#!/usr/bin/env node
"use strict";
/**
 * Train models via PyTorch server (GPU) and export pretrained weight files.
 * Sends graph + dataset to POST /api/train, waits for completion via SSE,
 * fetches result weights from GET /api/train/:id/result.
 *
 * Usage:
 *   node scripts/train_pretrained_server.js <demo-folder> [model-index]
 */

var fs = require("fs");
var path = require("path");
var http = require("http");
var zlib = require("zlib");
var vm = require("vm");

var SERVER = process.env.SURROGATE_SERVER || "http://localhost:3777";
var SERVER_URL = new (require("url").URL)(SERVER);

// Setup browser-like globals for preset loading
global.window = global;
global.document = {
  createElement: function () { return { onload: null, onerror: null, style: {} }; },
  head: { appendChild: function () {} },
};
global.OSCDatasetModules = { registerModule: function () {} };

var sr = require("../src/schema_registry.js");
global.OSCSchemaRegistry = sr;
require("../src/schema_definitions_builtin.js");
var dm = require("../src/dataset_modules.js");
global.OSCDatasetModules = dm;
try { global.OSCDatasetSourceRegistry = require("../src/dataset_source_registry.js"); } catch (_) {}
var MBC = require("../src/model_builder_core.js");

var demoDir = process.argv[2];
var modelIdx = process.argv[3] !== undefined ? Number(process.argv[3]) : -1;

if (!demoDir || !fs.existsSync(path.join(demoDir, "preset.js"))) {
  console.error("Usage: node scripts/train_pretrained_server.js <demo-folder> [model-index]");
  process.exit(1);
}

// Load demo-local files
var demoJsFiles = fs.readdirSync(demoDir).filter(function (f) {
  return f.endsWith(".js") && f !== "preset.js" && !f.includes("pretrained");
}).sort(function (a, b) {
  var order = function (n) { return n.includes("data") ? 0 : n.includes("schema") ? 1 : 2; };
  return order(a) - order(b);
});
demoJsFiles.forEach(function (f) {
  try {
    if (f.includes("data") && !f.includes("module") && !f.includes("schema")) {
      var src = fs.readFileSync(path.resolve(demoDir, f), "utf8");
      vm.runInThisContext(src, { filename: f });
      return;
    }
    var exported = require(path.resolve(demoDir, f));
    if (exported && exported.id && exported.build && typeof dm.registerModule === "function") {
      dm.registerModule(exported);
    }
  } catch (e) { console.warn("  [load] " + f + ": " + e.message); }
});

require(path.resolve(demoDir, "preset.js"));
var presetKey = Object.keys(global).find(function (k) { return k.endsWith("_PRESET"); });
if (!presetKey) { console.error("No preset found"); process.exit(1); }
var preset = global[presetKey];
console.log("Preset:", presetKey, "models:", preset.models.length, "trainers:", preset.trainers.length);

var schemaId = (preset.dataset && preset.dataset.schemaId) ||
  (preset.datasets && preset.datasets[0] && preset.datasets[0].schemaId) ||
  (preset.models && preset.models[0] && preset.models[0].schemaId) || "";
console.log("Schema:", schemaId);

function oneHot(label, n) { var arr = new Array(n).fill(0); arr[label] = 1; return arr; }
function slugify(name) {
  var s = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (/^[0-9]/.test(s)) s = "m" + s;
  return s;
}

function httpRequest(method, urlPath, body) {
  return new Promise(function (resolve, reject) {
    var opts = {
      hostname: SERVER_URL.hostname,
      port: SERVER_URL.port,
      path: urlPath,
      method: method,
      headers: { "Content-Type": "application/json", "Accept-Encoding": "gzip,deflate" },
    };
    var req = http.request(opts, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        var buf = Buffer.concat(chunks);
        if (res.headers["content-encoding"] === "gzip") {
          zlib.gunzip(buf, function (err, unzipped) {
            if (err) return reject(err);
            try { resolve(JSON.parse(unzipped.toString())); } catch (e) { resolve(unzipped.toString()); }
          });
        } else {
          try { resolve(JSON.parse(buf.toString())); } catch (e) { resolve(buf.toString()); }
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function waitForJob(jobId) {
  return new Promise(function (resolve, reject) {
    var opts = {
      hostname: SERVER_URL.hostname,
      port: SERVER_URL.port,
      path: "/api/train/" + jobId,
      method: "GET",
      headers: { "Accept": "text/event-stream" },
    };
    var req = http.request(opts, function (res) {
      var buf = "";
      var currentEvent = "";
      res.on("data", function (chunk) {
        buf += chunk.toString();
        var lines = buf.split("\n");
        buf = lines.pop();
        lines.forEach(function (line) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              var data = JSON.parse(line.slice(6));
              if (currentEvent === "epoch" || data.kind === "epoch") {
                var p = data.payload || data;
                var ep = p.epoch || data.epoch;
                if (ep && (ep % 5 === 0 || ep === 1)) {
                  console.log("    epoch " + ep + " loss=" + (p.loss != null ? Number(p.loss).toFixed(4) : "?") + " val=" + (p.val_loss != null ? Number(p.val_loss).toFixed(4) : "?"));
                }
              } else if (currentEvent === "complete" || data.kind === "complete") {
                resolve(data);
              } else if (currentEvent === "error" || data.kind === "error") {
                reject(new Error(data.message || "Server training failed"));
              }
            } catch (_) {}
            currentEvent = "";
          } else if (line.trim() === "") {
            currentEvent = "";
          }
        });
      });
      res.on("end", function () { resolve(null); });
    });
    req.on("error", reject);
    req.end();
  });
}

async function buildDataset() {
  var modList = dm.getModuleForSchema(schemaId);
  if (!modList || !modList.length) throw new Error("No module for schema: " + schemaId);
  var mod = dm.getModule(modList[0].id);
  var pds = preset.dataset || (preset.datasets && preset.datasets[0]) || {};
  var cfg = { seed: pds.seed || 42, schemaId: schemaId, moduleId: mod.id, sourceMode: "synthetic" };
  if (pds.config) Object.assign(cfg, pds.config);
  // Cap dataset size for server training (JSON payload limit)
  var maxSamples = Number(process.env.MAX_SAMPLES || 6000);
  cfg.totalCount = Math.min(maxSamples, pds.totalCount || pds.sourceTotalExamples || maxSamples);
  var result = await mod.build(cfg);
  if (!result) throw new Error("build returned null");

  // Handle different dataset formats
  if (result.xTrain && result.xTrain.length) {
    if ((result.targetMode === "label" || result.targetMode === "classification") && typeof result.yTrain[0] === "number") {
      var nc = result.classCount || result.numClasses || 2;
      result.labelsTrain = result.yTrain.map(function (l) { return oneHot(l, nc); });
      result.labelsVal = result.yVal.map(function (l) { return oneHot(l, nc); });
      result.labelsTest = result.yTest.map(function (l) { return oneHot(l, nc); });
    }
    return result;
  }
  if (result.records) {
    var train = result.records.train || {};
    var val = result.records.val || {};
    var test = result.records.test || {};
    var nc2 = result.classCount || 10;
    result.xTrain = train.x || []; result.yTrain = (train.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc2) : l; });
    result.xVal = val.x || []; result.yVal = (val.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc2) : l; });
    result.xTest = test.x || []; result.yTest = (test.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc2) : l; });
    result.featureSize = result.featureSize || (result.xTrain[0] && result.xTrain[0].length) || 784;
    result.labelsTrain = result.yTrain;
    result.labelsVal = result.yVal;
    result.labelsTest = result.yTest;
    if (result.xTrain.length) return result;
  }
  // Zero-copy with splitIndices — resolve through source registry
  if (result.splitIndices && global.OSCDatasetSourceRegistry) {
    var _srcReg = global.OSCDatasetSourceRegistry;
    if (typeof _srcReg.resolveDatasetSplit === "function") {
      var tr = _srcReg.resolveDatasetSplit(result, "train");
      var va = _srcReg.resolveDatasetSplit(result, "val");
      var te = _srcReg.resolveDatasetSplit(result, "test");
      if (tr && tr.x && tr.x.length) {
        var nc3 = result.classCount || 10;
        result.xTrain = tr.x; result.yTrain = (tr.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc3) : l; });
        result.xVal = va.x || []; result.yVal = (va.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc3) : l; });
        result.xTest = te.x || []; result.yTest = (te.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc3) : l; });
        result.featureSize = result.featureSize || (result.xTrain[0] && result.xTrain[0].length) || 784;
        result.labelsTrain = result.yTrain;
        result.labelsVal = result.yVal;
        result.labelsTest = result.yTest;
        if (result.xTrain.length) return result;
      }
    }
  }
  console.log("  Dataset keys:", Object.keys(result).join(", "));
  throw new Error("Unsupported build result format");
}

function exportPretrained(trainerName, config, result, outputPath) {
  var weightSpecs = result.weightSpecs || [];
  // Normalize: server may return weightData (flat array) or weightValues
  var weightValues = result.weightValues || [];
  if (!weightValues.length && result.weightData) {
    weightValues = Array.isArray(result.weightData) ? result.weightData : Array.from(new Float32Array(result.weightData));
  }
  // Integrity check
  var expectedLen = weightSpecs.reduce(function (sum, s) { return sum + (s.shape || []).reduce(function (a, b) { return a * b; }, 1); }, 0);
  if (weightValues.length !== expectedLen) {
    console.warn("  WARNING: weightValues length " + weightValues.length + " != expected " + expectedLen + " from specs");
  }
  var metrics = result.metrics || {};

  var meta = {
    name: trainerName,
    status: "done",
    config: config,
    metrics: metrics,
    backend: "cuda",
    weightSpecs: weightSpecs,
    epochs: result.epochs || [],
  };

  var metaJson = JSON.stringify(meta);
  var metaBytes = Buffer.from(metaJson, "utf8");
  var weightBuf = Buffer.from(new Float32Array(weightValues).buffer);
  var lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(metaBytes.length, 0);
  var fullBuf = Buffer.concat([lenBuf, metaBytes, weightBuf]);
  var b64 = fullBuf.toString("base64");
  var varName = slugify(trainerName).toUpperCase() + "_PRETRAINED_BIN_B64";
  var js = "// Pre-trained " + trainerName + " (PyTorch CUDA)\nwindow." + varName + " = \"" + b64 + "\";\n";
  fs.writeFileSync(outputPath, js);
  console.log("  Exported:", outputPath, "(" + (fullBuf.length / 1024).toFixed(0) + " KB,", weightSpecs.length, "weight arrays)");
  return varName;
}

async function trainOneModel(modelDef, dataset, trainerDef) {
  var graph = modelDef.graph;
  if (!graph) { console.log("  SKIP (no graph)"); return null; }

  var outputKeys = sr.getOutputKeys(schemaId).map(function (k) { return (k && typeof k === "object") ? k.key : k; });
  var defaultTarget = outputKeys[0] || "x";
  var featureSize = dataset.featureSize || (dataset.xTrain[0] && dataset.xTrain[0].length) || 1;
  var tc = trainerDef.trainCfg || trainerDef.config || {};

  // Build headConfigs from graph — same contract as browser/worker
  var graphHeadConfigs = [];
  try {
    var tf = { layers: {}, sequential: function(){}, model: function(){} };  // stub — only need headConfigs, not actual model
    var buildInfo = MBC.buildModelFromGraph(require("../src/tfjs_node_loader.js").loadTfjs(), graph, {
      mode: "direct", featureSize: featureSize, windowSize: 1, seqFeatureSize: featureSize,
      allowedOutputKeys: outputKeys, defaultTarget: defaultTarget,
      numClasses: dataset.numClasses || dataset.classCount || 10,
    });
    graphHeadConfigs = buildInfo.headConfigs || [];
    if (buildInfo.model) try { buildInfo.model.dispose(); } catch (_) {}
  } catch (e) { console.warn("  Could not extract headConfigs from graph:", e.message); }

  // Build payload for server
  var payload = {
    runId: "pretrain-" + slugify(modelDef.name) + "-" + Date.now().toString(36),
    graph: graph,
    schemaId: schemaId,
    headConfigs: graphHeadConfigs,
    dataset: {
      xTrain: dataset.xTrain,
      yTrain: dataset.yTrain,
      xVal: dataset.xVal,
      yVal: dataset.yVal,
      xTest: dataset.xTest || [],
      yTest: dataset.yTest || [],
      labelsTrain: dataset.labelsTrain || [],
      labelsVal: dataset.labelsVal || [],
      labelsTest: dataset.labelsTest || [],
      featureSize: featureSize,
      targetSize: dataset.targetSize || (dataset.yTrain[0] ? (Array.isArray(dataset.yTrain[0]) ? dataset.yTrain[0].length : 1) : 1),
      numClasses: dataset.numClasses || dataset.classCount || 10,
      targetMode: dataset.targetMode || defaultTarget,
    },
    epochs: tc.epochs || 30,
    batchSize: tc.batchSize || 32,
    learningRate: tc.learningRate || 0.001,
    optimizerType: tc.optimizerType || tc.optimizer || "adam",
    lrSchedulerType: tc.lrSchedulerType || "plateau",
    earlyStoppingPatience: tc.earlyStoppingPatience || 10,
    restoreBestWeights: true,
  };

  console.log("  Sending to server (", dataset.xTrain.length, "train samples, features:", featureSize, ")...");
  var startRes = await httpRequest("POST", "/api/train", payload);
  if (!startRes.jobId) throw new Error("Server did not return jobId: " + JSON.stringify(startRes));
  console.log("  Job:", startRes.jobId);

  // Wait for completion via SSE — the complete event includes the full result
  var sseResult = await waitForJob(startRes.jobId);

  // Try SSE result first, fall back to explicit fetch
  var result = sseResult;
  if (!result || !result.weightSpecs) {
    console.log("  Fetching result from endpoint...");
    result = await httpRequest("GET", "/api/train/" + startRes.jobId + "/result");
  }
  // Normalize result — server returns modelArtifacts with weightSpecs/weightValues inside
  var artifacts = result.modelArtifacts || result;
  if (!artifacts.weightSpecs && !artifacts.weightValues) throw new Error("No weight data in result. Keys: " + Object.keys(result || {}).join(","));
  artifacts.metrics = result.metrics || { mae: result.mae, mse: result.mse, bestEpoch: result.bestEpoch, bestValLoss: result.bestValLoss };
  console.log("  Training complete. Weights:", (artifacts.weightSpecs || []).length, "arrays, MAE:", result.mae || result.testMae || "?");
  return artifacts;
}

async function main() {
  console.log("\nBuilding dataset...");
  var dataset = await buildDataset();
  console.log("Dataset: train=" + dataset.xTrain.length + " val=" + (dataset.xVal || []).length);

  var models = preset.models || [];
  var trainers = preset.trainers || [];

  for (var mi = 0; mi < models.length; mi++) {
    if (modelIdx >= 0 && mi !== modelIdx) continue;
    var modelDef = models[mi];
    console.log("\n=== Model " + mi + ": " + modelDef.name + " ===");

    var trainer = trainers.find(function (t) { return t.modelId === modelDef.id && !t._pretrainedVar; }) ||
      trainers.find(function (t) { return t.modelId === modelDef.id; });
    if (!trainer) { console.log("  No trainer found"); continue; }

    try {
      var result = await trainOneModel(modelDef, dataset, trainer);
      if (!result) continue;

      var trainerName = modelDef.name + " (pre-trained)";
      var slug = slugify(modelDef.name);
      var outPath = path.join(demoDir, slug + "_pretrained.js");
      var tc = trainer.trainCfg || trainer.config || {};
      exportPretrained(trainerName, tc, result, outPath);
    } catch (err) {
      console.log("  FAIL:", err.message);
    }
  }
  console.log("\nDone.");
}

main().catch(function (e) { console.error("FAIL:", e.message); process.exit(1); });

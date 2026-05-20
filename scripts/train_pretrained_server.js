#!/usr/bin/env node
"use strict";
/**
 * Train models via PyTorch server (GPU) and export pretrained weight files.
 * Sends graph + dataset to POST /api/train, waits for completion via SSE,
 * fetches result weights from GET /api/train/:id/result.
 *
 * Usage:
 *   node scripts/train_pretrained_server.js <demo-folder> [model-index]
 *
 * Memory: defaults to 8 GB heap. Some demos (Oscillator-Surrogate)
 * carry 100k+ trajectory samples that exceed Node's stock 4 GB heap
 * during JSON encoding for the server payload. Set NODE_OPTIONS to
 * override (e.g. NODE_OPTIONS=--max-old-space-size=16384 for very
 * large datasets).
 */
if (!process.env.NODE_OPTIONS || !/--max-old-space-size/.test(process.env.NODE_OPTIONS)) {
    var spawn = require("child_process").spawnSync;
    var existing = process.env.NODE_OPTIONS || "";
    var nodeOpts = (existing + " --max-old-space-size=8192").trim();
    if (!process.env.__OSC_RETRAIN_RESPAWNED) {
        var result = spawn(process.execPath, process.argv.slice(1), {
            stdio: "inherit",
            env: Object.assign({}, process.env, {
                NODE_OPTIONS: nodeOpts,
                __OSC_RETRAIN_RESPAWNED: "1",
            }),
        });
        // Propagate child failure honestly. status === null means the
        // child died from a signal (e.g. OOM kill, SIGABRT) — must NOT
        // report success in that case. The previous `result.status || 0`
        // collapsed null → 0, masking signal failures.
        if (result.error) {
            console.error("respawn failed:", result.error.message);
            process.exit(1);
        }
        if (result.signal) {
            console.error("child terminated by signal:", result.signal);
            process.exit(1);
        }
        process.exit(typeof result.status === "number" ? result.status : 1);
    }
}

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
  // ais_module._resolveDataBase walks document.getElementsByTagName("script")
  // at module-load time. Without this stub the require throws, safeRequire
  // in dataset_modules.js swallows it, and `getModuleForSchema("ais_trajectory")`
  // silently returns 0 matches — making it impossible to retrain TrAISformer
  // through this script. Returning an empty NodeList-ish array lets
  // _resolveDataBase fall through to its sensible "../../data/ais-dma/" default.
  getElementsByTagName: function () { return []; },
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

// Stream-encode `value` as JSON to a Writable. Built because Node's
// JSON.stringify caps at the V8 max string length (~512 MB), which
// the Oscillator-Surrogate dataset trips with totalCount >= ~150
// trajectories (each window-expands into thousands of samples). For
// huge arrays (xTrain, yTrain, ...) we batch CHUNK_ROWS rows per
// JSON.stringify call so a 1.25M-row dataset is ~12K stream.writes
// instead of 60M+ recursive callbacks. Backpressure is honored via
// 'drain'.
var _STREAM_CHUNK_ROWS = 256;

function _streamJSONValue(stream, value, onDrain) {
  if (value === null || value === undefined || typeof value !== "object") {
    return _writeWithBackpressure(stream, JSON.stringify(value === undefined ? null : value), onDrain);
  }
  if (Array.isArray(value)) return _streamArray(stream, value, onDrain);
  return _streamObject(stream, value, onDrain);
}

function _streamArray(stream, arr, onDrain) {
  if (arr.length === 0) return _writeWithBackpressure(stream, "[]", onDrain);
  // Empty array, plain primitives, or short arrays-of-primitives:
  // stringify in one call.
  if (arr.length < _STREAM_CHUNK_ROWS && _arrayDepth(arr) <= 1) {
    return _writeWithBackpressure(stream, JSON.stringify(arr), onDrain);
  }
  // Big array: batch rows by chunk and stream each chunk.
  _writeWithBackpressure(stream, "[", function () {
    _streamArrayChunks(stream, arr, 0, function () {
      _writeWithBackpressure(stream, "]", onDrain);
    });
  });
}

function _streamArrayChunks(stream, arr, i, done) {
  if (i >= arr.length) return done();
  var end = Math.min(i + _STREAM_CHUNK_ROWS, arr.length);
  var parts = [];
  for (var k = i; k < end; k++) {
    if (k > 0) parts.push(",");
    parts.push(JSON.stringify(arr[k]));
  }
  _writeWithBackpressure(stream, parts.join(""), function () {
    _streamArrayChunks(stream, arr, end, done);
  });
}

function _streamObject(stream, obj, onDrain) {
  var keys = Object.keys(obj);
  if (keys.length === 0) return _writeWithBackpressure(stream, "{}", onDrain);
  _writeWithBackpressure(stream, "{", function () {
    _streamObjectKey(stream, obj, keys, 0, function () {
      _writeWithBackpressure(stream, "}", onDrain);
    });
  });
}

function _streamObjectKey(stream, obj, keys, i, done) {
  if (i >= keys.length) return done();
  var k = keys[i];
  var prefix = (i > 0 ? "," : "") + JSON.stringify(k) + ":";
  _writeWithBackpressure(stream, prefix, function () {
    _streamJSONValue(stream, obj[k], function () {
      _streamObjectKey(stream, obj, keys, i + 1, done);
    });
  });
}

// Quick depth probe for arrays. Returns 0 for primitive arrays,
// 1 for arrays of primitive arrays (typical xTrain rows), 2+ for
// nested. Cheap because we only sample arr[0].
function _arrayDepth(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  if (typeof arr[0] !== "object" || arr[0] === null) return 0;
  if (Array.isArray(arr[0])) {
    return 1 + _arrayDepth(arr[0]);
  }
  return 2;  // contains plain objects — needs recursive encode
}

function _writeWithBackpressure(stream, chunk, done) {
  if (stream.write(chunk)) {
    setImmediate(done);  // setImmediate yields the event loop better than nextTick for huge loops
  } else {
    stream.once("drain", done);
  }
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
    if (body == null) {
      req.end();
      return;
    }
    if (typeof body === "string") {
      req.write(body);
      req.end();
      return;
    }
    // Object: stream-encode to avoid JSON.stringify's V8 string-length cap.
    _streamJSONValue(req, body, function () { req.end(); });
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
      var epochsLog = [];
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
                epochsLog.push(p);
                var ep = p.epoch || data.epoch;
                if (ep && (ep % 5 === 0 || ep === 1)) {
                  console.log("    epoch " + ep + " loss=" + (p.loss != null ? Number(p.loss).toFixed(4) : "?") + " val=" + (p.val_loss != null ? Number(p.val_loss).toFixed(4) : "?"));
                }
              } else if (currentEvent === "complete" || data.kind === "complete") {
                data.epochs = epochsLog;
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
  var cfg = { seed: pds.seed || 42, schemaId: schemaId, moduleId: mod.id };
  if (pds.config) Object.assign(cfg, pds.config);
  // If the preset asks for the real source (Fashion-MNIST etc.), the dataset
  // module loads IDX files from data/. Only fall back to synthetic when the
  // preset explicitly opts in — otherwise the script silently trains on random
  // pixels instead of real samples (showed up as checkerboard/noise generation
  // for GAN demos despite healthy-looking BCE loss).
  var presetSays = String(pds.config && pds.config.sourceMode || "").trim().toLowerCase();
  var useFullSource = !!(pds.config && pds.config.useFullSource);
  if (!cfg.sourceMode) {
    cfg.sourceMode = presetSays || (useFullSource ? "" : "synthetic");
  }
  // Cap dataset size for server training (JSON payload limit ~200MB).
  // MAX_SAMPLES, if set, is the authoritative upper bound — and it overrides the
  // preset's totalCount (otherwise GAN demos with classFilter that yield ~600
  // samples/epoch starve adversarial schedules of batches: WGAN's 5 D + 1 G
  // schedule needs ≥6 batches/epoch for the generator to ever update).
  var envMax = Number(process.env.MAX_SAMPLES || 0);
  if (envMax > 0) {
    cfg.totalCount = envMax;
  } else {
    var defaultMax = 6000;
    cfg.totalCount = Math.min(defaultMax, pds.totalCount || pds.sourceTotalExamples || defaultMax);
  }
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

function exportPretrained(trainerName, config, result, outputPath, varNameOverride) {
  var weightSpecs = result.weightSpecs || [];
  // Normalize: server may return weightData (flat array) or weightValues
  var weightValues = result.weightValues || [];
  if (!weightValues.length && result.weightData) {
    weightValues = Array.isArray(result.weightData) ? result.weightData : Array.from(new Float32Array(result.weightData));
  }
  // Integrity check — fatal, never write a corrupt file
  var expectedLen = weightSpecs.reduce(function (sum, s) { return sum + (s.shape || []).reduce(function (a, b) { return a * b; }, 1); }, 0);
  if (weightValues.length !== expectedLen) {
    throw new Error(
      "Weight data mismatch: got " + weightValues.length + " values, expected " + expectedLen +
      " from " + weightSpecs.length + " specs. " +
      "Refusing to write corrupt pretrained file. " +
      "Check server response — likely missing weightValues/weightData field."
    );
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
  // Prefer the preset's _pretrainedVar (matches what the demo's index.html / preset.js expect).
  // Fall back to deriving from trainerName only when no override is provided.
  var varName = varNameOverride || (slugify(trainerName).toUpperCase() + "_PRETRAINED_BIN_B64");
  var js = "// Pre-trained " + trainerName + " (PyTorch CUDA)\nwindow." + varName + " = \"" + b64 + "\";\n";
  fs.writeFileSync(outputPath, js);
  console.log("  Exported:", outputPath, "(" + (fullBuf.length / 1024).toFixed(0) + " KB,", weightSpecs.length, "weight arrays)");
  return varName;
}

async function trainOneModel(modelDef, dataset, trainerDef) {
  var graph = modelDef.graph;
  if (!graph) { console.log("  SKIP (no graph)"); return null; }

  // Keep full output-key objects (with featureSize, headType, etc.) — the
  // browser path passes these objects to buildModelFromGraph and so should
  // we, otherwise targetUnitsFromMode falls through to its default-1
  // fallback for any custom target name and the model output collapses to
  // a single scalar (BUG-41).
  var outputKeys = sr.getOutputKeys(schemaId);
  var defaultTarget = (outputKeys[0] && (outputKeys[0].key || outputKeys[0])) || "x";
  var featureSize = dataset.featureSize || (dataset.xTrain[0] && dataset.xTrain[0].length) || 1;
  var tc = trainerDef.trainCfg || trainerDef.config || {};

  // Build headConfigs from graph — same contract as browser/worker.
  // #183 P2: the build is also where Layer 1 / 2 / 3 validation runs (shape,
  // type lineage, paired-config sync). A build failure here means the graph
  // is invalid; sending it to the server would either reproduce the same
  // failure or silently produce a mis-augmented training run. Abort fast.
  var graphHeadConfigs = [];
  try {
    var tf = { layers: {}, sequential: function(){}, model: function(){} };  // stub — only need headConfigs, not actual model
    var buildInfo = MBC.buildModelFromGraph(require("../src/tfjs_node_loader.js").loadTfjs(), graph, {
      mode: "direct", featureSize: featureSize, windowSize: 1, seqFeatureSize: featureSize,
      allowedOutputKeys: outputKeys, defaultTarget: defaultTarget,
      numClasses: dataset.numClasses || dataset.classCount || 10,
      // Required for dynamic-width targets (Custom CSV target column,
      // any schema whose output omits featureSize). model_builder_core
      // throws here rather than silently defaulting to 1 — see PR #90's
      // ais_trajectory.position bug for what the silent default cost us.
      targetSize: dataset.targetSize,
    });
    graphHeadConfigs = buildInfo.headConfigs || [];
    if (buildInfo.model) try { buildInfo.model.dispose(); } catch (_) {}
  } catch (e) {
    console.error("  Graph build failed (Layer 1/2/3 validation or compile): " + e.message);
    throw e;  // abort retrain instead of warning and continuing
  }

  // Build payload for server.
  // Spread the entire trainer config first so the server receives every field the user
  // declared in preset.js (trainingSchedule, rotateSchedule, optimizerBeta1/Beta2,
  // weightSelection, clipWeights, etc.). This keeps the script contract-driven — the UI
  // sends the same full config to /api/train, and the script must match that envelope or
  // adversarial trainers (which need phase scheduling) will diverge.
  // SEED env var, if set, overrides the trainer's seed for reproducible
  // retrains (lets us hunt WGAN basins by trying multiple seeds). Otherwise
  // honors tc.seed, then preset.dataset.seed, then 42.
  var envSeed = Number(process.env.SEED);
  var resolvedSeed = Number.isFinite(envSeed) && envSeed >= 0
    ? envSeed
    : (tc && tc.seed != null ? Number(tc.seed) : (preset && preset.dataset && preset.dataset.seed != null ? Number(preset.dataset.seed) : 42));
  var payload = Object.assign({}, tc || {}, {
    runId: "pretrain-" + slugify(modelDef.name) + "-" + Date.now().toString(36),
    graph: graph,
    schemaId: schemaId,
    headConfigs: graphHeadConfigs,
    seed: resolvedSeed,
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
    // Defaults for fields the trainer config didn't specify.
    // EPOCHS env var, if set, overrides the preset (lets pretrained generators
    // be trained beyond their preset's epoch count for visual smoothness — DCGAN
    // BCE plateaus around 200 but conv-transpose checkerboard takes longer to fade).
    epochs: Number(process.env.EPOCHS) > 0 ? Number(process.env.EPOCHS) : (tc.epochs || 30),
    batchSize: tc.batchSize || 32,
    learningRate: tc.learningRate || 0.001,
    optimizerType: tc.optimizerType || tc.optimizer || "adam",
    lrSchedulerType: tc.lrSchedulerType || "plateau",
    earlyStoppingPatience: tc.earlyStoppingPatience != null ? tc.earlyStoppingPatience : 10,
  });
  // Do NOT force restoreBestWeights — the server's _resolve_restore_best_weights
  // honors weightSelection ("last" → use final epoch). Forcing true here reverts
  // the model to bestEpoch (often epoch 3 of a GAN, when D had crushed G), so
  // the exported weights are essentially untrained → noise/checkerboard generation.
  // If the trainer config says restoreBestWeights, it'll already be in tc via the
  // Object.assign spread above; otherwise let the server resolve from weightSelection.

  console.log("  Sending to server (", dataset.xTrain.length, "train samples, features:", featureSize, ")...");
  var startRes = await httpRequest("POST", "/api/train", payload);
  if (!startRes.jobId) throw new Error("Server did not return jobId: " + JSON.stringify(startRes));
  console.log("  Job:", startRes.jobId);

  // Wait for completion via SSE
  var sseResult = await waitForJob(startRes.jobId);

  // SSE sends lightweight result (no modelArtifacts) — always fetch full result via GET
  // Retry up to 3 times with delay to handle server stdout drain timing
  var result = null;
  var maxRetries = 3;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      console.log("  Retry " + attempt + "/" + maxRetries + " (waiting for server to drain stdout)...");
      await new Promise(function (r) { setTimeout(r, 2000); });
    }
    console.log("  Fetching result from endpoint...");
    result = await httpRequest("GET", "/api/train/" + startRes.jobId + "/result");
    if (result && result.modelArtifacts) break;
    if (result && result.error) {
      console.log("  Server: " + result.error);
    }
  }

  // Normalize result — server returns modelArtifacts with weightSpecs/weightData inside
  var artifacts = result.modelArtifacts || result;
  if (!artifacts.weightSpecs) {
    throw new Error("No weightSpecs in result. Keys: " + Object.keys(result || {}).join(",") +
      (artifacts !== result ? "; artifact keys: " + Object.keys(artifacts).join(",") : ""));
  }

  // Verify weight data is present (weightData from server, weightValues from TF.js)
  var wv = artifacts.weightValues || artifacts.weightData || [];
  var expectedCount = (artifacts.weightSpecs || []).reduce(function (sum, s) {
    return sum + (s.shape || []).reduce(function (a, b) { return a * b; }, 1);
  }, 0);
  if (!wv.length || wv.length !== expectedCount) {
    throw new Error(
      "Weight data missing or incomplete in server response. " +
      "Got " + wv.length + " values, expected " + expectedCount + ". " +
      "Artifact keys: " + Object.keys(artifacts).join(",")
    );
  }

  // Build a scalar-only metrics summary. The result endpoint sometimes omits
  // result.metrics — when that happens the previous code fell through to
  // sseResult, which carries the full epochs[] array, doubling the artifact
  // size and polluting the metrics contract. Pull only summary scalars.
  function _scalarMetrics(src) {
    if (!src || typeof src !== "object") return {};
    var out = {};
    var scalarKeys = ["mae", "mse", "bestEpoch", "bestValLoss", "finalLr",
      "stoppedEarly", "stoppedByUser", "headCount", "backend", "paramCount",
      "resolvedBackend", "hasArtifacts"];
    scalarKeys.forEach(function (k) {
      if (src[k] != null && typeof src[k] !== "object") out[k] = src[k];
    });
    return out;
  }
  artifacts.metrics = Object.assign(
    _scalarMetrics(sseResult),
    _scalarMetrics(result),
    _scalarMetrics(result.metrics)
  );
  artifacts.epochs = (sseResult && sseResult.epochs) || result.epochs || [];
  console.log("  Training complete. Weights:", artifacts.weightSpecs.length, "arrays (" + wv.length + " values), epochs captured:", artifacts.epochs.length, ", MAE:", (artifacts.metrics || {}).mae || "?");
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
      var tc = trainer.trainCfg || trainer.config || {};
      // Look up the preset's pretrained trainer entry — its _pretrainedVar is
      // the global the loader reads, and the demo's index.html includes a fixed
      // filename for that global. Filenames are inconsistent across demos
      // (m1_mlp_baseline vs MLP_BASELINE_PRE_TRAINED_PRETRAINED, etc.), so
      // slugifying the var name doesn't always match — instead, find the
      // existing demo file that already declares `window.<VAR>` and overwrite
      // that path. Falls back to slug only when no existing file matches
      // (which is appropriate for genuinely new cards).
      var pretrainedTrainer = trainers.find(function (t) {
        return t.modelId === modelDef.id && t._pretrainedVar;
      });
      var varName, outPath;
      if (pretrainedTrainer && pretrainedTrainer._pretrainedVar) {
        varName = pretrainedTrainer._pretrainedVar;
        var existing = null;
        try {
          var candidates = fs.readdirSync(demoDir)
            .filter(function (f) { return f.endsWith("_pretrained.js"); });
          var needle = "window." + varName + " ";
          for (var ci = 0; ci < candidates.length; ci++) {
            var p = path.join(demoDir, candidates[ci]);
            var head = fs.readFileSync(p, "utf8").slice(0, 1024);
            if (head.indexOf(needle) >= 0) { existing = p; break; }
          }
        } catch (_) {}
        if (existing) {
          outPath = existing;
        } else {
          // No existing file — derive default. The slug heuristic is imperfect
          // for trainer names containing "(pre-trained)" but it's a reasonable
          // first guess; the resulting filename can be checked in via PR.
          var fnameBase = varName.toLowerCase().replace(/_bin_b64$/, "");
          outPath = path.join(demoDir, fnameBase + ".js");
          console.log("  WARNING: no existing pretrained file declares window." +
            varName + " — writing to " + path.basename(outPath) +
            ". Verify the demo's index.html <script src=...> matches.");
        }
      } else {
        varName = slugify(trainerName).toUpperCase() + "_PRETRAINED_BIN_B64";
        outPath = path.join(demoDir, slugify(modelDef.name) + "_pretrained.js");
      }
      exportPretrained(trainerName, tc, result, outPath, varName);
    } catch (err) {
      console.log("  FAIL:", err.message);
    }
  }
  console.log("\nDone.");
}

main().catch(function (e) { console.error("FAIL:", e.message); process.exit(1); });

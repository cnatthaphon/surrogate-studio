/**
 * Train Oscillator Surrogate models via PyTorch server and export pretrained weights.
 *
 * Run: node scripts/train_oscillator_pretrained.js
 *
 * Requires: PyTorch training server running on localhost:3777
 */
"use strict";
global.window = global;

var http = require("http");
var fs = require("fs");
var path = require("path");
var mb = require("../src/model_builder_core.js");

require("../src/schema_registry.js");
require("../src/schema_definitions_builtin.js");
var oscCore = require("../src/oscillator_dataset_core.js");
if (oscCore) global.window.OSCOscillatorDatasetCore = oscCore;
var oscModule = require("../src/dataset_modules/oscillator_module.js");
if (oscModule) global.window.OSCDatasetModuleOscillator = oscModule;

eval(fs.readFileSync("demo/Oscillator-Surrogate/preset.js", "utf8"));
var preset = window.OSCILLATOR_DEMO_PRESET;

var DEMO_DIR = path.resolve(__dirname, "../demo/Oscillator-Surrogate");
var SERVER = "http://localhost:3777";
var EPOCHS = 30;
var BATCH = 32;

function postJSON(url, data) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify(data);
    var u = new (require("url").URL)(url);
    var req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        var text = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(text)); } catch (e) { resolve({ raw: text }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function streamSSE(url) {
  return new Promise(function (resolve, reject) {
    var u = new (require("url").URL)(url);
    http.get({ hostname: u.hostname, port: u.port, path: u.pathname }, function (res) {
      var epochLogs = [];
      var result = null;
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
              var d = JSON.parse(line.slice(6));
              if (currentEvent === "epoch" && d.epoch != null) {
                epochLogs.push(d);
                if (d.epoch % 5 === 0 || d.epoch === 1)
                  console.log("    epoch " + d.epoch + " loss=" + (d.loss || 0).toFixed(6) + " val=" + (d.val_loss || 0).toFixed(6));
              }
              if (currentEvent === "complete" || currentEvent === "result") {
                result = d;
              }
            } catch (e) {}
            currentEvent = "";
          }
        });
      });
      res.on("end", function () { resolve({ epochs: epochLogs, result: result }); });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function packBinary(meta, specs, values) {
  meta.weightSpecs = specs;
  var metaJson = JSON.stringify(meta);
  var metaBytes = Buffer.from(metaJson, "utf8");
  var metaLen = metaBytes.length;
  var totalBytes = values.length * 4;
  var out = Buffer.alloc(4 + metaLen + totalBytes);
  out.writeUInt32LE(metaLen, 0);
  metaBytes.copy(out, 4);
  var fBuf = Buffer.from(new Float32Array(values).buffer);
  fBuf.copy(out, 4 + metaLen);
  return out;
}

// Need source registry for zero-copy resolution
var srcReg = require("../src/dataset_source_registry.js");
if (srcReg) global.window.OSCDatasetSourceRegistry = srcReg;

// Build oscillator dataset
console.log("Generating oscillator dataset...");
var dsRaw = oscModule.build({
  seed: 42, numTraj: 300,
  splitConfig: { mode: "stratified_scenario", train: 0.70, val: 0.15, test: 0.15 },
  includedScenarios: ["spring", "pendulum", "bouncing"],
  scenarioType: "none",
  predictionMode: "autoregressive",
  targetMode: "xv",
  windowSize: 20,
  dt: 0.05, steps: 200, durationSec: 10,
  featureConfig: { useX: true, useV: true, useParams: true },
  featureSpec: {
    useX: true, useV: true, useParams: true,
    useTimeSec: false, useTimeNorm: false, useScenario: false,
    useSinNorm: false, useCosNorm: false, useNoiseSchedule: false,
    paramMask: { m: true, c: true, k: true, e: false, x0: false, v0: false, gm: false, gk: false, gc: false },
  },
});
// Resolve actual arrays from source registry
var trainSplit = srcReg.resolveDatasetSplit(dsRaw, "train");
var valSplit = srcReg.resolveDatasetSplit(dsRaw, "val");
var testSplit = srcReg.resolveDatasetSplit(dsRaw, "test");
var ds = {
  xTrain: trainSplit.x || dsRaw.xTrain || [],
  yTrain: trainSplit.y || dsRaw.yTrain || [],
  xVal: valSplit.x || dsRaw.xVal || [],
  yVal: valSplit.y || dsRaw.yVal || [],
  xTest: testSplit.x || dsRaw.xTest || [],
  yTest: testSplit.y || dsRaw.yTest || [],
  labelsTrain: dsRaw.labelsTrain || [], labelsVal: dsRaw.labelsVal || [], labelsTest: dsRaw.labelsTest || [],
  pTrain: dsRaw.pTrain || [], pVal: dsRaw.pVal || [], pTest: dsRaw.pTest || [],
  classCount: dsRaw.classCount || dsRaw.numClasses || 3,
  numClasses: dsRaw.numClasses || dsRaw.classCount || 3,
};
console.log("Train: " + ds.xTrain.length + " Val: " + ds.xVal.length + " Test: " + ds.xTest.length);
var featureSize = ds.xTrain[0] ? ds.xTrain[0].length : 1;
var targetSize = ds.yTrain[0] ? (Array.isArray(ds.yTrain[0]) ? ds.yTrain[0].length : 1) : 1;
var numClasses = ds.classCount || ds.numClasses || 3;
console.log("Feature size: " + featureSize + " Target size: " + targetSize + " Classes: " + numClasses);

// Ensure y is always 2D array
function ensureY(y) {
  if (!y.length) return y;
  if (typeof y[0] === "number") return y.map(function (v) { return [v]; });
  return y;
}
var yTrain = ensureY(ds.yTrain);
var yVal = ensureY(ds.yVal);
var yTest = ensureY(ds.yTest);

// Labels for classification (VAE+Classifier needs this)
var labelsTrain = ds.labelsTrain || ds.pTrain || [];
var labelsVal = ds.labelsVal || ds.pVal || [];
var labelsTest = ds.labelsTest || ds.pTest || [];

// One-hot encode labels
function oneHot(label, n) { var arr = new Array(n).fill(0); arr[typeof label === "number" ? label : 0] = 1; return arr; }
function ensureOneHotLabels(labels) {
  if (!labels.length) return labels;
  if (typeof labels[0] === "number") return labels.map(function (l) { return oneHot(l, numClasses); });
  return labels;
}

var modelConfigs = [
  { model: preset.models[0], trainer: preset.trainers[0], varName: "OSC_MLP_PRETRAINED_BIN_B64", file: "mlp_pretrained.js" },
  { model: preset.models[1], trainer: preset.trainers[1], varName: "OSC_GRU_PRETRAINED_BIN_B64", file: "gru_pretrained.js" },
  { model: preset.models[2], trainer: preset.trainers[2], varName: "OSC_VAE_PRETRAINED_BIN_B64", file: "vae_pretrained.js" },
  { model: preset.models[3], trainer: preset.trainers[3], varName: "OSC_VAE_CLS_PRETRAINED_BIN_B64", file: "vae_cls_pretrained.js" },
  { model: preset.models[4], trainer: preset.trainers[4], varName: "OSC_DENOISER_PRETRAINED_BIN_B64", file: "denoiser_pretrained.js" },
];

var midx = 0;
function nextModel() {
  if (midx >= modelConfigs.length) {
    console.log("\nAll pretrained weights exported!");
    process.exit(0);
  }
  var cfg = modelConfigs[midx++];
  var m = cfg.model;
  var tCfg = cfg.trainer.config;
  var lr = tCfg.learningRate || 0.001;
  console.log("\n=== Training: " + m.name + " (" + EPOCHS + " epochs, lr=" + lr + ") ===");

  // Build model info
  var tf = require("@tensorflow/tfjs");
  var allowedOutputKeys = [{ key: "xv", headType: "regression" }];
  // VAE+Classifier has a label head too
  var isMultiHead = m.name.indexOf("Classifier") >= 0;
  if (isMultiHead) {
    allowedOutputKeys.push({ key: "label", headType: "classification" });
  }
  var built = mb.buildModelFromGraph(tf, m.graph, {
    mode: "direct", featureSize: featureSize, numClasses: numClasses,
    allowedOutputKeys: allowedOutputKeys, defaultTarget: "xv",
  });
  console.log("  params: " + built.model.countParams());
  built.model.dispose();

  // Prepare dataset for server
  var datasetPayload = {
    featureSize: featureSize, targetSize: targetSize,
    mode: "regression", targetMode: "xv",
    xTrain: ds.xTrain, yTrain: yTrain,
    xVal: ds.xVal, yVal: yVal,
    xTest: ds.xTest, yTest: yTest,
    paramNames: [], paramSize: 0, numClasses: numClasses,
  };

  // For VAE+Classifier, include labels
  if (isMultiHead) {
    datasetPayload.labelsTrain = ensureOneHotLabels(labelsTrain);
    datasetPayload.labelsVal = ensureOneHotLabels(labelsVal);
    datasetPayload.labelsTest = ensureOneHotLabels(labelsTest);
  }

  var trainPayload = {
    graph: m.graph,
    headConfigs: built.headConfigs,
    config: {
      epochs: EPOCHS, batchSize: BATCH, learningRate: lr, optimizerType: "adam",
      lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5, minLr: 0.00001,
      earlyStoppingPatience: 10, restoreBestWeights: true,
      shuffleTrain: true,
    },
    dataset: datasetPayload,
  };

  console.log("  Sending to server...");
  postJSON(SERVER + "/api/train", trainPayload).then(function (resp) {
    if (!resp || !resp.jobId) {
      console.log("  Server error:", JSON.stringify(resp).substring(0, 300));
      nextModel(); return;
    }
    console.log("  Job: " + resp.jobId + " — streaming...");
    var _jobId = resp.jobId;
    return streamSSE(SERVER + "/api/train/" + _jobId).then(function (r) { r._jobId = _jobId; return r; });
  }).then(function (sse) {
    if (!sse) { nextModel(); return; }
    var result = sse.result || {};
    var epochs = sse.epochs || [];

    console.log("  Done. " + epochs.length + " epochs");
    if (result.testMae != null) console.log("  Test MAE: " + result.testMae.toFixed(6));
    if (result.testRmse != null) console.log("  Test RMSE: " + result.testRmse.toFixed(6));
    if (result.testR2 != null) console.log("  Test R²: " + result.testR2.toFixed(6));

    var jobId = sse._jobId;
    if (!jobId) { console.log("  No jobId"); nextModel(); return; }
    console.log("  Fetching weights...");
    var zlib = require("zlib");
    http.get(SERVER + "/api/train/" + jobId + "/result", function (wRes) {
      var chunks = [];
      wRes.on("data", function (c) { chunks.push(c); });
      wRes.on("end", function () {
        var raw = Buffer.concat(chunks);
        try {
          var decoded = wRes.headers["content-encoding"] === "gzip" ? zlib.gunzipSync(raw) : raw;
          var fullResult = JSON.parse(decoded.toString());
          var artifacts = fullResult.modelArtifacts || {};
          var specs = artifacts.weightSpecs || [];
          var values = artifacts.weightValues || artifacts.weightData || [];
          if (!specs.length || !values.length) {
            console.log("  No weights (specs:" + specs.length + " vals:" + values.length + ")");
            nextModel(); return;
          }
          var meta = {
            name: m.name + " (pre-trained)", status: "done",
            config: trainPayload.config,
            metrics: { bestEpoch: result.bestEpoch, bestValLoss: result.bestValLoss,
                       testMae: result.testMae, testRmse: result.testRmse, testR2: result.testR2 },
            backend: "pytorch",
            epochs: epochs.map(function (e) { return { epoch: e.epoch, loss: e.loss, val_loss: e.val_loss, current_lr: e.current_lr }; }),
          };
          var packed = packBinary(meta, specs, values);
          var b64 = packed.toString("base64");
          fs.writeFileSync(path.join(DEMO_DIR, cfg.file),
            "// Pre-trained " + m.name + " (PyTorch CUDA)\nwindow." + cfg.varName + " = \"" + b64 + "\";\n");
          console.log("  Saved: " + cfg.file + " (" + (packed.length / 1024).toFixed(0) + " KB)");
        } catch (e) { console.log("  Weight error: " + e.message); }
        nextModel();
      });
    }).on("error", function (e) { console.log("  Fetch error: " + e.message); nextModel(); });
  }).catch(function (e) {
    console.log("  Error: " + e.message);
    nextModel();
  });
}
nextModel();

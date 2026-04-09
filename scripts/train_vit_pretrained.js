/**
 * Train Fashion-MNIST ViT models via PyTorch server and export pretrained weights.
 *
 * Run: node scripts/train_vit_pretrained.js
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

// Load source registry + MNIST source loader + fashion module
var srcReg = require("../src/dataset_source_registry.js");
var mnistSourceLoader = require("../src/dataset_modules/mnist_source_loader.js");
var mnistModule = require("../src/dataset_modules/mnist_module.js");
var fashionMnistModule = require("../src/dataset_modules/fashion_mnist_module.js");
// Ensure globals are set (modules use UMD pattern)
if (srcReg) global.window.OSCDatasetSourceRegistry = srcReg;
if (mnistSourceLoader) global.window.OSCMnistSourceLoader = mnistSourceLoader;
if (mnistModule) global.window.OSCDatasetModuleMnist = mnistModule;
if (fashionMnistModule) global.window.OSCDatasetModuleFashionMnist = fashionMnistModule;

// Load preset
eval(fs.readFileSync("demo/Fashion-MNIST-Transformer/preset.js", "utf8"));
var preset = window.FASHION_MNIST_TRANSFORMER_PRESET;

var DEMO_DIR = path.resolve(__dirname, "../demo/Fashion-MNIST-Transformer");
var SERVER = "http://localhost:3777";
var EPOCHS = 30;
var BATCH = 64;
var LR = 0.001;
var TOTAL_COUNT = 10000; // 10K samples for fast training (8K train, 1K val, 1K test)

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
                  console.log("    epoch " + d.epoch + " loss=" + (d.loss || 0).toFixed(6) + " val=" + (d.val_loss || 0).toFixed(6) + " acc=" + (d.val_accuracy || 0).toFixed(4));
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

// Build dataset
console.log("Loading Fashion-MNIST dataset (" + TOTAL_COUNT + " samples)...");
var fashionModule = fashionMnistModule || global.window.OSCDatasetModuleFashionMnist || global.OSCDatasetModuleFashionMnist;
if (!fashionModule || typeof fashionModule.build !== "function") {
  console.error("Fashion-MNIST module not found. Check module loading.");
  process.exit(1);
}

fashionModule.build({
  seed: 42, totalCount: TOTAL_COUNT, variant: "fashion_mnist",
  splitMode: "stratified_label", trainFrac: 0.8, valFrac: 0.1, testFrac: 0.1,
  useFullSource: true,
}).then(function (ds) {
  // Resolve splits from source registry (zero-copy architecture)
  var trainSplit = srcReg.resolveDatasetSplit(ds, "train");
  var valSplit = srcReg.resolveDatasetSplit(ds, "val");
  var testSplit = srcReg.resolveDatasetSplit(ds, "test");
  var xTrain = trainSplit.x || [];
  var yTrain = trainSplit.y || [];
  var xVal = valSplit.x || [];
  var yVal = valSplit.y || [];
  var xTest = testSplit.x || [];
  var yTest = testSplit.y || [];

  console.log("Train: " + xTrain.length + " Val: " + xVal.length + " Test: " + xTest.length);
  var featureSize = xTrain[0] ? xTrain[0].length : 784;
  var numClasses = ds.classCount || ds.numClasses || 10;

  // One-hot encode labels if they're integers
  function oneHot(label, n) {
    var arr = new Array(n).fill(0);
    arr[typeof label === "number" ? label : 0] = 1;
    return arr;
  }
  function ensureOneHot(labels) {
    if (!labels.length) return labels;
    if (typeof labels[0] === "number") return labels.map(function (l) { return oneHot(l, numClasses); });
    return labels;
  }
  yTrain = ensureOneHot(yTrain);
  yVal = ensureOneHot(yVal);
  yTest = ensureOneHot(yTest);

  var modelConfigs = [
    { model: preset.models[0], varName: "TINY_VIT_PRETRAINED_BIN_B64", file: "tiny_vit_pretrained.js" },
    { model: preset.models[1], varName: "SMALL_VIT_PRETRAINED_BIN_B64", file: "small_vit_pretrained.js" },
    { model: preset.models[2], varName: "VIT_MLP_HEAD_PRETRAINED_BIN_B64", file: "vit_mlp_head_pretrained.js" },
  ];

  var midx = 0;
  function nextModel() {
    if (midx >= modelConfigs.length) {
      console.log("\nAll pretrained weights exported!");
      process.exit(0);
    }
    var cfg = modelConfigs[midx++];
    var m = cfg.model;
    console.log("\n=== Training: " + m.name + " (" + EPOCHS + " epochs on server) ===");

    // Build model info
    var tf = require("@tensorflow/tfjs");
    var built = mb.buildModelFromGraph(tf, m.graph, {
      mode: "direct", featureSize: featureSize, numClasses: numClasses,
      allowedOutputKeys: [{ key: "label", headType: "classification" }], defaultTarget: "label",
    });
    console.log("  params: " + built.model.countParams());
    built.model.dispose();

    // Send training request to server
    var trainPayload = {
      graph: m.graph,
      headConfigs: built.headConfigs,
      config: {
        epochs: EPOCHS, batchSize: BATCH, learningRate: LR, optimizerType: "adam",
        lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5, minLr: 0.00001,
        earlyStoppingPatience: 10, restoreBestWeights: true,
        shuffleTrain: true,
      },
      dataset: {
        featureSize: featureSize, targetSize: numClasses,
        mode: "classification", targetMode: "label",
        xTrain: xTrain, yTrain: yTrain,
        xVal: xVal, yVal: yVal,
        xTest: xTest, yTest: yTest,
        paramNames: [], paramSize: 0, numClasses: numClasses,
      },
    };

    console.log("  Sending to server (" + xTrain.length + " train samples)...");
    postJSON(SERVER + "/api/train", trainPayload).then(function (resp) {
      if (!resp || !resp.jobId) {
        console.log("  Server error:", JSON.stringify(resp).substring(0, 200));
        nextModel(); return;
      }
      console.log("  Job: " + resp.jobId + " — streaming epochs...");
      var _jobId = resp.jobId;
      return streamSSE(SERVER + "/api/train/" + _jobId).then(function (r) { r._jobId = _jobId; return r; });
    }).then(function (sse) {
      if (!sse) { nextModel(); return; }
      var result = sse.result || {};
      var epochs = sse.epochs || [];

      console.log("  Done. " + epochs.length + " epochs");
      if (result.testAccuracy != null) console.log("  Test Accuracy: " + (result.testAccuracy * 100).toFixed(2) + "%");
      if (result.testMacroF1 != null) console.log("  Test Macro F1: " + result.testMacroF1.toFixed(4));
      if (result.bestValLoss != null) console.log("  Best Val Loss: " + result.bestValLoss.toFixed(6));

      // Fetch full result with weights
      var jobId = sse._jobId;
      if (!jobId) { console.log("  No jobId, skipping export"); nextModel(); return; }
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
              metrics: {
                bestEpoch: result.bestEpoch, bestValLoss: result.bestValLoss,
                testAccuracy: result.testAccuracy, testMacroF1: result.testMacroF1,
              },
              backend: "pytorch",
              epochs: epochs.map(function (e) {
                return { epoch: e.epoch, loss: e.loss, val_loss: e.val_loss, current_lr: e.current_lr,
                         accuracy: e.accuracy, val_accuracy: e.val_accuracy };
              }),
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
}).catch(function (e) { console.log("Dataset error:", e.message); });

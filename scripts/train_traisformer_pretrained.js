/**
 * Train TrAISformer models via PyTorch server and export pretrained weights.
 *
 * Run: node scripts/train_traisformer_pretrained.js
 */
"use strict";
global.window = global;

var http = require("http");
var fs = require("fs");
var path = require("path");
var mb = require("../src/model_builder_core.js");

require("../src/schema_registry.js");
require("../src/schema_definitions_builtin.js");

eval(fs.readFileSync("data/ais-dma/ais_dma_full_inline.js", "utf8"));
eval(fs.readFileSync("demo/TrAISformer/preset.js", "utf8"));
var preset = window.TRAISFORMER_PRESET;
var aisModule = require("../src/dataset_modules/ais_module.js");

var DEMO_DIR = path.resolve(__dirname, "../demo/TrAISformer");
var SERVER = "http://localhost:3777";
var EPOCHS = 20;
var BATCH = 256;
var LR = 0.001;
var MAX_TRAJS = 2000;

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

console.log("Building dataset (max " + MAX_TRAJS + " trajectories)...");
aisModule.build({ windowSize: 16, maxTrajectories: MAX_TRAJS }).then(function (ds) {
  console.log("Train: " + ds.xTrain.length + " Val: " + ds.xVal.length + " Test: " + ds.xTest.length);

  var modelConfigs = [
    { model: preset.models[0], varName: "MLP_BASELINE_PRETRAINED_BIN_B64", file: "mlp_baseline_pretrained.js" },
    { model: preset.models[1], varName: "TINY_TRAIS_PRETRAINED_BIN_B64", file: "tiny_trais_pretrained.js" },
    { model: preset.models[2], varName: "SMALL_TRAIS_PRETRAINED_BIN_B64", file: "small_trais_pretrained.js" },
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
      mode: "direct", featureSize: 64, numClasses: 0,
      allowedOutputKeys: [{ key: "position", headType: "regression" }], defaultTarget: "position",
    });
    console.log("  params: " + built.model.countParams());
    built.model.dispose();

    // Send training request to server
    var trainPayload = {
      graph: m.graph,
      headConfigs: built.headConfigs,
      config: {
        epochs: EPOCHS, batchSize: BATCH, learningRate: LR, optimizerType: "adam",
        lrSchedulerType: "plateau", lrPatience: 3, lrFactor: 0.5, minLr: 0.00001,
        earlyStoppingPatience: 0, restoreBestWeights: true,
        shuffleTrain: true,
      },
      dataset: {
        featureSize: ds.featureSize, targetSize: ds.targetSize || 4,
        mode: "regression", targetMode: "position",
        xTrain: ds.xTrain, yTrain: ds.yTrain,
        xVal: ds.xVal, yVal: ds.yVal,
        xTest: ds.xTest, yTest: ds.yTest,
        paramNames: [], paramSize: 0, numClasses: 0,
      },
    };

    console.log("  Sending to server...");
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

      function exportWeights(cfg, m, specs, values, result, epochs) {
        var meta = {
          name: m.name + " (pre-trained)", status: "done",
          config: trainPayload.config,
          metrics: { bestEpoch: result.bestEpoch, bestValLoss: result.bestValLoss, testMae: result.testMae, testRmse: result.testRmse, testR2: result.testR2 },
          backend: "pytorch",
          epochs: epochs.map(function (e) { return { epoch: e.epoch, loss: e.loss, val_loss: e.val_loss, current_lr: e.current_lr }; }),
        };
        var packed = packBinary(meta, specs, values);
        var b64 = packed.toString("base64");
        fs.writeFileSync(path.join(DEMO_DIR, cfg.file),
          "// Pre-trained " + m.name + " (PyTorch CUDA)\nwindow." + cfg.varName + " = \"" + b64 + "\";\n");
        console.log("  Saved: " + cfg.file + " (" + (packed.length / 1024).toFixed(0) + " KB)");
      }
      console.log("  Done. " + epochs.length + " epochs");
      if (result.testMae != null) console.log("  Test MAE: " + result.testMae.toFixed(6));
      if (result.testRmse != null) console.log("  Test RMSE: " + result.testRmse.toFixed(6));
      if (result.testR2 != null) console.log("  Test R²: " + result.testR2.toFixed(6));

      // Fetch full result with weights from /api/train/:id/result
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
            if (!specs.length || !values.length) { console.log("  No weights (specs:" + specs.length + " vals:" + values.length + ")"); nextModel(); return; }
            exportWeights(cfg, m, specs, values, result, epochs);
          } catch (e) { console.log("  Weight error: " + e.message); }
          nextModel();
        });
      }).on("error", function (e) { console.log("  Fetch error: " + e.message); nextModel(); });
      return; // don't fall through to nextModel

      var meta = {
        name: m.name + " (pre-trained)", status: "done",
        config: trainPayload.config,
        metrics: { bestEpoch: result.bestEpoch, bestValLoss: result.bestValLoss, testMae: result.testMae, testRmse: result.testRmse, testR2: result.testR2 },
        backend: "pytorch",
        epochs: epochs.map(function (e) { return { epoch: e.epoch, loss: e.loss, val_loss: e.val_loss, current_lr: e.current_lr }; }),
      };
      var packed = packBinary(meta, specs, values);
      var b64 = packed.toString("base64");
      fs.writeFileSync(path.join(DEMO_DIR, cfg.file),
        "// Pre-trained " + m.name + " (PyTorch server)\nwindow." + cfg.varName + " = \"" + b64 + "\";\n");
      console.log("  Saved: " + cfg.file + " (" + (packed.length / 1024).toFixed(0) + " KB)");

      nextModel();
    }).catch(function (e) {
      console.log("  Error: " + e.message);
      nextModel();
    });
  }
  nextModel();
}).catch(function (e) { console.log("Dataset error:", e.message); });

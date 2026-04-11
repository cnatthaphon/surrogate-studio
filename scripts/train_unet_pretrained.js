#!/usr/bin/env node
/**
 * Train UNet + Conv AE on Fashion-MNIST and export pretrained weights.
 *
 * Usage: node scripts/train_unet_pretrained.js
 * Requires: PyTorch server running on localhost:3777
 */
"use strict";
globalThis.window = globalThis;

var http = require("http");
var fs = require("fs");
var path = require("path");
var api = require("../src/workflow_api_core.js");
api.bootstrapRuntime();
var srcReg = globalThis.OSCDatasetSourceRegistry;

var SERVER = "http://localhost:3777";
var DEMO_DIR = path.resolve(__dirname, "..", "demo", "Fashion-MNIST-UNet");

function post(urlPath, body) {
  return new Promise(function (resolve, reject) {
    var url = new URL(urlPath, SERVER);
    var data = JSON.stringify(body);
    var req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json" } }, function (res) {
      var buf = "";
      res.on("data", function (c) { buf += c.toString(); });
      res.on("end", function () { try { resolve(JSON.parse(buf)); } catch (e) { resolve({ raw: buf.slice(0, 200) }); } });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function pollUntilDone(jobId, label) {
  return new Promise(function (resolve, reject) {
    var lastEpoch = 0;
    var timer = setInterval(function () {
      http.get(new URL("/api/train/" + jobId, SERVER), function (res) {
        var buf = "";
        res.on("data", function (c) { buf += c.toString(); });
        res.on("end", function () {
          var epochLines = buf.split("\n").filter(function (l) { return l.startsWith("data: ") && l.includes('"kind":"epoch"'); });
          if (epochLines.length > lastEpoch) {
            var evt = JSON.parse(epochLines[epochLines.length - 1].slice(6));
            process.stdout.write("  [" + label + "] Epoch " + evt.epoch + " loss=" + Number(evt.loss).toFixed(6) + " val=" + Number(evt.val_loss).toFixed(6) + " lr=" + Number(evt.current_lr).toFixed(6) + (evt.improved ? " *" : "") + "\n");
            lastEpoch = epochLines.length;
          }
          if (buf.includes("event: complete")) {
            clearInterval(timer);
            var cLine = buf.split("\n").filter(function (l) { return l.startsWith("data: ") && l.includes('"kind":"complete"'); })[0];
            if (cLine) resolve(JSON.parse(cLine.slice(6)));
            else resolve(null);
          }
          if (buf.includes("event: error")) {
            clearInterval(timer);
            reject(new Error("Training error for " + label));
          }
        });
      }).on("error", function (e) { clearInterval(timer); reject(e); });
    }, 5000);
  });
}

function exportPretrained(result, varName, outFile) {
  if (!result || !result.modelArtifacts) { console.log("  No artifacts to export for " + varName); return; }
  var arts = result.modelArtifacts;
  var specs = arts.weightSpecs || [];
  var values = arts.weightValues || arts.weightData || [];

  // Binary format: [4-byte metaLen LE][JSON meta][Float32 weights]
  var meta = {
    weightSpecs: specs,
    config: {},
    metrics: { mae: result.mae, mse: result.mse, bestEpoch: result.bestEpoch, bestValLoss: result.bestValLoss },
    epochs: [],
    backend: result.backend || "cuda",
  };
  var metaStr = JSON.stringify(meta);
  var metaBytes = Buffer.from(metaStr, "utf-8");
  var weightBuf = Buffer.alloc(values.length * 4);
  for (var i = 0; i < values.length; i++) weightBuf.writeFloatLE(values[i], i * 4);
  var fullBuf = Buffer.alloc(4 + metaBytes.length + weightBuf.length);
  fullBuf.writeUInt32LE(metaBytes.length, 0);
  metaBytes.copy(fullBuf, 4);
  weightBuf.copy(fullBuf, 4 + metaBytes.length);
  var b64 = fullBuf.toString("base64");

  var js = "window." + varName + " = \"" + b64 + "\";\n";
  var outPath = path.join(DEMO_DIR, outFile);
  fs.writeFileSync(outPath, js);
  var sizeKB = Math.round(Buffer.byteLength(js) / 1024);
  console.log("  Exported: " + outFile + " (" + sizeKB + "KB, " + specs.length + " tensors, " + values.length + " values)");
}

async function main() {
  console.log("Creating Fashion-MNIST dataset...");
  var ds = await api.create_dataset({
    schema: "fashion_mnist", name: "unet_pretrain", seed: 42,
    sourceMode: "synthetic", sourceTotalExamples: 8000,
    splitMode: "stratified_label", trainFrac: 0.8, valFrac: 0.1, testFrac: 0.1,
  });
  console.log("  train=" + ds.trainCount + " val=" + ds.valCount + " test=" + ds.testCount);

  var train = srcReg.resolveDatasetSplit(ds, "train");
  var val = srcReg.resolveDatasetSplit(ds, "val");

  require(path.join(DEMO_DIR, "preset.js"));
  var preset = globalThis.FASHION_MNIST_UNET_PRESET;

  var models = [
    { name: "UNet", graph: preset.models[0].graph, varName: "UNET_PRETRAINED_WEIGHTS", file: "unet_pretrained.js" },
    { name: "Conv AE", graph: preset.models[1].graph, varName: "CONV_AE_PRETRAINED_WEIGHTS", file: "conv_ae_pretrained.js" },
  ];

  for (var mi = 0; mi < models.length; mi++) {
    var m = models[mi];
    console.log("\n=== Training " + m.name + " (200 epochs, patience=30) ===");

    var job = await post("/api/train", {
      graph: m.graph,
      dataset: { xTrain: train.x, yTrain: train.x, xVal: val.x, yVal: val.x },
      config: {
        epochs: 200, batchSize: 64, learningRate: 0.001, optimizer: "adam",
        earlyStoppingPatience: 30, lrPatience: 10, lrFactor: 0.5, minLr: 1e-6,
        restoreBestWeights: true,
      },
      headConfigs: [{ headType: "reconstruction", targetType: "x", matchWeight: 1.0 }],
    });

    if (!job.jobId) { console.error("  Failed to start:", JSON.stringify(job).slice(0, 200)); continue; }
    console.log("  Job: " + job.jobId);

    var result = await pollUntilDone(job.jobId, m.name);
    if (!result) { console.error("  Training failed"); continue; }

    console.log("  MAE=" + Number(result.mae).toFixed(6) + " bestEpoch=" + result.bestEpoch + " params=" + result.paramCount + " stoppedEarly=" + result.stoppedEarly);
    exportPretrained(result, m.varName, m.file);
  }

  console.log("\nDone. Pretrained weights saved to demo/Fashion-MNIST-UNet/");
}

main().catch(function (e) { console.error("FATAL:", e.message); process.exit(1); });

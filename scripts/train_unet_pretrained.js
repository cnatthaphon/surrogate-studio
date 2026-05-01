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
var zlib = require("zlib");
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

// Single persistent SSE connection (matches train_pretrained_server.js pattern).
// Streaming polls were unreliable — each http.get opened a fresh subscriber and
// the "complete" event sometimes arrived on a different connection than the one
// being inspected, so the export step never fired.
function pollUntilDone(jobId, label) {
  return new Promise(function (resolve, reject) {
    var url = new URL("/api/train/" + jobId, SERVER);
    var opts = {
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: "GET", headers: { "Accept": "text/event-stream" },
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
                process.stdout.write("  [" + label + "] Epoch " + p.epoch + " loss=" + Number(p.loss).toFixed(6) + " val=" + (p.val_loss != null ? Number(p.val_loss).toFixed(6) : "?") + (p.improved ? " *" : "") + "\n");
              } else if (currentEvent === "complete" || data.kind === "complete") {
                data.epochs = epochsLog;
                resolve(data);
              } else if (currentEvent === "error" || data.kind === "error") {
                reject(new Error(data.message || "Training error for " + label));
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
    epochs: Array.isArray(result.epochs) ? result.epochs : [],
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
  // Load preset first so we can pull its dataset config (single source of truth).
  require(path.join(DEMO_DIR, "preset.js"));
  var preset = globalThis.FASHION_MNIST_UNET_PRESET;
  var pds = preset.dataset || {};
  var pdsCfg = pds.config || {};
  var split = pds.splitConfig || { train: 0.8, val: 0.1, test: 0.1 };

  console.log("Creating Fashion-MNIST dataset (matches preset)...");
  // Use real Fashion-MNIST IDX from data/fashion-mnist/. The synthetic mode
  // generates random pixels, which trains the autoencoder to reconstruct
  // noise instead of shirts. Pull totalCount from preset so the training set
  // exactly matches what a visitor sees on the dataset card.
  var ds = await api.create_dataset({
    schema: "fashion_mnist", name: "unet_pretrain", seed: pds.seed || 42,
    totalCount: pdsCfg.totalCount || 8000,
    useFullSource: pdsCfg.useFullSource !== false,
    splitMode: (split.mode || "stratified_label"),
    trainFrac: split.train, valFrac: split.val, testFrac: split.test,
  });
  console.log("  train=" + ds.trainCount + " val=" + ds.valCount + " test=" + ds.testCount);

  var train = srcReg.resolveDatasetSplit(ds, "train");
  var val = srcReg.resolveDatasetSplit(ds, "val");

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

    // pollUntilDone returns the SSE 'complete' event payload, which is intentionally
    // lightweight and lacks modelArtifacts. Fetch the full result from the dedicated
    // endpoint after SSE finishes (with retries — the server drains stdout async).
    var sseResult = await pollUntilDone(job.jobId, m.name);
    if (!sseResult) { console.error("  SSE poll returned null"); continue; }

    var result = null;
    for (var attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise(function (r) { setTimeout(r, 2000); });
      result = await new Promise(function (resolve) {
        // Server compresses the result body with gzip. Raw http.get on the chunks
        // gives binary garbage that fails JSON.parse — must check Content-Encoding
        // and decompress before parsing.
        http.get(new URL("/api/train/" + job.jobId + "/result", SERVER), function (res) {
          var chunks = [];
          res.on("data", function (c) { chunks.push(c); });
          res.on("end", function () {
            var raw = Buffer.concat(chunks);
            var enc = (res.headers["content-encoding"] || "").toLowerCase();
            if (enc === "gzip") {
              zlib.gunzip(raw, function (err, decompressed) {
                if (err) return resolve(null);
                try { resolve(JSON.parse(decompressed.toString())); } catch (_) { resolve(null); }
              });
            } else {
              try { resolve(JSON.parse(raw.toString())); } catch (_) { resolve(null); }
            }
          });
        }).on("error", function () { resolve(null); });
      });
      if (result && result.modelArtifacts && result.modelArtifacts.weightSpecs) break;
    }
    if (!result || !result.modelArtifacts) { console.error("  Result fetch failed (no modelArtifacts after retries)"); continue; }

    // Merge SSE metrics (mae, bestEpoch, etc.) with full artifacts.
    if (sseResult && typeof sseResult === "object") {
      ["mae", "mse", "bestEpoch", "bestValLoss", "paramCount", "stoppedEarly", "backend"].forEach(function (k) {
        if (result[k] == null && sseResult[k] != null) result[k] = sseResult[k];
      });
      // Per-epoch loss history is what populates the trainer card's loss curve.
      // The /result endpoint doesn't return it; the SSE event accumulator does.
      if (Array.isArray(sseResult.epochs) && sseResult.epochs.length) {
        result.epochs = sseResult.epochs;
      }
    }
    console.log("  MAE=" + Number(result.mae).toFixed(6) + " bestEpoch=" + result.bestEpoch + " params=" + result.paramCount + " stoppedEarly=" + result.stoppedEarly);
    exportPretrained(result, m.varName, m.file);
  }

  console.log("\nDone. Pretrained weights saved to demo/Fashion-MNIST-UNet/");
}

main().catch(function (e) { console.error("FATAL:", e.message); process.exit(1); });

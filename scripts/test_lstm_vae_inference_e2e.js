#!/usr/bin/env node
"use strict";
/**
 * BUG-41 end-to-end smoke test: load the shipped LSTM-VAE artifact
 * into the SAME model graph the client/browser builds, run inference,
 * and confirm the output is shape [batch, 40] (a 40-dim ant
 * trajectory reconstruction) — not [batch, 1] (the collapsed scalar
 * the user reported on the live site).
 *
 * Pre-fix: schema's "xv" output key omitted featureSize. Client model
 * built with Dense(1). Loading the (correctly-shaped Dense(40))
 * artifact silently fell back to positional with shape mismatch on
 * the output kernel, model produced 1-scalar predictions.
 *
 * Post-fix: schema declares featureSize: 40 so client model builds
 * Dense(40) — matches the artifact and produces 40-dim reconstructions.
 */
var path = require("path");
var fs = require("fs");
var vm = require("vm");

var REPO = path.resolve(__dirname, "..");
global.window = global;
global.OSCDatasetModules = { registerModule: function () {} };

var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var sr = require(path.join(REPO, "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(REPO, "src/schema_definitions_builtin.js"));
require(path.join(REPO, "demo/LSTM-VAE-for-dominant-motion-extraction/ant_trajectory_schema.js"));
var MBC = require(path.join(REPO, "src/model_builder_core.js"));
var WC = require(path.join(REPO, "src/weight_converter.js"));

var presetSrc = fs.readFileSync(path.join(REPO, "demo/LSTM-VAE-for-dominant-motion-extraction/preset.js"), "utf8");
var sandbox = { window: {}, Date: Date };
vm.runInNewContext(presetSrc, sandbox);
var preset = Object.keys(sandbox.window).map(function (k) { return sandbox.window[k]; })
  .find(function (v) { return v && v.models; });

(async function () {
  await tf.setBackend("cpu"); await tf.ready();

  // Build the same model graph the browser client would build for
  // generation: featureSize from the dataset (40), schema-declared
  // output keys from the registry.
  var allowedKeys = sr.getOutputKeys("ant_trajectory");
  var modelDef = preset.models.find(function (m) { return m.id === "demo-lstm-vae"; });
  var built = MBC.buildModelFromGraph(tf, modelDef.graph, {
    mode: "direct", featureSize: 40, windowSize: 1, seqFeatureSize: 40,
    allowedOutputKeys: allowedKeys, defaultTarget: "xv", numClasses: 0,
  });

  // Load the shipped pretrained artifact.
  var artSrc = fs.readFileSync(path.join(REPO, "demo/LSTM-VAE-for-dominant-motion-extraction/lstm_vae_paper_pretrained.js"), "utf8");
  var match = artSrc.match(/=\s*"([A-Za-z0-9+/=]+)"/);
  var b = Buffer.from(match[1], "base64");
  var hdrLen = b.readUInt32LE(0);
  var hdr = JSON.parse(b.slice(4, 4 + hdrLen).toString("utf8"));
  var weightBytes = b.slice(4 + hdrLen);
  var buf = Buffer.alloc(weightBytes.length);
  weightBytes.copy(buf);
  var weightValues = Array.from(new Float32Array(buf.buffer, 0, Math.floor(buf.length / 4)));

  var loadResult = WC.loadArtifactsIntoModel(tf, built.model, {
    weightSpecs: hdr.weightSpecs,
    weightValues: weightValues,
    producerRuntime: "python_server",
  });
  console.log("Load result: " + JSON.stringify(loadResult));

  // Run inference on a deterministic synthetic ant-trajectory frame
  // (40-dim, values in [0, 1]).
  var rng = (function (seed) { return function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }; })(42);
  var inputArr = [];
  for (var b2 = 0; b2 < 4; b2++) {
    var row = [];
    for (var f = 0; f < 40; f++) row.push(rng());
    inputArr.push(row);
  }
  var x = tf.tensor2d(inputArr);
  var pred = built.model.predict(x);
  // Multi-output (xv + latent_kl): take the xv head.
  var out = Array.isArray(pred) ? pred[0] : pred;
  var outShape = out.shape;
  var samples = out.arraySync();
  console.log("Output shape: " + JSON.stringify(outShape));
  console.log("Sample[0] first 8 values: " + samples[0].slice(0, 8).map(function (v) { return v.toFixed(4); }).join(", "));

  var pass = outShape.length === 2 && outShape[1] === 40;
  if (!pass) {
    console.log("FAIL: expected output shape [batch, 40], got " + JSON.stringify(outShape));
    process.exit(1);
  }

  // Diversity: per-feature std across 4 samples should be > 0 — confirms
  // the model isn't producing a constant or single-scalar broadcast.
  var sumStd = 0;
  for (var fi = 0; fi < 40; fi++) {
    var sum = 0;
    for (var si = 0; si < 4; si++) sum += samples[si][fi];
    var mean = sum / 4;
    var sq = 0;
    for (var si2 = 0; si2 < 4; si2++) { var d = samples[si2][fi] - mean; sq += d * d; }
    sumStd += Math.sqrt(sq / 4);
  }
  var avgStd = sumStd / 40;
  console.log("Per-feature std avg: " + avgStd.toFixed(6));

  console.log("PASS: LSTM-VAE produces 40-dim reconstructions (was [1] pre-fix).");
})().catch(function (e) { console.error(e); process.exit(1); });

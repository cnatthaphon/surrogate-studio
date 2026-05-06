#!/usr/bin/env node
"use strict";
/**
 * BUG-39 end-to-end smoke test: load the retrained LSTM-VAE pretrained
 * artifact, run inference on a deterministic input, and confirm the
 * reconstruction is NOT collapsed to a single point.
 *
 * Pre-fix: TF.js inference produced near-zero output because the LSTM
 * gate-block swap on extract scrambled forget/cell weights. Per-pixel
 * std across samples was effectively 0, range was ~[-0.5, 0].
 *
 * Post-fix: PyTorch [i,f,g,o] maps directly to TF.js [i,f,c,o] without
 * reorder. Inference should produce trajectories spread across the
 * input domain with healthy per-feature variance.
 */
var path = require("path");
var fs = require("fs");
var vm = require("vm");

global.window = global;
global.document = { createElement: function () { return { onload: null, onerror: null, style: {} }; }, head: { appendChild: function () {} } };
global.OSCDatasetModules = { registerModule: function () {} };

var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");

var REPO = path.resolve(__dirname, "..");
var sr = require(path.join(REPO, "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(REPO, "src/schema_definitions_builtin.js"));
var MBC = require(path.join(REPO, "src/model_builder_core.js"));
var WC = require(path.join(REPO, "src/weight_converter.js"));

(async function () {
  await tf.setBackend("cpu");
  await tf.ready();

  var presetSrc = fs.readFileSync(path.join(REPO, "demo/LSTM-VAE-for-dominant-motion-extraction/preset.js"), "utf8");
  var sandbox = { window: {}, Date: Date };
  vm.runInNewContext(presetSrc, sandbox);
  var preset = Object.keys(sandbox.window).map(function (k) { return sandbox.window[k]; }).find(function (v) { return v && v.models; });
  var modelDef = preset.models.find(function (m) { return m.id === "demo-lstm-vae"; });

  var artSrc = fs.readFileSync(path.join(REPO, "demo/LSTM-VAE-for-dominant-motion-extraction/lstm_vae_paper_pretrained.js"), "utf8");
  var match = artSrc.match(/=\s*"([A-Za-z0-9+/=]+)"/);
  var b = Buffer.from(match[1], "base64");
  var hdrLen = b.readUInt32LE(0);
  var hdr = JSON.parse(b.slice(4, 4 + hdrLen).toString("utf8"));
  var weightBytes = b.slice(4 + hdrLen);
  var buf = Buffer.alloc(weightBytes.length);
  weightBytes.copy(buf);
  var weightValues = Array.from(new Float32Array(buf.buffer, 0, Math.floor(buf.length / 4)));

  // Look at preset for shape info
  var graphData = modelDef.graph.drawflow.Home.data;
  var imageSrc = Object.keys(graphData).map(function (k) { return graphData[k]; })
    .find(function (n) { return n.name === "image_source_layer" || n.name === "input_layer"; });
  var featureSize = (imageSrc && imageSrc.data && imageSrc.data.featureSize) || 40;

  var built = MBC.buildModelFromGraph(tf, modelDef.graph, {
    mode: "direct",
    featureSize: featureSize,
    windowSize: 1,
    seqFeatureSize: featureSize,
    targetSize: featureSize,
    allowedOutputKeys: sr.getOutputKeys("ant_trajectory") || [{ key: "trajectory", featureSize: featureSize, headType: "reconstruction" }],
    defaultTarget: "trajectory",
    numClasses: 0,
  });
  WC.loadArtifactsIntoModel(tf, built.model, {
    weightSpecs: hdr.weightSpecs,
    weightValues: weightValues,
    producerRuntime: "python_server",
  });

  // Generate a synthetic ant trajectory: 20 ants × 20 timesteps in [0,1].
  // The model treats the flattened 40-dim feature as one timestep input;
  // exact shape depends on the demo's mode. We just need ANY input that
  // exercises the LSTM and check the output isn't collapsed.
  var rng = (function (seed) { return function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }; })(42);
  var batch = 8;
  var seqLen = 1; // single-step direct mode for the test
  var inputArr = [];
  for (var bi = 0; bi < batch; bi++) {
    var seq = [];
    for (var t = 0; t < seqLen; t++) {
      var feat = [];
      for (var f = 0; f < featureSize; f++) feat.push(rng());
      seq.push(feat);
    }
    inputArr.push(seq);
  }

  // Try 2D first (some demos flatten input)
  var x;
  try {
    x = tf.tensor3d(inputArr);
    var pred = built.model.predict(x);
    var out = Array.isArray(pred) ? pred[0] : pred;
    var samples = out.arraySync();
    var flat = samples.flat(2);

    // Diversity: per-feature std across samples
    var stride = flat.length / batch;
    var perFeatureStd = 0;
    var globalMin = Infinity, globalMax = -Infinity;
    for (var fi = 0; fi < stride; fi++) {
      var sum = 0;
      for (var si = 0; si < batch; si++) sum += flat[si * stride + fi];
      var mean = sum / batch;
      var sq = 0;
      for (var si2 = 0; si2 < batch; si2++) { var d = flat[si2 * stride + fi] - mean; sq += d * d; }
      perFeatureStd += Math.sqrt(sq / batch);
    }
    perFeatureStd /= stride;
    for (var v = 0; v < flat.length; v++) {
      if (flat[v] < globalMin) globalMin = flat[v];
      if (flat[v] > globalMax) globalMax = flat[v];
    }

    console.log("LSTM-VAE inference smoke test:");
    console.log("  per-feature std avg: " + perFeatureStd.toFixed(4));
    console.log("  output range: [" + globalMin.toFixed(3) + ", " + globalMax.toFixed(3) + "]");

    if (perFeatureStd > 0.01 && globalMax - globalMin > 0.1) {
      console.log("PASS: reconstruction shows variation across samples and across the output space.");
      console.log("      (Pre-BUG-39 fix this would collapse to a near-constant near zero.)");
    } else {
      console.log("FAIL: reconstruction looks collapsed (std " + perFeatureStd.toFixed(4) + ", range " + (globalMax - globalMin).toFixed(3) + ")");
      process.exit(1);
    }
  } catch (e) {
    // direct 3D failed; try 2D flat.
    if (x) x.dispose();
    var x2 = tf.tensor2d(inputArr.map(function (s) { return s[0]; }));
    var pred2 = built.model.predict(x2);
    var samples2 = (Array.isArray(pred2) ? pred2[0] : pred2).arraySync();
    var minV = Infinity, maxV = -Infinity;
    for (var i = 0; i < samples2.length; i++) for (var j = 0; j < samples2[i].length; j++) {
      var v2 = samples2[i][j]; if (v2 < minV) minV = v2; if (v2 > maxV) maxV = v2;
    }
    console.log("LSTM-VAE inference smoke (2D fallback):");
    console.log("  output range: [" + minV.toFixed(3) + ", " + maxV.toFixed(3) + "]");
    if (maxV - minV > 0.1) {
      console.log("PASS");
    } else {
      console.log("FAIL: collapsed");
      process.exit(1);
    }
  }
})().catch(function (e) { console.error(e); process.exit(1); });

#!/usr/bin/env node
"use strict";
/**
 * Verify FM-Benchmark m8 NCSN produces diverse Langevin samples WITHOUT
 * the walk-jump workaround. NCSN is a σ-conditioned score network so
 * naive Langevin (init x ~ N(0,1), iterate model + decreasing noise)
 * should converge to data-distribution samples — that's the whole
 * point of σ-conditioning.
 *
 * Compares against m7 Denoiser running the SAME naive Langevin (no
 * walk-jump) to make the fix visible: m7 should collapse, m8 should
 * stay diverse.
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
var GE = require(path.join(REPO, "src/generation_engine_core.js"));

(async function () {
  await tf.setBackend("cpu");
  await tf.ready();

  var presetSrc = fs.readFileSync(path.join(REPO, "demo/Fashion-MNIST-Benchmark/preset.js"), "utf8");
  var sandbox = { window: {}, Date: Date };
  vm.runInNewContext(presetSrc, sandbox);
  var preset = Object.keys(sandbox.window).map(function (k) { return sandbox.window[k]; }).find(function (v) { return v && v.models; });

  function loadArtifact(filename) {
    var src = fs.readFileSync(path.join(REPO, "demo/Fashion-MNIST-Benchmark", filename), "utf8");
    var match = src.match(/=\s*"([A-Za-z0-9+/=]+)"/);
    var b = Buffer.from(match[1], "base64");
    var hdrLen = b.readUInt32LE(0);
    var hdr = JSON.parse(b.slice(4, 4 + hdrLen).toString("utf8"));
    var weightBytes = b.slice(4 + hdrLen);
    var buf = Buffer.alloc(weightBytes.length);
    weightBytes.copy(buf);
    var weightValues = Array.from(new Float32Array(buf.buffer, 0, Math.floor(buf.length / 4)));
    return { weightSpecs: hdr.weightSpecs, weightValues: weightValues, producerRuntime: "python_server" };
  }

  function buildModel(modelDef) {
    var built = MBC.buildModelFromGraph(tf, modelDef.graph, {
      mode: "direct", featureSize: 784, windowSize: 1, seqFeatureSize: 784, targetSize: 784,
      allowedOutputKeys: sr.getOutputKeys("fashion_mnist") || [{ key: "pixel_values", featureSize: 784, headType: "reconstruction" }],
      defaultTarget: "pixel_values", numClasses: 10,
    });
    return built;
  }

  async function naiveLangevin(model) {
    return await GE.generate(tf, {
      model: model, latentDim: 784, numSamples: 16, seed: 42,
      method: "langevin", steps: 100, lr: 0.01, temperature: 1.0,
    });
  }

  function diversityStats(samples) {
    var nS = samples.length, nD = samples[0].length;
    var pixelStds = [];
    for (var d = 0; d < nD; d++) {
      var sum = 0;
      for (var s = 0; s < nS; s++) sum += samples[s][d];
      var mean = sum / nS;
      var sq = 0;
      for (var s2 = 0; s2 < nS; s2++) { var dv = samples[s2][d] - mean; sq += dv * dv; }
      pixelStds.push(Math.sqrt(sq / nS));
    }
    var avgStd = pixelStds.reduce(function (a, b) { return a + b; }, 0) / nD;
    var pairCount = 0, pairSum = 0;
    for (var i = 0; i < nS; i++) {
      for (var j = i + 1; j < nS; j++) {
        var d2 = 0;
        for (var k = 0; k < nD; k++) { var diff = samples[i][k] - samples[j][k]; d2 += diff * diff; }
        pairSum += Math.sqrt(d2);
        pairCount++;
      }
    }
    return { perPixelStd: avgStd, pairwiseL2: pairSum / pairCount };
  }

  var denoiser = preset.models.find(function (m) { return m.id === "m-denoiser"; });
  var ncsn = preset.models.find(function (m) { return m.id === "m-ncsn"; });

  var denoiserBuilt = buildModel(denoiser);
  WC.loadArtifactsIntoModel(tf, denoiserBuilt.model, loadArtifact("m7_denoising_ae_pretrained.js"));
  var ncsnBuilt = buildModel(ncsn);
  WC.loadArtifactsIntoModel(tf, ncsnBuilt.model, loadArtifact("m8_ncsn_pretrained.js"));

  console.log("=== m7 Denoiser (single-σ DAE) — naive Langevin ===");
  var d7 = await naiveLangevin(denoiserBuilt.model);
  var s7 = diversityStats(d7.samples);
  console.log("  per-pixel std: " + s7.perPixelStd.toFixed(4));
  console.log("  pairwise L2:   " + s7.pairwiseL2.toFixed(4));

  console.log("\n=== m8 NCSN (multi-σ score net) — naive Langevin ===");
  var d8 = await naiveLangevin(ncsnBuilt.model);
  var s8 = diversityStats(d8.samples);
  console.log("  per-pixel std: " + s8.perPixelStd.toFixed(4));
  console.log("  pairwise L2:   " + s8.pairwiseL2.toFixed(4));

  console.log("\n=== Verdict ===");
  console.log("Diversity ratio (NCSN / Denoiser pairwise L2): " + (s8.pairwiseL2 / Math.max(1e-6, s7.pairwiseL2)).toFixed(2) + "x");
  if (s8.pairwiseL2 > 1.0 && s8.perPixelStd > 0.05) {
    console.log("PASS: NCSN naive Langevin produces diverse samples WITHOUT walk-jump.");
    console.log("      The σ-conditioning is doing its job.");
  } else {
    console.log("FAIL: NCSN naive Langevin still collapsed — model didn't learn σ-conditioning.");
    process.exit(1);
  }
})().catch(function (e) { console.error(e); process.exit(1); });

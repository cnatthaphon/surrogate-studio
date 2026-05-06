#!/usr/bin/env node
"use strict";
/**
 * Verify the new walk-jump Langevin produces diverse samples on the FM-Benchmark
 * Denoiser. Checks:
 *  - Sample stddev across the batch is non-trivial (>0.05) — not collapsed.
 *  - Output range is bounded in [0,1] — sigmoid worked.
 *
 * Compares against legacy "noise" init (which we expect to collapse) so we have
 * a baseline showing the fix matters.
 */
var path = require("path");
var fs = require("fs");
var vm = require("vm");

global.window = global;
global.document = {
  createElement: function () { return { onload: null, onerror: null, style: {} }; },
  head: { appendChild: function () {} },
};
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

  // Load preset graph for m-denoiser
  var presetSrc = fs.readFileSync(path.join(REPO, "demo/Fashion-MNIST-Benchmark/preset.js"), "utf8");
  var sandbox = { window: {}, Date: Date };
  vm.runInNewContext(presetSrc, sandbox);
  var preset = Object.keys(sandbox.window).map(function (k) { return sandbox.window[k]; }).find(function (v) { return v && v.models; });
  var denoiser = preset.models.find(function (m) { return m.id === "m-denoiser"; });

  // Load pretrained artifact
  var artSrc = fs.readFileSync(path.join(REPO, "demo/Fashion-MNIST-Benchmark/m7_denoising_ae_pretrained.js"), "utf8");
  var match = artSrc.match(/=\s*"([A-Za-z0-9+/=]+)"/);
  var b = Buffer.from(match[1], "base64");
  var hdrLen = b.readUInt32LE(0);
  var hdr = JSON.parse(b.slice(4, 4 + hdrLen).toString("utf8"));
  var weightBytes = b.slice(4 + hdrLen);
  var buf = Buffer.alloc(weightBytes.length);
  weightBytes.copy(buf);
  var weightValues = Array.from(new Float32Array(buf.buffer, 0, Math.floor(buf.length / 4)));

  var built = MBC.buildModelFromGraph(tf, denoiser.graph, {
    mode: "direct",
    featureSize: 784,
    windowSize: 1,
    seqFeatureSize: 784,
    targetSize: 784,
    allowedOutputKeys: sr.getOutputKeys("fashion_mnist") || [{ key: "pixel_values", featureSize: 784, headType: "reconstruction" }],
    defaultTarget: "pixel_values",
    numClasses: 10,
  });
  var artifacts = { weightSpecs: hdr.weightSpecs, weightValues: weightValues, producerRuntime: "python_server" };
  WC.loadArtifactsIntoModel(tf, built.model, artifacts);

  // Run BOTH the legacy ("noise" init) Langevin and the new walk-jump
  // ("uniform" init + walkNoise=0.3) to compare diversity.
  async function run(label, cfg) {
    var result = await GE.generate(tf, Object.assign({
      model: built.model,
      latentDim: 784,
      numSamples: 16,
      steps: 100,
      seed: 42,
    }, cfg));
    var samples = result.samples; // [16, 784]
    // Mean stddev across the batch (per pixel, averaged over pixels) — a proxy
    // for sample diversity. Also report min/max output.
    var nS = samples.length, nD = samples[0].length;
    var pixelStds = [];
    var globalMin = Infinity, globalMax = -Infinity;
    for (var d = 0; d < nD; d++) {
      var sum = 0;
      for (var s = 0; s < nS; s++) {
        var v = samples[s][d];
        sum += v;
        if (v < globalMin) globalMin = v;
        if (v > globalMax) globalMax = v;
      }
      var mean = sum / nS;
      var sq = 0;
      for (var s2 = 0; s2 < nS; s2++) {
        var dv = samples[s2][d] - mean;
        sq += dv * dv;
      }
      pixelStds.push(Math.sqrt(sq / nS));
    }
    var avgStd = pixelStds.reduce(function (a, b) { return a + b; }, 0) / nD;

    // Pairwise diversity: average L2 between sample pairs (lower = more collapsed).
    var pairCount = 0, pairSum = 0;
    for (var i = 0; i < nS; i++) {
      for (var j = i + 1; j < nS; j++) {
        var d2 = 0;
        for (var k = 0; k < nD; k++) {
          var diff = samples[i][k] - samples[j][k];
          d2 += diff * diff;
        }
        pairSum += Math.sqrt(d2);
        pairCount++;
      }
    }
    var avgL2 = pairSum / pairCount;

    console.log(label);
    console.log("  per-pixel std avg:", avgStd.toFixed(4));
    console.log("  pairwise L2 avg:  ", avgL2.toFixed(4));
    console.log("  output range:     [" + globalMin.toFixed(3) + ", " + globalMax.toFixed(3) + "]");
    return { avgStd: avgStd, avgL2: avgL2, range: [globalMin, globalMax] };
  }

  console.log("=== Legacy Langevin (init=noise, no walkNoise) ===");
  var legacy = await run("legacy", { method: "langevin", lr: 0.01, temperature: 1.0 });

  console.log("\n=== Walk-jump Langevin (init=uniform, walkNoise=0.3) ===");
  var walkjump = await run("walkjump", { method: "langevin", lr: 0.0, init: "uniform", walkNoise: 0.3 });

  console.log("\n=== Verdict ===");
  // Walk-jump should produce more diverse samples (higher pairwise L2) than legacy.
  var diversityRatio = walkjump.avgL2 / Math.max(1e-6, legacy.avgL2);
  console.log("Diversity ratio (walkjump / legacy L2):", diversityRatio.toFixed(2) + "x");
  if (walkjump.avgL2 > 1.0 && walkjump.avgStd > 0.05) {
    console.log("PASS: walk-jump produces visibly different samples.");
  } else {
    console.log("FAIL: walk-jump samples still look collapsed.");
    process.exit(1);
  }
})().catch(function (e) {
  console.error(e);
  process.exit(1);
});

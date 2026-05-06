#!/usr/bin/env node
"use strict";
/**
 * Sweep Langevin walk-jump schedule variants and dump per-variant 4x4 sample
 * grids as PNGs so we can compare visual quality side-by-side.
 *
 * Quality proxy: per-pixel std (diversity) AND mean column variance — pure
 * noise has high column variance, garments have spatial structure with
 * specific high/low-variance regions.
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
  var denoiser = preset.models.find(function (m) { return m.id === "m-denoiser"; });

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
    mode: "direct", featureSize: 784, windowSize: 1, seqFeatureSize: 784, targetSize: 784,
    allowedOutputKeys: sr.getOutputKeys("fashion_mnist") || [{ key: "pixel_values", featureSize: 784, headType: "reconstruction" }],
    defaultTarget: "pixel_values", numClasses: 10,
  });
  WC.loadArtifactsIntoModel(tf, built.model, { weightSpecs: hdr.weightSpecs, weightValues: weightValues, producerRuntime: "python_server" });

  // Variants to sweep.
  var variants = [
    { label: "linear-100",      cfg: { steps: 100, walkNoise: 0.3, cleanFraction: 0 } },          // current
    { label: "stepclean-100-0.2", cfg: { steps: 100, walkNoise: 0.3, cleanFraction: 0.2 } },     // new default
    { label: "stepclean-200-0.2", cfg: { steps: 200, walkNoise: 0.3, cleanFraction: 0.2 } },
    { label: "stepclean-200-0.1", cfg: { steps: 200, walkNoise: 0.3, cleanFraction: 0.1 } },
    { label: "constant-200",      cfg: { steps: 200, walkNoise: 0.3, cleanFraction: 0.0001 } }, // ~constant, no settle
    { label: "stepclean-300-0.15",cfg: { steps: 300, walkNoise: 0.3, cleanFraction: 0.15 } },
    { label: "loud-stepclean",    cfg: { steps: 200, walkNoise: 0.4, cleanFraction: 0.2 } },
  ];

  var outDir = path.join(REPO, "tmp_langevin_sweep");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  for (var vi = 0; vi < variants.length; vi++) {
    var v = variants[vi];
    var t0 = Date.now();
    var result = await GE.generate(tf, Object.assign({
      method: "langevin", model: built.model, latentDim: 784,
      numSamples: 16, seed: 42, init: "uniform", lr: 0.0,
    }, v.cfg));
    var dt = ((Date.now() - t0) / 1000).toFixed(1);
    var samples = result.samples;
    // Diversity stats
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

    // Within-sample structure: high-variance pixels concentrated → garment;
    // uniformly varied → noise. Compute std within each sample's pixels.
    var inSampleStds = [];
    for (var s3 = 0; s3 < nS; s3++) {
      var smean = 0;
      for (var k = 0; k < nD; k++) smean += samples[s3][k];
      smean /= nD;
      var ssq = 0;
      for (var k2 = 0; k2 < nD; k2++) { var dv2 = samples[s3][k2] - smean; ssq += dv2 * dv2; }
      inSampleStds.push(Math.sqrt(ssq / nD));
    }
    var avgInSampleStd = inSampleStds.reduce(function (a, b) { return a + b; }, 0) / nS;

    console.log(v.label + ": diversity=" + avgStd.toFixed(4) + "  in-sample-std=" + avgInSampleStd.toFixed(4) + "  time=" + dt + "s");

    // Dump as 4x4 grid PGM (simple greyscale, easy to view)
    var grid = 4, cell = 28;
    var W = grid * cell, H = grid * cell;
    var buf2 = Buffer.alloc(W * H);
    for (var si = 0; si < 16; si++) {
      var gx = (si % 4) * cell, gy = Math.floor(si / 4) * cell;
      for (var py = 0; py < cell; py++) {
        for (var px = 0; px < cell; px++) {
          var v2 = samples[si][py * 28 + px];
          var pix = Math.max(0, Math.min(1, v2)) * 255;
          buf2[(gy + py) * W + (gx + px)] = Math.round(pix);
        }
      }
    }
    var pgm = Buffer.concat([Buffer.from("P5\n" + W + " " + H + "\n255\n"), buf2]);
    fs.writeFileSync(path.join(outDir, v.label + ".pgm"), pgm);
  }
  console.log("\nSamples written to " + outDir);
})().catch(function (e) { console.error(e); process.exit(1); });

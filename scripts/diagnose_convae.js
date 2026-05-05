// Diagnose BUG-38: Conv-AE train/run MSE 10x mismatch
"use strict";
var path = require("path");
var fs = require("fs");
var vm = require("vm");

var REPO = "/mnt/f/Data/Projects/Portfolio/surrogate-studio";
global.window = global;
global.OSCDatasetModules = { registerModule: function () {} };

var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");

var schemaReg = require(path.join(REPO, "src/schema_registry.js"));
global.OSCSchemaRegistry = schemaReg;
require(path.join(REPO, "src/schema_definitions_builtin.js"));
var MBC = require(path.join(REPO, "src/model_builder_core.js"));
var WC = require(path.join(REPO, "src/weight_converter.js"));

// Load Conv-AE pretrained
var artSrc = fs.readFileSync(path.join(REPO, "demo/Fashion-MNIST-Benchmark/m4_conv_autoencoder_pretrained.js"), "utf8");
var match = artSrc.match(/=\s*"([A-Za-z0-9+/=]+)"/);
var b = Buffer.from(match[1], "base64");
var hdrLen = b.readUInt32LE(0);
var hdr = JSON.parse(b.slice(4, 4 + hdrLen).toString("utf8"));
var weightBytes = b.slice(4 + hdrLen);

var buf = Buffer.alloc(weightBytes.length);
weightBytes.copy(buf);
var weightValues = Array.from(new Float32Array(buf.buffer, 0, Math.floor(buf.length / 4)));

console.log("Artifact:", hdr.name, "backend:", hdr.backend);
console.log("Weight specs (" + hdr.weightSpecs.length + "):");
hdr.weightSpecs.forEach(function (w) { console.log("  " + w.name + " " + JSON.stringify(w.shape)); });

// Load preset graph
var presetSrc = fs.readFileSync(path.join(REPO, "demo/Fashion-MNIST-Benchmark/preset.js"), "utf8");
var sandbox = { window: {}, Date: Date };
vm.runInNewContext(presetSrc, sandbox);
var preset = Object.keys(sandbox.window).map(function (k) { return sandbox.window[k]; }).find(function (v) { return v && v.models; });
var convAe = preset.models.find(function (m) { return m.id === "m-conv-ae"; });

(async function () {
  await tf.setBackend("cpu");
  await tf.ready();

  var built = MBC.buildModelFromGraph(tf, convAe.graph, {
    mode: "direct", featureSize: 784, windowSize: 1, seqFeatureSize: 784,
    targetSize: 784,
    allowedOutputKeys: schemaReg.getOutputKeys("fashion_mnist") || [{ key: "pixel_values", featureSize: 784, headType: "reconstruction" }],
    defaultTarget: "pixel_values",
    numClasses: 10,
  });

  console.log("\nModel weights (in TF.js order):");
  built.model.weights.forEach(function (w) {
    console.log("  " + w.name + " " + JSON.stringify(w.shape));
  });

  var artifacts = { weightSpecs: hdr.weightSpecs, weightValues: weightValues, producerRuntime: "python_server" };
  var loadResult = WC.loadArtifactsIntoModel(tf, built.model, artifacts);
  console.log("\nLoad result:", JSON.stringify(loadResult));

  // Run forward on a synthetic test image
  var testImg = new Float32Array(784).fill(0.5);
  for (var i = 100; i < 200; i++) testImg[i] = 0.9;
  var x = tf.tensor2d([Array.from(testImg)]);
  var pred = built.model.predict(x);
  var preds = Array.isArray(pred) ? pred : [pred];
  preds.forEach(function (p, i) {
    var arr = p.arraySync();
    console.log("Output[" + i + "] shape=" + JSON.stringify(p.shape) + " min=" + Math.min.apply(null, arr[0]).toFixed(4) + " max=" + Math.max.apply(null, arr[0]).toFixed(4) + " mean=" + (arr[0].reduce(function (a, b) { return a + b; }, 0) / arr[0].length).toFixed(4));
  });

  // Audit: confirm first conv kernel matches artifact byte-for-byte.
  var n3kernel = built.model.weights.find(function (w) { return w.name === "n3/kernel"; });
  if (n3kernel) {
    var loaded = n3kernel.read().arraySync();
    var artSpec = hdr.weightSpecs.find(function (s) { return s.name === "tfjs_conv2d_3.weight"; });
    var artLen = artSpec.shape.reduce(function (a, b) { return a * b; }, 1);
    var artVals = weightValues.slice(artSpec.offset / 4, artSpec.offset / 4 + artLen);
    var loadedFlat = [];
    function flatten(arr) { arr.forEach(function (v) { Array.isArray(v) ? flatten(v) : loadedFlat.push(v); }); }
    flatten(loaded);
    var maxDiff = 0;
    for (var li = 0; li < Math.min(loadedFlat.length, artVals.length); li++) {
      var diff = Math.abs(loadedFlat[li] - artVals[li]);
      if (diff > maxDiff) maxDiff = diff;
    }
    console.log("\nn3/kernel load audit: loaded[0..3]=" + JSON.stringify(loadedFlat.slice(0,3)) + " artifact[0..3]=" + JSON.stringify(artVals.slice(0,3)) + " maxDiff=" + maxDiff.toExponential(3));
  }
  // Same audit for convt2d (n9, the suspect op)
  var n9 = built.model.weights.find(function (w) { return w.name === "n9/kernel"; });
  if (n9) {
    var loaded9 = n9.read().arraySync();
    var spec9 = hdr.weightSpecs.find(function (s) { return s.name === "tfjs_convt2d_9.weight"; });
    var len9 = spec9.shape.reduce(function (a, b) { return a * b; }, 1);
    var vals9 = weightValues.slice(spec9.offset / 4, spec9.offset / 4 + len9);
    var lf9 = [];
    (function flat(arr) { arr.forEach(function (v) { Array.isArray(v) ? flat(v) : lf9.push(v); }); })(loaded9);
    var maxD9 = 0;
    for (var li2 = 0; li2 < Math.min(lf9.length, vals9.length); li2++) {
      var d2 = Math.abs(lf9[li2] - vals9[li2]); if (d2 > maxD9) maxD9 = d2;
    }
    console.log("n9/kernel load audit (convt2d): loaded[0..3]=" + JSON.stringify(lf9.slice(0,3)) + " artifact[0..3]=" + JSON.stringify(vals9.slice(0,3)) + " maxDiff=" + maxD9.toExponential(3));
  }

  // Compute MSE between input and output (recon error)
  var truth = Array.from(testImg);
  var predFlat = preds[0].arraySync()[0];
  if (predFlat.length === 784) {
    var sumSq = 0;
    for (var k = 0; k < 784; k++) sumSq += Math.pow(truth[k] - predFlat[k], 2);
    console.log("\nReconstruction MSE on synthetic input:", (sumSq / 784).toFixed(6));
  } else {
    console.log("\nUnexpected output shape — cannot compute MSE. predFlat.length=" + predFlat.length);
  }
})().catch(function (e) { console.error("ERROR:", e.message); console.error(e.stack); process.exit(1); });

// Headless: load LSTM-VAE artifact, predict on a sample, compare to expected.
"use strict";
global.window = global;
global.document = { createElement: function () { return { onload: null, onerror: null, style: {} }; }, head: { appendChild: function () {} } };
global.OSCDatasetModules = { registerModule: function () {} };

var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");

var path = require("path");
// Repo root resolved relative to this script so it works on any machine,
// not just the original WSL checkout. Codex flagged the prior hardcoded
// /mnt/f/... path as unportable.
var REPO_ROOT = path.resolve(__dirname, "..");

require(path.join(REPO_ROOT, "src/schema_registry.js"));
require(path.join(REPO_ROOT, "src/schema_definitions_builtin.js"));
var MBC = require(path.join(REPO_ROOT, "src/model_builder_core.js"));
var WC = require(path.join(REPO_ROOT, "src/weight_converter.js"));

var fs = require("fs");
var vm = require("vm");

// Load preset
var demoDir = path.join(REPO_ROOT, "demo/LSTM-VAE-for-dominant-motion-extraction");
vm.runInThisContext(fs.readFileSync(path.join(demoDir, "ant_data.js"), "utf8"));
var presetSrc = fs.readFileSync(path.join(demoDir, "preset.js"), "utf8");
vm.runInThisContext(presetSrc);
var preset = global.LSTM_VAE_DEMO_PRESET;
var lstmVaeModel = preset.models.find(function (m) { return m.id === "demo-lstm-vae"; });

// Load pretrained artifact
var artSrc = fs.readFileSync(path.join(demoDir, "lstm_vae_paper_pretrained.js"), "utf8");
var match = artSrc.match(/=\s*"([A-Za-z0-9+/=]+)"/);
var b = Buffer.from(match[1], "base64");
var hdrLen = b.readUInt32LE(0);
var hdr = JSON.parse(b.slice(4, 4 + hdrLen).toString("utf8"));
var weightBytes = b.slice(4 + hdrLen);
console.log("Artifact:", hdr.name, "specs=", hdr.weightSpecs.length);

var artifacts = {
  weightSpecs: hdr.weightSpecs,
  weightValues: (function () {
    var buf = Buffer.alloc(weightBytes.length);
    weightBytes.copy(buf);
    return Array.from(new Float32Array(buf.buffer, 0, Math.floor(buf.length / 4)));
  })(),
  producerRuntime: hdr.backend === "cuda" ? "python_server" : "js_client",
};

(async function () {
  await tf.setBackend("cpu");
  await tf.ready();

  // Build model the way eval would
  var built = MBC.buildModelFromGraph(tf, lstmVaeModel.graph, {
    mode: "direct",
    featureSize: 40,
    windowSize: 1,
    seqFeatureSize: 40,
    allowedOutputKeys: [{ key: "xv", featureSize: 40, headType: "regression" }],
    defaultTarget: "xv",
    numClasses: 0,
    targetSize: 40,
  });
  console.log("Built model weights:");
  built.model.weights.forEach(function (w) { console.log("  " + w.name + " " + JSON.stringify(w.shape)); });

  // Load weights
  var loadResult = WC.loadArtifactsIntoModel(tf, built.model, artifacts);
  console.log("Load result:", JSON.stringify(loadResult));

  // Predict on a sample
  var sample = global.ANT_DATA.s[0];
  console.log("Sample[0..5]:", sample.slice(0, 5));
  console.log("Sample range:", Math.min.apply(null, sample), Math.max.apply(null, sample));

  var x = tf.tensor2d([sample]);
  var pred = built.model.predict(x);
  var preds = Array.isArray(pred) ? pred : [pred];
  preds.forEach(function (p, i) {
    var arr = p.arraySync();
    console.log("Output[" + i + "] shape=" + JSON.stringify(p.shape) + " sample=" + JSON.stringify(arr[0].slice(0, 5)));
  });

  // Compute MAE and R²
  var truthFlat = sample;
  var predFlat = preds[0].arraySync()[0];
  var sumAbsErr = 0, sumSqErr = 0, sumTrue = 0, sumSqTrue = 0, n = truthFlat.length;
  for (var i = 0; i < n; i++) {
    sumAbsErr += Math.abs(truthFlat[i] - predFlat[i]);
    sumSqErr += Math.pow(truthFlat[i] - predFlat[i], 2);
    sumTrue += truthFlat[i];
    sumSqTrue += truthFlat[i] * truthFlat[i];
  }
  var meanTrue = sumTrue / n;
  var ssTot = sumSqTrue - n * meanTrue * meanTrue;
  console.log("Single-sample MAE:", sumAbsErr / n);
  console.log("Single-sample R²:", 1 - sumSqErr / ssTot);
})();

#!/usr/bin/env node
"use strict";
/**
 * Probe: build the LSTM-VAE model graph from the demo's preset and
 * print what output shape the model_builder actually produces. The
 * user reported `first_sample_shape: [1]` from the live site, which
 * would mean the output layer is collapsing to a single scalar. This
 * script reproduces that build to confirm.
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

var presetSrc = fs.readFileSync(path.join(REPO, "demo/LSTM-VAE-for-dominant-motion-extraction/preset.js"), "utf8");
var sandbox = { window: {}, Date: Date };
vm.runInNewContext(presetSrc, sandbox);
var preset = Object.keys(sandbox.window).map(function (k) { return sandbox.window[k]; })
  .find(function (v) { return v && v.models; });

(async function () {
  await tf.setBackend("cpu"); await tf.ready();

  var allowedKeys = sr.getOutputKeys("ant_trajectory");
  console.log("Schema allowedOutputKeys:");
  allowedKeys.forEach(function (k) {
    console.log("  " + JSON.stringify(k));
  });

  var modelDef = preset.models.find(function (m) { return m.id === "demo-lstm-vae"; });
  var built = MBC.buildModelFromGraph(tf, modelDef.graph, {
    mode: "direct", featureSize: 40, windowSize: 1, seqFeatureSize: 40,
    allowedOutputKeys: allowedKeys, defaultTarget: "xv", numClasses: 0,
  });
  console.log();
  console.log("Built model outputs:");
  built.model.outputs.forEach(function (o, i) { console.log("  output[" + i + "].shape=" + JSON.stringify(o.shape)); });
  console.log("headConfigs:", JSON.stringify(built.headConfigs));

  // Run a forward pass to confirm shape.
  var x = tf.zeros([1, 40]);
  var y = built.model.predict(x);
  var arr = (Array.isArray(y) ? y[0] : y);
  console.log("predict() output shape:", JSON.stringify(arr.shape));
  console.log("predict() values:", arr.dataSync());
})().catch(function (e) { console.error(e); process.exit(1); });

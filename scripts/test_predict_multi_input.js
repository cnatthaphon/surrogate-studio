"use strict";
// #173 fix verification: prediction_core.batchPredict and rolloutAutoregressive
// must handle multi-input models (e.g. graphs with target_source) by padding
// the unmatched inputs with zero tensors instead of crashing with
// "Expected to see N Tensor(s), but instead got 1 Tensor(s)".
//
// Before fix: model.predict(singleTensor) on a 2-input model throws.
// After fix:  wrapped into [primary, zeros] and predict runs cleanly.
var path = require("path");
global.window = global;
global.OSCDatasetModules = { registerModule: function () {}, registerModules: function () {} };
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var sr = require(path.join(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var MBC = require(path.join(__dirname, "..", "src/model_builder_core.js"));
var PC = require(path.join(__dirname, "..", "src/prediction_core.js"));

require(path.join(__dirname, "..", "demo/SAR-Ship-Detection/preset.js"));
var preset = global.SAR_SHIP_DETECTION_PRESET;
var augModel = preset.models.filter(function (m) { return m.id === "sar_cnn_aug"; })[0];

(async function () {
  await tf.setBackend("cpu"); await tf.ready();
  var ok = true;
  var fail = function (m) { console.error("  FAIL: " + m); ok = false; };

  // Build the actual SAR-Ship aug graph (2 inputs: image + target_source)
  var built = MBC.buildModelFromGraph(tf, augModel.graph, {
    mode: "direct", featureSize: 64 * 64, imageShape: [64, 64, 1],
    allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
    defaultTarget: "bbox", numClasses: 1, targetSize: 4,
  });
  console.log("Built sar_cnn_aug: inputs=" + built.model.inputs.length + " outputs=" + built.model.outputs.length);
  if (built.model.inputs.length !== 2) fail("expected 2 inputs for aug graph");

  // Test 1: batchPredict on multi-input model
  console.log("Test 1: batchPredict feeds image-only data through a 2-input model");
  var xTest = [];
  for (var i = 0; i < 8; i++) {
    var row = new Array(64 * 64);
    for (var p = 0; p < row.length; p++) row[p] = ((p + i) % 256) / 255;
    xTest.push(row);
  }
  var preds;
  try {
    preds = await PC.batchPredict(tf, built.model, xTest, { batchSize: 4 });
  } catch (e) {
    fail("batchPredict threw on multi-input model: " + (e && e.message || e));
    process.exit(1);
  }
  if (!Array.isArray(preds) || preds.length !== 8) fail("expected 8 predictions, got " + (preds && preds.length));
  if (preds[0] && preds[0].length !== 4) fail("expected each prediction to be 4-vector (bbox), got " + (preds[0] && preds[0].length));
  console.log("  ✓ predicted " + preds.length + " bboxes, each shape " + (preds[0] ? preds[0].length : "?"));

  // Test 2: single-input model still works (regression check)
  console.log("Test 2: single-input baseline model still predicts cleanly (no regression)");
  var baseModel = preset.models.filter(function (m) { return m.id === "sar_cnn"; })[0];
  var baseBuilt = MBC.buildModelFromGraph(tf, baseModel.graph, {
    mode: "direct", featureSize: 64 * 64, imageShape: [64, 64, 1],
    allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
    defaultTarget: "bbox", numClasses: 1, targetSize: 4,
  });
  if (baseBuilt.model.inputs.length !== 1) fail("baseline model should have 1 input, got " + baseBuilt.model.inputs.length);
  var basePreds = await PC.batchPredict(tf, baseBuilt.model, xTest, { batchSize: 4 });
  if (basePreds.length !== 8) fail("baseline batchPredict expected 8 results");
  console.log("  ✓ baseline batchPredict still returns " + basePreds.length + " predictions");

  // Test 3: extras are disposed (no memory leak)
  console.log("Test 3: tensor count returns to baseline after batchPredict (no extras leak)");
  var beforeT = tf.memory().numTensors;
  await PC.batchPredict(tf, built.model, xTest.slice(0, 4), { batchSize: 4 });
  var afterT = tf.memory().numTensors;
  if (afterT - beforeT > 0) {
    fail("tensor leak: before=" + beforeT + " after=" + afterT + " (delta " + (afterT - beforeT) + ")");
  } else {
    console.log("  ✓ tensor count stable (" + beforeT + " → " + afterT + ")");
  }

  if (ok) console.log("\nPASS: prediction_core handles multi-input models (target_source graphs eval cleanly).");
  else { console.error("\nFAIL"); process.exit(1); }
})().catch(function (e) { console.error(e && e.stack ? e.stack : e); process.exit(1); });

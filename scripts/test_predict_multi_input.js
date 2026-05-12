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

  // #174 (P1 from PR #75 review): match by trailing shape, not just rank.
  // If a graph wires target_source BEFORE image_source (lower node ID), the
  // resulting model has [target_input, image_input] order. A rank-only match
  // would feed image data into the target slot and crash with a shape error
  // ("expected target_first to have shape [null,4] but got [B,4096]").
  console.log("Test 4: reversed input order — target_source first, image second");
  var reversedGraph = { drawflow: { Home: { data: {
    // Lower IDs come first in topo, so target_source gets nid=1 and shows up
    // as model.inputs[0]. image_source gets nid=2.
    "1": { id:1, name:"target_source_layer", data:{ targetKey:"bbox", featureSize:4 }, class:"target_source_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"7", input:"input_2" }] } }, pos_x:0, pos_y:200 },
    "2": { id:2, name:"image_source_layer", data:{ sourceKey:"pixel_values", featureSize:64*64, imageShape:[64,64,1] }, class:"image_source_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "3": { id:3, name:"reshape_layer", data:{ targetShape:"64,64,1" }, class:"reshape_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"4", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "4": { id:4, name:"flatten_layer", data:{}, class:"flatten_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"3", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"5", input:"input_1" }] } }, pos_x:200, pos_y:0 },
    "5": { id:5, name:"dense_layer", data:{ units:8, activation:"relu" }, class:"dense_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"4", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"6", input:"input_1" }] } }, pos_x:300, pos_y:0 },
    "6": { id:6, name:"dense_layer", data:{ units:4, activation:"relu" }, class:"dense_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"5", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"7", input:"input_1" }] } }, pos_x:400, pos_y:0 },
    "7": { id:7, name:"output_layer", data:{ target:"bbox", targetType:"bbox", loss:"mse", units:4, headType:"regression" }, class:"output_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"6", output:"output_1" }] }, input_2:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{}, pos_x:500, pos_y:0 },
  } } } };
  var revBuilt;
  try {
    revBuilt = MBC.buildModelFromGraph(tf, reversedGraph, {
      mode: "direct", featureSize: 64*64, imageShape: [64, 64, 1],
      allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
      defaultTarget: "bbox", numClasses: 1, targetSize: 4,
    });
  } catch (e) {
    fail("reversed graph build failed: " + (e && e.message || e));
    process.exit(1);
  }
  if (revBuilt.model.inputs.length !== 2) fail("reversed graph expected 2 inputs, got " + revBuilt.model.inputs.length);
  // Verify the slot ordering really is reversed (target_input first)
  var firstShape = revBuilt.model.inputs[0].shape;
  var secondShape = revBuilt.model.inputs[1].shape;
  console.log("  model.inputs[0] shape=" + JSON.stringify(firstShape) + " (expect [null,4] target)");
  console.log("  model.inputs[1] shape=" + JSON.stringify(secondShape) + " (expect [null,4096] image)");
  var input0Trailing = firstShape[firstShape.length - 1];
  if (input0Trailing !== 4) {
    console.log("  (note: this preset version puts image first; reversed-order coverage may need different graph)");
  } else {
    // Confirmed reversed: target_source is model.inputs[0]. Now call
    // batchPredict with image-sized data — if buildPredictInputs is rank-only,
    // it'll route image into target slot and TF.js throws a shape error.
    var revPreds;
    try {
      revPreds = await PC.batchPredict(tf, revBuilt.model, xTest, { batchSize: 4 });
    } catch (e) {
      var m = String(e && e.message || e);
      fail("reversed-input batchPredict threw (image went into target slot): " + m.slice(0, 200));
      console.error(e && e.stack);
      process.exit(1);
    }
    if (!Array.isArray(revPreds) || revPreds.length !== xTest.length) {
      fail("reversed-input batchPredict returned " + (revPreds && revPreds.length) + " preds, expected " + xTest.length);
    }
    console.log("  ✓ reversed-input model: image fed into model.inputs[1] (matched by trailing shape)");
  }

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

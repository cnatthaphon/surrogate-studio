"use strict";
// #146 Phase 1 smoke test: build a graph with target_source
// connected to output_layer.input_2 (with augment_bbox in between),
// verify the model has TWO inputs (image + target) and the build
// completes without errors.
//
// This validates the foundation of #146: target_source becomes a
// real tf.input. Engine-side feeding of dataset y to that input is
// Phase 2.
var path = require("path");
global.window = global;
global.OSCDatasetModules = { registerModule: function () {} };
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var sr = require(path.join(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var MBC = require(path.join(__dirname, "..", "src/model_builder_core.js"));

(async function () {
  await tf.setBackend("cpu"); await tf.ready();
  var ok = true;
  var fail = function (msg) { console.error("  FAIL: " + msg); ok = false; };

  var H = 8, W = 8, C = 1, FS = H * W * C;
  // Graph:
  //   image_source(1) → reshape(2) → conv2d(3) → flatten(4) → output(5).input_1
  //   target_source(6) → augment_bbox(7) → output(5).input_2
  var graph = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer", data:{mode:"flat", featureSize:FS, imageShape:[H,W,C]}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"reshape_layer", data:{targetShape: H+","+W+","+C}, class:"reshape_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:120, pos_y:0 },
    "3": { id:3, name:"conv2d_layer", data:{filters:4, kernelSize:3, strides:1, padding:"same", activation:"relu"}, class:"conv2d_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"4",input:"input_1"}]}}, pos_x:240, pos_y:0 },
    "4": { id:4, name:"flatten_layer", data:{}, class:"flatten_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"3",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"5",input:"input_1"}]}}, pos_x:360, pos_y:0 },
    "5": { id:5, name:"output_layer", data:{target:"bbox", targetType:"bbox", loss:"mse", units:4}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"4",output:"output_1"}]}, input_2:{connections:[{node:"7",output:"output_1"}]}}, outputs:{}, pos_x:480, pos_y:0 },
    "6": { id:6, name:"target_source_layer", data:{targetKey:"bbox", featureSize:4}, class:"target_source_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"7",input:"input_1"}]}}, pos_x:120, pos_y:200 },
    "7": { id:7, name:"augment_bbox_layer", data:{hflipProb: 0.5, vflipProb: 0, seedLink:"aug1", imageWidth:W, imageHeight:H, format:"x0y0x1y1"}, class:"augment_bbox_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"6",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"5",input:"input_2"}]}}, pos_x:240, pos_y:200 },
  } } } };

  console.log("Building graph with target_source → augment_bbox → output_layer.input_2...");
  var built;
  try {
    built = MBC.buildModelFromGraph(tf, graph, {
      mode: "direct", featureSize: FS, windowSize: 1, seqFeatureSize: FS,
      allowedOutputKeys: [{ key: "bbox", label: "bbox", headType: "regression", featureSize: 4 }],
      defaultTarget: "bbox", numClasses: 0, targetSize: 4,
    });
  } catch (e) {
    fail("build threw: " + (e && e.message || e));
    process.exit(1);
  }

  console.log("  model.inputs.length: " + built.model.inputs.length);
  console.log("  model.inputs.names: " + built.model.inputs.map(function (i) { return i.name; }).join(", "));
  console.log("  model.outputs.length: " + built.model.outputs.length);
  console.log("  model.outputs.shapes: " + built.model.outputs.map(function (o) { return JSON.stringify(o.shape); }).join(", "));

  // Test 1: model has TWO inputs (image + target).
  if (built.model.inputs.length !== 2) {
    fail("expected 2 model inputs (image + target), got " + built.model.inputs.length);
  }
  var hasTargetInput = built.model.inputs.some(function (i) { return /target_input_bbox/.test(i.name); });
  if (!hasTargetInput) fail("no target_input_bbox_* input found among model inputs");

  // Test 2: model has TWO outputs (prediction + augmented target via input_2 wiring).
  if (built.model.outputs.length < 2) {
    fail("expected >=2 model outputs (prediction + augmented target), got " + built.model.outputs.length);
  }

  // Test 3: predict() runs end-to-end with both inputs.
  var imgX = tf.randomUniform([2, FS], 0, 1);
  var bboxX = tf.tensor2d([[1, 2, 5, 6], [3, 1, 7, 4]]);
  try {
    var preds = built.model.predict([imgX, bboxX]);
    var predList = Array.isArray(preds) ? preds : [preds];
    console.log("  predict produced " + predList.length + " output tensors:");
    predList.forEach(function (p, i) { console.log("    [" + i + "] " + JSON.stringify(p.shape)); });
    predList.forEach(function (p) { p.dispose(); });
  } catch (e) {
    fail("predict failed: " + (e && e.message || e));
  }
  imgX.dispose(); bboxX.dispose();

  if (ok) {
    console.log("\nPASS: target_source emits a tf.input and wires through augment_bbox to output_layer.input_2.");
  } else {
    console.error("\nFAIL: at least one assertion failed.");
    process.exit(1);
  }
})().catch(function (e) { console.error(e); process.exit(1); });

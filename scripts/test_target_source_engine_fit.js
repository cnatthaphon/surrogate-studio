"use strict";
// #146 Phase 2 full smoke test: training engine end-to-end with
// target_source feeding through augment_label (passthrough) into
// output_layer.input_2. Verifies trainModel runs without errors and
// produces a finite loss.
var path = require("path");
global.window = global;
global.OSCDatasetModules = { registerModule: function () {} };
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var sr = require(path.join(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var MBC = require(path.join(__dirname, "..", "src/model_builder_core.js"));
var TEC = require(path.join(__dirname, "..", "src/training_engine_core.js"));

(async function () {
  await tf.setBackend("cpu"); await tf.ready();
  var ok = true;
  var fail = function (msg) { console.error("  FAIL: " + msg); ok = false; };

  var FS = 16, TARGET_SIZE = 4;
  var N = 64;
  var xTrain = [], yTrain = [];
  for (var i = 0; i < N; i++) {
    var x = [];
    for (var p = 0; p < FS; p++) x.push(Math.random());
    xTrain.push(x);
    yTrain.push([0.1, 0.2, 0.5, 0.6]);  // constant target
  }
  var dataset = {
    xTrain: xTrain, yTrain: yTrain,
    xVal: xTrain.slice(0, 8), yVal: yTrain.slice(0, 8),
    xTest: xTrain.slice(0, 8), yTest: yTrain.slice(0, 8),
    targetMode: "bbox", targetSize: TARGET_SIZE, numClasses: 1,
  };

  var graph = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer", data:{mode:"flat", featureSize:FS}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"dense_layer", data:{units:8, activation:"relu"}, class:"dense_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:120, pos_y:0 },
    "3": { id:3, name:"output_layer", data:{target:"bbox", targetType:"bbox", loss:"mse", units:TARGET_SIZE, headType:"regression"}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}, input_2:{connections:[{node:"5",output:"output_1"}]}}, outputs:{}, pos_x:240, pos_y:0 },
    "4": { id:4, name:"target_source_layer", data:{targetKey:"bbox", featureSize:TARGET_SIZE}, class:"target_source_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"5",input:"input_1"}]}}, pos_x:0, pos_y:200 },
    "5": { id:5, name:"augment_label_layer", data:{seedLink:""}, class:"augment_label_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"4",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_2"}]}}, pos_x:120, pos_y:200 },
  } } } };

  var built;
  try {
    built = MBC.buildModelFromGraph(tf, graph, {
      mode: "direct", featureSize: FS, windowSize: 1, seqFeatureSize: FS,
      allowedOutputKeys: [{ key: "bbox", label: "bbox", headType: "regression", featureSize: TARGET_SIZE }],
      defaultTarget: "bbox", numClasses: 1, targetSize: TARGET_SIZE,
    });
  } catch (e) {
    fail("build failed: " + (e && e.message || e));
    process.exit(1);
  }

  var inputNodes = built.model.inputs.map(function (mi) {
    if (/target_input_/.test(mi.name)) {
      return { name: "target_source_layer", data: { targetKey: "bbox", featureSize: TARGET_SIZE } };
    }
    return { name: "input_layer", data: {} };
  });

  console.log("Running 3-epoch fit with target_source pipeline...");
  try {
    var result = await TEC.trainModel(tf, {
      model: built.model,
      dataset: dataset,
      datasetMeta: { featureSize: FS, targetSize: TARGET_SIZE, numClasses: 1, allowedOutputKeys: [{ key: "bbox", featureSize: TARGET_SIZE }] },
      inputNodes: inputNodes,
      headConfigs: built.headConfigs || [],
      epochs: 3, batchSize: 16, learningRate: 0.05, optimizer: "adam",
    });
    var lossList = (result.epochHistory || result.epochs || []).map(function (e) { return e.loss; });
    console.log("  epoch losses: " + JSON.stringify(lossList));
    if (!lossList.length) fail("no epoch losses captured");
    if (lossList.some(function (l) { return !isFinite(l); })) fail("non-finite loss observed");
  } catch (e) {
    fail("trainModel threw: " + (e && e.message || e));
    if (e && e.stack) console.error(e.stack);
  }

  if (ok) {
    console.log("\nPASS: target_source feeds through engine end-to-end (build + fit with multi-output graph).");
  } else {
    console.error("\nFAIL: at least one assertion failed.");
    process.exit(1);
  }
})().catch(function (e) { console.error(e); if (e && e.stack) console.error(e.stack); process.exit(1); });

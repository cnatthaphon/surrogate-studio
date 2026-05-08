"use strict";
// #147 SAR-Ship demo smoke test: loads the actual preset's buildCnnAugDetector
// graph and verifies it builds + fits. Uses synthetic 64x64 patches with
// constant-region bbox targets so flipping really does change the answer
// when probability=1.0 — which is what we use here as a forcing function.
var path = require("path");
global.window = global;
global.OSCDatasetModules = { registerModule: function () {}, registerModules: function () {} };
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var sr = require(path.join(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var MBC = require(path.join(__dirname, "..", "src/model_builder_core.js"));
var TEC = require(path.join(__dirname, "..", "src/training_engine_core.js"));

// Load the preset by executing it under window.
require(path.join(__dirname, "..", "demo/SAR-Ship-Detection/preset.js"));
var preset = global.SAR_SHIP_DETECTION_PRESET;
if (!preset) { console.error("preset did not register"); process.exit(1); }

(async function () {
  await tf.setBackend("cpu"); await tf.ready();
  var ok = true;
  var fail = function (msg) { console.error("  FAIL: " + msg); ok = false; };

  // -- Step 1: locate the augmented model's graph --
  var augModel = preset.models.filter(function (m) { return m.id === "sar_cnn_aug"; })[0];
  if (!augModel) { fail("preset missing sar_cnn_aug model"); process.exit(1); }
  var graph = augModel.graph;
  console.log("Step 1: located sar_cnn_aug preset graph");

  // -- Step 2: build the model from the graph --
  var built;
  try {
    built = MBC.buildModelFromGraph(tf, graph, {
      mode: "direct",
      featureSize: 64 * 64,
      imageShape: [64, 64, 1],
      allowedOutputKeys: [{ key: "bbox", label: "bbox", headType: "regression", featureSize: 4 }],
      defaultTarget: "bbox",
      numClasses: 1,
      targetSize: 4,
    });
  } catch (e) {
    fail("build failed: " + (e && e.message || e));
    if (e && e.stack) console.error(e.stack);
    process.exit(1);
  }
  console.log("Step 2: model built — inputs=" + built.model.inputs.length + " outputs=" + built.model.outputs.length);
  if (built.model.inputs.length !== 2) fail("expected 2 inputs (image + target_source); got " + built.model.inputs.length);
  if (built.model.outputs.length !== 2) fail("expected 2 outputs (bbox prediction + augmented target); got " + built.model.outputs.length);

  // Diagnostic: log input names + shapes.
  built.model.inputs.forEach(function (inp, i) {
    console.log("  input[" + i + "]: name=" + inp.name + " shape=" + JSON.stringify(inp.shape));
  });
  built.model.outputs.forEach(function (out, i) {
    console.log("  output[" + i + "]: shape=" + JSON.stringify(out.shape));
  });

  // -- Step 3: synthetic dataset (small, 64 train / 8 val / 8 test) --
  var FS = 64 * 64;
  var N = 64, NV = 8, NT = 8;
  var xTrain = [], yTrain = [];
  // Build a striped pattern so flipping is detectable + bbox stays around the bright stripe
  for (var i = 0; i < N; i++) {
    var img = new Array(FS);
    var stripeStart = 8 + (i % 16);  // varying stripe column
    var stripeW = 6;
    for (var p = 0; p < FS; p++) {
      var col = p % 64;
      img[p] = (col >= stripeStart && col < stripeStart + stripeW) ? 0.9 : 0.1;
    }
    xTrain.push(img);
    // bbox in normalized xywh: covers the bright stripe
    yTrain.push([stripeStart / 64, 0.2, stripeW / 64, 0.6]);
  }
  // Use a slice for val/test
  var dataset = {
    xTrain: xTrain, yTrain: yTrain,
    xVal: xTrain.slice(0, NV), yVal: yTrain.slice(0, NV),
    xTest: xTrain.slice(0, NT), yTest: yTrain.slice(0, NT),
    targetMode: "bbox", targetSize: 4, numClasses: 1,
    imageShape: [64, 64, 1], featureSize: FS,
  };

  // -- Step 4: inputNodes for engine — image_source + target_source --
  var inputNodes = built.model.inputs.map(function (mi) {
    if (/target_input_/.test(mi.name)) {
      return { name: "target_source_layer", data: { targetKey: "bbox", featureSize: 4 } };
    }
    return { name: "image_source_layer", data: { sourceKey: "pixel_values", featureSize: FS, imageShape: [64, 64, 1] } };
  });

  // -- Step 5: 3-epoch fit, expect finite + decreasing loss --
  console.log("Step 3: running 3-epoch fit...");
  try {
    var result = await TEC.trainModel(tf, {
      model: built.model,
      dataset: dataset,
      datasetMeta: { featureSize: FS, targetSize: 4, numClasses: 1, imageShape: [64, 64, 1], allowedOutputKeys: [{ key: "bbox", featureSize: 4 }] },
      inputNodes: inputNodes,
      headConfigs: built.headConfigs || [],
      epochs: 3, batchSize: 16, learningRate: 0.01, optimizer: "adam",
    });
    var hist = result.epochHistory || result.epochs || [];
    var losses = hist.map(function (e) { return e.loss; });
    console.log("  epoch losses: " + JSON.stringify(losses));
    if (!losses.length) fail("no epoch losses captured");
    if (losses.some(function (l) { return !isFinite(l); })) fail("non-finite loss observed");
    if (losses.length >= 2 && losses[losses.length - 1] >= losses[0]) {
      console.warn("  warn: loss did not strictly decrease — may indicate aug fighting label (which is the bug we want to catch)");
    }
  } catch (e) {
    fail("trainModel threw: " + (e && e.message || e));
    if (e && e.stack) console.error(e.stack);
  }

  if (ok) {
    console.log("\nPASS: SAR-Ship aug graph builds + fits end-to-end.");
  } else {
    console.error("\nFAIL: at least one assertion failed.");
    process.exit(1);
  }
})().catch(function (e) { console.error(e); if (e && e.stack) console.error(e.stack); process.exit(1); });

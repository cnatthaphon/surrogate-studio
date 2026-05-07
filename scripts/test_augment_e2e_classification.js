"use strict";
// End-to-end smoke test: builds a small classification graph that
// includes augment_image_layer, runs a few fit() steps + predict(),
// and asserts the model trains without errors and produces valid
// outputs. This is the "tested it" evidence that the augment block
// actually integrates with the rest of the model builder + training
// loop, not just the layer-level unit tests.
//
// Synthetic data: 4-class classification on tiny 8x8 grayscale images
// where class is invariant under horizontal flip (the augment use case
// where #146 target wiring isn't needed — labels passthrough).
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

  // 8x8 grayscale, 4 classes, NHWC.
  var H = 8, W = 8, C = 1, NUM_CLASSES = 4;
  var FEATURE_SIZE = H * W * C;

  // Graph: image_source → reshape → augment_image → conv2d → flatten → dense → output
  var graph = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer", data:{mode:"flat", featureSize:FEATURE_SIZE, imageShape:[H,W,C]}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"reshape_layer", data:{targetShape: H+","+W+","+C}, class:"reshape_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:120, pos_y:0 },
    "3": { id:3, name:"augment_image_layer", data:{transform:"horizontal_flip", probability:0.5, seedLink:"aug1", layout:"nhwc"}, class:"augment_image_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"4",input:"input_1"}]}}, pos_x:240, pos_y:0 },
    "4": { id:4, name:"conv2d_layer", data:{filters:8, kernelSize:3, strides:1, padding:"same", activation:"relu"}, class:"conv2d_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"3",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"5",input:"input_1"}]}}, pos_x:360, pos_y:0 },
    "5": { id:5, name:"flatten_layer", data:{}, class:"flatten_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"4",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"6",input:"input_1"}]}}, pos_x:480, pos_y:0 },
    "6": { id:6, name:"dense_layer", data:{units:16, activation:"relu"}, class:"dense_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"5",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"7",input:"input_1"}]}}, pos_x:600, pos_y:0 },
    "7": { id:7, name:"output_layer", data:{target:"label", targetType:"label", loss:"cross_entropy", units:NUM_CLASSES}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"6",output:"output_1"}]}}, outputs:{}, pos_x:720, pos_y:0 },
  } } } };

  console.log("Building model...");
  var built;
  try {
    built = MBC.buildModelFromGraph(tf, graph, {
      mode: "direct", featureSize: FEATURE_SIZE, windowSize: 1, seqFeatureSize: FEATURE_SIZE,
      allowedOutputKeys: [{ key: "label", label: "class label", values: ["a","b","c","d"] }],
      defaultTarget: "label", numClasses: NUM_CLASSES,
    });
  } catch (e) {
    fail("model build failed: " + (e && e.message || e));
    process.exit(1);
  }
  console.log("  model built with " + built.model.weights.length + " weight tensors");

  // ─── Test 1: forward pass works in eval mode (training=false default) ───
  console.log("Test 1: model.predict() runs end-to-end");
  var batchSize = 8;
  var x = tf.randomUniform([batchSize, FEATURE_SIZE], 0, 1);
  var pred;
  try {
    pred = built.model.predict(x);
  } catch (e) {
    fail("predict failed: " + (e && e.message || e));
    process.exit(1);
  }
  var predTensor = Array.isArray(pred) ? pred[0] : pred;
  var predShape = predTensor.shape;
  console.log("  predict output shape: " + JSON.stringify(predShape));
  if (predShape[0] !== batchSize || predShape[predShape.length - 1] !== NUM_CLASSES) {
    fail("expected predict output [" + batchSize + ", " + NUM_CLASSES + "], got " + JSON.stringify(predShape));
  }
  predTensor.dispose();

  // ─── Test 2: model compiles and fit() runs a few steps ──────────
  console.log("Test 2: model.fit() runs without error");
  built.model.compile({
    optimizer: "adam",
    loss: "categoricalCrossentropy",
    metrics: ["accuracy"],
  });
  // One-hot label tensor.
  var yLabels = [];
  for (var i = 0; i < batchSize; i++) {
    var cls = i % NUM_CLASSES;
    var oh = new Array(NUM_CLASSES).fill(0); oh[cls] = 1;
    yLabels.push(oh);
  }
  var y = tf.tensor2d(yLabels);
  try {
    var hist = await built.model.fit(x, y, { epochs: 2, batchSize: batchSize, verbose: 0 });
    console.log("  fit completed, final loss: " + hist.history.loss[hist.history.loss.length - 1].toFixed(4));
    if (!isFinite(hist.history.loss[0])) fail("loss is non-finite — likely augment layer corrupted gradients");
  } catch (e) {
    fail("fit failed: " + (e && e.message || e));
    process.exit(1);
  }

  // ─── Test 3: same input gives different outputs across fit calls (stochastic augment proves it ran) ───
  console.log("Test 3: stochastic augmentation visible in output (training mode varies across forwards)");
  // Use predict() on training=true via direct layer apply on the model's
  // augment layer. We'll find it and pass a tensor through with training=true.
  var augLayer = null;
  built.model.layers.forEach(function (l) {
    if (l.getClassName && l.getClassName() === "AugmentImageLayer") augLayer = l;
  });
  if (!augLayer) {
    fail("could not find AugmentImageLayer in built model");
  } else {
    // Distinct W values so flip is detectable.
    var probe = tf.tensor4d([[[[1],[2],[3],[4],[5],[6],[7],[8]]
                             ,[[1],[2],[3],[4],[5],[6],[7],[8]]
                             ,[[1],[2],[3],[4],[5],[6],[7],[8]]
                             ,[[1],[2],[3],[4],[5],[6],[7],[8]]
                             ,[[1],[2],[3],[4],[5],[6],[7],[8]]
                             ,[[1],[2],[3],[4],[5],[6],[7],[8]]
                             ,[[1],[2],[3],[4],[5],[6],[7],[8]]
                             ,[[1],[2],[3],[4],[5],[6],[7],[8]]]]);
    var flipCount = 0;
    for (var k = 0; k < 50; k++) {
      var out = augLayer.apply(probe, { training: true });
      var arr = out.arraySync()[0];
      // After hflip, first W cell becomes 8 (was 1).
      if (arr[0][0][0] === 8) flipCount++;
      out.dispose();
    }
    console.log("  augment layer flipped " + flipCount + "/50 in training mode (expect ~25 with p=0.5)");
    if (flipCount === 0) fail("augment layer never flipped in training mode — probability=0.5 not honored");
    if (flipCount === 50) fail("augment layer always flipped — randomness broken");
    probe.dispose();
  }

  x.dispose(); y.dispose();

  if (ok) {
    console.log("\nPASS: augment_image_layer integrates end-to-end (build + fit + predict + stochastic flip).");
  } else {
    console.error("\nFAIL: at least one assertion failed.");
    process.exit(1);
  }
})().catch(function (e) { console.error(e); process.exit(1); });

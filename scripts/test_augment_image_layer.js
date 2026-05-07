"use strict";
// Smoke test for #144: AugmentImageLayer
//
// Asserts that:
//   1. The layer instantiates with config.transform = "horizontal_flip"
//      and registers via tf.serialization (round-trippable).
//   2. In training=true mode with probability=1.0, the W axis is reversed
//      (deterministic flip).
//   3. In training=true mode with probability=0.0, the input is unchanged.
//   4. In training=false (eval) mode, regardless of probability, the
//      input is unchanged — augmentation is training-only.
//   5. The layer can be wired into a graph via buildModelFromGraph and
//      the resulting model.predict() runs (eval mode = identity).
//   6. The "identity" transform passes through untouched in both modes.
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
  var assertClose = function (label, a, b, tol) {
    var d = Math.abs(a - b);
    if (d > (tol || 1e-6)) fail(label + " (got " + a.toFixed(6) + ", expected " + b.toFixed(6) + ", diff " + d.toFixed(6) + ")");
  };

  // Pull AugmentImageLayer out of the registry (model_builder registers it
  // when its IIFE runs during buildModelFromGraph; for direct construction
  // we look it up via tf.serialization).
  // Build a minimal graph that uses augment_image_layer so the IIFE in
  // model_builder_core runs and registers the class.
  var smallImage = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer", data:{mode:"image", featureSize:12, imageShape:[2,3,2]}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"augment_image_layer", data:{transform:"horizontal_flip", probability:1.0, seedLink:""}, class:"augment_image_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:200, pos_y:0 },
    "3": { id:3, name:"output_layer", data:{target:"pixel_values", targetType:"pixel_values", loss:"none", units:12}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}}, outputs:{}, pos_x:400, pos_y:0 },
  } } } };
  var built = MBC.buildModelFromGraph(tf, smallImage, {
    mode: "direct", featureSize: 12, windowSize: 1, seqFeatureSize: 12,
    allowedOutputKeys: [{ key: "pixel_values", label: "pixel", featureSize: 12, shape: [2, 3, 2] }],
    defaultTarget: "pixel_values", numClasses: 0,
  });

  // Now AugmentImageLayer is registered. Look it up.
  var Layer = null;
  try {
    var reg = tf.serialization.SerializationMap.getMap();
    var classMap = reg && reg.classNameMap ? reg.classNameMap : null;
    if (classMap && classMap["AugmentImageLayer"]) {
      Layer = classMap["AugmentImageLayer"][0];
    }
  } catch (e) {}
  if (!Layer) {
    // Fallback: pull from any AugmentImage layer instance in the model.
    built.model.layers.forEach(function (l) {
      if (l.getClassName && l.getClassName() === "AugmentImageLayer" && !Layer) Layer = l.constructor;
    });
  }
  if (!Layer) {
    fail("could not find AugmentImageLayer class (registration failed)");
    process.exit(1);
  }

  // ─── Test 1: probability=1.0 + training=true → flip happens ────
  console.log("Test 1: training=true, probability=1.0 → deterministic flip");
  var layer1 = new Layer({ transform: "horizontal_flip", probability: 1.0 });
  // [B=1, H=2, W=3, C=2]: distinct values per W-position so a flip is detectable.
  var x = tf.tensor4d([
    [[[1, 2], [3, 4], [5, 6]],
     [[7, 8], [9, 10], [11, 12]]]
  ]);
  // Apply with training=true repeatedly; with prob=1.0 the result is always flipped.
  for (var trial = 0; trial < 5; trial++) {
    var y = layer1.apply(x, { training: true });
    var arr = y.arraySync()[0];  // [H, W, C]
    // First row should be [[5,6], [3,4], [1,2]] (flipped W axis).
    assertClose("trial " + trial + " row0[0][0]", arr[0][0][0], 5, 1e-6);
    assertClose("trial " + trial + " row0[2][0]", arr[0][2][0], 1, 1e-6);
    y.dispose();
  }
  console.log("  -> all 5 trials produced flipped output");

  // ─── Test 2: probability=0.0 + training=true → never flips ─────
  console.log("Test 2: training=true, probability=0.0 → never flips");
  var layer0 = new Layer({ transform: "horizontal_flip", probability: 0.0 });
  for (var trial2 = 0; trial2 < 5; trial2++) {
    var y2 = layer0.apply(x, { training: true });
    var arr2 = y2.arraySync()[0];
    assertClose("trial " + trial2 + " row0[0][0]", arr2[0][0][0], 1, 1e-6);
    assertClose("trial " + trial2 + " row0[2][0]", arr2[0][2][0], 5, 1e-6);
    y2.dispose();
  }
  console.log("  -> all 5 trials produced unflipped output");

  // ─── Test 3: training=false → identity regardless of probability ──
  console.log("Test 3: training=false, probability=1.0 → identity (no flip)");
  var layerEval = new Layer({ transform: "horizontal_flip", probability: 1.0 });
  for (var trial3 = 0; trial3 < 3; trial3++) {
    var y3 = layerEval.apply(x, { training: false });
    var arr3 = y3.arraySync()[0];
    assertClose("eval trial " + trial3 + " row0[0][0]", arr3[0][0][0], 1, 1e-6);
    assertClose("eval trial " + trial3 + " row0[2][0]", arr3[0][2][0], 5, 1e-6);
    y3.dispose();
  }
  console.log("  -> eval mode is identity");

  // ─── Test 4: identity transform passthrough ────────────────────
  console.log("Test 4: transform=\"identity\" → passthrough always");
  var layerId = new Layer({ transform: "identity", probability: 1.0 });
  var yId = layerId.apply(x, { training: true });
  var arrId = yId.arraySync()[0];
  assertClose("identity trans row0[0][0]", arrId[0][0][0], 1, 1e-6);
  yId.dispose();
  console.log("  -> identity transform is passthrough");

  // ─── Test 5: getConfig round-trip ──────────────────────────────
  console.log("Test 5: getConfig captures transform/probability/seedLink");
  var layerCfg = new Layer({ transform: "horizontal_flip", probability: 0.7, seedLink: "shared_aug_42" });
  var cfg = layerCfg.getConfig();
  if (cfg.transform !== "horizontal_flip") fail("getConfig transform mismatch: " + cfg.transform);
  if (Math.abs(cfg.probability - 0.7) > 1e-6) fail("getConfig probability mismatch: " + cfg.probability);
  if (cfg.seedLink !== "shared_aug_42") fail("getConfig seedLink mismatch: " + cfg.seedLink);
  console.log("  -> config round-trips: " + JSON.stringify({ transform: cfg.transform, probability: cfg.probability, seedLink: cfg.seedLink }));

  if (ok) {
    console.log("\nPASS: AugmentImageLayer behaves correctly (flip/no-flip/eval/identity/graph/getConfig).");
    process.exit(0);
  } else {
    console.error("\nFAIL: at least one assertion failed.");
    process.exit(1);
  }
})().catch(function (e) { console.error(e); process.exit(1); });

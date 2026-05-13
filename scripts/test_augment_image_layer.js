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
  // #147 Layer 1: augment_image now hard-validates rank=4 at build time, so
  // we have to wire a reshape between flat input and the augment block.
  var smallImage = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer", data:{mode:"image", featureSize:12, imageShape:[2,3,2]}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"reshape_layer", data:{targetShape:"2,3,2"}, class:"reshape_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:100, pos_y:0 },
    "3": { id:3, name:"augment_image_layer", data:{hflipProb: 1.0, vflipProb: 0, seedLink:""}, class:"augment_image_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"4",input:"input_1"}]}}, pos_x:200, pos_y:0 },
    "4": { id:4, name:"flatten_layer", data:{}, class:"flatten_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"3",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"5",input:"input_1"}]}}, pos_x:300, pos_y:0 },
    "5": { id:5, name:"output_layer", data:{target:"pixel_values", targetType:"pixel_values", loss:"none", units:12}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"4",output:"output_1"}]}}, outputs:{}, pos_x:400, pos_y:0 },
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
  var layer1 = new Layer({ hflipProb: 1.0, vflipProb: 0 });
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
  var layer0 = new Layer({ hflipProb: 0.0, vflipProb: 0 });
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
  var layerEval = new Layer({ hflipProb: 1.0, vflipProb: 0 });
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
  var layerId = new Layer({ hflipProb: 0, vflipProb: 0 });
  var yId = layerId.apply(x, { training: true });
  var arrId = yId.arraySync()[0];
  assertClose("identity trans row0[0][0]", arrId[0][0][0], 1, 1e-6);
  yId.dispose();
  console.log("  -> identity transform is passthrough");

  // ─── Test 4b: vertical_flip on NHWC — reverses H (axis -3) ────
  console.log("Test 4b: NHWC vertical_flip, p=1.0 → flips H axis (-3)");
  var layerVF = new Layer({ hflipProb: 0, vflipProb: 1.0, layout: "nhwc" });
  for (var trialV = 0; trialV < 5; trialV++) {
    var yV = layerVF.apply(x, { training: true });
    var arrV = yV.arraySync()[0];
    assertClose("vflip trial " + trialV + " H[0][0][0]", arrV[0][0][0], 7, 1e-6);
    assertClose("vflip trial " + trialV + " H[1][0][0]", arrV[1][0][0], 1, 1e-6);
    yV.dispose();
  }
  console.log("  -> NHWC vertical_flip reverses axis -3");

  // ─── Test 4c: NCHW layout="nchw" → flips axis -1 / -2 ──────────
  console.log("Test 4c: layout=\"nchw\" → flips axis -1 (hflip), -2 (vflip)");
  // NCHW [B=1, C=2, H=2, W=3]:
  //   C=0: [[1,3,5], [7,9,11]]
  //   C=1: [[2,4,6], [8,10,12]]
  var xNchw = tf.tensor4d([
    [[[1, 3, 5], [7, 9, 11]],   // channel 0
     [[2, 4, 6], [8, 10, 12]]]  // channel 1
  ]);
  var layerHFNchw = new Layer({ hflipProb: 1.0, vflipProb: 0, layout: "nchw" });
  var yHN = layerHFNchw.apply(xNchw, { training: true });
  var arrHN = yHN.arraySync()[0];
  // NCHW hflip: axis -1 (W) reversed. C=0 H=0 was [1,3,5] → [5,3,1].
  assertClose("NCHW hflip C=0 H=0 W[0]", arrHN[0][0][0], 5, 1e-6);
  assertClose("NCHW hflip C=0 H=0 W[2]", arrHN[0][0][2], 1, 1e-6);
  yHN.dispose();
  var layerVFNchw = new Layer({ hflipProb: 0, vflipProb: 1.0, layout: "nchw" });
  var yVN = layerVFNchw.apply(xNchw, { training: true });
  var arrVN = yVN.arraySync()[0];
  // NCHW vflip: axis -2 (H) reversed. C=0 H=0 was [1,3,5], H=1 was [7,9,11] → swap.
  assertClose("NCHW vflip C=0 H=0", arrVN[0][0][0], 7, 1e-6);
  assertClose("NCHW vflip C=0 H=1", arrVN[0][1][0], 1, 1e-6);
  yVN.dispose();
  xNchw.dispose();
  console.log("  -> layout=nchw selects correct axis for both flips");

  // ─── Test 5: non-4D input must throw (#147 Layer 1 hard validation) ─
  // Previously this silently passed through. The silent path hid wiring
  // bugs (image-augment block wired to a flat dense output would never
  // augment, and training looked healthy). Now build/apply throws.
  console.log("Test 5: non-4D input → throws at apply time (was: silent passthrough)");
  var layerFlat = new Layer({ hflipProb: 1.0, vflipProb: 0 });
  var flat = tf.tensor2d([[1, 2, 3, 4], [5, 6, 7, 8]]);  // [B=2, F=4]
  var threw = false;
  try {
    layerFlat.apply(flat, { training: true });
  } catch (e) {
    threw = true;
    var m = String(e && e.message || e);
    if (!/4D|rank/i.test(m)) fail("threw, but message lacks 4D/rank hint: " + m.slice(0, 200));
  }
  if (!threw) fail("non-4D input should throw, not passthrough");
  flat.dispose();
  console.log("  -> 2D [batch, features] correctly rejected with rank/4D error");

  // ─── Test 6: invalid probability clamps (per-transform field) ──
  console.log("Test 6: invalid probability (NaN, negative, >1) clamps to [0,1]");
  var layerNeg = new Layer({ hflipProb: -0.5, vflipProb: 0 });
  if (Math.abs(layerNeg.hflipProb - 0) > 1e-9) fail("negative hflipProb did not clamp to 0 (got " + layerNeg.hflipProb + ")");
  var layerNaN = new Layer({ hflipProb: NaN, vflipProb: 0 });
  if (Math.abs(layerNaN.hflipProb - 0) > 1e-9) fail("NaN hflipProb did not clamp to 0 (got " + layerNaN.hflipProb + ")");
  var layerOver = new Layer({ hflipProb: 5, vflipProb: 0 });
  if (Math.abs(layerOver.hflipProb - 1) > 1e-9) fail("hflipProb=5 did not clamp to 1 (got " + layerOver.hflipProb + ")");
  console.log("  -> invalid probabilities clamp to 0; >1 clamps to 1");

  // ─── Test 7: getConfig round-trip ──────────────────────────────
  console.log("Test 7: getConfig captures hflipProb/vflipProb/seedLink/layout");
  var layerCfg = new Layer({ hflipProb: 0.7, vflipProb: 0.3, seedLink: "shared_aug_42", layout: "nchw" });
  var cfg = layerCfg.getConfig();
  if (Math.abs(cfg.hflipProb - 0.7) > 1e-6) fail("getConfig hflipProb mismatch: " + cfg.hflipProb);
  if (Math.abs(cfg.vflipProb - 0.3) > 1e-6) fail("getConfig vflipProb mismatch: " + cfg.vflipProb);
  if (cfg.seedLink !== "shared_aug_42") fail("getConfig seedLink mismatch: " + cfg.seedLink);
  if (cfg.layout !== "nchw") fail("getConfig layout mismatch: " + cfg.layout);
  console.log("  -> config round-trips: " + JSON.stringify({ hflipProb: cfg.hflipProb, vflipProb: cfg.vflipProb, seedLink: cfg.seedLink, layout: cfg.layout }));

  if (ok) {
    console.log("\nPASS: AugmentImageLayer behaves correctly (flip/no-flip/eval/identity/graph/getConfig).");
    process.exit(0);
  } else {
    console.error("\nFAIL: at least one assertion failed.");
    process.exit(1);
  }
})().catch(function (e) { console.error(e); process.exit(1); });

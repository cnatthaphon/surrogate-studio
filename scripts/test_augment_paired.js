"use strict";
// #145 paired augment test: verifies that AugmentImage and AugmentBbox
// sharing a seedLink make the SAME flip decision per call.
//
// The seedLink registry pattern: the image layer publishes its
// per-batch coin to a module-level Map; the bbox layer reads the same
// coin and uses it to decide whether to mirror x coords. This ensures
// a flipped image stays aligned with its flipped bboxes.
//
// Test strategy: with probability=0.5, run image+bbox pairs many times
// and verify they always agree (image flipped ↔ bbox mirrored).
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

  // Build a graph that exercises augment_image_layer so the IIFE runs
  // and registers the layer classes. We'll construct paired layers by
  // hand because we want to call .apply() with explicit training=true.
  var bootstrap = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer", data:{mode:"flat", featureSize:12, imageShape:[2,3,2]}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"augment_image_layer", data:{transform:"horizontal_flip", probability:0.5, seedLink:"aug1"}, class:"augment_image_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:200, pos_y:0 },
    "3": { id:3, name:"output_layer", data:{target:"pixel_values", targetType:"pixel_values", loss:"none", units:12}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}}, outputs:{}, pos_x:400, pos_y:0 },
  } } } };
  MBC.buildModelFromGraph(tf, bootstrap, {
    mode: "direct", featureSize: 12, windowSize: 1, seqFeatureSize: 12,
    allowedOutputKeys: [{ key: "pixel_values", label: "pixel", featureSize: 12, shape: [2, 3, 2] }],
    defaultTarget: "pixel_values", numClasses: 0,
  });

  function getLayerCtor(name) {
    var reg = tf.serialization.SerializationMap.getMap();
    var classMap = reg && reg.classNameMap ? reg.classNameMap : null;
    return classMap && classMap[name] ? classMap[name][0] : null;
  }
  var ImgLayer = getLayerCtor("AugmentImageLayer");
  var BboxLayer = getLayerCtor("AugmentBboxLayer");
  var MaskLayer = getLayerCtor("AugmentMaskLayer");
  var LabelLayer = getLayerCtor("AugmentLabelLayer");
  if (!ImgLayer || !BboxLayer || !MaskLayer || !LabelLayer) {
    fail("missing layer constructor (Img=" + !!ImgLayer + " Bbox=" + !!BboxLayer + " Mask=" + !!MaskLayer + " Label=" + !!LabelLayer + ")");
    process.exit(1);
  }

  // ─── Test 1: paired image + bbox always agree under shared seedLink ───
  console.log("Test 1: image+bbox with seedLink=aug1, probability=0.5 — agreement over 200 trials");
  var img = new ImgLayer({ transform: "horizontal_flip", probability: 0.5, seedLink: "aug1" });
  var bbox = new BboxLayer({ transform: "horizontal_flip", probability: 0.5, seedLink: "aug1", imageWidth: 100 });
  // Image [B=1, H=2, W=3, C=1] with distinct W values so a flip is detectable.
  // Bbox [B=1, 4] = [x0=10, y0=20, x1=30, y1=40].  Under hflip with imgWidth=100:
  //   x0_new = 100-30 = 70,  x1_new = 100-10 = 90.
  var x = tf.tensor4d([[[[1], [2], [3]], [[4], [5], [6]]]]);
  var b = tf.tensor2d([[10, 20, 30, 40]]);
  var flipCount = 0;
  var disagreementCount = 0;
  for (var trial = 0; trial < 200; trial++) {
    var yImg = img.apply(x, { training: true });
    var yBbox = bbox.apply(b, { training: true });
    var imgArr = yImg.arraySync()[0];
    var bboxArr = yBbox.arraySync()[0];
    // Image flip: position [0][0][0] becomes 3 (was 1). Detect.
    var imgFlipped = (imgArr[0][0][0] === 3);
    // Bbox flip: x0 becomes 70, x1 becomes 90.
    var bboxFlipped = (Math.abs(bboxArr[0] - 70) < 1e-3 && Math.abs(bboxArr[2] - 90) < 1e-3);
    if (imgFlipped !== bboxFlipped) disagreementCount++;
    if (imgFlipped) flipCount++;
    yImg.dispose(); yBbox.dispose();
  }
  console.log("  flips: " + flipCount + "/200, disagreements: " + disagreementCount);
  if (disagreementCount > 0) fail("paired layers disagreed on " + disagreementCount + " / 200 trials — seedLink registry not syncing");
  // With p=0.5, expect ~100 flips. Allow wide tolerance (50-150) since RNG is real.
  if (flipCount < 50 || flipCount > 150) fail("flip count " + flipCount + " is suspiciously skewed; RNG may be broken");

  // ─── Test 2: bbox with no shared coin (no upstream image) — falls back to own RNG ───
  console.log("Test 2: bbox alone (no upstream image with same seedLink) — fallback to own coin");
  var bboxAlone = new BboxLayer({ transform: "horizontal_flip", probability: 0.5, seedLink: "lonely_link", imageWidth: 100 });
  // Read registry directly to confirm no entry exists for this seedLink yet.
  // Just exercise the fallback path — should not throw.
  var b2 = tf.tensor2d([[10, 20, 30, 40]]);
  var loneCount = 0;
  for (var t2 = 0; t2 < 100; t2++) {
    var y = bboxAlone.apply(b2, { training: true });
    var arr = y.arraySync()[0];
    if (Math.abs(arr[0] - 70) < 1e-3) loneCount++;
    y.dispose();
  }
  console.log("  flipped " + loneCount + "/100 with own RNG (expect ~50)");
  if (loneCount < 25 || loneCount > 75) fail("lone bbox flip count " + loneCount + " is suspicious");

  // ─── Test 3: eval mode — bbox passthrough ───────────────────────
  console.log("Test 3: bbox eval mode → passthrough");
  var bboxEval = new BboxLayer({ transform: "horizontal_flip", probability: 1.0, seedLink: "aug1", imageWidth: 100 });
  var bIn = tf.tensor2d([[10, 20, 30, 40]]);
  var bOut = bboxEval.apply(bIn, { training: false });
  var bArr = bOut.arraySync()[0];
  if (Math.abs(bArr[0] - 10) > 1e-6) fail("eval mode bbox x0 changed (got " + bArr[0] + ", expected 10)");
  if (Math.abs(bArr[2] - 30) > 1e-6) fail("eval mode bbox x1 changed (got " + bArr[2] + ", expected 30)");
  console.log("  eval bbox: " + JSON.stringify(bArr) + " (unchanged)");
  bOut.dispose(); bIn.dispose();

  // ─── Test 4: paired image + mask agree under shared seedLink ────
  console.log("Test 4: image+mask with seedLink=aug2 — agreement over 100 trials");
  var img2 = new ImgLayer({ transform: "horizontal_flip", probability: 0.5, seedLink: "aug2" });
  var mask = new MaskLayer({ transform: "horizontal_flip", probability: 0.5, seedLink: "aug2" });
  var imgX = tf.tensor4d([[[[1], [2], [3]], [[4], [5], [6]]]]);
  var maskX = tf.tensor4d([[[[10], [20], [30]], [[40], [50], [60]]]]);
  var maskDisagreements = 0;
  for (var t4 = 0; t4 < 100; t4++) {
    var yi = img2.apply(imgX, { training: true });
    var ym = mask.apply(maskX, { training: true });
    var iArr = yi.arraySync()[0];
    var mArr = ym.arraySync()[0];
    var imgF = (iArr[0][0][0] === 3);
    var maskF = (mArr[0][0][0] === 30);
    if (imgF !== maskF) maskDisagreements++;
    yi.dispose(); ym.dispose();
  }
  console.log("  mask disagreements: " + maskDisagreements + "/100");
  if (maskDisagreements > 0) fail("image+mask disagreed on " + maskDisagreements + " trials");

  // ─── Test 5: label is passthrough ────────────────────────────────
  console.log("Test 5: label → passthrough always");
  var label = new LabelLayer({ seedLink: "aug1" });
  var l = tf.tensor2d([[1, 0, 0, 0, 0]]);
  var ly = label.apply(l, { training: true });
  var lArr = ly.arraySync()[0];
  if (lArr[0] !== 1 || lArr[1] !== 0) fail("label changed in training mode: " + JSON.stringify(lArr));
  ly.dispose(); l.dispose();
  console.log("  label unchanged");

  if (ok) {
    console.log("\nPASS: paired augment layers stay synced via seedLink registry.");
  } else {
    console.error("\nFAIL: at least one assertion failed.");
    process.exit(1);
  }
})().catch(function (e) { console.error(e); process.exit(1); });

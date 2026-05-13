"use strict";
// #182: multi-transform per augment block. One block can enable multiple
// transforms (hflipProb, vflipProb each in [0,1]); each rolls an independent
// coin per batch. Paired blocks via seedLink read per-transform coins so
// image and label stay aligned even with multiple transforms enabled.
//
// Also exercises Layer 3 validation: paired blocks sharing a seedLink must
// have identical (hflipProb, vflipProb) tuples — else the build throws.
var path = require("path");
global.window = global;
global.OSCDatasetModules = { registerModule: function () {}, registerModules: function () {} };
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var sr = require(path.join(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var MBC = require(path.join(__dirname, "..", "src/model_builder_core.js"));

(async function () {
  await tf.setBackend("cpu"); await tf.ready();
  var ok = true;
  var fail = function (m) { console.error("  FAIL: " + m); ok = false; };

  // Bootstrap to register the layer classes via the IIFE.
  var bootstrap = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer", data:{mode:"flat", featureSize:12}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"reshape_layer", data:{targetShape:"2,3,2"}, class:"reshape_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:100, pos_y:0 },
    "3": { id:3, name:"augment_image_layer", data:{hflipProb:0.5, vflipProb:0.5, seedLink:"", layout:"nhwc"}, class:"augment_image_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"4",input:"input_1"}]}}, pos_x:200, pos_y:0 },
    "4": { id:4, name:"flatten_layer", data:{}, class:"flatten_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"3",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"5",input:"input_1"}]}}, pos_x:300, pos_y:0 },
    "5": { id:5, name:"output_layer", data:{target:"pixel_values", targetType:"pixel_values", loss:"none", units:12}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"4",output:"output_1"}]}}, outputs:{}, pos_x:400, pos_y:0 },
  } } } };
  MBC.buildModelFromGraph(tf, bootstrap, {
    mode: "direct", featureSize: 12, windowSize: 1, seqFeatureSize: 12,
    allowedOutputKeys: [{ key: "pixel_values", featureSize: 12, shape: [2,3,2] }],
    defaultTarget: "pixel_values", numClasses: 0,
  });
  var classMap = tf.serialization.SerializationMap.getMap().classNameMap;
  var ImgLayer = classMap["AugmentImageLayer"][0];
  var BboxLayer = classMap["AugmentBboxLayer"][0];
  var MaskLayer = classMap["AugmentMaskLayer"][0];

  // Test 1: both transforms enabled in one block → output varies per call
  console.log("Test 1: augment_image with hflipProb=1, vflipProb=1 → always both flipped");
  var probe = tf.tensor4d([
    [[[1,0],[2,0],[3,0]], [[4,0],[5,0],[6,0]]]
  ]);  // [B=1, H=2, W=3, C=2]
  var bothLayer = new ImgLayer({ hflipProb: 1.0, vflipProb: 1.0, layout: "nhwc" });
  var out = bothLayer.apply(probe, { training: true });
  var arr = out.arraySync()[0];
  // Original: H=0 row [1,2,3], H=1 row [4,5,6]
  // After hflip+vflip: H=0 row [6,5,4], H=1 row [3,2,1]
  if (arr[0][0][0] !== 6) fail("both flips: expected arr[0][0][0]=6, got " + arr[0][0][0]);
  if (arr[1][2][0] !== 1) fail("both flips: expected arr[1][2][0]=1, got " + arr[1][2][0]);
  out.dispose();
  console.log("  ✓ both transforms compose (output reflects hflip ∘ vflip)");

  // Test 2: paired image+bbox with shared seedLink — both transforms must align
  console.log("Test 2: paired image+bbox, hflipProb=0.5 vflipProb=0.5, 200 trials → 0 disagreements");
  var img = new ImgLayer({ hflipProb: 0.5, vflipProb: 0.5, seedLink: "multi", layout: "nhwc" });
  var bbox = new BboxLayer({ hflipProb: 0.5, vflipProb: 0.5, seedLink: "multi", format: "x0y0x1y1", imageWidth: 100, imageHeight: 100 });
  // Image [B=1, H=2, W=3, C=1] with W distinguishable + H distinguishable
  var img4d = tf.tensor4d([
    [[[10],[20],[30]], [[40],[50],[60]]]
  ]);
  var bb = tf.tensor2d([[10, 20, 30, 40]]);  // x0y0x1y1
  var disagreements = 0;
  var anyFlipped = 0;
  for (var k = 0; k < 200; k++) {
    var yi = img.apply(img4d, { training: true });
    var yb = bbox.apply(bb, { training: true });
    var ia = yi.arraySync()[0];
    var ba = yb.arraySync()[0];
    // Did image hflip? W=0,H=0 should become 30 (was 10).
    var img_h = (ia[0][0][0] !== 10);
    // Did image vflip? H=0,W=0 — if vflip and not hflip, should be 40 (was 10).
    // To probe vflip: pick a cell where hflip alone wouldn't change the H index.
    // After hflip ∘ vflip, ia[0][0][0] could be 60 (both), 30 (hflip only),
    // 40 (vflip only), or 10 (neither).
    var probe00 = ia[0][0][0];
    var img_v;
    if (probe00 === 60) { img_h = true; img_v = true; }
    else if (probe00 === 30) { img_h = true; img_v = false; }
    else if (probe00 === 40) { img_h = false; img_v = true; }
    else if (probe00 === 10) { img_h = false; img_v = false; }
    else { fail("unexpected image pixel: " + probe00); break; }
    // Did bbox hflip? x0 should become 100-30=70 if hflip.
    var bb_h = Math.abs(ba[0] - 70) < 1e-3;
    var bb_v;
    if (bb_h) bb_v = Math.abs(ba[3] - (100 - 20)) < 1e-3; // y1 = H - y0_orig = 80 if vflip after hflip
    else      bb_v = Math.abs(ba[3] - (100 - 20)) < 1e-3;
    if (img_h !== bb_h) disagreements++;
    if (img_v !== bb_v) disagreements++;
    if (img_h || img_v) anyFlipped++;
    yi.dispose(); yb.dispose();
  }
  console.log("  flips: " + anyFlipped + "/200, disagreements: " + disagreements);
  if (disagreements > 0) fail("paired layers disagreed " + disagreements + " times");
  if (anyFlipped < 100 || anyFlipped > 195) fail("flip rate suspicious: " + anyFlipped + "/200 (expect ~150 with two p=0.5 transforms)");
  img4d.dispose(); bb.dispose();

  // Test 3: paired image+mask, all-disabled (hflipProb=vflipProb=0) → identity
  console.log("Test 3: hflipProb=0, vflipProb=0 → identity passthrough");
  var imgZero = new ImgLayer({ hflipProb: 0, vflipProb: 0, seedLink: "", layout: "nhwc" });
  var probe2 = tf.tensor4d([[[[7]]]]);
  var yz = imgZero.apply(probe2, { training: true });
  if (yz.arraySync()[0][0][0][0] !== 7) fail("disabled augment should be identity");
  yz.dispose(); probe2.dispose();
  console.log("  ✓ all-zero probs = passthrough");

  // Test 4: Layer 3 validation — divergent probs on shared seedLink throws
  console.log("Test 4: paired blocks with mismatched probs must throw (Layer 3)");
  var divergentGraph = { drawflow: { Home: { data: {
    "1": { id:1, name:"image_source_layer", data:{ sourceKey:"pixel_values", featureSize:16, imageShape:[4,4,1] }, class:"image_source_layer", html:"", typenode:false, inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "2": { id:2, name:"reshape_layer", data:{ targetShape:"4,4,1" }, class:"reshape_layer", html:"", typenode:false, inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "3": { id:3, name:"augment_image_layer", data:{ hflipProb:0.5, vflipProb:0, seedLink:"shared", layout:"nhwc" }, class:"augment_image_layer", html:"", typenode:false, inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"4", input:"input_1" }] } }, pos_x:200, pos_y:0 },
    "4": { id:4, name:"flatten_layer", data:{}, class:"flatten_layer", html:"", typenode:false, inputs:{ input_1:{ connections:[{ node:"3", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"5", input:"input_1" }] } }, pos_x:300, pos_y:0 },
    "5": { id:5, name:"output_layer", data:{ target:"bbox", targetType:"bbox", loss:"mse", units:4, headType:"regression" }, class:"output_layer", html:"", typenode:false, inputs:{ input_1:{ connections:[{ node:"4", output:"output_1" }] }, input_2:{ connections:[{ node:"7", output:"output_1" }] } }, outputs:{}, pos_x:400, pos_y:0 },
    "6": { id:6, name:"target_source_layer", data:{ targetKey:"bbox", featureSize:4 }, class:"target_source_layer", html:"", typenode:false, inputs:{}, outputs:{ output_1:{ connections:[{ node:"7", input:"input_1" }] } }, pos_x:200, pos_y:200 },
    "7": { id:7, name:"augment_bbox_layer", data:{ hflipProb:1.0, vflipProb:0, seedLink:"shared", format:"x0y0x1y1", imageWidth:1, imageHeight:1 }, class:"augment_bbox_layer", html:"", typenode:false, inputs:{ input_1:{ connections:[{ node:"6", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"5", input:"input_2" }] } }, pos_x:300, pos_y:200 },
  } } } };
  var threw = false;
  try {
    MBC.buildModelFromGraph(tf, divergentGraph, {
      mode: "direct", featureSize: 16, imageShape: [4, 4, 1],
      allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
      defaultTarget: "bbox", numClasses: 1, targetSize: 4,
    });
  } catch (e) {
    threw = true;
    if (!/seedLink.*shared|divergent/i.test(String(e.message))) {
      fail("threw, but message doesn't mention seedLink/divergent: " + e.message.slice(0, 200));
    } else {
      console.log("  ✓ threw on divergent paired config: " + e.message.slice(0, 100));
    }
  }
  if (!threw) fail("Layer 3 didn't throw on divergent probs across paired blocks");

  // Test 5: same probs on shared seedLink → builds OK
  console.log("Test 5: paired blocks with matching probs build cleanly (positive control)");
  var goodGraph = JSON.parse(JSON.stringify(divergentGraph));
  goodGraph.drawflow.Home.data["7"].data.hflipProb = 0.5;
  try {
    MBC.buildModelFromGraph(tf, goodGraph, {
      mode: "direct", featureSize: 16, imageShape: [4, 4, 1],
      allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
      defaultTarget: "bbox", numClasses: 1, targetSize: 4,
    });
    console.log("  ✓ matching paired probs build cleanly");
  } catch (e) {
    fail("matching paired probs should build but threw: " + e.message.slice(0, 200));
  }

  // Test 6: layout="auto" round-trips and resolves to NHWC behavior in browser
  // (#183 P2). TF.js reshape preserves NHWC unlike the PyTorch server's
  // reshape (which permutes to NCHW), so "auto" in browser is functionally
  // equivalent to "nhwc" — but the stored config value must be "auto" so
  // server-side auto-detect still works when the same graph trains there.
  console.log("Test 6: layout=\"auto\" stays as \"auto\" in config and uses NHWC axes in TF.js");
  var autoLayer = new ImgLayer({ hflipProb: 1.0, vflipProb: 0, layout: "auto" });
  if (autoLayer.layout !== "auto") fail("layout=\"auto\" should round-trip as \"auto\", got " + autoLayer.layout);
  var autoProbe = tf.tensor4d([[[[1],[2],[3]],[[4],[5],[6]]]]);  // [B=1, H=2, W=3, C=1]
  var autoOut = autoLayer.apply(autoProbe, { training: true });
  var autoArr = autoOut.arraySync()[0];
  // Under NHWC axes hflip reverses W, so [0][0][0] should become 3 (was 1).
  if (autoArr[0][0][0] !== 3) fail("layout=\"auto\" should use NHWC axes in browser (hflip on W); got " + autoArr[0][0][0]);
  autoProbe.dispose(); autoOut.dispose();
  console.log("  ✓ layout=\"auto\" round-trips and resolves to NHWC in browser");

  if (ok) console.log("\nPASS: multi-transform per block + Layer 3 sync validation.");
  else { console.error("\nFAIL: at least one assertion failed."); process.exit(1); }
})().catch(function (e) { console.error(e && e.stack ? e.stack : e); process.exit(1); });

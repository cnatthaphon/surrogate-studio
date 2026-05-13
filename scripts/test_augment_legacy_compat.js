"use strict";
// #184 P2 regression: saved/exported graphs predating PR #79 still carry
// the legacy { transform, probability } field shape on augment nodes.
// They bypass the editor factory and hit the JS builder directly.
//
// Reviewer reproduced: a legacy graph node { transform: "horizontal_flip",
// probability: 1 } produced layer config hflipProb=0, vflipProb=0 — silent
// no-op augment. This test wires raw legacy graph data through
// buildModelFromGraph + applies the resulting layer with training=true and
// verifies a flip actually happens.
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
  function fail(m) { console.error("  FAIL: " + m); ok = false; }

  // Test 1: legacy { transform: "horizontal_flip", probability: 1 } → hflip ALWAYS happens
  console.log("Test 1: legacy {transform:'horizontal_flip', probability:1} → layer flips reliably");
  var legacyHflip = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer", data:{mode:"image", featureSize:6, imageShape:[2,3,1]}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"reshape_layer", data:{targetShape:"2,3,1"}, class:"reshape_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:100, pos_y:0 },
    "3": { id:3, name:"augment_image_layer", data:{ transform: "horizontal_flip", probability: 1, seedLink: "", layout: "nhwc" }, class:"augment_image_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"4",input:"input_1"}]}}, pos_x:200, pos_y:0 },
    "4": { id:4, name:"flatten_layer", data:{}, class:"flatten_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"3",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"5",input:"input_1"}]}}, pos_x:300, pos_y:0 },
    "5": { id:5, name:"output_layer", data:{target:"pixel_values", targetType:"pixel_values", loss:"none", units:6}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"4",output:"output_1"}]}}, outputs:{}, pos_x:400, pos_y:0 },
  } } } };
  var built = MBC.buildModelFromGraph(tf, legacyHflip, {
    mode: "direct", featureSize: 6, windowSize: 1, seqFeatureSize: 6,
    allowedOutputKeys: [{ key: "pixel_values", featureSize: 6, shape: [2,3,1] }],
    defaultTarget: "pixel_values", numClasses: 0,
  });
  // Locate the AugmentImage layer and verify cfg was migrated.
  var augLayer = null;
  built.model.layers.forEach(function (l) {
    if (l.getClassName && l.getClassName() === "AugmentImageLayer") augLayer = l;
  });
  if (!augLayer) { fail("AugmentImageLayer not found in built model"); process.exit(1); }
  if (augLayer.hflipProb !== 1) fail("legacy hflip should map to hflipProb=1, got " + augLayer.hflipProb);
  if (augLayer.vflipProb !== 0) fail("legacy hflip should leave vflipProb=0, got " + augLayer.vflipProb);

  // Forward with training=true on a probe and verify the actual flip behavior.
  // [B=1, H=2, W=3, C=1], distinct W values so flip is detectable.
  var probe = tf.tensor4d([[[[1],[2],[3]],[[4],[5],[6]]]]);
  var flipsSeen = 0;
  for (var k = 0; k < 5; k++) {
    var out = augLayer.apply(probe, { training: true });
    var arr = out.arraySync()[0];
    // After hflip (axis -2 on NHWC, which is W) cell W=0 should become 3 (was 1).
    if (arr[0][0][0] === 3) flipsSeen++;
    out.dispose();
  }
  if (flipsSeen !== 5) fail("legacy hflip with prob=1 should flip on every call, got " + flipsSeen + "/5");
  probe.dispose();
  console.log("  ✓ legacy hflip with prob=1 → 5/5 flips at runtime (was 0/5 pre-fix)");

  // Test 2: legacy { transform: "vertical_flip", probability: 1 } → vflip works
  console.log("Test 2: legacy {transform:'vertical_flip', probability:1} → vflip reliably");
  var legacyVflip = JSON.parse(JSON.stringify(legacyHflip));
  legacyVflip.drawflow.Home.data["3"].data = { transform: "vertical_flip", probability: 1, seedLink: "", layout: "nhwc" };
  var built2 = MBC.buildModelFromGraph(tf, legacyVflip, {
    mode: "direct", featureSize: 6, windowSize: 1, seqFeatureSize: 6,
    allowedOutputKeys: [{ key: "pixel_values", featureSize: 6, shape: [2,3,1] }],
    defaultTarget: "pixel_values", numClasses: 0,
  });
  var augLayer2 = null;
  built2.model.layers.forEach(function (l) { if (l.getClassName && l.getClassName() === "AugmentImageLayer") augLayer2 = l; });
  if (augLayer2.hflipProb !== 0) fail("legacy vflip should leave hflipProb=0");
  if (augLayer2.vflipProb !== 1) fail("legacy vflip should map to vflipProb=1");
  var probe2 = tf.tensor4d([[[[1],[2],[3]],[[4],[5],[6]]]]);
  var out2 = augLayer2.apply(probe2, { training: true });
  var arr2 = out2.arraySync()[0];
  // vflip on NHWC reverses axis -3 (H). After vflip, H=0,W=0 should be 4 (was 1).
  if (arr2[0][0][0] !== 4) fail("legacy vflip should swap H rows; arr[0][0][0]=" + arr2[0][0][0] + " (expected 4)");
  probe2.dispose(); out2.dispose();
  console.log("  ✓ legacy vflip with prob=1 → H rows swapped");

  // Test 3: legacy bbox { transform: "horizontal_flip", probability: 1 } → bbox flips
  console.log("Test 3: legacy augment_bbox {transform:'horizontal_flip', probability:1} → bbox flips");
  var legacyBbox = { drawflow: { Home: { data: {
    "1": { id:1, name:"target_source_layer", data:{ targetKey:"bbox", featureSize:4 }, class:"target_source_layer", html:"", typenode:false, inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "2": { id:2, name:"augment_bbox_layer", data:{ transform: "horizontal_flip", probability: 1, seedLink: "", format: "x0y0x1y1", imageWidth: 100, imageHeight: 100 }, class:"augment_bbox_layer", html:"", typenode:false, inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "3": { id:3, name:"output_layer", data:{ target:"bbox", targetType:"bbox", loss:"mse", units:4, headType:"regression" }, class:"output_layer", html:"", typenode:false, inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{}, pos_x:200, pos_y:0 },
  } } } };
  var built3 = MBC.buildModelFromGraph(tf, legacyBbox, {
    mode: "direct", featureSize: 4,
    allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
    defaultTarget: "bbox", numClasses: 1, targetSize: 4,
  });
  var bboxLayer = null;
  built3.model.layers.forEach(function (l) { if (l.getClassName && l.getClassName() === "AugmentBboxLayer") bboxLayer = l; });
  if (bboxLayer.hflipProb !== 1) fail("legacy bbox hflip should set hflipProb=1, got " + bboxLayer.hflipProb);
  if (bboxLayer.vflipProb !== 0) fail("legacy bbox should leave vflipProb=0");
  var probeBbox = tf.tensor2d([[10, 20, 30, 40]]);  // x0y0x1y1
  var outBbox = bboxLayer.apply(probeBbox, { training: true });
  var ba = outBbox.arraySync()[0];
  // hflip about W=100: x0=100-30=70, x1=100-10=90
  if (Math.abs(ba[0] - 70) > 1e-3) fail("legacy bbox hflip: expected x0=70, got " + ba[0]);
  if (Math.abs(ba[2] - 90) > 1e-3) fail("legacy bbox hflip: expected x1=90, got " + ba[2]);
  probeBbox.dispose(); outBbox.dispose();
  console.log("  ✓ legacy bbox hflip math correct: [10,20,30,40] → [70,20,90,40]");

  // Test 4: identity / unrecognized → both probs 0 (safe passthrough)
  console.log("Test 4: legacy {transform:'identity', probability:1} → both probs 0 (passthrough)");
  var legacyId = JSON.parse(JSON.stringify(legacyHflip));
  legacyId.drawflow.Home.data["3"].data = { transform: "identity", probability: 1, seedLink: "", layout: "nhwc" };
  var built4 = MBC.buildModelFromGraph(tf, legacyId, {
    mode: "direct", featureSize: 6, windowSize: 1, seqFeatureSize: 6,
    allowedOutputKeys: [{ key: "pixel_values", featureSize: 6, shape: [2,3,1] }],
    defaultTarget: "pixel_values", numClasses: 0,
  });
  var augLayer4 = null;
  built4.model.layers.forEach(function (l) { if (l.getClassName && l.getClassName() === "AugmentImageLayer") augLayer4 = l; });
  if (augLayer4.hflipProb !== 0 || augLayer4.vflipProb !== 0) fail("legacy identity should map to both probs = 0");
  console.log("  ✓ legacy identity maps to {hflipProb:0, vflipProb:0}");

  // Test 5: new shape still works (positive control — no regression)
  console.log("Test 5: new {hflipProb:0.5, vflipProb:0.5} still resolves correctly");
  var newShape = JSON.parse(JSON.stringify(legacyHflip));
  newShape.drawflow.Home.data["3"].data = { hflipProb: 0.5, vflipProb: 0.5, seedLink: "", layout: "nhwc" };
  var built5 = MBC.buildModelFromGraph(tf, newShape, {
    mode: "direct", featureSize: 6, windowSize: 1, seqFeatureSize: 6,
    allowedOutputKeys: [{ key: "pixel_values", featureSize: 6, shape: [2,3,1] }],
    defaultTarget: "pixel_values", numClasses: 0,
  });
  var augLayer5 = null;
  built5.model.layers.forEach(function (l) { if (l.getClassName && l.getClassName() === "AugmentImageLayer") augLayer5 = l; });
  if (augLayer5.hflipProb !== 0.5) fail("new shape: hflipProb should be 0.5, got " + augLayer5.hflipProb);
  if (augLayer5.vflipProb !== 0.5) fail("new shape: vflipProb should be 0.5, got " + augLayer5.vflipProb);
  console.log("  ✓ new shape unchanged behavior");

  if (ok) console.log("\nPASS: builder accepts legacy {transform,probability} and maps to hflipProb/vflipProb.");
  else { console.error("\nFAIL: at least one assertion failed."); process.exit(1); }
})().catch(function (e) { console.error(e && e.stack ? e.stack : e); process.exit(1); });

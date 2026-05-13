"use strict";
// #172 Layer 2: graph-walk type validation. Each augment node must trace
// upstream to a source whose declared type matches what the block expects:
//   - augment_image / augment_mask: must NOT trace back to target_source
//   - augment_bbox:                  MUST trace back ONLY to target_source
//   - augment_label:                 permissive (passthrough)
// Layer 1 (shape validation) catches plain shape mismatches; Layer 2
// catches semantic mistakes where shapes happen to align but the data
// kind is wrong (e.g. a target tensor wired into augment_image).
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

  function expectThrow(label, fn, pattern) {
    try { fn(); fail(label + " — expected throw, got success"); }
    catch (e) {
      var m = String(e && e.message || e);
      if (pattern && !pattern.test(m)) fail(label + " — message didn't match " + pattern + ": " + m.slice(0, 200));
      else console.log("  ✓ " + label + " threw: " + m.slice(0, 110));
    }
  }
  function expectOk(label, fn) {
    try { fn(); console.log("  ✓ " + label); }
    catch (e) { fail(label + " — threw unexpectedly: " + (e && e.message || e).slice(0, 200)); }
  }

  // Test 1: augment_bbox wired to target_source → builds OK
  console.log("Test 1: augment_bbox after target_source builds cleanly (the canonical pattern)");
  var goodBbox = { drawflow: { Home: { data: {
    "1": { id:1, name:"target_source_layer", data:{ targetKey:"bbox", featureSize:4 }, class:"target_source_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "2": { id:2, name:"augment_bbox_layer", data:{ transform:"horizontal_flip", probability:0.5, seedLink:"", format:"x0y0x1y1", imageWidth:1, imageHeight:1 }, class:"augment_bbox_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "3": { id:3, name:"output_layer", data:{ target:"bbox", targetType:"bbox", loss:"mse", units:4, headType:"regression" }, class:"output_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{}, pos_x:200, pos_y:0 },
  } } } };
  expectOk("augment_bbox <- target_source", function () {
    MBC.buildModelFromGraph(tf, goodBbox, {
      mode: "direct", featureSize: 4, allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
      defaultTarget: "bbox", numClasses: 1, targetSize: 4,
    });
  });

  // Test 2: augment_bbox wired to image_source → throws (root is image, not target)
  console.log("Test 2: augment_bbox after image_source must throw (wrong upstream type)");
  var badBbox = { drawflow: { Home: { data: {
    "1": { id:1, name:"image_source_layer", data:{ sourceKey:"pixel_values", featureSize:4, imageShape:[1,1,4] }, class:"image_source_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "2": { id:2, name:"augment_bbox_layer", data:{ transform:"horizontal_flip", probability:0.5, seedLink:"", format:"x0y0x1y1", imageWidth:1, imageHeight:1 }, class:"augment_bbox_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "3": { id:3, name:"output_layer", data:{ target:"bbox", targetType:"bbox", loss:"mse", units:4, headType:"regression" }, class:"output_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{}, pos_x:200, pos_y:0 },
  } } } };
  expectThrow("augment_bbox <- image_source", function () {
    MBC.buildModelFromGraph(tf, badBbox, {
      mode: "direct", featureSize: 4, imageShape: [1, 1, 4],
      allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
      defaultTarget: "bbox", numClasses: 1, targetSize: 4,
    });
  }, /augment_bbox.*target_source|target_source.*augment_bbox/);

  // Test 3: augment_image wired to target_source → throws
  console.log("Test 3: augment_image after target_source must throw (wrong upstream type)");
  // Build a target_source that emits a rank-4 tensor (using featureSize=4, then
  // reshape to [1,1,4]). The shape would actually be rank-2 [B,4] not rank-4,
  // so Layer 1 shape check would catch this BEFORE Layer 2. To test Layer 2 in
  // isolation we'd need a multi-dim target_source. Set targetShape=[2,2,1].
  var badImg = { drawflow: { Home: { data: {
    "1": { id:1, name:"target_source_layer", data:{ targetKey:"mask", featureSize:4, targetShape:[2,2,1] }, class:"target_source_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "2": { id:2, name:"reshape_layer", data:{ targetShape:"2,2,1" }, class:"reshape_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "3": { id:3, name:"augment_image_layer", data:{ transform:"horizontal_flip", probability:0.5, seedLink:"", layout:"nhwc" }, class:"augment_image_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"4", input:"input_1" }] } }, pos_x:200, pos_y:0 },
    "4": { id:4, name:"output_layer", data:{ target:"mask", targetType:"mask", loss:"mse", units:4, headType:"regression" }, class:"output_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"3", output:"output_1" }] } }, outputs:{}, pos_x:300, pos_y:0 },
  } } } };
  expectThrow("augment_image <- target_source", function () {
    MBC.buildModelFromGraph(tf, badImg, {
      mode: "direct", featureSize: 4, imageShape: [2, 2, 1],
      allowedOutputKeys: [{ key: "mask", featureSize: 4, headType: "regression" }],
      defaultTarget: "mask", numClasses: 1, targetSize: 4,
    });
  }, /augment_image.*target_source|image data/);

  // Test 4: augment_image after image_source/reshape → OK (the SAR-Ship pattern)
  console.log("Test 4: augment_image after image_source -> reshape builds cleanly");
  var goodImg = { drawflow: { Home: { data: {
    "1": { id:1, name:"image_source_layer", data:{ sourceKey:"pixel_values", featureSize:16, imageShape:[4,4,1] }, class:"image_source_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "2": { id:2, name:"reshape_layer", data:{ targetShape:"4,4,1" }, class:"reshape_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "3": { id:3, name:"augment_image_layer", data:{ transform:"horizontal_flip", probability:0.5, seedLink:"", layout:"nhwc" }, class:"augment_image_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"4", input:"input_1" }] } }, pos_x:200, pos_y:0 },
    "4": { id:4, name:"flatten_layer", data:{}, class:"flatten_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"3", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"5", input:"input_1" }] } }, pos_x:300, pos_y:0 },
    "5": { id:5, name:"output_layer", data:{ target:"x", targetType:"x", loss:"mse", units:16, headType:"regression" }, class:"output_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"4", output:"output_1" }] } }, outputs:{}, pos_x:400, pos_y:0 },
  } } } };
  expectOk("augment_image <- image_source -> reshape", function () {
    MBC.buildModelFromGraph(tf, goodImg, {
      mode: "direct", featureSize: 16, imageShape: [4, 4, 1],
      allowedOutputKeys: [{ key: "x", featureSize: 16, headType: "regression" }],
      defaultTarget: "x", numClasses: 1, targetSize: 16,
    });
  });

  // Test 5: augment_mask must accept target_source upstream (segmentation pattern)
  // This is the #175 regression: a segmentation graph like
  //   target_source(targetKey="mask") -> augment_mask -> output.input_2
  // is legitimate (the mask label being augmented in lockstep with the image
  // via seedLink). Lineage check must NOT reject target_source for augment_mask.
  console.log("Test 5: augment_mask after target_source builds cleanly (#175 P1 regression)");
  var goodMaskFromTarget = { drawflow: { Home: { data: {
    "1": { id:1, name:"target_source_layer", data:{ targetKey:"mask", featureSize:16, targetShape:[4,4,1] }, class:"target_source_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "2": { id:2, name:"augment_mask_layer", data:{ transform:"horizontal_flip", probability:0.5, seedLink:"", layout:"nhwc" }, class:"augment_mask_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "3": { id:3, name:"output_layer", data:{ target:"mask", targetType:"mask", loss:"mse", units:16, headType:"regression" }, class:"output_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{}, pos_x:200, pos_y:0 },
  } } } };
  expectOk("augment_mask <- target_source(targetKey='mask')", function () {
    MBC.buildModelFromGraph(tf, goodMaskFromTarget, {
      mode: "direct", featureSize: 16, imageShape: [4, 4, 1],
      allowedOutputKeys: [{ key: "mask", featureSize: 16, headType: "regression" }],
      defaultTarget: "mask", numClasses: 1, targetSize: 16,
    });
  });

  // Test 6: augment_mask also accepts image_source upstream (paired with augment_image)
  console.log("Test 6: augment_mask after image_source -> reshape builds cleanly (paired image+mask)");
  var goodMaskFromImg = { drawflow: { Home: { data: {
    "1": { id:1, name:"image_source_layer", data:{ sourceKey:"pixel_values", featureSize:16, imageShape:[4,4,1] }, class:"image_source_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "2": { id:2, name:"reshape_layer", data:{ targetShape:"4,4,1" }, class:"reshape_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "3": { id:3, name:"augment_mask_layer", data:{ transform:"horizontal_flip", probability:0.5, seedLink:"", layout:"nhwc" }, class:"augment_mask_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"4", input:"input_1" }] } }, pos_x:200, pos_y:0 },
    "4": { id:4, name:"flatten_layer", data:{}, class:"flatten_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"3", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"5", input:"input_1" }] } }, pos_x:300, pos_y:0 },
    "5": { id:5, name:"output_layer", data:{ target:"mask", targetType:"mask", loss:"mse", units:16, headType:"regression" }, class:"output_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"4", output:"output_1" }] } }, outputs:{}, pos_x:400, pos_y:0 },
  } } } };
  expectOk("augment_mask <- image_source -> reshape", function () {
    MBC.buildModelFromGraph(tf, goodMaskFromImg, {
      mode: "direct", featureSize: 16, imageShape: [4, 4, 1],
      allowedOutputKeys: [{ key: "mask", featureSize: 16, headType: "regression" }],
      defaultTarget: "mask", numClasses: 1, targetSize: 16,
    });
  });

  // #176 (P1 from PR #76 round-2): feature-block parents on a source must
  // NOT shadow the actual source in the lineage walk. The reviewer reproduced:
  //   - VALID params_layer -> target_source -> augment_bbox was rejected
  //     (walker reported params_layer as root instead of target_source)
  //   - INVALID params_layer -> target_source -> augment_image was allowed
  //     (root != target_source vacuously passed the reject-target rule)
  // Fix: stop the walk at declared input/source node names regardless of
  // feature-block parents, mirroring input-detection logic.
  console.log("Test 7a: params_layer -> target_source -> augment_bbox builds cleanly (#176)");
  var paramsBbox = { drawflow: { Home: { data: {
    "1": { id:1, name:"params_layer", data:{ paramKeys:["m","k","c"] }, class:"params_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:-100 },
    "2": { id:2, name:"target_source_layer", data:{ targetKey:"bbox", featureSize:4 }, class:"target_source_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "3": { id:3, name:"augment_bbox_layer", data:{ transform:"horizontal_flip", probability:0.5, seedLink:"", format:"x0y0x1y1", imageWidth:1, imageHeight:1 }, class:"augment_bbox_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"4", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "4": { id:4, name:"output_layer", data:{ target:"bbox", targetType:"bbox", loss:"mse", units:4, headType:"regression" }, class:"output_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"3", output:"output_1" }] } }, outputs:{}, pos_x:200, pos_y:0 },
  } } } };
  expectOk("params_layer -> target_source -> augment_bbox", function () {
    MBC.buildModelFromGraph(tf, paramsBbox, {
      mode: "direct", featureSize: 4,
      allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
      defaultTarget: "bbox", numClasses: 1, targetSize: 4,
    });
  });

  console.log("Test 7b: params_layer -> target_source -> augment_image must STILL throw (#176)");
  var paramsImg = { drawflow: { Home: { data: {
    "1": { id:1, name:"params_layer", data:{ paramKeys:["m","k","c"] }, class:"params_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:-100 },
    "2": { id:2, name:"target_source_layer", data:{ targetKey:"mask", featureSize:4, targetShape:[2,2,1] }, class:"target_source_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "3": { id:3, name:"reshape_layer", data:{ targetShape:"2,2,1" }, class:"reshape_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"4", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "4": { id:4, name:"augment_image_layer", data:{ transform:"horizontal_flip", probability:0.5, seedLink:"", layout:"nhwc" }, class:"augment_image_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"3", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"5", input:"input_1" }] } }, pos_x:200, pos_y:0 },
    "5": { id:5, name:"output_layer", data:{ target:"mask", targetType:"mask", loss:"mse", units:4, headType:"regression" }, class:"output_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"4", output:"output_1" }] } }, outputs:{}, pos_x:300, pos_y:0 },
  } } } };
  expectThrow("params_layer -> target_source -> augment_image", function () {
    MBC.buildModelFromGraph(tf, paramsImg, {
      mode: "direct", featureSize: 4, imageShape: [2, 2, 1],
      allowedOutputKeys: [{ key: "mask", featureSize: 4, headType: "regression" }],
      defaultTarget: "mask", numClasses: 1, targetSize: 4,
    });
  }, /augment_image.*target_source|image data/);

  // #177 (P1 from PR #76 round-3): a declared source with a REAL tensor
  // parent (not feature-metadata) must NOT terminate the walk. The
  // reviewer reproduced two bypasses where target_source acted as a
  // passthrough for image-side data and incorrectly satisfied the
  // bbox-needs-target-root rule:
  //   - image_source -> target_source -> augment_bbox built OK (should reject)
  //   - input_layer  -> target_source -> augment_bbox built OK (should reject)
  console.log("Test 8a: image_source -> target_source -> augment_bbox must THROW (#177)");
  var imgPassthroughBbox = { drawflow: { Home: { data: {
    "1": { id:1, name:"image_source_layer", data:{ sourceKey:"pixel_values", featureSize:4, imageShape:[1,1,4] }, class:"image_source_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "2": { id:2, name:"target_source_layer", data:{ targetKey:"bbox", featureSize:4 }, class:"target_source_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "3": { id:3, name:"augment_bbox_layer", data:{ transform:"horizontal_flip", probability:0.5, seedLink:"", format:"x0y0x1y1", imageWidth:1, imageHeight:1 }, class:"augment_bbox_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"4", input:"input_1" }] } }, pos_x:200, pos_y:0 },
    "4": { id:4, name:"output_layer", data:{ target:"bbox", targetType:"bbox", loss:"mse", units:4, headType:"regression" }, class:"output_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"3", output:"output_1" }] } }, outputs:{}, pos_x:300, pos_y:0 },
  } } } };
  expectThrow("image_source -> target_source -> augment_bbox", function () {
    MBC.buildModelFromGraph(tf, imgPassthroughBbox, {
      mode: "direct", featureSize: 4, imageShape: [1, 1, 4],
      allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
      defaultTarget: "bbox", numClasses: 1, targetSize: 4,
    });
  }, /augment_bbox.*target_source|image_source/);

  console.log("Test 8b: input_layer -> target_source -> augment_bbox must THROW (#177)");
  var inputPassthroughBbox = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer", data:{ mode:"flat", featureSize:4 }, class:"input_layer", html:"", typenode:false,
           inputs:{}, outputs:{ output_1:{ connections:[{ node:"2", input:"input_1" }] } }, pos_x:0, pos_y:0 },
    "2": { id:2, name:"target_source_layer", data:{ targetKey:"bbox", featureSize:4 }, class:"target_source_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"1", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"3", input:"input_1" }] } }, pos_x:100, pos_y:0 },
    "3": { id:3, name:"augment_bbox_layer", data:{ transform:"horizontal_flip", probability:0.5, seedLink:"", format:"x0y0x1y1", imageWidth:1, imageHeight:1 }, class:"augment_bbox_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"2", output:"output_1" }] } }, outputs:{ output_1:{ connections:[{ node:"4", input:"input_1" }] } }, pos_x:200, pos_y:0 },
    "4": { id:4, name:"output_layer", data:{ target:"bbox", targetType:"bbox", loss:"mse", units:4, headType:"regression" }, class:"output_layer", html:"", typenode:false,
           inputs:{ input_1:{ connections:[{ node:"3", output:"output_1" }] } }, outputs:{}, pos_x:300, pos_y:0 },
  } } } };
  expectThrow("input_layer -> target_source -> augment_bbox", function () {
    MBC.buildModelFromGraph(tf, inputPassthroughBbox, {
      mode: "direct", featureSize: 4,
      allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
      defaultTarget: "bbox", numClasses: 1, targetSize: 4,
    });
  }, /augment_bbox.*target_source|input_layer/);

  // Test 7: full SAR-Ship aug graph (image + target_source branches) still builds
  console.log("Test 7: full SAR-Ship aug graph still builds (regression)");
  require(path.join(__dirname, "..", "demo/SAR-Ship-Detection/preset.js"));
  var preset = global.SAR_SHIP_DETECTION_PRESET;
  var augModel = preset.models.filter(function (m) { return m.id === "sar_cnn_aug"; })[0];
  expectOk("sar_cnn_aug preset graph", function () {
    MBC.buildModelFromGraph(tf, augModel.graph, {
      mode: "direct", featureSize: 64 * 64, imageShape: [64, 64, 1],
      allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }],
      defaultTarget: "bbox", numClasses: 1, targetSize: 4,
    });
  });

  if (ok) console.log("\nPASS: Layer 2 type-lineage check fires on cross-type wiring and stays out of the way for valid graphs.");
  else { console.error("\nFAIL"); process.exit(1); }
})().catch(function (e) { console.error(e && e.stack ? e.stack : e); process.exit(1); });

"use strict";
// #147 Layer 1: hard shape validation. Each augment block must throw at
// build time when wired to a tensor of the wrong rank/last-dim, instead
// of silently passing through. Silent passthrough hides wiring bugs and
// produces un-augmented training that looks healthy. Mirrors the same
// validation on the PyTorch server (raises RuntimeError).
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
  var fail = function (msg) { console.error("  FAIL: " + msg); ok = false; };

  function expectThrow(label, fn, msgPattern) {
    try {
      fn();
      fail(label + " — expected throw, got success");
    } catch (e) {
      var m = String(e && e.message || e);
      if (msgPattern && !msgPattern.test(m)) {
        fail(label + " — threw but message doesn't match pattern " + msgPattern + ": " + m.slice(0, 200));
      } else {
        console.log("  ✓ " + label + " threw: " + m.slice(0, 100));
      }
    }
  }

  // -- Test 1: augment_image wired to non-4D tensor → throw --
  console.log("Test 1: augment_image rejects non-4D upstream");
  var graph1 = { drawflow: { Home: { data: {
    "1": { id: 1, name: "input_layer", data: { mode: "flat", featureSize: 16 }, class: "input_layer", html: "", typenode: false, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } }, pos_x: 0, pos_y: 0 },
    "2": { id: 2, name: "augment_image_layer", data: { transform: "horizontal_flip", probability: 0.5, seedLink: "", layout: "nhwc" }, class: "augment_image_layer", html: "", typenode: false, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } }, pos_x: 100, pos_y: 0 },
    "3": { id: 3, name: "output_layer", data: { target: "x", targetType: "x", loss: "mse", units: 16, headType: "regression" }, class: "output_layer", html: "", typenode: false, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: {}, pos_x: 200, pos_y: 0 },
  } } } };
  expectThrow("augment_image on rank-2 input", function () {
    MBC.buildModelFromGraph(tf, graph1, { mode: "direct", featureSize: 16, allowedOutputKeys: [{ key: "x", featureSize: 16 }], defaultTarget: "x", numClasses: 1, targetSize: 16 });
  }, /augment_image.*4D|requires.*4D/);

  // -- Test 2: augment_bbox wired to non-bbox tensor → throw --
  console.log("Test 2: augment_bbox rejects last-dim != 4");
  var graph2 = { drawflow: { Home: { data: {
    "1": { id: 1, name: "input_layer", data: { mode: "flat", featureSize: 16 }, class: "input_layer", html: "", typenode: false, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } }, pos_x: 0, pos_y: 0 },
    "2": { id: 2, name: "augment_bbox_layer", data: { transform: "horizontal_flip", probability: 0.5, seedLink: "", format: "x0y0x1y1", imageWidth: 1, imageHeight: 1 }, class: "augment_bbox_layer", html: "", typenode: false, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } }, pos_x: 100, pos_y: 0 },
    "3": { id: 3, name: "output_layer", data: { target: "x", targetType: "x", loss: "mse", units: 16, headType: "regression" }, class: "output_layer", html: "", typenode: false, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: {}, pos_x: 200, pos_y: 0 },
  } } } };
  expectThrow("augment_bbox on featureSize=16", function () {
    MBC.buildModelFromGraph(tf, graph2, { mode: "direct", featureSize: 16, allowedOutputKeys: [{ key: "x", featureSize: 16 }], defaultTarget: "x", numClasses: 1, targetSize: 16 });
  }, /augment_bbox.*last dim = 4|augment_bbox.*4|2D \[B,4\]/);

  // -- Test 3: augment_mask wired to rank-2 → throw --
  console.log("Test 3: augment_mask rejects rank-2 input");
  var graph3 = { drawflow: { Home: { data: {
    "1": { id: 1, name: "input_layer", data: { mode: "flat", featureSize: 16 }, class: "input_layer", html: "", typenode: false, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } }, pos_x: 0, pos_y: 0 },
    "2": { id: 2, name: "augment_mask_layer", data: { transform: "horizontal_flip", probability: 0.5, seedLink: "", layout: "nhwc" }, class: "augment_mask_layer", html: "", typenode: false, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } }, pos_x: 100, pos_y: 0 },
    "3": { id: 3, name: "output_layer", data: { target: "x", targetType: "x", loss: "mse", units: 16, headType: "regression" }, class: "output_layer", html: "", typenode: false, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: {}, pos_x: 200, pos_y: 0 },
  } } } };
  expectThrow("augment_mask on rank-2", function () {
    MBC.buildModelFromGraph(tf, graph3, { mode: "direct", featureSize: 16, allowedOutputKeys: [{ key: "x", featureSize: 16 }], defaultTarget: "x", numClasses: 1, targetSize: 16 });
  }, /augment_mask.*3D|augment_mask.*4D|requires.*[34]D/);

  // -- Test 4: augment_image with correct 4D upstream → builds OK --
  console.log("Test 4: augment_image with 4D upstream builds successfully");
  var graph4 = { drawflow: { Home: { data: {
    "1": { id: 1, name: "image_source_layer", data: { sourceKey: "pixel_values", featureSize: 16, imageShape: [4, 4, 1] }, class: "image_source_layer", html: "", typenode: false, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } }, pos_x: 0, pos_y: 0 },
    "2": { id: 2, name: "reshape_layer", data: { targetShape: "4,4,1" }, class: "reshape_layer", html: "", typenode: false, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } }, pos_x: 100, pos_y: 0 },
    "3": { id: 3, name: "augment_image_layer", data: { transform: "horizontal_flip", probability: 0.5, seedLink: "", layout: "nhwc" }, class: "augment_image_layer", html: "", typenode: false, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "4", input: "input_1" }] } }, pos_x: 200, pos_y: 0 },
    "4": { id: 4, name: "flatten_layer", data: {}, class: "flatten_layer", html: "", typenode: false, inputs: { input_1: { connections: [{ node: "3", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "5", input: "input_1" }] } }, pos_x: 300, pos_y: 0 },
    "5": { id: 5, name: "output_layer", data: { target: "x", targetType: "x", loss: "mse", units: 16, headType: "regression" }, class: "output_layer", html: "", typenode: false, inputs: { input_1: { connections: [{ node: "4", output: "output_1" }] } }, outputs: {}, pos_x: 400, pos_y: 0 },
  } } } };
  try {
    var built = MBC.buildModelFromGraph(tf, graph4, { mode: "direct", featureSize: 16, imageShape: [4, 4, 1], allowedOutputKeys: [{ key: "x", featureSize: 16 }], defaultTarget: "x", numClasses: 1, targetSize: 16 });
    console.log("  ✓ correctly-wired image graph builds: outputs=" + built.model.outputs.length);
  } catch (e) {
    fail("correctly-wired image graph should build, but threw: " + (e && e.message || e));
  }

  // -- Test 5: palette default for layout is "auto" --
  console.log("Test 5: palette default for augment_image layout is 'auto'");
  var schemaSrc = require("fs").readFileSync(path.join(__dirname, "..", "src/schema_definitions_builtin.js"), "utf8");
  if (schemaSrc.indexOf('"augment_image", "AugmentImage", "Augment", { transform: "horizontal_flip", probability: 0.5, seedLink: "", layout: "auto"') < 0) {
    fail("schema_definitions_builtin.js: augment_image palette default should be layout: \"auto\"");
  } else {
    console.log("  ✓ augment_image palette default is layout=\"auto\"");
  }
  if (schemaSrc.indexOf('"augment_mask", "AugmentMask", "Augment", { transform: "horizontal_flip", probability: 0.5, seedLink: "", layout: "auto"') < 0) {
    fail("schema_definitions_builtin.js: augment_mask palette default should be layout: \"auto\"");
  } else {
    console.log("  ✓ augment_mask palette default is layout=\"auto\"");
  }

  if (ok) console.log("\nPASS: augment-block shape validation throws on wrong shape, builds on correct shape, palette defaults updated.");
  else { console.error("\nFAIL: at least one assertion failed."); process.exit(1); }
})().catch(function (e) { console.error(e); if (e && e.stack) console.error(e.stack); process.exit(1); });

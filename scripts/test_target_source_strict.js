"use strict";
// Regression test for the target_source node width resolution
// (post-#92 silent-fallback cleanup). Before, an unannotated
// target_source node defaulted to featureSize=4 (bbox-shaped) —
// fine for bbox/xyxy targets, wrong for mask/label/scalar.
//
// After: same strict-resolution order as targetUnitsFromMode:
//   1. explicit `featureSize` on the node
//   2. schema lookup via targetKey → allowedOutputKeys
//   3. datasetMeta.targetSize
//   4. throw

var path = require("path");
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
global.window = global;
var MBC = require(path.join(__dirname, "..", "src/model_builder_core.js"));

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

// Minimal graph: image_source → output (input branch) + target_source → output.input_2
// We only need the target_source to enter the build path; the rest can be
// stubbed via a simple direct wire.
function makeGraph(tgtNodeData) {
  return {
    drawflow: {
      Home: {
        data: {
          "1": {
            id: 1, name: "image_source_layer", class: "image_source_layer", html: "", typenode: false,
            data: { sourceKey: "pixel_values", featureSize: 16, imageShape: [4, 4, 1] },
            inputs: {}, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } },
            pos_x: 0, pos_y: 0,
          },
          "2": {
            id: 2, name: "target_source_layer", class: "target_source_layer", html: "", typenode: false,
            data: tgtNodeData,
            inputs: {}, outputs: { output_1: { connections: [{ node: "3", input: "input_2" }] } },
            pos_x: 0, pos_y: 0,
          },
          "3": {
            id: 3, name: "output_layer", class: "output_layer", html: "", typenode: false,
            data: { target: "custom", targetType: "custom", headType: "regression", loss: "mse", units: 4 },
            inputs: {
              input_1: { connections: [{ node: "1", output: "output_1" }] },
              input_2: { connections: [{ node: "2", output: "output_1" }] },
            },
            outputs: {}, pos_x: 0, pos_y: 0,
          },
        },
      },
    },
  };
}

(async function () {
  await tf.setBackend("cpu"); await tf.ready();

  // --- Case 1: target_source with NO featureSize/targetShape, NO schema
  // featureSize, NO datasetMeta.targetSize → throws.
  var threw1 = null;
  try {
    MBC.buildModelFromGraph(tf, makeGraph({ targetKey: "trajectory" }), {
      mode: "direct",
      featureSize: 16,
      imageShape: [4, 4, 1],
      allowedOutputKeys: [{ key: "trajectory", headType: "regression" }],
      defaultTarget: "trajectory",
    });
  } catch (e) { threw1 = e; }
  ok(threw1 != null, "target_source with no width hint throws");
  ok(threw1 && /target_source node/.test(String(threw1.message || "")),
    "error mentions target_source");
  ok(threw1 && /featureSize|targetShape/.test(String(threw1.message || "")),
    "error lists the three places to declare width");
  ok(threw1 && /no resolvable width/.test(String(threw1.message || "")),
    "error names the symptom (no resolvable width)");

  // --- Case 2: explicit featureSize on the node → resolves.
  var built2;
  try {
    built2 = MBC.buildModelFromGraph(tf, makeGraph({ targetKey: "trajectory", featureSize: 7 }), {
      mode: "direct",
      featureSize: 16,
      imageShape: [4, 4, 1],
      allowedOutputKeys: [{ key: "trajectory", headType: "regression" }],
      defaultTarget: "trajectory",
    });
  } catch (e) { failed += 1; console.log("  ✗ explicit featureSize=7 should build: " + e.message); }
  ok(built2 && built2.model && built2.model.inputs.some(function (i) {
    return i.shape && i.shape[1] === 7;
  }), "explicit featureSize=7 produces a 7-dim target input");

  // --- Case 3: targetShape array → resolves regardless of featureSize.
  var built3;
  try {
    built3 = MBC.buildModelFromGraph(tf, makeGraph({ targetKey: "mask", targetShape: [4, 4] }), {
      mode: "direct",
      featureSize: 16,
      imageShape: [4, 4, 1],
      allowedOutputKeys: [{ key: "mask", headType: "segmentation" }],
      defaultTarget: "mask",
    });
  } catch (e) { failed += 1; console.log("  ✗ targetShape=[4,4] should build: " + e.message); }
  ok(built3 && built3.model, "targetShape=[4,4] builds (rank-2 target)");

  // --- Case 4: schema featureSize resolves the target without an
  // explicit node override.
  var built4;
  try {
    built4 = MBC.buildModelFromGraph(tf, makeGraph({ targetKey: "bbox" }), {
      mode: "direct",
      featureSize: 16,
      imageShape: [4, 4, 1],
      allowedOutputKeys: [{ key: "bbox", headType: "regression", featureSize: 4, bboxFormat: "xywh" }],
      defaultTarget: "bbox",
    });
  } catch (e) { failed += 1; console.log("  ✗ schema lookup should resolve: " + e.message); }
  ok(built4 && built4.model && built4.model.inputs.some(function (i) {
    return i.shape && i.shape[1] === 4;
  }), "schema bbox.featureSize=4 resolves target_source to 4-dim");

  // --- Case 5: datasetMeta.targetSize resolves as last fallback.
  var built5;
  try {
    built5 = MBC.buildModelFromGraph(tf, makeGraph({ targetKey: "trajectory" }), {
      mode: "direct",
      featureSize: 16,
      imageShape: [4, 4, 1],
      allowedOutputKeys: [{ key: "trajectory", headType: "regression" }],
      defaultTarget: "trajectory",
      targetSize: 9,
    });
  } catch (e) { failed += 1; console.log("  ✗ datasetMeta.targetSize=9 should build: " + e.message); }
  ok(built5 && built5.model && built5.model.inputs.some(function (i) {
    return i.shape && i.shape[1] === 9;
  }), "datasetMeta.targetSize=9 resolves target_source to 9-dim");

  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

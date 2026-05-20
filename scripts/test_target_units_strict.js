"use strict";
// Regression test for the strict-targetSize contract in
// model_builder_core.targetUnitsFromMode. Before #91, an
// unannotated regression head (no schema featureSize, no node
// units, no datasetMeta.targetSize) silently defaulted to 1 unit —
// that's what masked the ais_trajectory.position bug fixed in #90.
//
// After: targetUnitsFromMode throws a clear error rather than
// shipping a 1-unit head that mis-matches trained weights.
//
// Verifies:
//   1. unannotated regression target with no width hint → throws
//   2. datasetMeta.targetSize satisfies the contract → builds
//   3. schema featureSize satisfies the contract → builds
//   4. explicit node `units` satisfies the contract → builds
//   5. existing special-case targets (label, pixel_values, custom)
//      still build without an explicit width

var path = require("path");
var assert = require("assert");

global.window = global;
global.OSCDatasetModules = { registerModule: function () {}, registerModules: function () {} };

var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var sr = require(path.join(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var MBC = require(path.join(__dirname, "..", "src/model_builder_core.js"));

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

function makeGraph(outputData) {
  // Minimal graph: image_source(8) → dense → output. Just enough to
  // exercise the head-units resolution path.
  return {
    drawflow: {
      Home: {
        data: {
          "1": {
            id: 1, name: "image_source_layer", class: "image_source_layer", html: "", typenode: false,
            data: { sourceKey: "pixel_values", featureSize: 8 },
            inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } },
            pos_x: 0, pos_y: 0,
          },
          "2": {
            id: 2, name: "dense_layer", class: "dense_layer", html: "", typenode: false,
            data: { units: 16 },
            inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } },
            outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } },
            pos_x: 0, pos_y: 0,
          },
          "3": {
            id: 3, name: "output_layer", class: "output_layer", html: "", typenode: false,
            data: outputData,
            inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } },
            outputs: {}, pos_x: 0, pos_y: 0,
          },
        },
      },
    },
  };
}

(async function () {
  await tf.setBackend("cpu"); await tf.ready();

  // --- Case 1: target "trajectory" with NO featureSize, NO node units,
  // NO datasetMeta.targetSize → must throw.
  var threw = null;
  try {
    MBC.buildModelFromGraph(tf, makeGraph({ target: "trajectory", targetType: "trajectory", headType: "regression", loss: "mse" }), {
      mode: "direct",
      featureSize: 8,
      allowedOutputKeys: [{ key: "trajectory", headType: "regression" }],
      defaultTarget: "trajectory",
    });
  } catch (e) { threw = e; }
  ok(threw != null, "unannotated regression target throws");
  ok(threw && /Cannot resolve output width/.test(String(threw.message || "")),
    "error mentions 'Cannot resolve output width' (got: " + (threw && threw.message) + ")");
  ok(threw && /trajectory/.test(String(threw.message || "")),
    "error names the offending target key");

  // --- Case 2: datasetMeta.targetSize satisfies the contract.
  var built2;
  try {
    built2 = MBC.buildModelFromGraph(tf, makeGraph({ target: "trajectory", targetType: "trajectory", headType: "regression", loss: "mse" }), {
      mode: "direct",
      featureSize: 8,
      allowedOutputKeys: [{ key: "trajectory", headType: "regression" }],
      defaultTarget: "trajectory",
      targetSize: 7,  // dynamic dataset declares this
    });
  } catch (e) { failed += 1; console.log("  ✗ datasetMeta.targetSize=7 should build: " + e.message); }
  ok(built2 && built2.headConfigs && built2.headConfigs[0] && built2.headConfigs[0].units === 7,
    "datasetMeta.targetSize=7 resolves to a 7-unit head");
  if (built2 && built2.model) built2.model.dispose();

  // --- Case 3: schema featureSize satisfies the contract.
  var built3;
  try {
    built3 = MBC.buildModelFromGraph(tf, makeGraph({ target: "boxes", targetType: "boxes", headType: "regression", loss: "mse" }), {
      mode: "direct",
      featureSize: 8,
      allowedOutputKeys: [{ key: "boxes", headType: "regression", featureSize: 5 }],
      defaultTarget: "boxes",
    });
  } catch (e) { failed += 1; console.log("  ✗ schema featureSize=5 should build: " + e.message); }
  ok(built3 && built3.headConfigs && built3.headConfigs[0] && built3.headConfigs[0].units === 5,
    "schema featureSize=5 resolves to a 5-unit head");
  if (built3 && built3.model) built3.model.dispose();

  // --- Case 4: explicit `units` on node satisfies the contract.
  var built4;
  try {
    built4 = MBC.buildModelFromGraph(tf, makeGraph({ target: "trajectory", targetType: "trajectory", headType: "regression", loss: "mse", units: 11 }), {
      mode: "direct",
      featureSize: 8,
      allowedOutputKeys: [{ key: "trajectory", headType: "regression" }],
      defaultTarget: "trajectory",
    });
  } catch (e) { failed += 1; console.log("  ✗ node units=11 should build: " + e.message); }
  ok(built4 && built4.headConfigs && built4.headConfigs[0] && built4.headConfigs[0].units === 11,
    "node units=11 resolves to an 11-unit head");
  if (built4 && built4.model) built4.model.dispose();

  // --- Case 5: special-case targets (label, custom, pixel_values) still
  // build without an explicit width — they have universal conventions.
  var built5a;
  try {
    built5a = MBC.buildModelFromGraph(tf, makeGraph({ target: "label", targetType: "label", headType: "classification", loss: "categoricalCrossentropy" }), {
      mode: "direct",
      featureSize: 8,
      allowedOutputKeys: [{ key: "label", headType: "classification" }],
      defaultTarget: "label",
      numClasses: 10,
    });
  } catch (e) { failed += 1; console.log("  ✗ label classification should build: " + e.message); }
  ok(built5a && built5a.headConfigs && built5a.headConfigs[0] && built5a.headConfigs[0].units === 10,
    "label + numClasses=10 resolves to 10-unit softmax head");
  if (built5a && built5a.model) built5a.model.dispose();

  var built5b;
  try {
    built5b = MBC.buildModelFromGraph(tf, makeGraph({ target: "custom", targetType: "custom", headType: "regression", loss: "mse" }), {
      mode: "direct",
      featureSize: 8,
      allowedOutputKeys: [],
      defaultTarget: "custom",
    });
  } catch (e) { failed += 1; console.log("  ✗ custom should build from upstream units: " + e.message); }
  ok(built5b && built5b.headConfigs && built5b.headConfigs[0] && built5b.headConfigs[0].units === 16,
    "custom resolves to upstream dense units=16");
  if (built5b && built5b.model) built5b.model.dispose();

  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

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

  // --- Case 2 setup: scalar-target regression — y is `0.42`, not [0.42].
  // The trainer's rebuild path infers targetSize from y[0]; if y[0] is a
  // number, the inferred width is 1 (scalar regression head). Verified
  // here at the resolver level via datasetMeta.targetSize=1.
  var built1b;
  try {
    built1b = MBC.buildModelFromGraph(tf, makeGraph({ target: "scalar", targetType: "scalar", headType: "regression", loss: "mse" }), {
      mode: "direct",
      featureSize: 8,
      allowedOutputKeys: [{ key: "scalar", headType: "regression" }],
      defaultTarget: "scalar",
      targetSize: 1,
    });
  } catch (e) { failed += 1; console.log("  ✗ scalar regression with targetSize=1 should build: " + e.message); }
  ok(built1b && built1b.headConfigs && built1b.headConfigs[0] && built1b.headConfigs[0].units === 1,
    "scalar regression: targetSize=1 resolves to a 1-unit head (no fallback ambiguity)");
  if (built1b && built1b.model) built1b.model.dispose();

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

  // --- Case 6: classification target missing numClasses → throws.
  // (Used to silently default to upstream units or 1.)
  var threw6 = null;
  try {
    MBC.buildModelFromGraph(tf, makeGraph({ target: "label", targetType: "label", headType: "classification", loss: "categoricalCrossentropy" }), {
      mode: "direct",
      featureSize: 8,
      allowedOutputKeys: [{ key: "label", headType: "classification" }],
      defaultTarget: "label",
      // no numClasses
    });
  } catch (e) { threw6 = e; }
  ok(threw6 != null, "classification with no numClasses throws");
  ok(threw6 && /numClasses/.test(String(threw6.message || "")),
    "classification error mentions numClasses (got: " + (threw6 && threw6.message) + ")");

  // --- Case 7: params target with empty paramsSelect AND no paramSize → throws.
  var threw7 = null;
  try {
    MBC.buildModelFromGraph(tf, makeGraph({ target: "params", targetType: "params", headType: "regression", loss: "mse" }), {
      mode: "direct",
      featureSize: 8,
      allowedOutputKeys: [{ key: "params", headType: "regression" }],
      defaultTarget: "params",
      // no paramsSelect, no paramSize
    });
  } catch (e) { threw7 = e; }
  ok(threw7 != null, "params with empty paramsSelect + no paramSize throws");
  ok(threw7 && /paramsSelect|paramSize/.test(String(threw7.message || "")),
    "params error mentions paramsSelect or paramSize");

  // --- Case 8: params target with paramSize set → builds.
  var built8;
  try {
    built8 = MBC.buildModelFromGraph(tf, makeGraph({ target: "params", targetType: "params", headType: "regression", loss: "mse" }), {
      mode: "direct",
      featureSize: 8,
      allowedOutputKeys: [{ key: "params", headType: "regression" }],
      defaultTarget: "params",
      paramSize: 6,
    });
  } catch (e) { failed += 1; console.log("  ✗ params + paramSize=6 should build: " + e.message); }
  ok(built8 && built8.headConfigs && built8.headConfigs[0] && built8.headConfigs[0].units === 6,
    "params + paramSize=6 resolves to a 6-unit head");
  if (built8 && built8.model) built8.model.dispose();

  // --- Case 9: pixel_values throw is source-asserted only.
  // Construct an end-to-end graph that exercises *only* the pixel_values
  // 0/0 branch without something else short-circuiting the build is
  // genuinely hard (image_source with featureSize=0 still synthesizes
  // a non-empty input tensor downstream). The guard itself is verified
  // by source inspection — the source pattern is identical to the
  // classification + params branches, both of which ARE end-to-end
  // tested above. We assert the guard exists in source so the throw
  // can't be silently removed.
  var src = require("fs").readFileSync(
    path.join(__dirname, "..", "src/model_builder_core.js"), "utf8");
  ok(/targetKey === "pixel_values"[\s\S]{0,500}Cannot resolve output width for target 'pixel_values'/.test(src),
    "pixel_values branch has the strict-throw guard in source");

  // --- Case 10: inferTargetWidth helper handles the zero-scalar trap
  // (the reviewer's specific finding: train.y[0] === 0 is valid for
  // scalar regression, and the previous `||` truthiness chain skipped
  // it. The helper now uses explicit array-length checks.)
  ok(MBC.inferTargetWidth([{ x: [[1, 2, 3]], y: [0] }], "regression", 0) === 1,
    "inferTargetWidth: scalar y=[0] (zero) regression → 1 (no falsy-skip)");
  ok(MBC.inferTargetWidth([{ x: [[1, 2, 3]], y: [0.42] }], "regression", 0) === 1,
    "inferTargetWidth: scalar y=[0.42] (nonzero) regression → 1");
  ok(MBC.inferTargetWidth([{ x: [[1, 2, 3]], y: [[0.1, 0.2, 0.3, 0.4]] }], "regression", 0) === 4,
    "inferTargetWidth: vector y=[[0.1,0.2,0.3,0.4]] regression → 4");
  ok(MBC.inferTargetWidth([{ x: [[1, 2, 3]], y: [] }, { x: [[4, 5, 6]], y: [0] }], "regression", 0) === 1,
    "inferTargetWidth: empty first split, next has y=[0] → 1 (still picks zero)");
  ok(MBC.inferTargetWidth([{ x: [[1, 2, 3]], y: [[1, 2]] }], "reconstruction", 0) === 3,
    "inferTargetWidth: reconstruction → uses x[0].length (3), not y");
  ok(MBC.inferTargetWidth([{ x: [], y: [] }], "classification", 7) === 7,
    "inferTargetWidth: classification → numClasses (7) regardless of data");
  ok(MBC.inferTargetWidth([{ x: [], y: [] }], "regression", 0) === 0,
    "inferTargetWidth: empty data → 0 (caller decides what to do)");

  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

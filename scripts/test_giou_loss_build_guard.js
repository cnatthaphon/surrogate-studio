"use strict";
// Regression test for the build-time GIoU/units guard. Even with the UI
// dropdown gated to bbox heads, a legacy preset or hand-edited graph
// could carry `loss: "giou"` on a non-4-unit head. The builder must
// fail fast with a clear error rather than silently constructing a
// head that explodes deep inside the loss tensor op at training time.

var path = require("path");
global.window = global;
global.OSCDatasetModules = { registerModule: function () {}, registerModules: function () {} };
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var sr = require(path.join(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var MBC = require(path.join(__dirname, "..", "src/model_builder_core.js"));

// Start from the SAR-Ship CNN preset and mutate the output node only.
// Keeps the input/conv pipeline intact so the build gets to the
// output_layer head construction. Each mutator overrides the output
// node's data field to produce a specific misconfiguration.
function makeGraph(outputData) {
  require(path.join(__dirname, "..", "demo/SAR-Ship-Detection/preset.js"));
  var preset = global.SAR_SHIP_DETECTION_PRESET;
  var cnn = preset.models.filter(function (m) { return m.id === "sar_cnn"; })[0];
  var graph = JSON.parse(JSON.stringify(cnn.graph));
  var data = graph.drawflow.Home.data;
  var outId = Object.keys(data).filter(function (id) { return data[id].name === "output_layer"; })[0];
  data[outId].data = outputData;
  return graph;
}

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

function buildShouldThrow(label, outputData, datasetMetaOverrides, errPredicate) {
  var threw = null;
  try {
    MBC.buildModelFromGraph(tf, makeGraph(outputData), Object.assign({
      mode: "direct",
      featureSize: 64 * 64,
      imageShape: [64, 64, 1],
      allowedOutputKeys: [{ key: "bbox", label: "bbox", headType: "regression", featureSize: 4, bboxFormat: "xywh" }],
      defaultTarget: "bbox",
      numClasses: 1,
      targetSize: 4,
    }, datasetMetaOverrides || {}));
  } catch (e) {
    threw = e;
  }
  ok(threw != null, label + ": build throws");
  if (threw && errPredicate) {
    ok(errPredicate(threw.message || ""),
      label + ": error message matches expectation (got: " + (threw && threw.message) + ")");
  }
}

(async function () {
  await tf.setBackend("cpu"); await tf.ready();

  // Case 1: GIoU on a 10-unit classification head.
  buildShouldThrow(
    "classification head + GIoU",
    {
      target: "digit", targetType: "digit",
      loss: "giou", headType: "classification",
      matchWeight: 1, activation: "softmax", units: 10,
    },
    {
      allowedOutputKeys: [{ key: "digit", label: "digit", headType: "classification", featureSize: 10 }],
      defaultTarget: "digit", numClasses: 10, targetSize: 10,
    },
    function (m) { return /GIoU/.test(m) && /4-unit/.test(m); }
  );

  // Case 2: GIoU on a "custom" target — no schema entry, so no
  // bboxFormat. The browser-side loss would default to xywh while
  // the server rejects empty bboxFormat. The build-time guard catches
  // imported/legacy graphs that bypass the UI gate.
  buildShouldThrow(
    "custom target + GIoU (no bboxFormat)",
    {
      target: "custom", targetType: "custom",
      loss: "giou", headType: "regression",
      matchWeight: 1, activation: "sigmoid", units: 4,
    },
    null,
    function (m) { return /bboxFormat/.test(m); }
  );

  // Case 3: bbox target but schema didn't declare a format and the
  // node carries no override. Same story as custom — the build must
  // refuse rather than silently picking xywh.
  buildShouldThrow(
    "bbox target without declared bboxFormat",
    {
      target: "bbox", targetType: "bbox",
      loss: "giou", headType: "regression",
      matchWeight: 1, activation: "sigmoid",
    },
    {
      // strip bboxFormat from the allowedOutputKeys
      allowedOutputKeys: [{ key: "bbox", label: "bbox", headType: "regression", featureSize: 4 }],
      defaultTarget: "bbox", numClasses: 1, targetSize: 4,
    },
    function (m) { return /bboxFormat/.test(m); }
  );

  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

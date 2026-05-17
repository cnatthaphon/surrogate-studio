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

// Start from the SAR-Ship CNN preset and mutate it: keep the input/conv
// pipeline intact (so the build gets to the output_layer head construction)
// but flip the output node into a classification configuration while leaving
// loss="giou" stale. The guard should trip.
function makeBadGraph() {
  require(path.join(__dirname, "..", "demo/SAR-Ship-Detection/preset.js"));
  var preset = global.SAR_SHIP_DETECTION_PRESET;
  var cnn = preset.models.filter(function (m) { return m.id === "sar_cnn"; })[0];
  var graph = JSON.parse(JSON.stringify(cnn.graph));
  var data = graph.drawflow.Home.data;
  var outId = Object.keys(data).filter(function (id) { return data[id].name === "output_layer"; })[0];
  // Force a classification-head shape with stale GIoU loss.
  data[outId].data = {
    target: "digit", targetType: "digit",
    loss: "giou", headType: "classification",
    matchWeight: 1, activation: "softmax", units: 10,
  };
  return graph;
}

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

(async function () {
  await tf.setBackend("cpu"); await tf.ready();

  var threw = null;
  try {
    MBC.buildModelFromGraph(tf, makeBadGraph(), {
      mode: "direct",
      featureSize: 64 * 64,
      imageShape: [64, 64, 1],
      allowedOutputKeys: [{ key: "digit", label: "digit", headType: "classification", featureSize: 10 }],
      defaultTarget: "digit",
      numClasses: 10,
      targetSize: 10,
    });
  } catch (e) {
    threw = e;
  }

  ok(threw != null, "build throws when GIoU loss is paired with a non-bbox head");
  ok(threw && /GIoU/.test(String(threw.message || "")), "error mentions GIoU (got: " + (threw && threw.message) + ")");
  ok(threw && /4-unit/.test(String(threw.message || "")), "error mentions the 4-unit requirement");

  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

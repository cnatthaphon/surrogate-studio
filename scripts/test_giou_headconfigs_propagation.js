"use strict";
// Regression test for the end-to-end bboxFormat propagation that the
// PR #89 Codex review thread caught (preset.js:82 missing
// `bboxFormat: "xywh"`). The build-time guard threw "GIoU loss requires
// bboxFormat" against scripts/test_predict_multi_input.js, which passed
// a minimal `allowedOutputKeys` array without the format field.
//
// Asserts the two layers of propagation that have to keep working:
//   1. SAR-Ship preset graphs: every Output node with a giou-family
//      loss must carry `bboxFormat: "xywh"` directly on node.data so
//      callers that build with sparse `allowedOutputKeys` succeed.
//   2. headConfigs emitted by buildModelFromGraph: every head with a
//      giou-family loss must end up with a recognized bboxFormat in
//      the entry shipped to the engine/server.

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

require(path.join(__dirname, "..", "demo/SAR-Ship-Detection/preset.js"));
var preset = global.SAR_SHIP_DETECTION_PRESET;

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

// --- Case 1: every SAR-Ship Output node with a giou-family loss
// declares bboxFormat directly on node.data.
preset.models.forEach(function (m) {
  var nodes = m.graph.drawflow.Home.data;
  Object.keys(nodes).forEach(function (id) {
    var n = nodes[id];
    if (n.name !== "output_layer") return;
    var l = String((n.data && n.data.loss) || "").toLowerCase();
    if (l === "giou" || l === "iou" || l === "giou_mse" || l === "mse_giou") {
      var fmt = String((n.data && n.data.bboxFormat) || "").toLowerCase();
      ok(fmt === "xywh" || fmt === "xyxy",
        m.name + " output node " + id + ": loss=" + l + " has bboxFormat='" + fmt + "' (must be xywh or xyxy)");
    }
  });
});

// --- Case 2: headConfigs from a sparse allowedOutputKeys still
// resolves bboxFormat (because the preset declares it on the node).
(async function () {
  await tf.setBackend("cpu"); await tf.ready();

  var augModel = preset.models.filter(function (m) { return m.id === "sar_cnn_aug"; })[0];
  ok(!!augModel, "found sar_cnn_aug in preset");

  // Sparse allowedOutputKeys — no bboxFormat — mirrors what the
  // multi-input prediction test (and any minimal caller) passes.
  var sparse = [{ key: "bbox", label: "bbox", headType: "regression", featureSize: 4 }];
  var built;
  try {
    built = MBC.buildModelFromGraph(tf, augModel.graph, {
      mode: "direct",
      featureSize: 64 * 64,
      imageShape: [64, 64, 1],
      allowedOutputKeys: sparse,
      defaultTarget: "bbox",
      numClasses: 1,
      targetSize: 4,
    });
  } catch (e) {
    failed += 1;
    console.log("  ✗ build with sparse allowedOutputKeys threw: " + e.message);
    process.exit(1);
  }
  ok(Array.isArray(built.headConfigs) && built.headConfigs.length > 0,
    "build emitted headConfigs (got " + (built.headConfigs && built.headConfigs.length) + ")");

  built.headConfigs.forEach(function (hc, i) {
    var l = String(hc.loss || "").toLowerCase();
    if (l === "giou" || l === "iou" || l === "giou_mse" || l === "mse_giou") {
      var fmt = String(hc.bboxFormat || "").toLowerCase();
      ok(fmt === "xywh" || fmt === "xyxy",
        "headConfigs[" + i + "]: loss=" + l + " carries bboxFormat='" + fmt + "'");
    }
  });

  // --- Case 3: round-trip — clear bboxFormat from preset node,
  // builder falls back to schema lookup (full allowedOutputKeys with
  // bboxFormat from schemaRegistry).
  var rich = sr.getOutputKeys("sar_ship_detection");
  ok(rich.some(function (k) { return k.key === "bbox" && k.bboxFormat === "xywh"; }),
    "schemaRegistry.getOutputKeys carries bboxFormat for sar_ship_detection");

  var graphCopy = JSON.parse(JSON.stringify(augModel.graph));
  Object.keys(graphCopy.drawflow.Home.data).forEach(function (id) {
    var n = graphCopy.drawflow.Home.data[id];
    if (n.name === "output_layer" && n.data) delete n.data.bboxFormat;
  });
  var built2;
  try {
    built2 = MBC.buildModelFromGraph(tf, graphCopy, {
      mode: "direct",
      featureSize: 64 * 64,
      imageShape: [64, 64, 1],
      allowedOutputKeys: rich,
      defaultTarget: "bbox",
      numClasses: 1,
      targetSize: 4,
    });
  } catch (e) {
    failed += 1;
    console.log("  ✗ build with rich allowedOutputKeys (no node bboxFormat) threw: " + e.message);
    process.exit(1);
  }
  built2.headConfigs.forEach(function (hc, i) {
    var l = String(hc.loss || "").toLowerCase();
    if (l === "giou" || l === "iou" || l === "giou_mse" || l === "mse_giou") {
      ok(hc.bboxFormat === "xywh",
        "schema-fallback headConfigs[" + i + "]: bboxFormat resolved from schema (got '" + hc.bboxFormat + "')");
    }
  });

  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

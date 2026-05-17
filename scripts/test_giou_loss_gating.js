#!/usr/bin/env node
"use strict";
// Regression test for GIoU loss being scoped to bbox-compatible heads.
// Before fix: giou and giou_mse were offered on every Output loss
// dropdown, including classification heads — selecting one produced an
// opaque shape-mismatch failure at training time because the loss
// expects a [B, 4] tensor. Switching the target away from a bbox head
// also left the stored loss as "giou", so a stale value lingered on a
// head shape that couldn't possibly satisfy it.
//
// After fix:
//   1. getNodeConfigSpec only adds giou/giou_mse to the loss options
//      when the resolved target is a 4-unit regression head (or
//      "custom", since custom targets are user-defined).
//   2. applyNodeConfigValue normalizes a stale giou loss to mse when
//      the user switches the target to a non-bbox head.

var path = require("path");
var schemaRegistry = require(path.join(__dirname, "..", "src/schema_registry.js"));
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var modelGraphCore = require(path.join(__dirname, "..", "src/model_graph_core.js"));

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

function makeRuntime(schemaId) {
  return modelGraphCore.createRuntime({
    resolveSchemaId: function () { return schemaId; },
    getCurrentSchemaId: function () { return schemaId; },
    getOutputKeys: function (sid) { return schemaRegistry.getOutputKeys(sid) || []; },
    normalizeOutputTargetsList: function (raw, current /* , sid */) {
      var v = String(raw || "").trim().toLowerCase();
      if (v) return [v];
      return current || [];
    },
  });
}

function lossValues(spec) {
  if (!Array.isArray(spec)) return [];
  var f = spec.filter(function (x) { return x && x.key === "loss"; })[0];
  return f && f.options ? f.options.map(function (o) { return o.value; }) : [];
}

// --- Case 1: SAR-Ship bbox head (regression, featureSize=4) shows GIoU options.
(function () {
  var runtime = makeRuntime("sar_ship_detection");
  var node = {
    id: 1, name: "output_layer",
    data: { target: "bbox", targetType: "bbox", loss: "giou", headType: "regression", bboxFormat: "xywh" },
    inputs: {}, outputs: {},
  };
  var spec = runtime.getNodeConfigSpec(node, "sar_ship_detection");
  var values = lossValues(spec);
  ok(values.indexOf("giou") >= 0, "bbox head: 'giou' option is offered");
  ok(values.indexOf("giou_mse") >= 0, "bbox head: 'giou_mse' option is offered");
  ok(values.indexOf("mse") >= 0, "bbox head: 'mse' still offered");
})();

// --- Case 2: Fashion-MNIST classification head hides GIoU options.
(function () {
  var runtime = makeRuntime("oscillator"); // any schema, irrelevant — we'll
                                            // mock a classification output key via runtime context
  // Build a runtime where the schema returns a classification target.
  var classRuntime = modelGraphCore.createRuntime({
    resolveSchemaId: function () { return "fake_classification"; },
    getCurrentSchemaId: function () { return "fake_classification"; },
    getOutputKeys: function () {
      return [{ key: "digit", label: "Digit class", headType: "classification", featureSize: 10 }];
    },
    normalizeOutputTargetsList: function (raw, current) {
      var v = String(raw || "").trim().toLowerCase();
      if (v) return [v];
      return current || [];
    },
  });
  var node = {
    id: 2, name: "output_layer",
    data: { target: "digit", targetType: "digit", loss: "categoricalCrossentropy", headType: "classification" },
    inputs: {}, outputs: {},
  };
  var spec = classRuntime.getNodeConfigSpec(node, "fake_classification");
  var values = lossValues(spec);
  ok(values.indexOf("giou") < 0, "classification head: 'giou' option NOT offered (got " + values.join(",") + ")");
  ok(values.indexOf("giou_mse") < 0, "classification head: 'giou_mse' option NOT offered");
  ok(values.indexOf("categoricalCrossentropy") >= 0, "classification head: categoricalCrossentropy still offered");
})();

// --- Case 3: 1-unit BCE-style regression head hides GIoU (wrong shape).
(function () {
  var runtime = modelGraphCore.createRuntime({
    resolveSchemaId: function () { return "fake_scalar"; },
    getCurrentSchemaId: function () { return "fake_scalar"; },
    getOutputKeys: function () {
      return [{ key: "score", label: "Score", headType: "regression", featureSize: 1 }];
    },
    normalizeOutputTargetsList: function (raw, current) {
      var v = String(raw || "").trim().toLowerCase();
      if (v) return [v];
      return current || [];
    },
  });
  var node = {
    id: 3, name: "output_layer",
    data: { target: "score", targetType: "score", loss: "mse", headType: "regression" },
    inputs: {}, outputs: {},
  };
  var spec = runtime.getNodeConfigSpec(node, "fake_scalar");
  var values = lossValues(spec);
  ok(values.indexOf("giou") < 0, "1-unit regression head: 'giou' option NOT offered");
  ok(values.indexOf("giou_mse") < 0, "1-unit regression head: 'giou_mse' option NOT offered");
})();

// --- Case 4: custom target still exposes GIoU (escape hatch for advanced users).
(function () {
  var runtime = makeRuntime("sar_ship_detection");
  var node = {
    id: 4, name: "output_layer",
    data: { target: "custom", targetType: "custom", loss: "mse" },
    inputs: {}, outputs: {},
  };
  var spec = runtime.getNodeConfigSpec(node, "sar_ship_detection");
  var values = lossValues(spec);
  ok(values.indexOf("giou") >= 0, "custom target: 'giou' option offered");
  ok(values.indexOf("giou_mse") >= 0, "custom target: 'giou_mse' option offered");
})();

// --- Case 5: applyNodeConfigValue downgrades stale GIoU when target changes.
(function () {
  var calls = [];
  var bag = {
    "10": {
      id: 10, name: "output_layer",
      data: { target: "bbox", targetType: "bbox", loss: "giou", headType: "regression" },
      inputs: { input_1: { connections: [] } },
      outputs: {},
    },
  };
  var editor = {
    export: function () { return { drawflow: { Home: { data: bag } } }; },
    updateNodeDataFromId: function (id, d) { calls.push({ id: id, data: d }); bag[String(id)].data = d; },
    addNodeInput: function () {},
    removeNodeInput: function () {},
    removeSingleConnection: function () {},
  };
  var classifyRuntime = modelGraphCore.createRuntime({
    resolveSchemaId: function () { return "fake_classification"; },
    getCurrentSchemaId: function () { return "fake_classification"; },
    getOutputKeys: function () {
      return [
        { key: "bbox", label: "Box", headType: "regression", featureSize: 4 },
        { key: "digit", label: "Digit", headType: "classification", featureSize: 10 },
      ];
    },
    normalizeOutputTargetsList: function (raw, current) {
      var v = String(raw || "").trim().toLowerCase();
      if (v) return [v];
      return current || [];
    },
  });
  var result = classifyRuntime.applyNodeConfigValue(editor, "10", "targetType", "digit", "fake_classification");
  ok(result && result.handled, "applyNodeConfigValue handles target switch");
  ok(bag["10"].data.targetType === "digit", "target moved to 'digit'");
  ok(bag["10"].data.loss === "mse", "stale 'giou' loss downgraded to 'mse' (got '" + bag["10"].data.loss + "')");
})();

// --- Case 6: switching between two bbox-compatible heads keeps giou loss.
(function () {
  var bag = {
    "20": {
      id: 20, name: "output_layer",
      data: { target: "bbox_a", targetType: "bbox_a", loss: "giou", headType: "regression" },
      inputs: {}, outputs: {},
    },
  };
  var editor = {
    export: function () { return { drawflow: { Home: { data: bag } } }; },
    updateNodeDataFromId: function (id, d) { bag[String(id)].data = d; },
    addNodeInput: function () {},
    removeNodeInput: function () {},
    removeSingleConnection: function () {},
  };
  var twoBboxRuntime = modelGraphCore.createRuntime({
    resolveSchemaId: function () { return "fake_two_bbox"; },
    getCurrentSchemaId: function () { return "fake_two_bbox"; },
    getOutputKeys: function () {
      return [
        { key: "bbox_a", label: "A", headType: "regression", featureSize: 4, bboxFormat: "xywh" },
        { key: "bbox_b", label: "B", headType: "regression", featureSize: 4, bboxFormat: "xywh" },
      ];
    },
    normalizeOutputTargetsList: function (raw, current) {
      var v = String(raw || "").trim().toLowerCase();
      if (v) return [v];
      return current || [];
    },
  });
  twoBboxRuntime.applyNodeConfigValue(editor, "20", "targetType", "bbox_b", "fake_two_bbox");
  ok(bag["20"].data.targetType === "bbox_b", "switched between bbox targets");
  ok(bag["20"].data.loss === "giou", "giou retained when switching bbox→bbox (got '" + bag["20"].data.loss + "')");
})();

console.log("\n  " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

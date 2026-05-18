#!/usr/bin/env node
"use strict";
// Regression test for the SAR-Ship CNN + Aug graph bug. The Output
// config form replays every config key on submit, including an
// unchanged targetType. Before the fix: applyNodeConfigValue called
// syncOutputNodeInputCount on every such replay, which then saw
// `current=2` (the legitimately wired augment_bbox → output.input_2
// connection from demo/SAR-Ship-Detection/preset.js) and `want=1`
// for a non-custom target, and tore the port + connection down.
// After the fix: the helper is a no-op when the target didn't
// actually change, and it only shrinks ports when leaving the
// "custom" sentinel (where input_2 is *defined to be* a user-wired
// target tensor that disappears with the target).

var path = require("path");
var schemaRegistry = require(path.join(__dirname, "..", "src/schema_registry.js"));
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var modelGraphCore = require(path.join(__dirname, "..", "src/model_graph_core.js"));

// Load the actual SAR-Ship preset so the graph we exercise here
// matches the live demo, not a hand-rolled fixture.
global.window = global;
require(path.join(__dirname, "..", "demo/SAR-Ship-Detection/preset.js"));
var preset = global.SAR_SHIP_DETECTION_PRESET;
var augModel = preset.models.filter(function (m) { return m.id === "sar_cnn_aug"; })[0];
if (!augModel) { console.error("preset missing sar_cnn_aug model"); process.exit(1); }

// Drawflow graphs are stored under drawflow.Home.data. Clone the
// preset graph so this test's mutations don't leak across the file.
function cloneGraphData() {
  var src = augModel.graph.drawflow.Home.data;
  return JSON.parse(JSON.stringify(src));
}

function findNodeId(bag, predicate) {
  var ids = Object.keys(bag);
  for (var i = 0; i < ids.length; i += 1) if (predicate(bag[ids[i]], ids[i])) return ids[i];
  return null;
}

function makeEditorFromBag(bag) {
  var calls = { addNodeInput: [], removeNodeInput: [], removeSingleConnection: [], updateNodeDataFromId: [] };
  return {
    _data: bag,
    _calls: calls,
    export: function () { return { drawflow: { Home: { data: bag } } }; },
    addNodeInput: function (id) {
      calls.addNodeInput.push(String(id));
      var n = bag[String(id)];
      if (!n.inputs) n.inputs = {};
      var idx = Object.keys(n.inputs).length + 1;
      n.inputs["input_" + idx] = { connections: [] };
    },
    removeNodeInput: function (id, port) {
      calls.removeNodeInput.push({ id: String(id), port: port });
      var n = bag[String(id)];
      if (n && n.inputs && n.inputs[port]) delete n.inputs[port];
    },
    removeSingleConnection: function (fromId, toId, fromCls, toCls) {
      calls.removeSingleConnection.push({ fromId: String(fromId), toId: String(toId), fromCls: fromCls, toCls: toCls });
      var to = bag[String(toId)];
      if (to && to.inputs && to.inputs[toCls] && to.inputs[toCls].connections) {
        to.inputs[toCls].connections = to.inputs[toCls].connections.filter(function (c) {
          return !(String(c.node) === String(fromId) && String(c.output || "output_1") === String(fromCls));
        });
      }
    },
    updateNodeDataFromId: function (id, d) {
      calls.updateNodeDataFromId.push({ id: String(id), data: d });
      if (bag[String(id)]) bag[String(id)].data = d;
    },
  };
}

var runtime = modelGraphCore.createRuntime({
  resolveSchemaId: function () { return "sar_ship_detection"; },
  getCurrentSchemaId: function () { return "sar_ship_detection"; },
  getOutputKeys: function (sid) { return schemaRegistry.getOutputKeys(sid) || []; },
  normalizeOutputTargetsList: function (raw, current) {
    var v = String(raw || "").trim().toLowerCase();
    if (v) return [v];
    return current || [];
  },
});

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

function countInputsOnOutput(bag) {
  var outId = findNodeId(bag, function (n) { return n && n.name === "output_layer"; });
  var node = outId && bag[outId];
  return node ? Object.keys(node.inputs || {}).length : 0;
}

function input2Wired(bag) {
  var outId = findNodeId(bag, function (n) { return n && n.name === "output_layer"; });
  if (!outId) return false;
  var node = bag[outId];
  var conns = (node.inputs && node.inputs.input_2 && node.inputs.input_2.connections) || [];
  return conns.length > 0;
}

// ---- Case 1: replay unchanged targetType "bbox" on the SAR-Ship-Aug
// output node. The graph ships with input_2 wired from augment_bbox.
(function () {
  var bag = cloneGraphData();
  var outId = findNodeId(bag, function (n) { return n && n.name === "output_layer"; });
  ok(outId != null, "found output_layer in SAR-Ship-Aug graph (id=" + outId + ")");
  ok(countInputsOnOutput(bag) === 2, "fixture has 2 inputs on output_layer (got " + countInputsOnOutput(bag) + ")");
  ok(input2Wired(bag), "fixture has a wired connection on output.input_2");

  var editor = makeEditorFromBag(bag);
  var beforeData = JSON.parse(JSON.stringify(bag[outId].data));
  runtime.applyNodeConfigValue(editor, outId, "targetType", beforeData.targetType, "sar_ship_detection");

  ok(countInputsOnOutput(bag) === 2, "unchanged-target replay preserves input port count (got " + countInputsOnOutput(bag) + ")");
  ok(input2Wired(bag), "unchanged-target replay preserves the wired input_2 connection");
  ok(editor._calls.removeNodeInput.length === 0, "no removeNodeInput calls on replay (got " + editor._calls.removeNodeInput.length + ")");
  ok(editor._calls.removeSingleConnection.length === 0, "no removeSingleConnection calls on replay (got " + editor._calls.removeSingleConnection.length + ")");
})();

// ---- Case 2: editing loss or matchWeight must not trigger the resync
// at all (the form replays every key, but only targetType/target take
// the sync path). Verify by exercising the loss key on the same graph.
(function () {
  var bag = cloneGraphData();
  var outId = findNodeId(bag, function (n) { return n && n.name === "output_layer"; });
  var editor = makeEditorFromBag(bag);
  runtime.applyNodeConfigValue(editor, outId, "loss", "mae", "sar_ship_detection");
  ok(countInputsOnOutput(bag) === 2, "loss edit preserves input port count");
  ok(input2Wired(bag), "loss edit preserves the wired input_2 connection");
  ok(bag[outId].data.loss === "mae", "loss edit actually persisted (got '" + bag[outId].data.loss + "')");
})();

// ---- Case 3: switching from a different non-custom target to bbox
// (a real change) shouldn't tear down a legit input_2 either —
// paired augment flows are scoped to the schema target, but as long
// as the user didn't come from "custom", their augment wiring
// belongs to them.
(function () {
  var bag = cloneGraphData();
  var outId = findNodeId(bag, function (n) { return n && n.name === "output_layer"; });
  bag[outId].data = Object.assign({}, bag[outId].data, { target: "label", targetType: "label" });
  var editor = makeEditorFromBag(bag);
  runtime.applyNodeConfigValue(editor, outId, "targetType", "bbox", "sar_ship_detection");
  ok(countInputsOnOutput(bag) === 2, "non-custom → non-custom switch preserves input port count");
  ok(input2Wired(bag), "non-custom → non-custom switch preserves the wired input_2 connection");
  ok(editor._calls.removeSingleConnection.length === 0, "no removeSingleConnection on non-custom → non-custom switch");
})();

// ---- Case 4: switching FROM custom TO bbox still tears down. This
// guards against the reviewer's earlier finding (PR #86: stale
// custom input_2 silently becoming a graph-label tensor for the new
// target).
(function () {
  var bag = cloneGraphData();
  var outId = findNodeId(bag, function (n) { return n && n.name === "output_layer"; });
  bag[outId].data = Object.assign({}, bag[outId].data, { target: "custom", targetType: "custom" });
  var editor = makeEditorFromBag(bag);
  runtime.applyNodeConfigValue(editor, outId, "targetType", "bbox", "sar_ship_detection");
  ok(countInputsOnOutput(bag) === 1, "custom → bbox tears down input_2 (port count back to 1)");
  ok(editor._calls.removeSingleConnection.length === 1, "custom → bbox issues exactly one disconnect (got " + editor._calls.removeSingleConnection.length + ")");
})();

console.log("\n  " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

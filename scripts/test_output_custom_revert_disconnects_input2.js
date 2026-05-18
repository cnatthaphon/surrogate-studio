#!/usr/bin/env node
"use strict";
// Regression test for the stale-input_2 bug. Before fix:
// switching an output_layer's target from "custom" back to a normal
// schema target removed the input_2 *port* only when nothing was wired
// to it. A connected input_2 was silently left intact, so the model
// builder picked up the lingering tensor as a graph-label input and
// corrupted the head wiring of the new target. After fix: the revert
// force-disconnects any connection on the dropped port first, then
// removes the port.

var path = require("path");
var assert = require("assert");
var schemaRegistry = require(path.join(__dirname, "..", "src/schema_registry.js"));
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var modelGraphCore = require(path.join(__dirname, "..", "src/model_graph_core.js"));

function makeEditorMock(initialData) {
  var data = JSON.parse(JSON.stringify(initialData));
  var calls = { addNodeInput: [], removeNodeInput: [], removeSingleConnection: [], updateNodeDataFromId: [] };
  return {
    _data: data,
    _calls: calls,
    export: function () { return { drawflow: { Home: { data: data } } }; },
    addNodeInput: function (nodeId) {
      calls.addNodeInput.push(String(nodeId));
      var n = data[String(nodeId)];
      if (!n.inputs) n.inputs = {};
      var existing = Object.keys(n.inputs);
      var next = "input_" + String(existing.length + 1);
      n.inputs[next] = { connections: [] };
    },
    removeNodeInput: function (nodeId, portKey) {
      calls.removeNodeInput.push({ nodeId: String(nodeId), portKey: portKey });
      var n = data[String(nodeId)];
      if (n && n.inputs && n.inputs[portKey]) delete n.inputs[portKey];
    },
    removeSingleConnection: function (fromId, toId, fromCls, toCls) {
      calls.removeSingleConnection.push({ fromId: String(fromId), toId: String(toId), fromCls: fromCls, toCls: toCls });
      var to = data[String(toId)];
      if (to && to.inputs && to.inputs[toCls] && to.inputs[toCls].connections) {
        to.inputs[toCls].connections = to.inputs[toCls].connections.filter(function (c) {
          return !(String(c.node) === String(fromId) && String(c.output || "output_1") === String(fromCls));
        });
      }
      var from = data[String(fromId)];
      if (from && from.outputs && from.outputs[fromCls] && from.outputs[fromCls].connections) {
        from.outputs[fromCls].connections = from.outputs[fromCls].connections.filter(function (c) {
          return !(String(c.node) === String(toId) && String(c.input) === String(toCls));
        });
      }
    },
    updateNodeDataFromId: function (nodeId, newData) {
      calls.updateNodeDataFromId.push({ nodeId: String(nodeId), data: newData });
      if (data[String(nodeId)]) data[String(nodeId)].data = newData;
    },
  };
}

// Two-node graph: a constant_layer wired into output_layer.input_2,
// plus an upstream feature node wired into output_layer.input_1.
function makeGraphCustomWithWiredInput2() {
  return {
    "1": {
      id: 1, name: "dense_layer", data: { units: 16 }, class: "dense_layer", html: "", typenode: false,
      inputs: {}, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } }, pos_x: 0, pos_y: 0,
    },
    "2": {
      id: 2, name: "constant_layer", data: { value: 0 }, class: "constant_layer", html: "", typenode: false,
      inputs: {}, outputs: { output_1: { connections: [{ node: "3", input: "input_2" }] } }, pos_x: 0, pos_y: 0,
    },
    "3": {
      id: 3, name: "output_layer",
      data: { target: "custom", targetType: "custom", loss: "mse", matchWeight: 1 },
      class: "output_layer", html: "", typenode: false,
      inputs: {
        input_1: { connections: [{ node: "1", output: "output_1" }] },
        input_2: { connections: [{ node: "2", output: "output_1" }] },
      },
      outputs: {},
      pos_x: 0, pos_y: 0,
    },
  };
}

var runtime = modelGraphCore.createRuntime({
  resolveSchemaId: function () { return "sar_ship_detection"; },
  getCurrentSchemaId: function () { return "sar_ship_detection"; },
  getOutputKeys: function (sid) {
    var defs = schemaRegistry.getSchema(sid);
    return (defs && defs.outputs) || [{ key: "bbox", label: "bbox", headType: "regression" }];
  },
  normalizeOutputTargetsList: function (raw, current /* , sid */) {
    // Single-target schema: just return the requested target lowercased.
    var v = String(raw || "").trim().toLowerCase();
    if (v) return [v];
    return current || [];
  },
});
var applyNodeConfigValue = runtime.applyNodeConfigValue;

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

// --- Case 1: revert from "custom" to "bbox" with a wired input_2.
(function () {
  var editor = makeEditorMock(makeGraphCustomWithWiredInput2());
  var before = editor._data["3"];
  assert.strictEqual(Object.keys(before.inputs).length, 2, "fixture starts with 2 inputs");

  var result = applyNodeConfigValue(editor, "3", "targetType", "bbox", "sar_ship_detection");
  ok(result && result.handled, "applyNodeConfigValue(handled=true) on target switch");

  var after = editor._data["3"];
  ok(after.data.targetType === "bbox", "targetType is 'bbox' after revert (got '" + after.data.targetType + "')");
  ok(after.data.target === "bbox", "target is 'bbox' after revert (got '" + after.data.target + "')");
  ok(Object.keys(after.inputs).length === 1, "input_2 port removed (input keys: " + Object.keys(after.inputs).join(",") + ")");
  ok(!after.inputs.input_2, "after.inputs.input_2 is undefined");

  var removed = editor._calls.removeSingleConnection;
  ok(removed.length === 1, "removeSingleConnection was called once (got " + removed.length + ")");
  ok(removed[0] && removed[0].toCls === "input_2", "removeSingleConnection target port is input_2 (got '" + (removed[0] && removed[0].toCls) + "')");
  ok(removed[0] && removed[0].fromId === "2", "removeSingleConnection upstream is the constant_layer (got '" + (removed[0] && removed[0].fromId) + "')");

  // Upstream node should no longer reference the output port.
  var upstream = editor._data["2"];
  var stillConnected = (upstream.outputs.output_1.connections || []).some(function (c) {
    return String(c.node) === "3" && String(c.input) === "input_2";
  });
  ok(!stillConnected, "upstream constant_layer no longer references output.input_2");
})();

// --- Case 2: revert with no wired input_2 still works (no over-disconnect).
(function () {
  var g = makeGraphCustomWithWiredInput2();
  g["3"].inputs.input_2 = { connections: [] };
  g["2"].outputs.output_1.connections = [];
  var editor = makeEditorMock(g);
  applyNodeConfigValue(editor, "3", "targetType", "bbox", "sar_ship_detection");
  ok(!editor._data["3"].inputs.input_2, "empty input_2 port is removed on revert");
  ok(editor._calls.removeSingleConnection.length === 0, "no spurious removeSingleConnection calls when port had no wires");
})();

// --- Case 3: switching TO custom from "bbox" adds input_2 without disconnecting anything.
(function () {
  var g = {
    "1": {
      id: 1, name: "dense_layer", data: {}, class: "dense_layer", html: "", typenode: false,
      inputs: {}, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } }, pos_x: 0, pos_y: 0,
    },
    "3": {
      id: 3, name: "output_layer",
      data: { target: "bbox", targetType: "bbox", loss: "mse", matchWeight: 1 },
      class: "output_layer", html: "", typenode: false,
      inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } },
      outputs: {}, pos_x: 0, pos_y: 0,
    },
  };
  var editor = makeEditorMock(g);
  applyNodeConfigValue(editor, "3", "targetType", "custom", "sar_ship_detection");
  var node = editor._data["3"];
  ok(node.data.targetType === "custom", "custom target persisted (got '" + node.data.targetType + "')");
  ok(Object.keys(node.inputs).length === 2 && node.inputs.input_2, "input_2 port added when going TO custom");
  ok(editor._calls.removeSingleConnection.length === 0, "no removeSingleConnection calls when expanding");
})();

console.log("\n  " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

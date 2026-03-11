#!/usr/bin/env node
"use strict";

const assert = require("assert");
const schemaRegistry = require("../src/schema_registry.js");
globalThis.OSCSchemaRegistry = schemaRegistry;
require("../src/schema_definitions_builtin.js");
const adapter = require("../src/model_graph_drawflow_adapter.js");

function main() {
  assert(adapter && typeof adapter.createDrawflowGraphFromPreset === "function", "adapter preset function missing");
  const graph = adapter.createDrawflowGraphFromPreset("fashion_mnist", "fashion_mnist_mlp_baseline");
  assert(graph && graph.drawflow && graph.drawflow.Home && graph.drawflow.Home.data, "drawflow graph missing");
  const nodes = graph.drawflow.Home.data;
  const ids = Object.keys(nodes);
  assert(ids.length > 0, "graph should have nodes");
  const names = ids.map(function (id) { return String((nodes[id] && nodes[id].name) || ""); });
  assert(names.indexOf("image_source_block") >= 0, "fashion preset should include image source");
  assert(names.indexOf("output_layer") >= 0, "fashion preset should include output");
  ids.forEach(function (id) {
    const node = nodes[id] || {};
    const outputs = node.outputs && typeof node.outputs === "object" ? node.outputs : {};
    const inputs = node.inputs && typeof node.inputs === "object" ? node.inputs : {};
    Object.keys(outputs).forEach(function (portKey) {
      const connections = Array.isArray(outputs[portKey] && outputs[portKey].connections)
        ? outputs[portKey].connections
        : [];
      connections.forEach(function (conn) {
        assert(String((conn && conn.node) || "").trim(), "output connection target node missing");
        assert(String((conn && conn.input) || "").trim(), "output connection target input missing");
      });
    });
    Object.keys(inputs).forEach(function (portKey) {
      const connections = Array.isArray(inputs[portKey] && inputs[portKey].connections)
        ? inputs[portKey].connections
        : [];
      connections.forEach(function (conn) {
        assert(String((conn && conn.node) || "").trim(), "input connection source node missing");
        assert(String((conn && conn.output) || "").trim(), "input connection source output missing");
      });
    });
  });
  console.log("PASS test_contract_model_graph_drawflow_adapter");
}

main();

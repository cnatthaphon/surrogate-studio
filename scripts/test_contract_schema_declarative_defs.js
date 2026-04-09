#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const schemaRegistry = require("../src/schema_registry.js");
require("../src/schema_definitions_builtin.js");

function main() {
  const filePath = path.resolve(__dirname, "../src/schema_definitions_builtin.js");
  const source = fs.readFileSync(filePath, "utf8");
  [
    "function _presetNode(",
    "function _presetEdge(",
    "function _presetGraph(",
    "function _preset(",
    "function _imageClassifierPreset(",
    "function _oscillatorRecipePreset(",
    "function _diffusionPreset(",
    "function _vaePreset(",
    "function _dualLatentPreset(",
    "function _arGruLatentPreset(",
  ].forEach(function (needle) {
    assert(source.indexOf(needle) < 0, "declarative schema file must not contain legacy helper: " + needle);
  });

  schemaRegistry.listSchemas().forEach(function (item) {
    const schemaId = String(item.id || "");
    const schema = schemaRegistry.getSchema(schemaId);
    assert(schema, "schema missing: " + schemaId);

    const presets = (((schema || {}).model || {}).presets) || [];
    if (presets.length === 0) return; // some schemas have no presets
    presets.forEach(function (preset) {
      assert(preset && typeof preset === "object", "preset must be object: " + schemaId);
      assert(String(preset.id || "").trim(), "preset id missing: " + schemaId);
      const graphSpec = preset.metadata && preset.metadata.graphSpec;
      assert(graphSpec && typeof graphSpec === "object", "preset graphSpec missing: " + schemaId + ":" + String(preset.id || ""));
      assert(Array.isArray(graphSpec.nodes), "preset graphSpec.nodes missing: " + schemaId + ":" + String(preset.id || ""));
      assert(Array.isArray(graphSpec.edges), "preset graphSpec.edges missing: " + schemaId + ":" + String(preset.id || ""));
      const nodeByKey = {};
      graphSpec.nodes.forEach(function (node) {
        assert(String((node && node.key) || "").trim(), "preset node key missing: " + schemaId + ":" + String(preset.id || ""));
        assert(String((node && node.type) || "").trim(), "preset node type missing: " + schemaId + ":" + String(preset.id || ""));
        nodeByKey[String((node && node.key) || "")] = node || {};
      });
      graphSpec.edges.forEach(function (edge) {
        const toKey = String((edge && edge.to) || "");
        const port = String((edge && edge.in) || "");
        const toNode = nodeByKey[toKey];
        if (!toNode || String((toNode && toNode.type) || "") !== "concat") return;
        const m = port.match(/^input_(\d+)$/);
        if (!m) return;
        const need = Number(m[1] || 0);
        const have = Number((((toNode || {}).config || {}).numInputs) || 0);
        assert(need <= have, "concat numInputs too small: " + schemaId + ":" + String(preset.id || "") + " need=" + need + " have=" + have);
      });
    });

    const palette = (((schema || {}).model || {}).metadata || {}).featureNodes || {};
    const paletteItems = (((palette || {}).palette || {}).items) || [];
    assert(Array.isArray(paletteItems) && paletteItems.length > 0, "palette items missing: " + schemaId);
    paletteItems.forEach(function (entry) {
      assert(String((entry && entry.uiKey) || "").trim(), "palette uiKey missing: " + schemaId);
      assert(String((entry && entry.type) || "").trim(), "palette type missing: " + schemaId);
      assert(String((entry && entry.label) || "").trim(), "palette label missing: " + schemaId);
      assert(String((entry && entry.section) || "").trim(), "palette section missing: " + schemaId);
      assert(entry && typeof entry.config === "object", "palette config missing: " + schemaId);
    });
  });

  console.log("PASS test_contract_schema_declarative_defs");
}

try {
  main();
} catch (err) {
  console.error("FAIL test_contract_schema_declarative_defs:", err && err.stack ? err.stack : err);
  process.exit(1);
}

#!/usr/bin/env node
"use strict";

const assert = require("assert");
const schemaRegistry = require("../src/schema_registry.js");
require("../src/schema_definitions_builtin.js");

function main() {
  assert(schemaRegistry, "schema registry is required");
  assert.strictEqual(schemaRegistry.getDefaultSchemaId(), "oscillator");

  const all = schemaRegistry.listSchemas();
  const ids = all.map((x) => String(x.id || ""));
  assert(ids.includes("oscillator"), "oscillator schema must exist");
  assert(ids.includes("mnist"), "mnist schema must exist");

  const mnistDs = schemaRegistry.getDatasetSchema("mnist");
  assert(mnistDs, "mnist dataset schema must exist");
  assert.strictEqual(mnistDs.sampleType, "image");

  const oscDs = schemaRegistry.getDatasetSchema("oscillator");
  assert(oscDs, "oscillator dataset schema must exist");
  assert.strictEqual(oscDs.sampleType, "trajectory");

  const oscOutputs = schemaRegistry.getOutputKeys("oscillator");
  assert(Array.isArray(oscOutputs) && oscOutputs.includes("x"), "oscillator outputs should include x");

  ids.forEach(function (sid) {
    const modelSchema = schemaRegistry.getModelSchema(sid);
    const pre = schemaRegistry.getModelPreconfig(sid);
    const defaultPreset = String((pre && pre.defaultPreset) || "").trim();
    const presetDefs = Array.isArray(modelSchema && modelSchema.presets) ? modelSchema.presets : [];
    presetDefs.forEach(function (p) {
      assert(p && typeof p === "object", "preset should be object for schema=" + sid);
      assert(String(p.id || "").trim(), "preset id missing for schema=" + sid);
      assert(p.metadata && typeof p.metadata === "object", "preset metadata missing for schema=" + sid + " preset=" + String(p.id || ""));
      assert(p.metadata.graphSpec && typeof p.metadata.graphSpec === "object", "preset graphSpec missing for schema=" + sid + " preset=" + String(p.id || ""));
      assert(Array.isArray(p.metadata.graphSpec.nodes) && p.metadata.graphSpec.nodes.length > 0, "preset graphSpec.nodes missing for schema=" + sid + " preset=" + String(p.id || ""));
      assert(Array.isArray(p.metadata.graphSpec.edges), "preset graphSpec.edges missing for schema=" + sid + " preset=" + String(p.id || ""));
    });
    if (!defaultPreset) return;
    const presetSet = new Set(
      presetDefs.map(function (p) { return String((p && p.id) || "").trim(); })
    );
    assert(presetSet.has(defaultPreset), "default model preset for schema=" + sid + " should exist in preset list");
  });

  console.log("PASS test_contract_schema_registry");
}

try {
  main();
} catch (err) {
  console.error("FAIL test_contract_schema_registry:", err && err.stack ? err.stack : err);
  process.exit(1);
}

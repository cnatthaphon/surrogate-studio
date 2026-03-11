#!/usr/bin/env node
"use strict";

const assert = require("assert");

function makeMockSourceRecords(count) {
  const n = Math.max(40, Number(count) || 200);
  const x = new Array(n);
  const y = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const row = new Array(28 * 28);
    const label = i % 10;
    for (let j = 0; j < row.length; j += 1) {
      row[j] = ((j + label * 5) % 255) / 255;
    }
    x[i] = row;
    y[i] = label;
  }
  return { x, y };
}

async function main() {
  globalThis.OSCSchemaRegistry = require("../src/schema_registry.js");
  require("../src/schema_definitions_builtin.js");
  globalThis.OSCDatasetModules = require("../src/dataset_modules.js");
  const runtime = require("../src/dataset_runtime.js");

  assert(runtime, "dataset runtime is required");
  assert.strictEqual(typeof runtime.listModules, "function", "listModules missing");
  assert.strictEqual(typeof runtime.buildDataset, "function", "buildDataset missing");

  const modules = runtime.listModules();
  const ids = modules.map((x) => String((x && x.id) || ""));
  assert(ids.includes("oscillator"), "runtime missing oscillator module");
  assert(ids.includes("mnist"), "runtime missing mnist module");
  assert(ids.includes("fashion_mnist"), "runtime missing fashion_mnist module");

  const splitDefs = runtime.getSplitModeDefs("mnist");
  const splitIds = splitDefs.map((x) => String((x && x.id) || ""));
  assert(splitIds.includes("random"), "mnist split mode random missing");
  assert(splitIds.includes("stratified_label"), "mnist split mode stratified_label missing");

  const mnistModules = runtime.getModulesForSchema("mnist");
  assert(Array.isArray(mnistModules) && mnistModules.length >= 1, "mnist modules for schema missing");
  const defaultMnistModule = runtime.pickDefaultModuleForSchema("mnist");
  assert(defaultMnistModule, "default mnist module missing");

  const ds = await runtime.buildDataset(defaultMnistModule, {
    seed: 99,
    totalCount: 100,
    sourceRecords: makeMockSourceRecords(260),
  });
  assert(ds && typeof ds === "object", "runtime buildDataset failed");
  assert.strictEqual(String(ds.schemaId), "mnist", "runtime built dataset schema mismatch");

  const fashionDs = await runtime.buildDataset("fashion_mnist", {
    seed: 7,
    totalCount: 80,
    sourceRecords: makeMockSourceRecords(240),
  });
  assert(fashionDs && typeof fashionDs === "object", "runtime buildDataset fashion_mnist failed");
  assert.strictEqual(String(fashionDs.schemaId), "fashion_mnist", "runtime fashion dataset schema mismatch");
  assert(Array.isArray(fashionDs.classNames) && fashionDs.classNames.length === 10, "fashion classNames invalid");
  assert(String(fashionDs.classNames[0] || "").toLowerCase().indexOf("t-shirt") >= 0, "fashion classNames not detected");

  const oscProfile = runtime.getUiProfile("oscillator");
  assert.strictEqual(String(oscProfile.viewer), "trajectory", "oscillator ui viewer must be trajectory");
  const mnistProfile = runtime.getUiProfile("mnist");
  assert.strictEqual(String(mnistProfile.viewer), "image", "mnist ui viewer must be image");

  console.log("PASS test_contract_dataset_runtime");
}

main().catch((err) => {
  console.error("FAIL test_contract_dataset_runtime:", err && err.stack ? err.stack : err);
  process.exit(1);
});

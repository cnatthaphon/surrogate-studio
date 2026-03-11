#!/usr/bin/env node
"use strict";

const assert = require("assert");
const core = require("../src/entity_create_core.js");

function main() {
  assert(core && typeof core === "object", "entity_create_core missing");
  assert.strictEqual(typeof core.pickOptionValue, "function", "pickOptionValue missing");
  assert.strictEqual(typeof core.buildSchemaOptions, "function", "buildSchemaOptions missing");
  assert.strictEqual(typeof core.normalizeCreateForm, "function", "normalizeCreateForm missing");

  const picked = core.pickOptionValue(
    [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    "b"
  );
  assert.strictEqual(picked, "b", "pickOptionValue should keep preferred");

  const schemaOptions = core.buildSchemaOptions(
    [{ id: "mnist", label: "MNIST" }],
    function (sid) { return String(sid || "").toLowerCase(); }
  );
  assert.strictEqual(schemaOptions.length, 1, "schema options length mismatch");
  assert.strictEqual(schemaOptions[0].value, "mnist", "schema option value mismatch");

  const datasetOut = core.normalizeCreateForm(
    {
      kind: "dataset",
      defaultSchemaId: "mnist",
      defaultRuntime: "js_client",
      defaultRuntimeBackend: "auto",
      schemaEntries: [{ id: "mnist", label: "MNIST" }],
    },
    {
      name: "dataset_1",
      schemaId: "mnist",
    },
    {
      resolveSchemaId: function (sid) { return String(sid || "").toLowerCase(); },
      normalizeRuntimeId: function (rid) { return String(rid || "js_client"); },
      normalizeRuntimeBackend: function (_rid, backend) { return String(backend || "auto"); },
    }
  );
  assert.strictEqual(datasetOut.schemaId, "mnist", "dataset schema mismatch");
  assert.strictEqual(datasetOut.moduleId, "", "dataset create form must not expose module selection");

  const modelOut = core.normalizeCreateForm(
    {
      kind: "model",
      defaultSchemaId: "fashion_mnist",
      defaultRuntime: "js_client",
      defaultRuntimeBackend: "auto",
      schemaEntries: [{ id: "mnist", label: "MNIST" }, { id: "fashion_mnist", label: "Fashion-MNIST" }],
    },
    {
      name: "model_1",
      schemaId: "fashion_mnist",
      moduleId: "fashion_mnist",
    },
    {
      resolveSchemaId: function (sid) { return String(sid || "").toLowerCase(); },
      normalizeRuntimeId: function (rid) { return String(rid || "js_client"); },
      normalizeRuntimeBackend: function (_rid, backend) { return String(backend || "auto"); },
    }
  );
  assert.strictEqual(modelOut.schemaId, "fashion_mnist", "model schema mismatch");
  assert.strictEqual(modelOut.moduleId, "", "model must not carry dataset module");

  const trainerOut = core.normalizeCreateForm(
    {
      kind: "trainer",
      defaultSchemaId: "oscillator",
      defaultRuntime: "js_client",
      defaultRuntimeBackend: "auto",
      schemaEntries: [{ id: "oscillator", label: "Oscillator" }],
    },
    {
      name: "trainer_1",
      schemaId: "oscillator",
    },
    {
      resolveSchemaId: function (sid) { return String(sid || "").toLowerCase(); },
      normalizeRuntimeId: function (rid) { return String(rid || "js_client"); },
      normalizeRuntimeBackend: function (_rid, backend) { return String(backend || "auto"); },
    }
  );
  assert.strictEqual(trainerOut.modelId, "", "trainer model must be empty on create");
  assert.strictEqual(trainerOut.datasetId, "", "trainer dataset must be empty on create");
  assert.strictEqual(trainerOut.schemaId, "oscillator", "trainer schema mismatch");
  assert.strictEqual(trainerOut.runtime, "js_client", "trainer runtime mismatch");
  assert.strictEqual(trainerOut.runtimeBackend, "auto", "trainer runtime backend mismatch");

  const trainerSchemaOut = core.normalizeCreateForm(
    {
      kind: "trainer",
      defaultSchemaId: "oscillator",
      defaultRuntime: "js_client",
      defaultRuntimeBackend: "auto",
      schemaEntries: [{ id: "oscillator", label: "Oscillator" }, { id: "mnist", label: "MNIST" }],
    },
    {
      name: "trainer_2",
      schemaId: "mnist",
    },
    {
      resolveSchemaId: function (sid) { return String(sid || "").toLowerCase(); },
      normalizeRuntimeId: function (rid) { return String(rid || "js_client"); },
      normalizeRuntimeBackend: function (_rid, backend) { return String(backend || "auto"); },
    }
  );
  assert.strictEqual(trainerSchemaOut.schemaId, "mnist", "trainer schema select mismatch");
  assert.strictEqual(trainerSchemaOut.modelId, "", "trainer model must stay empty after schema select");
  assert.strictEqual(trainerSchemaOut.datasetId, "", "trainer dataset must stay empty after schema select");

  console.log("PASS test_contract_entity_create_core");
}

try {
  main();
} catch (err) {
  console.error("FAIL test_contract_entity_create_core:", err && err.stack ? err.stack : err);
  process.exit(1);
}

#!/usr/bin/env node
"use strict";

const assert = require("assert");
const workspaceStore = require("../src/workspace_store.js");

function main() {
  assert(workspaceStore, "workspace_store module required");
  assert.strictEqual(typeof workspaceStore.createMemoryStore, "function", "createMemoryStore missing");

  const store = workspaceStore.createMemoryStore();
  assert(store && typeof store.snapshot === "function", "memory store invalid");

  store.upsertDataset({ id: "ds_1", name: "dataset_1", schemaId: "mnist" });
  store.upsertModel({ id: "m_1", name: "model_1", schemaId: "mnist" });
  store.upsertTrainerCard({ id: "t_1", name: "trainer_1", schemaId: "mnist", modelId: "m_1", datasetId: "ds_1" });
  store.appendTrainerEpoch("t_1", { epoch: 1, loss: 0.123 });
  store.appendTrainerEpoch("t_1", { epoch: 2, loss: 0.111 });

  let snap = store.snapshot();
  assert(snap.datasetsById && snap.datasetsById.ds_1, "dataset not stored");
  assert(snap.modelsById && snap.modelsById.m_1, "model not stored");
  assert(snap.trainerCardsById && snap.trainerCardsById.t_1, "trainer card not stored");
  assert(Array.isArray(snap.trainEpochsBySessionId.t_1), "trainer epochs missing");
  assert.strictEqual(snap.trainEpochsBySessionId.t_1.length, 2, "trainer epochs length mismatch");
  assert.strictEqual(typeof store.getDataset, "function", "getDataset missing");
  assert.strictEqual(typeof store.listDatasets, "function", "listDatasets missing");
  assert.strictEqual(typeof store.getModel, "function", "getModel missing");
  assert.strictEqual(typeof store.listModels, "function", "listModels missing");
  assert.strictEqual(typeof store.getTrainerCard, "function", "getTrainerCard missing");
  assert.strictEqual(typeof store.listTrainerCards, "function", "listTrainerCards missing");
  assert.strictEqual(typeof store.getTrainerEpochs, "function", "getTrainerEpochs missing");
  assert.strictEqual(typeof store.query, "function", "query missing");
  assert.strictEqual(typeof store.save, "function", "save missing");
  assert.strictEqual(typeof store.list, "function", "list missing");
  assert.strictEqual(typeof store.get, "function", "get missing");
  assert.strictEqual(typeof store.remove, "function", "remove missing");
  assert.strictEqual(typeof store.initTables, "function", "initTables missing");

  assert(store.getDataset("ds_1"), "getDataset should return row");
  assert.strictEqual(store.listDatasets({ schemaId: "mnist" }).length, 1, "listDatasets schema filter mismatch");
  assert(store.getModel("m_1"), "getModel should return row");
  assert.strictEqual(store.listModels({ schemaId: "mnist" }).length, 1, "listModels schema filter mismatch");
  assert(store.getTrainerCard("t_1"), "getTrainerCard should return row");
  assert.strictEqual(store.listTrainerCards({ schemaId: "mnist" }).length, 1, "listTrainerCards schema filter mismatch");
  assert.strictEqual(store.getTrainerEpochs("t_1").length, 2, "getTrainerEpochs length mismatch");
  assert.strictEqual(store.query("dataset").length, 1, "query(dataset) mismatch");
  assert.strictEqual(store.query("model").length, 1, "query(model) mismatch");
  assert.strictEqual(store.query("trainer").length, 1, "query(trainer) mismatch");
  store.initTables({ tables: ["metrics"] });
  store.save({ table: "metrics", values: [{ id: "m1", name: "metric-1", kind: "loss" }] });
  assert.strictEqual(store.list({ table: "metrics" }).length, 1, "list(metrics) mismatch");
  assert(store.get({ table: "metrics", id: "m1" }), "get(metrics,m1) should return row");
  assert.strictEqual(store.remove({ table: "metrics", id: "m1" }), 1, "remove(metrics,m1) should return 1");
  assert.strictEqual(store.list({ table: "metrics" }).length, 0, "metrics should be empty after remove");

  assert.strictEqual(typeof store.clearTrainerEpochs, "function", "clearTrainerEpochs missing");
  store.clearTrainerEpochs("t_1");
  assert.strictEqual(store.getTrainerEpochs("t_1").length, 0, "clearTrainerEpochs did not clear");
  assert.strictEqual(typeof store.replaceTrainerEpochs, "function", "replaceTrainerEpochs missing");
  store.replaceTrainerEpochs("t_1", [{ epoch: 9, loss: 0.09 }]);
  assert.strictEqual(store.getTrainerEpochs("t_1").length, 1, "replaceTrainerEpochs length mismatch");
  assert.strictEqual(Number(store.getTrainerEpochs("t_1")[0].epoch), 9, "replaceTrainerEpochs value mismatch");

  store.removeTrainerCard("t_1");
  snap = store.snapshot();
  assert(!snap.trainerCardsById.t_1, "trainer card not removed");
  assert(!snap.trainEpochsBySessionId.t_1, "trainer epochs should be removed with trainer card");

  store.upsertDataset({ id: "ds_2", name: "dataset_2", schemaId: "oscillator" });
  store.upsertModel({ id: "m_2", name: "model_2", schemaId: "oscillator" });
  assert.strictEqual(typeof store.removeDataset, "function", "removeDataset missing");
  assert.strictEqual(typeof store.removeModel, "function", "removeModel missing");
  assert.strictEqual(store.removeDataset("ds_2"), true, "removeDataset should return true");
  assert.strictEqual(store.removeModel("m_2"), true, "removeModel should return true");
  assert.strictEqual(store.getDataset("ds_2"), null, "dataset should be removed");
  assert.strictEqual(store.getModel("m_2"), null, "model should be removed");

  const normalized = workspaceStore.normalizeDoc({
    datasetsById: { d: { id: "d" } },
    modelsById: { m: { id: "m" } },
    trainerCardsById: { t: { id: "t" } },
    trainEpochsBySessionId: { t: [{ epoch: 1 }] },
    meta: { x: 1 },
  });
  assert(normalized && normalized.datasetsById && normalized.datasetsById.d, "normalizeDoc failed for datasets");
  assert(normalized.modelsById && normalized.modelsById.m, "normalizeDoc failed for models");
  assert(normalized.trainerCardsById && normalized.trainerCardsById.t, "normalizeDoc failed for cards");
  assert(Array.isArray(normalized.trainEpochsBySessionId.t), "normalizeDoc failed for epochs");

  console.log("PASS test_contract_workspace_store");
}

try {
  main();
} catch (err) {
  console.error("FAIL test_contract_workspace_store:", err && err.stack ? err.stack : err);
  process.exit(1);
}

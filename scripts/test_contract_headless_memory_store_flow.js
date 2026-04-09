#!/usr/bin/env node
"use strict";

const assert = require("assert");
const api = require("../src/workflow_api_core.js");

(async function main() {
  const store = await api.buildWorkspaceStore("memory");
  assert.ok(store && typeof store.upsertDataset === "function", "memory store invalid");

  const dataset = await api.create_dataset({
    store,
    schema: "fashion_mnist",
    name: "memory_fashion_dataset",
    seed: 42,
    sourceMode: "synthetic",
    sourceTotalExamples: 1200,
    splitMode: "stratified_label",
    trainFrac: 0.7,
    valFrac: 0.15,
    testFrac: 0.15,
  });
  assert.ok(store.getDataset(dataset.id), "dataset should persist in memory store");

  const model = api.create_model({
    store,
    schema: "fashion_mnist",
    modelName: "memory_fashion_model",
    preset: "fashion_mnist_mlp_baseline",
  });
  assert.ok(store.getModel(model.id), "model should persist in memory store");

  const trainer = api.create_trainner({
    store,
    datasetRef: { id: dataset.id },
    modelRef: { id: model.id },
    name: "memory_fashion_trainer",
    runtime: "js_client",
    runtimeBackend: "webgl",
    trainCfg: {
      epochs: 3,
      batchSize: 16,
      learningRate: 1e-3,
      useLrScheduler: false,
    },
  });
  const storedTrainerBefore = store.getTrainerCard(trainer.id);
  assert.ok(storedTrainerBefore, "trainer should persist in memory store");
  assert.strictEqual(String(storedTrainerBefore.datasetId), String(dataset.id), "trainer datasetId mismatch");
  assert.strictEqual(String(storedTrainerBefore.modelId), String(model.id), "trainer modelId mismatch");

  const trainOut = await api.run_trainner({
    store,
    trainerId: trainer.id,
    compileModelArtifacts: async function (ctx) {
      assert.strictEqual(String(ctx.model.id), String(model.id), "compile hook model mismatch");
      assert.strictEqual(String(ctx.dataset.id), String(dataset.id), "compile hook dataset mismatch");
      return { modelTopology: { class_name: "Sequential" }, weightSpecs: [], weightData: new ArrayBuffer(0) };
    },
    runTrainingInWorker: async function (spec) {
      assert.strictEqual(String(spec.runId), String(trainer.id), "runId should match trainer id");
      assert.ok(spec.dataset && (spec.dataset.splitIndices || (spec.dataset.records && spec.dataset.records.train)), "dataset payload should come from store");
      return {
        metrics: { mae: 0.1, testMae: 0.2, bestValLoss: 0.05, bestEpoch: 2, finalLr: 1e-4, stoppedEarly: false },
        history: {
          epoch: [1, 2, 3],
          loss: [1.0, 0.7, 0.4],
          val_loss: [1.1, 0.8, 0.5],
          lr: [1e-3, 5e-4, 1e-4],
        },
        modelArtifacts: { modelTopology: { class_name: "Sequential" }, weightSpecs: [], weightData: new ArrayBuffer(0) },
        generatedBy: "memory-contract-test",
      };
    },
  });

  assert.strictEqual(String(trainOut.trainerId), String(trainer.id), "run output trainerId mismatch");
  assert.strictEqual(Number(trainOut.storedEpochs), 3, "stored epochs mismatch");

  const epochs = store.getTrainerEpochs(trainer.id);
  assert.strictEqual(epochs.length, 3, "epochs should persist in memory store");
  assert.strictEqual(Number(epochs[2].train_loss), 0.4, "final train loss mismatch");

  const storedTrainerAfter = store.getTrainerCard(trainer.id);
  assert.ok(storedTrainerAfter && storedTrainerAfter.lastResult, "trainer lastResult should persist");
  assert.strictEqual(String(storedTrainerAfter.lastResult.generatedBy), "memory-contract-test", "generatedBy mismatch");
  assert.strictEqual(Number(storedTrainerAfter.lastResult.metrics.bestEpoch), 2, "metrics bestEpoch mismatch");

  console.log("PASS test_contract_headless_memory_store_flow");
})().catch(function (err) {
  console.error("FAIL test_contract_headless_memory_store_flow:", err && err.stack ? err.stack : err);
  process.exit(1);
});

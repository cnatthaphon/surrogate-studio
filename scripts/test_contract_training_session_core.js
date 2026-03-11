#!/usr/bin/env node
"use strict";

const assert = require("assert");
const core = require("../src/training_session_core.js");

(async function main() {
  assert.ok(core && typeof core.createWorkerTrainSpec === "function");
  assert.ok(core && typeof core.runWorkerTraining === "function");

  const spec = core.createWorkerTrainSpec({
    runId: "run_contract",
    modelArtifacts: { modelTopology: { class_name: "Sequential" } },
    dataset: { yTrain: [1, 2], yVal: [1], yTest: [1] },
    epochs: 3,
    batchSize: 16,
    learningRate: 1e-3,
    useLrScheduler: false,
  });

  assert.strictEqual(String(spec.runId), "run_contract");
  assert.strictEqual(Number(spec.epochs), 3);
  assert.strictEqual(Number(spec.batchSize), 16);
  assert.strictEqual(Boolean(spec.useLrScheduler), false);

  let called = 0;
  const out = await core.runWorkerTraining(spec, {
    runTrainingInWorker: async function (inSpec) {
      called += 1;
      assert.strictEqual(String(inSpec.runId), "run_contract");
      return {
        metrics: { mae: 0.1, testMae: 0.2, bestValLoss: 0.05, bestEpoch: 2, finalLr: 1e-4, stoppedEarly: false },
        history: { epoch: [1, 2, 3], loss: [1, 0.8, 0.7], val_loss: [1.1, 0.9, 0.75], lr: [1e-3, 5e-4, 1e-4] },
        modelArtifacts: { modelTopology: { class_name: "Sequential" }, weightSpecs: [], weightData: new ArrayBuffer(0) },
        generatedBy: "unit-test",
      };
    },
  });

  assert.strictEqual(called, 1);
  assert.ok(out && out.metrics && out.modelArtifacts);
  assert.strictEqual(String(out.generatedBy), "unit-test");

  let missingRunner = false;
  try {
    await core.runWorkerTraining(spec, {});
  } catch (_err) {
    missingRunner = true;
  }
  assert.ok(missingRunner, "missing runner should throw");

  let missingMetrics = false;
  try {
    await core.runWorkerTraining(spec, {
      runTrainingInWorker: async function () {
        return { modelArtifacts: { modelTopology: {} } };
      },
    });
  } catch (_err) {
    missingMetrics = true;
  }
  assert.ok(missingMetrics, "missing metrics should throw");

  console.log("PASS test_contract_training_session_core");
})().catch(function (err) {
  console.error("FAIL test_contract_training_session_core:", err && err.stack ? err.stack : err);
  process.exit(1);
});


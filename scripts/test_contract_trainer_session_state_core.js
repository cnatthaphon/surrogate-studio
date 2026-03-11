#!/usr/bin/env node
"use strict";

const assert = require("assert");
const core = require("../src/trainer_session_state_core.js");

function main() {
  assert(core && typeof core.createEmptyHistory === "function", "createEmptyHistory missing");
  assert(core && typeof core.normalizeStatus === "function", "normalizeStatus missing");
  assert(core && typeof core.normalizeLockState === "function", "normalizeLockState missing");
  assert(core && typeof core.clearState === "function", "clearState missing");
  assert(core && typeof core.applyRuntimeEvent === "function", "applyRuntimeEvent missing");

  const empty = core.createEmptyHistory();
  assert.deepStrictEqual(empty, { epoch: [], loss: [], val_loss: [], lr: [] }, "empty history shape mismatch");

  const draftSession = { datasetId: "", modelId: "" };
  assert.strictEqual(core.normalizeStatus(draftSession), "draft", "draft status mismatch");

  const readySession = { datasetId: "ds_1", modelId: "model_1", history: core.createEmptyHistory(), lastResult: null };
  assert.strictEqual(core.normalizeStatus(readySession), "ready", "ready status mismatch");

  const runningSession = {
    datasetId: "ds_1",
    modelId: "model_1",
    runtime: "js_client",
    runtimeBackend: "auto",
    history: core.createEmptyHistory(),
    lastResult: null,
  };
  core.applyRuntimeEvent(runningSession, {
    kind: "run_started",
    ts: 1,
    runtimeId: "js_client",
    runtime: { backend: "webgl", transport: "inproc", engine: "tfjs", host: "browser" },
    status: { state: "running", message: "Started." },
  });
  assert.strictEqual(String(runningSession.status), "running", "run_started should set running status");
  assert.strictEqual(Boolean(runningSession.lockState.datasetLocked), true, "run_started should lock dataset");
  assert.strictEqual(Boolean(runningSession.lockState.modelLocked), true, "run_started should lock model");
  assert.strictEqual(Boolean(runningSession.lockState.runtimeLocked), true, "run_started should lock runtime");

  core.applyRuntimeEvent(runningSession, {
    kind: "epoch_end",
    ts: 2,
    metrics: { epoch: 1, train_loss: 0.9, val_loss: 1.1, lr: 1e-3 },
    status: { state: "running", message: "Epoch 1 complete." },
  });
  assert.deepStrictEqual(runningSession.history.epoch, [1], "epoch should append");
  assert.deepStrictEqual(runningSession.history.loss, [0.9], "loss should append");

  core.applyRuntimeEvent(runningSession, {
    kind: "run_completed",
    ts: 3,
    metrics: { val_mae: 0.1, test_mae: 0.2, best_val_loss: 0.05, best_epoch: 1, final_lr: 1e-4 },
    status: { state: "completed", message: "Done." },
  });
  assert.strictEqual(String(runningSession.status), "completed", "run_completed should set completed status");
  assert.strictEqual(Number(runningSession.lastResult.valMae), 0.1, "valMae mismatch");
  assert.strictEqual(Boolean(runningSession.lockState.datasetLocked), true, "completed should keep lock");

  core.clearState(runningSession, "dataset changed");
  assert.strictEqual(String(runningSession.status), "ready", "clearState should reset to ready");
  assert.deepStrictEqual(runningSession.history, { epoch: [], loss: [], val_loss: [], lr: [] }, "clearState should wipe history");
  assert.strictEqual(runningSession.lastResult, null, "clearState should wipe result");
  assert.strictEqual(Boolean(runningSession.lockState.datasetLocked), false, "clearState should unlock dataset");
  assert.strictEqual(Boolean(runningSession.lockState.modelLocked), false, "clearState should unlock model");
  assert.strictEqual(Boolean(runningSession.lockState.runtimeLocked), false, "clearState should unlock runtime");

  const skipped = {
    datasetId: "ds_1",
    modelId: "model_1",
    runtime: "server_pytorch_gpu",
    runtimeBackend: "gpu",
    history: core.createEmptyHistory(),
  };
  core.applyRuntimeEvent(skipped, {
    kind: "run_skipped",
    status: { state: "skipped", message: "Skipped." },
  });
  assert.strictEqual(String(skipped.status), "ready", "run_skipped should stay ready");
  assert.strictEqual(Boolean(skipped.lockState.datasetLocked), false, "run_skipped should not lock dataset");

  console.log("PASS test_contract_trainer_session_state_core");
}

main();

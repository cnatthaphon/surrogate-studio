#!/usr/bin/env node
"use strict";

const path = require("path");
const assert = require("assert");

const bridge = require(path.join(__dirname, "..", "src", "training_worker_bridge.js"));

function makeFakeWorkerCtor(mode) {
  const state = { instances: [] };
  class FakeWorker {
    constructor(workerPath) {
      this.workerPath = String(workerPath || "");
      this.onmessage = null;
      this.onerror = null;
      this.terminated = false;
      this.lastPosted = null;
      this.lastTransfer = null;
      state.instances.push(this);
    }
    postMessage(payload, transfer) {
      this.lastPosted = payload;
      this.lastTransfer = Array.isArray(transfer) ? transfer : [];
      const self = this;
      if (mode === "error") {
        setTimeout(function () {
          if (typeof self.onmessage === "function") {
            self.onmessage({ data: { kind: "error", error: { message: "simulated worker error", reason: "simulated" } } });
          }
        }, 0);
        return;
      }
      if (mode === "onerror") {
        setTimeout(function () {
          if (typeof self.onerror === "function") {
            self.onerror({ message: "simulated onerror" });
          }
        }, 0);
        return;
      }
      setTimeout(function () {
        if (typeof self.onmessage === "function") self.onmessage({ data: { kind: "ready", backend: "webgl" } });
        if (typeof self.onmessage === "function") self.onmessage({ data: { kind: "epoch", payload: { epoch: 1, loss: 0.9, val_loss: 0.8, lr: 1e-3 }, history: { epoch: [1], loss: [0.9], val_loss: [0.8], lr: [1e-3] } } });
        if (typeof self.onmessage === "function") self.onmessage({ data: { kind: "epoch", payload: { epoch: 2, loss: 0.6, val_loss: 0.5, lr: 1e-3 }, history: { epoch: [1, 2], loss: [0.9, 0.6], val_loss: [0.8, 0.5], lr: [1e-3, 1e-3] } } });
        if (typeof self.onmessage === "function") self.onmessage({ data: { kind: "complete", result: { metrics: { mae: 0.123 }, modelArtifacts: { modelTopology: {}, weightSpecs: [], weightData: new ArrayBuffer(0) } } } });
      }, 0);
    }
    terminate() {
      this.terminated = true;
    }
  }
  FakeWorker.__state = state;
  return FakeWorker;
}

async function testSuccessPath() {
  const WorkerCtor = makeFakeWorkerCtor("success");
  const epochEvents = [];
  const busyEvents = [];
  const result = await bridge.runTrainingInWorker({
    runId: "run-success",
    dataset: { xTrain: [[0]], yTrain: [[0]], xVal: [[0]], yVal: [[0]], xTest: [[0]], yTest: [[0]], featureSize: 1, targetSize: 1 },
    modelArtifacts: { modelTopology: {}, weightSpecs: [], weightData: new ArrayBuffer(0) },
    onEpochData: function (payload, history) {
      epochEvents.push({ payload, history });
    },
  }, {
    workerPath: "/tmp/training_worker.js",
    WorkerCtor: WorkerCtor,
    setBusy: function (busy, workerRef) {
      busyEvents.push({ busy: Boolean(busy), hasWorker: Boolean(workerRef) });
    },
  });

  assert.strictEqual(Number(result.metrics && result.metrics.mae), 0.123, "Expected final metrics from worker result.");
  assert.strictEqual(epochEvents.length, 2, "Expected two epoch events.");
  assert.strictEqual(epochEvents[0].payload.epoch, 1);
  assert.strictEqual(epochEvents[1].payload.epoch, 2);
  assert.strictEqual(busyEvents.length >= 2, true, "Expected busy state set/unset.");
  assert.strictEqual(busyEvents[0].busy, true);
  assert.strictEqual(busyEvents[busyEvents.length - 1].busy, false);
  assert.strictEqual(WorkerCtor.__state.instances.length, 1);
  assert.strictEqual(WorkerCtor.__state.instances[0].terminated, true, "Worker must terminate on completion.");
}

async function testErrorMessagePath() {
  const WorkerCtor = makeFakeWorkerCtor("error");
  let failed = false;
  try {
    await bridge.runTrainingInWorker({
      runId: "run-error",
      dataset: {},
      modelArtifacts: {},
    }, {
      workerPath: "/tmp/training_worker.js",
      WorkerCtor: WorkerCtor,
    });
  } catch (err) {
    failed = true;
    assert.ok(String(err.message || "").indexOf("simulated worker error") >= 0);
  }
  assert.strictEqual(failed, true, "Expected rejection on worker error message.");
}

async function testOnErrorPath() {
  const WorkerCtor = makeFakeWorkerCtor("onerror");
  let failed = false;
  try {
    await bridge.runTrainingInWorker({
      runId: "run-onerror",
      dataset: {},
      modelArtifacts: {},
    }, {
      workerPath: "/tmp/training_worker.js",
      WorkerCtor: WorkerCtor,
    });
  } catch (err) {
    failed = true;
    assert.ok(String(err.message || "").indexOf("simulated onerror") >= 0);
  }
  assert.strictEqual(failed, true, "Expected rejection on worker onerror.");
}

async function testNoWorkerCtorPath() {
  let failed = false;
  try {
    await bridge.runTrainingInWorker({}, { workerPath: "/tmp/training_worker.js", WorkerCtor: null });
  } catch (err) {
    failed = true;
    assert.ok(String(err.message || "").toLowerCase().indexOf("worker") >= 0);
  }
  assert.strictEqual(failed, true, "Expected rejection when Worker ctor is missing.");
}

(async function main() {
  await testSuccessPath();
  await testErrorMessagePath();
  await testOnErrorPath();
  await testNoWorkerCtorPath();
  console.log("PASS test_contract_training_worker_bridge");
})().catch(function (err) {
  console.error("FAIL test_contract_training_worker_bridge:", err && err.stack ? err.stack : err);
  process.exit(1);
});


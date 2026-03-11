#!/usr/bin/env node
"use strict";

const assert = require("assert");
const adapter = require("../src/dataset_bundle_adapter.js");

function buildToyOscillatorDataset() {
  return {
    schemaId: "oscillator",
    name: "toy_osc",
    mode: "mixed",
    seed: 42,
    splitConfig: { mode: "random", train: 0.7, val: 0.2, test: 0.1 },
    trajectories: [
      {
        params: { scenario: "spring", m: 1, c: 0.1, k: 4, x0: 0.5, v0: 0 },
        t: [0, 0.1, 0.2],
        x: [0.5, 0.4, 0.3],
        v: [0, -0.8, -0.7],
      },
      {
        params: { scenario: "pendulum", m: 1.2, c: 0.15, k: 1.8, x0: 0.2, v0: 0.1 },
        t: [0, 0.1, 0.2],
        x: [0.2, 0.19, 0.17],
        v: [0.1, -0.05, -0.2],
      },
      {
        params: { scenario: "bouncing", m: 0.8, c: 0.02, k: 9.81, x0: 1.0, v0: 0.0, restitution: 0.8 },
        t: [0, 0.1, 0.2],
        x: [1.0, 0.95, 0.86],
        v: [0, -0.98, -1.8],
      },
    ],
  };
}

function main() {
  assert(adapter, "dataset bundle adapter required");
  assert.strictEqual(typeof adapter.buildNotebookDatasetFiles, "function", "buildNotebookDatasetFiles missing");

  const split = adapter.normalizeSplitConfig({ train: 7, val: 2, test: 1, mode: "random" });
  const s = split.train + split.val + split.test;
  assert(Math.abs(s - 1) < 1e-9, "split fractions must sum to 1");

  const oscFiles = adapter.buildNotebookDatasetFiles({
    schemaId: "oscillator",
    datasetName: "toy_osc",
    dataset: buildToyOscillatorDataset(),
  });
  assert(oscFiles && oscFiles.format === "csv_manifest", "oscillator should export csv_manifest");
  assert(Array.isArray(oscFiles.files) && oscFiles.files.length === 2, "oscillator files count mismatch");
  assert(oscFiles.files.some((f) => /\.csv$/i.test(String(f.path || ""))), "oscillator csv file missing");
  assert(oscFiles.files.some((f) => /split_manifest\.json$/i.test(String(f.path || ""))), "oscillator split manifest missing");

  const mnistFiles = adapter.buildNotebookDatasetFiles({
    schemaId: "mnist",
    datasetName: "mnist_demo",
    dataset: {
      schemaId: "mnist",
      records: { train: { x: [[0, 1]], y: [0] }, val: { x: [], y: [] }, test: { x: [], y: [] } },
      splitConfig: { mode: "random", train: 0.8, val: 0.1, test: 0.1 },
      seed: 7,
    },
  });
  assert(mnistFiles && mnistFiles.format === "csv_manifest", "mnist should export csv_manifest");
  assert(Array.isArray(mnistFiles.files) && mnistFiles.files.length === 2, "mnist files count mismatch");
  assert(mnistFiles.files.some((f) => /\.csv$/i.test(String(f.path || ""))), "mnist dataset csv missing");

  console.log("PASS test_contract_dataset_bundle_adapter");
}

try {
  main();
} catch (err) {
  console.error("FAIL test_contract_dataset_bundle_adapter:", err && err.stack ? err.stack : err);
  process.exit(1);
}

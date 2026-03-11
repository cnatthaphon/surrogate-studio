#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const api = require("../src/workflow_api_core.js");

(async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const outDir = path.join(projectRoot, "output", "contract_headless_api_flow");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const dataset = await api.create_dataset({
    schema: "fashion_mnist",
    name: "contract_fashion_dataset",
    seed: 42,
    sourceMode: "synthetic",
    sourceTotalExamples: 12000,
    splitMode: "stratified_label",
    trainFrac: 0.70,
    valFrac: 0.15,
    testFrac: 0.15,
  });
  assert.strictEqual(String(dataset.schemaId), "fashion_mnist");
  assert.ok(dataset.records && dataset.records.train && Array.isArray(dataset.records.train.x), "dataset train split must exist");
  assert.ok(dataset.records && dataset.records.val && Array.isArray(dataset.records.val.x), "dataset val split must exist");
  assert.ok(dataset.records && dataset.records.test && Array.isArray(dataset.records.test.x), "dataset test split must exist");
  assert.ok(dataset.trainCount > 0, "dataset train rows must be > 0");
  assert.ok(dataset.valCount > 0, "dataset val rows must be > 0");
  assert.ok(dataset.testCount > 0, "dataset test rows must be > 0");

  const model = api.create_model({
    schema: "fashion_mnist",
    modelName: "contract_fashion_mlp",
    preset: "fashion_mnist_mlp_baseline",
  });
  assert.strictEqual(String(model.schemaId), "fashion_mnist");
  assert.ok(model.drawflowGraph && model.drawflowGraph.drawflow, "model graph must be drawflow");

  const trainer = api.create_trainner({
    dataset: dataset,
    model: model,
    name: "contract_trainer",
    runtime: "server_pytorch_cpu",
    runtimeBackend: "cpu",
    trainCfg: { epochs: 2, batchSize: 32, learningRate: 1e-3 },
  });
  assert.strictEqual(String(trainer.schemaId), "fashion_mnist");
  assert.strictEqual(String(trainer.runtime), "server_pytorch_cpu");
  assert.strictEqual(String(trainer.runtimeFamily), "pytorch");
  assert.strictEqual(String(trainer.runtimeBackend), "cpu");

  const exported = await api.export_notebook_zip({
    sessions: [trainer],
    outputDir: outDir,
    zipName: "contract_fashion_pipeline",
  });
  assert.ok(exported && exported.zipPath && fs.existsSync(exported.zipPath), "zip output must exist");
  assert.ok(exported.summary && Number(exported.summary.sessionCount) === 1, "zip summary must include one session");
  assert.ok(Number(exported.summary.fileCount || 0) >= 3, "zip should include notebook/model/dataset files");

  const unpacked = api.unzipAndExecute({
    zipPath: exported.zipPath,
    outputDir: path.join(outDir, "zip_unpacked"),
    run: false,
  });
  assert.ok(fs.existsSync(unpacked.runNotebook), "unpacked notebook run.ipynb must exist");

  console.log("PASS test_contract_headless_api_flow");
})().catch(function (err) {
  console.error("FAIL test_contract_headless_api_flow:", err && err.stack ? err.stack : err);
  process.exit(1);
});

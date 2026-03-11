#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const api = require(path.join(ROOT, "src", "workflow_api_core.js"));

async function main() {
  const outputDir = path.join(ROOT, "output", "full_fashion_pipeline_compare");
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const store = await api.buildWorkspaceStore("memory");

  const dataset = await api.create_dataset({
    store,
    schema: "fashion_mnist",
    name: "fashion_mnist_pipeline_dataset",
    splitMode: "stratified_label",
    trainFrac: 0.8,
    valFrac: 0.1,
    testFrac: 0.1,
    seed: 42,
    totalCount: 600,
  });

  const model = api.create_model({
    store,
    schema: "fashion_mnist",
    name: "fashion_mnist_pipeline_model",
  });

  const commonTrainCfg = {
    epochs: 2,
    batchSize: 32,
    learningRate: 1e-3,
    optimizerType: "adam",
    seed: 42,
  };

  const tfjsTrainer = api.create_trainner({
    store,
    name: "fashion_mnist_tfjs_compare",
    schemaId: "fashion_mnist",
    datasetRef: { id: dataset.id },
    modelRef: { id: model.id },
    runtime: "js_client",
    trainCfg: commonTrainCfg,
  });

  const tfjsRun = await api.run_trainner({
    store,
    trainerId: tfjsTrainer.id,
  });

  const pytorchTrainer = api.create_trainner({
    store,
    name: "fashion_mnist_pytorch_compare",
    schemaId: "fashion_mnist",
    datasetRef: { id: dataset.id },
    modelRef: { id: model.id },
    runtime: "server_pytorch_gpu",
    trainCfg: commonTrainCfg,
  });

  const bundle = await api.export_notebook_zip({
    sessions: [pytorchTrainer],
    outputDir: outputDir,
    zipName: "fashion_mnist_pipeline_compare",
  });

  const executed = api.unzipAndExecute({
    zipPath: bundle.zipPath,
    outputDir: path.join(outputDir, "zip_unpacked"),
    keepOriginalName: false,
    executedName: "executed.ipynb",
  });

  const parsedReport = api.parse_executed_notebook_report({
    notebookPath: executed.executedNotebook,
  });

  api.store_executed_notebook_report({
    store,
    trainerId: pytorchTrainer.id,
    parsedReport: parsedReport,
  });

  const tfjsSaved = store.getTrainerCard(tfjsTrainer.id);
  const pytorchSaved = store.getTrainerCard(pytorchTrainer.id);
  assert.ok(tfjsSaved && tfjsSaved.lastResult, "Missing stored tfjs result.");
  assert.ok(pytorchSaved && pytorchSaved.lastResult, "Missing stored notebook result.");

  const tfjsMetrics = Object.assign({}, tfjsSaved.lastResult.metrics || {});
  const pytorchMetrics = Object.assign({}, pytorchSaved.lastResult.metrics || {});
  const tfjsAccuracy = Number(tfjsMetrics.accuracy);
  const pytorchAccuracy = Number(pytorchMetrics.accuracy);
  const accuracyDelta = Math.abs(tfjsAccuracy - pytorchAccuracy);

  assert.ok(Number.isFinite(tfjsAccuracy), "tfjs accuracy is not finite.");
  assert.ok(Number.isFinite(pytorchAccuracy), "pytorch accuracy is not finite.");
  assert.ok(accuracyDelta <= 0.10, "Accuracy delta is too large: " + accuracyDelta);

  const summary = {
    dataset: {
      id: dataset.id,
      schemaId: dataset.schemaId,
      splitCounts: {
        train: dataset.records.train.x.length,
        val: dataset.records.val.x.length,
        test: dataset.records.test.x.length,
      },
    },
    model: {
      id: model.id,
      schemaId: model.schemaId,
      preset: model.name,
    },
    tfjs: {
      trainerId: tfjsTrainer.id,
      runtime: tfjsTrainer.runtime,
      metrics: tfjsMetrics,
      storedEpochs: store.getTrainerEpochs(tfjsTrainer.id).length,
    },
    notebook: {
      trainerId: pytorchTrainer.id,
      runtime: pytorchTrainer.runtime,
      metrics: pytorchMetrics,
      parsedReport: parsedReport,
      zipPath: bundle.zipPath,
      executedNotebook: executed.executedNotebook,
    },
    compare: {
      accuracyDelta: accuracyDelta,
    },
  };

  const summaryPath = path.join(outputDir, "compare_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(JSON.stringify({
    summaryPath: summaryPath,
    tfjsAccuracy: tfjsAccuracy,
    pytorchAccuracy: pytorchAccuracy,
    accuracyDelta: accuracyDelta,
    zipPath: bundle.zipPath,
    executedNotebook: executed.executedNotebook,
  }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

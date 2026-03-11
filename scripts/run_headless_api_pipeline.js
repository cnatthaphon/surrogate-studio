#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const api = require("../src/workflow_api_core.js");

(async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const outDir = path.resolve(projectRoot, "output", "headless_api_pipeline");

  const dataset = await api.create_dataset({
    schema: "mnist",
    name: "mnist_toy_dataset_api",
    seed: 42,
    sourceMode: "synthetic",
    sourceTotalExamples: 12000,
    splitMode: "stratified_label",
    trainFrac: 0.7,
    valFrac: 0.15,
    testFrac: 0.15,
  });

  const model = api.create_model({
    schema: "mnist",
    modelName: "direct_mlp_strong",
    preset: "direct_mlp_strong",
  });

  const trainer = api.create_trainner({
    dataset,
    model,
    name: "mnist_api_session",
    runtime: "js_client",
    runtimeBackend: "webgl",
  });

  const exportResult = await api.export_notebook_zip({
    sessions: [trainer],
    outputDir: outDir,
    zipName: "mnist_api_pipeline",
    schemaId: "mnist",
  });

  const execResult = api.unzipAndExecute({
    zipPath: exportResult.zipPath,
    outputDir: path.join(outDir, "zip_unpacked"),
  });

  const summary = {
    dataset: {
      name: dataset.name,
      schema: dataset.schemaId,
      splitConfig: dataset.splitConfig,
      splitCounts: dataset.splitCounts,
      total: dataset.trainCount + dataset.valCount + dataset.testCount,
    },
    model: {
      name: model.name,
      schema: model.schemaId,
    },
    trainer: {
      id: trainer.id,
      runtime: trainer.runtime,
      runtimeBackend: trainer.runtimeBackend,
      trainCfg: trainer.trainCfg,
    },
    export: exportResult,
    executed: execResult,
  };

  const summaryPath = path.join(outDir, "pipeline_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log("SUMMARY_PATH=" + summaryPath);
  console.log(JSON.stringify(summary, null, 2));
})().catch((err) => {
  console.error("PIPELINE_FAILED:", err && err.stack ? err.stack : err);
  process.exit(1);
});

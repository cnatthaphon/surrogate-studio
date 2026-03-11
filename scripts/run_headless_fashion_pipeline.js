#!/usr/bin/env node
"use strict";

const path = require("path");
const api = require("../src/workflow_api_core.js");

(async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const outDir = path.join(projectRoot, "output", "headless_fashion_pipeline");

  const dataset = await api.create_dataset({
    schema: "fashion_mnist",
    name: "fashion_mnist_dataset_default",
    seed: 42,
    sourceMode: "synthetic",
    sourceTotalExamples: 12000,
  });

  const model = api.create_model({
    schema: "fashion_mnist",
  });

  const trainer = api.create_trainner({
    dataset,
    model,
    name: "fashion_mnist_session",
    runtime: "js_client",
    runtimeBackend: "webgl",
  });

  const exported = await api.export_notebook_zip({
    sessions: [trainer],
    outputDir: outDir,
    zipName: "fashion_mnist_pipeline",
    schemaId: "fashion_mnist",
  });

  const executed = api.unzipAndExecute({
    zipPath: exported.zipPath,
    outputDir: path.join(outDir, "zip_unpacked"),
    keepOriginalName: true,
  });

  const result = {
    dataset: {
      id: dataset.id,
      name: dataset.name,
      schemaId: dataset.schemaId,
      splitConfig: dataset.splitConfig,
      splitCounts: dataset.splitCounts,
    },
    model: {
      id: model.id,
      name: model.name,
      schemaId: model.schemaId,
    },
    trainer: {
      id: trainer.id,
      name: trainer.name,
      schemaId: trainer.schemaId,
      runtime: trainer.runtime,
      runtimeBackend: trainer.runtimeBackend,
      trainCfg: trainer.trainCfg,
    },
    exported: exported,
    executed: executed,
  };

  console.log("HEADLESS_FASHION_PIPELINE_OK");
  console.log(JSON.stringify(result, null, 2));
})().catch((err) => {
  console.error("HEADLESS_FASHION_PIPELINE_FAILED:", err && err.stack ? err.stack : err);
  process.exit(1);
});

#!/usr/bin/env node
"use strict";

const assert = require("assert");

require("../src/notebook_runtime_assets.js");
require("../src/dataset_source_descriptor.js");
const NBC = require("../src/notebook_bundle_core.js");
const DBA = require("../src/dataset_bundle_adapter.js");
require("../src/schema_registry.js");
require("../src/schema_definitions_builtin.js");

async function main() {
  const graph = {
    drawflow: { Home: { data: {
      "1": {
        name: "input_layer",
        data: { mode: "flat" },
        inputs: {},
        outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } }
      },
      "2": {
        name: "dense_layer",
        data: { units: 16, activation: "relu" },
        inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } },
        outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } }
      },
      "3": {
        name: "output_layer",
        data: { targets: ["traj"], targetType: "traj", matchWeight: 1, loss: "mse" },
        inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } },
        outputs: {}
      }
    } } }
  };

  const sourceDataset = {
    schemaId: "ais_trajectory",
    name: "ais_source_notebook_test",
    mode: "regression",
    featureSize: 64,
    targetSize: 4,
    sourceDescriptor: {
      kind: "local_json_dataset",
      schemaId: "ais_trajectory",
      datasetModuleId: "ais_module",
      datasetPath: "/tmp/ais_notebook_test.json",
      deliveryMode: "server_reference",
      preferServerSource: true,
      metadata: { note: "contract-test" }
    }
  };

  const result = await NBC.createSingleNotebookFileFromConfig({
    seed: 42,
    datasetBundleAdapter: DBA,
    returnObject: true,
    sessions: [{
      id: "ais_source_descriptor_session",
      name: "ais_source_descriptor_session",
      schemaId: "ais_trajectory",
      graph,
      runtime: "python_server",
      epochs: 3,
      batchSize: 8,
      learningRate: 0.001,
      datasetData: sourceDataset,
    }],
  });

  assert(result && result.notebook, "notebook object should be returned");
  const cellTexts = result.notebook.cells.map((cell) =>
    Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || "")
  );
  const joined = cellTexts.join("\n\n");

  assert(/DATASET_SOURCE_DESCRIPTOR_PATH = 'dataset\/[^']+\.source_descriptor\.json'/.test(joined),
    "notebook should expose a source descriptor path");
  assert(joined.includes("EMBEDDED_SOURCE_DESCRIPTOR_B64 = '"),
    "single notebook export should embed the source descriptor payload");
  assert(joined.includes("from dataset_source_loader import load_dataset_from_source_descriptor"),
    "generic notebook should load source-backed datasets through dataset_source_loader");
  assert(!joined.includes("Dataset adapter did not provide a CSV"),
    "source descriptor export should not require CSV materialization");

  console.log("PASS test_contract_notebook_source_descriptor");
}

main().catch((err) => {
  console.error("FAIL test_contract_notebook_source_descriptor:", err && err.stack ? err.stack : err);
  process.exit(1);
});

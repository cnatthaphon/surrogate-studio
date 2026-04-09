"use strict";

var assert = require("assert");

require("../src/notebook_runtime_assets.js");
var NBC = require("../src/notebook_bundle_core.js");
var DBA = require("../src/dataset_bundle_adapter.js");
require("../src/schema_registry.js");
require("../src/schema_definitions_builtin.js");

function _makeRows(n, dim, offset) {
  var rows = [];
  for (var i = 0; i < n; i += 1) {
    var row = [];
    for (var j = 0; j < dim; j += 1) {
      row.push(((i + j + offset) % 17) / 16);
    }
    rows.push(row);
  }
  return rows;
}

async function main() {
  var featureSize = 64;
  var targetSize = 4;
  var dataset = {
    schemaId: "ais_trajectory",
    name: "ais_notebook_test",
    mode: "regression",
    featureSize: featureSize,
    targetSize: targetSize,
    xTrain: _makeRows(18, featureSize, 0),
    yTrain: _makeRows(18, targetSize, 3),
    xVal: _makeRows(6, featureSize, 5),
    yVal: _makeRows(6, targetSize, 8),
    xTest: _makeRows(6, featureSize, 9),
    yTest: _makeRows(6, targetSize, 12),
  };

  var graph = {
    drawflow: { Home: { data: {
      "1": {
        name: "input_layer",
        data: { mode: "flat" },
        inputs: {},
        outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } }
      },
      "2": {
        name: "dense_layer",
        data: { units: 32, activation: "relu" },
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

  var result = await NBC.createSingleNotebookFileFromConfig({
    seed: 42,
    datasetBundleAdapter: DBA,
    returnObject: true,
    sessions: [{
      id: "ais_export_test",
      name: "ais_export_test",
      schemaId: "ais_trajectory",
      graph: graph,
      runtime: "python_server",
      epochs: 3,
      batchSize: 8,
      learningRate: 0.001,
      datasetData: dataset,
    }],
  });

  assert(result && result.notebook, "generic notebook export returned notebook object");
  assert.strictEqual(result.summary.datasetSchemaId, "ais_trajectory", "summary schema id should match");

  var cellTexts = result.notebook.cells.map(function (cell) {
    return Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || "");
  });
  var joined = cellTexts.join("\n\n");

  assert(joined.indexOf("oscillator_surrogate_pipeline") < 0, "generic notebook must not embed oscillator pipeline");
  assert(joined.indexOf("load_trajectory_csv(") < 0, "generic notebook must not include oscillator CSV loader");
  assert(joined.indexOf("EMBEDDED_DATASET_CSV_B64 = '") >= 0, "generic notebook should embed dataset CSV");
  assert(joined.indexOf("EMBEDDED_GRAPH_JSON_B64 = '") >= 0, "generic notebook should embed graph JSON");
  assert(joined.indexOf("if EMBEDDED_DATASET_CSV_B64:") >= 0, "generic notebook should load embedded dataset when present");
  assert(joined.indexOf("if EMBEDDED_GRAPH_JSON_B64:") >= 0, "generic notebook should load embedded graph when present");
  assert(joined.indexOf("graph_data = graph.get('drawflow', {}).get('Home', {}).get('data', graph)") >= 0, "generic notebook should define graph_data");
  assert(joined.indexOf("plt.tight_layout(); plt.show()\\\\n") < 0, "generic notebook should not emit stray literal newline escapes");

  console.log("PASS test_headless_generic_notebook_export");
}

main().catch(function (err) {
  console.error("FAIL test_headless_generic_notebook_export:", err && err.stack ? err.stack : err);
  process.exit(1);
});

"use strict";
/**
 * Headless notebook export test:
 * 1. Generate dataset
 * 2. Build model graph
 * 3. Export notebook (single file)
 * 4. Verify notebook structure (cells, runtime code, dataset, model)
 * 5. Save to disk for manual verification
 */

var assert = require("assert");
var fs = require("fs");
var path = require("path");

require("../src/notebook_runtime_assets.js");
var NBC = require("../src/notebook_bundle_core.js");
var DBA = require("../src/dataset_bundle_adapter.js");
var sr = require("../src/schema_registry.js");
require("../src/schema_definitions_builtin.js");
var dm = require("../src/dataset_modules.js");
require("../src/dataset_modules/oscillator_module.js");

function main() {
  // 1. Generate dataset
  var mod = dm.getModule("oscillator");
  var ds = mod.build({
    schemaId: "oscillator", seed: 42, numTraj: 10, scenarioType: "spring", includedScenarios: ["spring"],
    predictionMode: "direct", targetMode: "x", featureConfig: { useParams: true },
    featureSpec: { useParams: true, useTimeNorm: true }, paramPreset: "safe",
    durationSec: 2, dt: 0.02, steps: 100, trainFrac: 0.7, valFrac: 0.15, testFrac: 0.15,
    mRange: [0.5, 2], cRange: [0.1, 0.5], kRange: [1, 5],
    x0Range: [0.5, 1.5], v0Range: [0, 0.5], restitutionRange: [0.5, 0.9],
    globalG: 9.81, groundModel: "rigid", groundK: 2500, groundC: 90,
  });
  assert(ds, "dataset generated");
  console.log("Dataset: generated OK");

  // 2. Model graph
  var graph = {
    drawflow: { Home: { data: {
      "1": { name: "input_layer", data: { mode: "flat" }, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } } },
      "2": { name: "dense_layer", data: { units: 32, activation: "relu" }, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } } },
      "3": { name: "dense_layer", data: { units: 16, activation: "relu" }, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "4", input: "input_1" }] } } },
      "4": { name: "output_layer", data: { matchWeight: 1, targets: ["x"], targetType: "x", loss: "mse", wx: 1, wv: 1 }, inputs: { input_1: { connections: [{ node: "3", output: "output_1" }] } }, outputs: {} },
    } } }
  };

  // 3. Export notebook
  return NBC.createSingleNotebookFileFromConfig({
    seed: 42,
    datasetBundleAdapter: DBA,
    sessions: [{
      id: "export_test", name: "oscillator_mlp", schemaId: "oscillator",
      graph: graph, runtime: "python_server",
      epochs: 10, batchSize: 32, learningRate: 0.001,
      datasetData: ds,
    }],
  }).then(function (result) {
    assert(result, "export returned result");
    assert(result.fileName, "has fileName: " + result.fileName);
    assert(result.buffer, "has buffer");

    var str = Buffer.isBuffer(result.buffer) ? result.buffer.toString("utf8") : String(result.buffer);
    var nb = JSON.parse(str);

    // 4. Verify structure
    assert(nb.cells && nb.cells.length >= 10, "notebook has >= 10 cells, got " + nb.cells.length);
    assert.strictEqual(nb.nbformat, 4, "nbformat 4");

    // check key sections exist
    var cellTexts = nb.cells.map(function (c) {
      return Array.isArray(c.source) ? c.source.join("") : String(c.source || "");
    });

    var hasSetup = cellTexts.some(function (t) { return t.indexOf("Setup Runtime") >= 0; });
    var hasTrain = cellTexts.some(function (t) { return t.indexOf("Train") >= 0; });
    var hasEpochReport = cellTexts.some(function (t) { return t.indexOf("Epoch Report") >= 0 || t.indexOf("Loss Curves") >= 0; });
    var hasValidation = cellTexts.some(function (t) { return t.indexOf("Validation") >= 0; });
    var hasFinalReport = cellTexts.some(function (t) { return t.indexOf("Final Report") >= 0; });
    var hasPipeline = cellTexts.some(function (t) { return t.indexOf("oscillator_surrogate_pipeline") >= 0 || t.indexOf("DrawflowTorchModel") >= 0; });
    var hasDataset = cellTexts.some(function (t) { return t.indexOf("DATASET_CSV") >= 0 || t.indexOf("dataset") >= 0; });

    assert(hasSetup, "has Setup Runtime section");
    assert(hasTrain, "has Train section");
    assert(hasEpochReport, "has Epoch Report section");
    assert(hasValidation, "has Validation section");
    assert(hasFinalReport, "has Final Report section");
    assert(hasPipeline, "has embedded pipeline code");

    console.log("Notebook: " + nb.cells.length + " cells");
    console.log("  Setup: " + hasSetup);
    console.log("  Pipeline embedded: " + hasPipeline);
    console.log("  Dataset: " + hasDataset);
    console.log("  Train: " + hasTrain);
    console.log("  Epoch Report: " + hasEpochReport);
    console.log("  Validation: " + hasValidation);
    console.log("  Final Report: " + hasFinalReport);

    // 5. Save for manual verification
    var outDir = path.join(__dirname, "..", "output");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    var outPath = path.join(outDir, "test_export_notebook.ipynb");
    fs.writeFileSync(outPath, str);
    console.log("\nSaved: " + outPath);
    console.log("Summary:", JSON.stringify(result.summary, null, 2));

    console.log("\nPASS test_headless_notebook_export");
  });
}

main().catch(function (err) {
  console.error("FAIL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

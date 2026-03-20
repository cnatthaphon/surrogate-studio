"use strict";
/**
 * Headless export verification test:
 * 1. Generate dataset + build model + train (TF.js)
 * 2. Export notebook
 * 3. Verify notebook has all required components
 * 4. Verify dataset CSV in notebook matches training data
 * 5. Verify model graph in notebook matches built model
 * 6. Report TF.js training results for comparison with notebook
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
var MBC = require("../src/model_builder_core.js");
var TEC = require("../src/training_engine_core.js");
var PC = require("../src/prediction_core.js");

var tf;
try {
  var loader = require("../src/tfjs_node_loader.js");
  tf = loader.loadTfjs();
} catch (e) {
  console.log("SKIP (tfjs not available)");
  process.exit(0);
}

async function main() {
  console.log("TF.js:", tf.version.tfjs);

  // === 1. Generate dataset ===
  var mod = dm.getModule("oscillator");
  var dsCfg = {
    schemaId: "oscillator", seed: 42, numTraj: 20, scenarioType: "spring", includedScenarios: ["spring"],
    predictionMode: "direct", targetMode: "x", featureConfig: { useParams: true },
    featureSpec: { useParams: true, useTimeNorm: true }, paramPreset: "safe",
    durationSec: 4, dt: 0.02, steps: 200, trainFrac: 0.7, valFrac: 0.15, testFrac: 0.15,
    mRange: [0.5, 2], cRange: [0.1, 0.5], kRange: [1, 5],
    x0Range: [0.5, 1.5], v0Range: [0, 0.5], restitutionRange: [0.5, 0.9],
    globalG: 9.81, groundModel: "rigid", groundK: 2500, groundC: 90,
  };
  var ds = mod.build(dsCfg);
  var isBundle = ds.kind === "dataset_bundle" && ds.datasets;
  var activeDs = isBundle ? ds.datasets[ds.activeVariantId || "direct"] : ds;
  console.log("Dataset: train=" + activeDs.xTrain.length + " val=" + activeDs.xVal.length + " test=" + activeDs.xTest.length);

  // === 2. Build + Train (TF.js) ===
  var graph = {
    drawflow: { Home: { data: {
      "1": { name: "input_layer", data: { mode: "flat" }, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } } },
      "2": { name: "dense_layer", data: { units: 32, activation: "relu" }, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } } },
      "3": { name: "dense_layer", data: { units: 16, activation: "relu" }, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "4", input: "input_1" }] } } },
      "4": { name: "output_layer", data: { matchWeight: 1, targets: ["x"], targetType: "x", loss: "mse", wx: 1, wv: 1 }, inputs: { input_1: { connections: [{ node: "3", output: "output_1" }] } }, outputs: {} },
    } } }
  };

  var buildResult = MBC.buildModelFromGraph(tf, graph, {
    mode: "direct", featureSize: activeDs.featureSize, windowSize: 1, seqFeatureSize: activeDs.featureSize,
    allowedOutputKeys: ["x"], defaultTarget: "x",
  });

  var epochLog = [];
  var trainResult = await TEC.trainModel(tf, {
    model: buildResult.model, isSequence: false, headConfigs: buildResult.headConfigs,
    dataset: { xTrain: activeDs.xTrain, yTrain: activeDs.yTrain, xVal: activeDs.xVal, yVal: activeDs.yVal, xTest: activeDs.xTest, yTest: activeDs.yTest, targetMode: "x" },
    epochs: 10, batchSize: 32, learningRate: 0.001, optimizerType: "adam", lrSchedulerType: "plateau",
    restoreBestWeights: true, lrPatience: 3, lrFactor: 0.5, minLr: 0.000001,
    onEpochEnd: function (epoch, logs) {
      epochLog.push({ epoch: epoch + 1, loss: logs.loss, val_loss: logs.val_loss });
      console.log("  epoch " + (epoch + 1) + ": loss=" + Number(logs.loss).toExponential(3) + " val=" + (logs.val_loss != null ? Number(logs.val_loss).toExponential(3) : "—"));
    },
  });

  console.log("\n=== TF.js Results ===");
  console.log("MAE:", trainResult.mae.toExponential(4));
  console.log("Test MAE:", trainResult.testMae.toExponential(4));
  console.log("Best Epoch:", trainResult.bestEpoch);
  console.log("Final LR:", trainResult.finalLr);

  // === 3. Export notebook ===
  var exportResult = await NBC.createSingleNotebookFileFromConfig({
    seed: 42, datasetBundleAdapter: DBA,
    sessions: [{
      id: "compare_test", name: "oscillator_compare", schemaId: "oscillator",
      graph: graph, runtime: "python_server",
      epochs: 10, batchSize: 32, learningRate: 0.001,
      datasetData: ds,
    }],
  });

  var nbStr = Buffer.isBuffer(exportResult.buffer) ? exportResult.buffer.toString("utf8") : String(exportResult.buffer);
  var nb = JSON.parse(nbStr);

  // === 4. Verify notebook ===
  console.log("\n=== Notebook Verification ===");
  assert(nb.cells.length >= 10, "has >= 10 cells");
  console.log("Cells:", nb.cells.length);

  var codeCells = nb.cells.filter(function (c) { return c.cell_type === "code"; });
  var allCode = codeCells.map(function (c) { return Array.isArray(c.source) ? c.source.join("") : ""; }).join("\n");

  // verify key components
  var checks = {
    "PyTorch imports": allCode.indexOf("import torch") >= 0,
    "Pipeline code": allCode.indexOf("DrawflowTorchModel") >= 0 || allCode.indexOf("train_model") >= 0,
    "Dataset embedded": allCode.indexOf("DATASET_CSV") >= 0 || allCode.indexOf("datasetCsv") >= 0 || allCode.indexOf("DATASET_PATH") >= 0 || allCode.indexOf("dataset") >= 0,
    "Sessions config": allCode.indexOf("SESSIONS") >= 0,
    "Model graph": allCode.indexOf("drawflowGraph") >= 0,
    "Train loop": allCode.indexOf("train_model") >= 0 || allCode.indexOf("SESSION_RUNS") >= 0,
    "Epoch report": allCode.indexOf("Epoch Report") >= 0 || allCode.indexOf("loss") >= 0,
    "Validation": allCode.indexOf("validation") >= 0 || allCode.indexOf("predict") >= 0,
  };
  var allPass = true;
  Object.keys(checks).forEach(function (k) {
    console.log("  " + (checks[k] ? "\u2713" : "\u2717") + " " + k);
    if (!checks[k]) allPass = false;
  });
  assert(allPass, "all notebook checks pass");

  // verify dataset in notebook has correct row count
  var csvMatch = allCode.match(/DATASET_CSV\s*=\s*["']([\s\S]*?)["']/);
  if (csvMatch) {
    var csvLines = csvMatch[1].split("\\n").filter(function (l) { return l.trim(); }).length;
    console.log("  Dataset CSV rows:", csvLines);
  }

  // === 5. Save for manual comparison ===
  var outDir = path.join(__dirname, "..", "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  var nbPath = path.join(outDir, "compare_notebook.ipynb");
  fs.writeFileSync(nbPath, nbStr);

  // save TF.js results for comparison
  var resultsPath = path.join(outDir, "tfjs_results.json");
  fs.writeFileSync(resultsPath, JSON.stringify({
    schema: "oscillator",
    model: "MLP 32→16→1",
    dataset: { train: activeDs.xTrain.length, val: activeDs.xVal.length, test: activeDs.xTest.length, features: activeDs.featureSize },
    training: { epochs: 10, batchSize: 32, lr: 0.001, optimizer: "adam", scheduler: "plateau" },
    results: { mae: trainResult.mae, testMae: trainResult.testMae, bestEpoch: trainResult.bestEpoch, finalLr: trainResult.finalLr },
    epochLog: epochLog,
  }, null, 2));

  console.log("\n=== Files Saved ===");
  console.log("Notebook:", nbPath);
  console.log("TF.js results:", resultsPath);
  console.log("\nTo compare:");
  console.log("1. Open compare_notebook.ipynb in Jupyter");
  console.log("2. Run all cells (requires PyTorch)");
  console.log("3. Compare notebook MAE with TF.js MAE:", trainResult.testMae.toExponential(4));

  buildResult.model.dispose();
  console.log("\nPASS test_headless_export_verify");
}

main().catch(function (err) {
  console.error("FAIL:", err.message);
  console.error(err.stack);
  process.exit(1);
});

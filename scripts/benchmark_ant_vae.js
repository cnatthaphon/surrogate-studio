#!/usr/bin/env node
/**
 * Headless benchmark: Train LSTM-VAE and MLP-AE on ant trajectory data,
 * report reconstruction metrics for paper comparison.
 */
"use strict";

// Load TF.js
const tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");

// Load modules
const ModelBuilder = require("../src/model_builder_core.js");
const TrainingEngine = require("../src/training_engine_core.js");

// Load ant data — ant_data.js declares `var ANT_DATA = ...`
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const antCtx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../demo/LSTM-VAE-for-dominant-motion-extraction/ant_data.js"), "utf8"), antCtx);
global.window = { ANT_DATA: antCtx.ANT_DATA };
global.ANT_DATA = antCtx.ANT_DATA;
const AntModule = require("../demo/LSTM-VAE-for-dominant-motion-extraction/ant_trajectory_module.js");

async function main() {
  await tf.setBackend("cpu");
  await tf.ready();
  console.log("TF.js backend:", tf.getBackend());

  // Build dataset
  console.log("\n=== Building dataset ===");
  const ds = await AntModule.build({ totalCount: 1000, seed: 42, splitMode: "random", trainFrac: 0.8, valFrac: 0.1 });
  console.log(`Train: ${ds.trainCount}, Val: ${ds.valCount}, Test: ${ds.testCount}, Features: ${ds.featureSize}`);

  // Load preset graphs (Drawflow format — same as the demo)
  const presetCode = fs.readFileSync(path.join(__dirname, "../demo/LSTM-VAE-for-dominant-motion-extraction/preset.js"), "utf8");
  const presetCtx = { window: {}, Date: Date };
  vm.runInNewContext(presetCode, presetCtx);
  const preset = presetCtx.window.LSTM_VAE_DEMO_PRESET;
  const vaeGraph = preset.models[0].graph; // LSTM-VAE
  const aeGraph = preset.models[1].graph;  // MLP-AE

  // === LSTM-VAE (paper architecture adapted) ===
  console.log("\n=== LSTM-VAE: Input(40) → LSTM(32) → μ(8)/logσ²(8) → Reparam → Dense(32,relu) → Dense(128,relu) → Output(40) ===");
  const vaeResult = await trainModel(tf, ds, vaeGraph, "LSTM-VAE", {
    epochs: 50, batchSize: 32, lr: 0.0005, optimizer: "adam",
  });

  // === MLP-AE baseline ===
  console.log("\n=== MLP-AE: Input(40) → Dense(128) → Dense(32) → Dense(8) → Dense(32) → Dense(128) → Output(40) ===");
  const aeResult = await trainModel(tf, ds, aeGraph, "MLP-AE", {
    epochs: 50, batchSize: 32, lr: 0.0005, optimizer: "adam",
  });

  // === Summary ===
  console.log("\n" + "=".repeat(70));
  console.log("BENCHMARK RESULTS: Ant Trajectory Reconstruction (1000 timesteps)");
  console.log("=".repeat(70));
  console.log("");
  printResult("LSTM-VAE (ours)", vaeResult);
  printResult("MLP-AE (baseline)", aeResult);

  console.log("\nPaper reference (Jadhav & Barati Farimani, 2022):");
  console.log("  Architecture: LSTM(hidden=100, depth=2), latent=20, 10399 timesteps");
  console.log("  Framework: PyTorch");
  console.log("  Focus: reconstruction quality sufficient for SINDy equation discovery");
  console.log("  (Paper does not report explicit MSE/R² — shows qualitative reconstruction in figures)");

  console.log("\nOur reproduction:");
  console.log("  Architecture: LSTM(hidden=32, depth=1), latent=8, 1000 timesteps");
  console.log("  Framework: TF.js (CPU)");
  console.log("  Smaller model (19K vs ~80K params) trained on 10% of the data");
  console.log("");
}

function printResult(name, r) {
  if (!r) { console.log(`  ${name}: FAILED`); return; }
  console.log(`  ${name}:`);
  console.log(`    Params:     ${r.paramCount || "?"}`);
  console.log(`    Best epoch: ${r.bestEpoch || "?"} / ${r.epochs}`);
  console.log(`    Train loss: ${r.bestTrainLoss != null ? r.bestTrainLoss.toExponential(4) : "?"}`);
  console.log(`    Val loss:   ${r.bestValLoss != null ? r.bestValLoss.toExponential(4) : "?"}`);
  console.log(`    Test MAE:   ${r.testMae != null ? r.testMae.toExponential(4) : "?"}`);
  console.log(`    Test RMSE:  ${r.testRmse != null ? r.testRmse.toExponential(4) : "?"}`);
  console.log(`    Test R²:    ${r.testR2 != null ? r.testR2.toFixed(4) : "?"}`);
  console.log(`    Test Bias:  ${r.testBias != null ? r.testBias.toExponential(4) : "?"}`);
  console.log("");
}

async function trainModel(tf, ds, graphSpec, name, cfg) {
  try {
    // Build model from graph spec
    const built = ModelBuilder.buildModelFromGraph(tf, graphSpec, {
      mode: "direct", featureSize: ds.featureSize, windowSize: 1, seqFeatureSize: ds.featureSize,
      allowedOutputKeys: ["xv"], defaultTarget: "xv", numClasses: 0,
    });

    const paramCount = built.model.countParams();
    console.log(`  Parameters: ${paramCount}`);

    // Train — API expects opts.dataset as sub-object
    const result = await TrainingEngine.trainModel(tf, {
      model: built.model,
      isSequence: built.isSequence,
      headConfigs: built.headConfigs,
      dataset: {
        xTrain: ds.xTrain, yTrain: ds.yTrain,
        xVal: ds.xVal, yVal: ds.yVal,
        xTest: ds.xTest, yTest: ds.yTest,
        targetMode: ds.targetMode || "xv",
        featureSize: ds.featureSize,
      },
      epochs: cfg.epochs, batchSize: cfg.batchSize,
      learningRate: cfg.lr, optimizerType: cfg.optimizer,
      lrSchedulerType: "plateau", earlyStoppingPatience: 20,
      restoreBestWeights: true,
      onEpoch: function (epoch, logs) {
        if (epoch % 10 === 0 || epoch === cfg.epochs - 1) {
          console.log(`  Epoch ${epoch + 1}/${cfg.epochs} — loss: ${(logs.loss || 0).toExponential(3)}, val_loss: ${(logs.val_loss || 0).toExponential(3)}`);
        }
      },
    });

    result.paramCount = paramCount;
    result.epochs = cfg.epochs;
    built.model.dispose();
    return result;
  } catch (e) {
    console.error(`  ERROR: ${e.message}`);
    return null;
  }
}

main().catch(e => { console.error(e); process.exit(1); });

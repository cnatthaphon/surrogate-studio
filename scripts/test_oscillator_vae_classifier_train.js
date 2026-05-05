#!/usr/bin/env node
// Regression test for Codex round-2 finding on PR #63: client-side
// Oscillator VAE+Classifier training was failing because
// oscillator_dataset_core emits scalar scenario labels but
// training_engine_core's rowsToTensor was calling tensor2d(scalars, [n, 3])
// without one-hot encoding first. The earlier scripts/test_oscillator_labels.js
// only checked label length/range and missed this — the actual training
// pipeline still failed with "tensor should have 540 values but has 180".
//
// This test exercises the full path: dataset build → model build → 1 epoch
// fit. Pre-fix it threw the shape-mismatch error inside TrainingEngine. Post-fix
// it completes a single epoch with finite loss values.
//
// Run via: node scripts/test_oscillator_vae_classifier_train.js
"use strict";
var path = require("path");
var fs = require("fs");
var vm = require("vm");

var REPO = path.resolve(__dirname, "..");

global.window = global;
global.OSCDatasetModules = { registerModule: function () {} };

var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");

var schemaReg = require(path.join(REPO, "src/schema_registry.js"));
global.OSCSchemaRegistry = schemaReg;
global.window.OSCSchemaRegistry = schemaReg;
require(path.join(REPO, "src/schema_definitions_builtin.js"));
var OSC = require(path.join(REPO, "src/oscillator_dataset_core.js"));
global.window.OSCOscillatorDatasetCore = OSC;
var oscModule = require(path.join(REPO, "src/dataset_modules/oscillator_module.js"));
if (oscModule) global.window.OSCDatasetModuleOscillator = oscModule;

var MBC = require(path.join(REPO, "src/model_builder_core.js"));
var TE = require(path.join(REPO, "src/training_engine_core.js"));

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

(async function () {
  await tf.setBackend("cpu");
  await tf.ready();

  // Build a small Oscillator dataset with the same config the demo preset uses.
  // Small sample count (30 trajectories) so the test runs in seconds.
  var ds = OSC.generateDataset({
    totalCount: 30,
    numTraj: 30,
    seed: 42,
    splitMode: "random",
    trainFrac: 0.7, valFrac: 0.15, testFrac: 0.15,
    targetMode: "xv",
    windowSize: 20,
    predictionMode: "autoregressive",
    includedScenarios: ["spring", "pendulum", "bouncing"],
    featureConfig: { useX: true, useV: true, useParams: true },
    featureSpec: {
      useX: true, useV: true, useParams: true,
      useTimeSec: false, useTimeNorm: false, useScenario: false,
      useSinNorm: false, useCosNorm: false, useNoiseSchedule: false,
      paramMask: { m: true, c: true, k: true, e: false, x0: false, v0: false, gm: false, gk: false, gc: false },
    },
  });

  if (ds.classCount !== 3) fail("classCount should be 3, got " + ds.classCount);
  if (!ds.labelsTrain || ds.labelsTrain.length !== ds.yTrain.length) {
    fail("labelsTrain.length=" + (ds.labelsTrain && ds.labelsTrain.length) + " yTrain.length=" + ds.yTrain.length);
  }
  // Sanity: first label should be a SCALAR (this is the format that broke
  // training before the fix; if labels arrive as [[1,0,0]] one-hot already,
  // the test isn't exercising the bug).
  var sample = ds.labelsTrain[0];
  if (Array.isArray(sample)) fail("Expected scalar labels (this is the format that triggered the bug); got array: " + JSON.stringify(sample));

  console.log("Dataset built:");
  console.log("  classCount:", ds.classCount);
  console.log("  classNames:", ds.classNames);
  console.log("  xTrain[0].length:", ds.xTrain[0].length);
  console.log("  yTrain[0]:", ds.yTrain[0]);
  console.log("  labelsTrain[0..5]:", ds.labelsTrain.slice(0, 5), "(scalars — the format that broke training)");
  console.log("  splits: train=" + ds.yTrain.length + " val=" + ds.yVal.length + " test=" + ds.yTest.length);

  // Build the VAE+Classifier graph from the demo preset.
  var presetSrc = fs.readFileSync(path.join(REPO, "demo/Oscillator-Surrogate/preset.js"), "utf8");
  var sandbox = { window: {}, Date: Date };
  vm.runInNewContext(presetSrc, sandbox);
  var preset = sandbox.window.OSCILLATOR_DEMO_PRESET;
  var vaeCls = preset.models.find(function (m) { return m.id === "demo-osc-vae-cls"; });
  if (!vaeCls) fail("demo-osc-vae-cls not found in preset");

  if (!schemaReg) fail("OSCSchemaRegistry not loaded");
  var outputKeys = schemaReg.getOutputKeys("oscillator");
  var built = MBC.buildModelFromGraph(tf, vaeCls.graph, {
    mode: "direct",
    featureSize: ds.xTrain[0].length,
    windowSize: 20,
    seqFeatureSize: ds.xTrain[0].length,
    targetSize: 2,
    allowedOutputKeys: outputKeys,
    defaultTarget: "xv",
    numClasses: ds.classCount,
  });

  console.log("\nModel built:");
  console.log("  total weights:", built.model.weights.length);
  console.log("  headConfigs:");
  built.headConfigs.forEach(function (h) {
    console.log("    " + h.id + " target=" + h.target + " headType=" + h.headType + " units=" + h.units);
  });

  // Run 1 epoch — this is where the bug surfaced before. Pre-fix it threw
  // "tensor should have N*3 values but has N" inside rowsToTensor.
  console.log("\nTraining 1 epoch...");
  var lossTrace = [];
  var result = await TE.trainModel(tf, {
    model: built.model,
    isSequence: built.isSequence,
    headConfigs: built.headConfigs,
    dataset: {
      xTrain: ds.xTrain, yTrain: ds.yTrain, labelsTrain: ds.labelsTrain,
      xVal: ds.xVal, yVal: ds.yVal, labelsVal: ds.labelsVal,
      xTest: ds.xTest, yTest: ds.yTest, labelsTest: ds.labelsTest,
      numClasses: ds.classCount,
      classCount: ds.classCount,
      featureSize: ds.xTrain[0].length,
      targetMode: "xv",
    },
    epochs: 1,
    batchSize: 32,
    learningRate: 1e-3,
    optimizerType: "adam",
    lrSchedulerType: "none",
    onEpoch: function (epoch, logs) {
      lossTrace.push({ epoch: epoch, loss: logs.loss, val_loss: logs.val_loss });
    },
  });

  console.log("Training complete.");
  console.log("  finalLoss:", result.finalLoss || result.bestTrainLoss);
  console.log("  bestValLoss:", result.bestValLoss);
  console.log("  epochsCaptured:", result.epochsCaptured);

  if (!Number.isFinite(result.finalLoss || result.bestTrainLoss || NaN) &&
      !Number.isFinite(result.bestValLoss || NaN)) {
    fail("training produced no finite loss");
  }

  built.model.dispose();
  console.log("\nPASS test_oscillator_vae_classifier_train (1 epoch completed without shape errors)");
})().catch(function (e) {
  console.error("UNEXPECTED ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});

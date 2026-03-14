"use strict";
/**
 * Headless end-to-end test: dataset → model build → train → predict → evaluate
 * Runs with Node.js + @tensorflow/tfjs — no browser, no DOM.
 * Tests the complete pipeline for a simple MLP on synthetic data.
 */

var assert = require("assert");

// load modules
var MBC = require("../src/model_builder_core.js");
var TEC = require("../src/training_engine_core.js");
var PC = require("../src/prediction_core.js");

var tf;
try {
  var loader = require("../src/tfjs_node_loader.js");
  tf = loader.loadTfjs();
} catch (e) {
  console.log("SKIP test_headless_train_flow (tfjs runtime not available: " + e.message + ")");
  process.exit(0);
}

async function main() {
  console.log("TF.js version:", tf.version.tfjs);

  // ===== STEP 1: Create synthetic dataset =====
  // Simple: y = 2*x1 + 3*x2 + noise (regression)
  var N = 200;
  var xTrain = [], yTrain = [], xVal = [], yVal = [], xTest = [], yTest = [];
  function makeSample() {
    var x1 = Math.random() * 2 - 1;
    var x2 = Math.random() * 2 - 1;
    var y = 2 * x1 + 3 * x2 + (Math.random() - 0.5) * 0.1;
    return { x: [x1, x2], y: [y] };
  }
  for (var i = 0; i < N; i++) {
    var s = makeSample();
    if (i < 140) { xTrain.push(s.x); yTrain.push(s.y); }
    else if (i < 170) { xVal.push(s.x); yVal.push(s.y); }
    else { xTest.push(s.x); yTest.push(s.y); }
  }
  console.log("Dataset: train=" + xTrain.length + " val=" + xVal.length + " test=" + xTest.length);

  // ===== STEP 2: Build model from graph spec =====
  var graphSpec = {
    drawflow: { Home: { data: {
      "1": {
        name: "input_layer", data: { mode: "flat" },
        inputs: {},
        outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } }
      },
      "2": {
        name: "dense_layer", data: { units: 16, activation: "relu" },
        inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } },
        outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } }
      },
      "3": {
        name: "dense_layer", data: { units: 8, activation: "relu" },
        inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } },
        outputs: { output_1: { connections: [{ node: "4", input: "input_1" }] } }
      },
      "4": {
        name: "output_layer",
        data: { matchWeight: 1, targets: ["x"], loss: "mse", wx: 1, wv: 1 },
        inputs: { input_1: { connections: [{ node: "3", output: "output_1" }] } },
        outputs: {}
      },
    } } }
  };

  // graph inference
  var mode = MBC.inferGraphMode(graphSpec, "direct");
  assert.strictEqual(mode, "direct");
  var family = MBC.inferModelFamily(graphSpec);
  assert.strictEqual(family, "supervised");
  var heads = MBC.inferOutputHeads(graphSpec, ["x"], "x");
  assert(heads.length >= 1);
  console.log("Graph: mode=" + mode + " family=" + family + " heads=" + heads.length);

  // build TF.js model
  var buildResult = MBC.buildModelFromGraph(tf, graphSpec, {
    mode: "direct",
    featureSize: 2,
    windowSize: 1,
    seqFeatureSize: 2,
    allowedOutputKeys: ["x"],
    defaultTarget: "x",
  });
  assert(buildResult.model, "model built");
  assert.strictEqual(buildResult.isSequence, false);
  assert(buildResult.headConfigs.length >= 1);
  console.log("Model built: params=" + buildResult.model.countParams());

  // ===== STEP 3: Train =====
  var trainResult = await TEC.trainModel(tf, {
    model: buildResult.model,
    isSequence: false,
    headConfigs: buildResult.headConfigs,
    dataset: {
      xTrain: xTrain, yTrain: yTrain,
      xVal: xVal, yVal: yVal,
      xTest: xTest, yTest: yTest,
      targetMode: "x",
    },
    epochs: 10,
    batchSize: 32,
    learningRate: 0.01,
    optimizerType: "adam",
    lrSchedulerType: "none",
    restoreBestWeights: true,
    onEpochEnd: function (epoch, logs) {
      if (epoch === 0 || epoch === 9) {
        console.log("  epoch " + (epoch + 1) + ": loss=" + Number(logs.loss).toExponential(3) +
          " val_loss=" + (logs.val_loss != null ? Number(logs.val_loss).toExponential(3) : "—"));
      }
    },
  });

  assert(trainResult, "training returned result");
  assert(typeof trainResult.mae === "number", "has mae");
  assert(typeof trainResult.testMae === "number", "has testMae");
  assert(trainResult.mae < 1, "mae reasonable (< 1)");
  console.log("Training done: mae=" + trainResult.mae.toExponential(3) +
    " testMae=" + trainResult.testMae.toExponential(3) +
    " bestEpoch=" + trainResult.bestEpoch);

  // ===== STEP 4: Predict =====
  var predTensor = tf.tensor2d(xTest);
  var predRaw = buildResult.model.predict(predTensor);
  var predictions = (Array.isArray(predRaw) ? predRaw[0] : predRaw).arraySync().map(function (r) { return r[0]; });
  predTensor.dispose();
  if (Array.isArray(predRaw)) predRaw.forEach(function (t) { t.dispose(); }); else predRaw.dispose();

  var truthFlat = yTest.map(function (r) { return r[0]; });

  // ===== STEP 5: Evaluate =====
  var metrics = PC.computeRegressionMetrics(truthFlat, predictions);
  assert(metrics.mae < 1, "prediction mae < 1");
  assert(metrics.rmse >= metrics.mae, "rmse >= mae");
  console.log("Evaluation: mae=" + metrics.mae.toExponential(3) +
    " rmse=" + metrics.rmse.toExponential(3) +
    " bias=" + metrics.bias.toExponential(3));

  // ===== STEP 6: Classification test =====
  console.log("\n--- Classification test (softmax) ---");
  var classGraph = {
    drawflow: { Home: { data: {
      "1": { name: "input_layer", data: { mode: "flat" }, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } } },
      "2": { name: "dense_layer", data: { units: 16, activation: "relu" }, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } } },
      "3": { name: "output_layer", data: { matchWeight: 1, targets: ["logits"], loss: "mse", wx: 1, wv: 1 }, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: {} },
    } } }
  };

  var classBuild = MBC.buildModelFromGraph(tf, classGraph, {
    mode: "direct", featureSize: 4, windowSize: 1, seqFeatureSize: 4,
    allowedOutputKeys: ["logits", "label"], defaultTarget: "logits", numClasses: 3,
  });
  assert(classBuild.model, "classification model built");
  console.log("Classification model: params=" + classBuild.model.countParams());

  // synthetic 3-class data
  var cxTrain = [], cyTrain = [], cxVal = [], cyVal = [];
  for (var ci = 0; ci < 90; ci++) {
    var cls = ci % 3;
    var feat = [cls === 0 ? 1 : 0, cls === 1 ? 1 : 0, cls === 2 ? 1 : 0, Math.random() * 0.1];
    var oneHot = [0, 0, 0]; oneHot[cls] = 1;
    if (ci < 72) { cxTrain.push(feat); cyTrain.push(oneHot); }
    else { cxVal.push(feat); cyVal.push(oneHot); }
  }

  var classTrainResult = await TEC.trainModel(tf, {
    model: classBuild.model,
    isSequence: false,
    headConfigs: classBuild.headConfigs,
    dataset: { xTrain: cxTrain, yTrain: cyTrain, xVal: cxVal, yVal: cyVal, targetMode: "logits" },
    epochs: 20,
    batchSize: 16,
    learningRate: 0.01,
    optimizerType: "adam",
    lrSchedulerType: "none",
  });
  console.log("Classification training: mae=" + classTrainResult.mae.toExponential(3));

  // predict and check accuracy
  var predLabels = PC.batchPredictClassification(tf, classBuild.model, cxVal, {});
  var trueLabels = cyVal.map(function (oh) { return PC.argmax(oh); });
  var classMetrics = PC.computeClassificationMetrics(trueLabels, predLabels);
  console.log("Classification accuracy: " + (classMetrics.accuracy * 100).toFixed(1) + "%");
  assert(classMetrics.accuracy >= 0.5, "accuracy >= 50% on simple task");

  // cleanup
  buildResult.model.dispose();
  classBuild.model.dispose();

  console.log("\nPASS test_headless_train_flow (full pipeline: dataset → model → train → predict → evaluate)");
}

main().catch(function (err) {
  console.error("FAIL test_headless_train_flow:", err.message || err);
  process.exit(1);
});

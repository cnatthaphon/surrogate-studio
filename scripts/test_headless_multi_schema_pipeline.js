"use strict";
/**
 * Headless multi-schema pipeline test:
 * Tests full flow for EVERY registered schema:
 * oscillator (regression), mnist (classification), fashion_mnist (classification)
 * All via function calls — no DOM, no UI.
 */

var assert = require("assert");
var sr = require("../src/schema_registry.js");
require("../src/schema_definitions_builtin.js");
var dm = require("../src/dataset_modules.js");
require("../src/dataset_modules/oscillator_module.js");
require("../src/dataset_modules/mnist_source_loader.js");
require("../src/dataset_modules/mnist_module.js");
require("../src/dataset_modules/fashion_mnist_module.js");
var WS = require("../src/workspace_store.js");
var MBC = require("../src/model_builder_core.js");
var TEC = require("../src/training_engine_core.js");
var PC = require("../src/prediction_core.js");
var NBC = require("../src/notebook_bundle_core.js");

var tf;
try {
  var loader = require("../src/tfjs_node_loader.js");
  tf = loader.loadTfjs();
} catch (e) {
  console.log("SKIP (tfjs not available)");
  process.exit(0);
}

// --- test helpers ---
function buildSimpleGraph(featureSize, outputTarget, numClasses) {
  var outputData = { matchWeight: 1, targets: [outputTarget], targetType: outputTarget, loss: "mse", wx: 1, wv: 1 };
  if (outputTarget === "logits" || outputTarget === "label") {
    outputData.loss = "cross_entropy";
  }
  return {
    drawflow: { Home: { data: {
      "1": { name: "input_layer", data: { mode: "flat" }, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } } },
      "2": { name: "dense_layer", data: { units: 32, activation: "relu" }, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } } },
      "3": { name: "output_layer", data: outputData, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: {} },
    } } }
  };
}

async function testSchema(schemaId, store) {
  console.log("\n========== " + schemaId.toUpperCase() + " ==========");

  // 1. schema info
  var schema = sr.getSchema(schemaId);
  assert(schema, schemaId + " schema exists");
  var dsSchema = sr.getDatasetSchema(schemaId);
  var outputKeys = sr.getOutputKeys(schemaId);
  console.log("sampleType:", dsSchema.sampleType, "outputs:", outputKeys);

  // 2. dataset module
  var modList = dm.getModuleForSchema(schemaId);
  assert(Array.isArray(modList) && modList.length, schemaId + " has module");
  var mod = dm.getModule(modList[0].id);
  assert(mod && typeof mod.build === "function", schemaId + " module has build");

  // 3. generate dataset
  var dsId = "ds_" + schemaId + "_" + Date.now();
  var buildCfg;
  if (dsSchema.sampleType === "image") {
    buildCfg = { seed: 42, totalCount: 60, variant: schemaId, sourceMode: "synthetic" };
  } else {
    buildCfg = {
      schemaId: schemaId, moduleId: mod.id,
      seed: 42, numTraj: 10, scenarioType: "spring", includedScenarios: ["spring"],
      predictionMode: "direct", targetMode: "x",
      featureConfig: { useX: false, useV: false, useParams: true },
      featureSpec: { useParams: true, useTimeNorm: true },
      paramPreset: "safe", durationSec: 2, dt: 0.02, steps: 100,
      trainFrac: 0.7, valFrac: 0.15, testFrac: 0.15,
      mRange: [0.5, 2], cRange: [0.1, 0.5], kRange: [1, 5],
      x0Range: [0.5, 1.5], v0Range: [0, 0.5], restitutionRange: [0.5, 0.9],
      globalG: 9.81, groundModel: "rigid", groundK: 2500, groundC: 90,
    };
  }

  var dsResult = await mod.build(buildCfg);
  assert(dsResult, schemaId + " build returned result");

  // resolve actual data
  var isBundle = dsResult.kind === "dataset_bundle" && dsResult.datasets;
  var activeDs;
  if (isBundle) {
    activeDs = dsResult.datasets[dsResult.activeVariantId || Object.keys(dsResult.datasets)[0]];
  } else if (dsResult.records) {
    // image format — convert to xTrain/yTrain
    var trainX = (dsResult.records.train && dsResult.records.train.x) || [];
    var trainY = (dsResult.records.train && dsResult.records.train.y) || [];
    var valX = (dsResult.records.val && dsResult.records.val.x) || [];
    var valY = (dsResult.records.val && dsResult.records.val.y) || [];
    var testX = (dsResult.records.test && dsResult.records.test.x) || [];
    var testY = (dsResult.records.test && dsResult.records.test.y) || [];
    // one-hot encode for classification
    var nClasses = dsResult.classCount || 10;
    function oneHot(label, n) { var arr = new Array(n).fill(0); arr[label] = 1; return arr; }
    activeDs = {
      xTrain: trainX, yTrain: trainY.map(function (l) { return oneHot(l, nClasses); }),
      xVal: valX, yVal: valY.map(function (l) { return oneHot(l, nClasses); }),
      xTest: testX, yTest: testY.map(function (l) { return oneHot(l, nClasses); }),
      featureSize: trainX[0] ? trainX[0].length : 784,
      numClasses: nClasses,
      targetMode: "logits",
    };
  } else {
    activeDs = dsResult;
  }

  assert(activeDs && activeDs.xTrain && activeDs.xTrain.length > 0, schemaId + " has training data");
  var featureSize = activeDs.featureSize || (activeDs.xTrain[0] && activeDs.xTrain[0].length) || 1;
  console.log("Dataset: train=" + activeDs.xTrain.length + " features=" + featureSize);

  store.upsertDataset({ id: dsId, name: schemaId + "_ds", schemaId: schemaId, status: "ready", data: dsResult });

  // 4. build model
  var defaultTarget = outputKeys[0] || "x";
  var graph = buildSimpleGraph(featureSize, defaultTarget, activeDs.numClasses || 10);
  var modelId = "m_" + schemaId + "_" + Date.now();
  store.upsertModel({ id: modelId, name: schemaId + "_model", schemaId: schemaId, graph: graph });

  var buildResult = MBC.buildModelFromGraph(tf, graph, {
    mode: "direct", featureSize: featureSize, windowSize: 1, seqFeatureSize: featureSize,
    allowedOutputKeys: outputKeys, defaultTarget: defaultTarget,
    numClasses: activeDs.numClasses || 10,
  });
  assert(buildResult.model, schemaId + " TF.js model built");
  console.log("Model: params=" + buildResult.model.countParams() + " target=" + defaultTarget);

  // 5. train
  var trainerId = "t_" + schemaId + "_" + Date.now();
  store.upsertTrainerCard({ id: trainerId, name: schemaId + "_train", schemaId: schemaId, datasetId: dsId, modelId: modelId, status: "running" });

  var trainResult = await TEC.trainModel(tf, {
    model: buildResult.model, isSequence: false, headConfigs: buildResult.headConfigs,
    dataset: {
      xTrain: activeDs.xTrain, yTrain: activeDs.yTrain,
      xVal: activeDs.xVal, yVal: activeDs.yVal,
      xTest: activeDs.xTest, yTest: activeDs.yTest,
      targetMode: activeDs.targetMode || defaultTarget,
      numClasses: activeDs.numClasses,
    },
    epochs: 3, batchSize: 16, learningRate: 0.01, optimizerType: "adam", lrSchedulerType: "none",
    onEpochEnd: function (epoch, logs) {
      store.appendTrainerEpoch(trainerId, { epoch: epoch + 1, loss: logs.loss, val_loss: logs.val_loss });
    },
  });

  assert(trainResult, schemaId + " training done");
  console.log("Train: mae=" + trainResult.mae.toExponential(3) + " bestEpoch=" + trainResult.bestEpoch);

  store.upsertTrainerCard({ id: trainerId, name: schemaId + "_train", schemaId: schemaId, datasetId: dsId, modelId: modelId, status: "done", metrics: trainResult });

  // 6. evaluate
  if (dsSchema.sampleType === "image") {
    var predLabels = PC.batchPredictClassification(tf, buildResult.model, activeDs.xTest.slice(0, 20), {});
    var trueLabels = activeDs.yTest.slice(0, 20).map(function (oh) { return PC.argmax(oh); });
    var classMetrics = PC.computeClassificationMetrics(trueLabels, predLabels);
    console.log("Eval: accuracy=" + (classMetrics.accuracy * 100).toFixed(1) + "%");
  } else {
    var predTensor = tf.tensor2d(activeDs.xTest.slice(0, 20));
    var predRaw = buildResult.model.predict(predTensor);
    var preds = (Array.isArray(predRaw) ? predRaw[0] : predRaw).arraySync().map(function (r) { return Array.isArray(r) ? r[0] : r; });
    predTensor.dispose();
    if (Array.isArray(predRaw)) predRaw.forEach(function (t) { t.dispose(); }); else predRaw.dispose();
    var truth = activeDs.yTest.slice(0, 20).map(function (r) { return Array.isArray(r) ? r[0] : r; });
    var regMetrics = PC.computeRegressionMetrics(truth, preds);
    console.log("Eval: mae=" + regMetrics.mae.toExponential(3));
  }

  // 7. verify store
  assert(store.getTrainerCard(trainerId).status === "done", schemaId + " trainer done");
  assert(store.getTrainerEpochs(trainerId).length === 3, schemaId + " 3 epochs logged");

  // 8. notebook export module check
  assert(NBC, "notebook_bundle_core loaded");

  buildResult.model.dispose();
  console.log(schemaId.toUpperCase() + ": PASS");
}

async function main() {
  console.log("TF.js:", tf.version.tfjs);
  var store = WS.createMemoryStore();

  var schemas = sr.listSchemas().map(function (s) { return s.id; });
  console.log("Testing schemas:", schemas);

  for (var i = 0; i < schemas.length; i++) {
    await testSchema(schemas[i], store);
  }

  // final store summary
  console.log("\n========== STORE SUMMARY ==========");
  console.log("Datasets:", store.listDatasets({}).length);
  console.log("Models:", store.listModels({}).length);
  console.log("Trainers:", store.listTrainerCards({}).length);

  console.log("\n===== PASS test_headless_multi_schema_pipeline =====");
}

main().catch(function (err) {
  console.error("FAIL:", err.message || err);
  console.error(err.stack);
  process.exit(1);
});

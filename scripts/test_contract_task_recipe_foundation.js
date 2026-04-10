#!/usr/bin/env node
"use strict";

const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

globalThis.OSCSchemaRegistry = require(path.join(ROOT, "src", "schema_registry.js"));
globalThis.OSCTaskRecipeRegistry = require(path.join(ROOT, "src", "task_recipe_registry.js"));
globalThis.OSCTaskRecipeRuntime = require(path.join(ROOT, "src", "task_recipe_runtime.js"));
require(path.join(ROOT, "src", "task_recipe_definitions_builtin.js"));
require(path.join(ROOT, "src", "schema_definitions_builtin.js"));

const datasetSourceDescriptor = require(path.join(ROOT, "src", "dataset_source_descriptor.js"));
const datasetModules = require(path.join(ROOT, "src", "dataset_modules.js"));

async function main() {
  const schemaRegistry = globalThis.OSCSchemaRegistry;
  const taskRecipeRegistry = globalThis.OSCTaskRecipeRegistry;
  const taskRecipeRuntime = globalThis.OSCTaskRecipeRuntime;

  assert(taskRecipeRegistry.getRecipe("supervised_standard"), "missing supervised_standard recipe");
  assert(taskRecipeRegistry.getRecipe("detection_single_box"), "missing detection_single_box recipe");
  assert(taskRecipeRuntime && typeof taskRecipeRuntime.resolveRecipe === "function", "missing task recipe runtime");

  assert(schemaRegistry.getTaskRecipeId("oscillator") === "sequence_forecast", "oscillator taskRecipeId mismatch");
  assert(schemaRegistry.getTaskRecipeId("synthetic_detection") === "detection_single_box", "synthetic_detection taskRecipeId mismatch");
  const detectionRecipe = taskRecipeRuntime.resolveRecipe(schemaRegistry, taskRecipeRegistry, "synthetic_detection", null, "");
  assert(detectionRecipe && detectionRecipe.id === "detection_single_box", "synthetic_detection recipe resolve mismatch");
  assert(taskRecipeRuntime.getPredictiveMode(detectionRecipe, schemaRegistry.getOutputKeys("synthetic_detection")) === "detection", "synthetic_detection predictive mode mismatch");
  const suggested = taskRecipeRuntime.getSuggestedMetricIds(detectionRecipe, ["mae"]);
  assert(Array.isArray(suggested) && suggested.indexOf("iou_mean") >= 0, "synthetic_detection suggested metrics mismatch");
  assert(suggested.indexOf("bbox_mae") >= 0, "synthetic_detection bbox metric missing");
  assert(suggested.indexOf("class_accuracy") >= 0, "synthetic_detection class metric missing");
  assert(typeof taskRecipeRuntime.prepareDatasetForTraining === "function", "missing recipe dataset preparation hook");

  const normalized = datasetSourceDescriptor.normalize({
    kind: "local_csv_manifest",
    schemaId: "synthetic_detection",
    datasetPath: "/tmp/data.csv",
    manifestPath: "/tmp/manifest.json",
    taskRecipeId: "detection_single_box",
  });
  assert(normalized && normalized.kind === "local_csv_manifest", "source descriptor normalize failed");
  assert(datasetSourceDescriptor.shouldUseServerReference(normalized) === true, "source descriptor should use server reference");

  const mod = datasetModules.getModule("synthetic_detection");
  assert(mod && typeof mod.build === "function", "synthetic_detection module missing");
  assert(mod.uiApi && typeof mod.uiApi.getSourceDescriptorSpec === "function", "synthetic_detection source descriptor spec missing");
  const ds = await Promise.resolve(mod.build({ seed: 7, totalCount: 120 }));
  assert(ds && ds.schemaId === "synthetic_detection", "synthetic_detection schemaId mismatch");
  assert(ds.featureSize === 1024, "synthetic_detection featureSize mismatch");
  assert(ds.targetSize === 4, "synthetic_detection targetSize mismatch");
  assert(ds.numClasses === 3, "synthetic_detection numClasses mismatch");
  assert(Array.isArray(ds.xTrain) && ds.xTrain.length > 0, "synthetic_detection xTrain missing");
  assert(Array.isArray(ds.yTrain) && ds.yTrain.length === ds.xTrain.length, "synthetic_detection yTrain mismatch");
  assert(Array.isArray(ds.labelsTrain) && ds.labelsTrain.length === ds.xTrain.length, "synthetic_detection labelsTrain mismatch");
  assert(Array.isArray(ds.yTrain[0]) && ds.yTrain[0].length === 4, "synthetic_detection bbox target mismatch");
  assert(Array.isArray(ds.labelsTrain[0]) && ds.labelsTrain[0].length === 3, "synthetic_detection class target mismatch");
  const preparedDetection = taskRecipeRuntime.prepareDatasetForTraining(schemaRegistry, taskRecipeRegistry, "synthetic_detection", {
    schemaId: "synthetic_detection",
    featureSize: 4,
    classCount: 3,
    records: {
      train: { x: [[0, 1, 0, 1]], y: [[0.1, 0.2, 0.3, 0.4]], labels: [2] },
      val: { x: [[1, 0, 1, 0]], y: [[0.2, 0.2, 0.5, 0.5]], labels: [1] },
      test: { x: [[1, 1, 0, 0]], y: [[0.0, 0.0, 0.4, 0.4]], labels: [0] },
    },
  }, {
    inferredHeads: [
      { target: "bbox", headType: "regression" },
      { target: "label", headType: "classification" },
    ],
    defaultTarget: "bbox",
  });
  assert(preparedDetection && preparedDetection.dataset, "prepareDatasetForTraining returned no dataset");
  assert(preparedDetection.mode === "detection", "prepareDatasetForTraining detection mode mismatch");
  assert(preparedDetection.dataset.targetMode === "bbox", "prepared detection targetMode mismatch");
  assert(Array.isArray(preparedDetection.dataset.yTrain[0]) && preparedDetection.dataset.yTrain[0].length === 4, "prepared detection bbox mismatch");
  assert(Array.isArray(preparedDetection.dataset.labelsTrain[0]) && preparedDetection.dataset.labelsTrain[0][2] === 1, "prepared detection label one-hot mismatch");
  const sourceBacked = await Promise.resolve(mod.build({
    sourceDescriptor: datasetSourceDescriptor.normalize({
      kind: "local_json_dataset",
      schemaId: "synthetic_detection",
      datasetModuleId: "synthetic_detection",
      datasetPath: "/tmp/synth_det.json",
      metadata: { featureSize: 1024, numClasses: 3, classNames: ["square", "wide_box", "tall_box"] },
    }),
    trainFrac: 0.7, valFrac: 0.15, testFrac: 0.15,
  }));
  assert(sourceBacked && sourceBacked.sourceDescriptor, "synthetic_detection source-backed build missing sourceDescriptor");
  assert(Number(sourceBacked.featureSize) === 1024, "synthetic_detection source-backed featureSize mismatch");
  assert(Number(sourceBacked.numClasses) === 3, "synthetic_detection source-backed numClasses mismatch");
  assert(Array.isArray(sourceBacked.classNames) && sourceBacked.classNames.length === 3, "synthetic_detection source-backed classNames mismatch");
  const preparedSourceBacked = taskRecipeRuntime.prepareDatasetForTraining(schemaRegistry, taskRecipeRegistry, "synthetic_detection", sourceBacked, {
    sourceDescriptorHelper: datasetSourceDescriptor,
    inferredHeads: [
      { target: "bbox", headType: "regression" },
      { target: "label", headType: "classification" },
    ],
    defaultTarget: "bbox",
  });
  assert(preparedSourceBacked.useSourceReference === true, "source-backed dataset should preserve server reference");
  assert(preparedSourceBacked.dataset.sourceDescriptor, "prepared source-backed descriptor missing");
  assert(Array.isArray(preparedSourceBacked.dataset.xTrain) && preparedSourceBacked.dataset.xTrain.length === 0, "prepared source-backed should not embed rows");

  global.window = global.window || {};
  delete global.window.SYNTHETIC_DETECTION_PRESET;
  require(path.join(ROOT, "demo", "Synthetic-Detection", "preset.js"));
  const preset = global.window.SYNTHETIC_DETECTION_PRESET;
  assert(preset && Array.isArray(preset.evaluations) && preset.evaluations.length, "synthetic_detection preset missing evaluation");
  const evalCard = preset.evaluations[0];
  assert(Array.isArray(evalCard.evaluatorIds), "synthetic_detection preset evaluatorIds missing");
  assert(evalCard.evaluatorIds.indexOf("bbox_mae") >= 0, "synthetic_detection preset bbox_mae missing");
  assert(evalCard.evaluatorIds.indexOf("class_accuracy") >= 0, "synthetic_detection preset class_accuracy missing");
  assert(evalCard.evaluatorIds.indexOf("iou_mean") >= 0, "synthetic_detection preset iou_mean missing");

  console.log("PASS test_contract_task_recipe_foundation");
}

main().catch((err) => {
  console.error("FAIL test_contract_task_recipe_foundation:", err && err.message ? err.message : err);
  process.exit(1);
});

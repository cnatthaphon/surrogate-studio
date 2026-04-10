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

  console.log("PASS test_contract_task_recipe_foundation");
}

main().catch((err) => {
  console.error("FAIL test_contract_task_recipe_foundation:", err && err.message ? err.message : err);
  process.exit(1);
});

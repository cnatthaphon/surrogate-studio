#!/usr/bin/env node
"use strict";

var assert = require("assert");
var path = require("path");

var taskRecipeRegistry = require(path.resolve(__dirname, "..", "src", "task_recipe_registry.js"));
require(path.resolve(__dirname, "..", "src", "task_recipe_definitions_builtin.js"));
var taskRecipeRuntime = require(path.resolve(__dirname, "..", "src", "task_recipe_runtime.js"));
var predictionCore = require(path.resolve(__dirname, "..", "src", "prediction_core.js"));

(function main() {
  // 1. Recipe registered
  var recipe = taskRecipeRegistry.getRecipe("segmentation_mask");
  assert.ok(recipe, "segmentation_mask recipe should be registered");
  assert.strictEqual(recipe.family, "segmentation", "recipe family should be segmentation");
  assert.strictEqual(recipe.trainMode, "standard", "recipe trainMode should be standard");

  // 2. Suggested metrics
  var metrics = taskRecipeRuntime.getSuggestedMetricIds(recipe, ["mae"]);
  assert.ok(metrics.indexOf("mask_iou") >= 0, "should suggest mask_iou");
  assert.ok(metrics.indexOf("dice") >= 0, "should suggest dice");
  assert.ok(metrics.indexOf("pixel_accuracy") >= 0, "should suggest pixel_accuracy");

  // 3. Predictive mode
  var mode = taskRecipeRuntime.getPredictiveMode(recipe, []);
  assert.strictEqual(mode, "segmentation", "predictive mode should be segmentation");

  // 4. isSegmentationRecipe
  assert.ok(taskRecipeRuntime.isSegmentationRecipe(recipe), "should detect segmentation recipe");
  assert.ok(!taskRecipeRuntime.isDetectionRecipe(recipe), "should not detect as detection");

  // 5. Mask IoU
  var iou = predictionCore.computeMaskIoU([1, 1, 0, 0], [1, 0, 0, 0], 0.5);
  assert.ok(Math.abs(iou - 0.5) < 0.01, "IoU of [1,1,0,0] vs [1,0,0,0] should be 0.5, got " + iou);

  var iouPerfect = predictionCore.computeMaskIoU([1, 1, 0, 0], [1, 1, 0, 0], 0.5);
  assert.ok(Math.abs(iouPerfect - 1.0) < 0.01, "Perfect IoU should be 1.0");

  // 6. Dice score
  var dice = predictionCore.computeDiceScore([1, 1, 0, 0], [1, 0, 0, 0], 0.5);
  assert.ok(Math.abs(dice - 2 / 3) < 0.01, "Dice of [1,1,0,0] vs [1,0,0,0] should be 2/3, got " + dice);

  // 7. Pixel accuracy
  var acc = predictionCore.computePixelAccuracy([1, 1, 0, 0], [1, 0, 0, 0], 0.5);
  assert.ok(Math.abs(acc - 0.75) < 0.01, "Pixel accuracy should be 0.75, got " + acc);

  // 7b. Length mismatch returns 0 (not silent truncation)
  var mismatchIou = predictionCore.computeMaskIoU([1], [1, 0, 0, 0], 0.5);
  assert.strictEqual(mismatchIou, 0, "Mismatched lengths should return 0 IoU, got " + mismatchIou);
  var mismatchDice = predictionCore.computeDiceScore([1], [1, 0, 0, 0], 0.5);
  assert.strictEqual(mismatchDice, 0, "Mismatched lengths should return 0 Dice, got " + mismatchDice);
  var mismatchAcc = predictionCore.computePixelAccuracy([1], [1, 0, 0, 0], 0.5);
  assert.strictEqual(mismatchAcc, 0, "Mismatched lengths should return 0 accuracy, got " + mismatchAcc);

  // 8. Batch segmentation metrics
  var batchMetrics = predictionCore.computeSegmentationMetrics(
    [[1, 1, 0, 0], [0, 0, 1, 1]],
    [[1, 1, 0, 0], [0, 0, 1, 1]],
    0.5
  );
  assert.ok(Math.abs(batchMetrics.mask_iou - 1.0) < 0.01, "Perfect batch IoU");
  assert.ok(Math.abs(batchMetrics.dice - 1.0) < 0.01, "Perfect batch Dice");
  assert.ok(Math.abs(batchMetrics.pixel_accuracy - 1.0) < 0.01, "Perfect batch accuracy");

  // 9. Dataset module builds
  var segModule = require(path.resolve(__dirname, "..", "src", "dataset_modules", "synthetic_segmentation_module.js"));
  var ds = segModule.buildDataset({ seed: 42, totalCount: 50 });
  assert.strictEqual(ds.schemaId, "synthetic_segmentation");
  assert.strictEqual(ds.taskRecipeId, "segmentation_mask");
  assert.strictEqual(ds.targetMode, "mask");
  assert.ok(ds.xTrain.length > 0, "should have train data");
  assert.ok(ds.yTrain.length > 0, "should have train masks");
  assert.strictEqual(ds.xTrain[0].length, 1024, "feature size should be 32*32=1024");
  assert.strictEqual(ds.yTrain[0].length, 1024, "mask size should be 32*32=1024");
  // Masks should be binary (0 or 1)
  var maskValues = ds.yTrain[0].filter(function (v) { return v !== 0 && v !== 1; });
  assert.strictEqual(maskValues.length, 0, "mask should be binary (0 or 1 only)");

  // 10. prepareDatasetForTraining
  globalThis.OSCSchemaRegistry = require(path.resolve(__dirname, "..", "src", "schema_registry.js"));
  require(path.resolve(__dirname, "..", "src", "schema_definitions_builtin.js"));
  var prepared = taskRecipeRuntime.prepareDatasetForTraining(
    globalThis.OSCSchemaRegistry, taskRecipeRegistry, "synthetic_segmentation", ds, {}
  );
  assert.ok(prepared.recipe, "should resolve recipe");
  assert.strictEqual(prepared.mode, "segmentation", "mode should be segmentation");
  assert.strictEqual(prepared.dataset.targetMode, "mask", "targetMode should be mask");
  // yTrain should be masks (same as input y), not one-hot encoded
  assert.strictEqual(prepared.dataset.yTrain[0].length, 1024, "prepared yTrain should be mask (1024 values)");

  console.log("PASS test_contract_segmentation_recipe");
})();

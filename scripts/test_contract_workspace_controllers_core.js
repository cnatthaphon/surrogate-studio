#!/usr/bin/env node
"use strict";

const assert = require("assert");
const core = require("../src/workspace_controllers_core.js");

function main() {
  assert(core && typeof core.createPreviewController === "function", "controller factory missing");
  const order = [];

  const preview = core.createPreviewController({
    resizePlots: function () { order.push("preview:show"); },
    refreshWorkspace: function () { order.push("preview:paint"); },
  });
  preview.afterShow({});
  preview.afterPaint({});

  const dataset = core.createDatasetController({
    refreshModuleSelect: function () { order.push("dataset:module"); },
    showSubTab: function () { order.push("dataset:subtab"); },
    refreshDetailPanel: function () { order.push("dataset:detail"); },
    getActiveDatasetId: function () { return "ds_1"; },
    shouldLoadActiveDataset: function () { return true; },
    loadActiveDataset: function (_, id) { order.push("dataset:load:" + id); },
  });
  dataset.afterPaint({});

  const datasetSkip = core.createDatasetController({
    refreshModuleSelect: function () { order.push("dataset-skip:module"); },
    showSubTab: function () { order.push("dataset-skip:subtab"); },
    refreshDetailPanel: function () { order.push("dataset-skip:detail"); },
    getActiveDatasetId: function () { return "ds_2"; },
    shouldLoadActiveDataset: function () { return false; },
    loadActiveDataset: function () { order.push("dataset-skip:load:unexpected"); },
  });
  datasetSkip.afterPaint({});

  const model = core.createModelController({
    hasActiveModel: function () { return true; },
    shouldLoadActiveModel: function () { return true; },
    loadActiveModel: function () { order.push("model:load"); },
    refreshSelection: function () { order.push("model:refresh"); },
  });
  model.afterPaint({});

  const modelSkip = core.createModelController({
    hasActiveModel: function () { return true; },
    shouldLoadActiveModel: function () { return false; },
    loadActiveModel: function () { order.push("model:load:unexpected"); },
    refreshSelection: function () { order.push("model:refresh:unexpected"); },
  });
  modelSkip.afterPaint({});

  const modelEmpty = core.createModelController({
    hasActiveModel: function () { return false; },
    loadActiveModel: function () { order.push("model:load:unexpected"); },
    refreshSelection: function () { order.push("model:refresh"); },
  });
  modelEmpty.afterPaint({});

  const train = core.createTrainingController({
    refreshWorkspace: function () { order.push("train:paint"); },
  });
  train.afterPaint({});

  const gen = core.createGenerationController({
    resizePlots: function () { order.push("gen:show"); },
    refreshWorkspace: function () { order.push("gen:paint"); },
  });
  gen.afterShow({});
  gen.afterPaint({});

  const evalCtrl = core.createEvaluationController({
    resizePlots: function () { order.push("eval:show"); },
  });
  evalCtrl.afterShow({});

  assert.deepStrictEqual(order, [
    "preview:show",
    "preview:paint",
    "dataset:module",
    "dataset:subtab",
    "dataset:detail",
    "dataset:load:ds_1",
    "dataset-skip:module",
    "dataset-skip:subtab",
    "dataset-skip:detail",
    "model:load",
    "model:refresh",
    "train:paint",
    "gen:show",
    "gen:paint",
    "eval:show",
  ], "workspace controller contract mismatch");

  console.log("PASS test_contract_workspace_controllers_core");
}

main();

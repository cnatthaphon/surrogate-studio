#!/usr/bin/env node
"use strict";

const assert = require("assert");
const core = require("../src/workspace_lab_handlers_core.js");

function main() {
  assert(core && typeof core.createRuntime === "function", "createRuntime missing");
  const order = [];
  const runtime = core.createRuntime({
    previewAfterShow: function () { order.push("show:preview"); },
    generationAfterShow: function () { order.push("show:gen"); },
    evaluationAfterShow: function () { order.push("show:eval"); },
    loadActiveModel: function () { order.push("paint:nn:load"); },
    refreshModelSelection: function () { order.push("paint:nn:refresh"); },
    refreshTrainingWorkspace: function () { order.push("paint:train"); },
    refreshDatasetWorkspace: function () { order.push("paint:dataset"); },
    refreshPreviewWorkspace: function () { order.push("paint:preview"); },
    refreshGenerationWorkspace: function () { order.push("paint:gen"); },
  });

  const afterShow = runtime.getAfterShowHandlers();
  const afterPaint = runtime.getAfterPaintHandlers();
  afterShow.preview({});
  afterShow.gen({});
  afterShow.eval({});
  afterPaint.nn({ hasActiveModel: true });
  afterPaint.nn({ hasActiveModel: false });
  afterPaint.train({});
  afterPaint.dataset({});
  afterPaint.preview({});
  afterPaint.gen({});

  assert.deepStrictEqual(order, [
    "show:preview",
    "show:gen",
    "show:eval",
    "paint:nn:load",
    "paint:nn:refresh",
    "paint:train",
    "paint:dataset",
    "paint:preview",
    "paint:gen",
  ], "workspace lab handlers mismatch");

  console.log("PASS test_contract_workspace_lab_handlers_core");
}

main();

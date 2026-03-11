#!/usr/bin/env node
"use strict";

const assert = require("assert");
const core = require("../src/workspace_selection_ui_core.js");

function main() {
  assert(core && typeof core.createRuntime === "function", "createRuntime missing");
  const applied = [];
  const runtime = core.createRuntime({
    applySelectionState: function (payload) {
      applied.push(Boolean(payload && payload.selected));
      if (payload && payload.selected && typeof payload.onSelected === "function") payload.onSelected();
      if (payload && !payload.selected && typeof payload.onEmpty === "function") payload.onEmpty();
    },
  });

  const none = runtime.buildDatasetDetailState(null);
  assert.deepStrictEqual(none, {
    hasSelection: false,
    title: "No dataset selected",
    meta: "Select dataset from left panel or click New Dataset.",
    hideMeta: false,
  }, "empty dataset detail state mismatch");

  const selected = runtime.buildDatasetDetailState({ id: "ds_1", name: "fashion" });
  assert.deepStrictEqual(selected, {
    hasSelection: true,
    title: "fashion",
    meta: "",
    hideMeta: true,
  }, "selected dataset detail state mismatch");

  const log = [];
  runtime.applyDatasetSelectionUi({
    hasSelection: false,
    onEmpty: function () { log.push("dataset:empty"); },
  });
  runtime.applyDatasetSelectionUi({
    hasSelection: true,
    onSelected: function () { log.push("dataset:selected"); },
  });

  const emptyEl = { style: { display: "" } };
  const contentEl = { style: { display: "none" } };
  runtime.applyModelSelectionUi({
    hasSelection: false,
    emptyEl: emptyEl,
    contentEl: contentEl,
    renderPalette: function () { log.push("model:palette"); },
  });
  assert.strictEqual(emptyEl.style.display, "", "model empty element should remain visible");
  assert.strictEqual(contentEl.style.display, "", "model content element should be shown");
  runtime.applyModelSelectionUi({
    hasSelection: true,
    emptyEl: emptyEl,
    contentEl: contentEl,
  });
  assert.strictEqual(emptyEl.style.display, "none", "model empty element should hide with selection");

  assert.deepStrictEqual(applied, [false, true], "dataset selection application mismatch");
  assert.deepStrictEqual(log, [
    "dataset:empty",
    "dataset:selected",
    "model:palette",
  ], "workspace selection ui flow mismatch");

  console.log("PASS test_contract_workspace_selection_ui_core");
}

main();

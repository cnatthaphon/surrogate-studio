#!/usr/bin/env node
"use strict";

const assert = require("assert");
const core = require("../src/workspace_tab_effects_core.js");

function main() {
  assert(core && typeof core.createRuntime === "function", "createRuntime missing");
  const order = [];
  const runtime = core.createRuntime({
    afterShowHandlers: {
      preview: function (payload, id) {
        order.push("show:" + id + ":" + String(payload.kind || ""));
      },
    },
    afterPaintHandlers: {
      nn: function (payload, id) {
        order.push("paint:" + id + ":" + String(payload.kind || ""));
      },
      dataset: function () {
        order.push("paint:dataset");
      },
    },
  });

  assert.strictEqual(runtime.runAfterShow("preview", { kind: "chart" }), true, "preview afterShow should dispatch");
  assert.strictEqual(runtime.runAfterPaint("nn", { kind: "graph" }), true, "nn afterPaint should dispatch");
  assert.strictEqual(runtime.runAfterPaint("dataset", {}), true, "dataset afterPaint should dispatch");
  assert.strictEqual(runtime.runAfterShow("missing", {}), false, "unknown afterShow should return false");
  assert.strictEqual(runtime.runAfterPaint("missing", {}), false, "unknown afterPaint should return false");
  assert.deepStrictEqual(order, [
    "show:preview:chart",
    "paint:nn:graph",
    "paint:dataset",
  ], "workspace tab effects dispatch order mismatch");

  console.log("PASS test_contract_workspace_tab_effects_core");
}

main();

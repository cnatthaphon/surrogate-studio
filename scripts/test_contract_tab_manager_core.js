#!/usr/bin/env node
"use strict";

const assert = require("assert");
const tabCore = require("../src/tab_manager_core.js");

function makeClassList() {
  const set = new Set();
  return {
    toggle: function (name, force) {
      const key = String(name || "");
      if (force) set.add(key);
      else set.delete(key);
    },
    contains: function (name) {
      return set.has(String(name || ""));
    },
  };
}

function makeEl() {
  return { classList: makeClassList() };
}

function main() {
  assert(tabCore && typeof tabCore.createRuntime === "function", "createRuntime missing");
  const order = [];
  const previewTab = makeEl();
  const previewPane = makeEl();
  const modelTab = makeEl();
  const modelPane = makeEl();

  const runtime = tabCore.createRuntime({
    initialTabId: "preview",
    tabs: [
      { id: "preview", tabEl: previewTab, paneEl: previewPane },
      { id: "nn", tabEl: modelTab, paneEl: modelPane },
    ],
    defer: function (fn) {
      order.push("defer");
      fn();
    },
    onBeforeShow: function (next, prev) {
      order.push("before:" + prev + "->" + next);
    },
    onApplyState: function (next) {
      order.push("apply:" + next);
    },
    onAfterShow: function (next) {
      order.push("after:" + next);
    },
    onAfterPaint: function (next) {
      order.push("paint:" + next);
    },
  });

  assert.strictEqual(runtime.getActiveTabId(), "preview", "initial tab mismatch");
  assert.strictEqual(runtime.showTab("nn"), true, "showTab should succeed");
  assert.strictEqual(runtime.getActiveTabId(), "nn", "active tab should update");
  assert.strictEqual(previewTab.classList.contains("active"), false, "previous tab should deactivate");
  assert.strictEqual(modelTab.classList.contains("active"), true, "target tab should activate");
  assert.strictEqual(previewPane.classList.contains("active"), false, "previous pane should deactivate");
  assert.strictEqual(modelPane.classList.contains("active"), true, "target pane should activate");
  assert.deepStrictEqual(order, [
    "before:preview->nn",
    "apply:nn",
    "after:nn",
    "defer",
    "paint:nn",
  ], "callback order mismatch");

  assert.strictEqual(runtime.showTab("missing"), false, "unknown tab should fail");
  assert.strictEqual(runtime.getActiveTabId(), "nn", "active tab should stay unchanged on failure");

  const queued = [];
  const raceOrder = [];
  const raceRuntime = tabCore.createRuntime({
    initialTabId: "preview",
    tabs: [
      { id: "preview", tabEl: makeEl(), paneEl: makeEl() },
      { id: "nn", tabEl: makeEl(), paneEl: makeEl() },
    ],
    defer: function (fn) {
      queued.push(fn);
    },
    onAfterPaint: function (next) {
      raceOrder.push("paint:" + next);
    },
  });
  assert.strictEqual(raceRuntime.showTab("nn"), true, "race showTab nn should succeed");
  assert.strictEqual(raceRuntime.showTab("preview"), true, "race showTab preview should succeed");
  assert.strictEqual(queued.length, 2, "deferred paint queue length mismatch");
  queued[0]();
  queued[1]();
  assert.deepStrictEqual(raceOrder, ["paint:preview"], "stale afterPaint callback should be suppressed");

  console.log("PASS test_contract_tab_manager_core");
}

main();

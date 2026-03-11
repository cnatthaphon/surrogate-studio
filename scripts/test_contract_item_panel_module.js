#!/usr/bin/env node
"use strict";

const assert = require("assert");

let renderCalls = [];
let activeCalls = [];

globalThis.OSCUiSharedEngine = {
  renderItemList: function (cfg) {
    renderCalls.push(cfg);
    return { itemById: { a1: { id: "a1" } } };
  },
  setActiveItemClassById: function (cfg, mountEl, activeItemId) {
    activeCalls.push({ cfg: cfg, mountEl: mountEl, activeItemId: activeItemId });
  },
  escapeHtml: function (s) {
    return String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  },
};

const panelModule = require("../src/item_panel_module.js");

function main() {
  assert(panelModule && typeof panelModule.create === "function", "create missing");
  const mountEl = { innerHTML: "" };
  const panel = panelModule.create({ mountEl: mountEl });
  assert(panel && typeof panel.render === "function", "render missing");
  assert.strictEqual(typeof panel.setActiveItem, "function", "setActiveItem missing");
  assert.strictEqual(typeof panel.clear, "function", "clear missing");
  assert.strictEqual(typeof panel.destroy, "function", "destroy missing");

  const result = panel.render({
    emptyText: "No items",
    items: [{ id: "a1", title: "Item A" }],
    onOpen: function () {},
  });
  assert(result && result.itemById && result.itemById.a1, "render should return engine result");
  assert.strictEqual(renderCalls.length, 1, "render should call shared engine once");
  assert.strictEqual(renderCalls[0].mountEl, mountEl, "mountEl should be forwarded");
  assert.strictEqual(renderCalls[0].items.length, 1, "items should be forwarded");

  panel.setActiveItem("a1");
  assert.strictEqual(activeCalls.length, 1, "setActiveItem should call shared engine helper");
  assert.strictEqual(activeCalls[0].mountEl, mountEl, "active helper mount mismatch");
  assert.strictEqual(activeCalls[0].activeItemId, "a1", "active item mismatch");

  panel.clear("No <items>");
  assert(mountEl.innerHTML.includes("&lt;items&gt;"), "clear should escape html");

  panel.destroy();
  console.log("PASS test_contract_item_panel_module");
}

main();

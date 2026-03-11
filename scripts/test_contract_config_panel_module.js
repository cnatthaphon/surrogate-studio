#!/usr/bin/env node
"use strict";

const assert = require("assert");

let destroyCount = 0;
let renderCalls = [];

function makeApi(tag) {
  return {
    tag: tag,
    destroy: function () {
      destroyCount += 1;
    },
    getConfig: function () {
      return { tag: tag };
    },
  };
}

globalThis.OSCUiSharedEngine = {
  renderConfigForm: function (cfg) {
    renderCalls.push(cfg);
    return makeApi("api_" + renderCalls.length);
  },
};

const panelModule = require("../src/config_panel_module.js");

function main() {
  assert(panelModule && typeof panelModule.create === "function", "create missing");
  const mountEl = { innerHTML: "" };
  const panel = panelModule.create({ mountEl: mountEl });
  assert(panel && typeof panel.render === "function", "render missing");
  assert.strictEqual(typeof panel.clear, "function", "clear missing");
  assert.strictEqual(typeof panel.getFormApi, "function", "getFormApi missing");
  assert.strictEqual(typeof panel.destroy, "function", "destroy missing");

  const api1 = panel.render({
    schema: [{ key: "name", label: "Name" }],
    value: { name: "a" },
  });
  assert.strictEqual(renderCalls.length, 1, "first render missing");
  assert.strictEqual(renderCalls[0].mountEl, mountEl, "mountEl should be forwarded");
  assert.strictEqual(panel.getFormApi(), api1, "getFormApi should return active api");

  const api2 = panel.render({
    schema: [{ key: "name", label: "Name" }],
    value: { name: "b" },
  });
  assert.strictEqual(renderCalls.length, 2, "second render missing");
  assert.strictEqual(destroyCount, 1, "previous form should be destroyed before rerender");
  assert.strictEqual(panel.getFormApi(), api2, "getFormApi should update after rerender");

  panel.clear("<div>empty</div>");
  assert.strictEqual(destroyCount, 2, "clear should destroy current form");
  assert.strictEqual(panel.getFormApi(), null, "clear should reset api");
  assert.strictEqual(mountEl.innerHTML, "<div>empty</div>", "clear should set mount html");

  panel.render({ schema: [], value: {} });
  panel.destroy();
  assert.strictEqual(destroyCount, 3, "destroy should destroy active form");

  console.log("PASS test_contract_config_panel_module");
}

main();

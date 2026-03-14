"use strict";
var assert = require("assert");
var MT = require("../src/tabs/model_tab.js");

function main() {
  assert(MT, "module loaded");
  assert.strictEqual(typeof MT.create, "function");

  var tab = MT.create({
    layout: { leftEl: {}, mainEl: {}, rightEl: {} },
    stateApi: { getActiveSchema: function () { return "mnist"; }, getActiveModel: function () { return ""; }, setActiveModel: function () {} },
    store: {
      listModels: function () { return []; },
      upsertModel: function () {},
    },
    schemaRegistry: {
      getModelSchema: function (id) {
        if (id === "mnist") return {
          palette: { input: {}, dense: {}, image_source: {}, output: {} },
          presets: { mnist_mlp_baseline: {} },
        };
        return { palette: {}, presets: {} };
      },
    },
  });

  assert.strictEqual(typeof tab.mount, "function", "has mount");
  assert.strictEqual(typeof tab.unmount, "function", "has unmount");
  assert.strictEqual(typeof tab.refresh, "function", "has refresh");
  assert.strictEqual(typeof tab.getEditor, "function", "has getEditor");

  // verify no hardcoded schema names
  var src = require("fs").readFileSync(require("path").join(__dirname, "../src/tabs/model_tab.js"), "utf8");
  assert(src.indexOf('"oscillator"') === -1, "no hardcoded oscillator");
  assert(src.indexOf('"mnist"') === -1, "no hardcoded mnist");

  console.log("PASS test_contract_model_tab");
}

main();

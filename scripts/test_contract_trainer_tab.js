"use strict";
var assert = require("assert");
var TT = require("../src/tabs/trainer_tab.js");

function main() {
  assert(TT, "module loaded");
  assert.strictEqual(typeof TT.create, "function");

  var tab = TT.create({
    layout: { leftEl: {}, mainEl: {}, rightEl: {} },
    stateApi: {
      getActiveSchema: function () { return "fashion_mnist"; },
      getActiveTrainer: function () { return ""; },
      setActiveTrainer: function () {},
    },
    store: {
      listTrainerCards: function () { return []; },
      listDatasets: function (f) { return [{ id: "ds1", name: "ds1", schemaId: f.schemaId }]; },
      listModels: function (f) { return [{ id: "m1", name: "m1", schemaId: f.schemaId }]; },
      getDataset: function (id) { return { id: id, schemaId: "fashion_mnist" }; },
      getModel: function (id) { return { id: id, schemaId: "fashion_mnist" }; },
      upsertTrainerCard: function () {},
      appendTrainerEpoch: function () {},
      getTrainerEpochs: function () { return []; },
    },
    trainingEngine: { OPTIMIZER_TYPES: ["adam", "sgd"], LR_SCHEDULER_TYPES: ["plateau", "none"] },
  });

  assert.strictEqual(typeof tab.mount, "function");
  assert.strictEqual(typeof tab.unmount, "function");
  assert.strictEqual(typeof tab.refresh, "function");

  // verify no hardcoded schemas
  var src = require("fs").readFileSync(require("path").join(__dirname, "../src/tabs/trainer_tab.js"), "utf8");
  assert(src.indexOf('"oscillator"') === -1, "no hardcoded oscillator");
  assert(src.indexOf('"mnist"') === -1, "no hardcoded mnist");

  console.log("PASS test_contract_trainer_tab");
}

main();

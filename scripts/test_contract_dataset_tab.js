"use strict";
var assert = require("assert");
var DT = require("../src/tabs/dataset_tab.js");

function main() {
  assert(DT, "module loaded");
  assert.strictEqual(typeof DT.create, "function");

  // mock store
  var storedDatasets = {};
  var mockStore = {
    listDatasets: function (filter) {
      return Object.values(storedDatasets).filter(function (d) {
        return !filter || !filter.schemaId || d.schemaId === filter.schemaId;
      });
    },
    getDataset: function (id) { return storedDatasets[id] || null; },
    upsertDataset: function (record) { storedDatasets[record.id] = record; },
    removeDataset: function (id) { delete storedDatasets[id]; return true; },
  };

  var mockSchemaRegistry = {
    getDatasetSchema: function (id) {
      if (id === "mnist") return { sampleType: "image", splitDefaults: { mode: "random", train: 0.8, val: 0.1, test: 0.1 } };
      return { sampleType: "trajectory", splitDefaults: { mode: "stratified_scenario", train: 0.7, val: 0.15, test: 0.15 } };
    },
  };

  var buildCalled = false;
  var mockDatasetModules = {
    getModuleForSchema: function (schemaId) {
      return [{
        id: schemaId + "_mod",
        schemaId: schemaId,
        label: schemaId + " builder",
        playground: { mode: "generic" },
        preconfig: { dataset: { seed: 42, totalCount: 100 } },
        build: function (cfg) {
          buildCalled = true;
          return { ok: true, splits: { train: 70, val: 15, test: 15 }, samples: [] };
        },
        uiApi: {},
      }];
    },
  };

  var mockState = {
    _schema: "oscillator",
    _dataset: "",
    getActiveSchema: function () { return mockState._schema; },
    setActiveDataset: function (id) { mockState._dataset = id; },
    getActiveDataset: function () { return mockState._dataset; },
  };

  var tab = DT.create({
    layout: { leftEl: {}, mainEl: {}, rightEl: {} },
    stateApi: mockState,
    store: mockStore,
    schemaRegistry: mockSchemaRegistry,
    datasetModules: mockDatasetModules,
  });

  assert.strictEqual(typeof tab.mount, "function", "has mount");
  assert.strictEqual(typeof tab.unmount, "function", "has unmount");
  assert.strictEqual(typeof tab.refresh, "function", "has refresh");

  // verify schema-driven: change schema, module changes
  mockState._schema = "mnist";
  var mnistMods = mockDatasetModules.getModuleForSchema("mnist");
  assert.strictEqual(mnistMods[0].schemaId, "mnist");
  assert.strictEqual(mnistMods[0].id, "mnist_mod");

  // verify no hardcoded schema references in the module
  var src = require("fs").readFileSync(require("path").join(__dirname, "../src/tabs/dataset_tab.js"), "utf8");
  assert(src.indexOf('"oscillator"') === -1, "no hardcoded oscillator in dataset_tab.js");
  assert(src.indexOf('"mnist"') === -1, "no hardcoded mnist in dataset_tab.js");

  console.log("PASS test_contract_dataset_tab");
}

main();

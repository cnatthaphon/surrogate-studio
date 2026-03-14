"use strict";
var assert = require("assert");
var PT = require("../src/tabs/playground_tab.js");

function main() {
  assert(PT, "module loaded");
  assert.strictEqual(typeof PT.create, "function");

  // mock dependencies
  var mockSchemaRegistry = {
    listSchemas: function () {
      return [
        { id: "oscillator", label: "Oscillator", description: "RK4 oscillator" },
        { id: "mnist", label: "MNIST", description: "MNIST digits" },
        { id: "fashion_mnist", label: "Fashion MNIST", description: "Fashion items" },
      ];
    },
    getSchema: function (id) {
      if (id === "oscillator") return {
        id: "oscillator", label: "Oscillator", description: "RK4",
        dataset: { sampleType: "trajectory", splitDefaults: { mode: "stratified_scenario", train: 0.7, val: 0.15, test: 0.15 } },
        model: {
          palette: { input: {}, dense: {}, lstm: {}, output: {} },
          presets: { ar_lstm_strong: {} },
        },
      };
      if (id === "mnist") return {
        id: "mnist", label: "MNIST", description: "Digits",
        dataset: { sampleType: "image", splitDefaults: { mode: "random", train: 0.8, val: 0.1, test: 0.1 } },
        model: {
          palette: { input: {}, dense: {}, image_source: {}, output: {} },
          presets: { mnist_mlp_baseline: {} },
        },
      };
      return null;
    },
    getOutputKeys: function (id) {
      if (id === "oscillator") return ["x", "v", "xv", "params"];
      if (id === "mnist") return ["logits", "label"];
      return [];
    },
  };

  var mockDatasetModules = {
    getModuleForSchema: function (schemaId) {
      if (schemaId === "oscillator") return [{ id: "oscillator", schemaId: "oscillator", label: "Oscillator RK4", playground: { mode: "trajectory_simulation" } }];
      if (schemaId === "mnist") return [{ id: "mnist", schemaId: "mnist", label: "MNIST Builder", playground: { mode: "image_dataset" } }];
      return [];
    },
  };

  var mockStateApi = {
    getActiveSchema: function () { return "oscillator"; },
  };

  // Test that create returns correct API
  var tab = PT.create({
    layout: { leftEl: {}, mainEl: {}, rightEl: {} },
    stateApi: mockStateApi,
    schemaRegistry: mockSchemaRegistry,
    datasetModules: mockDatasetModules,
  });

  assert.strictEqual(typeof tab.mount, "function", "has mount");
  assert.strictEqual(typeof tab.unmount, "function", "has unmount");
  assert.strictEqual(typeof tab.refresh, "function", "has refresh");

  console.log("PASS test_contract_playground_tab");
}

main();

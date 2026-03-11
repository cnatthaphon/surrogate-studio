(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    var mnistPack = null;
    try {
      mnistPack = require("./mnist_module.js");
    } catch (_err) {
      mnistPack = null;
    }
    module.exports = factory(root, mnistPack);
    return;
  }
  var descriptor = factory(root, root.OSCDatasetModuleMnist || null);
  root.OSCDatasetModuleFashionMnist = descriptor;
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModule === "function") {
    root.OSCDatasetModules.registerModule(descriptor);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, mnistPack) {
  "use strict";

  function resolveBuilder() {
    if (mnistPack && typeof mnistPack.buildMnistDataset === "function") {
      return mnistPack.buildMnistDataset;
    }
    if (
      root &&
      root.OSCDatasetModuleMnist &&
      typeof root.OSCDatasetModuleMnist.buildMnistDataset === "function"
    ) {
      return root.OSCDatasetModuleMnist.buildMnistDataset;
    }
    return null;
  }

  function resolveImageDatasetUiApiFactory() {
    if (mnistPack && typeof mnistPack.createImageDatasetUiApi === "function") {
      return mnistPack.createImageDatasetUiApi;
    }
    if (
      root &&
      root.OSCDatasetModuleMnist &&
      typeof root.OSCDatasetModuleMnist.createImageDatasetUiApi === "function"
    ) {
      return root.OSCDatasetModuleMnist.createImageDatasetUiApi;
    }
    return null;
  }

  return {
    id: "fashion_mnist",
    schemaId: "fashion_mnist",
    label: "Fashion-MNIST",
    description: "Fashion-MNIST image classification builder from source dataset.",
    helpText: "Fashion-MNIST image classification builder (real source, lazy-loaded once). | split modes: random, stratified_label(stratify=label) | columns: split, index, label, class_name, pixel_values",
    kind: "panel_builder",
    playground: {
      mode: "image_dataset",
    },
    preconfig: {
      dataset: {
        seed: 42,
        totalCount: 1400,
        splitDefaults: {
          mode: "stratified_label",
          train: 0.8,
          val: 0.1,
          test: 0.1
        }
      },
      model: {
        defaultPreset: "mnist_mlp_baseline"
      }
    },
    build: function (cfg) {
      var buildMnistDataset = resolveBuilder();
      if (!buildMnistDataset) {
        throw new Error("OSCDatasetModuleFashionMnist requires mnist_module.js to be loaded first.");
      }
      return buildMnistDataset(Object.assign({}, cfg || {}, { variant: "fashion_mnist" }));
    },
    uiApi: (function () {
      var createUiApi = resolveImageDatasetUiApiFactory();
      return createUiApi ? createUiApi({
        schemaId: "fashion_mnist",
        defaultSplitMode: "stratified_label",
        defaultTotalCount: 1400,
      }) : null;
    })(),
  };
});

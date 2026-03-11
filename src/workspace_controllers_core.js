(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCWorkspaceControllersCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function noop() {}

  function pickFn(cfg, key) {
    return cfg && typeof cfg[key] === "function" ? cfg[key] : noop;
  }

  function createPreviewController(config) {
    var cfg = config && typeof config === "object" ? config : {};
    var resizePlots = pickFn(cfg, "resizePlots");
    var refreshWorkspace = pickFn(cfg, "refreshWorkspace");
    return {
      afterShow: function (payload) {
        resizePlots(payload || {});
      },
      afterPaint: function (payload) {
        refreshWorkspace(payload || {});
      },
    };
  }

  function createDatasetController(config) {
    var cfg = config && typeof config === "object" ? config : {};
    var refreshModuleSelect = pickFn(cfg, "refreshModuleSelect");
    var showSubTab = pickFn(cfg, "showSubTab");
    var refreshDetailPanel = pickFn(cfg, "refreshDetailPanel");
    var getActiveDatasetId = pickFn(cfg, "getActiveDatasetId");
    var shouldLoadActiveDataset = pickFn(cfg, "shouldLoadActiveDataset");
    var loadActiveDataset = pickFn(cfg, "loadActiveDataset");
    var onError = pickFn(cfg, "onError");
    return {
      afterPaint: function (payload) {
        var info = payload || {};
        refreshModuleSelect(info);
        showSubTab(info);
        refreshDetailPanel(info);
        var activeId = String(getActiveDatasetId(info) || "").trim();
        if (!activeId) return;
        if (shouldLoadActiveDataset(info, activeId) === false) return;
        try {
          loadActiveDataset(info, activeId);
        } catch (err) {
          onError(err, info, activeId);
        }
      },
    };
  }

  function createModelController(config) {
    var cfg = config && typeof config === "object" ? config : {};
    var hasActiveModel = pickFn(cfg, "hasActiveModel");
    var shouldLoadActiveModel = pickFn(cfg, "shouldLoadActiveModel");
    var loadActiveModel = pickFn(cfg, "loadActiveModel");
    var refreshSelection = pickFn(cfg, "refreshSelection");
    return {
      afterPaint: function (payload) {
        var info = payload || {};
        if (hasActiveModel(info)) {
          if (shouldLoadActiveModel(info) === false) return;
          loadActiveModel(info);
          return;
        }
        refreshSelection(info);
      },
    };
  }

  function createTrainingController(config) {
    var cfg = config && typeof config === "object" ? config : {};
    var refreshWorkspace = pickFn(cfg, "refreshWorkspace");
    return {
      afterPaint: function (payload) {
        refreshWorkspace(payload || {});
      },
    };
  }

  function createGenerationController(config) {
    var cfg = config && typeof config === "object" ? config : {};
    var resizePlots = pickFn(cfg, "resizePlots");
    var refreshWorkspace = pickFn(cfg, "refreshWorkspace");
    return {
      afterShow: function (payload) {
        resizePlots(payload || {});
      },
      afterPaint: function (payload) {
        refreshWorkspace(payload || {});
      },
    };
  }

  function createEvaluationController(config) {
    var cfg = config && typeof config === "object" ? config : {};
    var resizePlots = pickFn(cfg, "resizePlots");
    return {
      afterShow: function (payload) {
        resizePlots(payload || {});
      },
    };
  }

  return {
    createPreviewController: createPreviewController,
    createDatasetController: createDatasetController,
    createModelController: createModelController,
    createTrainingController: createTrainingController,
    createGenerationController: createGenerationController,
    createEvaluationController: createEvaluationController,
  };
});

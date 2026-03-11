(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCWorkspaceLabHandlersCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function noop() {}

  function pickFn(cfg, key) {
    return cfg && typeof cfg[key] === "function" ? cfg[key] : noop;
  }

  function createRuntime(config) {
    var cfg = config && typeof config === "object" ? config : {};
    var previewAfterShow = pickFn(cfg, "previewAfterShow");
    var generationAfterShow = pickFn(cfg, "generationAfterShow");
    var evaluationAfterShow = pickFn(cfg, "evaluationAfterShow");
    var loadActiveModel = pickFn(cfg, "loadActiveModel");
    var refreshModelSelection = pickFn(cfg, "refreshModelSelection");
    var refreshTrainingWorkspace = pickFn(cfg, "refreshTrainingWorkspace");
    var refreshDatasetWorkspace = pickFn(cfg, "refreshDatasetWorkspace");
    var refreshPreviewWorkspace = pickFn(cfg, "refreshPreviewWorkspace");
    var refreshGenerationWorkspace = pickFn(cfg, "refreshGenerationWorkspace");

    return {
      getAfterShowHandlers: function () {
        return {
          preview: function (payload) {
            previewAfterShow(payload || {});
          },
          gen: function (payload) {
            generationAfterShow(payload || {});
          },
          eval: function (payload) {
            evaluationAfterShow(payload || {});
          },
        };
      },
      getAfterPaintHandlers: function () {
        return {
          nn: function (payload) {
            var info = payload || {};
            if (info.hasActiveModel) loadActiveModel(info);
            else refreshModelSelection(info);
          },
          train: function (payload) {
            refreshTrainingWorkspace(payload || {});
          },
          dataset: function (payload) {
            refreshDatasetWorkspace(payload || {});
          },
          preview: function (payload) {
            refreshPreviewWorkspace(payload || {});
          },
          gen: function (payload) {
            refreshGenerationWorkspace(payload || {});
          },
        };
      },
    };
  }

  return {
    createRuntime: createRuntime,
  };
});

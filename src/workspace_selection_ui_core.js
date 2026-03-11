(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCWorkspaceSelectionUiCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function noop() {}

  function createRuntime(config) {
    var cfg = config && typeof config === "object" ? config : {};
    var applySelectionState = typeof cfg.applySelectionState === "function" ? cfg.applySelectionState : noop;

    function buildDatasetDetailState(activeEntry) {
      var entry = activeEntry && typeof activeEntry === "object" ? activeEntry : null;
      if (!entry) {
        return {
          hasSelection: false,
          title: "No dataset selected",
          meta: "Select dataset from left panel or click New Dataset.",
          hideMeta: false,
        };
      }
      return {
        hasSelection: true,
        title: String(entry.name || entry.id || "dataset"),
        meta: "",
        hideMeta: true,
      };
    }

    function applyDatasetSelectionUi(payload) {
      var info = payload && typeof payload === "object" ? payload : {};
      var hasSelection = Boolean(info.hasSelection);
      applySelectionState({
        selected: hasSelection,
        emptyEl: info.emptyEl || null,
        disableWhenEmpty: Array.isArray(info.disableWhenEmpty) ? info.disableWhenEmpty : [],
        onEmpty: typeof info.onEmpty === "function" ? info.onEmpty : noop,
        onSelected: typeof info.onSelected === "function" ? info.onSelected : noop,
      });
      return hasSelection;
    }

    function applyModelSelectionUi(payload) {
      var info = payload && typeof payload === "object" ? payload : {};
      var hasSelection = Boolean(info.hasSelection);
      if (typeof info.renderPalette === "function") info.renderPalette();
      if (info.emptyEl && info.emptyEl.style) info.emptyEl.style.display = hasSelection ? "none" : "";
      if (info.contentEl && info.contentEl.style) info.contentEl.style.display = "";
      return hasSelection;
    }

    return {
      buildDatasetDetailState: buildDatasetDetailState,
      applyDatasetSelectionUi: applyDatasetSelectionUi,
      applyModelSelectionUi: applyModelSelectionUi,
    };
  }

  return {
    createRuntime: createRuntime,
  };
});

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCItemPanelModule = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function getUiSharedEngine() {
    if (typeof window !== "undefined" && window.OSCUiSharedEngine) return window.OSCUiSharedEngine;
    if (typeof globalThis !== "undefined" && globalThis.OSCUiSharedEngine) return globalThis.OSCUiSharedEngine;
    try {
      return require("./ui_shared_engine.js");
    } catch (_err) {
      return null;
    }
  }

  function create(config) {
    var engine = getUiSharedEngine();
    if (!engine || typeof engine.renderItemList !== "function") {
      throw new Error("OSCItemPanelModule requires OSCUiSharedEngine.renderItemList.");
    }
    var state = {
      mountEl: config && config.mountEl ? config.mountEl : null,
      lastConfig: null,
    };

    function render(nextConfig) {
      state.lastConfig = Object.assign({}, nextConfig || {}, {
        mountEl: state.mountEl,
      });
      return engine.renderItemList(state.lastConfig);
    }

    function setActiveItem(activeItemId) {
      if (!state.mountEl) return;
      engine.setActiveItemClassById(state.lastConfig || {}, state.mountEl, activeItemId);
    }

    function clear(emptyText) {
      if (!state.mountEl) return;
      state.mountEl.innerHTML = "<div class='hint'>" + engine.escapeHtml(String(emptyText || "No items.")) + "</div>";
    }

    function destroy() {
      state.lastConfig = null;
    }

    return {
      render: render,
      setActiveItem: setActiveItem,
      clear: clear,
      destroy: destroy,
    };
  }

  return {
    create: create,
  };
});

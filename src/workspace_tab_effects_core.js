(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCWorkspaceTabEffectsCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function noop() {}

  function normalizeHandlerMap(raw) {
    var out = {};
    var src = raw && typeof raw === "object" ? raw : {};
    Object.keys(src).forEach(function (key) {
      var id = String(key || "").trim();
      if (!id) return;
      if (typeof src[key] !== "function") return;
      out[id] = src[key];
    });
    return out;
  }

  function createRuntime(config) {
    var cfg = config && typeof config === "object" ? config : {};
    var afterShowHandlers = normalizeHandlerMap(cfg.afterShowHandlers);
    var afterPaintHandlers = normalizeHandlerMap(cfg.afterPaintHandlers);
    var onMissingAfterShow = typeof cfg.onMissingAfterShow === "function" ? cfg.onMissingAfterShow : noop;
    var onMissingAfterPaint = typeof cfg.onMissingAfterPaint === "function" ? cfg.onMissingAfterPaint : noop;

    function runMapped(map, tabId, payload, onMissing) {
      var id = String(tabId || "").trim();
      if (!id) return false;
      var fn = map[id];
      if (typeof fn === "function") {
        fn(payload || {}, id);
        return true;
      }
      onMissing(id, payload || {});
      return false;
    }

    return {
      runAfterShow: function (tabId, payload) {
        return runMapped(afterShowHandlers, tabId, payload, onMissingAfterShow);
      },
      runAfterPaint: function (tabId, payload) {
        return runMapped(afterPaintHandlers, tabId, payload, onMissingAfterPaint);
      },
    };
  }

  return {
    createRuntime: createRuntime,
  };
});

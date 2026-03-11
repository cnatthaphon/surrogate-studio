(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCTabManagerCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function noop() {}

  function normalizeTabs(raw) {
    var list = Array.isArray(raw) ? raw : [];
    return list
      .map(function (tab) {
        if (!tab || typeof tab !== "object") return null;
        var id = String(tab.id || "").trim();
        if (!id) return null;
        return {
          id: id,
          tabEl: tab.tabEl || null,
          paneEl: tab.paneEl || null,
        };
      })
      .filter(Boolean);
  }

  function createRuntime(config) {
    var cfg = config && typeof config === "object" ? config : {};
    var defer = typeof cfg.defer === "function" ? cfg.defer : function (fn) { setTimeout(fn, 0); };
    var getTabs = typeof cfg.getTabs === "function"
      ? cfg.getTabs
      : function () { return normalizeTabs(cfg.tabs); };
    var onBeforeShow = typeof cfg.onBeforeShow === "function" ? cfg.onBeforeShow : noop;
    var onAfterShow = typeof cfg.onAfterShow === "function" ? cfg.onAfterShow : noop;
    var onAfterPaint = typeof cfg.onAfterPaint === "function" ? cfg.onAfterPaint : noop;
    var onApplyState = typeof cfg.onApplyState === "function" ? cfg.onApplyState : noop;
    var activeTabId = String(cfg.initialTabId || "").trim();
    var showSeq = 0;

    function listTabs() {
      return normalizeTabs(getTabs());
    }

    function getActiveTabId() {
      return activeTabId;
    }

    function showTab(nextId) {
      var targetId = String(nextId || "").trim();
      if (!targetId) return false;
      var tabs = listTabs();
      var nextTab = null;
      tabs.forEach(function (tab) {
        if (tab.id === targetId) nextTab = tab;
      });
      if (!nextTab) return false;
      var prevId = activeTabId;
      onBeforeShow(targetId, prevId, nextTab, tabs);
      tabs.forEach(function (tab) {
        var isActive = tab.id === targetId;
        if (tab.tabEl && tab.tabEl.classList && typeof tab.tabEl.classList.toggle === "function") {
          tab.tabEl.classList.toggle("active", isActive);
        }
        if (tab.paneEl && tab.paneEl.classList && typeof tab.paneEl.classList.toggle === "function") {
          tab.paneEl.classList.toggle("active", isActive);
        }
      });
      activeTabId = targetId;
      showSeq += 1;
      var currentSeq = showSeq;
      onApplyState(targetId, prevId, nextTab, tabs);
      onAfterShow(targetId, prevId, nextTab, tabs);
      defer(function () {
        if (showSeq !== currentSeq) return;
        if (activeTabId !== targetId) return;
        onAfterPaint(targetId, prevId, nextTab, tabs);
      });
      return true;
    }

    return {
      listTabs: listTabs,
      getActiveTabId: getActiveTabId,
      showTab: showTab,
    };
  }

  return {
    createRuntime: createRuntime,
  };
});

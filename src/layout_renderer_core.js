(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCLayoutRendererCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var TAB_DEFS = [
    { id: "playground", label: "Playground" },
    { id: "dataset", label: "Dataset" },
    { id: "model", label: "Model" },
    { id: "trainer", label: "Trainer" },
    { id: "generation", label: "Generation" },
    { id: "evaluation", label: "Evaluation" },
  ];

  var CSS = [
    "* { box-sizing: border-box; }",
    "body { margin: 0; font-family: 'Segoe UI', Tahoma, sans-serif; background: #0f172a; color: #e2e8f0; }",
    ".osc-root { display: flex; flex-direction: column; min-height: 100vh; }",
    ".osc-header { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border-bottom: 1px solid #1e293b; background: #111827; }",
    ".osc-header h1 { margin: 0; font-size: 18px; color: #67e8f9; white-space: nowrap; }",
    ".osc-header select { padding: 4px 8px; border-radius: 6px; border: 1px solid #334155; background: #0b1220; color: #e2e8f0; font-size: 13px; }",
    ".osc-header .osc-status { font-size: 12px; color: #94a3b8; margin-left: auto; }",
    ".osc-tabs { display: flex; gap: 4px; padding: 6px 16px; background: #111827; border-bottom: 1px solid #1e293b; }",
    ".osc-tab-btn { padding: 6px 14px; border: 1px solid #334155; border-radius: 8px; background: #1e293b; color: #cbd5e1; cursor: pointer; font-size: 13px; font-weight: 500; }",
    ".osc-tab-btn.active { border-color: #0ea5e9; color: #67e8f9; background: #0c2340; }",
    ".osc-tab-btn:hover { border-color: #475569; }",
    ".osc-workspace { flex: 1; display: none; }",
    ".osc-workspace.active { display: grid; grid-template-columns: 260px 1fr 280px; min-height: 0; }",
    ".osc-panel-left { padding: 12px; border-right: 1px solid #1e293b; background: #111827; overflow-y: auto; max-height: calc(100vh - 90px); }",
    ".osc-panel-main { padding: 12px; overflow-y: auto; max-height: calc(100vh - 90px); }",
    ".osc-panel-right { padding: 12px; border-left: 1px solid #1e293b; background: #111827; overflow-y: auto; max-height: calc(100vh - 90px); }",
    ".osc-panel-left h3, .osc-panel-right h3 { margin: 0 0 8px; font-size: 13px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }",
    ".osc-item-list { list-style: none; padding: 0; margin: 0; }",
    ".osc-item-list li { padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: 13px; margin-bottom: 2px; }",
    ".osc-item-list li:hover { background: #1e293b; }",
    ".osc-item-list li.active { background: #0c2340; border: 1px solid #0ea5e9; color: #67e8f9; }",
    ".osc-btn { display: inline-block; padding: 6px 14px; border-radius: 8px; border: 1px solid #0ea5e9; background: linear-gradient(135deg, #0284c7, #0369a1); color: #fff; font-weight: 600; cursor: pointer; font-size: 13px; }",
    ".osc-btn:hover { filter: brightness(1.1); }",
    ".osc-btn.secondary { border-color: #475569; background: #1f2937; color: #cbd5e1; }",
    ".osc-btn.sm { padding: 3px 8px; font-size: 11px; }",
    ".osc-card { background: #111827; border: 1px solid #1e293b; border-radius: 10px; padding: 14px; margin-bottom: 10px; }",
    ".osc-form-row { display: grid; grid-template-columns: 1fr 120px; gap: 8px; margin-bottom: 6px; align-items: center; }",
    ".osc-form-row label { font-size: 12px; color: #cbd5e1; }",
    ".osc-form-row input, .osc-form-row select { padding: 6px 8px; border-radius: 6px; border: 1px solid #334155; background: #0b1220; color: #e2e8f0; font-size: 13px; }",
    ".osc-empty { color: #64748b; font-size: 13px; text-align: center; padding: 24px; }",
    ".osc-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; background: #1e293b; color: #94a3b8; }",
    "#drawflow { width: 100%; height: 400px; background: #f8fafc; border-radius: 10px; }",
    ".osc-palette { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }",
    ".osc-palette button { font-size: 11px; padding: 4px 8px; border-radius: 6px; border: 1px solid #475569; background: #1f2937; color: #cbd5e1; cursor: pointer; }",
    ".osc-palette button:hover { border-color: #0ea5e9; color: #67e8f9; }",
    ".osc-metric-table { width: 100%; border-collapse: collapse; font-size: 12px; }",
    ".osc-metric-table th, .osc-metric-table td { padding: 4px 8px; border-bottom: 1px solid #1e293b; text-align: left; }",
    ".osc-metric-table th { color: #94a3b8; font-weight: 500; }",
  ].join("\n");

  function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "className") e.className = attrs[k];
        else if (k === "textContent") e.textContent = attrs[k];
        else if (k === "innerHTML") e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
    }
    return e;
  }

  function render(mountEl, config) {
    if (!mountEl) throw new Error("mountEl required");
    var cfg = config || {};
    var schemas = Array.isArray(cfg.schemas) ? cfg.schemas : [];
    var defaultSchemaId = String(cfg.defaultSchemaId || "oscillator");

    // inject CSS
    var styleEl = document.createElement("style");
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    // root
    var root = el("div", { className: "osc-root" });

    // header
    var header = el("div", { className: "osc-header" });
    var title = el("h1", {}, "Surrogate Studio");
    var statusEl = el("span", { className: "osc-status" }, "Ready");
    header.appendChild(title);
    header.appendChild(statusEl);
    root.appendChild(header);

    // tab bar
    var tabBar = el("div", { className: "osc-tabs" });
    var tabBtns = {};
    TAB_DEFS.forEach(function (def) {
      var btn = el("button", { className: "osc-tab-btn", "data-tab": def.id }, def.label);
      tabBtns[def.id] = btn;
      tabBar.appendChild(btn);
    });
    root.appendChild(tabBar);

    // workspaces (one per tab, 3-panel each)
    var tabs = {};
    TAB_DEFS.forEach(function (def) {
      var ws = el("div", { className: "osc-workspace", "data-workspace": def.id });
      var leftEl = el("div", { className: "osc-panel-left" });
      var mainEl = el("div", { className: "osc-panel-main" });
      var rightEl = el("div", { className: "osc-panel-right" });
      ws.appendChild(leftEl);
      ws.appendChild(mainEl);
      ws.appendChild(rightEl);
      root.appendChild(ws);
      tabs[def.id] = {
        tabBtn: tabBtns[def.id],
        pane: ws,
        leftEl: leftEl,
        mainEl: mainEl,
        rightEl: rightEl,
      };
    });

    // modal backdrop
    var modalBackdrop = el("div", {
      className: "osc-modal-backdrop",
      style: "display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:1000;align-items:center;justify-content:center;",
    });
    var modalBox = el("div", {
      style: "background:#111827;border:1px solid #1e293b;border-radius:12px;padding:20px;min-width:340px;max-width:480px;",
    });
    var modalTitle = el("h3", { style: "color:#67e8f9;margin:0 0 12px;" }, "");
    var modalFormMount = el("div", {});
    var modalBtnRow = el("div", { style: "display:flex;gap:8px;margin-top:12px;justify-content:flex-end;" });
    var modalCancelBtn = el("button", { className: "osc-btn secondary" }, "Cancel");
    var modalCreateBtn = el("button", { className: "osc-btn" }, "Create");
    modalBtnRow.appendChild(modalCancelBtn);
    modalBtnRow.appendChild(modalCreateBtn);
    modalBox.appendChild(modalTitle);
    modalBox.appendChild(modalFormMount);
    modalBox.appendChild(modalBtnRow);
    modalBackdrop.appendChild(modalBox);
    root.appendChild(modalBackdrop);

    var _modalOnCreate = null;
    function openModal(config) {
      var cfg = config || {};
      modalTitle.textContent = String(cfg.title || "New Item");
      modalFormMount.innerHTML = "";
      if (cfg.renderForm) cfg.renderForm(modalFormMount);
      _modalOnCreate = cfg.onCreate || null;
      modalBackdrop.style.display = "flex";
    }
    function closeModal() {
      modalBackdrop.style.display = "none";
      _modalOnCreate = null;
    }
    modalCancelBtn.addEventListener("click", closeModal);
    modalBackdrop.addEventListener("click", function (e) { if (e.target === modalBackdrop) closeModal(); });
    modalCreateBtn.addEventListener("click", function () {
      if (typeof _modalOnCreate === "function") _modalOnCreate();
      closeModal();
    });

    mountEl.innerHTML = "";
    mountEl.appendChild(root);

    // tab switching
    var _activeTabId = null;
    var _onTabChange = null;

    function showTab(tabId) {
      var tid = String(tabId || "playground");
      if (!tabs[tid]) return;
      if (_activeTabId === tid) return;
      var prev = _activeTabId;
      _activeTabId = tid;
      TAB_DEFS.forEach(function (def) {
        var isActive = def.id === tid;
        tabs[def.id].tabBtn.classList.toggle("active", isActive);
        tabs[def.id].pane.classList.toggle("active", isActive);
      });
      if (typeof _onTabChange === "function") _onTabChange(tid, prev);
    }

    // wire tab clicks
    TAB_DEFS.forEach(function (def) {
      tabs[def.id].tabBtn.addEventListener("click", function () { showTab(def.id); });
    });

    function setStatus(msg) {
      statusEl.textContent = String(msg || "");
    }

    function onTabChange(cb) {
      _onTabChange = cb;
    }

    function getSchemaSelectEl() { return null; }
    function getActiveTabId() { return _activeTabId; }

    function destroy() {
      mountEl.innerHTML = "";
      if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    }

    return {
      tabs: tabs,
      header: { statusEl: statusEl, titleEl: title },
      modal: { open: openModal, close: closeModal, formMount: modalFormMount },
      showTab: showTab,
      setStatus: setStatus,
      onTabChange: onTabChange,
      getSchemaSelectEl: getSchemaSelectEl,
      getActiveTabId: getActiveTabId,
      destroy: destroy,
      TAB_DEFS: TAB_DEFS,
      escapeHtml: escapeHtml,
      el: el,
    };
  }

  return {
    render: render,
    TAB_DEFS: TAB_DEFS,
    CSS: CSS,
  };
});

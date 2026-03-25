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
    // reset + base — softer dark theme with good readability
    "* { box-sizing: border-box; margin: 0; }",
    "body { margin: 0; font-family: 'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1320; color: #cbd5e1; font-size: 13px; -webkit-font-smoothing: antialiased; }",
    "::selection { background: #0ea5e9; color: #fff; }",
    "::-webkit-scrollbar { width: 6px; height: 6px; }",
    "::-webkit-scrollbar-track { background: transparent; }",
    "::-webkit-scrollbar-thumb { background: #2d3748; border-radius: 3px; }",
    "::-webkit-scrollbar-thumb:hover { background: #4a5568; }",

    // layout
    ".osc-root { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }",
    ".osc-header { display: flex; align-items: center; gap: 10px; padding: 6px 14px; background: #141929; border-bottom: 1px solid #1e2740; }",
    ".osc-header h1 { margin: 0; font-size: 14px; font-weight: 700; color: #7dd3fc; white-space: nowrap; letter-spacing: -0.3px; }",
    ".osc-header select { padding: 3px 8px; border-radius: 5px; border: 1px solid #2d3748; background: #1a202e; color: #cbd5e1; font-size: 12px; outline: none; transition: border-color 0.2s; }",
    ".osc-header select:focus { border-color: #38bdf8; }",
    ".osc-header .osc-status { font-size: 11px; color: #94a3b8; margin-left: auto; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",

    // tabs
    ".osc-tabs { display: flex; gap: 0; padding: 0 14px; background: #141929; border-bottom: 1px solid #1e2740; }",
    ".osc-tab-btn { padding: 8px 16px; border: none; border-bottom: 2px solid transparent; background: transparent; color: #64748b; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.15s; }",
    ".osc-tab-btn:hover { color: #cbd5e1; background: rgba(255,255,255,0.03); }",
    ".osc-tab-btn.active { color: #7dd3fc; border-bottom-color: #38bdf8; }",

    // workspace
    ".osc-workspace { flex: 1; display: none; overflow: hidden; }",
    ".osc-workspace.active { display: grid; grid-template-columns: 220px 1fr 250px; min-height: 0; }",

    // panels — slightly lighter side panels for contrast
    ".osc-panel-left { padding: 8px; border-right: 1px solid #1e2740; background: #151b2c; overflow-y: auto; }",
    ".osc-panel-main { padding: 10px; overflow-y: auto; background: #0f1320; }",
    ".osc-panel-right { padding: 8px; border-left: 1px solid #1e2740; background: #151b2c; overflow-y: auto; font-size: 12px; }",
    ".osc-panel-left h3, .osc-panel-right h3 { margin: 0 0 6px; font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }",

    // item list
    ".osc-item-list { list-style: none; padding: 0; margin: 0; }",
    ".osc-item-list li { padding: 6px 8px; border-radius: 5px; cursor: pointer; font-size: 12px; margin-bottom: 1px; transition: background 0.1s; color: #94a3b8; }",
    ".osc-item-list li:hover { background: rgba(255,255,255,0.04); color: #cbd5e1; }",
    ".osc-item-list li.active { background: rgba(56,189,248,0.1); border-left: 2px solid #38bdf8; color: #e2e8f0; }",

    // buttons
    ".osc-btn { display: inline-flex; align-items: center; justify-content: center; padding: 5px 12px; border-radius: 6px; border: 1px solid #0ea5e9; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #fff; font-weight: 600; cursor: pointer; font-size: 12px; transition: all 0.15s; box-shadow: 0 1px 3px rgba(2,132,199,0.3); }",
    ".osc-btn:hover { filter: brightness(1.15); transform: translateY(-0.5px); box-shadow: 0 2px 6px rgba(2,132,199,0.4); }",
    ".osc-btn:active { transform: translateY(0); }",
    ".osc-btn.secondary { border-color: #1e293b; background: #111827; color: #94a3b8; box-shadow: none; }",
    ".osc-btn.secondary:hover { border-color: #334155; color: #cbd5e1; }",
    ".osc-btn.sm { padding: 2px 7px; font-size: 10px; }",

    // cards
    ".osc-card { background: #171d30; border: 1px solid #1e2740; border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; }",

    // forms — clearer labels and inputs
    ".osc-form-row, .row { display: grid; grid-template-columns: 1fr 110px; gap: 6px; margin-bottom: 4px; align-items: center; }",
    ".osc-form-row label, .row label { font-size: 11px; color: #94a3b8; }",
    ".osc-form-row input, .osc-form-row select, .row input, .row select { padding: 4px 7px; border-radius: 4px; border: 1px solid #2d3748; background: #1a202e; color: #e2e8f0; font-size: 12px; width: 100%; outline: none; transition: border-color 0.2s; }",
    ".osc-form-row input:focus, .osc-form-row select:focus, .row input:focus, .row select:focus { border-color: #38bdf8; box-shadow: 0 0 0 1px rgba(56,189,248,0.2); }",
    ".osc-form-row input[type='checkbox'] { width: auto; accent-color: #38bdf8; }",

    // empty state
    ".osc-empty { color: #4a5568; font-size: 12px; text-align: center; padding: 30px 16px; }",

    // badge
    ".osc-badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; background: #1e2740; color: #94a3b8; font-weight: 500; }",

    // drawflow — clean dark theme, compact nodes (config in right panel)
    "#drawflow { width: 100%; height: 420px; background: #0d1120; border-radius: 8px; border: 1px solid #1e2740; }",
    ".drawflow { background-image: radial-gradient(circle, #1e2740 1px, transparent 1px); background-size: 24px 24px; }",
    ".drawflow .drawflow-node { background: #1a2035; border: 1.5px solid #2d3748; border-radius: 6px; color: #cbd5e1; font-size: 11px; min-width: 100px; box-shadow: 0 2px 6px rgba(0,0,0,0.2); }",
    ".drawflow .drawflow-node.selected { border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56,189,248,0.2); }",
    ".drawflow .drawflow-node:hover { border-color: #4a5568; }",
    ".drawflow .drawflow-node .drawflow_content_node { padding: 6px 10px; }",
    // hide inline form fields — config goes in right panel
    ".drawflow .drawflow-node input, .drawflow .drawflow-node select { display: none; }",
    ".drawflow .drawflow-node .node-summary { display: block; font-size: 9px; color: #64748b; margin-top: 2px; }",
    ".drawflow .drawflow-node .input, .drawflow .drawflow-node .output { background: #38bdf8; width: 10px; height: 10px; }",
    ".drawflow .drawflow-node .input:hover, .drawflow .drawflow-node .output:hover { background: #7dd3fc; }",
    ".drawflow .connection .main-path { stroke: #4a5568; stroke-width: 2; }",
    ".drawflow .connection .main-path:hover { stroke: #38bdf8; stroke-width: 2.5; }",
    ".drawflow .drawflow-delete { background: #ef4444; border: none; color: #fff; border-radius: 50%; width: 18px; height: 18px; font-size: 10px; }",

    // palette — grouped with section labels
    ".osc-palette { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 6px; }",
    ".osc-palette button { font-size: 10px; padding: 3px 8px; border-radius: 4px; border: 1px solid #2d3748; background: #1a202e; color: #94a3b8; cursor: pointer; transition: all 0.15s; font-weight: 500; }",
    ".osc-palette button:hover { border-color: #38bdf8; color: #7dd3fc; background: rgba(56,189,248,0.06); }",
    ".osc-palette-group { font-size: 9px; color: #4a5568; text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 4px; width: 100%; margin-top: 4px; }",

    // metric table
    ".osc-metric-table { width: 100%; border-collapse: collapse; font-size: 11px; }",
    ".osc-metric-table th, .osc-metric-table td { padding: 4px 8px; border-bottom: 1px solid #1e2740; text-align: left; }",
    ".osc-metric-table th { color: #64748b; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }",
    ".osc-metric-table td { color: #cbd5e1; }",
    ".osc-metric-table tr:hover { background: rgba(255,255,255,0.02); }",

    // left panel item list (dataset/model/trainer)
    ".left-dataset-list { list-style: none; padding: 0; margin: 0; }",
    ".left-dataset-item { padding: 6px 8px; border-radius: 5px; cursor: pointer; font-size: 12px; margin-bottom: 1px; border: 1px solid transparent; transition: all 0.1s; }",
    ".left-dataset-item:hover { background: rgba(255,255,255,0.03); }",
    ".left-dataset-item.active { background: rgba(56,189,248,0.08); border-color: rgba(56,189,248,0.25); }",
    ".left-dataset-main { display: flex; justify-content: space-between; align-items: flex-start; }",
    ".left-dataset-open { font-weight: 600; color: #cbd5e1; font-size: 11px; flex: 1; }",
    ".left-dataset-item.active .left-dataset-open { color: #7dd3fc; }",
    ".left-dataset-meta { font-size: 9px; color: #64748b; margin-top: 1px; }",
    ".left-dataset-meta span { margin-right: 3px; }",
    ".left-dataset-actions { display: flex; gap: 3px; margin-top: 2px; }",
    ".left-dataset-actions button { padding: 0px 5px; font-size: 9px; border-radius: 3px; border: 1px solid #2d3748; background: transparent; color: #64748b; cursor: pointer; width: auto; transition: all 0.1s; }",
    ".left-dataset-actions button:hover { border-color: #38bdf8; color: #7dd3fc; }",
    ".left-dataset-actions button[data-item-action='delete'] { border-color: #7c2d12; color: #b45309; }",
    ".left-dataset-actions button[data-item-action='delete']:hover { background: rgba(127,29,29,0.15); color: #fdba74; }",

    // modal
    ".osc-modal-backdrop { backdrop-filter: blur(4px); }",

    // animations
    "@keyframes osc-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }",
    ".osc-card { animation: osc-fade-in 0.15s ease-out; }",
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
        else if (typeof c === "number") e.appendChild(document.createTextNode(String(c)));
        else if (c && c.nodeType) e.appendChild(c);
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

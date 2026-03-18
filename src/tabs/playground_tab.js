(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCPlaygroundTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCENARIO_DEFS = [
    { id: "spring", label: "Damped Spring",
      params: [
        { key: "m", label: "Mass m (kg)", value: 1.2 },
        { key: "c", label: "Damping c (Ns/m)", value: 0.25 },
        { key: "k", label: "Stiffness k (N/m)", value: 4.0 },
        { key: "x0", label: "Position x₀ (m)", value: 1.0 },
        { key: "v0", label: "Velocity v₀ (m/s)", value: 0.0 },
      ],
      ranges: [
        { key: "mRange", label: "m range", value: "0.5,2.0" },
        { key: "cRange", label: "c range", value: "0.05,0.8" },
        { key: "kRange", label: "k range", value: "1.0,8.0" },
        { key: "x0Range", label: "x₀ range", value: "-1.5,1.5" },
        { key: "v0Range", label: "v₀ range", value: "-1.0,1.0" },
      ],
    },
    { id: "pendulum", label: "Damped Pendulum",
      params: [
        { key: "m", label: "Mass (kg)", value: 1.0 },
        { key: "c", label: "Damping (c)", value: 0.15 },
        { key: "k", label: "Length L (m)", value: 2.0 },
        { key: "x0", label: "Initial angle θ₀ (rad)", value: 0.6 },
        { key: "v0", label: "Initial ω₀ (rad/s)", value: 0.0 },
      ],
      ranges: [
        { key: "mRange", label: "m range", value: "0.5,2.0" },
        { key: "cRange", label: "c range", value: "0.01,0.5" },
        { key: "kRange", label: "L range", value: "0.5,2.0" },
        { key: "x0Range", label: "θ₀ range (rad)", value: "-1.2,1.2" },
        { key: "v0Range", label: "ω₀ range", value: "-1.0,1.0" },
      ],
    },
    { id: "bouncing", label: "Bouncing Ball",
      params: [
        { key: "m", label: "Mass (m)", value: 1.0 },
        { key: "c", label: "Air drag (c)", value: 0.15 },
        { key: "k", label: "Gravity (g)", value: 9.81 },
        { key: "e", label: "Restitution (e)", value: 0.80 },
        { key: "x0", label: "Height x(0)", value: 1.0 },
        { key: "v0", label: "Velocity v(0)", value: 2.0 },
      ],
      ranges: [
        { key: "mRange", label: "m range", value: "0.3,3.0" },
        { key: "cRange", label: "c range", value: "0.0,0.25" },
        { key: "eRange", label: "e range", value: "0.55,0.9" },
        { key: "x0Range", label: "x(0) range", value: "0.0,0.0" },
        { key: "v0Range", label: "v(0) range", value: "0.8,6.0" },
      ],
    },
  ];

  function create(deps) {
    var layout = deps.layout;
    var stateApi = deps.stateApi;
    var schemaRegistry = deps.schemaRegistry;
    var datasetModules = deps.datasetModules;
    var oscillatorCore = deps.oscillatorCore;
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };
    var el = deps.el || function (tag, attrs, children) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "className") e.className = attrs[k];
        else if (k === "textContent") e.textContent = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
      if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
      return e;
    };

    // per-scenario state: { inputs: {key: inputEl}, includeCheckbox, chartDiv }

    function _getSchemaId() { return stateApi ? stateApi.getActiveSchema() : ""; }
    function _getPlaygroundMode() {
      var mods = datasetModules ? (datasetModules.getModuleForSchema(_getSchemaId()) || []) : [];
      var mod = Array.isArray(mods) ? mods[0] : mods;
      return (mod && mod.playground && mod.playground.mode) || "generic";
    }

    function _parseRange(str) {
      var parts = String(str || "").split(",").map(function (s) { return Number(s.trim()); });
      if (parts.length >= 2 && isFinite(parts[0]) && isFinite(parts[1])) return parts;
      return [0, 1];
    }

    function _rand(lo, hi) { return lo + Math.random() * (hi - lo); }

    // --- LEFT: schema list ---
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Schemas"));
      var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
      var active = _getSchemaId();
      var list = el("ul", { className: "osc-item-list" });
      schemas.forEach(function (s) {
        var li = el("li", { className: s.id === active ? "active" : "" });
        li.appendChild(el("strong", {}, s.label || s.id));
        li.addEventListener("click", function () {
          if (stateApi) stateApi.setActiveSchema(s.id);
          mount();
        });
        list.appendChild(li);
      });
      leftEl.appendChild(list);
    }

    function _getModuleWithBuild() {
      var schemaId = _getSchemaId();
      if (!datasetModules) return null;
      var modList = datasetModules.getModuleForSchema(schemaId);
      if (!Array.isArray(modList)) modList = modList ? [modList] : [];
      var modId = modList.length ? modList[0].id : null;
      return modId && datasetModules.getModule ? datasetModules.getModule(modId) : null;
    }

    // --- MIDDLE: delegate to module ---
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";

      var mod = _getModuleWithBuild();
      if (mod && mod.playgroundApi && typeof mod.playgroundApi.renderPlayground === "function") {
        var currentMountId = _mountId;
        layout.rightEl.innerHTML = ""; // clear right panel for module to render config
        mod.playgroundApi.renderPlayground(mainEl, {
          el: el,
          escapeHtml: escapeHtml,
          Plotly: (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null,
          configEl: layout.rightEl,
          mountId: currentMountId,
          isCurrent: function () { return currentMountId === _mountId; },
        });
        return;
      }

      // fallback: no renderPlayground — show schema info
      var schemaId = _getSchemaId();
      var schema = schemaRegistry ? schemaRegistry.getSchema(schemaId) : null;
      if (schema) {
        mainEl.appendChild(el("div", { style: "color:#94a3b8;font-size:13px;" },
          (schema.label || schema.id) + " — " + (schema.description || "No preview available")));
      } else {
        mainEl.appendChild(el("div", { className: "osc-empty" }, "Select a schema to explore."));
      }
    }

    // --- RIGHT: rendered by module via configEl, or fallback ---
    function _renderRightPanel() {
      // module.renderPlayground already renders config into layout.rightEl via deps.configEl
      // only render fallback if module didn't touch it
      var rightEl = layout.rightEl;
      if (rightEl.children.length > 0) return; // module already rendered
      // module's renderPlayground already rendered config into rightEl via deps.configEl
      // only add fallback info if empty
      if (!rightEl.children.length) {
        rightEl.appendChild(el("h3", {}, "Info"));
        var schemaId = _getSchemaId();
        var schema = schemaRegistry ? schemaRegistry.getSchema(schemaId) : null;
        if (schema) {
          rightEl.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;" }, schema.description || ""));
        }
      }
    }

    // --- simulation ---

    // --- lifecycle ---
    var _mountId = 0; // incremented on each mount to cancel stale async renders

    function mount() {
      _mountId++;
      var mode = _getPlaygroundMode();
      console.log("[playground] mount schema=" + _getSchemaId() + " mode=" + mode);
      _renderLeftPanel();
      _renderRightPanel();
      _renderMainPanel();
    }
    function unmount() {
      _mountId++;
      layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = "";
    }
    function refresh() { mount(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

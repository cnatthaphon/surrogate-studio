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
    var _scenarios = {};
    var _globalInputs = {};
    var _statusEl = null;

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

    // --- MIDDLE: 3 charts (one per scenario) ---
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";
      var mode = _getPlaygroundMode();

      if (mode === "trajectory_simulation") {
        SCENARIO_DEFS.forEach(function (def) {
          var wrap = el("div", { style: "margin-bottom:12px;" });
          wrap.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:4px;font-weight:600;" }, def.label));
          var chartDiv = el("div", { style: "height:260px;" });
          wrap.appendChild(chartDiv);
          mainEl.appendChild(wrap);
          _scenarios[def.id].chartDiv = chartDiv;
        });
        _statusEl = el("div", { style: "font-size:12px;color:#94a3b8;margin-top:4px;" });
        mainEl.appendChild(_statusEl);
        setTimeout(function () { _simulateAll(); }, 50);

      } else if (mode === "image_dataset") {
        mainEl.appendChild(el("h3", { style: "color:#67e8f9;" }, "Image Dataset Preview"));
        var previewMount = el("div", {});
        mainEl.appendChild(previewMount);
        var mods = datasetModules ? (datasetModules.getModuleForSchema(_getSchemaId()) || []) : [];
        var mod = Array.isArray(mods) ? mods[0] : mods;
        if (mod && typeof mod.build === "function") {
          previewMount.innerHTML = "<div style='color:#67e8f9;'>Generating preview...</div>";
          try {
            var r = mod.build({ seed: 42, totalCount: 50, variant: _getSchemaId() });
            var h = function (res) {
              if (!res) { previewMount.innerHTML = "<div class='osc-empty'>No data</div>"; return; }
              previewMount.innerHTML = "";
              previewMount.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;" },
                "Train: " + ((res.xTrain||[]).length) + " | Val: " + ((res.xVal||[]).length) + " | Test: " + ((res.xTest||[]).length)));
            };
            if (r && typeof r.then === "function") r.then(h); else h(r);
          } catch (e) { previewMount.innerHTML = "<div style='color:#f43f5e;'>" + escapeHtml(e.message) + "</div>"; }
        }
      } else {
        mainEl.appendChild(el("div", { className: "osc-empty" }, "Select a schema to explore."));
      }
    }

    // --- RIGHT: global config + per-scenario cards ---
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      var mode = _getPlaygroundMode();

      if (mode === "trajectory_simulation") {
        rightEl.appendChild(el("h3", {}, "Simulation Config"));

        // global controls
        var globalDefs = [
          { key: "durationSec", label: "Duration (s)", value: 8, step: 0.5 },
          { key: "dt", label: "dt", value: 0.02, step: 0.001 },
          { key: "g", label: "Gravity (g)", value: 9.81, step: 0.1 },
        ];
        globalDefs.forEach(function (gd) {
          var row = el("div", { className: "osc-form-row" });
          row.appendChild(el("label", {}, gd.label));
          var inp = el("input", { type: "number", value: String(gd.value) });
          if (gd.step) inp.setAttribute("step", gd.step);
          _globalInputs[gd.key] = inp;
          row.appendChild(inp);
          rightEl.appendChild(row);
        });

        // action buttons
        var btnRow = el("div", { style: "display:flex;gap:4px;margin:8px 0;" });
        var simAll = el("button", { className: "osc-btn", style: "flex:1;font-size:12px;" }, "Simulate All");
        simAll.addEventListener("click", function () { _simulateAll(); });
        btnRow.appendChild(simAll);
        var randAll = el("button", { className: "osc-btn secondary", style: "flex:1;font-size:12px;" }, "Random All");
        randAll.addEventListener("click", function () { _randomizeAll(); _simulateAll(); });
        btnRow.appendChild(randAll);
        rightEl.appendChild(btnRow);

        // per-scenario cards
        _scenarios = {};
        SCENARIO_DEFS.forEach(function (def) {
          var sc = { inputs: {}, rangeInputs: {}, includeCheckbox: null, chartDiv: null };
          var card = el("div", { className: "osc-card", style: "margin-bottom:8px;padding:10px;" });

          // header
          var head = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;" });
          head.appendChild(el("strong", { style: "font-size:12px;color:#67e8f9;" }, def.label));
          var resetBtn = el("button", { className: "osc-btn sm secondary" }, "Reset");
          resetBtn.addEventListener("click", function () { _resetScenario(def.id); _simulateOne(def.id); });
          head.appendChild(resetBtn);
          card.appendChild(head);

          // param inputs only (no ranges, no include checkbox — those belong in Dataset tab)
          def.params.forEach(function (p) {
            var row = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;" });
            row.appendChild(el("span", { style: "font-size:11px;color:#94a3b8;min-width:100px;" }, p.label));
            var inp = el("input", { type: "number", value: String(p.value), style: "width:70px;padding:2px 4px;font-size:11px;border-radius:4px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
            inp.setAttribute("step", "0.1");
            sc.inputs[p.key] = inp;
            row.appendChild(inp);
            card.appendChild(row);
          });

          rightEl.appendChild(card);
          _scenarios[def.id] = sc;
        });

      } else if (mode === "image_dataset") {
        rightEl.appendChild(el("h3", {}, "Preview Config"));
        rightEl.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;" }, "Go to Dataset tab to generate full dataset."));
      } else {
        rightEl.appendChild(el("h3", {}, "Info"));
        rightEl.appendChild(el("div", { className: "osc-empty" }, "Select a schema."));
      }
    }

    // --- simulation ---

    function _getScenarioCondition(scenarioId) {
      var sc = _scenarios[scenarioId];
      if (!sc) return null;
      var p = {};
      Object.keys(sc.inputs).forEach(function (k) { p[k] = Number(sc.inputs[k].value); });
      return {
        scenario: scenarioId,
        m: p.m || 1, c: p.c || 0.25, k: p.k || 4, g: Number((_globalInputs.g || {}).value) || 9.81,
        x0: p.x0 || 0, v0: p.v0 || 0, restitution: p.e || 0.8,
        dt: Number((_globalInputs.dt || {}).value) || 0.02,
        steps: Math.max(10, Math.floor((Number((_globalInputs.durationSec || {}).value) || 8) / (Number((_globalInputs.dt || {}).value) || 0.02))),
        groundModel: "rigid", groundK: 2500, groundC: 90,
      };
    }

    function _simulateOne(scenarioId) {
      if (!oscillatorCore) return;
      var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
      if (!Plotly) return;
      var sc = _scenarios[scenarioId];
      if (!sc || !sc.chartDiv) return;

      var cond = _getScenarioCondition(scenarioId);
      var sim = oscillatorCore.simulateOscillator(cond);
      var def = SCENARIO_DEFS.find(function (d) { return d.id === scenarioId; });
      var title = (def ? def.label : scenarioId) + " | m=" + cond.m + " c=" + cond.c + " k=" + cond.k;

      Plotly.newPlot(sc.chartDiv, [
        { x: sim.t, y: sim.x, mode: "lines", name: "x(t)", line: { color: "#22d3ee" } },
        { x: sim.t, y: sim.v, mode: "lines", name: "v(t)", line: { color: "#f59e0b", dash: "dot" } },
      ], {
        paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
        title: { text: title, font: { size: 12 } },
        xaxis: { title: "t (s)", gridcolor: "#1e293b" },
        yaxis: { gridcolor: "#1e293b" },
        legend: { orientation: "h", y: -0.2, font: { size: 10 } },
        margin: { t: 30, b: 45, l: 40, r: 10 },
      }, { responsive: true });
    }

    function _simulateAll() {
      SCENARIO_DEFS.forEach(function (def) { _simulateOne(def.id); });
      if (_statusEl) _statusEl.textContent = "Simulated all scenarios | dt=" + (Number((_globalInputs.dt || {}).value) || 0.02);
    }

    function _resetScenario(scenarioId) {
      var def = SCENARIO_DEFS.find(function (d) { return d.id === scenarioId; });
      var sc = _scenarios[scenarioId];
      if (!def || !sc) return;
      def.params.forEach(function (p) { if (sc.inputs[p.key]) sc.inputs[p.key].value = String(p.value); });
      def.ranges.forEach(function (r) { if (sc.rangeInputs[r.key]) sc.rangeInputs[r.key].value = r.value; });
    }

    function _randomizeAll() {
      SCENARIO_DEFS.forEach(function (def) {
        var sc = _scenarios[def.id];
        if (!sc) return;
        def.ranges.forEach(function (r) {
          var range = _parseRange(sc.rangeInputs[r.key] ? sc.rangeInputs[r.key].value : r.value);
          var paramKey = r.key.replace("Range", "");
          if (sc.inputs[paramKey]) sc.inputs[paramKey].value = _rand(range[0], range[1]).toFixed(3);
        });
      });
    }

    // --- lifecycle ---
    function mount() {
      _scenarios = {}; _globalInputs = {}; _statusEl = null;
      _renderLeftPanel();
      _renderRightPanel(); // right first so _scenarios is populated before main needs chartDivs
      _renderMainPanel();
    }
    function unmount() {
      _scenarios = {}; _globalInputs = {}; _statusEl = null;
      layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = "";
    }
    function refresh() { mount(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

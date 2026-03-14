(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCPlaygroundTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCENARIOS = ["spring", "pendulum", "bouncing"];
  var SCENARIO_DEFAULTS = {
    spring:    { m: 1.2, c: 0.25, k: 4.0, x0: 1.0, v0: 0, e: 0.8 },
    pendulum:  { m: 1.0, c: 0.1,  k: 9.81, x0: 0.5, v0: 0, e: 0.8 },
    bouncing:  { m: 0.5, c: 0.0,  k: 9.81, x0: 2.0, v0: 0, e: 0.8 },
  };

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
        else if (k === "innerHTML") e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
      if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
      return e;
    };

    var _inputs = {};
    var _chartDiv = null;
    var _scenarioSelect = null;
    var _statusEl = null;

    function _getSchemaId() { return stateApi ? stateApi.getActiveSchema() : ""; }

    function _getPlaygroundMode() {
      var schemaId = _getSchemaId();
      if (!datasetModules) return "generic";
      var mods = [];
      if (typeof datasetModules.getModuleForSchema === "function") {
        mods = datasetModules.getModuleForSchema(schemaId);
        if (!Array.isArray(mods)) mods = [];
      }
      if (!mods.length && typeof datasetModules.listModules === "function") {
        mods = datasetModules.listModules().filter(function (m) { return m.schemaId === schemaId; });
      }
      var mod = mods[0];
      return (mod && mod.playground && mod.playground.mode) || "generic";
    }

    // --- left panel: schema/module list ---
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Schemas"));

      var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
      var activeSchema = _getSchemaId();
      var list = el("ul", { className: "osc-item-list" });
      schemas.forEach(function (s) {
        var li = el("li", { className: s.id === activeSchema ? "active" : "" });
        li.appendChild(el("strong", {}, s.label || s.id));
        if (s.description) li.appendChild(el("div", { style: "font-size:11px;color:#64748b;" }, s.description));
        li.addEventListener("click", function () {
          if (stateApi) stateApi.setActiveSchema(s.id);
          mount(); // re-render entire tab for new schema
        });
        list.appendChild(li);
      });
      leftEl.appendChild(list);
    }

    // --- main panel: interactive simulation ---
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";

      var mode = _getPlaygroundMode();
      if (mode === "trajectory_simulation") {
        _renderTrajectoryPlayground(mainEl);
      } else if (mode === "image_dataset") {
        _renderImagePlayground(mainEl);
      } else {
        mainEl.appendChild(el("div", { className: "osc-empty" }, "Select a schema with a playground module."));
      }
    }

    function _renderTrajectoryPlayground(mainEl) {
      if (!oscillatorCore) {
        mainEl.appendChild(el("div", { className: "osc-empty" }, "Oscillator core not loaded."));
        return;
      }

      // title
      mainEl.appendChild(el("h3", { style: "color:#67e8f9;margin:0 0 12px;" }, "RK4 Oscillator Playground"));

      // scenario selector
      var topBar = el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:8px;" });
      topBar.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;" }, "Scenario:"));
      _scenarioSelect = el("select", { style: "padding:4px 8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
      SCENARIOS.forEach(function (s) {
        var opt = el("option", { value: s });
        opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
        _scenarioSelect.appendChild(opt);
      });
      _scenarioSelect.addEventListener("change", function () { _applyScenarioDefaults(); });
      topBar.appendChild(_scenarioSelect);

      // action buttons
      var simBtn = el("button", { className: "osc-btn" }, "Simulate");
      simBtn.addEventListener("click", function () { _runSimulation(); });
      topBar.appendChild(simBtn);

      var randomBtn = el("button", { className: "osc-btn secondary" }, "Random Params");
      randomBtn.addEventListener("click", function () { _randomizeParams(); _runSimulation(); });
      topBar.appendChild(randomBtn);

      mainEl.appendChild(topBar);

      // parameter controls grid
      var paramGrid = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;margin-bottom:12px;" });
      var paramDefs = [
        { key: "m", label: "Mass (m)", min: 0.1, max: 10, step: 0.1 },
        { key: "c", label: "Damping (c)", min: 0, max: 5, step: 0.05 },
        { key: "k", label: "Stiffness (k)", min: 0.1, max: 30, step: 0.1 },
        { key: "x0", label: "x(0)", min: -5, max: 5, step: 0.1 },
        { key: "v0", label: "v(0)", min: -5, max: 5, step: 0.1 },
        { key: "e", label: "Restitution (e)", min: 0, max: 1, step: 0.05 },
        { key: "durationSec", label: "Duration (s)", min: 0.5, max: 30, step: 0.5 },
        { key: "dt", label: "dt", min: 0.001, max: 0.1, step: 0.001 },
        { key: "g", label: "Gravity (g)", min: 0.1, max: 20, step: 0.1 },
      ];
      var defaults = Object.assign({ durationSec: 8, dt: 0.02, g: 9.81 }, SCENARIO_DEFAULTS.spring);
      paramDefs.forEach(function (p) {
        var row = el("div", { style: "display:flex;flex-direction:column;gap:2px;" });
        row.appendChild(el("label", { style: "font-size:11px;color:#94a3b8;" }, p.label));
        var inp = el("input", {
          type: "number", value: String(defaults[p.key] != null ? defaults[p.key] : ""),
          style: "padding:4px 6px;border-radius:4px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;font-size:12px;",
        });
        if (p.min != null) inp.setAttribute("min", p.min);
        if (p.max != null) inp.setAttribute("max", p.max);
        if (p.step != null) inp.setAttribute("step", p.step);
        _inputs[p.key] = inp;
        row.appendChild(inp);
        paramGrid.appendChild(row);
      });
      mainEl.appendChild(paramGrid);

      // chart
      _chartDiv = el("div", { style: "height:350px;margin-bottom:8px;" });
      mainEl.appendChild(_chartDiv);

      // status
      _statusEl = el("div", { style: "font-size:12px;color:#94a3b8;" });
      mainEl.appendChild(_statusEl);

      // auto-run
      setTimeout(function () { _runSimulation(); }, 50);
    }

    function _renderImagePlayground(mainEl) {
      mainEl.appendChild(el("h3", { style: "color:#67e8f9;margin:0 0 12px;" }, "Image Dataset Preview"));
      mainEl.appendChild(el("p", { style: "color:#94a3b8;font-size:13px;" },
        "Generate a small preview of the image dataset to explore class distribution."));

      var previewBtn = el("button", { className: "osc-btn" }, "Preview Samples");
      var previewMount = el("div", { style: "margin-top:12px;" });
      mainEl.appendChild(previewBtn);
      mainEl.appendChild(previewMount);

      previewBtn.addEventListener("click", function () {
        var schemaId = _getSchemaId();
        var mods = datasetModules ? (datasetModules.getModuleForSchema(schemaId) || []) : [];
        var mod = Array.isArray(mods) ? mods[0] : mods;
        if (!mod || typeof mod.build !== "function") {
          previewMount.innerHTML = "<div class='osc-empty'>No build function</div>";
          return;
        }
        previewMount.innerHTML = "<div style='color:#67e8f9;'>Generating...</div>";
        try {
          var result = mod.build({ seed: 42, totalCount: 100, variant: schemaId });
          var handle = function (res) {
            if (!res) { previewMount.innerHTML = "<div class='osc-empty'>No data</div>"; return; }
            previewMount.innerHTML = "";
            var info = el("div", { style: "font-size:12px;color:#cbd5e1;margin-bottom:8px;" });
            info.textContent = "Train: " + ((res.xTrain || []).length) + " Val: " + ((res.xVal || []).length) + " Test: " + ((res.xTest || []).length);
            previewMount.appendChild(info);
          };
          if (result && typeof result.then === "function") result.then(handle);
          else handle(result);
        } catch (err) {
          previewMount.innerHTML = "<div style='color:#f43f5e;'>" + escapeHtml(err.message) + "</div>";
        }
      });
    }

    // --- right panel: info ---
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      rightEl.appendChild(el("h3", {}, "Playground Info"));

      var schemaId = _getSchemaId();
      var schema = schemaRegistry ? schemaRegistry.getSchema(schemaId) : null;
      if (!schema) {
        rightEl.appendChild(el("div", { className: "osc-empty" }, "No schema selected"));
        return;
      }

      var card = el("div", { className: "osc-card" });
      card.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:4px;" }, schema.label || schema.id));
      if (schema.description) card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:8px;" }, schema.description));

      var dsSchema = schema.dataset || {};
      card.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;" },
        "Type: " + (dsSchema.sampleType || "unknown")));

      // hint
      card.appendChild(el("p", { style: "font-size:12px;color:#64748b;margin-top:12px;" },
        "Explore the simulation. When ready, go to Dataset tab to generate training data."));

      rightEl.appendChild(card);
    }

    // --- simulation actions ---

    function _getParams() {
      var params = {};
      Object.keys(_inputs).forEach(function (k) {
        params[k] = Number(_inputs[k].value);
      });
      return params;
    }

    function _applyScenarioDefaults() {
      var scenario = _scenarioSelect ? _scenarioSelect.value : "spring";
      var defaults = SCENARIO_DEFAULTS[scenario] || SCENARIO_DEFAULTS.spring;
      Object.keys(defaults).forEach(function (k) {
        if (_inputs[k]) _inputs[k].value = String(defaults[k]);
      });
    }

    function _randomizeParams() {
      var scenario = _scenarioSelect ? _scenarioSelect.value : "spring";
      var def = SCENARIO_DEFAULTS[scenario] || SCENARIO_DEFAULTS.spring;
      function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
      if (_inputs.m) _inputs.m.value = rand(0.3, 3).toFixed(2);
      if (_inputs.c) _inputs.c.value = rand(0, 1).toFixed(2);
      if (_inputs.k) _inputs.k.value = (scenario === "bouncing" ? 9.81 : rand(0.5, 10)).toFixed(2);
      if (_inputs.x0) _inputs.x0.value = rand(0.2, 2.5).toFixed(2);
      if (_inputs.v0) _inputs.v0.value = rand(-1, 1).toFixed(2);
      if (_inputs.e) _inputs.e.value = rand(0.3, 0.95).toFixed(2);
    }

    function _runSimulation() {
      if (!oscillatorCore || !_chartDiv) return;
      var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
      if (!Plotly) {
        if (_statusEl) _statusEl.textContent = "Plotly not loaded";
        return;
      }

      var p = _getParams();
      var scenario = _scenarioSelect ? _scenarioSelect.value : "spring";
      var steps = Math.max(10, Math.floor((p.durationSec || 8) / (p.dt || 0.02)));

      var sim = oscillatorCore.simulateOscillator({
        scenario: scenario,
        m: p.m || 1, c: p.c || 0.25, k: p.k || 4, g: p.g || 9.81,
        x0: p.x0 || 1, v0: p.v0 || 0,
        restitution: p.e || 0.8,
        dt: p.dt || 0.02, steps: steps,
        groundModel: "rigid", groundK: 2500, groundC: 90,
      });

      var titleText = scenario.charAt(0).toUpperCase() + scenario.slice(1) +
        " (m=" + (p.m || 1) + " c=" + (p.c || 0.25) + " k=" + (p.k || 4) + ")";

      Plotly.newPlot(_chartDiv, [
        { x: sim.t, y: sim.x, mode: "lines", name: "x(t)", line: { color: "#22d3ee" } },
        { x: sim.t, y: sim.v, mode: "lines", name: "v(t)", line: { color: "#f59e0b", dash: "dot" } },
      ], {
        paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220",
        font: { color: "#e2e8f0" },
        title: titleText,
        xaxis: { title: "time (s)", gridcolor: "#1e293b" },
        yaxis: { title: scenario === "bouncing" ? "height (m)" : "displacement", gridcolor: "#1e293b" },
        legend: { orientation: "h", y: -0.15 },
        margin: { t: 40, b: 60, l: 50, r: 20 },
      }, { responsive: true });

      if (_statusEl) {
        _statusEl.textContent = "Simulated " + sim.t.length + " steps | " +
          scenario + " | dt=" + (p.dt || 0.02) + " | duration=" + (p.durationSec || 8) + "s";
      }
    }

    // --- lifecycle ---

    function mount() {
      _inputs = {};
      _chartDiv = null;
      _scenarioSelect = null;
      _statusEl = null;
      _renderLeftPanel();
      _renderMainPanel();
      _renderRightPanel();
    }

    function unmount() {
      _inputs = {};
      _chartDiv = null;
      _scenarioSelect = null;
      _statusEl = null;
      layout.leftEl.innerHTML = "";
      layout.mainEl.innerHTML = "";
      layout.rightEl.innerHTML = "";
    }

    function refresh() { mount(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

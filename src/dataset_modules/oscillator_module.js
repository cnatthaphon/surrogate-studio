(function (root, factory) {
  var descriptor = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = descriptor;
    return;
  }
  root.OSCDatasetModuleOscillator = descriptor;
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModule === "function") {
    root.OSCDatasetModules.registerModule(descriptor);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function resolveCore() {
    try {
      return require("../oscillator_dataset_core.js");
    } catch (_err) {}
    if (typeof globalThis !== "undefined" && globalThis.OSCOscillatorDatasetCore) {
      return globalThis.OSCOscillatorDatasetCore;
    }
    throw new Error("OSCOscillatorDatasetCore is required by oscillator_module.js");
  }

  var OSC_CORE = resolveCore();
  var PRESET_LIMITS = OSC_CORE.PRESET_LIMITS || {};

  function parseRange(rawValue, fallbackRange, clampRange) {
    var raw = String(rawValue == null ? "" : rawValue).trim();
    var out = Array.isArray(fallbackRange) ? fallbackRange.slice(0, 2) : [0, 0];
    if (raw) {
      var parts = raw.split(",").map(function (s) { return Number(String(s || "").trim()); });
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        out = [Math.min(parts[0], parts[1]), Math.max(parts[0], parts[1])];
      }
    }
    if (Array.isArray(clampRange) && clampRange.length >= 2) {
      out[0] = Math.max(Number(clampRange[0]), out[0]);
      out[1] = Math.min(Number(clampRange[1]), out[1]);
      if (out[1] < out[0]) out = [Number(clampRange[0]), Number(clampRange[1])];
    }
    return out;
  }

  function clonePlainObject(value) {
    if (!value || typeof value !== "object") return {};
    return JSON.parse(JSON.stringify(value));
  }

  function getScopedConfig(ctx, scope, moduleId, defaults) {
    if (ctx && typeof ctx.getModuleConfigState === "function") {
      return ctx.getModuleConfigState(scope, defaults, moduleId);
    }
    return clonePlainObject(defaults);
  }

  function setScopedConfig(ctx, scope, moduleId, nextValue) {
    if (ctx && typeof ctx.setModuleConfigState === "function") {
      return ctx.setModuleConfigState(scope, nextValue, moduleId);
    }
    return clonePlainObject(nextValue);
  }

  function patchScopedConfig(ctx, scope, moduleId, patch) {
    if (ctx && typeof ctx.patchModuleConfigState === "function") {
      return ctx.patchModuleConfigState(scope, patch, moduleId);
    }
    return clonePlainObject(patch);
  }

  function clampNumber(value, fallback, min, max) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = Number(fallback);
    if (!Number.isFinite(n)) n = 0;
    if (Number.isFinite(Number(min))) n = Math.max(Number(min), n);
    if (Number.isFinite(Number(max))) n = Math.min(Number(max), n);
    return n;
  }

  function normalizeSplitFractions(trainFrac, valFrac, testFrac) {
    var tr = clampNumber(trainFrac, 0.7, 0.01, 0.99);
    var va = clampNumber(valFrac, 0.15, 0.01, 0.99);
    var te = clampNumber(testFrac, 0.15, 0.01, 0.99);
    var sum = tr + va + te;
    if (!(sum > 0)) return { train: 0.7, val: 0.15, test: 0.15 };
    return { train: tr / sum, val: va / sum, test: te / sum };
  }

  var DEFAULT_PLAYGROUND_CONFIG = {
    previewDurationSec: 16.0,
    previewDt: 0.02,
    globalG: 9.81,
    quickCompareMode: "vary_m",
    sweepParam: "m",
    sweepValues: "0.5,1.0,2.0",
    pgSpring: true,
    pgPendulum: false,
    pgBouncing: false,
    spM: 1.2,
    spC: 0.25,
    spK: 4.0,
    spX0: 1.0,
    spV0: 0.0,
    pdM: 1.0,
    pdC: 0.15,
    pdK: 2.0,
    pdX0: 0.6,
    pdV0: 0.0,
    bbM: 1.0,
    bbC: 0.15,
    bbE: 0.8,
    bbGroundModel: "rigid",
    bbGroundK: 2500,
    bbGroundC: 90,
    bbX0: 1.0,
    bbV0: 2.0,
  };

  var DEFAULT_DATASET_CONFIG = {
    seed: 42,
    splitMode: "stratified_scenario",
    trainFrac: 0.70,
    valFrac: 0.15,
    testFrac: 0.15,
    numTraj: 150,
    durationSec: 16.0,
    dt: 0.02,
    globalG: 9.81,
    cardDsSpring: true,
    cardDsPendulum: true,
    cardDsBouncing: true,
    spMRng: "0.5,2.0",
    spCRng: "0.05,0.8",
    spKRng: "1.0,8.0",
    spX0Rng: "-1.5,1.5",
    spV0Rng: "-1.0,1.0",
    pdMRng: "0.5,2.0",
    pdCRng: "0.01,0.5",
    pdKRng: "0.5,2.0",
    pdX0Rng: "-1.2,1.2",
    pdV0Rng: "-1.0,1.0",
    bbGroundModel: "rigid",
    bbGroundK: 2500,
    bbGroundC: 90,
    bbMRng: "0.3,3.0",
    bbCRng: "0.0,0.25",
    bbERng: "0.55,0.9",
    bbX0Rng: "0.0,0.0",
    bbV0Rng: "0.8,6.0",
  };

  function normalizePlaygroundConfig(raw) {
    var base = Object.assign({}, DEFAULT_PLAYGROUND_CONFIG, raw || {});
    var selected = {
      spring: Boolean(base.pgSpring),
      pendulum: Boolean(base.pgPendulum),
      bouncing: Boolean(base.pgBouncing),
    };
    if (!selected.spring && !selected.pendulum && !selected.bouncing) selected.spring = true;
    return {
      previewDurationSec: clampNumber(base.previewDurationSec, DEFAULT_PLAYGROUND_CONFIG.previewDurationSec, 0.5),
      previewDt: clampNumber(base.previewDt, DEFAULT_PLAYGROUND_CONFIG.previewDt, 0.001),
      globalG: clampNumber(base.globalG, DEFAULT_PLAYGROUND_CONFIG.globalG, 0.1),
      quickCompareMode: String(base.quickCompareMode || DEFAULT_PLAYGROUND_CONFIG.quickCompareMode),
      sweepParam: String(base.sweepParam || DEFAULT_PLAYGROUND_CONFIG.sweepParam),
      sweepValues: String(base.sweepValues || DEFAULT_PLAYGROUND_CONFIG.sweepValues),
      pgSpring: selected.spring,
      pgPendulum: selected.pendulum,
      pgBouncing: selected.bouncing,
      spM: clampNumber(base.spM, DEFAULT_PLAYGROUND_CONFIG.spM),
      spC: clampNumber(base.spC, DEFAULT_PLAYGROUND_CONFIG.spC),
      spK: clampNumber(base.spK, DEFAULT_PLAYGROUND_CONFIG.spK),
      spX0: clampNumber(base.spX0, DEFAULT_PLAYGROUND_CONFIG.spX0),
      spV0: clampNumber(base.spV0, DEFAULT_PLAYGROUND_CONFIG.spV0),
      pdM: clampNumber(base.pdM, DEFAULT_PLAYGROUND_CONFIG.pdM),
      pdC: clampNumber(base.pdC, DEFAULT_PLAYGROUND_CONFIG.pdC),
      pdK: clampNumber(base.pdK, DEFAULT_PLAYGROUND_CONFIG.pdK),
      pdX0: clampNumber(base.pdX0, DEFAULT_PLAYGROUND_CONFIG.pdX0),
      pdV0: clampNumber(base.pdV0, DEFAULT_PLAYGROUND_CONFIG.pdV0),
      bbM: clampNumber(base.bbM, DEFAULT_PLAYGROUND_CONFIG.bbM),
      bbC: clampNumber(base.bbC, DEFAULT_PLAYGROUND_CONFIG.bbC),
      bbE: clampNumber(base.bbE, DEFAULT_PLAYGROUND_CONFIG.bbE),
      bbGroundModel: String(base.bbGroundModel || DEFAULT_PLAYGROUND_CONFIG.bbGroundModel),
      bbGroundK: clampNumber(base.bbGroundK, DEFAULT_PLAYGROUND_CONFIG.bbGroundK, 50),
      bbGroundC: clampNumber(base.bbGroundC, DEFAULT_PLAYGROUND_CONFIG.bbGroundC, 0),
      bbX0: clampNumber(base.bbX0, DEFAULT_PLAYGROUND_CONFIG.bbX0),
      bbV0: clampNumber(base.bbV0, DEFAULT_PLAYGROUND_CONFIG.bbV0),
    };
  }

  function normalizeDatasetConfig(raw) {
    var base = Object.assign({}, DEFAULT_DATASET_CONFIG, raw || {});
    var fractions = normalizeSplitFractions(base.trainFrac, base.valFrac, base.testFrac);
    var selected = {
      spring: Boolean(base.cardDsSpring),
      pendulum: Boolean(base.cardDsPendulum),
      bouncing: Boolean(base.cardDsBouncing),
    };
    if (!selected.spring && !selected.pendulum && !selected.bouncing) selected.spring = true;
    return {
      seed: Math.max(0, Math.floor(clampNumber(base.seed, DEFAULT_DATASET_CONFIG.seed))),
      splitMode: String(base.splitMode || DEFAULT_DATASET_CONFIG.splitMode),
      trainFrac: fractions.train,
      valFrac: fractions.val,
      testFrac: fractions.test,
      numTraj: Math.max(10, Math.floor(clampNumber(base.numTraj, DEFAULT_DATASET_CONFIG.numTraj))),
      durationSec: clampNumber(base.durationSec, DEFAULT_DATASET_CONFIG.durationSec, 0.5),
      dt: clampNumber(base.dt, DEFAULT_DATASET_CONFIG.dt, 0.001),
      globalG: clampNumber(base.globalG, DEFAULT_DATASET_CONFIG.globalG, 0.1),
      cardDsSpring: selected.spring,
      cardDsPendulum: selected.pendulum,
      cardDsBouncing: selected.bouncing,
      spMRng: String(base.spMRng || DEFAULT_DATASET_CONFIG.spMRng),
      spCRng: String(base.spCRng || DEFAULT_DATASET_CONFIG.spCRng),
      spKRng: String(base.spKRng || DEFAULT_DATASET_CONFIG.spKRng),
      spX0Rng: String(base.spX0Rng || DEFAULT_DATASET_CONFIG.spX0Rng),
      spV0Rng: String(base.spV0Rng || DEFAULT_DATASET_CONFIG.spV0Rng),
      pdMRng: String(base.pdMRng || DEFAULT_DATASET_CONFIG.pdMRng),
      pdCRng: String(base.pdCRng || DEFAULT_DATASET_CONFIG.pdCRng),
      pdKRng: String(base.pdKRng || DEFAULT_DATASET_CONFIG.pdKRng),
      pdX0Rng: String(base.pdX0Rng || DEFAULT_DATASET_CONFIG.pdX0Rng),
      pdV0Rng: String(base.pdV0Rng || DEFAULT_DATASET_CONFIG.pdV0Rng),
      bbGroundModel: String(base.bbGroundModel || DEFAULT_DATASET_CONFIG.bbGroundModel),
      bbGroundK: clampNumber(base.bbGroundK, DEFAULT_DATASET_CONFIG.bbGroundK, 50),
      bbGroundC: clampNumber(base.bbGroundC, DEFAULT_DATASET_CONFIG.bbGroundC, 0),
      bbMRng: String(base.bbMRng || DEFAULT_DATASET_CONFIG.bbMRng),
      bbCRng: String(base.bbCRng || DEFAULT_DATASET_CONFIG.bbCRng),
      bbERng: String(base.bbERng || DEFAULT_DATASET_CONFIG.bbERng),
      bbX0Rng: String(base.bbX0Rng || DEFAULT_DATASET_CONFIG.bbX0Rng),
      bbV0Rng: String(base.bbV0Rng || DEFAULT_DATASET_CONFIG.bbV0Rng),
    };
  }

  function getPlaygroundState(ctx) {
    return normalizePlaygroundConfig(getScopedConfig(ctx, "playground", "oscillator", DEFAULT_PLAYGROUND_CONFIG));
  }

  function setPlaygroundState(ctx, nextValue) {
    return setScopedConfig(ctx, "playground", "oscillator", normalizePlaygroundConfig(nextValue));
  }

  function patchPlaygroundState(ctx, patch) {
    var next = patchScopedConfig(ctx, "playground", "oscillator", patch || {});
    return setPlaygroundState(ctx, next);
  }

  function getDatasetState(ctx) {
    return normalizeDatasetConfig(getScopedConfig(ctx, "dataset", "oscillator", DEFAULT_DATASET_CONFIG));
  }

  function setDatasetState(ctx, nextValue) {
    return setScopedConfig(ctx, "dataset", "oscillator", normalizeDatasetConfig(nextValue));
  }

  function patchDatasetState(ctx, patch) {
    var next = patchScopedConfig(ctx, "dataset", "oscillator", patch || {});
    return setDatasetState(ctx, next);
  }

  function getQuickComparePlan(mode, scenarios, preset, presetLimits) {
    var key = "m";
    if (mode === "vary_c") key = "c";
    else if (mode === "vary_k") key = "k";
    else if (mode === "vary_e") key = "restitution";
    var limitsByScenario = presetLimits && typeof presetLimits === "object" ? presetLimits : {};
    var valuesByScenario = {};
    (Array.isArray(scenarios) ? scenarios : []).forEach(function (s) {
      var perScenario = limitsByScenario[s] && limitsByScenario[s][preset] ? limitsByScenario[s][preset] : null;
      if (!perScenario) {
        valuesByScenario[s] = [];
        return;
      }
      valuesByScenario[s] =
        key === "m" ? [perScenario.m[0], 0.5 * (perScenario.m[0] + perScenario.m[1]), perScenario.m[1]] :
        key === "c" ? [perScenario.c[0], 0.5 * (perScenario.c[0] + perScenario.c[1]), perScenario.c[1]] :
        key === "k" ? [perScenario.k[0], 0.5 * (perScenario.k[0] + perScenario.k[1]), perScenario.k[1]] :
        [perScenario.e[0], 0.5 * (perScenario.e[0] + perScenario.e[1]), perScenario.e[1]];
    });
    return { key: key, valuesByScenario: valuesByScenario };
  }

  function buildQuickCompareInfoText(ctx) {
    var scenarios = Array.isArray(ctx && ctx.selectedScenarios) && ctx.selectedScenarios.length
      ? ctx.selectedScenarios
      : ["spring"];
    var mode = String((ctx && ctx.quickCompareMode) || "vary_m");
    var preset = String((ctx && ctx.paramPreset) || "safe");
    var plan = getQuickComparePlan(mode, scenarios, preset, ctx && ctx.presetLimits);
    var keyLabel =
      plan.key === "m" ? "mass m" :
      plan.key === "c" ? "damping/air c" :
      plan.key === "k" ? "k / L / g" :
      "restitution e";
    var detail = scenarios.map(function (s) {
      var vals = (plan.valuesByScenario[s] || []).map(function (v) { return Number(v).toFixed(3); }).join(", ");
      return s + ": [" + vals + "]";
    }).join(" | ");
    return "Quick Compare plan: vary " + keyLabel + ". Values -> " + detail + ". Unswept parameters remain fixed at current scenario card values.";
  }

  function parseSweepValues(raw) {
    return String(raw || "")
      .split(",")
      .map(function (s) { return Number(String(s || "").trim()); })
      .filter(function (v) { return Number.isFinite(v); });
  }

  function runPreviewAction(ctx) {
    var selected = Array.isArray(ctx && ctx.selectedScenarios) ? ctx.selectedScenarios : [];
    var scenarios = selected.length ? selected : [String((ctx && ctx.primaryScenario) || "spring")];
    if (scenarios.length > 1) {
      var colors = { spring: "#22d3ee", pendulum: "#a78bfa", bouncing: "#f59e0b" };
      var byScenario = {};
      scenarios.forEach(function (scen) {
        var sim = ctx.simulateOscillator(ctx.getEvalCondition(scen));
        byScenario[scen] = [{
          x: sim.t,
          y: sim.x,
          mode: "lines",
          name: scen + " RK4",
          line: { color: colors[scen] || "#22d3ee" },
        }];
      });
      ctx.plotPreviewSplitByScenario(byScenario, "Trajectory");
      ctx.setStatus("Preview generated (RK4 only), split by scenario.");
      return;
    }
    var cond = ctx.getEvalCondition(scenarios[0]);
    var simSingle = ctx.simulateOscillator(cond);
    ctx.plotTrajectories(
      [{ x: simSingle.t, y: simSingle.x, mode: "lines", name: "RK4 trajectory", line: { color: "#22d3ee" } }],
      "Trajectory (" + cond.scenario + ")"
    );
    ctx.setStatus("Preview generated (RK4 only).");
  }

  function runQuickCompareAction(ctx) {
    var mode = String((ctx && ctx.quickCompareMode) || "vary_m");
    var selectedScenarios = Array.isArray(ctx && ctx.selectedScenarios) ? ctx.selectedScenarios : [];
    var scenarios = selectedScenarios.length ? selectedScenarios : [String((ctx && ctx.primaryScenario) || "spring")];
    var colors = ["#22d3ee", "#a78bfa", "#f59e0b"];
    var plan = getQuickComparePlan(mode, scenarios, String((ctx && ctx.paramPreset) || "safe"), ctx && ctx.presetLimits);
    var key = plan.key;
    if (scenarios.length > 1) {
      var byScenario = {};
      scenarios.forEach(function (scen) {
        var values = plan.valuesByScenario[scen] || [];
        byScenario[scen] = [];
        for (var i = 0; i < values.length; i += 1) {
          var cfg = ctx.getEvalCondition(scen);
          cfg[key] = values[i];
          var sim = ctx.simulateOscillator(cfg);
          byScenario[scen].push({
            x: sim.t,
            y: sim.x,
            mode: "lines",
            name: key + "=" + values[i].toFixed(3),
            line: { color: colors[i] },
          });
        }
      });
      ctx.plotPreviewSplitByScenario(byScenario, "Quick Compare (" + key + ")");
      ctx.setStatus("Quick compare plotted (RK4 only), split by scenario for " + key + ".");
      return;
    }

    var s = scenarios[0];
    var vals = plan.valuesByScenario[s] || [];
    var traces = [];
    for (var j = 0; j < vals.length; j += 1) {
      var cfgSingle = ctx.getEvalCondition(s);
      cfgSingle[key] = vals[j];
      var simSingle = ctx.simulateOscillator(cfgSingle);
      traces.push({
        x: simSingle.t,
        y: simSingle.x,
        mode: "lines",
        name: key + "=" + vals[j].toFixed(3),
        line: { color: colors[j] },
      });
    }
    ctx.plotTrajectories(traces, "Quick Compare (" + s + ", " + key + ")");
    ctx.setStatus("Quick compare plotted (RK4 only) for " + key + ".");
  }

  function runParameterSweepAction(ctx) {
    var param = String((ctx && ctx.sweepParam) || "");
    var values = parseSweepValues(ctx && ctx.sweepValuesCsv);
    if (!values.length) {
      throw new Error("Sweep error: provide numeric csv values.");
    }
    var selectedScenarios = Array.isArray(ctx && ctx.selectedScenarios) ? ctx.selectedScenarios : [];
    var scenarios = selectedScenarios.length ? selectedScenarios : [String((ctx && ctx.primaryScenario) || "spring")];
    var sweepSig = JSON.stringify({
      param: param,
      values: values,
      scenarios: scenarios,
      uiState: ctx && ctx.sweepUiState,
    });
    var isSameConfig = String((ctx && ctx.lastSweepSig) || "") === sweepSig;
    if (ctx && typeof ctx.setLastSweepSig === "function") ctx.setLastSweepSig(sweepSig);

    var colors = ["#22d3ee", "#a78bfa", "#f59e0b", "#34d399", "#f43f5e", "#facc15"];
    if (scenarios.length > 1) {
      var byScenario = {};
      scenarios.forEach(function (scen) {
        var base = Object.assign({}, ctx.getEvalCondition(scen), { scenario: scen });
        if (scen === "bouncing" && param === "k") {
          ctx.setStatus("Note: bouncing-ball gravity is fixed to 9.81, so sweeping k has no effect.");
        }
        byScenario[scen] = values.map(function (v, idx) {
          var cfg = Object.assign({}, base);
          cfg[param] = v;
          var sim = ctx.simulateOscillator(cfg);
          return {
            x: sim.t,
            y: sim.x,
            mode: "lines",
            name: param + "=" + v,
            line: { color: colors[idx % colors.length] },
          };
        });
      });
      ctx.plotPreviewSplitByScenario(byScenario, "Parameter Sweep (" + param + ")");
      ctx.setStatus(isSameConfig ? "Parameter sweep rerun with same config; curves unchanged by design." : "Parameter sweep generated, split by scenario.");
      return;
    }

    var scenSingle = scenarios[0];
    var baseSingle = Object.assign({}, ctx.getEvalCondition(scenSingle), { scenario: scenSingle });
    if (scenSingle === "bouncing" && param === "k") {
      ctx.setStatus("Note: bouncing-ball gravity is fixed to 9.81, so sweeping k has no effect.");
    }
    var traces = values.map(function (v, idx) {
      var cfg = Object.assign({}, baseSingle);
      cfg[param] = v;
      var sim = ctx.simulateOscillator(cfg);
      return {
        x: sim.t,
        y: sim.x,
        mode: "lines",
        name: param + "=" + v,
        line: { color: colors[idx % colors.length] },
      };
    });
    ctx.plotTrajectories(traces, "Parameter Sweep (" + scenSingle + ", " + param + ")");
    ctx.setStatus(isSameConfig ? "Parameter sweep rerun with same config; curves unchanged by design." : "Parameter sweep comparison generated.");
  }

  function applyWorkspaceState(ctx) {
    var ui = (ctx && ctx.ui) || {};
    if (!ui.rk4Controls) return;
    ui.rk4Controls.style.display = "none";
  }

  function bindUi(ctx) {
    void ctx;
  }

  function syncPreviewTimeControls(ctx, fromPreview) {
    var datasetState = getDatasetState(ctx);
    var playgroundState = getPlaygroundState(ctx);
    if (fromPreview) {
      patchDatasetState(ctx, {
        durationSec: playgroundState.previewDurationSec,
        dt: playgroundState.previewDt,
        globalG: playgroundState.globalG,
      });
      return;
    }
    patchPlaygroundState(ctx, {
      previewDurationSec: datasetState.durationSec,
      previewDt: datasetState.dt,
      globalG: datasetState.globalG,
    });
  }

  function getDatasetScenarioSelection(ctx) {
    var datasetState = getDatasetState(ctx);
    var out = [];
    if (datasetState.cardDsSpring) out.push("spring");
    if (datasetState.cardDsPendulum) out.push("pendulum");
    if (datasetState.cardDsBouncing) out.push("bouncing");
    return out.length ? out : ["spring"];
  }

  function getPlaygroundScenarioSelection(ctx) {
    var playgroundState = getPlaygroundState(ctx);
    var out = [];
    if (playgroundState.pgSpring) out.push("spring");
    if (playgroundState.pgPendulum) out.push("pendulum");
    if (playgroundState.pgBouncing) out.push("bouncing");
    return out.length ? out : ["spring"];
  }

  function getPreviewParamsForScenario(ctx, scenario) {
    var uiState = getPlaygroundState(ctx);
    var preset = "safe";
    var limitsByScenario = (ctx && ctx.presetLimits) || {};
    var s = String(scenario || "spring");
    var lim = limitsByScenario[s] && limitsByScenario[s][preset] ? limitsByScenario[s][preset] : null;
    var clampValue = typeof (ctx && ctx.clamp) === "function"
      ? ctx.clamp
      : function (value, lo, hi) {
          return Math.min(Math.max(Number(value), Number(lo)), Number(hi));
        };
    function bounded(raw, range, fallback) {
      var bounds = Array.isArray(range) && range.length >= 2 ? range : [fallback, fallback];
      var n = Number(raw);
      var v = Number.isFinite(n) ? n : fallback;
      return clampValue(v, bounds[0], bounds[1]);
    }
    var gGlobal = clampValue(uiState.globalG, 0.1, 1e9);
    if (s === "pendulum") {
      return {
        scenario: "pendulum",
        m: bounded(uiState.pdM, lim && lim.m, 1.0),
        c: bounded(uiState.pdC, lim && lim.c, 0.15),
        k: bounded(uiState.pdK, lim && lim.k, 2.0),
        g: gGlobal,
        restitution: 0.8,
        groundModel: "rigid",
        groundK: 2500,
        groundC: 90,
        x0: bounded(uiState.pdX0, lim && lim.x0, 0.6),
        v0: bounded(uiState.pdV0, lim && lim.v0, 0.0),
      };
    }
    if (s === "bouncing") {
      return {
        scenario: "bouncing",
        m: bounded(uiState.bbM, lim && lim.m, 1.0),
        c: bounded(uiState.bbC, lim && lim.c, 0.15),
        k: gGlobal,
        g: gGlobal,
        restitution: bounded(uiState.bbE, lim && lim.e, 0.8),
        groundModel: String(uiState.bbGroundModel || "rigid"),
        groundK: Math.max(50, Number(uiState.bbGroundK) || 2500),
        groundC: Math.max(0, Number(uiState.bbGroundC) || 90),
        x0: bounded(uiState.bbX0, lim && lim.x0, 0.0),
        v0: bounded(uiState.bbV0, lim && lim.v0, 2.0),
      };
    }
    return {
      scenario: "spring",
      m: bounded(uiState.spM, lim && lim.m, 1.2),
      c: bounded(uiState.spC, lim && lim.c, 0.25),
      k: bounded(uiState.spK, lim && lim.k, 4.0),
      g: gGlobal,
      restitution: 0.8,
      groundModel: "rigid",
      groundK: 2500,
      groundC: 90,
      x0: bounded(uiState.spX0, lim && lim.x0, 1.0),
      v0: bounded(uiState.spV0, lim && lim.v0, 0.0),
    };
  }

  function getEvalCondition(ctx, scenarioOverride) {
    var uiState = getPlaygroundState(ctx);
    var scenario = String(
      scenarioOverride ||
      (getPlaygroundScenarioSelection(ctx)[0]) ||
      "spring"
    );
    var p = getPreviewParamsForScenario(ctx, scenario);
    var dt = Math.max(1e-6, Number(uiState.previewDt) || 0.02);
    var durationSec = Math.max(dt, Number(uiState.previewDurationSec) || 1);
    var steps = typeof (ctx && ctx.getStepsFromDuration) === "function"
      ? ctx.getStepsFromDuration(durationSec, dt)
      : Math.max(2, Math.round(durationSec / dt) + 1);
    return {
      scenario: p.scenario,
      m: p.m,
      c: p.c,
      k: p.k,
      g: p.g,
      restitution: p.restitution,
      groundModel: p.groundModel,
      groundK: p.groundK,
      groundC: p.groundC,
      x0: p.x0,
      v0: p.v0,
      dt: dt,
      durationSec: durationSec,
      steps: steps,
    };
  }

  function buildPlaygroundActionContext(ctx, actionId) {
    var uiState = getPlaygroundState(ctx);
    return {
      actionId: String(actionId || (ctx && ctx.actionId) || "").trim().toLowerCase(),
      selectedScenarios: getPlaygroundScenarioSelection(ctx),
      primaryScenario: String(getPlaygroundScenarioSelection(ctx)[0] || "spring"),
      quickCompareMode: String(uiState.quickCompareMode || "vary_m"),
      paramPreset: "safe",
      sweepParam: String(uiState.sweepParam || ""),
      sweepValuesCsv: String(uiState.sweepValues || ""),
      sweepUiState: {
        sp: [uiState.spM, uiState.spC, uiState.spK, uiState.spX0, uiState.spV0],
        pd: [uiState.pdM, uiState.pdC, uiState.pdK, uiState.pdX0, uiState.pdV0],
        bb: [uiState.bbM, uiState.bbC, uiState.globalG, uiState.bbE, uiState.bbGroundModel, uiState.bbGroundK, uiState.bbGroundC, uiState.bbX0, uiState.bbV0],
        dt: uiState.previewDt,
        durationSec: uiState.previewDurationSec,
      },
      lastSweepSig: String((ctx && ctx.state && ctx.state.lastSweepSig) || ""),
      setLastSweepSig: ctx && ctx.setLastSweepSig,
      simulateOscillator: ctx && ctx.simulateOscillator,
      getEvalCondition: function (scenarioOverride) {
        return getEvalCondition(ctx, scenarioOverride);
      },
      plotTrajectories: ctx && ctx.plotTrajectories,
      plotPreviewSplitByScenario: ctx && ctx.plotPreviewSplitByScenario,
      setStatus: ctx && ctx.setStatus,
      presetLimits: (ctx && ctx.presetLimits) || {},
    };
  }

  function resetScenarioCardDefaults(ctx, scen) {
    var s = String(scen || "");
    if (s === "spring") {
      patchPlaygroundState(ctx, {
        spM: DEFAULT_PLAYGROUND_CONFIG.spM,
        spC: DEFAULT_PLAYGROUND_CONFIG.spC,
        spK: DEFAULT_PLAYGROUND_CONFIG.spK,
        spX0: DEFAULT_PLAYGROUND_CONFIG.spX0,
        spV0: DEFAULT_PLAYGROUND_CONFIG.spV0,
      });
      if (ctx && typeof ctx.setStatus === "function") ctx.setStatus("Spring parameters reset.");
      return;
    }
    if (s === "pendulum") {
      patchPlaygroundState(ctx, {
        pdM: DEFAULT_PLAYGROUND_CONFIG.pdM,
        pdC: DEFAULT_PLAYGROUND_CONFIG.pdC,
        pdK: DEFAULT_PLAYGROUND_CONFIG.pdK,
        pdX0: DEFAULT_PLAYGROUND_CONFIG.pdX0,
        pdV0: DEFAULT_PLAYGROUND_CONFIG.pdV0,
      });
      if (ctx && typeof ctx.setStatus === "function") ctx.setStatus("Pendulum parameters reset.");
      return;
    }
    if (s === "bouncing") {
      patchPlaygroundState(ctx, {
        bbM: DEFAULT_PLAYGROUND_CONFIG.bbM,
        bbC: DEFAULT_PLAYGROUND_CONFIG.bbC,
        bbE: DEFAULT_PLAYGROUND_CONFIG.bbE,
        bbGroundModel: DEFAULT_PLAYGROUND_CONFIG.bbGroundModel,
        bbGroundK: DEFAULT_PLAYGROUND_CONFIG.bbGroundK,
        bbGroundC: DEFAULT_PLAYGROUND_CONFIG.bbGroundC,
        bbX0: DEFAULT_PLAYGROUND_CONFIG.bbX0,
        bbV0: DEFAULT_PLAYGROUND_CONFIG.bbV0,
      });
      if (ctx && typeof ctx.setStatus === "function") ctx.setStatus("Bouncing parameters reset.");
    }
  }

  function randomizePreviewCards(ctx) {
    var uiState = getPlaygroundState(ctx);
    var limitsByScenario = (ctx && ctx.presetLimits) || {};
    var preset = "safe";
    var limSp = limitsByScenario.spring && limitsByScenario.spring[preset] ? limitsByScenario.spring[preset] : null;
    var limPd = limitsByScenario.pendulum && limitsByScenario.pendulum[preset] ? limitsByScenario.pendulum[preset] : null;
    var limBb = limitsByScenario.bouncing && limitsByScenario.bouncing[preset] ? limitsByScenario.bouncing[preset] : null;
    var rand = typeof (ctx && ctx.randInRange) === "function"
      ? ctx.randInRange
      : function (range) {
          var lo = Array.isArray(range) && Number.isFinite(Number(range[0])) ? Number(range[0]) : 0;
          var hi = Array.isArray(range) && Number.isFinite(Number(range[1])) ? Number(range[1]) : lo;
          return lo + Math.random() * (hi - lo);
        };
    function fmt(v, d) { return Number(v).toFixed(d); }
    function pick(range, d) { return fmt(rand(range), d); }
    var patch = {};
    if (limSp) {
      patch.spM = Number(pick(limSp.m, 3));
      patch.spC = Number(pick(limSp.c, 3));
      patch.spK = Number(pick(limSp.k, 3));
      patch.spX0 = Number(pick(limSp.x0, 3));
      patch.spV0 = Number(pick(limSp.v0, 3));
    }
    if (limPd) {
      patch.pdM = Number(pick(limPd.m, 3));
      patch.pdC = Number(pick(limPd.c, 3));
      patch.pdK = Number(pick(limPd.k, 3));
      patch.pdX0 = Number(pick(limPd.x0, 3));
      patch.pdV0 = Number(pick(limPd.v0, 3));
    }
    if (limBb) {
      patch.globalG = Number(pick(limBb.k, 2));
      patch.bbM = Number(pick(limBb.m, 3));
      patch.bbC = Number(pick(limBb.c, 3));
      patch.bbE = Number(pick(limBb.e, 3));
      patch.bbGroundModel = Math.random() < 0.5 ? "rigid" : "compliant";
      patch.bbGroundK = Math.round(rand([600, 4000]));
      patch.bbGroundC = Math.round(rand([20, 220]));
      patch.bbX0 = Number(pick(limBb.x0, 3));
      patch.bbV0 = Number(pick(limBb.v0, 3));
    }
    void uiState;
    patchPlaygroundState(ctx, patch);
  }

  function buildPlaygroundConfigSpec(ctx) {
    var uiState = getPlaygroundState(ctx);
    return {
      sections: [
        {
          id: "global",
          title: "Global Controls",
          schema: [
            { key: "previewDurationSec", label: "Simulation time (s)", type: "number", min: 0.5, step: 0.1 },
            { key: "previewDt", label: "dt", type: "number", min: 0.001, step: 0.001 },
            { key: "globalG", label: "Gravity g (global)", type: "number", min: 0.1, step: 0.01 }
          ],
          value: {
            previewDurationSec: uiState.previewDurationSec,
            previewDt: uiState.previewDt,
            globalG: uiState.globalG
          },
          actions: [
            { id: "preview_time_reset", label: "Reset Global", secondary: true }
          ]
        },
        {
          id: "scenarios",
          title: "Scenarios",
          schema: [
            { key: "pgSpring", label: "Spring", type: "checkbox" },
            { key: "pgPendulum", label: "Pendulum", type: "checkbox" },
            { key: "pgBouncing", label: "Bouncing", type: "checkbox" }
          ],
          value: {
            pgSpring: uiState.pgSpring,
            pgPendulum: uiState.pgPendulum,
            pgBouncing: uiState.pgBouncing
          }
        },
        {
          id: "quick_compare",
          title: "Quick Compare",
          schema: [
            {
              key: "quickCompareMode",
              label: "Quick Compare",
              type: "select",
              options: [
                { value: "vary_m", label: "Vary Mass (m)" },
                { value: "vary_c", label: "Vary Air Resistance (c)" },
                { value: "vary_k", label: "Vary k / L / g" },
                { value: "vary_e", label: "Vary Restitution (e)" }
              ]
            }
          ],
          value: {
            quickCompareMode: uiState.quickCompareMode
          },
          actions: [
            { id: "quick_compare", label: "Quick Compare", secondary: true }
          ]
        },
        {
          id: "parameter_sweep",
          title: "Parameter Sweep",
          schema: [
            {
              key: "sweepParam",
              label: "Sweep Parameter",
              type: "select",
              options: [
                { value: "m", label: "Mass m" },
                { value: "c", label: "Damping/Air c" },
                { value: "k", label: "k / L / g" },
                { value: "restitution", label: "Restitution e" }
              ]
            },
            { key: "sweepValues", label: "Sweep Values (csv)", type: "text" }
          ],
          value: {
            sweepParam: uiState.sweepParam,
            sweepValues: uiState.sweepValues
          },
          actions: [
            { id: "parameter_sweep", label: "Parameter Sweep", secondary: true }
          ]
        },
        {
          id: "preview_utilities",
          title: "Preview Utilities",
          schema: [],
          emptyText: "",
          value: {},
          actions: [
            { id: "randomize_preview", label: "Random Params + Preview", secondary: true },
            { id: "reset_all_preview", label: "Reset All + Preview", secondary: true }
          ]
        },
        {
          id: "spring",
          title: "Spring Parameters",
          schema: [
            { key: "spM", label: "Mass (m)", type: "number" },
            { key: "spC", label: "Damping (c)", type: "number" },
            { key: "spK", label: "Stiffness (k)", type: "number" },
            { key: "spX0", label: "Initial Position x(0)", type: "number" },
            { key: "spV0", label: "Initial Velocity v(0)", type: "number" }
          ],
          value: {
            spM: uiState.spM,
            spC: uiState.spC,
            spK: uiState.spK,
            spX0: uiState.spX0,
            spV0: uiState.spV0
          },
          actions: [{ id: "reset_spring", label: "Reset", secondary: true }]
        },
        {
          id: "pendulum",
          title: "Pendulum Parameters",
          schema: [
            { key: "pdM", label: "Mass (m)", type: "number" },
            { key: "pdC", label: "Damping (c)", type: "number" },
            { key: "pdK", label: "Length (L)", type: "number" },
            { key: "pdX0", label: "Initial Angle/State x(0)", type: "number" },
            { key: "pdV0", label: "Initial Angular Velocity v(0)", type: "number" }
          ],
          value: {
            pdM: uiState.pdM,
            pdC: uiState.pdC,
            pdK: uiState.pdK,
            pdX0: uiState.pdX0,
            pdV0: uiState.pdV0
          },
          actions: [{ id: "reset_pendulum", label: "Reset", secondary: true }]
        },
        {
          id: "bouncing",
          title: "Bouncing Parameters",
          schema: [
            { key: "bbM", label: "Mass (m)", type: "number" },
            { key: "bbC", label: "Air Drag (c)", type: "number" },
            { key: "bbE", label: "Restitution (e)", type: "number" },
            { key: "bbGroundModel", label: "Ground model", type: "select", options: [{ value: "rigid", label: "Rigid (impact)" }, { value: "compliant", label: "Compliant (spring-damper)" }] },
            { key: "bbGroundK", label: "Ground Stiffness (k_g)", type: "number" },
            { key: "bbGroundC", label: "Ground Damping (c_g)", type: "number" },
            { key: "bbX0", label: "Initial Height x(0)", type: "number" },
            { key: "bbV0", label: "Initial Velocity v(0)", type: "number" }
          ],
          value: {
            bbM: uiState.bbM,
            bbC: uiState.bbC,
            bbE: uiState.bbE,
            bbGroundModel: uiState.bbGroundModel,
            bbGroundK: uiState.bbGroundK,
            bbGroundC: uiState.bbGroundC,
            bbX0: uiState.bbX0,
            bbV0: uiState.bbV0
          },
          actions: [{ id: "reset_bouncing", label: "Reset", secondary: true }]
        }
      ]
    };
  }

  function buildDatasetSplitModeOptions(ctx) {
    var schemaId = String((ctx && ctx.activeSchemaId) || "oscillator").trim().toLowerCase() || "oscillator";
    var defs = ctx && typeof ctx.getSchemaSplitModeDefs === "function"
      ? ctx.getSchemaSplitModeDefs(schemaId)
      : [];
    if (!Array.isArray(defs) || !defs.length) {
      return [
        { value: "stratified_scenario", label: "Stratified by scenario" },
        { value: "random", label: "Random (global)" }
      ];
    }
    return defs.map(function (def) {
      return {
        value: String((def && def.id) || ""),
        label: String((def && def.label) || (def && def.id) || ""),
      };
    }).filter(function (entry) { return entry.value; });
  }

  function buildDatasetConfigSpec(ctx) {
    var uiState = getDatasetState(ctx);
    return {
      sections: [
        {
          id: "dataset_common",
          title: "Dataset Config",
          schema: [
            { key: "seed", label: "Random Seed", type: "number", step: 1 },
            { key: "splitMode", label: "Split mode", type: "select", options: buildDatasetSplitModeOptions(ctx) },
            { key: "trainFrac", label: "Train fraction", type: "number", min: 0.01, max: 0.99, step: 0.01 },
            { key: "valFrac", label: "Val fraction", type: "number", min: 0.01, max: 0.99, step: 0.01 },
            { key: "testFrac", label: "Test fraction (auto)", type: "number", step: 0.01, disabled: true },
            { key: "numTraj", label: "Trajectories", type: "number", min: 10, step: 1 },
            { key: "durationSec", label: "Simulation duration (s)", type: "number", min: 0.5, step: 0.1 },
            { key: "dt", label: "dt", type: "number", min: 0.001, step: 0.001 },
            { key: "globalG", label: "Gravity g (global)", type: "number", min: 0.1, step: 0.01 }
          ],
          value: {
            seed: String(uiState.seed),
            splitMode: uiState.splitMode,
            trainFrac: Number(uiState.trainFrac || 0.7).toFixed(4),
            valFrac: Number(uiState.valFrac || 0.15).toFixed(4),
            testFrac: Number(uiState.testFrac || 0.15).toFixed(4),
            numTraj: String(uiState.numTraj),
            durationSec: String(uiState.durationSec),
            dt: String(uiState.dt),
            globalG: String(uiState.globalG)
          }
        },
        {
          id: "dataset_spring",
          title: "Spring Parameters",
          schema: [
            { key: "cardDsSpring", label: "Include in dataset", type: "checkbox" },
            { key: "spMRng", label: "Mass m range [min,max]", type: "text" },
            { key: "spCRng", label: "Damping c range [min,max]", type: "text" },
            { key: "spKRng", label: "Stiffness k range [min,max]", type: "text" },
            { key: "spX0Rng", label: "x(0) range [min,max]", type: "text" },
            { key: "spV0Rng", label: "v(0) range [min,max]", type: "text" }
          ],
          value: {
            cardDsSpring: uiState.cardDsSpring,
            spMRng: uiState.spMRng,
            spCRng: uiState.spCRng,
            spKRng: uiState.spKRng,
            spX0Rng: uiState.spX0Rng,
            spV0Rng: uiState.spV0Rng
          }
        },
        {
          id: "dataset_pendulum",
          title: "Pendulum Parameters",
          schema: [
            { key: "cardDsPendulum", label: "Include in dataset", type: "checkbox" },
            { key: "pdMRng", label: "Mass m range [min,max]", type: "text" },
            { key: "pdCRng", label: "Damping c range [min,max]", type: "text" },
            { key: "pdKRng", label: "Length L range [min,max]", type: "text" },
            { key: "pdX0Rng", label: "x(0) range [min,max]", type: "text" },
            { key: "pdV0Rng", label: "v(0) range [min,max]", type: "text" }
          ],
          value: {
            cardDsPendulum: uiState.cardDsPendulum,
            pdMRng: uiState.pdMRng,
            pdCRng: uiState.pdCRng,
            pdKRng: uiState.pdKRng,
            pdX0Rng: uiState.pdX0Rng,
            pdV0Rng: uiState.pdV0Rng
          }
        },
        {
          id: "dataset_bouncing",
          title: "Bouncing Parameters",
          schema: [
            { key: "cardDsBouncing", label: "Include in dataset", type: "checkbox" },
            { key: "bbGroundModel", label: "Ground model", type: "select", options: [{ value: "rigid", label: "Rigid (impact)" }, { value: "compliant", label: "Compliant (spring-damper)" }] },
            { key: "bbGroundK", label: "Ground Stiffness (k_g)", type: "number", min: 50, step: 50 },
            { key: "bbGroundC", label: "Ground Damping (c_g)", type: "number", min: 0, step: 1 },
            { key: "bbMRng", label: "Mass m range [min,max]", type: "text" },
            { key: "bbCRng", label: "Air drag c range [min,max]", type: "text" },
            { key: "bbERng", label: "Restitution e range [min,max]", type: "text" },
            { key: "bbX0Rng", label: "x(0) range [min,max]", type: "text" },
            { key: "bbV0Rng", label: "v(0) range [min,max]", type: "text" }
          ],
          value: {
            cardDsBouncing: uiState.cardDsBouncing,
            bbGroundModel: uiState.bbGroundModel,
            bbGroundK: String(uiState.bbGroundK),
            bbGroundC: String(uiState.bbGroundC),
            bbMRng: uiState.bbMRng,
            bbCRng: uiState.bbCRng,
            bbERng: uiState.bbERng,
            bbX0Rng: uiState.bbX0Rng,
            bbV0Rng: uiState.bbV0Rng
          }
        }
      ],
      actions: [
        { id: "create_dataset", label: "Create Dataset" }
      ]
    };
  }

  function buildDatasetBuildConfig(ctx) {
    var uiState = getDatasetState(ctx);
    var preset = "safe";
    var includedScenarios = getDatasetScenarioSelection(ctx);
    var primaryScenario = includedScenarios.length ? includedScenarios[0] : "spring";
    var lim = PRESET_LIMITS[primaryScenario] && PRESET_LIMITS[primaryScenario][preset]
      ? PRESET_LIMITS[primaryScenario][preset]
      : PRESET_LIMITS.spring.safe;
    var dt = Math.max(1e-6, Number(uiState.dt) || 0.02);
    var durationSec = Math.max(dt, Number(uiState.durationSec) || 16.0);
    var steps = ctx && typeof ctx.getStepsFromDuration === "function"
      ? ctx.getStepsFromDuration(durationSec, dt)
      : Math.max(2, Math.round(durationSec / dt) + 1);
    var globalG = Math.max(0.1, Number(uiState.globalG) || 9.81);
    var splitMode = String(uiState.splitMode || "stratified_scenario");
    var trainFrac = Number(uiState.trainFrac);
    var valFrac = Number(uiState.valFrac);
    var testFrac = Number(uiState.testFrac);
    var requestedMode = ctx && typeof ctx.getRequestedDatasetMode === "function"
      ? String(ctx.getRequestedDatasetMode() || "autoregressive")
      : "autoregressive";
    var targetMode = ctx && typeof ctx.inferTargetModeForGraph === "function"
      ? String(ctx.inferTargetModeForGraph("x") || "x")
      : "x";
    var arFeatureSpec = ctx && typeof ctx.inferFeatureSpecForMode === "function"
      ? ctx.inferFeatureSpecForMode("autoregressive", {
          useX: true,
          useV: true,
          useParams: true,
          useTimeSec: false,
          useTimeNorm: true,
          useScenario: false,
          useSinNorm: false,
          useCosNorm: false,
        })
      : {
          useX: true,
          useV: true,
          useParams: true,
          useTimeSec: false,
          useTimeNorm: true,
          useScenario: false,
          useSinNorm: false,
          useCosNorm: false,
        };
    var directFeatureSpec = ctx && typeof ctx.inferFeatureSpecForMode === "function"
      ? ctx.inferFeatureSpecForMode("direct", {
          useX: false,
          useV: false,
          useParams: true,
          useTimeSec: false,
          useTimeNorm: true,
          useScenario: false,
          useSinNorm: false,
          useCosNorm: false,
        })
      : {
          useX: false,
          useV: false,
          useParams: true,
          useTimeSec: false,
          useTimeNorm: true,
          useScenario: false,
          useSinNorm: false,
          useCosNorm: false,
        };

    var scenarioRanges = {
      spring: {
        mRange: parseRange(uiState.spMRng, lim.m, PRESET_LIMITS.spring.safe.m),
        cRange: parseRange(uiState.spCRng, lim.c, PRESET_LIMITS.spring.safe.c),
        kRange: parseRange(uiState.spKRng, lim.k, PRESET_LIMITS.spring.safe.k),
        restitutionRange: (PRESET_LIMITS.spring.safe.e || [0.6, 0.9]).slice(),
        x0Range: parseRange(uiState.spX0Rng, lim.x0, PRESET_LIMITS.spring.safe.x0),
        v0Range: parseRange(uiState.spV0Rng, lim.v0, PRESET_LIMITS.spring.safe.v0),
      },
      pendulum: {
        mRange: parseRange(uiState.pdMRng, PRESET_LIMITS.pendulum.safe.m, PRESET_LIMITS.pendulum.safe.m),
        cRange: parseRange(uiState.pdCRng, PRESET_LIMITS.pendulum.safe.c, PRESET_LIMITS.pendulum.safe.c),
        kRange: parseRange(uiState.pdKRng, PRESET_LIMITS.pendulum.safe.k, PRESET_LIMITS.pendulum.safe.k),
        restitutionRange: (PRESET_LIMITS.pendulum.safe.e || [0.6, 0.9]).slice(),
        x0Range: parseRange(uiState.pdX0Rng, PRESET_LIMITS.pendulum.safe.x0, PRESET_LIMITS.pendulum.safe.x0),
        v0Range: parseRange(uiState.pdV0Rng, PRESET_LIMITS.pendulum.safe.v0, PRESET_LIMITS.pendulum.safe.v0),
      },
      bouncing: {
        mRange: parseRange(uiState.bbMRng, PRESET_LIMITS.bouncing.safe.m, PRESET_LIMITS.bouncing.safe.m),
        cRange: parseRange(uiState.bbCRng, PRESET_LIMITS.bouncing.safe.c, PRESET_LIMITS.bouncing.safe.c),
        kRange: [globalG, globalG],
        restitutionRange: parseRange(uiState.bbERng, PRESET_LIMITS.bouncing.safe.e, PRESET_LIMITS.bouncing.safe.e),
        x0Range: parseRange(uiState.bbX0Rng, PRESET_LIMITS.bouncing.safe.x0, PRESET_LIMITS.bouncing.safe.x0),
        v0Range: parseRange(uiState.bbV0Rng, PRESET_LIMITS.bouncing.safe.v0, PRESET_LIMITS.bouncing.safe.v0),
        groundModel: String(uiState.bbGroundModel || "rigid"),
        groundK: Math.max(50, Number(uiState.bbGroundK) || 2500),
        groundC: Math.max(0, Number(uiState.bbGroundC) || 90),
      },
    };

    return {
      requestedVariantId: requestedMode,
      activeVariantId: requestedMode,
      variants: {
        autoregressive: {
          schemaId: "oscillator",
          scenarioType: primaryScenario,
          paramPreset: preset,
          includedScenarios: includedScenarios.slice(),
          mRange: scenarioRanges[primaryScenario].mRange.slice(),
          cRange: scenarioRanges[primaryScenario].cRange.slice(),
          kRange: scenarioRanges[primaryScenario].kRange.slice(),
          restitutionRange: scenarioRanges[primaryScenario].restitutionRange.slice(),
          x0Range: scenarioRanges[primaryScenario].x0Range.slice(),
          v0Range: scenarioRanges[primaryScenario].v0Range.slice(),
          groundModel: String((scenarioRanges[primaryScenario] && scenarioRanges[primaryScenario].groundModel) || uiState.bbGroundModel || "rigid"),
          groundK: Math.max(50, Number((scenarioRanges[primaryScenario] && scenarioRanges[primaryScenario].groundK) || uiState.bbGroundK) || 2500),
          groundC: Math.max(0, Number((scenarioRanges[primaryScenario] && scenarioRanges[primaryScenario].groundC) || uiState.bbGroundC) || 90),
          numTraj: Math.max(10, Number(uiState.numTraj) || 150),
          durationSec: durationSec,
          steps: steps,
          windowSize: Math.max(5, Number(ctx && typeof ctx.getActiveWindowSize === "function" ? ctx.getActiveWindowSize() : 20) || 20),
          dt: dt,
          seed: Math.max(0, Number(uiState.seed) || 42),
          featureConfig: OSC_CORE.ensureFeatureConfig({ useX: true, useV: true, useParams: true }),
          predictionMode: "autoregressive",
          targetMode: targetMode,
          globalG: globalG,
          splitConfig: {
            mode: splitMode,
            train: trainFrac,
            val: valFrac,
            test: testFrac,
          },
          scenarioRanges: scenarioRanges,
          featureSpec: arFeatureSpec,
        },
        direct: {
          schemaId: "oscillator",
          scenarioType: primaryScenario,
          paramPreset: preset,
          includedScenarios: includedScenarios.slice(),
          mRange: scenarioRanges[primaryScenario].mRange.slice(),
          cRange: scenarioRanges[primaryScenario].cRange.slice(),
          kRange: scenarioRanges[primaryScenario].kRange.slice(),
          restitutionRange: scenarioRanges[primaryScenario].restitutionRange.slice(),
          x0Range: scenarioRanges[primaryScenario].x0Range.slice(),
          v0Range: scenarioRanges[primaryScenario].v0Range.slice(),
          groundModel: String((scenarioRanges[primaryScenario] && scenarioRanges[primaryScenario].groundModel) || uiState.bbGroundModel || "rigid"),
          groundK: Math.max(50, Number((scenarioRanges[primaryScenario] && scenarioRanges[primaryScenario].groundK) || uiState.bbGroundK) || 2500),
          groundC: Math.max(0, Number((scenarioRanges[primaryScenario] && scenarioRanges[primaryScenario].groundC) || uiState.bbGroundC) || 90),
          numTraj: Math.max(10, Number(uiState.numTraj) || 150),
          durationSec: durationSec,
          steps: steps,
          windowSize: Math.max(5, Number(ctx && typeof ctx.getActiveWindowSize === "function" ? ctx.getActiveWindowSize() : 20) || 20),
          dt: dt,
          seed: Math.max(0, Number(uiState.seed) || 42),
          featureConfig: OSC_CORE.ensureFeatureConfig({ useX: false, useV: false, useParams: true }),
          predictionMode: "direct",
          targetMode: targetMode,
          globalG: globalG,
          splitConfig: {
            mode: splitMode,
            train: trainFrac,
            val: valFrac,
            test: testFrac,
          },
          scenarioRanges: scenarioRanges,
          featureSpec: directFeatureSpec,
        },
      },
    };
  }

  function handlePlaygroundConfigChange(nextConfig, payload, ctx) {
    var key = String((payload && payload.key) || "").trim();
    if (!key) return;
    var value = payload ? payload.value : undefined;
    var nextState = patchPlaygroundState(ctx, (function () {
      var patch = {};
      patch[key] = value;
      return patch;
    })());
    if (key === "previewDurationSec" || key === "previewDt" || key === "globalG") {
      ctx.syncPreviewTimeControls(true);
    }
    if (key === "pgSpring" || key === "pgPendulum" || key === "pgBouncing") {
      nextState = setPlaygroundState(ctx, nextState);
    }
    if (key === "quickCompareMode") {
      ctx.updateQuickCompareInfo();
      return;
    }
    if (ctx && typeof ctx.refreshPlaygroundConfigPanel === "function") ctx.refreshPlaygroundConfigPanel();
    ctx.schedulePreviewRefresh();
  }

  function handlePlaygroundAction(payload, ctx) {
    var actionId = String((payload && payload.actionId) || "").trim().toLowerCase();
    if (actionId === "preview_time_reset") {
      patchPlaygroundState(ctx, {
        previewDurationSec: DEFAULT_PLAYGROUND_CONFIG.previewDurationSec,
        previewDt: DEFAULT_PLAYGROUND_CONFIG.previewDt,
        globalG: DEFAULT_PLAYGROUND_CONFIG.globalG,
      });
      ctx.syncPreviewTimeControls(true);
      ctx.setStatus("Global settings reset (T=16.0s, dt=0.02, g=9.81).");
      if (ctx && typeof ctx.refreshPlaygroundConfigPanel === "function") ctx.refreshPlaygroundConfigPanel();
      ctx.schedulePreviewRefresh();
      return;
    }
    if (actionId === "quick_compare") {
      ctx.runQuickCompare();
      return;
    }
    if (actionId === "parameter_sweep") {
      ctx.runParameterSweep();
      return;
    }
    if (actionId === "randomize_preview") {
      ctx.randomizePreviewCards();
      ctx.setStatus("Randomized all scenario cards.");
      ctx.setPreviewCompareLock(false);
      if (ctx && typeof ctx.refreshPlaygroundConfigPanel === "function") ctx.refreshPlaygroundConfigPanel();
      ctx.runPreview();
      return;
    }
    if (actionId === "reset_all_preview") {
      ctx.resetScenarioCardDefaults("spring");
      ctx.resetScenarioCardDefaults("pendulum");
      ctx.resetScenarioCardDefaults("bouncing");
      ctx.setStatus("Reset all scenario cards.");
      ctx.setPreviewCompareLock(false);
      if (ctx && typeof ctx.refreshPlaygroundConfigPanel === "function") ctx.refreshPlaygroundConfigPanel();
      ctx.runPreview();
      return;
    }
    if (actionId === "reset_spring") {
      ctx.resetScenarioCardDefaults("spring");
      if (ctx && typeof ctx.refreshPlaygroundConfigPanel === "function") ctx.refreshPlaygroundConfigPanel();
      ctx.schedulePreviewRefresh();
      return;
    }
    if (actionId === "reset_pendulum") {
      ctx.resetScenarioCardDefaults("pendulum");
      if (ctx && typeof ctx.refreshPlaygroundConfigPanel === "function") ctx.refreshPlaygroundConfigPanel();
      ctx.schedulePreviewRefresh();
      return;
    }
    if (actionId === "reset_bouncing") {
      ctx.resetScenarioCardDefaults("bouncing");
      if (ctx && typeof ctx.refreshPlaygroundConfigPanel === "function") ctx.refreshPlaygroundConfigPanel();
      ctx.schedulePreviewRefresh();
    }
  }

  function handleDatasetConfigChange(_nextConfig, payload, ctx) {
    var key = String((payload && payload.key) || "").trim();
    if (!key) return;
    var value = payload ? payload.value : undefined;
    patchDatasetState(ctx, (function () {
      var patch = {};
      patch[key] = value;
      return patch;
    })());
    if ((key === "durationSec" || key === "dt" || key === "globalG") && ctx && typeof ctx.syncPreviewTimeControls === "function") {
      ctx.syncPreviewTimeControls(false);
    }
    if (ctx && typeof ctx.refreshDatasetConfigPanel === "function") {
      ctx.refreshDatasetConfigPanel();
    }
  }

  function handleDatasetAction(payload, ctx) {
    var actionId = String((payload && payload.actionId) || "").trim().toLowerCase();
    if (actionId === "create_dataset" && ctx && typeof ctx.triggerDatasetBuild === "function") {
      ctx.triggerDatasetBuild();
    }
  }

  return {
    id: "oscillator",
    schemaId: "oscillator",
    label: "Oscillator",
    description: "RK4 oscillator dataset builder (existing sidebar controls).",
    helpText: "RK4 oscillator dataset builder (existing sidebar controls). | split modes: stratified_scenario(stratify=scenario), random | columns: traj, step, t, x, v, scenario, m, c, k_slg, k_slg_role, g_global, e, x0, v0, ground, k_g, c_g",
    kind: "builtin_sidebar",
    playground: {
      mode: "trajectory_simulation",
    },
    playgroundApi: {
      buildQuickCompareInfoText: buildQuickCompareInfoText,
      renderDataset: function (mountEl, deps) {
        if (!mountEl) return;
        var Plotly = deps && deps.Plotly;
        var elF = deps && deps.el || function (tag, a, c) {
          var e = document.createElement(tag); if (a) Object.keys(a).forEach(function(k){ if(k==="className")e.className=a[k]; else if(k==="textContent")e.textContent=a[k]; else e.setAttribute(k,a[k]); }); if(c)(Array.isArray(c)?c:[c]).forEach(function(ch){ if(typeof ch==="string")e.appendChild(document.createTextNode(ch)); else if(ch)e.appendChild(ch); }); return e;
        };
        var d = deps && deps.datasetData;
        if (!d) { mountEl.appendChild(elF("div", { style: "color:#64748b;" }, "No dataset data")); return; }

        var isBundle = d.kind === "dataset_bundle" && d.datasets;
        var variants = isBundle ? Object.keys(d.datasets) : ["default"];
        var activeVar = isBundle ? (d.activeVariantId || variants[0]) : "default";
        var activeDs = isBundle ? d.datasets[activeVar] : d;

        if (!activeDs) { mountEl.appendChild(elF("div", { style: "color:#64748b;" }, "No active variant")); return; }

        // summary
        mountEl.appendChild(elF("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:8px;" },
          "Trajectories: " + ((activeDs.trajectories || []).length) +
          " | Train: " + (activeDs.trainCount || (activeDs.xTrain || []).length) +
          " | Val: " + (activeDs.valCount || (activeDs.xVal || []).length) +
          " | Test: " + (activeDs.testCount || (activeDs.xTest || []).length) +
          " | Mode: " + (activeDs.mode || "?") +
          " | Window: " + (activeDs.windowSize || "?") +
          (isBundle ? " | Variant: " + activeVar : "")));

        // scenario distribution
        var trajs = activeDs.trajectories || [];
        if (trajs.length) {
          var scenarioCounts = {};
          trajs.forEach(function (tr) {
            var s = (tr.params && tr.params.scenario) || "unknown";
            scenarioCounts[s] = (scenarioCounts[s] || 0) + 1;
          });
          var distDiv = elF("div", { style: "margin-bottom:8px;" });
          distDiv.appendChild(elF("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:2px;font-weight:600;" }, "Scenario Distribution"));
          var maxC = 0;
          Object.keys(scenarioCounts).forEach(function (k) { if (scenarioCounts[k] > maxC) maxC = scenarioCounts[k]; });
          Object.keys(scenarioCounts).forEach(function (k) {
            var count = scenarioCounts[k];
            var pct = maxC > 0 ? (count / maxC) * 100 : 0;
            var row = elF("div", { style: "display:flex;align-items:center;gap:6px;margin-bottom:2px;" });
            row.appendChild(elF("span", { style: "font-size:10px;color:#94a3b8;min-width:60px;text-align:right;" }, k));
            var bar = elF("div", { style: "flex:1;height:12px;background:#1e293b;border-radius:3px;overflow:hidden;" });
            var colors = { spring: "#22d3ee", pendulum: "#a78bfa", bouncing: "#f59e0b" };
            bar.appendChild(elF("div", { style: "height:100%;width:" + pct + "%;background:" + (colors[k] || "#0ea5e9") + ";border-radius:3px;" }));
            row.appendChild(bar);
            row.appendChild(elF("span", { style: "font-size:10px;color:#64748b;" }, String(count)));
            distDiv.appendChild(row);
          });
          mountEl.appendChild(distDiv);
        }

        // plot sample trajectories
        if (Plotly && trajs.length) {
          var chartDiv = elF("div", { style: "height:300px;margin-top:8px;" });
          mountEl.appendChild(chartDiv);
          var traces = [];
          var showCount = Math.min(trajs.length, 9);
          var colors = { spring: "#22d3ee", pendulum: "#a78bfa", bouncing: "#f59e0b" };
          for (var ti = 0; ti < showCount; ti++) {
            var tr = trajs[ti];
            traces.push({
              x: tr.t, y: tr.x, mode: "lines",
              name: (tr.params && tr.params.scenario || "") + " #" + ti,
              line: { color: colors[(tr.params && tr.params.scenario)] || "#67e8f9", width: 1 },
            });
          }
          Plotly.newPlot(chartDiv, traces, {
            paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
            title: { text: "Sample Trajectories (" + showCount + "/" + trajs.length + ")", font: { size: 12 } },
            xaxis: { title: "t (s)", gridcolor: "#1e293b" }, yaxis: { gridcolor: "#1e293b" },
            legend: { orientation: "h", y: -0.15, font: { size: 9 } },
            margin: { t: 30, b: 50, l: 40, r: 10 },
          }, { responsive: true });

          // Random samples button
          var randBtn = elF("button", { style: "margin-top:4px;padding:4px 12px;font-size:11px;border-radius:6px;border:1px solid #0ea5e9;background:#0284c7;color:#fff;cursor:pointer;" }, "Random Samples");
          randBtn.addEventListener("click", function () {
            var newTraces = [];
            for (var ri = 0; ri < showCount; ri++) {
              var idx = Math.floor(Math.random() * trajs.length);
              var rtr = trajs[idx];
              newTraces.push({
                x: rtr.t, y: rtr.x, mode: "lines",
                name: (rtr.params && rtr.params.scenario || "") + " #" + idx,
                line: { color: colors[(rtr.params && rtr.params.scenario)] || "#67e8f9", width: 1 },
              });
            }
            Plotly.newPlot(chartDiv, newTraces, {
              paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
              title: { text: "Sample Trajectories (random " + showCount + "/" + trajs.length + ")", font: { size: 12 } },
              xaxis: { title: "t (s)", gridcolor: "#1e293b" }, yaxis: { gridcolor: "#1e293b" },
              legend: { orientation: "h", y: -0.15, font: { size: 9 } },
              margin: { t: 30, b: 50, l: 40, r: 10 },
            }, { responsive: true });
          });
          mountEl.appendChild(randBtn);
        }
      },
      runAction: function (actionId, ctx) {
        var aid = String(actionId || "").trim().toLowerCase();
        if (aid === "preview") return runPreviewAction(ctx || {});
        if (aid === "quick_compare") return runQuickCompareAction(ctx || {});
        if (aid === "parameter_sweep") return runParameterSweepAction(ctx || {});
        throw new Error("Unsupported oscillator playground action: " + aid);
      },
      renderPlayground: function (mountEl, deps) {
        if (!mountEl) return;
        var Plotly = deps && deps.Plotly;
        var elF = deps && deps.el || function (tag, attrs, ch) {
          var e = document.createElement(tag);
          if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === "className") e.className = attrs[k];
            else if (k === "textContent") e.textContent = attrs[k];
            else e.setAttribute(k, attrs[k]);
          });
          if (ch) (Array.isArray(ch) ? ch : [ch]).forEach(function (c) {
            if (typeof c === "string") e.appendChild(document.createTextNode(c));
            else if (c) e.appendChild(c);
          });
          return e;
        };

        var SCENARIOS = ["spring", "pendulum", "bouncing"];
        var DEFAULTS = {
          spring: { m: 1.2, c: 0.25, k: 4.0, x0: 1.0, v0: 0, e: 0.8 },
          pendulum: { m: 1.0, c: 0.15, k: 2.0, x0: 0.6, v0: 0, e: 0.8 },
          bouncing: { m: 1.0, c: 0.15, k: 9.81, x0: 1.0, v0: 2.0, e: 0.8 },
        };
        var LABELS = {
          spring: [
            { key: "m", label: "Mass m (kg)" }, { key: "c", label: "Damping c (Ns/m)" },
            { key: "k", label: "Stiffness k (N/m)" }, { key: "x0", label: "x\u2080 (m)" }, { key: "v0", label: "v\u2080 (m/s)" },
          ],
          pendulum: [
            { key: "m", label: "Mass m (kg)" }, { key: "c", label: "Damping c" },
            { key: "k", label: "Length L (m)" }, { key: "x0", label: "\u03b8\u2080 (rad)" }, { key: "v0", label: "\u03c9\u2080 (rad/s)" },
          ],
          bouncing: [
            { key: "m", label: "Mass m (kg)" }, { key: "c", label: "Air drag c" },
            { key: "k", label: "Gravity g (m/s\u00b2)" }, { key: "e", label: "Restitution e" },
            { key: "x0", label: "Height x\u2080 (m)" }, { key: "v0", label: "Velocity v\u2080 (m/s)" },
          ],
        };

        var scenarios = {};
        var globalInputs = {};
        var Y_LABELS = { spring: "displacement (m)", pendulum: "angle \u03b8 (rad)", bouncing: "height (m)" };
        var V_LABELS = { spring: "velocity (m/s)", pendulum: "angular vel \u03c9 (rad/s)", bouncing: "velocity (m/s)" };

        function simOne(scenarioId) {
          var sc = scenarios[scenarioId];
          if (!sc || !sc.chartDiv || !Plotly) return;
          var p = {};
          Object.keys(sc.inputs).forEach(function (k) { p[k] = Number(sc.inputs[k].value); });
          var g = Number((globalInputs.g || {}).value) || 9.81;
          var dt = Number((globalInputs.dt || {}).value) || 0.02;
          var dur = Number((globalInputs.durationSec || {}).value) || 8;
          var steps = Math.max(10, Math.floor(dur / dt));
          var sim = OSC_CORE.simulateOscillator({
            scenario: scenarioId, m: p.m || 1, c: p.c || 0, k: p.k || 4, g: g,
            x0: p.x0 || 0, v0: p.v0 || 0, restitution: p.e || 0.8,
            dt: dt, steps: steps, groundModel: "rigid", groundK: 2500, groundC: 90,
          });
          var title = scenarioId.charAt(0).toUpperCase() + scenarioId.slice(1) + " | m=" + (p.m||1) + " c=" + (p.c||0) + " k=" + (p.k||4);
          var showX = sc.showX ? sc.showX.checked : true;
          var showV = sc.showV ? sc.showV.checked : true;
          var traces = [];
          if (showX) traces.push({ x: sim.t, y: sim.x, mode: "lines", name: "x(t)", line: { color: "#22d3ee" } });
          if (showV) traces.push({ x: sim.t, y: sim.v, mode: "lines", name: "v(t)", line: { color: "#f59e0b", dash: "dot" } });
          if (!traces.length) traces.push({ x: [0], y: [0], mode: "lines", name: "-" });
          var yLabel = showX && !showV ? (Y_LABELS[scenarioId] || "x") : (showV && !showX ? (V_LABELS[scenarioId] || "v") : "");
          Plotly.newPlot(sc.chartDiv, traces, {
            paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
            title: { text: title, font: { size: 12 } },
            xaxis: { title: "t (s)", gridcolor: "#1e293b" }, yaxis: { title: yLabel, gridcolor: "#1e293b" },
            legend: { orientation: "h", y: -0.2, font: { size: 10 } },
            margin: { t: 30, b: 45, l: 50, r: 10 },
          }, { responsive: true });
        }

        function sweepParam(scenarioId, paramKey, values) {
          var sc = scenarios[scenarioId];
          if (!sc || !sc.chartDiv || !Plotly) return;
          var p = {};
          Object.keys(sc.inputs).forEach(function (k) { p[k] = Number(sc.inputs[k].value); });
          var g = Number((globalInputs.g || {}).value) || 9.81;
          var dt = Number((globalInputs.dt || {}).value) || 0.02;
          var dur = Number((globalInputs.durationSec || {}).value) || 8;
          var steps = Math.max(10, Math.floor(dur / dt));
          var showX = sc.showX ? sc.showX.checked : true;
          var showV = sc.showV ? sc.showV.checked : true;
          var traces = [];
          var colors = ["#22d3ee", "#f59e0b", "#a78bfa", "#4ade80", "#f43f5e", "#fb923c"];
          values.forEach(function (val, vi) {
            var pp = Object.assign({}, p);
            pp[paramKey] = val;
            var sim = OSC_CORE.simulateOscillator({
              scenario: scenarioId, m: pp.m || 1, c: pp.c || 0, k: pp.k || 4, g: g,
              x0: pp.x0 || 0, v0: pp.v0 || 0, restitution: pp.e || 0.8,
              dt: dt, steps: steps, groundModel: "rigid", groundK: 2500, groundC: 90,
            });
            var clr = colors[vi % colors.length];
            if (showX) traces.push({ x: sim.t, y: sim.x, mode: "lines", name: paramKey + "=" + val + " x", line: { color: clr } });
            if (showV) traces.push({ x: sim.t, y: sim.v, mode: "lines", name: paramKey + "=" + val + " v", line: { color: clr, dash: "dot" } });
          });
          if (!traces.length) traces.push({ x: [0], y: [0], mode: "lines", name: "-" });
          var yLabel = showX && !showV ? (Y_LABELS[scenarioId] || "x") : (showV && !showX ? (V_LABELS[scenarioId] || "v") : "");
          Plotly.newPlot(sc.chartDiv, traces, {
            paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
            title: { text: scenarioId + " | Sweep " + paramKey, font: { size: 12 } },
            xaxis: { title: "t (s)", gridcolor: "#1e293b" }, yaxis: { title: yLabel, gridcolor: "#1e293b" },
            legend: { orientation: "h", y: -0.2, font: { size: 9 } },
            margin: { t: 30, b: 45, l: 40, r: 10 },
          }, { responsive: true });
        }

        function simAll() { SCENARIOS.forEach(simOne); }
        function randomAll() {
          SCENARIOS.forEach(function (sid) {
            var sc = scenarios[sid];
            if (!sc) return;
            var def = DEFAULTS[sid];
            Object.keys(sc.inputs).forEach(function (k) {
              var base = def[k] || 1;
              sc.inputs[k].value = (base * (0.5 + Math.random())).toFixed(3);
            });
          });
        }

        // render config into deps.configEl (right panel)
        var configEl = deps && deps.configEl;
        if (configEl) {
          configEl.innerHTML = "";
          configEl.appendChild(elF("h3", { style: "margin:0 0 8px;font-size:13px;color:#94a3b8;text-transform:uppercase;" }, "Simulation Config"));

          var gDefs = [
            { key: "durationSec", label: "Duration (s)", value: 8, step: 0.5 },
            { key: "dt", label: "dt", value: 0.02, step: 0.001 },
            { key: "g", label: "Gravity g (m/s\u00b2)", value: 9.81, step: 0.1 },
          ];
          gDefs.forEach(function (gd) {
            var row = elF("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;" });
            row.appendChild(elF("span", { style: "font-size:11px;color:#94a3b8;" }, gd.label));
            var inp = elF("input", { type: "number", value: String(gd.value), style: "width:70px;padding:2px 4px;font-size:11px;border-radius:4px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
            if (gd.step) inp.setAttribute("step", gd.step);
            globalInputs[gd.key] = inp;
            row.appendChild(inp);
            configEl.appendChild(row);
          });

          var btnRow = elF("div", { style: "display:flex;gap:4px;margin:8px 0;" });
          var simBtn = elF("button", { style: "flex:1;padding:4px 8px;font-size:11px;border-radius:6px;border:1px solid #0ea5e9;background:#0284c7;color:#fff;cursor:pointer;" }, "Simulate All");
          simBtn.addEventListener("click", simAll);
          btnRow.appendChild(simBtn);
          var randBtn = elF("button", { style: "flex:1;padding:4px 8px;font-size:11px;border-radius:6px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;" }, "Random All");
          randBtn.addEventListener("click", function () { randomAll(); simAll(); });
          btnRow.appendChild(randBtn);
          configEl.appendChild(btnRow);

          SCENARIOS.forEach(function (sid) {
            var sc = { inputs: {} };
            var card = elF("div", { style: "border:1px solid #334155;border-radius:8px;padding:8px;margin-bottom:8px;background:#0b1220;" });
            var head = elF("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;" });
            head.appendChild(elF("strong", { style: "font-size:12px;color:#67e8f9;" }, sid.charAt(0).toUpperCase() + sid.slice(1)));
            var resetBtn = elF("button", { style: "padding:2px 6px;font-size:10px;border-radius:4px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;" }, "Reset");
            resetBtn.addEventListener("click", function () {
              var def = DEFAULTS[sid];
              Object.keys(def).forEach(function (k) { if (sc.inputs[k]) sc.inputs[k].value = String(def[k]); });
              simOne(sid);
            });
            head.appendChild(resetBtn);
            card.appendChild(head);
            (LABELS[sid] || []).forEach(function (p) {
              var row = elF("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;" });
              row.appendChild(elF("span", { style: "font-size:10px;color:#94a3b8;min-width:90px;" }, p.label));
              var inp = elF("input", { type: "number", value: String(DEFAULTS[sid][p.key] || 0), style: "width:60px;padding:2px 4px;font-size:10px;border-radius:4px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
              inp.setAttribute("step", "0.1");
              sc.inputs[p.key] = inp;
              row.appendChild(inp);
              card.appendChild(row);
            });
            // show/hide x(t), v(t)
            var toggleRow = elF("div", { style: "display:flex;gap:8px;margin-top:4px;font-size:10px;color:#94a3b8;" });
            var showXCb = elF("input", { type: "checkbox" }); showXCb.checked = true;
            var showVCb = elF("input", { type: "checkbox" }); showVCb.checked = true;
            sc.showX = showXCb; sc.showV = showVCb;
            var xLabel = elF("label", { style: "display:flex;align-items:center;gap:2px;cursor:pointer;" });
            xLabel.appendChild(showXCb); xLabel.appendChild(document.createTextNode("x(t)"));
            var vLabel = elF("label", { style: "display:flex;align-items:center;gap:2px;cursor:pointer;" });
            vLabel.appendChild(showVCb); vLabel.appendChild(document.createTextNode("v(t)"));
            toggleRow.appendChild(xLabel); toggleRow.appendChild(vLabel);
            showXCb.addEventListener("change", (function (s) { return function () { simOne(s); }; })(sid));
            showVCb.addEventListener("change", (function (s) { return function () { simOne(s); }; })(sid));
            card.appendChild(toggleRow);

            // parameter sweep
            var sweepRow = elF("div", { style: "display:flex;gap:4px;margin-top:4px;align-items:center;" });
            var sweepSelect = elF("select", { style: "padding:2px 4px;font-size:9px;border-radius:3px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
            (LABELS[sid] || []).forEach(function (p) {
              var opt = elF("option", { value: p.key }); opt.textContent = p.key; sweepSelect.appendChild(opt);
            });
            var defaultSweep = sid === "bouncing" ? "0.5,0.7,0.9" : "0.5,1.0,2.0";
            var sweepInput = elF("input", { type: "text", value: defaultSweep, style: "width:80px;padding:2px 4px;font-size:9px;border-radius:3px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
            var sweepBtn = elF("button", { style: "padding:2px 6px;font-size:9px;border-radius:3px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;" }, "Sweep");
            sweepBtn.addEventListener("click", (function (s, sel, inp) {
              return function () {
                var vals = inp.value.split(",").map(function (v) { return Number(v.trim()); }).filter(function (v) { return isFinite(v); });
                if (vals.length) sweepParam(s, sel.value, vals);
              };
            })(sid, sweepSelect, sweepInput));
            sweepRow.appendChild(sweepSelect); sweepRow.appendChild(sweepInput); sweepRow.appendChild(sweepBtn);
            card.appendChild(sweepRow);

            configEl.appendChild(card);
            scenarios[sid] = sc;
          });
        }

        // render charts into mountEl (main panel)
        SCENARIOS.forEach(function (sid) {
          if (!scenarios[sid]) scenarios[sid] = { inputs: {} };
          var wrap = elF("div", { style: "margin-bottom:12px;" });
          wrap.appendChild(elF("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:4px;font-weight:600;" },
            sid.charAt(0).toUpperCase() + sid.slice(1)));
          var chartDiv = elF("div", { style: "height:260px;" });
          wrap.appendChild(chartDiv);
          mountEl.appendChild(wrap);
          scenarios[sid].chartDiv = chartDiv;
        });

        setTimeout(simAll, 50);
      },
    },
    uiApi: {
      applyWorkspaceState: applyWorkspaceState,
      bindUi: bindUi,
      getPlaygroundState: getPlaygroundState,
      getDatasetState: getDatasetState,
      syncPreviewTimeControls: syncPreviewTimeControls,
      getDatasetScenarioSelection: getDatasetScenarioSelection,
      getPreviewParamsForScenario: getPreviewParamsForScenario,
      getEvalCondition: getEvalCondition,
      buildPlaygroundActionContext: buildPlaygroundActionContext,
      resetScenarioCardDefaults: resetScenarioCardDefaults,
      randomizePreviewCards: randomizePreviewCards,
      getDatasetConfigSpec: buildDatasetConfigSpec,
      handleDatasetConfigChange: handleDatasetConfigChange,
      handleDatasetAction: handleDatasetAction,
      getDatasetBuildConfig: buildDatasetBuildConfig,
      getPlaygroundConfigSpec: buildPlaygroundConfigSpec,
      handlePlaygroundConfigChange: handlePlaygroundConfigChange,
      handlePlaygroundAction: handlePlaygroundAction,
    },
    preconfig: {
      dataset: {
        seed: 42,
        totalCount: 150,
        splitDefaults: {
          mode: "stratified_scenario",
          train: 0.70,
          val: 0.15,
          test: 0.15,
        }
      }
    },
    build: function (cfg) {
      var raw = cfg && typeof cfg === "object" ? cfg : {};
      if (raw && raw.variants && typeof raw.variants === "object") {
        return OSC_CORE.buildDatasetBundle(raw);
      }
      return OSC_CORE.generateDataset(raw);
    },
  };
});

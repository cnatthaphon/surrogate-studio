(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCOscillatorDatasetCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function defaultParamMask() {
    return {
      m: true, c: true, k: true, e: true, x0: true, v0: true,
      gm: true, gk: true, gc: true, rkm: false, rcm: false, rgl: false,
    };
  }

  function normalizeParamMask(mask) {
    var d = defaultParamMask();
    if (!mask) return d;
    return {
      m: mask.m !== false,
      c: mask.c !== false,
      k: mask.k !== false,
      e: mask.e !== false,
      x0: mask.x0 !== false,
      v0: mask.v0 !== false,
      gm: mask.gm !== false,
      gk: mask.gk !== false,
      gc: mask.gc !== false,
      rkm: mask.rkm === true,
      rcm: mask.rcm === true,
      rgl: mask.rgl === true,
    };
  }

  function ensureFeatureConfig(cfg) {
    var out = {
      useX: Boolean(cfg && cfg.useX),
      useV: Boolean(cfg && cfg.useV),
      useParams: Boolean(cfg && cfg.useParams),
      useScenario: Boolean(cfg && cfg.useScenario),
    };
    if (out.useX || out.useV || out.useParams || out.useScenario) return out;
    return { useX: true, useV: false, useParams: true, useScenario: false };
  }

  function normalizeFeatureSpec(spec, mode) {
    var m = String(mode || "autoregressive");
    var s = Object.assign({}, spec || {});
    var useTimeNorm = s.useTimeNorm !== undefined ? Boolean(s.useTimeNorm) : Boolean(s.useTime);
    var useSinNorm = s.useSinNorm !== undefined ? Boolean(s.useSinNorm) : Boolean(s.useTrig);
    var useCosNorm = s.useCosNorm !== undefined ? Boolean(s.useCosNorm) : Boolean(s.useTrig);
    if (m === "direct") {
      return {
        useX: false,
        useV: false,
        useParams: Boolean(s.useParams),
        useTimeSec: Boolean(s.useTimeSec),
        useTimeNorm: useTimeNorm,
        useScenario: Boolean(s.useScenario),
        useSinNorm: useSinNorm,
        useCosNorm: useCosNorm,
        useNoiseSchedule: Boolean(s.useNoiseSchedule),
        paramMask: normalizeParamMask(s.paramMask),
      };
    }
    return {
      useX: Boolean(s.useX),
      useV: Boolean(s.useV),
      useParams: Boolean(s.useParams),
      useTimeSec: Boolean(s.useTimeSec),
      useTimeNorm: useTimeNorm,
      useScenario: Boolean(s.useScenario),
      useSinNorm: useSinNorm,
      useCosNorm: useCosNorm,
      useNoiseSchedule: Boolean(s.useNoiseSchedule),
      paramMask: normalizeParamMask(s.paramMask),
    };
  }

  function countStaticParams(paramMask) {
    var pm = normalizeParamMask(paramMask);
    return (
      (pm.m ? 1 : 0) +
      (pm.c ? 1 : 0) +
      (pm.k ? 1 : 0) +
      (pm.e ? 1 : 0) +
      (pm.x0 ? 1 : 0) +
      (pm.v0 ? 1 : 0) +
      (pm.gm ? 1 : 0) +
      (pm.gk ? 1 : 0) +
      (pm.gc ? 1 : 0) +
      (pm.rkm === true ? 1 : 0) +
      (pm.rcm === true ? 1 : 0) +
      (pm.rgl === true ? 1 : 0)
    );
  }

  function buildStaticParams(condition, paramMask) {
    var pm = normalizeParamMask(paramMask);
    var gm = String(condition.groundModel || "rigid") === "compliant" ? 1 : 0;
    var mSafe = Math.max(1e-9, Number(condition.m || 1));
    var cVal = Number(condition.c || 0);
    var kVal = Number(condition.k || 0);
    var gVal = Number(condition.g || 9.81);
    var lSafe = Math.max(1e-9, Number(condition.k || 1));
    var out = [];
    if (pm.m) out.push(Number(condition.m));
    if (pm.c) out.push(Number(condition.c));
    if (pm.k) out.push(Number(condition.k));
    if (pm.e) out.push(Number(condition.restitution != null ? condition.restitution : 0.8));
    if (pm.x0) out.push(Number(condition.x0 != null ? condition.x0 : 0));
    if (pm.v0) out.push(Number(condition.v0 != null ? condition.v0 : 0));
    if (pm.gm) out.push(gm);
    if (pm.gk) out.push(Number(condition.groundK != null ? condition.groundK : 2500));
    if (pm.gc) out.push(Number(condition.groundC != null ? condition.groundC : 90));
    if (pm.rkm) out.push(kVal / mSafe);
    if (pm.rcm) out.push(cVal / mSafe);
    if (pm.rgl) out.push(gVal / lSafe);
    return out;
  }

  function inferFeatureSizes(windowSize, featureCfg, featureSpec) {
    var cfg = ensureFeatureConfig(featureCfg);
    var nParams = countStaticParams(featureSpec && featureSpec.paramMask);
    var seqFeatureSize = 0;
    if (cfg.useX) seqFeatureSize += 1;
    if (cfg.useV) seqFeatureSize += 1;
    if (cfg.useParams) seqFeatureSize += nParams;
    if (cfg.useScenario) seqFeatureSize += 3;
    var flatFeatureSize =
      (cfg.useX ? windowSize : 0) +
      (cfg.useV ? windowSize : 0) +
      (cfg.useParams ? nParams : 0) +
      (cfg.useScenario ? 3 : 0);
    return {
      seqFeatureSize: Math.max(1, seqFeatureSize),
      flatFeatureSize: Math.max(1, flatFeatureSize),
    };
  }

  function noiseScheduleFeatures(tNorm) {
    var tau = clamp(Number(tNorm) || 0, 0, 1);
    var betaMin = 1e-4;
    var betaMax = 2e-2;
    var betaT = betaMin + (betaMax - betaMin) * tau;
    var alphaBar = Math.exp(-(betaMin * tau + 0.5 * (betaMax - betaMin) * tau * tau));
    var sigmaT = Math.sqrt(Math.max(1e-9, 1 - alphaBar));
    return [betaT, alphaBar, sigmaT];
  }

  function buildInputFeatures(historyX, historyV, condition, featureCfg, asSequence, featureSpec) {
    var cfg = ensureFeatureConfig(featureCfg);
    var staticParams = buildStaticParams(condition, featureSpec && featureSpec.paramMask);
    var scenarioVec = (function () {
      var s = String(condition.scenario || "spring");
      return [s === "spring" ? 1 : 0, s === "pendulum" ? 1 : 0, s === "bouncing" ? 1 : 0];
    })();
    if (!asSequence) {
      var out = [];
      if (cfg.useX) out.push.apply(out, historyX);
      if (cfg.useV) out.push.apply(out, historyV);
      if (cfg.useParams) out.push.apply(out, staticParams);
      if (cfg.useScenario) out.push.apply(out, scenarioVec);
      return out;
    }
    var seq = [];
    for (var i = 0; i < historyX.length; i += 1) {
      var row = [];
      if (cfg.useX) row.push(historyX[i]);
      if (cfg.useV) row.push(historyV[i]);
      if (cfg.useParams) row.push.apply(row, staticParams);
      if (cfg.useScenario) row.push.apply(row, scenarioVec);
      seq.push(row);
    }
    return seq;
  }

  function buildDirectFeatures(t, condition, durationSec, featureSpec) {
    var spec = normalizeFeatureSpec(featureSpec || { useParams: true, useTimeNorm: true, useScenario: false, useSinNorm: false, useCosNorm: false }, "direct");
    var T = Math.max(1e-6, Number(durationSec) || 1);
    var tNorm = Number(t) / T;
    var out = [];
    if (spec.useTimeSec) out.push(Number(t));
    if (spec.useTimeNorm) out.push(tNorm);
    if (spec.useSinNorm || spec.useCosNorm) {
      var ang = 2 * Math.PI * tNorm;
      if (spec.useSinNorm) out.push(Math.sin(ang));
      if (spec.useCosNorm) out.push(Math.cos(ang));
    }
    if (spec.useNoiseSchedule) out.push.apply(out, noiseScheduleFeatures(tNorm));
    if (spec.useScenario) {
      var s = String(condition.scenario || "spring");
      out.push(s === "spring" ? 1 : 0, s === "pendulum" ? 1 : 0, s === "bouncing" ? 1 : 0);
    }
    if (spec.useParams) out.push.apply(out, buildStaticParams(condition, spec.paramMask));
    return out.length ? out : [tNorm];
  }

  function inferDirectFeatureSize(featureSpec) {
    var spec = normalizeFeatureSpec(featureSpec || { useParams: true, useTimeNorm: true }, "direct");
    var n = 0;
    if (spec.useTimeSec) n += 1;
    if (spec.useTimeNorm) n += 1;
    if (spec.useSinNorm) n += 1;
    if (spec.useCosNorm) n += 1;
    if (spec.useNoiseSchedule) n += 3;
    if (spec.useScenario) n += 3;
    if (spec.useParams) n += countStaticParams(spec.paramMask);
    return Math.max(1, n);
  }

  function rk4Step(state, dt, params) {
    var m = params.m, c = params.c, k = params.k, g = params.g, scenario = params.scenario, groundModel = params.groundModel, groundK = params.groundK, groundC = params.groundC;
    var mSafe = Math.max(1e-6, Number(m) || 1);
    var cSafe = Math.max(0, Number(c) || 0);
    var deriv = function (sv) {
      var x = sv[0];
      var v = sv[1];
      var a;
      if (scenario === "bouncing") {
        var gravRaw = Number(g);
        var grav = Number.isFinite(gravRaw) && gravRaw > 0 ? gravRaw : 9.81;
        var invM = 1 / mSafe;
        a = -grav - (cSafe * invM) * v - (cSafe * invM) * Math.abs(v) * v;
        if (groundModel === "compliant") {
          var delta = Math.max(0, -x);
          var deltaDot = delta > 0 ? Math.max(0, -v) : 0;
          var fc = Math.max(0, Number(groundK) * delta + Number(groundC) * deltaDot);
          a += fc * invM;
        }
      } else if (scenario === "pendulum") {
        var L = Math.max(Number(k) || 0, 1e-6);
        var gravPendRaw = Number(g);
        var gravPend = Number.isFinite(gravPendRaw) && gravPendRaw > 0 ? gravPendRaw : 9.81;
        a = -(cSafe / mSafe) * v - (gravPend / L) * Math.sin(x);
      } else {
        var kSafe = Number(k) || 0;
        a = -(cSafe / mSafe) * v - (kSafe / mSafe) * x;
      }
      return [v, a];
    };

    var k1 = deriv(state);
    var k2 = deriv([state[0] + 0.5 * dt * k1[0], state[1] + 0.5 * dt * k1[1]]);
    var k3 = deriv([state[0] + 0.5 * dt * k2[0], state[1] + 0.5 * dt * k2[1]]);
    var k4 = deriv([state[0] + dt * k3[0], state[1] + dt * k3[1]]);

    return [
      state[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      state[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    ];
  }

  function simulateOscillator(cfg) {
    var scenario = cfg.scenario;
    var restitution = cfg.restitution;
    var groundModel = cfg.groundModel;
    var groundK = cfg.groundK;
    var groundC = cfg.groundC;
    var s = scenario === "bouncing"
      ? [Math.max(0, Number(cfg.x0) || 0), Number(cfg.v0) || 0]
      : [cfg.x0, cfg.v0];
    var steps = Number(cfg.steps);
    var t = new Array(steps);
    var x = new Array(steps);
    var v = new Array(steps);
    var dtOut = Math.max(1e-6, Number(cfg.dt) || 0.02);
    var maxInternalDt = Math.min(0.01, dtOut);
    var subSteps = Math.max(1, Math.ceil(dtOut / maxInternalDt));
    var h = dtOut / subSteps;

    for (var i = 0; i < steps; i += 1) {
      t[i] = i * dtOut;
      x[i] = s[0];
      v[i] = s[1];
      for (var sub = 0; sub < subSteps; sub += 1) {
        var prev = [s[0], s[1]];
        var next = rk4Step(s, h, {
          m: cfg.m, c: cfg.c, k: cfg.k, g: cfg.g,
          scenario: scenario || "spring",
          restitution: restitution != null ? restitution : 0.8,
          groundModel: groundModel || "rigid",
          groundK: groundK != null ? groundK : 2500,
          groundC: groundC != null ? groundC : 90,
        });
        s = next;

        if ((scenario || "spring") === "bouncing") {
          var gm = groundModel || "rigid";
          if (gm === "rigid" && prev[0] > 0 && next[0] < 0) {
            var alpha = clamp(prev[0] / Math.max(1e-9, prev[0] - next[0]), 0, 1);
            var vImpact = prev[1] + alpha * (next[1] - prev[1]);
            var e = Math.max(0, Math.min(1, restitution != null ? restitution : 0.8));
            var vAfter = Math.abs(vImpact) * e;
            var rem = (1 - alpha) * h;
            s = [0, vAfter];
            if (rem > 1e-9 && vAfter > 0) {
              s = rk4Step(s, rem, {
                m: cfg.m, c: cfg.c, k: cfg.k, g: cfg.g,
                scenario: scenario || "spring",
                restitution: restitution != null ? restitution : 0.8,
                groundModel: gm,
                groundK: groundK != null ? groundK : 2500,
                groundC: groundC != null ? groundC : 90,
              });
            }
            if (s[0] < 0) s[0] = 0;
            if (Math.abs(s[1]) < 0.03) s[1] = 0;
          } else if (gm === "rigid" && s[0] <= 0 && s[1] < 0) {
            var er = Math.max(0, Math.min(1, restitution != null ? restitution : 0.8));
            s[0] = 0;
            s[1] = Math.max(0, -s[1] * er);
            if (s[1] < 0.02) s[1] = 0;
          } else if (gm === "compliant" && s[0] < 1e-4 && Math.abs(s[1]) < 0.08) {
            s[0] = 0;
            s[1] = 0;
          } else if (gm === "compliant" && s[0] < -1e-2) {
            s[0] = -1e-2;
          }
        }
      }
    }
    return { t: t, x: x, v: v };
  }

  function createRng(seed) {
    var x = (seed >>> 0) || 42;
    return function () {
      x = (1664525 * x + 1013904223) >>> 0;
      return x / 4294967296;
    };
  }

  function randInRange(range, rng) {
    var r = rng ? rng() : Math.random();
    return range[0] + r * (range[1] - range[0]);
  }

  function normalizeSplitConfig(cfg) {
    var mode = String((cfg && cfg.mode) || "stratified_scenario");
    var train = Number(cfg && cfg.train);
    var val = Number(cfg && cfg.val);
    var test = Number(cfg && cfg.test);
    if (!Number.isFinite(train)) train = 0.70;
    if (!Number.isFinite(val)) val = 0.15;
    if (!Number.isFinite(test)) test = 0.15;
    train = clamp(train, 0.01, 0.98);
    val = clamp(val, 0.01, 0.98);
    test = clamp(test, 0.01, 0.98);
    var s = train + val + test;
    if (s <= 1e-9) return { mode: mode, train: 0.70, val: 0.15, test: 0.15 };
    return { mode: mode, train: train / s, val: val / s, test: test / s };
  }

  function buildTrajectorySplitMap(trajectories, splitCfg, seed) {
    var cfg = normalizeSplitConfig(splitCfg);
    var n = Array.isArray(trajectories) ? trajectories.length : 0;
    var bucketOf = new Array(n);
    if (!n) return bucketOf;

    var groups = {};
    for (var i = 0; i < n; i += 1) {
      var tr = trajectories[i] || {};
      var sc = String((tr.params && tr.params.scenario) || "spring");
      var gk = cfg.mode === "stratified_scenario" ? sc : "all";
      if (!groups[gk]) groups[gk] = [];
      groups[gk].push(i);
    }

    Object.keys(groups).forEach(function (gk, gIdx) {
      var idxs = groups[gk].slice();
      var r = createRng((Number(seed) || 42) + (gIdx + 1) * 1009);
      for (var ii = idxs.length - 1; ii > 0; ii -= 1) {
        var j = Math.floor(r() * (ii + 1));
        var t = idxs[ii];
        idxs[ii] = idxs[j];
        idxs[j] = t;
      }
      var m = idxs.length;
      var nTrain = Math.floor(m * cfg.train);
      var nVal = Math.floor(m * cfg.val);
      var nTest = m - nTrain - nVal;
      if (m >= 3) {
        if (nTrain < 1) { nTrain = 1; nTest = Math.max(0, m - nTrain - nVal); }
        if (nVal < 1) { nVal = 1; nTest = Math.max(0, m - nTrain - nVal); }
        if (nTest < 1) {
          nTest = 1;
          if (nTrain > nVal && nTrain > 1) nTrain -= 1;
          else if (nVal > 1) nVal -= 1;
          else if (nTrain > 1) nTrain -= 1;
        }
      }
      for (var k = 0; k < m; k += 1) {
        var ti = idxs[k];
        if (k < nTrain) bucketOf[ti] = "train";
        else if (k < nTrain + nVal) bucketOf[ti] = "val";
        else bucketOf[ti] = "test";
      }
    });
    return bucketOf;
  }

  function generateDataset(cfg) {
    var normalizedCfg = cfg && typeof cfg === "object" ? cfg : {};
    var trainFlat = [];
    var trainSeq = [];
    var trainY = [];
    var valFlat = [];
    var valSeq = [];
    var valY = [];
    var testFlat = [];
    var testSeq = [];
    var testY = [];
    var trajectories = [];
    var rng = createRng(normalizedCfg.seed);
    var mode = String(normalizedCfg.predictionMode || "autoregressive");
    var featureCfg = ensureFeatureConfig(normalizedCfg.featureConfig || { useX: true, useParams: true });
    var featureSpec = normalizeFeatureSpec(normalizedCfg.featureSpec || {
      useX: featureCfg.useX,
      useV: featureCfg.useV,
      useParams: featureCfg.useParams,
      useTimeSec: false,
      useTimeNorm: true,
      useScenario: false,
      useSinNorm: false,
      useCosNorm: false,
    }, mode);
    var targetMode = String(normalizedCfg.targetMode || "x");
    var targetSize = targetMode === "xv" ? 2 : 1;
    var featSizes = inferFeatureSizes(normalizedCfg.windowSize, featureCfg, featureSpec);
    var included = (normalizedCfg.includedScenarios && normalizedCfg.includedScenarios.length)
      ? normalizedCfg.includedScenarios.slice()
      : [normalizedCfg.scenarioType];
    var arFeatureCfg = ensureFeatureConfig(Object.assign({}, featureCfg, { useScenario: Boolean(featureSpec.useScenario) }));
    var sampleParams = function () {
      var s = included[Math.floor(rng() * included.length)];
      var lim = PRESET_LIMITS[s][String(normalizedCfg.paramPreset || "safe")] || PRESET_LIMITS[s].safe;
      var scenarioCfg = normalizedCfg.scenarioRanges && normalizedCfg.scenarioRanges[s] ? normalizedCfg.scenarioRanges[s] : null;
      var mRange = scenarioCfg && scenarioCfg.mRange ? scenarioCfg.mRange : (s === normalizedCfg.scenarioType ? normalizedCfg.mRange : lim.m);
      var cRange = scenarioCfg && scenarioCfg.cRange ? scenarioCfg.cRange : (s === normalizedCfg.scenarioType ? normalizedCfg.cRange : lim.c);
      var kRange = scenarioCfg && scenarioCfg.kRange ? scenarioCfg.kRange : (s === normalizedCfg.scenarioType ? normalizedCfg.kRange : lim.k);
      var eRange = scenarioCfg && scenarioCfg.restitutionRange ? scenarioCfg.restitutionRange : (s === normalizedCfg.scenarioType ? normalizedCfg.restitutionRange : lim.e);
      var x0Range = scenarioCfg && scenarioCfg.x0Range ? scenarioCfg.x0Range : (s === normalizedCfg.scenarioType ? normalizedCfg.x0Range : lim.x0);
      var v0Range = scenarioCfg && scenarioCfg.v0Range ? scenarioCfg.v0Range : (s === normalizedCfg.scenarioType ? normalizedCfg.v0Range : lim.v0);
      var groundModel = scenarioCfg && scenarioCfg.groundModel ? scenarioCfg.groundModel : normalizedCfg.groundModel;
      var groundK = scenarioCfg && Number.isFinite(Number(scenarioCfg.groundK)) ? Number(scenarioCfg.groundK) : normalizedCfg.groundK;
      var groundC = scenarioCfg && Number.isFinite(Number(scenarioCfg.groundC)) ? Number(scenarioCfg.groundC) : normalizedCfg.groundC;
      var gGlobal = Number.isFinite(Number(normalizedCfg.globalG)) ? Number(normalizedCfg.globalG) : 9.81;
      return {
        scenario: s,
        m: randInRange(mRange, rng),
        c: randInRange(cRange, rng),
        k: s === "bouncing" ? gGlobal : randInRange(kRange, rng),
        g: gGlobal,
        restitution: randInRange(eRange, rng),
        x0: randInRange(x0Range, rng),
        v0: randInRange(v0Range, rng),
        groundModel: groundModel,
        groundK: groundK,
        groundC: groundC,
        dt: normalizedCfg.dt,
        steps: normalizedCfg.steps,
      };
    };

    if (Array.isArray(normalizedCfg.sourceTrajectories) && normalizedCfg.sourceTrajectories.length) {
      normalizedCfg.sourceTrajectories.forEach(function (tr) {
        trajectories.push({
          t: (tr.t || []).slice(),
          x: (tr.x || []).slice(),
          v: (tr.v || []).slice(),
          params: Object.assign({}, tr.params || {}),
        });
      });
    } else {
      for (var n = 0; n < normalizedCfg.numTraj; n += 1) {
        var params = sampleParams();
        var sim = simulateOscillator(params);
        trajectories.push({
          t: sim.t.slice(),
          x: sim.x.slice(),
          v: sim.v.slice(),
          params: {
            m: params.m,
            c: params.c,
            k: params.k,
            g: params.g,
            restitution: params.restitution,
            x0: params.x0,
            v0: params.v0,
            scenario: params.scenario,
            groundModel: params.groundModel,
            groundK: params.groundK,
            groundC: params.groundC,
          },
        });
      }
    }

    var splitCfg = normalizeSplitConfig(normalizedCfg.splitConfig || { mode: "stratified_scenario", train: 0.70, val: 0.15, test: 0.15 });
    var splitMap = buildTrajectorySplitMap(trajectories, splitCfg, normalizedCfg.seed);
    trajectories.forEach(function (tr, n) {
      var sim = { t: tr.t, x: tr.x, v: tr.v };
      var p = tr.params || {};
      var params = {
        m: Number(p.m),
        c: Number(p.c),
        k: Number(p.k),
        g: Number(p.g),
        restitution: Number(p.restitution),
        x0: Number(p.x0),
        v0: Number(p.v0),
        scenario: String(p.scenario || normalizedCfg.scenarioType || "spring"),
        groundModel: String(p.groundModel || "rigid"),
        groundK: Number(p.groundK),
        groundC: Number(p.groundC),
        dt: normalizedCfg.dt,
        steps: normalizedCfg.steps,
      };

      var bucketName = splitMap[n] || "train";
      var flatBucket;
      var seqBucket;
      var yBucket;
      if (bucketName === "train") {
        flatBucket = trainFlat;
        seqBucket = trainSeq;
        yBucket = trainY;
      } else if (bucketName === "val") {
        flatBucket = valFlat;
        seqBucket = valSeq;
        yBucket = valY;
      } else {
        flatBucket = testFlat;
        seqBucket = testSeq;
        yBucket = testY;
      }

      if (mode === "direct") {
        for (var i = 0; i < sim.x.length; i += 1) {
          flatBucket.push(buildDirectFeatures(sim.t[i], params, normalizedCfg.durationSec, featureSpec));
          if (targetMode === "xv") yBucket.push([sim.x[i], sim.v[i]]);
          else if (targetMode === "v") yBucket.push([sim.v[i]]);
          else yBucket.push([sim.x[i]]);
        }
      } else {
        for (var j = normalizedCfg.windowSize; j < sim.x.length; j += 1) {
          var histX = sim.x.slice(j - normalizedCfg.windowSize, j);
          var histV = sim.v.slice(j - normalizedCfg.windowSize, j);
          flatBucket.push(buildInputFeatures(histX, histV, params, arFeatureCfg, false, featureSpec));
          seqBucket.push(buildInputFeatures(histX, histV, params, arFeatureCfg, true, featureSpec));
          if (targetMode === "xv") yBucket.push([sim.x[j], sim.v[j]]);
          else if (targetMode === "v") yBucket.push([sim.v[j]]);
          else yBucket.push([sim.x[j]]);
        }
      }
    });

    var includedOut = (normalizedCfg.includedScenarios && normalizedCfg.includedScenarios.length)
      ? normalizedCfg.includedScenarios.slice()
      : Array.from(new Set(trajectories.map(function (tr) {
        return String((tr.params && tr.params.scenario) || normalizedCfg.scenarioType || "spring");
      })));

    return {
      xTrain: trainFlat,
      xVal: valFlat,
      xTest: testFlat,
      seqTrain: trainSeq,
      seqVal: valSeq,
      seqTest: testSeq,
      yTrain: trainY,
      yVal: valY,
      yTest: testY,
      featureSize: mode === "direct" ? inferDirectFeatureSize(featureSpec) : featSizes.flatFeatureSize,
      seqFeatureSize: mode === "direct" ? inferDirectFeatureSize(featureSpec) : featSizes.seqFeatureSize,
      windowSize: normalizedCfg.windowSize,
      dt: normalizedCfg.dt,
      durationSec: normalizedCfg.durationSec,
      steps: normalizedCfg.steps,
      mode: mode,
      schemaId: normalizedCfg.schemaId || "oscillator",
      scenarioType: includedOut.length > 1 ? "mixed" : includedOut[0],
      includedScenarios: includedOut,
      seed: normalizedCfg.seed,
      featureConfig: featureCfg,
      featureSpec: featureSpec,
      targetMode: targetMode,
      targetSize: targetSize,
      splitConfig: splitCfg,
      previewParams: null,
      trajectories: trajectories,
      trainCount: trainY.length,
      valCount: valY.length,
      testCount: testY.length,
    };
  }

  function buildDatasetBundle(cfg) {
    var normalizedCfg = cfg && typeof cfg === "object" ? cfg : {};
    var variants = normalizedCfg.variants && typeof normalizedCfg.variants === "object" ? normalizedCfg.variants : {};
    var arCfg = variants.autoregressive && typeof variants.autoregressive === "object"
      ? variants.autoregressive
      : Object.assign({}, normalizedCfg, { predictionMode: "autoregressive" });
    var directCfg = variants.direct && typeof variants.direct === "object"
      ? variants.direct
      : Object.assign({}, normalizedCfg, { predictionMode: "direct" });
    var dsAr = generateDataset(arCfg);
    var dsDirect = generateDataset(Object.assign({}, directCfg, { sourceTrajectories: dsAr.trajectories }));
    var activeVariantId = String(normalizedCfg.activeVariantId || normalizedCfg.requestedVariantId || "autoregressive");
    return {
      kind: "dataset_bundle",
      activeVariantId: activeVariantId,
      datasets: {
        autoregressive: dsAr,
        direct: dsDirect,
      },
    };
  }

  var PRESET_LIMITS = {
    spring: {
      safe: { m: [0.5, 2.0], c: [0.05, 0.8], k: [1.0, 8.0], x0: [-1.5, 1.5], v0: [-1.0, 1.0], e: [0.6, 0.9] },
      wide: { m: [0.2, 4.0], c: [0.0, 2.5], k: [0.5, 15.0], x0: [-3.0, 3.0], v0: [-3.0, 3.0], e: [0.4, 0.95] },
      stress: { m: [0.1, 8.0], c: [0.0, 4.0], k: [0.2, 25.0], x0: [-5.0, 5.0], v0: [-6.0, 6.0], e: [0.2, 0.98] },
    },
    pendulum: {
      safe: { m: [0.5, 2.0], c: [0.01, 0.5], k: [0.5, 2.0], x0: [-1.2, 1.2], v0: [-1.0, 1.0], e: [0.6, 0.9] },
      wide: { m: [0.2, 4.0], c: [0.0, 1.5], k: [0.2, 4.0], x0: [-2.5, 2.5], v0: [-3.0, 3.0], e: [0.4, 0.95] },
      stress: { m: [0.1, 8.0], c: [0.0, 3.0], k: [0.1, 8.0], x0: [-3.1, 3.1], v0: [-6.0, 6.0], e: [0.2, 0.98] },
    },
    bouncing: {
      safe: { m: [0.3, 3.0], c: [0.0, 0.25], k: [9.81, 9.81], x0: [0.0, 0.0], v0: [0.8, 6.0], e: [0.55, 0.9] },
      wide: { m: [0.2, 6.0], c: [0.0, 0.8], k: [9.81, 9.81], x0: [0.0, 0.0], v0: [0.2, 12.0], e: [0.4, 0.95] },
      stress: { m: [0.1, 10.0], c: [0.0, 1.5], k: [9.81, 9.81], x0: [0.0, 0.0], v0: [0.1, 20.0], e: [0.2, 0.98] },
    },
  };

  return {
    PRESET_LIMITS: PRESET_LIMITS,
    defaultParamMask: defaultParamMask,
    normalizeParamMask: normalizeParamMask,
    ensureFeatureConfig: ensureFeatureConfig,
    normalizeFeatureSpec: normalizeFeatureSpec,
    countStaticParams: countStaticParams,
    buildStaticParams: buildStaticParams,
    inferFeatureSizes: inferFeatureSizes,
    buildInputFeatures: buildInputFeatures,
    buildDirectFeatures: buildDirectFeatures,
    inferDirectFeatureSize: inferDirectFeatureSize,
    rk4Step: rk4Step,
    simulateOscillator: simulateOscillator,
    createRng: createRng,
    randInRange: randInRange,
    normalizeSplitConfig: normalizeSplitConfig,
    buildTrajectorySplitMap: buildTrajectorySplitMap,
    generateDataset: generateDataset,
    buildDatasetBundle: buildDatasetBundle,
  };
});

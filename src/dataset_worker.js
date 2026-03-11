(function () {
  "use strict";

  if (typeof importScripts === "function") {
    try {
      importScripts(
        "dataset_service_core.js",
        "schema_registry.js",
        "dataset_modules.js",
        "dataset_processing_core.js",
        "dataset_runtime.js",
        "dataset_modules/mnist_source_loader.js",
        "dataset_modules/mnist_module.js",
        "dataset_modules/fashion_mnist_module.js",
        "oscillator_dataset_core.js",
        "dataset_modules/oscillator_module.js"
      );
    } catch (_err) {}
  }

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
    const d = defaultParamMask();
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
    const out = {
      useX: Boolean(cfg && cfg.useX),
      useV: Boolean(cfg && cfg.useV),
      useParams: Boolean(cfg && cfg.useParams),
      useScenario: Boolean(cfg && cfg.useScenario),
    };
    if (out.useX || out.useV || out.useParams || out.useScenario) return out;
    return { useX: true, useV: false, useParams: true, useScenario: false };
  }

  function normalizeFeatureSpec(spec, mode) {
    const m = String(mode || "autoregressive");
    const s = Object.assign({}, spec || {});
    const useTimeNorm = s.useTimeNorm !== undefined ? Boolean(s.useTimeNorm) : Boolean(s.useTime);
    const useSinNorm = s.useSinNorm !== undefined ? Boolean(s.useSinNorm) : Boolean(s.useTrig);
    const useCosNorm = s.useCosNorm !== undefined ? Boolean(s.useCosNorm) : Boolean(s.useTrig);
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
    const pm = normalizeParamMask(paramMask);
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
    const pm = normalizeParamMask(paramMask);
    const gm = String(condition.groundModel || "rigid") === "compliant" ? 1 : 0;
    const mSafe = Math.max(1e-9, Number(condition.m || 1));
    const cVal = Number(condition.c || 0);
    const kVal = Number(condition.k || 0);
    const gVal = Number(condition.g || 9.81);
    const lSafe = Math.max(1e-9, Number(condition.k || 1));
    const out = [];
    if (pm.m) out.push(Number(condition.m));
    if (pm.c) out.push(Number(condition.c));
    if (pm.k) out.push(Number(condition.k));
    if (pm.e) out.push(Number(condition.restitution ?? 0.8));
    if (pm.x0) out.push(Number(condition.x0 ?? 0));
    if (pm.v0) out.push(Number(condition.v0 ?? 0));
    if (pm.gm) out.push(gm);
    if (pm.gk) out.push(Number(condition.groundK ?? 2500));
    if (pm.gc) out.push(Number(condition.groundC ?? 90));
    if (pm.rkm) out.push(kVal / mSafe);
    if (pm.rcm) out.push(cVal / mSafe);
    if (pm.rgl) out.push(gVal / lSafe);
    return out;
  }

  function inferFeatureSizes(windowSize, featureCfg, featureSpec) {
    const cfg = ensureFeatureConfig(featureCfg);
    const nParams = countStaticParams(featureSpec && featureSpec.paramMask);
    let seqFeatureSize = 0;
    if (cfg.useX) seqFeatureSize += 1;
    if (cfg.useV) seqFeatureSize += 1;
    if (cfg.useParams) seqFeatureSize += nParams;
    if (cfg.useScenario) seqFeatureSize += 3;
    const flatFeatureSize =
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
    const tau = clamp(Number(tNorm) || 0, 0, 1);
    const betaMin = 1e-4;
    const betaMax = 2e-2;
    const betaT = betaMin + (betaMax - betaMin) * tau;
    const alphaBar = Math.exp(-(betaMin * tau + 0.5 * (betaMax - betaMin) * tau * tau));
    const sigmaT = Math.sqrt(Math.max(1e-9, 1 - alphaBar));
    return [betaT, alphaBar, sigmaT];
  }

  function buildInputFeatures(historyX, historyV, condition, featureCfg, asSequence, featureSpec) {
    const cfg = ensureFeatureConfig(featureCfg);
    const staticParams = buildStaticParams(condition, featureSpec && featureSpec.paramMask);
    const scenarioVec = (function () {
      const s = String(condition.scenario || "spring");
      return [s === "spring" ? 1 : 0, s === "pendulum" ? 1 : 0, s === "bouncing" ? 1 : 0];
    })();
    if (!asSequence) {
      const out = [];
      if (cfg.useX) out.push.apply(out, historyX);
      if (cfg.useV) out.push.apply(out, historyV);
      if (cfg.useParams) out.push.apply(out, staticParams);
      if (cfg.useScenario) out.push.apply(out, scenarioVec);
      return out;
    }
    const seq = [];
    for (let i = 0; i < historyX.length; i += 1) {
      const row = [];
      if (cfg.useX) row.push(historyX[i]);
      if (cfg.useV) row.push(historyV[i]);
      if (cfg.useParams) row.push.apply(row, staticParams);
      if (cfg.useScenario) row.push.apply(row, scenarioVec);
      seq.push(row);
    }
    return seq;
  }

  function buildDirectFeatures(t, condition, durationSec, featureSpec) {
    const spec = normalizeFeatureSpec(featureSpec || { useParams: true, useTimeNorm: true, useScenario: false, useSinNorm: false, useCosNorm: false }, "direct");
    const T = Math.max(1e-6, Number(durationSec) || 1);
    const tNorm = Number(t) / T;
    const out = [];
    if (spec.useTimeSec) out.push(Number(t));
    if (spec.useTimeNorm) out.push(tNorm);
    if (spec.useSinNorm || spec.useCosNorm) {
      const ang = 2 * Math.PI * tNorm;
      if (spec.useSinNorm) out.push(Math.sin(ang));
      if (spec.useCosNorm) out.push(Math.cos(ang));
    }
    if (spec.useNoiseSchedule) {
      out.push.apply(out, noiseScheduleFeatures(tNorm));
    }
    if (spec.useScenario) {
      const s = String(condition.scenario || "spring");
      out.push(s === "spring" ? 1 : 0, s === "pendulum" ? 1 : 0, s === "bouncing" ? 1 : 0);
    }
    if (spec.useParams) out.push.apply(out, buildStaticParams(condition, spec.paramMask));
    return out.length ? out : [tNorm];
  }

  function inferDirectFeatureSize(featureSpec) {
    const spec = normalizeFeatureSpec(featureSpec || { useParams: true, useTimeNorm: true }, "direct");
    let n = 0;
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
    const { m, c, k, g, scenario, groundModel, groundK, groundC } = params;
    const mSafe = Math.max(1e-6, Number(m) || 1);
    const cSafe = Math.max(0, Number(c) || 0);
    const deriv = ([x, v]) => {
      let a;
      if (scenario === "bouncing") {
        const gravRaw = Number(g);
        const grav = Number.isFinite(gravRaw) && gravRaw > 0 ? gravRaw : 9.81;
        const invM = 1 / mSafe;
        a = -grav - (cSafe * invM) * v - (cSafe * invM) * Math.abs(v) * v;
        if (groundModel === "compliant") {
          const delta = Math.max(0, -x);
          const deltaDot = delta > 0 ? Math.max(0, -v) : 0;
          const fc = Math.max(0, Number(groundK) * delta + Number(groundC) * deltaDot);
          a += fc * invM;
        }
      } else if (scenario === "pendulum") {
        const L = Math.max(Number(k) || 0, 1e-6);
        const gravRaw = Number(g);
        const grav = Number.isFinite(gravRaw) && gravRaw > 0 ? gravRaw : 9.81;
        a = -(cSafe / mSafe) * v - (grav / L) * Math.sin(x);
      } else {
        const kSafe = Number(k) || 0;
        a = -(cSafe / mSafe) * v - (kSafe / mSafe) * x;
      }
      return [v, a];
    };

    const [k1x, k1v] = deriv(state);
    const [k2x, k2v] = deriv([state[0] + 0.5 * dt * k1x, state[1] + 0.5 * dt * k1v]);
    const [k3x, k3v] = deriv([state[0] + 0.5 * dt * k2x, state[1] + 0.5 * dt * k2v]);
    const [k4x, k4v] = deriv([state[0] + dt * k3x, state[1] + dt * k3v]);

    return [
      state[0] + (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x),
      state[1] + (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v),
    ];
  }

  function simulateOscillator({ m, c, k, g, x0, v0, dt, steps, scenario, restitution, groundModel, groundK, groundC }) {
    let s;
    if (scenario === "bouncing") {
      s = [Math.max(0, Number(x0) || 0), Number(v0) || 0];
    } else {
      s = [x0, v0];
    }
    const t = new Array(steps);
    const x = new Array(steps);
    const v = new Array(steps);
    const dtOut = Math.max(1e-6, Number(dt) || 0.02);
    const maxInternalDt = Math.min(0.01, dtOut);
    const subSteps = Math.max(1, Math.ceil(dtOut / maxInternalDt));
    const h = dtOut / subSteps;

    for (let i = 0; i < steps; i += 1) {
      t[i] = i * dt;
      x[i] = s[0];
      v[i] = s[1];
      for (let sub = 0; sub < subSteps; sub += 1) {
        const prev = [s[0], s[1]];
        const next = rk4Step(s, h, {
          m,
          c,
          k,
          g,
          scenario: scenario || "spring",
          restitution: restitution ?? 0.8,
          groundModel: groundModel || "rigid",
          groundK: groundK ?? 2500,
          groundC: groundC ?? 90,
        });
        s = next;

        if ((scenario || "spring") === "bouncing") {
          const gm = groundModel || "rigid";
          if (gm === "rigid" && prev[0] > 0 && next[0] < 0) {
            const alpha = clamp(prev[0] / Math.max(1e-9, prev[0] - next[0]), 0, 1);
            const vImpact = prev[1] + alpha * (next[1] - prev[1]);
            const e = Math.max(0, Math.min(1, restitution ?? 0.8));
            const vAfter = Math.abs(vImpact) * e;
            const rem = (1 - alpha) * h;
            s = [0, vAfter];
            if (rem > 1e-9 && vAfter > 0) {
              s = rk4Step(s, rem, {
                m,
                c,
                k,
                g,
                scenario: scenario || "spring",
                restitution: restitution ?? 0.8,
                groundModel: gm,
                groundK: groundK ?? 2500,
                groundC: groundC ?? 90,
              });
            }
            if (s[0] < 0) s[0] = 0;
            if (Math.abs(s[1]) < 0.03) s[1] = 0;
          } else if (gm === "rigid" && s[0] <= 0 && s[1] < 0) {
            const e = Math.max(0, Math.min(1, restitution ?? 0.8));
            s[0] = 0;
            s[1] = Math.max(0, -s[1] * e);
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
    return { t, x, v };
  }

  function createRng(seed) {
    let x = (seed >>> 0) || 42;
    return function () {
      x = (1664525 * x + 1013904223) >>> 0;
      return x / 4294967296;
    };
  }

  function randInRange(range, rng) {
    const r = rng ? rng() : Math.random();
    return range[0] + r * (range[1] - range[0]);
  }

  function normalizeSplitConfig(cfg) {
    const mode = String((cfg && cfg.mode) || "stratified_scenario");
    let train = Number(cfg && cfg.train);
    let val = Number(cfg && cfg.val);
    let test = Number(cfg && cfg.test);
    if (!Number.isFinite(train)) train = 0.70;
    if (!Number.isFinite(val)) val = 0.15;
    if (!Number.isFinite(test)) test = 0.15;
    train = clamp(train, 0.01, 0.98);
    val = clamp(val, 0.01, 0.98);
    test = clamp(test, 0.01, 0.98);
    const s = train + val + test;
    if (s <= 1e-9) return { mode: mode, train: 0.70, val: 0.15, test: 0.15 };
    return { mode: mode, train: train / s, val: val / s, test: test / s };
  }

  function buildTrajectorySplitMap(trajectories, splitCfg, seed) {
    const cfg = normalizeSplitConfig(splitCfg);
    const n = Array.isArray(trajectories) ? trajectories.length : 0;
    const bucketOf = new Array(n);
    if (!n) return bucketOf;

    const groups = {};
    for (let i = 0; i < n; i += 1) {
      const tr = trajectories[i] || {};
      const sc = String((tr.params && tr.params.scenario) || "spring");
      const gk = cfg.mode === "stratified_scenario" ? sc : "all";
      if (!groups[gk]) groups[gk] = [];
      groups[gk].push(i);
    }

    Object.keys(groups).forEach(function (gk, gIdx) {
      const idxs = groups[gk].slice();
      const r = createRng((Number(seed) || 42) + (gIdx + 1) * 1009);
      for (let i = idxs.length - 1; i > 0; i -= 1) {
        const j = Math.floor(r() * (i + 1));
        const t = idxs[i];
        idxs[i] = idxs[j];
        idxs[j] = t;
      }
      const m = idxs.length;
      let nTrain = Math.floor(m * cfg.train);
      let nVal = Math.floor(m * cfg.val);
      let nTest = m - nTrain - nVal;
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
      for (let i = 0; i < m; i += 1) {
        const ti = idxs[i];
        if (i < nTrain) bucketOf[ti] = "train";
        else if (i < nTrain + nVal) bucketOf[ti] = "val";
        else bucketOf[ti] = "test";
      }
    });
    return bucketOf;
  }

  function generateDataset(cfg) {
    const normalizedCfg = cfg && typeof cfg === "object" ? cfg : {};
    const trainFlat = [];
    const trainSeq = [];
    const trainY = [];
    const valFlat = [];
    const valSeq = [];
    const valY = [];
    const testFlat = [];
    const testSeq = [];
    const testY = [];
    const trajectories = [];
    const rng = createRng(normalizedCfg.seed);
    const mode = String(normalizedCfg.predictionMode || "autoregressive");
    const featureCfg = ensureFeatureConfig(normalizedCfg.featureConfig || { useX: true, useParams: true });
    const featureSpec = normalizeFeatureSpec(normalizedCfg.featureSpec || {
      useX: featureCfg.useX,
      useV: featureCfg.useV,
      useParams: featureCfg.useParams,
      useTimeSec: false,
      useTimeNorm: true,
      useScenario: false,
      useSinNorm: false,
      useCosNorm: false,
    }, mode);
    const targetMode = String(normalizedCfg.targetMode || "x");
    const featSizes = inferFeatureSizes(normalizedCfg.windowSize, featureCfg, featureSpec);
    const included = (normalizedCfg.includedScenarios && normalizedCfg.includedScenarios.length)
      ? normalizedCfg.includedScenarios.slice()
      : [normalizedCfg.scenarioType];
    const arFeatureCfg = ensureFeatureConfig(Object.assign({}, featureCfg, { useScenario: Boolean(featureSpec.useScenario) }));
    const sampleParams = function () {
      const s = included[Math.floor(rng() * included.length)];
      const lim = PRESET_LIMITS[s][String(normalizedCfg.paramPreset || "safe")] || PRESET_LIMITS[s].safe;
      const scenarioCfg = normalizedCfg.scenarioRanges && normalizedCfg.scenarioRanges[s] ? normalizedCfg.scenarioRanges[s] : null;
      const mRange = scenarioCfg && scenarioCfg.mRange ? scenarioCfg.mRange : (s === normalizedCfg.scenarioType ? normalizedCfg.mRange : lim.m);
      const cRange = scenarioCfg && scenarioCfg.cRange ? scenarioCfg.cRange : (s === normalizedCfg.scenarioType ? normalizedCfg.cRange : lim.c);
      const kRange = scenarioCfg && scenarioCfg.kRange ? scenarioCfg.kRange : (s === normalizedCfg.scenarioType ? normalizedCfg.kRange : lim.k);
      const eRange = scenarioCfg && scenarioCfg.restitutionRange ? scenarioCfg.restitutionRange : (s === normalizedCfg.scenarioType ? normalizedCfg.restitutionRange : lim.e);
      const x0Range = scenarioCfg && scenarioCfg.x0Range ? scenarioCfg.x0Range : (s === normalizedCfg.scenarioType ? normalizedCfg.x0Range : lim.x0);
      const v0Range = scenarioCfg && scenarioCfg.v0Range ? scenarioCfg.v0Range : (s === normalizedCfg.scenarioType ? normalizedCfg.v0Range : lim.v0);
      const groundModel = scenarioCfg && scenarioCfg.groundModel ? scenarioCfg.groundModel : normalizedCfg.groundModel;
      const groundK = scenarioCfg && Number.isFinite(Number(scenarioCfg.groundK)) ? Number(scenarioCfg.groundK) : normalizedCfg.groundK;
      const groundC = scenarioCfg && Number.isFinite(Number(scenarioCfg.groundC)) ? Number(scenarioCfg.groundC) : normalizedCfg.groundC;
      const gGlobal = Number.isFinite(Number(normalizedCfg.globalG)) ? Number(normalizedCfg.globalG) : 9.81;
      return {
        scenario: s,
        m: randInRange(mRange, rng),
        c: randInRange(cRange, rng),
        k: s === "bouncing" ? gGlobal : randInRange(kRange, rng),
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
      for (let n = 0; n < normalizedCfg.numTraj; n += 1) {
        const params = sampleParams();
        const sim = simulateOscillator(params);
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

    const splitCfg = normalizeSplitConfig(normalizedCfg.splitConfig || { mode: "stratified_scenario", train: 0.70, val: 0.15, test: 0.15 });
    const splitMap = buildTrajectorySplitMap(trajectories, splitCfg, normalizedCfg.seed);
    trajectories.forEach(function (tr, n) {
      const sim = { t: tr.t, x: tr.x, v: tr.v };
      const p = tr.params || {};
      const params = {
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
      const bucketName = splitMap[n] || "train";
      let flatBucket;
      let seqBucket;
      let yBucket;
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
        for (let i = 0; i < sim.x.length; i += 1) {
          flatBucket.push(buildDirectFeatures(sim.t[i], params, normalizedCfg.durationSec, featureSpec));
          if (targetMode === "xv") yBucket.push([sim.x[i], sim.v[i]]);
          else if (targetMode === "v") yBucket.push([sim.v[i]]);
          else yBucket.push([sim.x[i]]);
        }
      } else {
        for (let i = normalizedCfg.windowSize; i < sim.x.length; i += 1) {
          const histX = sim.x.slice(i - normalizedCfg.windowSize, i);
          const histV = sim.v.slice(i - normalizedCfg.windowSize, i);
          flatBucket.push(buildInputFeatures(histX, histV, params, arFeatureCfg, false, featureSpec));
          seqBucket.push(buildInputFeatures(histX, histV, params, arFeatureCfg, true, featureSpec));
          if (targetMode === "xv") yBucket.push([sim.x[i], sim.v[i]]);
          else if (targetMode === "v") yBucket.push([sim.v[i]]);
          else yBucket.push([sim.x[i]]);
        }
      }
    });

    const includedOut = (normalizedCfg.includedScenarios && normalizedCfg.includedScenarios.length)
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
      splitConfig: splitCfg,
      previewParams: null,
      trajectories: trajectories,
    };
  }

  const PRESET_LIMITS = {
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

  function postError(runId, err) {
    return {
      kind: "error",
      runId: String(runId || ""),
      error: {
        message: String((err && err.message) || "Dataset worker failed."),
        reason: String((err && err.stack) || ""),
      },
    };
  }

  function postComplete(runId, result) {
    return {
      kind: "complete",
      runId: String(runId || ""),
      result: result || {},
    };
  }

  var DATASET_SERVICE = (function () {
    var serviceCore = typeof OSCDatasetServiceCore === "object" && OSCDatasetServiceCore && typeof OSCDatasetServiceCore.createService === "function"
      ? OSCDatasetServiceCore
      : null;
    var datasetRuntime = typeof OSCDatasetRuntime === "object" && OSCDatasetRuntime ? OSCDatasetRuntime : null;
    if (!serviceCore) {
      throw new Error("OSCDatasetServiceCore is required by dataset_worker.js.");
    }
    return serviceCore.createService({
      handlers: {
        build_module_dataset: function (payload) {
          var p = payload && typeof payload === "object" ? payload : {};
          var moduleId = String(p.moduleId || "").trim().toLowerCase();
          var cfg = p.cfg && typeof p.cfg === "object" ? p.cfg : {};
          if (!moduleId) {
            throw new Error("build_module_dataset requires payload.moduleId.");
          }
          if (!datasetRuntime || typeof datasetRuntime.buildDataset !== "function") {
            throw new Error("OSCDatasetRuntime.buildDataset() is not available in dataset worker.");
          }
          return datasetRuntime.buildDataset(moduleId, cfg);
        },
        build_oscillator_pair: function (payload) {
          var p = payload && typeof payload === "object" ? payload : {};
          var arCfg = p.arCfg && typeof p.arCfg === "object" ? p.arCfg : {};
          var directCfg = p.directCfg && typeof p.directCfg === "object" ? p.directCfg : {};
          var dsAr = generateDataset(arCfg);
          var dsDirect = generateDataset(Object.assign({}, directCfg, { sourceTrajectories: dsAr.trajectories }));
          return { ar: dsAr, direct: dsDirect };
        },
      },
    });
  })();

  self.onmessage = function (evt) {
    const msg = evt && evt.data ? evt.data : {};
    const kind = String(msg.kind || "");
    if (kind !== "run") return;
    const runId = String(msg.runId || "");
    Promise.resolve(DATASET_SERVICE.execute({
      action: String(msg.action || ""),
      payload: msg.payload || {},
      context: {},
    })).then(function (result) {
      self.postMessage(postComplete(runId, result));
    }).catch(function (err) {
      self.postMessage(postError(runId, err));
    });
  };
})();

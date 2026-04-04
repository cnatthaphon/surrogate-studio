(function () {
  "use strict";

  const TFJS_VERSION = "4.22.0";
  const TFJS_CDN_BASE = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@" + TFJS_VERSION + "/dist/";
  const TFJS_WASM_BACKEND_CDN = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@" + TFJS_VERSION + "/dist/";
  const TFJS_WEBGL_BACKEND_CDN = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@" + TFJS_VERSION + "/dist/";
  const TFJS_WEBGPU_BACKEND_CDN = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgpu@" + TFJS_VERSION + "/dist/";
  const DEFAULT_LOSS_TYPE = "meanSquaredError";

  let initialized = false;

  const clamp = function (v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  };

  function normalizeFeatureSpec(spec, mode) {
    const m = String(mode || "autoregressive");
    const s = Object.assign({}, spec || {});
    return {
      useX: Boolean(s.useX),
      useV: Boolean(s.useV),
      useParams: Boolean(s.useParams),
      useTimeSec: Boolean(s.useTimeSec),
      useTimeNorm: s.useTimeNorm !== undefined ? Boolean(s.useTimeNorm) : Boolean(s.useTime),
      useScenario: Boolean(s.useScenario),
      useSinNorm: s.useSinNorm !== undefined ? Boolean(s.useSinNorm) : Boolean(s.useTrig),
      useCosNorm: s.useCosNorm !== undefined ? Boolean(s.useCosNorm) : Boolean(s.useTrig),
      useNoiseSchedule: Boolean(s.useNoiseSchedule),
      paramMask: s.paramMask || {},
    };
  }

  function countStaticParams(paramMask) {
    const pm = paramMask || {};
    return (pm.m !== false ? 1 : 0) +
      (pm.c !== false ? 1 : 0) +
      (pm.k !== false ? 1 : 0) +
      (pm.e !== false ? 1 : 0) +
      (pm.x0 !== false ? 1 : 0) +
      (pm.v0 !== false ? 1 : 0) +
      (pm.gm !== false ? 1 : 0) +
      (pm.gk !== false ? 1 : 0) +
      (pm.gc !== false ? 1 : 0) +
      (pm.rkm === true ? 1 : 0) +
      (pm.rcm === true ? 1 : 0) +
      (pm.rgl === true ? 1 : 0);
  }

  function ensureFeatureConfig(spec, mode) {
    const m = String(mode || "autoregressive");
    const cfg = normalizeFeatureSpec(spec, m);
    if (cfg.useX || cfg.useV || cfg.useParams || cfg.useScenario) return cfg;
    return { useX: true, useV: false, useParams: true, useScenario: false, useTimeSec: false, useTimeNorm: true, useSinNorm: false, useCosNorm: false, useNoiseSchedule: false, paramMask: cfg.paramMask || {} };
  }

  function normalizeLrSchedulerType(type, fallback) {
    const v = String(type || fallback || "none").toLowerCase().trim();
    if (v === "plateau" || v === "step" || v === "exponential" || v === "cosine" || v === "none") return v;
    return String(fallback || "none");
  }

  function normalizeOptimizerType(type, fallback) {
    const v = String(type || fallback || "adam").toLowerCase().trim();
    if (v === "sgd" || v === "momentum" || v === "nesterov" || v === "rmsprop" || v === "adam" || v === "adadelta" || v === "adagrad" || v === "adamax") return v;
    return String(fallback || "adam");
  }

  function numOr(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function resolveOptimizerConfig(raw) {
    const cfg = raw || {};
    return {
      type: normalizeOptimizerType(cfg.optimizerType, "adam"),
      beta1: Math.max(0, Math.min(0.999999, numOr(cfg.optimizerBeta1, 0.9))),
      beta2: Math.max(0, Math.min(0.999999, numOr(cfg.optimizerBeta2, 0.999))),
      momentum: Math.max(0, numOr(cfg.optimizerMomentum, 0)),
      rho: Math.max(0, Math.min(0.999999, numOr(cfg.optimizerRho, 0.9))),
      epsilon: Math.max(1e-8, numOr(cfg.optimizerEpsilon, 1e-7)),
    };
  }

  function resolveRestoreBestWeights(raw, headConfigs) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    if (typeof cfg.restoreBestWeights === "boolean") return cfg.restoreBestWeights;
    const weightSelection = String(cfg.weightSelection || "").trim().toLowerCase();
    if (weightSelection === "last") return false;
    if (weightSelection === "best") return true;
    if (Array.isArray(cfg.trainingSchedule) && cfg.trainingSchedule.length) return false;
    const heads = Array.isArray(headConfigs) ? headConfigs : [];
    if (heads.some(h => String((h && h.phase) || "").trim() !== "")) return false;
    return true;
  }

  function createOptimizerByType(type, lr, rawCfg) {
    const optCfg = rawCfg && rawCfg.type ? rawCfg : resolveOptimizerConfig(Object.assign({}, rawCfg || {}, { optimizerType: type }));
    const v = normalizeOptimizerType(optCfg.type || type, "adam");
    const learningRate = Math.max(1e-8, Number(lr) || 1e-3);
    if (v === "sgd") return optCfg.momentum > 0 ? tf.train.momentum(learningRate, optCfg.momentum, false) : tf.train.sgd(learningRate);
    if (v === "momentum") return tf.train.momentum(learningRate, optCfg.momentum || 0.9, false);
    if (v === "nesterov") return tf.train.momentum(learningRate, optCfg.momentum || 0.9, true);
    if (v === "rmsprop") return tf.train.rmsprop(learningRate, optCfg.rho, optCfg.momentum, optCfg.epsilon, false);
    if (v === "adadelta") return tf.train.adadelta(learningRate);
    if (v === "adagrad") return tf.train.adagrad(learningRate);
    if (v === "adamax") return tf.train.adamax(learningRate);
    return tf.train.adam(learningRate, optCfg.beta1, optCfg.beta2, optCfg.epsilon);
  }

  function mapLossAlias(lossName, fallback) {
    const v = String(lossName || fallback || "mse");
    if (v === "mse") return "meanSquaredError";
    if (v === "mae") return "meanAbsoluteError";
    if (v === "huber") return "huberLoss";
    if (v === "use_global") return "meanSquaredError";
    return fallback || "meanSquaredError";
  }

  function scalarLossByType(pred, truth, type) {
    if (type === "meanAbsoluteError") {
      return tf.mean(tf.abs(tf.sub(pred, truth)));
    }
    if (type === "huberLoss") {
      const delta = tf.scalar(1.0);
      const err = tf.sub(pred, truth);
      const a = tf.abs(err);
      const quadratic = tf.minimum(a, delta);
      const linear = tf.sub(a, quadratic);
      return tf.mean(tf.add(tf.mul(0.5, tf.square(quadratic)), tf.mul(delta, linear)));
    }
    return tf.mean(tf.square(tf.sub(pred, truth)));
  }

  function makeHeadLoss(head, targetMode, resolvedLossType) {
    const target = String((head && head.target) || "x");
    const type = mapLossAlias(head && head.loss, resolvedLossType);
    const wx = Math.max(0, Number((head && head.wx) || 1));
    const wv = Math.max(0, Number((head && head.wv) || 1));
    const headWeight = Math.max(0, Number((head && head.matchWeight) || 1));
    const klBeta = Math.max(0, Number((head && head.beta) || 1e-3));
    if (target === "latent_kl") {
      return function (_yTrue, yPred) {
        return tf.tidy(function () {
          const total = Math.max(2, Number((head && head.units) || (yPred.shape && yPred.shape[1]) || 2));
          const zDim = Math.max(1, Math.floor(total / 2));
          const mu = yPred.slice([0, 0], [-1, zDim]);
          const logvar = tf.clipByValue(yPred.slice([0, zDim], [-1, zDim]), -10, 10);
          const one = tf.onesLike(logvar);
          const klTerm = tf.sub(tf.add(one, logvar), tf.add(tf.square(mu), tf.exp(logvar)));
          const kl = tf.mul(tf.scalar(-0.5), tf.mean(tf.sum(klTerm, -1)));
          return tf.mul(tf.scalar(headWeight * klBeta), kl);
        });
      };
    }
    return function (yTrue, yPred) {
      return tf.tidy(function () {
        // generic loss on full output (works for any dimension)
        const l = scalarLossByType(yPred, yTrue, type);
        return tf.mul(tf.scalar(headWeight), l);
      });
    };
  }

  function normalizeOutputTargetsList(raw, fallbackTargets, schemaId, allowed) {
    let list = [];
    if (Array.isArray(raw)) {
      list = raw.map(function (x) { return String(x || "").trim().toLowerCase(); });
    } else if (typeof raw === "string") {
      list = raw.split(",").map(function (x) { return String(x || "").trim().toLowerCase(); });
    } else if (raw != null) {
      list = [String(raw || "").trim().toLowerCase()];
    }
    const allow = Array.isArray(allowed) && allowed.length ? allowed : ["x", "v", "xv", "traj", "params", "latent_diff", "latent_kl"];
    list = list.filter(function (x) { return x && allow.indexOf(x) >= 0; });
    if (!list.length) {
      const fb = Array.isArray(fallbackTargets) ? fallbackTargets : ["x"];
      list = fb.map(function (x) { return String(x || "").trim().toLowerCase(); })
        .filter(function (x) { return x && allow.indexOf(x) >= 0; });
    }
    void schemaId;
    if (!list.length) list = allow.indexOf("x") >= 0 ? ["x"] : allow.slice(0, 1);
    const uniq = [];
    list.forEach(function (x) {
      if (uniq.indexOf(x) < 0) uniq.push(x);
    });
    if (uniq.indexOf("xv") >= 0) return uniq.filter(function (x) { return x !== "x" && x !== "v"; });
    return uniq;
  }

  function extractHeadRows(rowsMain, rowsParams, targetMode, head) {
    const headTarget = String((head && head.targetType) || (head && head.target) || "x");
    if (headTarget === "params") {
      if (Math.max(0, Number(head && head.paramSize || 0)) < 1 && (!Array.isArray(rowsParams) || !rowsParams.length)) {
        throw new Error("Params output head requires at least one enabled Params feature in dataset/schema.");
      }
      if (!Array.isArray(rowsParams) || !rowsParams.length) throw new Error("Params target requested but parameter targets are missing.");
      const rawSelect = String((head && head.paramsSelect) || "");
      const picks = rawSelect.split(",").map(function (s) { return String(s || "").trim(); }).filter(function (s) { return !!s; });
      const names = Array.isArray(head && head.paramNames) ? (head.paramNames || []) : [];
      if (picks.length && names.length) {
        const idx = picks.map(function (k) { return names.indexOf(k); }).filter(function (i) { return i >= 0; });
        if (idx.length) {
          return rowsParams.map(function (r) {
            const row = Array.isArray(r) ? r : [r];
            return idx.map(function (j) { return Number(row[j] || 0); });
          });
        }
      }
      return rowsParams;
    }
    if (headTarget === "latent_diff") {
      const n = Array.isArray(rowsMain) ? rowsMain.length : 0;
      const units = Math.max(1, Number(head.units || 1));
      const zeros = new Array(n);
      for (let i = 0; i < n; i += 1) zeros[i] = new Array(units).fill(0);
      return zeros;
    }
    if (headTarget === "latent_kl") {
      const n = Array.isArray(rowsMain) ? rowsMain.length : 0;
      const units = Math.max(2, Number(head.units || 2));
      const zeros = new Array(n);
      for (let i = 0; i < n; i += 1) zeros[i] = new Array(units).fill(0);
      return zeros;
    }
    if (headTarget === "xv") {
      if (String(targetMode) !== "xv") throw new Error("x+v head requires dataset target mode xv.");
      return rowsMain;
    }
    if (headTarget === "traj") {
      if (String(targetMode) === "v") throw new Error("traj head requested but dataset currently has v-only labels.");
      return rowsMain.map(function (r) { return [Number(r[0] || 0)]; });
    }
    if (headTarget === "x") {
      if (String(targetMode) === "v") throw new Error("x head requested but dataset currently has v-only labels.");
      return rowsMain.map(function (r) { return [Number(r[0] || 0)]; });
    }
    if (headTarget === "v") {
      if (String(targetMode) === "x") throw new Error("v head requested but dataset currently has x-only labels.");
      if (String(targetMode) === "v") return rowsMain.map(function (r) { return [Number(r[0] || 0)]; });
      return rowsMain.map(function (r) { return [Number(r[1] || 0)]; });
    }
    throw new Error("Unsupported output head target: " + String(headTarget));
  }

  function rowsToTensor(rows, cols) {
    const n = Array.isArray(rows) ? rows.length : 0;
    const c = Math.max(1, Math.floor(Number(cols) || 1));
    return tf.tensor2d(rows || [], [n, c]);
  }

  function applyGradClip(optimizer, gradClipNorm, gradClipValue) {
    if (gradClipNorm <= 0 && gradClipValue <= 0) return;
    const originalApplyGradients = optimizer.applyGradients.bind(optimizer);
    optimizer.applyGradients = function (variableGradients) {
      const isArray = Array.isArray(variableGradients);
      const names = [];
      const grads = [];
      if (isArray) {
        variableGradients.forEach(function (entry) {
          if (!entry || !entry.tensor) return;
          names.push(String(entry.name || ""));
          grads.push(entry.tensor);
        });
      } else if (variableGradients && typeof variableGradients === "object") {
        Object.keys(variableGradients).forEach(function (name) {
          const tensor = variableGradients[name];
          if (!tensor) return;
          names.push(String(name || ""));
          grads.push(tensor);
        });
      } else {
        return originalApplyGradients(variableGradients);
      }
      if (!grads.length) return originalApplyGradients(variableGradients);
      let clipped = grads;
      let needsDispose = false;
      if (gradClipNorm > 0) {
        const pair = tf.clipByGlobalNorm(clipped, gradClipNorm);
        clipped = pair[0];
        needsDispose = true;
        if (pair[1] && typeof pair[1].dispose === "function") pair[1].dispose();
      }
      if (gradClipValue > 0) {
        const valueClipped = clipped.map(function (g) {
          return tf.clipByValue(g, -gradClipValue, gradClipValue);
        });
        if (needsDispose) tf.dispose(clipped);
        clipped = valueClipped;
        needsDispose = true;
      }
      const applyArg = isArray
        ? names.map(function (name, idx) { return { name: name, tensor: clipped[idx] }; })
        : (function () {
          const out = {};
          names.forEach(function (name, idx) {
            out[name] = clipped[idx];
          });
          return out;
        })();
      try {
        return originalApplyGradients(applyArg);
      } finally {
        if (needsDispose) tf.dispose(clipped);
      }
    };
  }

  function normalizeBackendOrder(rawOrder) {
    var parts = Array.isArray(rawOrder) ? rawOrder.slice() : String(rawOrder || "").split(/[,\s]+/);
    var allowed = { webgl: true, webgpu: true, wasm: true, cpu: true };
    var seen = {};
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var key = String(parts[i] || "").trim().toLowerCase();
      if (!allowed[key] || seen[key]) continue;
      seen[key] = true;
      out.push(key);
    }
    if (!out.length) return ["webgl", "webgpu", "wasm", "cpu"];
    if (!seen.cpu) out.push("cpu");
    return out;
  }

  function ensureTfBackend(runtimeConfig) {
    const requestedRaw = String((runtimeConfig && runtimeConfig.backend) || "auto").toLowerCase();
    const requested = requestedRaw === "gpu" ? "auto" : requestedRaw;
    const autoOrder = normalizeBackendOrder(runtimeConfig && runtimeConfig.backendOrder);
    const loadBackendScript = function (name) {
      try {
        if (name === "wasm") {
          importScripts(TFJS_WASM_BACKEND_CDN + "tfjs-backend-wasm.js");
        } else if (name === "webgl") {
          importScripts(TFJS_WEBGL_BACKEND_CDN + "tfjs-backend-webgl.js");
        } else if (name === "webgpu") {
          importScripts(TFJS_WEBGPU_BACKEND_CDN + "tfjs-backend-webgpu.js");
        }
      } catch (_) {}
    };
    const trySetBackend = async function (name) {
      if (name === "auto") {
        await tf.ready();
        return;
      }
      if (name === "wasm" && !tf.findBackend("wasm")) {
        loadBackendScript("wasm");
      } else if (name === "webgl" && !tf.findBackend("webgl")) {
        loadBackendScript("webgl");
      } else if (name === "webgpu" && !tf.findBackend("webgpu")) {
        loadBackendScript("webgpu");
      }
      const ok = await tf.setBackend(name);
      if (!ok && name !== "cpu") {
        try {
          await tf.setBackend("cpu");
        } catch (_) {}
      }
      await tf.ready();
    };
    if (requested !== "auto") return trySetBackend(requested);
    // auto: use configured order, defaulting to WebGL first for browser TF.js training.
    return (async function () {
      for (var i = 0; i < autoOrder.length; i++) {
        try {
          if (autoOrder[i] !== "cpu") loadBackendScript(autoOrder[i]);
          var ok = await tf.setBackend(autoOrder[i]);
          if (ok) { await tf.ready(); return; }
        } catch (_) {}
      }
      await tf.ready();
    })();
  }

  async function runTraining(message) {
    const runtimeConfig = message.runtimeConfig || {};
    const modelArtifacts = message.modelArtifacts || {};
    const ds = message.dataset || {};
    const payloadHeadConfigs = Array.isArray(message.headConfigs) ? message.headConfigs : [];
    const outputLossConfig = message.outputLossConfig || {};
    const resolvedLossType = String((outputLossConfig && outputLossConfig.resolvedLossType) || message.lossType || DEFAULT_LOSS_TYPE);
    const headConfigs = payloadHeadConfigs.length
      ? payloadHeadConfigs
      : [{
        id: "single",
        target: String((ds && ds.targetMode) || "x"),
        loss: String((outputLossConfig && outputLossConfig.loss) || "mse"),
        wx: 1,
        wv: 1,
      }];

    const mode = String(ds.mode || "autoregressive");
    const isRnn = Boolean(message.isSequence);
    const ySize = Math.max(1, Number(ds.targetSize || 1));
    if (!Array.isArray(ds.yTrain) || !ds.yTrain.length ||
      !Array.isArray(ds.yVal) || !ds.yVal.length ||
      !Array.isArray(ds.yTest) || !ds.yTest.length) {
      throw new Error("Dataset split too small. Increase trajectories or duration.");
    }
    if (!modelArtifacts || !modelArtifacts.modelTopology) {
      throw new Error("Missing model artifacts.");
    }

    const artifactLike = {
      modelTopology: modelArtifacts.modelTopology,
      weightSpecs: modelArtifacts.weightSpecs || [],
      weightData: modelArtifacts.weightData,
      format: modelArtifacts.format || "tfjs",
      generatedBy: modelArtifacts.generatedBy || "training",
      convertedBy: modelArtifacts.convertedBy || null,
      trainingConfig: modelArtifacts.trainingConfig || null,
      userDefinedMetadata: modelArtifacts.userDefinedMetadata || null,
      modelInitializer: modelArtifacts.modelInitializer || null,
    };
    const model = await tf.loadLayersModel(tf.io.fromMemory(artifactLike));

    const xTrain = isRnn ? tf.tensor3d(ds.seqTrain) : tf.tensor2d(ds.xTrain, [ds.xTrain.length, Number(ds.featureSize || 1)]);
    const yTrain = tf.tensor2d(ds.yTrain, [ds.yTrain.length, ySize]);
    const xVal = isRnn ? tf.tensor3d(ds.seqVal) : tf.tensor2d(ds.xVal, [ds.xVal.length, Number(ds.featureSize || 1)]);
    const yVal = tf.tensor2d(ds.yVal, [ds.yVal.length, ySize]);
    const xTest = isRnn ? tf.tensor3d(ds.seqTest) : tf.tensor2d(ds.xTest, [ds.xTest.length, Number(ds.featureSize || 1)]);

    const targetMode = String(ds.targetMode || "x");
    const yTrainTensors = [];
    const yValTensors = [];
    const yTestTensors = [];
    const losses = [];
    const metrics = [];
    const dsParamSize = Math.max(0, Number(ds.paramSize || 0));
    const dsParamNames = Array.isArray(ds.paramNames) ? ds.paramNames.slice() : [];
    const paramSize = Math.max(1, dsParamSize);

    headConfigs.forEach(function (head) {
      const target = String(head.target || "x");
      const rowsTrain = extractHeadRows(ds.yTrain, ds.pTrain, targetMode, Object.assign({}, head, { paramSize: paramSize, paramNames: dsParamNames }));
      const rowsVal = extractHeadRows(ds.yVal, ds.pVal, targetMode, Object.assign({}, head, { paramSize: paramSize, paramNames: dsParamNames }));
      const rowsTest = extractHeadRows(ds.yTest, ds.pTest, targetMode, Object.assign({}, head, { paramSize: paramSize, paramNames: dsParamNames }));
      const cols = target === "xv" ? 2
        : (target === "params" ? Math.max(1, paramSize || (rowsTrain[0] && rowsTrain[0].length) || 1)
          : (target === "traj" ? 1
            : (target === "latent_diff" ? Math.max(1, Number(head.units || 1))
              : (target === "latent_kl" ? Math.max(2, Number(head.units || 2))
                : 1))));
      yTrainTensors.push(rowsToTensor(rowsTrain, cols));
      yValTensors.push(rowsToTensor(rowsVal, cols));
      yTestTensors.push(rowsToTensor(rowsTest, cols));
      losses.push(makeHeadLoss(head, targetMode, resolvedLossType));
      metrics.push("mae");
    });

    const optimizerCfg = resolveOptimizerConfig(message);
    const optimizerType = optimizerCfg.type;
    const requestedLr = Math.max(1e-8, Number(message.learningRate || 1e-3));
    const lrSchedulerType = normalizeLrSchedulerType(message.lrSchedulerType, message.useLrScheduler === false ? "none" : "plateau");
    const useLrScheduler = lrSchedulerType !== "none";
    const lrPatience = Math.max(1, Number(message.lrPatience || 3));
    const lrFactor = clamp(Number(message.lrFactor || 0.5), 0.05, 0.99);
    const minLr = Math.max(1e-8, Number(message.minLr || 1e-6));
    const gradClipNorm = Math.max(0, Number(message.gradClipNorm || 0));
    const gradClipValue = Math.max(0, Number(message.gradClipValue || 0));
    const restoreBestWeights = resolveRestoreBestWeights(message, headConfigs);
    const earlyStoppingPatienceRaw = Number(message.earlyStoppingPatience);
    const earlyStoppingPatience = Number.isFinite(earlyStoppingPatienceRaw) && earlyStoppingPatienceRaw > 0
      ? Math.max(1, Math.floor(earlyStoppingPatienceRaw))
      : 0;

    let currentLr = requestedLr;
    const optimizer = createOptimizerByType(optimizerType, currentLr, optimizerCfg);
    applyGradClip(optimizer, gradClipNorm, gradClipValue);

    const trySetLearningRate = function (nextLr) {
      const v = Math.max(minLr, Number(nextLr) || currentLr);
      currentLr = v;
      try {
        if (model && model.optimizer && typeof model.optimizer.setLearningRate === "function") {
          model.optimizer.setLearningRate(v);
          return true;
        }
      } catch (_) {}
      try {
        if (model && model.optimizer) {
          model.optimizer.learningRate = v;
          return true;
        }
      } catch (_) {}
      return false;
    };

    let bestValLoss = Number.POSITIVE_INFINITY;
    let bestEpoch = -1;
    let bestWeights = null;
    let staleCount = 0;
    let lrStaleCount = 0;
    let stoppedEarly = false;
    const disposeTensorArray = function (arr) {
      if (!Array.isArray(arr)) return;
      arr.forEach(function (t) {
        try { if (t && typeof t.dispose === "function") t.dispose(); } catch (_) {}
      });
    };
    const disposeTensor = function (t) { try { if (t && typeof t.dispose === "function") t.dispose(); } catch (_) {} };
    const singleHead = headConfigs.length === 1;

    const history = { epoch: [], loss: [], val_loss: [], lr: [] };
    model.compile({
      optimizer: optimizer,
      loss: singleHead ? losses[0] : losses,
      metrics: singleHead ? ["mae"] : metrics,
    });

    await model.fit(xTrain, singleHead ? yTrainTensors[0] : yTrainTensors, {
      epochs: Number(message.epochs || 1),
      batchSize: Number(message.batchSize || 32),
      shuffle: message.shuffleTrain !== false,
      validationData: [xVal, singleHead ? yValTensors[0] : yValTensors],
      callbacks: [{
        onEpochEnd: function (epoch, logs) {
          logs = logs || {};
          const valLoss = Number(logs.val_loss);
          const trainLoss = Number(logs.loss);
          const metricForBest = Number.isFinite(valLoss) ? valLoss : trainLoss;
          let improved = false;
          if (Number.isFinite(metricForBest) && metricForBest < bestValLoss) {
            improved = true;
            bestValLoss = metricForBest;
            bestEpoch = epoch + 1;
            if (restoreBestWeights) {
              const nw = model.getWeights().map(function (w) { return w.clone(); });
              disposeTensorArray(bestWeights);
              bestWeights = nw;
            }
            staleCount = 0;
            lrStaleCount = 0;
          } else {
            staleCount += 1;
            lrStaleCount += 1;
          }
          if (useLrScheduler) {
            if (lrSchedulerType === "plateau") {
              if (lrStaleCount >= lrPatience && currentLr > minLr) {
                const nextLr = Math.max(minLr, currentLr * lrFactor);
                if (nextLr < currentLr - 1e-12) trySetLearningRate(nextLr);
                lrStaleCount = 0;
              }
            } else if (lrSchedulerType === "step") {
              const epoch1 = epoch + 1;
              if (epoch1 > 0 && epoch1 % Math.max(1, lrPatience) === 0 && currentLr > minLr) {
                const nextLr = Math.max(minLr, currentLr * lrFactor);
                if (nextLr < currentLr - 1e-12) trySetLearningRate(nextLr);
              }
            } else if (lrSchedulerType === "exponential") {
              if (currentLr > minLr) {
                const nextLr = Math.max(minLr, currentLr * lrFactor);
                if (nextLr < currentLr - 1e-12) trySetLearningRate(nextLr);
              }
            } else if (lrSchedulerType === "cosine") {
              const totalEpochs = Math.max(1, Number(message.epochs) || 1);
              const progress = Math.min(1, Math.max(0, (epoch + 1) / totalEpochs));
              const cosine = 0.5 * (1 + Math.cos(Math.PI * progress));
              const nextLr = Math.max(minLr, minLr + (requestedLr - minLr) * cosine);
              trySetLearningRate(nextLr);
            }
          }
          if (earlyStoppingPatience > 0 && staleCount >= earlyStoppingPatience) {
            stoppedEarly = true;
            try { model.stopTraining = true; } catch (_) {}
          }
          logs.current_lr = currentLr;
          logs.optimizer_type = optimizerType;
          logs.lr_scheduler_type = lrSchedulerType;
          logs.grad_clip_norm = gradClipNorm;
          logs.grad_clip_value = gradClipValue;
          logs.best_val_loss = Number.isFinite(bestValLoss) ? bestValLoss : NaN;
          logs.best_epoch = bestEpoch > 0 ? bestEpoch : NaN;
          logs.stopped_early = stoppedEarly;
          logs.improved = improved;
          history.epoch.push(epoch + 1);
          history.loss.push(trainLoss);
          history.val_loss.push(valLoss);
          history.lr.push(currentLr);
          self.postMessage({
            kind: "epoch",
            payload: {
              epoch: epoch + 1,
              loss: trainLoss,
              val_loss: valLoss,
              lr: currentLr,
              best_val_loss: logs.best_val_loss,
              improved: improved,
            },
            history: Object.assign({}, history),
          });
        },
        onBatchEnd: function () {},
      }],
    });

    if (restoreBestWeights && Array.isArray(bestWeights) && bestWeights.length) {
      try { model.setWeights(bestWeights); } catch (_) {}
    }

    const predValRaw = model.predict(isRnn ? xVal : xVal);
    const predTestRaw = model.predict(isRnn ? xTest : xTest);
    const predVals = Array.isArray(predValRaw) ? predValRaw : [predValRaw];
    const predTests = Array.isArray(predTestRaw) ? predTestRaw : [predTestRaw];
    let mse = 0;
    let mae = 0;
    let testMse = 0;
    let testMae = 0;
    for (let i = 0; i < predVals.length; i += 1) {
      const pv = predVals[i];
      const pt = predTests[i];
      const yv = yValTensors[i];
      const yt = yTestTensors[i];
      mse += tf.losses.meanSquaredError(yv, pv).dataSync()[0];
      mae += tf.metrics.meanAbsoluteError(yv, pv).dataSync()[0];
      testMse += tf.losses.meanSquaredError(yt, pt).dataSync()[0];
      testMae += tf.metrics.meanAbsoluteError(yt, pt).dataSync()[0];
    }
    const denom = Math.max(1, predVals.length);
    mse /= denom;
    mae /= denom;
    testMse /= denom;
    testMae /= denom;

    disposeTensorArray(yTrainTensors);
    disposeTensorArray(yValTensors);
    disposeTensorArray(yTestTensors);
    disposeTensorArray(predVals);
    disposeTensorArray(predTests);
    disposeTensor(xTrain);
    disposeTensor(xVal);
    disposeTensor(xTest);
    disposeTensorArray(bestWeights);

    const artifactHistory = Object.assign({}, history);
    const trainedArtifacts = await model.save(tf.io.withSaveHandler(async function (artifacts) {
      return artifacts;
    }));
    model.dispose();
    return {
      metrics: {
        mse: mse,
        mae: mae,
        testMse: testMse,
        testMae: testMae,
        headCount: headConfigs.length,
        bestEpoch: bestEpoch > 0 ? bestEpoch : null,
        bestValLoss: Number.isFinite(bestValLoss) ? bestValLoss : null,
        finalLr: currentLr,
        stoppedEarly: stoppedEarly,
      },
      modelArtifacts: trainedArtifacts,
      history: artifactHistory,
    };
  }

  async function ensureTfInitialized() {
    if (initialized) return;
    if (typeof importScripts === "function" && typeof tf === "undefined") {
      importScripts(TFJS_CDN_BASE + "tf.min.js");
    } else if (typeof tf === "undefined" && typeof importScripts === "function") {
      importScripts(TFJS_CDN_BASE + "tf.min.js");
    }
    initialized = true;
  }

  self.onmessage = async function (event) {
    const msg = event && event.data ? event.data : {};
    if (String(msg.kind || "") !== "run") return;
    try {
      await ensureTfInitialized();
      await tf.ready();
      await ensureTfBackend(msg.runtimeConfig || {});
      var resolvedBackend = tf.getBackend();
      self.postMessage({ kind: "ready", backend: resolvedBackend });
      const out = await runTraining(msg);
      if (out) out.resolvedBackend = resolvedBackend;
      const transfer = [];
      const wd = out && out.modelArtifacts ? out.modelArtifacts.weightData : null;
      if (wd instanceof ArrayBuffer) {
        transfer.push(wd);
      } else if (wd && wd.buffer instanceof ArrayBuffer) {
        transfer.push(wd.buffer);
      }
      self.postMessage({ kind: "complete", result: out }, transfer);
    } catch (err) {
      self.postMessage({
        kind: "error",
        error: {
          message: String((err && err.message) || "Training worker failed."),
          reason: String(err && err.stack || ""),
        },
      });
    }
  };
})();

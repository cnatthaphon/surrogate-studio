(( ) => {
  "use strict";

  function pickWorkerCtor(explicitCtor) {
    if (explicitCtor) return explicitCtor;
    if (typeof Worker !== "undefined") return Worker;
    return null;
  }

  function resolveRestoreBestWeights(spec) {
    const cfg = spec && typeof spec === "object" ? spec : {};
    if (typeof cfg.restoreBestWeights === "boolean") return cfg.restoreBestWeights;
    const weightSelection = String(cfg.weightSelection || "").trim().toLowerCase();
    if (weightSelection === "last") return false;
    if (weightSelection === "best") return true;
    if (Array.isArray(cfg.trainingSchedule) && cfg.trainingSchedule.length) return false;
    const heads = Array.isArray(cfg.headConfigs) ? cfg.headConfigs : [];
    if (heads.some(h => String((h && h.phase) || "").trim() !== "")) return false;
    return true;
  }

  function runTrainingInWorker(rawSpec, rawDeps) {
    const spec = rawSpec && typeof rawSpec === "object" ? rawSpec : {};
    const deps = rawDeps && typeof rawDeps === "object" ? rawDeps : {};
    const WorkerCtor = pickWorkerCtor(deps.WorkerCtor);
    if (!WorkerCtor) {
      return Promise.reject(new Error("Web Worker is not supported in this environment."));
    }
    const workerPath = String(deps.workerPath || "").trim();
    if (!workerPath) {
      return Promise.reject(new Error("Training worker path is not configured."));
    }

    const runId = String(spec.runId || ("run-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36)));
    const ds = spec.dataset || {};
    const defaultLossType = String(deps.defaultLossType || "meanSquaredError");
    const payload = {
      kind: "run",
      runId: runId,
      runtimeConfig: spec.runtimeConfig || { runtimeId: "js_client", backend: "auto" },
      modelArtifacts: spec.modelArtifacts || {},
      dataset: {
        mode: String(ds.mode || "autoregressive"),
        windowSize: Number(ds.windowSize || 20),
        seqFeatureSize: Number(ds.seqFeatureSize || 1),
        featureSize: Number(ds.featureSize || 1),
        targetMode: String(ds.targetMode || "x"),
        targetSize: Number(ds.targetSize || 1),
        paramSize: Number(ds.paramSize || 0),
        paramNames: Array.isArray(ds.paramNames) ? ds.paramNames.slice() : [],
        xTrain: Array.isArray(ds.xTrain) ? ds.xTrain.slice() : [],
        xVal: Array.isArray(ds.xVal) ? ds.xVal.slice() : [],
        xTest: Array.isArray(ds.xTest) ? ds.xTest.slice() : [],
        seqTrain: Array.isArray(ds.seqTrain) ? ds.seqTrain.slice() : [],
        seqVal: Array.isArray(ds.seqVal) ? ds.seqVal.slice() : [],
        seqTest: Array.isArray(ds.seqTest) ? ds.seqTest.slice() : [],
        yTrain: Array.isArray(ds.yTrain) ? ds.yTrain.slice() : [],
        yVal: Array.isArray(ds.yVal) ? ds.yVal.slice() : [],
        yTest: Array.isArray(ds.yTest) ? ds.yTest.slice() : [],
        pTrain: Array.isArray(ds.pTrain) ? ds.pTrain.slice() : [],
        pVal: Array.isArray(ds.pVal) ? ds.pVal.slice() : [],
        pTest: Array.isArray(ds.pTest) ? ds.pTest.slice() : [],
      },
      isSequence: Boolean(spec.isSequence),
      headConfigs: Array.isArray(spec.headConfigs) ? spec.headConfigs.slice() : [],
      outputLossConfig: spec.outputLossConfig || {},
      lossType: String(spec.lossType || defaultLossType),
      epochs: Number(spec.epochs || 1),
      batchSize: Number(spec.batchSize || 32),
      optimizerType: String(spec.optimizerType || "adam"),
      learningRate: Number(spec.learningRate || 1e-3),
      lrSchedulerType: String(spec.lrSchedulerType || "plateau"),
      useLrScheduler: Boolean(spec.useLrScheduler),
      lrPatience: Number(spec.lrPatience || 3),
      lrFactor: Number(spec.lrFactor || 0.5),
      minLr: Number(spec.minLr || 1e-6),
      gradClipNorm: Number(spec.gradClipNorm || 0),
      gradClipValue: Number(spec.gradClipValue || 0),
      restoreBestWeights: resolveRestoreBestWeights(spec),
      earlyStoppingPatience: Number(spec.earlyStoppingPatience || 0),
      useTfvis: false,
    };

    const transfer = [];
    if (payload.modelArtifacts && payload.modelArtifacts.weightData instanceof ArrayBuffer) {
      transfer.push(payload.modelArtifacts.weightData);
    } else if (
      payload.modelArtifacts &&
      payload.modelArtifacts.weightData &&
      payload.modelArtifacts.weightData.buffer instanceof ArrayBuffer
    ) {
      transfer.push(payload.modelArtifacts.weightData.buffer);
    }

    return new Promise(function (resolve, reject) {
      let worker = null;
      try {
        worker = new WorkerCtor(workerPath);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      if (typeof deps.setBusy === "function") {
        deps.setBusy(true, worker);
      }
      let settled = false;
      const finalize = function () {
        if (worker) {
          worker.onmessage = null;
          worker.onerror = null;
          try { worker.terminate(); } catch (_) {}
        }
        if (typeof deps.setBusy === "function") {
          deps.setBusy(false, null);
        }
      };
      const done = function (result) {
        if (settled) return;
        settled = true;
        finalize();
        resolve(result || {});
      };
      const fail = function (err) {
        if (settled) return;
        settled = true;
        finalize();
        reject(err || new Error("Training worker failed."));
      };

      worker.onmessage = function (evt) {
        const msg = evt && evt.data ? evt.data : {};
        const kind = String(msg.kind || "");
        if (kind === "ready") {
          if (typeof spec.onReady === "function") spec.onReady(msg);
          return;
        }
        if (kind === "epoch") {
          if (typeof spec.onEpochData === "function") {
            spec.onEpochData(msg.payload || {}, msg.history || null);
          }
          return;
        }
        if (kind === "log") {
          if (typeof spec.onStatus === "function") spec.onStatus(String(msg.message || ""));
          return;
        }
        if (kind === "error") {
          const wErr = msg.error || {};
          const err = new Error(String(wErr.message || "Worker training failed."));
          if (wErr.reason) err.reason = String(wErr.reason);
          fail(err);
          return;
        }
        if (kind === "complete") {
          done(msg.result || {});
          return;
        }
      };
      worker.onerror = function (evt) {
        fail(new Error(evt && evt.message ? evt.message : "Worker error"));
      };
      try {
        worker.postMessage(payload, transfer);
      } catch (err) {
        fail(err);
      }
    });
  }

  const api = {
    runTrainingInWorker: runTrainingInWorker,
  };

  if (typeof window !== "undefined") {
    window.OSCTrainingWorkerBridge = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();

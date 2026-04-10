(( ) => {
  "use strict";

  function toNum(value, fallback) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const fb = Number(fallback);
    return Number.isFinite(fb) ? fb : 0;
  }

  function toBool(value, fallback) {
    if (typeof value === "boolean") return value;
    return Boolean(fallback);
  }

  function toStr(value, fallback) {
    const v = String(value == null ? "" : value).trim();
    if (v) return v;
    return String(fallback == null ? "" : fallback).trim();
  }

  function createRunId() {
    return "run-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36);
  }

  function resolveRestoreBestWeights(rawSpec) {
    const spec = rawSpec && typeof rawSpec === "object" ? rawSpec : {};
    if (typeof spec.restoreBestWeights === "boolean") return spec.restoreBestWeights;
    const weightSelection = String(spec.weightSelection || "").trim().toLowerCase();
    if (weightSelection === "last") return false;
    if (weightSelection === "best") return true;
    if (Array.isArray(spec.trainingSchedule) && spec.trainingSchedule.length) return false;
    const heads = Array.isArray(spec.headConfigs) ? spec.headConfigs : [];
    if (heads.some(function (h) { return String((h && h.phase) || "").trim() !== ""; })) return false;
    return true;
  }

  function createWorkerTrainSpec(rawSpec) {
    const spec = rawSpec && typeof rawSpec === "object" ? rawSpec : {};
    const runtimeConfig = spec.runtimeConfig || { runtimeId: "js_client", backend: "auto", transport: "inproc", endpoint: "" };
    return {
      runId: toStr(spec.runId, createRunId()),
      runtimeConfig: Object.assign({
        runtimeFamily: String((runtimeConfig && runtimeConfig.runtimeFamily) || "").trim() || "tfjs",
      }, runtimeConfig),
      modelArtifacts: spec.modelArtifacts || null,
      dataset: spec.dataset || null,
      taskRecipeId: toStr(spec.taskRecipeId, (spec.dataset && spec.dataset.taskRecipeId) || ""),
      isSequence: toBool(spec.isSequence, false),
      headConfigs: Array.isArray(spec.headConfigs) ? spec.headConfigs.slice() : [],
      outputLossConfig: spec.outputLossConfig || {},
      lossType: toStr(spec.lossType, "meanSquaredError"),
      epochs: Math.max(1, Math.floor(toNum(spec.epochs, 1))),
      batchSize: Math.max(1, Math.floor(toNum(spec.batchSize, 32))),
      optimizerType: toStr(spec.optimizerType, "adam"),
      learningRate: Math.max(1e-8, toNum(spec.learningRate, 1e-3)),
      lrSchedulerType: toStr(spec.lrSchedulerType, "plateau"),
      useLrScheduler: toBool(spec.useLrScheduler, true),
      lrPatience: Math.max(1, Math.floor(toNum(spec.lrPatience, 3))),
      lrFactor: Math.max(0.01, Math.min(0.99, toNum(spec.lrFactor, 0.5))),
      minLr: Math.max(1e-10, toNum(spec.minLr, 1e-6)),
      gradClipNorm: Math.max(0, toNum(spec.gradClipNorm, 0)),
      gradClipValue: Math.max(0, toNum(spec.gradClipValue, 0)),
      restoreBestWeights: resolveRestoreBestWeights(spec),
      earlyStoppingPatience: Math.max(0, Math.floor(toNum(spec.earlyStoppingPatience, 0))),
      onEpochData: typeof spec.onEpochData === "function" ? spec.onEpochData : null,
      onStatus: typeof spec.onStatus === "function" ? spec.onStatus : null,
    };
  }

  async function runWorkerTraining(rawSpec, rawDeps) {
    const spec = createWorkerTrainSpec(rawSpec);
    const deps = rawDeps && typeof rawDeps === "object" ? rawDeps : {};
    const runner = typeof deps.runTrainingInWorker === "function" ? deps.runTrainingInWorker : null;
    if (!runner) {
      throw new Error("runWorkerTraining requires deps.runTrainingInWorker(spec).");
    }
    if (!spec.modelArtifacts || !spec.modelArtifacts.modelTopology) {
      throw new Error("Training spec requires modelArtifacts.modelTopology.");
    }
    if (!spec.dataset || typeof spec.dataset !== "object") {
      throw new Error("Training spec requires dataset.");
    }
    const result = await runner(spec);
    if (!result || typeof result !== "object") {
      throw new Error("Training worker returned invalid result.");
    }
    if (!result.metrics || typeof result.metrics !== "object") {
      throw new Error("Training worker result is missing metrics.");
    }
    if (!result.modelArtifacts || typeof result.modelArtifacts !== "object") {
      throw new Error("Training worker result is missing modelArtifacts.");
    }
    return {
      runId: spec.runId,
      runtimeConfig: spec.runtimeConfig,
      metrics: result.metrics,
      history: result.history || null,
      modelArtifacts: result.modelArtifacts,
      generatedBy: toStr(result.generatedBy, "training_worker"),
    };
  }

  const api = {
    createWorkerTrainSpec: createWorkerTrainSpec,
    runWorkerTraining: runWorkerTraining,
  };

  if (typeof window !== "undefined") {
    window.OSCTrainingSessionCore = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();

#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const NOTEBOOK_DIR = path.join(PROJECT_ROOT, "notebooks");
const MODELS_DIR = path.join(PROJECT_ROOT, "models");
const PYTHON_EXE = "/home/cue/venv/main/bin/python3";

let bootstrapState = null;

function bootstrapRuntime() {
  if (bootstrapState) return bootstrapState;

  const core = require(path.join(PROJECT_ROOT, "src", "notebook_bundle_core.js"));
  const schemaRegistry = require(path.join(PROJECT_ROOT, "src", "schema_registry.js"));
  globalThis.OSCSchemaRegistry = schemaRegistry;
  require(path.join(PROJECT_ROOT, "src", "schema_definitions_builtin.js"));
  const datasetModules = require(path.join(PROJECT_ROOT, "src", "dataset_modules.js"));
  globalThis.OSCDatasetModules = datasetModules;
  const datasetRuntime = require(path.join(PROJECT_ROOT, "src", "dataset_runtime.js"));
  const workspaceStoreMod = require(path.join(PROJECT_ROOT, "src", "workspace_store.js"));
  const datasetBundleAdapter = require(path.join(PROJECT_ROOT, "src", "dataset_bundle_adapter.js"));
  const modelGraphDrawflowAdapter = require(path.join(PROJECT_ROOT, "src", "model_graph_drawflow_adapter.js"));
  const trainingSessionCore = require(path.join(PROJECT_ROOT, "src", "training_session_core.js"));
  const tfjsHeadlessCore = require(path.join(PROJECT_ROOT, "src", "tfjs_headless_core.js"));
  const notebookResultCore = require(path.join(PROJECT_ROOT, "src", "notebook_result_core.js"));
  require(path.join(PROJECT_ROOT, "src", "notebook_runtime_assets.js"));
  const notebookRuntimeAssets = globalThis.OSCNotebookRuntimeAssets || null;
  const sourceRegistry = require(path.join(PROJECT_ROOT, "src", "dataset_source_registry.js"));
  globalThis.OSCDatasetSourceRegistry = sourceRegistry;

  bootstrapState = {
    projectRoot: PROJECT_ROOT,
    core,
    schemaRegistry,
    datasetModules,
    datasetRuntime,
    workspaceStore: workspaceStoreMod,
    datasetBundleAdapter,
    modelGraphDrawflowAdapter,
    trainingSessionCore,
    tfjsHeadlessCore,
    notebookResultCore,
    notebookRuntimeAssets,
    sourceRegistry,
  };
  return bootstrapState;
}

function sanitizeName(raw, fallback) {
  return String(raw || fallback || "item")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || String(fallback || "item");
}

function normalizeSplitMode(raw, fallback) {
  var m = String(raw || fallback || "random").trim().toLowerCase();
  if (!m) m = String(fallback || "random");
  return m;
}

function normalizeSplitFrac(raw, fallback) {
  var n = Number(raw);
  if (!Number.isFinite(n)) n = Number(fallback);
  if (!Number.isFinite(n)) n = 0.7;
  return n;
}

function runtimeFamilyFor(runtimeId) {
  var rid = String(runtimeId || "js_client").trim().toLowerCase();
  if (rid === "server_pytorch_cpu" || rid === "server_pytorch_gpu" || rid === "pytorch" || rid === "python") {
    return "pytorch";
  }
  return "tfjs";
}

function canUseStore(store) {
  return !!(store && typeof store === "object");
}

function persistDatasetToStore(store, dataset) {
  if (!canUseStore(store) || typeof store.upsertDataset !== "function" || !dataset) return dataset;
  store.upsertDataset({
    id: dataset.id,
    name: dataset.name,
    schemaId: dataset.schemaId,
    createdAt: dataset.createdAt,
    updatedAt: dataset.updatedAt || dataset.createdAt,
    payload: dataset,
  });
  return dataset;
}

function persistModelToStore(store, model) {
  if (!canUseStore(store) || typeof store.upsertModel !== "function" || !model) return model;
  store.upsertModel({
    id: model.id,
    name: model.name,
    schemaId: model.schemaId,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt || model.createdAt,
    payload: model,
  });
  return model;
}

function record_trainner_result(rawCfg) {
  const c = rawCfg || {};
  const store = c.store || null;
  const trainerRef = c.trainer || c.session || null;
  const trainerId = String((trainerRef && trainerRef.id) || c.trainerId || c.sessionId || "").trim();
  let trainer = trainerRef && typeof trainerRef === "object" ? Object.assign({}, trainerRef) : null;
  if (!trainer && trainerId && store && typeof store.getTrainerCard === "function") {
    trainer = store.getTrainerCard(trainerId);
  }
  if (!trainer) throw new Error("record_trainner_result requires trainer or trainerId.");

  const runtime = String((c.runtimeConfig && c.runtimeConfig.runtimeId) || c.runtime || trainer.runtime || "js_client");
  const runtimeFamily = String((c.runtimeConfig && c.runtimeConfig.runtimeFamily) || c.runtimeFamily || trainer.runtimeFamily || runtimeFamilyFor(runtime)).trim().toLowerCase();
  const runtimeBackend = String((c.runtimeConfig && c.runtimeConfig.backend) || c.runtimeBackend || trainer.runtimeBackend || "auto");
  const lastResult = {
    runId: String(c.runId || trainerId || ""),
    runtimeConfig: {
      runtimeId: runtime,
      runtimeFamily: runtimeFamily,
      backend: runtimeBackend,
      transport: String((c.runtimeConfig && c.runtimeConfig.transport) || c.transport || "inproc"),
      endpoint: String((c.runtimeConfig && c.runtimeConfig.endpoint) || c.endpoint || ""),
    },
    metrics: Object.assign({}, c.metrics || {}),
    historySummary: Object.assign({}, c.historySummary || {}),
    generatedBy: String(c.generatedBy || "workflow_api"),
  };

  if (store && typeof store.replaceTrainerEpochs === "function" && Array.isArray(c.epochRows)) {
    store.replaceTrainerEpochs(trainerId, c.epochRows);
  }
  if (store && typeof store.upsertTrainerCard === "function") {
    store.upsertTrainerCard({
      id: String(trainer.id || trainerId),
      name: String(trainer.name || trainerId || "trainer"),
      schemaId: String(trainer.schemaId || trainer.datasetSchemaId || trainer.modelSchemaId || "oscillator"),
      datasetId: String(trainer.datasetId || ""),
      modelId: String(trainer.modelId || ""),
      runtime: runtime,
      runtimeFamily: runtimeFamily,
      runtimeBackend: runtimeBackend,
      trainCfg: Object.assign({}, trainer.trainCfg || {}),
      createdAt: Number(trainer.createdAt) || Date.now(),
      updatedAt: Date.now(),
      lastResult: lastResult,
    });
  }

  return {
    trainerId: trainerId,
    lastResult: lastResult,
  };
}

function resolveStoreDataset(store, rawDatasetOrRef) {
  const src = rawDatasetOrRef || null;
  if (!src) return null;
  if (src.records || src.trajectories || src.splitIndices) return src;
  const id = String(src.id || src.datasetId || "").trim();
  if (!id || !store || typeof store.getDataset !== "function") return null;
  const row = store.getDataset(id);
  return row && row.payload ? row.payload : null;
}

function resolveStoreModel(store, rawModelOrRef) {
  const src = rawModelOrRef || null;
  if (!src) return null;
  if (src.drawflowGraph || src.drawflow) return src;
  const id = String(src.id || src.modelId || "").trim();
  if (!id || !store || typeof store.getModel !== "function") return null;
  const row = store.getModel(id);
  return row && row.payload ? row.payload : null;
}

function buildEpochRowsFromHistory(history) {
  const h = history && typeof history === "object" ? history : {};
  const epochs = Array.isArray(h.epoch) ? h.epoch : [];
  const trainLoss = Array.isArray(h.loss) ? h.loss : [];
  const valLoss = Array.isArray(h.val_loss) ? h.val_loss : [];
  const lr = Array.isArray(h.lr) ? h.lr : [];
  const out = [];
  for (let i = 0; i < epochs.length; i += 1) {
    out.push({
      epoch: Number(epochs[i]),
      train_loss: Number(trainLoss[i]),
      val_loss: Number(valLoss[i]),
      lr: Number(lr[i]),
    });
  }
  return out;
}

function create_dataset(rawCfg) {
  const c = rawCfg || {};
  const boot = bootstrapRuntime();
  const schemaId = boot.datasetRuntime.resolveSchemaId(c.schema || c.schemaId || "mnist");
  const moduleId = boot.datasetRuntime.pickDefaultModuleForSchema(schemaId);
  const name = sanitizeName(c.name, `${schemaId}_dataset_${Date.now()}`);
  const preconfig = (boot.schemaRegistry && typeof boot.schemaRegistry.getDatasetPreconfig === "function")
    ? boot.schemaRegistry.getDatasetPreconfig(schemaId)
    : (boot.datasetRuntime && typeof boot.datasetRuntime.getDatasetPreconfig === "function")
      ? boot.datasetRuntime.getDatasetPreconfig(schemaId)
      : {};
  const splitDefaults = (preconfig && preconfig.splitDefaults) || { mode: "random", train: 0.7, val: 0.15, test: 0.15 };
  const cfg = Object.assign({}, c, {
    schema: schemaId,
    schemaId,
    moduleId,
    name,
  });

  cfg.splitMode = normalizeSplitMode(cfg.splitMode, splitDefaults.mode);
  cfg.trainFrac = normalizeSplitFrac(cfg.trainFrac, splitDefaults.train);
  cfg.valFrac = normalizeSplitFrac(cfg.valFrac, splitDefaults.val);
  cfg.testFrac = normalizeSplitFrac(cfg.testFrac, splitDefaults.test);
  cfg.splitConfig = Object.assign({}, {
    mode: normalizeSplitMode(cfg.splitMode, splitDefaults.mode),
    train: Number.isFinite(Number(cfg.trainFrac)) ? Number(cfg.trainFrac) : 0.7,
    val: Number.isFinite(Number(cfg.valFrac)) ? Number(cfg.valFrac) : 0.15,
    test: Number.isFinite(Number(cfg.testFrac)) ? Number(cfg.testFrac) : 0.15,
  });

  return Promise.resolve(boot.datasetRuntime.buildDataset(moduleId, cfg))
    .then(function (ds) {
      const now = Date.now();
      ds.id = String(ds.id || `${schemaId}_${now}_${Math.floor(Math.random() * 1e6).toString(16)}`);
      ds.name = ds.name || name;
      ds.schemaId = boot.datasetRuntime.resolveSchemaId(ds.schemaId || schemaId);
      ds.createdAt = now;
      ds.updatedAt = now;
      persistDatasetToStore(c.store, ds);
      return ds;
    });
}

function cloneGraph(raw) {
  return JSON.parse(JSON.stringify(raw || {}));
}

function ensureMatchWeightAndTarget(graph) {
  const out = cloneGraph(graph);
  const nodes = (out && out.drawflow && out.drawflow.Home && out.drawflow.Home.data)
    || (out && out.drawflow && out.drawflow.Home && out.drawflow.Home.data)
    || null;
  if (!nodes || typeof nodes !== "object") return out;
  Object.keys(nodes).forEach(function (id) {
    const node = nodes[id];
    if (!node || node.name !== "output_layer" || !node.data || typeof node.data !== "object") return;
    if (node.data.matchWeight == null) node.data.matchWeight = 1;
    if (!node.data.targetType) node.data.targetType = node.data.target || "x";
  });
  return out;
}

function create_model(rawCfg) {
  const c = rawCfg || {};
  const boot = bootstrapRuntime();
  const schemaId = boot.schemaRegistry.resolveSchemaId(c.schema || c.schemaId || "oscillator", "oscillator");
  let graph = null;
  let modelName = sanitizeName(c.modelName || c.name || "model", "model");
  const modelPreconfig = (boot.schemaRegistry && typeof boot.schemaRegistry.getModelPreconfig === "function")
    ? boot.schemaRegistry.getModelPreconfig(schemaId)
    : (boot.datasetRuntime && typeof boot.datasetRuntime.getModelPreconfig === "function")
      ? boot.datasetRuntime.getModelPreconfig(schemaId)
      : {};
  const presetDefs = (boot.schemaRegistry && typeof boot.schemaRegistry.getPresetDefs === "function")
    ? boot.schemaRegistry.getPresetDefs(schemaId)
    : [];

  if (c.drawflowGraph) {
    graph = c.drawflowGraph;
  }

  if (!graph && c.modelPath) {
    const p = path.isAbsolute(c.modelPath)
      ? c.modelPath
      : path.join(PROJECT_ROOT, c.modelPath);
    graph = JSON.parse(fs.readFileSync(p, "utf8"));
  }

  if (!graph && c.preset) {
    const presetId = String(c.preset).trim();
    const presetDef = presetDefs.find(function (p) {
      return String((p && p.id) || "").trim() === presetId;
    }) || null;
    if (!presetDef) {
      throw new Error("Model preset '" + presetId + "' is not registered for schema='" + schemaId + "'.");
    }
    if (!presetDef.metadata || !presetDef.metadata.graphSpec) {
      throw new Error("Model preset '" + presetId + "' is missing metadata.graphSpec.");
    }
    graph = boot.modelGraphDrawflowAdapter.createDrawflowGraphFromPreset(schemaId, presetId);
    if (!c.modelName) modelName = presetId;
  }

  if (!graph) {
    const presetFromSchema = String((modelPreconfig && modelPreconfig.defaultPreset) || "").trim();
    if (!presetFromSchema) {
      throw new Error("No default model preset configured for schema='" + schemaId + "'.");
    }
    const presetDef = presetDefs.find(function (p) {
      return String((p && p.id) || "").trim() === presetFromSchema;
    }) || null;
    if (!presetDef || !presetDef.metadata || !presetDef.metadata.graphSpec) {
      throw new Error("Default model preset '" + presetFromSchema + "' is unavailable for schema='" + schemaId + "'.");
    }
    graph = boot.modelGraphDrawflowAdapter.createDrawflowGraphFromPreset(schemaId, presetFromSchema);
    if (!c.modelName) modelName = presetFromSchema;
  }

  graph = ensureMatchWeightAndTarget(graph);
  const normalized = {
    id: sanitizeName(c.id, `model_${Date.now()}_${Math.floor(Math.random() * 1e6)}`),
    name: sanitizeName(modelName, "model"),
    schemaId,
    drawflow: graph.drawflow || null,
    drawflowGraph: graph,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: c.source || "workflow_api",
  };
  persistModelToStore(c.store, normalized);
  return normalized;
}

function create_trainner(rawCfg) {
  const c = rawCfg || {};
  const boot = bootstrapRuntime();
  const store = c.store || null;
  const dataset = resolveStoreDataset(store, c.dataset || c.datasetRef || null);
  const model = resolveStoreModel(store, c.model || c.modelRef || c.modelGraph || null);
  const schemaId = boot.datasetRuntime.resolveSchemaId(
    c.schemaId || (dataset && dataset.schemaId) || (model && model.schemaId) || "mnist"
  );
  if (!dataset) throw new Error("create_trainner requires dataset.");
  if (!model) throw new Error("create_trainner requires model.");
  if (boot.datasetRuntime.resolveSchemaId(dataset.schemaId || schemaId) !== schemaId) {
    throw new Error("Dataset schema mismatch: " + String(dataset.schemaId || "unknown") + " vs " + schemaId);
  }
  if (boot.datasetRuntime.resolveSchemaId(model.schemaId || schemaId) !== schemaId) {
    throw new Error("Model schema mismatch: " + String(model.schemaId || "unknown") + " vs " + schemaId);
  }
  const drawflowGraph = model.drawflowGraph || model.graph || model.drawflow || {};
  const session = {
    id: sanitizeName(c.id, `session_${Date.now()}_${Math.floor(Math.random() * 1e6)}`),
    name: sanitizeName(c.name, `session_${Date.now()}`),
    schemaId,
    datasetSchemaId: schemaId,
    modelSchemaId: schemaId,
    datasetName: dataset.name || `${dataset.schemaId}_dataset`,
    datasetData: dataset,
    modelName: model.name || (model.schemaId ? `${model.schemaId}_model` : "model"),
    drawflowGraph,
    runtime: c.runtime || c.runtimeId || "js_client",
    runtimeFamily: runtimeFamilyFor(c.runtime || c.runtimeId || "js_client"),
    runtimeBackend: c.runtimeBackend || "auto",
    trainCfg: Object.assign({}, c.trainCfg || c.trainConfig || {}),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (store && typeof store.upsertTrainerCard === "function") {
    store.upsertTrainerCard({
      id: session.id,
      name: session.name,
      schemaId: session.schemaId,
      datasetId: String(dataset.id || ""),
      modelId: String(model.id || ""),
      modelName: session.modelName,
      datasetName: session.datasetName,
      runtime: session.runtime,
      runtimeFamily: session.runtimeFamily,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      runtimeBackend: session.runtimeBackend,
      trainCfg: session.trainCfg,
    });
  }
  return session;
}

async function run_trainner(rawCfg) {
  const c = rawCfg || {};
  const boot = bootstrapRuntime();
  const store = c.store || null;
  const trainerRef = c.trainer || c.session || null;
  const trainerId = String((trainerRef && trainerRef.id) || c.trainerId || c.sessionId || "").trim();
  let trainer = trainerRef && typeof trainerRef === "object" && trainerRef.runtime ? Object.assign({}, trainerRef) : null;
  if (!trainer && trainerId && store && typeof store.getTrainerCard === "function") {
    trainer = store.getTrainerCard(trainerId);
  }
  if (!trainer) throw new Error("run_trainner requires trainer or trainerId.");

  const dataset = resolveStoreDataset(store, c.dataset || c.datasetRef || { id: trainer.datasetId });
  const model = resolveStoreModel(store, c.model || c.modelRef || { id: trainer.modelId });
  if (!dataset) throw new Error("run_trainner could not resolve dataset.");
  if (!model) throw new Error("run_trainner could not resolve model.");

  const trainCfg = Object.assign({}, trainer.trainCfg || {}, c.trainCfg || {});
  const runtime = String(c.runtime || trainer.runtime || "js_client");
  const runtimeFamily = String(c.runtimeFamily || trainer.runtimeFamily || runtimeFamilyFor(runtime)).trim().toLowerCase();

  if (runtimeFamily === "tfjs" && typeof c.runTrainingInWorker !== "function" && !(c.deps && typeof c.deps.runTrainingInWorker === "function")) {
    const tfjsResult = await boot.tfjsHeadlessCore.runTrainer({
      trainer: trainer,
      model: model,
      dataset: dataset,
      trainCfg: trainCfg,
      schemaId: String(trainer.schemaId || model.schemaId || dataset.schemaId || ""),
    });
    const epochRowsDirect = buildEpochRowsFromHistory(tfjsResult.history);
    if (store && typeof store.replaceTrainerEpochs === "function") {
      store.replaceTrainerEpochs(String(trainer.id || trainerId), epochRowsDirect);
    }
    if (store && typeof store.upsertTrainerCard === "function") {
      store.upsertTrainerCard({
        id: String(trainer.id || trainerId),
        name: String(trainer.name || trainerId || "trainer"),
        schemaId: String(trainer.schemaId || dataset.schemaId || model.schemaId || "oscillator"),
        datasetId: String(dataset.id || trainer.datasetId || ""),
        modelId: String(model.id || trainer.modelId || ""),
        runtime: runtime,
        runtimeBackend: String(c.runtimeBackend || trainer.runtimeBackend || "auto"),
        trainCfg: trainCfg,
        createdAt: Number(trainer.createdAt) || Date.now(),
        updatedAt: Date.now(),
        lastResult: {
          runId: String(trainer.id || trainerId),
          runtimeConfig: {
            runtimeId: runtime,
            runtimeFamily: runtimeFamily,
            backend: String(c.runtimeBackend || trainer.runtimeBackend || "auto"),
          },
          metrics: tfjsResult.metrics,
          historySummary: {
            epochs: epochRowsDirect.length,
            finalTrainLoss: epochRowsDirect.length ? epochRowsDirect[epochRowsDirect.length - 1].train_loss : null,
            finalValLoss: epochRowsDirect.length ? epochRowsDirect[epochRowsDirect.length - 1].val_loss : null,
          },
          generatedBy: tfjsResult.generatedBy,
        },
      });
    }
    if (store && typeof store.upsertModel === "function") {
      const modelRow = store.getModel && typeof store.getModel === "function" ? store.getModel(String(model.id || "")) : null;
      const payload = modelRow && modelRow.payload ? Object.assign({}, modelRow.payload) : Object.assign({}, model);
      payload.modelArtifacts = tfjsResult.modelArtifacts;
      payload.updatedAt = Date.now();
      store.upsertModel({
        id: String(model.id || payload.id || ""),
        name: String(model.name || payload.name || "model"),
        schemaId: String(model.schemaId || payload.schemaId || ""),
        createdAt: Number((modelRow && modelRow.createdAt) || payload.createdAt || Date.now()),
        updatedAt: payload.updatedAt,
        payload: payload,
      });
    }
    return {
      trainerId: String(trainer.id || trainerId),
      datasetId: String(dataset.id || trainer.datasetId || ""),
      modelId: String(model.id || trainer.modelId || ""),
      result: tfjsResult,
      storedEpochs: epochRowsDirect.length,
    };
  }

  let modelArtifacts = c.modelArtifacts || trainer.modelArtifacts || model.modelArtifacts || null;
  if ((!modelArtifacts || !modelArtifacts.modelTopology) && typeof c.compileModelArtifacts === "function") {
    modelArtifacts = await Promise.resolve(c.compileModelArtifacts({
      trainer: trainer,
      model: model,
      dataset: dataset,
      store: store,
      schemaId: String(trainer.schemaId || model.schemaId || dataset.schemaId || ""),
    }));
  }
  if (!modelArtifacts || !modelArtifacts.modelTopology) {
    throw new Error("run_trainner requires modelArtifacts.modelTopology or compileModelArtifacts(ctx).");
  }

  const spec = boot.trainingSessionCore.createWorkerTrainSpec({
    runId: String(c.runId || trainer.id || ""),
    runtimeConfig: {
      runtimeId: runtime,
      runtimeFamily: runtimeFamily,
      backend: String(c.runtimeBackend || trainer.runtimeBackend || "auto"),
      transport: String(c.transport || "inproc"),
      endpoint: String(c.endpoint || ""),
    },
    modelArtifacts: modelArtifacts,
    dataset: dataset,
    epochs: trainCfg.epochs,
    batchSize: trainCfg.batchSize,
    optimizerType: trainCfg.optimizerType || trainCfg.optimizer,
    learningRate: trainCfg.learningRate,
    useLrScheduler: trainCfg.useLrScheduler,
    lrSchedulerType: trainCfg.lrSchedulerType || trainCfg.lrScheduler,
    lrPatience: trainCfg.lrPatience,
    lrFactor: trainCfg.lrFactor,
    minLr: trainCfg.minLr,
    gradClipNorm: trainCfg.gradClipNorm,
    gradClipValue: trainCfg.gradClipValue,
    restoreBestWeights: trainCfg.restoreBestWeights,
    earlyStoppingPatience: trainCfg.earlyStoppingPatience,
  });

  const result = await boot.trainingSessionCore.runWorkerTraining(spec, {
    runTrainingInWorker: c.runTrainingInWorker || (c.deps && c.deps.runTrainingInWorker),
  });

  const epochRows = buildEpochRowsFromHistory(result.history);
  if (store && typeof store.replaceTrainerEpochs === "function") {
    store.replaceTrainerEpochs(String(trainer.id || trainerId), epochRows);
  }
  if (store && typeof store.upsertTrainerCard === "function") {
    store.upsertTrainerCard({
      id: String(trainer.id || trainerId),
      name: String(trainer.name || trainerId || "trainer"),
      schemaId: String(trainer.schemaId || dataset.schemaId || model.schemaId || "oscillator"),
      datasetId: String(dataset.id || trainer.datasetId || ""),
      modelId: String(model.id || trainer.modelId || ""),
      runtime: runtime,
      runtimeBackend: String(spec.runtimeConfig.backend || trainer.runtimeBackend || "auto"),
      trainCfg: trainCfg,
      createdAt: Number(trainer.createdAt) || Date.now(),
      updatedAt: Date.now(),
      lastResult: {
        runId: result.runId,
        runtimeConfig: result.runtimeConfig,
        metrics: result.metrics,
        historySummary: {
          epochs: epochRows.length,
          finalTrainLoss: epochRows.length ? epochRows[epochRows.length - 1].train_loss : null,
          finalValLoss: epochRows.length ? epochRows[epochRows.length - 1].val_loss : null,
        },
        generatedBy: result.generatedBy,
      },
    });
  }

  return {
    trainerId: String(trainer.id || trainerId),
    datasetId: String(dataset.id || trainer.datasetId || ""),
    modelId: String(model.id || trainer.modelId || ""),
    result: result,
    storedEpochs: epochRows.length,
  };
}

function buildMnistAdapter() {
  return {
    buildNotebookDatasetFiles(input) {
      const cfg = input || {};
      const ds = cfg.dataset || {};
      const schemaId = String(cfg.schemaId || ds.schemaId || "mnist").trim().toLowerCase();
      if (schemaId !== "mnist" && schemaId !== "fashion_mnist") return null;

      const name = sanitizeName(cfg.datasetName || ds.name || schemaId, "dataset");
      const classCount = Number(ds.classCount) || 10;
      const srcReg = bootstrapRuntime().sourceRegistry;

      // Determine feature size from first sample
      let sampleX = null;
      ["train", "val", "test"].some(function (s) {
        let split = (ds.records && ds.records[s]) || {};
        if ((!split.x || !split.x.length) && srcReg && typeof srcReg.resolveDatasetSplit === "function") {
          split = srcReg.resolveDatasetSplit(ds, s);
        }
        if (split.x && split.x.length) { sampleX = split.x[0]; return true; }
        return false;
      });
      const featureSize = Array.isArray(sampleX) ? sampleX.length : 784;

      // Build header: split, f0..fN, t0..tC
      const headerParts = ["split"];
      for (let fi = 0; fi < featureSize; fi++) headerParts.push("f" + fi);
      for (let ti = 0; ti < classCount; ti++) headerParts.push("t" + ti);
      const rows = [headerParts.join(",")];
      const splitCfg = bootstrapRuntime().core.normalizeSplitConfig(ds.splitConfig || { mode: "random", train: 0.8, val: 0.1, test: 0.1 });
      const splitCounts = { train: 0, val: 0, test: 0 };
      ["train", "val", "test"].forEach(function (splitName) {
        let split = (ds.records && ds.records[splitName]) || {};
        if ((!split.x || !split.x.length) && srcReg && typeof srcReg.resolveDatasetSplit === "function") {
          split = srcReg.resolveDatasetSplit(ds, splitName);
        }
        const xs = Array.isArray(split.x) ? split.x : [];
        const ys = Array.isArray(split.y) ? split.y : [];
        const n = Math.min(xs.length, ys.length);
        for (let i = 0; i < n; i += 1) {
          const x = xs[i] || [];
          const parts = [splitName];
          for (let k = 0; k < featureSize; k++) {
            let vv = Number(x[k] || 0);
            if (!Number.isFinite(vv)) vv = 0;
            if (vv > 1) vv = vv / 255;
            parts.push(Math.max(0, Math.min(1, vv)));
          }
          const label = Math.max(0, Math.min(classCount - 1, Math.round(Number(ys[i]) || 0)));
          for (let tc = 0; tc < classCount; tc++) parts.push(tc === label ? 1 : 0);
          rows.push(parts.join(","));
          splitCounts[splitName] = (splitCounts[splitName] || 0) + 1;
        }
      });

      const manifest = {
        version: 1,
        source: "workflow_api",
        schemaId,
        splitConfig: splitCfg,
        splitCounts,
      };
      return {
        schemaId,
        datasetRef: "dataset/" + name + ".csv",
        splitRef: "dataset/" + name + ".split_manifest.json",
        format: "csv_manifest",
        files: [
          { path: "dataset/" + name + ".csv", content: rows.join("\n"), contentType: "text/csv;charset=utf-8;" },
          { path: "dataset/" + name + ".split_manifest.json", content: JSON.stringify(manifest, null, 2), contentType: "application/json;charset=utf-8;" },
        ],
        manifest,
      };
    },
  };
}

function export_notebook_zip(rawCfg) {
  const c = rawCfg || {};
  const boot = bootstrapRuntime();
  const sessions = Array.isArray(c.sessions) ? c.sessions : [];
  if (!sessions.length) throw new Error("export_notebook_zip requires at least one session.");
  sessions.forEach(function (s) {
    const family = String((s && s.runtimeFamily) || runtimeFamilyFor(s && s.runtime)).trim().toLowerCase();
    if (family !== "pytorch") {
      throw new Error("Notebook export requires pytorch runtime family. Session '" + String((s && s.name) || (s && s.id) || "?") + "' uses '" + family + "'.");
    }
  });
  const outDir = c.outputDir || path.join(PROJECT_ROOT, "output", "headless_workflow_api");
  fs.mkdirSync(outDir, { recursive: true });
  const zipName = sanitizeName(c.zipName || "trainner_bundle", "trainner_bundle") + ".zip";
  const zipPath = path.join(outDir, zipName);
  const options = {
    sessions: sessions,
    layout: c.layout || "per_session",
    packageMode: c.packageMode || "zip_two_file_runtime",
    includeModelGraph: c.includeModelGraph !== false,
    zipFileName: zipName,
    outputZipPath: zipPath,
    runtimeFiles: boot.notebookRuntimeAssets && boot.notebookRuntimeAssets.files
      ? Object.assign({}, boot.notebookRuntimeAssets.files)
      : null,
    runtimeLoader: function (name) {
      const p = path.join(NOTEBOOK_DIR, String(name || ""));
      return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    },
  };
  options.datasetBundleAdapter = boot.datasetBundleAdapter;
  return boot.core.createNotebookBundleZipFromConfig(options)
    .then(function (res) {
      return {
        zipPath: res.zipPath || zipPath,
        outputDir: outDir,
        summary: res.summary || null,
        sessions: sessions.map(function (s) {
          return { id: s.id, name: s.name, schemaId: s.schemaId, runtime: s.runtime };
        }),
      };
    });
}

function buildWorkspaceStore(mode) {
  const boot = bootstrapRuntime();
  const sel = String(mode || "").trim().toLowerCase();
  const maybeStore = (sel === "indexeddb" && typeof boot.workspaceStore.createIndexedDbStore === "function")
    ? boot.workspaceStore.createIndexedDbStore({})
    : boot.workspaceStore.createMemoryStore();
  if (maybeStore && typeof maybeStore.then === "function") {
    return maybeStore.then(function (store) {
      return store;
    });
  }
  return maybeStore;
}

function unzipAndExecute(rawCfg) {
  const c = rawCfg || {};
  if (!c.zipPath) throw new Error("unzipAndExecute requires zipPath.");
  const outDir = c.outputDir || path.join(path.dirname(c.zipPath), "unpacked");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const zipPathArg = String(c.zipPath).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const outDirArg = String(outDir).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const unzipCmd = [
    "import zipfile",
    "from pathlib import Path",
    "zip_path = Path(r'" + zipPathArg + "')",
    "out_dir = Path(r'" + outDirArg + "')",
    "with zipfile.ZipFile(zip_path, 'r') as z:",
    "    z.extractall(out_dir)",
  ].join("\n");
  cp.execFileSync(PYTHON_EXE, ["-c", unzipCmd], { stdio: "inherit" });

  const runIpynb = path.join(outDir, "notebooks", "run.ipynb");
  const nbOutDir = path.dirname(runIpynb);
  const runName = path.basename(runIpynb);
  const shouldKeepName = c.keepOriginalName !== false;
  const executedName = shouldKeepName ? runName : (c.executedName || "executed.ipynb");
  const executed = path.join(nbOutDir, executedName);
  if (c.run !== false) {
    cp.execSync(`${JSON.stringify(PYTHON_EXE)} -m nbconvert --to notebook --execute --output ${JSON.stringify(executedName)} --ExecutePreprocessor.timeout=300 ${JSON.stringify(runIpynb)}`, {
      cwd: nbOutDir,
      stdio: "inherit",
      timeout: 300000,
    });
  }
  return {
    unpackedDir: outDir,
    runNotebook: runIpynb,
    executedNotebook: executed,
  };
}

function parse_executed_notebook_report(rawCfg) {
  const c = rawCfg || {};
  if (!c.notebookPath && !c.executedNotebook) {
    throw new Error("parse_executed_notebook_report requires notebookPath.");
  }
  const boot = bootstrapRuntime();
  return boot.notebookResultCore.extractNotebookReport(String(c.notebookPath || c.executedNotebook));
}

function store_executed_notebook_report(rawCfg) {
  const c = rawCfg || {};
  const parsed = c.parsedReport || c.report || parse_executed_notebook_report(c);
  const finalReport = Array.isArray(parsed && parsed.finalReport) ? parsed.finalReport : [];
  if (!finalReport.length) {
    throw new Error("store_executed_notebook_report could not find finalReport row.");
  }
  const row = finalReport[0] || {};
  return record_trainner_result({
    store: c.store,
    trainer: c.trainer,
    trainerId: c.trainerId,
    generatedBy: "executed_notebook",
    runtimeConfig: {
      runtimeId: String(row.runtime || c.runtime || "server_pytorch_gpu"),
      runtimeFamily: "pytorch",
      backend: String(c.runtimeBackend || "auto"),
      transport: "notebook",
      endpoint: "",
    },
    metrics: {
      testMae: Number(row.test_mae),
      testRmse: Number(row.test_rmse),
      testBias: Number(row.test_bias),
      testAccuracy: Number(row.test_accuracy),
      accuracy: Number(row.test_accuracy),
      bestEpoch: Number(row.best_epoch),
      bestValLoss: Number(row.best_val_loss),
    },
    historySummary: {
      epochs: Number(row.best_epoch),
      finalTrainLoss: null,
      finalValLoss: Number(row.best_val_loss),
    },
  });
}

module.exports = {
  create_dataset,
  create_model,
  create_trainner,
  run_trainner,
  record_trainner_result,
  export_notebook_zip,
  buildWorkspaceStore,
  unzipAndExecute,
  parse_executed_notebook_report,
  store_executed_notebook_report,
  bootstrapRuntime,
};

// aliases
const createDataset = create_dataset;
const createModel = create_model;
const createTrainer = create_trainner;
const runTrainer = run_trainner;
const exportNotebookZip = export_notebook_zip;

module.exports.createDataset = createDataset;
module.exports.createModel = createModel;
module.exports.createTrainer = createTrainer;
module.exports.runTrainer = runTrainer;
module.exports.exportNotebookZip = exportNotebookZip;

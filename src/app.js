(function () {
  "use strict";
  const BUILD_TAG = "2026-02-19-output-v-target";
  const DEFAULT_LOSS_TYPE = "meanSquaredError";
  const TFJS_VERSION = "4.22.0";
  const TFJS_WASM_CDN_BASE = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@" + TFJS_VERSION + "/dist/";
  const DATASET_WORKER_PATH = (function () {
    if (typeof window === "undefined") return "";
    try {
      const currentScript = document.currentScript;
      if (currentScript && currentScript.src) {
        return new URL("dataset_worker.js", currentScript.src).href;
      }
    } catch (_) {}
    try {
      return new URL("src/dataset_worker.js", window.location.href).href;
    } catch (_) {}
    return "src/dataset_worker.js";
  })();
  const TRAINING_WORKER_PATH = (function () {
    if (typeof window === "undefined") return "";
    try {
      const currentScript = document.currentScript;
      if (currentScript && currentScript.src) {
        return new URL("training_worker.js", currentScript.src).href;
      }
    } catch (_) {}
    try {
      return new URL("src/training_worker.js", window.location.href).href;
    } catch (_) {}
    return "src/training_worker.js";
  })();

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

  const SCHEMA_REGISTRY = (function () {
    if (typeof window === "undefined" || !window.OSCSchemaRegistry) {
      throw new Error("OSCSchemaRegistry is required. Load src/schema_registry.js before src/app.js.");
    }
    return window.OSCSchemaRegistry;
  })();

  const DATASET_RUNTIME = (function () {
    if (typeof window !== "undefined" && window.OSCDatasetRuntime) {
      return window.OSCDatasetRuntime;
    }
    return null;
  })();

  const WORKSPACE_STORE_RUNTIME = (function () {
    if (typeof window !== "undefined" && window.OSCWorkspaceStore) {
      return window.OSCWorkspaceStore;
    }
    return null;
  })();

  const UI_SHARED_ENGINE = (function () {
    if (typeof window === "undefined" || !window.OSCUiSharedEngine) {
      throw new Error("OSCUiSharedEngine is required. Load src/ui_shared_engine.js before src/app.js.");
    }
    return window.OSCUiSharedEngine;
  })();

  const ITEM_PANEL_MODULE = (function () {
    if (typeof window === "undefined" || !window.OSCItemPanelModule) {
      throw new Error("OSCItemPanelModule is required. Load src/item_panel_module.js before src/app.js.");
    }
    return window.OSCItemPanelModule;
  })();

  const CONFIG_PANEL_MODULE = (function () {
    if (typeof window === "undefined" || !window.OSCConfigPanelModule) {
      throw new Error("OSCConfigPanelModule is required. Load src/config_panel_module.js before src/app.js.");
    }
    return window.OSCConfigPanelModule;
  })();

  const TAB_MANAGER_CORE = (function () {
    if (typeof window === "undefined" || !window.OSCTabManagerCore) {
      throw new Error("OSCTabManagerCore is required. Load src/tab_manager_core.js before src/app.js.");
    }
    return window.OSCTabManagerCore;
  })();

  const DATASET_PROCESSING_CORE = (function () {
    if (typeof window === "undefined" || !window.OSCDatasetProcessingCore) {
      throw new Error("OSCDatasetProcessingCore is required. Load src/dataset_processing_core.js before src/app.js.");
    }
    return window.OSCDatasetProcessingCore;
  })();

  const ENTITY_CREATE_CORE = (function () {
    if (typeof window === "undefined" || !window.OSCEntityCreateCore) {
      throw new Error("OSCEntityCreateCore is required. Load src/entity_create_core.js before src/app.js.");
    }
    return window.OSCEntityCreateCore;
  })();

  const MODEL_GRAPH_CORE = (function () {
    if (typeof window === "undefined" || !window.OSCModelGraphCore) {
      return null;
    }
    return window.OSCModelGraphCore;
  })();

  const MODEL_GRAPH_DRAWFLOW_ADAPTER = (function () {
    if (typeof window === "undefined" || !window.OSCModelGraphDrawflowAdapter) {
      return null;
    }
    return window.OSCModelGraphDrawflowAdapter;
  })();

  const IMAGE_RENDER_CORE = (function () {
    if (typeof window === "undefined" || !window.OSCImageRenderCore) {
      throw new Error("OSCImageRenderCore is required. Load src/image_render_core.js before src/app.js.");
    }
    return window.OSCImageRenderCore;
  })();

  const TRAINER_SESSION_STATE_CORE = (function () {
    if (typeof window === "undefined" || !window.OSCTrainerSessionStateCore) {
      throw new Error("OSCTrainerSessionStateCore is required. Load src/trainer_session_state_core.js before src/app.js.");
    }
    return window.OSCTrainerSessionStateCore;
  })();

  const WORKSPACE_TAB_EFFECTS_CORE = (function () {
    if (typeof window === "undefined" || !window.OSCWorkspaceTabEffectsCore) {
      throw new Error("OSCWorkspaceTabEffectsCore is required. Load src/workspace_tab_effects_core.js before src/app.js.");
    }
    return window.OSCWorkspaceTabEffectsCore;
  })();

  const WORKSPACE_LAB_HANDLERS_CORE = (function () {
    if (typeof window === "undefined" || !window.OSCWorkspaceLabHandlersCore) {
      throw new Error("OSCWorkspaceLabHandlersCore is required. Load src/workspace_lab_handlers_core.js before src/app.js.");
    }
    return window.OSCWorkspaceLabHandlersCore;
  })();

  const WORKSPACE_CONTROLLERS_CORE = (function () {
    if (typeof window === "undefined" || !window.OSCWorkspaceControllersCore) {
      throw new Error("OSCWorkspaceControllersCore is required. Load src/workspace_controllers_core.js before src/app.js.");
    }
    return window.OSCWorkspaceControllersCore;
  })();

  const WORKSPACE_SELECTION_UI_CORE = (function () {
    if (typeof window === "undefined" || !window.OSCWorkspaceSelectionUiCore) {
      throw new Error("OSCWorkspaceSelectionUiCore is required. Load src/workspace_selection_ui_core.js before src/app.js.");
    }
    return window.OSCWorkspaceSelectionUiCore;
  })();

  let _modelGraphRuntime = null;
  let _tabManagerRuntime = null;
  let _imageRenderRuntime = null;
  let _workspaceTabEffectsRuntime = null;
  let _workspaceLabHandlersRuntime = null;
  let _workspaceControllersRuntime = null;
  let _workspaceSelectionUiRuntime = null;
  let _trainingActionRuntime = {
    runSessionsByIds: null,
  };

  function getModelGraphRuntime() {
    if (_modelGraphRuntime) return _modelGraphRuntime;
    if (!MODEL_GRAPH_CORE || typeof MODEL_GRAPH_CORE.createRuntime !== "function") return null;
    _modelGraphRuntime = MODEL_GRAPH_CORE.createRuntime({
      clamp: clamp,
      resolveSchemaId: resolveSchemaId,
      getCurrentSchemaId: function () {
        return resolveSchemaId(state && state.modelSchemaId || "oscillator");
      },
      getSchemaPresetDefById: getSchemaPresetDefById,
      defaultParamMask: defaultParamMask,
      normalizeParamMask: normalizeParamMask,
      countStaticParams: countStaticParams,
      normalizeHistorySeriesKey: normalizeHistorySeriesKey,
      historySeriesLabel: historySeriesLabel,
      normalizeOneHotKey: normalizeOneHotKey,
      oneHotLabel: oneHotLabel,
      getImageSourceSpec: getImageSourceSpec,
      normalizeOutputTargetsList: normalizeOutputTargetsList,
      outputTargetsSummaryText: outputTargetsSummaryText,
      estimateNodeFeatureWidth: estimateNodeFeatureWidth,
      clearEditor: clearEditor,
    });
    return _modelGraphRuntime;
  }

  function getImageRenderRuntime() {
    if (_imageRenderRuntime) return _imageRenderRuntime;
    if (!IMAGE_RENDER_CORE || typeof IMAGE_RENDER_CORE.createRuntime !== "function") return null;
    _imageRenderRuntime = IMAGE_RENDER_CORE.createRuntime({
      clamp: clamp,
      createRng: createRng,
      escapeHtml: escapeHtml,
      documentRef: typeof document !== "undefined" ? document : null,
    });
    return _imageRenderRuntime;
  }

  function getTrainingActionRuntime() {
    return _trainingActionRuntime;
  }

  function getWorkspaceSelectionUiRuntime() {
    if (_workspaceSelectionUiRuntime) return _workspaceSelectionUiRuntime;
    _workspaceSelectionUiRuntime = WORKSPACE_SELECTION_UI_CORE.createRuntime({
      applySelectionState: function (cfg) {
        applyLabSelectionState(cfg);
      },
    });
    return _workspaceSelectionUiRuntime;
  }

  function getWorkspaceControllersRuntime() {
    if (_workspaceControllersRuntime) return _workspaceControllersRuntime;
    _workspaceControllersRuntime = {
      preview: WORKSPACE_CONTROLLERS_CORE.createPreviewController({
        resizePlots: function () {
          try {
            if (ui.chart && window.Plotly && Plotly.Plots) {
              resizePlotIfVisible(ui.chart);
              if (ui.evalChartSpring) resizePlotIfVisible(ui.evalChartSpring);
              if (ui.evalChartPendulum) resizePlotIfVisible(ui.evalChartPendulum);
              if (ui.evalChartBouncing) resizePlotIfVisible(ui.evalChartBouncing);
            }
          } catch (_) {}
        },
        refreshWorkspace: function () {
          refreshPlaygroundWorkspaceUi();
        },
      }),
      dataset: WORKSPACE_CONTROLLERS_CORE.createDatasetController({
        refreshModuleSelect: function () {
          refreshDatasetModuleSelect(currentDatasetModuleId() || state.activeDatasetModuleId || "oscillator");
        },
        showSubTab: function () {
          showDataLabSubTab(state.dataLabSubTab || "preview");
        },
        refreshDetailPanel: function () {
          refreshDatasetDetailPanel();
        },
        getActiveDatasetId: function () {
          return String(state.activeDatasetId || "").trim();
        },
        shouldLoadActiveDataset: function (_, activeId) {
          return String(state.renderedDatasetId || "").trim() !== String(activeId || "").trim();
        },
        loadActiveDataset: function () {
          loadSavedDatasetById(String(state.activeDatasetId || "").trim(), {
            skipUiSync: true,
            refreshLibrary: false,
          });
        },
        onError: function (err) {
          setStatus("Load dataset failed: " + (err && err.message ? err.message : String(err)));
        },
      }),
      nn: WORKSPACE_CONTROLLERS_CORE.createModelController({
        hasActiveModel: function () {
          return !!getSavedModelById(state.activeModelId);
        },
        shouldLoadActiveModel: function () {
          return String(state.renderedModelId || "").trim() !== String(state.activeModelId || "").trim();
        },
        loadActiveModel: function () {
          var activeModel = getSavedModelById(state.activeModelId);
          if (!activeModel) return;
          runAfterFirstPaint(function () {
            if (String(state.currentWorkspace || "") !== "nn") return;
            try {
              loadSavedModelById(activeModel.id);
            } catch (err) {
              setStatus("Load model failed: " + (err && err.message ? err.message : String(err)));
            }
          });
        },
        refreshSelection: function () {
          refreshModelLabSelectionState();
        },
      }),
      train: WORKSPACE_CONTROLLERS_CORE.createTrainingController({
        refreshWorkspace: function () {
          refreshSavedModelSelect();
          refreshTrainSessionSelectors();
          renderTrainSessionTable();
          updateRuntimeOptionsUi();
        },
      }),
      gen: WORKSPACE_CONTROLLERS_CORE.createGenerationController({
        resizePlots: function () {
          try {
            if (window.Plotly && Plotly.Plots) {
              if (ui.genSingleChart) resizePlotIfVisible(ui.genSingleChart);
              if (ui.genBatchChart) resizePlotIfVisible(ui.genBatchChart);
              if (ui.genQualityChart) resizePlotIfVisible(ui.genQualityChart);
            }
          } catch (_) {}
        },
        refreshWorkspace: function () {
          refreshGenerationRefOptions();
        },
      }),
      eval: WORKSPACE_CONTROLLERS_CORE.createEvaluationController({
        resizePlots: function () {
          try {
            if (ui.compareChart && window.Plotly && Plotly.Plots) resizePlotIfVisible(ui.compareChart);
          } catch (_) {}
        },
      }),
    };
    return _workspaceControllersRuntime;
  }

  function getWorkspaceLabHandlersRuntime() {
    if (_workspaceLabHandlersRuntime) return _workspaceLabHandlersRuntime;
    var controllers = getWorkspaceControllersRuntime();
    _workspaceLabHandlersRuntime = WORKSPACE_LAB_HANDLERS_CORE.createRuntime({
      afterShowHandlers: {
        preview: controllers.preview.afterShow,
        gen: controllers.gen.afterShow,
        eval: controllers.eval.afterShow,
      },
      afterPaintHandlers: {
        nn: controllers.nn.afterPaint,
        train: controllers.train.afterPaint,
        dataset: controllers.dataset.afterPaint,
        preview: controllers.preview.afterPaint,
        gen: controllers.gen.afterPaint,
      },
    });
    return _workspaceLabHandlersRuntime;
  }

  function getWorkspaceTabEffectsRuntime() {
    if (_workspaceTabEffectsRuntime) return _workspaceTabEffectsRuntime;
    var handlers = getWorkspaceLabHandlersRuntime();
    _workspaceTabEffectsRuntime = WORKSPACE_TAB_EFFECTS_CORE.createRuntime({
      afterShowHandlers: handlers.getAfterShowHandlers(),
      afterPaintHandlers: handlers.getAfterPaintHandlers(),
    });
    return _workspaceTabEffectsRuntime;
  }

  function getTabManagerRuntime() {
    if (_tabManagerRuntime) return _tabManagerRuntime;
    _tabManagerRuntime = TAB_MANAGER_CORE.createRuntime({
      initialTabId: "preview",
      defer: runAfterFirstPaint,
      getTabs: function () {
        return [
          { id: "preview", tabEl: ui.wsPreviewTab, paneEl: ui.wsPreviewPane },
          { id: "dataset", tabEl: ui.wsDatasetTab, paneEl: ui.wsDatasetPane },
          { id: "nn", tabEl: ui.wsNnTab, paneEl: ui.wsNnPane },
          { id: "train", tabEl: ui.wsTrainTab, paneEl: ui.wsTrainPane },
          { id: "gen", tabEl: ui.wsGenTab, paneEl: ui.wsGenPane },
          { id: "eval", tabEl: ui.wsEvalTab, paneEl: ui.wsEvalPane },
        ];
      },
      onApplyState: function (target) {
        var activeId = String(target || "preview");
        if (document && document.body) {
          document.body.classList.toggle("tfvis-allowed", activeId === "nn");
        }
        updateSidebarForWorkspace(activeId);
        renderLeftLibraryByWorkspace();
        refreshRightInspectorPanels();
      },
      onAfterShow: function (target) {
        getWorkspaceTabEffectsRuntime().runAfterShow(String(target || "preview"));
      },
      onAfterPaint: function (target) {
        getWorkspaceTabEffectsRuntime().runAfterPaint(String(target || "preview"));
      },
    });
    return _tabManagerRuntime;
  }

  function resolveSchemaId(schemaId) {
    return SCHEMA_REGISTRY.resolveSchemaId(schemaId, "oscillator");
  }

  function getModelSchemaConfig(schemaId) {
    const sid = resolveSchemaId(schemaId);
    return SCHEMA_REGISTRY.getModelSchema(sid) || SCHEMA_REGISTRY.getModelSchema("oscillator") || {
      id: "oscillator",
      label: "oscillator",
      outputs: [{ key: "x", label: "x" }],
      params: [],
      presets: [],
    };
  }

  function getDatasetSchemaConfig(schemaId) {
    if (DATASET_RUNTIME && typeof DATASET_RUNTIME.getDatasetSchema === "function") {
      return DATASET_RUNTIME.getDatasetSchema(schemaId);
    }
    const sid = resolveSchemaId(schemaId);
    return SCHEMA_REGISTRY.getDatasetSchema(sid) || { id: sid, label: sid, sampleType: "trajectory", splitDefaults: { mode: "random", train: 0.7, val: 0.15, test: 0.15 }, metadata: {} };
  }

  function getDatasetPreconfig(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    if (DATASET_RUNTIME && typeof DATASET_RUNTIME.getDatasetPreconfig === "function") {
      return DATASET_RUNTIME.getDatasetPreconfig(sid) || {};
    }
    return SCHEMA_REGISTRY.getDatasetPreconfig
      ? SCHEMA_REGISTRY.getDatasetPreconfig(sid) || {}
      : {};
  }

  function getDefaultModelPreset(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    if (DATASET_RUNTIME && typeof DATASET_RUNTIME.getDefaultModelPresetId === "function") {
      return String(DATASET_RUNTIME.getDefaultModelPresetId(sid) || "").trim();
    }
    return SCHEMA_REGISTRY.getDefaultModelPresetId
      ? String(SCHEMA_REGISTRY.getDefaultModelPresetId(sid) || "").trim()
      : "";
  }

  function getSchemaSplitModeDefs(schemaId) {
    if (DATASET_RUNTIME && typeof DATASET_RUNTIME.getSplitModeDefs === "function") {
      return DATASET_RUNTIME.getSplitModeDefs(schemaId);
    }
    const dsSchema = getDatasetSchemaConfig(schemaId);
    const fallbackMode = String((dsSchema && dsSchema.splitDefaults && dsSchema.splitDefaults.mode) || "random");
    return [{ id: fallbackMode, label: fallbackMode, stratifyKey: "" }];
  }

  function getSchemaDisplayColumns(schemaId) {
    if (DATASET_RUNTIME && typeof DATASET_RUNTIME.getDisplayColumns === "function") {
      return DATASET_RUNTIME.getDisplayColumns(schemaId);
    }
    return [];
  }

  function getSchemaSplitDefaults(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const dsSchema = getDatasetSchemaConfig(sid);
    const pre = getDatasetPreconfig(sid);
    const splitRaw = (pre && pre.splitDefaults) ? pre.splitDefaults : (dsSchema && dsSchema.splitDefaults) || {};
    const modeDefs = getSchemaSplitModeDefs(sid);
    return {
      mode: DATASET_PROCESSING_CORE.normalizeSplitMode(
        String(splitRaw.mode || ""),
        modeDefs,
        String((modeDefs[0] && modeDefs[0].id) || "random")
      ),
      fractions: DATASET_PROCESSING_CORE.normalizeSplitFractions(
        {
          train: Number(splitRaw.train),
          val: Number(splitRaw.val),
          test: Number(splitRaw.test),
        },
        { train: 0.7, val: 0.15, test: 0.15 }
      ),
    };
  }

  function getDatasetModuleDatasetPreconfig(moduleId, schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const normalizedModuleId = String(
      moduleId || pickDefaultDatasetModuleForSchema(sid)
    ).trim().toLowerCase();
    if (!normalizedModuleId) {
      throw new Error("Schema '" + sid + "' does not resolve to a dataset module.");
    }
    const schemaSplit = getSchemaSplitDefaults(sid);
    const modeDefs = getSchemaSplitModeDefs(sid);
    const mod = getDatasetModule(normalizedModuleId);
    const moduleDatasetPre =
      (mod && mod.preconfig && typeof mod.preconfig === "object" &&
       mod.preconfig.dataset && typeof mod.preconfig.dataset === "object")
        ? mod.preconfig.dataset
        : {};
    const splitRaw = (moduleDatasetPre.splitDefaults && typeof moduleDatasetPre.splitDefaults === "object")
      ? moduleDatasetPre.splitDefaults
      : {};
    const mode = DATASET_PROCESSING_CORE.normalizeSplitMode(
      String(splitRaw.mode || schemaSplit.mode || ""),
      modeDefs,
      schemaSplit.mode
    );
    const fractions = DATASET_PROCESSING_CORE.normalizeSplitFractions(
      {
        train: Number(splitRaw.train),
        val: Number(splitRaw.val),
        test: Number(splitRaw.test),
      },
      schemaSplit.fractions
    );
    const seedRaw = Number(moduleDatasetPre.seed);
    const totalRaw = Number(moduleDatasetPre.totalCount);
    return {
      moduleId: normalizedModuleId,
      schemaId: sid,
      mode: mode,
      fractions: fractions,
      seed: Number.isFinite(seedRaw) ? Math.floor(seedRaw) : 42,
      totalCount: Number.isFinite(totalRaw) && totalRaw > 0 ? Math.floor(totalRaw) : 1400,
    };
  }

  function fallbackUiProfileForSchema(schemaId) {
    const dsSchema = getDatasetSchemaConfig(schemaId);
    const md = (dsSchema && dsSchema.metadata && typeof dsSchema.metadata === "object") ? dsSchema.metadata : {};
    const uiMd = (md.ui && typeof md.ui === "object") ? md.ui : {};
    const sid = resolveSchemaId((dsSchema && dsSchema.id) || schemaId || "oscillator");
    const sampleType = String((dsSchema && dsSchema.sampleType) || "trajectory").trim().toLowerCase();
    const viewer = String(uiMd.viewer || "").trim().toLowerCase() || (sampleType === "image" ? "image" : "trajectory");
    const sidebarMode = String(uiMd.sidebarMode || "").trim().toLowerCase() || (sid === "oscillator" ? "oscillator" : "generic");
    return {
      sidebarMode: sidebarMode,
      viewer: viewer,
    };
  }

  function getUiProfileForSchema(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    if (DATASET_RUNTIME && typeof DATASET_RUNTIME.getUiProfile === "function") {
      const p = DATASET_RUNTIME.getUiProfile(sid);
      if (p && typeof p === "object") {
        const fallback = fallbackUiProfileForSchema(sid);
        return {
          sidebarMode: String(p.sidebarMode || "").trim().toLowerCase() || fallback.sidebarMode,
          viewer: String(p.viewer || "").trim().toLowerCase() || fallback.viewer,
        };
      }
    }
    return fallbackUiProfileForSchema(sid);
  }

  function refreshSplitModeOptionsForSchema(schemaId) {
    if (!ui || !ui.splitMode) return;
    const defs = getSchemaSplitModeDefs(schemaId);
    const cur = String(ui.splitMode.value || "");
    ui.splitMode.innerHTML = "";
    defs.forEach(function (d) {
      const op = document.createElement("option");
      op.value = d.id;
      op.textContent = d.stratifyKey
        ? (d.label + " (stratify=" + d.stratifyKey + ")")
        : d.label;
      ui.splitMode.appendChild(op);
    });
    if (!defs.length) return;
    const next = defs.some(function (d) { return String(d.id) === cur; }) ? cur : String(defs[0].id);
    ui.splitMode.value = next;
  }

  function listModelSchemas() {
    return SCHEMA_REGISTRY.listSchemas();
  }

  function listRegisteredSchemaEntries() {
    const raw = listModelSchemas();
    const out = Array.isArray(raw) ? raw
      .map(function (s) {
        if (!s || typeof s !== "object") return null;
        const sid = resolveSchemaId(s.id || "oscillator");
        return {
          id: sid,
          label: String(s.label || sid),
          description: String(s.description || ""),
        };
      })
      .filter(Boolean)
      : [];
    if (out.length) return out;
    const sid = resolveSchemaId("oscillator");
    return [{ id: sid, label: sid, description: "" }];
  }

  function schemaLabelById(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const hit = listRegisteredSchemaEntries().find(function (x) { return String(x.id || "") === sid; });
    return String((hit && (hit.label || hit.id)) || sid);
  }

  function listDatasetModules() {
    if (DATASET_RUNTIME && typeof DATASET_RUNTIME.listModules === "function") {
      return DATASET_RUNTIME.listModules();
    }
    return [{
      id: "oscillator",
      schemaId: "oscillator",
      label: "Oscillator",
      description: "RK4 oscillator dataset builder",
      kind: "builtin_sidebar",
    }];
  }

  function getDatasetModule(moduleId) {
    const id = String(moduleId || "").trim().toLowerCase();
    if (DATASET_RUNTIME && typeof DATASET_RUNTIME.getModule === "function") {
      return DATASET_RUNTIME.getModule(id);
    }
    return null;
  }

  function listDatasetModulesForSchema(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    if (DATASET_RUNTIME && typeof DATASET_RUNTIME.getModulesForSchema === "function") {
      const mods = DATASET_RUNTIME.getModulesForSchema(sid);
      if (Array.isArray(mods) && mods.length) return mods;
    }
    return listDatasetModules().filter(function (m) {
      return resolveSchemaId((m && m.schemaId) || "oscillator") === sid;
    });
  }

  function pickDefaultDatasetModuleForSchema(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    if (DATASET_RUNTIME && typeof DATASET_RUNTIME.pickDefaultModuleForSchema === "function") {
      const picked = String(DATASET_RUNTIME.pickDefaultModuleForSchema(sid) || "").trim().toLowerCase();
      if (picked) return picked;
    }
    const pre = getDatasetPreconfig(sid);
    const declared = String((pre && pre.defaultModuleId) || "").trim().toLowerCase();
    if (declared) {
      const mod = getDatasetModule(declared);
      if (!mod) {
        throw new Error("Schema '" + sid + "' declares defaultModuleId '" + declared + "' but no matching dataset module is registered.");
      }
      return declared;
    }
    throw new Error("Schema '" + sid + "' does not declare dataset.preconfig.defaultModuleId.");
  }

  function splitModeDefsToInlineText(defs) {
    const arr = Array.isArray(defs) ? defs : [];
    return arr.map(function (d) {
      if (!d || typeof d !== "object") return "";
      const id = String(d.id || "").trim();
      if (!id) return "";
      const sk = String(d.stratifyKey || "").trim();
      return sk ? (id + "(stratify=" + sk + ")") : id;
    }).filter(Boolean).join(", ");
  }

  function buildSchemaHelpTextFallback(schemaId, descriptionText) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const splitDefs = getSchemaSplitModeDefs(sid);
    const displayCols = getSchemaDisplayColumns(sid);
    const desc = String(descriptionText || ("Dataset builder for schema '" + sid + "'."));
    return desc +
      " | split modes: " + (splitModeDefsToInlineText(splitDefs) || "-") +
      " | columns: " + (displayCols.join(", ") || "-");
  }

  function getDatasetModuleHelpText(moduleId, schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const mid = String(moduleId || "").trim().toLowerCase() || pickDefaultDatasetModuleForSchema(sid);
    const mod = getDatasetModule(mid);
    if (mod && typeof mod.getHelpText === "function") {
      try {
        const txt = String(mod.getHelpText({ schemaId: sid, moduleId: mid }) || "").trim();
        if (txt) return txt;
      } catch (_err) {
        // fallback below
      }
    }
    const moduleHelp = String((mod && mod.helpText) || "").trim();
    if (moduleHelp) return moduleHelp;
    const desc = String((mod && mod.description) || "");
    return buildSchemaHelpTextFallback(sid, desc);
  }

  function currentDatasetModuleId() {
    const activeEntry = state && state.activeDatasetId ? getSavedDatasetById(state.activeDatasetId) : null;
    const fromActive = String((activeEntry && activeEntry.data && activeEntry.data.datasetModuleId) || "").trim().toLowerCase();
    if (fromActive) return fromActive;
    const fromState = String((state && state.activeDatasetModuleId) || "").trim().toLowerCase();
    if (fromState) return fromState;
    const schemaId = resolveSchemaId(
      (activeEntry && activeEntry.schemaId) ||
      (state && state.dataset && state.dataset.schemaId) ||
      ""
    );
    if (schemaId) return String(pickDefaultDatasetModuleForSchema(schemaId) || "").trim().toLowerCase();
    return "";
  }

  function setActiveDatasetModuleId(moduleId, schemaId) {
    const sid = resolveSchemaId(
      schemaId ||
      (state && state.activeDatasetId && getSavedDatasetById(state.activeDatasetId) && getSavedDatasetSchemaId(getSavedDatasetById(state.activeDatasetId), "oscillator")) ||
      (state && state.dataset && state.dataset.schemaId) ||
      "oscillator"
    );
    const resolved = String(moduleId || "").trim().toLowerCase() || String(pickDefaultDatasetModuleForSchema(sid) || "").trim().toLowerCase();
    const mod = getDatasetModule(resolved);
    if (!mod) {
      throw new Error("Dataset module '" + resolved + "' is not registered.");
    }
    const modSchemaId = resolveSchemaId(mod.schemaId || sid);
    if (modSchemaId !== sid) {
      throw new Error("Dataset module '" + resolved + "' does not belong to schema '" + sid + "'.");
    }
    state.activeDatasetModuleId = resolved;
    if (ui.datasetModuleSelect) ui.datasetModuleSelect.value = resolved;
    return resolved;
  }

  function currentPlaygroundSchemaId() {
    const raw = String((state && state.playgroundSchemaId) || "").trim();
    return raw ? resolveSchemaId(raw) : "";
  }

  function getLatestSavedDatasetEntryForSchema(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const activeId = String(state.activeDatasetId || "").trim();
    const activeEntry = activeId ? getSavedDatasetById(activeId) : null;
    if (activeEntry && getSavedDatasetSchemaId(activeEntry, sid) === sid) return activeEntry;
    const matches = (state.savedDatasets || []).filter(function (entry) {
      return getSavedDatasetSchemaId(entry, sid) === sid && entry && entry.data && !entry.data.draft;
    });
    if (!matches.length) return null;
    matches.sort(function (a, b) {
      return Number((b && (b.updatedAt || b.createdAt)) || 0) - Number((a && (a.updatedAt || a.createdAt)) || 0);
    });
    return matches[0] || null;
  }

  function getWorkspaceDatasetModuleId(workspaceName) {
    const ws = String(workspaceName || state.currentWorkspace || "").trim().toLowerCase();
    if (ws === "preview") {
      return getCurrentPlaygroundModuleId() || currentDatasetModuleId();
    }
    return currentDatasetModuleId();
  }

  function getCurrentPlaygroundModuleId() {
    const schemaId = currentPlaygroundSchemaId();
    if (!schemaId) return "";
    return String(pickDefaultDatasetModuleForSchema(schemaId) || "").trim().toLowerCase();
  }

  function getCurrentPlaygroundModule() {
    const moduleId = getCurrentPlaygroundModuleId();
    return moduleId ? getDatasetModule(moduleId) : null;
  }

  function getDatasetModuleUiCapability(capabilityName, workspaceName) {
    const capability = String(capabilityName || "").trim();
    if (!capability) return null;
    const ids = [
      getWorkspaceDatasetModuleId(workspaceName || state.currentWorkspace || ""),
      currentDatasetModuleId(),
      getCurrentPlaygroundModuleId(),
    ];
    const seen = new Set();
    for (let i = 0; i < ids.length; i += 1) {
      const moduleId = String(ids[i] || "").trim().toLowerCase();
      if (!moduleId || seen.has(moduleId)) continue;
      seen.add(moduleId);
      const mod = getDatasetModule(moduleId);
      const uiApi = mod && mod.uiApi;
      if (uiApi && typeof uiApi[capability] === "function") {
        return { moduleId, module: mod, uiApi };
      }
    }
    return null;
  }

  function applyDatasetModuleWorkspaceUi(workspace, activeModuleId) {
    const modules = listDatasetModules();
    const ctx = {
      workspace: String(workspace || state.currentWorkspace || "").trim().toLowerCase(),
      activeModuleId: String(activeModuleId || currentDatasetModuleId() || "").trim().toLowerCase(),
      ui: ui,
      document: (typeof document !== "undefined") ? document : null,
      state: state,
    };
    modules.forEach(function (mod) {
      if (!mod || !mod.uiApi || typeof mod.uiApi.applyWorkspaceState !== "function") return;
      mod.uiApi.applyWorkspaceState(ctx);
    });
  }

  function buildDatasetModuleUiContext() {
    const activeModuleId = getWorkspaceDatasetModuleId(state.currentWorkspace || "");
    const activeModule = activeModuleId ? getDatasetModule(activeModuleId) : null;
    const activeSchemaId = resolveSchemaId((activeModule && activeModule.schemaId) || currentPlaygroundSchemaId() || "");
    return {
      ui: ui,
      state: state,
      activeModuleId: activeModuleId,
      activeSchemaId: activeSchemaId,
      showWorkspaceTab: showWorkspaceTab,
      getCurrentWorkspace: function () { return String(state.currentWorkspace || "preview"); },
      clamp: clamp,
      randInRange: randInRange,
      getStepsFromDuration: getStepsFromDuration,
      presetLimits: PRESET_LIMITS,
      simulateOscillator: simulateOscillator,
      plotTrajectories: plotTrajectories,
      plotPreviewSplitByScenario: plotPreviewSplitByScenario,
      syncPreviewTimeControls: syncPreviewTimeControls,
      schedulePreviewRefresh: schedulePreviewRefresh,
      normalizeSplitFractionsFromUi: normalizeSplitFractionsFromUi,
      syncImageSplitCountsFromFractions: syncImageSplitCountsFromFractions,
      getSchemaSplitModeDefs: getSchemaSplitModeDefs,
      getRequestedDatasetMode: resolveRequestedDatasetMode,
      getActiveWindowSize: getActiveWindowSize,
      inferFeatureSpecForMode: function (mode, fallback) {
        return inferFeatureSpecFromDrawflow(state.editor, mode, fallback);
      },
      inferTargetModeForGraph: function (fallbackTarget) {
        return inferTargetModeFromDrawflow(state.editor, fallbackTarget || "x");
      },
      getModuleConfigState: function (scope, defaults, moduleIdOverride) {
        return getModuleConfigState(scope, moduleIdOverride || activeModuleId || "", defaults || {});
      },
      setModuleConfigState: function (scope, nextValue, moduleIdOverride) {
        return setModuleConfigState(scope, moduleIdOverride || activeModuleId || "", nextValue || {});
      },
      patchModuleConfigState: function (scope, patch, moduleIdOverride) {
        return patchModuleConfigState(scope, moduleIdOverride || activeModuleId || "", patch || {});
      },
      listSavedDatasetsForSchema: function (schemaId) {
        const sid = resolveSchemaId(schemaId || activeSchemaId || "oscillator");
        return sortRowsByUpdatedThenCreated(state.savedDatasets
          .map(function (entry) {
            if (!entry) return null;
            const id = String(entry.id || "").trim();
            if (!id) return null;
            if (getSavedDatasetSchemaId(entry, sid) !== sid) return null;
            return {
              id: id,
              name: String(entry.name || id),
              schemaId: sid,
              updatedAt: Number(entry.updatedAt || 0),
              createdAt: Number(entry.createdAt || 0),
              data: entry.data || null,
            };
          })
          .filter(Boolean));
      },
      getSavedDatasetById: function (datasetId) {
        return getSavedDatasetById(datasetId);
      },
      getLatestSavedDatasetEntryForSchema: function (schemaId) {
        return getLatestSavedDatasetEntryForSchema(schemaId);
      },
      triggerDatasetBuild: function () {
        if (ui.genDatasetBtn) ui.genDatasetBtn.click();
      },
      refreshDatasetConfigPanel: function () {
        const moduleId = getWorkspaceDatasetModuleId("dataset");
        if (moduleId) renderDatasetConfigPanel(moduleId);
      },
      refreshPlaygroundConfigPanel: function () {
        const moduleId = getWorkspaceDatasetModuleId("preview");
        if (moduleId) renderPlaygroundConfigPanel(moduleId);
      },
      refreshPlaygroundWorkspace: function () {
        refreshPlaygroundWorkspaceUi();
      },
      updateQuickCompareInfo: updateQuickCompareInfo,
      resetScenarioCardDefaults: resetScenarioCardDefaults,
      randomizePreviewCards: randomizePreviewCards,
      setStatus: setStatus,
      setPreviewCompareLock: function (next) { state.previewCompareLock = Boolean(next); },
      setLastSweepSig: function (nextSig) { state.lastSweepSig = String(nextSig || ""); },
      runPreview: runPreview,
      runQuickCompare: function () {
        const targetSchemaId = resolveSchemaId((activeModule && activeModule.schemaId) || "");
        if (targetSchemaId && currentPlaygroundSchemaId() !== targetSchemaId) {
          state.playgroundSchemaId = targetSchemaId;
          renderLeftPlaygroundSchemaItems();
        }
        cancelPreviewRefresh();
        state.previewCompareLock = true;
        updateQuickCompareInfo();
        dispatchPlaygroundAction("quick_compare");
      },
      runParameterSweep: function () {
        const targetSchemaId = resolveSchemaId((activeModule && activeModule.schemaId) || "");
        if (targetSchemaId && currentPlaygroundSchemaId() !== targetSchemaId) {
          state.playgroundSchemaId = targetSchemaId;
          renderLeftPlaygroundSchemaItems();
        }
        cancelPreviewRefresh();
        state.previewCompareLock = true;
        state.sweepRunCount += 1;
        dispatchPlaygroundAction("parameter_sweep");
      },
    };
  }

  function buildDatasetModuleCapabilityContext(extra) {
    return Object.assign({}, buildDatasetModuleUiContext(), extra || {});
  }

  function bindDatasetModuleUi() {
    const modules = listDatasetModules();
    const ctx = buildDatasetModuleUiContext();
    modules.forEach(function (mod) {
      if (!mod || !mod.uiApi || typeof mod.uiApi.bindUi !== "function") return;
      mod.uiApi.bindUi(ctx);
    });
  }

  function inferDatasetSchemaFromDataEntry(data) {
    const d = data || {};
    if (Array.isArray(d.trajectories) && d.trajectories.length) {
      return "oscillator";
    }
    if (Array.isArray(d.records) || (d.records && typeof d.records === "object")) {
      const rec = d.records || {};
      if (rec.train || rec.val || rec.test) {
        const train = rec.train && typeof rec.train === "object" ? rec.train : null;
        const hasTrainX = train && Array.isArray(train.x);
        const hasLabel = train && Array.isArray(train.y);
        if (hasTrainX && hasLabel) return "";
      }
      return "";
    }
    if (d.mode && typeof d.mode === "string") {
      const mode = String(d.mode).trim().toLowerCase();
      if (mode === "classification") return "";
      if (mode === "autoregressive" || mode === "direct") return "oscillator";
    }
    if (Array.isArray(d.splitCounts) || Array.isArray(d.splitConfig)) {
      return "";
    }
    if (Array.isArray(d.xTrain) || Array.isArray(d.yTrain) || Array.isArray(d.trainRows)) {
      return "";
    }
    return "";
  }

  function datasetSchemaIdOf(entry, fallbackSchemaId) {
    const d = entry || {};
    const data = (d.data && typeof d.data === "object") ? d.data : null;

    const inferredFromModule = function (moduleId) {
      const m = getDatasetModule(moduleId);
      const ms = String((m && m.schemaId) || "").trim().toLowerCase();
      const normalized = resolveSchemaId(ms || moduleId);
      return normalized || "";
    };

    const candidateFromData = inferDatasetSchemaFromDataEntry(data);
    return resolveSchemaId(
      (d.data && typeof d.data === "object" && data.datasetModuleId ? inferredFromModule(data.datasetModuleId) : "") ||
      (d.datasetModuleId && inferredFromModule(d.datasetModuleId)) ||
      (d.moduleId && inferredFromModule(d.moduleId)) ||
      candidateFromData ||
      d.schemaId ||
      (data && (data.schemaId || data.datasetSchemaId)) ||
      fallbackSchemaId ||
      "oscillator"
    );
  }

  function modelSchemaIdOf(entry, fallbackSchemaId) {
    const m = entry || {};
    return resolveSchemaId(m.schemaId || m.modelSchemaId || fallbackSchemaId || "oscillator");
  }

  function getSchemaPresetDefs(schemaId) {
    const sid = resolveSchemaId(schemaId);
    if (typeof SCHEMA_REGISTRY.getPresetDefs === "function") {
      const defs = SCHEMA_REGISTRY.getPresetDefs(sid);
      if (Array.isArray(defs) && defs.length) return defs;
    }
    const schema = getModelSchemaConfig(sid);
    const raw = Array.isArray(schema && schema.presets) ? schema.presets : [];
    const defs = [];
    raw.forEach(function (p) {
      if (typeof p === "string" || typeof p === "number") {
        const id = String(p || "").trim();
        if (id) defs.push({ id: id, label: id });
        return;
      }
      if (!p || typeof p !== "object") return;
      const id = String((p.id != null ? p.id : (p.key != null ? p.key : "")) || "").trim();
      if (!id) return;
      defs.push({ id: id, label: String((p.label != null ? p.label : id) || id) });
    });
    return defs;
  }

  function getSchemaPresetDefById(schemaId, presetId) {
    const sid = resolveSchemaId(schemaId);
    const pid = String(presetId || "").trim();
    if (!pid) return null;
    const schema = getModelSchemaConfig(sid);
    const raw = Array.isArray(schema && schema.presets) ? schema.presets : [];
    for (let i = 0; i < raw.length; i += 1) {
      const item = raw[i];
      if (!item || typeof item !== "object") continue;
      const id = String((item.id != null ? item.id : (item.key != null ? item.key : "")) || "").trim();
      if (id === pid) return item;
    }
    return null;
  }

  function schemaOutputKeys(schemaId) {
    const sid = resolveSchemaId(schemaId);
    return SCHEMA_REGISTRY.getOutputKeys(sid);
  }

  function getSchemaHistorySeriesDefs(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const schema = getModelSchemaConfig(sid);
    const md = (schema && schema.metadata && schema.metadata.featureNodes) ? schema.metadata.featureNodes : {};
    const raw = Array.isArray(md.historySeries) ? md.historySeries : [];
    const out = raw
      .map(function (x) {
        if (!x || typeof x !== "object") return null;
        const key = String(x.key || "").trim().toLowerCase();
        if (!key) return null;
        return { key: key, label: String(x.label || key) };
      })
      .filter(Boolean);
    if (out.length) return out;
    const dsSchema = getDatasetSchemaConfig(sid);
    const sampleType = String(dsSchema && dsSchema.sampleType || "").trim().toLowerCase();
    if (sampleType === "image") return [];
    return [{ key: "x", label: "x(t)" }, { key: "v", label: "v(t)" }];
  }

  function getSchemaOneHotDefs(schemaId) {
    const schema = getModelSchemaConfig(schemaId);
    const md = (schema && schema.metadata && schema.metadata.featureNodes) ? schema.metadata.featureNodes : {};
    const raw = Array.isArray(md.oneHot) ? md.oneHot : [];
    const out = raw
      .map(function (x) {
        if (!x || typeof x !== "object") return null;
        const key = String(x.key || "").trim().toLowerCase();
        if (!key) return null;
        return {
          key: key,
          label: String(x.label || key),
          values: Array.isArray(x.values) ? x.values.map(function (v) { return String(v); }) : [],
        };
      })
      .filter(Boolean);
    if (out.length) return out;
    return [{ key: "scenario", label: "scenario", values: ["spring", "pendulum", "bouncing"] }];
  }

  function getSchemaFeatureNodePolicy(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const schema = getModelSchemaConfig(sid);
    const dsSchema = getDatasetSchemaConfig(sid);
    const md = (schema && schema.metadata && schema.metadata.featureNodes) ? schema.metadata.featureNodes : {};
    const rawPolicy = (md && typeof md.policy === "object") ? md.policy : {};
    const sampleType = String(dsSchema && dsSchema.sampleType || "").trim().toLowerCase();
    const imageDefault = sampleType === "image";
    return {
      allowHistory: rawPolicy.allowHistory !== undefined ? Boolean(rawPolicy.allowHistory) : !imageDefault,
      allowWindowHistory: rawPolicy.allowWindowHistory !== undefined ? Boolean(rawPolicy.allowWindowHistory) : !imageDefault,
      allowParams: rawPolicy.allowParams !== undefined ? Boolean(rawPolicy.allowParams) : !imageDefault,
      allowOneHot: rawPolicy.allowOneHot !== undefined ? Boolean(rawPolicy.allowOneHot) : true,
      allowImageSource: rawPolicy.allowImageSource !== undefined ? Boolean(rawPolicy.allowImageSource) : imageDefault,
    };
  }

  function getSchemaImageSourceDefs(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const schema = getModelSchemaConfig(sid);
    const dsSchema = getDatasetSchemaConfig(sid);
    const md = (schema && schema.metadata && schema.metadata.featureNodes) ? schema.metadata.featureNodes : {};
    const raw = Array.isArray(md.imageSource) ? md.imageSource : [];
    const out = raw
      .map(function (x) {
        if (!x || typeof x !== "object") return null;
        const key = String(x.key || "").trim().toLowerCase();
        if (!key) return null;
        const shape = Array.isArray(x.shape) ? x.shape.map(function (n) { return Math.max(1, Number(n) || 1); }) : [];
        let featureSize = Number(x.featureSize);
        if (!Number.isFinite(featureSize) || featureSize < 1) {
          featureSize = shape.length
            ? shape.reduce(function (acc, n) { return acc * Math.max(1, Number(n) || 1); }, 1)
            : 784;
        }
        return {
          key: key,
          label: String(x.label || key),
          featureSize: Math.max(1, Math.round(featureSize)),
          shape: shape,
        };
      })
      .filter(Boolean);
    if (out.length) return out;
    const sampleType = String(dsSchema && dsSchema.sampleType || "").trim().toLowerCase();
    if (sampleType === "image") {
      return [{ key: "pixel_values", label: "pixel values (28x28)", featureSize: 784, shape: [28, 28, 1] }];
    }
    return [];
  }

  function normalizeOneHotKey(raw, schemaId) {
    const defs = getSchemaOneHotDefs(schemaId);
    const allowed = defs.map(function (x) { return String(x.key || ""); });
    const key = String(raw || "").trim().toLowerCase();
    if (allowed.indexOf(key) >= 0) return key;
    return allowed.length ? allowed[0] : "scenario";
  }

  function oneHotLabel(key, schemaId) {
    const kk = normalizeOneHotKey(key, schemaId);
    const defs = getSchemaOneHotDefs(schemaId);
    const hit = defs.find(function (x) { return String(x.key || "") === kk; });
    return String((hit && hit.label) || kk);
  }

  function normalizeHistorySeriesKey(raw, schemaId) {
    const defs = getSchemaHistorySeriesDefs(schemaId);
    const allowed = defs.map(function (x) { return String(x.key || ""); });
    const key = String(raw || "").trim().toLowerCase();
    if (allowed.indexOf(key) >= 0) return key;
    return allowed.length ? allowed[0] : "x";
  }

  function historySeriesLabel(key, schemaId) {
    const kk = normalizeHistorySeriesKey(key, schemaId);
    const defs = getSchemaHistorySeriesDefs(schemaId);
    const hit = defs.find(function (x) { return String(x.key || "") === kk; });
    return String((hit && hit.label) || kk);
  }

  function normalizeImageSourceKey(raw, schemaId) {
    const defs = getSchemaImageSourceDefs(schemaId);
    const allowed = defs.map(function (x) { return String(x.key || ""); });
    const key = String(raw || "").trim().toLowerCase();
    if (allowed.indexOf(key) >= 0) return key;
    return allowed.length ? allowed[0] : "pixel_values";
  }

  function imageSourceLabel(key, schemaId) {
    const kk = normalizeImageSourceKey(key, schemaId);
    const defs = getSchemaImageSourceDefs(schemaId);
    const hit = defs.find(function (x) { return String(x.key || "") === kk; });
    return String((hit && hit.label) || kk);
  }

  function getImageSourceSpec(rawSourceKey, schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const defs = getSchemaImageSourceDefs(sid);
    const key = normalizeImageSourceKey(rawSourceKey || "", sid);
    const hit = defs.find(function (x) { return String(x.key || "") === key; }) || defs[0] || null;
    const shapeRaw = (hit && Array.isArray(hit.shape)) ? hit.shape : [];
    const h = Math.max(1, Math.round(Number(shapeRaw[0] || 1)));
    const w = Math.max(1, Math.round(Number(shapeRaw[1] || 1)));
    const c = Math.max(1, Math.round(Number(shapeRaw[2] || 1)));
    const fallbackSize = Math.max(1, h * w * c);
    const featureSize = Math.max(1, Math.round(Number((hit && hit.featureSize) || fallbackSize)));
    return {
      schemaId: sid,
      sourceKey: key,
      label: imageSourceLabel(key, sid),
      featureSize: featureSize,
      shape: [h, w, c],
      height: h,
      width: w,
      channels: c,
    };
  }

  function normalizeOutputTargetsList(raw, fallbackTargets, schemaId) {
    const allowed = schemaOutputKeys(schemaId);
    const defaultTarget = allowed.indexOf("x") >= 0
      ? "x"
      : (allowed.indexOf("logits") >= 0 ? "logits" : String(allowed[0] || "x"));
    let list = [];
    if (Array.isArray(raw)) {
      list = raw.map(function (x) { return String(x || "").trim().toLowerCase(); });
    } else if (typeof raw === "string") {
      list = raw.split(",").map(function (x) { return String(x || "").trim().toLowerCase(); });
    } else if (raw != null) {
      list = [String(raw || "").trim().toLowerCase()];
    }
    list = list.filter(function (x) { return x && allowed.indexOf(x) >= 0; });
    if (!list.length) {
      const fb = Array.isArray(fallbackTargets) ? fallbackTargets : [String(fallbackTargets || defaultTarget)];
      list = fb.map(function (x) { return String(x || "").trim().toLowerCase(); })
        .filter(function (x) { return x && allowed.indexOf(x) >= 0; });
    }
    if (!list.length) list = [defaultTarget];
    const uniq = [];
    list.forEach(function (x) {
      if (uniq.indexOf(x) < 0) uniq.push(x);
    });
    if (uniq.indexOf("xv") >= 0) {
      return uniq.filter(function (x) { return x !== "x" && x !== "v"; });
    }
    return uniq;
  }

  function outputTargetsFromNodeData(data, schemaId, fallbackTarget) {
    const d = data || {};
    const allowed = schemaOutputKeys(schemaId);
    const defaultTarget = allowed.indexOf("x") >= 0
      ? "x"
      : (allowed.indexOf("logits") >= 0 ? "logits" : String(allowed[0] || "x"));
    const raw = (Array.isArray(d.targets) && d.targets.length) ? d.targets
      : (typeof d.targetsCsv === "string" ? d.targetsCsv : (d.targetType || d.target || fallbackTarget || defaultTarget));
    return normalizeOutputTargetsList(raw, [String(fallbackTarget || d.targetType || d.target || defaultTarget)], schemaId);
  }

  function writeOutputTargetsToNodeData(data, targets, schemaId) {
    const allowed = schemaOutputKeys(schemaId);
    const defaultTarget = allowed.indexOf("x") >= 0
      ? "x"
      : (allowed.indexOf("logits") >= 0 ? "logits" : String(allowed[0] || "x"));
    const t = normalizeOutputTargetsList(targets, [defaultTarget], schemaId);
    const d = Object.assign({}, data || {});
    d.targets = t.slice();
    d.targetsCsv = t.join(",");
    d.target = t[0];
    d.targetType = t[0];
    return d;
  }

  function outputTargetsSummaryText(targets, schemaId) {
    const allowed = schemaOutputKeys(schemaId);
    const defaultTarget = allowed.indexOf("x") >= 0
      ? "x"
      : (allowed.indexOf("logits") >= 0 ? "logits" : String(allowed[0] || "x"));
    const t = normalizeOutputTargetsList(targets, [defaultTarget], schemaId);
    return "targets=[" + t.join(",") + "]";
  }

  function outputTargetDefaultForSchema(schemaId) {
    const allowed = schemaOutputKeys(schemaId);
    if (allowed.indexOf("x") >= 0) return "x";
    if (allowed.indexOf("logits") >= 0) return "logits";
    return String(allowed[0] || "x");
  }

  function isClassificationOutputTarget(targetKey) {
    const t = String(targetKey || "").trim().toLowerCase();
    return t === "logits" || t === "label";
  }

  function classifyLossOptionsForTargets(targets) {
    const list = Array.isArray(targets) ? targets : [];
    const hasClassTarget = list.some(function (t) { return isClassificationOutputTarget(t); });
    if (hasClassTarget) {
      return [
        { value: "sparse_cross_entropy", label: "cross_entropy (sparse)" },
        { value: "categorical_cross_entropy", label: "cross_entropy (one-hot)" },
        { value: "mse", label: "mse" },
        { value: "mae", label: "mae" },
        { value: "huber", label: "huber" },
      ];
    }
    return [
      { value: "mse", label: "mse" },
      { value: "mae", label: "mae" },
      { value: "huber", label: "huber" },
    ];
  }

  function normalizeHeadLossType(rawLoss, targets) {
    const opts = classifyLossOptionsForTargets(targets);
    const allowed = opts.map(function (o) { return String(o.value || ""); });
    let v = String(rawLoss || "").trim().toLowerCase();
    if (v === "cross_entropy") v = "sparse_cross_entropy";
    if (allowed.indexOf(v) >= 0) return v;
    return String(opts[0] && opts[0].value || "mse");
  }

  function shouldUseFromLogits(rawValue, targets, lossType) {
    const hasClassTarget = (Array.isArray(targets) ? targets : []).some(function (t) { return isClassificationOutputTarget(t); });
    if (!hasClassTarget) return false;
    const normalizedLoss = normalizeHeadLossType(lossType, targets);
    if (normalizedLoss !== "sparse_cross_entropy" && normalizedLoss !== "categorical_cross_entropy") return false;
    if (rawValue == null || rawValue === "") return true;
    return Boolean(rawValue);
  }

  function resolveHeadLossType(lossType, fromLogits) {
    const v = String(lossType || "mse");
    if (v === "mse") return "meanSquaredError";
    if (v === "mae") return "meanAbsoluteError";
    if (v === "huber") return "huberLoss";
    if (v === "sparse_cross_entropy") {
      return Boolean(fromLogits) ? "sparseCrossEntropyFromLogits" : "sparseCrossEntropy";
    }
    if (v === "categorical_cross_entropy") {
      return Boolean(fromLogits) ? "categoricalCrossEntropyFromLogits" : "categoricalCrossEntropy";
    }
    return DEFAULT_LOSS_TYPE;
  }

  const EQUATIONS_HTML = {
    spring:
      "<div>d<sup>2</sup>x/dt<sup>2</sup> + (c/m) dx/dt + (k/m) x = 0</div>" +
      "<div style='opacity:.9;margin-top:4px;'>Equivalent: m d<sup>2</sup>x/dt<sup>2</sup> + c dx/dt + kx = 0</div>",
    pendulum:
      "<div>d<sup>2</sup>&theta;/dt<sup>2</sup> + (c/m) d&theta;/dt + (g/&ell;) sin(&theta;) = 0</div>" +
      "<div style='opacity:.9;margin-top:4px;'>State: [&theta;, &omega;], &omega; = d&theta;/dt, g is global.</div>",
    bouncingRigid:
      "<div>d<sup>2</sup>y/dt<sup>2</sup> + (c/m) v + (c/m)|v|v + g = 0</div>" +
      "<div style='opacity:.9;margin-top:4px;'>|v|v means abs(v)·v (quadratic drag). Impact at y=0: v<sup>+</sup> = -e v<sup>-</sup>.</div>" +
      "<div style='opacity:.9;'>g is global.</div>",
    bouncingCompliant:
      "<div>d<sup>2</sup>y/dt<sup>2</sup> + (c/m) v + (c/m)|v|v + g - F<sub>c</sub>/m = 0</div>" +
      "<div style='opacity:.9;margin-top:4px;'>&delta; = max(0, -y), d&delta;/dt = max(0, -v)</div>" +
      "<div style='opacity:.9;'>F<sub>c</sub> = k<sub>g</sub>&delta; + c<sub>g</sub> d&delta;/dt</div>",
  };

  function getYAxisLabel(scenario) {
    if (scenario === "bouncing") return "height y(t) [m]";
    if (scenario === "pendulum") return "angle θ(t) [rad]";
    return "displacement x(t)";
  }

  function getEvalYAxisLabel(scenario, targetMode) {
    return String(targetMode || "x") === "v" ? "velocity v(t)" : getYAxisLabel(scenario);
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function getStepsFromDuration(durationSec, dt) {
    const h = Math.max(1e-6, Number(dt) || 0.02);
    const T = Math.max(h, Number(durationSec) || 1);
    return Math.max(2, Math.floor(T / h) + 1);
  }

  function getActiveWindowSize() {
    return inferArHistoryConfigFromDrawflow(state && state.editor ? state.editor : null, 20).windowSize;
  }

  function getArWarmupStepsFromUI() {
    if (!ui || !ui.arWarmupSteps) return undefined;
    const raw = Number(ui.arWarmupSteps.value);
    if (!Number.isFinite(raw)) return undefined;
    return Math.max(0, Math.floor(raw));
  }

  function getFeatureConfigFromUI(ui) {
    // Feature selection is fixed by pipeline (not user-toggled):
    // AR uses x-history + v-history + params.
    return { useX: true, useV: true, useParams: true };
  }

  function enforcePredictionModeFeaturePolicy(ui, opts) {
    // Feature checkboxes were removed from UI; policy is fixed in pipeline code.
    void ui;
    void opts;
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

  function isFeatureSpecEqual(a, b, mode) {
    const aa = normalizeFeatureSpec(a, mode);
    const bb = normalizeFeatureSpec(b, mode);
    return aa.useX === bb.useX &&
      aa.useV === bb.useV &&
      aa.useParams === bb.useParams &&
      aa.useTimeSec === bb.useTimeSec &&
      aa.useTimeNorm === bb.useTimeNorm &&
      aa.useScenario === bb.useScenario &&
      aa.useSinNorm === bb.useSinNorm &&
      aa.useCosNorm === bb.useCosNorm &&
      aa.useNoiseSchedule === bb.useNoiseSchedule;
  }

  function getDatasetScenarioSelection(uiOverride) {
    const resolved = getDatasetModuleUiCapability("getDatasetScenarioSelection");
    if (!resolved) return [];
    const ctx = buildDatasetModuleUiContext();
    if (uiOverride && uiOverride !== ui) ctx.ui = uiOverride;
    const out = resolved.uiApi.getDatasetScenarioSelection(ctx);
    return Array.isArray(out) ? out : [];
  }

  function getDatasetModuleScopedState(scope, workspaceName) {
    const normalizedScope = String(scope || "").trim().toLowerCase();
    const capability = normalizedScope === "dataset" ? "getDatasetState" : "getPlaygroundState";
    const resolved = getDatasetModuleUiCapability(capability, workspaceName || state.currentWorkspace || "");
    if (!resolved) return null;
    const ctx = buildDatasetModuleCapabilityContext({
      activeModuleId: resolved.moduleId,
      activeSchemaId: resolveSchemaId((resolved.module && resolved.module.schemaId) || ""),
    });
    const out = resolved.uiApi[capability](ctx);
    return (out && typeof out === "object") ? out : null;
  }

  function defaultParamMask() {
    return { m: true, c: true, k: true, e: true, x0: true, v0: true, gm: true, gk: true, gc: true, rkm: false, rcm: false, rgl: false };
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

  function countStaticParams(paramMask) {
    const pm = normalizeParamMask(paramMask);
    return (pm.m ? 1 : 0) + (pm.c ? 1 : 0) + (pm.k ? 1 : 0) + (pm.e ? 1 : 0) + (pm.x0 ? 1 : 0) + (pm.v0 ? 1 : 0) + (pm.gm ? 1 : 0) + (pm.gk ? 1 : 0) + (pm.gc ? 1 : 0) + (pm.rkm ? 1 : 0) + (pm.rcm ? 1 : 0) + (pm.rgl ? 1 : 0);
  }

  function staticParamNames(paramMask) {
    const pm = normalizeParamMask(paramMask);
    const out = [];
    if (pm.m) out.push("m");
    if (pm.c) out.push("c");
    if (pm.k) out.push("k");
    if (pm.e) out.push("e");
    if (pm.x0) out.push("x0");
    if (pm.v0) out.push("v0");
    if (pm.gm) out.push("gm");
    if (pm.gk) out.push("gk");
    if (pm.gc) out.push("gc");
    if (pm.rkm) out.push("rkm");
    if (pm.rcm) out.push("rcm");
    if (pm.rgl) out.push("rgl");
    return out;
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

  function noiseScheduleFeatures(tNorm) {
    const tau = clamp(Number(tNorm) || 0, 0, 1);
    const betaMin = 1e-4;
    const betaMax = 2e-2;
    const betaT = betaMin + (betaMax - betaMin) * tau;
    const alphaBar = Math.exp(-(betaMin * tau + 0.5 * (betaMax - betaMin) * tau * tau));
    const sigmaT = Math.sqrt(Math.max(1e-9, 1 - alphaBar));
    return [betaT, alphaBar, sigmaT];
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
    return { seqFeatureSize: Math.max(1, seqFeatureSize), flatFeatureSize: Math.max(1, flatFeatureSize) };
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
          // Contact damping must only act during compression/contact (delta > 0).
          const deltaDot = delta > 0 ? Math.max(0, -v) : 0;
          const fc = Math.max(0, Number(groundK) * delta + Number(groundC) * deltaDot);
          a += fc * invM;
        }
      } else if (scenario === "pendulum") {
        const L = Math.max(Number(k) || 0, 1e-6); // k field reused as length for pendulum scenario
        const gravRaw = Number(g);
        const grav = Number.isFinite(gravRaw) && gravRaw > 0 ? gravRaw : 9.81;
        a = -(cSafe / mSafe) * v - (grav / L) * Math.sin(x);
      } else {
        // spring
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
      // Respect user initial conditions for bouncing mode.
      s = [Math.max(0, Number(x0) || 0), Number(v0) || 0];
    } else {
      s = [x0, v0];
    }
    const t = new Array(steps);
    const x = new Array(steps);
    const v = new Array(steps);

    const dtOut = Math.max(1e-6, Number(dt) || 0.02);
    // Integrate with smaller internal step to avoid coarse-step triangular artifacts.
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
            // Use impact speed magnitude for robust bounce even under coarse-step sign errors.
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
            // Fallback bounce for numerical penetration instead of absorbing all momentum.
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

  function parseRange(text, fallback, limit) {
    const parts = String(text).split(",").map(Number);
    let a = Number.isFinite(parts[0]) ? parts[0] : fallback[0];
    let b = Number.isFinite(parts[1]) ? parts[1] : fallback[1];
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    if (limit) {
      a = clamp(a, limit[0], limit[1]);
      b = clamp(b, limit[0], limit[1]);
    }
    return [a, b];
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
      const rng = createRng((Number(seed) || 42) + (gIdx + 1) * 1009);
      for (let i = idxs.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
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
    const rng = createRng(cfg.seed);
    const mode = String(cfg.predictionMode || "autoregressive");
    const featureCfg = ensureFeatureConfig(cfg.featureConfig || { useX: true, useParams: true });
    const featureSpec = normalizeFeatureSpec(cfg.featureSpec || {
      useX: featureCfg.useX,
      useV: featureCfg.useV,
      useParams: featureCfg.useParams,
      useTimeSec: false,
      useTimeNorm: true,
      useScenario: false,
      useSinNorm: false,
      useCosNorm: false,
    }, mode);
    const targetMode = String(cfg.targetMode || "x");
    const targetSize = targetMode === "xv" ? 2 : 1;
    const arFeatureCfg = ensureFeatureConfig(Object.assign({}, featureCfg, { useScenario: Boolean(featureSpec.useScenario) }));
    const featSizes = inferFeatureSizes(cfg.windowSize, arFeatureCfg, featureSpec);
    const included = (cfg.includedScenarios && cfg.includedScenarios.length)
      ? cfg.includedScenarios.slice()
      : [cfg.scenarioType];
    const sampleParams = function () {
      const s = included[Math.floor(rng() * included.length)];
      const lim = PRESET_LIMITS[s][cfg.paramPreset];
      const scenarioCfg = cfg.scenarioRanges && cfg.scenarioRanges[s] ? cfg.scenarioRanges[s] : null;
      const mRange = scenarioCfg && scenarioCfg.mRange ? scenarioCfg.mRange : (s === cfg.scenarioType ? cfg.mRange : lim.m);
      const cRange = scenarioCfg && scenarioCfg.cRange ? scenarioCfg.cRange : (s === cfg.scenarioType ? cfg.cRange : lim.c);
      const kRange = scenarioCfg && scenarioCfg.kRange ? scenarioCfg.kRange : (s === cfg.scenarioType ? cfg.kRange : lim.k);
      const eRange = scenarioCfg && scenarioCfg.restitutionRange ? scenarioCfg.restitutionRange : (s === cfg.scenarioType ? cfg.restitutionRange : lim.e);
      const x0Range = scenarioCfg && scenarioCfg.x0Range ? scenarioCfg.x0Range : (s === cfg.scenarioType ? cfg.x0Range : lim.x0);
      const v0Range = scenarioCfg && scenarioCfg.v0Range ? scenarioCfg.v0Range : (s === cfg.scenarioType ? cfg.v0Range : lim.v0);
      const groundModel = scenarioCfg && scenarioCfg.groundModel ? scenarioCfg.groundModel : cfg.groundModel;
      const groundK = scenarioCfg && Number.isFinite(Number(scenarioCfg.groundK)) ? Number(scenarioCfg.groundK) : cfg.groundK;
      const groundC = scenarioCfg && Number.isFinite(Number(scenarioCfg.groundC)) ? Number(scenarioCfg.groundC) : cfg.groundC;
      const gGlobal = Number.isFinite(Number(cfg.globalG)) ? Number(cfg.globalG) : 9.81;
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
        dt: cfg.dt,
        steps: cfg.steps,
      };
    };
    let previewParams = null;
    if (Array.isArray(cfg.sourceTrajectories) && cfg.sourceTrajectories.length) {
      cfg.sourceTrajectories.forEach(function (tr) {
        trajectories.push({
          t: (tr.t || []).slice(),
          x: (tr.x || []).slice(),
          v: (tr.v || []).slice(),
          params: Object.assign({}, tr.params || {}),
        });
      });
      const p0 = trajectories[0].params || {};
      previewParams = {
        scenario: p0.scenario || (included[0] || cfg.scenarioType),
        m: Number(p0.m),
        c: Number(p0.c),
        k: Number(p0.k),
        g: Number(p0.g),
        restitution: Number(p0.restitution),
        x0: Number(p0.x0),
        v0: Number(p0.v0),
        groundModel: String(p0.groundModel || "rigid"),
        groundK: Number(p0.groundK),
        groundC: Number(p0.groundC),
        dt: cfg.dt,
        steps: cfg.steps,
      };
    } else {
      previewParams = sampleParams();
      for (let n = 0; n < cfg.numTraj; n += 1) {
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

    const splitCfg = normalizeSplitConfig(cfg.splitConfig || { mode: "stratified_scenario", train: 0.70, val: 0.15, test: 0.15 });
    const splitMap = buildTrajectorySplitMap(trajectories, splitCfg, cfg.seed);
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
        scenario: String(p.scenario || cfg.scenarioType || "spring"),
        groundModel: String(p.groundModel || "rigid"),
        groundK: Number(p.groundK),
        groundC: Number(p.groundC),
        dt: cfg.dt,
        steps: cfg.steps,
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
          flatBucket.push(buildDirectFeatures(sim.t[i], params, cfg.durationSec, featureSpec));
          if (targetMode === "xv") yBucket.push([sim.x[i], sim.v[i]]);
          else if (targetMode === "v") yBucket.push([sim.v[i]]);
          else yBucket.push([sim.x[i]]);
        }
      } else {
        for (let i = cfg.windowSize; i < sim.x.length; i += 1) {
          const histX = sim.x.slice(i - cfg.windowSize, i);
          const histV = sim.v.slice(i - cfg.windowSize, i);
          flatBucket.push(buildInputFeatures(histX, histV, params, arFeatureCfg, false, featureSpec));
          seqBucket.push(buildInputFeatures(histX, histV, params, arFeatureCfg, true, featureSpec));
          if (targetMode === "xv") yBucket.push([sim.x[i], sim.v[i]]);
          else if (targetMode === "v") yBucket.push([sim.v[i]]);
          else yBucket.push([sim.x[i]]);
        }
      }
    });
    const includedOut = (cfg.includedScenarios && cfg.includedScenarios.length)
      ? cfg.includedScenarios.slice()
      : Array.from(new Set(trajectories.map(function (tr) {
          return String((tr.params && tr.params.scenario) || cfg.scenarioType || "spring");
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
      windowSize: cfg.windowSize,
      dt: cfg.dt,
      durationSec: cfg.durationSec,
      steps: cfg.steps,
      mode: mode,
      schemaId: resolveSchemaId((cfg && cfg.schemaId) || (state && state.modelSchemaId) || "oscillator"),
      scenarioType: includedOut.length > 1 ? "mixed" : includedOut[0],
      includedScenarios: includedOut,
      seed: cfg.seed,
      featureConfig: featureCfg,
      featureSpec: featureSpec,
      targetMode: targetMode,
      targetSize: targetSize,
      splitConfig: splitCfg,
      previewParams: previewParams,
      trajectories: trajectories,
    };
  }

  function prepareDatasetForModel(baseDs, prepCfg) {
    if (!baseDs || !Array.isArray(baseDs.trajectories) || !baseDs.trajectories.length) {
      throw new Error("Dataset has no trajectories. Generate dataset first.");
    }
    const mode = String((prepCfg && prepCfg.mode) || baseDs.mode || "autoregressive");
    const arCfg = (prepCfg && prepCfg.arHistory) || {
      windowSize: Math.max(5, Number((prepCfg && prepCfg.windowSize) || baseDs.windowSize || 20)),
      stride: 1,
      lagMode: "contiguous",
      lags: null,
      padMode: "none",
    };
    const windowSize = Math.max(1, Number(arCfg.windowSize || (prepCfg && prepCfg.windowSize) || baseDs.windowSize || 20));
    const targetMode = String((prepCfg && prepCfg.targetMode) || baseDs.targetMode || "x");
    const targetSize = targetMode === "xv" ? 2 : 1;
    const featureSpec = normalizeFeatureSpec(
      (prepCfg && prepCfg.featureSpec) || baseDs.featureSpec || {},
      mode
    );
    const featureCfg = mode === "direct"
      ? ensureFeatureConfig({ useX: false, useV: false, useParams: true, useScenario: Boolean(featureSpec.useScenario) })
      : ensureFeatureConfig({ useX: true, useV: true, useParams: true, useScenario: Boolean(featureSpec.useScenario) });
    const featSizes = inferFeatureSizes(windowSize, featureCfg, featureSpec);

    const paramMaskForTargets = normalizeParamMask(featureSpec.paramMask || defaultParamMask());
    const paramSize = countStaticParams(paramMaskForTargets);
    const paramNames = staticParamNames(paramMaskForTargets);
    const trainFlat = [];
    const trainSeq = [];
    const trainY = [];
    const trainParamsY = [];
    const valFlat = [];
    const valSeq = [];
    const valY = [];
    const valParamsY = [];
    const testFlat = [];
    const testSeq = [];
    const testY = [];
    const testParamsY = [];
    const splitCfg = normalizeSplitConfig((prepCfg && prepCfg.splitConfig) || baseDs.splitConfig || { mode: "stratified_scenario", train: 0.70, val: 0.15, test: 0.15 });
    const splitMap = buildTrajectorySplitMap(baseDs.trajectories, splitCfg, Number(baseDs.seed || 42));

    baseDs.trajectories.forEach(function (tr, n) {
      const t = tr.t || [];
      const x = tr.x || [];
      const v = tr.v || [];
      if (!t.length || !x.length || !v.length) return;
      const p = tr.params || {};
      const params = {
        m: Number(p.m),
        c: Number(p.c),
        k: Number(p.k),
        g: Number(p.g),
        restitution: Number(p.restitution),
        x0: Number(p.x0),
        v0: Number(p.v0),
        scenario: String(p.scenario || baseDs.scenarioType || "spring"),
        groundModel: String(p.groundModel || "rigid"),
        groundK: Number(p.groundK),
        groundC: Number(p.groundC),
        dt: Number(baseDs.dt || 0.02),
        steps: Number(baseDs.steps || x.length),
      };

      const bucketName = splitMap[n] || "train";
      let flatBucket;
      let seqBucket;
      let yBucket;
      let pBucket;
      if (bucketName === "train") {
        flatBucket = trainFlat;
        seqBucket = trainSeq;
        yBucket = trainY;
        pBucket = trainParamsY;
      } else if (bucketName === "val") {
        flatBucket = valFlat;
        seqBucket = valSeq;
        yBucket = valY;
        pBucket = valParamsY;
      } else {
        flatBucket = testFlat;
        seqBucket = testSeq;
        yBucket = testY;
        pBucket = testParamsY;
      }
      const pVec = buildStaticParams(params, paramMaskForTargets);

      if (mode === "direct") {
        for (let i = 0; i < x.length; i += 1) {
          flatBucket.push(buildDirectFeatures(t[i], params, Number(baseDs.durationSec || t[t.length - 1] || 1), featureSpec));
          if (targetMode === "xv") yBucket.push([x[i], v[i]]);
          else if (targetMode === "v") yBucket.push([v[i]]);
          else yBucket.push([x[i]]);
          pBucket.push(pVec.slice());
        }
      } else {
        const padMode = String(arCfg.padMode || "none");
        const useZeroPad = padMode === "zero";
        const useEdgePad = padMode === "edge";
        if (arCfg.lagMode === "exact" && Array.isArray(arCfg.lags) && arCfg.lags.length) {
          const stride = Math.max(1, Number(arCfg.stride || 1));
          const padX = useEdgePad ? Number(x[0] || 0) : 0;
          const padV = useEdgePad ? Number(v[0] || 0) : 0;
          for (let i = 0; i < x.length; i += stride) {
            const histX = [];
            const histV = [];
            let valid = true;
            arCfg.lags.forEach(function (lag) {
              const idx = i - Number(lag || 0);
              if (idx >= 0) {
                histX.push(Number(x[idx] || 0));
                histV.push(Number(v[idx] || 0));
              } else if (useZeroPad || useEdgePad) {
                histX.push(useEdgePad ? padX : 0);
                histV.push(useEdgePad ? padV : 0);
              } else {
                valid = false;
              }
            });
            if (!valid) continue;
            flatBucket.push(buildInputFeatures(histX, histV, params, featureCfg, false, featureSpec));
            seqBucket.push(buildInputFeatures(histX, histV, params, featureCfg, true, featureSpec));
            if (targetMode === "xv") yBucket.push([x[i], v[i]]);
            else if (targetMode === "v") yBucket.push([v[i]]);
            else yBucket.push([x[i]]);
            pBucket.push(pVec.slice());
          }
        } else {
          const stride = Math.max(1, Number(arCfg.stride || 1));
          const padX = useEdgePad ? Number(x[0] || 0) : 0;
          const padV = useEdgePad ? Number(v[0] || 0) : 0;
          for (let i = 0; i < x.length; i += stride) {
            const histX = [];
            const histV = [];
            let valid = true;
            for (let j = i - windowSize; j < i; j += 1) {
              if (j >= 0) {
                histX.push(Number(x[j] || 0));
                histV.push(Number(v[j] || 0));
              } else if (useZeroPad || useEdgePad) {
                histX.push(useEdgePad ? padX : 0);
                histV.push(useEdgePad ? padV : 0);
              } else {
                valid = false;
                break;
              }
            }
            if (!valid) continue;
            flatBucket.push(buildInputFeatures(histX, histV, params, featureCfg, false, featureSpec));
            seqBucket.push(buildInputFeatures(histX, histV, params, featureCfg, true, featureSpec));
            if (targetMode === "xv") yBucket.push([x[i], v[i]]);
            else if (targetMode === "v") yBucket.push([v[i]]);
            else yBucket.push([x[i]]);
            pBucket.push(pVec.slice());
          }
        }
      }
    });

    return Object.assign({}, baseDs, {
      mode: mode,
      windowSize: windowSize,
      featureConfig: featureCfg,
      featureSpec: featureSpec,
      targetMode: targetMode,
      targetSize: targetSize,
      splitConfig: splitCfg,
      xTrain: trainFlat,
      xVal: valFlat,
      xTest: testFlat,
      seqTrain: trainSeq,
      seqVal: valSeq,
      seqTest: testSeq,
      yTrain: trainY,
      yVal: valY,
      yTest: testY,
      pTrain: trainParamsY,
      pVal: valParamsY,
      pTest: testParamsY,
      paramSize: paramSize,
      paramNames: paramNames,
      paramMaskForTargets: paramMaskForTargets,
      featureSize: mode === "direct" ? inferDirectFeatureSize(featureSpec) : featSizes.flatFeatureSize,
      seqFeatureSize: mode === "direct" ? inferDirectFeatureSize(featureSpec) : featSizes.seqFeatureSize,
    });
  }

  function getNodeByName(nodes, name) {
    const values = Object.values(nodes);
    for (let i = 0; i < values.length; i += 1) {
      if (values[i].name === name) return values[i];
    }
    return null;
  }

  function incomingNode(nodes, node) {
    const inputKeys = Object.keys(node.inputs || {});
    if (!inputKeys.length) return null;
    const conn = node.inputs[inputKeys[0]].connections || [];
    if (!conn.length) return null;
    return nodes[conn[0].node] || null;
  }

  function initDrawflow(containerEl) {
    patchDrawflowRuntimeSafety();
    if (!containerEl) {
      throw new Error("Drawflow container '#drawflow' not found.");
    }
    const editor = new Drawflow(containerEl);
    editor.reroute = true;
    editor.start();
    return editor;
  }

  function patchDrawflowRuntimeSafety() {
    if (typeof Drawflow !== "function" || !Drawflow.prototype) return;
    const proto = Drawflow.prototype;
    if (proto.__oscUpdateConnectionGuardPatched) return;
    const originalUpdateConnection = proto.updateConnection;
    const originalUpdateConnectionNodes = proto.updateConnectionNodes;
    if (typeof originalUpdateConnection !== "function") return;
    proto.updateConnection = function (x, y) {
      if (!this || !this.ele_selected || !this.connection_ele || !this.precanvas) return;
      try {
        return originalUpdateConnection.call(this, x, y);
      } catch (err) {
        const msg = String((err && err.message) || err || "");
        if (msg.indexOf("offsetWidth") >= 0 || msg.indexOf("offsetHeight") >= 0 || msg.indexOf("querySelector") >= 0) {
          try {
            if (typeof this.__oscSanitizeBrokenConnectionElements === "function") {
              this.__oscSanitizeBrokenConnectionElements();
            }
          } catch (_cleanupErr) {}
          return;
        }
        throw err;
      }
    };
    if (typeof originalUpdateConnectionNodes === "function") {
      proto.__oscSanitizeBrokenConnectionElements = function () {
        if (!this || !this.container || !this.precanvas || !this.container.querySelectorAll) return 0;
        const conns = this.container.querySelectorAll(".connection");
        let removed = 0;
        conns.forEach(function (conn) {
          try {
            const classes = Array.from(conn.classList || []);
            const inClass = classes.find(function (c) { return String(c || "").indexOf("node_in_") === 0; });
            const outClass = classes.find(function (c) { return String(c || "").indexOf("node_out_") === 0; });
            if (!inClass || !outClass) return;
            const inputNodeId = String(inClass).replace("node_in_", "");
            const outputNodeId = String(outClass).replace("node_out_", "");
            if (!inputNodeId || !outputNodeId) return;
            const outputPortClass = classes.find(function (c) { return String(c || "").indexOf("output_") === 0; }) || "";
            const inputPortClass = classes.find(function (c) { return String(c || "").indexOf("input_") === 0; }) || "";
            const inputPort = inputPortClass
              ? this.container.querySelector("#" + inputNodeId + " ." + inputPortClass)
              : this.container.querySelector("#" + inputNodeId);
            const outputPort = outputPortClass
              ? this.container.querySelector("#" + outputNodeId + " ." + outputPortClass)
              : this.container.querySelector("#" + outputNodeId);
            if (!inputPort || !outputPort) {
              conn.remove();
              removed += 1;
            }
          } catch (_err) {}
        }, this);
        return removed;
      };
      proto.updateConnectionNodes = function (nodeId) {
        if (!this || !this.container || !this.precanvas) return;
        try {
          return originalUpdateConnectionNodes.call(this, nodeId);
        } catch (err) {
          const msg = String((err && err.message) || err || "");
          if (msg.indexOf("offsetWidth") >= 0 || msg.indexOf("offsetHeight") >= 0 || msg.indexOf("querySelectorAll") >= 0) {
            try {
              if (typeof this.__oscSanitizeBrokenConnectionElements === "function") {
                this.__oscSanitizeBrokenConnectionElements();
              }
            } catch (_cleanupErr) {}
            return;
          }
          throw err;
        }
      };
    }
    proto.__oscUpdateConnectionGuardPatched = true;
  }

  function clearEditor(editor) {
    if (typeof editor.clear === "function") {
      editor.clear();
      return;
    }
    if (typeof editor.clearModuleSelected === "function") {
      editor.clearModuleSelected();
    }
  }

  function addInputNode(editor, x, y) {
    const html =
      "<div><div style='font-weight:700'>Input</div><div style='display:grid;gap:4px'>" +
      "<select df-mode style='width:120px'><option value='auto'>auto</option><option value='flat'>flat</option><option value='sequence'>sequence</option></select>" +
      "<div style='font-size:11px'>auto: infer from layers</div><div class='node-summary' style='font-size:11px;color:#334155;'>mode=auto</div></div></div>";
    return editor.addNode("input_layer", 1, 1, x, y, "input_layer", { mode: "auto" }, html);
  }

  function addDenseNode(editor, x, y, cfg) {
    const units = Math.max(1, Number((cfg && cfg.units) || 32));
    const activation = String((cfg && cfg.activation) || "relu");
    const html =
      "<div><div style='font-weight:700'>Dense</div><div style='display:grid;gap:4px'>" +
      "<input type='number' df-units value='" + units + "' min='1' style='width:80px'>" +
      "<select df-activation style='width:120px'>" +
      "<option value='relu'>relu</option><option value='tanh'>tanh</option><option value='sigmoid'>sigmoid</option><option value='linear'>linear</option>" +
      "</select><div class='node-summary' style='font-size:11px;color:#334155;'>u=" + units + ", act=" + activation + "</div></div></div>";
    return editor.addNode("dense_layer", 1, 1, x, y, "dense_layer", { units: units, activation: activation }, html);
  }

  function addDropoutNode(editor, x, y, cfg) {
    const rate = clamp(Number((cfg && cfg.rate) || 0.1), 0, 0.9);
    const html =
      "<div><div style='font-weight:700'>Dropout</div>" +
      "<input type='number' step='0.05' min='0' max='0.9' df-rate value='" + rate.toFixed(2) + "' style='width:80px'>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>rate=" + rate.toFixed(2) + "</div></div>";
    return editor.addNode("dropout_layer", 1, 1, x, y, "dropout_layer", { rate: rate }, html);
  }

  function addBatchNormNode(editor, x, y, cfg) {
    const momentum = clamp(Number((cfg && cfg.momentum) || 0.99), 0.1, 0.999);
    const epsilon = Math.max(1e-6, Number((cfg && cfg.epsilon) || 1e-3));
    const html =
      "<div><div style='font-weight:700'>BatchNorm</div>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>m=" + momentum.toFixed(3) + ", ε=" + epsilon.toExponential(1) + "</div></div>";
    return editor.addNode("batchnorm_layer", 1, 1, x, y, "batchnorm_layer", { momentum: momentum, epsilon: epsilon }, html);
  }

  function addLayerNormNode(editor, x, y, cfg) {
    const epsilon = Math.max(1e-6, Number((cfg && cfg.epsilon) || 1e-3));
    const html =
      "<div><div style='font-weight:700'>LayerNorm</div>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>ε=" + epsilon.toExponential(1) + "</div></div>";
    return editor.addNode("layernorm_layer", 1, 1, x, y, "layernorm_layer", { epsilon: epsilon }, html);
  }

  function addLatentNode(editor, x, y, cfg) {
    const units = Math.max(2, Number((cfg && cfg.units) || 16));
    const group = String((cfg && cfg.group) || "z_shared");
    const matchWeight = Math.max(0, Number((cfg && cfg.matchWeight) || 1));
    const html =
      "<div><div style='font-weight:700'>Latent Z</div>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>u=" + units + ", g=" + group + ", w=" + matchWeight.toFixed(2) + "</div></div>";
    return editor.addNode("latent_layer", 1, 1, x, y, "latent_layer", { units: units, group: group, matchWeight: matchWeight }, html);
  }

  function addLatentMuNode(editor, x, y, cfg) {
    const units = Math.max(2, Number((cfg && cfg.units) || 16));
    const group = String((cfg && cfg.group) || "z_shared");
    const matchWeight = Math.max(0, Number((cfg && cfg.matchWeight) || 1));
    const html =
      "<div><div style='font-weight:700'>Latent μ</div>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>u=" + units + ", g=" + group + ", w=" + matchWeight.toFixed(2) + "</div></div>";
    return editor.addNode("latent_mu_layer", 1, 1, x, y, "latent_mu_layer", { units: units, group: group, matchWeight: matchWeight }, html);
  }

  function addLatentLogVarNode(editor, x, y, cfg) {
    const units = Math.max(2, Number((cfg && cfg.units) || 16));
    const group = String((cfg && cfg.group) || "z_shared");
    const matchWeight = Math.max(0, Number((cfg && cfg.matchWeight) || 1));
    const html =
      "<div><div style='font-weight:700'>Latent logσ²</div>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>u=" + units + ", g=" + group + ", w=" + matchWeight.toFixed(2) + "</div></div>";
    return editor.addNode("latent_logvar_layer", 1, 1, x, y, "latent_logvar_layer", { units: units, group: group, matchWeight: matchWeight }, html);
  }

  function addReparamNode(editor, x, y, cfg) {
    const group = String((cfg && cfg.group) || "z_shared");
    const beta = Math.max(0, Number((cfg && cfg.beta) || 1e-3));
    const matchWeight = Math.max(0, Number((cfg && cfg.matchWeight) || 1));
    const html =
      "<div><div style='font-weight:700'>Reparam z</div>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>g=" + group + ", β=" + beta.toExponential(1) + ", w=" + matchWeight.toFixed(2) + "</div></div>";
    return editor.addNode("reparam_layer", 2, 1, x, y, "reparam_layer", { group: group, beta: beta, matchWeight: matchWeight }, html);
  }

  function addOutputNode(editor, x, y, cfg) {
    const schemaId = resolveSchemaId((cfg && cfg.schemaId) || (state && state.modelSchemaId) || "oscillator");
    const targets = normalizeOutputTargetsList(
      (cfg && (cfg.targets != null ? cfg.targets : (cfg.targetsCsv != null ? cfg.targetsCsv : (cfg.targetType || cfg.target)))),
      ["x"],
      schemaId
    );
    const target = targets[0];
    const loss = String((cfg && cfg.loss) || "mse");
    const wx = Math.max(0, Number((cfg && cfg.wx) || 1));
    const wv = Math.max(0, Number((cfg && cfg.wv) || 1));
    const matchWeight = Math.max(0, Number((cfg && cfg.matchWeight) || 1));
    const paramsSelectRaw = (cfg && cfg.paramsSelect != null) ? cfg.paramsSelect : "";
    const paramsSelect = Array.isArray(paramsSelectRaw)
      ? paramsSelectRaw.join(",")
      : String(paramsSelectRaw || "");
    const html =
      "<div><div style='font-weight:700'>Output</div>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>" + outputTargetsSummaryText(targets, schemaId) + ", loss=" + loss + "</div></div>";
    return editor.addNode("output_layer", 1, 0, x, y, "output_layer", {
      targets: targets.slice(),
      targetsCsv: targets.join(","),
      target: target,
      targetType: target,
      paramsSelect: paramsSelect,
      loss: loss,
      wx: wx,
      wv: wv,
      matchWeight: matchWeight,
    }, html);
  }

  function addHistNode(editor, x, y, cfg) {
    const schemaId = resolveSchemaId((cfg && cfg.schemaId) || (state && state.modelSchemaId) || "oscillator");
    const featureKey = normalizeHistorySeriesKey((cfg && cfg.featureKey) || "x", schemaId);
    const html = "<div><div style='font-weight:700'>History</div><div class='node-summary' style='font-size:11px;color:#334155;'>feature=" + historySeriesLabel(featureKey, schemaId) + "</div></div>";
    return editor.addNode("hist_block", 0, 1, x, y, "hist_block", { featureKey: featureKey }, html);
  }

  function addImageSourceNode(editor, x, y, cfg) {
    const schemaId = resolveSchemaId((cfg && cfg.schemaId) || (state && state.modelSchemaId) || "oscillator");
    const srcSpec = getImageSourceSpec((cfg && cfg.sourceKey) || "", schemaId);
    const featureSize = Math.max(1, Number((cfg && cfg.featureSize) || srcSpec.featureSize || 1));
    const html =
      "<div><div style='font-weight:700'>ImageSource</div>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>feature=" + srcSpec.label + ", shape=" + srcSpec.width + "x" + srcSpec.height + "x" + srcSpec.channels + ", n=" + String(Math.round(featureSize)) + "</div></div>";
    return editor.addNode("image_source_block", 0, 1, x, y, "image_source_block", {
      sourceKey: srcSpec.sourceKey,
      featureSize: Math.round(featureSize),
      imageShape: srcSpec.shape.slice(),
      imageHeight: srcSpec.height,
      imageWidth: srcSpec.width,
      imageChannels: srcSpec.channels,
    }, html);
  }

  function addHistXNode(editor, x, y) {
    return addHistNode(editor, x, y, { featureKey: "x", schemaId: state && state.modelSchemaId });
  }

  function addHistVNode(editor, x, y) {
    return addHistNode(editor, x, y, { featureKey: "v", schemaId: state && state.modelSchemaId });
  }

  function addXNode(editor, x, y) {
    return addHistNode(editor, x, y, { featureKey: "x", schemaId: state && state.modelSchemaId });
  }

  function addVNode(editor, x, y) {
    return addHistNode(editor, x, y, { featureKey: "v", schemaId: state && state.modelSchemaId });
  }

  function addWindowHistNode(editor, x, y, cfg) {
    const schemaId = resolveSchemaId((cfg && cfg.schemaId) || (state && state.modelSchemaId) || "oscillator");
    const featureKey = normalizeHistorySeriesKey((cfg && cfg.featureKey) || "x", schemaId);
    const windowSize = Math.max(5, Number((cfg && cfg.windowSize) || 20));
    const stride = Math.max(1, Number((cfg && cfg.stride) || 1));
    const lagMode = String((cfg && cfg.lagMode) || "contiguous");
    const lagCsv = String((cfg && cfg.lagCsv) || "1,2,3,4,5");
    const padMode = String((cfg && cfg.padMode) || "none");
    const html =
      "<div><div style='font-weight:700'>WindowHistory</div>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>feature=" + historySeriesLabel(featureKey, schemaId) + ", w=" + windowSize + ", s=" + stride + ", " + lagMode + ", " + padMode + "</div></div>";
    return editor.addNode("window_hist_block", 0, 1, x, y, "window_hist_block", { featureKey: featureKey, windowSize: windowSize, stride: stride, lagMode: lagMode, lagCsv: lagCsv, padMode: padMode }, html);
  }

  function addWindowHistXNode(editor, x, y, cfg) {
    return addWindowHistNode(editor, x, y, Object.assign({}, cfg || {}, { featureKey: "x", schemaId: state && state.modelSchemaId }));
  }

  function addWindowHistVNode(editor, x, y, cfg) {
    return addWindowHistNode(editor, x, y, Object.assign({}, cfg || {}, { featureKey: "v", schemaId: state && state.modelSchemaId }));
  }

  function addParamsNode(editor, x, y, cfg) {
    const pm = normalizeParamMask(cfg && cfg.paramMask ? cfg.paramMask : defaultParamMask());
    const html =
      "<div><div style='font-weight:700'>Features</div>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>m,c,k,e,x0,v0,gm,gk,gc,+ratios(opt)</div></div>";
    return editor.addNode("params_block", 0, 1, x, y, "params_block", { paramMask: pm }, html);
  }

  function addScenarioNode(editor, x, y, cfg) {
    const schemaId = resolveSchemaId((cfg && cfg.schemaId) || (state && state.modelSchemaId) || "oscillator");
    const oneHotKey = normalizeOneHotKey((cfg && cfg.oneHotKey) || "scenario", schemaId);
    const html = "<div><div style='font-weight:700'>OneHot</div><div class='node-summary' style='font-size:11px;color:#334155;'>field=" + oneHotLabel(oneHotKey, schemaId) + "</div></div>";
    return editor.addNode("scenario_block", 0, 1, x, y, "scenario_block", { oneHotKey: oneHotKey }, html);
  }

  function addTimeSecNode(editor, x, y) {
    const html = "<div><div style='font-weight:700'>TimeSec</div><div class='node-summary' style='font-size:11px;color:#334155;'>t (seconds)</div></div>";
    return editor.addNode("time_sec_block", 0, 1, x, y, "time_sec_block", {}, html);
  }

  function addTimeNormNode(editor, x, y) {
    const html = "<div><div style='font-weight:700'>TimeNorm</div><div class='node-summary' style='font-size:11px;color:#334155;'>t/T</div></div>";
    return editor.addNode("time_norm_block", 0, 1, x, y, "time_norm_block", {}, html);
  }

  function addSinNormNode(editor, x, y) {
    const html = "<div><div style='font-weight:700'>SinNorm</div><div class='node-summary' style='font-size:11px;color:#334155;'>sin(2π·t/T)</div></div>";
    return editor.addNode("sin_norm_block", 0, 1, x, y, "sin_norm_block", {}, html);
  }

  function addCosNormNode(editor, x, y) {
    const html = "<div><div style='font-weight:700'>CosNorm</div><div class='node-summary' style='font-size:11px;color:#334155;'>cos(2π·t/T)</div></div>";
    return editor.addNode("cos_norm_block", 0, 1, x, y, "cos_norm_block", {}, html);
  }

  function addNoiseScheduleNode(editor, x, y) {
    const html = "<div><div style='font-weight:700'>NoiseSchedule</div><div class='node-summary' style='font-size:11px;color:#334155;'>β(t), ᾱ(t), σ(t)</div></div>";
    return editor.addNode("noise_schedule_block", 0, 1, x, y, "noise_schedule_block", {}, html);
  }

  function addConv1dNode(editor, x, y, cfg) {
    const filters = Math.max(1, Number((cfg && cfg.filters) || 64));
    const kernelSize = Math.max(1, Number((cfg && cfg.kernelSize) || 3));
    const stride = Math.max(1, Number((cfg && cfg.stride) || 1));
    const activation = String((cfg && cfg.activation) || "relu");
    const html =
      "<div><div style='font-weight:700'>Conv1D</div><div style='display:grid;gap:4px'>" +
      "<input type='number' df-filters value='" + filters + "' min='1' style='width:80px'>" +
      "<input type='number' df-kernelSize value='" + kernelSize + "' min='1' style='width:80px'>" +
      "<input type='number' df-stride value='" + stride + "' min='1' style='width:80px'>" +
      "<select df-activation style='width:120px'><option value='relu'>relu</option><option value='tanh'>tanh</option><option value='sigmoid'>sigmoid</option><option value='linear'>linear</option></select>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>f=" + filters + ", k=" + kernelSize + ", s=" + stride + ", act=" + activation + "</div></div></div>";
    return editor.addNode("conv1d_layer", 1, 1, x, y, "conv1d_layer", { filters: filters, kernelSize: kernelSize, stride: stride, activation: activation }, html);
  }

  function addRatioKmNode(editor, x, y) {
    const html = "<div><div style='font-weight:700'>Ratio k/m</div><div class='node-summary' style='font-size:11px;color:#334155;'>k/m</div></div>";
    return editor.addNode("ratio_km_block", 0, 1, x, y, "ratio_km_block", {}, html);
  }

  function addRatioCmNode(editor, x, y) {
    const html = "<div><div style='font-weight:700'>Ratio c/m</div><div class='node-summary' style='font-size:11px;color:#334155;'>c/m</div></div>";
    return editor.addNode("ratio_cm_block", 0, 1, x, y, "ratio_cm_block", {}, html);
  }

  function addRatioGlNode(editor, x, y) {
    const html = "<div><div style='font-weight:700'>Ratio g/L</div><div class='node-summary' style='font-size:11px;color:#334155;'>g/L</div></div>";
    return editor.addNode("ratio_gl_block", 0, 1, x, y, "ratio_gl_block", {}, html);
  }

  function addConcatNode(editor, x, y, cfg) {
    const numInputs = clamp(Math.round(Number((cfg && cfg.numInputs) || 5)), 1, 24);
    const html = "<div><div style='font-weight:700'>Concat</div><div class='node-summary' style='font-size:11px;color:#334155;'>merge selected features</div></div>";
    return editor.addNode("concat_block", numInputs, 1, x, y, "concat_block", { numInputs: numInputs }, html);
  }

  function addRnnNode(editor, x, y, cfg) {
    const units = Math.max(1, Number((cfg && cfg.units) || 48));
    const dropout = clamp(Number((cfg && cfg.dropout) || 0.1), 0, 0.8);
    const returnseq = String((cfg && cfg.returnseq) || "auto");
    const html =
      "<div><div style='font-weight:700'>SimpleRNN</div><div style='display:grid;gap:4px'>" +
      "<input type='number' df-units value='" + units + "' min='1' style='width:80px'>" +
      "<input type='number' df-dropout value='" + dropout.toFixed(2) + "' min='0' max='0.8' step='0.05' style='width:80px'>" +
      "<select df-returnseq style='width:120px'><option value='auto'>returnSeq:auto</option><option value='false'>returnSeq:false</option><option value='true'>returnSeq:true</option></select>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>u=" + units + ", d=" + dropout.toFixed(2) + ", rs=" + returnseq + "</div>" +
      "</div></div>";
    return editor.addNode("rnn_layer", 1, 1, x, y, "rnn_layer", { units: units, dropout: dropout, returnseq: returnseq }, html);
  }

  function addGruNode(editor, x, y, cfg) {
    const units = Math.max(1, Number((cfg && cfg.units) || 64));
    const dropout = clamp(Number((cfg && cfg.dropout) || 0.1), 0, 0.8);
    const returnseq = String((cfg && cfg.returnseq) || "auto");
    const html =
      "<div><div style='font-weight:700'>GRU</div><div style='display:grid;gap:4px'>" +
      "<input type='number' df-units value='" + units + "' min='1' style='width:80px'>" +
      "<input type='number' df-dropout value='" + dropout.toFixed(2) + "' min='0' max='0.8' step='0.05' style='width:80px'>" +
      "<select df-returnseq style='width:120px'><option value='auto'>returnSeq:auto</option><option value='false'>returnSeq:false</option><option value='true'>returnSeq:true</option></select>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>u=" + units + ", d=" + dropout.toFixed(2) + ", rs=" + returnseq + "</div>" +
      "</div></div>";
    return editor.addNode("gru_layer", 1, 1, x, y, "gru_layer", { units: units, dropout: dropout, returnseq: returnseq }, html);
  }

  function addLstmNode(editor, x, y, cfg) {
    const units = Math.max(1, Number((cfg && cfg.units) || 64));
    const dropout = clamp(Number((cfg && cfg.dropout) || 0.1), 0, 0.8);
    const returnseq = String((cfg && cfg.returnseq) || "auto");
    const html =
      "<div><div style='font-weight:700'>LSTM</div><div style='display:grid;gap:4px'>" +
      "<input type='number' df-units value='" + units + "' min='1' style='width:80px'>" +
      "<input type='number' df-dropout value='" + dropout.toFixed(2) + "' min='0' max='0.8' step='0.05' style='width:80px'>" +
      "<select df-returnseq style='width:120px'><option value='auto'>returnSeq:auto</option><option value='false'>returnSeq:false</option><option value='true'>returnSeq:true</option></select>" +
      "<div class='node-summary' style='font-size:11px;color:#334155;'>u=" + units + ", d=" + dropout.toFixed(2) + ", rs=" + returnseq + "</div>" +
      "</div></div>";
    return editor.addNode("lstm_layer", 1, 1, x, y, "lstm_layer", { units: units, dropout: dropout, returnseq: returnseq }, html);
  }

  function seedPreconfigGraph(editor, preset) {
    const runtime = getModelGraphRuntime();
    const schemaId = resolveSchemaId((state && state.modelSchemaId) || "oscillator");
    if (runtime && typeof runtime.seedPreconfigGraph === "function") {
      runtime.seedPreconfigGraph(editor, preset, schemaId);
      return;
    }
    preset = String(preset || "").trim();
    clearEditor(editor);
    if (preset === "mnist_mlp_baseline") {
      const hx = addImageSourceNode(editor, 140, 60, { sourceKey: "pixel_values", schemaId: state && state.modelSchemaId });
      const i = addInputNode(editor, 420, 120);
      if (editor && typeof editor.updateNodeDataFromId === "function") editor.updateNodeDataFromId(i, { mode: "flat" });
      const d1 = addDenseNode(editor, 620, 120, { units: 256, activation: "relu" });
      const dr = addDropoutNode(editor, 800, 120, { rate: 0.2 });
      const d2 = addDenseNode(editor, 980, 120, { units: 128, activation: "relu" });
      const o = addOutputNode(editor, 1160, 120, { target: "label", targetType: "label", loss: "cross_entropy", units: 10, unitsHint: 10, matchWeight: 1 });
      editor.addConnection(hx, i, "output_1", "input_1");
      editor.addConnection(i, d1, "output_1", "input_1");
      editor.addConnection(d1, dr, "output_1", "input_1");
      editor.addConnection(dr, d2, "output_1", "input_1");
      editor.addConnection(d2, o, "output_1", "input_1");
      return;
    }
    if (preset === "exp_diffusion_denoise_1d") {
      const pm = normalizeParamMask(defaultParamMask());
      const px = addParamsNode(editor, 180, 80, { paramMask: pm });
      const tnorm = addTimeNormNode(editor, 340, 80);
      const ns = addNoiseScheduleNode(editor, 500, 80);
      const sx = addScenarioNode(editor, 660, 80);
      const cx = addConcatNode(editor, 840, 80, { numInputs: 4 });
      const i = addInputNode(editor, 980, 120);
      if (editor && typeof editor.updateNodeDataFromId === "function") editor.updateNodeDataFromId(i, { mode: "flat" });
      const d1 = addDenseNode(editor, 1140, 80, { units: 128, activation: "relu" });
      const d2 = addDenseNode(editor, 1300, 80, { units: 64, activation: "relu" });
      const d3 = addDenseNode(editor, 1460, 80, { units: 32, activation: "tanh" });
      const o = addOutputNode(editor, 1620, 80, { target: "x", loss: "mse", wx: 1, wv: 1 });
      let ci = 1;
      editor.addConnection(px, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(tnorm, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(ns, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(sx, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(cx, i, "output_1", "input_1");
      editor.addConnection(i, d1, "output_1", "input_1");
      editor.addConnection(d1, d2, "output_1", "input_1");
      editor.addConnection(d2, d3, "output_1", "input_1");
      editor.addConnection(d3, o, "output_1", "input_1");
      return;
    }
    if (preset === "exp_vae_direct") {
      const pm = normalizeParamMask(defaultParamMask());
      const px = addParamsNode(editor, 180, 80, { paramMask: pm });
      const tnorm = addTimeNormNode(editor, 340, 80);
      const sx = addScenarioNode(editor, 500, 80);
      const sn = addSinNormNode(editor, 660, 80);
      const cn = addCosNormNode(editor, 820, 80);
      const cx = addConcatNode(editor, 980, 80, { numInputs: 5 });
      const i = addInputNode(editor, 1120, 120);
      if (editor && typeof editor.updateNodeDataFromId === "function") editor.updateNodeDataFromId(i, { mode: "flat" });
      const e1 = addDenseNode(editor, 1280, 80, { units: 96, activation: "relu" });
      const mu = addLatentMuNode(editor, 1440, 40, { units: 16, group: "z_vae" });
      const lv = addLatentLogVarNode(editor, 1440, 180, { units: 16, group: "z_vae" });
      const rz = addReparamNode(editor, 1600, 100, { group: "z_vae", beta: 1e-3 });
      const d1 = addDenseNode(editor, 1760, 100, { units: 64, activation: "relu" });
      const o = addOutputNode(editor, 1920, 100, { target: "x", loss: "mse", wx: 1, wv: 1 });
      let ci = 1;
      editor.addConnection(px, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(tnorm, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(sx, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(sn, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(cn, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(cx, i, "output_1", "input_1");
      editor.addConnection(i, e1, "output_1", "input_1");
      editor.addConnection(e1, mu, "output_1", "input_1");
      editor.addConnection(e1, lv, "output_1", "input_1");
      editor.addConnection(mu, rz, "output_1", "input_1");
      editor.addConnection(lv, rz, "output_1", "input_2");
      editor.addConnection(rz, d1, "output_1", "input_1");
      editor.addConnection(d1, o, "output_1", "input_1");
      return;
    }
    if (preset === "exp_dual_latent_match_direct") {
      const pm = normalizeParamMask(defaultParamMask());
      const px = addParamsNode(editor, 160, 80, { paramMask: pm });
      const tsec = addTimeSecNode(editor, 320, 80);
      const tnorm = addTimeNormNode(editor, 480, 80);
      const sx = addScenarioNode(editor, 640, 80);
      const sn = addSinNormNode(editor, 800, 80);
      const cn = addCosNormNode(editor, 960, 80);
      const cx = addConcatNode(editor, 1120, 80, { numInputs: 6 });
      const i = addInputNode(editor, 1260, 120);
      if (editor && typeof editor.updateNodeDataFromId === "function") editor.updateNodeDataFromId(i, { mode: "flat" });
      const e1 = addDenseNode(editor, 1420, 70, { units: 96, activation: "relu" });
      const e2 = addDenseNode(editor, 1420, 190, { units: 96, activation: "relu" });
      const z1 = addLatentNode(editor, 1580, 70, { units: 16, group: "z_shared", matchWeight: 1 });
      const z2 = addLatentNode(editor, 1580, 190, { units: 16, group: "z_shared", matchWeight: 1 });
      const d1 = addDenseNode(editor, 1740, 70, { units: 64, activation: "relu" });
      const d2 = addDenseNode(editor, 1900, 70, { units: 32, activation: "tanh" });
      const o = addOutputNode(editor, 2060, 70, { target: "x", loss: "mse", wx: 1, wv: 1 });
      let ci = 1;
      editor.addConnection(px, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(tsec, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(tnorm, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(sx, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(sn, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(cn, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(cx, i, "output_1", "input_1");
      editor.addConnection(i, e1, "output_1", "input_1");
      editor.addConnection(i, e2, "output_1", "input_1");
      editor.addConnection(e1, z1, "output_1", "input_1");
      editor.addConnection(e2, z2, "output_1", "input_1");
      editor.addConnection(z1, d1, "output_1", "input_1");
      editor.addConnection(d1, d2, "output_1", "input_1");
      editor.addConnection(d2, o, "output_1", "input_1");
      return;
    }
    if (preset === "exp_ar_gru_latent_match") {
      const pm = normalizeParamMask(defaultParamMask());
      const whx = addWindowHistXNode(editor, 40, 40, { windowSize: 20, stride: 1, lagMode: "contiguous", lagCsv: "1,2,3,4,5", padMode: "none" });
      const whv = addWindowHistVNode(editor, 200, 40, { windowSize: 20, stride: 1, lagMode: "contiguous", lagCsv: "1,2,3,4,5", padMode: "none" });
      const px = addParamsNode(editor, 360, 40, { paramMask: pm });
      const tnorm = addTimeNormNode(editor, 520, 40);
      const sx = addScenarioNode(editor, 680, 40);
      const cx = addConcatNode(editor, 840, 40, { numInputs: 5 });
      const i = addInputNode(editor, 980, 120);
      if (editor && typeof editor.updateNodeDataFromId === "function") editor.updateNodeDataFromId(i, { mode: "sequence" });
      const g1 = addGruNode(editor, 1140, 120, { units: 96, dropout: 0.1, returnseq: "true" });
      const g2 = addGruNode(editor, 1300, 120, { units: 48, dropout: 0.1, returnseq: "false" });
      const z1 = addLatentNode(editor, 1460, 80, { units: 16, group: "z_shared", matchWeight: 1 });
      const z2 = addLatentNode(editor, 1460, 200, { units: 16, group: "z_shared", matchWeight: 1 });
      const d1 = addDenseNode(editor, 1620, 80, { units: 32, activation: "relu" });
      const o = addOutputNode(editor, 1780, 80, { target: "x", loss: "mse", wx: 1, wv: 1 });
      let ci = 1;
      editor.addConnection(whx, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(whv, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(px, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(tnorm, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(sx, cx, "output_1", "input_" + String(ci++));
      editor.addConnection(cx, i, "output_1", "input_1");
      editor.addConnection(i, g1, "output_1", "input_1");
      editor.addConnection(g1, g2, "output_1", "input_1");
      editor.addConnection(g2, z1, "output_1", "input_1");
      editor.addConnection(g2, z2, "output_1", "input_1");
      editor.addConnection(z1, d1, "output_1", "input_1");
      editor.addConnection(d1, o, "output_1", "input_1");
      return;
    }
    const directPresets = {
      direct_mlp_strong: true,
      direct_mlp_ratio: true,
      exp_dual_latent_match_direct: true,
    };
    const arGruPresets = {
      gru: true,
      ar_gru_strong: true,
      ar_gru_ratio: true,
      exp_ar_gru_window_to_x_zero_pad: true,
      exp_ar_gru_window_to_x_rk4_warmup: true,
      exp_ar_gru_latent_match: true,
    };
    const arCnnPresets = {
      exp_ar_cnn_strong: true,
    };
    const arLstmPresets = {
      lstm: true,
      ar_lstm_strong: true,
      ar_lstm_ratio: true,
    };
    const isDirectPreset = Boolean(directPresets[preset]);
    const useRatioPreset = preset === "direct_mlp_ratio" || preset === "ar_gru_ratio" || preset === "ar_lstm_ratio";
    const outputTarget = (preset.indexOf("_to_v") >= 0) ? "v" : ((preset.indexOf("_to_xv") >= 0) ? "xv" : "x");
    const includeHist = !(isDirectPreset);
    const windowPadMode = preset.indexOf("zero_pad") >= 0
      ? "zero"
      : (preset.indexOf("edge_pad") >= 0 ? "edge" : "none");
    const pm = normalizeParamMask(Object.assign({}, defaultParamMask(), {
      rkm: useRatioPreset,
      rcm: useRatioPreset,
      rgl: useRatioPreset,
    }));
    const whx = includeHist ? addWindowHistXNode(editor, 40, 40, { windowSize: 20, stride: 1, lagMode: "contiguous", lagCsv: "1,2,3,4,5", padMode: windowPadMode }) : null;
    const whv = includeHist ? addWindowHistVNode(editor, 200, 40, { windowSize: 20, stride: 1, lagMode: "contiguous", lagCsv: "1,2,3,4,5", padMode: windowPadMode }) : null;
    const px = addParamsNode(editor, includeHist ? 540 : 360, 40, { paramMask: pm });
    const tsec = addTimeSecNode(editor, includeHist ? 700 : 520, 40);
    const tnorm = addTimeNormNode(editor, includeHist ? 860 : 680, 40);
    const sx = addScenarioNode(editor, includeHist ? 860 : 680, 40);
    const sn = addSinNormNode(editor, includeHist ? 1020 : 840, 40);
    const cn = addCosNormNode(editor, includeHist ? 1180 : 1000, 40);
    const cx = addConcatNode(editor, includeHist ? 1340 : 1160, 40, { numInputs: includeHist ? 8 : 6 });
    const i = addInputNode(editor, includeHist ? 1480 : 1300, 120);
    if (editor && typeof editor.updateNodeDataFromId === "function") {
      editor.updateNodeDataFromId(i, {
        mode: (preset === "mlp" || isDirectPreset) ? "flat" : "sequence",
      });
    }
    let n1;
    let n2;
    let n3 = null;
    if (preset === "rnn") {
      n1 = addRnnNode(editor, 1340, 120, { units: 64, dropout: 0.1, returnseq: "true" });
      n2 = addRnnNode(editor, 1540, 120, { units: 32, dropout: 0.1, returnseq: "false" });
      n3 = addDenseNode(editor, 1740, 120, { units: 32, activation: "relu" });
    } else if (arGruPresets[preset]) {
      n1 = addGruNode(editor, 1340, 120, { units: 96, dropout: 0.1, returnseq: "true" });
      n2 = addGruNode(editor, 1540, 120, { units: 48, dropout: 0.1, returnseq: "false" });
      n3 = addDenseNode(editor, 1740, 120, { units: 32, activation: "relu" });
    } else if (arLstmPresets[preset]) {
      n1 = addLstmNode(editor, 1340, 120, { units: 96, dropout: 0.1, returnseq: "true" });
      n2 = addLstmNode(editor, 1540, 120, { units: 48, dropout: 0.1, returnseq: "false" });
      n3 = addDenseNode(editor, 1740, 120, { units: 32, activation: "relu" });
    } else if (arCnnPresets[preset]) {
      n1 = addConv1dNode(editor, 1340, 120, { filters: 64, kernelSize: 5, stride: 1, activation: "relu" });
      n2 = addConv1dNode(editor, 1540, 120, { filters: 32, kernelSize: 3, stride: 1, activation: "relu" });
      n3 = addDenseNode(editor, 1740, 120, { units: 32, activation: "relu" });
    } else if (preset === "direct_mlp_strong") {
      n1 = addDenseNode(editor, 1340, 120, { units: 128, activation: "relu" });
      n2 = addDenseNode(editor, 1540, 120, { units: 64, activation: "relu" });
      n3 = addDenseNode(editor, 1740, 120, { units: 32, activation: "tanh" });
    } else if (preset === "direct_mlp_ratio") {
      n1 = addDenseNode(editor, 1340, 120, { units: 128, activation: "relu" });
      n2 = addDenseNode(editor, 1540, 120, { units: 64, activation: "relu" });
      n3 = addDenseNode(editor, 1740, 120, { units: 32, activation: "relu" });
    } else {
      n1 = addDenseNode(editor, 1340, 120, { units: 96, activation: "relu" });
      n2 = addDenseNode(editor, 1540, 120, { units: 48, activation: "relu" });
      n3 = addDropoutNode(editor, 1740, 120, { rate: 0.1 });
    }
    const o = addOutputNode(editor, 1940, 120, { target: outputTarget });
    let ci = 1;
    if (whx) editor.addConnection(whx, cx, "output_1", "input_" + String(ci++));
    if (whv) editor.addConnection(whv, cx, "output_1", "input_" + String(ci++));
    editor.addConnection(px, cx, "output_1", "input_" + String(ci++));
    editor.addConnection(tsec, cx, "output_1", "input_" + String(ci++));
    editor.addConnection(tnorm, cx, "output_1", "input_" + String(ci++));
    editor.addConnection(sx, cx, "output_1", "input_" + String(ci++));
    editor.addConnection(sn, cx, "output_1", "input_" + String(ci++));
    editor.addConnection(cn, cx, "output_1", "input_" + String(ci++));
    editor.addConnection(cx, i, "output_1", "input_1");
    editor.addConnection(i, n1, "output_1", "input_1");
    editor.addConnection(n1, n2, "output_1", "input_1");
    if (n3) {
      editor.addConnection(n2, n3, "output_1", "input_1");
      editor.addConnection(n3, o, "output_1", "input_1");
    } else {
      editor.addConnection(n2, o, "output_1", "input_1");
    }
  }

  function seedDefaultGraph(editor) {
    const sid = resolveSchemaId((state && state.modelSchemaId) || "oscillator");
    const preset = getDefaultModelPreset(sid) || "direct_mlp_strong";
    seedPreconfigGraph(editor, preset);
  }

  function autoArrangeGraph(editor) {
    if (!editor || typeof editor.export !== "function") return 0;
    const data = editor.export().drawflow.Home.data || {};
    const ids = Object.keys(data);
    if (!ids.length) return 0;

    const featureSet = {
      image_source_block: true,
      sliding_window_block: true,
      window_hist_block: true,
      window_hist_x_block: true,
      window_hist_v_block: true,
      hist_block: true,
      hist_x_block: true,
      hist_v_block: true,
      x_block: true,
      v_block: true,
      params_block: true,
      time_block: true,
      time_sec_block: true,
      time_norm_block: true,
      scenario_block: true,
      trig_block: true,
      sin_norm_block: true,
      cos_norm_block: true,
      noise_schedule_block: true,
      ratio_km_block: true,
      ratio_cm_block: true,
      ratio_gl_block: true,
    };

    const layerById = {};
    const edges = [];
    ids.forEach(function (id) {
      const n = data[id];
      if (!n) return;
      if (featureSet[n.name]) layerById[id] = 0;
      else if (n.name === "concat_block") layerById[id] = 1;
      else if (n.name === "input_layer") layerById[id] = 2;
      else if (n.name === "output_layer") layerById[id] = 4;
      else layerById[id] = 3;

      const outKeys = Object.keys(n.outputs || {});
      outKeys.forEach(function (k) {
        const conns = (n.outputs[k] && n.outputs[k].connections) || [];
        conns.forEach(function (c) {
          const to = String(c.node);
          if (data[to]) edges.push([String(id), to]);
        });
      });
    });

    // Relax layers from graph edges so downstream nodes are to the right,
    // without sending any disconnected output to extreme coordinates.
    for (let pass = 0; pass < ids.length + 2; pass += 1) {
      let changed = false;
      edges.forEach(function (e) {
        const from = e[0];
        const to = e[1];
        const lf = Number(layerById[from] || 0);
        const cand = lf + 1;
        if (!Number.isFinite(layerById[to]) || layerById[to] < cand) {
          layerById[to] = cand;
          changed = true;
        }
      });
      if (!changed) break;
    }

    const layerGroups = {};
    ids.forEach(function (id) {
      const n = data[id];
      if (!n) return;
      let layer = Number(layerById[id]);
      if (!Number.isFinite(layer)) layer = 3;
      if (n.name === "output_layer" && layer < 4) layer = 4;
      if (layer > 10) layer = 10;
      if (!layerGroups[layer]) layerGroups[layer] = [];
      layerGroups[layer].push(id);
    });

    const orderedLayers = Object.keys(layerGroups).map(Number).sort(function (a, b) { return a - b; });
    const baseX = 60;
    const dx = 230;
    const startY = 40;
    const laneGap = 96;
    let moved = 0;
    const yById = {};
    const avg = function (arr) {
      if (!arr || !arr.length) return startY;
      let s = 0;
      for (let i = 0; i < arr.length; i += 1) s += Number(arr[i] || 0);
      return s / arr.length;
    };

    orderedLayers.forEach(function (layer) {
      const arr = layerGroups[layer].slice();
      const desiredY = {};
      arr.forEach(function (id, idx) {
        const inc = [];
        const node = data[id];
        Object.keys((node && node.inputs) || {}).forEach(function (ik) {
          const conns = (node.inputs[ik] && node.inputs[ik].connections) || [];
          conns.forEach(function (c) {
            const pid = String(c.node);
            if (Object.prototype.hasOwnProperty.call(yById, pid)) inc.push(yById[pid]);
          });
        });
        desiredY[id] = inc.length ? avg(inc) : (startY + idx * laneGap);
      });
      arr.sort(function (a, b) {
        const da = Number(desiredY[a] || 0);
        const db = Number(desiredY[b] || 0);
        if (da !== db) return da - db;
        return Number(a) - Number(b);
      });

      let cursor = startY;
      arr.forEach(function (id) {
        const x = baseX + layer * dx;
        const y = Math.max(Number(desiredY[id] || startY), cursor);
        cursor = y + laneGap;
        yById[id] = y;
        const n = data[id];
        if (!n) return;
        n.pos_x = x;
        n.pos_y = y;
        const el = document.getElementById("node-" + id);
        if (el && el.style) {
          el.style.left = String(x) + "px";
          el.style.top = String(y) + "px";
        }
        if (typeof editor.updateConnectionNodes === "function") {
          editor.updateConnectionNodes("node-" + id);
        }
        moved += 1;
      });
    });
    return moved;
  }

  function fitGraphToViewport(editor, containerEl) {
    if (!editor || typeof editor.export !== "function" || !containerEl) return false;
    const data = editor.export().drawflow.Home.data || {};
    const allIds = Object.keys(data);
    let ids = allIds.slice();
    const inputIds = allIds.filter(function (id) { return data[id] && data[id].name === "input_layer"; });
    if (inputIds.length) {
      const seen = {};
      const q = [String(inputIds[0])];
      seen[String(inputIds[0])] = true;
      while (q.length) {
        const id = q.shift();
        const n = data[id];
        if (!n || !n.outputs) continue;
        Object.keys(n.outputs).forEach(function (ok) {
          const conns = (n.outputs[ok] && n.outputs[ok].connections) || [];
          conns.forEach(function (c) {
            const to = String(c.node);
            if (!seen[to] && data[to]) {
              seen[to] = true;
              q.push(to);
            }
          });
        });
      }
      const primary = Object.keys(seen);
      if (primary.length) ids = primary;
    }
    if (!ids.length) return false;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let any = false;

    ids.forEach(function (id) {
      const n = data[id];
      if (!n) return;
      const el = document.getElementById("node-" + id);
      const w = (el && el.offsetWidth) ? el.offsetWidth : 180;
      const h = (el && el.offsetHeight) ? el.offsetHeight : 90;
      const x = Number(n.pos_x || 0);
      const y = Number(n.pos_y || 0);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
      any = true;
    });
    if (!any) return false;

    const vw = Math.max(1, Number(containerEl.clientWidth || 0));
    const vh = Math.max(1, Number(containerEl.clientHeight || 0));
    if (vw < 80 || vh < 80) return false;
    const pad = 40;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const sx = (vw - 2 * pad) / bw;
    const sy = (vh - 2 * pad) / bh;
    const scale = clamp(Math.min(sx, sy, 0.88), 0.18, 1);
    const graphCx = (minX + maxX) * 0.5;
    const graphCy = (minY + maxY) * 0.5;
    const viewCx = vw * 0.5;
    const viewCy = vh * 0.5;
    const tx = viewCx - graphCx * scale;
    const ty = viewCy - graphCy * scale;

    const p = editor.precanvas || containerEl.querySelector(".precanvas");
    if (!p || !p.style) return false;
    p.style.transformOrigin = "0 0";
    const applyTransform = function (txv, tyv, zv) {
      p.style.transform = "translate(" + txv.toFixed(2) + "px, " + tyv.toFixed(2) + "px) scale(" + zv.toFixed(4) + ")";
      if (Object.prototype.hasOwnProperty.call(editor, "zoom")) editor.zoom = zv;
      if (Object.prototype.hasOwnProperty.call(editor, "canvas_x")) editor.canvas_x = txv;
      if (Object.prototype.hasOwnProperty.call(editor, "canvas_y")) editor.canvas_y = tyv;
    };
    applyTransform(tx, ty, scale);

    ids.forEach(function (id) {
      if (typeof editor.updateConnectionNodes === "function") editor.updateConnectionNodes("node-" + id);
    });

    // Post-render calibration: center based on actual rendered node rectangles.
    const crect = containerEl.getBoundingClientRect ? containerEl.getBoundingClientRect() : null;
    if (crect && Number.isFinite(crect.width) && Number.isFinite(crect.height) && crect.width > 20 && crect.height > 20) {
      let rx0 = Number.POSITIVE_INFINITY;
      let ry0 = Number.POSITIVE_INFINITY;
      let rx1 = Number.NEGATIVE_INFINITY;
      let ry1 = Number.NEGATIVE_INFINITY;
      let rAny = false;
      ids.forEach(function (id) {
        const el = document.getElementById("node-" + id);
        if (!el || !el.getBoundingClientRect) return;
        const r = el.getBoundingClientRect();
        if (!r || !Number.isFinite(r.width) || !Number.isFinite(r.height) || r.width <= 0 || r.height <= 0) return;
        rx0 = Math.min(rx0, r.left);
        ry0 = Math.min(ry0, r.top);
        rx1 = Math.max(rx1, r.right);
        ry1 = Math.max(ry1, r.bottom);
        rAny = true;
      });
      if (rAny) {
        const graphCxPx = (rx0 + rx1) * 0.5;
        const graphCyPx = (ry0 + ry1) * 0.5;
        const viewCxPx = crect.left + crect.width * 0.5;
        const viewCyPx = crect.top + crect.height * 0.5;
        const dxPx = viewCxPx - graphCxPx;
        const dyPx = viewCyPx - graphCyPx;
        if (Math.abs(dxPx) > 1 || Math.abs(dyPx) > 1) {
          applyTransform(tx + dxPx, ty + dyPx, scale);
          ids.forEach(function (id) {
            if (typeof editor.updateConnectionNodes === "function") editor.updateConnectionNodes("node-" + id);
          });
        }
      }
    }
    return true;
  }

  function nudgeGraphToViewportCenter(editor, containerEl) {
    if (!editor || !containerEl) return false;
    const p = editor.precanvas || containerEl.querySelector(".precanvas");
    if (!p || !p.style) return false;
    const crect = containerEl.getBoundingClientRect ? containerEl.getBoundingClientRect() : null;
    if (!crect || !Number.isFinite(crect.width) || !Number.isFinite(crect.height) || crect.width < 40 || crect.height < 40) return false;

    const nodeEls = Array.from(containerEl.querySelectorAll(".drawflow-node"));
    if (!nodeEls.length) return false;
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    let any = false;
    nodeEls.forEach(function (el) {
      if (!el || !el.getBoundingClientRect) return;
      const r = el.getBoundingClientRect();
      if (!r || !Number.isFinite(r.width) || !Number.isFinite(r.height) || r.width <= 0 || r.height <= 0) return;
      x0 = Math.min(x0, r.left);
      y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right);
      y1 = Math.max(y1, r.bottom);
      any = true;
    });
    if (!any) return false;

    const graphCx = (x0 + x1) * 0.5;
    const graphCy = (y0 + y1) * 0.5;
    const viewCx = crect.left + crect.width * 0.5;
    const viewCy = crect.top + crect.height * 0.5;
    const dx = viewCx - graphCx;
    const dy = viewCy - graphCy;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return true;

    const curX = Number(editor.canvas_x || 0);
    const curY = Number(editor.canvas_y || 0);
    const z = Number(editor.zoom || 1);
    const nx = curX + dx;
    const ny = curY + dy;
    p.style.transformOrigin = "0 0";
    p.style.transform = "translate(" + nx.toFixed(2) + "px, " + ny.toFixed(2) + "px) scale(" + z.toFixed(4) + ")";
    if (Object.prototype.hasOwnProperty.call(editor, "canvas_x")) editor.canvas_x = nx;
    if (Object.prototype.hasOwnProperty.call(editor, "canvas_y")) editor.canvas_y = ny;
    return true;
  }

  function scheduleFitGraphToViewport(editor, containerEl) {
    fitGraphToViewport(editor, containerEl);
    nudgeGraphToViewportCenter(editor, containerEl);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        fitGraphToViewport(editor, containerEl);
        nudgeGraphToViewportCenter(editor, containerEl);
      });
    }
    setTimeout(function () { fitGraphToViewport(editor, containerEl); nudgeGraphToViewportCenter(editor, containerEl); }, 0);
    setTimeout(function () { fitGraphToViewport(editor, containerEl); nudgeGraphToViewportCenter(editor, containerEl); }, 80);
    setTimeout(function () { fitGraphToViewport(editor, containerEl); nudgeGraphToViewportCenter(editor, containerEl); }, 220);
    setTimeout(function () { fitGraphToViewport(editor, containerEl); nudgeGraphToViewportCenter(editor, containerEl); }, 500);
    setTimeout(function () { nudgeGraphToViewportCenter(editor, containerEl); }, 800);
  }

  function estimateNodeFeatureWidth(moduleData, nodeId, memo, stack) {
    const key = String(nodeId || "");
    if (!moduleData || !moduleData[key]) return 0;
    if (memo && Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
    if (stack && stack[key]) return 0;
    if (!memo) memo = {};
    if (!stack) stack = {};
    stack[key] = true;
    const node = moduleData[key];
    const d = node.data || {};
    let out = 0;
    if (node.name === "window_hist_block" || node.name === "window_hist_x_block" || node.name === "window_hist_v_block" || node.name === "sliding_window_block") {
      out = Math.max(1, Number(d.windowSize || 20));
    } else if (node.name === "image_source_block") {
      out = Math.max(1, Number(d.featureSize || 784));
    } else if (node.name === "hist_block" || node.name === "hist_x_block" || node.name === "x_block" || node.name === "hist_v_block" || node.name === "v_block") {
      out = 1;
    } else if (node.name === "params_block") {
      out = countStaticParams(normalizeParamMask(d.paramMask));
    } else if (node.name === "scenario_block") {
      out = 3;
    } else if (
      node.name === "time_block" ||
      node.name === "time_sec_block" ||
      node.name === "time_norm_block" ||
      node.name === "trig_block" ||
      node.name === "sin_norm_block" ||
      node.name === "cos_norm_block" ||
      node.name === "ratio_km_block" ||
      node.name === "ratio_cm_block" ||
      node.name === "ratio_gl_block"
    ) {
      out = 1;
    } else if (node.name === "concat_block") {
      let sum = 0;
      Object.keys(node.inputs || {}).forEach(function (ik) {
        const conns = (node.inputs[ik] && node.inputs[ik].connections) || [];
        conns.forEach(function (c) {
          const fromId = String(c.node);
          sum += estimateNodeFeatureWidth(moduleData, fromId, memo, stack);
        });
      });
      out = sum;
    } else {
      Object.keys(node.inputs || {}).forEach(function (ik) {
        const conns = (node.inputs[ik] && node.inputs[ik].connections) || [];
        conns.forEach(function (c) {
          const fromId = String(c.node);
          out = Math.max(out, estimateNodeFeatureWidth(moduleData, fromId, memo, stack));
        });
      });
    }
    memo[key] = out;
    delete stack[key];
    return out;
  }

  function getNodeSummary(node, nodeId, moduleData) {
    if (!node) return "";
    const d = node.data || {};
    if (node.name === "input_layer") return "mode=" + String(d.mode || "auto");
    if (node.name === "dense_layer") return "u=" + Number(d.units || 32) + ", act=" + String(d.activation || "relu");
    if (node.name === "latent_layer") return "u=" + Number(d.units || 16) + ", g=" + String(d.group || "z_shared") + ", w=" + Number(d.matchWeight || 1).toFixed(2);
    if (node.name === "latent_mu_layer") return "u=" + Number(d.units || 16) + ", g=" + String(d.group || "z_shared") + ", w=" + Number(d.matchWeight || 1).toFixed(2);
    if (node.name === "latent_logvar_layer") return "u=" + Number(d.units || 16) + ", g=" + String(d.group || "z_shared") + ", w=" + Number(d.matchWeight || 1).toFixed(2);
    if (node.name === "reparam_layer") return "g=" + String(d.group || "z_shared") + ", β=" + Number(d.beta || 1e-3).toExponential(1) + ", w=" + Number(d.matchWeight || 1).toFixed(2);
    if (node.name === "dropout_layer") return "rate=" + Number(d.rate || 0.1).toFixed(2);
    if (node.name === "batchnorm_layer") return "m=" + Number(d.momentum || 0.99).toFixed(3) + ", ε=" + Number(d.epsilon || 1e-3).toExponential(1);
    if (node.name === "layernorm_layer") return "ε=" + Number(d.epsilon || 1e-3).toExponential(1);
    if (node.name === "rnn_layer" || node.name === "gru_layer" || node.name === "lstm_layer") {
      return "u=" + Number(d.units || 64) + ", d=" + Number(d.dropout || 0).toFixed(2) + ", rs=" + String(d.returnseq || "auto");
    }
    if (node.name === "sliding_window_block") return "w=" + Number(d.windowSize || 20) + ", s=" + Number(d.stride || 1) + ", " + String(d.lagMode || "contiguous") + ", " + String(d.padMode || "none");
    if (node.name === "window_hist_block") {
      const sId = resolveSchemaId(state && state.modelSchemaId);
      const fk = normalizeHistorySeriesKey(d.featureKey || "x", sId);
      return "feature=" + historySeriesLabel(fk, sId) + ", w=" + Number(d.windowSize || 20) + ", s=" + Number(d.stride || 1) + ", " + String(d.lagMode || "contiguous") + ", " + String(d.padMode || "none");
    }
    if (node.name === "image_source_block") {
      const sId = resolveSchemaId(state && state.modelSchemaId);
      const srcSpec = getImageSourceSpec(d.sourceKey || "", sId);
      const featureSize = Math.max(1, Number(d.featureSize || srcSpec.featureSize || 1));
      const width = Math.max(1, Number(d.imageWidth || srcSpec.width || 1));
      const height = Math.max(1, Number(d.imageHeight || srcSpec.height || 1));
      const channels = Math.max(1, Number(d.imageChannels || srcSpec.channels || 1));
      return "feature=" + srcSpec.label + ", shape=" + width + "x" + height + "x" + channels + ", n=" + String(Math.round(featureSize));
    }
    if (node.name === "window_hist_x_block") return "wx=" + Number(d.windowSize || 20) + ", s=" + Number(d.stride || 1) + ", " + String(d.lagMode || "contiguous") + ", " + String(d.padMode || "none");
    if (node.name === "window_hist_v_block") return "wv=" + Number(d.windowSize || 20) + ", s=" + Number(d.stride || 1) + ", " + String(d.lagMode || "contiguous") + ", " + String(d.padMode || "none");
    if (node.name === "hist_block") {
      const sId = resolveSchemaId(state && state.modelSchemaId);
      const fk = normalizeHistorySeriesKey(d.featureKey || "x", sId);
      return "feature=" + historySeriesLabel(fk, sId);
    }
    if (node.name === "hist_x_block" || node.name === "x_block") return "x(t-1)";
    if (node.name === "hist_v_block" || node.name === "v_block") return "v(t-1)";
    if (node.name === "params_block") {
      const pm = normalizeParamMask(d.paramMask);
      const names = [];
      if (pm.m) names.push("m");
      if (pm.c) names.push("c");
      if (pm.k) names.push("k");
      if (pm.e) names.push("e");
      if (pm.x0) names.push("x0");
      if (pm.v0) names.push("v0");
      if (pm.gm) names.push("gm");
      if (pm.gk) names.push("gk");
      if (pm.gc) names.push("gc");
      if (pm.rkm) names.push("k/m");
      if (pm.rcm) names.push("c/m");
      if (pm.rgl) names.push("g/L");
      return "n=" + String(countStaticParams(pm)) + " [" + names.join(",") + "]";
    }
    if (node.name === "time_block") return "t/T";
    if (node.name === "time_sec_block") return "t (sec)";
    if (node.name === "time_norm_block") return "t/T";
    if (node.name === "scenario_block") {
      const sId = resolveSchemaId(state && state.modelSchemaId);
      const k = normalizeOneHotKey(d.oneHotKey || "scenario", sId);
      const defs = getSchemaOneHotDefs(sId);
      const hit = defs.find(function (x) { return String(x.key || "") === k; });
      const n = Math.max(1, Number((hit && Array.isArray(hit.values) ? hit.values.length : 3)));
      return "field=" + oneHotLabel(k, sId) + ", one-hot n=" + String(n);
    }
    if (node.name === "trig_block") return "sin/cos(2π·t/T)";
    if (node.name === "sin_norm_block") return "sin(2π·t/T)";
    if (node.name === "cos_norm_block") return "cos(2π·t/T)";
    if (node.name === "noise_schedule_block") return "β(t), ᾱ(t), σ(t)";
    if (node.name === "conv1d_layer") return "f=" + Number(d.filters || 64) + ", k=" + Number(d.kernelSize || 3) + ", s=" + Number(d.stride || 1) + ", act=" + String(d.activation || "relu");
    if (node.name === "concat_block") {
      const nIn = Object.keys(node.inputs || {}).length || Math.max(1, Number(d.numInputs || 5));
      const featW = estimateNodeFeatureWidth(moduleData || {}, nodeId, {}, {});
      return "merge features, in=" + String(nIn) + ", feat≈" + String(Math.max(0, Number(featW || 0)));
    }
    if (node.name === "output_layer") {
      const rawLoss = String(d.loss || "mse");
      const loss = rawLoss === "use_global" ? "mse" : rawLoss;
      const targets = outputTargetsFromNodeData(d, state && state.modelSchemaId, "x");
      const hasParams = targets.indexOf("params") >= 0;
      const hasXV = targets.indexOf("xv") >= 0;
      const hasTraj = targets.indexOf("traj") >= 0;
      const parts = [outputTargetsSummaryText(targets, state && state.modelSchemaId), "loss=" + loss];
      if (hasXV) parts.push("w=(" + Number(d.wx || 1).toFixed(2) + "," + Number(d.wv || 1).toFixed(2) + ")");
      if (hasParams) {
        const s = String(d.paramsSelect || "").trim();
        parts.push("params=[" + (s ? s : "all") + "]");
      }
      if (hasTraj) parts.push("full-seq");
      parts.push("w=" + Number(d.matchWeight || 1).toFixed(2));
      return parts.join(", ");
    }
    return "";
  }

  function refreshNodeSummaries(editor) {
    if (!editor || typeof editor.export !== "function") return;
    const moduleData = editor.export().drawflow.Home.data;
    Object.keys(moduleData).forEach(function (id) {
      const node = moduleData[id];
      const el = document.querySelector("#node-" + id + " .node-summary");
      if (el) el.textContent = getNodeSummary(node, id, moduleData);
    });
  }

  function getDrawflowNodeFromElement(editor, el) {
    if (!editor || !el || typeof editor.export !== "function") return null;
    const nodeEl = el.closest(".drawflow-node");
    if (!nodeEl || !nodeEl.id) return null;
    const id = String(nodeEl.id).replace("node-", "");
    const moduleData = editor.export().drawflow.Home.data;
    if (!moduleData || !moduleData[id]) return null;
    return { id: id, node: moduleData[id], nodeEl: nodeEl };
  }

  function getDrawflowNodeById(editor, nodeId) {
    if (!editor || !nodeId || typeof editor.export !== "function") return null;
    const moduleData = editor.export().drawflow.Home.data;
    if (!moduleData || !moduleData[nodeId]) return null;
    return { id: String(nodeId), node: moduleData[nodeId] };
  }

  function setConcatInputCount(editor, nodeId, desiredCount) {
    const hit = getDrawflowNodeById(editor, nodeId);
    if (!hit || !hit.node || hit.node.name !== "concat_block") return false;
    const node = hit.node;
    const clampCount = clamp(Math.round(Number(desiredCount) || 5), 1, 24);
    const inputs = node.inputs || {};
    const keys = Object.keys(inputs);
    const parseIdx = function (k) {
      const m = String(k || "").match(/input_(\d+)/);
      return m ? Number(m[1]) : 0;
    };
    const current = keys.length || Number(node.data && node.data.numInputs) || 5;
    const connectedMax = keys.reduce(function (mx, k) {
      const conns = (inputs[k] && inputs[k].connections) || [];
      if (conns.length) return Math.max(mx, parseIdx(k));
      return mx;
    }, 0);
    const target = Math.max(clampCount, connectedMax || 0, 1);
    if (target === current) return true;

    if (typeof editor.addNodeInput === "function" && typeof editor.removeNodeInput === "function") {
      if (target > current) {
        for (let i = current + 1; i <= target; i += 1) editor.addNodeInput(String(nodeId));
      } else {
        for (let i = current; i > target; i -= 1) editor.removeNodeInput(String(nodeId), "input_" + String(i));
      }
    } else {
      if (!node.inputs) node.inputs = {};
      if (target > current) {
        for (let i = current + 1; i <= target; i += 1) {
          node.inputs["input_" + String(i)] = { connections: [] };
        }
      } else {
        for (let i = current; i > target; i -= 1) {
          const k = "input_" + String(i);
          const conns = (node.inputs[k] && node.inputs[k].connections) || [];
          if (conns.length) continue;
          delete node.inputs[k];
        }
      }
    }
    const nodeAfter = getDrawflowNodeById(editor, nodeId);
    if (nodeAfter && nodeAfter.node) {
      const d = Object.assign({}, nodeAfter.node.data || {});
      d.numInputs = target;
      if (typeof editor.updateNodeDataFromId === "function") editor.updateNodeDataFromId(String(nodeId), d);
      else nodeAfter.node.data = d;
    }
    if (typeof editor.updateConnectionNodes === "function") editor.updateConnectionNodes("node-" + String(nodeId));
    return true;
  }

  function applyNodeConfigUpdate(editor, nodeId, key, rawValue) {
    const hit = getDrawflowNodeById(editor, nodeId);
    if (!hit) return false;
    const node = hit.node;
    const data = Object.assign({}, node.data || {});
    const k = String(key || "");

    if (k === "target" || k === "targetType") {
      const v = String(rawValue || "x");
      const target = (v === "xv" || v === "v" || v === "params" || v === "traj") ? v : "x";
      const updated = writeOutputTargetsToNodeData(data, [target], state && state.modelSchemaId);
      Object.keys(updated).forEach(function (kk) { data[kk] = updated[kk]; });
    } else if (k === "targetsCsv") {
      const updated = writeOutputTargetsToNodeData(data, String(rawValue || ""), state && state.modelSchemaId);
      Object.keys(updated).forEach(function (kk) { data[kk] = updated[kk]; });
    } else if (k.indexOf("target_") === 0) {
      const tKey = String(k.slice(7) || "").trim();
      const cur = outputTargetsFromNodeData(data, state && state.modelSchemaId, "x");
      const next = cur.slice();
      if (Boolean(rawValue)) {
        if (next.indexOf(tKey) < 0) next.push(tKey);
      } else {
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i] === tKey) next.splice(i, 1);
        }
      }
      const updated = writeOutputTargetsToNodeData(data, next, state && state.modelSchemaId);
      Object.keys(updated).forEach(function (kk) { data[kk] = updated[kk]; });
    } else if (k === "paramsSelect") {
      const cleaned = String(rawValue || "")
        .replace(/[^a-zA-Z0-9_,]/g, "")
        .replace(/\s+/g, "")
        .replace(/,+/g, ",")
        .replace(/^,|,$/g, "");
      data.paramsSelect = cleaned;
    } else if (k === "loss") {
      const v = String(rawValue || "mse");
      data.loss = (v === "mse" || v === "mae" || v === "huber") ? v : "mse";
    } else if (k === "wx") {
      data.wx = Math.max(0, Number(rawValue) || 1);
    } else if (k === "wv") {
      data.wv = Math.max(0, Number(rawValue) || 1);
    } else if (k === "windowSize") {
      data.windowSize = Math.max(5, Number(rawValue) || 20);
    } else if (k === "stride") {
      data.stride = Math.max(1, Number(rawValue) || 1);
    } else if (k === "lagMode") {
      const v = String(rawValue || "contiguous");
      data.lagMode = (v === "exact") ? "exact" : "contiguous";
    } else if (k === "lagCsv") {
      const cleaned = String(rawValue || "")
        .replace(/[^0-9,\s\-]/g, "")
        .replace(/\s+/g, "")
        .replace(/,+/g, ",")
        .replace(/^,|,$/g, "");
      data.lagCsv = cleaned || "1,2,3,4,5";
    } else if (k === "padMode") {
      const v = String(rawValue || "none");
      data.padMode = (v === "zero" || v === "edge") ? v : "none";
    } else if (k === "featureKey") {
      data.featureKey = normalizeHistorySeriesKey(rawValue || "x", state && state.modelSchemaId);
    } else if (k === "sourceKey") {
      const schemaId = resolveSchemaId(state && state.modelSchemaId);
      const srcSpec = getImageSourceSpec(rawValue || "", schemaId);
      data.sourceKey = srcSpec.sourceKey;
      data.featureSize = srcSpec.featureSize;
      data.imageShape = srcSpec.shape.slice();
      data.imageHeight = srcSpec.height;
      data.imageWidth = srcSpec.width;
      data.imageChannels = srcSpec.channels;
    } else if (k === "oneHotKey") {
      data.oneHotKey = normalizeOneHotKey(rawValue || "scenario", state && state.modelSchemaId);
    } else if (k.indexOf("pm_") === 0) {
      const pm = normalizeParamMask(data.paramMask);
      const pKey = k.slice(3);
      if (Object.prototype.hasOwnProperty.call(pm, pKey)) pm[pKey] = Boolean(rawValue);
      data.paramMask = normalizeParamMask(pm);
    } else if (k === "mode") {
      const m = String(rawValue || "auto");
      data.mode = (m === "flat" || m === "sequence") ? m : "auto";
    } else if (k === "units") {
      if (node.name === "latent_layer" || node.name === "latent_mu_layer" || node.name === "latent_logvar_layer") data.units = Math.max(2, Math.round(Number(rawValue) || 16));
      else data.units = Math.max(1, Math.round(Number(rawValue) || 32));
    } else if (k === "group") {
      const g = String(rawValue || "z_shared").trim().replace(/\s+/g, "_");
      data.group = g || "z_shared";
    } else if (k === "matchWeight") {
      data.matchWeight = Math.max(0, Number(rawValue) || 1);
    } else if (k === "beta") {
      data.beta = Math.max(0, Number(rawValue) || 1e-3);
    } else if (k === "activation") {
      const a = String(rawValue || "relu");
      data.activation = ["relu", "tanh", "sigmoid", "linear"].indexOf(a) >= 0 ? a : "relu";
    } else if (k === "filters") {
      data.filters = Math.max(1, Math.round(Number(rawValue) || 64));
    } else if (k === "kernelSize") {
      data.kernelSize = Math.max(1, Math.round(Number(rawValue) || 3));
    } else if (k === "strideConv") {
      data.stride = Math.max(1, Math.round(Number(rawValue) || 1));
    } else if (k === "rate") {
      data.rate = clamp(Number(rawValue) || 0.1, 0, 0.9);
    } else if (k === "momentum") {
      data.momentum = clamp(Number(rawValue) || 0.99, 0.1, 0.999);
    } else if (k === "epsilon") {
      data.epsilon = Math.max(1e-6, Number(rawValue) || 1e-3);
    } else if (k === "dropout") {
      data.dropout = clamp(Number(rawValue) || 0.1, 0, 0.8);
    } else if (k === "returnseq") {
      const rs = String(rawValue || "auto");
      data.returnseq = (rs === "true" || rs === "false") ? rs : "auto";
    } else if (k === "numInputs") {
      return setConcatInputCount(editor, hit.id, rawValue);
    } else {
      return false;
    }

    if (typeof editor.updateNodeDataFromId === "function") editor.updateNodeDataFromId(hit.id, data);
    else node.data = data;
    return true;
  }

  function getNodeDisplayName(name) {
    const map = {
      input_layer: "Input",
      dense_layer: "Dense",
      latent_layer: "Latent Z",
      latent_mu_layer: "Latent μ",
      latent_logvar_layer: "Latent logσ²",
      reparam_layer: "Reparam z",
      dropout_layer: "Dropout",
      batchnorm_layer: "BatchNorm",
      layernorm_layer: "LayerNorm",
      output_layer: "Output",
      sliding_window_block: "SlidingWindow",
      window_hist_block: "WindowHistory",
      window_hist_x_block: "WindowHistX",
      window_hist_v_block: "WindowHistV",
      hist_block: "History",
      hist_x_block: "History X",
      hist_v_block: "History V",
      x_block: "X",
      v_block: "V",
      params_block: "Features",
      time_block: "Time",
      time_sec_block: "TimeSec",
      time_norm_block: "TimeNorm",
      scenario_block: "OneHot",
      trig_block: "Sin/Cos",
      sin_norm_block: "SinNorm",
      cos_norm_block: "CosNorm",
      noise_schedule_block: "NoiseSchedule",
      concat_block: "Concat",
      conv1d_layer: "Conv1D",
      rnn_layer: "SimpleRNN",
      gru_layer: "GRU",
      lstm_layer: "LSTM",
      image_source_block: "ImageSource",
    };
    return map[name] || String(name || "Node");
  }

  function renderNodeConfigPanel(editor, nodeId) {
    if (!ui.nodeConfigTitle || !ui.nodeConfigBody) return;
    const hit = getDrawflowNodeById(editor, nodeId);
    if (!hit) {
      ui.nodeConfigTitle.textContent = "No node selected";
      ui.nodeConfigBody.innerHTML = "<div style='font-size:12px;color:#94a3b8;'>Click a node gear in Model tab to edit its settings here.</div>";
      return;
    }
    const node = hit.node;
    const d = node.data || {};
    ui.nodeConfigTitle.textContent = getNodeDisplayName(node.name) + " (#" + hit.id + ")";

    const row = function (label, html) {
      return "<div class='row'><label>" + label + "</label>" + html + "</div>";
    };
    const checkbox = function (k, on, text) {
      return "<label style='display:flex;align-items:center;gap:6px;'><input class='node-cfg-field' data-key='" + k + "' type='checkbox'" + (on ? " checked" : "") + "> " + text + "</label>";
    };

    let html = "";
    if (node.name === "output_layer") {
      const schemaId = resolveSchemaId(state && state.modelSchemaId);
      const schema = getModelSchemaConfig(schemaId);
      const targets = outputTargetsFromNodeData(d, schemaId, "x");
      const rawLoss = String(d.loss || "mse");
      const loss = rawLoss === "use_global" ? "mse" : rawLoss;
      const targetCols = schema.outputs.map(function (o) {
        const key = String(o.key || "");
        const checked = targets.indexOf(key) >= 0;
        return "<label style='display:flex;align-items:center;gap:6px;justify-content:flex-start;padding:6px 8px;border:1px solid #334155;border-radius:8px;'>" +
          "<input class='node-cfg-field' data-key='target_" + key + "' type='checkbox'" + (checked ? " checked" : "") + "> " + String(o.label || key) +
          "</label>";
      }).join("");
      html += "<div style='font-size:11px;color:#94a3b8;margin-bottom:6px;'>Select one or multiple output heads.</div>";
      html += "<div style='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;align-items:stretch;'>" + targetCols + "</div>";
      html += row(
        "Loss",
        "<select class='node-cfg-field' data-key='loss'>" +
        "<option value='mse'" + (loss === "mse" ? " selected" : "") + ">mse</option>" +
        "<option value='mae'" + (loss === "mae" ? " selected" : "") + ">mae</option>" +
        "<option value='huber'" + (loss === "huber" ? " selected" : "") + ">huber</option>" +
        "</select>"
      );
      html += row("Match weight", "<input class='node-cfg-field' data-key='matchWeight' type='number' min='0' step='0.1' value='" + Math.max(0, Number(d.matchWeight || 1)).toFixed(2) + "'>");
      if (targets.indexOf("xv") >= 0) {
        html += row("Weight x", "<input class='node-cfg-field' data-key='wx' type='number' min='0' step='0.1' value='" + Math.max(0, Number(d.wx || 1)).toFixed(2) + "'>");
        html += row("Weight v", "<input class='node-cfg-field' data-key='wv' type='number' min='0' step='0.1' value='" + Math.max(0, Number(d.wv || 1)).toFixed(2) + "'>");
        html += "<div style='font-size:11px;color:#94a3b8;'>Weighted head loss: L = w_x·L_x + w_v·L_v (normalized by w_x+w_v).</div>";
      }
      if (targets.indexOf("params") >= 0) {
        html += row("Params select", "<input class='node-cfg-field' data-key='paramsSelect' type='text' value='" + String(d.paramsSelect || "") + "' placeholder='m,c,k,e,x0,v0,...'>");
        html += "<div style='font-size:11px;color:#94a3b8;'>Leave empty to use all params. Comma-separated keys.</div>";
      }
      if (targets.indexOf("traj") >= 0) {
        html += "<div style='font-size:11px;color:#94a3b8;'>Trajectory reconstruction head. In notebook pipeline this maps to full x(t) sequence target.</div>";
      }
    } else if (node.name === "image_source_block") {
      const schemaId = resolveSchemaId(state && state.modelSchemaId);
      const defs = getSchemaImageSourceDefs(schemaId);
      const srcSpec = getImageSourceSpec(d.sourceKey || "", schemaId);
      const sourceKey = srcSpec.sourceKey;
      const opts = defs.map(function (f) {
        const key = String(f.key || "");
        const label = String(f.label || key);
        return "<option value='" + key + "'" + (sourceKey === key ? " selected" : "") + ">" + label + "</option>";
      }).join("");
      const featureSize = Math.max(1, Number(d.featureSize || srcSpec.featureSize || 1));
      const width = Math.max(1, Number(d.imageWidth || srcSpec.width || 1));
      const height = Math.max(1, Number(d.imageHeight || srcSpec.height || 1));
      const channels = Math.max(1, Number(d.imageChannels || srcSpec.channels || 1));
      html += row("Image source", "<select class='node-cfg-field' data-key='sourceKey'>" + opts + "</select>");
      html += row("Image width", "<input type='number' value='" + String(Math.round(width)) + "' disabled>");
      html += row("Image height", "<input type='number' value='" + String(Math.round(height)) + "' disabled>");
      html += row("Channels", "<input type='number' value='" + String(Math.round(channels)) + "' disabled>");
      html += row("Flatten size", "<input type='number' value='" + String(Math.round(featureSize)) + "' disabled>");
      html += "<div style='font-size:11px;color:#94a3b8;'>Source + image shape are controlled by schema metadata.</div>";
    } else if (node.name === "sliding_window_block" || node.name === "window_hist_block" || node.name === "window_hist_x_block" || node.name === "window_hist_v_block") {
      if (node.name === "window_hist_block") {
        const schemaId = resolveSchemaId(state && state.modelSchemaId);
        const defs = getSchemaHistorySeriesDefs(schemaId);
        const featureKey = normalizeHistorySeriesKey(d.featureKey || "x", schemaId);
        const opts = defs.map(function (f) {
          const key = String(f.key || "");
          const label = String(f.label || key);
          return "<option value='" + key + "'" + (featureKey === key ? " selected" : "") + ">" + label + "</option>";
        }).join("");
        html += row("History source", "<select class='node-cfg-field' data-key='featureKey'>" + opts + "</select>");
        if (!defs.length) {
          html += "<div style='font-size:11px;color:#94a3b8;'>No history features are allowed for current schema.</div>";
        }
      }
      html += row("Window size", "<input class='node-cfg-field' data-key='windowSize' type='number' min='5' value='" + Math.max(5, Number(d.windowSize || 20)) + "'>");
      html += row("Stride", "<input class='node-cfg-field' data-key='stride' type='number' min='1' value='" + Math.max(1, Number(d.stride || 1)) + "'>");
      html += row("Lag mode", "<select class='node-cfg-field' data-key='lagMode'><option value='contiguous'" + (String(d.lagMode || "contiguous") === "contiguous" ? " selected" : "") + ">contiguous</option><option value='exact'" + (String(d.lagMode || "contiguous") === "exact" ? " selected" : "") + ">exact</option></select>");
      html += row("Lag csv", "<input class='node-cfg-field' data-key='lagCsv' type='text' value='" + String(d.lagCsv || "1,2,3,4,5") + "' placeholder='1,2,5'>");
      html += row("Pad mode", "<select class='node-cfg-field' data-key='padMode'><option value='none'" + (String(d.padMode || "none") === "none" ? " selected" : "") + ">none (no pad)</option><option value='zero'" + (String(d.padMode || "none") === "zero" ? " selected" : "") + ">zero pad</option><option value='edge'" + (String(d.padMode || "none") === "edge" ? " selected" : "") + ">edge pad x(0),v(0)</option></select>");
    } else if (node.name === "hist_block") {
      const schemaId = resolveSchemaId(state && state.modelSchemaId);
      const defs = getSchemaHistorySeriesDefs(schemaId);
      const featureKey = normalizeHistorySeriesKey(d.featureKey || "x", schemaId);
      const opts = defs.map(function (f) {
        const key = String(f.key || "");
        const label = String(f.label || key);
        return "<option value='" + key + "'" + (featureKey === key ? " selected" : "") + ">" + label + "</option>";
      }).join("");
      html += row("History source", "<select class='node-cfg-field' data-key='featureKey'>" + opts + "</select>");
      if (!defs.length) {
        html += "<div style='font-size:11px;color:#94a3b8;'>No history features are allowed for current schema.</div>";
      }
    } else if (node.name === "params_block") {
      const pm = normalizeParamMask(d.paramMask);
      html += "<div style='font-size:11px;color:#94a3b8;margin-bottom:6px;'>Choose numeric feature columns from schema</div>";
      html += "<div style='font-size:11px;color:#94a3b8;margin-bottom:6px;'>Shared schema: k_slg = k (spring), L (pendulum), g (bouncing). Use OneHot node for disambiguation.</div>";
      html += "<div style='font-size:11px;color:#94a3b8;margin-bottom:6px;'>Optional derived ratios are configured here (not separate nodes): k/m, c/m, g/L.</div>";
      html += "<div style='font-size:11px;color:#94a3b8;margin-bottom:6px;'>Meaning: m=mass, c=damping/drag, e=restitution, x0/v0=initial state, gm=ground model (0 rigid, 1 compliant), gk/gc=ground spring/damper.</div>";
      html += "<div style='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;align-items:stretch;'>";
      const schemaId = resolveSchemaId(state && state.modelSchemaId);
      const schema = getModelSchemaConfig(schemaId);
      (schema.params || []).forEach(function (f) {
        const key = String(f.key || "");
        const label = String(f.label || key);
        const on = Boolean(pm[key]);
        html += "<label style='display:flex;align-items:center;gap:6px;justify-content:flex-start;padding:6px 8px;border:1px solid #334155;border-radius:8px;'>" +
          "<input class='node-cfg-field' data-key='pm_" + key + "' type='checkbox'" + (on ? " checked" : "") + "> " + label + "</label>";
      });
      html += "</div>";
    } else if (node.name === "scenario_block") {
      const schemaId = resolveSchemaId(state && state.modelSchemaId);
      const defs = getSchemaOneHotDefs(schemaId);
      const oneHotKey = normalizeOneHotKey(d.oneHotKey || "scenario", schemaId);
      const opts = defs.map(function (f) {
        const key = String(f.key || "");
        const label = String(f.label || key);
        return "<option value='" + key + "'" + (oneHotKey === key ? " selected" : "") + ">" + label + "</option>";
      }).join("");
      html += row("OneHot field", "<select class='node-cfg-field' data-key='oneHotKey'>" + opts + "</select>");
      html += "<div style='font-size:11px;color:#94a3b8;margin-bottom:6px;'>Categorical feature from schema metadata, encoded as one-hot.</div>";
    } else if (node.name === "input_layer") {
      html += row("Mode", "<select class='node-cfg-field' data-key='mode'><option value='auto'" + (String(d.mode || "auto") === "auto" ? " selected" : "") + ">auto</option><option value='flat'" + (String(d.mode || "auto") === "flat" ? " selected" : "") + ">flat</option><option value='sequence'" + (String(d.mode || "auto") === "sequence" ? " selected" : "") + ">sequence</option></select>");
    } else if (node.name === "latent_layer") {
      html += row("Units (z dim)", "<input class='node-cfg-field' data-key='units' type='number' min='2' value='" + Math.max(2, Number(d.units || 16)) + "'>");
      html += row("Group", "<input class='node-cfg-field' data-key='group' type='text' value='" + String(d.group || "z_shared") + "'>");
      html += row("Match weight", "<input class='node-cfg-field' data-key='matchWeight' type='number' min='0' step='0.1' value='" + Math.max(0, Number(d.matchWeight || 1)).toFixed(2) + "'>");
      html += "<div style='font-size:11px;color:#94a3b8;'>Latent nodes with same type + same group create auxiliary z-match loss (pairwise to first node in group).</div>";
    } else if (node.name === "latent_mu_layer" || node.name === "latent_logvar_layer") {
      html += row("Units (z dim)", "<input class='node-cfg-field' data-key='units' type='number' min='2' value='" + Math.max(2, Number(d.units || 16)) + "'>");
      html += row("Group", "<input class='node-cfg-field' data-key='group' type='text' value='" + String(d.group || "z_shared") + "'>");
      html += row("Match weight", "<input class='node-cfg-field' data-key='matchWeight' type='number' min='0' step='0.1' value='" + Math.max(0, Number(d.matchWeight || 1)).toFixed(2) + "'>");
      html += "<div style='font-size:11px;color:#94a3b8;'>Use Latent μ + Latent logσ² -> Reparam z for VAE. Match loss groups by same type + same group.</div>";
    } else if (node.name === "reparam_layer") {
      html += row("Group", "<input class='node-cfg-field' data-key='group' type='text' value='" + String(d.group || "z_shared") + "'>");
      html += row("KL β", "<input class='node-cfg-field' data-key='beta' type='number' min='0' step='0.0001' value='" + Math.max(0, Number(d.beta || 1e-3)).toFixed(4) + "'>");
      html += row("KL match weight", "<input class='node-cfg-field' data-key='matchWeight' type='number' min='0' step='0.1' value='" + Math.max(0, Number(d.matchWeight || 1)).toFixed(2) + "'>");
      html += "<div style='font-size:11px;color:#94a3b8;'>Inputs: #1=μ, #2=logσ². Adds auxiliary KL loss automatically.</div>";
    } else if (node.name === "dense_layer") {
      html += row("Units", "<input class='node-cfg-field' data-key='units' type='number' min='1' value='" + Math.max(1, Number(d.units || 32)) + "'>");
      html += row("Activation", "<select class='node-cfg-field' data-key='activation'><option value='relu'" + (String(d.activation || "relu") === "relu" ? " selected" : "") + ">relu</option><option value='tanh'" + (String(d.activation || "relu") === "tanh" ? " selected" : "") + ">tanh</option><option value='sigmoid'" + (String(d.activation || "relu") === "sigmoid" ? " selected" : "") + ">sigmoid</option><option value='linear'" + (String(d.activation || "relu") === "linear" ? " selected" : "") + ">linear</option></select>");
    } else if (node.name === "conv1d_layer") {
      html += row("Filters", "<input class='node-cfg-field' data-key='filters' type='number' min='1' value='" + Math.max(1, Number(d.filters || 64)) + "'>");
      html += row("Kernel size", "<input class='node-cfg-field' data-key='kernelSize' type='number' min='1' value='" + Math.max(1, Number(d.kernelSize || 3)) + "'>");
      html += row("Stride", "<input class='node-cfg-field' data-key='strideConv' type='number' min='1' value='" + Math.max(1, Number(d.stride || 1)) + "'>");
      html += row("Activation", "<select class='node-cfg-field' data-key='activation'><option value='relu'" + (String(d.activation || "relu") === "relu" ? " selected" : "") + ">relu</option><option value='tanh'" + (String(d.activation || "relu") === "tanh" ? " selected" : "") + ">tanh</option><option value='sigmoid'" + (String(d.activation || "relu") === "sigmoid" ? " selected" : "") + ">sigmoid</option><option value='linear'" + (String(d.activation || "relu") === "linear" ? " selected" : "") + ">linear</option></select>");
      html += "<div style='font-size:11px;color:#94a3b8;'>Conv1D expects sequence input. For direct mode, keep graph flat.</div>";
    } else if (node.name === "dropout_layer") {
      html += row("Rate", "<input class='node-cfg-field' data-key='rate' type='number' min='0' max='0.9' step='0.05' value='" + clamp(Number(d.rate || 0.1), 0, 0.9).toFixed(2) + "'>");
    } else if (node.name === "batchnorm_layer") {
      html += row("Momentum", "<input class='node-cfg-field' data-key='momentum' type='number' min='0.1' max='0.999' step='0.001' value='" + clamp(Number(d.momentum || 0.99), 0.1, 0.999).toFixed(3) + "'>");
      html += row("Epsilon", "<input class='node-cfg-field' data-key='epsilon' type='number' min='0.000001' step='0.000001' value='" + Math.max(1e-6, Number(d.epsilon || 1e-3)).toFixed(6) + "'>");
      html += "<div style='font-size:11px;color:#94a3b8;'>BatchNorm after Dense/Conv1D can improve training stability.</div>";
    } else if (node.name === "layernorm_layer") {
      html += row("Epsilon", "<input class='node-cfg-field' data-key='epsilon' type='number' min='0.000001' step='0.000001' value='" + Math.max(1e-6, Number(d.epsilon || 1e-3)).toFixed(6) + "'>");
      html += "<div style='font-size:11px;color:#94a3b8;'>LayerNorm is sequence-safe and often robust for RNN/GRU/LSTM stacks.</div>";
    } else if (node.name === "rnn_layer" || node.name === "gru_layer" || node.name === "lstm_layer") {
      html += row("Units", "<input class='node-cfg-field' data-key='units' type='number' min='1' value='" + Math.max(1, Number(d.units || 64)) + "'>");
      html += row("Dropout", "<input class='node-cfg-field' data-key='dropout' type='number' min='0' max='0.8' step='0.05' value='" + clamp(Number(d.dropout || 0.1), 0, 0.8).toFixed(2) + "'>");
      html += row("Return seq", "<select class='node-cfg-field' data-key='returnseq'><option value='auto'" + (String(d.returnseq || "auto") === "auto" ? " selected" : "") + ">auto</option><option value='false'" + (String(d.returnseq || "auto") === "false" ? " selected" : "") + ">false</option><option value='true'" + (String(d.returnseq || "auto") === "true" ? " selected" : "") + ">true</option></select>");
    } else if (node.name === "concat_block") {
      const nIn = Object.keys(node.inputs || {}).length || Math.max(1, Number(d.numInputs || 5));
      html += row("Input ports", "<input class='node-cfg-field' data-key='numInputs' type='number' min='1' max='24' value='" + Math.max(1, Number(nIn)) + "'>");
      html += "<div style='font-size:11px;color:#94a3b8;'>Default is 5 for manual nodes. Presets may use larger values.</div>";
    } else {
      html = "<div style='font-size:12px;color:#94a3b8;'>No configurable fields for this node.</div>";
    }
    ui.nodeConfigBody.innerHTML = html;
  }

  function setActiveNode(editor, nodeId) {
    state.activeNodeId = String(nodeId || "");
    renderNodeConfigPanel(editor, state.activeNodeId);
  }

  function getUpstreamFeatureNodeNames(editor) {
    const names = {};
    if (!editor || typeof editor.export !== "function") return names;
    const data = editor.export().drawflow.Home.data;
    const inputNode = getNodeByName(data, "input_layer");
    if (!inputNode) return names;
    const startIds = [];
    Object.keys(inputNode.inputs || {}).forEach(function (k) {
      const conns = (inputNode.inputs[k] && inputNode.inputs[k].connections) || [];
      conns.forEach(function (c) { startIds.push(String(c.node)); });
    });
    if (!startIds.length) return names;
    const seen = {};
    const walk = function (id) {
      if (seen[id]) return;
      seen[id] = true;
      const node = data[id];
      if (!node) return;
      names[node.name] = true;
      Object.keys(node.inputs || {}).forEach(function (k) {
        const conns = (node.inputs[k] && node.inputs[k].connections) || [];
        conns.forEach(function (c) { walk(String(c.node)); });
      });
    };
    startIds.forEach(walk);
    return names;
  }

  function getUpstreamFeatureNodes(editor) {
    const nodesByName = {};
    if (!editor || typeof editor.export !== "function") return nodesByName;
    const data = editor.export().drawflow.Home.data;
    const inputNode = getNodeByName(data, "input_layer");
    if (!inputNode) return nodesByName;
    const startIds = [];
    Object.keys(inputNode.inputs || {}).forEach(function (k) {
      const conns = (inputNode.inputs[k] && inputNode.inputs[k].connections) || [];
      conns.forEach(function (c) { startIds.push(String(c.node)); });
    });
    const seen = {};
    const all = [];
    const walk = function (id) {
      if (seen[id]) return;
      seen[id] = true;
      const node = data[id];
      if (!node) return;
      if (!nodesByName[node.name]) nodesByName[node.name] = node;
      all.push(node);
      Object.keys(node.inputs || {}).forEach(function (k) {
        const conns = (node.inputs[k] && node.inputs[k].connections) || [];
        conns.forEach(function (c) { walk(String(c.node)); });
      });
    };
    startIds.forEach(walk);
    nodesByName.__all = all;
    return nodesByName;
  }

  function getHistoryFieldFromNode(node) {
    if (!node) return "";
    const name = String(node.name || "");
    const d = node.data || {};
    if (name === "hist_x_block" || name === "x_block" || name === "window_hist_x_block") return "x";
    if (name === "hist_v_block" || name === "v_block" || name === "window_hist_v_block") return "v";
    if (name === "hist_block" || name === "window_hist_block") return normalizeHistorySeriesKey(d.featureKey || "x", state && state.modelSchemaId);
    return "";
  }

  function nodeUsesHistoryField(node, fieldKey) {
    return getHistoryFieldFromNode(node) === String(fieldKey || "");
  }

  function inferGraphModeFromDrawflow(editor, fallbackMode) {
    if (!editor || typeof editor.export !== "function") return String(fallbackMode || "direct");
    const names = getUpstreamFeatureNodeNames(editor);
    const hasHistory = Boolean(
      names.hist_block ||
      names.hist_x_block || names.hist_v_block ||
      names.x_block || names.v_block ||
      names.window_hist_block ||
      names.window_hist_x_block || names.window_hist_v_block ||
      names.sliding_window_block
    );
    return hasHistory ? "autoregressive" : String(fallbackMode || "direct");
  }

  function inferModelFamilyFromDrawflow(editor) {
    if (!editor || typeof editor.export !== "function") return "supervised";
    const data = editor.export().drawflow.Home.data || {};
    const ids = Object.keys(data || {});
    const names = ids.map(function (id) { return String((data[id] && data[id].name) || ""); });
    const hasNoiseSchedule = names.indexOf("noise_schedule_block") >= 0;
    const hasReparam = names.indexOf("reparam_layer") >= 0;
    const hasLatent = names.indexOf("latent_layer") >= 0 || names.indexOf("latent_mu_layer") >= 0 || names.indexOf("latent_logvar_layer") >= 0;
    if (hasNoiseSchedule) return "diffusion";
    if (hasReparam || hasLatent) return "vae";
    return "supervised";
  }

  function inferWindowFromDrawflow(editor, fallbackWindow) {
    const wFallback = Math.max(5, Number(fallbackWindow) || 20);
    if (!editor || typeof editor.export !== "function") return wFallback;
    const nodes = getUpstreamFeatureNodes(editor);
    const n = nodes.window_hist_block || nodes.window_hist_x_block || nodes.window_hist_v_block || nodes.sliding_window_block;
    if (n) return Math.max(5, Number((n.data && n.data.windowSize) || wFallback));
    if (nodes.hist_block || nodes.hist_x_block || nodes.hist_v_block || nodes.x_block || nodes.v_block) return 1;
    return wFallback;
  }

  function inferArHistoryConfigFromDrawflow(editor, fallbackWindow) {
    const fallback = {
      windowSize: Math.max(5, Number(fallbackWindow) || 20),
      stride: 1,
      lagMode: "contiguous",
      lags: null,
      padMode: "none",
    };
    if (!editor || typeof editor.export !== "function") return fallback;
    const nodes = getUpstreamFeatureNodes(editor);
    const n = nodes.window_hist_block || nodes.window_hist_x_block || nodes.window_hist_v_block || nodes.sliding_window_block;
    if (n) {
      const d = n.data || {};
      const windowSize = Math.max(5, Number(d.windowSize || fallback.windowSize));
      const stride = Math.max(1, Number(d.stride || 1));
      const lagMode = String(d.lagMode || "contiguous");
      const padMode = (String(d.padMode || "none") === "zero" || String(d.padMode || "none") === "edge")
        ? String(d.padMode || "none")
        : "none";
      if (lagMode !== "exact") {
        return { windowSize: windowSize, stride: stride, lagMode: "contiguous", lags: null, padMode: padMode };
      }
      const lags = String(d.lagCsv || "")
        .split(",")
        .map(function (s) { return Number(s.trim()); })
        .filter(function (v) { return Number.isFinite(v) && v >= 1; })
        .map(function (v) { return Math.floor(v); });
      const uniq = Array.from(new Set(lags)).sort(function (a, b) { return a - b; });
      if (!uniq.length) return { windowSize: windowSize, stride: stride, lagMode: "contiguous", lags: null, padMode: padMode };
      return { windowSize: uniq.length, stride: stride, lagMode: "exact", lags: uniq, padMode: padMode };
    }
    if (nodes.hist_block || nodes.hist_x_block || nodes.hist_v_block || nodes.x_block || nodes.v_block) {
      return { windowSize: 1, stride: 1, lagMode: "contiguous", lags: null, padMode: "none" };
    }
    return fallback;
  }

  function inferTargetModeFromDrawflow(editor, fallbackTarget) {
    const fallback = String(fallbackTarget || "x");
    if (!editor || typeof editor.export !== "function") return fallback;
    const data = editor.export().drawflow.Home.data;
    const out = getNodeByName(data, "output_layer");
    if (!out || !out.data) return fallback;
    const targets = outputTargetsFromNodeData(out.data, state && state.modelSchemaId, fallback);
    if (targets.indexOf("xv") >= 0) return "xv";
    if (targets.indexOf("v") >= 0 && targets.indexOf("x") < 0 && targets.indexOf("traj") < 0) return "v";
    return "x";
  }

  function inferOutputHeadsFromDrawflow(editor, fallbackTarget) {
    const fallback = String(fallbackTarget || "x");
    if (!editor || typeof editor.export !== "function") {
      return [{ id: "fallback", target: fallback, loss: "mse", wx: 1, wv: 1 }];
    }
    const data = editor.export().drawflow.Home.data;
    const ids = Object.keys(data || {});
    const inputIds = ids.filter(function (id) { return data[id] && data[id].name === "input_layer"; });
    if (!inputIds.length) {
      return [{ id: "fallback", target: fallback, loss: "mse", wx: 1, wv: 1 }];
    }
    const reachable = {};
    const q = [String(inputIds[0])];
    reachable[String(inputIds[0])] = true;
    while (q.length) {
      const id = q.shift();
      const n = data[id];
      if (!n || !n.outputs) continue;
      Object.keys(n.outputs).forEach(function (ok) {
        const conns = (n.outputs[ok] && n.outputs[ok].connections) || [];
        conns.forEach(function (c) {
          const to = String(c.node);
          if (!reachable[to]) {
            reachable[to] = true;
            q.push(to);
          }
        });
      });
    }
    const nodes = Object.keys(data || {}).map(function (id) { return { id: String(id), node: data[id] }; })
      .filter(function (x) { return reachable[x.id] && x.node && x.node.name === "output_layer"; })
      .sort(function (a, b) { return Number(a.id) - Number(b.id); });
    if (!nodes.length) {
      return [{ id: "fallback", target: fallback, loss: "mse", wx: 1, wv: 1 }];
    }
    const heads = [];
    nodes.forEach(function (x) {
      const d = x.node.data || {};
      const targets = outputTargetsFromNodeData(d, state && state.modelSchemaId, fallback);
      const normalizedLoss = (function () {
        const v = String(d.loss || "mse");
        if (v === "use_global") return "mse";
        return (v === "mse" || v === "mae" || v === "huber") ? v : "mse";
      })();
      targets.forEach(function (target, ti) {
        heads.push({
          id: x.id + ":" + String(target) + ":" + String(ti + 1),
          nodeId: x.id,
          target: target,
          targetType: target,
          paramsSelect: String(d.paramsSelect || ""),
          loss: normalizedLoss,
          wx: Math.max(0, Number(d.wx || 1)),
          wv: Math.max(0, Number(d.wv || 1)),
        });
      });
    });
    return heads.length ? heads : [{ id: "fallback", target: fallback, loss: "mse", wx: 1, wv: 1 }];
  }

  function inferDatasetTargetModeFromOutputHeads(heads, fallback) {
    const list = Array.isArray(heads) ? heads : [];
    const hasX = list.some(function (h) {
      const t = String(h.target || "");
      return t === "x" || t === "xv" || t === "traj";
    });
    const hasV = list.some(function (h) { return String(h.target) === "v" || String(h.target) === "xv"; });
    if (hasX && hasV) return "xv";
    if (hasV) return "v";
    if (hasX) return "x";
    return String(fallback || "x");
  }

  function pickPrimaryTrajectoryHeadIndex(heads) {
    const list = Array.isArray(heads) ? heads : [];
    for (let i = 0; i < list.length; i += 1) {
      const t = String(list[i].target || "");
      if (t === "x" || t === "v" || t === "xv" || t === "traj") return i;
    }
    return -1;
  }

  function inferOutputLossConfigFromDrawflow(editor, globalLossType) {
    const fallbackGlobal = String(globalLossType || DEFAULT_LOSS_TYPE);
    const out = {
      loss: "mse",
      resolvedLossType: fallbackGlobal,
      wx: 1,
      wv: 1,
    };
    if (!editor || typeof editor.export !== "function") return out;
    const data = editor.export().drawflow.Home.data;
    const outputNode = getNodeByName(data, "output_layer");
    if (!outputNode || !outputNode.data) return out;
    const d = outputNode.data || {};
    const loss = String(d.loss || "mse");
    out.loss = (loss === "use_global")
      ? "mse"
      : ((loss === "mse" || loss === "mae" || loss === "huber") ? loss : "mse");
    out.wx = Math.max(0, Number(d.wx || 1));
    out.wv = Math.max(0, Number(d.wv || 1));
    if (out.loss === "mse") out.resolvedLossType = "meanSquaredError";
    else if (out.loss === "mae") out.resolvedLossType = "meanAbsoluteError";
    else if (out.loss === "huber") out.resolvedLossType = "huberLoss";
    else out.resolvedLossType = fallbackGlobal;
    return out;
  }

  function inferFeatureSpecFromDrawflow(editor, mode, fallback) {
    const defaults = Object.assign({}, fallback || {});
    if (!editor || typeof editor.export !== "function") return defaults;
    const schemaId = resolveSchemaId((defaults && defaults.schemaId) || (state && state.modelSchemaId) || "oscillator");
    const featurePolicy = getSchemaFeatureNodePolicy(schemaId);
    const names = getUpstreamFeatureNodeNames(editor);
    const nodes = getUpstreamFeatureNodes(editor);
    const allNodes = Array.isArray(nodes.__all) ? nodes.__all : [];
    const genericUseX = allNodes.some(function (n) {
      const nm = String((n && n.name) || "");
      if (nm !== "hist_block" && nm !== "window_hist_block") return false;
      return nodeUsesHistoryField(n, "x");
    });
    const genericUseV = allNodes.some(function (n) {
      const nm = String((n && n.name) || "");
      if (nm !== "hist_block" && nm !== "window_hist_block") return false;
      return nodeUsesHistoryField(n, "v");
    });
    const paramsNode = nodes.params_block;
    const paramMask = normalizeParamMask(paramsNode && paramsNode.data && paramsNode.data.paramMask);
    const spec = Object.assign({}, defaults, {
      useX: featurePolicy.allowHistory
        ? Boolean(genericUseX || names.hist_x_block || names.x_block || names.window_hist_x_block)
        : false,
      useV: featurePolicy.allowHistory
        ? Boolean(genericUseV || names.hist_v_block || names.v_block || names.window_hist_v_block)
        : false,
      useParams: featurePolicy.allowParams ? Boolean(names.params_block) : false,
      useTimeSec: Boolean(names.time_sec_block),
      useTimeNorm: Boolean(names.time_norm_block || names.time_block),
      useScenario: featurePolicy.allowOneHot ? Boolean(names.scenario_block) : false,
      useSinNorm: Boolean(names.sin_norm_block || names.trig_block),
      useCosNorm: Boolean(names.cos_norm_block || names.trig_block),
      useNoiseSchedule: Boolean(names.noise_schedule_block),
      useImageSource: featurePolicy.allowImageSource ? Boolean(names.image_source_block) : false,
      paramMask: paramMask,
    });
    if (mode === "direct") {
      if (featurePolicy.allowImageSource) {
        if (!spec.useImageSource) spec.useImageSource = true;
        spec.useParams = false;
        spec.useTimeSec = false;
        spec.useTimeNorm = false;
        spec.useSinNorm = false;
        spec.useCosNorm = false;
        spec.useNoiseSchedule = false;
      }
      if (!spec.useImageSource && !spec.useParams && !spec.useTimeSec && !spec.useTimeNorm && !spec.useScenario && !spec.useSinNorm && !spec.useCosNorm && !spec.useNoiseSchedule) {
        spec.useParams = true;
        spec.useTimeNorm = true;
      }
    } else {
      if (!spec.useX && !spec.useV && !spec.useParams) {
        spec.useX = true;
        spec.useParams = true;
      }
    }
    return spec;
  }

  function buildModelFromDrawflow(editor, datasetMeta) {
    const moduleData = editor.export().drawflow.Home.data;
    const ids = Object.keys(moduleData || {});
    if (!ids.length) throw new Error("Drawflow graph is empty.");

    const inputIds = ids.filter(function (id) { return moduleData[id] && moduleData[id].name === "input_layer"; });
    if (inputIds.length !== 1) throw new Error("Graph must contain exactly one Input node.");
    const inputId = String(inputIds[0]);

    const parsePortIndex = function (name) {
      const m = String(name || "").match(/_(\d+)$/);
      return m ? Number(m[1]) : 9999;
    };

    const getOutgoing = function (id) {
      const n = moduleData[id];
      if (!n || !n.outputs) return [];
      const out = [];
      Object.keys(n.outputs).forEach(function (ok) {
        const conns = (n.outputs[ok] && n.outputs[ok].connections) || [];
        conns.forEach(function (c) {
          out.push({ from: String(id), to: String(c.node), fromPort: String(ok), toPort: String(c.input || "") });
        });
      });
      return out;
    };
    const getIncoming = function (id) {
      const n = moduleData[id];
      if (!n || !n.inputs) return [];
      const ins = [];
      Object.keys(n.inputs).forEach(function (ik) {
        const conns = (n.inputs[ik] && n.inputs[ik].connections) || [];
        conns.forEach(function (c) {
          ins.push({ from: String(c.node), to: String(id), fromPort: String(c.output || ""), toPort: String(ik) });
        });
      });
      ins.sort(function (a, b) { return parsePortIndex(a.toPort) - parsePortIndex(b.toPort); });
      return ins;
    };

    const reachable = {};
    const q = [inputId];
    reachable[inputId] = true;
    while (q.length) {
      const id = q.shift();
      getOutgoing(id).forEach(function (e) {
        if (!reachable[e.to]) {
          reachable[e.to] = true;
          q.push(e.to);
        }
      });
    }
    const reachableIds = Object.keys(reachable);
    const outputIds = reachableIds.filter(function (id) { return moduleData[id] && moduleData[id].name === "output_layer"; });
    if (!outputIds.length) throw new Error("Graph must have at least one Output node connected from Input.");

    const hasRecurrent = reachableIds.some(function (id) {
      const name = moduleData[id] && moduleData[id].name;
      return name === "rnn_layer" || name === "gru_layer" || name === "lstm_layer" || name === "conv1d_layer";
    });
    const inputNode = moduleData[inputId];
    const inputMode = String((inputNode.data && inputNode.data.mode) || "auto");
    const isSequence = inputMode === "sequence" ? true : (inputMode === "flat" ? false : hasRecurrent);
    if (datasetMeta.mode === "direct" && isSequence) {
      throw new Error("Direct mode requires flat graph input (Input mode: flat/auto with no recurrent layers).");
    }

    const indegree = {};
    reachableIds.forEach(function (id) { indegree[id] = 0; });
    reachableIds.forEach(function (id) {
      getOutgoing(id).forEach(function (e) {
        if (reachable[e.to]) indegree[e.to] += 1;
      });
    });
    const topo = [];
    const tq = reachableIds.filter(function (id) { return indegree[id] === 0; }).sort(function (a, b) { return Number(a) - Number(b); });
    while (tq.length) {
      const id = tq.shift();
      topo.push(id);
      getOutgoing(id).forEach(function (e) {
        if (!reachable[e.to]) return;
        indegree[e.to] -= 1;
        if (indegree[e.to] === 0) tq.push(e.to);
      });
      tq.sort(function (a, b) { return Number(a) - Number(b); });
    }
    if (topo.length !== reachableIds.length) throw new Error("Graph contains cycle(s). Please use acyclic connections.");

    const inputTensor = isSequence
      ? tf.input({ shape: [datasetMeta.windowSize, datasetMeta.seqFeatureSize] })
      : tf.input({ shape: [datasetMeta.featureSize] });

    const tensorById = {};
    tensorById[inputId] = inputTensor;
    const outTensors = [];
    const headConfigs = [];
    const latentGroups = {};
    const vaeKLGroups = {};

    class ReparameterizeLayer extends tf.layers.Layer {
      constructor(config) {
        super(config || {});
      }
      computeOutputShape(inputShape) {
        return Array.isArray(inputShape) ? inputShape[0] : inputShape;
      }
        call(inputs) {
          return tf.tidy(function () {
            const arr = Array.isArray(inputs) ? inputs : [inputs];
            const mu = arr[0];
            const logvar = tf.clipByValue(arr[1], -10, 10);
            const eps = tf.randomNormal(tf.shape(mu), 0, 1, mu.dtype);
            const std = tf.exp(tf.mul(tf.scalar(0.5), logvar));
            return tf.add(mu, tf.mul(std, eps));
          });
        }
    }

    const targetUnitsFromMode = function (target, paramsSelectRaw) {
      if (target === "xv") return 2;
      if (target === "params") {
        const names = Array.isArray(datasetMeta.paramNames) ? datasetMeta.paramNames.map(String) : [];
        const picks = String(paramsSelectRaw || "")
          .split(",")
          .map(function (s) { return String(s || "").trim(); })
          .filter(Boolean);
        if (picks.length && names.length) {
          const count = picks.filter(function (k) { return names.indexOf(k) >= 0; }).length;
          return Math.max(1, count);
        }
        return Math.max(1, Number(datasetMeta.paramSize || 1));
      }
      return 1;
    };

    const requiredNonNegativeNumber = function (data, key, nodeName, nodeId) {
      if (!data || !Object.prototype.hasOwnProperty.call(data, key)) {
        throw new Error("Node '" + String(nodeId) + "' (" + String(nodeName) + ") missing required data." + String(key));
      }
      const v = Number(data[key]);
      if (!Number.isFinite(v) || v < 0) {
        throw new Error("Node '" + String(nodeId) + "' (" + String(nodeName) + ") invalid data." + String(key) + " (must be finite >= 0)");
      }
      return v;
    };

    const requiredNonEmptyString = function (data, key, nodeName, nodeId) {
      if (!data || !Object.prototype.hasOwnProperty.call(data, key)) {
        throw new Error("Node '" + String(nodeId) + "' (" + String(nodeName) + ") missing required data." + String(key));
      }
      const v = String(data[key] == null ? "" : data[key]).trim();
      if (!v) {
        throw new Error("Node '" + String(nodeId) + "' (" + String(nodeName) + ") invalid data." + String(key) + " (must be non-empty)");
      }
      return v;
    };

    const applyNodeOp = function (node, inTensor, laterHasRecurrent) {
      if (node.name === "dense_layer") {
        const units = Math.max(1, Number(node.data.units || 32));
        const activation = String(node.data.activation || "relu");
        return tf.layers.dense({ units: units, activation: activation }).apply(inTensor);
      }
      if (node.name === "conv1d_layer") {
        if (datasetMeta.mode === "direct") throw new Error("Conv1D not supported in direct mode.");
        if (!isSequence) throw new Error("Conv1D requires sequence input mode.");
        const filters = Math.max(1, Number((node.data && node.data.filters) || 64));
        const kernelSize = Math.max(1, Number((node.data && node.data.kernelSize) || 3));
        const strides = Math.max(1, Number((node.data && node.data.stride) || 1));
        const activation = String((node.data && node.data.activation) || "relu");
        return tf.layers.conv1d({
          filters: filters,
          kernelSize: kernelSize,
          strides: strides,
          padding: "same",
          activation: activation,
        }).apply(inTensor);
      }
      if (node.name === "latent_layer" || node.name === "latent_mu_layer" || node.name === "latent_logvar_layer") {
        const units = Math.max(2, Number((node.data && node.data.units) || 16));
        return tf.layers.dense({ units: units, activation: "linear" }).apply(inTensor);
      }
      if (node.name === "reparam_layer") {
        throw new Error("Reparam node is handled as a special two-input op.");
      }
      if (node.name === "dropout_layer") {
        const rate = Math.min(0.9, Math.max(0, Number(node.data.rate || 0.1)));
        return tf.layers.dropout({ rate: rate }).apply(inTensor);
      }
      if (node.name === "batchnorm_layer") {
        const momentum = clamp(Number((node.data && node.data.momentum) || 0.99), 0.1, 0.999);
        const epsilon = Math.max(1e-6, Number((node.data && node.data.epsilon) || 1e-3));
        return tf.layers.batchNormalization({ momentum: momentum, epsilon: epsilon }).apply(inTensor);
      }
      if (node.name === "layernorm_layer") {
        const epsilon = Math.max(1e-6, Number((node.data && node.data.epsilon) || 1e-3));
        return tf.layers.layerNormalization({ axis: -1, epsilon: epsilon }).apply(inTensor);
      }
      if (node.name === "rnn_layer" || node.name === "gru_layer" || node.name === "lstm_layer") {
        if (datasetMeta.mode === "direct") throw new Error("RNN/GRU/LSTM not supported in direct mode.");
        if (!isSequence) throw new Error("RNN/GRU/LSTM layers require sequence input mode.");
        const units = Math.max(1, Number(node.data.units || 64));
        const dropout = clamp(Number(node.data.dropout || 0), 0, 0.8);
        const rsSetting = String(node.data.returnseq || "auto");
        const returnSeq = rsSetting === "true" ? true : (rsSetting === "false" ? false : laterHasRecurrent);
        if (node.name === "rnn_layer") {
          return tf.layers.simpleRNN({
            units: units,
            returnSequences: returnSeq,
            dropout: dropout,
            recurrentInitializer: "glorotUniform",
          }).apply(inTensor);
        }
        if (node.name === "gru_layer") {
          return tf.layers.gru({
            units: units,
            returnSequences: returnSeq,
            dropout: dropout,
            recurrentInitializer: "glorotUniform",
          }).apply(inTensor);
        }
        return tf.layers.lstm({
          units: units,
          returnSequences: returnSeq,
          dropout: dropout,
          recurrentInitializer: "glorotUniform",
        }).apply(inTensor);
      }
      if (node.name === "concat_block") {
        return inTensor;
      }
      throw new Error("Unsupported node type in model path: " + node.name);
    };

    for (let ti = 0; ti < topo.length; ti += 1) {
      const id = topo[ti];
      if (id === inputId) continue;
      const node = moduleData[id];
      if (!node) continue;
      const ins = getIncoming(id).filter(function (e) { return reachable[e.from]; });
      if (!ins.length) continue;
      const incomingTensors = ins.map(function (e) { return tensorById[e.from]; }).filter(Boolean);
      if (!incomingTensors.length) continue;
      let inTensor = incomingTensors[0];
      if (incomingTensors.length > 1) {
        if (node.name !== "concat_block" && node.name !== "reparam_layer") {
          throw new Error("Node '" + node.name + "' has multiple inputs but is not Concat.");
        }
        if (node.name === "concat_block") {
          inTensor = tf.layers.concatenate({ axis: -1 }).apply(incomingTensors);
        }
      }

      if (node.name === "output_layer") {
        const data = node.data || {};
        const headMatchWeight = requiredNonNegativeNumber(data, "matchWeight", "output_layer", id);
        const targets = outputTargetsFromNodeData(data, state && state.modelSchemaId, "x");
        const lossName = String((data && data.loss) || "mse");
        const paramsSelect = String((data && data.paramsSelect) || "");
        const inForHead = (inTensor.shape && inTensor.shape.length === 3)
          ? tf.layers.globalAveragePooling1d().apply(inTensor)
          : inTensor;
        const generated = [];
        targets.forEach(function (target, ti) {
          const units = targetUnitsFromMode(target, paramsSelect);
          const headTensor = tf.layers.dense({ units: units, activation: "linear" }).apply(inForHead);
          outTensors.push(headTensor);
          generated.push(headTensor);
          headConfigs.push({
            id: String(id) + ":" + String(target) + ":" + String(ti + 1),
            nodeId: String(id),
            target: target,
            targetType: target,
            paramsSelect: paramsSelect,
            units: units,
            loss: lossName,
            wx: Math.max(0, Number((data && data.wx) || 1)),
            wv: Math.max(0, Number((data && data.wv) || 1)),
            matchWeight: headMatchWeight,
          });
        });
        tensorById[id] = generated[0];
      } else {
        const laterHasRecurrent = topo.slice(ti + 1).some(function (nid) {
          const nm = moduleData[nid] && moduleData[nid].name;
          return nm === "rnn_layer" || nm === "gru_layer" || nm === "lstm_layer" || nm === "conv1d_layer";
        });
        let out;
        if (node.name === "reparam_layer") {
          if (incomingTensors.length !== 2) {
            throw new Error("Reparam node requires exactly 2 inputs: μ then logσ².");
          }
          const muTensor = incomingTensors[0];
          const logvarTensor = incomingTensors[1];
          out = new ReparameterizeLayer({}).apply([muTensor, logvarTensor]);
          const data = node.data || {};
          const g = requiredNonEmptyString(data, "group", "reparam_layer", id);
          const beta = requiredNonNegativeNumber(data, "beta", "reparam_layer", id);
          const matchWeight = requiredNonNegativeNumber(data, "matchWeight", "reparam_layer", id);
          if (!vaeKLGroups[g]) vaeKLGroups[g] = [];
          vaeKLGroups[g].push({
            id: String(id),
            mu: muTensor,
            logvar: logvarTensor,
            beta: beta,
            matchWeight: matchWeight,
            units: Math.max(2, Number(out.shape && out.shape[out.shape.length - 1] || 2)),
          });
        } else {
          out = applyNodeOp(node, inTensor, laterHasRecurrent);
        }
        tensorById[id] = out;
        if (node.name === "latent_layer" || node.name === "latent_mu_layer" || node.name === "latent_logvar_layer") {
          const data = node.data || {};
          const latentType = String(node.name || "latent_layer");
          const g = requiredNonEmptyString(data, "group", latentType, id);
          const gk = g + "::" + latentType;
          const mw = requiredNonNegativeNumber(data, "matchWeight", latentType, id);
          if (!latentGroups[gk]) latentGroups[gk] = [];
          latentGroups[gk].push({
            id: String(id),
            group: g,
            latentType: latentType,
            tensor: out,
            units: Math.max(2, Number((data && data.units) || 16)),
            matchWeight: mw,
          });
        }
      }
    }

    Object.keys(latentGroups).forEach(function (gk) {
      const items = latentGroups[gk] || [];
      if (items.length < 2) return;
      const ref = items[0];
      for (let i = 1; i < items.length; i += 1) {
        const it = items[i];
        if (Number(ref.units) !== Number(it.units)) {
          throw new Error("Latent group '" + ref.group + "' (" + ref.latentType + ") units mismatch (" + ref.units + " vs " + it.units + ").");
        }
        const diff = tf.layers.subtract().apply([ref.tensor, it.tensor]);
        outTensors.push(diff);
        headConfigs.push({
          id: "latent_diff:" + ref.group + ":" + ref.latentType + ":" + String(i),
          target: "latent_diff",
          units: Number(ref.units),
          loss: "mse",
          wx: 1,
          wv: 1,
          matchWeight: Math.max(0, Number((ref.matchWeight + it.matchWeight) / 2 || 1)),
        });
      }
    });

    Object.keys(vaeKLGroups).forEach(function (g) {
      const items = vaeKLGroups[g] || [];
      items.forEach(function (it, i) {
        const klTensor = tf.layers.concatenate({ axis: -1 }).apply([it.mu, it.logvar]);
        outTensors.push(klTensor);
        headConfigs.push({
          id: "latent_kl:" + g + ":" + String(i + 1),
          target: "latent_kl",
          units: Math.max(2, Number(it.units || 2)) * 2,
          loss: "mse",
          wx: 1,
          wv: 1,
          matchWeight: Math.max(0, Number(it.matchWeight || 1)),
          beta: Math.max(0, Number(it.beta || 1e-3)),
        });
      });
    });

    if (!outTensors.length) throw new Error("No valid Output heads were built from graph.");
    const outputs = outTensors.length === 1 ? outTensors[0] : outTensors;
    return { model: tf.model({ inputs: inputTensor, outputs: outputs }), isSequence: isSequence, headConfigs: headConfigs };
  }

  async function trainModel(opts) {
    const isRnn = Boolean(opts.isSequence);
    const ySize = Math.max(1, Number((opts.dataset && opts.dataset.targetSize) || 1));
    const headConfigs = Array.isArray(opts.headConfigs) && opts.headConfigs.length
      ? opts.headConfigs
      : [{
        id: "single",
        target: String((opts.dataset && opts.dataset.targetMode) || "x"),
        loss: String((opts.outputLossConfig && opts.outputLossConfig.loss) || "mse"),
        wx: Number((opts.outputLossConfig && opts.outputLossConfig.wx) || 1),
        wv: Number((opts.outputLossConfig && opts.outputLossConfig.wv) || 1),
      }];
    if (!opts.dataset.yTrain.length || !opts.dataset.yVal.length || !opts.dataset.yTest.length) {
      throw new Error("Dataset split too small. Increase trajectories or duration.");
    }
    if (typeof opts.onStatus === "function") opts.onStatus("Preparing tensors...");
    const xTrain = isRnn
      ? tf.tensor3d(opts.dataset.seqTrain)
      : tf.tensor2d(opts.dataset.xTrain);
    const yTrain = tf.tensor2d(opts.dataset.yTrain, [opts.dataset.yTrain.length, ySize]);
    const xVal = isRnn
      ? tf.tensor3d(opts.dataset.seqVal)
      : tf.tensor2d(opts.dataset.xVal);
    const yVal = tf.tensor2d(opts.dataset.yVal, [opts.dataset.yVal.length, ySize]);
    const xTest = isRnn
      ? tf.tensor3d(opts.dataset.seqTest)
      : tf.tensor2d(opts.dataset.xTest);

    const resolvedLossType = String(
      (opts.outputLossConfig && opts.outputLossConfig.resolvedLossType) ||
      opts.lossType ||
      DEFAULT_LOSS_TYPE
    );
    const mapLossAlias = function (lossName) {
      const v = String(lossName || "mse");
      if (v === "mse") return "meanSquaredError";
      if (v === "mae") return "meanAbsoluteError";
      if (v === "huber") return "huberLoss";
      if (v === "use_global") return "meanSquaredError";
      return resolvedLossType;
    };

    const scalarLossByType = function (pred, truth, type) {
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
    };

    const makeHeadLoss = function (head) {
      const target = String((head && head.target) || "x");
      const type = mapLossAlias(head && head.loss);
      const wx = Math.max(0, Number((head && head.wx) || 1));
      const wv = Math.max(0, Number((head && head.wv) || 1));
      const headWeight = Math.max(0, Number((head && head.matchWeight) || 1));
      const klBeta = Math.max(0, Number((head && head.beta) || 1e-3));
      return function (yTrue, yPred) {
        return tf.tidy(function () {
          if (target === "latent_kl") {
            const total = Math.max(2, Number((head && head.units) || (yPred.shape && yPred.shape[1]) || 2));
            const zDim = Math.max(1, Math.floor(total / 2));
            const mu = yPred.slice([0, 0], [-1, zDim]);
            const logvar = tf.clipByValue(yPred.slice([0, zDim], [-1, zDim]), -10, 10);
            const one = tf.onesLike(logvar);
            const klTerm = tf.sub(tf.add(one, logvar), tf.add(tf.square(mu), tf.exp(logvar)));
            const kl = tf.mul(tf.scalar(-0.5), tf.mean(tf.sum(klTerm, -1)));
            return tf.mul(tf.scalar(headWeight * klBeta), kl);
          }
          if (target !== "xv") {
            const l = scalarLossByType(yPred, yTrue, type);
            return tf.mul(tf.scalar(headWeight), l);
          }
          const wsum = Math.max(1e-9, wx + wv);
          const nx = wx / wsum;
          const nv = wv / wsum;
          const tx = yTrue.slice([0, 0], [-1, 1]);
          const tv = yTrue.slice([0, 1], [-1, 1]);
          const px = yPred.slice([0, 0], [-1, 1]);
          const pv = yPred.slice([0, 1], [-1, 1]);
          const lx = scalarLossByType(px, tx, type);
          const lv = scalarLossByType(pv, tv, type);
          const l = tf.add(tf.mul(tf.scalar(nx), lx), tf.mul(tf.scalar(nv), lv));
          return tf.mul(tf.scalar(headWeight), l);
        });
      };
    };

    const rowsToTensor = function (rows, cols) {
      return tf.tensor2d(rows, [rows.length, Math.max(1, cols)]);
    };

    const extractHeadRows = function (rowsMain, rowsParams, targetMode, head) {
      const headTarget = String((head && head.targetType) || (head && head.target) || "x");
      if (headTarget === "params") {
        if (Math.max(0, Number(opts.dataset.paramSize || 0)) < 1) {
          throw new Error("Params output head requires at least one enabled Params feature in dataset/schema.");
        }
        if (!Array.isArray(rowsParams) || !rowsParams.length) throw new Error("Params target requested but parameter targets are missing.");
        const rawSelect = String((head && head.paramsSelect) || "");
        const picks = rawSelect
          .split(",")
          .map(function (s) { return String(s || "").trim(); })
          .filter(function (s) { return !!s; });
        const names = Array.isArray(opts.dataset.paramNames) ? opts.dataset.paramNames.map(String) : [];
        if (picks.length && names.length) {
          const idx = picks
            .map(function (k) { return names.indexOf(k); })
            .filter(function (i) { return i >= 0; });
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
    };

    const targetMode = String((opts.dataset && opts.dataset.targetMode) || "x");
    const yTrainTensors = [];
    const yValTensors = [];
    const yTestTensors = [];
    const losses = [];
    const metrics = [];
    headConfigs.forEach(function (head) {
      const target = String(head.target || "x");
      const trainRows = extractHeadRows(opts.dataset.yTrain, opts.dataset.pTrain, targetMode, head);
      const valRows = extractHeadRows(opts.dataset.yVal, opts.dataset.pVal, targetMode, head);
      const testRows = extractHeadRows(opts.dataset.yTest, opts.dataset.pTest, targetMode, head);
      const cols = target === "xv"
        ? 2
        : (target === "params"
          ? Math.max(1, Number(opts.dataset.paramSize || (trainRows[0] && trainRows[0].length) || 1))
          : (target === "traj"
            ? 1
          : (target === "latent_diff"
            ? Math.max(1, Number(head.units || 1))
            : (target === "latent_kl"
              ? Math.max(2, Number(head.units || 2))
              : 1))));
      yTrainTensors.push(rowsToTensor(trainRows, cols));
      yValTensors.push(rowsToTensor(valRows, cols));
      yTestTensors.push(rowsToTensor(testRows, cols));
      losses.push(makeHeadLoss(head));
      metrics.push("mae");
    });

    const latentHeadIndices = [];
    const latentHeadGroups = [];
    const klHeadIndices = [];
    const klHeadGroups = [];
    headConfigs.forEach(function (h, i) {
      if (String(h.target || "") === "latent_diff") {
        latentHeadIndices.push(i);
        const parts = String(h.id || "").split(":");
        latentHeadGroups.push(parts.length >= 3 ? parts[1] : "latent");
      } else if (String(h.target || "") === "latent_kl") {
        klHeadIndices.push(i);
        const kparts = String(h.id || "").split(":");
        klHeadGroups.push(kparts.length >= 3 ? kparts[1] : "vae");
      }
    });

    const monCount = Math.min(256, Number(opts.dataset.yVal.length || 0));
    const xMon = monCount > 0
      ? (isRnn ? xVal.slice([0, 0, 0], [monCount, -1, -1]) : xVal.slice([0, 0], [monCount, -1]))
      : null;

    const computeLatentStats = function () {
      if ((!latentHeadIndices.length && !klHeadIndices.length) || !xMon) return null;
      const predRaw = opts.model.predict(xMon);
      const preds = Array.isArray(predRaw) ? predRaw : [predRaw];
      let absSum = 0;
      let normSum = 0;
      let groupText = [];
      for (let i = 0; i < latentHeadIndices.length; i += 1) {
        const idx = latentHeadIndices[i];
        const t = preds[idx];
        if (!t) continue;
        const absMean = tf.mean(tf.abs(t)).dataSync()[0];
        const norms = tf.sqrt(tf.sum(tf.square(t), -1));
        const normMean = tf.mean(norms).dataSync()[0];
        norms.dispose();
        absSum += Number(absMean || 0);
        normSum += Number(normMean || 0);
        groupText.push(latentHeadGroups[i] + ":|d|=" + Number(absMean || 0).toExponential(2) + ",||d||=" + Number(normMean || 0).toExponential(2));
      }
      let klSum = 0;
      for (let k = 0; k < klHeadIndices.length; k += 1) {
        const kidx = klHeadIndices[k];
        const kt = preds[kidx];
        if (!kt) continue;
        const total = Math.max(2, Number(kt.shape && kt.shape[1]) || 2);
        const zDim = Math.max(1, Math.floor(total / 2));
        const mu = kt.slice([0, 0], [-1, zDim]);
        const logvar = tf.clipByValue(kt.slice([0, zDim], [-1, zDim]), -10, 10);
        const one = tf.onesLike(logvar);
        const klTerm = tf.sub(tf.add(one, logvar), tf.add(tf.square(mu), tf.exp(logvar)));
        const kl = tf.mul(tf.scalar(-0.5), tf.mean(tf.sum(klTerm, -1))).dataSync()[0];
        mu.dispose();
        logvar.dispose();
        one.dispose();
        klTerm.dispose();
        klSum += Number(kl || 0);
        groupText.push(klHeadGroups[k] + ":KL=" + Number(kl || 0).toExponential(2));
      }
      tf.dispose(preds);
      const denom = Math.max(1, latentHeadIndices.length);
      const klDenom = Math.max(1, klHeadIndices.length);
      return {
        absMean: absSum / denom,
        normMean: normSum / denom,
        klMean: klSum / klDenom,
        groupsText: groupText.join(" | "),
      };
    };

    const singleHead = headConfigs.length === 1;
    const requestedLr = Math.max(1e-8, Number(opts.learningRate) || 1e-3);
    const optimizerType = normalizeOptimizerType(opts.optimizerType, "adam");
    const lrSchedulerType = normalizeLrSchedulerType(
      opts.lrSchedulerType,
      opts.useLrScheduler === false ? "none" : "plateau"
    );
    const useLrScheduler = lrSchedulerType !== "none";
    const lrPatience = Math.max(1, Number(opts.lrPatience) || 3);
    const lrFactor = clamp(Number(opts.lrFactor) || 0.5, 0.05, 0.99);
    const minLr = Math.max(1e-8, Number(opts.minLr) || 1e-6);
    const gradClipNorm = Math.max(0, Number(opts.gradClipNorm) || 0);
    const gradClipValue = Math.max(0, Number(opts.gradClipValue) || 0);
    const restoreBestWeights = opts.restoreBestWeights !== false;
    const earlyStoppingPatienceRaw = Number(opts.earlyStoppingPatience);
    const earlyStoppingPatience = Number.isFinite(earlyStoppingPatienceRaw) && earlyStoppingPatienceRaw > 0
      ? Math.max(1, Math.floor(earlyStoppingPatienceRaw))
      : 0;
    let currentLr = requestedLr;
    const optimizer = createOptimizerByType(optimizerType, currentLr);
    if (gradClipNorm > 0 || gradClipValue > 0) {
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

    opts.model.compile({
      optimizer: optimizer,
      loss: singleHead ? losses[0] : losses,
      metrics: singleHead ? ["mae"] : metrics,
    });

    const useTfvis = opts.useTfvis !== false;
    if (useTfvis) {
      try { tfvis.visor().open(); } catch (err) {}
    }
    if (useTfvis) tfvis.show.modelSummary({ name: "Model Summary", tab: "Training" }, opts.model);

    let bestValLoss = Number.POSITIVE_INFINITY;
    let bestEpoch = -1;
    let bestWeights = null;
    let staleCount = 0;
    let lrStaleCount = 0;
    let stoppedEarly = false;

    const disposeTensorArray = function (arr) {
      if (!Array.isArray(arr)) return;
      arr.forEach(function (t) {
        try { if (t && typeof t.dispose === "function") t.dispose(); } catch (err) {}
      });
    };

    const trySetLearningRate = function (nextLr) {
      const v = Math.max(minLr, Number(nextLr) || currentLr);
      currentLr = v;
      try {
        if (opts.model && opts.model.optimizer && typeof opts.model.optimizer.setLearningRate === "function") {
          opts.model.optimizer.setLearningRate(v);
          return true;
        }
      } catch (err) {}
      try {
        if (opts.model && opts.model.optimizer) {
          opts.model.optimizer.learningRate = v;
          return true;
        }
      } catch (err) {}
      return false;
    };

    const localProgressCb = {
      onEpochEnd: async function (epoch, logs) {
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
            const nw = opts.model.getWeights().map(function (w) { return w.clone(); });
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
              if (nextLr < currentLr - 1e-12) {
                trySetLearningRate(nextLr);
              }
              lrStaleCount = 0;
            }
          } else if (lrSchedulerType === "step") {
            const epoch1 = epoch + 1;
            if (epoch1 > 0 && epoch1 % Math.max(1, lrPatience) === 0 && currentLr > minLr) {
              const nextLr = Math.max(minLr, currentLr * lrFactor);
              if (nextLr < currentLr - 1e-12) {
                trySetLearningRate(nextLr);
              }
            }
          } else if (lrSchedulerType === "exponential") {
            if (currentLr > minLr) {
              const nextLr = Math.max(minLr, currentLr * lrFactor);
              if (nextLr < currentLr - 1e-12) {
                trySetLearningRate(nextLr);
              }
            }
          } else if (lrSchedulerType === "cosine") {
            const totalEpochs = Math.max(1, Number(opts.epochs) || 1);
            const progress = Math.min(1, Math.max(0, (epoch + 1) / totalEpochs));
            const cosine = 0.5 * (1 + Math.cos(Math.PI * progress));
            const nextLr = Math.max(minLr, minLr + (requestedLr - minLr) * cosine);
            trySetLearningRate(nextLr);
          }
        }

        if (earlyStoppingPatience > 0 && staleCount >= earlyStoppingPatience) {
          stoppedEarly = true;
          try { opts.model.stopTraining = true; } catch (err) {}
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

        const latentStats = computeLatentStats();
        if (latentStats) {
          logs = Object.assign({}, logs || {}, {
            latent_abs: latentStats.absMean,
            latent_norm: latentStats.normMean,
            latent_kl: latentStats.klMean,
            latent_groups: latentStats.groupsText,
          });
        }
        if (typeof opts.onEpochEnd === "function") opts.onEpochEnd(epoch, logs);
      },
      onBatchEnd: async function (batch, logs) {
        if (typeof opts.onBatchEnd === "function") opts.onBatchEnd(batch, logs);
      },
    };
    const callbacks = useTfvis
      ? [localProgressCb, tfvis.show.fitCallbacks(
          { name: "Training Curves", tab: "Training" },
          ["loss", "val_loss"],
          { callbacks: ["onEpochEnd"] }
        )]
      : [localProgressCb];

    await opts.model.fit(xTrain, singleHead ? yTrainTensors[0] : yTrainTensors, {
      epochs: opts.epochs,
      batchSize: opts.batchSize,
      validationData: [xVal, singleHead ? yValTensors[0] : yValTensors],
      callbacks: callbacks,
    });

    if (restoreBestWeights && Array.isArray(bestWeights) && bestWeights.length) {
      try {
        opts.model.setWeights(bestWeights);
      } catch (err) {}
    }

    const predValRaw = opts.model.predict(xVal);
    const predTestRaw = opts.model.predict(xTest);
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

    const disposeList = [xTrain, xVal, xTest].concat(yTrainTensors, yValTensors, yTestTensors, predVals, predTests);
    if (xMon) disposeList.push(xMon);
    tf.dispose(disposeList);
    disposeTensorArray(bestWeights);
    return {
      mse: mse,
      mae: mae,
      testMse: testMse,
      testMae: testMae,
      headCount: headConfigs.length,
      bestEpoch: bestEpoch > 0 ? bestEpoch : null,
      bestValLoss: Number.isFinite(bestValLoss) ? bestValLoss : null,
      finalLr: currentLr,
      stoppedEarly: stoppedEarly,
    };
  }

  function supportsDatasetWorker() {
    return Boolean(typeof window !== "undefined" && window.Worker);
  }

  function runDatasetGenerationInWorker(spec) {
    if (!supportsDatasetWorker()) {
      throw new Error("Web Worker is not supported in this browser.");
    }
    if (!DATASET_WORKER_PATH) {
      throw new Error("Dataset worker path is not configured.");
    }
    const payload = spec || {};
    const runId = String(
      payload.runId ||
      ("dataset-run-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36))
    );
    const arCfg = payload.arCfg && typeof payload.arCfg === "object" ? payload.arCfg : {};
    const directCfg = payload.directCfg && typeof payload.directCfg === "object" ? payload.directCfg : {};
    const workerPayload = {
      kind: "run",
      runId: runId,
      arCfg: arCfg,
      directCfg: directCfg,
    };
    return new Promise(function (resolve, reject) {
      const worker = new Worker(DATASET_WORKER_PATH);
      state.datasetWorkerBusy = true;
      state.datasetWorker = worker;
      state.datasetWorkerRunSeq += 1;
      let settled = false;
      const finalize = function () {
        if (worker) {
          worker.onmessage = null;
          worker.onerror = null;
          try {
            worker.terminate();
          } catch (_) {}
        }
        if (state.datasetWorker === worker) {
          state.datasetWorker = null;
        }
        state.datasetWorkerBusy = false;
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
        reject(err || new Error("Dataset generation worker failed."));
      };
      worker.onmessage = function (evt) {
        const msg = evt && evt.data ? evt.data : {};
        if (String(msg.kind || "") === "ready") return;
        if (String(msg.kind || "") === "error") {
          const wErr = msg.error || {};
          const err = new Error(String(wErr.message || "Dataset worker failed."));
          fail(err);
          return;
        }
        if (String(msg.kind || "") === "complete") {
          done(msg.result || {});
          return;
        }
      };
      worker.onerror = function (evt) {
        fail(new Error(evt && evt.message ? evt.message : "Dataset worker error"));
      };
      try {
        worker.postMessage(workerPayload);
      } catch (err) {
        fail(err);
      }
    });
  }

  function supportsTrainingWorker() {
    return Boolean(typeof window !== "undefined" && window.Worker);
  }

  async function runTrainingInWorker(spec) {
    if (!supportsTrainingWorker()) {
      throw new Error("Web Worker is not supported in this browser.");
    }
    if (!TRAINING_WORKER_PATH) {
      throw new Error("Training worker path is not configured.");
    }
    const payload = spec || {};
    const runId = String(payload.runId || ("run-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36)));
    const ds = payload.dataset || {};
    const workerPayload = {
      kind: "run",
      runId: runId,
      runtimeConfig: payload.runtimeConfig || { runtimeId: "js_client", backend: "auto" },
      modelArtifacts: payload.modelArtifacts || {},
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
      isSequence: Boolean(payload.isSequence),
      headConfigs: Array.isArray(payload.headConfigs) ? payload.headConfigs.slice() : [],
      outputLossConfig: payload.outputLossConfig || {},
      lossType: String(payload.lossType || DEFAULT_LOSS_TYPE),
      epochs: Number(payload.epochs || 1),
      batchSize: Number(payload.batchSize || 32),
      optimizerType: String(payload.optimizerType || "adam"),
      learningRate: Number(payload.learningRate || 1e-3),
      lrSchedulerType: String(payload.lrSchedulerType || "plateau"),
      useLrScheduler: Boolean(payload.useLrScheduler),
      lrPatience: Number(payload.lrPatience || 3),
      lrFactor: Number(payload.lrFactor || 0.5),
      minLr: Number(payload.minLr || 1e-6),
      gradClipNorm: Number(payload.gradClipNorm || 0),
      gradClipValue: Number(payload.gradClipValue || 0),
      restoreBestWeights: payload.restoreBestWeights !== false,
      earlyStoppingPatience: Number(payload.earlyStoppingPatience || 0),
      useTfvis: false,
    };
    const transfer = [];
    if (workerPayload.modelArtifacts && workerPayload.modelArtifacts.weightData instanceof ArrayBuffer) {
      transfer.push(workerPayload.modelArtifacts.weightData);
    } else if (workerPayload.modelArtifacts && workerPayload.modelArtifacts.weightData && workerPayload.modelArtifacts.weightData.buffer instanceof ArrayBuffer) {
      transfer.push(workerPayload.modelArtifacts.weightData.buffer);
    }
    return new Promise(function (resolve, reject) {
      const worker = new Worker(TRAINING_WORKER_PATH);
      state.trainingWorkerBusy = true;
      state.trainingWorker = worker;
      let settled = false;
      const finalize = function () {
        if (worker) {
          worker.onmessage = null;
          worker.onerror = null;
          try { worker.terminate(); } catch (_) {}
        }
        if (state.trainingWorker === worker) {
          state.trainingWorker = null;
        }
        state.trainingWorkerBusy = false;
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
        if (String(msg.kind || "") === "ready") return;
        if (String(msg.kind || "") === "epoch") {
          if (typeof payload.onEpochData === "function") {
            payload.onEpochData(msg.payload || {}, msg.history || null);
          }
          return;
        }
        if (String(msg.kind || "") === "log") {
          if (typeof payload.onStatus === "function") {
            payload.onStatus(String(msg.message || ""));
          }
          return;
        }
        if (String(msg.kind || "") === "error") {
          const wErr = msg.error || {};
          const err = new Error(String(wErr.message || "Worker training failed."));
          if (wErr.reason) err.reason = String(wErr.reason);
          fail(err);
          return;
        }
        if (String(msg.kind || "") === "complete") {
          done(msg.result || {});
          return;
        }
        if (String(msg.kind || "") === "ping") return;
        return;
      };
      worker.onerror = function (evt) {
        fail(new Error(evt && evt.message ? evt.message : "Worker error"));
      };
      worker.postMessage(workerPayload, transfer);
    });
  }

  async function loadModelFromArtifactForTrainingArtifacts(artifacts) {
    if (!artifacts || !artifacts.modelTopology) return null;
    const weightData =
      artifacts.weightData instanceof ArrayBuffer ? artifacts.weightData
        : (artifacts.weightData && artifacts.weightData.buffer instanceof ArrayBuffer ? artifacts.weightData.buffer : artifacts.weightData);
    const artifactLike = {
      modelTopology: artifacts.modelTopology,
      weightSpecs: artifacts.weightSpecs || [],
      weightData: weightData,
      format: artifacts.format || "tfjs",
      generatedBy: artifacts.generatedBy || "training-worker",
      convertedBy: artifacts.convertedBy || null,
      trainingConfig: artifacts.trainingConfig || null,
      userDefinedMetadata: artifacts.userDefinedMetadata || null,
      modelInitializer: artifacts.modelInitializer || null,
    };
    const m = await tf.loadLayersModel(tf.io.fromMemory(artifactLike));
    return m;
  }

  function resolveInferenceMethod(mode, requested, arCfg) {
    const m = String(mode || "autoregressive");
    const req = String(requested || "auto");
    const padMode = String((arCfg && arCfg.padMode) || "none");
    const defaultAr = padMode === "zero" ? "ar_zero_pad" : (padMode === "edge" ? "ar_edge_pad" : "ar_rk4_warmup");
    if (req === "auto") return m === "direct" ? "direct_only" : defaultAr;
    if (req === "direct_only") return m === "direct" ? "direct_only" : defaultAr;
    if (req === "ar_rk4_warmup" || req === "ar_zero_pad" || req === "ar_edge_pad") {
      return m === "direct" ? "direct_only" : req;
    }
    return m === "direct" ? "direct_only" : defaultAr;
  }

  function buildHistoryAt(series, i, arCfg, padValue) {
    const cfg = arCfg || {};
    const lagMode = String(cfg.lagMode || "contiguous");
    if (lagMode === "exact" && Array.isArray(cfg.lags) && cfg.lags.length) {
      return cfg.lags.map(function (lag) {
        const idx = i - Number(lag || 0);
        return idx >= 0 ? Number(series[idx] || 0) : Number(padValue || 0);
      });
    }
    const w = Math.max(1, Number(cfg.windowSize || 20));
    const out = [];
    for (let j = i - w; j < i; j += 1) {
      out.push(j >= 0 ? Number(series[j] || 0) : Number(padValue || 0));
    }
    return out;
  }

  function rolloutPredictionSeries(opts) {
    const x = (opts.x || []).slice();
    const t = (opts.t || []).slice();
    const vSeries = (opts.v || []).slice();
    const n = x.length;
    const mode = String(opts.mode || "autoregressive");
    const targetMode = String(opts.targetMode || "x");
    const isTargetXV = targetMode === "xv";
    const isTargetVOnly = targetMode === "v";
    const isRnn = Boolean(opts.isSequence);
    const dt = Math.max(1e-6, Number(opts.dt) || 0.02);
    const cond = opts.condition || {};
    const durationSec = Number(opts.durationSec || (t.length ? t[t.length - 1] : 1) || 1);
    const featCfg = ensureFeatureConfig(opts.featureConfig || { useX: true, useParams: true });
    const arFeatCfg = ensureFeatureConfig(Object.assign({}, featCfg, { useScenario: Boolean((opts.featureSpec || {}).useScenario) }));
    const directSpec = normalizeFeatureSpec(
      opts.featureSpec || { useParams: true, useTimeNorm: true, useScenario: false, useSinNorm: false, useCosNorm: false },
      "direct"
    );
    const arCfg = (opts.arHistory && typeof opts.arHistory === "object")
      ? opts.arHistory
      : { windowSize: Math.max(1, Number(opts.windowSize) || 20), lagMode: "contiguous", lags: null, padMode: "none" };
    const method = resolveInferenceMethod(mode, opts.inferenceMethod, arCfg);
    const arWindow = (String(arCfg.lagMode || "contiguous") === "exact" && Array.isArray(arCfg.lags) && arCfg.lags.length)
      ? Math.max.apply(null, arCfg.lags)
      : Math.max(1, Number(arCfg.windowSize || opts.windowSize || 20));

    const predicted = new Array(n).fill(0);
    const predictedV = new Array(n).fill(0);
    if (!n) return { predicted: predicted, predictedV: predictedV, method: method };

    const runDirectStep = function (i) {
      const feature = buildDirectFeatures(t[i], cond, durationSec, directSpec);
      const tensor = tf.tensor2d([feature]);
      const y = opts.model.predict(tensor);
      const out = y.dataSync();
      let px = 0;
      let pv = 0;
      if (isTargetXV) {
        px = Number(out[0] || 0);
        pv = Number(out[1] || 0);
      } else if (isTargetVOnly) {
        pv = Number(out[0] || 0);
        px = i > 0 ? (predicted[i - 1] + pv * dt) : Number(x[0] || 0);
      } else {
        px = Number(out[0] || 0);
        pv = i > 0 ? (px - predicted[i - 1]) / dt : Number(vSeries[0] || 0);
      }
      tensor.dispose();
      y.dispose();
      return { x: px, v: pv };
    };

    if (method === "direct_only") {
      for (let i = 0; i < n; i += 1) {
        const step = runDirectStep(i);
        predicted[i] = step.x;
        predictedV[i] = step.v;
      }
      return { predicted: predicted, predictedV: predictedV, method: method };
    }

    const warmupStepsRaw = Number(opts.warmupSteps);
    const warmupSteps = Number.isFinite(warmupStepsRaw) ? Math.max(0, Math.floor(warmupStepsRaw)) : arWindow;
    let startIdx = 0;
    let padX = 0;
    let padV = 0;

    if (method === "ar_rk4_warmup") {
      startIdx = Math.min(n, warmupSteps);
      for (let i = 0; i < startIdx; i += 1) {
        predicted[i] = Number(x[i] || 0);
        predictedV[i] = Number(vSeries[i] || 0);
      }
      padX = startIdx > 0 ? predicted[0] : 0;
      padV = startIdx > 0 ? predictedV[0] : 0;
    } else if (method === "ar_edge_pad") {
      predicted[0] = Number(x[0] || 0);
      predictedV[0] = Number(vSeries[0] || 0);
      startIdx = 0;
      padX = predicted[0];
      padV = predictedV[0];
    } else {
      // ar_zero_pad
      startIdx = 0;
      padX = 0;
      padV = 0;
    }

    for (let i = startIdx; i < n; i += 1) {
      const historyX = buildHistoryAt(predicted, i, arCfg, padX);
      const historyV = buildHistoryAt(predictedV, i, arCfg, padV);
      const feature = buildInputFeatures(historyX, historyV, cond, arFeatCfg, isRnn, opts.featureSpec);
      const inputTensor = isRnn ? tf.tensor3d([feature]) : tf.tensor2d([feature]);
      const y = opts.model.predict(inputTensor);
      const out = y.dataSync();
      if (isTargetXV) {
        predicted[i] = Number(out[0] || 0);
        predictedV[i] = Number(out[1] || 0);
      } else if (isTargetVOnly) {
        predictedV[i] = Number(out[0] || 0);
        predicted[i] = i > 0 ? (predicted[i - 1] + predictedV[i] * dt) : Number(x[0] || 0);
      } else {
        predicted[i] = Number(out[0] || 0);
        predictedV[i] = i > 0 ? (predicted[i] - predicted[i - 1]) / dt : Number(vSeries[0] || 0);
      }
      inputTensor.dispose();
      y.dispose();
    }

    return { predicted: predicted, predictedV: predictedV, method: method };
  }

  async function evaluateAndPlot(opts) {
    if (!opts.model) throw new Error("Train model first.");
    const sim = simulateOscillator(opts.condition);
    const x = sim.x;
    const t = sim.t;
    const mode = String(opts.mode || "autoregressive");
    const rollout = rolloutPredictionSeries({
      model: opts.model,
      mode: mode,
      inferenceMethod: opts.inferenceMethod,
      warmupSteps: opts.warmupSteps,
      targetMode: opts.targetMode,
      isSequence: Boolean(opts.isSequence),
      featureConfig: opts.featureConfig,
      featureSpec: opts.featureSpec,
      condition: opts.condition,
      x: x,
      v: sim.v,
      t: t,
      dt: Number(opts.condition && opts.condition.dt) || Number(opts.dt) || 0.02,
      durationSec: opts.durationSec || sim.t[sim.t.length - 1],
      windowSize: opts.windowSize,
      arHistory: opts.arHistory,
    });
    const targetMode = String(opts.targetMode || "x");
    const predicted = targetMode === "v" ? rollout.predictedV : rollout.predicted;
    const truth = targetMode === "v" ? sim.v : x;

    const err = truth.map(function (v, i) { return predicted[i] - v; });
    const absErr = err.map(function (e) { return Math.abs(e); });
    const mae = absErr.reduce(function (a, b) { return a + b; }, 0) / absErr.length;
    const rmse = Math.sqrt(err.reduce(function (a, b) { return a + b * b; }, 0) / err.length);
    const bias = err.reduce(function (a, b) { return a + b; }, 0) / err.length;

    Plotly.newPlot(
      opts.chartEl,
      [
        { x: t, y: truth, mode: "lines", name: "Real RK4", line: { color: "#22d3ee" } },
        { x: t, y: predicted, mode: "lines", name: "NN prediction", line: { color: "#f59e0b" } },
        { x: t, y: absErr, mode: "lines", name: "Absolute Error |NN-RK4|", yaxis: "y2", line: { color: "#f43f5e", width: 1 } },
      ],
      {
        paper_bgcolor: "#0b1220",
        plot_bgcolor: "#0b1220",
        font: { color: "#e2e8f0" },
        title:
          "[NN vs RK4][" + mode + "][" + rollout.method + "] Real RK4 vs NN Prediction | MAE=" + mae.toExponential(3) +
          " RMSE=" + rmse.toExponential(3) +
          " Bias(mean NN-RK4)=" + bias.toExponential(3),
        xaxis: { title: "time (s)", gridcolor: "#1e293b" },
        yaxis: { title: getEvalYAxisLabel(opts.condition.scenario, targetMode), gridcolor: "#1e293b" },
        yaxis2: { title: "|error|", overlaying: "y", side: "right", rangemode: "tozero" },
        legend: { orientation: "h" },
        annotations: [{
          xref: "paper",
          yref: "paper",
          x: 0.995,
          y: 1.13,
          xanchor: "right",
          yanchor: "top",
          showarrow: false,
          text: "target: " + String(targetMode || "x"),
          font: { color: "#bfdbfe", size: 11 },
          bgcolor: "rgba(30,58,138,0.28)",
          bordercolor: "#1e40af",
          borderwidth: 1,
          borderpad: 4
        }],
      },
      { responsive: true }
    );

    return { mae: mae, rmse: rmse, bias: bias };
  }

  async function evaluateDatasetTrajectoryAndPlot(opts) {
    if (!opts.model) throw new Error("Train model first.");
    const tr = opts.trajectory;
    const x = tr.x.slice();
    const t = tr.t.slice();
    const vSeries = (tr.v && tr.v.length === tr.x.length) ? tr.v.slice() : tr.x.map(function (_, i) {
      if (i === 0) return 0;
      return (tr.x[i] - tr.x[i - 1]) / Math.max(opts.dt, 1e-6);
    });
    const cond = opts.condition;
    const mode = String(opts.mode || "autoregressive");
    const rollout = rolloutPredictionSeries({
      model: opts.model,
      mode: mode,
      inferenceMethod: opts.inferenceMethod,
      warmupSteps: opts.warmupSteps,
      targetMode: opts.targetMode,
      isSequence: Boolean(opts.isSequence),
      featureConfig: opts.featureConfig,
      featureSpec: opts.featureSpec,
      condition: cond,
      x: x,
      v: vSeries,
      t: t,
      dt: opts.dt,
      durationSec: opts.durationSec || t[t.length - 1],
      windowSize: opts.windowSize,
      arHistory: opts.arHistory,
    });
    const targetMode = String(opts.targetMode || "x");
    const predicted = targetMode === "v" ? rollout.predictedV : rollout.predicted;
    const truth = targetMode === "v" ? vSeries : x;

    const err = truth.map(function (v, i) { return predicted[i] - v; });
    const absErr = err.map(function (e) { return Math.abs(e); });
    const mae = absErr.reduce(function (a, b) { return a + b; }, 0) / absErr.length;
    const rmse = Math.sqrt(err.reduce(function (a, b) { return a + b * b; }, 0) / err.length);
    const bias = err.reduce(function (a, b) { return a + b; }, 0) / err.length;

    const p = tr.params || {};
    const paramLabel =
      "m=" + Number(p.m || cond.m).toFixed(3) +
      ", c=" + Number(p.c || cond.c).toFixed(3) +
      ", k=" + Number(p.k || cond.k).toFixed(3) +
      ", e=" + Number(p.restitution ?? cond.restitution ?? 0.8).toFixed(3);

    Plotly.newPlot(
      opts.chartEl,
      [
        { x: t, y: truth, mode: "lines", name: "Real RK4 (" + paramLabel + ")", line: { color: "#22d3ee" } },
        { x: t, y: predicted, mode: "lines", name: "NN prediction (" + paramLabel + ")", line: { color: "#f59e0b" } },
        { x: t, y: absErr, mode: "lines", name: "Absolute Error |NN-RK4|", yaxis: "y2", line: { color: "#f43f5e", width: 1 } },
      ],
      {
        paper_bgcolor: "#0b1220",
        plot_bgcolor: "#0b1220",
        font: { color: "#e2e8f0" },
        title:
          "[NN vs RK4] Random Dataset Trajectory #" + String(opts.index) +
          " [" + rollout.method + "]" +
          " | MAE=" + mae.toExponential(3) +
          " RMSE=" + rmse.toExponential(3) +
          " Bias=" + bias.toExponential(3),
        xaxis: { title: "time (s)", gridcolor: "#1e293b" },
        yaxis: { title: getEvalYAxisLabel(cond.scenario, targetMode), gridcolor: "#1e293b" },
        yaxis2: { title: "|error|", overlaying: "y", side: "right", rangemode: "tozero" },
        legend: { orientation: "h" },
        annotations: [{
          xref: "paper",
          yref: "paper",
          x: 0.995,
          y: 1.13,
          xanchor: "right",
          yanchor: "top",
          showarrow: false,
          text: "target: " + String(targetMode || "x"),
          font: { color: "#bfdbfe", size: 11 },
          bgcolor: "rgba(30,58,138,0.28)",
          bordercolor: "#1e40af",
          borderwidth: 1,
          borderpad: 4
        }],
      },
      { responsive: true }
    );

    return { mae: mae, rmse: rmse, bias: bias, params: paramLabel, truth: truth, predicted: predicted, t: t };
  }

  function createWorkspaceStoreInstance() {
    if (WORKSPACE_STORE_RUNTIME && typeof WORKSPACE_STORE_RUNTIME.createMemoryStore === "function") {
      return WORKSPACE_STORE_RUNTIME.createMemoryStore();
    }
    const fallbackDoc = {
      irVersion: "1.0",
      updatedAt: Date.now(),
      datasetsById: {},
      modelsById: {},
      trainerCardsById: {},
      trainEpochsBySessionId: {},
      meta: {
        activeDatasetId: "",
        activeModelId: "",
        activeTrainSessionId: "",
        modelSchemaId: "oscillator",
      },
    };
    const hasMetaField = function (obj, key) {
      return Object.prototype.hasOwnProperty.call(obj || {}, key);
    };
    return {
      contractVersion: "1.0",
      snapshot: function () {
        return JSON.parse(JSON.stringify(fallbackDoc));
      },
      replace: function (doc) {
        if (!doc || typeof doc !== "object") return fallbackDoc;
        fallbackDoc.irVersion = String(doc.irVersion || "1.0");
        fallbackDoc.updatedAt = Number(doc.updatedAt) || Date.now();
        fallbackDoc.datasetsById = doc.datasetsById || {};
        fallbackDoc.modelsById = doc.modelsById || {};
        fallbackDoc.trainerCardsById = doc.trainerCardsById || {};
        fallbackDoc.trainEpochsBySessionId = doc.trainEpochsBySessionId || {};
        fallbackDoc.meta = Object.assign({}, fallbackDoc.meta, doc.meta || {});
        return fallbackDoc;
      },
      patchMeta: function (patch) {
        if (!patch || typeof patch !== "object") return fallbackDoc;
        const p = patch || {};
        if (hasMetaField(p, "activeDatasetId")) fallbackDoc.meta.activeDatasetId = String(p.activeDatasetId || "");
        if (hasMetaField(p, "activeModelId")) fallbackDoc.meta.activeModelId = String(p.activeModelId || "");
        if (hasMetaField(p, "activeTrainSessionId")) fallbackDoc.meta.activeTrainSessionId = String(p.activeTrainSessionId || "");
        if (hasMetaField(p, "modelSchemaId")) fallbackDoc.meta.modelSchemaId = resolveSchemaId(String(p.modelSchemaId || "oscillator"));
        fallbackDoc.updatedAt = Date.now();
        return fallbackDoc;
      },
      clear: function () {
        fallbackDoc.updatedAt = Date.now();
        fallbackDoc.datasetsById = {};
        fallbackDoc.modelsById = {};
        fallbackDoc.trainerCardsById = {};
        fallbackDoc.trainEpochsBySessionId = {};
        fallbackDoc.meta = {
          activeDatasetId: "",
          activeModelId: "",
          activeTrainSessionId: "",
          modelSchemaId: "oscillator",
        };
        return fallbackDoc;
      },
    };
  }

  const ui = {
    scenarioType: document.getElementById("scenarioType"),
    evalScenarioType: document.getElementById("evalScenarioType"),
    inferenceMethod: document.getElementById("inferenceMethod"),
    arWarmupSteps: document.getElementById("arWarmupSteps"),
    inferenceMethodInfo: document.getElementById("inferenceMethodInfo"),
    primaryScenarioRow: document.getElementById("primaryScenarioRow"),
    bbGravityRow: document.getElementById("bbGravityRow"),
    globalG: document.getElementById("globalG"),
    bbGroundModel: document.getElementById("bbGroundModel"),
    paramPreset: document.getElementById("paramPreset"),
    groundModel: document.getElementById("groundModel"),
    groundModelRow: document.getElementById("groundModelRow"),
    groundK: document.getElementById("groundK"),
    groundKRow: document.getElementById("groundKRow"),
    groundC: document.getElementById("groundC"),
    groundCRow: document.getElementById("groundCRow"),
    massRange: document.getElementById("massRange"),
    dampingRange: document.getElementById("dampingRange"),
    stiffnessRange: document.getElementById("stiffnessRange"),
    restitutionRange: document.getElementById("restitutionRange"),
    restitutionRangeRow: document.getElementById("restitutionRangeRow"),
    dampingRangeLabel: document.getElementById("dampingRangeLabel"),
    param3RangeLabel: document.getElementById("param3RangeLabel"),
    x0Range: document.getElementById("x0Range"),
    v0Range: document.getElementById("v0Range"),
    seed: document.getElementById("seed"),
    numTraj: document.getElementById("numTraj"),
    durationSec: document.getElementById("durationSec"),
    splitMode: document.getElementById("splitMode"),
    splitModeRow: document.getElementById("splitModeRow"),
    trainFrac: document.getElementById("trainFrac"),
    trainFracRow: document.getElementById("trainFracRow"),
    valFrac: document.getElementById("valFrac"),
    valFracRow: document.getElementById("valFracRow"),
    testFrac: document.getElementById("testFrac"),
    testFracRow: document.getElementById("testFracRow"),
    predictionMode: document.getElementById("predictionMode"),
    windowSize: document.getElementById("windowSize"),
    dt: document.getElementById("dt"),
    useTfvis: document.getElementById("useTfvis"),
    lossType: document.getElementById("lossType"),
    openTfvisBtn: document.getElementById("openTfvisBtn"),
    epochs: document.getElementById("epochs"),
    batchSize: document.getElementById("batchSize"),
    optimizerType: document.getElementById("optimizerType"),
    learningRate: document.getElementById("learningRate"),
    useLrScheduler: document.getElementById("useLrScheduler"),
    lrPatience: document.getElementById("lrPatience"),
    lrFactor: document.getElementById("lrFactor"),
    minLr: document.getElementById("minLr"),
    gradClipNorm: document.getElementById("gradClipNorm"),
    gradClipValue: document.getElementById("gradClipValue"),
    restoreBestWeights: document.getElementById("restoreBestWeights"),
    earlyStoppingPatience: document.getElementById("earlyStoppingPatience"),
    genDatasetBtn: document.getElementById("genDatasetBtn"),
    trainBtn: document.getElementById("trainBtn"),
    evalBtn: document.getElementById("evalBtn"),
    quickCompareInfo: document.getElementById("quickCompareInfo"),
    datasetCompareMode: document.getElementById("datasetCompareMode"),
    selectedTrajCsv: document.getElementById("selectedTrajCsv"),
    datasetName: document.getElementById("datasetName"),
    datasetConfigHome: document.getElementById("datasetConfigHome"),
    datasetConfigBlock: document.getElementById("datasetConfigBlock"),
    trainingConfigHome: document.getElementById("trainingConfigHome"),
    trainingConfigBlock: document.getElementById("trainingConfigBlock"),
    datasetSidebarOscillatorOnly: document.getElementById("datasetSidebarOscillatorOnly"),
    datasetSidebarImageOnly: document.getElementById("datasetSidebarImageOnly"),
    datasetModuleSelect: document.getElementById("datasetModuleSelect"),
    datasetModuleInfo: document.getElementById("datasetModuleInfo"),
    datasetDetailTitle: document.getElementById("datasetDetailTitle"),
    datasetDetailMeta: document.getElementById("datasetDetailMeta"),
    dataLabPreviewTab: document.getElementById("dataLabPreviewTab"),
    dataLabBuilderTab: document.getElementById("dataLabBuilderTab"),
    datasetSelectionEmpty: document.getElementById("datasetSelectionEmpty"),
    dataLabPreviewPane: document.getElementById("dataLabPreviewPane"),
    dataLabBuilderPane: document.getElementById("dataLabBuilderPane"),
    datasetOscillatorPanel: document.getElementById("datasetOscillatorPanel"),
    datasetOscillatorHint: document.getElementById("datasetOscillatorHint"),
    datasetOscillatorTableControls: document.getElementById("datasetOscillatorTableControls"),
    datasetOscillatorSchemaHint: document.getElementById("datasetOscillatorSchemaHint"),
    datasetOscillatorTableWrap: document.getElementById("datasetOscillatorTableWrap"),
    datasetGenericTableWrap: document.getElementById("datasetGenericTableWrap"),
    datasetGenericTableHeadRow: document.getElementById("datasetGenericTableHeadRow"),
    datasetGenericTableBody: document.getElementById("datasetGenericTableBody"),
    datasetImagePanel: document.getElementById("datasetImagePanel"),
    datasetImageSplit: document.getElementById("datasetImageSplit"),
    datasetImageIndex: document.getElementById("datasetImageIndex"),
    datasetImageCanvas: document.getElementById("datasetImageCanvas"),
    datasetImageInfo: document.getElementById("datasetImageInfo"),
    mnistRandomByClassBtn: document.getElementById("mnistRandomByClassBtn"),
    mnistClassGrid: document.getElementById("mnistClassGrid"),
    mnistTrainCount: document.getElementById("mnistTrainCount"),
    mnistValCount: document.getElementById("mnistValCount"),
    mnistTestCount: document.getElementById("mnistTestCount"),
    mnistTotalCount: document.getElementById("mnistTotalCount"),
    exportDatasetCsvBtn: document.getElementById("exportDatasetCsvBtn"),
    savedDatasetSelect: document.getElementById("savedDatasetSelect"),
    netPreset: document.getElementById("netPreset"),
    currentPresetLabel: document.getElementById("currentPresetLabel"),
    presetModalBackdrop: document.getElementById("presetModalBackdrop"),
    presetModalSelect: document.getElementById("presetModalSelect"),
    presetModalApplyBtn: document.getElementById("presetModalApplyBtn"),
    presetModalCancelBtn: document.getElementById("presetModalCancelBtn"),
    modelDatasetSource: document.getElementById("modelDatasetSource"),
    applyPresetBtn: document.getElementById("applyPresetBtn"),
    startCleanBtn: document.getElementById("startCleanBtn"),
    clearGraphBtn: document.getElementById("clearGraphBtn"),
    autoArrangeBtn: document.getElementById("autoArrangeBtn"),
    addInputBtn: document.getElementById("addInputBtn"),
    addDenseBtn: document.getElementById("addDenseBtn"),
    addBatchNormBtn: document.getElementById("addBatchNormBtn"),
    addLayerNormBtn: document.getElementById("addLayerNormBtn"),
    addLatentBtn: document.getElementById("addLatentBtn"),
    addLatentMuBtn: document.getElementById("addLatentMuBtn"),
    addLatentLogVarBtn: document.getElementById("addLatentLogVarBtn"),
    addReparamBtn: document.getElementById("addReparamBtn"),
    addDropoutBtn: document.getElementById("addDropoutBtn"),
    addOutputMultiBtn: document.getElementById("addOutputMultiBtn"),
    addWindowHistBtn: document.getElementById("addWindowHistBtn"),
    addRnnBtn: document.getElementById("addRnnBtn"),
    addGruBtn: document.getElementById("addGruBtn"),
    addLstmBtn: document.getElementById("addLstmBtn"),
    addConv1dBtn: document.getElementById("addConv1dBtn"),
    addHistBtn: document.getElementById("addHistBtn"),
    addImageSourceBtn: document.getElementById("addImageSourceBtn"),
    addParamsBtn: document.getElementById("addParamsBtn"),
    addScenarioBtn: document.getElementById("addScenarioBtn"),
    addTimeSecBtn: document.getElementById("addTimeSecBtn"),
    addTimeNormBtn: document.getElementById("addTimeNormBtn"),
    addSinNormBtn: document.getElementById("addSinNormBtn"),
    addCosNormBtn: document.getElementById("addCosNormBtn"),
    addNoiseScheduleBtn: document.getElementById("addNoiseScheduleBtn"),
    addRatioKmBtn: document.getElementById("addRatioKmBtn"),
    addRatioCmBtn: document.getElementById("addRatioCmBtn"),
    addRatioGlBtn: document.getElementById("addRatioGlBtn"),
    addConcatBtn: document.getElementById("addConcatBtn"),
    exportGraphBtn: document.getElementById("exportGraphBtn"),
    importGraphBtn: document.getElementById("importGraphBtn"),
    importGraphFile: document.getElementById("importGraphFile"),
    status: document.getElementById("status"),
    drawflow: document.getElementById("drawflow"),
    drawflowResizer: document.getElementById("drawflowResizer"),
    latentMonitorChart: document.getElementById("latentMonitorChart"),
    latentMonitorInfo: document.getElementById("latentMonitorInfo"),
    chart: document.getElementById("evalChart"),
    previewMainChartWrap: document.getElementById("previewMainChartWrap"),
    previewModulePanelMount: document.getElementById("previewModulePanelMount"),
    playgroundUnsupportedHint: document.getElementById("playgroundUnsupportedHint"),
    previewSplitCharts: document.getElementById("previewSplitCharts"),
    evalChartSpring: document.getElementById("evalChartSpring"),
    evalChartPendulum: document.getElementById("evalChartPendulum"),
    evalChartBouncing: document.getElementById("evalChartBouncing"),
    datasetChart: document.getElementById("datasetChart"),
    datasetComparePageBtn: document.getElementById("datasetComparePageBtn"),
    datasetCompareScenario: document.getElementById("datasetCompareScenario"),
    compareChart: document.getElementById("compareChart"),
    qaEvalBtn: document.getElementById("qaEvalBtn"),
    qaRandomDatasetEvalBtn: document.getElementById("qaRandomDatasetEvalBtn"),
    runBenchmarkBtn: document.getElementById("runBenchmarkBtn"),
    runFullAutoBtn: document.getElementById("runFullAutoBtn"),
    benchmarkSuite: document.getElementById("benchmarkSuite"),
    checklistTableBody: document.getElementById("checklistTableBody"),
    clearChecklistBtn: document.getElementById("clearChecklistBtn"),
    runLog: document.getElementById("runLog"),
    copyRunLogBtn: document.getElementById("copyRunLogBtn"),
    clearRunLogBtn: document.getElementById("clearRunLogBtn"),
    exportMetricsBtn: document.getElementById("exportMetricsBtn"),
    clearMetricsBtn: document.getElementById("clearMetricsBtn"),
    layoutRoot: document.getElementById("layoutRoot"),
    sidebar: document.getElementById("sidebar"),
    leftLibraryPanel: document.getElementById("leftLibraryPanel"),
    leftLibraryTitle: document.getElementById("leftLibraryTitle"),
    leftLibraryActions: document.getElementById("leftLibraryActions"),
    leftNewDatasetBtn: document.getElementById("leftNewDatasetBtn"),
    leftNewModelBtn: document.getElementById("leftNewModelBtn"),
    leftNewTrainSessionBtn: document.getElementById("leftNewTrainSessionBtn"),
    leftLibraryList: document.getElementById("leftLibraryList"),
    rightRail: document.getElementById("rightRail"),
    rightDataLabPanel: document.getElementById("rightDataLabPanel"),
    rightDataLabPanelTitle: document.getElementById("rightDataLabPanelTitle"),
    rightDataLabInfo: document.getElementById("rightDataLabInfo"),
    rightDataLabConfigTitle: document.getElementById("rightDataLabConfigTitle"),
    rightDataLabConfigMount: document.getElementById("rightDataLabConfigMount"),
    rightModelPanel: document.getElementById("rightModelPanel"),
    rightTrainPanel: document.getElementById("rightTrainPanel"),
    rightTrainInfo: document.getElementById("rightTrainInfo"),
    rightTrainConfigTitle: document.getElementById("rightTrainConfigTitle"),
    rightTrainConfigMount: document.getElementById("rightTrainConfigMount"),
    wsPreviewTab: document.getElementById("wsPreviewTab"),
    wsDatasetTab: document.getElementById("wsDatasetTab"),
    wsNnTab: document.getElementById("wsNnTab"),
    wsTrainTab: document.getElementById("wsTrainTab"),
    wsGenTab: document.getElementById("wsGenTab"),
    wsEvalTab: document.getElementById("wsEvalTab"),
    wsPreviewPane: document.getElementById("wsPreviewPane"),
    wsDatasetPane: document.getElementById("wsDatasetPane"),
    wsNnPane: document.getElementById("wsNnPane"),
    modelLabSelectionEmpty: document.getElementById("modelLabSelectionEmpty"),
    modelLabContent: document.getElementById("modelLabContent"),
    wsTrainPane: document.getElementById("wsTrainPane"),
    wsGenPane: document.getElementById("wsGenPane"),
    wsEvalPane: document.getElementById("wsEvalPane"),
    serverEndpointInput: document.getElementById("serverEndpointInput"),
    detectServerBtn: document.getElementById("detectServerBtn"),
    runtimeDetectInfo: document.getElementById("runtimeDetectInfo"),
    modelSchemaSelect: document.getElementById("modelSchemaSelect"),
    modelSchemaReadonly: document.getElementById("modelSchemaReadonly"),
    modelLibraryName: document.getElementById("modelLibraryName"),
    newModelBtn: document.getElementById("newModelBtn"),
    saveModelToLibraryBtn: document.getElementById("saveModelToLibraryBtn"),
    modelPaletteMount: document.getElementById("modelPaletteMount"),
    unsavedModelModalBackdrop: document.getElementById("unsavedModelModalBackdrop"),
    unsavedModelModalText: document.getElementById("unsavedModelModalText"),
    unsavedModelSaveBtn: document.getElementById("unsavedModelSaveBtn"),
    unsavedModelDiscardBtn: document.getElementById("unsavedModelDiscardBtn"),
    unsavedModelCancelBtn: document.getElementById("unsavedModelCancelBtn"),
    entityCreateModalBackdrop: document.getElementById("entityCreateModalBackdrop"),
    entityCreateModalTitle: document.getElementById("entityCreateModalTitle"),
    entityCreateFormMount: document.getElementById("entityCreateFormMount"),
    entityCreateFootnote: document.getElementById("entityCreateFootnote"),
    entityCreateModalCreateBtn: document.getElementById("entityCreateModalCreateBtn"),
    entityCreateModalCancelBtn: document.getElementById("entityCreateModalCancelBtn"),
    renameModelBtn: document.getElementById("renameModelBtn"),
    deleteModelFromLibraryBtn: document.getElementById("deleteModelFromLibraryBtn"),
    trainSessionName: document.getElementById("trainSessionName"),
    trainSessionSchemaSelect: document.getElementById("trainSessionSchemaSelect"),
    trainSessionDatasetSelect: document.getElementById("trainSessionDatasetSelect"),
    trainSessionModelSelect: document.getElementById("trainSessionModelSelect"),
    trainSessionRuntime: document.getElementById("trainSessionRuntime"),
    trainSessionRuntimeBackend: document.getElementById("trainSessionRuntimeBackend"),
    addTrainSessionBtn: document.getElementById("addTrainSessionBtn"),
    trainMainView: document.getElementById("trainMainView"),
    trainSessionStatus: document.getElementById("trainSessionStatus"),
    modeContract: document.getElementById("modeContract"),
    predictionModeInfo: document.getElementById("predictionModeInfo"),
    dataScenarioFilter: document.getElementById("dataScenarioFilter"),
    dataTrajIdx: document.getElementById("dataTrajIdx"),
    dataRows: document.getElementById("dataRows"),
    drawTableTrajBtn: document.getElementById("drawTableTrajBtn"),
    dataTableBody: document.getElementById("dataTableBody"),
    tableDatasetInfo: document.getElementById("tableDatasetInfo"),
    metricsTableBody: document.getElementById("metricsTableBody"),
    bestModelSummary: document.getElementById("bestModelSummary"),
    configMixWarning: document.getElementById("configMixWarning"),
    scenarioSummaryChart: document.getElementById("scenarioSummaryChart"),
    worstCasesTableBody: document.getElementById("worstCasesTableBody"),
    clearBenchDetailBtn: document.getElementById("clearBenchDetailBtn"),
    nodeConfigPanel: document.getElementById("nodeConfigPanel"),
    nodeConfigTitle: document.getElementById("nodeConfigTitle"),
    nodeConfigBody: document.getElementById("nodeConfigBody"),
    eomMainOverlay: document.getElementById("eomMainOverlay"),
    eomSpringOverlay: document.getElementById("eomSpringOverlay"),
    eomPendulumOverlay: document.getElementById("eomPendulumOverlay"),
    eomBouncingOverlay: document.getElementById("eomBouncingOverlay"),
    genScenarioType: document.getElementById("genScenarioType"),
    genSourceMode: document.getElementById("genSourceMode"),
    genRefTrajIdx: document.getElementById("genRefTrajIdx"),
    genNumSamples: document.getElementById("genNumSamples"),
    genParamNoise: document.getElementById("genParamNoise"),
    genRatioFeature: document.getElementById("genRatioFeature"),
    genRatioScale: document.getElementById("genRatioScale"),
    genDiffSteps: document.getElementById("genDiffSteps"),
    genGuidance: document.getElementById("genGuidance"),
    genRunOneBtn: document.getElementById("genRunOneBtn"),
    genRunBatchBtn: document.getElementById("genRunBatchBtn"),
    genQualityBtn: document.getElementById("genQualityBtn"),
    genClearBtn: document.getElementById("genClearBtn"),
    genExportCsvBtn: document.getElementById("genExportCsvBtn"),
    genExportJsonBtn: document.getElementById("genExportJsonBtn"),
    genSortMode: document.getElementById("genSortMode"),
    genSampleSelect: document.getElementById("genSampleSelect"),
    genJumpBtn: document.getElementById("genJumpBtn"),
    genSingleChart: document.getElementById("genSingleChart"),
    genBatchChart: document.getElementById("genBatchChart"),
    genQualityChart: document.getElementById("genQualityChart"),
    genMetricsTableBody: document.getElementById("genMetricsTableBody"),
    genQualityTableBody: document.getElementById("genQualityTableBody"),
  };

  function setStatus(text) {
    ui.status.textContent = text;
    if (ui.inlineStatus) ui.inlineStatus.textContent = text;
    const nowMs = Date.now();
    const isBatchMsg = /\bbatch\s+\d+/i.test(String(text || ""));
    if (isBatchMsg && state.lastBatchStatusMs && nowMs - state.lastBatchStatusMs < 1500) return;
    if (isBatchMsg) state.lastBatchStatusMs = nowMs;
    if (ui.runLog) {
      const ts = new Date().toLocaleTimeString();
      ui.runLog.value += "[" + ts + "] " + text + "\n";
      if (ui.runLog.value.length > 120000) {
        const cut = ui.runLog.value.indexOf("\n", 30000);
        ui.runLog.value = cut > 0 ? ui.runLog.value.slice(cut + 1) : ui.runLog.value.slice(-80000);
      }
      ui.runLog.scrollTop = ui.runLog.scrollHeight;
    }
  }

  function getGlobalLossType() {
    const raw = String((ui.lossType && ui.lossType.value) || DEFAULT_LOSS_TYPE);
    if (raw === "meanAbsoluteError" || raw === "huberLoss" || raw === "meanSquaredError") return raw;
    return DEFAULT_LOSS_TYPE;
  }

  function getPresetLabelByValue(value) {
    if (String(value || "") === "custom") return "Custom graph (manual edits)";
    const defs = getSchemaPresetDefs(state.modelSchemaId || "oscillator");
    const foundDef = defs.find(function (d) { return String(d && d.id) === String(value); });
    if (foundDef) return String(foundDef.label || foundDef.id || value);
    if (!ui.netPreset) return String(value || "custom");
    const opts = Array.from(ui.netPreset.options || []);
    const found = opts.find(function (o) { return String(o.value) === String(value); });
    return found ? String(found.textContent || found.value) : String(value || "custom");
  }

  function refreshCurrentPresetLabel() {
    if (!ui.currentPresetLabel || !ui.netPreset) return;
    ui.currentPresetLabel.textContent = "Active preset: " + getPresetLabelByValue(ui.netPreset.value || "direct_mlp_strong");
  }

  function refreshModelSchemaReadonly(schemaId) {
    if (!ui.modelSchemaReadonly) return;
    const sid = resolveSchemaId(schemaId || (ui.modelSchemaSelect && ui.modelSchemaSelect.value) || state.modelSchemaId || "oscillator");
    const label = schemaLabelById(sid);
    ui.modelSchemaReadonly.textContent = label + " [" + sid + "]";
  }

  function refreshModelSchemaOptions(preferredSchemaId) {
    if (!ui.modelSchemaSelect) return;
    const all = listModelSchemas();
    const cur = resolveSchemaId(preferredSchemaId || ui.modelSchemaSelect.value || state.modelSchemaId || "oscillator");
    ui.modelSchemaSelect.innerHTML = "";
    if (!all.length) {
      const op = document.createElement("option");
      op.value = "oscillator";
      op.textContent = "oscillator";
      ui.modelSchemaSelect.appendChild(op);
      ui.modelSchemaSelect.value = "oscillator";
      return;
    }
    all.forEach(function (s) {
      const op = document.createElement("option");
      op.value = String(s.id || "");
      op.textContent = String(s.label || s.id || "");
      ui.modelSchemaSelect.appendChild(op);
    });
    ui.modelSchemaSelect.value = resolveSchemaId(cur);
    refreshModelSchemaReadonly(ui.modelSchemaSelect.value);
  }

  function refreshPresetOptionsForSchema(schemaId) {
    const sid = resolveSchemaId(schemaId || state.modelSchemaId || "oscillator");
    const defs = getSchemaPresetDefs(sid);
    const addOption = function (sel, value, label) {
      const op = document.createElement("option");
      op.value = String(value || "");
      op.textContent = String(label || value || "");
      sel.appendChild(op);
    };
    const applyToSelect = function (sel) {
      if (!sel) return;
      const cur = String(sel.value || "");
      sel.innerHTML = "";
      defs.forEach(function (d) {
        const id = String((d && d.id) || "");
        if (!id) return;
        addOption(sel, id, String((d && d.label) || id));
      });
      addOption(sel, "custom", "Custom");
      const hasCur = Array.from(sel.options || []).some(function (op) { return String(op.value || "") === cur; });
      if (hasCur) sel.value = cur;
      else if (defs.length) sel.value = String((defs[0] && defs[0].id) || "custom");
      else sel.value = "custom";
    };
    applyToSelect(ui.netPreset);
    applyToSelect(ui.presetModalSelect);
    refreshCurrentPresetLabel();
  }

  function getSchemaPaletteSpec(schemaId) {
    const schema = getModelSchemaConfig(schemaId);
    const md = (schema && schema.metadata && schema.metadata.featureNodes) ? schema.metadata.featureNodes : {};
    const palette = (md && md.palette && typeof md.palette === "object") ? md.palette : {};
    const rawItems = Array.isArray(palette.items) ? palette.items : [];
    return rawItems
      .map(function (item) {
        if (!item || typeof item !== "object") return null;
        const type = String(item.type || "").trim().toLowerCase();
        if (!type) return null;
        return {
          uiKey: String(item.uiKey || type).trim(),
          type: type,
          label: String(item.label || type).trim(),
          section: String(item.section || "Nodes").trim(),
          config: (item.config && typeof item.config === "object") ? JSON.parse(JSON.stringify(item.config)) : {},
        };
      })
      .filter(Boolean);
  }

  function renderModelPaletteForSchema(schemaId) {
    if (!ui.modelPaletteMount) return;
    const items = getSchemaPaletteSpec(schemaId);
    if (!items.length) {
      ui.modelPaletteMount.innerHTML = "<div class='hint'>No node palette for this schema.</div>";
      return;
    }
    const sections = [];
    items.forEach(function (item) {
      let sec = sections.find(function (x) { return x.name === item.section; });
      if (!sec) {
        sec = { name: item.section, items: [] };
        sections.push(sec);
      }
      sec.items.push(item);
    });
    ui.modelPaletteMount.innerHTML = sections.map(function (sec) {
      return (
        "<div class='panel' style='margin-bottom:8px;'>" +
          "<div class='compare-title'>" + escapeHtml(sec.name) + "</div>" +
          "<div class='node-btns'>" +
            sec.items.map(function (item) {
              return (
                "<button class='secondary' type='button' " +
                  "data-palette-ui-key='" + escapeHtml(item.uiKey) + "' " +
                  "data-palette-type='" + escapeHtml(item.type) + "'>" +
                  escapeHtml(item.label) +
                "</button>"
              );
            }).join("") +
          "</div>" +
        "</div>"
      );
    }).join("");
  }

  function setFeatureButtonEnabled(buttonEl, enabled, disabledTitle) {
    if (!buttonEl) return;
    const on = Boolean(enabled);
    buttonEl.disabled = !on;
    buttonEl.style.opacity = on ? "1" : "0.45";
    buttonEl.style.cursor = on ? "" : "not-allowed";
    buttonEl.title = on ? "" : String(disabledTitle || "This node is not allowed by current dataset schema.");
  }

  function refreshFeatureNodeButtonsForSchema(schemaId) {
    renderModelPaletteForSchema(schemaId);
    const sid = resolveSchemaId(schemaId || state.modelSchemaId || "oscillator");
    const policy = getSchemaFeatureNodePolicy(sid);
    setFeatureButtonEnabled(ui.addWindowHistBtn, policy.allowWindowHistory, "WindowHistory is not allowed by this schema.");
    setFeatureButtonEnabled(ui.addHistBtn, policy.allowHistory, "History is not allowed by this schema.");
    setFeatureButtonEnabled(ui.addImageSourceBtn, policy.allowImageSource, "ImageSource is not allowed by this schema.");
    setFeatureButtonEnabled(ui.addParamsBtn, policy.allowParams, "Params/Features is not allowed by this schema.");
    setFeatureButtonEnabled(ui.addScenarioBtn, policy.allowOneHot, "OneHot is not allowed by this schema.");
  }

  function setCurrentModelSchema(schemaId, opts) {
    const sid = resolveSchemaId(schemaId);
    refreshModelSchemaOptions(sid);
    state.modelSchemaId = sid;
    if (ui.modelSchemaSelect) ui.modelSchemaSelect.value = sid;
    refreshModelSchemaReadonly(sid);
    refreshPresetOptionsForSchema(sid);
    refreshFeatureNodeButtonsForSchema(sid);
    refreshTrainSessionSelectors(sid);
    if (!(opts && opts.skipNodePanelRefresh) && state.editor && state.activeNodeId) {
      renderNodeConfigPanel(state.editor, state.activeNodeId);
      refreshNodeSummaries(state.editor);
    }
  }

  function graphSignatureFromPayload(payload) {
    try {
      return JSON.stringify(payload || {});
    } catch (err) {
      return "";
    }
  }

  function getDrawflowNodeCount(payload) {
    const info = extractDrawflowPayload(payload);
    const data = info && info.drawflow && info.drawflow.Home && info.drawflow.Home.data;
    if (!data || typeof data !== "object") return 0;
    return Object.keys(data).length;
  }

  function isCurrentGraphEmpty() {
    if (!state.editor || typeof state.editor.export !== "function") return true;
    return getDrawflowNodeCount(state.editor.export()) === 0;
  }

  function extractDrawflowPayload(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (payload.drawflow && payload.drawflow.Home && payload.drawflow.Home.data) return payload;
    if (payload.drawflow && payload.drawflow.drawflow && payload.drawflow.drawflow.Home && payload.drawflow.drawflow.Home.data) {
      return { drawflow: payload.drawflow.drawflow };
    }
    if (payload.graph && payload.graph.drawflow && payload.graph.drawflow.Home && payload.graph.drawflow.Home.data) return payload.graph;
    if (payload.graph && payload.graph.drawflow && payload.graph.drawflow.drawflow && payload.graph.drawflow.drawflow.Home && payload.graph.drawflow.drawflow.Home.data) {
      return { drawflow: payload.graph.drawflow.drawflow };
    }
    if (
      payload.model &&
      payload.model.graph &&
      payload.model.graph.drawflow &&
      payload.model.graph.drawflow.Home &&
      payload.model.graph.drawflow.Home.data
    ) {
      return payload.model.graph;
    }
    if (
      payload.model &&
      payload.model.graph &&
      payload.model.graph.drawflow &&
      payload.model.graph.drawflow.drawflow &&
      payload.model.graph.drawflow.drawflow.Home &&
      payload.model.graph.drawflow.drawflow.Home.data
    ) {
      return { drawflow: payload.model.graph.drawflow.drawflow };
    }
    return null;
  }

  function extractDrawflowNodeMap(payload) {
    const drawflowPayload = extractDrawflowPayload(payload);
    if (!drawflowPayload) return null;
    const data = drawflowPayload.drawflow && drawflowPayload.drawflow.Home
      ? drawflowPayload.drawflow.Home.data
      : null;
    if (!data || typeof data !== "object") return null;
    return { drawflowPayload: drawflowPayload, nodeMap: data };
  }

  function repairDrawflowConnections(nodeMap) {
    const ids = Object.keys(nodeMap || {});
    const idSet = {};
    ids.forEach(function (id) { idSet[String(id)] = true; });

    const ensureInputPort = function (node, inPort) {
      if (!node.inputs || typeof node.inputs !== "object") node.inputs = {};
      if (!node.inputs[inPort] || typeof node.inputs[inPort] !== "object") node.inputs[inPort] = {};
      if (!Array.isArray(node.inputs[inPort].connections)) node.inputs[inPort].connections = [];
      return node.inputs[inPort].connections;
    };
    const ensureOutputPort = function (node, outPort) {
      if (!node.outputs || typeof node.outputs !== "object") node.outputs = {};
      if (!node.outputs[outPort] || typeof node.outputs[outPort] !== "object") node.outputs[outPort] = {};
      if (!Array.isArray(node.outputs[outPort].connections)) node.outputs[outPort].connections = [];
      return node.outputs[outPort].connections;
    };
    const hasInputReciprocal = function (arr, sourceId, outPort) {
      return (arr || []).some(function (x) {
        return String((x && x.node) == null ? "" : x.node).trim() === sourceId &&
          String((x && x.output) == null ? "" : x.output).trim() === outPort;
      });
    };
    const hasOutputReciprocal = function (arr, targetId, inPort) {
      return (arr || []).some(function (x) {
        return String((x && x.node) == null ? "" : x.node).trim() === targetId &&
          String((x && x.input) == null ? "" : x.input).trim() === inPort;
      });
    };
    const inferInputPort = function (targetNode, sourceId, outPort) {
      const inputs = targetNode && targetNode.inputs && typeof targetNode.inputs === "object" ? targetNode.inputs : {};
      const keys = Object.keys(inputs);
      const matches = [];
      keys.forEach(function (inPort) {
        const arr = Array.isArray(inputs[inPort] && inputs[inPort].connections) ? inputs[inPort].connections : [];
        if (hasInputReciprocal(arr, sourceId, outPort)) matches.push(inPort);
      });
      if (matches.length === 1) return matches[0];
      if (keys.length === 1) return keys[0];
      return "";
    };
    const inferOutputPort = function (sourceNode, targetId, inPort) {
      const outputs = sourceNode && sourceNode.outputs && typeof sourceNode.outputs === "object" ? sourceNode.outputs : {};
      const keys = Object.keys(outputs);
      const matches = [];
      keys.forEach(function (outPort) {
        const arr = Array.isArray(outputs[outPort] && outputs[outPort].connections) ? outputs[outPort].connections : [];
        if (hasOutputReciprocal(arr, targetId, inPort)) matches.push(outPort);
      });
      if (matches.length === 1) return matches[0];
      if (keys.length === 1) return keys[0];
      return "";
    };

    ids.forEach(function (sourceId) {
      const sourceNode = nodeMap[sourceId];
      if (!sourceNode || typeof sourceNode !== "object") return;
      const outputs = sourceNode.outputs && typeof sourceNode.outputs === "object" ? sourceNode.outputs : {};
      Object.keys(outputs).forEach(function (outPort) {
        const outArr = ensureOutputPort(sourceNode, outPort);
        outArr.forEach(function (c) {
          if (!c || typeof c !== "object") return;
          const targetId = String((c && c.node) == null ? "" : c.node).trim();
          if (!targetId || !idSet[targetId]) return;
          const targetNode = nodeMap[targetId];
          if (!targetNode || typeof targetNode !== "object") return;
          let inPort = String((c && c.input) == null ? "" : c.input).trim();
          if (!inPort) {
            const guessed = inferInputPort(targetNode, sourceId, outPort);
            if (guessed) {
              c.input = guessed;
              inPort = guessed;
            }
          }
          if (!inPort) return;
          const inArr = ensureInputPort(targetNode, inPort);
          if (!hasInputReciprocal(inArr, sourceId, outPort)) {
            inArr.push({ node: sourceId, output: outPort });
          }
        });
      });
    });

    ids.forEach(function (targetId) {
      const targetNode = nodeMap[targetId];
      if (!targetNode || typeof targetNode !== "object") return;
      const inputs = targetNode.inputs && typeof targetNode.inputs === "object" ? targetNode.inputs : {};
      Object.keys(inputs).forEach(function (inPort) {
        const inArr = ensureInputPort(targetNode, inPort);
        inArr.forEach(function (c) {
          if (!c || typeof c !== "object") return;
          const sourceId = String((c && c.node) == null ? "" : c.node).trim();
          if (!sourceId || !idSet[sourceId]) return;
          const sourceNode = nodeMap[sourceId];
          if (!sourceNode || typeof sourceNode !== "object") return;
          let outPort = String((c && c.output) == null ? "" : c.output).trim();
          if (!outPort) {
            const guessed = inferOutputPort(sourceNode, targetId, inPort);
            if (guessed) {
              c.output = guessed;
              outPort = guessed;
            }
          }
          if (!outPort) return;
          const outArr = ensureOutputPort(sourceNode, outPort);
          if (!hasOutputReciprocal(outArr, targetId, inPort)) {
            outArr.push({ node: targetId, input: inPort });
          }
        });
      });
    });
  }

  function assertValidDrawflowGraph(payload, label) {
    const where = String(label || "Drawflow graph");
    const info = extractDrawflowNodeMap(payload);
    if (!info) throw new Error(where + " is missing drawflow.Home.data");
    const nodeMap = info.nodeMap;
    repairDrawflowConnections(nodeMap);
    const ids = Object.keys(nodeMap || {});
    if (!ids.length) throw new Error(where + " has no nodes.");
    const idSet = {};
    ids.forEach(function (id) {
      idSet[String(id)] = true;
    });
    ids.forEach(function (id) {
      const node = nodeMap[id];
      if (!node || typeof node !== "object") throw new Error(where + " node '" + id + "' is not an object.");
      const name = String(node.name || "").trim();
      if (!name) throw new Error(where + " node '" + id + "' is missing 'name'.");
      const data = node.data && typeof node.data === "object" ? node.data : {};
      const hasDataField = function (k) { return Object.prototype.hasOwnProperty.call(data, k); };
      const requireNonNegativeNumberField = function (k) {
        if (!hasDataField(k)) throw new Error(where + " node '" + id + "' (" + name + ") is missing data." + k);
        const v = Number(data[k]);
        if (!Number.isFinite(v) || v < 0) {
          throw new Error(where + " node '" + id + "' (" + name + ") has invalid data." + k + " (must be finite >= 0)");
        }
      };
      const inputs = node.inputs && typeof node.inputs === "object" ? node.inputs : {};
      const outputs = node.outputs && typeof node.outputs === "object" ? node.outputs : {};

      if (
        name === "latent_layer" ||
        name === "latent_mu_layer" ||
        name === "latent_logvar_layer" ||
        name === "reparam_layer" ||
        name === "output_layer"
      ) {
        requireNonNegativeNumberField("matchWeight");
      }
      if (
        name === "latent_layer" ||
        name === "latent_mu_layer" ||
        name === "latent_logvar_layer" ||
        name === "reparam_layer"
      ) {
        if (!hasDataField("group") || !String(data.group || "").trim()) {
          throw new Error(where + " node '" + id + "' (" + name + ") is missing non-empty data.group");
        }
      }
      if (name === "reparam_layer") {
        requireNonNegativeNumberField("beta");
      }
      if (name === "output_layer") {
        const hasTarget = String(data.target || data.targetType || "").trim().length > 0;
        const hasTargets = Array.isArray(data.targets) && data.targets.length > 0;
        if (!hasTarget && !hasTargets) {
          throw new Error(where + " node '" + id + "' (output_layer) is missing output target(s): data.target/data.targets");
        }
      }

      Object.keys(outputs).forEach(function (outPort) {
        const port = outputs[outPort] || {};
        const cons = Array.isArray(port.connections) ? port.connections : [];
        cons.forEach(function (c, j) {
          const to = String((c && c.node) == null ? "" : c.node).trim();
          const toInput = String((c && c.input) == null ? "" : c.input).trim();
          if (!to || !idSet[to]) {
            throw new Error(where + " node '" + id + "' output '" + outPort + "' has invalid target node at connection #" + (j + 1));
          }
          if (!toInput) {
            throw new Error(where + " node '" + id + "' output '" + outPort + "' has empty target input at connection #" + (j + 1));
          }
          const targetNode = nodeMap[to] || {};
          const targetInputs = targetNode.inputs && typeof targetNode.inputs === "object" ? targetNode.inputs : {};
          if (!(toInput in targetInputs)) {
            throw new Error(where + " node '" + id + "' output '" + outPort + "' points to missing input '" + toInput + "' on node '" + to + "'");
          }
        });
      });

      Object.keys(inputs).forEach(function (inPort) {
        const port = inputs[inPort] || {};
        const cons = Array.isArray(port.connections) ? port.connections : [];
        cons.forEach(function (c, j) {
          const from = String((c && c.node) == null ? "" : c.node).trim();
          const fromOutput = String((c && c.output) == null ? "" : c.output).trim();
          if (!from || !idSet[from]) {
            throw new Error(where + " node '" + id + "' input '" + inPort + "' has invalid source node at connection #" + (j + 1));
          }
          if (!fromOutput) {
            throw new Error(where + " node '" + id + "' input '" + inPort + "' has empty source output at connection #" + (j + 1));
          }
          const sourceNode = nodeMap[from] || {};
          const sourceOutputs = sourceNode.outputs && typeof sourceNode.outputs === "object" ? sourceNode.outputs : {};
          if (!(fromOutput in sourceOutputs)) {
            throw new Error(where + " node '" + id + "' input '" + inPort + "' points to missing output '" + fromOutput + "' on node '" + from + "'");
          }
        });
      });
    });
    return info.drawflowPayload;
  }

  function getCurrentGraphSignature() {
    if (!state.editor || typeof state.editor.export !== "function") return "";
    return graphSignatureFromPayload(state.editor.export());
  }

  function markModelGraphClean() {
    state.modelGraphBaselineSig = getCurrentGraphSignature();
  }

  function isModelGraphDirty() {
    const cur = getCurrentGraphSignature();
    const base = String(state.modelGraphBaselineSig || "");
    if (!base) return Boolean(cur);
    return cur !== base;
  }

  function closeUnsavedModelModal() {
    if (!ui.unsavedModelModalBackdrop) return;
    ui.unsavedModelModalBackdrop.classList.remove("open");
    ui.unsavedModelModalBackdrop.setAttribute("aria-hidden", "true");
    state.unsavedPromptAction = null;
  }

  function openUnsavedModelModal(actionLabel, onSave, onDiscard, onCancel) {
    if (!ui.unsavedModelModalBackdrop) {
      if (typeof onDiscard === "function") onDiscard();
      return;
    }
    if (ui.unsavedModelModalText) {
      ui.unsavedModelModalText.textContent =
        "Current model has unsaved changes. Save before " + String(actionLabel || "continue") + "?";
    }
    state.unsavedPromptAction = {
      onSave: typeof onSave === "function" ? onSave : null,
      onDiscard: typeof onDiscard === "function" ? onDiscard : null,
      onCancel: typeof onCancel === "function" ? onCancel : null,
    };
    ui.unsavedModelModalBackdrop.classList.add("open");
    ui.unsavedModelModalBackdrop.setAttribute("aria-hidden", "false");
    if (ui.unsavedModelSaveBtn) setTimeout(function () { ui.unsavedModelSaveBtn.focus(); }, 0);
  }

  function runWithUnsavedModelGuard(actionLabel, proceed) {
    const run = typeof proceed === "function" ? proceed : function () {};
    if (!isModelGraphDirty()) {
      run();
      return;
    }
    openUnsavedModelModal(
      actionLabel,
      function () {
        try {
          if (isModelLibraryLocked()) {
            setTrainSessionStatus("Cannot save model while training queue is running.");
            return;
          }
          const modelName = String((ui.modelLibraryName && ui.modelLibraryName.value) || "").trim();
          const ctx = getCurrentModelContext();
          saveCurrentModelNamed(modelName, ctx.modelId || "");
          markModelGraphClean();
          setTrainSessionStatus("Saved model before " + String(actionLabel || "continue") + ".");
          closeUnsavedModelModal();
          run();
        } catch (err) {
          setTrainSessionStatus("Save model failed: " + err.message);
        }
      },
      function () {
        closeUnsavedModelModal();
        run();
      },
      function () {
        closeUnsavedModelModal();
      }
    );
  }

  function startNewModelBlank() {
    clearEditor(state.editor);
    refreshNodeSummaries(state.editor);
    setActiveNode(state.editor, "");
    syncInferredPipelineFromGraph();
    if (ui.netPreset) ui.netPreset.value = "custom";
    refreshCurrentPresetLabel();
    state.activeModelId = "";
    state.activeModelName = String((ui.modelLibraryName && ui.modelLibraryName.value) || "").trim();
    markModelGraphClean();
    setStatus("New blank model ready.");
  }

  function closePresetModal() {
    if (!ui.presetModalBackdrop) return;
    ui.presetModalBackdrop.classList.remove("open");
    ui.presetModalBackdrop.setAttribute("aria-hidden", "true");
  }

  function openPresetModal() {
    if (!ui.presetModalBackdrop) return;
    if (ui.presetModalSelect && ui.netPreset) {
      const cur = String(ui.netPreset.value || "custom");
      const opts = Array.from(ui.presetModalSelect.options || []).filter(function (o) { return !o.disabled && !o.hidden; });
      const firstAllowed = opts.length ? String(opts[0].value || "custom") : "custom";
      const has = opts.some(function (o) { return String(o.value) === cur; });
      ui.presetModalSelect.value = has ? cur : firstAllowed;
    }
    ui.presetModalBackdrop.classList.add("open");
    ui.presetModalBackdrop.setAttribute("aria-hidden", "false");
    if (ui.presetModalSelect) setTimeout(function () { ui.presetModalSelect.focus(); }, 0);
  }

  function syncPreviewTimeControls(fromPreview) {
    const resolved = getDatasetModuleUiCapability("syncPreviewTimeControls");
    if (!resolved) return;
    return resolved.uiApi.syncPreviewTimeControls(buildDatasetModuleUiContext(), Boolean(fromPreview));
  }

  function updateModeContractText() {
    const mode = String((ui.predictionMode && ui.predictionMode.value) || "autoregressive");
    const infoText = mode === "direct"
      ? "DIRECT mode trains on condition+time->state rows from the direct dataset. Use flat graph (Dense/Dropout)."
      : "AUTOREGRESSIVE mode trains on history-window->next-state rows from the AR dataset. Use sequence graph (GRU/LSTM) or flat graph.";
    if (ui.predictionModeInfo) ui.predictionModeInfo.textContent = infoText;
    if (!ui.modeContract) return;
    if (mode === "direct") {
      ui.modeContract.textContent =
        "Mode contract: DIRECT (inferred from graph). Generate Dataset builds AR+Direct together; this mode uses Direct rows. " +
        "Graph must be FLAT. Feature blocks must match dataset features. Output units follow Output-node target.";
      return;
    }
    ui.modeContract.textContent =
      "Mode contract: AUTOREGRESSIVE (inferred from graph). Generate Dataset builds AR+Direct together; this mode uses AR rows. " +
      "Use WindowHistX/WindowHistV (or HistX/HistV). Optional ratio features are configured in Params node (k/m, c/m, g/L). Recommended graph: sequence model (GRU/LSTM). Output units follow Output-node target.";
  }

  function updateInferenceMethodInfo() {
    if (!ui.inferenceMethodInfo) return;
    const mode = String((ui.predictionMode && ui.predictionMode.value) || "autoregressive");
    const requested = String((ui.inferenceMethod && ui.inferenceMethod.value) || "auto");
    const arCfg = inferArHistoryConfigFromDrawflow(state.editor, getActiveWindowSize());
    const resolved = resolveInferenceMethod(mode, requested, arCfg);
    const warm = Math.max(0, Number(ui.arWarmupSteps && ui.arWarmupSteps.value) || 0);
    let detail = "";
    if (resolved === "direct_only") {
      detail = "Direct inference: predict every timestep from features (no RK4 history).";
    } else if (resolved === "ar_rk4_warmup") {
      detail = "AR warmup: use RK4 truth for first " + warm + " steps, then NN rollout.";
    } else if (resolved === "ar_zero_pad") {
      detail = "AR no-warmup: history is left-padded with zeros and rolled out by NN.";
    } else {
      detail = "AR edge-pad: history is left-padded with initial state x(0), v(0), then NN rollout.";
    }
    ui.inferenceMethodInfo.textContent =
      "Resolved: " + resolved + " (graph mode=" + mode + "). " + detail;
  }

  function syncInferredPipelineFromGraph() {
    if (!state.editor) return;
    const inferredMode = inferGraphModeFromDrawflow(state.editor, (ui.predictionMode && ui.predictionMode.value) || "autoregressive");
    if (ui.predictionMode) ui.predictionMode.value = inferredMode;
    updateModeContractText();
    updateInferenceMethodInfo();
  }

  function resolveRequestedDatasetMode() {
    const source = String((ui.modelDatasetSource && ui.modelDatasetSource.value) || "auto");
    if (source === "autoregressive" || source === "direct") return source;
    return String((ui.predictionMode && ui.predictionMode.value) || "autoregressive");
  }

  function getDatasetForMode(mode) {
    const m = String(mode || "autoregressive");
    if (state.datasetsByMode && state.datasetsByMode[m]) return state.datasetsByMode[m];
    if (state.dataset && String(state.dataset.mode || "") === m) return state.dataset;
    return null;
  }

  function getActiveDataset() {
    if (state.dataset) {
      const sid = resolveSchemaId(state.dataset.schemaId || "oscillator");
      const mode = String(state.dataset.mode || "").trim().toLowerCase();
      if (sid !== "oscillator" || (mode !== "autoregressive" && mode !== "direct")) {
        return state.dataset;
      }
    }
    const mode = resolveRequestedDatasetMode();
    const ds = getDatasetForMode(mode);
    if (ds) return ds;
    if (state.dataset) return state.dataset;
    return null;
  }

  function getDatasetForCurrentGraphMode() {
    const mode = inferGraphModeFromDrawflow(state.editor, (ui.predictionMode && ui.predictionMode.value) || "autoregressive");
    if (ui.predictionMode) ui.predictionMode.value = mode;
    return getDatasetForMode(mode);
  }

  function syncActiveDatasetFromSelection() {
    const ds = getActiveDataset();
    if (ds) state.dataset = ds;
    return ds;
  }

  function getTrainerControlOptionsFromUI() {
    const optimizerType = normalizeOptimizerType(
      ui.optimizerType ? ui.optimizerType.value : "adam",
      "adam"
    );
    const schedulerRaw = (function () {
      if (!ui.useLrScheduler) return "plateau";
      const type = String(ui.useLrScheduler.type || "").toLowerCase();
      if (type === "checkbox") return ui.useLrScheduler.checked ? "plateau" : "none";
      return String(ui.useLrScheduler.value || "plateau");
    })();
    const lrSchedulerType = normalizeLrSchedulerType(schedulerRaw, "plateau");
    return {
      optimizerType: optimizerType,
      lrSchedulerType: lrSchedulerType,
      useLrScheduler: lrSchedulerType !== "none",
      lrPatience: Math.max(1, Number(ui.lrPatience && ui.lrPatience.value) || 3),
      lrFactor: clamp(Number(ui.lrFactor && ui.lrFactor.value) || 0.5, 0.05, 0.99),
      minLr: Math.max(1e-8, Number(ui.minLr && ui.minLr.value) || 1e-6),
      gradClipNorm: Math.max(0, Number(ui.gradClipNorm && ui.gradClipNorm.value) || 0),
      gradClipValue: Math.max(0, Number(ui.gradClipValue && ui.gradClipValue.value) || 0),
      restoreBestWeights: Boolean(ui.restoreBestWeights ? ui.restoreBestWeights.checked : true),
      earlyStoppingPatience: Math.max(0, Number(ui.earlyStoppingPatience && ui.earlyStoppingPatience.value) || 0),
    };
  }

  function buildRunConfigSignature() {
    const tcfg = getTrainerControlOptionsFromUI();
    return JSON.stringify({
      mode: String((ui.predictionMode && ui.predictionMode.value) || "autoregressive"),
      seed: Number(ui.seed.value),
      numTraj: Number(ui.numTraj.value),
      durationSec: Number(ui.durationSec.value),
      dt: Number(ui.dt.value),
      windowSize: getActiveWindowSize(),
      targetOutput: inferTargetModeFromDrawflow(state && state.editor ? state.editor : null, "x"),
      epochs: Number(ui.epochs.value),
      batchSize: Number(ui.batchSize.value),
      optimizerType: String(tcfg.optimizerType || "adam"),
      learningRate: Number(ui.learningRate.value),
      lrSchedulerType: String(tcfg.lrSchedulerType || "plateau"),
      useLrScheduler: Boolean(tcfg.useLrScheduler),
      lrPatience: Number(tcfg.lrPatience),
      lrFactor: Number(tcfg.lrFactor),
      minLr: Number(tcfg.minLr),
      gradClipNorm: Number(tcfg.gradClipNorm),
      gradClipValue: Number(tcfg.gradClipValue),
      restoreBestWeights: Boolean(tcfg.restoreBestWeights),
      earlyStoppingPatience: Number(tcfg.earlyStoppingPatience),
      scenarios: getDatasetScenarioSelection(ui).join("+"),
      datasetSource: String((ui.modelDatasetSource && ui.modelDatasetSource.value) || "auto"),
      preset: String((ui.netPreset && ui.netPreset.value) || "custom"),
    });
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function resolveDatasetBundleAdapterRuntime() {
    if (typeof window !== "undefined" && window.OSCDatasetBundleAdapter &&
        typeof window.OSCDatasetBundleAdapter.buildDatasetCsvAndManifest === "function") {
      return window.OSCDatasetBundleAdapter;
    }
    if (typeof window !== "undefined" && window.OSCNotebookCore &&
        typeof window.OSCNotebookCore.buildDatasetCsvAndManifest === "function") {
      return window.OSCNotebookCore;
    }
    return null;
  }

  function buildDatasetCsvAndManifest(ds) {
    const adapter = resolveDatasetBundleAdapterRuntime();
    if (!adapter || typeof adapter.buildDatasetCsvAndManifest !== "function") return null;
    return adapter.buildDatasetCsvAndManifest(ds);
  }

  function exportGraphJson() {
    if (!state.editor || typeof state.editor.export !== "function") {
      setStatus("Drawflow editor not ready.");
      return;
    }
    const payload = state.editor.export();
    assertValidDrawflowGraph(payload, "Current editor graph");
    downloadJson("oscillator_drawflow_graph.json", payload);
    setStatus("Graph JSON exported.");
  }

  async function tryAddTemplateFileToZip(zip, zipPath, webPath) {
    try {
      const res = await fetch(webPath, { cache: "no-store" });
      if (!res.ok) return false;
      const text = await res.text();
      zip.file(zipPath, text);
      return true;
    } catch (err) {
      return false;
    }
  }

  function getNotebookRuntimeAssetsRuntime() {
    if (typeof window === "undefined") return null;
    const assets = window.OSCNotebookRuntimeAssets;
    if (!assets || typeof assets !== "object") return null;
    return assets;
  }

  function getNotebookRuntimeAssetText(name) {
    const assets = getNotebookRuntimeAssetsRuntime();
    if (!assets) return null;
    const key = String(name || "").trim();
    if (!key) return null;
    if (typeof assets.get === "function") {
      const text = assets.get(key);
      if (typeof text === "string") return text;
    }
    if (assets.files && typeof assets.files === "object" && typeof assets.files[key] === "string") {
      return String(assets.files[key]);
    }
    return null;
  }

  function buildNotebookRuntimeSourceMap(fileNames) {
    const out = {};
    const list = Array.isArray(fileNames) ? fileNames : [];
    for (let i = 0; i < list.length; i += 1) {
      const key = String(list[i] || "").trim();
      if (!key) continue;
      const text = getNotebookRuntimeAssetText(key);
      if (typeof text === "string") out[key] = text;
    }
    return out;
  }

  async function exportNotebookZipClient(sessionIds) {
    ensureLibraryEntityIds();
    if (!window.OSCNotebookCore || typeof window.OSCNotebookCore.createNotebookBundleZipFromConfig !== "function") {
      throw new Error("Notebook core module is not loaded.");
    }
    const requestedIds = Array.isArray(sessionIds)
      ? sessionIds.map(function (x) { return String(x || "").trim(); }).filter(Boolean)
      : [];
    const selectedSessions = requestedIds.length
      ? state.trainSessions.filter(function (s) { return requestedIds.indexOf(String(s.id || "")) >= 0; })
      : getSelectedTrainSessions();
    if (!selectedSessions.length) {
      throw new Error(requestedIds.length
        ? "Requested training session(s) not found."
        : "No trainer selected.");
    }
    const layout = "per_session";
    const includeRuntimeFiles = true;
    const sessionsPayload = [];
    for (let i = 0; i < selectedSessions.length; i += 1) {
      const s = selectedSessions[i];
      normalizeTrainSessionRecord(s);
      const exportSupport = getNotebookExportSupport(s);
      if (!exportSupport.ok) {
        throw new Error(
          "Session '" + String(s.name || s.id || "") + "' cannot export notebook: " + exportSupport.reason
        );
      }
      const dsEntry = getSavedDatasetById(s.datasetId);
      const modelEntry = getSavedModelById(s.modelId);
      if (!dsEntry || !dsEntry.data) throw new Error("Session dataset not found: " + String(s.datasetId || s.datasetName || ""));
      if (!modelEntry || !modelEntry.graph) throw new Error("Session model not found: " + String(s.modelId || s.modelName || ""));
      const schemaId = inferSessionSchemaId(s, state.modelSchemaId || "oscillator");
      const datasetSchemaId = getSavedDatasetSchemaId(dsEntry, schemaId);
      const modelSchemaId = getSavedModelSchemaId(modelEntry, schemaId);
      if (datasetSchemaId !== schemaId) {
        throw new Error("Session '" + String(s.name || s.id || "") + "' dataset schema mismatch: expected '" + schemaId + "', got '" + datasetSchemaId + "'.");
      }
      if (modelSchemaId !== schemaId) {
        throw new Error("Session '" + String(s.name || s.id || "") + "' model schema mismatch: expected '" + schemaId + "', got '" + modelSchemaId + "'.");
      }
      const graphPayload = assertValidDrawflowGraph(modelEntry.graph, "Saved model graph '" + String(modelEntry.name || s.modelName || "") + "'");
      sessionsPayload.push({
        id: s.id,
        name: s.name,
        schemaId: schemaId,
        runtime: normalizeRuntimeId(s.runtime || "js_client"),
        runtimeFamily: runtimeFamilyFor(s.runtime || "js_client"),
        runtimeBackend: normalizeRuntimeBackend(s.runtime || "js_client", s.runtimeBackend || "auto"),
        runtimeConfig: normalizeRuntimeConfig(s.runtime || "js_client", s.runtimeBackend || "auto"),
        trainCfg: s.trainCfg || {},
        datasetId: String(dsEntry.id || ""),
        datasetName: String(dsEntry.name || s.datasetName || ""),
        datasetSchemaId: datasetSchemaId,
        datasetData: dsEntry.data,
        modelId: String(modelEntry.id || ""),
        modelName: String(modelEntry.name || s.modelName || ""),
        modelSchemaId: modelSchemaId,
        drawflowGraph: graphPayload,
      });
    }

    const outName = selectedSessions.length === 1
      ? ("trainner_" + sanitizeFileStem(String((selectedSessions[0] && selectedSessions[0].name) || "session")) + ".zip")
      : ("trainner_bundle_" + Date.now() + ".zip");
    const runtimeFileNames = ["oscillator_surrogate_pipeline.py"];
    const commonCfg = {
      sessions: sessionsPayload,
      layout: layout,
      includeRuntimeFiles: includeRuntimeFiles,
      includeModelGraph: false,
      datasetBundleAdapter: (typeof window !== "undefined" && window.OSCDatasetBundleAdapter)
        ? window.OSCDatasetBundleAdapter
        : null,
      runtimeFiles: runtimeFileNames,
      runtimeSourceMap: buildNotebookRuntimeSourceMap(runtimeFileNames),
      requireRuntimeFiles: true,
      seed: Number(ui.seed && ui.seed.value),
      runtimeLoader: includeRuntimeFiles
        ? async function (name) {
            const fromAssets = getNotebookRuntimeAssetText(name);
            if (typeof fromAssets === "string") return fromAssets;
            if (typeof location !== "undefined" && String(location.protocol || "").toLowerCase() === "file:") {
              return null;
            }
            try {
              const res = await fetch("./notebooks/" + name, { cache: "no-store" });
              if (!res.ok) return null;
              return await res.text();
            } catch (err) {
              return null;
            }
          }
        : null,
    };

    const result = await window.OSCNotebookCore.createNotebookBundleZipFromConfig(Object.assign({}, commonCfg, {
      zipFileName: outName,
      packageMode: "zip_two_file_runtime",
      outputType: "blob",
      JSZipCtor: window.JSZip,
    }));
    downloadBlob(outName, result.blob);
    const summary = result && result.summary ? result.summary : {};
    setStatus(
      "Notebook bundle ZIP exported: " + outName +
      " | trainers=" + selectedSessions.length +
      " | files=" + String(summary.fileCount || 0) +
      " | mode=" + String(summary.packageMode || "zip_two_file_runtime")
    );
  }

  function normalizeImportedGraphPayload(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid JSON object.");
    }
    if (payload.drawflow && typeof payload.drawflow === "object") {
      return payload;
    }
    if (payload.graph && typeof payload.graph === "object") {
      return payload.graph;
    }
    if (payload.model && payload.model.graph && typeof payload.model.graph === "object") {
      return payload.model.graph;
    }
    return payload;
  }

  function importGraphJsonObject(payload, options) {
    const opts = options || {};
    const drawflowPayload = assertValidDrawflowGraph(
      normalizeImportedGraphPayload(payload),
      "Imported graph JSON"
    );
    clearEditor(state.editor);
    if (typeof state.editor.import === "function") {
      state.editor.import(drawflowPayload);
    } else {
      throw new Error("Drawflow import API unavailable.");
    }
    try {
      const nodeMap = extractDrawflowNodeMap(drawflowPayload) || {};
      Object.keys(nodeMap || {}).forEach(function (id) {
        if (typeof state.editor.updateConnectionNodes === "function") {
          state.editor.updateConnectionNodes("node-" + String(id));
        }
      });
    } catch (_) {}
    refreshNodeSummaries(state.editor);
    setActiveNode(state.editor, "");
    syncInferredPipelineFromGraph();
    if (ui.netPreset) {
      const requestedPreset = String(opts.presetValue || "").trim();
      if (requestedPreset) {
        const hasPreset = Array.from(ui.netPreset.options || []).some(function (op) {
          return String(op.value || "") === requestedPreset;
        });
        ui.netPreset.value = hasPreset ? requestedPreset : "custom";
      } else if (opts.resetPreset === true) {
        ui.netPreset.value = "custom";
      }
    }
    refreshCurrentPresetLabel();
    if (ui.drawflow) {
      runAfterFirstPaint(function () {
        scheduleFitGraphToViewport(state.editor, ui.drawflow);
        runAfterFirstPaint(function () {
          scheduleFitGraphToViewport(state.editor, ui.drawflow);
        });
      });
    }
    markModelGraphClean();
    setStatus("Graph JSON imported.");
  }

  function getPreviewParamsForScenario(scenario) {
    const resolved = getDatasetModuleUiCapability("getPreviewParamsForScenario");
    if (!resolved) {
      throw new Error("Active dataset module does not provide preview parameter handling.");
    }
    return resolved.uiApi.getPreviewParamsForScenario(buildDatasetModuleCapabilityContext(), scenario);
  }

  function getEvalCondition(scenarioOverride) {
    const resolved = getDatasetModuleUiCapability("getEvalCondition");
    if (!resolved) {
      throw new Error("Active dataset module does not provide evaluation condition handling.");
    }
    return resolved.uiApi.getEvalCondition(buildDatasetModuleCapabilityContext(), scenarioOverride);
  }

  function updateQuickCompareInfo() {
    if (!ui.quickCompareInfo) return;
    const resolved = getDatasetModuleUiCapability("buildPlaygroundActionContext", "preview");
    const moduleObj = resolved ? resolved.module : getCurrentPlaygroundModule();
    const playgroundApi = moduleObj && moduleObj.playgroundApi;
    if (playgroundApi && typeof playgroundApi.buildQuickCompareInfoText === "function") {
      try {
        const infoCtx = resolved
          ? (resolved.uiApi.buildPlaygroundActionContext(buildDatasetModuleCapabilityContext(), "quick_compare") || {})
          : {};
        ui.quickCompareInfo.textContent = String(playgroundApi.buildQuickCompareInfoText(infoCtx) || "");
        return;
      } catch (_err) {}
    }
    ui.quickCompareInfo.textContent = "";
  }

  function buildPlaygroundActionContext(actionId) {
    const baseCtx = buildDatasetModuleCapabilityContext({
      actionId: String(actionId || "").trim().toLowerCase(),
    });
    const resolved = getDatasetModuleUiCapability("buildPlaygroundActionContext", "preview");
    if (resolved) {
      return resolved.uiApi.buildPlaygroundActionContext(baseCtx, baseCtx.actionId) || baseCtx;
    }
    return baseCtx;
  }

  function dispatchPlaygroundAction(actionId) {
    const moduleObj = getCurrentPlaygroundModule();
    const playgroundApi = moduleObj && moduleObj.playgroundApi;
    if (!playgroundApi || typeof playgroundApi.runAction !== "function") {
      throw new Error("Playground module does not support action '" + String(actionId || "") + "'.");
    }
    return playgroundApi.runAction(actionId, buildPlaygroundActionContext(actionId));
  }

  function updateDatasetCompareModeUI() {
    if (!ui.datasetCompareMode || !ui.selectedTrajCsv) return;
    const isSelect = String(ui.datasetCompareMode.value || "random") === "select";
    ui.selectedTrajCsv.disabled = !isSelect;
    ui.selectedTrajCsv.style.opacity = isSelect ? "1" : "0.6";
    if (!isSelect) {
      ui.selectedTrajCsv.title = "Used only when Dataset Compare Mode = Select 3";
    } else {
      ui.selectedTrajCsv.title = "";
    }
  }

  function updateEomPanel() {
    const primary = String((ui.scenarioType && ui.scenarioType.value) || "spring");
    const gm = String((ui.bbGroundModel && ui.bbGroundModel.value) || "rigid");
    const bounceEq = gm === "compliant" ? EQUATIONS_HTML.bouncingCompliant : EQUATIONS_HTML.bouncingRigid;
    if (ui.eomMainOverlay) {
      ui.eomMainOverlay.innerHTML =
        primary === "spring" ? EQUATIONS_HTML.spring :
        primary === "pendulum" ? EQUATIONS_HTML.pendulum :
        bounceEq;
    }
    if (ui.eomSpringOverlay) ui.eomSpringOverlay.innerHTML = EQUATIONS_HTML.spring;
    if (ui.eomPendulumOverlay) ui.eomPendulumOverlay.innerHTML = EQUATIONS_HTML.pendulum;
    if (ui.eomBouncingOverlay) ui.eomBouncingOverlay.innerHTML = bounceEq;
  }

  function resetScenarioCardDefaults(scen) {
    const resolved = getDatasetModuleUiCapability("resetScenarioCardDefaults");
    if (!resolved) return;
    return resolved.uiApi.resetScenarioCardDefaults(buildDatasetModuleCapabilityContext(), scen);
  }

  function randomizePreviewCards() {
    const resolved = getDatasetModuleUiCapability("randomizePreviewCards");
    if (!resolved) return;
    return resolved.uiApi.randomizePreviewCards(buildDatasetModuleCapabilityContext());
  }

  function applyScenarioCardDefaultsOnLoad() {
    const ctx = buildDatasetModuleCapabilityContext({
      setStatus: function () {},
      schedulePreviewRefresh: function () {},
    });
    const actionResolved = getDatasetModuleUiCapability("handlePlaygroundAction");
    if (actionResolved) {
      try {
        actionResolved.uiApi.handlePlaygroundAction({ actionId: "preview_time_reset" }, ctx);
      } catch (_err) {}
    }
    const resetResolved = getDatasetModuleUiCapability("resetScenarioCardDefaults");
    if (!resetResolved) return;
    ["spring", "pendulum", "bouncing"].forEach(function (scenarioId) {
      try {
        resetResolved.uiApi.resetScenarioCardDefaults(ctx, scenarioId);
      } catch (_err) {}
    });
  }

  function schedulePreviewRefresh() {
    if (state.previewCompareLock) return;
    if (state.previewRefreshTimer) clearTimeout(state.previewRefreshTimer);
    state.previewRefreshTimer = setTimeout(function () {
      state.previewRefreshTimer = null;
      try {
        runPreview();
      } catch (err) {}
    }, 80);
  }

  function cancelPreviewRefresh() {
    if (state.previewRefreshTimer) {
      clearTimeout(state.previewRefreshTimer);
      state.previewRefreshTimer = null;
    }
  }

  function runPreview() {
    if (String(state.currentWorkspace || "") !== "preview") return;
    const schemaId = currentPlaygroundSchemaId();
    if (!schemaId) return;
    const moduleId = pickDefaultDatasetModuleForSchema(schemaId);
    if (getPlaygroundMode(moduleId) !== "trajectory_simulation") return;
    dispatchPlaygroundAction("preview");
  }

  function resizePlotIfVisible(el) {
    if (!el || !window.Plotly || !Plotly.Plots) return;
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    const hidden = style && (style.display === "none" || style.visibility === "hidden");
    if (hidden) return;
    if (el.offsetParent === null && (!el.getClientRects || el.getClientRects().length === 0)) return;
    Plotly.Plots.resize(el);
  }

  function showDataLabSubTab(name) {
    const next = String(name || "preview") === "builder" ? "builder" : "preview";
    state.dataLabSubTab = next;
    const isPreview = next === "preview";
    if (ui.dataLabPreviewTab) ui.dataLabPreviewTab.classList.toggle("active", isPreview);
    if (ui.dataLabBuilderTab) ui.dataLabBuilderTab.classList.toggle("active", !isPreview);
    if (ui.dataLabPreviewPane) ui.dataLabPreviewPane.style.display = isPreview ? "" : "none";
    if (ui.dataLabBuilderPane) ui.dataLabBuilderPane.style.display = isPreview ? "none" : "";
    if (state.currentWorkspace === "dataset") {
      setTimeout(function () {
        if (isPreview && ui.datasetChart) resizePlotIfVisible(ui.datasetChart);
        if (!isPreview && state.dataset) renderDataTable(state.dataset);
      }, 0);
    }
    refreshDatasetDetailPanel();
  }

  function showWorkspaceTab(name) {
    const target = String(name || "preview");
    state.currentWorkspace = target;
    getTabManagerRuntime().showTab(target);
  }

  function getPlaygroundMode(moduleId) {
    const mid = String(moduleId || currentDatasetModuleId() || "").trim().toLowerCase();
    if (!mid) return "";
    const mod = getDatasetModule(mid);
    return String((mod && mod.playground && mod.playground.mode) || "").trim().toLowerCase();
  }

  function renderPlaygroundConfigPanel(moduleId) {
    if (!ui.rightDataLabConfigMount) return null;
    const mod = getDatasetModule(moduleId);
    const uiApi = mod && mod.uiApi;
    if (!uiApi || typeof uiApi.getPlaygroundConfigSpec !== "function") {
      if (state.rightInspectorForms && state.rightInspectorForms.playground &&
          typeof state.rightInspectorForms.playground.destroy === "function") {
        state.rightInspectorForms.playground.destroy();
      }
      state.rightInspectorForms.playground = null;
      ui.rightDataLabConfigMount.innerHTML =
        "<div class='panel'>" +
          "<div class='hint'>No interactive config for this playground module.</div>" +
        "</div>";
      return null;
    }
    const ctx = buildDatasetModuleUiContext();
    const spec = uiApi.getPlaygroundConfigSpec(ctx) || {};
    state.rightInspectorForms.playground = renderSharedConfigForm({
      mountEl: ui.rightDataLabConfigMount,
      sections: Array.isArray(spec.sections) ? spec.sections : [],
      actions: Array.isArray(spec.actions) ? spec.actions : [],
      fieldNamePrefix: "playgroundCfg",
      onChange: function (nextConfig, payload) {
        if (typeof uiApi.handlePlaygroundConfigChange === "function") {
          uiApi.handlePlaygroundConfigChange(nextConfig, payload, ctx);
        }
      },
      onAction: function (payload) {
        if (typeof uiApi.handlePlaygroundAction === "function") {
          uiApi.handlePlaygroundAction(payload, ctx);
        }
      },
    });
    return state.rightInspectorForms.playground;
  }

  function renderDatasetConfigPanel(moduleId) {
    if (!ui.rightDataLabConfigMount) return null;
    const mod = getDatasetModule(moduleId);
    const uiApi = mod && mod.uiApi;
    if (state.rightInspectorForms && state.rightInspectorForms.dataset &&
        typeof state.rightInspectorForms.dataset.destroy === "function") {
      state.rightInspectorForms.dataset.destroy();
    }
    state.rightInspectorForms.dataset = null;
    if (!uiApi || typeof uiApi.getDatasetConfigSpec !== "function") {
      ui.rightDataLabConfigMount.innerHTML =
        "<div class='panel'>" +
          "<div class='hint'>No dataset config is declared for this module.</div>" +
        "</div>";
      return null;
    }
    const ctx = buildDatasetModuleUiContext();
    const spec = uiApi.getDatasetConfigSpec(ctx) || {};
    state.rightInspectorForms.dataset = renderSharedConfigForm({
      mountEl: ui.rightDataLabConfigMount,
      sections: Array.isArray(spec.sections) ? spec.sections : [],
      actions: Array.isArray(spec.actions) ? spec.actions : [],
      fieldNamePrefix: "datasetCfg",
      onChange: function (nextConfig, payload) {
        if (typeof uiApi.handleDatasetConfigChange === "function") {
          uiApi.handleDatasetConfigChange(nextConfig, payload, ctx);
        }
      },
      onAction: function (payload) {
        if (typeof uiApi.handleDatasetAction === "function") {
          uiApi.handleDatasetAction(payload, ctx);
        }
      },
    });
    return state.rightInspectorForms.dataset;
  }

  function refreshPlaygroundWorkspaceUi() {
    if (String(state.currentWorkspace || "") !== "preview") return;
    const schemaId = currentPlaygroundSchemaId();
    if (!schemaId) {
      if (state.rightInspectorForms && state.rightInspectorForms.playground &&
          typeof state.rightInspectorForms.playground.destroy === "function") {
        state.rightInspectorForms.playground.destroy();
      }
      state.rightInspectorForms.playground = null;
      applyDatasetModuleWorkspaceUi("preview", "");
      if (ui.playgroundUnsupportedHint) ui.playgroundUnsupportedHint.style.display = "none";
      if (ui.previewMainChartWrap) ui.previewMainChartWrap.style.display = "none";
      if (ui.previewSplitCharts) ui.previewSplitCharts.style.display = "none";
      if (ui.previewModulePanelMount) {
        ui.previewModulePanelMount.style.display = "";
        ui.previewModulePanelMount.innerHTML =
          "<div class='panel'>" +
            "<div class='compare-title'>Playground</div>" +
            "<div class='hint'>Select a schema from the left panel.</div>" +
          "</div>";
      }
      if (ui.rightDataLabConfigMount) {
        ui.rightDataLabConfigMount.style.display = "";
        ui.rightDataLabConfigMount.innerHTML =
          "<div class='panel'>" +
            "<div class='hint'>Select a schema from the left panel.</div>" +
          "</div>";
      }
      if (ui.rightDataLabPanelTitle) ui.rightDataLabPanelTitle.textContent = "Playground Inspector";
      if (ui.rightDataLabConfigTitle) ui.rightDataLabConfigTitle.textContent = "Playground Config";
      if (ui.rightDataLabInfo) ui.rightDataLabInfo.textContent = "No playground schema selected.";
      return;
    }
    const moduleId = pickDefaultDatasetModuleForSchema(schemaId);
    const playgroundMode = getPlaygroundMode(moduleId);
    const isTrajectoryPreview = playgroundMode === "trajectory_simulation";
    applyDatasetModuleWorkspaceUi("preview", moduleId);
    if (ui.playgroundUnsupportedHint) ui.playgroundUnsupportedHint.style.display = "none";
    if (ui.previewMainChartWrap) ui.previewMainChartWrap.style.display = isTrajectoryPreview ? "" : "none";
    if (ui.previewSplitCharts && !isTrajectoryPreview) ui.previewSplitCharts.style.display = "none";
    if (ui.rightDataLabConfigMount) ui.rightDataLabConfigMount.style.display = "";
    renderPlaygroundConfigPanel(moduleId);
    if (ui.previewModulePanelMount) {
      ui.previewModulePanelMount.style.display = isTrajectoryPreview ? "none" : "";
      if (!isTrajectoryPreview) {
        renderPlaygroundDatasetPreview(schemaId, moduleId);
      }
    }
    if (ui.rightDataLabPanelTitle) ui.rightDataLabPanelTitle.textContent = "Playground Inspector";
    if (ui.rightDataLabConfigTitle) {
      const mod = getDatasetModule(moduleId);
      const label = String((mod && mod.label) || moduleId || schemaId);
      ui.rightDataLabConfigTitle.textContent = "Playground Config (" + label + " / " + schemaId + ")";
    }
    if (ui.rightDataLabInfo) {
      ui.rightDataLabInfo.textContent =
        "schema=" + schemaId +
        " | module=" + String((getDatasetModule(moduleId) && getDatasetModule(moduleId).label) || moduleId) +
        " | interactive=" + (state.rightInspectorForms && state.rightInspectorForms.playground ? "yes" : "no");
    }
    if (isTrajectoryPreview && !state.previewCompareLock) {
      runAfterFirstPaint(function () {
        try {
          runPreview();
        } catch (_err) {}
      });
    }
  }

  function renderPlaygroundPreviewModel(model) {
    if (!ui.previewModulePanelMount) return;
    const imageRuntime = getImageRenderRuntime();
    const payload = model && typeof model === "object" ? model : {};
    const kind = String(payload.kind || "hint").trim().toLowerCase();
    const title = escapeHtml(String(payload.title || "Playground Preview"));
    const summary = Array.isArray(payload.summaryLines) ? payload.summaryLines : [];
    const summaryHtml = summary.length
      ? "<div class='hint'>" + summary.map(function (line) { return escapeHtml(String(line || "")); }).join("<br>") + "</div>"
      : "";
    if (kind !== "image_class_grid") {
      ui.previewModulePanelMount.innerHTML =
        "<div class='panel'>" +
          "<div class='compare-title'>" + title + "</div>" +
          summaryHtml +
        "</div>";
      return;
    }
    const samples = Array.isArray(payload.samples) ? payload.samples : [];
    const cards = samples.map(function (sample, idx) {
      const canvasId = "playground_preview_canvas_" + idx;
      const label = escapeHtml(String(sample && sample.label || "sample"));
      const meta = Array.isArray(sample && sample.meta) ? sample.meta : [];
      const metaHtml = meta.length ? "<div class='hint'>" + meta.map(function (line) { return escapeHtml(String(line || "")); }).join("<br>") + "</div>" : "";
      return (
        "<div class='panel' style='padding:8px;'>" +
          "<div class='hint'>" + label + "</div>" +
          "<canvas id='" + canvasId + "' width='28' height='28' style='width:84px; height:84px; image-rendering:pixelated; border:1px solid #334155; border-radius:6px; background:#020617;'></canvas>" +
          metaHtml +
        "</div>"
      );
    });
    ui.previewModulePanelMount.innerHTML =
      "<div class='panel'>" +
        "<div class='compare-title'>" + title + "</div>" +
        summaryHtml +
        "<div style='display:grid; grid-template-columns: repeat(auto-fill,minmax(120px,1fr)); gap:8px; margin-top:8px;'>" +
          cards.join("") +
        "</div>" +
      "</div>";
    samples.forEach(function (sample, idx) {
      const canvasEl = document.getElementById("playground_preview_canvas_" + idx);
      if (imageRuntime) {
        imageRuntime.drawGrayscaleCanvas(canvasEl, sample && sample.pixels, {
          shape: sample && sample.shape ? sample.shape : [28, 28, 1],
        });
      }
    });
  }

  function renderPlaygroundDatasetPreview(schemaId, moduleId) {
    if (!ui.previewModulePanelMount) return;
    const mod = getDatasetModule(moduleId);
    const uiApi = mod && mod.uiApi;
    if (!uiApi || typeof uiApi.getPlaygroundPreviewModel !== "function") {
      renderPlaygroundPreviewModel({
        kind: "hint",
        title: "Playground Preview",
        summaryLines: [
          "schema: " + resolveSchemaId(schemaId || "oscillator"),
          "module: " + String((mod && mod.label) || moduleId || schemaId || ""),
          "No preview model is declared for this module."
        ]
      });
      return;
    }
    const renderSeq = ++state.playgroundPreviewRenderSeq;
    const ctx = buildDatasetModuleUiContext();
    const result = uiApi.getPlaygroundPreviewModel(ctx);
    if (result && typeof result.then === "function") {
      renderPlaygroundPreviewModel({
        kind: "hint",
        title: "Playground Preview",
        summaryLines: [
          "schema: " + resolveSchemaId(schemaId || "oscillator"),
          "Loading source preview..."
        ]
      });
      result.then(function (model) {
        if (renderSeq !== state.playgroundPreviewRenderSeq) return;
        if (String(state.currentWorkspace || "") !== "preview") return;
        if (currentPlaygroundSchemaId() !== resolveSchemaId(schemaId || "oscillator")) return;
        renderPlaygroundPreviewModel(model);
      }).catch(function (err) {
        if (renderSeq !== state.playgroundPreviewRenderSeq) return;
        renderPlaygroundPreviewModel({
          kind: "hint",
          title: "Playground Preview",
          summaryLines: [
            "schema: " + resolveSchemaId(schemaId || "oscillator"),
            "Preview load failed: " + String(err && err.message ? err.message : err)
          ]
        });
      });
      return;
    }
    renderPlaygroundPreviewModel(result);
  }

  function initSidebarSections() {
    if (!ui.sidebar) return;
    const children = Array.from(ui.sidebar.children || []);
    const sections = {};
    let current = "_top";
    sections[current] = [];
    children.forEach(function (el) {
      const tag = String(el.tagName || "").toUpperCase();
      if (tag === "H2") {
        current = String(el.textContent || "").trim() || "_top";
        if (!sections[current]) sections[current] = [];
      }
      sections[current].push(el);
    });
    state.sidebarSections = sections;
  }

  function showSidebarSection(name, visible) {
    if (!state.sidebarSections || !state.sidebarSections[name]) return;
    state.sidebarSections[name].forEach(function (el) {
      el.style.display = visible ? "" : "none";
    });
  }

  function initDrawflowResizer() {
    if (!ui.drawflow || !ui.drawflowResizer) return;
    const key = "osc_drawflow_height";
    const minH = 260;
    const maxH = 900;
    const applyHeight = function (h) {
      const hh = clamp(Number(h) || 360, minH, maxH);
      ui.drawflow.style.height = String(Math.round(hh)) + "px";
      try { localStorage.setItem(key, String(Math.round(hh))); } catch (err) {}
      scheduleFitGraphToViewport(state.editor, ui.drawflow);
    };
    try {
      const saved = Number(localStorage.getItem(key));
      if (Number.isFinite(saved) && saved >= minH && saved <= maxH) {
        ui.drawflow.style.height = String(Math.round(saved)) + "px";
      }
    } catch (err) {}

    let dragging = false;
    let startY = 0;
    let startH = 0;
    const onMove = function (ev) {
      if (!dragging) return;
      const y = Number(ev.clientY || 0);
      const next = startH + (y - startY);
      ui.drawflow.style.height = String(Math.round(clamp(next, minH, maxH))) + "px";
      scheduleFitGraphToViewport(state.editor, ui.drawflow);
    };
    const onUp = function () {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = "";
      const finalH = Number(ui.drawflow.clientHeight || 360);
      applyHeight(finalH);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    ui.drawflowResizer.addEventListener("mousedown", function (ev) {
      dragging = true;
      startY = Number(ev.clientY || 0);
      startH = Number(ui.drawflow.clientHeight || 360);
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      ev.preventDefault();
    });
  }

  function relocateDatasetConfigForWorkspace(tabName) {
    if (!ui.datasetConfigBlock) return;
    ui.datasetConfigBlock.style.display = "none";
  }

  function relocateTrainingConfigForWorkspace(tabName) {
    if (!ui.trainingConfigBlock || !ui.trainingConfigHome) return;
    // Keep legacy global training block in its home area; per-session config is rendered in right panel.
    if (ui.trainingConfigBlock.parentElement !== ui.trainingConfigHome) {
      ui.trainingConfigHome.appendChild(ui.trainingConfigBlock);
    }
  }

  function updateSidebarForWorkspace(tabName) {
    const tab = String(tabName || "preview");
    if (!ui.sidebar || !ui.layoutRoot || !state.sidebarSections) return;
    relocateDatasetConfigForWorkspace(tab);
    relocateTrainingConfigForWorkspace(tab);
    const dsModuleId = currentDatasetModuleId();
    const dsModule = getDatasetModule(dsModuleId);
    const dsSchemaId = resolveSchemaId((dsModule && dsModule.schemaId) || "oscillator");
    const dsUiProfile = getUiProfileForSchema(dsSchemaId);
    const datasetUsesOscillatorSidebar = String((dsUiProfile && dsUiProfile.sidebarMode) || "generic") === "oscillator";
    Object.keys(state.sidebarSections).forEach(function (k) { showSidebarSection(k, false); });
    if (tab === "preview") {
      ui.sidebar.style.display = "";
      if (ui.rightRail) ui.rightRail.style.display = "";
      ui.layoutRoot.style.gridTemplateColumns = "320px minmax(0,1fr) 340px";
      showSidebarSection("_top", true);
      showSidebarSection("Library", true);
      showSidebarSection("Scenario", false);
      showSidebarSection("Preview", false);
      showSidebarSection("Dataset", false);
      showSidebarSection("Node Config", false);
      showSidebarSection("Training", false);
      applyDatasetModuleWorkspaceUi("preview", currentDatasetModuleId());
      if (ui.primaryScenarioRow) ui.primaryScenarioRow.style.display = "none";
      refreshPlaygroundWorkspaceUi();
      return;
    }
    if (tab === "dataset") {
      ui.sidebar.style.display = "";
      if (ui.rightRail) ui.rightRail.style.display = "";
      ui.layoutRoot.style.gridTemplateColumns = "320px minmax(0,1fr) 340px";
      showSidebarSection("_top", true);
      showSidebarSection("Library", true);
      showSidebarSection("Scenario", false);
      showSidebarSection("Preview", false);
      showSidebarSection("Dataset", false);
      showSidebarSection("Node Config", false);
      showSidebarSection("Training", false);
      if (ui.datasetSidebarOscillatorOnly) ui.datasetSidebarOscillatorOnly.style.display = datasetUsesOscillatorSidebar ? "" : "none";
      if (ui.datasetSidebarImageOnly) ui.datasetSidebarImageOnly.style.display = datasetUsesOscillatorSidebar ? "none" : "";
      applyDatasetModuleWorkspaceUi("dataset", currentDatasetModuleId());
      if (ui.primaryScenarioRow) ui.primaryScenarioRow.style.display = "none";
      return;
    }
    if (tab === "nn") {
      ui.sidebar.style.display = "";
      if (ui.rightRail) ui.rightRail.style.display = "";
      ui.layoutRoot.style.gridTemplateColumns = "320px minmax(0,1fr) 340px";
      showSidebarSection("_top", true);
      showSidebarSection("Library", true);
      showSidebarSection("Scenario", false);
      showSidebarSection("Preview", false);
      showSidebarSection("Dataset", false);
      showSidebarSection("Node Config", true);
      showSidebarSection("Training", false);
      applyDatasetModuleWorkspaceUi("nn", currentDatasetModuleId());
      if (ui.primaryScenarioRow) ui.primaryScenarioRow.style.display = "none";
      return;
    }
    if (tab === "train") {
      ui.sidebar.style.display = "";
      if (ui.rightRail) ui.rightRail.style.display = "";
      ui.layoutRoot.style.gridTemplateColumns = "320px minmax(0,1fr) 340px";
      showSidebarSection("_top", true);
      showSidebarSection("Library", true);
      showSidebarSection("Scenario", false);
      showSidebarSection("Preview", false);
      showSidebarSection("Dataset", false);
      showSidebarSection("Node Config", false);
      showSidebarSection("Training", false);
      applyDatasetModuleWorkspaceUi("train", currentDatasetModuleId());
      if (ui.primaryScenarioRow) ui.primaryScenarioRow.style.display = "none";
      return;
    }
    if (tab === "gen") {
      applyDatasetModuleWorkspaceUi("gen", currentDatasetModuleId());
      if (ui.primaryScenarioRow) ui.primaryScenarioRow.style.display = "none";
      ui.sidebar.style.display = "none";
      if (ui.rightRail) ui.rightRail.style.display = "none";
      ui.layoutRoot.style.gridTemplateColumns = "1fr";
      return;
    }
    applyDatasetModuleWorkspaceUi(tab, currentDatasetModuleId());
    if (ui.primaryScenarioRow) ui.primaryScenarioRow.style.display = "none";
    ui.sidebar.style.display = "none";
    if (ui.rightRail) ui.rightRail.style.display = "none";
    ui.layoutRoot.style.gridTemplateColumns = "1fr";
  }

  function getSelectedEvalScenario() {
    return String((ui.evalScenarioType && ui.evalScenarioType.value) || ui.scenarioType.value || "spring");
  }

  function pickDatasetTrajectories(pool, mode, count, csv) {
    const n = pool.length;
    const k = Math.min(Math.max(1, count), n);
    const picks = [];
    if (mode === "first") {
      for (let i = 0; i < k; i += 1) picks.push(pool[i]);
      return picks;
    }
    if (mode === "uniform") {
      if (k === 1) return [pool[0]];
      for (let i = 0; i < k; i += 1) {
        const idx = Math.round((i * (n - 1)) / (k - 1));
        picks.push(pool[idx]);
      }
      return picks;
    }
    if (mode === "select") {
      const indices = String(csv || "")
        .split(",")
        .map(function (s) { return Number(s.trim()); })
        .filter(function (v) { return Number.isInteger(v) && v >= 0 && v < n; });
      const uniq = [];
      const seen = {};
      for (let i = 0; i < indices.length && uniq.length < k; i += 1) {
        const idx = indices[i];
        if (!seen[idx]) {
          seen[idx] = true;
          uniq.push(pool[idx]);
        }
      }
      if (uniq.length) return uniq;
      for (let i = 0; i < k; i += 1) picks.push(pool[i]);
      return picks;
    }
    const used = {};
    while (picks.length < k) {
      const idx = Math.floor(Math.random() * n);
      if (!used[idx]) {
        used[idx] = true;
        picks.push(pool[idx]);
      }
    }
    return picks;
  }

  function pickBenchmarkTrajectoryIndices(dataset, maxCount) {
    const nTotal = dataset.trajectories.length;
    const idxStart = Math.floor(0.85 * nTotal);
    const testIdx = [];
    for (let i = idxStart; i < nTotal; i += 1) testIdx.push(i);
    if (!testIdx.length) return [];

    const groups = {};
    for (let i = 0; i < testIdx.length; i += 1) {
      const idx = testIdx[i];
      const tr = dataset.trajectories[idx];
      const s = String((tr && tr.params && tr.params.scenario) || dataset.scenarioType || "unknown");
      if (!groups[s]) groups[s] = [];
      groups[s].push(idx);
    }

    const scenarioKeys = Object.keys(groups);
    if (scenarioKeys.length <= 1) return testIdx.slice(0, Math.min(maxCount, testIdx.length));

    const perScenario = Math.max(1, Math.floor(maxCount / scenarioKeys.length));
    const picks = [];
    scenarioKeys.forEach(function (s) {
      const arr = groups[s];
      for (let i = 0; i < arr.length && i < perScenario; i += 1) picks.push(arr[i]);
    });

    // Fill remaining slots round-robin from each scenario group.
    const used = {};
    for (let i = 0; i < picks.length; i += 1) used[picks[i]] = true;
    let cursor = 0;
    while (picks.length < Math.min(maxCount, testIdx.length)) {
      const s = scenarioKeys[cursor % scenarioKeys.length];
      const arr = groups[s];
      let added = false;
      for (let i = 0; i < arr.length; i += 1) {
        const idx = arr[i];
        if (!used[idx]) {
          used[idx] = true;
          picks.push(idx);
          added = true;
          break;
        }
      }
      if (!added) {
        const done = scenarioKeys.every(function (k) {
          return groups[k].every(function (idx) { return used[idx]; });
        });
        if (done) break;
      }
      cursor += 1;
    }
    return picks;
  }

  function matchesScenarioFilter(tr, scenarioFilter, fallbackScenario) {
    const sf = String(scenarioFilter || "all");
    if (sf === "all") return true;
    const scen = String((tr && tr.params && tr.params.scenario) || fallbackScenario || "unknown");
    return scen === sf;
  }

  function setGenericDatasetTableHeader(columns) {
    if (!ui.datasetGenericTableHeadRow) return;
    const cols = Array.isArray(columns) && columns.length ? columns : ["Field", "Value"];
    ui.datasetGenericTableHeadRow.innerHTML = cols.map(function (c) {
      return "<th>" + escapeHtml(String(c || "")) + "</th>";
    }).join("");
  }

  function summarizeVectorForTable(values) {
    const arr = Array.isArray(values) ? values : [];
    if (!arr.length) return "";
    const take = Math.min(8, arr.length);
    const head = [];
    for (let i = 0; i < take; i += 1) {
      const v = Number(arr[i]);
      head.push(Number.isFinite(v) ? v.toFixed(3) : String(arr[i]));
    }
    return "[" + head.join(", ") + (arr.length > take ? ", ..." : "") + "] (n=" + arr.length + ")";
  }

  function buildNonTrajectoryDisplayRows(ds, displayCols, maxRows) {
    const rec = (ds && ds.records && typeof ds.records === "object") ? ds.records : {};
    const splitNames = Object.keys(rec);
    if (!splitNames.length || !displayCols.length) return [];
    const rows = [];
    const classNames = Array.isArray(ds && ds.classNames) ? ds.classNames : [];
    for (let s = 0; s < splitNames.length && rows.length < maxRows; s += 1) {
      const split = splitNames[s];
      const splitRec = rec[split] || {};
      const xs = Array.isArray(splitRec.x) ? splitRec.x : [];
      const ys = Array.isArray(splitRec.y) ? splitRec.y : [];
      const n = ys.length ? Math.min(xs.length, ys.length) : xs.length;
      for (let i = 0; i < n && rows.length < maxRows; i += 1) {
        const y = ys.length ? ys[i] : "";
        const yNum = Number(y);
        const row = {
          split: split,
          index: i,
          label: Number.isFinite(yNum) ? String(Math.round(yNum)) : String(y == null ? "" : y),
          class_name: Number.isFinite(yNum) && classNames[Math.round(yNum)] != null ? String(classNames[Math.round(yNum)]) : "",
          pixel_values: summarizeVectorForTable(xs[i]),
          x: summarizeVectorForTable(xs[i]),
          y: ys.length ? String(y == null ? "" : y) : "",
        };
        rows.push(row);
      }
    }
    return rows;
  }

  function renderNonTrajectoryDatasetTable(ds) {
    const schemaId = resolveSchemaId((ds && ds.schemaId) || "oscillator");
    const displayCols = getSchemaDisplayColumns(schemaId);
    const splitDefs = getSchemaSplitModeDefs(schemaId);
    const split = (ds && ds.splitCounts && typeof ds.splitCounts === "object")
      ? ds.splitCounts
      : {};
    const hist = (ds && ds.labelsHistogram && typeof ds.labelsHistogram === "object")
      ? ds.labelsHistogram
      : {};
    const rowLimitRaw = String((ui.dataRows && ui.dataRows.value) || "100");
    const rowLimit = rowLimitRaw === "all" ? 500 : Math.min(500, Math.max(10, Number(rowLimitRaw) || 100));
    const rows = buildNonTrajectoryDisplayRows(ds, displayCols, rowLimit);
    if (Boolean(ds && ds.draft)) {
      setGenericDatasetTableHeader(["Field", "Value"]);
      if (ui.datasetGenericTableBody) {
        ui.datasetGenericTableBody.innerHTML = "<tr><td>note</td><td>Draft dataset. Build data from the right panel config first.</td></tr>";
      }
      if (ui.dataTableBody) ui.dataTableBody.innerHTML = "";
      return;
    }
    if (rows.length && displayCols.length) {
      setGenericDatasetTableHeader(displayCols);
      if (ui.datasetGenericTableBody) {
        ui.datasetGenericTableBody.innerHTML = rows.map(function (r) {
          return "<tr>" + displayCols.map(function (c) {
            const v = r[c];
            return "<td>" + escapeHtml(String(v == null ? "" : v)) + "</td>";
          }).join("") + "</tr>";
        }).join("");
      }
      if (ui.dataTableBody) ui.dataTableBody.innerHTML = "";
      return;
    }

    setGenericDatasetTableHeader(["Field", "Value"]);
    let html = "";
    const addRow = function (k, v) {
      html += "<tr><td>" + escapeHtml(String(k || "")) + "</td><td>" + escapeHtml(String(v || "")) + "</td></tr>";
    };
    addRow("schema", schemaId);
    addRow("mode", String((ds && ds.mode) || "unknown"));
    addRow(
      "split train/val/test",
      String(Number(split.train || 0)) + "/" + String(Number(split.val || 0)) + "/" + String(Number(split.test || 0))
    );
    addRow("split mode", String((ds && ds.splitConfig && ds.splitConfig.mode) || "unknown"));
    if (splitDefs.length) {
      const splitTxt = splitDefs.map(function (d) {
        return d.stratifyKey
          ? (d.id + "(stratify=" + d.stratifyKey + ")")
          : d.id;
      }).join(", ");
      addRow("schema split modes", splitTxt);
    }
    if (displayCols.length) addRow("schema display columns", displayCols.join(", "));
    const keys = Object.keys(hist).sort(function (a, b) { return Number(a) - Number(b); });
    if (keys.length) {
      const chunks = keys.map(function (k) { return k + ":" + String(hist[k]); });
      addRow("label histogram", chunks.join(", "));
    } else {
      addRow("note", "No tabular rows found for this dataset.");
    }
    if (ui.datasetGenericTableBody) ui.datasetGenericTableBody.innerHTML = html;
    if (ui.dataTableBody) ui.dataTableBody.innerHTML = "";
  }

  function plotNonTrajectoryDataset(ds, title) {
    if (!ui.datasetChart || !window.Plotly) return;
    setDatasetChartVisibility(true);
    const hist = (ds && ds.labelsHistogram && typeof ds.labelsHistogram === "object")
      ? ds.labelsHistogram
      : {};
    const keys = Object.keys(hist).sort(function (a, b) { return Number(a) - Number(b); });
    if (!keys.length) {
      Plotly.newPlot(
        ui.datasetChart,
        [{ x: [0], y: [0], mode: "lines", name: "dataset" }],
        {
          paper_bgcolor: "#0b1220",
          plot_bgcolor: "#0b1220",
          font: { color: "#e2e8f0" },
          title: String(title || "Dataset loaded"),
          xaxis: { title: "index", gridcolor: "#1e293b" },
          yaxis: { title: "value", gridcolor: "#1e293b" },
        },
        { responsive: true }
      );
      return;
    }
    Plotly.newPlot(
      ui.datasetChart,
      [{ type: "bar", x: keys, y: keys.map(function (k) { return Number(hist[k] || 0); }), name: "count", marker: { color: "#22d3ee" } }],
      {
        paper_bgcolor: "#0b1220",
        plot_bgcolor: "#0b1220",
        font: { color: "#e2e8f0" },
        title: String(title || "Dataset label distribution"),
        xaxis: { title: "label", gridcolor: "#1e293b" },
        yaxis: { title: "count", gridcolor: "#1e293b" },
      },
      { responsive: true }
    );
  }

  function getDatasetRenderSignature(ds) {
    const d = ds || {};
    const trajCount = Array.isArray(d.trajectories) ? d.trajectories.length : 0;
    const firstLen = Array.isArray(d.trajectories) && d.trajectories[0] && Array.isArray(d.trajectories[0].t)
      ? d.trajectories[0].t.length
      : 0;
    const recCount = (d.records && typeof d.records === "object") ? Object.keys(d.records).length : 0;
    return [
      trajCount,
      firstLen,
      Number(d.seed || 0),
      Number(d.trainCount || 0),
      Number(d.valCount || 0),
      Number(d.testCount || 0),
      String((d.splitConfig && d.splitConfig.mode) || ""),
      recCount,
    ].join("|");
  }

  function getDatasetRenderCache(datasetId) {
    const did = String(datasetId || "").trim();
    if (!did) return null;
    if (!state.datasetRenderCache || typeof state.datasetRenderCache !== "object") {
      state.datasetRenderCache = Object.create(null);
    }
    if (!state.datasetRenderCache[did]) {
      state.datasetRenderCache[did] = {
        sig: "",
        trajIndex: Object.create(null),
        trajRows: Object.create(null),
        genericRows: Object.create(null),
        previewTrajSelectionKey: "",
        previewTrajSelection: [],
      };
    }
    return state.datasetRenderCache[did];
  }

  function invalidateDatasetRenderCache(datasetId) {
    const did = String(datasetId || "").trim();
    if (!did || !state.datasetRenderCache || typeof state.datasetRenderCache !== "object") return;
    delete state.datasetRenderCache[did];
  }

  function invalidateAllDatasetRenderCache() {
    state.datasetRenderCache = Object.create(null);
  }

  function markLeftLibraryItemActiveById(itemId) {
    const id = String(itemId || "").trim();
    if (!id) return;

    function applyToContainer(root, selectorList) {
      if (!root || typeof root.querySelectorAll !== "function") return;
      const rows = root.querySelectorAll(selectorList);
      for (let i = 0; i < rows.length; i += 1) {
        const item = rows[i];
        const isItemRow = item.classList && (
          item.classList.contains("left-dataset-item") ||
          item.classList.contains("dataset-card")
        );
        if (!isItemRow) continue;
        const rowId = String(item.getAttribute("data-item-id") || item.getAttribute("data-dataset-id") || "").trim();
        if (!rowId) continue;
        item.classList.toggle("active", rowId === id);
      }
    }

    applyToContainer(ui.leftLibraryList, ".left-dataset-item[data-item-id], .left-dataset-item[data-dataset-id], [data-item-id], [data-dataset-id]");
  }

  function normalizeSortTimestamp(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function sortRowsByUpdatedThenCreated(rows) {
    const safeRows = Array.isArray(rows) ? rows.slice() : [];
    safeRows.sort(function (a, b) {
      const aUpdated = normalizeSortTimestamp(a && a.updatedAt);
      const bUpdated = normalizeSortTimestamp(b && b.updatedAt);
      const aCreated = normalizeSortTimestamp(a && a.createdAt);
      const bCreated = normalizeSortTimestamp(b && b.createdAt);
      const deltaUpdated = bUpdated - aUpdated;
      if (deltaUpdated !== 0) return deltaUpdated;
      const deltaCreated = bCreated - aCreated;
      if (deltaCreated !== 0) return deltaCreated;
      const aName = String((a && a.name) || (a && a.title) || "").toLowerCase();
      const bName = String((b && b.name) || (b && b.title) || "").toLowerCase();
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return 0;
    });
    return safeRows;
  }

  function markDatasetUiActive(did) {
    const id = String(did || "").trim();
    if (!id) return;
    if (ui.savedDatasetSelect) {
      const list = Array.from(ui.savedDatasetSelect.querySelectorAll("option"))
        .map(function (op) { return String(op.value || "").trim(); });
      if (list.indexOf(id) >= 0) ui.savedDatasetSelect.value = id;
    }
    markLeftLibraryItemActiveById(id);
  }

  function clearDatasetImageCanvas() {
    if (!ui.datasetImageCanvas) return;
    const ctx = ui.datasetImageCanvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, ui.datasetImageCanvas.width, ui.datasetImageCanvas.height);
  }

  function setDatasetChartVisibility(visible) {
    if (!ui.datasetChart) return;
    ui.datasetChart.style.display = visible ? "" : "none";
  }

  function getImageDatasetSplitNames(ds) {
    const rec = (ds && ds.records && typeof ds.records === "object") ? ds.records : {};
    return Object.keys(rec).filter(function (k) {
      const s = rec[k];
      return s && Array.isArray(s.x) && Array.isArray(s.y) && s.x.length === s.y.length;
    });
  }

  function isImageSchemaByData(ds) {
    const sid = resolveSchemaId((ds && ds.schemaId) || "oscillator");
    const profile = getUiProfileForSchema(sid);
    return String(profile.viewer || "").trim().toLowerCase() === "image";
  }

  function renderDatasetImageSampleFromUi(ds) {
    if (!isImageSchemaByData(ds)) return;
    if (!ui.datasetImageSplit || !ui.datasetImageIndex) return;
    const split = String(ui.datasetImageSplit.value || "");
    const splitRec = ds && ds.records && ds.records[split] ? ds.records[split] : null;
    const xs = splitRec && Array.isArray(splitRec.x) ? splitRec.x : [];
    const ys = splitRec && Array.isArray(splitRec.y) ? splitRec.y : [];
    if (!xs.length || !ys.length) {
      clearDatasetImageCanvas();
      if (ui.datasetImageInfo) ui.datasetImageInfo.textContent = "No image samples in split '" + split + "'.";
      return;
    }
    let idx = Number(ui.datasetImageIndex.value);
    if (!Number.isFinite(idx) || idx < 0 || idx >= xs.length) idx = 0;
    ui.datasetImageIndex.value = String(idx);
    const pixels = Array.isArray(xs[idx]) ? xs[idx] : [];
    const label = Number(ys[idx]);
    const classNames = Array.isArray(ds.classNames) ? ds.classNames : [];
    const className = classNames[label] != null ? String(classNames[label]) : String(label);
    const imageShape = Array.isArray(ds && ds.imageShape) ? ds.imageShape : [28, 28, 1];
    if (ui.datasetImageCanvas) {
      const imageRuntime = getImageRenderRuntime();
      if (imageRuntime) imageRuntime.drawGrayscaleCanvas(ui.datasetImageCanvas, pixels, { shape: imageShape });
    }
    if (ui.datasetImageInfo) {
      ui.datasetImageInfo.textContent =
        "split=" + split +
        " | index=" + idx +
        " | label=" + label +
        " (" + className + ")" +
        " | shape=" + Number(imageShape[0] || 28) + "x" + Number(imageShape[1] || 28) + "x" + Number(imageShape[2] || 1) +
        " | split_count=" + xs.length +
        " | train/val/test=" +
        Number(ds.trainCount || 0) + "/" +
        Number(ds.valCount || 0) + "/" +
        Number(ds.testCount || 0);
    }
  }

  function renderImageClassGrid(ds, options) {
    if (!ui.mnistClassGrid) return;
    if (!isImageSchemaByData(ds)) {
      ui.mnistClassGrid.innerHTML = "";
      return;
    }
    const opts = options || {};
    const split = String((ui.datasetImageSplit && ui.datasetImageSplit.value) || "train");
    const rec = ds && ds.records && ds.records[split] ? ds.records[split] : null;
    const xs = rec && Array.isArray(rec.x) ? rec.x : [];
    const ys = rec && Array.isArray(rec.y) ? rec.y : [];
    const classNames = Array.isArray(ds.classNames) ? ds.classNames : ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const imageRuntime = getImageRenderRuntime();
    if (!imageRuntime) return;
    imageRuntime.renderImageClassGrid({
      mountEl: ui.mnistClassGrid,
      split: split,
      xs: xs,
      ys: ys,
      classNames: classNames,
      randomize: Boolean(opts.randomize),
      seed: Number(ds.seed || 42) + (Boolean(opts.randomize) ? Date.now() : 0),
      idPrefix: "dataset_image_class_canvas",
      shape: Array.isArray(ds && ds.imageShape) ? ds.imageShape : [28, 28, 1],
      emptyText: "No samples in split '" + split + "' for class overview.",
    });
  }

  function refreshDatasetImageViewer(ds) {
    if (!ui.datasetImageSplit || !ui.datasetImageIndex) return;
    if (!isImageSchemaByData(ds)) {
      ui.datasetImageSplit.innerHTML = "";
      ui.datasetImageIndex.innerHTML = "";
      clearDatasetImageCanvas();
      if (ui.datasetImageInfo) ui.datasetImageInfo.textContent = "Image preview is available for image schemas.";
      if (ui.mnistClassGrid) ui.mnistClassGrid.innerHTML = "";
      return;
    }
    const splitNames = getImageDatasetSplitNames(ds);
    const prevSplit = String(ui.datasetImageSplit.value || "");
    const prevIdx = Number(ui.datasetImageIndex.value);
    ui.datasetImageSplit.innerHTML = "";
    if (!splitNames.length) {
      const op = document.createElement("option");
      op.value = "";
      op.textContent = "(no split data)";
      ui.datasetImageSplit.appendChild(op);
      ui.datasetImageIndex.innerHTML = "<option value=''>-</option>";
      clearDatasetImageCanvas();
      if (ui.datasetImageInfo) ui.datasetImageInfo.textContent = "No split records found in dataset.";
      if (ui.mnistClassGrid) ui.mnistClassGrid.innerHTML = "";
      return;
    }
    splitNames.forEach(function (name) {
      const op = document.createElement("option");
      op.value = name;
      op.textContent = name;
      ui.datasetImageSplit.appendChild(op);
    });
    ui.datasetImageSplit.value = splitNames.indexOf(prevSplit) >= 0 ? prevSplit : splitNames[0];
    const split = String(ui.datasetImageSplit.value || splitNames[0]);
    const splitRec = ds.records && ds.records[split] ? ds.records[split] : { x: [], y: [] };
    const count = Array.isArray(splitRec.x) ? splitRec.x.length : 0;
    const maxMenu = Math.min(count, 2000);
    ui.datasetImageIndex.innerHTML = "";
    if (!count) {
      ui.datasetImageIndex.innerHTML = "<option value=''>-</option>";
      clearDatasetImageCanvas();
      if (ui.datasetImageInfo) ui.datasetImageInfo.textContent = "No samples in split '" + split + "'.";
      if (ui.mnistClassGrid) ui.mnistClassGrid.innerHTML = "";
      return;
    }
    for (let i = 0; i < maxMenu; i += 1) {
      const op = document.createElement("option");
      op.value = String(i);
      op.textContent = String(i);
      ui.datasetImageIndex.appendChild(op);
    }
    const idx = Number.isFinite(prevIdx) && prevIdx >= 0 && prevIdx < maxMenu ? prevIdx : 0;
    ui.datasetImageIndex.value = String(idx);
    renderDatasetImageSampleFromUi(ds);
    renderImageClassGrid(ds, { randomize: false });
  }

  function renderEmptyDatasetTableMessage(messageText) {
    const msg = String(messageText || "No dataset selected.");
    const oscVisible = !ui.datasetOscillatorTableWrap || ui.datasetOscillatorTableWrap.style.display !== "none";
    const genericVisible = !!ui.datasetGenericTableWrap && ui.datasetGenericTableWrap.style.display !== "none";
    if (genericVisible) {
      setGenericDatasetTableHeader(["Field", "Value"]);
      if (ui.datasetGenericTableBody) {
        ui.datasetGenericTableBody.innerHTML = "<tr><td>note</td><td>" + escapeHtml(msg) + "</td></tr>";
      }
      if (ui.dataTableBody) ui.dataTableBody.innerHTML = "";
      return;
    }
    if (oscVisible) {
      if (ui.dataTableBody) ui.dataTableBody.innerHTML = "<tr><td colspan='17'>" + escapeHtml(msg) + "</td></tr>";
      if (ui.datasetGenericTableBody) ui.datasetGenericTableBody.innerHTML = "";
      return;
    }
    if (ui.dataTableBody) ui.dataTableBody.innerHTML = "";
    if (ui.datasetGenericTableBody) ui.datasetGenericTableBody.innerHTML = "";
  }

  function renderDataTable(dsOverride, preferredIdx, opts) {
    const options = opts || {};
    const ds = dsOverride || state.dataset || syncActiveDatasetFromSelection();
    const cacheId = String(options.datasetId || "").trim() || String(state.activeDatasetId || "");
    const cache = cacheId ? getDatasetRenderCache(cacheId) : null;
    const cacheSig = cache ? getDatasetRenderSignature(ds) : "";
    if (!ds) {
      renderEmptyDatasetTableMessage("Generate dataset first.");
      if (ui.tableDatasetInfo) ui.tableDatasetInfo.textContent = "Table Dataset: (none)";
      return;
    }
    if (cache && cache.sig !== cacheSig) {
      cache.sig = cacheSig;
      cache.trajIndex = Object.create(null);
      cache.trajRows = Object.create(null);
      cache.genericRows = Object.create(null);
    }
    const schemaId = resolveSchemaId((ds && ds.schemaId) || "oscillator");
    if (schemaId !== "oscillator" || !Array.isArray(ds.trajectories) || !ds.trajectories.length) {
      if (ui.tableDatasetInfo) {
        const nm = String(state.activeDatasetName || "(unsaved)");
        ui.tableDatasetInfo.textContent = "Table Dataset: " + nm + " | schema=" + schemaId;
      }
      if (ui.dataTrajIdx) ui.dataTrajIdx.innerHTML = "";
      if (ui.dataTableBody) ui.dataTableBody.innerHTML = "";
      renderNonTrajectoryDatasetTable(ds);
      refreshDatasetImageViewer(ds);
      return;
    }
    if (ui.tableDatasetInfo) {
      const nm = String(state.activeDatasetName || "(unsaved)");
      const md = String(ds.mode || "unknown");
      const sd = Number.isFinite(Number(ds.seed)) ? String(ds.seed) : "-";
      ui.tableDatasetInfo.textContent = "Table Dataset: " + nm + " | mode=" + md + " | seed=" + sd;
    }
    const scenarioFilter = String((ui.dataScenarioFilter && ui.dataScenarioFilter.value) || "all");
    const allTraj = ds.trajectories;
    let filteredIdx = [];
    if (cache) {
      const cachedScenario = cache.trajIndex[scenarioFilter];
      if (cachedScenario && cachedScenario.sig === cacheSig) {
        filteredIdx = cachedScenario.indices || [];
        if (ui.dataTrajIdx && String(ui.dataTrajIdx.innerHTML || "") !== String(cachedScenario.optionsHtml || "")) {
          ui.dataTrajIdx.innerHTML = cachedScenario.optionsHtml || "";
        }
      }
    }
    if (!filteredIdx.length) {
      const indices = [];
      for (let i = 0; i < allTraj.length; i += 1) {
        if (matchesScenarioFilter(allTraj[i], scenarioFilter, ds.scenarioType)) indices.push(i);
      }
      filteredIdx = indices;
      if (cache) {
        const optionsHtml = indices.map(function (absIdx) {
          const scen = String((allTraj[absIdx] && allTraj[absIdx].params && allTraj[absIdx].params.scenario) || ds.scenarioType || "unknown");
          return "<option value='" + String(absIdx) + "'>" + String(absIdx) + " (" + scen + ")</option>";
        }).join("");
        cache.trajIndex[scenarioFilter] = {
          sig: cacheSig,
          indices: indices,
          optionsHtml: optionsHtml,
        };
        if (ui.dataTrajIdx) ui.dataTrajIdx.innerHTML = optionsHtml;
      } else if (ui.dataTrajIdx) {
        if (ui.dataTrajIdx) ui.dataTrajIdx.innerHTML = "";
        for (let i = 0; i < indices.length; i += 1) {
          const absIdx = indices[i];
          const scen = String((allTraj[absIdx] && allTraj[absIdx].params && allTraj[absIdx].params.scenario) || ds.scenarioType || "unknown");
          const op = document.createElement("option");
          op.value = String(absIdx);
          op.textContent = String(absIdx) + " (" + scen + ")";
          ui.dataTrajIdx.appendChild(op);
        }
      }
    }
    if (!filteredIdx.length) {
      if (ui.dataTrajIdx) ui.dataTrajIdx.innerHTML = "";
      ui.dataTableBody.innerHTML = "<tr><td colspan='17'>No trajectories for selected scenario filter.</td></tr>";
      setStatus("Data table: no trajectories for selected scenario filter '" + scenarioFilter + "'.");
      return;
    }
    let idx = Number.isInteger(Number(preferredIdx)) ? Number(preferredIdx) : Number(ui.dataTrajIdx && ui.dataTrajIdx.value);
    if (!Number.isInteger(idx) || filteredIdx.indexOf(idx) < 0) idx = filteredIdx[0];
    if (ui.dataTrajIdx) ui.dataTrajIdx.value = String(idx);
    const rowsRaw = String((ui.dataRows && ui.dataRows.value) || "100");
    const rowCacheKey = (cacheSig || "s0") + "|" + scenarioFilter + "|" + rowsRaw + "|" + String(idx);
    if (cache) {
      const cached = cache.trajRows[rowCacheKey];
      if (cached && cached.sig === cacheSig && cached.idx === String(idx) && cached.rowsRaw === rowsRaw && typeof cached.html === "string") {
        ui.dataTableBody.innerHTML = cached.html;
        if (ui.datasetGenericTableBody) ui.datasetGenericTableBody.innerHTML = "";
        setStatus("Data table: trajectory " + idx + " showing " + cached.rowCount + " rows (filter=" + scenarioFilter + ").");
        return;
      }
    }
    const tr = allTraj[idx];
    if (!tr || !Array.isArray(tr.t) || !tr.t.length) {
      ui.dataTableBody.innerHTML = "<tr><td colspan='17'>No rows in selected trajectory.</td></tr>";
      if (ui.datasetGenericTableBody) ui.datasetGenericTableBody.innerHTML = "";
      return;
    }
    const p = tr.params || {};
    const n = rowsRaw === "all"
      ? tr.t.length
      : Math.min(Math.max(10, Number(rowsRaw) || 100), tr.t.length);
    let html = "";
    for (let i = 0; i < n; i += 1) {
      const ti = Number(tr.t[i]);
      const xi = Number(tr.x[i]);
      const vi = tr.v ? Number(tr.v[i]) : NaN;
      const scen = String(p.scenario == null ? "" : p.scenario);
      const p3Role = scen === "spring" ? "k" : (scen === "pendulum" ? "L" : (scen === "bouncing" ? "g" : "p3"));
      html += "<tr>" +
        "<td>" + idx + "</td>" +
        "<td>" + i + "</td>" +
        "<td>" + ti.toFixed(4) + "</td>" +
        "<td>" + xi.toFixed(6) + "</td>" +
        "<td>" + (Number.isFinite(vi) ? vi.toFixed(6) : "-") + "</td>" +
        "<td>" + scen + "</td>" +
        "<td>" + (p.m == null ? "" : Number(p.m).toFixed(6)) + "</td>" +
        "<td>" + (p.c == null ? "" : Number(p.c).toFixed(6)) + "</td>" +
        "<td>" + (p.k == null ? "" : Number(p.k).toFixed(6)) + "</td>" +
        "<td>" + p3Role + "</td>" +
        "<td>" + (p.g == null ? "" : Number(p.g).toFixed(6)) + "</td>" +
        "<td>" + (p.restitution == null ? "" : Number(p.restitution).toFixed(6)) + "</td>" +
        "<td>" + (p.x0 == null ? "" : Number(p.x0).toFixed(6)) + "</td>" +
        "<td>" + (p.v0 == null ? "" : Number(p.v0).toFixed(6)) + "</td>" +
        "<td>" + String(p.groundModel == null ? "" : p.groundModel) + "</td>" +
        "<td>" + (p.groundK == null ? "" : Number(p.groundK).toFixed(6)) + "</td>" +
        "<td>" + (p.groundC == null ? "" : Number(p.groundC).toFixed(6)) + "</td>" +
        "</tr>";
    }
    ui.dataTableBody.innerHTML = html;
    if (ui.datasetGenericTableBody) ui.datasetGenericTableBody.innerHTML = "";
    if (cache) {
      cache.trajRows[rowCacheKey] = {
        sig: cacheSig,
        idx: String(idx),
        rowsRaw: rowsRaw,
        rowCount: n,
        html: html,
      };
    }
    setStatus("Data table: trajectory " + idx + " showing " + n + " rows (filter=" + scenarioFilter + ").");
  }

  function applyDatasetModuleUi(moduleId) {
    const mid = String(moduleId || "oscillator").trim().toLowerCase() || "oscillator";
    state.activeDatasetModuleId = mid;
    const mod = getDatasetModule(mid);
    const schemaId = resolveSchemaId((mod && mod.schemaId) || mid);
    const uiProfile = getUiProfileForSchema(schemaId);
    const useOscillatorView = String((uiProfile && uiProfile.viewer) || "trajectory") === "trajectory" &&
      String((uiProfile && uiProfile.sidebarMode) || "generic") === "oscillator";
    const useImageView = String((uiProfile && uiProfile.viewer) || "") === "image";
    if (ui.datasetModuleInfo) {
      const label = String((mod && mod.label) || schemaId);
      ui.datasetModuleInfo.textContent = label + " [" + schemaId + "]";
      ui.datasetModuleInfo.title = getDatasetModuleHelpText(mid, schemaId);
    }
    refreshRightDataLabConfigTitle();
    if (ui.datasetSidebarImageOnly) ui.datasetSidebarImageOnly.style.display = useImageView ? "" : "none";
    if (ui.trainFracRow) ui.trainFracRow.style.display = "";
    if (ui.valFracRow) ui.valFracRow.style.display = "";
    if (ui.testFracRow) ui.testFracRow.style.display = "";
    if (ui.datasetOscillatorPanel) ui.datasetOscillatorPanel.style.display = useOscillatorView ? "" : "none";
    if (ui.datasetOscillatorHint) {
      ui.datasetOscillatorHint.style.display = useOscillatorView ? "" : "none";
      ui.datasetOscillatorHint.textContent = "Use right panel Dataset Config, then click Generate Dataset (RK4).";
    }
    if (ui.datasetOscillatorTableControls) ui.datasetOscillatorTableControls.style.display = useOscillatorView ? "" : "none";
    if (ui.datasetOscillatorSchemaHint) ui.datasetOscillatorSchemaHint.style.display = useOscillatorView ? "" : "none";
    if (ui.datasetOscillatorTableWrap) ui.datasetOscillatorTableWrap.style.display = useOscillatorView ? "" : "none";
    if (ui.datasetGenericTableWrap) ui.datasetGenericTableWrap.style.display = useOscillatorView ? "none" : "";
    if (ui.datasetImagePanel) ui.datasetImagePanel.style.display = useImageView ? "" : "none";
    if (useImageView) {
      const activeDatasetSchemaId = state.dataset ? resolveSchemaId((state.dataset && state.dataset.schemaId) || schemaId) : "";
      if (!activeDatasetSchemaId || activeDatasetSchemaId !== schemaId) {
        setDatasetChartVisibility(false);
      }
    } else if (useOscillatorView) {
      setDatasetChartVisibility(true);
    }
    if (ui.genDatasetBtn) {
      ui.genDatasetBtn.textContent = useOscillatorView ? "Generate Dataset (RK4)" : "Create Dataset";
      ui.genDatasetBtn.disabled = false;
      ui.genDatasetBtn.title = "";
    }
    refreshSplitModeOptionsForSchema(schemaId);
    if (ui.exportDatasetCsvBtn) {
      const oscMode = useOscillatorView;
      ui.exportDatasetCsvBtn.disabled = !oscMode;
      ui.exportDatasetCsvBtn.title = oscMode ? "" : "CSV export is available for oscillator schema.";
    }
    if (String(state.currentWorkspace || "") === "dataset" && String(state.activeDatasetId || "").trim()) {
      renderDatasetConfigPanel(mid);
    }
    if (state.currentWorkspace === "dataset" || state.currentWorkspace === "preview") {
      updateSidebarForWorkspace(state.currentWorkspace);
    }
    if (useImageView) syncImageSplitCountsFromFractions(true);
  }

  function normalizeSplitFractionsFromUi(syncInputs) {
    const activeModuleId = currentDatasetModuleId();
    const activeModule = getDatasetModule(activeModuleId);
    const schemaId = resolveSchemaId((activeModule && activeModule.schemaId) || "oscillator");
    const moduleDefaults = getDatasetModuleDatasetPreconfig(activeModuleId, schemaId);
    const normalized = DATASET_PROCESSING_CORE.normalizeSplitFractions(
      {
        train: Number((ui.trainFrac && ui.trainFrac.value)),
        val: Number((ui.valFrac && ui.valFrac.value)),
        test: Number((ui.testFrac && ui.testFrac.value)),
      },
      moduleDefaults.fractions
    );
    const tr = Number(normalized.train);
    const va = Number(normalized.val);
    const te = Number(normalized.test);
    if (syncInputs) {
      if (ui.trainFrac) ui.trainFrac.value = tr.toFixed(4);
      if (ui.valFrac) ui.valFrac.value = va.toFixed(4);
      if (ui.testFrac) ui.testFrac.value = te.toFixed(4);
    }
    return { train: tr, val: va, test: te };
  }

  function splitCountsFromTotalAndFractions(total, fr) {
    const out = DATASET_PROCESSING_CORE.computeSplitCounts(
      Number(total),
      fr || { train: 0.7, val: 0.15, test: 0.15 },
      { minEach: 1, minTotal: 3, fallbackFractions: { train: 0.7, val: 0.15, test: 0.15 } }
    );
    return {
      total: Number(out.total),
      train: Number(out.train),
      val: Number(out.val),
      test: Number(out.test),
    };
  }

  function syncImageSplitCountsFromFractions(syncFracInputs) {
    if (!ui || !ui.datasetSidebarImageOnly) return null;
    const visible = ui.datasetSidebarImageOnly.style.display !== "none";
    if (!visible) return null;
    const moduleId = currentDatasetModuleId();
    const mod = getDatasetModule(moduleId);
    const schemaId = resolveSchemaId((mod && mod.schemaId) || "oscillator");
    const moduleDefaults = getDatasetModuleDatasetPreconfig(moduleId, schemaId);
    const fr = normalizeSplitFractionsFromUi(Boolean(syncFracInputs));
    const totalRaw = Number((ui.mnistTotalCount && ui.mnistTotalCount.value) || moduleDefaults.totalCount || 1400);
    const counts = splitCountsFromTotalAndFractions(totalRaw, fr);
    if (ui.mnistTotalCount) ui.mnistTotalCount.value = String(counts.total);
    if (ui.mnistTrainCount) ui.mnistTrainCount.value = String(counts.train);
    if (ui.mnistValCount) ui.mnistValCount.value = String(counts.val);
    if (ui.mnistTestCount) ui.mnistTestCount.value = String(counts.test);
    return { fractions: fr, counts: counts };
  }

  function refreshDatasetModuleSelect(preferredModuleId, opts) {
    if (!ui.datasetModuleSelect) return;
    const modules = listDatasetModules();
    const cur = String(preferredModuleId || state.activeDatasetModuleId || "oscillator").trim().toLowerCase();
    ui.datasetModuleSelect.innerHTML = "";
    if (!modules.length) {
      const op0 = document.createElement("option");
      op0.value = "oscillator";
      op0.textContent = "Oscillator [oscillator]";
      ui.datasetModuleSelect.appendChild(op0);
      ui.datasetModuleSelect.value = "oscillator";
      setActiveDatasetModuleId("oscillator", "oscillator");
      if (!(opts && opts.skipApply)) applyDatasetModuleUi("oscillator");
      return;
    }
    modules.forEach(function (m) {
      const op = document.createElement("option");
      op.value = String(m.id || "");
      op.textContent = String(m.label || m.id) + " [" + String(m.schemaId || "oscillator") + "]";
      ui.datasetModuleSelect.appendChild(op);
    });
    const exists = modules.some(function (m) { return String(m.id || "") === cur; });
    const next = exists ? cur : String(modules[0].id || "oscillator");
    setActiveDatasetModuleId(next, (getDatasetModule(next) && getDatasetModule(next).schemaId) || "oscillator");
    if (!(opts && opts.skipApply)) applyDatasetModuleUi(next);
  }

  async function buildDatasetFromSelectedModule() {
    const moduleId = currentDatasetModuleId();
    const mod = getDatasetModule(moduleId);
    if (!mod) throw new Error("Dataset module '" + moduleId + "' is not registered.");
    const schemaId = resolveSchemaId(mod.schemaId || "oscillator");
    const uiApi = mod.uiApi || null;
    if (!uiApi || typeof uiApi.getDatasetBuildConfig !== "function") {
      throw new Error("Dataset module '" + moduleId + "' does not declare getDatasetBuildConfig(ctx).");
    }
    const cfg = uiApi.getDatasetBuildConfig(buildDatasetModuleUiContext());
    const ds = (DATASET_RUNTIME && typeof DATASET_RUNTIME.buildDataset === "function")
      ? await DATASET_RUNTIME.buildDataset(moduleId, cfg)
      : (async function () {
        if (!mod || typeof mod.build !== "function") {
          throw new Error("Dataset module '" + moduleId + "' does not provide a build function.");
        }
        const out = await mod.build(cfg);
        if (!out || typeof out !== "object") throw new Error("Dataset module build failed.");
        out.schemaId = resolveSchemaId(out.schemaId || mod.schemaId || "oscillator");
        return out;
      })();
    return ds;
  }

  function normalizeDatasetVariantMap(variantMapRaw, schemaId, moduleId) {
    const raw = (variantMapRaw && typeof variantMapRaw === "object") ? variantMapRaw : {};
    const out = Object.create(null);
    Object.keys(raw).forEach(function (key) {
      const ds = raw[key];
      if (!ds || typeof ds !== "object") return;
      const clean = Object.assign({}, ds);
      delete clean.variantMap;
      delete clean.activeVariantId;
      out[String(key || "").trim()] = normalizeDatasetPayloadForStore(clean, {
        schemaId: schemaId,
        moduleId: moduleId,
      });
    });
    return out;
  }

  function normalizeDatasetBuildOutput(rawOutput, options) {
    const opts = options || {};
    const schemaId = resolveSchemaId(opts.schemaId || "oscillator");
    const moduleId = String(opts.moduleId || pickDefaultDatasetModuleForSchema(schemaId)).trim().toLowerCase();
    const requestedVariantId = String(opts.requestedVariantId || "").trim();
    const raw = (rawOutput && typeof rawOutput === "object") ? rawOutput : {};
    if (raw.kind === "dataset_bundle" && raw.datasets && typeof raw.datasets === "object") {
      const variantMap = normalizeDatasetVariantMap(raw.datasets, schemaId, moduleId);
      const keys = Object.keys(variantMap);
      if (!keys.length) {
        throw new Error("Dataset bundle has no variants.");
      }
      const activeVariantId = String(raw.activeVariantId || requestedVariantId || keys[0]).trim() || keys[0];
      const activeDataset = variantMap[activeVariantId] || variantMap[keys[0]];
      const datasetToSave = Object.assign({}, activeDataset, {
        variantMap: variantMap,
        activeVariantId: activeVariantId,
      });
      return {
        kind: "dataset_bundle",
        activeVariantId: activeVariantId,
        activeDataset: datasetToSave,
        variantMap: variantMap,
      };
    }
    const activeDataset = normalizeDatasetPayloadForStore(raw, {
      schemaId: schemaId,
      moduleId: moduleId,
    });
    return {
      kind: "dataset",
      activeVariantId: "",
      activeDataset: activeDataset,
      variantMap: Object.create(null),
    };
  }

  function applyBuiltDatasetResult(result) {
    const normalized = result && typeof result === "object" ? result : null;
    if (!normalized || !normalized.activeDataset) {
      throw new Error("Invalid dataset build result.");
    }
    state.dataset = normalized.activeDataset;
    state.preparedDataset = null;
    if (state.datasetsByMode) {
      state.datasetsByMode.autoregressive = null;
      state.datasetsByMode.direct = null;
      const variants = normalized.variantMap || {};
      Object.keys(variants).forEach(function (key) {
        state.datasetsByMode[String(key)] = variants[key];
      });
      if (!Object.keys(variants).length && state.dataset.mode) {
        state.datasetsByMode[String(state.dataset.mode)] = state.dataset;
      }
    }
  }

  function refreshSavedDatasetSelect(opts) {
    const options = opts || {};
    const doLibrary = options.refreshLibrary !== false;

    ensureLibraryEntityIds();
    if (!ui.savedDatasetSelect) return;
    const selectedModuleId = currentDatasetModuleId();
    const selectedModule = getDatasetModule(selectedModuleId);
    const selectedSchema = selectedModule ? resolveSchemaId(selectedModule.schemaId || "oscillator") : "";
    const cur = String(ui.savedDatasetSelect.value || "");
    const list = state.savedDatasets
      .map(function (d) {
        if (!d) return null;
        const id = String(d.id || "").trim();
        const name = String(d.name || "").trim();
        if (!id || !name) return null;
        return {
          id: id,
          name: name,
          schemaId: getSavedDatasetSchemaId(d, "oscillator"),
          updatedAt: Number(d.updatedAt || 0),
          createdAt: Number(d.createdAt || 0),
        };
      })
      .filter(function (d) {
        if (!selectedSchema) return true;
        return resolveSchemaId(d.schemaId) === selectedSchema;
      })
      .filter(Boolean);
    const sortedList = sortRowsByUpdatedThenCreated(list);
    if (!sortedList.length) {
      refreshDatasetDetailPanel();
      if (state.currentWorkspace === "dataset") renderLeftLibraryByWorkspace();
      refreshRightInspectorPanels();
      return;
    }
    ui.savedDatasetSelect.innerHTML = "";
    const noneOp = document.createElement("option");
    noneOp.value = "";
    noneOp.textContent = "(none)";
    ui.savedDatasetSelect.appendChild(noneOp);
    sortedList.forEach(function (d) {
      const op = document.createElement("option");
      op.value = d.id;
      op.textContent = d.name + " [" + d.schemaId + "]";
      ui.savedDatasetSelect.appendChild(op);
    });
    const active = String(state.activeDatasetId || "");
    if (active && list.some(function (d) { return d.id === active; })) {
      ui.savedDatasetSelect.value = active;
    } else if (cur && list.some(function (d) { return d.id === cur; })) {
      ui.savedDatasetSelect.value = cur;
    } else if (!active && String(state.currentWorkspace || "") === "dataset") {
      ui.savedDatasetSelect.value = "";
    } else {
      ui.savedDatasetSelect.value = sortedList[0] ? sortedList[0].id : "";
    }
    refreshDatasetDetailPanel();
    if (doLibrary && state.currentWorkspace === "dataset") renderLeftLibraryByWorkspace();
    refreshRightInspectorPanels();
  }

  function datasetCardStatsText(dsEntry) {
    const d = dsEntry && dsEntry.data ? dsEntry.data : {};
    const schemaId = getSavedDatasetSchemaId(dsEntry, "oscillator");
    const countBySplit = function (splitName) {
      const key = String(splitName || "").trim().toLowerCase();
      if (!key) return 0;
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      const direct = [d[key + "Count"], d["n" + cap]];
      for (let i = 0; i < direct.length; i += 1) {
        const n = Number(direct[i]);
        if (Number.isFinite(n) && n >= 0) return n;
      }
      if (d.splitCounts && typeof d.splitCounts === "object") {
        const splitN = Number(d.splitCounts[key]);
        if (Number.isFinite(splitN) && splitN >= 0) return splitN;
      }
      const ySeries = d["y" + cap];
      if (Array.isArray(ySeries)) return ySeries.length;
      const rowSeries = d[key + "Rows"];
      if (Array.isArray(rowSeries)) return rowSeries.length;
      const rec = d.records && typeof d.records === "object" ? d.records[key] : null;
      if (rec && typeof rec === "object") {
        if (Array.isArray(rec.y)) return rec.y.length;
        if (Array.isArray(rec.x)) return rec.x.length;
        if (Array.isArray(rec.rows)) return rec.rows.length;
      }
      return 0;
    };
    const isDraft = Boolean(d.draft) || (
      !Array.isArray(d.trajectories) &&
      (!d.records || !Object.keys(d.records).length) &&
      !Number.isFinite(Number(d.trainCount)) &&
      !Number.isFinite(Number(d.valCount)) &&
      !Number.isFinite(Number(d.testCount))
    );
    if (isDraft) {
      return "schema=" + schemaId + " | draft";
    }
    const tr = Array.isArray(d.trajectories) ? d.trajectories.length : 0;
    const trainN = countBySplit("train");
    const valN = countBySplit("val");
    const testN = countBySplit("test");
    const split = String((d.splitConfig && d.splitConfig.mode) || "");
    const mode = String(d.mode || "");
    const parts = [
      "schema=" + schemaId,
      mode ? ("mode=" + mode) : "",
      tr ? ("traj=" + tr) : "",
      ("split=" + (split || "n/a")),
      ("train/val/test=" + trainN + "/" + valN + "/" + testN),
    ].filter(Boolean);
    return parts.join(" | ");
  }

  function applyLabSelectionState(config) {
    UI_SHARED_ENGINE.applySelectionState(config);
  }

  function refreshDataLabSelectionLinkedPanels(hasSelection) {
    if (String(state.currentWorkspace || "") === "preview") return;
    getWorkspaceSelectionUiRuntime().applyDatasetSelectionUi({
      selected: hasSelection,
      hasSelection: hasSelection,
      emptyEl: ui.datasetSelectionEmpty,
      disableWhenEmpty: [ui.dataLabPreviewTab, ui.dataLabBuilderTab, ui.exportDatasetCsvBtn],
      onEmpty: function () {
        if (ui.dataLabPreviewPane) ui.dataLabPreviewPane.style.display = "none";
        if (ui.dataLabBuilderPane) ui.dataLabBuilderPane.style.display = "none";
        if (state.rightInspectorForms && state.rightInspectorForms.dataset &&
            typeof state.rightInspectorForms.dataset.destroy === "function") {
          state.rightInspectorForms.dataset.destroy();
        }
        state.rightInspectorForms.dataset = null;
        if (ui.rightDataLabConfigMount) ui.rightDataLabConfigMount.style.display = "none";
        if (ui.rightDataLabConfigTitle) ui.rightDataLabConfigTitle.textContent = "Dataset Config";
        if (state.currentWorkspace === "dataset" && ui.rightDataLabInfo) {
          ui.rightDataLabInfo.textContent = "No dataset selected. Select dataset from the left panel.";
        }
      },
      onSelected: function () {
        if (ui.rightDataLabConfigMount) ui.rightDataLabConfigMount.style.display = "";
        const isPreview = String(state.dataLabSubTab || "preview") !== "builder";
        if (ui.dataLabPreviewPane) ui.dataLabPreviewPane.style.display = isPreview ? "" : "none";
        if (ui.dataLabBuilderPane) ui.dataLabBuilderPane.style.display = isPreview ? "none" : "";
        renderDatasetConfigPanel(currentDatasetModuleId());
      },
    });
  }

  function refreshDatasetDetailPanel() {
    if (!ui.datasetDetailTitle || !ui.datasetDetailMeta) return;
    const activeId = String((state.activeDatasetId || (ui.savedDatasetSelect && ui.savedDatasetSelect.value) || "") || "").trim();
    const dsEntry = activeId ? getSavedDatasetById(activeId) : null;
    const detailState = getWorkspaceSelectionUiRuntime().buildDatasetDetailState(dsEntry);
    ui.datasetDetailTitle.textContent = detailState.title;
    ui.datasetDetailMeta.textContent = detailState.meta;
    ui.datasetDetailMeta.style.display = detailState.hideMeta ? "none" : "";
    refreshDataLabSelectionLinkedPanels(detailState.hasSelection);
  }

  function refreshModelLabSelectionState() {
    const activeId = String(state.activeModelId || "").trim();
    getWorkspaceSelectionUiRuntime().applyModelSelectionUi({
      hasSelection: !!getSavedModelById(activeId),
      emptyEl: ui.modelLabSelectionEmpty,
      contentEl: ui.modelLabContent,
      renderPalette: function () {
        renderModelPaletteForSchema(state.modelSchemaId || SCHEMA_REGISTRY.getDefaultSchemaId());
      },
    });
  }

  function renderLeftLibraryByWorkspace() {
    if (!ui.leftLibraryList || !ui.leftLibraryTitle) return;
    const ws = String(state.currentWorkspace || "preview");
    const cfgByWorkspace = {
      preview: {
        title: "Playground Schemas",
        showDatasetAction: false,
        showModelAction: false,
        showTrainAction: false,
        render: renderLeftPlaygroundSchemaItems,
      },
      dataset: {
        title: "Datasets",
        showDatasetAction: true,
        showModelAction: false,
        showTrainAction: false,
        render: renderLeftDatasetLibraryItems,
      },
      nn: {
        title: "Model Lab",
        showDatasetAction: false,
        showModelAction: true,
        showTrainAction: false,
        render: function () {
          renderLeftModelLibraryItems();
          refreshModelLabSelectionState();
        },
      },
      train: {
        title: "Training Lab",
        showDatasetAction: false,
        showModelAction: false,
        showTrainAction: true,
        render: renderLeftTrainingLibraryItems,
      },
    };
    const wsCfg = cfgByWorkspace[ws] || null;
    const showDatasetAction = Boolean(wsCfg && wsCfg.showDatasetAction);
    const showModelAction = Boolean(wsCfg && wsCfg.showModelAction);
    const showTrainAction = Boolean(wsCfg && wsCfg.showTrainAction);
    UI_SHARED_ENGINE.setActionButtonsVisibility({
      containerEl: ui.leftLibraryActions,
      buttons: [
        { el: ui.leftNewDatasetBtn, visible: showDatasetAction },
        { el: ui.leftNewModelBtn, visible: showModelAction },
        { el: ui.leftNewTrainSessionBtn, visible: showTrainAction },
      ],
    });
    if (wsCfg && typeof wsCfg.render === "function") {
      ui.leftLibraryTitle.textContent = wsCfg.title;
      wsCfg.render();
      return;
    }
    ui.leftLibraryTitle.textContent = "Workspace Library";
    ui.leftLibraryList.innerHTML = "<div class='hint'>Open Playground, Data Lab, Model Lab, or Training Lab to view items.</div>";
  }

  function libraryIconSvg(kind) {
    if (kind === "rename") {
      return (
        "<svg viewBox='0 0 24 24' aria-hidden='true'>" +
          "<path d='M12 20h9'/>" +
          "<path d='M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z'/>" +
        "</svg>"
      );
    }
    if (kind === "delete") {
      return (
        "<svg viewBox='0 0 24 24' aria-hidden='true'>" +
          "<path d='M3 6h18'/>" +
          "<path d='M8 6V4h8v2'/>" +
          "<path d='M19 6l-1 14H6L5 6'/>" +
        "</svg>"
      );
    }
    return "";
  }

  function renderLeftCardEngine(options) {
    if (!ui.leftLibraryList) return { itemById: {} };
    var panel = ui.leftLibraryList.__oscItemPanelModule;
    if (!panel) {
      panel = ITEM_PANEL_MODULE.create({ mountEl: ui.leftLibraryList });
      ui.leftLibraryList.__oscItemPanelModule = panel;
    }
    return panel.render({
      emptyText: options && options.emptyText,
      items: options && options.items,
      onOpen: options && options.onOpen,
      onAction: options && options.onAction,
      listClassName: "left-dataset-list",
      itemClassName: "left-dataset-item",
      itemMainClassName: "left-dataset-main",
      titleClassName: "left-dataset-open",
      metaClassName: "left-dataset-meta",
      actionsClassName: "left-dataset-actions",
    });
  }

  function handleDatasetLibraryOpen(datasetId) {
    const did = String(datasetId || "").trim();
    if (!did) return;
    const entry = getSavedDatasetById(did);
    if (entry) {
      state.activeDatasetId = did;
      state.activeDatasetName = String(entry.name || "");
      markDatasetUiActive(did);
      setStatus("Loading saved dataset '" + String(entry.name || did) + "'... (no rebuild)");
    }
    loadSavedDatasetById(did, { skipUiSync: true });
  }

  function selectActiveModelLibraryItem(modelId) {
    const mid = String(modelId || "").trim();
    if (!mid) return null;
    const model = getSavedModelById(mid);
    if (!model) return null;
    state.activeModelId = String(model.id || "");
    state.activeModelName = String(model.name || "");
    markLeftLibraryItemActiveById(state.activeModelId);
    if (ui.modelLibraryName) ui.modelLibraryName.value = String(model.name || "");
    if (state.currentWorkspace === "nn") refreshModelLabSelectionState();
    return model;
  }

  function handleModelLibraryOpen(modelId) {
    const mid = String(modelId || "").trim();
    if (!mid) return;
    const model = getSavedModelById(mid);
    if (!model) return;
    const label = String(model.name || model.id || mid);
    runWithUnsavedModelGuard("loading model '" + label + "'", function () {
      const selected = selectActiveModelLibraryItem(mid);
      if (!selected) return;
      try {
        loadSavedModelById(selected.id);
        refreshRightInspectorPanels();
      } catch (err) {
        setTrainSessionStatus("Load model failed: " + err.message);
        if (state.currentWorkspace === "nn") refreshModelLabSelectionState();
      }
    });
  }

  function handleTrainingLibraryOpen(sessionId) {
    const sid = String(sessionId || "").trim();
    const s = getTrainSessionById(sid);
    if (!s) return;
    state.activeTrainSessionId = sid;
    markLeftLibraryItemActiveById(sid);
    normalizeTrainSessionRecord(s);
    renderTrainSessionTable();
  }

  function renderLeftPlaygroundSchemaItems() {
    const schemas = listRegisteredSchemaEntries().filter(function (s) {
      return listDatasetModulesForSchema(s.id).length > 0;
    });
    if (!schemas.length) {
      ui.leftLibraryList.innerHTML = "<div class='hint'>No registered schemas.</div>";
      return;
    }
    const activeSchemaId = currentPlaygroundSchemaId();
    const rows = schemas.map(function (s) {
      const sid = resolveSchemaId(s.id || "oscillator");
      const moduleId = pickDefaultDatasetModuleForSchema(sid);
      const moduleObj = getDatasetModule(moduleId);
      return {
        schemaId: sid,
        schemaLabel: String(s.label || sid),
        moduleId: moduleId,
        moduleLabel: String((moduleObj && moduleObj.label) || moduleId),
      };
    });
    renderLeftCardEngine({
      emptyText: "No registered schemas.",
      items: rows.map(function (r) {
        return {
          id: r.schemaId,
          title: r.schemaLabel,
          titleTip: getDatasetModuleHelpText(r.moduleId, r.schemaId),
          metaLines: [
            "module: " + r.moduleLabel,
            "click item to switch playground",
          ],
          active: r.schemaId === activeSchemaId,
          actions: [],
        };
      }),
      onOpen: function (schemaId) {
        const sid = resolveSchemaId(schemaId || "oscillator");
        state.playgroundSchemaId = sid;
        refreshPlaygroundWorkspaceUi();
        renderLeftPlaygroundSchemaItems();
        setStatus("Playground schema switched to '" + sid + "'.");
      },
    });
  }

  function renderLeftDatasetLibraryItems() {
    ensureLibraryEntityIds();
    const rows = state.savedDatasets
      .filter(Boolean)
      .map(function (d) {
        const schemaId = getSavedDatasetSchemaId(d, "oscillator");
        const moduleId = String(
          (d && d.data && d.data.datasetModuleId) ||
          pickDefaultDatasetModuleForSchema(schemaId) ||
          "oscillator"
        ).trim().toLowerCase();
        return {
          id: String(d.id || "").trim(),
          name: String(d.name || "").trim(),
          schemaId: schemaId,
          moduleId: moduleId,
          entry: d,
          updatedAt: Number(d.updatedAt || d.createdAt || 0),
        };
      })
      .filter(function (d) { return d.id && d.name; });
    if (!rows.length) {
      ui.leftLibraryList.innerHTML = "<div class='hint'>No saved datasets.</div>";
      return;
    }
    const activeId = String(state.activeDatasetId || "").trim();
    const sortedRows = sortRowsByUpdatedThenCreated(rows);
    renderLeftCardEngine({
      emptyText: "No saved datasets.",
      items: sortedRows.map(function (r) {
        const updated = r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "-";
        return {
          id: r.id,
          title: r.name,
          titleTip: datasetCardStatsText(r.entry),
          metaLines: [
            "schema: " + r.schemaId,
            "updated: " + updated,
          ],
          active: r.id === activeId,
          actions: [
            { id: "rename", title: "Rename dataset", iconSvg: libraryIconSvg("rename") },
            { id: "delete", title: "Delete dataset", iconSvg: libraryIconSvg("delete") },
          ],
        };
      }),
      onOpen: function (datasetId) {
        handleDatasetLibraryOpen(datasetId);
      },
      onAction: function (datasetId, action) {
        const did = String(datasetId || "").trim();
        if (!did) return;
        if (action === "rename") {
          const hit = getSavedDatasetById(did);
          const curName = String((hit && hit.name) || "");
          const next = String(window.prompt("Rename dataset", curName) || "").trim();
          if (!next || next === curName) return;
          try {
            renameSavedDatasetById(did, next);
          } catch (err) {
            setStatus("Rename dataset failed: " + err.message);
          }
          return;
        }
        if (action === "delete") {
          deleteSavedDatasetById(did);
        }
      },
    });
  }

  function renderLeftModelLibraryItems() {
    ensureLibraryEntityIds();
    const rows = state.savedModels
      .filter(Boolean)
      .map(function (m) {
        return {
          id: String(m.id || "").trim(),
          name: String(m.name || "").trim(),
          schemaId: getSavedModelSchemaId(m, "oscillator"),
          updatedAt: Number(m.updatedAt || m.createdAt || 0),
        };
      })
      .filter(function (m) { return m.id && m.name; });
    if (!rows.length) {
      ui.leftLibraryList.innerHTML = "<div class='hint'>No saved models.</div>";
      return;
    }
    const activeId = String(state.activeModelId || "").trim();
    const sortedRows = sortRowsByUpdatedThenCreated(rows);
    renderLeftCardEngine({
      emptyText: "No saved models.",
      items: sortedRows.map(function (r) {
        return {
          id: r.id,
          title: r.name,
          active: r.id === activeId,
          metaLines: [
            "schema: " + r.schemaId,
            "updated: " + new Date(r.updatedAt || Date.now()).toLocaleString(),
          ],
          actions: [
            { id: "rename", title: "Rename model", iconSvg: libraryIconSvg("rename") },
            { id: "delete", title: "Delete model", iconSvg: libraryIconSvg("delete") },
          ],
        };
      }),
      onOpen: function (modelId) {
        handleModelLibraryOpen(modelId);
      },
      onAction: function (modelId, action) {
        const mid = String(modelId || "").trim();
        if (!mid) return;
        if (action === "rename") {
          const hit = getSavedModelById(mid);
          const curName = String((hit && hit.name) || "");
          const next = String(window.prompt("Rename model", curName) || "").trim();
          if (!next || next === curName) return;
          try {
            renameSavedModel(mid, next);
          } catch (err) {
            setTrainSessionStatus("Rename model failed: " + err.message);
          }
          return;
        }
        if (action === "delete") {
          deleteSavedModelById(mid);
          setTrainSessionStatus("Deleted model.");
        }
      },
    });
  }

  function renderLeftTrainingLibraryItems() {
    const rows = state.trainSessions.filter(Boolean);
    if (!rows.length) {
      ui.leftLibraryList.innerHTML = "<div class='hint'>No training sessions.</div>";
      return;
    }
    const activeId = resolveActiveTrainSessionId(state.activeTrainSessionId);
    if (String(state.activeTrainSessionId || "") !== activeId) {
      state.activeTrainSessionId = activeId;
    }
    rows.forEach(function (s) { normalizeTrainSessionRecord(s); });
    const sortedRows = sortRowsByUpdatedThenCreated(rows.map(function (s) {
      return {
        id: String(s.id || ""),
        name: String(s.name || s.id || ""),
        updatedAt: Number((s && s.updatedAt) || 0),
        createdAt: Number((s && s.createdAt) || 0),
        rawSession: s,
      };
    }));
    renderLeftCardEngine({
      emptyText: "No training sessions.",
      items: sortedRows.map(function (r) {
        const s = r.rawSession;
        return {
          id: String(s.id || ""),
          title: String(s.name || s.id || ""),
          active: String(s.id || "") === activeId,
          metaLines: [
            "runtime: " + String(s.runtime || "js_client"),
            "dataset: " + getSavedDatasetLabelById(s.datasetId, s.datasetName),
            "model: " + getSavedModelLabelById(s.modelId, s.modelName),
          ],
          actions: [
            { id: "rename", title: "Rename trainer", iconSvg: libraryIconSvg("rename") },
            { id: "delete", title: "Delete trainer", iconSvg: libraryIconSvg("delete") },
          ],
        };
      }),
      onOpen: function (sessionId) {
        handleTrainingLibraryOpen(sessionId);
      },
      onAction: function (sessionId, action) {
        const sid = String(sessionId || "").trim();
        const s = getTrainSessionById(sid);
        if (!sid || !s) return;
        if (action === "rename") {
          const curName = String(s.name || sid);
          const next = String(window.prompt("Rename trainer", curName) || "").trim();
          if (!next || next === curName) return;
          s.name = next;
          s.updatedAt = Date.now();
          renderTrainSessionTable();
          syncWorkspaceStoreFromState("rename_train_session");
          return;
        }
        if (action === "delete") {
          if (!window.confirm("Delete trainer '" + String(s.name || sid) + "'?")) return;
          state.trainSessions = state.trainSessions.filter(function (x) { return String(x.id || "") !== sid; });
          if (String(state.activeTrainSessionId || "") === sid) {
            state.activeTrainSessionId = resolveActiveTrainSessionId("");
          }
          renderTrainSessionTable();
          syncWorkspaceStoreFromState("delete_train_session");
          setTrainSessionStatus("Deleted trainer: " + String(s.name || sid));
        }
      },
    });
  }

  function getTrainSessionInspectorConfig(session) {
    const s = session || {};
    const cfg = ensureTrainSessionConfigDefaults(s);
    return {
      schemaId: String(s.schemaId || "oscillator"),
      datasetId: String(s.datasetId || ""),
      modelId: String(s.modelId || ""),
      runtime: normalizeRuntimeId(s.runtime || "js_client"),
      runtimeBackend: normalizeRuntimeBackend(s.runtime || "js_client", s.runtimeBackend || "auto"),
      epochs: Number(cfg.epochs || 40),
      batchSize: Number(cfg.batchSize || 64),
      optimizerType: normalizeOptimizerType(cfg.optimizerType || "adam", "adam"),
      learningRate: Number(cfg.learningRate || 1e-3),
      lrSchedulerType: normalizeLrSchedulerType(cfg.lrSchedulerType || (cfg.useLrScheduler ? "plateau" : "none"), "plateau"),
      lrPatience: Number(cfg.lrPatience || 3),
      lrFactor: Number(cfg.lrFactor || 0.5),
      minLr: Number(cfg.minLr || 1e-6),
      gradClipNorm: Number(cfg.gradClipNorm || 0),
      gradClipValue: Number(cfg.gradClipValue || 0),
      restoreBestWeights: Boolean(cfg.restoreBestWeights),
      earlyStoppingPatience: Number(cfg.earlyStoppingPatience || 0),
    };
  }

  function buildTrainSessionInspectorSchema(session) {
    const s = session || {};
    const runtimeId = normalizeRuntimeId(s.runtime || "js_client");
    const datasetOpts = datasetOptionDefs(s.schemaId);
    const modelOpts = modelOptionDefs(s.schemaId);
    return [
      { key: "schemaId", label: "Schema", type: "text", disabled: true },
      {
        key: "modelId",
        label: "Model",
        type: "select",
        options: modelOpts.length ? modelOpts : [{ value: "", label: "(no saved model for schema)" }],
      },
      {
        key: "datasetId",
        label: "Dataset",
        type: "select",
        options: datasetOpts.length ? datasetOpts : [{ value: "", label: "(no saved dataset for schema)" }],
      },
      { key: "runtime", label: "Runtime", type: "select", options: runtimeOptionDefs() },
      { key: "runtimeBackend", label: "Backend", type: "select", options: runtimeBackendOptionDefs(runtimeId) },
      { key: "epochs", label: "Epochs", type: "number", min: 1, parse: function (v) { return Math.max(1, Number(v) || 1); } },
      { key: "batchSize", label: "Batch size", type: "number", min: 1, parse: function (v) { return Math.max(1, Number(v) || 1); } },
      { key: "optimizerType", label: "Optimizer", type: "select", options: OPTIMIZER_OPTION_DEFS },
      { key: "learningRate", label: "Learning rate", type: "number", min: 1e-7, step: 1e-7, parse: function (v) { return Math.max(1e-7, Number(v) || 1e-3); } },
      { key: "lrSchedulerType", label: "LR scheduler", type: "select", options: LR_SCHEDULER_OPTION_DEFS },
      { key: "lrPatience", label: "LR patience", type: "number", min: 1, parse: function (v) { return Math.max(1, Number(v) || 3); } },
      { key: "lrFactor", label: "LR factor", type: "number", min: 0.01, max: 0.99, step: 0.01, parse: function (v) { return Math.min(0.99, Math.max(0.01, Number(v) || 0.5)); } },
      { key: "minLr", label: "Min LR", type: "number", min: 1e-8, step: 1e-8, parse: function (v) { return Math.max(1e-8, Number(v) || 1e-6); } },
      { key: "gradClipNorm", label: "Grad clip norm", type: "number", min: 0, step: 0.1, parse: function (v) { return Math.max(0, Number(v) || 0); } },
      { key: "gradClipValue", label: "Grad clip value", type: "number", min: 0, step: 0.1, parse: function (v) { return Math.max(0, Number(v) || 0); } },
      { key: "restoreBestWeights", label: "Restore best weights", type: "checkbox" },
      { key: "earlyStoppingPatience", label: "Early stop patience", type: "number", min: 0, parse: function (v) { return Math.max(0, Number(v) || 0); } },
    ];
  }

  function setTrainSessionInspectorConfig(session, config, changedKey) {
    const s = session || {};
    const next = config && typeof config === "object" ? config : {};
    const key = String(changedKey || "").trim();
    const trainCfg = ensureTrainSessionConfigDefaults(s);
    const prevDatasetId = String(s.datasetId || "").trim();
    const prevModelId = String(s.modelId || "").trim();
    const prevRuntime = normalizeRuntimeId(s.runtime || "js_client");
    const prevRuntimeBackend = normalizeRuntimeBackend(prevRuntime, s.runtimeBackend || "auto");
    let syncReason = "update_train_cfg";
    let rerenderSessionCard = false;
    let rerenderInspector = false;
    let clearReason = "";

    if (!key || key === "modelId") {
      s.modelId = String(next.modelId || "").trim();
      s.modelName = getSavedModelLabelById(s.modelId, s.modelName);
      syncReason = key ? "update_train_model" : syncReason;
      rerenderSessionCard = rerenderSessionCard || !key || key === "modelId";
    }
    if (!key || key === "datasetId") {
      s.datasetId = String(next.datasetId || "").trim();
      s.datasetName = getSavedDatasetLabelById(s.datasetId, s.datasetName);
      syncReason = key ? "update_train_dataset" : syncReason;
      rerenderSessionCard = rerenderSessionCard || !key || key === "datasetId";
    }
    if (!key || key === "runtime") {
      s.runtime = normalizeRuntimeId(next.runtime || s.runtime || "js_client");
      const backendSource = key === "runtime" ? next.runtimeBackend : (next.runtimeBackend || s.runtimeBackend);
      s.runtimeBackend = normalizeRuntimeBackend(s.runtime, backendSource || "auto");
      syncReason = key ? "update_train_runtime" : syncReason;
      rerenderSessionCard = rerenderSessionCard || !key || key === "runtime";
      rerenderInspector = rerenderInspector || !key || key === "runtime";
    }
    if (!key || key === "runtimeBackend") {
      s.runtime = normalizeRuntimeId(s.runtime || "js_client");
      s.runtimeBackend = normalizeRuntimeBackend(s.runtime, next.runtimeBackend || s.runtimeBackend || "auto");
      syncReason = key ? "update_train_runtime_backend" : syncReason;
      rerenderSessionCard = rerenderSessionCard || !key || key === "runtimeBackend";
    }
    if (!key || key === "epochs") trainCfg.epochs = Math.max(1, Number(next.epochs) || 1);
    if (!key || key === "batchSize") trainCfg.batchSize = Math.max(1, Number(next.batchSize) || 1);
    if (!key || key === "optimizerType") trainCfg.optimizerType = normalizeOptimizerType(next.optimizerType, "adam");
    if (!key || key === "learningRate") trainCfg.learningRate = Math.max(1e-7, Number(next.learningRate) || 1e-3);
    if (!key || key === "lrSchedulerType") {
      trainCfg.lrSchedulerType = normalizeLrSchedulerType(next.lrSchedulerType, "plateau");
      trainCfg.useLrScheduler = trainCfg.lrSchedulerType !== "none";
    }
    if (!key || key === "lrPatience") trainCfg.lrPatience = Math.max(1, Number(next.lrPatience) || 3);
    if (!key || key === "lrFactor") trainCfg.lrFactor = Math.min(0.99, Math.max(0.01, Number(next.lrFactor) || 0.5));
    if (!key || key === "minLr") trainCfg.minLr = Math.max(1e-8, Number(next.minLr) || 1e-6);
    if (!key || key === "gradClipNorm") trainCfg.gradClipNorm = Math.max(0, Number(next.gradClipNorm) || 0);
    if (!key || key === "gradClipValue") trainCfg.gradClipValue = Math.max(0, Number(next.gradClipValue) || 0);
    if (!key || key === "restoreBestWeights") trainCfg.restoreBestWeights = Boolean(next.restoreBestWeights);
    if (!key || key === "earlyStoppingPatience") trainCfg.earlyStoppingPatience = Math.max(0, Number(next.earlyStoppingPatience) || 0);
    s.trainCfg = trainCfg;
    s.runtimeFamily = runtimeFamilyFor(s.runtime);
    if (key === "datasetId" && String(s.datasetId || "").trim() !== prevDatasetId) {
      clearReason = "dataset changed";
      syncReason = "clear_train_session_dataset";
    } else if (key === "modelId" && String(s.modelId || "").trim() !== prevModelId) {
      clearReason = "model changed";
      syncReason = "clear_train_session_model";
    } else if (key === "runtime" && normalizeRuntimeId(s.runtime || "js_client") !== prevRuntime) {
      clearReason = "runtime changed";
      syncReason = "clear_train_session_runtime";
    } else if (key === "runtimeBackend" && normalizeRuntimeBackend(s.runtime || "js_client", s.runtimeBackend || "auto") !== prevRuntimeBackend) {
      clearReason = "runtime backend changed";
      syncReason = "clear_train_session_runtime_backend";
    }
    if (clearReason) {
      clearTrainSessionState(s, clearReason);
      rerenderSessionCard = true;
      rerenderInspector = true;
      setTrainSessionStatus("Trainer session cleared: " + clearReason + ".");
    } else {
      s.status = normalizeTrainSessionStatus(s);
      s.lockState = normalizeTrainSessionLockState(s);
      if (!s.runtimeStatus || typeof s.runtimeStatus !== "object") {
        s.runtimeStatus = {
          state: String(s.status || "ready"),
          message: "",
          ts: Date.now(),
          runtimeId: String(s.runtime || "js_client"),
          backend: String(s.runtimeBackend || "auto"),
          transport: "",
          engine: "",
          host: "",
        };
      }
    }
    s.updatedAt = Date.now();
    syncWorkspaceStoreFromState(syncReason);
    if (rerenderSessionCard) renderTrainSessionTable();
    if (rerenderInspector && !rerenderSessionCard) renderRightTrainConfigPanel();
  }

  function getActiveTrainInspectorConfig() {
    const ctrl = state.rightInspectorForms && state.rightInspectorForms.train;
    if (ctrl && typeof ctrl.getConfig === "function") return ctrl.getConfig();
    const s = getActiveTrainSession();
    if (!s) return null;
    return getTrainSessionInspectorConfig(s);
  }

  function setActiveTrainInspectorConfig(nextConfig) {
    const s = getActiveTrainSession();
    if (!s) return false;
    setTrainSessionInspectorConfig(s, nextConfig || {}, "");
    const ctrl = state.rightInspectorForms && state.rightInspectorForms.train;
    if (ctrl && typeof ctrl.setConfig === "function") {
      ctrl.setConfig(getTrainSessionInspectorConfig(s));
    }
    return true;
  }

  function renderRightTrainConfigPanel() {
    if (!ui.rightTrainConfigMount) return;
    if (state.rightInspectorForms && state.rightInspectorForms.train &&
        typeof state.rightInspectorForms.train.destroy === "function") {
      state.rightInspectorForms.train.destroy();
      state.rightInspectorForms.train = null;
    }
    const activeId = resolveActiveTrainSessionId(state.activeTrainSessionId);
    if (String(state.activeTrainSessionId || "") !== activeId) {
      state.activeTrainSessionId = activeId;
    }
    const s = getTrainSessionById(activeId);
    if (!s) {
      if (ui.rightTrainConfigTitle) ui.rightTrainConfigTitle.textContent = "Training Config";
      ui.rightTrainConfigMount.innerHTML = "<div class='hint'>No trainer selected. Select a trainer from the left panel.</div>";
      return;
    }
    normalizeTrainSessionRecord(s);
    if (ui.rightTrainConfigTitle) ui.rightTrainConfigTitle.textContent = "Training Config (" + String(s.name || s.id || "") + ")";
    const formValue = getTrainSessionInspectorConfig(s);
    const formSchema = buildTrainSessionInspectorSchema(s);
    state.rightInspectorForms.train = renderSharedConfigForm({
      mountEl: ui.rightTrainConfigMount,
      schema: formSchema,
      value: formValue,
      fieldNamePrefix: "trainCfg",
      onChange: function (nextConfig, ctx) {
        const changedKey = ctx && ctx.key ? String(ctx.key) : "";
        setTrainSessionInspectorConfig(s, nextConfig, changedKey);
      },
    });
  }

  function refreshRightInspectorPanels() {
    if (!ui.rightRail) return;
    const ws = String(state.currentWorkspace || "preview");
    if (ui.rightDataLabPanel) ui.rightDataLabPanel.style.display = (ws === "dataset" || ws === "preview") ? "" : "none";
    if (ui.rightModelPanel) ui.rightModelPanel.style.display = ws === "nn" ? "" : "none";
    if (ui.rightTrainPanel) ui.rightTrainPanel.style.display = ws === "train" ? "" : "none";
    if (ui.rightDataLabPanelTitle && ws === "preview") ui.rightDataLabPanelTitle.textContent = "Playground Inspector";
    if (ui.rightDataLabPanelTitle && ws === "dataset") ui.rightDataLabPanelTitle.textContent = "Data Lab Inspector";
    if (ui.rightDataLabInfo && (ws === "dataset" || ws === "preview")) {
      const moduleId = getWorkspaceDatasetModuleId(ws);
      const mod = getDatasetModule(moduleId);
      const active = getSavedDatasetById(state.activeDatasetId);
      const schemaId = String((mod && mod.schemaId) || "-");
      const isPreview = ws === "preview";
      refreshRightDataLabConfigTitle();
      ui.rightDataLabInfo.textContent = isPreview
        ? (
          "module=" + String((mod && mod.label) || moduleId || "-") +
          " | schema=" + schemaId +
          " | interactive=" + (String(getPlaygroundMode(moduleId || "")) ? "yes" : "no")
        )
        : (
        "module=" + String((mod && mod.label) || moduleId || "-") +
        " | schema=" + schemaId +
        (active ? (" | active_dataset=" + String(active.name || active.id || "")) : " | active_dataset=(none)")
      );
    }
    if (ui.rightTrainInfo && ws === "train") {
      const total = state.trainSessions.length;
      const activeSession = getActiveTrainSession();
      ui.rightTrainInfo.textContent =
        "trainers=" + total +
        " | selected=" + (activeSession ? String(activeSession.name || activeSession.id || "") : "(none)");
      renderRightTrainConfigPanel();
    }
  }

  function refreshRightDataLabConfigTitle() {
    if (!ui.rightDataLabConfigTitle) return;
    const ws = String(state.currentWorkspace || "preview");
    const moduleId = getWorkspaceDatasetModuleId(ws);
    const mod = getDatasetModule(moduleId);
    const schemaId = resolveSchemaId((mod && mod.schemaId) || "oscillator");
    const label = String((mod && mod.label) || moduleId || schemaId);
    const prefix = ws === "preview" ? "Playground Config" : "Dataset Config";
    ui.rightDataLabConfigTitle.textContent = prefix + " (" + label + " / " + schemaId + ")";
  }

  function closeEntityCreateModal() {
    if (!ui.entityCreateModalBackdrop) return;
    if (state.entityCreateForm && typeof state.entityCreateForm.destroy === "function") {
      state.entityCreateForm.destroy();
    }
    state.entityCreateForm = null;
    if (typeof document !== "undefined" && document.activeElement && ui.entityCreateModalBackdrop.contains(document.activeElement)) {
      try { document.activeElement.blur(); } catch (_err) {}
    }
    ui.entityCreateModalBackdrop.classList.remove("open");
    ui.entityCreateModalBackdrop.setAttribute("aria-hidden", "true");
    state.entityCreateContext = null;
  }

  function pickOptionValue(options, preferred) {
    return ENTITY_CREATE_CORE.pickOptionValue(options, preferred);
  }

  function buildEntityCreateSchemaOptions(ctx) {
    const c = ctx || {};
    return ENTITY_CREATE_CORE.buildSchemaOptions(c.schemaEntries || [], resolveSchemaId);
  }

  function normalizeEntityCreateFormConfig(ctx, raw) {
    const c = ctx || {};
    const cfg = raw && typeof raw === "object" ? raw : {};
    return ENTITY_CREATE_CORE.normalizeCreateForm(c, cfg, {
      resolveSchemaId: resolveSchemaId,
      normalizeRuntimeId: normalizeRuntimeId,
      normalizeRuntimeBackend: normalizeRuntimeBackend,
      getModelSchemaId: function (modelId) {
        const modelEntry = getSavedModelById(modelId);
        if (!modelEntry) return "";
        return getSavedModelSchemaId(modelEntry, c.defaultSchemaId || "oscillator");
      },
      getDatasetOptions: function (schemaId) {
        return datasetOptionDefs(schemaId);
      },
      getModelOptionsAll: function () {
        return modelOptionDefsAll();
      },
    });
  }

  function buildEntityCreateFormSchema(ctx) {
    const c = ctx || {};
    const schemaOptions = buildEntityCreateSchemaOptions(c);
    const rows = [
      {
        key: "name",
        label: String(c.nameLabel || "Name"),
        type: "text",
        parse: function (v) { return String(v || "").trim(); },
      },
    ];
    if (c.kind === "trainer") {
      rows.push({
        key: "schemaId",
        label: "Schema",
        type: "select",
        options: schemaOptions,
        parse: function (v) {
          const next = pickOptionValue(schemaOptions, v || c.defaultSchemaId || "oscillator");
          return resolveSchemaId(next || c.defaultSchemaId || "oscillator");
        },
      });
    } else if (c.kind === "dataset") {
      rows.push({
        key: "schemaId",
        label: "Schema",
        type: "select",
        options: schemaOptions,
        parse: function (v) {
          const next = pickOptionValue(schemaOptions, v || c.defaultSchemaId || "oscillator");
          return resolveSchemaId(next || c.defaultSchemaId || "oscillator");
        },
      });
    } else {
      rows.push({
        key: "schemaId",
        label: "Schema",
        type: "select",
        options: schemaOptions,
        parse: function (v) {
          const next = pickOptionValue(schemaOptions, v || c.defaultSchemaId || "oscillator");
          return resolveSchemaId(next || c.defaultSchemaId || "oscillator");
        },
      });
    }
    return rows;
  }

  function updateEntityCreateFootnote(ctx, formCfg) {
    if (!ui.entityCreateFootnote) return;
    const c = ctx || {};
    const cfg = normalizeEntityCreateFormConfig(c, formCfg || {});
    const schemaId = resolveSchemaId(cfg.schemaId || c.defaultSchemaId || "oscillator");
    if (c.kind === "dataset") {
      ui.entityCreateFootnote.textContent = getDatasetModuleHelpText(pickDefaultDatasetModuleForSchema(schemaId), schemaId);
      return;
    }
    if (c.kind === "model") {
      const dsSchema = getDatasetSchemaConfig(schemaId);
      const label = String((dsSchema && dsSchema.label) || schemaId);
      ui.entityCreateFootnote.textContent = "Create blank model graph for schema '" + label + "' (" + schemaId + ").";
      return;
    }
    if (c.kind === "trainer") {
      const dsList = state.savedDatasets.filter(function (d) { return getSavedDatasetSchemaId(d, schemaId) === schemaId; });
      const modelList = state.savedModels.filter(function (m) { return getSavedModelSchemaId(m, schemaId) === schemaId; });
      ui.entityCreateFootnote.textContent =
        "Trainer schema '" + schemaId + "' | datasets=" + dsList.length + " | models=" + modelList.length;
      return;
    }
    ui.entityCreateFootnote.textContent = "Configure name and schema, then create.";
  }

  function openEntityCreateModal(config) {
    const cfg = config || {};
    if (!ui.entityCreateModalBackdrop || !ui.entityCreateFormMount) return;

    const kind = String(cfg.kind || "").trim().toLowerCase();
    const defaultSchemaId = resolveSchemaId(cfg.defaultSchemaId || state.modelSchemaId || "oscillator");
    const schemaFilter = typeof cfg.schemaFilter === "function"
      ? cfg.schemaFilter
      : function () { return true; };
    const schemaEntries = listRegisteredSchemaEntries().filter(function (s) {
      return schemaFilter(resolveSchemaId(s.id || "oscillator"));
    });
    if (!schemaEntries.length) {
      throw new Error("No schema available for " + (kind || "item") + " creation.");
    }

    const nextSchemaId = schemaEntries.some(function (s) {
      return resolveSchemaId((s && s.id) || "oscillator") === defaultSchemaId;
    }) ? defaultSchemaId : resolveSchemaId((schemaEntries[0] && schemaEntries[0].id) || "oscillator");
    if (!nextSchemaId) {
      throw new Error("Schema selection is empty for " + (kind || "item") + " creation.");
    }

    if (ui.entityCreateModalTitle) ui.entityCreateModalTitle.textContent = String(cfg.title || "New Item");

    state.entityCreateContext = {
      kind: kind,
      defaultSchemaId: nextSchemaId,
      defaultRuntime: String(cfg.defaultRuntime || "js_client"),
      defaultRuntimeBackend: String(cfg.defaultRuntimeBackend || "auto"),
      nameLabel: String(cfg.nameLabel || "Name"),
      defaultName: String(cfg.defaultName || ""),
      schemaEntries: schemaEntries,
      onCreate: typeof cfg.onCreate === "function" ? cfg.onCreate : null,
    };

    if (state.entityCreateForm && typeof state.entityCreateForm.destroy === "function") {
      state.entityCreateForm.destroy();
    }
    state.entityCreateForm = null;
    const formSchema = buildEntityCreateFormSchema(state.entityCreateContext);
    const initialFormSeed = {
      name: String(cfg.defaultName || ""),
      schemaId: nextSchemaId,
      runtime: String(cfg.defaultRuntime || "js_client"),
      runtimeBackend: String(cfg.defaultRuntimeBackend || "auto"),
    };
    const formValue = normalizeEntityCreateFormConfig(state.entityCreateContext, initialFormSeed);
    state.entityCreateForm = renderSharedConfigForm({
      mountEl: ui.entityCreateFormMount,
      schema: formSchema,
      value: formValue,
      fieldNamePrefix: "entityCreate",
      onChange: function (nextFormConfig, changeCtx) {
        const changedKey = String((changeCtx && changeCtx.key) || "").trim();
        const rawCfg = nextFormConfig && typeof nextFormConfig === "object" ? nextFormConfig : {};
        const kind = String((state.entityCreateContext && state.entityCreateContext.kind) || "").trim().toLowerCase();
        const rawName = String(rawCfg.name || "").trim();
        const normalized = normalizeEntityCreateFormConfig(state.entityCreateContext, rawCfg);
        if ((kind === "dataset" || kind === "model") && changedKey === "schemaId" && isAutoEntityName(kind, rawName)) {
          normalized.name = buildDefaultEntityName(kind, normalized.schemaId);
        }
        if (state.entityCreateForm && typeof state.entityCreateForm.setConfig === "function") {
          state.entityCreateForm.setConfig(normalized);
        }
        updateEntityCreateFootnote(state.entityCreateContext, normalized);
      },
    });
    updateEntityCreateFootnote(state.entityCreateContext, formValue);
    ui.entityCreateModalBackdrop.classList.add("open");
    ui.entityCreateModalBackdrop.setAttribute("aria-hidden", "false");
    setTimeout(function () {
      const ctrl = state.entityCreateForm;
      const nameEl = ctrl && typeof ctrl.getFieldElement === "function"
        ? ctrl.getFieldElement("name")
        : null;
      if (nameEl && typeof nameEl.focus === "function") nameEl.focus();
    }, 0);
  }

  function openNewDatasetModal() {
    const currentModule = getDatasetModule(currentDatasetModuleId());
    const currentSchemaId = resolveSchemaId((currentModule && currentModule.schemaId) || "oscillator");
    openEntityCreateModal({
      kind: "dataset",
      title: "New Dataset",
      nameLabel: "Dataset name",
      defaultName: buildDefaultEntityName("dataset", currentSchemaId),
      defaultSchemaId: currentSchemaId,
      schemaFilter: function (sid) {
        return listDatasetModulesForSchema(sid).length > 0;
      },
      onCreate: function (payload) {
        createNewDatasetDraftFromSchema(payload.schemaId, payload.name);
      },
    });
  }

  function openNewModelModal() {
    const currentSchemaId = resolveSchemaId(
      String((ui.modelSchemaSelect && ui.modelSchemaSelect.value) || state.modelSchemaId || "oscillator")
    );
    openEntityCreateModal({
      kind: "model",
      title: "New Model",
      nameLabel: "Model name",
      defaultName: buildDefaultEntityName("model", currentSchemaId),
      defaultSchemaId: currentSchemaId,
      onCreate: function (payload) {
        createNewModelDraftFromSchema(payload.schemaId, payload.name);
      },
    });
  }

  function openNewTrainerModal() {
    const defaultTrainerSchemaId = pickDefaultTrainerSchemaId();
    openEntityCreateModal({
      kind: "trainer",
      title: "New Trainer",
      nameLabel: "Trainer name",
      defaultName: "session_" + formatTimestampForName(new Date()),
      defaultSchemaId: defaultTrainerSchemaId,
      defaultRuntime: "js_client",
      defaultRuntimeBackend: "auto",
      onCreate: function (payload) {
        addTrainSessionFromSpec(payload);
      },
    });
  }

  function createNewDatasetDraftFromSchema(schemaId, preferredName) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const moduleId = pickDefaultDatasetModuleForSchema(sid);
    if (!moduleId) throw new Error("No dataset module registered for schema '" + sid + "'.");
    const moduleDefaults = getDatasetModuleDatasetPreconfig(moduleId, sid);
    const now = Date.now();
    const draftName = String(preferredName || "").trim();
    if (!draftName) throw new Error("Dataset name is required.");
    const draftId = generateEntityId("ds");
    const draftEntry = {
      id: draftId,
      name: draftName,
      schemaId: sid,
      createdAt: now,
      updatedAt: now,
      data: {
        schemaId: sid,
        datasetModuleId: moduleId,
        seed: Number(moduleDefaults.seed),
        totalCount: Number(moduleDefaults.totalCount),
        mode: "",
        draft: true,
        splitConfig: {
          mode: String(moduleDefaults.mode || "random"),
          train: Number(moduleDefaults.fractions.train || 0.8),
          val: Number(moduleDefaults.fractions.val || 0.1),
          test: Number(moduleDefaults.fractions.test || 0.1),
        },
      },
    };
    state.savedDatasets.unshift(draftEntry);
    state.dataset = null;
    state.preparedDataset = null;
    state.activeDatasetId = String(draftId);
    state.activeDatasetName = String(draftName);
    setActiveDatasetModuleId(moduleId, sid);
    if (state.datasetsByMode) {
      state.datasetsByMode.autoregressive = null;
      state.datasetsByMode.direct = null;
    }
    applyDatasetModuleUi(moduleId);
    syncWorkspaceStoreFromState("new_dataset_draft");
    refreshSavedDatasetSelect();
    loadSavedDatasetById(draftId, { skipUiSync: true });
    showDataLabSubTab("preview");
    setStatus("New dataset draft created and selected.");
  }

  function pickDefaultTrainerSchemaId() {
    const fallback = resolveSchemaId(state.modelSchemaId || "oscillator");
    const entries = listRegisteredSchemaEntries();
    if (!entries.length) return fallback;
    const rows = entries.map(function (s) {
      const sid = resolveSchemaId((s && s.id) || fallback);
      return {
        schemaId: sid,
        datasetCount: datasetOptionDefs(sid).length,
        modelCount: modelOptionDefs(sid).length,
      };
    });
    const withBoth = rows.find(function (r) { return r.datasetCount > 0 && r.modelCount > 0; });
    if (withBoth && withBoth.schemaId) return withBoth.schemaId;
    const fallbackRow = rows.find(function (r) { return r.schemaId === fallback; });
    if (fallbackRow && (fallbackRow.datasetCount > 0 || fallbackRow.modelCount > 0)) return fallback;
    const withDataset = rows.find(function (r) { return r.datasetCount > 0; });
    if (withDataset && withDataset.schemaId) return withDataset.schemaId;
    const withModel = rows.find(function (r) { return r.modelCount > 0; });
    if (withModel && withModel.schemaId) return withModel.schemaId;
    return fallback;
  }

  function createNewModelDraftFromSchema(schemaId, preferredName) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const proceedCreateModelDraft = function () {
      const preset = getDefaultModelPreset(sid);
      if (!preset) throw new Error("No default model preset configured for schema '" + sid + "'.");
      const draftName = String(preferredName || "").trim();
      if (!draftName) throw new Error("Model name is required.");

      if (!MODEL_GRAPH_DRAWFLOW_ADAPTER || typeof MODEL_GRAPH_DRAWFLOW_ADAPTER.createDrawflowGraphFromPreset !== "function") {
        throw new Error("Model graph drawflow adapter is not available.");
      }

      const graphPayload = assertValidDrawflowGraph(
        MODEL_GRAPH_DRAWFLOW_ADAPTER.createDrawflowGraphFromPreset(sid, preset),
        "Preset graph '" + String(preset || "") + "'"
      );
      const now = Date.now();
      const nextEntry = {
        id: generateEntityId("model"),
        name: draftName,
        createdAt: now,
        updatedAt: now,
        schemaId: sid,
        preset: String(preset || "custom"),
        graph: graphPayload,
        draft: true,
      };
      const existingIdx = state.savedModels.findIndex(function (m) {
        return String((m && m.name) || "") === draftName;
      });
      if (existingIdx >= 0) {
        nextEntry.id = String(state.savedModels[existingIdx].id || nextEntry.id);
        nextEntry.createdAt = Number(state.savedModels[existingIdx].createdAt || now);
        state.savedModels[existingIdx] = nextEntry;
      } else {
        state.savedModels.push(nextEntry);
      }

      setCurrentModelSchema(sid);
      refreshSavedModelSelect();
      refreshTrainSessionSelectors();
      renderLeftModelLibraryItems();
      loadSavedModelById(nextEntry.id);
      markLeftLibraryItemActiveById(nextEntry.id);
      if (state.currentWorkspace === "nn") renderLeftLibraryByWorkspace();
      refreshModelLabSelectionState();
      syncWorkspaceStoreFromState("new_model_draft");
      setTrainSessionStatus("New model draft created and selected.");
    };
    if (isCurrentGraphEmpty()) {
      proceedCreateModelDraft();
      return;
    }
    runWithUnsavedModelGuard("creating a new model", proceedCreateModelDraft);
  }

  function formatTimestampForName(d) {
    const dt = d || new Date();
    const yyyy = String(dt.getFullYear());
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    const hh = String(dt.getHours()).padStart(2, "0");
    const mi = String(dt.getMinutes()).padStart(2, "0");
    const ss = String(dt.getSeconds()).padStart(2, "0");
    const ms = String(dt.getMilliseconds()).padStart(3, "0");
    return yyyy + mm + dd + "_" + hh + mi + ss + ms;
  }

  function buildDefaultEntityName(kind, schemaId) {
    const k = String(kind || "").trim().toLowerCase();
    const sid = resolveSchemaId(schemaId || "oscillator");
    const ts = formatTimestampForName(new Date());
    if (k === "dataset") return "dataset_" + sid + "_" + ts;
    if (k === "model") return "model_" + sid + "_" + ts;
    return "item_" + ts;
  }

  function isAutoEntityName(kind, name) {
    const k = String(kind || "").trim().toLowerCase();
    const n = String(name || "").trim();
    if (!n) return true;
    if (k === "dataset") return /^dataset_.+_\d{8}_\d{9}$/.test(n);
    if (k === "model") return /^model_.+_\d{8}_\d{9}$/.test(n);
    return false;
  }

  function buildSuggestedDatasetName(seed, scenarios) {
    const s = Array.isArray(scenarios) && scenarios.length ? scenarios.join("-") : "mixed";
    return "ds_s" + String(seed || 42) + "_" + s + "_" + formatTimestampForName(new Date());
  }

  function clearDatasetViews(reasonText, options) {
    const opts = options || {};
    const preserveSelection = Boolean(opts.preserveSelection);
    const schemaId = resolveSchemaId(
      opts.schemaId ||
      (state.dataset && state.dataset.schemaId) ||
      (state.activeDatasetId ? getSavedDatasetSchemaId(getSavedDatasetById(state.activeDatasetId), "oscillator") : "") ||
      currentDatasetModuleId() ||
      "oscillator"
    );
    const profile = getUiProfileForSchema(schemaId);
    const useImageView = String((profile && profile.viewer) || "").trim().toLowerCase() === "image";
    state.preparedDataset = null;
    state.renderedDatasetId = "";
    if (!preserveSelection) {
      state.activeDatasetId = "";
      state.activeDatasetName = "";
    }
    if (ui.dataTrajIdx) ui.dataTrajIdx.innerHTML = "";
    renderEmptyDatasetTableMessage("No saved dataset selected.");
    if (ui.tableDatasetInfo) ui.tableDatasetInfo.textContent = "Table Dataset: (none)";
    if (ui.datasetImageSplit) ui.datasetImageSplit.innerHTML = "";
    if (ui.datasetImageIndex) ui.datasetImageIndex.innerHTML = "";
    if (ui.datasetGenericTableBody) ui.datasetGenericTableBody.innerHTML = "<tr><td>note</td><td>No saved dataset selected.</td></tr>";
    if (ui.dataTableBody && (!ui.datasetOscillatorTableWrap || ui.datasetOscillatorTableWrap.style.display !== "none")) {
      ui.dataTableBody.innerHTML = "<tr><td colspan='17'>No saved dataset selected.</td></tr>";
    }
    clearDatasetImageCanvas();
    if (ui.datasetImageInfo) ui.datasetImageInfo.textContent = "Select split and sample to preview image.";
    if (ui.mnistClassGrid) ui.mnistClassGrid.innerHTML = "";
    if (ui.datasetChart && window.Plotly && !useImageView) {
      setDatasetChartVisibility(true);
      Plotly.newPlot(
        ui.datasetChart,
        [{ x: [0], y: [0], mode: "lines", name: "dataset" }],
        {
          paper_bgcolor: "#0b1220",
          plot_bgcolor: "#0b1220",
          font: { color: "#e2e8f0" },
          title: "No dataset loaded",
          xaxis: { title: "time (s)", gridcolor: "#1e293b" },
          yaxis: { title: "state", gridcolor: "#1e293b" },
        },
        { responsive: true }
      );
    } else {
      setDatasetChartVisibility(false);
    }
    refreshGenerationRefOptions();
    refreshDatasetDetailPanel();
    refreshRightInspectorPanels();
    setStatus(reasonText || "No dataset loaded.");
  }

  function sanitizeFileStem(name) {
    return String(name || "item")
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "item";
  }

  function generateEntityId(prefix) {
    const p = String(prefix || "id");
    return p + "_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
  }

  function getSavedDatasetById(id) {
    const did = String(id || "").trim();
    if (!did) return null;
    return state.savedDatasets.find(function (d) { return String((d && d.id) || "") === did; }) || null;
  }

  function getSavedModelById(id) {
    const mid = String(id || "").trim();
    if (!mid) return null;
    return state.savedModels.find(function (m) { return String((m && m.id) || "") === mid; }) || null;
  }

  function getSavedDatasetByName(name) {
    const n = String(name || "").trim();
    return state.savedDatasets.find(function (d) { return String((d && d.name) || "") === n; }) || null;
  }

  function getSavedModelByName(name) {
    const n = String(name || "").trim();
    return state.savedModels.find(function (m) { return String((m && m.name) || "") === n; }) || null;
  }

  function getSavedDatasetIdByName(name) {
    const d = getSavedDatasetByName(name);
    return d ? String(d.id || "") : "";
  }

  function getSavedModelIdByName(name) {
    const m = getSavedModelByName(name);
    return m ? String(m.id || "") : "";
  }

  function getSavedDatasetLabelById(id, fallback) {
    const d = getSavedDatasetById(id);
    if (d && d.name) return String(d.name);
    const fb = String(fallback || "").trim();
    return fb || "-";
  }

  function getSavedModelLabelById(id, fallback) {
    const m = getSavedModelById(id);
    if (m && m.name) return String(m.name);
    const fb = String(fallback || "").trim();
    return fb || "-";
  }

  function getSavedDatasetSchemaId(entry, fallbackSchemaId) {
    return datasetSchemaIdOf(entry, fallbackSchemaId || "oscillator");
  }

  function getSavedModelSchemaId(entry, fallbackSchemaId) {
    return modelSchemaIdOf(entry, fallbackSchemaId || "oscillator");
  }

  function getFirstSavedDatasetIdForSchema(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const sorted = sortRowsByUpdatedThenCreated(state.savedDatasets.map(function (d) {
      if (!d) return null;
      return {
        id: String(d.id || "").trim(),
        name: String(d.name || "").trim(),
        schemaId: getSavedDatasetSchemaId(d, sid),
        updatedAt: Number(d.updatedAt || d.createdAt || 0),
        createdAt: Number(d.createdAt || 0),
      };
    }).filter(function (x) { return x.id && x.name; })).filter(function (x) {
      return resolveSchemaId(x.schemaId) === sid;
    });
    const hit = sorted[0];
    return hit ? String(hit.id || "") : "";
  }

  function getFirstSavedModelIdForSchema(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    const sorted = sortRowsByUpdatedThenCreated(state.savedModels.map(function (m) {
      if (!m) return null;
      return {
        id: String(m.id || "").trim(),
        name: String(m.name || "").trim(),
        schemaId: getSavedModelSchemaId(m, sid),
        updatedAt: Number(m.updatedAt || m.createdAt || 0),
        createdAt: Number(m.createdAt || 0),
      };
    }).filter(function (x) { return x.id && x.name; })).filter(function (x) {
      return resolveSchemaId(x.schemaId) === sid;
    });
    const hit = sorted[0];
    return hit ? String(hit.id || "") : "";
  }

  function inferSessionSchemaId(session, fallbackSchemaId) {
    const s = session || {};
    const fb = resolveSchemaId(fallbackSchemaId || state.modelSchemaId || "oscillator");
    const ds = getSavedDatasetById(s.datasetId);
    const model = getSavedModelById(s.modelId);
    return resolveSchemaId(
      s.schemaId ||
      (ds && getSavedDatasetSchemaId(ds, fb)) ||
      (model && getSavedModelSchemaId(model, fb)) ||
      fb
    );
  }

  function getTrainSessionById(sessionId) {
    const sid = String(sessionId || "").trim();
    if (!sid) return null;
    return state.trainSessions.find(function (s) {
      return String((s && s.id) || "") === sid;
    }) || null;
  }

  function resolveActiveTrainSessionId(preferredSessionId) {
    const preferred = String(preferredSessionId || "").trim();
    if (!state.trainSessions.length) return "";
    if (preferred && getTrainSessionById(preferred)) return preferred;
    const current = String(state.activeTrainSessionId || "").trim();
    if (current && getTrainSessionById(current)) return current;
    const latest = sortRowsByUpdatedThenCreated(state.trainSessions.map(function (s) {
      if (!s) return null;
      return {
        id: String(s.id || "").trim(),
        updatedAt: Number(s.updatedAt || s.createdAt || 0),
        createdAt: Number(s.createdAt || 0),
      };
    }).filter(function (s) { return s && s.id; }))[0];
    return latest ? String(latest.id || "") : "";
  }

  function getActiveTrainSession() {
    const sid = resolveActiveTrainSessionId(state.activeTrainSessionId);
    if (!sid) return null;
    if (String(state.activeTrainSessionId || "") !== sid) {
      state.activeTrainSessionId = sid;
    }
    return getTrainSessionById(sid);
  }

  function ensureTrainSessionConfigDefaults(session) {
    const s = session || {};
    const cfg = Object.assign({}, s.trainCfg || {});
    cfg.epochs = Math.max(1, Number(cfg.epochs) || 40);
    cfg.batchSize = Math.max(1, Number(cfg.batchSize) || 64);
    cfg.optimizerType = normalizeOptimizerType(cfg.optimizerType, "adam");
    cfg.learningRate = Math.max(1e-7, Number(cfg.learningRate) || 1e-3);
    cfg.lrSchedulerType = normalizeLrSchedulerType(
      cfg.lrSchedulerType,
      cfg.useLrScheduler === false ? "none" : "plateau"
    );
    cfg.useLrScheduler = cfg.lrSchedulerType !== "none";
    cfg.lrPatience = Math.max(1, Number(cfg.lrPatience) || 3);
    cfg.lrFactor = Math.min(0.99, Math.max(0.01, Number(cfg.lrFactor) || 0.5));
    cfg.minLr = Math.max(1e-8, Number(cfg.minLr) || 1e-6);
    cfg.gradClipNorm = Math.max(0, Number(cfg.gradClipNorm) || 0);
    cfg.gradClipValue = Math.max(0, Number(cfg.gradClipValue) || 0);
    cfg.restoreBestWeights = Boolean(cfg.restoreBestWeights);
    cfg.earlyStoppingPatience = Math.max(0, Number(cfg.earlyStoppingPatience) || 0);
    s.trainCfg = cfg;
    return cfg;
  }

  function normalizeTrainSessionRecord(session) {
    const s = session || {};
    s.schemaId = inferSessionSchemaId(s, state.modelSchemaId || "oscillator");
    const ds = getSavedDatasetById(s.datasetId);
    if (!ds || getSavedDatasetSchemaId(ds, s.schemaId) !== s.schemaId) {
      s.datasetId = getFirstSavedDatasetIdForSchema(s.schemaId) || "";
    }
    const model = getSavedModelById(s.modelId);
    if (!model || getSavedModelSchemaId(model, s.schemaId) !== s.schemaId) {
      s.modelId = getFirstSavedModelIdForSchema(s.schemaId) || "";
    }
    s.datasetName = getSavedDatasetLabelById(s.datasetId, s.datasetName);
    s.modelName = getSavedModelLabelById(s.modelId, s.modelName);
    s.runtime = normalizeRuntimeId(s.runtime || "js_client");
    s.runtimeFamily = runtimeFamilyFor(s.runtime);
    s.runtimeBackend = normalizeRuntimeBackend(s.runtime, s.runtimeBackend || "auto");
    ensureTrainSessionConfigDefaults(s);
    s.status = TRAINER_SESSION_STATE_CORE.normalizeStatus(s);
    s.lockState = TRAINER_SESSION_STATE_CORE.normalizeLockState(s);
    if (!s.runtimeStatus || typeof s.runtimeStatus !== "object") {
      s.runtimeStatus = {
        state: String(s.status || "ready"),
        message: "",
        ts: Number(s.updatedAt || s.createdAt || Date.now()),
        runtimeId: String(s.runtime || "js_client"),
        backend: String(s.runtimeBackend || "auto"),
        transport: "",
        engine: "",
        host: "",
      };
    }
    return s;
  }

  function getNotebookExportSupport(session) {
    const s = session || {};
    const family = String(s.runtimeFamily || runtimeFamilyFor(s.runtime || "js_client") || "").trim().toLowerCase();
    if (family === "pytorch") {
      return { ok: true, family: family, reason: "" };
    }
    return {
      ok: false,
      family: family || "unknown",
      reason: "Notebook export baseline requires pytorch runtime family.",
    };
  }

  function getCurrentModelContext() {
    ensureLibraryEntityIds();
    const typedName = String((ui.modelLibraryName && ui.modelLibraryName.value) || "").trim();
    const byTyped = typedName ? getSavedModelByName(typedName) : null;
    const byActive = state.activeModelId ? getSavedModelById(state.activeModelId) : null;
    const model = byActive || byTyped || null;
    return {
      typedName: typedName,
      model: model,
      modelId: model ? String(model.id || "") : "",
      modelName: model ? String(model.name || "") : "",
    };
  }

  function ensureLibraryEntityIds() {
    let changed = false;
    state.savedDatasets.forEach(function (d) {
      if (!d) return;
      if (!String(d.id || "").trim()) {
        d.id = generateEntityId("ds");
        changed = true;
      }
      const dsSchemaId = getSavedDatasetSchemaId(d, "oscillator");
      if (String(d.schemaId || "") !== dsSchemaId) {
        d.schemaId = dsSchemaId;
        changed = true;
      }
      if (d.data && typeof d.data === "object" && String(d.data.schemaId || "") !== dsSchemaId) {
        d.data.schemaId = dsSchemaId;
        changed = true;
      }
    });
    state.savedModels.forEach(function (m) {
      if (!m) return;
      if (!String(m.id || "").trim()) {
        m.id = generateEntityId("model");
        changed = true;
      }
      const modelSchemaId = getSavedModelSchemaId(m, "oscillator");
      if (String(m.schemaId || "") !== modelSchemaId) {
        m.schemaId = modelSchemaId;
        changed = true;
      }
    });
    state.trainSessions.forEach(function (s) {
      if (!s) return;
      if (!String(s.datasetId || "").trim()) {
        const did = getSavedDatasetIdByName(s.datasetName);
        if (did) {
          s.datasetId = did;
          changed = true;
        }
      }
      if (!String(s.modelId || "").trim()) {
        const mid = getSavedModelIdByName(s.modelName);
        if (mid) {
          s.modelId = mid;
          changed = true;
        }
      }
      if (!String(s.datasetName || "").trim() && String(s.datasetId || "").trim()) {
        const d = getSavedDatasetById(s.datasetId);
        if (d && d.name) {
          s.datasetName = String(d.name);
          changed = true;
        }
      }
      if (!String(s.modelName || "").trim() && String(s.modelId || "").trim()) {
        const m = getSavedModelById(s.modelId);
        if (m && m.name) {
          s.modelName = String(m.name);
          changed = true;
        }
      }
      const schemaId = inferSessionSchemaId(s, state.modelSchemaId || "oscillator");
      if (String(s.schemaId || "") !== schemaId) {
        s.schemaId = schemaId;
        changed = true;
      }
      const dsForSchema = getSavedDatasetById(s.datasetId);
      if (dsForSchema && getSavedDatasetSchemaId(dsForSchema, schemaId) !== schemaId) {
        const nextDatasetId = getFirstSavedDatasetIdForSchema(schemaId);
        if (nextDatasetId) {
          s.datasetId = nextDatasetId;
          const dNext = getSavedDatasetById(nextDatasetId);
          s.datasetName = dNext ? String(dNext.name || s.datasetName || "") : s.datasetName;
          changed = true;
        }
      }
      const modelForSchema = getSavedModelById(s.modelId);
      if (modelForSchema && getSavedModelSchemaId(modelForSchema, schemaId) !== schemaId) {
        const nextModelId = getFirstSavedModelIdForSchema(schemaId);
        if (nextModelId) {
          s.modelId = nextModelId;
          const mNext = getSavedModelById(nextModelId);
          s.modelName = mNext ? String(mNext.name || s.modelName || "") : s.modelName;
          changed = true;
        }
      }
    });
    if (state.activeDatasetName && !state.activeDatasetId) {
      const did = getSavedDatasetIdByName(state.activeDatasetName);
      if (did) {
        state.activeDatasetId = did;
        changed = true;
      }
    }
    return changed;
  }

  function refreshSavedModelSelect() {
    ensureLibraryEntityIds();
    if (state.currentWorkspace === "nn") refreshModelLabSelectionState();
  }

  function refreshTrainSessionSelectors(preferredSchemaId) {
    ensureLibraryEntityIds();
    const schemaList = listRegisteredSchemaEntries();
    const currentSchema = resolveSchemaId(
      preferredSchemaId ||
      (ui.trainSessionSchemaSelect && ui.trainSessionSchemaSelect.value) ||
      state.modelSchemaId ||
      "oscillator"
    );
    if (ui.trainSessionSchemaSelect) {
      ui.trainSessionSchemaSelect.innerHTML = "";
      schemaList.forEach(function (s) {
        const op = document.createElement("option");
        op.value = String(s.id || "");
        op.textContent = String(s.label || s.id || "");
        ui.trainSessionSchemaSelect.appendChild(op);
      });
      if (!schemaList.length) {
        const op = document.createElement("option");
        op.value = "oscillator";
        op.textContent = "oscillator";
        ui.trainSessionSchemaSelect.appendChild(op);
      }
      ui.trainSessionSchemaSelect.value = resolveSchemaId(currentSchema);
    }

    if (ui.trainSessionDatasetSelect) {
      const curDs = String(ui.trainSessionDatasetSelect.value || "");
      ui.trainSessionDatasetSelect.innerHTML = "";
      const dsList = state.savedDatasets
        .map(function (d) {
          if (!d) return null;
          const id = String(d.id || "").trim();
          const name = String(d.name || "").trim();
          if (!id || !name) return null;
          return { id: id, name: name, schemaId: getSavedDatasetSchemaId(d, currentSchema) };
        })
        .filter(function (d) { return d && resolveSchemaId(d.schemaId) === currentSchema; })
        .filter(Boolean);
      if (!dsList.length) {
        const op = document.createElement("option");
        op.value = "";
        op.textContent = "(no saved dataset for schema)";
        ui.trainSessionDatasetSelect.appendChild(op);
      } else {
        dsList.forEach(function (d) {
          const op = document.createElement("option");
          op.value = d.id;
          op.textContent = d.name;
          ui.trainSessionDatasetSelect.appendChild(op);
        });
        ui.trainSessionDatasetSelect.value = dsList.some(function (d) { return d.id === curDs; }) ? curDs : dsList[0].id;
      }
    }

    if (ui.trainSessionModelSelect) {
      const curModel = String(ui.trainSessionModelSelect.value || "");
      ui.trainSessionModelSelect.innerHTML = "";
      const modelList = state.savedModels
        .map(function (m) {
          if (!m) return null;
          const id = String(m.id || "").trim();
          const name = String(m.name || "").trim();
          if (!id || !name) return null;
          return { id: id, name: name, schemaId: getSavedModelSchemaId(m, currentSchema) };
        })
        .filter(function (m) { return m && resolveSchemaId(m.schemaId) === currentSchema; })
        .filter(Boolean);
      if (!modelList.length) {
        const op = document.createElement("option");
        op.value = "";
        op.textContent = "(no saved model for schema)";
        ui.trainSessionModelSelect.appendChild(op);
      } else {
        modelList.forEach(function (m) {
          const op = document.createElement("option");
          op.value = m.id;
          op.textContent = m.name;
          ui.trainSessionModelSelect.appendChild(op);
        });
        ui.trainSessionModelSelect.value = modelList.some(function (m) { return m.id === curModel; }) ? curModel : modelList[0].id;
      }
    }
    if (ui.trainSessionRuntime && ui.trainSessionRuntimeBackend) {
      const runtime = normalizeRuntimeId(String(ui.trainSessionRuntime.value || "js_client"));
      const currentBackend = normalizeRuntimeBackend(runtime, String(ui.trainSessionRuntimeBackend.value || "auto"));
      ui.trainSessionRuntimeBackend.innerHTML = runtimeBackendOptionsHtml(runtime, currentBackend);
      ui.trainSessionRuntimeBackend.value = normalizeRuntimeBackend(runtime, currentBackend);
    }
  }

  function saveCurrentModelNamed(name, preferredModelId) {
    ensureLibraryEntityIds();
    if (!state.editor || typeof state.editor.export !== "function") {
      throw new Error("Drawflow editor not ready.");
    }
    const n = String(name || "").trim();
    if (!n) throw new Error("Model name is required.");
    const payload = state.editor.export();
    assertValidDrawflowGraph(payload, "Current editor graph");
    const now = Date.now();
    const entry = {
      name: n,
      createdAt: now,
      updatedAt: now,
      schemaId: resolveSchemaId(state.modelSchemaId),
      preset: String((ui.netPreset && ui.netPreset.value) || "custom"),
      graph: payload,
    };
    const preferredIdRaw = String(preferredModelId || "").trim();
    const idxById = preferredIdRaw
      ? state.savedModels.findIndex(function (m) { return String((m && m.id) || "") === preferredIdRaw; })
      : -1;
    const preferredId = idxById >= 0 ? preferredIdRaw : "";
    const idxByName = state.savedModels.findIndex(function (m) { return String((m && m.name) || "") === n; });
    const idx = idxById >= 0 ? idxById : idxByName;
    if (idx >= 0) {
      entry.createdAt = Number(state.savedModels[idx].createdAt || now);
      entry.id = String(state.savedModels[idx].id || preferredId || generateEntityId("model"));
      state.savedModels[idx] = entry;
    } else {
      entry.id = preferredId || generateEntityId("model");
      state.savedModels.push(entry);
    }
    refreshSavedModelSelect();
    refreshTrainSessionSelectors();
    if (ui.modelLibraryName) ui.modelLibraryName.value = String(entry.name || "");
    state.activeModelId = String(entry.id || "");
    state.activeModelName = String(entry.name || "");
    state.renderedModelId = "";
    markModelGraphClean();
    if (state.currentWorkspace === "nn") refreshModelLabSelectionState();
    syncWorkspaceStoreFromState("save_model");
    return String(entry.id || "");
  }

  function loadSavedModelById(id) {
    ensureLibraryEntityIds();
    const model = getSavedModelById(id);
    if (!model || !model.graph) throw new Error("Saved model not found.");
    setCurrentModelSchema((model && model.schemaId) || "oscillator", { skipNodePanelRefresh: true });
    const graphPayload = assertValidDrawflowGraph(model.graph, "Saved model graph '" + String(model.name || "") + "'");
    importGraphJsonObject(graphPayload, {
      presetValue: String((model && model.preset) || "").trim(),
      resetPreset: false,
    });
    if (ui.modelLibraryName) ui.modelLibraryName.value = String(model.name || "");
    state.activeModelId = String(model.id || "");
    state.activeModelName = String(model.name || "");
    state.renderedModelId = String(model.id || "");
    markModelGraphClean();
    if (state.currentWorkspace === "nn") refreshModelLabSelectionState();
    syncWorkspaceStoreMetaOnly("load_model");
  }

  function deleteSavedModelById(modelId) {
    ensureLibraryEntityIds();
    const mid = String(modelId || "").trim();
    if (!mid) return;
    state.savedModels = state.savedModels.filter(function (m) { return String((m && m.id) || "") !== mid; });
    if (String(state.activeModelId || "") === mid) {
      state.activeModelId = "";
      state.activeModelName = "";
      state.renderedModelId = "";
    }
    refreshSavedModelSelect();
    refreshTrainSessionSelectors();
    if (state.currentWorkspace === "nn") refreshModelLabSelectionState();
    syncWorkspaceStoreFromState("delete_model");
  }

  function renameSavedModel(modelId, newName) {
    ensureLibraryEntityIds();
    const mid = String(modelId || "").trim();
    const newN = String(newName || "").trim();
    if (!mid) throw new Error("Select model to rename.");
    if (!newN) throw new Error("New model name is required.");
    const idx = state.savedModels.findIndex(function (m) { return String((m && m.id) || "") === mid; });
    if (idx < 0) throw new Error("Model not found: " + mid);
    if (String(state.savedModels[idx].name || "") === newN) return;
    const exists = state.savedModels.some(function (m, i) {
      return i !== idx && String((m && m.name) || "") === newN;
    });
    if (exists) throw new Error("Model name already exists: " + newN);
    const oldN = String(state.savedModels[idx].name || "");
    state.savedModels[idx].name = newN;
    state.savedModels[idx].updatedAt = Date.now();
    if (String(state.activeModelId || "") === mid) {
      state.activeModelName = newN;
    }
    state.trainSessions.forEach(function (s) {
      if (String((s && s.modelId) || "") === mid || String((s && s.modelName) || "") === oldN) {
        s.modelId = mid;
        s.modelName = newN;
      }
    });
    refreshSavedModelSelect();
    refreshTrainSessionSelectors();
    renderTrainSessionTable();
    syncWorkspaceStoreFromState("rename_model");
  }

  function deleteSavedModelNamed(name) {
    const model = getSavedModelByName(name);
    if (!model) return;
    deleteSavedModelById(model.id);
  }

  function renameSavedDatasetById(datasetId, newName) {
    ensureLibraryEntityIds();
    const did = String(datasetId || "").trim();
    const newN = String(newName || "").trim();
    if (!did) throw new Error("Select dataset to rename.");
    if (!newN) throw new Error("New dataset name is required.");
    const idx = state.savedDatasets.findIndex(function (d) { return String((d && d.id) || "") === did; });
    if (idx < 0) throw new Error("Dataset not found: " + did);
    if (String(state.savedDatasets[idx].name || "") === newN) return;
    const exists = state.savedDatasets.some(function (d, i) {
      return i !== idx && String((d && d.name) || "") === newN;
    });
    if (exists) throw new Error("Dataset name already exists: " + newN);
    const oldN = String(state.savedDatasets[idx].name || "");
    state.savedDatasets[idx].name = newN;
    state.savedDatasets[idx].updatedAt = Date.now();
    if (String(state.activeDatasetId || "") === did) state.activeDatasetName = newN;
    state.trainSessions.forEach(function (s) {
      if (!s) return;
      if (String((s.datasetId || "")) === did || String((s.datasetName || "")) === oldN) {
        s.datasetId = did;
        s.datasetName = newN;
      }
    });
    if (ui.datasetName && String((ui.savedDatasetSelect && ui.savedDatasetSelect.value) || "") === did) {
      ui.datasetName.value = newN;
    }
    refreshSavedDatasetSelect();
    refreshTrainSessionSelectors();
    renderTrainSessionTable();
    syncWorkspaceStoreFromState("rename_dataset");
    setStatus("Renamed dataset '" + oldN + "' -> '" + newN + "'.");
  }

  function deleteSavedDatasetById(datasetId) {
    ensureLibraryEntityIds();
    const did = String(datasetId || "").trim();
    const dsEntry = getSavedDatasetById(did);
    const name = dsEntry ? String(dsEntry.name || "") : "";
    if (!did || !dsEntry) {
      setStatus("No saved dataset selected.");
      return;
    }
    const refs = state.trainSessions.filter(function (s) { return String((s && s.datasetId) || "") === did; }).length;
    const msg =
      "Delete dataset '" + name + "'?" +
      (refs > 0 ? (" It is referenced by " + refs + " training session(s).") : "") +
      " This cannot be undone.";
    if (!window.confirm(msg)) {
      setStatus("Delete dataset canceled: " + name);
      return;
    }
    state.savedDatasets = state.savedDatasets.filter(function (d) { return String((d && d.id) || "") !== did; });
    state.trainSessions = state.trainSessions.filter(function (s) { return String((s && s.datasetId) || "") !== did; });
    const deletedWasActive = String(state.activeDatasetId || "") === did;
    if (deletedWasActive) {
      state.activeDatasetId = "";
      state.activeDatasetName = "";
    }
    refreshSavedDatasetSelect();
    refreshTrainSessionSelectors();
    renderTrainSessionTable();
    if (!state.savedDatasets.length) {
      state.dataset = null;
      if (state.datasetsByMode) {
        state.datasetsByMode.autoregressive = null;
        state.datasetsByMode.direct = null;
      }
      clearDatasetViews("Deleted saved dataset '" + name + "'. No saved datasets remain.");
      syncWorkspaceStoreFromState("delete_dataset");
      return;
    }
    if (deletedWasActive) {
      const nextId = String((state.savedDatasets[0] && state.savedDatasets[0].id) || "");
      const nextName = String((state.savedDatasets[0] && state.savedDatasets[0].name) || "");
      if (nextId) {
        loadSavedDatasetById(nextId, { skipUiSync: true });
        setStatus("Deleted saved dataset '" + name + "'. Loaded '" + nextName + "'.");
        syncWorkspaceStoreFromState("delete_dataset");
        return;
      }
    }
    renderDataTable();
    setStatus("Deleted saved dataset '" + name + "'.");
    syncWorkspaceStoreFromState("delete_dataset");
  }

  function resolveSelectedDatasetModuleId(found, schemaId) {
    const modules = listDatasetModulesForSchema(schemaId);
    const preferredModuleId = String(
      (found && found.data && found.data.datasetModuleId) ||
      ""
    ).trim().toLowerCase();
    if (modules.some(function (m) { return String(m.id || "").toLowerCase() === preferredModuleId; })) {
      return preferredModuleId;
    }
    return String(pickDefaultDatasetModuleForSchema(schemaId) || "").trim().toLowerCase();
  }

  function loadSavedDatasetById(id, opts) {
    const options = opts || {};
    const force = Boolean(options.force);
    const skipUiSync = Boolean(options.skipUiSync);
    const syncLibrary = options.refreshLibrary !== false;
    const renderSeq = ++state.datasetSelectionRenderSeq;

    function scheduleDatasetSelectionRender(cb) {
      if (typeof cb !== "function") return;
      if (String(state.currentWorkspace || "") === "dataset") {
        if (state.datasetSelectionRenderSeq !== renderSeq) return;
        cb();
        return;
      }
      if (state.datasetSelectionRenderHandle) {
        clearTimeout(state.datasetSelectionRenderHandle);
        state.datasetSelectionRenderHandle = null;
      }
      setTimeout(function () {
        state.datasetSelectionRenderHandle = null;
        if (state.datasetSelectionRenderSeq !== renderSeq) return;
        cb();
      }, 0);
    }

    function syncDatasetSelectionUI(did) {
      if (skipUiSync) {
        markDatasetUiActive(did);
        refreshDatasetDetailPanel();
        refreshRightInspectorPanels();
        return;
      }
      refreshSavedDatasetSelect({
        refreshLibrary: syncLibrary,
      });
    }

    function renderLoadedDatasetSelection(datasetPayload, datasetName, datasetSchemaId) {
      scheduleDatasetSelectionRender(function () {
        const inBuilder = String(state.dataLabSubTab || "preview") === "builder";
        if (inBuilder) renderDataTable(datasetPayload);
        if (datasetSchemaId !== "oscillator") {
          if (!inBuilder) {
            plotNonTrajectoryDataset(
              datasetPayload,
              "Loaded Dataset (" + datasetName + ") | schema=" + datasetSchemaId
            );
            refreshDatasetImageViewer(datasetPayload);
          }
          refreshGenerationRefOptions();
          if (String(state.currentWorkspace || "") === "dataset") {
            refreshDataLabSelectionLinkedPanels(true);
            showDataLabSubTab(state.dataLabSubTab || "preview");
          }
          setStatus("Loaded saved dataset '" + datasetName + "' (schema=" + datasetSchemaId + ", no regeneration).");
          syncWorkspaceStoreMetaOnly("load_dataset");
          return;
        }
        if (!inBuilder && ui.datasetChart && state.dataset && state.dataset.trajectories && state.dataset.trajectories.length) {
          const mode = ui.datasetCompareMode && ui.datasetCompareMode.value ? ui.datasetCompareMode.value : "uniform";
          const csv = ui.selectedTrajCsv ? ui.selectedTrajCsv.value : "";
          const cache = getDatasetRenderCache(did);
          const pickKey = [
            String(mode || ""),
            String(csv || ""),
            String((ui.dataScenarioFilter && ui.dataScenarioFilter.value) || "all"),
          ].join("|");
          let picks = cache && cache.previewTrajSelectionKey === pickKey && Array.isArray(cache.previewTrajSelection)
            ? cache.previewTrajSelection
            : null;
          if (!picks || !picks.length) {
            picks = pickDatasetTrajectories(state.dataset.trajectories, mode, 3, csv);
            if (cache) {
              cache.previewTrajSelectionKey = pickKey;
              cache.previewTrajSelection = picks.slice();
            }
          }
          const colors = ["#22d3ee", "#a78bfa", "#f59e0b"];
          const traces = picks.map(function (tr, i) {
            const p = tr.params || {};
            const scen = String((p && p.scenario) || state.dataset.scenarioType || "unknown");
            return {
              x: tr.t,
              y: tr.x,
              mode: "lines",
              name: scen + " | loaded " + (i + 1),
              line: { color: colors[i % colors.length] },
            };
          });
          plotTrajectoriesOn(ui.datasetChart, traces, "Loaded Dataset (" + datasetName + ")");
        }
        if (!inBuilder) refreshDatasetImageViewer(datasetPayload);
        refreshGenerationRefOptions();
        if (String(state.currentWorkspace || "") === "dataset") {
          refreshDataLabSelectionLinkedPanels(true);
          showDataLabSubTab(state.dataLabSubTab || "preview");
        }
        setStatus("Loaded saved dataset '" + datasetName + "' (chart/table refreshed, no regeneration).");
        syncWorkspaceStoreMetaOnly("load_dataset");
      });
    }

    ensureLibraryEntityIds();
    const did = String(id || "").trim();
    const found = getSavedDatasetById(did);
    if (!found) {
      setStatus("Saved dataset not found.");
      return;
    }
    const schemaId = getSavedDatasetSchemaId(found, "oscillator");
    const dataObj = (found && typeof found.data === "object") ? found.data : null;
    const savedVariantMap = (dataObj && dataObj.variantMap && typeof dataObj.variantMap === "object")
      ? dataObj.variantMap
      : null;
    const isDraft = !dataObj || Boolean(dataObj.draft);
    const pickedModule = resolveSelectedDatasetModuleId(found, schemaId);
    const shouldApplyDatasetUi = String(state.currentWorkspace || "") === "dataset";
    const sameId = String(state.activeDatasetId || "") === did;
    const sameDataSig = sameId && !isDraft && state.dataset
      ? getDatasetRenderSignature(state.dataset) === getDatasetRenderSignature(dataObj)
      : false;
    const isSameSelection = !force &&
      sameId &&
      (isDraft ? state.dataset === null : (state.dataset === dataObj || sameDataSig));
    if (isSameSelection) {
      state.dataset = isDraft ? null : dataObj;
      state.activeDatasetName = String(found.name || "");
      state.renderedDatasetId = isDraft ? "" : did;
      state.preparedDataset = null;
      if (state.datasetsByMode) {
        state.datasetsByMode.autoregressive = null;
        state.datasetsByMode.direct = null;
        if (!isDraft && savedVariantMap) {
          Object.keys(savedVariantMap).forEach(function (key) {
            state.datasetsByMode[String(key)] = savedVariantMap[key];
          });
        } else if (!isDraft && dataObj && dataObj.mode) {
          state.datasetsByMode[String(dataObj.mode)] = dataObj;
        }
      }
      setActiveDatasetModuleId(pickedModule, schemaId);
      if (shouldApplyDatasetUi) applyDatasetModuleUi(pickedModule);
      if (ui.datasetName) ui.datasetName.value = String(found.name || "");
      if (ui.modelDatasetSource && dataObj && dataObj.mode) {
        const m = String(dataObj.mode);
        if (ui.modelDatasetSource.querySelector("option[value='" + m + "']")) {
          ui.modelDatasetSource.value = m;
        }
      }
      syncDatasetSelectionUI(did);
      if (state.currentWorkspace === "train") refreshTrainSessionSelectors();
      if (shouldApplyDatasetUi) {
        refreshRightDataLabConfigTitle();
        refreshRightInspectorPanels();
      }
      if (isDraft) {
        clearDatasetViews(
          "Draft dataset '" + String(found.name || found.id || "") + "' selected. Configure in right panel.",
          { preserveSelection: true, schemaId: schemaId }
        );
      } else if (dataObj) {
        renderLoadedDatasetSelection(dataObj, String(found.name || ""), schemaId);
      } else {
        setStatus("Saved dataset '" + String(found.name || "") + "' selected (no regeneration).");
      }
      return;
    }
    if (isDraft) {
      state.dataset = null;
      state.activeDatasetId = String(found.id || "");
      state.activeDatasetName = String(found.name || "");
      state.renderedDatasetId = "";
      state.preparedDataset = null;
      if (state.datasetsByMode) {
        state.datasetsByMode.autoregressive = null;
        state.datasetsByMode.direct = null;
      }
      setActiveDatasetModuleId(pickedModule, schemaId);
      if (shouldApplyDatasetUi) applyDatasetModuleUi(pickedModule);
      if (ui.datasetName) ui.datasetName.value = String(found.name || "");
      syncDatasetSelectionUI(did);
      if (state.currentWorkspace === "train") refreshTrainSessionSelectors();
      clearDatasetViews(
        "Draft dataset '" + String(found.name || found.id || "") + "' selected. Configure in right panel.",
        { preserveSelection: true, schemaId: schemaId }
      );
      if (shouldApplyDatasetUi) {
        refreshRightDataLabConfigTitle();
        refreshRightInspectorPanels();
      }
      return;
    }
    state.dataset = found.data;
    state.activeDatasetId = String(found.id || "");
    state.activeDatasetName = String(found.name || "");
    state.renderedDatasetId = did;
    state.preparedDataset = null;
    if (state.datasetsByMode) {
      state.datasetsByMode.autoregressive = null;
      state.datasetsByMode.direct = null;
      if (savedVariantMap) {
        Object.keys(savedVariantMap).forEach(function (key) {
          state.datasetsByMode[String(key)] = savedVariantMap[key];
        });
      } else if (found.data && found.data.mode) {
        state.datasetsByMode[String(found.data.mode)] = found.data;
      }
    }
    {
      const mods = listDatasetModulesForSchema(schemaId);
      if (mods.length) {
        setActiveDatasetModuleId(pickedModule, schemaId);
        if (shouldApplyDatasetUi) applyDatasetModuleUi(pickedModule);
      }
    }
    if (ui.modelDatasetSource && found.data && found.data.mode) {
      const m = String(found.data.mode);
      if (ui.modelDatasetSource.querySelector("option[value='" + m + "']")) {
        ui.modelDatasetSource.value = m;
      }
    }
    if (ui.datasetName) ui.datasetName.value = String(found.name || "");
    syncDatasetSelectionUI(did);
    if (state.currentWorkspace === "train") refreshTrainSessionSelectors();
    if (ui.dataScenarioFilter) ui.dataScenarioFilter.value = "all";
    if (ui.dataTrajIdx) {
      ui.dataTrajIdx.innerHTML = "";
      ui.dataTrajIdx.value = "0";
    }
    const datasetPayload = found.data;
    const datasetName = String(found.name || "");
    const datasetSchemaId = schemaId;
    renderLoadedDatasetSelection(datasetPayload, datasetName, datasetSchemaId);
  }

  function loadSavedDatasetNamed(name) {
    const found = getSavedDatasetByName(name);
    if (!found) {
      setStatus("Saved dataset not found.");
      return;
    }
    loadSavedDatasetById(found.id);
  }

  function normalizeDatasetPayloadForStore(dsRaw, opts) {
    const cfg = opts || {};
    const raw = (dsRaw && typeof dsRaw === "object") ? dsRaw : {};
    const sid = resolveSchemaId(
      cfg.schemaId ||
      raw.schemaId ||
      "oscillator"
    );
    const moduleId = String(
      cfg.moduleId ||
      raw.datasetModuleId ||
      pickDefaultDatasetModuleForSchema(sid)
    ).trim().toLowerCase();
    const moduleDefaults = getDatasetModuleDatasetPreconfig(moduleId, sid);
    const defaults = {
      mode: String(moduleDefaults.mode || "random"),
      train: Number(moduleDefaults.fractions.train || 0.8),
      val: Number(moduleDefaults.fractions.val || 0.1),
      test: Number(moduleDefaults.fractions.test || 0.1),
    };
    const splitDefs = getSchemaSplitModeDefs(sid);
    const allowedSplitModeIds = splitDefs.map(function (d) { return String(d.id || ""); });
    const incomingSplit = (raw && raw.splitConfig && typeof raw.splitConfig === "object") ? raw.splitConfig : {};
    const modeRaw = String(incomingSplit.mode || defaults.mode || "random");
    const mode = allowedSplitModeIds.indexOf(modeRaw) >= 0
      ? modeRaw
      : String((allowedSplitModeIds[0] || defaults.mode || "random"));
    const train = Number(incomingSplit.train);
    const val = Number(incomingSplit.val);
    const test = Number(incomingSplit.test);
    const tr = Number.isFinite(train) ? train : Number(defaults.train || 0.8);
    const va = Number.isFinite(val) ? val : Number(defaults.val || 0.1);
    const te = Number.isFinite(test) ? test : Number(defaults.test || 0.1);
    const sum = Math.max(1e-9, tr + va + te);
    const seedRaw = Number(raw.seed);
    const totalRaw = Number(raw.totalCount);

    const payload = Object.assign({}, raw, {
      schemaId: sid,
      datasetModuleId: moduleId,
      contractVersion: "1.0",
      seed: Number.isFinite(seedRaw) ? Math.floor(seedRaw) : Number(moduleDefaults.seed || 42),
      totalCount: Number.isFinite(totalRaw) && totalRaw > 0
        ? Math.floor(totalRaw)
        : Number(moduleDefaults.totalCount || 1400),
      splitConfig: Object.assign({}, incomingSplit, {
        mode: mode,
        train: tr / sum,
        val: va / sum,
        test: te / sum,
      }),
    });
    return payload;
  }

  function saveCurrentDatasetNamed(name, preferredDatasetId, explicitDataset) {
    ensureLibraryEntityIds();
    const existingById = preferredDatasetId ? getSavedDatasetById(preferredDatasetId) : null;
    const activeById = existingById ? null : getSavedDatasetById(state.activeDatasetId);
    const dsRaw = explicitDataset || syncActiveDatasetFromSelection();
    if (!dsRaw) {
      setStatus("No dataset to save. Generate dataset first.");
      return "";
    }
    const schemaId = resolveSchemaId(
      (dsRaw && dsRaw.schemaId) ||
      (existingById && existingById.schemaId) ||
      "oscillator"
    );
    const moduleId = String(
      (dsRaw && dsRaw.datasetModuleId) ||
      (existingById && existingById.data && existingById.data.datasetModuleId) ||
      (activeById && activeById.data && activeById.data.datasetModuleId) ||
      currentDatasetModuleId() ||
      pickDefaultDatasetModuleForSchema(schemaId)
    ).trim().toLowerCase();
    const ds = normalizeDatasetPayloadForStore(dsRaw, { schemaId: schemaId, moduleId: moduleId });
    const requestedName = String(name || "").trim();
    const n = requestedName || String((existingById && existingById.name) || "").trim() || ("dataset_" + formatTimestampForName(new Date()));
    const now = Date.now();
    const preferredIdRaw = String(preferredDatasetId || state.activeDatasetId || "").trim();
    const idxById = preferredIdRaw
      ? state.savedDatasets.findIndex(function (d) { return String((d && d.id) || "") === preferredIdRaw; })
      : -1;
    let idx = idxById;
    if (idx < 0) {
      const sameName = state.savedDatasets
        .map(function (d, i) { return { d: d, i: i }; })
        .filter(function (x) { return String((x.d && x.d.name) || "") === n; });
      if (sameName.length === 1) {
        idx = sameName[0].i;
      }
    }
    let entry = {
      id: generateEntityId("ds"),
      name: n,
      schemaId: schemaId,
      createdAt: now,
      updatedAt: now,
      data: ds,
    };
    if (idx >= 0) {
      entry.id = String(state.savedDatasets[idx].id || generateEntityId("ds"));
      entry.createdAt = Number(state.savedDatasets[idx].createdAt || now);
      entry.updatedAt = now;
      state.savedDatasets[idx] = entry;
    } else {
      state.savedDatasets.push(entry);
    }
    state.activeDatasetId = String(entry.id || "");
    state.activeDatasetName = n;
    refreshSavedDatasetSelect();
    refreshSavedModelSelect();
    refreshTrainSessionSelectors();
    renderTrainSessionTable();
    updateRuntimeOptionsUi();
    refreshTrainSessionSelectors();
    setStatus("Saved dataset '" + n + "'.");
    syncWorkspaceStoreFromState("save_dataset");
    return String(entry.id || "");
  }

  function setTrainSessionStatus(msg) {
    if (ui.trainSessionStatus) ui.trainSessionStatus.textContent = String(msg || "");
    setStatus(String(msg || ""));
  }

  function isModelLibraryLocked() {
    return Boolean(state && state.trainQueueRunning);
  }

  function updateModelLibraryLockUi() {
    const locked = isModelLibraryLocked();
    const controls = [
      ui.newModelBtn,
      ui.leftNewModelBtn,
      ui.saveModelToLibraryBtn,
      ui.deleteModelFromLibraryBtn,
      ui.importGraphBtn,
      ui.exportGraphBtn,
      ui.startCleanBtn,
      ui.autoArrangeBtn,
    ];
    controls.forEach(function (el) {
      if (!el) return;
      el.disabled = locked;
    });
    if (ui.modelSchemaSelect) ui.modelSchemaSelect.disabled = locked;
    if (ui.modelLibraryName) ui.modelLibraryName.readOnly = locked;
  }

  function requireModelLibraryUnlocked(actionLabel) {
    if (!isModelLibraryLocked()) return true;
    setTrainSessionStatus("Cannot " + String(actionLabel || "modify model") + " while training queue is running.");
    return false;
  }

  const RUNTIME_OPTION_DEFS = [
    { value: "js_client", label: "client" },
    { value: "server_tfjs", label: "server-tfjs (optional)" },
    { value: "server_pytorch_gpu", label: "server-pytorch-gpu" },
    { value: "server_pytorch_cpu", label: "server-pytorch-no-gpu" },
  ];
  const RUNTIME_EVENT_IR_VERSION = "1.0";
  const RUNTIME_PROFILE_DEFS = {
    js_client: { host: "browser", engine: "tfjs", transport: "inproc", backend: "auto" },
    server_tfjs: { host: "server", engine: "tfjs", transport: "ws", backend: "auto" },
    server_pytorch_gpu: { host: "server", engine: "pytorch", transport: "ws", backend: "torch-cuda" },
    server_pytorch_cpu: { host: "server", engine: "pytorch", transport: "ws", backend: "torch-cpu" },
  };
  const RUNTIME_BACKEND_OPTION_DEFS = {
    js_client: [
      { value: "auto", label: "auto" },
      { value: "cpu", label: "cpu" },
      { value: "webgl", label: "webgl" },
      { value: "wasm", label: "wasm" },
      { value: "webgpu", label: "webgpu" },
    ],
    server_tfjs: [
      { value: "auto", label: "auto" },
      { value: "cpu", label: "cpu" },
      { value: "webgl", label: "webgl" },
      { value: "wasm", label: "wasm" },
      { value: "webgpu", label: "webgpu" },
      { value: "tfjs-node-cpu", label: "tfjs-node-cpu" },
      { value: "tfjs-node-gpu", label: "tfjs-node-gpu" },
    ],
    server_pytorch_gpu: [
      { value: "auto", label: "auto" },
      { value: "torch-cuda", label: "torch-cuda" },
      { value: "torch-cpu", label: "torch-cpu" },
    ],
    server_pytorch_cpu: [
      { value: "auto", label: "auto" },
      { value: "torch-cpu", label: "torch-cpu" },
    ],
  };
  const LR_SCHEDULER_OPTION_DEFS = [
    { value: "plateau", label: "reduce_on_plateau" },
    { value: "step", label: "step_decay" },
    { value: "exponential", label: "exponential_decay" },
    { value: "cosine", label: "cosine_annealing" },
    { value: "none", label: "none" },
  ];
  const OPTIMIZER_OPTION_DEFS = [
    { value: "adam", label: "adam" },
    { value: "sgd", label: "sgd" },
    { value: "rmsprop", label: "rmsprop" },
    { value: "adagrad", label: "adagrad" },
  ];

  function normalizeLrSchedulerType(raw, fallbackType) {
    const fb = String(fallbackType || "plateau").trim().toLowerCase() || "plateau";
    const allowed = LR_SCHEDULER_OPTION_DEFS.map(function (o) { return String(o.value || "").toLowerCase(); });
    const v0 = String(raw == null ? "" : raw).trim().toLowerCase();
    const aliases = {
      "": fb,
      on: "plateau",
      off: "none",
      true: "plateau",
      false: "none",
      reduce_on_plateau: "plateau",
      step_decay: "step",
      exponential_decay: "exponential",
      cosine_annealing: "cosine",
    };
    const v = aliases[v0] || v0 || fb;
    return allowed.indexOf(v) >= 0 ? v : fb;
  }

  function lrSchedulerOptionsHtml(selectedType) {
    const current = normalizeLrSchedulerType(selectedType, "plateau");
    return LR_SCHEDULER_OPTION_DEFS.map(function (o) {
      const value = String(o.value || "");
      const label = String(o.label || value);
      const sel = value === current ? " selected" : "";
      return "<option value='" + escapeHtml(value) + "'" + sel + ">" + escapeHtml(label) + "</option>";
    }).join("");
  }

  function normalizeOptimizerType(raw, fallbackType) {
    const fb = String(fallbackType || "adam").trim().toLowerCase() || "adam";
    const allowed = OPTIMIZER_OPTION_DEFS.map(function (o) { return String(o.value || "").toLowerCase(); });
    const v0 = String(raw == null ? "" : raw).trim().toLowerCase();
    const aliases = {
      "": fb,
      "adamw": "adam",
      "rms": "rmsprop",
    };
    const v = aliases[v0] || v0 || fb;
    return allowed.indexOf(v) >= 0 ? v : fb;
  }

  function optimizerOptionsHtml(selectedType) {
    const current = normalizeOptimizerType(selectedType, "adam");
    return OPTIMIZER_OPTION_DEFS.map(function (o) {
      const value = String(o.value || "");
      const label = String(o.label || value);
      const sel = value === current ? " selected" : "";
      return "<option value='" + escapeHtml(value) + "'" + sel + ">" + escapeHtml(label) + "</option>";
    }).join("");
  }

  function createOptimizerByType(optimizerType, learningRate) {
    const type = normalizeOptimizerType(optimizerType, "adam");
    const lr = Math.max(1e-8, Number(learningRate) || 1e-3);
    if (type === "adam") return tf.train.adam(lr);
    if (type === "sgd") return tf.train.sgd(lr);
    if (type === "rmsprop") return tf.train.rmsprop(lr);
    if (type === "adagrad") return tf.train.adagrad(lr);
    throw new Error("Unsupported optimizer type: " + type);
  }

  function normalizeRuntimeId(raw) {
    const v = String(raw || "js_client").trim();
    if (!v) return "js_client";
    if (v === "python_server_gpu") return "server_pytorch_gpu";
    if (v === "python_server_cpu" || v === "python_server") return "server_pytorch_cpu";
    return v;
  }

  function runtimeProfileFor(runtimeId) {
    const rid = normalizeRuntimeId(runtimeId || "js_client");
    return Object.assign(
      { host: "unknown", engine: "unknown", transport: "inproc", backend: "auto" },
      RUNTIME_PROFILE_DEFS[rid] || {}
    );
  }

  function runtimeFamilyFor(runtimeId) {
    const profile = runtimeProfileFor(runtimeId);
    const engine = String(profile.engine || "unknown").trim().toLowerCase();
    if (engine === "pytorch") return "pytorch";
    if (engine === "tfjs") return "tfjs";
    return "unknown";
  }

  function runtimeBackendOptionsFor(runtimeId) {
    const rid = normalizeRuntimeId(runtimeId || "js_client");
    const opts = RUNTIME_BACKEND_OPTION_DEFS[rid];
    return Array.isArray(opts) && opts.length
      ? opts.slice()
      : [{ value: "auto", label: "auto" }];
  }

  function normalizeRuntimeBackend(runtimeId, raw) {
    const rid = normalizeRuntimeId(runtimeId || "js_client");
    const v0 = String(raw == null ? "" : raw).trim().toLowerCase();
    const aliases = {
      "": "auto",
      gpu: rid === "server_pytorch_gpu" ? "torch-cuda" : "tfjs-node-gpu",
      cuda: "torch-cuda",
      "pytorch-gpu": "torch-cuda",
      "pytorch-cpu": "torch-cpu",
      "tfjs-node": "tfjs-node-cpu",
    };
    const v = aliases[v0] || v0 || "auto";
    const allowed = runtimeBackendOptionsFor(rid).map(function (x) { return String(x.value || "auto"); });
    if (allowed.indexOf(v) >= 0) return v;
    return String((runtimeProfileFor(rid).backend || "auto"));
  }

  function normalizeRuntimeConfig(rawRuntime, rawBackend, rawTransport) {
    const runtimeId = normalizeRuntimeId(rawRuntime || "js_client");
    const profile = runtimeProfileFor(runtimeId);
    const backend = normalizeRuntimeBackend(runtimeId, rawBackend == null ? profile.backend : rawBackend);
    const transport = String(rawTransport || profile.transport || "inproc");
    return {
      irVersion: "1.0",
      runtimeId: runtimeId,
      runtimeFamily: runtimeFamilyFor(runtimeId),
      host: String(profile.host || "unknown"),
      engine: String(profile.engine || "unknown"),
      backend: backend,
      transport: transport,
    };
  }

  function getClientTfjsBackendAvailability() {
    const out = { cpu: false, webgl: false, wasm: false, webgpu: false };
    if (!window.tf || typeof tf.getBackend !== "function") return out;
    try {
      const cur = String(tf.getBackend() || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(out, cur)) out[cur] = true;
    } catch (_) {}
    try {
      if (tf.engine && typeof tf.engine === "function") {
        const eng = tf.engine();
        const reg = eng && eng.registryFactory ? Object.keys(eng.registryFactory) : [];
        reg.forEach(function (k) {
          const kk = String(k || "").toLowerCase();
          if (Object.prototype.hasOwnProperty.call(out, kk)) out[kk] = true;
        });
      }
    } catch (_) {}
    if (!window.isSecureContext || !(typeof navigator !== "undefined" && navigator.gpu)) {
      out.webgpu = false;
    }
    out.cpu = true; // tfjs has CPU fallback in browser runtime.
    return out;
  }

  function preferredClientBackend(avail) {
    const a = avail || getClientTfjsBackendAvailability();
    if (a.webgpu) return "webgpu";
    if (a.webgl) return "webgl";
    if (a.wasm) return "wasm";
    return "cpu";
  }

  function configureTfjsWasmPaths() {
    if (!window.tf || !tf.wasm || typeof tf.wasm.setWasmPaths !== "function") return false;
    try {
      tf.wasm.setWasmPaths(TFJS_WASM_CDN_BASE);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function bootstrapClientTfjsBackends() {
    if (!window.tf || typeof tf.getBackend !== "function") {
      return { ok: false, reason: "tfjs_missing" };
    }
    configureTfjsWasmPaths();
    if (typeof tf.ready === "function") {
      try { await tf.ready(); } catch (_) {}
    }
    const avail = getClientTfjsBackendAvailability();
    const current = String(tf.getBackend ? tf.getBackend() : "cpu").toLowerCase() || "cpu";
    let finalBackend = current;
    if (current === "cpu") {
      const preferred = preferredClientBackend(avail);
      if (preferred !== "cpu") {
        try {
          await tf.setBackend(preferred);
          if (typeof tf.ready === "function") await tf.ready();
          finalBackend = String(tf.getBackend ? tf.getBackend() : preferred).toLowerCase() || preferred;
        } catch (_) {
          finalBackend = current;
        }
      }
    }
    return {
      ok: true,
      backend: finalBackend,
      availability: getClientTfjsBackendAvailability(),
    };
  }

  function summarizeClientTfjsBackends() {
    const a = getClientTfjsBackendAvailability();
    return Object.keys(a).filter(function (k) { return Boolean(a[k]); }).join(", ");
  }

  async function performRuntimeHandshake(runtimeConfig) {
    const cfg = normalizeRuntimeConfig(
      runtimeConfig && runtimeConfig.runtimeId,
      runtimeConfig && runtimeConfig.backend,
      runtimeConfig && runtimeConfig.transport
    );
    if (cfg.runtimeId === "js_client") {
      if (!window.tf || typeof tf.getBackend !== "function") {
        return {
          ok: false,
          reason: "tfjs_missing",
          message: "TensorFlow.js is not available in browser runtime.",
          runtimeConfig: cfg,
          backendAvailability: getClientTfjsBackendAvailability(),
        };
      }
      configureTfjsWasmPaths();
      try {
        if (typeof tf.ready === "function") await tf.ready();
      } catch (_) {}
      const avail = getClientTfjsBackendAvailability();
      const requested = String(cfg.backend || "auto").toLowerCase();
      let negotiated = requested;
      if (negotiated === "auto") {
        negotiated = preferredClientBackend(avail);
      }
      if (!Object.prototype.hasOwnProperty.call(avail, negotiated) || !avail[negotiated]) {
        const fallbackBackend = preferredClientBackend(avail) || "cpu";
        if (Object.prototype.hasOwnProperty.call(avail, fallbackBackend) && avail[fallbackBackend]) {
          negotiated = fallbackBackend;
        } else {
          negotiated = "cpu";
        }
      }
      let handshakeMessage = "Browser runtime ready.";
      if (requested !== negotiated) {
        handshakeMessage =
          requested === "auto"
            ? ("Browser runtime ready. Auto-selected backend '" + negotiated + "'.")
            : ("Browser runtime ready. Requested backend '" + requested + "' unavailable; fallback to '" + negotiated + "'.");
      }
      try {
        if (typeof tf.setBackend === "function" && String(tf.getBackend() || "").toLowerCase() !== negotiated) {
          await tf.setBackend(negotiated);
        }
        if (typeof tf.ready === "function") await tf.ready();
      } catch (err) {
        return {
          ok: false,
          reason: "backend_set_failed",
          message: String(err && err.message ? err.message : err),
          runtimeConfig: cfg,
          backendAvailability: avail,
        };
      }
      const finalBackend = String(tf.getBackend ? tf.getBackend() : negotiated).toLowerCase() || negotiated;
      return {
        ok: true,
        reason: "ok",
        message: handshakeMessage,
        runtimeConfig: normalizeRuntimeConfig(cfg.runtimeId, finalBackend, cfg.transport),
        backendAvailability: avail,
      };
    }
    const caps = normalizeRuntimeCapabilities(state.runtimeCapabilities);
    if (!caps[cfg.runtimeId]) {
      return {
        ok: false,
        reason: "runtime_unavailable",
        message: "Runtime '" + cfg.runtimeId + "' is not available from capability handshake.",
        runtimeConfig: cfg,
      };
    }
    return {
      ok: true,
      reason: "ok",
      message: "Server runtime ready.",
      runtimeConfig: cfg,
    };
  }

  function createRuntimeTrainEvent(kind, context, payload) {
    const ctx = context || {};
    const cfg = normalizeRuntimeConfig(
      ctx.runtimeConfig && ctx.runtimeConfig.runtimeId,
      ctx.runtimeConfig && ctx.runtimeConfig.backend,
      ctx.runtimeConfig && ctx.runtimeConfig.transport
    );
    const body = payload && typeof payload === "object" ? payload : {};
    return Object.assign({
      irVersion: RUNTIME_EVENT_IR_VERSION,
      kind: String(kind || "unknown"),
      ts: Date.now(),
      sessionId: String(ctx.sessionId || ""),
      runtimeId: cfg.runtimeId,
      runtime: {
        host: cfg.host,
        engine: cfg.engine,
        backend: cfg.backend,
        transport: cfg.transport,
      },
    }, body);
  }

  function applyRuntimeTrainEventToSession(session, event) {
    const s = session || {};
    const ev = event || {};
    const kind = String(ev.kind || "");
    TRAINER_SESSION_STATE_CORE.applyRuntimeEvent(s, ev);
    syncWorkspaceStoreFromState("runtime_event_" + kind);
  }

  function normalizeRuntimeCapabilities(raw) {
    const caps = {
      js_client: true,
      server_tfjs: false,
      server_pytorch_gpu: false,
      server_pytorch_cpu: false,
    };
    if (!raw || typeof raw !== "object") return caps;
    if (typeof raw.js_client === "boolean") caps.js_client = raw.js_client;
    if (typeof raw.server_tfjs === "boolean") caps.server_tfjs = raw.server_tfjs;
    if (typeof raw.server_pytorch_gpu === "boolean") caps.server_pytorch_gpu = raw.server_pytorch_gpu;
    if (typeof raw.server_pytorch_cpu === "boolean") caps.server_pytorch_cpu = raw.server_pytorch_cpu;
    if (typeof raw.python_server_gpu === "boolean") caps.server_pytorch_gpu = raw.python_server_gpu;
    if (typeof raw.python_server_cpu === "boolean") caps.server_pytorch_cpu = raw.python_server_cpu;
    if (typeof raw.python_server === "boolean") caps.server_pytorch_cpu = caps.server_pytorch_cpu || raw.python_server;
    caps.js_client = true;
    return caps;
  }

  function summarizeRuntimeCapabilities(caps) {
    const c = normalizeRuntimeCapabilities(caps);
    const avail = RUNTIME_OPTION_DEFS.filter(function (o) {
      return o.value === "js_client" || Boolean(c[o.value]);
    }).map(function (o) { return o.label; });
    return avail.length ? avail.join(", ") : "client";
  }

  function updateRuntimeOptionsUi() {
    state.runtimeCapabilities = normalizeRuntimeCapabilities(state.runtimeCapabilities);
    const caps = state.runtimeCapabilities;
    state.trainSessions.forEach(function (s) {
      s.runtime = normalizeRuntimeId(s.runtime || "js_client");
      if (s.runtime !== "js_client" && !caps[s.runtime]) {
        s.runtime = "js_client";
      }
      s.runtimeBackend = normalizeRuntimeBackend(s.runtime, s.runtimeBackend || "auto");
    });
    if (ui.trainSessionRuntime) {
      const current = normalizeRuntimeId(String(ui.trainSessionRuntime.value || "js_client"));
      ui.trainSessionRuntime.innerHTML = runtimeOptionsHtml(current);
      const currentEnabled = current === "js_client" || Boolean(caps[current]);
      ui.trainSessionRuntime.value = currentEnabled ? current : "js_client";
    }
    if (ui.trainSessionRuntime && ui.trainSessionRuntimeBackend) {
      const runtime = normalizeRuntimeId(String(ui.trainSessionRuntime.value || "js_client"));
      const backend = normalizeRuntimeBackend(runtime, String(ui.trainSessionRuntimeBackend.value || "auto"));
      ui.trainSessionRuntimeBackend.innerHTML = runtimeBackendOptionsHtml(runtime, backend);
      ui.trainSessionRuntimeBackend.value = normalizeRuntimeBackend(runtime, backend);
    }
    if (ui.runtimeDetectInfo) {
      const serverEnabled = Boolean(caps.server_tfjs || caps.server_pytorch_gpu || caps.server_pytorch_cpu);
      const endpoint = String((ui.serverEndpointInput && ui.serverEndpointInput.value) || "").trim();
      ui.runtimeDetectInfo.textContent = serverEnabled
        ? ("Detected runtimes: " + summarizeRuntimeCapabilities(caps) + (endpoint ? (" | endpoint: " + endpoint) : ""))
        : "No server detected. Default runtime: js_client.";
      ui.runtimeDetectInfo.textContent += " | client_backends: " + summarizeClientTfjsBackends();
      if (!window.isSecureContext) {
        ui.runtimeDetectInfo.textContent += " | webgpu_note: requires https or localhost secure context";
      } else if (!(typeof navigator !== "undefined" && navigator.gpu)) {
        ui.runtimeDetectInfo.textContent += " | webgpu_note: navigator.gpu unavailable in this browser/device";
      }
    }
    if (ui.trainMainView) {
      renderTrainSessionTable();
    }
  }

  async function detectServerRuntimes() {
    const endpointRaw = String((ui.serverEndpointInput && ui.serverEndpointInput.value) || "").trim();
    const endpoint = endpointRaw.replace(/\/+$/g, "");
    const bases = [];
    if (endpoint) bases.push(endpoint);
    if (typeof window !== "undefined" && window.location && /^https?:/i.test(String(window.location.origin || ""))) {
      const origin = String(window.location.origin || "").replace(/\/+$/g, "");
      if (!bases.includes(origin)) bases.push(origin);
    }
    if (!bases.length) {
      state.runtimeCapabilities = normalizeRuntimeCapabilities(null);
      updateRuntimeOptionsUi();
      setTrainSessionStatus("No server endpoint set. Using js_client.");
      return state.runtimeCapabilities;
    }

    const paths = ["/api/runtime/capabilities", "/runtime/capabilities", "/runtime_capabilities.json"];
    let found = null;
    let lastErr = "";
    for (let bi = 0; bi < bases.length && !found; bi += 1) {
      const base = bases[bi];
      for (let pi = 0; pi < paths.length && !found; pi += 1) {
        const url = base + paths[pi];
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const tm = controller ? setTimeout(function () { controller.abort(); }, 2200) : null;
        try {
          const res = await fetch(url, { cache: "no-store", signal: controller ? controller.signal : undefined });
          if (!res.ok) continue;
          const payload = await res.json();
          if (payload && typeof payload === "object") {
            found = (payload.capabilities && typeof payload.capabilities === "object")
              ? payload.capabilities
              : payload;
          }
        } catch (err) {
          lastErr = String(err && err.message ? err.message : err);
        } finally {
          if (tm) clearTimeout(tm);
        }
      }
    }

    if (!found) {
      state.runtimeCapabilities = normalizeRuntimeCapabilities(null);
      updateRuntimeOptionsUi();
      setTrainSessionStatus("No server runtime capability endpoint found. Using js_client." + (lastErr ? (" Last error: " + lastErr) : ""));
      return state.runtimeCapabilities;
    }

    state.runtimeCapabilities = normalizeRuntimeCapabilities(found);
    updateRuntimeOptionsUi();
    setTrainSessionStatus("Runtime detection complete: " + summarizeRuntimeCapabilities(state.runtimeCapabilities));
    return state.runtimeCapabilities;
  }

  function runtimeOptionsHtml(selected) {
    const current = normalizeRuntimeId(selected || "js_client");
    return renderSelectOptionsHtml(runtimeOptionDefs(), current);
  }

  function runtimeBackendOptionsHtml(runtimeId, selected) {
    const rid = normalizeRuntimeId(runtimeId || "js_client");
    const current = normalizeRuntimeBackend(rid, selected || "auto");
    return renderSelectOptionsHtml(runtimeBackendOptionDefs(rid), current);
  }

  function schemaOptionsHtml(selected) {
    const sid = resolveSchemaId(selected || "oscillator");
    const list = listRegisteredSchemaEntries();
    if (!list.length) return "<option value='oscillator'>oscillator</option>";
    return list.map(function (s) {
      const id = resolveSchemaId(s.id || "oscillator");
      const sel = id === sid ? " selected" : "";
      return "<option value='" + escapeHtml(id) + "'" + sel + ">" + escapeHtml(String(s.label || id)) + "</option>";
    }).join("");
  }

  function datasetOptionsHtml(selected, schemaId) {
    const selectedId = String(selected || "").trim();
    const list = datasetOptionDefs(schemaId);
    if (!list.length) return "<option value=''> (no saved dataset for schema) </option>";
    return renderSelectOptionsHtml(list, selectedId);
  }

  function modelOptionsHtml(selected, schemaId) {
    const selectedId = String(selected || "").trim();
    const list = modelOptionDefs(schemaId);
    if (!list.length) return "<option value=''> (no saved model for schema) </option>";
    return renderSelectOptionsHtml(list, selectedId);
  }

  function renderSelectOptionsHtml(options, selectedValue) {
    const opts = Array.isArray(options) ? options : [];
    const current = String(selectedValue == null ? "" : selectedValue);
    return opts.map(function (o) {
      const value = String((o && o.value) == null ? "" : o.value);
      const label = String((o && o.label) == null ? value : o.label);
      const sel = current === value ? " selected" : "";
      const dis = o && o.disabled ? " disabled" : "";
      const title = o && o.title ? (" title='" + escapeHtml(String(o.title)) + "'") : "";
      return "<option value='" + escapeHtml(value) + "'" + sel + dis + title + ">" + escapeHtml(label) + "</option>";
    }).join("");
  }

  function runtimeOptionDefs() {
    const caps = normalizeRuntimeCapabilities(state.runtimeCapabilities);
    return RUNTIME_OPTION_DEFS.map(function (o) {
      return {
        value: String(o.value || ""),
        label: String(o.label || o.value || ""),
        disabled: !(o.value === "js_client" || Boolean(caps[o.value])),
      };
    });
  }

  function runtimeBackendOptionDefs(runtimeId) {
    const rid = normalizeRuntimeId(runtimeId || "js_client");
    const opts = runtimeBackendOptionsFor(rid);
    const avail = rid === "js_client" ? getClientTfjsBackendAvailability() : null;
    return opts.map(function (o) {
      const value = String(o.value || "auto");
      const label = String(o.label || value);
      const enabled = !avail || value === "auto" || Boolean(avail[value]);
      return {
        value: value,
        label: label,
        disabled: !enabled,
      };
    });
  }

  function datasetOptionDefs(schemaId) {
    ensureLibraryEntityIds();
    const sid = resolveSchemaId(schemaId || "oscillator");
    return sortRowsByUpdatedThenCreated(state.savedDatasets
      .map(function (d) {
        if (!d) return null;
        const id = String(d.id || "").trim();
        const name = String(d.name || "").trim();
        if (!id || !name) return null;
        return {
          id: id,
          name: name,
          value: id,
          label: name,
          schemaId: getSavedDatasetSchemaId(d, sid),
          updatedAt: Number(d.updatedAt || d.createdAt || 0),
          createdAt: Number(d.createdAt || 0),
        };
      })
      .filter(function (d) { return d && resolveSchemaId(d.schemaId) === sid; })
      .filter(Boolean))
      .map(function (d) {
        return {
          value: String(d.id || d.value || ""),
          label: String(d.name || d.label || ""),
          schemaId: d.schemaId,
        };
      });
  }

  function datasetModuleOptionDefs(schemaId) {
    const sid = resolveSchemaId(schemaId || "oscillator");
    return listDatasetModulesForSchema(sid)
      .map(function (m) {
        if (!m || typeof m !== "object") return null;
        const id = String(m.id || "").trim().toLowerCase();
        if (!id) return null;
        return {
          value: id,
          label: String(m.label || id) + " [" + id + "]",
          schemaId: sid,
        };
      })
      .filter(Boolean);
  }

  function modelOptionDefs(schemaId) {
    ensureLibraryEntityIds();
    const sid = resolveSchemaId(schemaId || "oscillator");
    return sortRowsByUpdatedThenCreated(state.savedModels
      .map(function (m) {
        if (!m) return null;
        const id = String(m.id || "").trim();
        const name = String(m.name || "").trim();
        if (!id || !name) return null;
        return {
          id: id,
          name: name,
          value: id,
          label: name,
          schemaId: getSavedModelSchemaId(m, sid),
          updatedAt: Number(m.updatedAt || m.createdAt || 0),
          createdAt: Number(m.createdAt || 0),
        };
      })
      .filter(function (m) { return m && resolveSchemaId(m.schemaId) === sid; })
      .filter(Boolean))
      .map(function (m) {
        return {
          value: String(m.id || m.value || ""),
          label: String(m.name || m.label || ""),
          schemaId: m.schemaId,
        };
      });
  }

  function modelOptionDefsAll() {
    ensureLibraryEntityIds();
    return sortRowsByUpdatedThenCreated(state.savedModels
      .map(function (m) {
        if (!m) return null;
        const id = String(m.id || "").trim();
        const name = String(m.name || "").trim();
        if (!id || !name) return null;
        const sid = getSavedModelSchemaId(m, "oscillator");
        return {
          value: id,
          label: name + " [" + sid + "]",
          schemaId: sid,
          id: id,
          name: name,
          updatedAt: Number(m.updatedAt || m.createdAt || 0),
          createdAt: Number(m.createdAt || 0),
        };
      })
      .filter(Boolean))
      .map(function (m) {
        return {
          value: String(m.value || m.id || ""),
          label: String(m.label || ""),
          schemaId: m.schemaId,
        };
      });
  }

  function renderSharedConfigForm(spec) {
    const cfg = spec || {};
    const mountEl = cfg.mountEl || null;
    if (!mountEl) return null;
    let panel = mountEl.__oscConfigPanelModule;
    if (!panel) {
      panel = CONFIG_PANEL_MODULE.create({ mountEl: mountEl });
      mountEl.__oscConfigPanelModule = panel;
    }
    return panel.render(cfg);
  }

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtLossCell(v) {
    const x = Number(v);
    return Number.isFinite(x) ? x.toExponential(3) : "-";
  }

  function renderTrainSessionEpochTable(session) {
    const s = session || {};
    const sid = String(s.id || "");
    if (!sid) return;
    const tbody = document.getElementById("trainSessionEpochBody_" + sid);
    if (!tbody) return;
    const hist = s.history || {};
    const ep = Array.isArray(hist.epoch) ? hist.epoch : [];
    const tr = Array.isArray(hist.loss) ? hist.loss : [];
    const vl = Array.isArray(hist.val_loss) ? hist.val_loss : [];
    const lr = Array.isArray(hist.lr) ? hist.lr : [];
    if (!ep.length) {
      tbody.innerHTML = "<tr><td colspan='4' style='color:#94a3b8;'>No epoch logs yet.</td></tr>";
      return;
    }
    let rows = "";
    for (let i = ep.length - 1; i >= 0; i -= 1) {
      rows +=
        "<tr>" +
          "<td>" + escapeHtml(ep[i]) + "</td>" +
          "<td>" + fmtLossCell(tr[i]) + "</td>" +
          "<td>" + fmtLossCell(vl[i]) + "</td>" +
          "<td>" + fmtLossCell(lr[i]) + "</td>" +
        "</tr>";
    }
    tbody.innerHTML = rows;
  }

  function plotTrainerLossChart(session) {
    if (!window.Plotly) return;
    const s = session || {};
    const chartId = "trainSessionChart_" + String(s.id || "");
    const el = document.getElementById(chartId);
    if (!el) return;
    const hist = s.history || {};
    const ep = Array.isArray(hist.epoch) ? hist.epoch : [];
    const tr = Array.isArray(hist.loss) ? hist.loss : [];
    const vl = Array.isArray(hist.val_loss) ? hist.val_loss : [];
    const traces = [];
    if (ep.length && tr.length) traces.push({ x: ep, y: tr, mode: "lines", name: "train_loss", line: { color: "#22d3ee" } });
    if (ep.length && vl.length) traces.push({ x: ep, y: vl, mode: "lines", name: "val_loss", line: { color: "#f59e0b" } });
    if (!traces.length) traces.push({ x: [0], y: [0], mode: "lines", name: "loss" });
    Plotly.react(
      el,
      traces,
      {
        paper_bgcolor: "#0b1220",
        plot_bgcolor: "#0b1220",
        font: { color: "#e2e8f0" },
        title: "Loss (" + String(s.name || "") + ")",
        xaxis: { title: "epoch", gridcolor: "#1e293b" },
        yaxis: { title: "loss", gridcolor: "#1e293b" },
        margin: { l: 42, r: 12, t: 34, b: 34 },
        height: 220,
        legend: { orientation: "h" },
      },
      { responsive: true }
    );
    renderTrainSessionEpochTable(s);
  }

  function bindTrainerMainViewEvents() {
    if (!ui.trainMainView) return;
    const rows = ui.trainMainView.querySelectorAll("[data-session-id]");
    rows.forEach(function (row) {
      const sid = String(row.getAttribute("data-session-id") || "");
      const q = function (sel) { return row.querySelector(sel); };
      const runBtn = q("[data-act='run']");
      if (runBtn) {
        runBtn.addEventListener("click", async function () {
          try {
            const runtime = getTrainingActionRuntime();
            if (!runtime || typeof runtime.runSessionsByIds !== "function") {
              throw new Error("Trainer run action is not initialized.");
            }
            await runtime.runSessionsByIds([sid]);
          } catch (err) {
            setTrainSessionStatus("Run session failed: " + err.message);
          }
        });
      }
      const exportBtn = q("[data-act='export']");
      if (exportBtn) {
        exportBtn.addEventListener("click", async function () {
          try {
            await exportNotebookZipClient([sid]);
          } catch (err) {
            setTrainSessionStatus("Session export failed: " + (err && err.message ? err.message : String(err)));
          }
        });
      }
      const clearBtn = q("[data-act='clear']");
      if (clearBtn) {
        clearBtn.addEventListener("click", function () {
          try {
            clearTrainSessionById(sid, "manual clear");
          } catch (err) {
            setTrainSessionStatus("Clear session failed: " + (err && err.message ? err.message : String(err)));
          }
        });
      }
    });
  }

  function clearTrainSessionById(sessionId, reason) {
    const sid = String(sessionId || "").trim();
    if (!sid) throw new Error("Trainer session id is required.");
    const session = getTrainSessionById(sid);
    if (!session) throw new Error("Trainer session not found: " + sid);
    if (state.trainQueueRunning) throw new Error("Cannot clear trainer session while training is running.");
    clearTrainSessionState(session, reason || "manual clear");
    normalizeTrainSessionRecord(session);
    syncWorkspaceStoreFromState("clear_train_session");
    renderTrainSessionTable();
    setTrainSessionStatus("Trainer session cleared: " + String(session.name || sid) + ".");
    return session;
  }

  function renderTrainSessionTable() {
    ensureLibraryEntityIds();
    if (!ui.trainMainView) return;
    if (!state.trainSessions.length) {
      ui.trainMainView.innerHTML = "<div class='panel'>No trainer selected.</div>";
      state.activeTrainSessionId = "";
      refreshTrainQueueActionButtons();
      renderRightTrainConfigPanel();
      if (state.currentWorkspace === "train") renderLeftLibraryByWorkspace();
      refreshRightInspectorPanels();
      return;
    }
    const activeId = resolveActiveTrainSessionId(state.activeTrainSessionId);
    state.activeTrainSessionId = activeId;
    const s = getTrainSessionById(activeId) || state.trainSessions[0];
    if (!s) return;
    state.activeTrainSessionId = String(s.id || "");
    normalizeTrainSessionRecord(s);
    const sid = String(s.id || "");
    const exportSupport = getNotebookExportSupport(s);
    const statusLabel = getTrainSessionStatusLabel(s);
    const last = (function () {
      if (!s.lastResult) return "last: (not run)";
      const note = String(s.lastResult.note || "").trim();
      if (note) return "last: " + note;
      const v = Number(s.lastResult.valMae);
      const t = Number(s.lastResult.testMae);
      if (Number.isFinite(v) && Number.isFinite(t)) {
        return "last: valMAE=" + v.toExponential(3) + " testMAE=" + t.toExponential(3);
      }
      return "last: (not run)";
    })();
    const runLocked = Boolean(state.trainQueueRunning);
    const runDisabledAttr = runLocked ? " disabled" : "";
    const clearDisabledAttr = runLocked ? " disabled" : "";
    const exportDisabled = runLocked || !exportSupport.ok;
    const exportDisabledAttr = exportDisabled ? " disabled" : "";
    const exportTitleAttr = exportSupport.ok
      ? ""
      : (" title='" + escapeHtml(exportSupport.reason) + "'");
    const runLabel = runLocked ? "Training..." : "Train";
    ui.trainMainView.innerHTML =
      "<div data-session-id='" + escapeHtml(sid) + "'>" +
        "<div class='compare-title' style='margin:0 0 6px 0;'>Trainer: " + escapeHtml(String(s.name || sid)) + "</div>" +
        "<div style='font-size:12px; color:#94a3b8;'>status=" + escapeHtml(statusLabel) + " | schema=" + escapeHtml(String(s.schemaId || "oscillator")) + " | dataset=" + escapeHtml(getSavedDatasetLabelById(s.datasetId, s.datasetName)) + " | model=" + escapeHtml(getSavedModelLabelById(s.modelId, s.modelName)) + " | family=" + escapeHtml(String(s.runtimeFamily || runtimeFamilyFor(s.runtime || "js_client"))) + " | runtime=" + escapeHtml(s.runtime || "js_client") + " | backend=" + escapeHtml(s.runtimeBackend || "auto") + "</div>" +
        "<div class='quick-actions' style='margin:8px 0;'>" +
          "<button data-act='run' style='width:auto; padding:4px 8px;'" + runDisabledAttr + ">" + runLabel + "</button>" +
          "<button class='secondary' data-act='clear' style='width:auto; padding:4px 8px;'" + clearDisabledAttr + ">Clear Session</button>" +
          "<button class='secondary' data-act='export' style='width:auto; padding:4px 8px;'" + exportDisabledAttr + exportTitleAttr + ">Export Notebook ZIP</button>" +
        "</div>" +
        (!exportSupport.ok
          ? ("<div class='hint' style='margin-bottom:6px; color:#fda4af;'>" + escapeHtml(exportSupport.reason) + "</div>")
          : "") +
        "<div class='hint' style='margin-bottom:6px;'>" + escapeHtml(last) + "</div>" +
        "<div id='trainSessionChart_" + escapeHtml(sid) + "' class='chart' style='min-height:220px;'></div>" +
        "<div class='metric-wrap' style='max-height:220px; margin-top:8px;'>" +
          "<table class='metric-table'>" +
            "<thead><tr><th>epoch</th><th>train_loss</th><th>val_loss</th><th>lr</th></tr></thead>" +
            "<tbody id='trainSessionEpochBody_" + escapeHtml(sid) + "'></tbody>" +
          "</table>" +
        "</div>" +
      "</div>";
    bindTrainerMainViewEvents();
    plotTrainerLossChart(s);
    renderTrainSessionEpochTable(s);
    refreshTrainQueueActionButtons();
    if (state.currentWorkspace === "train") renderLeftLibraryByWorkspace();
    refreshRightInspectorPanels();
  }

  function refreshTrainQueueActionButtons() {
    // Training Lab uses card-level actions only.
    return;
  }

  function buildTrainCfgFromUi() {
    const trainerCfg = getTrainerControlOptionsFromUI();
    return {
      epochs: Number(ui.epochs && ui.epochs.value) || 40,
      batchSize: Number(ui.batchSize && ui.batchSize.value) || 64,
      optimizerType: String(trainerCfg.optimizerType || "adam"),
      learningRate: Number(ui.learningRate && ui.learningRate.value) || 1e-3,
      lrSchedulerType: String(trainerCfg.lrSchedulerType || "plateau"),
      useLrScheduler: Boolean(trainerCfg.useLrScheduler),
      lrPatience: Number(trainerCfg.lrPatience),
      lrFactor: Number(trainerCfg.lrFactor),
      minLr: Number(trainerCfg.minLr),
      gradClipNorm: Number(trainerCfg.gradClipNorm),
      gradClipValue: Number(trainerCfg.gradClipValue),
      restoreBestWeights: Boolean(trainerCfg.restoreBestWeights),
      earlyStoppingPatience: Number(trainerCfg.earlyStoppingPatience),
    };
  }

  function addTrainSessionFromSpec(spec) {
    ensureLibraryEntityIds();
    const cfg = spec || {};
    const name = String(cfg.name || "").trim();
    const runtime = normalizeRuntimeId(cfg.runtime || "js_client");
    const runtimeBackendRaw = String(cfg.runtimeBackend || "auto");
    const incomingSchema = resolveSchemaId(cfg.schemaId || pickDefaultTrainerSchemaId() || state.modelSchemaId || "oscillator");
    if (!name) throw new Error("Session name is required.");
    const schemaId = resolveSchemaId(
      incomingSchema ||
      state.modelSchemaId ||
      "oscillator"
    );
    let datasetId = String(cfg.datasetId || "").trim();
    let modelId = String(cfg.modelId || "").trim();
    if (!datasetId) datasetId = getFirstSavedDatasetIdForSchema(schemaId) || "";
    if (!modelId) modelId = getFirstSavedModelIdForSchema(schemaId) || "";
    const ds = datasetId ? getSavedDatasetById(datasetId) : null;
    if (datasetId && (!ds || !ds.data)) throw new Error("Dataset not found: " + datasetId);
    const model = modelId ? getSavedModelById(modelId) : null;
    if (modelId && (!model || !model.graph)) throw new Error("Model not found: " + modelId);
    const dsSchemaId = ds ? getSavedDatasetSchemaId(ds, schemaId) : schemaId;
    const modelSchemaId = model ? getSavedModelSchemaId(model, schemaId) : schemaId;
    if (datasetId && dsSchemaId !== schemaId) {
      throw new Error("Dataset schema mismatch. Expected '" + schemaId + "', got '" + dsSchemaId + "'.");
    }
    if (modelId && modelSchemaId !== schemaId) {
      throw new Error("Model schema mismatch. Expected '" + schemaId + "', got '" + modelSchemaId + "'.");
    }
    const id = "sess_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
    const session = {
      id: id,
      name: name,
      schemaId: schemaId,
      datasetId: String(datasetId),
      datasetName: getSavedDatasetLabelById(datasetId, ds && ds.name),
      modelId: String(modelId),
      modelName: getSavedModelLabelById(modelId, model && model.name),
      runtime: runtime,
      runtimeFamily: runtimeFamilyFor(runtime),
      runtimeBackend: normalizeRuntimeBackend(runtime, runtimeBackendRaw || "auto"),
      trainCfg: cfg.trainCfg && typeof cfg.trainCfg === "object" ? cfg.trainCfg : buildTrainCfgFromUi(),
      selected: true,
      collapsed: false,
      history: createEmptyTrainSessionHistory(),
      lastResult: null,
      status: (!String(datasetId || "").trim() || !String(modelId || "").trim()) ? "draft" : "ready",
      lockState: {
        datasetLocked: false,
        modelLocked: false,
        runtimeLocked: false,
      },
      runtimeStatus: {
        state: (!String(datasetId || "").trim() || !String(modelId || "").trim()) ? "draft" : "ready",
        message: "Trainer created.",
        ts: Date.now(),
        runtimeId: runtime,
        backend: normalizeRuntimeBackend(runtime, runtimeBackendRaw || "auto"),
        transport: "",
        engine: "",
        host: "",
      },
      sessionArtifactRef: null,
      checkpointRef: null,
      createdAt: Date.now(),
    };
    ensureTrainSessionConfigDefaults(session);
    normalizeTrainSessionRecord(session);
    state.trainSessions.push(session);
    state.activeTrainSessionId = id;
    renderTrainSessionTable();
    syncWorkspaceStoreFromState("add_train_session");
    setTrainSessionStatus("Trainer created: " + name);
  }

  function addTrainSessionFromUi() {
    return addTrainSessionFromSpec({
      name: String((ui.trainSessionName && ui.trainSessionName.value) || "").trim(),
      schemaId: String((ui.trainSessionSchemaSelect && ui.trainSessionSchemaSelect.value) || state.modelSchemaId || "oscillator"),
      datasetId: String((ui.trainSessionDatasetSelect && ui.trainSessionDatasetSelect.value) || "").trim(),
      modelId: String((ui.trainSessionModelSelect && ui.trainSessionModelSelect.value) || "").trim(),
      runtime: String((ui.trainSessionRuntime && ui.trainSessionRuntime.value) || "js_client"),
      runtimeBackend: String((ui.trainSessionRuntimeBackend && ui.trainSessionRuntimeBackend.value) || "auto"),
      trainCfg: buildTrainCfgFromUi(),
    });
  }

  function getSelectedTrainSessions() {
    const active = getActiveTrainSession();
    return active ? [active] : [];
  }

  function plotTrajectoriesOn(chartEl, traces, title, scenario) {
    if (!chartEl || !window.Plotly) return;
    const s = scenario || ui.scenarioType.value;
    const showLegend = Array.isArray(traces) && traces.length > 1;
    const fixedHeight = chartEl && chartEl.id === "datasetChart" ? 360 : null;
    const layout = {
      paper_bgcolor: "#0b1220",
      plot_bgcolor: "#0b1220",
      font: { color: "#e2e8f0" },
      title: title,
      height: fixedHeight || undefined,
      margin: { l: 52, r: 24, t: 64, b: 44 },
      xaxis: { title: "time (s)", gridcolor: "#1e293b" },
      yaxis: { title: getYAxisLabel(s), gridcolor: "#1e293b" },
      showlegend: showLegend,
      legend: {
        orientation: "h",
        y: 0.995,
        yanchor: "top",
        x: 0.02,
        xanchor: "left",
        bgcolor: "rgba(11,18,32,0.55)",
        bordercolor: "#334155",
        borderwidth: 1,
      },
    };
    const config = { responsive: true };
    if (chartEl.id === "datasetChart") {
      setDatasetChartVisibility(true);
      chartEl.style.height = "360px";
      chartEl.style.minHeight = "360px";
      chartEl.style.maxHeight = "360px";
      if (chartEl.data || chartEl._fullLayout) {
        Plotly.react(chartEl, traces, layout, config);
      } else {
        Plotly.newPlot(chartEl, traces, layout, config);
      }
      return;
    }
    // Prefer react for non-dataset charts to reduce redraw flicker.
    if (chartEl.data) {
      Plotly.react(chartEl, traces, layout, config);
    } else {
      Plotly.newPlot(chartEl, traces, layout, config);
    }
  }

  function showPreviewChartMode(mode) {
    const split = String(mode || "single") === "split";
    if (ui.chart) ui.chart.style.display = split ? "none" : "";
    if (ui.previewSplitCharts) ui.previewSplitCharts.style.display = split ? "" : "none";
    if (ui.eomMainOverlay) ui.eomMainOverlay.style.display = split ? "none" : "";
    if (ui.eomSpringOverlay) ui.eomSpringOverlay.style.display = split ? "" : "none";
    if (ui.eomPendulumOverlay) ui.eomPendulumOverlay.style.display = split ? "" : "none";
    if (ui.eomBouncingOverlay) ui.eomBouncingOverlay.style.display = split ? "" : "none";
  }

  function plotTrajectories(traces, title, scenario) {
    showPreviewChartMode("single");
    plotTrajectoriesOn(ui.chart, traces, title, scenario);
  }

  function syncTableToPlottedTrajectory(ds, tr) {
    if (!ds || !tr || !Array.isArray(ds.trajectories)) return;
    const idx = ds.trajectories.indexOf(tr);
    if (idx < 0) return;
    if (ui.dataScenarioFilter) ui.dataScenarioFilter.value = "all";
    if (ui.dataTrajIdx) ui.dataTrajIdx.innerHTML = "";
    renderDataTable(ds, idx);
  }

  function plotPreviewSplitByScenario(seriesMap, titlePrefix) {
    showPreviewChartMode("split");
    const scenList = ["spring", "pendulum", "bouncing"];
    const chartByScenario = {
      spring: ui.evalChartSpring,
      pendulum: ui.evalChartPendulum,
      bouncing: ui.evalChartBouncing,
    };
    scenList.forEach(function (scen) {
      const traces = (seriesMap && seriesMap[scen] && seriesMap[scen].length)
        ? seriesMap[scen]
        : [{ x: [0], y: [0], mode: "lines", name: "No data", line: { color: "#334155" } }];
      plotTrajectoriesOn(
        chartByScenario[scen],
        traces,
        String(titlePrefix || "Preview") + " - " + scen,
        scen
      );
    });
  }

  const state = {
    editor: null,
    dataset: null,
    datasetsByMode: { autoregressive: null, direct: null },
    activeDatasetId: "",
    activeDatasetName: "",
    renderedDatasetId: "",
    activeDatasetModuleId: "oscillator",
    playgroundSchemaId: "",
    activeModelId: "",
    activeModelName: "",
    renderedModelId: "",
    activeTrainSessionId: "",
    savedDatasets: [],
    savedModels: [],
    modelSchemaId: SCHEMA_REGISTRY.getDefaultSchemaId(),
    modelGraphBaselineSig: "",
    unsavedPromptAction: null,
    trainSessions: [],
    workspaceStore: createWorkspaceStoreInstance(),
    workspaceStoreUpdatedAt: 0,
    workspaceMetaSyncHandle: null,
    workspaceMetaSignature: "",
    runtimeCapabilities: {
      js_client: true,
      server_tfjs: false,
      server_pytorch_gpu: false,
      server_pytorch_cpu: false,
    },
    trainQueueRunning: false,
    model: null,
    modelIsSequence: false,
    modelTargetMode: "x",
    modelOutputSize: 1,
    preparedDataset: null,
    metricsLog: [],
    lastBatchStatusMs: 0,
    currentExpId: "",
    currentConfigSig: "",
    metricsBaseConfigSig: "",
    sweepRunCount: 0,
    lastSweepSig: "",
    sidebarSections: null,
    currentWorkspace: "preview",
    dataLabSubTab: "preview",
    entityCreateContext: null,
    rightInspectorForms: {
      dataset: null,
      playground: null,
      train: null,
    },
    entityCreateForm: null,
    modelTabAutoArrangedOnce: false,
    configVisible: true,
    activeNodeId: "",
    previewRefreshTimer: null,
    latentMonitorHistory: { epoch: [], abs: [], norm: [] },
    generationRows: [],
    generationQualityRows: [],
    checklist: {},
    benchmarkDetails: [],
    moduleConfigState: {
      dataset: Object.create(null),
      playground: Object.create(null),
    },
    datasetRenderCache: Object.create(null),
    datasetSelectionRenderSeq: 0,
    datasetSelectionRenderHandle: null,
    datasetWorker: null,
    datasetWorkerBusy: false,
    datasetWorkerRunSeq: 0,
    trainingWorker: null,
    trainingWorkerBusy: false,
    trainingWorkerRunSeq: 0,
    playgroundPreviewRenderSeq: 0,
    playgroundPreviewStatus: { phase: "idle", message: "" },
    workspaceBootstrapPromise: null,
    workspaceBootstrapped: false,
  };

  function clonePlainObject(value) {
    if (!value || typeof value !== "object") return {};
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_err) {
      return Object.assign({}, value);
    }
  }

  function getModuleConfigBucket(scope) {
    const key = String(scope || "").trim().toLowerCase();
    if (!key) throw new Error("Module config scope is required.");
    if (!state.moduleConfigState[key]) state.moduleConfigState[key] = Object.create(null);
    return state.moduleConfigState[key];
  }

  function getModuleConfigState(scope, moduleId, defaults) {
    const bucket = getModuleConfigBucket(scope);
    const id = String(moduleId || "").trim().toLowerCase();
    if (!id) return clonePlainObject(defaults);
    if (!bucket[id]) bucket[id] = clonePlainObject(defaults);
    return clonePlainObject(bucket[id]);
  }

  function setModuleConfigState(scope, moduleId, nextValue) {
    const bucket = getModuleConfigBucket(scope);
    const id = String(moduleId || "").trim().toLowerCase();
    if (!id) return {};
    bucket[id] = clonePlainObject(nextValue);
    return getModuleConfigState(scope, id, {});
  }

  function patchModuleConfigState(scope, moduleId, patch) {
    const current = getModuleConfigState(scope, moduleId, {});
    const next = Object.assign({}, current, clonePlainObject(patch));
    return setModuleConfigState(scope, moduleId, next);
  }

  function buildDatasetStoreStats(entry) {
    const d = (entry && entry.data) ? entry.data : {};
    const trajectories = Array.isArray(d.trajectories) ? d.trajectories.length : 0;
    const trainRows = Number(
      (Array.isArray(d.yTrain) ? d.yTrain.length : NaN) ||
      (Array.isArray(d.trainRows) ? d.trainRows.length : NaN) ||
      d.trainCount
    ) || 0;
    const valRows = Number(
      (Array.isArray(d.yVal) ? d.yVal.length : NaN) ||
      (Array.isArray(d.valRows) ? d.valRows.length : NaN) ||
      d.valCount
    ) || 0;
    const testRows = Number(
      (Array.isArray(d.yTest) ? d.yTest.length : NaN) ||
      (Array.isArray(d.testRows) ? d.testRows.length : NaN) ||
      d.testCount
    ) || 0;
    return {
      mode: String(d.mode || ""),
      trajectories: trajectories,
      trainRows: trainRows,
      valRows: valRows,
      testRows: testRows,
      splitMode: String((d.splitConfig && d.splitConfig.mode) || ""),
    };
  }

  function buildTrainEpochRowsForStore(session) {
    const s = session || {};
    const hist = s.history || {};
    const ep = Array.isArray(hist.epoch) ? hist.epoch : [];
    const tr = Array.isArray(hist.loss) ? hist.loss : [];
    const vl = Array.isArray(hist.val_loss) ? hist.val_loss : [];
    const lr = Array.isArray(hist.lr) ? hist.lr : [];
    const rows = [];
    for (let i = 0; i < ep.length; i += 1) {
      const epoch = Number(ep[i]);
      if (!Number.isFinite(epoch)) continue;
      rows.push({
        epoch: epoch,
        train_loss: Number(tr[i]),
        val_loss: Number(vl[i]),
        lr: Number(lr[i]),
      });
    }
    return rows;
  }

  function createEmptyTrainSessionHistory() {
    return TRAINER_SESSION_STATE_CORE.createEmptyHistory();
  }

  function hasTrainSessionHistory(session) {
    return TRAINER_SESSION_STATE_CORE.hasHistory(session || {});
  }

  function normalizeTrainSessionStatus(session) {
    return TRAINER_SESSION_STATE_CORE.normalizeStatus(session || {});
  }

  function normalizeTrainSessionLockState(session) {
    return TRAINER_SESSION_STATE_CORE.normalizeLockState(session || {});
  }

  function clearTrainSessionState(session, reason) {
    return TRAINER_SESSION_STATE_CORE.clearState(session || {}, reason);
  }

  function getTrainSessionStatusLabel(session) {
    return TRAINER_SESSION_STATE_CORE.getStatusLabel(session || {});
  }

  function buildWorkspaceStoreDocumentFromState() {
    ensureLibraryEntityIds();
    const now = Date.now();
    const datasetsById = {};
    state.savedDatasets.forEach(function (entry) {
      if (!entry) return;
      const id = String(entry.id || "").trim();
      if (!id) return;
      const schemaId = getSavedDatasetSchemaId(entry, "oscillator");
      datasetsById[id] = {
        id: id,
        name: String(entry.name || id),
        schemaId: schemaId,
        createdAt: Number(entry.createdAt) || now,
        updatedAt: now,
        stats: buildDatasetStoreStats(entry),
        payload: entry.data || null,
      };
    });
    const modelsById = {};
    state.savedModels.forEach(function (entry) {
      if (!entry) return;
      const id = String(entry.id || "").trim();
      if (!id) return;
      const schemaId = getSavedModelSchemaId(entry, "oscillator");
      modelsById[id] = {
        id: id,
        name: String(entry.name || id),
        schemaId: schemaId,
        createdAt: Number(entry.createdAt) || now,
        updatedAt: Number(entry.updatedAt) || now,
        payload: entry.graph || null,
      };
    });
    const trainerCardsById = {};
    const trainEpochsBySessionId = {};
    state.trainSessions.forEach(function (session) {
      if (!session) return;
      const sid = String(session.id || "").trim();
      if (!sid) return;
      const schemaId = inferSessionSchemaId(session, state.modelSchemaId || "oscillator");
      trainerCardsById[sid] = {
        id: sid,
        name: String(session.name || sid),
        schemaId: schemaId,
        datasetId: String(session.datasetId || ""),
        modelId: String(session.modelId || ""),
        runtime: normalizeRuntimeId(session.runtime || "js_client"),
        runtimeFamily: String(session.runtimeFamily || runtimeFamilyFor(session.runtime || "js_client") || "tfjs"),
        runtimeBackend: normalizeRuntimeBackend(session.runtime || "js_client", session.runtimeBackend || "auto"),
        trainCfg: Object.assign({}, session.trainCfg || {}),
        selected: Boolean(session.selected),
        collapsed: Boolean(session.collapsed),
        createdAt: Number(session.createdAt) || now,
        updatedAt: now,
        status: String(session.status || normalizeTrainSessionStatus(session) || "ready"),
        lockState: Object.assign({}, session.lockState || normalizeTrainSessionLockState(session)),
        runtimeStatus: session.runtimeStatus ? Object.assign({}, session.runtimeStatus) : null,
        lastResult: session.lastResult ? Object.assign({}, session.lastResult) : null,
        sessionArtifactRef: session.sessionArtifactRef || null,
        checkpointRef: session.checkpointRef || null,
      };
      trainEpochsBySessionId[sid] = buildTrainEpochRowsForStore(session);
    });
    return {
      irVersion: (state.workspaceStore && state.workspaceStore.contractVersion) || "1.0",
      updatedAt: now,
      datasetsById: datasetsById,
      modelsById: modelsById,
      trainerCardsById: trainerCardsById,
      trainEpochsBySessionId: trainEpochsBySessionId,
      meta: {
        activeDatasetId: String(state.activeDatasetId || ""),
        activeModelId: String(state.activeModelId || ""),
        activeTrainSessionId: String(state.activeTrainSessionId || ""),
        modelSchemaId: resolveSchemaId(state.modelSchemaId || "oscillator"),
      },
    };
  }

  function syncWorkspaceStoreFromState(reason) {
    if (!state.workspaceStore || typeof state.workspaceStore.replace !== "function") return;
    state.workspaceStore.replace(buildWorkspaceStoreDocumentFromState());
    state.workspaceStoreUpdatedAt = Date.now();
    if (typeof window !== "undefined") {
      window.__oscWorkspaceStoreSnapshot = function () {
        return (state.workspaceStore && typeof state.workspaceStore.snapshot === "function")
          ? state.workspaceStore.snapshot()
          : buildWorkspaceStoreDocumentFromState();
      };
      window.__oscWorkspaceStoreLastReason = String(reason || "");
    }
  }

  function getWorkspaceMetaSignature() {
    const next = {
      activeDatasetId: String(state.activeDatasetId || ""),
      activeModelId: String(state.activeModelId || ""),
      activeTrainSessionId: String(state.activeTrainSessionId || ""),
      modelSchemaId: resolveSchemaId(state.modelSchemaId || "oscillator"),
    };
    return String(next.activeDatasetId) + "|" + String(next.activeModelId) + "|" + String(next.activeTrainSessionId) + "|" + String(next.modelSchemaId);
  }

  function syncWorkspaceStoreMetaOnly(reason) {
    if (!state.workspaceStore) return;
    const patch = {
      activeDatasetId: String(state.activeDatasetId || ""),
      activeModelId: String(state.activeModelId || ""),
      activeTrainSessionId: String(state.activeTrainSessionId || ""),
      modelSchemaId: resolveSchemaId(state.modelSchemaId || "oscillator"),
    };
    const nextSig = getWorkspaceMetaSignature();
    if (state.workspaceMetaSignature === nextSig && state.workspaceMetaSyncHandle) {
      return;
    }
    if (state.workspaceMetaSignature === nextSig) {
      if (typeof window !== "undefined") {
        window.__oscWorkspaceStoreLastReason = String(reason || "");
      }
      return;
    }
    state.workspaceMetaSignature = nextSig;
    if (state.workspaceMetaSyncHandle) {
      clearTimeout(state.workspaceMetaSyncHandle);
      state.workspaceMetaSyncHandle = null;
    }
    state.workspaceMetaSyncHandle = setTimeout(function () {
      state.workspaceMetaSyncHandle = null;
      if (typeof state.workspaceStore.patchMeta === "function") {
        state.workspaceStore.patchMeta(patch);
        state.workspaceStoreUpdatedAt = Date.now();
        if (typeof window !== "undefined") {
          window.__oscWorkspaceStoreLastReason = String(reason || "");
        }
        return;
      }
      syncWorkspaceStoreFromState(reason || "meta_sync_fallback");
    }, 0);
  }

  function hasWorkspaceStoreData(doc) {
    const d = doc && typeof doc === "object" ? doc : {};
    const dsN = d.datasetsById && typeof d.datasetsById === "object" ? Object.keys(d.datasetsById).length : 0;
    const mN = d.modelsById && typeof d.modelsById === "object" ? Object.keys(d.modelsById).length : 0;
    const sN = d.trainerCardsById && typeof d.trainerCardsById === "object" ? Object.keys(d.trainerCardsById).length : 0;
    const eN = d.trainEpochsBySessionId && typeof d.trainEpochsBySessionId === "object" ? Object.keys(d.trainEpochsBySessionId).length : 0;
    return (dsN + mN + sN + eN) > 0;
  }

  function hydrateStateFromWorkspaceDoc(doc) {
    const d = doc && typeof doc === "object" ? doc : null;
    if (!d) return false;

    const datasetsById = (d.datasetsById && typeof d.datasetsById === "object") ? d.datasetsById : {};
    const modelsById = (d.modelsById && typeof d.modelsById === "object") ? d.modelsById : {};
    const trainerCardsById = (d.trainerCardsById && typeof d.trainerCardsById === "object") ? d.trainerCardsById : {};
    const trainEpochsBySessionId = (d.trainEpochsBySessionId && typeof d.trainEpochsBySessionId === "object") ? d.trainEpochsBySessionId : {};
    const meta = (d.meta && typeof d.meta === "object") ? d.meta : {};

    state.savedDatasets = Object.keys(datasetsById).map(function (id) {
      const rec = datasetsById[id] || {};
      return {
        id: String(rec.id || id),
        name: String(rec.name || rec.id || id),
        schemaId: resolveSchemaId(rec.schemaId || "oscillator"),
        createdAt: Number(rec.createdAt) || Date.now(),
        data: rec.payload || null,
      };
    }).sort(function (a, b) {
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    });

    state.savedModels = Object.keys(modelsById).map(function (id) {
      const rec = modelsById[id] || {};
      return {
        id: String(rec.id || id),
        name: String(rec.name || rec.id || id),
        schemaId: resolveSchemaId(rec.schemaId || "oscillator"),
        createdAt: Number(rec.createdAt) || Date.now(),
        updatedAt: Number(rec.updatedAt) || Date.now(),
        graph: rec.payload || null,
      };
    }).sort(function (a, b) {
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    });

    state.trainSessions = Object.keys(trainerCardsById).map(function (sid) {
      const rec = trainerCardsById[sid] || {};
      const rows = Array.isArray(trainEpochsBySessionId[sid]) ? trainEpochsBySessionId[sid] : [];
      const hist = { epoch: [], loss: [], val_loss: [], lr: [] };
      rows.forEach(function (r) {
        const rr = r && typeof r === "object" ? r : {};
        const ep = Number(rr.epoch);
        if (!Number.isFinite(ep)) return;
        hist.epoch.push(ep);
        hist.loss.push(Number(rr.train_loss));
        hist.val_loss.push(Number(rr.val_loss));
        hist.lr.push(Number(rr.lr));
      });
      return {
        id: String(rec.id || sid),
        name: String(rec.name || rec.id || sid),
        schemaId: resolveSchemaId(rec.schemaId || state.modelSchemaId || "oscillator"),
        datasetId: String(rec.datasetId || ""),
        datasetName: getSavedDatasetLabelById(rec.datasetId, ""),
        modelId: String(rec.modelId || ""),
        modelName: getSavedModelLabelById(rec.modelId, ""),
        runtime: normalizeRuntimeId(rec.runtime || "js_client"),
        runtimeFamily: String(rec.runtimeFamily || runtimeFamilyFor(rec.runtime || "js_client") || "tfjs"),
        runtimeBackend: normalizeRuntimeBackend(rec.runtime || "js_client", rec.runtimeBackend || "auto"),
        trainCfg: Object.assign({}, rec.trainCfg || {}),
        selected: rec.selected !== false,
        collapsed: Boolean(rec.collapsed),
        history: hist,
        status: String(rec.status || ""),
        lockState: rec.lockState && typeof rec.lockState === "object" ? Object.assign({}, rec.lockState) : null,
        runtimeStatus: rec.runtimeStatus && typeof rec.runtimeStatus === "object" ? Object.assign({}, rec.runtimeStatus) : null,
        lastResult: rec.lastResult ? Object.assign({}, rec.lastResult) : null,
        sessionArtifactRef: rec.sessionArtifactRef || null,
        checkpointRef: rec.checkpointRef || null,
        createdAt: Number(rec.createdAt) || Date.now(),
      };
    }).sort(function (a, b) {
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    });

    state.activeDatasetId = String(meta.activeDatasetId || "");
    state.activeModelId = String(meta.activeModelId || "");
    state.activeTrainSessionId = String(meta.activeTrainSessionId || "");
    state.activeTrainSessionId = resolveActiveTrainSessionId(state.activeTrainSessionId);
    state.modelSchemaId = resolveSchemaId(meta.modelSchemaId || state.modelSchemaId || "oscillator");
    state.activeDatasetName = getSavedDatasetLabelById(state.activeDatasetId, "");
    state.activeModelName = getSavedModelLabelById(state.activeModelId, "");
    state.dataset = null;
    state.datasetsByMode = { autoregressive: null, direct: null };
    state.preparedDataset = null;
    state.model = null;
    state.modelIsSequence = false;
    state.modelTargetMode = "x";
    state.modelOutputSize = 1;
    return true;
  }

  async function bootstrapWorkspaceStoreAdapter() {
    if (!WORKSPACE_STORE_RUNTIME || typeof WORKSPACE_STORE_RUNTIME.createIndexedDbStore !== "function") {
      syncWorkspaceStoreFromState("adapter_memory_only");
      return { mode: "memory", restored: false };
    }
    try {
      const store = await WORKSPACE_STORE_RUNTIME.createIndexedDbStore({
        dbName: "osc_workspace",
        storeName: "kv",
        docKey: "workspace_doc",
      });
      if (store && typeof store.snapshot === "function") {
        state.workspaceStore = store;
      }
      const snap = typeof state.workspaceStore.peekRaw === "function"
        ? state.workspaceStore.peekRaw()
        : (state.workspaceStore.snapshot ? state.workspaceStore.snapshot() : null);
      const restored = hasWorkspaceStoreData(snap) ? hydrateStateFromWorkspaceDoc(snap) : false;
      if (restored) {
        setTrainSessionStatus("Workspace restored from IndexedDB.");
      }
      return { mode: String((state.workspaceStore && state.workspaceStore.storageMode) || "memory"), restored: restored };
    } catch (err) {
      console.warn("Workspace adapter bootstrap failed:", err);
      return { mode: "memory", restored: false };
    }
  }

  function ensureWorkspaceStoreBootstrapped() {
    if (state.workspaceBootstrapped) {
      return Promise.resolve({
        mode: String((state.workspaceStore && state.workspaceStore.storageMode) || "memory"),
        restored: true,
      });
    }
    if (state.workspaceBootstrapPromise) {
      return state.workspaceBootstrapPromise;
    }
    state.workspaceBootstrapPromise = bootstrapWorkspaceStoreAdapter()
      .then(function (result) {
        state.workspaceBootstrapped = true;
        return result;
      })
      .catch(function (err) {
        state.workspaceBootstrapped = true;
        throw err;
      })
      .finally(function () {
        state.workspaceBootstrapPromise = null;
      });
    return state.workspaceBootstrapPromise;
  }

  const EXPERIMENT_CHECKLIST = [
    { id: "run1", name: "Run 1", preset: "Direct-MLP-Strong", target: "x", inference: "direct_only" },
    { id: "run2", name: "Run 2", preset: "AR-GRU-Strong", target: "x", inference: "ar_zero_pad" },
    { id: "run3", name: "Run 3", preset: "AR-GRU-Strong", target: "x", inference: "ar_rk4_warmup" },
    { id: "run4", name: "Run 4", preset: "AR-LSTM-Strong", target: "x", inference: "ar_zero_pad" },
    { id: "run5", name: "Run 5", preset: "AR-LSTM-Strong", target: "x", inference: "ar_rk4_warmup" },
    { id: "run6", name: "Run 6", preset: "EXP: Dual Encoder Z-Match (Direct)", target: "x", inference: "direct_only" },
    { id: "run7", name: "Run 7", preset: "EXP: AR-GRU + Z-Match", target: "x", inference: "ar_rk4_warmup" },
    { id: "run8", name: "Run 8", preset: "Direct-MLP-Strong", target: "params", inference: "direct_only" },
  ];

  function numFmt(v) {
    if (!Number.isFinite(v)) return "-";
    return Number(v).toExponential(3);
  }

  function meanOf(arr) {
    if (!Array.isArray(arr) || !arr.length) return NaN;
    let s = 0;
    let n = 0;
    for (let i = 0; i < arr.length; i += 1) {
      const v = Number(arr[i]);
      if (!Number.isFinite(v)) continue;
      s += v;
      n += 1;
    }
    return n ? (s / n) : NaN;
  }

  function stdOf(arr) {
    const mu = meanOf(arr);
    if (!Number.isFinite(mu)) return NaN;
    let s = 0;
    let n = 0;
    for (let i = 0; i < arr.length; i += 1) {
      const v = Number(arr[i]);
      if (!Number.isFinite(v)) continue;
      const d = v - mu;
      s += d * d;
      n += 1;
    }
    return n > 1 ? Math.sqrt(s / n) : 0;
  }

  function dominantFreqHz(xArr, dt) {
    const x = Array.isArray(xArr) ? xArr : [];
    const n = x.length;
    if (n < 8 || !Number.isFinite(dt) || dt <= 0) return 0;
    let bestK = 1;
    let bestMag = -Infinity;
    const kMax = Math.floor(n / 2);
    for (let k = 1; k <= kMax; k += 1) {
      let re = 0;
      let im = 0;
      for (let i = 0; i < n; i += 1) {
        const ang = (2 * Math.PI * k * i) / n;
        re += x[i] * Math.cos(ang);
        im -= x[i] * Math.sin(ang);
      }
      const mag = re * re + im * im;
      if (mag > bestMag) {
        bestMag = mag;
        bestK = k;
      }
    }
    return bestK / (n * dt);
  }

  function dampingProxy(arr, tArr) {
    const x = Array.isArray(arr) ? arr : [];
    const t = Array.isArray(tArr) ? tArr : [];
    if (x.length < 4 || t.length !== x.length) return NaN;
    const env = x.map(function (v) { return Math.abs(Number(v) || 0); });
    const peaks = [];
    for (let i = 1; i < env.length - 1; i += 1) {
      if (env[i] >= env[i - 1] && env[i] >= env[i + 1]) peaks.push(i);
    }
    if (peaks.length < 2) return NaN;
    const i0 = peaks[0];
    const i1 = peaks[peaks.length - 1];
    const e0 = Math.max(1e-8, env[i0]);
    const e1 = Math.max(1e-8, env[i1]);
    const dt = Math.max(1e-8, (Number(t[i1]) || 0) - (Number(t[i0]) || 0));
    return (Math.log(e0) - Math.log(e1)) / dt;
  }

  function getTrajectoryFeatureVector(yArr, tArr) {
    const y = Array.isArray(yArr) ? yArr.map(function (v) { return Number(v) || 0; }) : [];
    const t = Array.isArray(tArr) ? tArr.map(function (v) { return Number(v) || 0; }) : [];
    if (!y.length || t.length !== y.length) {
      return { amp: NaN, rms: NaN, fdom: NaN, rough: NaN, damp: NaN };
    }
    let minY = Infinity;
    let maxY = -Infinity;
    let s2 = 0;
    for (let i = 0; i < y.length; i += 1) {
      const v = y[i];
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
      s2 += v * v;
    }
    let rough = 0;
    let roughN = 0;
    for (let i = 1; i < y.length; i += 1) {
      rough += Math.abs(y[i] - y[i - 1]);
      roughN += 1;
    }
    const dt = y.length > 1 ? Math.max(1e-8, (t[t.length - 1] - t[0]) / (y.length - 1)) : 0.02;
    return {
      amp: 0.5 * (maxY - minY),
      rms: Math.sqrt(s2 / y.length),
      fdom: dominantFreqHz(y, dt),
      rough: roughN ? rough / roughN : 0,
      damp: dampingProxy(y, t),
    };
  }

  function featureDist(fPred, fRef) {
    const names = ["amp", "rms", "fdom", "rough", "damp"];
    const vals = [];
    names.forEach(function (k) {
      const a = Number(fPred[k]);
      const b = Number(fRef[k]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return;
      vals.push(Math.abs(a - b) / (Math.abs(b) + 1e-8));
    });
    return meanOf(vals);
  }

  function wassersteinLike(aArr, bArr) {
    const a = (Array.isArray(aArr) ? aArr : []).map(function (v) { return Number(v); }).filter(Number.isFinite).sort(function (x, y) { return x - y; });
    const b = (Array.isArray(bArr) ? bArr : []).map(function (v) { return Number(v); }).filter(Number.isFinite).sort(function (x, y) { return x - y; });
    if (!a.length || !b.length) return NaN;
    const n = Math.min(a.length, b.length);
    if (n < 2) return Math.abs(a[0] - b[0]);
    let s = 0;
    for (let i = 0; i < n; i += 1) {
      const ia = Math.min(a.length - 1, Math.round((i / (n - 1)) * (a.length - 1)));
      const ib = Math.min(b.length - 1, Math.round((i / (n - 1)) * (b.length - 1)));
      s += Math.abs(a[ia] - b[ib]);
    }
    return s / n;
  }

  function resetLatentMonitorChart(message) {
    state.latentMonitorHistory = { epoch: [], abs: [], norm: [] };
    if (ui.latentMonitorInfo) {
      ui.latentMonitorInfo.textContent = message || "Use Latent Z groups and/or VAE Reparam nodes to track latent metrics during training.";
    }
    if (!ui.latentMonitorChart) return;
    Plotly.newPlot(
      ui.latentMonitorChart,
      [
        { x: [], y: [], mode: "lines+markers", name: "mean |z1-z2|", line: { color: "#22d3ee" } },
        { x: [], y: [], mode: "lines+markers", name: "mean ||z1-z2||", line: { color: "#f59e0b" } },
      ],
      {
        paper_bgcolor: "#0b1220",
        plot_bgcolor: "#0b1220",
        font: { color: "#e2e8f0" },
        title: "Latent Match Monitor",
        xaxis: { title: "epoch", gridcolor: "#1e293b" },
        yaxis: { title: "mismatch", gridcolor: "#1e293b" },
        legend: { orientation: "h" },
      },
      { responsive: true }
    );
  }

  function appendLatentMonitorPoint(epoch1, latentStats) {
    if (!ui.latentMonitorChart || !latentStats || !Number.isFinite(Number(latentStats.absMean))) return;
    state.latentMonitorHistory.epoch.push(Number(epoch1));
    state.latentMonitorHistory.abs.push(Number(latentStats.absMean));
    state.latentMonitorHistory.norm.push(Number(latentStats.normMean));
    Plotly.react(
      ui.latentMonitorChart,
      [
        { x: state.latentMonitorHistory.epoch, y: state.latentMonitorHistory.abs, mode: "lines+markers", name: "mean |z1-z2|", line: { color: "#22d3ee" } },
        { x: state.latentMonitorHistory.epoch, y: state.latentMonitorHistory.norm, mode: "lines+markers", name: "mean ||z1-z2||", line: { color: "#f59e0b" } },
      ],
      {
        paper_bgcolor: "#0b1220",
        plot_bgcolor: "#0b1220",
        font: { color: "#e2e8f0" },
        title: "Latent Match Monitor",
        xaxis: { title: "epoch", gridcolor: "#1e293b" },
        yaxis: { title: "mismatch", gridcolor: "#1e293b" },
        legend: { orientation: "h" },
      },
      { responsive: true }
    );
  }

  function appendMetricRow(row) {
    if (!row.expId && state.currentExpId) row.expId = state.currentExpId;
    if (!row.configSig && state.currentConfigSig) row.configSig = state.currentConfigSig;
    if (row.configSig) {
      if (!state.metricsBaseConfigSig) {
        state.metricsBaseConfigSig = row.configSig;
      } else if (state.metricsBaseConfigSig !== row.configSig && ui.configMixWarning) {
        ui.configMixWarning.style.display = "block";
        ui.configMixWarning.textContent =
          "Warning: Metrics table contains mixed configurations. Clear Metrics for clean comparison.";
      }
    }
    const last = state.metricsLog.length ? state.metricsLog[state.metricsLog.length - 1] : null;
    if (last) {
      const same =
        String(last.type || "") === String(row.type || "") &&
        String(last.scenario || "") === String(row.scenario || "") &&
        String(last.model || "") === String(row.model || "") &&
        String(last.valMae || "") === String(row.valMae || "") &&
        String(last.testMae || "") === String(row.testMae || "") &&
        String(last.mae || "") === String(row.mae || "") &&
        String(last.rmse || "") === String(row.rmse || "") &&
        String(last.bias || "") === String(row.bias || "");
      if (same) return;
    }
    state.metricsLog.push(row);
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + String(row.type || "-") + "</td>" +
      "<td>" + String(row.expId || "-") + "</td>" +
      "<td>" + String(row.scenario || "-") + "</td>" +
      "<td>" + String(row.model || "-") + "</td>" +
      "<td>" + numFmt(row.valMae) + "</td>" +
      "<td>" + numFmt(row.testMae) + "</td>" +
      "<td>" + numFmt(row.mae) + "</td>" +
      "<td>" + numFmt(row.rmse) + "</td>" +
      "<td>" + numFmt(row.bias) + "</td>";
    ui.metricsTableBody.prepend(tr);
    try { localStorage.setItem("osc_benchmark_metrics", JSON.stringify(state.metricsLog)); } catch (err) {}
    updateBestModelSummary();
    refreshBenchmarkDetailViews();
  }

  function reloadMetricTable() {
    ui.metricsTableBody.innerHTML = "";
    for (let i = state.metricsLog.length - 1; i >= 0; i -= 1) {
      const row = state.metricsLog[i];
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + String(row.type || "-") + "</td>" +
        "<td>" + String(row.expId || "-") + "</td>" +
        "<td>" + String(row.scenario || "-") + "</td>" +
        "<td>" + String(row.model || "-") + "</td>" +
        "<td>" + numFmt(row.valMae) + "</td>" +
        "<td>" + numFmt(row.testMae) + "</td>" +
        "<td>" + numFmt(row.mae) + "</td>" +
        "<td>" + numFmt(row.rmse) + "</td>" +
        "<td>" + numFmt(row.bias) + "</td>";
      ui.metricsTableBody.appendChild(tr);
    }
    updateBestModelSummary();
    refreshBenchmarkDetailViews();
  }

  function refreshBenchmarkDetailViews() {
    renderScenarioSummaryChart();
    renderWorstCasesTable();
  }

  function renderScenarioSummaryChart() {
    if (!ui.scenarioSummaryChart) return;
    const rows = state.metricsLog.filter(function (r) {
      return String(r.type || "").indexOf("benchmark-avg-scenario") === 0 && Number.isFinite(Number(r.mae));
    });
    if (!rows.length) {
      Plotly.newPlot(
        ui.scenarioSummaryChart,
        [{ x: [], y: [], type: "bar", name: "MAE" }],
        {
          paper_bgcolor: "#0b1220",
          plot_bgcolor: "#0b1220",
          font: { color: "#e2e8f0" },
          title: "Scenario Summary (MAE)",
          xaxis: { title: "scenario | model", gridcolor: "#1e293b" },
          yaxis: { title: "MAE", gridcolor: "#1e293b" },
        },
        { responsive: true }
      );
      return;
    }
    const latestExpId = String(rows[rows.length - 1].expId || "");
    const picked = latestExpId ? rows.filter(function (r) { return String(r.expId || "") === latestExpId; }) : rows;
    const x = picked.map(function (r) { return String(r.scenario || "-") + " | " + String(r.model || "-"); });
    const y = picked.map(function (r) { return Number(r.mae); });
    Plotly.react(
      ui.scenarioSummaryChart,
      [{ x: x, y: y, type: "bar", marker: { color: "#38bdf8" }, name: "MAE" }],
      {
        paper_bgcolor: "#0b1220",
        plot_bgcolor: "#0b1220",
        font: { color: "#e2e8f0" },
        title: "Scenario Summary (Latest Exp ID: " + (latestExpId || "n/a") + ")",
        xaxis: { title: "scenario | model", gridcolor: "#1e293b", tickangle: -18 },
        yaxis: { title: "MAE", gridcolor: "#1e293b" },
        margin: { t: 42, l: 52, r: 20, b: 120 },
      },
      { responsive: true }
    );
  }

  function renderWorstCasesTable() {
    if (!ui.worstCasesTableBody) return;
    ui.worstCasesTableBody.innerHTML = "";
    const rows = (state.benchmarkDetails || []).filter(function (r) {
      return Number.isFinite(Number(r.mae));
    });
    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td colspan='6'>No benchmark-detail rows yet. Run Benchmark to populate.</td>";
      ui.worstCasesTableBody.appendChild(tr);
      return;
    }
    const latestExpId = String(rows[rows.length - 1].expId || "");
    const picked = latestExpId ? rows.filter(function (r) { return String(r.expId || "") === latestExpId; }) : rows;
    picked.sort(function (a, b) { return Number(b.mae) - Number(a.mae); });
    picked.slice(0, 12).forEach(function (r) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + String(r.model || "-") + "</td>" +
        "<td>" + String(r.scenario || "-") + "</td>" +
        "<td>" + String(r.trajIdx == null ? "-" : r.trajIdx) + "</td>" +
        "<td>" + numFmt(r.mae) + "</td>" +
        "<td>" + numFmt(r.rmse) + "</td>" +
        "<td>" + numFmt(r.bias) + "</td>";
      ui.worstCasesTableBody.appendChild(tr);
    });
  }

  function updateBestModelSummary() {
    if (!ui.bestModelSummary) return;
    const rows = state.metricsLog.filter(function (r) {
      return String(r.type || "").indexOf("benchmark-avg") === 0 &&
        String(r.type || "").indexOf("scenario") < 0 &&
        Number.isFinite(Number(r.mae));
    });
    if (!rows.length) {
      ui.bestModelSummary.textContent = "Best model summary will appear after benchmarks.";
      return;
    }
    rows.sort(function (a, b) { return Number(a.mae) - Number(b.mae); });
    const best = rows[0];
    ui.bestModelSummary.textContent =
      "Best mixed benchmark so far: " +
      String(best.model || "-") +
      " | MAE=" + numFmt(best.mae) +
      " RMSE=" + numFmt(best.rmse) +
      " Bias=" + numFmt(best.bias) +
      " | Exp ID: " + String(best.expId || "-");
  }

  function loadChecklistState() {
    try {
      const raw = localStorage.getItem("osc_experiment_checklist");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") state.checklist = parsed;
    } catch (err) {}
  }

  function saveChecklistState() {
    try { localStorage.setItem("osc_experiment_checklist", JSON.stringify(state.checklist || {})); } catch (err) {}
  }

  function renderExperimentChecklist() {
    if (!ui.checklistTableBody) return;
    ui.checklistTableBody.innerHTML = "";
    EXPERIMENT_CHECKLIST.forEach(function (row) {
      const done = Boolean(state.checklist && state.checklist[row.id]);
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td><input type='checkbox' data-id='" + row.id + "'" + (done ? " checked" : "") + "></td>" +
        "<td>" + row.name + "</td>" +
        "<td>" + row.preset + "</td>" +
        "<td>" + row.target + "</td>" +
        "<td>" + row.inference + "</td>";
      ui.checklistTableBody.appendChild(tr);
    });
  }

  async function evaluateTrajectorySeries(opts) {
    const tr = opts.trajectory;
    const x = tr.x.slice();
    const t = tr.t.slice();
    const cond = opts.condition;
    const mode = String(opts.mode || "autoregressive");
    const vSeries = (tr.v && tr.v.length === tr.x.length) ? tr.v.slice() : tr.x.map(function (_, i) {
      if (i === 0) return 0;
      return (tr.x[i] - tr.x[i - 1]) / Math.max(opts.dt, 1e-6);
    });
    const rollout = rolloutPredictionSeries({
      model: opts.model,
      mode: mode,
      inferenceMethod: opts.inferenceMethod,
      warmupSteps: opts.warmupSteps,
      targetMode: opts.targetMode,
      isSequence: Boolean(opts.isSequence),
      featureConfig: opts.featureConfig,
      featureSpec: opts.featureSpec,
      condition: cond,
      x: x,
      v: vSeries,
      t: t,
      dt: opts.dt,
      durationSec: opts.durationSec || t[t.length - 1],
      windowSize: opts.windowSize,
      arHistory: opts.arHistory,
    });
    const targetMode = String(opts.targetMode || "x");
    const predicted = targetMode === "v" ? rollout.predictedV : rollout.predicted;
    const truth = targetMode === "v" ? vSeries : x;

    const err = truth.map(function (v, i) { return predicted[i] - v; });
    const absErr = err.map(function (e) { return Math.abs(e); });
    const mae = absErr.reduce(function (a, b) { return a + b; }, 0) / absErr.length;
    const rmse = Math.sqrt(err.reduce(function (a, b) { return a + b * b; }, 0) / err.length);
    const bias = err.reduce(function (a, b) { return a + b; }, 0) / err.length;
    return { mae: mae, rmse: rmse, bias: bias, truth: truth, predicted: predicted, t: t };
  }

  async function evaluateTrajectoryMetrics(opts) {
    const out = await evaluateTrajectorySeries(opts);
    return { mae: out.mae, rmse: out.rmse, bias: out.bias };
  }

  function getGenerationTrajectoryPool(ds, scenario) {
    if (!ds || !Array.isArray(ds.trajectories)) return [];
    const scen = String(scenario || "spring");
    return ds.trajectories
      .map(function (tr, i) { return { tr: tr, idx: i }; })
      .filter(function (x) {
        return matchesScenarioFilter(x.tr, scen, ds.scenarioType);
      });
  }

  function buildConditionFromTrajectory(tr, fallbackScenario) {
    const p = (tr && tr.params) || {};
    const playgroundState = getDatasetModuleScopedState("playground", "preview") || {};
    const dt = Math.max(1e-6, Number(playgroundState.previewDt) || Number(ui.dt && ui.dt.value) || 0.02);
    const durationSec = Math.max(dt, Number(playgroundState.previewDurationSec) || Number(ui.durationSec && ui.durationSec.value) || 16);
    const steps = getStepsFromDuration(durationSec, dt);
    const scenario = String(p.scenario || fallbackScenario || "spring");
    const gGlobal = Number.isFinite(Number(playgroundState.globalG))
      ? Number(playgroundState.globalG)
      : (Number.isFinite(Number(ui.globalG && ui.globalG.value)) ? Number(ui.globalG.value) : 9.81);
    const gVal = Number.isFinite(Number(p.g)) ? Number(p.g) : gGlobal;
    return {
      scenario: scenario,
      m: Number(p.m),
      c: Number(p.c),
      k: Number(p.k),
      g: gVal,
      restitution: Number(p.restitution ?? 0.8),
      groundModel: String(p.groundModel || "rigid"),
      groundK: Number(p.groundK ?? 2500),
      groundC: Number(p.groundC ?? 90),
      x0: Number(p.x0 ?? 0),
      v0: Number(p.v0 ?? 0),
      dt: dt,
      durationSec: durationSec,
      steps: steps,
    };
  }

  function applyRatioScaleToCondition(cond, ratioFeature, ratioScale) {
    const out = Object.assign({}, cond);
    const s = String(out.scenario || "spring");
    const rf = String(ratioFeature || "none");
    const rs = Number(ratioScale);
    if (!Number.isFinite(rs) || rf === "none") return out;
    if (rf === "rkm") out.k = Number(out.k) * rs;
    else if (rf === "rcm") out.c = Number(out.c) * rs;
    else if (rf === "rgl") {
      if (s === "pendulum") out.g = Number(out.g) * rs;
      if (s === "bouncing") {
        out.g = Number(out.g) * rs;
        out.k = out.g;
      }
    }
    return out;
  }

  function applyParamNoiseToCondition(cond, sigma, rng) {
    const out = Object.assign({}, cond);
    const s = String(out.scenario || "spring");
    const sg = Math.max(0, Number(sigma) || 0);
    if (!sg) return out;
    const lim = PRESET_LIMITS[s][String((ui.paramPreset && ui.paramPreset.value) || "safe")];
    const n = function (v) { return Number(v) * (1 + sg * ((rng() * 2) - 1)); };
    out.m = clamp(n(out.m), lim.m[0], lim.m[1]);
    out.c = clamp(n(out.c), lim.c[0], lim.c[1]);
    out.k = s === "bouncing" ? Number(out.k) : clamp(n(out.k), lim.k[0], lim.k[1]);
    out.x0 = clamp(n(out.x0), lim.x0[0], lim.x0[1]);
    out.v0 = clamp(n(out.v0), lim.v0[0], lim.v0[1]);
    if (s === "bouncing") out.restitution = clamp(n(out.restitution), lim.e[0], lim.e[1]);
    return out;
  }

  function renderGenerationMetricsTable() {
    if (!ui.genMetricsTableBody) return;
    ui.genMetricsTableBody.innerHTML = "";
    const rows = state.generationRows || [];
    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td colspan='8'>No generation results yet.</td>";
      ui.genMetricsTableBody.appendChild(tr);
      return;
    }
    rows.forEach(function (r, i) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + String(i + 1) + "</td>" +
        "<td>" + String(r.scenario || "-") + "</td>" +
        "<td>" + String(r.model || "-") + "</td>" +
        "<td>" + String(r.source || "-") + "</td>" +
        "<td>" + String(r.ratio || "-") + "</td>" +
        "<td>" + numFmt(r.mae) + "</td>" +
        "<td>" + numFmt(r.rmse) + "</td>" +
        "<td>" + numFmt(r.bias) + "</td>";
      ui.genMetricsTableBody.appendChild(tr);
    });
  }

  function getGenerationRowsSorted() {
    const rows = (state.generationRows || []).slice();
    const mode = String((ui.genSortMode && ui.genSortMode.value) || "recent");
    if (mode === "best_mae") rows.sort(function (a, b) { return Number(a.mae || Infinity) - Number(b.mae || Infinity); });
    else if (mode === "worst_mae") rows.sort(function (a, b) { return Number(b.mae || -Infinity) - Number(a.mae || -Infinity); });
    else rows.sort(function (a, b) { return Number(b.ts || 0) - Number(a.ts || 0); });
    return rows;
  }

  function refreshGenerationSampleSelect() {
    if (!ui.genSampleSelect) return;
    const rows = getGenerationRowsSorted();
    const prev = String(ui.genSampleSelect.value || "");
    ui.genSampleSelect.innerHTML = "";
    if (!rows.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(no sample)";
      ui.genSampleSelect.appendChild(opt);
      return;
    }
    rows.forEach(function (r) {
      const opt = document.createElement("option");
      opt.value = String(r.id);
      opt.textContent =
        String(r.scenario || "-") + " | MAE=" + numFmt(r.mae) +
        " | " + String(r.model || "-");
      ui.genSampleSelect.appendChild(opt);
    });
    const hasPrev = rows.some(function (r) { return String(r.id) === prev; });
    ui.genSampleSelect.value = hasPrev ? prev : String(rows[0].id);
  }

  function renderGenerationBatchChart() {
    if (!ui.genBatchChart) return;
    const rows = state.generationRows || [];
    if (!rows.length) {
      Plotly.newPlot(
        ui.genBatchChart,
        [{ x: [], y: [], type: "bar", name: "MAE" }],
        {
          paper_bgcolor: "#0b1220",
          plot_bgcolor: "#0b1220",
          font: { color: "#e2e8f0" },
          title: "Generation Batch Summary",
          xaxis: { title: "sample", gridcolor: "#1e293b" },
          yaxis: { title: "MAE", gridcolor: "#1e293b" },
        },
        { responsive: true }
      );
      return;
    }
    const x = rows.map(function (r, i) { return String(i + 1) + ":" + String(r.scenario || "-"); });
    const y = rows.map(function (r) { return Number(r.mae || 0); });
    Plotly.react(
      ui.genBatchChart,
      [{ x: x, y: y, type: "bar", name: "MAE", marker: { color: "#38bdf8" } }],
      {
        paper_bgcolor: "#0b1220",
        plot_bgcolor: "#0b1220",
        font: { color: "#e2e8f0" },
        title: "Generation Batch Summary (MAE)",
        xaxis: { title: "sample", gridcolor: "#1e293b", tickangle: -20 },
        yaxis: { title: "MAE", gridcolor: "#1e293b" },
        margin: { t: 42, l: 52, r: 20, b: 120 },
      },
      { responsive: true }
    );
  }

  function renderGenerationQualityTable() {
    if (!ui.genQualityTableBody) return;
    ui.genQualityTableBody.innerHTML = "";
    const rows = state.generationQualityRows || [];
    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td colspan='6'>Run Quality Check after generation.</td>";
      ui.genQualityTableBody.appendChild(tr);
      return;
    }
    rows.forEach(function (r) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + String(r.scope || "-") + "</td>" +
        "<td>" + String(r.model || "-") + "</td>" +
        "<td>" + String(r.scenario || "-") + "</td>" +
        "<td>" + String(r.samples || 0) + "</td>" +
        "<td>" + numFmt(r.integrity) + "</td>" +
        "<td>" + numFmt(r.diversityGap) + "</td>";
      ui.genQualityTableBody.appendChild(tr);
    });
  }

  function renderGenerationQualityChart() {
    if (!ui.genQualityChart) return;
    const rows = (state.generationQualityRows || []).filter(function (r) { return String(r.scope) !== "overall"; });
    if (!rows.length) {
      Plotly.newPlot(
        ui.genQualityChart,
        [{ x: [], y: [], type: "bar", name: "integrity" }],
        {
          paper_bgcolor: "#0b1220",
          plot_bgcolor: "#0b1220",
          font: { color: "#e2e8f0" },
          title: "Quality Overview",
          xaxis: { title: "scenario", gridcolor: "#1e293b" },
          yaxis: { title: "score", gridcolor: "#1e293b" },
          legend: { orientation: "h" },
        },
        { responsive: true }
      );
      return;
    }
    const x = rows.map(function (r) { return String(r.scenario); });
    const yI = rows.map(function (r) { return Number(r.integrity || 0); });
    const yD = rows.map(function (r) { return Number(r.diversityGap || 0); });
    Plotly.react(
      ui.genQualityChart,
      [
        { x: x, y: yI, type: "bar", name: "Integrity (lower better)", marker: { color: "#38bdf8" } },
        { x: x, y: yD, type: "bar", name: "Diversity Gap (lower better)", marker: { color: "#f59e0b" } },
      ],
      {
        barmode: "group",
        paper_bgcolor: "#0b1220",
        plot_bgcolor: "#0b1220",
        font: { color: "#e2e8f0" },
        title: "Quality Overview (Feature-based)",
        xaxis: { title: "scenario", gridcolor: "#1e293b" },
        yaxis: { title: "score", gridcolor: "#1e293b" },
        legend: { orientation: "h" },
      },
      { responsive: true }
    );
  }

  async function runGenerationQualityCheck() {
    const rows = state.generationRows || [];
    if (!rows.length) throw new Error("Run generation first.");
    const modelSet = {};
    rows.forEach(function (r) { modelSet[String(r.model || "-")] = true; });
    const modelLabel = Object.keys(modelSet).length === 1 ? Object.keys(modelSet)[0] : "mixed";
    const grouped = {};
    rows.forEach(function (r) {
      const scen = String(r.scenario || "unknown");
      if (!grouped[scen]) grouped[scen] = [];
      grouped[scen].push(r);
    });
    const out = [];
    const allInt = [];
    const allDiv = [];
    Object.keys(grouped).forEach(function (scen) {
      const g = grouped[scen];
      const integArr = [];
      const predByFeat = { amp: [], rms: [], fdom: [], rough: [], damp: [] };
      const refByFeat = { amp: [], rms: [], fdom: [], rough: [], damp: [] };
      g.forEach(function (r) {
        const fp = r.featuresPred || {};
        const fr = r.featuresRef || {};
        const d = Number(r.integrity);
        if (Number.isFinite(d)) integArr.push(d);
        ["amp", "rms", "fdom", "rough", "damp"].forEach(function (k) {
          if (Number.isFinite(Number(fp[k]))) predByFeat[k].push(Number(fp[k]));
          if (Number.isFinite(Number(fr[k]))) refByFeat[k].push(Number(fr[k]));
        });
      });
      const ws = [];
      const dg = [];
      ["amp", "rms", "fdom", "rough", "damp"].forEach(function (k) {
        const w = wassersteinLike(predByFeat[k], refByFeat[k]);
        if (Number.isFinite(w)) ws.push(w);
        const sp = stdOf(predByFeat[k]);
        const sr = stdOf(refByFeat[k]);
        if (Number.isFinite(sp) && Number.isFinite(sr)) dg.push(Math.abs(sp - sr));
      });
      const integrity = Number.isFinite(meanOf(ws)) ? meanOf(ws) : meanOf(integArr);
      const diversityGap = meanOf(dg);
      out.push({
        scope: "scenario",
        model: modelLabel,
        scenario: scen,
        samples: g.length,
        integrity: integrity,
        diversityGap: diversityGap,
      });
      if (Number.isFinite(integrity)) allInt.push(integrity);
      if (Number.isFinite(diversityGap)) allDiv.push(diversityGap);
    });
    out.unshift({
      scope: "overall",
      model: modelLabel,
      scenario: "all",
      samples: rows.length,
      integrity: meanOf(allInt),
      diversityGap: meanOf(allDiv),
    });
    state.generationQualityRows = out;
    renderGenerationQualityTable();
    renderGenerationQualityChart();
    setStatus(
      "Quality check complete. Integrity=" + numFmt(out[0].integrity) +
      " DiversityGap=" + numFmt(out[0].diversityGap)
    );
  }

  function exportGenerationRowsCsv() {
    const rows = state.generationRows || [];
    if (!rows.length) {
      setStatus("No generation rows to export.");
      return;
    }
    const head = ["id", "ts", "scenario", "model", "source", "ratio", "mae", "rmse", "bias", "refTrajIdx"];
    const csv = [head.join(",")].concat(rows.map(function (r) {
      return head.map(function (k) {
        const v = r[k];
        if (v == null) return "";
        const s = String(v);
        return s.indexOf(",") >= 0 ? ("\"" + s.replace(/\"/g, "\"\"") + "\"") : s;
      }).join(",");
    })).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "oscillator_generation_metrics.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus("Generation CSV exported.");
  }

  function exportGenerationRowsJson() {
    const rows = state.generationRows || [];
    if (!rows.length) {
      setStatus("No generation rows to export.");
      return;
    }
    downloadJson("oscillator_generation_metrics.json", rows);
    setStatus("Generation JSON exported.");
  }

  async function plotGenerationSelectedSample() {
    const id = String((ui.genSampleSelect && ui.genSampleSelect.value) || "");
    if (!id) throw new Error("No generation sample selected.");
    const row = (state.generationRows || []).find(function (r) { return String(r.id) === id; });
    if (!row) throw new Error("Selected sample not found.");
    const ds = state.preparedDataset || getDatasetForCurrentGraphMode() || syncActiveDatasetFromSelection();
    if (!state.model) throw new Error("Train model first.");
    const cond = Object.assign({}, row.cond || {});
    let tr = null;
    if (Number.isInteger(Number(row.refTrajIdx)) && ds && ds.trajectories && ds.trajectories[Number(row.refTrajIdx)]) {
      tr = ds.trajectories[Number(row.refTrajIdx)];
    } else {
      const sim = simulateOscillator(cond);
      tr = { t: sim.t.slice(), x: sim.x.slice(), v: sim.v.slice(), params: Object.assign({}, cond) };
    }
    const result = await evaluateDatasetTrajectoryAndPlot({
      model: state.model,
      mode: ds ? ds.mode : String((ui.predictionMode && ui.predictionMode.value) || "autoregressive"),
      inferenceMethod: String((ui.inferenceMethod && ui.inferenceMethod.value) || "auto"),
      warmupSteps: getArWarmupStepsFromUI(),
      targetMode: String(state.modelTargetMode || inferTargetModeFromDrawflow(state.editor, "x")),
      isSequence: Boolean(state.modelIsSequence),
      featureConfig: ensureFeatureConfig(getFeatureConfigFromUI(ui)),
      featureSpec: ds ? ds.featureSpec : null,
      condition: cond,
      trajectory: tr,
      dt: Number(cond.dt) || Number(ds && ds.dt || 0.02),
      durationSec: Number(cond.durationSec) || Number(ds && ds.durationSec || 16),
      windowSize: Number(ds && ds.windowSize || getActiveWindowSize()),
      arHistory: inferArHistoryConfigFromDrawflow(state.editor, Number(ds && ds.windowSize || getActiveWindowSize())),
      chartEl: ui.genSingleChart || ui.compareChart,
      index: Number(row.refTrajIdx),
    });
    setStatus("Plotted selected generation sample. MAE=" + Number(result.mae).toExponential(3));
  }

  function clearGenerationResults() {
    state.generationRows = [];
    state.generationQualityRows = [];
    renderGenerationMetricsTable();
    renderGenerationBatchChart();
    renderGenerationQualityTable();
    renderGenerationQualityChart();
    refreshGenerationSampleSelect();
    if (ui.genSingleChart) {
      Plotly.newPlot(
        ui.genSingleChart,
        [{ x: [0], y: [0], mode: "lines", name: "comparison" }],
        {
          paper_bgcolor: "#0b1220",
          plot_bgcolor: "#0b1220",
          font: { color: "#e2e8f0" },
          title: "Generate + Compare (Single) to render output",
          xaxis: { title: "time (s)", gridcolor: "#1e293b" },
          yaxis: { title: "state", gridcolor: "#1e293b" },
        },
        { responsive: true }
      );
    }
  }

  function refreshGenerationRefOptions() {
    if (!ui.genRefTrajIdx || !ui.genScenarioType) return;
    const ds = state.preparedDataset || getDatasetForCurrentGraphMode() || syncActiveDatasetFromSelection();
    const scen = String(ui.genScenarioType.value || "spring");
    const pool = getGenerationTrajectoryPool(ds, scen);
    const prev = String(ui.genRefTrajIdx.value || "");
    ui.genRefTrajIdx.innerHTML = "";
    if (!pool.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(no trajectory)";
      ui.genRefTrajIdx.appendChild(opt);
      return;
    }
    pool.forEach(function (item) {
      const p = item.tr && item.tr.params ? item.tr.params : {};
      const opt = document.createElement("option");
      opt.value = String(item.idx);
      opt.textContent = "#" + String(item.idx) + " | m=" + Number(p.m || 0).toFixed(2) + " c=" + Number(p.c || 0).toFixed(2);
      ui.genRefTrajIdx.appendChild(opt);
    });
    const hasPrev = pool.some(function (x) { return String(x.idx) === prev; });
    ui.genRefTrajIdx.value = hasPrev ? prev : String(pool[0].idx);
  }

  async function runGenerationSingle() {
    if (!state.model) throw new Error("Train model first.");
    const ds = state.preparedDataset || getDatasetForCurrentGraphMode() || syncActiveDatasetFromSelection();
    if (!ds) throw new Error("Generate dataset first.");
    const scen = String((ui.genScenarioType && ui.genScenarioType.value) || "spring");
    const sourceMode = String((ui.genSourceMode && ui.genSourceMode.value) || "dataset_ref");
    const pool = getGenerationTrajectoryPool(ds, scen);
    let tr = null;
    if (sourceMode === "dataset_ref") {
      const idx = Number(ui.genRefTrajIdx && ui.genRefTrajIdx.value);
      tr = (Number.isInteger(idx) && ds.trajectories[idx]) ? ds.trajectories[idx] : (pool.length ? pool[0].tr : null);
      if (!tr) throw new Error("No reference trajectory for scenario '" + scen + "'.");
    }
    let cond = tr ? buildConditionFromTrajectory(tr, scen) : getEvalCondition(scen);
    cond = applyRatioScaleToCondition(cond, ui.genRatioFeature && ui.genRatioFeature.value, Number(ui.genRatioScale && ui.genRatioScale.value));
    const sim = simulateOscillator(cond);
    const refTraj = tr || { t: sim.t.slice(), x: sim.x.slice(), v: sim.v.slice(), params: Object.assign({}, cond) };
    const result = await evaluateDatasetTrajectoryAndPlot({
      model: state.model,
      mode: ds.mode || String((ui.predictionMode && ui.predictionMode.value) || "autoregressive"),
      inferenceMethod: String((ui.inferenceMethod && ui.inferenceMethod.value) || "auto"),
      warmupSteps: getArWarmupStepsFromUI(),
      targetMode: String(state.modelTargetMode || inferTargetModeFromDrawflow(state.editor, "x")),
      isSequence: Boolean(state.modelIsSequence),
      featureConfig: ensureFeatureConfig(getFeatureConfigFromUI(ui)),
      featureSpec: ds.featureSpec,
      condition: cond,
      trajectory: refTraj,
      dt: Number(cond.dt) || Number(ds.dt || 0.02),
      durationSec: Number(cond.durationSec) || Number(ds.durationSec || 16),
      windowSize: Number(ds.windowSize || getActiveWindowSize()),
      arHistory: inferArHistoryConfigFromDrawflow(state.editor, Number(ds.windowSize || getActiveWindowSize())),
      chartEl: ui.genSingleChart || ui.compareChart,
      index: Number(ui.genRefTrajIdx && ui.genRefTrajIdx.value),
    });
    const qPred = getTrajectoryFeatureVector(result.predicted || [], result.t || []);
    const qRef = getTrajectoryFeatureVector(result.truth || [], result.t || []);
    state.generationRows.unshift({
      id: "gen_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36),
      ts: Date.now(),
      scenario: scen,
      model: inferModelFamilyFromDrawflow(state.editor),
      source: sourceMode,
      ratio: String((ui.genRatioFeature && ui.genRatioFeature.value) || "none") + " x" + Number(ui.genRatioScale && ui.genRatioScale.value || 1).toFixed(2),
      mae: result.mae,
      rmse: result.rmse,
      bias: result.bias,
      integrity: featureDist(qPred, qRef),
      refTrajIdx: Number.isInteger(Number(ui.genRefTrajIdx && ui.genRefTrajIdx.value)) ? Number(ui.genRefTrajIdx.value) : null,
      cond: cond,
      featuresPred: qPred,
      featuresRef: qRef,
      yPred: Array.isArray(result.predicted) ? result.predicted.slice() : [],
      yRef: Array.isArray(result.truth) ? result.truth.slice() : [],
      t: Array.isArray(result.t) ? result.t.slice() : [],
    });
    if (state.generationRows.length > 200) state.generationRows.length = 200;
    state.generationQualityRows = [];
    renderGenerationMetricsTable();
    renderGenerationBatchChart();
    renderGenerationQualityTable();
    renderGenerationQualityChart();
    refreshGenerationSampleSelect();
    setStatus("Generation(single) complete. MAE=" + Number(result.mae).toExponential(3) + " RMSE=" + Number(result.rmse).toExponential(3));
  }

  async function runGenerationBatch() {
    if (!state.model) throw new Error("Train model first.");
    const ds = state.preparedDataset || getDatasetForCurrentGraphMode() || syncActiveDatasetFromSelection();
    if (!ds) throw new Error("Generate dataset first.");
    const scen = String((ui.genScenarioType && ui.genScenarioType.value) || "spring");
    const sourceMode = String((ui.genSourceMode && ui.genSourceMode.value) || "dataset_ref");
    const n = Math.max(1, Math.min(200, Number(ui.genNumSamples && ui.genNumSamples.value) || 12));
    const sigma = Math.max(0, Number(ui.genParamNoise && ui.genParamNoise.value) || 0);
    const pool = getGenerationTrajectoryPool(ds, scen);
    if (sourceMode === "dataset_ref" && !pool.length) throw new Error("No dataset trajectories for scenario '" + scen + "'.");
    const rng = createRng(Number(ui.seed && ui.seed.value) + 101);
    for (let i = 0; i < n; i += 1) {
      const baseTr = sourceMode === "dataset_ref"
        ? pool[Math.floor(rng() * pool.length)].tr
        : null;
      let cond = baseTr ? buildConditionFromTrajectory(baseTr, scen) : getEvalCondition(scen);
      cond = applyRatioScaleToCondition(cond, ui.genRatioFeature && ui.genRatioFeature.value, Number(ui.genRatioScale && ui.genRatioScale.value));
      cond = applyParamNoiseToCondition(cond, sigma, rng);
      const sim = simulateOscillator(cond);
      const tr = baseTr || { t: sim.t.slice(), x: sim.x.slice(), v: sim.v.slice(), params: Object.assign({}, cond) };
      const series = await evaluateTrajectorySeries({
        model: state.model,
        mode: ds.mode || String((ui.predictionMode && ui.predictionMode.value) || "autoregressive"),
        inferenceMethod: String((ui.inferenceMethod && ui.inferenceMethod.value) || "auto"),
        warmupSteps: getArWarmupStepsFromUI(),
        targetMode: String(state.modelTargetMode || inferTargetModeFromDrawflow(state.editor, "x")),
        isSequence: Boolean(state.modelIsSequence),
        featureConfig: ensureFeatureConfig(getFeatureConfigFromUI(ui)),
        featureSpec: ds.featureSpec,
        condition: cond,
        trajectory: tr,
        dt: Number(cond.dt) || Number(ds.dt || 0.02),
        durationSec: Number(cond.durationSec) || Number(ds.durationSec || 16),
        windowSize: Number(ds.windowSize || getActiveWindowSize()),
        arHistory: inferArHistoryConfigFromDrawflow(state.editor, Number(ds.windowSize || getActiveWindowSize())),
      });
      const qPred = getTrajectoryFeatureVector(series.predicted || [], series.t || []);
      const qRef = getTrajectoryFeatureVector(series.truth || [], series.t || []);
      state.generationRows.push({
        id: "gen_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36),
        ts: Date.now(),
        scenario: scen,
        model: inferModelFamilyFromDrawflow(state.editor),
        source: sourceMode,
        ratio: String((ui.genRatioFeature && ui.genRatioFeature.value) || "none") + " x" + Number(ui.genRatioScale && ui.genRatioScale.value || 1).toFixed(2),
        mae: series.mae,
        rmse: series.rmse,
        bias: series.bias,
        integrity: featureDist(qPred, qRef),
        refTrajIdx: baseTr ? ds.trajectories.indexOf(baseTr) : null,
        cond: cond,
        featuresPred: qPred,
        featuresRef: qRef,
        yPred: Array.isArray(series.predicted) ? series.predicted.slice() : [],
        yRef: Array.isArray(series.truth) ? series.truth.slice() : [],
        t: Array.isArray(series.t) ? series.t.slice() : [],
      });
      if ((i + 1) % 4 === 0) {
        setStatus("Generation(batch) " + String(i + 1) + "/" + String(n) + "...");
        await tf.nextFrame();
      }
    }
    if (state.generationRows.length > 200) state.generationRows = state.generationRows.slice(-200);
    state.generationQualityRows = [];
    renderGenerationMetricsTable();
    renderGenerationBatchChart();
    renderGenerationQualityTable();
    renderGenerationQualityChart();
    refreshGenerationSampleSelect();
    setStatus("Generation(batch) complete. Samples=" + String(n));
  }

  function syncTfvisButtonLabel() {
    try {
      const visor = tfvis.visor();
      const isOpen = typeof visor.isOpen === "function" ? visor.isOpen() : true;
      ui.openTfvisBtn.textContent = isOpen ? "Hide tfjs-vis" : "Open tfjs-vis";
    } catch (err) {
      ui.openTfvisBtn.textContent = "Toggle tfjs-vis";
    }
  }

  function runAfterFirstPaint(fn) {
    if (typeof fn !== "function") return;
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      setTimeout(fn, 0);
      return;
    }
    window.requestAnimationFrame(function () {
      setTimeout(fn, 0);
    });
  }

  function init() {
    window.addEventListener("error", function (ev) {
      const msg = (ev && ev.message) ? ev.message : "Unknown runtime error";
      setStatus("Runtime error: " + msg);
    });
    window.addEventListener("unhandledrejection", function (ev) {
      const reason = ev && ev.reason;
      const msg = reason && reason.message ? reason.message : String(reason || "Unhandled promise rejection");
      setStatus("Runtime error: " + msg);
    });

    try {
      const saved = JSON.parse(localStorage.getItem("osc_benchmark_metrics") || "[]");
      if (Array.isArray(saved)) state.metricsLog = saved;
    } catch (err) {
      state.metricsLog = [];
    }
    loadChecklistState();
    renderExperimentChecklist();
    state.editor = initDrawflow(ui.drawflow);
    clearEditor(state.editor);
    setCurrentModelSchema(SCHEMA_REGISTRY.getDefaultSchemaId(), { skipNodePanelRefresh: true });
    if (ui.netPreset) ui.netPreset.value = "custom";
    refreshNodeSummaries(state.editor);
    setActiveNode(state.editor, "");
    syncInferredPipelineFromGraph();
    markModelGraphClean();
    applyScenarioCardDefaultsOnLoad();
    applyDatasetModuleWorkspaceUi("preview", "");
    if (ui.previewMainChartWrap) ui.previewMainChartWrap.style.display = "none";
    if (ui.previewSplitCharts) ui.previewSplitCharts.style.display = "none";
    if (ui.bbGravityRow) ui.bbGravityRow.style.display = "none";
    enforcePredictionModeFeaturePolicy(ui, { silent: true });
    updateModeContractText();
    updateInferenceMethodInfo();
    initSidebarSections();
    initDrawflowResizer();
    try { tfvis.visor().close(); } catch (err) {}
    syncTfvisButtonLabel();
    refreshDatasetModuleSelect(state.activeDatasetModuleId || "oscillator", { skipApply: true });
    bindDatasetModuleUi();
    showDataLabSubTab(state.dataLabSubTab || "preview");
    updateRuntimeOptionsUi();
    showPreviewChartMode("single");
    normalizeSplitFractionsFromUi(true);
    syncImageSplitCountsFromFractions(false);
    if (ui.datasetName) {
      const cur = String(ui.datasetName.value || "").trim();
      if (!cur || cur === "ds_seed42_mixed") {
        ui.datasetName.value = buildSuggestedDatasetName(ui.seed ? ui.seed.value : 42, getDatasetScenarioSelection(ui));
      }
    }
    setStatus("Ready (" + BUILD_TAG + "). Click Preview RK4 or Generate Dataset.");
    showWorkspaceTab("preview");
    runAfterFirstPaint(function () {
      renderModelPaletteForSchema(state.modelSchemaId || SCHEMA_REGISTRY.getDefaultSchemaId());
      bootstrapWorkspaceStoreAdapter()
        .then(function () {
          updateRuntimeOptionsUi();
          if (String(state.currentWorkspace || "") === "preview") {
            renderLeftLibraryByWorkspace();
            refreshPlaygroundWorkspaceUi();
          }
        })
        .catch(function (err) {
          console.warn("Workspace adapter bootstrap failed:", err);
        });
      if (String(state.currentWorkspace || "") === "preview") {
        updateQuickCompareInfo();
        updateDatasetCompareModeUI();
      }
      if (String(state.currentWorkspace || "") === "gen") {
        renderGenerationMetricsTable();
        renderGenerationQualityTable();
        refreshGenerationSampleSelect();
      }
      if (String(state.currentWorkspace || "") === "eval") {
        reloadMetricTable();
      }
    });
    ui.predictionMode.addEventListener("change", function () {
      enforcePredictionModeFeaturePolicy(ui, { silent: false });
      updateModeContractText();
      updateInferenceMethodInfo();
      syncActiveDatasetFromSelection();
    });
    if (ui.inferenceMethod) {
      ui.inferenceMethod.addEventListener("change", function () {
        updateInferenceMethodInfo();
      });
    }
    if (ui.arWarmupSteps) {
      ui.arWarmupSteps.addEventListener("change", function () {
        updateInferenceMethodInfo();
      });
      ui.arWarmupSteps.addEventListener("input", function () {
        updateInferenceMethodInfo();
      });
    }
    if (ui.modelDatasetSource) {
      ui.modelDatasetSource.addEventListener("change", function () {
        const ds = syncActiveDatasetFromSelection();
        setStatus(ds
          ? ("Dataset source selected: " + String(ui.modelDatasetSource.value) + " -> " + String(ds.mode))
          : "No dataset available for selected source. Generate dataset first.");
      });
    }
    if (ui.durationSec) {
      ui.durationSec.addEventListener("change", function () {
        syncPreviewTimeControls(false);
        schedulePreviewRefresh();
      });
      ui.durationSec.addEventListener("input", function () {
        syncPreviewTimeControls(false);
        schedulePreviewRefresh();
      });
    }
    if (ui.dt) {
      ui.dt.addEventListener("change", function () {
        syncPreviewTimeControls(false);
        schedulePreviewRefresh();
      });
      ui.dt.addEventListener("input", function () {
        syncPreviewTimeControls(false);
        schedulePreviewRefresh();
      });
    }
    if (ui.trainFrac) {
      ui.trainFrac.addEventListener("change", function () {
        normalizeSplitFractionsFromUi(true);
        syncImageSplitCountsFromFractions(false);
      });
      ui.trainFrac.addEventListener("input", function () {
        normalizeSplitFractionsFromUi(true);
        syncImageSplitCountsFromFractions(false);
      });
    }
    if (ui.valFrac) {
      ui.valFrac.addEventListener("change", function () {
        normalizeSplitFractionsFromUi(true);
        syncImageSplitCountsFromFractions(false);
      });
      ui.valFrac.addEventListener("input", function () {
        normalizeSplitFractionsFromUi(true);
        syncImageSplitCountsFromFractions(false);
      });
    }
    if (ui.testFrac) {
      ui.testFrac.addEventListener("change", function () {
        normalizeSplitFractionsFromUi(true);
        syncImageSplitCountsFromFractions(false);
      });
    }
    if (ui.mnistTotalCount) {
      ui.mnistTotalCount.addEventListener("change", function () {
        syncImageSplitCountsFromFractions(false);
      });
      ui.mnistTotalCount.addEventListener("input", function () {
        syncImageSplitCountsFromFractions(false);
      });
    }
    if (ui.datasetCompareMode) ui.datasetCompareMode.addEventListener("change", updateDatasetCompareModeUI);
    if (ui.datasetCompareScenario) {
      ui.datasetCompareScenario.addEventListener("change", function () {
        setStatus("Dataset compare scenario filter set to '" + String(ui.datasetCompareScenario.value || "all") + "'.");
      });
    }
    if (ui.dataScenarioFilter) {
      ui.dataScenarioFilter.addEventListener("change", function () { renderDataTable(); });
      ui.dataScenarioFilter.addEventListener("input", function () { renderDataTable(); });
    }
    if (ui.wsPreviewTab) ui.wsPreviewTab.addEventListener("click", function () { showWorkspaceTab("preview"); });
    if (ui.wsDatasetTab) ui.wsDatasetTab.addEventListener("click", function () { showWorkspaceTab("dataset"); });
    if (ui.wsNnTab) ui.wsNnTab.addEventListener("click", function () { showWorkspaceTab("nn"); });
    if (ui.wsTrainTab) ui.wsTrainTab.addEventListener("click", function () { showWorkspaceTab("train"); });
    if (ui.wsGenTab) ui.wsGenTab.addEventListener("click", function () { showWorkspaceTab("gen"); refreshGenerationRefOptions(); });
    if (ui.wsEvalTab) ui.wsEvalTab.addEventListener("click", function () { showWorkspaceTab("eval"); });
    if (ui.dataLabPreviewTab) {
      ui.dataLabPreviewTab.addEventListener("click", function () {
        showDataLabSubTab("preview");
      });
    }
    if (ui.dataLabBuilderTab) {
      ui.dataLabBuilderTab.addEventListener("click", function () {
        showDataLabSubTab("builder");
      });
    }
    if (ui.leftNewDatasetBtn) {
      ui.leftNewDatasetBtn.addEventListener("click", function () {
        try {
          openNewDatasetModal();
        } catch (err) {
          setStatus("New dataset failed: " + err.message);
        }
      });
    }
    if (ui.leftNewModelBtn) {
      ui.leftNewModelBtn.addEventListener("click", function () {
        if (!requireModelLibraryUnlocked("create new model")) return;
        try {
          openNewModelModal();
        } catch (err) {
          setTrainSessionStatus("New model failed: " + err.message);
        }
      });
    }
    if (ui.leftNewTrainSessionBtn) {
      ui.leftNewTrainSessionBtn.addEventListener("click", function () {
        try {
          openNewTrainerModal();
        } catch (err) {
          setTrainSessionStatus("New trainer failed: " + err.message);
        }
      });
    }
    if (ui.entityCreateModalCancelBtn) {
      ui.entityCreateModalCancelBtn.addEventListener("click", function () {
        closeEntityCreateModal();
      });
    }
    if (ui.entityCreateModalCreateBtn) {
      ui.entityCreateModalCreateBtn.addEventListener("click", function () {
        const ctx = state.entityCreateContext || null;
        if (!ctx) return;
        const rawFormCfg = state.entityCreateForm && typeof state.entityCreateForm.getConfig === "function"
          ? state.entityCreateForm.getConfig()
          : {};
        const formCfg = normalizeEntityCreateFormConfig(ctx, rawFormCfg);
        const name = String(formCfg.name || "").trim();
        if (!name) {
          setTrainSessionStatus("Create failed: name is required.");
          return;
        }
        const schemaId = resolveSchemaId(String(formCfg.schemaId || ctx.defaultSchemaId || "oscillator"));
        const payload = {
          kind: ctx.kind,
          name: name,
          schemaId: schemaId,
          moduleId: String(formCfg.moduleId || "").trim().toLowerCase(),
          datasetId: String(formCfg.datasetId || "").trim(),
          modelId: String(formCfg.modelId || "").trim(),
          runtime: String(formCfg.runtime || ctx.defaultRuntime || "js_client"),
          runtimeBackend: String(formCfg.runtimeBackend || ctx.defaultRuntimeBackend || "auto"),
          trainCfg: buildTrainCfgFromUi(),
        };
        closeEntityCreateModal();
        try {
          if (ctx.kind === "model" && !requireModelLibraryUnlocked("create new model")) return;
          if (typeof ctx.onCreate === "function") ctx.onCreate(payload);
        } catch (err) {
          try { console.error("Entity create failed:", err); } catch (_) {}
          setTrainSessionStatus("Create failed: " + err.message);
        }
      });
    }
    if (ui.entityCreateModalBackdrop) {
      ui.entityCreateModalBackdrop.addEventListener("click", function (ev) {
        if (ev.target === ui.entityCreateModalBackdrop) closeEntityCreateModal();
      });
    }
    if (ui.detectServerBtn) {
      ui.detectServerBtn.addEventListener("click", async function () {
        try {
          await detectServerRuntimes();
        } catch (err) {
          setTrainSessionStatus("Server detect error: " + err.message);
        }
      });
    }
    if (ui.saveModelToLibraryBtn) {
      ui.saveModelToLibraryBtn.addEventListener("click", function () {
        try {
          if (!requireModelLibraryUnlocked("save model")) return;
          const ctx = getCurrentModelContext();
          const selectedId = String((ctx && ctx.modelId) || "").trim();
          const selectedModel = getSavedModelById(selectedId);
          if (!selectedModel) throw new Error("Select model from left panel first.");
          const selectedName = String(selectedModel.name || "").trim();
          if (!selectedName) throw new Error("Selected model has empty name.");
          if (!isModelGraphDirty()) {
            setTrainSessionStatus("No graph changes to save: " + selectedName);
            return;
          }
          saveCurrentModelNamed(selectedName, selectedId);
          setTrainSessionStatus("Saved model: " + selectedName);
        } catch (err) {
          setTrainSessionStatus("Save model failed: " + err.message);
        }
      });
    }
    if (ui.newModelBtn) {
      ui.newModelBtn.addEventListener("click", function () {
        if (!requireModelLibraryUnlocked("create new model")) return;
        try {
          openNewModelModal();
        } catch (err) {
          setTrainSessionStatus("New model failed: " + err.message);
        }
      });
    }
    if (ui.unsavedModelSaveBtn) {
      ui.unsavedModelSaveBtn.addEventListener("click", function () {
        const action = state.unsavedPromptAction || {};
        if (typeof action.onSave === "function") action.onSave();
      });
    }
    if (ui.unsavedModelDiscardBtn) {
      ui.unsavedModelDiscardBtn.addEventListener("click", function () {
        const action = state.unsavedPromptAction || {};
        if (typeof action.onDiscard === "function") action.onDiscard();
      });
    }
    if (ui.unsavedModelCancelBtn) {
      ui.unsavedModelCancelBtn.addEventListener("click", function () {
        const action = state.unsavedPromptAction || {};
        if (typeof action.onCancel === "function") action.onCancel();
        else closeUnsavedModelModal();
      });
    }
    if (ui.unsavedModelModalBackdrop) {
      ui.unsavedModelModalBackdrop.addEventListener("click", function (ev) {
        if (ev.target === ui.unsavedModelModalBackdrop) closeUnsavedModelModal();
      });
    }
    if (ui.deleteModelFromLibraryBtn) {
      ui.deleteModelFromLibraryBtn.addEventListener("click", function () {
        ensureLibraryEntityIds();
        if (!requireModelLibraryUnlocked("delete model")) return;
        const typed = String((ui.modelLibraryName && ui.modelLibraryName.value) || "").trim();
        const model = typed ? getSavedModelByName(typed) : (state.activeModelId ? getSavedModelById(state.activeModelId) : null);
        const modelId = model ? String(model.id || "") : "";
        const name = model ? String(model.name || "") : "";
        if (!modelId || !model) {
          setTrainSessionStatus("No model selected. Type model name or load a model first.");
          return;
        }
        const refs = state.trainSessions.filter(function (s) {
          return String((s && s.modelId) || "") === modelId;
        }).length;
        const msg =
          "Delete model '" + name + "'?" +
          (refs > 0 ? (" It is referenced by " + refs + " training session(s).") : "") +
          " This cannot be undone.";
        if (!window.confirm(msg)) {
          setTrainSessionStatus("Delete model canceled: " + name);
          return;
        }
        deleteSavedModelById(modelId);
        if (ui.modelLibraryName && String(ui.modelLibraryName.value || "").trim() === name) {
          ui.modelLibraryName.value = "model_current";
        }
        setTrainSessionStatus("Deleted model: " + name);
      });
    }
    if (ui.modelSchemaSelect) {
      ui.modelSchemaSelect.addEventListener("change", function () {
        if (!requireModelLibraryUnlocked("change model schema")) return;
        const sid = resolveSchemaId(ui.modelSchemaSelect.value || "oscillator");
        setCurrentModelSchema(sid);
        setTrainSessionStatus("Model schema set: " + sid);
      });
    }
    if (ui.trainSessionSchemaSelect) {
      ui.trainSessionSchemaSelect.addEventListener("change", function () {
        refreshTrainSessionSelectors(resolveSchemaId(ui.trainSessionSchemaSelect.value || "oscillator"));
      });
    }
    if (ui.trainSessionModelSelect) {
      ui.trainSessionModelSelect.addEventListener("change", function () {
        const modelId = String((ui.trainSessionModelSelect && ui.trainSessionModelSelect.value) || "").trim();
        const model = getSavedModelById(modelId);
        if (model && model.schemaId) {
          refreshTrainSessionSelectors(resolveSchemaId(model.schemaId));
          return;
        }
        refreshTrainSessionSelectors();
      });
    }
    if (ui.trainSessionRuntime) {
      ui.trainSessionRuntime.addEventListener("change", function () {
        refreshTrainSessionSelectors();
      });
    }
    if (ui.addTrainSessionBtn) {
      ui.addTrainSessionBtn.addEventListener("click", function () {
        try {
          addTrainSessionFromUi();
        } catch (err) {
          setTrainSessionStatus("Add session failed: " + err.message);
        }
      });
    }
    if (ui.genScenarioType) {
      ui.genScenarioType.addEventListener("change", function () {
        refreshGenerationRefOptions();
      });
    }
    if (ui.genSourceMode) {
      ui.genSourceMode.addEventListener("change", function () {
        refreshGenerationRefOptions();
      });
    }
    if (ui.genRunOneBtn) {
      ui.genRunOneBtn.addEventListener("click", async function () {
        try {
          await runGenerationSingle();
        } catch (err) {
          setStatus("Generation(single) error: " + err.message);
          console.error(err);
        }
      });
    }
    if (ui.genRunBatchBtn) {
      ui.genRunBatchBtn.addEventListener("click", async function () {
        try {
          await runGenerationBatch();
        } catch (err) {
          setStatus("Generation(batch) error: " + err.message);
          console.error(err);
        }
      });
    }
    if (ui.genQualityBtn) {
      ui.genQualityBtn.addEventListener("click", async function () {
        try {
          await runGenerationQualityCheck();
        } catch (err) {
          setStatus("Generation(quality) error: " + err.message);
          console.error(err);
        }
      });
    }
    if (ui.genClearBtn) {
      ui.genClearBtn.addEventListener("click", function () {
        clearGenerationResults();
        setStatus("Generation results cleared.");
      });
    }
    if (ui.genExportCsvBtn) {
      ui.genExportCsvBtn.addEventListener("click", function () {
        exportGenerationRowsCsv();
      });
    }
    if (ui.genExportJsonBtn) {
      ui.genExportJsonBtn.addEventListener("click", function () {
        exportGenerationRowsJson();
      });
    }
    if (ui.genSortMode) {
      ui.genSortMode.addEventListener("change", function () {
        refreshGenerationSampleSelect();
      });
    }
    if (ui.genJumpBtn) {
      ui.genJumpBtn.addEventListener("click", async function () {
        try {
          await plotGenerationSelectedSample();
        } catch (err) {
          setStatus("Generation(plot selected) error: " + err.message);
          console.error(err);
        }
      });
    }
    ui.clearMetricsBtn.addEventListener("click", function () {
      state.metricsLog = [];
      state.metricsBaseConfigSig = "";
      state.benchmarkDetails = [];
      ui.metricsTableBody.innerHTML = "";
      try { localStorage.removeItem("osc_benchmark_metrics"); } catch (err) {}
      if (ui.configMixWarning) {
        ui.configMixWarning.style.display = "none";
        ui.configMixWarning.textContent = "";
      }
      updateBestModelSummary();
      refreshBenchmarkDetailViews();
      setStatus("Performance metrics table cleared.");
    });
    if (ui.clearBenchDetailBtn) {
      ui.clearBenchDetailBtn.addEventListener("click", function () {
        state.benchmarkDetails = [];
        refreshBenchmarkDetailViews();
        setStatus("Benchmark-detail panel cleared.");
      });
    }
    if (ui.clearRunLogBtn) {
      ui.clearRunLogBtn.addEventListener("click", function () {
        ui.runLog.value = "";
        setStatus("Run log cleared.");
      });
    }
    if (ui.copyRunLogBtn) {
      ui.copyRunLogBtn.addEventListener("click", async function () {
        try {
          await navigator.clipboard.writeText(ui.runLog ? ui.runLog.value : "");
          setStatus("Run log copied to clipboard.");
        } catch (err) {
          setStatus("Copy failed. Select log text manually and copy.");
        }
      });
    }
    ui.exportMetricsBtn.addEventListener("click", function () {
      if (!state.metricsLog.length) {
        setStatus("No metrics to export.");
        return;
      }
      const head = ["type", "expId", "scenario", "model", "valMae", "testMae", "mae", "rmse", "bias"];
      const rows = state.metricsLog.map(function (r) {
        return head.map(function (k) { return String(r[k] == null ? "" : r[k]); }).join(",");
      });
      const csv = [head.join(",")].concat(rows).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "oscillator_benchmark_metrics.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus("Metrics exported to CSV.");
    });
    if (ui.checklistTableBody) {
      ui.checklistTableBody.addEventListener("change", function (ev) {
        const el = ev.target;
        if (!el || String(el.type || "") !== "checkbox") return;
        const id = String(el.getAttribute("data-id") || "");
        if (!id) return;
        state.checklist[id] = Boolean(el.checked);
        saveChecklistState();
      });
    }
    if (ui.clearChecklistBtn) {
      ui.clearChecklistBtn.addEventListener("click", function () {
        state.checklist = {};
        saveChecklistState();
        renderExperimentChecklist();
        setStatus("Experiment checklist cleared.");
      });
    }
    ui.runBenchmarkBtn.addEventListener("click", async function () {
      const runId = Number(window.__benchmarkRunId || 0) + 1;
      window.__benchmarkRunId = runId;
      window.__benchmarkRunning = true;
      window.dispatchEvent(new CustomEvent("osc-benchmark-start", { detail: { runId: runId } }));
      state.currentExpId =
        String((ui.netPreset && ui.netPreset.value) || "custom") +
        "-" + String((ui.predictionMode && ui.predictionMode.value) || "autoregressive") +
        "-s" + String(ui.seed.value) +
        "-" + Date.now().toString(36).slice(-4);
      state.currentConfigSig = buildRunConfigSignature();
      try {
        setStatus("Benchmark button clicked. Validating dataset and model setup...");
        syncInferredPipelineFromGraph();
        const dsBase = getDatasetForCurrentGraphMode() || syncActiveDatasetFromSelection();
        if (!dsBase || !dsBase.trajectories || !dsBase.trajectories.length) {
          throw new Error("Generate dataset first (click 'Generate Dataset').");
        }
        const baseMode = String(dsBase.mode || "autoregressive");
        const dsSpec = normalizeFeatureSpec(dsBase.featureSpec || {}, baseMode);
        const currentSpec = normalizeFeatureSpec(
          inferFeatureSpecFromDrawflow(state.editor, baseMode, dsSpec),
          baseMode
        );
        if (!isFeatureSpecEqual(dsSpec, currentSpec, baseMode)) {
          throw new Error("Drawflow feature blocks changed since dataset build. Regenerate dataset before benchmark.");
        }
        const outputHeadsForRun = inferOutputHeadsFromDrawflow(state.editor, "x");
        const dsTargetMode = inferDatasetTargetModeFromOutputHeads(outputHeadsForRun, "x");
        const ds = prepareDatasetForModel(dsBase, {
          mode: baseMode,
          windowSize: getActiveWindowSize(),
          arHistory: inferArHistoryConfigFromDrawflow(state.editor, getActiveWindowSize()),
          targetMode: dsTargetMode,
          featureSpec: currentSpec,
        });
        ui.runBenchmarkBtn.disabled = true;
        const picks = pickBenchmarkTrajectoryIndices(ds, 12);
        if (!picks.length) throw new Error("No test trajectories found.");
        setStatus("Balanced benchmark picks selected: " + picks.length + " trajectories.");

        const runAvgBenchmark = async function (model, isSequence, label) {
          let sumMae = 0;
          let sumRmse = 0;
          let sumBias = 0;
          const byScenario = {};
          for (let i = 0; i < picks.length; i += 1) {
            setStatus("Benchmark [" + label + "] " + (i + 1) + "/" + picks.length + "...");
            await tf.nextFrame();
            const idx = picks[i];
            const tr = ds.trajectories[idx];
            const p = tr.params || {};
            const scenarioName = String(p.scenario || ds.scenarioType || "unknown");
            const res = await evaluateTrajectoryMetrics({
              model: model,
              mode: ds.mode,
              inferenceMethod: String((ui.inferenceMethod && ui.inferenceMethod.value) || "auto"),
              warmupSteps: getArWarmupStepsFromUI(),
              isSequence: isSequence,
              featureConfig: ds.featureConfig,
              featureSpec: ds.featureSpec,
              targetMode: ds.targetMode,
              trajectory: tr,
              condition: {
                scenario: p.scenario || ds.scenarioType,
                m: Number(p.m),
                c: Number(p.c),
                k: Number(p.k),
                g: Number(p.g),
                restitution: Number(p.restitution),
                x0: Number(p.x0),
                v0: Number(p.v0),
                groundModel: p.groundModel,
                groundK: p.groundK,
                groundC: p.groundC,
              },
              dt: ds.dt,
              durationSec: ds.durationSec,
              windowSize: ds.windowSize,
              arHistory: inferArHistoryConfigFromDrawflow(state.editor, ds.windowSize),
            });
            sumMae += res.mae;
            sumRmse += res.rmse;
            sumBias += res.bias;
            if (!byScenario[scenarioName]) {
              byScenario[scenarioName] = { n: 0, mae: 0, rmse: 0, bias: 0 };
            }
            byScenario[scenarioName].n += 1;
            byScenario[scenarioName].mae += res.mae;
            byScenario[scenarioName].rmse += res.rmse;
            byScenario[scenarioName].bias += res.bias;
            state.benchmarkDetails.push({
              expId: state.currentExpId || "",
              model: label,
              scenario: scenarioName,
              trajIdx: idx,
              mae: Number(res.mae),
              rmse: Number(res.rmse),
              bias: Number(res.bias),
            });
          }
          const avgMae = sumMae / picks.length;
          const avgRmse = sumRmse / picks.length;
          const avgBias = sumBias / picks.length;
          const diverged = !Number.isFinite(avgMae) || !Number.isFinite(avgRmse) || Math.abs(avgMae) > 1e3 || Math.abs(avgRmse) > 1e3;
          appendMetricRow({
            type: diverged ? "benchmark-avg-diverged" : "benchmark-avg",
            scenario: ds.scenarioType + " [" + ds.mode + "]",
            model: label,
            mae: avgMae,
            rmse: avgRmse,
            bias: avgBias,
          });
          Object.keys(byScenario).sort().forEach(function (s) {
            const v = byScenario[s];
            const sMae = v.mae / Math.max(1, v.n);
            const sRmse = v.rmse / Math.max(1, v.n);
            const sBias = v.bias / Math.max(1, v.n);
            const sDiverged = !Number.isFinite(sMae) || !Number.isFinite(sRmse) || Math.abs(sMae) > 1e3 || Math.abs(sRmse) > 1e3;
            appendMetricRow({
              type: sDiverged ? "benchmark-avg-scenario-diverged" : "benchmark-avg-scenario",
              scenario: s + " [" + ds.mode + "]",
              model: label,
              mae: sMae,
              rmse: sRmse,
              bias: sBias,
            });
          });
        };

        const trainCurrentGraph = async function (label) {
          const fam = inferModelFamilyFromDrawflow(state.editor);
          setStatus("Building model [" + label + "][" + fam + "]...");
          await tf.nextFrame();
          const built = buildModelFromDrawflow(state.editor, ds);
          const predHeadIdx = pickPrimaryTrajectoryHeadIndex(built.headConfigs || []);
          if (predHeadIdx < 0) throw new Error("No trajectory output head found. Add Output target x, v, x+v, or traj for benchmark/eval.");
          const predHead = (built.headConfigs && built.headConfigs[predHeadIdx]) || { target: String(ds.targetMode || "x") };
          const evalModel = Array.isArray(built.model.outputs)
            ? tf.model({ inputs: built.model.inputs, outputs: built.model.outputs[predHeadIdx] })
            : built.model;
          const lossCfg = inferOutputLossConfigFromDrawflow(state.editor, getGlobalLossType());
          const trainerCfg = getTrainerControlOptionsFromUI();
          const metrics = await trainModel({
            model: built.model,
            dataset: ds,
            isSequence: built.isSequence,
            headConfigs: built.headConfigs,
            useTfvis: Boolean(ui.useTfvis && ui.useTfvis.checked),
            lossType: getGlobalLossType(),
            outputLossConfig: lossCfg,
            onStatus: function (msg) { setStatus("[" + label + "] " + msg); },
            onBatchEnd: function (batch, logs) {
              if (batch % 200 !== 0) return;
              const loss = Number(logs && logs.loss);
              setStatus(
                "[" + label + "] batch " + (batch + 1) +
                " | loss=" + (Number.isFinite(loss) ? loss.toExponential(3) : "n/a")
              );
            },
            onEpochEnd: function (epoch, logs) {
              const e = epoch + 1;
              const total = Math.max(1, Number(ui.epochs.value) || 1);
              const loss = Number(logs && logs.loss);
              const valLoss = Number(logs && logs.val_loss);
              const curLr = Number(logs && logs.current_lr);
              const bestVal = Number(logs && logs.best_val_loss);
              const improved = Boolean(logs && logs.improved);
              setStatus(
                "[" + label + "] Training " + e + "/" + total +
                " | loss=" + (Number.isFinite(loss) ? loss.toExponential(3) : "n/a") +
                " | val_loss=" + (Number.isFinite(valLoss) ? valLoss.toExponential(3) : "n/a") +
                (Number.isFinite(curLr) ? " | lr=" + curLr.toExponential(2) : "") +
                (Number.isFinite(bestVal) ? " | best=" + bestVal.toExponential(3) : "") +
                (improved ? " (best)" : "")
              );
            },
            epochs: Number(ui.epochs.value),
            batchSize: Number(ui.batchSize.value),
            optimizerType: String(trainerCfg.optimizerType || "adam"),
            learningRate: Number(ui.learningRate.value),
            lrSchedulerType: String(trainerCfg.lrSchedulerType || "plateau"),
            useLrScheduler: trainerCfg.useLrScheduler,
            lrPatience: trainerCfg.lrPatience,
            lrFactor: trainerCfg.lrFactor,
            minLr: trainerCfg.minLr,
            gradClipNorm: Number(trainerCfg.gradClipNorm),
            gradClipValue: Number(trainerCfg.gradClipValue),
            restoreBestWeights: trainerCfg.restoreBestWeights,
            earlyStoppingPatience: trainerCfg.earlyStoppingPatience,
          });
          appendMetricRow({
            type: "benchmark-train",
            scenario: ds.scenarioType + " [" + ds.mode + "]",
            model: label,
            valMae: metrics.mae,
            testMae: metrics.testMae,
          });
          return { built: built, evalModel: evalModel, predHead: predHead };
        };

        const suite = String((ui.benchmarkSuite && ui.benchmarkSuite.value) || "current");
        const dsMode = String(ds.mode || "autoregressive");
        if (suite === "current") {
          const currentPreset = String((ui.netPreset && ui.netPreset.value) || "custom");
          const prevModel = state.model;
          const out = await trainCurrentGraph("current-graph:" + currentPreset);
          const built = out.built;
          state.model = out.evalModel;
          state.modelIsSequence = built.isSequence;
          state.modelTargetMode = String(out.predHead.target || ds.targetMode || "x");
          state.modelOutputSize = Number((out.predHead.target === "xv") ? 2 : 1);
          state.preparedDataset = ds;
          if (prevModel && prevModel !== state.model && typeof prevModel.dispose === "function") {
            prevModel.dispose();
          }
          await runAvgBenchmark(
            state.model,
            state.modelIsSequence,
            "current:" + currentPreset + (state.modelIsSequence ? " [seq]" : " [flat]")
          );
          setStatus("Benchmark completed on " + picks.length + " test trajectories.");
          return;
        }

        const presets = dsMode === "direct"
          ? ["direct_mlp_strong"]
          : ["ar_gru_strong", "ar_lstm_strong"];
        for (let pi = 0; pi < presets.length; pi += 1) {
          const preset = presets[pi];
          const label = "preset:" + preset;
          seedPreconfigGraph(state.editor, preset);
          refreshNodeSummaries(state.editor);
          if (ui.netPreset) ui.netPreset.value = preset;
          refreshCurrentPresetLabel();
          const out = await trainCurrentGraph(label);
          const built = out.built;
          await runAvgBenchmark(out.evalModel, built.isSequence, label + (built.isSequence ? " [seq]" : " [flat]"));
          if (out.evalModel && out.evalModel !== built.model && typeof out.evalModel.dispose === "function") out.evalModel.dispose();
          if (built.model && built.model !== state.model) built.model.dispose();
        }
        setStatus("Benchmark suite completed (" + suite + ") on " + picks.length + " test trajectories.");
      } catch (err) {
        setStatus("Benchmark error: " + err.message);
        console.error(err);
      } finally {
        window.__benchmarkRunning = false;
        window.__benchmarkLastFinishedRunId = runId;
        window.dispatchEvent(new CustomEvent("osc-benchmark-finish", { detail: { runId: runId } }));
        ui.runBenchmarkBtn.disabled = false;
      }
    });
    ui.runFullAutoBtn.addEventListener("click", async function () {
      const waitForBenchmarkFinish = async function (timeoutMs, prevRunId) {
        await new Promise(function (resolve, reject) {
          let startedRunId = null;
          const t = setTimeout(function () {
            window.removeEventListener("osc-benchmark-start", onStart);
            window.removeEventListener("osc-benchmark-finish", onFinish);
            reject(new Error("Timeout while waiting for benchmark to finish."));
          }, timeoutMs);
          const onStart = function (ev) {
            const rid = Number(ev && ev.detail && ev.detail.runId);
            if (Number.isFinite(rid) && rid > prevRunId) startedRunId = rid;
          };
          const onFinish = function (ev) {
            const rid = Number(ev && ev.detail && ev.detail.runId);
            const done = Number(window.__benchmarkLastFinishedRunId || 0);
            if ((startedRunId != null && rid === startedRunId) || (startedRunId == null && done > prevRunId)) {
              clearTimeout(t);
              window.removeEventListener("osc-benchmark-start", onStart);
              window.removeEventListener("osc-benchmark-finish", onFinish);
              resolve();
            }
          };
          window.addEventListener("osc-benchmark-start", onStart);
          window.addEventListener("osc-benchmark-finish", onFinish);
        });
      };

      try {
        ui.runFullAutoBtn.disabled = true;
        setStatus("[AUTO] Starting full benchmark run...");
        state.metricsLog = [];
        state.benchmarkDetails = [];
        ui.metricsTableBody.innerHTML = "";
        try { localStorage.removeItem("osc_benchmark_metrics"); } catch (err) {}
        refreshBenchmarkDetailViews();

        setActiveDatasetModuleId("oscillator", "oscillator");
        patchModuleConfigState("dataset", "oscillator", {
          cardDsSpring: true,
          cardDsPendulum: true,
          cardDsBouncing: true,
        });
        if (ui.benchmarkSuite) ui.benchmarkSuite.value = "current";
        if (ui.modelDatasetSource) ui.modelDatasetSource.value = "auto";

        const runs = [
          { mode: "autoregressive", preset: "ar_gru_strong" },
          { mode: "autoregressive", preset: "ar_lstm_strong" },
          { mode: "direct", preset: "direct_mlp_strong" },
        ];

        for (let i = 0; i < runs.length; i += 1) {
          const run = runs[i];
          setStatus("[AUTO] (" + (i + 1) + "/" + runs.length + ") setup " + run.preset + " [" + run.mode + "]");
          if (ui.predictionMode) {
            ui.predictionMode.value = run.mode;
            ui.predictionMode.dispatchEvent(new Event("change"));
          }
          if (ui.netPreset) ui.netPreset.value = run.preset;
          refreshCurrentPresetLabel();
          applySelectedPreset(run.preset);
          state.model = null;
          state.modelIsSequence = false;

          setStatus("[AUTO] Generating dataset for " + run.preset + "...");
          ui.genDatasetBtn.click();
          await tf.nextFrame();

          setStatus("[AUTO] Running benchmark for " + run.preset + "...");
          const prevRunId = Number(window.__benchmarkRunId || 0);
          ui.runBenchmarkBtn.click();
          await waitForBenchmarkFinish(3 * 60 * 60 * 1000, prevRunId);
          setStatus("[AUTO] Completed " + run.preset + ".");
        }

        setStatus("[AUTO] Full run finished. Export CSV when ready.");
      } catch (err) {
        setStatus("[AUTO] Error: " + err.message);
        console.error(err);
      } finally {
        ui.runFullAutoBtn.disabled = false;
      }
    });
    ui.drawflow.addEventListener("click", function (ev) {
      const nodeEl = ev.target && ev.target.closest ? ev.target.closest(".drawflow-node") : null;
      if (nodeEl && nodeEl.id) {
        const id = String(nodeEl.id).replace("node-", "");
        setActiveNode(state.editor, id);
      }
    });
    ui.drawflow.addEventListener("input", function (ev) {
      state.preparedDataset = null;
      refreshNodeSummaries(state.editor);
      renderNodeConfigPanel(state.editor, state.activeNodeId);
      syncInferredPipelineFromGraph();
    });
    ui.drawflow.addEventListener("change", function (ev) {
      state.preparedDataset = null;
      refreshNodeSummaries(state.editor);
      renderNodeConfigPanel(state.editor, state.activeNodeId);
      syncInferredPipelineFromGraph();
    });
    if (ui.nodeConfigBody) {
      const onPanelCfgChange = function (ev) {
        const field = ev.target && ev.target.closest ? ev.target.closest(".node-cfg-field") : null;
        if (!field || !state.activeNodeId) return;
        const key = String(field.getAttribute("data-key") || "").trim();
        const raw = field.type === "checkbox" ? Boolean(field.checked) : field.value;
        if (!applyNodeConfigUpdate(state.editor, state.activeNodeId, key, raw)) return;
        state.preparedDataset = null;
        refreshNodeSummaries(state.editor);
        renderNodeConfigPanel(state.editor, state.activeNodeId);
        syncInferredPipelineFromGraph();
      };
      ui.nodeConfigBody.addEventListener("input", onPanelCfgChange);
      ui.nodeConfigBody.addEventListener("change", onPanelCfgChange);
    }
    async function runEvaluationFromCurrentGraph() {
      const ds = state.preparedDataset || getDatasetForCurrentGraphMode() || syncActiveDatasetFromSelection();
      const evalScenario = getSelectedEvalScenario();
      const cond = getEvalCondition(evalScenario);
      const result = await evaluateAndPlot({
        model: state.model,
        mode: ds ? ds.mode : String(ui.predictionMode.value || "autoregressive"),
        inferenceMethod: String((ui.inferenceMethod && ui.inferenceMethod.value) || "auto"),
        warmupSteps: getArWarmupStepsFromUI(),
        targetMode: String(state.modelTargetMode || inferTargetModeFromDrawflow(state.editor, "x")),
        isSequence: Boolean(state.modelIsSequence),
        featureConfig: ensureFeatureConfig(getFeatureConfigFromUI(ui)),
        featureSpec: ds ? ds.featureSpec : null,
        condition: cond,
        durationSec: Number(ui.durationSec.value),
        windowSize: Number(ds && ds.windowSize ? ds.windowSize : getActiveWindowSize()),
        arHistory: inferArHistoryConfigFromDrawflow(state.editor, Number(ds && ds.windowSize ? ds.windowSize : getActiveWindowSize())),
        chartEl: ui.compareChart,
      });
      setStatus(
        "Evaluation complete (see chart below Drawflow). MAE=" +
        result.mae.toExponential(3) + ", RMSE=" + result.rmse.toExponential(3)
      );
      appendMetricRow({
        type: "eval",
        scenario: evalScenario + " [" + (ds ? ds.mode : String(ui.predictionMode.value || "autoregressive")) + "]",
        model: state.modelIsSequence ? "sequence-graph" : "flat-graph",
        mae: result.mae,
        rmse: result.rmse,
        bias: result.bias,
      });
    }

    if (ui.qaEvalBtn) {
      ui.qaEvalBtn.addEventListener("click", async function () {
        showWorkspaceTab("eval");
        try {
          await runEvaluationFromCurrentGraph();
        } catch (err) {
          setStatus("Eval error: " + err.message);
          console.error(err);
        }
      });
    }
    ui.qaRandomDatasetEvalBtn.addEventListener("click", async function () {
      showWorkspaceTab("eval");
      try {
        if (!state.model) throw new Error("Train model first.");
        const ds = state.preparedDataset || getDatasetForCurrentGraphMode() || syncActiveDatasetFromSelection();
        if (!ds || !ds.trajectories || !ds.trajectories.length) {
          throw new Error("Generate dataset first.");
        }
        const idx = Math.floor(Math.random() * ds.trajectories.length);
        const tr = ds.trajectories[idx];
        const p = tr.params || {};
        const result = await evaluateDatasetTrajectoryAndPlot({
          model: state.model,
          mode: ds ? ds.mode : String(ui.predictionMode.value || "autoregressive"),
          inferenceMethod: String((ui.inferenceMethod && ui.inferenceMethod.value) || "auto"),
          warmupSteps: getArWarmupStepsFromUI(),
          targetMode: String(state.modelTargetMode || inferTargetModeFromDrawflow(state.editor, "x")),
          isSequence: Boolean(state.modelIsSequence),
          featureConfig: ensureFeatureConfig(getFeatureConfigFromUI(ui)),
          featureSpec: ds ? ds.featureSpec : null,
          trajectory: tr,
          index: idx,
          condition: {
            scenario: p.scenario || ds.scenarioType || ui.scenarioType.value,
            m: Number(p.m),
            c: Number(p.c),
            k: Number(p.k),
            g: Number(p.g),
            restitution: Number(p.restitution),
          },
          dt: ds.dt || Number(ui.dt.value) || 0.02,
          durationSec: ds.durationSec || Number(ui.durationSec.value) || 1,
          windowSize: Number(ds.windowSize || getActiveWindowSize()),
          arHistory: inferArHistoryConfigFromDrawflow(state.editor, Number(ds.windowSize || getActiveWindowSize())),
          chartEl: ui.compareChart,
        });
        appendMetricRow({
          type: "random-dataset-eval",
          scenario:
            ((tr.params && tr.params.scenario) || ds.scenarioType || ui.scenarioType.value) +
            " [" + (ds ? ds.mode : String(ui.predictionMode.value || "autoregressive")) + "]",
          model: state.modelIsSequence ? "sequence-graph" : "flat-graph",
          mae: result.mae,
          rmse: result.rmse,
          bias: result.bias,
        });
        setStatus("Random dataset vs NN complete (#" + idx + "). MAE=" + result.mae.toExponential(3) + " | " + result.params);
      } catch (err) {
        setStatus("Random dataset vs NN error: " + err.message);
      }
    });
    if (ui.savedDatasetSelect) {
      ui.savedDatasetSelect.addEventListener("change", function () {
        ensureLibraryEntityIds();
        const datasetId = String(ui.savedDatasetSelect.value || "").trim();
        if (!datasetId || datasetId === "(none)") {
          clearDatasetViews("No saved dataset selected.");
          return;
        }
        if (String(state.activeDatasetId || "") === datasetId) {
          return;
        }
        loadSavedDatasetById(datasetId, { skipUiSync: true });
      });
    }
    if (ui.datasetModuleSelect) {
      ui.datasetModuleSelect.addEventListener("change", function () {
        const activeModuleId = currentDatasetModuleId();
        if (ui.datasetModuleSelect.value !== activeModuleId) {
          ui.datasetModuleSelect.value = activeModuleId;
        }
      });
    }
    if (ui.datasetName) {
      const onDatasetNameChanged = function () {
        const name = String(ui.datasetName.value || "").trim();
        if (!name) return;
        const exists = state.savedDatasets.some(function (d) { return String((d && d.name) || "") === name; });
        if (exists) {
          loadSavedDatasetNamed(name);
        } else {
          setStatus("Dataset name set to '" + name + "' (will be used on next save).");
        }
      };
      ui.datasetName.addEventListener("change", onDatasetNameChanged);
      ui.datasetName.addEventListener("blur", onDatasetNameChanged);
    }
    if (ui.exportDatasetCsvBtn) {
      ui.exportDatasetCsvBtn.addEventListener("click", function () {
        const ds = syncActiveDatasetFromSelection();
        const schemaId = resolveSchemaId((ds && ds.schemaId) || "oscillator");
        if (schemaId !== "oscillator" || !ds || !Array.isArray(ds.trajectories) || !ds.trajectories.length) {
          setStatus("CSV export currently supports oscillator trajectory datasets only.");
          return;
        }
        const built = buildDatasetCsvAndManifest(ds);
        if (!built) {
          setStatus("No dataset to export. Generate dataset first.");
          return;
        }
        downloadBlob(built.baseName + ".csv", new Blob([built.csv], { type: "text/csv;charset=utf-8;" }));
        downloadJson(built.baseName + ".split_manifest.json", built.manifest);

        setStatus(
          "Dataset exported: CSV + split manifest (" +
            ds.trajectories.length +
            " trajectories, mode=" +
            String(ds.mode || "unknown") +
            ")."
        );
      });
    }
    ui.openTfvisBtn.addEventListener("click", function () {
      try {
        const visor = tfvis.visor();
        if (typeof visor.toggle === "function") {
          visor.toggle();
        } else if (typeof visor.isOpen === "function" && visor.isOpen()) {
          visor.close();
        } else {
          visor.open();
        }
        syncTfvisButtonLabel();
        setStatus("tfjs-vis toggled.");
      } catch (err) {
        setStatus("Unable to open tfjs-vis visor.");
      }
    });
    if (ui.dataTrajIdx) {
      ui.dataTrajIdx.addEventListener("change", function () {
        renderDataTable();
      });
      ui.dataTrajIdx.addEventListener("input", function () {
        renderDataTable();
      });
    }
    if (ui.dataRows) {
      ui.dataRows.addEventListener("change", function () {
        renderDataTable();
      });
      ui.dataRows.addEventListener("input", function () {
        renderDataTable();
      });
    }
    if (ui.datasetImageSplit) {
      ui.datasetImageSplit.addEventListener("change", function () {
        const ds = state.dataset || syncActiveDatasetFromSelection();
        refreshDatasetImageViewer(ds);
      });
    }
    if (ui.datasetImageIndex) {
      ui.datasetImageIndex.addEventListener("change", function () {
        const ds = state.dataset || syncActiveDatasetFromSelection();
        renderDatasetImageSampleFromUi(ds);
        renderImageClassGrid(ds, { randomize: false });
      });
      ui.datasetImageIndex.addEventListener("input", function () {
        const ds = state.dataset || syncActiveDatasetFromSelection();
        renderDatasetImageSampleFromUi(ds);
        renderImageClassGrid(ds, { randomize: false });
      });
    }
    if (ui.mnistRandomByClassBtn) {
      ui.mnistRandomByClassBtn.addEventListener("click", function () {
        const ds = state.dataset || syncActiveDatasetFromSelection();
        renderImageClassGrid(ds, { randomize: true });
      });
    }
    if (ui.drawTableTrajBtn) {
      ui.drawTableTrajBtn.addEventListener("click", function () {
        const ds = state.dataset || syncActiveDatasetFromSelection();
        const schemaId = resolveSchemaId((ds && ds.schemaId) || "oscillator");
        if (schemaId !== "oscillator" || !ds || !Array.isArray(ds.trajectories) || !ds.trajectories.length) {
          setStatus("Draw Trajectory supports oscillator trajectory datasets only.");
          return;
        }
        const idx = clamp(Number(ui.dataTrajIdx && ui.dataTrajIdx.value) || 0, 0, ds.trajectories.length - 1);
        const tr = ds.trajectories[idx];
        const p = (tr && tr.params) || {};
        const scen = String((p && p.scenario) || ds.scenarioType || "unknown");
        plotTrajectoriesOn(
          ui.datasetChart,
          [{
            x: tr.t,
            y: tr.x,
            mode: "lines",
            name:
              scen +
              " | traj " + idx +
              " | m=" + Number(p.m || 0).toFixed(2) +
              " c=" + Number(p.c || 0).toFixed(2),
            line: { color: "#22d3ee" },
          }],
          "Dataset Trajectory #" + idx + " (" + String(ds.mode || "unknown") + ")",
          scen
        );
        setStatus("Drew trajectory #" + idx + " on dataset chart.");
      });
    }

    function applyPresetInferenceDefaults(presetName) {
      if (!ui.inferenceMethod) return;
      const p = String(presetName || "");
      if (p.indexOf("zero_pad") >= 0) {
        ui.inferenceMethod.value = "ar_zero_pad";
      } else if (p.indexOf("edge_pad") >= 0) {
        ui.inferenceMethod.value = "ar_edge_pad";
      } else if (p.indexOf("rk4_warmup") >= 0) {
        ui.inferenceMethod.value = "ar_rk4_warmup";
      } else if (p.indexOf("direct") >= 0) {
        ui.inferenceMethod.value = "direct_only";
      } else if (p.indexOf("ar_") >= 0) {
        ui.inferenceMethod.value = "ar_rk4_warmup";
      }
      updateInferenceMethodVisibility();
      updateInferenceMethodInfo();
    }

    // Apply model preset is a built-in graph import from schema-bound presets.
    function applySelectedPreset(presetOverride) {
      try {
        const p = String(presetOverride || (ui.netPreset && ui.netPreset.value) || "custom");
        if (!state.editor) throw new Error("Drawflow editor not ready.");
        if (ui.netPreset) ui.netPreset.value = p;
        seedPreconfigGraph(state.editor, p);
        applyPresetInferenceDefaults(p);
        let moved = autoArrangeGraph(state.editor);
        scheduleFitGraphToViewport(state.editor, ui.drawflow);
        setTimeout(function () {
          const moved2 = autoArrangeGraph(state.editor);
          moved += moved2;
          scheduleFitGraphToViewport(state.editor, ui.drawflow);
        }, 60);
        refreshNodeSummaries(state.editor);
        setActiveNode(state.editor, "");
        syncInferredPipelineFromGraph();
        refreshCurrentPresetLabel();
        setStatus("Model preset applied: " + p.toUpperCase() + " (graph updated, auto-arranged " + moved + " nodes).");
      } catch (err) {
        setStatus("Model preset error: " + (err && err.message ? err.message : String(err)));
      }
    }
    ui.applyPresetBtn.addEventListener("click", function () {
      openPresetModal();
    });
    if (ui.presetModalApplyBtn) {
      ui.presetModalApplyBtn.addEventListener("click", function () {
        const p = String((ui.presetModalSelect && ui.presetModalSelect.value) || (ui.netPreset && ui.netPreset.value) || "direct_mlp_strong");
        closePresetModal();
        applySelectedPreset(p);
      });
    }
    if (ui.presetModalCancelBtn) {
      ui.presetModalCancelBtn.addEventListener("click", function () {
        closePresetModal();
      });
    }
    if (ui.presetModalSelect) {
      ui.presetModalSelect.addEventListener("change", function () {
        const p = String(ui.presetModalSelect.value || "direct_mlp_strong");
        setStatus("Model preset selected: " + p.toUpperCase() + ". Click Apply.");
      });
    }
    if (ui.presetModalBackdrop) {
      ui.presetModalBackdrop.addEventListener("click", function (ev) {
        if (ev.target === ui.presetModalBackdrop) closePresetModal();
      });
    }
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") {
        closePresetModal();
        closeUnsavedModelModal();
      }
    });
    ui.startCleanBtn.addEventListener("click", function () {
      clearEditor(state.editor);
      refreshNodeSummaries(state.editor);
      setActiveNode(state.editor, "");
      syncInferredPipelineFromGraph();
      if (ui.netPreset) ui.netPreset.value = "custom";
      refreshCurrentPresetLabel();
      markModelGraphClean();
      setStatus("Graph cleared.");
    });

    if (ui.clearGraphBtn) {
      ui.clearGraphBtn.addEventListener("click", function () {
        clearEditor(state.editor);
        refreshNodeSummaries(state.editor);
        setActiveNode(state.editor, "");
        syncInferredPipelineFromGraph();
        setStatus("Graph cleared.");
      });
    }
    if (ui.autoArrangeBtn) {
      ui.autoArrangeBtn.addEventListener("click", function () {
        const moved = autoArrangeGraph(state.editor);
        scheduleFitGraphToViewport(state.editor, ui.drawflow);
        syncInferredPipelineFromGraph();
        setStatus("Auto Arrange complete (" + moved + " nodes).");
      });
    }
    if (ui.exportGraphBtn) {
      ui.exportGraphBtn.addEventListener("click", function () {
        try { exportGraphJson(); } catch (err) { setStatus("Export graph error: " + err.message); }
      });
    }
    if (ui.importGraphBtn && ui.importGraphFile) {
      ui.importGraphBtn.addEventListener("click", function () {
        ui.importGraphFile.value = "";
        ui.importGraphFile.click();
      });
      ui.importGraphFile.addEventListener("change", function (ev) {
        const f = ev && ev.target && ev.target.files && ev.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = function () {
          try {
            const payload = JSON.parse(String(reader.result || "{}"));
            importGraphJsonObject(payload, { resetPreset: true });
          } catch (err) {
            setStatus("Import graph error: " + err.message);
          }
        };
        reader.onerror = function () {
          setStatus("Import graph error: unable to read file.");
        };
        reader.readAsText(f);
      });
    }

    if (ui.modelPaletteMount && !ui.modelPaletteMount.__paletteBound) {
      ui.modelPaletteMount.__paletteBound = true;
      ui.modelPaletteMount.addEventListener("click", function (ev) {
        const btn = ev.target && ev.target.closest ? ev.target.closest("[data-palette-type]") : null;
        if (!btn || !state.editor) return;
        const runtime = getModelGraphRuntime();
        if (!runtime || typeof runtime.createNodeByType !== "function") {
          setStatus("Model graph runtime is not ready.");
          return;
        }
        const schemaId = resolveSchemaId(state.modelSchemaId || "oscillator");
        const item = getSchemaPaletteSpec(schemaId).find(function (spec) {
          return String(spec.type || "") === String(btn.getAttribute("data-palette-type") || "");
        });
        if (!item) return;
        try {
          const id = runtime.createNodeByType(
            state.editor,
            item.type,
            120 + Math.random() * 160,
            120 + Math.random() * 180,
            item.config || {},
            schemaId
          );
          refreshNodeSummaries(state.editor);
          setActiveNode(state.editor, id);
          syncInferredPipelineFromGraph();
        } catch (err) {
          setStatus("Add node error: " + (err && err.message ? err.message : String(err)));
        }
      });
    }

    function runDatasetCompare() {
      const ds = syncActiveDatasetFromSelection();
      const schemaId = resolveSchemaId((ds && ds.schemaId) || "oscillator");
      if (schemaId !== "oscillator" || !ds || !ds.trajectories || !ds.trajectories.length) {
        setStatus("Dataset Compare currently supports oscillator trajectory datasets only.");
        showWorkspaceTab("dataset");
        return;
      }

      const mode = ui.datasetCompareMode.value;
      const scenarioFilter = String((ui.datasetCompareScenario && ui.datasetCompareScenario.value) || "all");
      const pool = ds.trajectories.filter(function (tr) {
        return matchesScenarioFilter(tr, scenarioFilter, ds.scenarioType);
      });
      if (!pool.length) {
        setStatus("No trajectories found for compare scenario filter '" + scenarioFilter + "'.");
        return;
      }
      const picks = pickDatasetTrajectories(pool, mode, 3, ui.selectedTrajCsv.value);

      const colors = ["#22d3ee", "#a78bfa", "#f59e0b"];
      const traces = picks.map(function (tr, i) {
        const p = tr.params || {};
        const scen = String((p && p.scenario) || ds.scenarioType || "unknown");
        return {
          x: tr.t,
          y: tr.x,
          mode: "lines",
          name:
            scen +
            " | traj" + (i + 1) +
            " | m=" + Number(p.m || 0).toFixed(2) +
            " c=" + Number(p.c || 0).toFixed(2),
          line: { color: colors[i % colors.length] },
        };
      });

      plotTrajectoriesOn(
        ui.datasetChart,
        traces,
        "Dataset Trajectory Comparison (" + (scenarioFilter === "all" ? "all" : scenarioFilter) + " [" + ds.mode + "]; scenario shown in legend)"
      );
      if (picks.length) syncTableToPlottedTrajectory(ds, picks[0]);
      if (state.currentWorkspace !== "dataset") showWorkspaceTab("dataset");
      setStatus("Showing " + picks.length + " RK4 dataset trajectories (" + mode + ", filter=" + scenarioFilter + ").");
    }

    if (ui.datasetComparePageBtn) ui.datasetComparePageBtn.addEventListener("click", runDatasetCompare);

    ui.genDatasetBtn.addEventListener("click", async function () {
      const activeDatasetId = String(state.activeDatasetId || "").trim();
      if (!activeDatasetId) {
        setStatus("Select a dataset item from the left panel first, then create dataset.");
        return;
      }
      const activeDatasetEntry = getSavedDatasetById(activeDatasetId);
      if (!activeDatasetEntry) {
        setStatus("Selected dataset item not found.");
        return;
      }
      const moduleId = currentDatasetModuleId();
      const module = getDatasetModule(moduleId);
      const moduleSchemaId = resolveSchemaId((module && module.schemaId) || "oscillator");
      const savedSchemaId = getSavedDatasetSchemaId(activeDatasetEntry, moduleSchemaId);
      if (savedSchemaId !== moduleSchemaId) {
        setStatus("Selected dataset schema is '" + savedSchemaId + "'. Choose a '" + moduleSchemaId + "' dataset item first.");
        return;
      }
      const prevLabel = ui.genDatasetBtn ? String(ui.genDatasetBtn.textContent || "Create Dataset") : "Create Dataset";
      if (ui.genDatasetBtn) {
        ui.genDatasetBtn.disabled = true;
        ui.genDatasetBtn.textContent = "Loading...";
      }
      try {
        const moduleLabel = String((module && module.label) || moduleId || "dataset");
        setStatus("Building " + moduleLabel + " dataset...");
        const rawBuildOutput = await buildDatasetFromSelectedModule();
        const normalizedBuild = normalizeDatasetBuildOutput(rawBuildOutput, {
          schemaId: moduleSchemaId,
          moduleId: moduleId,
          requestedVariantId: resolveRequestedDatasetMode(),
        });
        applyBuiltDatasetResult(normalizedBuild);
        const finalName = String((ui.datasetName && ui.datasetName.value) || activeDatasetEntry.name || "").trim() || String(activeDatasetEntry.name || "dataset");
        if (ui.datasetName) ui.datasetName.value = finalName;
        if (moduleSchemaId === "oscillator") {
          state.currentConfigSig = buildRunConfigSignature();
        }
        const savedId = saveCurrentDatasetNamed(finalName, activeDatasetEntry.id, normalizedBuild.activeDataset);
        if (savedId) loadSavedDatasetById(savedId, { skipUiSync: true });
        const variantKeys = Object.keys(normalizedBuild.variantMap || {});
        if (variantKeys.length > 1) {
          setStatus(
            "Built and updated " + moduleLabel + " dataset '" + finalName + "'. " +
            "variants=" + variantKeys.join(", ") +
            " | active=" + String(normalizedBuild.activeVariantId || (state.dataset && state.dataset.mode) || "default")
          );
        } else {
          setStatus(
            "Built and updated " + moduleLabel + " dataset '" + finalName + "'. " +
            "train/val/test=" + Number((state.dataset && state.dataset.trainCount) || 0) + "/" +
            Number((state.dataset && state.dataset.valCount) || 0) + "/" +
            Number((state.dataset && state.dataset.testCount) || 0)
          );
        }
      } catch (err) {
        setStatus("Create dataset failed: " + err.message);
      } finally {
        if (ui.genDatasetBtn) {
          ui.genDatasetBtn.disabled = false;
          ui.genDatasetBtn.textContent = prevLabel;
        }
      }
    });

    async function runTrainingFromCurrentGraph(runOpts) {
      const opts = runOpts || {};
      const statusPrefix = String(opts.statusPrefix || "");
      const trainerOverride = opts.trainerCfg || null;
      const onEpochData = typeof opts.onEpochData === "function" ? opts.onEpochData : null;
      const onRuntimeEvent = typeof opts.onRuntimeEvent === "function" ? opts.onRuntimeEvent : null;
      const runtimeContext = normalizeRuntimeConfig(
        (opts.runtimeContext && opts.runtimeContext.runtimeId) || "js_client",
        (opts.runtimeContext && opts.runtimeContext.backend) || "auto",
        (opts.runtimeContext && opts.runtimeContext.transport) || "inproc"
      );
      const runtimeSessionId = String(opts.sessionId || "");
      const emitRuntimeEvent = function (kind, payload) {
        if (!onRuntimeEvent) return;
        onRuntimeEvent(createRuntimeTrainEvent(kind, {
          sessionId: runtimeSessionId,
          runtimeConfig: runtimeContext,
        }, payload || {}));
      };
      const history = { epoch: [], loss: [], val_loss: [], lr: [] };
      const recordEpoch = function (epochOneBased, logs) {
        const e = Number(epochOneBased || 0);
        if (!Number.isFinite(e) || e <= 0) return;
        const total = Math.max(1, Number(trainerCfg && trainerCfg.epochs) || 1);
        const loss = Number(logs && logs.loss);
        const valLoss = Number(logs && logs.val_loss);
        const curLr = Number(logs && logs.current_lr);
        const bestVal = Number(logs && logs.best_val_loss);
        const stoppedEarly = Boolean(logs && logs.stopped_early);
        const improved = Boolean(logs && logs.improved);
        const latentAbs = Number(logs && logs.latent_abs);
        const latentNorm = Number(logs && logs.latent_norm);
        const latentKl = Number(logs && logs.latent_kl);
        history.epoch.push(e);
        history.loss.push(loss);
        history.val_loss.push(valLoss);
        history.lr.push(curLr);
        setStatus(
          statusPrefix +
          "Training " + e + "/" + total +
          " | loss=" + (Number.isFinite(loss) ? loss.toExponential(3) : "n/a") +
          " | val_loss=" + (Number.isFinite(valLoss) ? valLoss.toExponential(3) : "n/a") +
          (Number.isFinite(curLr) ? " | lr=" + curLr.toExponential(2) : "") +
          (Number.isFinite(bestVal) ? " | best=" + bestVal.toExponential(3) : "") +
          (improved ? " (best)" : "") +
          (stoppedEarly ? " | early-stop" : "") +
          (Number.isFinite(latentAbs) ? " | z_abs=" + latentAbs.toExponential(3) : "") +
          (Number.isFinite(latentNorm) ? " | z_norm=" + latentNorm.toExponential(3) : "") +
          (Number.isFinite(latentKl) ? " | kl=" + latentKl.toExponential(3) : "")
        );
        if (Number.isFinite(latentAbs)) {
          appendLatentMonitorPoint(e, { absMean: latentAbs, normMean: latentNorm });
          if (ui.latentMonitorInfo && logs && logs.latent_groups) {
            ui.latentMonitorInfo.textContent = "Tracking: " + String(logs.latent_groups);
          }
        }
        if (onEpochData) {
          onEpochData({
            epoch: e,
            loss: loss,
            val_loss: valLoss,
            lr: curLr,
            best_val_loss: bestVal,
            improved: improved,
          }, history);
        }
        emitRuntimeEvent("epoch_end", {
          status: { state: "running", message: "Epoch " + e + " complete." },
          metrics: {
            epoch: e,
            train_loss: loss,
            val_loss: valLoss,
            lr: curLr,
            best_val_loss: bestVal,
            improved: improved,
          },
        });
      };
      syncInferredPipelineFromGraph();
      const dsBase = getDatasetForCurrentGraphMode() || syncActiveDatasetFromSelection();
      if (!dsBase) throw new Error("Generate dataset first.");
      const mode = String(dsBase.mode || "autoregressive");
      const dsSpec = normalizeFeatureSpec(dsBase.featureSpec || {}, mode);
      const currentSpec = normalizeFeatureSpec(
        inferFeatureSpecFromDrawflow(state.editor, mode, dsSpec),
        mode
      );
      if (!isFeatureSpecEqual(dsSpec, currentSpec, mode)) {
        throw new Error("Drawflow feature blocks changed since dataset build. Regenerate dataset before training.");
      }
      const outputHeads = inferOutputHeadsFromDrawflow(state.editor, "x");
      const dsTargetMode = inferDatasetTargetModeFromOutputHeads(outputHeads, "x");
      const ds = prepareDatasetForModel(dsBase, {
        mode: mode,
        windowSize: getActiveWindowSize(),
        arHistory: inferArHistoryConfigFromDrawflow(state.editor, getActiveWindowSize()),
        targetMode: dsTargetMode,
        featureSpec: currentSpec,
      });
      const modelFamily = inferModelFamilyFromDrawflow(state.editor);
      setStatus(statusPrefix + "Building model...");
      await tf.nextFrame();
      const built = buildModelFromDrawflow(state.editor, ds);
      const predHeadIdx = pickPrimaryTrajectoryHeadIndex(built.headConfigs || []);
      if (predHeadIdx < 0) throw new Error("No trajectory output head found. Add Output target x, v, x+v, or traj for evaluation.");
      const predHead = (built.headConfigs && built.headConfigs[predHeadIdx]) || { target: String(ds.targetMode || "x") };
      state.modelIsSequence = built.isSequence;
      state.modelTargetMode = String(predHead.target || ds.targetMode || "x");
      state.modelOutputSize = Number((state.modelTargetMode === "xv") ? 2 : 1);
      state.preparedDataset = ds;
      const trainerCfg = trainerOverride || getTrainerControlOptionsFromUI();
      if (!trainerCfg || typeof trainerCfg !== "object") {
        throw new Error("Invalid trainer configuration.");
      }
      const latentHeadCount = (built.headConfigs || []).filter(function (h) {
        const t = String(h.target || "");
        return t === "latent_diff" || t === "latent_kl";
      }).length;
      resetLatentMonitorChart(
        latentHeadCount > 0
          ? ("Latent monitor active (" + latentHeadCount + " latent head" + (latentHeadCount > 1 ? "s" : "") + ").")
          : "No latent heads in this graph. Add Latent Z groups and/or VAE Reparam nodes."
      );
      const lossCfg = inferOutputLossConfigFromDrawflow(state.editor, getGlobalLossType());
      setStatus(
        statusPrefix +
        "Training started [" + mode + "][" + modelFamily + "] (" + (state.modelIsSequence ? "SEQUENCE" : "FLAT") + " graph). " +
        "Train=" + ds.yTrain.length + ", Val=" + ds.yVal.length + ", Test=" + ds.yTest.length +
        ", loss=" + String(lossCfg.resolvedLossType)
      );
      emitRuntimeEvent("run_started", {
        status: { state: "running", message: "Training started." },
        mode: mode,
        modelFamily: modelFamily,
        train: {
          train_size: Number(ds.yTrain.length),
          val_size: Number(ds.yVal.length),
          test_size: Number(ds.yTest.length),
          loss: String(lossCfg.resolvedLossType),
        },
      });
      await tf.nextFrame();
      const runWithWorker = async function () {
        if (!supportsTrainingWorker()) {
          return null;
        }
        const modelArtifacts = await built.model.save(tf.io.withSaveHandler(async function (artifacts) {
          return artifacts;
        }));
        const result = await runTrainingInWorker({
          runId: String("run-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36)),
          runtimeConfig: runtimeContext,
          modelArtifacts: modelArtifacts,
          dataset: ds,
          isSequence: state.modelIsSequence,
          headConfigs: built.headConfigs,
          outputLossConfig: lossCfg,
          lossType: getGlobalLossType(),
          epochs: Number(trainerCfg.epochs),
          batchSize: Number(trainerCfg.batchSize),
          optimizerType: String(trainerCfg.optimizerType || "adam"),
          learningRate: Number(trainerCfg.learningRate),
          lrSchedulerType: String(trainerCfg.lrSchedulerType || "plateau"),
          useLrScheduler: Boolean(trainerCfg.useLrScheduler),
          lrPatience: Number(trainerCfg.lrPatience),
          lrFactor: Number(trainerCfg.lrFactor),
          minLr: Number(trainerCfg.minLr),
          gradClipNorm: Number(trainerCfg.gradClipNorm),
          gradClipValue: Number(trainerCfg.gradClipValue),
          restoreBestWeights: Boolean(trainerCfg.restoreBestWeights),
          earlyStoppingPatience: Number(trainerCfg.earlyStoppingPatience),
          onEpochData: function (payload) {
            recordEpoch(payload && payload.epoch, payload || {});
          },
          onStatus: function (msg) {
            setStatus(statusPrefix + msg);
          },
        });
        if (!result || !result.metrics) {
          throw new Error("Training worker returned invalid result.");
        }
        const workerArtifacts = result.modelArtifacts || null;
        if (!workerArtifacts) throw new Error("Training worker did not return trained model artifacts.");
        const finalModel = await loadModelFromArtifactForTrainingArtifacts(workerArtifacts);
        if (!finalModel) throw new Error("Failed to load trained model artifacts.");
        return {
          model: finalModel,
          evalModel: Array.isArray(finalModel.outputs)
            ? tf.model({ inputs: finalModel.inputs, outputs: finalModel.outputs[predHeadIdx] })
            : finalModel,
          metrics: result.metrics,
          artifactHistory: result.history,
        };
      };
      const runWithMain = async function () {
        const metrics = await trainModel({
          model: built.model,
          dataset: ds,
          isSequence: state.modelIsSequence,
          headConfigs: built.headConfigs,
          useTfvis: Boolean(ui.useTfvis && ui.useTfvis.checked),
          lossType: getGlobalLossType(),
          outputLossConfig: lossCfg,
          onStatus: function (msg) {
            setStatus(statusPrefix + msg);
          },
          onEpochEnd: function (epoch, logs) {
            recordEpoch(epoch + 1, logs);
          },
          epochs: Number(trainerCfg.epochs),
          batchSize: Number(trainerCfg.batchSize),
          optimizerType: String(trainerCfg.optimizerType || "adam"),
          learningRate: Number(trainerCfg.learningRate),
          lrSchedulerType: String(trainerCfg.lrSchedulerType || "plateau"),
          useLrScheduler: Boolean(trainerCfg.useLrScheduler),
          lrPatience: Number(trainerCfg.lrPatience),
          lrFactor: Number(trainerCfg.lrFactor),
          minLr: Number(trainerCfg.minLr),
          gradClipNorm: Number(trainerCfg.gradClipNorm),
          gradClipValue: Number(trainerCfg.gradClipValue),
          restoreBestWeights: Boolean(trainerCfg.restoreBestWeights),
          earlyStoppingPatience: Number(trainerCfg.earlyStoppingPatience),
        });
        return {
          model: built.model,
          evalModel: Array.isArray(built.model.outputs)
            ? tf.model({ inputs: built.model.inputs, outputs: built.model.outputs[predHeadIdx] })
            : built.model,
          metrics: metrics,
          artifactHistory: null,
        };
      };
      const runResult = function () {
        if (runtimeContext.runtimeId !== "js_client") {
          throw new Error("Runtime '" + String(runtimeContext.runtimeId) + "' is not supported in client trainer.");
        }
        return runWithWorker().catch(function () {
          return runWithMain();
        });
      }();
      const trainingResult = await runResult;
      const metrics = trainingResult && trainingResult.metrics;
      const resolvedModel = trainingResult && trainingResult.model;
      const evalModel = trainingResult && trainingResult.evalModel;
      if (!resolvedModel || !evalModel) {
        throw new Error("Training completed without a valid model.");
      }
      if (trainingResult && trainingResult.artifactHistory && trainingResult.artifactHistory.epoch) {
        history.epoch = Array.isArray(trainingResult.artifactHistory.epoch) ? trainingResult.artifactHistory.epoch.slice() : history.epoch;
        history.loss = Array.isArray(trainingResult.artifactHistory.loss) ? trainingResult.artifactHistory.loss.slice() : history.loss;
        history.val_loss = Array.isArray(trainingResult.artifactHistory.val_loss) ? trainingResult.artifactHistory.val_loss.slice() : history.val_loss;
        history.lr = Array.isArray(trainingResult.artifactHistory.lr) ? trainingResult.artifactHistory.lr.slice() : history.lr;
      }
      const prevModel = state.model;
      state.model = evalModel;
      state.modelIsSequence = built.isSequence;
      state.modelTargetMode = String(predHead.target || ds.targetMode || "x");
      state.modelOutputSize = Number((state.modelTargetMode === "xv") ? 2 : 1);
      if (prevModel && prevModel !== state.model && typeof prevModel.dispose === "function") {
        prevModel.dispose();
      }
      setStatus(
        statusPrefix +
        "Training complete. Val MAE=" + metrics.mae.toExponential(3) +
        " Test MAE=" + metrics.testMae.toExponential(3) +
        (Number.isFinite(Number(metrics.bestValLoss)) ? " | best_val_loss=" + Number(metrics.bestValLoss).toExponential(3) : "") +
        (Number.isFinite(Number(metrics.bestEpoch)) ? " | best_epoch=" + String(metrics.bestEpoch) : "") +
        (Number.isFinite(Number(metrics.finalLr)) ? " | final_lr=" + Number(metrics.finalLr).toExponential(2) : "") +
        (metrics.stoppedEarly ? " | early-stop" : "")
      );
      appendMetricRow({
        type: "train",
        scenario: ds.scenarioType + " [" + mode + "]",
        model: (state.modelIsSequence ? "sequence-graph" : "flat-graph"),
        valMae: metrics.mae,
        testMae: metrics.testMae,
      });
      emitRuntimeEvent("run_completed", {
        status: { state: "completed", message: "Training complete." },
        metrics: {
          val_mae: Number(metrics.mae),
          test_mae: Number(metrics.testMae),
          best_val_loss: Number(metrics.bestValLoss),
          best_epoch: Number(metrics.bestEpoch),
          final_lr: Number(metrics.finalLr),
        },
      });
      return { ds: ds, metrics: metrics, history: history };
    }

    ui.trainBtn.addEventListener("click", async function () {
      try {
        await runTrainingFromCurrentGraph();
      } catch (err) {
        setStatus("Train error: " + err.message);
        console.error(err);
      }
    });

    function applyTrainCfgToUi(cfg) {
      const c = cfg || {};
      if (ui.epochs && Number.isFinite(Number(c.epochs))) ui.epochs.value = String(Number(c.epochs));
      if (ui.batchSize && Number.isFinite(Number(c.batchSize))) ui.batchSize.value = String(Number(c.batchSize));
      if (ui.optimizerType) ui.optimizerType.value = normalizeOptimizerType(c.optimizerType, "adam");
      if (ui.learningRate && Number.isFinite(Number(c.learningRate))) ui.learningRate.value = String(Number(c.learningRate));
      if (ui.useLrScheduler) {
        const schedulerType = normalizeLrSchedulerType(
          c.lrSchedulerType,
          c.useLrScheduler === false ? "none" : "plateau"
        );
        const controlType = String(ui.useLrScheduler.type || "").toLowerCase();
        if (controlType === "checkbox") {
          ui.useLrScheduler.checked = schedulerType !== "none";
        } else {
          ui.useLrScheduler.value = schedulerType;
        }
      }
      if (ui.lrPatience && Number.isFinite(Number(c.lrPatience))) ui.lrPatience.value = String(Number(c.lrPatience));
      if (ui.lrFactor && Number.isFinite(Number(c.lrFactor))) ui.lrFactor.value = String(Number(c.lrFactor));
      if (ui.minLr && Number.isFinite(Number(c.minLr))) ui.minLr.value = String(Number(c.minLr));
      if (ui.gradClipNorm && Number.isFinite(Number(c.gradClipNorm))) ui.gradClipNorm.value = String(Number(c.gradClipNorm));
      if (ui.gradClipValue && Number.isFinite(Number(c.gradClipValue))) ui.gradClipValue.value = String(Number(c.gradClipValue));
      if (ui.restoreBestWeights && typeof c.restoreBestWeights === "boolean") ui.restoreBestWeights.checked = Boolean(c.restoreBestWeights);
      if (ui.earlyStoppingPatience && Number.isFinite(Number(c.earlyStoppingPatience))) {
        ui.earlyStoppingPatience.value = String(Number(c.earlyStoppingPatience));
      }
    }

    function buildRuntimeSessionPayloadDraft(planItem, runtimeCfg) {
      const p = planItem || {};
      const rc = normalizeRuntimeConfig(
        (runtimeCfg && runtimeCfg.runtimeId) || p.runtime || "js_client",
        (runtimeCfg && runtimeCfg.backend) || p.runtimeBackend || "auto",
        (runtimeCfg && runtimeCfg.transport) || "inproc"
      );
      const dsEntry = getSavedDatasetById(p.datasetId);
      const adapter = (typeof window !== "undefined" && window.OSCDatasetBundleAdapter &&
        typeof window.OSCDatasetBundleAdapter.buildNotebookDatasetFiles === "function")
        ? window.OSCDatasetBundleAdapter
        : null;
      let dsBundle = null;
      if (adapter && dsEntry && dsEntry.data) {
        dsBundle = adapter.buildNotebookDatasetFiles({
          dataset: dsEntry.data,
          datasetName: p.datasetName || (dsEntry && dsEntry.name) || "dataset",
          schemaId: p.datasetSchemaId || p.schemaId || "oscillator",
          sourceTag: "runtime_payload_draft",
        });
      }
      return {
        irVersion: "1.0",
        sessionId: String((p.session && p.session.id) || ""),
        sessionName: String((p.session && p.session.name) || ""),
        schemaId: String(p.schemaId || "oscillator"),
        runtimeConfig: rc,
        trainCfg: JSON.parse(JSON.stringify(p.trainCfg || {})),
        dataset: {
          id: String(p.datasetId || ""),
          name: String(p.datasetName || ""),
          schemaId: String(p.datasetSchemaId || p.schemaId || "oscillator"),
          bundle: dsBundle ? {
            format: String(dsBundle.format || ""),
            datasetRef: String(dsBundle.datasetRef || ""),
            splitRef: String(dsBundle.splitRef || ""),
            files: Array.isArray(dsBundle.files) ? dsBundle.files : [],
          } : null,
        },
        model: {
          id: String(p.modelId || ""),
          name: String(p.modelName || ""),
          schemaId: String(p.modelSchemaId || p.schemaId || "oscillator"),
          drawflowGraph: JSON.parse(JSON.stringify(p.modelGraph || {})),
        },
      };
    }

    async function runTrainSessionsByIds(sessionIds) {
      ensureLibraryEntityIds();
      const ids = Array.isArray(sessionIds) ? sessionIds.map(function (x) { return String(x || ""); }).filter(Boolean) : [];
      if (!ids.length) throw new Error("No trainer selected.");
      if (state.trainQueueRunning) throw new Error("Training is already running.");
      const runs = ids.map(function (sid) {
        return state.trainSessions.find(function (x) { return String(x.id) === sid; });
      }).filter(Boolean);
      if (!runs.length) throw new Error("No trainer selected.");

      const runPlan = runs.map(function (s) {
        normalizeTrainSessionRecord(s);
        const ds = getSavedDatasetById(s.datasetId);
        const model = getSavedModelById(s.modelId);
        if (!ds || !ds.data) throw new Error("Dataset not found for session: " + s.name);
        if (!model || !model.graph) throw new Error("Model not found for session: " + s.name);
        const sessionSchemaId = inferSessionSchemaId(s, state.modelSchemaId || "oscillator");
        const datasetSchemaId = getSavedDatasetSchemaId(ds, sessionSchemaId);
        const modelSchemaId = getSavedModelSchemaId(model, sessionSchemaId);
        if (datasetSchemaId !== sessionSchemaId) {
          throw new Error("Session '" + s.name + "' dataset schema mismatch: expected '" + sessionSchemaId + "', got '" + datasetSchemaId + "'.");
        }
        if (modelSchemaId !== sessionSchemaId) {
          throw new Error("Session '" + s.name + "' model schema mismatch: expected '" + sessionSchemaId + "', got '" + modelSchemaId + "'.");
        }
        const runtime = normalizeRuntimeId(s.runtime || "js_client");
        return {
          session: s,
          schemaId: sessionSchemaId,
          datasetId: String(ds.id || ""),
          datasetName: String(ds.name || s.datasetName || ""),
          datasetSchemaId: datasetSchemaId,
          runtime: runtime,
          runtimeBackend: normalizeRuntimeBackend(runtime, s.runtimeBackend || "auto"),
          trainCfg: JSON.parse(JSON.stringify(s.trainCfg || {})),
          modelId: String(model.id || ""),
          modelName: String(model.name || s.modelName || ""),
          modelSchemaId: modelSchemaId,
          modelGraph: JSON.parse(JSON.stringify(model.graph || {})),
        };
      });

      state.trainQueueRunning = true;
      updateModelLibraryLockUi();
      refreshTrainQueueActionButtons();
      setTrainSessionStatus("Training started: model editing is locked until run completes.");
      let ranCount = 0;
      let skippedCount = 0;
      try {
        for (let i = 0; i < runPlan.length; i += 1) {
          const p = runPlan[i];
          const s = p.session;
          state.activeTrainSessionId = String(s.id || "");
          s.schemaId = p.schemaId;
          s.runtime = p.runtime;
          s.runtimeFamily = runtimeFamilyFor(s.runtime);
          s.runtimeBackend = p.runtimeBackend;
          s.datasetId = p.datasetId;
          s.datasetName = p.datasetName;
          s.modelId = p.modelId;
          s.modelName = p.modelName;
          clearTrainSessionState(s, "fresh run");
          renderTrainSessionTable();
          plotTrainerLossChart(s);
          renderTrainSessionEpochTable(s);
          const baseRuntimeConfig = normalizeRuntimeConfig(s.runtime, s.runtimeBackend, s.runtime === "js_client" ? "inproc" : "ws");
          const emitSessionRuntimeEvent = function (kind, payload, runtimeCfgOverride) {
            const ev = createRuntimeTrainEvent(kind, {
              sessionId: String(s.id || ""),
              runtimeConfig: runtimeCfgOverride || baseRuntimeConfig,
            }, payload || {});
            applyRuntimeTrainEventToSession(s, ev);
            renderTrainSessionEpochTable(s);
            if (kind === "epoch_end") {
              const ep = Number(ev.metrics && ev.metrics.epoch);
              if (ep === 1 || (Number.isFinite(ep) && ep % 2 === 0)) plotTrainerLossChart(s);
            } else {
              plotTrainerLossChart(s);
            }
            if (kind !== "epoch_end" && ev.status && ev.status.message) {
              setTrainSessionStatus("[" + s.name + "] " + String(ev.status.message));
            }
            return ev;
          };
          const hs = await performRuntimeHandshake(baseRuntimeConfig);
          if (!hs.ok) {
            skippedCount += 1;
            emitSessionRuntimeEvent("handshake_failed", {
              status: {
                state: "error",
                message: String(hs.message || hs.reason || "Runtime handshake failed."),
              },
              reason: String(hs.reason || "runtime_handshake_failed"),
              handshake: {
                ok: false,
                runtimeId: baseRuntimeConfig.runtimeId,
                backend: baseRuntimeConfig.backend,
                transport: baseRuntimeConfig.transport,
              },
            }, baseRuntimeConfig);
            emitSessionRuntimeEvent("run_skipped", {
              status: {
                state: "skipped",
                message: "Skipped: runtime handshake failed.",
              },
              reason: String(hs.reason || "runtime_handshake_failed"),
            }, baseRuntimeConfig);
            continue;
          }
          const activeRuntimeConfig = hs.runtimeConfig || baseRuntimeConfig;
          s.runtimeBackend = normalizeRuntimeBackend(s.runtime, activeRuntimeConfig.backend || s.runtimeBackend || "auto");
          emitSessionRuntimeEvent("handshake_ok", {
            status: {
              state: "ready",
              message: "Runtime handshake ready.",
            },
            handshake: {
              ok: true,
              runtimeId: activeRuntimeConfig.runtimeId,
              backend: activeRuntimeConfig.backend,
              transport: activeRuntimeConfig.transport,
              backendAvailability: hs.backendAvailability || null,
            },
          }, activeRuntimeConfig);
          if (activeRuntimeConfig.runtimeId !== "js_client") {
            skippedCount += 1;
            const draftPayload = buildRuntimeSessionPayloadDraft(p, activeRuntimeConfig);
            emitSessionRuntimeEvent("run_skipped", {
              status: {
                state: "skipped",
                message: "Pending adapter for runtime '" + activeRuntimeConfig.runtimeId + "' on client-first runner.",
              },
              reason: "adapter_not_implemented",
              payload: {
                schemaId: String(draftPayload.schemaId || ""),
                dataset: {
                  schemaId: String(draftPayload.dataset && draftPayload.dataset.schemaId || ""),
                  format: String(draftPayload.dataset && draftPayload.dataset.bundle && draftPayload.dataset.bundle.format || ""),
                  datasetRef: String(draftPayload.dataset && draftPayload.dataset.bundle && draftPayload.dataset.bundle.datasetRef || ""),
                  fileCount: Number((draftPayload.dataset && draftPayload.dataset.bundle && draftPayload.dataset.bundle.files && draftPayload.dataset.bundle.files.length) || 0),
                },
              },
            }, activeRuntimeConfig);
            continue;
          }

          const ds = getSavedDatasetById(p.datasetId);
          if (!ds || !ds.data) throw new Error("Dataset not found for session: " + s.name);
          if (!p.modelGraph || typeof p.modelGraph !== "object") throw new Error("Model snapshot is invalid for session: " + s.name);

          if (!s.history) s.history = createEmptyTrainSessionHistory();
          s.history = createEmptyTrainSessionHistory();
          plotTrainerLossChart(s);

          loadSavedDatasetById(p.datasetId, { skipUiSync: true });
          setCurrentModelSchema(p.modelSchemaId, { skipNodePanelRefresh: true });
          importGraphJsonObject(p.modelGraph, {
            presetValue: String(p.modelPreset || s.preset || "").trim(),
            resetPreset: !String(p.modelPreset || s.preset || "").trim(),
          });
          if (ui.modelLibraryName) ui.modelLibraryName.value = p.modelName;
          state.activeModelId = String(p.modelId || "");
          state.activeModelName = String(p.modelName || "");
          applyTrainCfgToUi(p.trainCfg || {});

          let out = null;
          try {
            out = await runTrainingFromCurrentGraph({
              statusPrefix: "[session " + (i + 1) + "/" + runPlan.length + " | " + s.name + "] ",
              trainerCfg: p.trainCfg || buildTrainCfgFromUi(),
              runtimeContext: activeRuntimeConfig,
              sessionId: String(s.id || ""),
              onRuntimeEvent: function (ev) {
                applyRuntimeTrainEventToSession(s, ev);
                renderTrainSessionEpochTable(s);
                if (String(ev.kind || "") === "epoch_end") {
                  const ep = Number(ev.metrics && ev.metrics.epoch);
                  if (ep === 1 || (Number.isFinite(ep) && ep % 2 === 0)) plotTrainerLossChart(s);
                } else {
                  plotTrainerLossChart(s);
                }
              },
            });
          } catch (err) {
            emitSessionRuntimeEvent("run_failed", {
              status: {
                state: "error",
                message: "Training failed: " + String(err && err.message ? err.message : err),
              },
              reason: "train_error",
            }, activeRuntimeConfig);
            throw err;
          }

          s.lastResult = {
            valMae: Number(out && out.metrics && out.metrics.mae),
            testMae: Number(out && out.metrics && out.metrics.testMae),
            bestValLoss: Number(out && out.metrics && out.metrics.bestValLoss),
            bestEpoch: Number(out && out.metrics && out.metrics.bestEpoch),
            finalLr: Number(out && out.metrics && out.metrics.finalLr),
          };
          ranCount += 1;
          plotTrainerLossChart(s);
        }
        setTrainSessionStatus(
          "Training run complete: trained=" + ranCount + ", skipped=" + skippedCount + ", total=" + runPlan.length + "."
        );
        renderTrainSessionTable();
        showWorkspaceTab("train");
      } finally {
        state.trainQueueRunning = false;
        updateModelLibraryLockUi();
        refreshTrainQueueActionButtons();
      }
    }

    async function runTrainSessions(onlySelected) {
      const runs = onlySelected
        ? (function () {
          const active = getActiveTrainSession();
          return active ? [active] : [];
        })()
        : state.trainSessions.slice();
      if (!runs.length) throw new Error("No trainer selected.");
      const ids = runs.map(function (s) { return String(s.id); });
      await runTrainSessionsByIds(ids);
    }

    _trainingActionRuntime.runSessionsByIds = runTrainSessionsByIds;

    if (ui.evalBtn) {
      ui.evalBtn.addEventListener("click", async function () {
        try {
          await runEvaluationFromCurrentGraph();
        } catch (err) {
          setStatus("Eval error: " + err.message);
          console.error(err);
        }
      });
    }

    refreshCurrentPresetLabel();
    resetLatentMonitorChart();
    updateModelLibraryLockUi();
    refreshTrainQueueActionButtons();

  }

  init();
})();

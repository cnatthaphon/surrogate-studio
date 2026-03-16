(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.SurrogateStudio = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function init(config) {
    var cfg = config || {};
    var mountEl = cfg.mountEl;
    if (!mountEl) throw new Error("SurrogateStudio.init: mountEl required");

    // resolve dependencies from globals
    var W = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {});
    var SchemaRegistry = cfg.schemaRegistry || W.OSCSchemaRegistry;
    var DatasetModules = cfg.datasetModules || W.OSCDatasetModules;
    var DatasetRuntime = cfg.datasetRuntime || W.OSCDatasetRuntime;
    var WorkspaceStore = cfg.workspaceStoreFactory || W.OSCWorkspaceStore;
    var AppStateCore = cfg.appStateCore || W.OSCAppStateCore;
    var LayoutRenderer = cfg.layoutRenderer || W.OSCLayoutRendererCore;
    var ModelGraphCore = cfg.modelGraphCore || W.OSCModelGraphCore;
    var DrawflowAdapter = cfg.drawflowAdapter || W.OSCModelGraphDrawflowAdapter;
    var TrainingEngine = cfg.trainingEngine || W.OSCTrainingEngineCore;
    var ModelBuilderCore = cfg.modelBuilder || W.OSCModelBuilderCore;
    var PredictionCore = cfg.predictionCore || W.OSCPredictionCore;
    var UiEngine = cfg.uiEngine || W.OSCUiSharedEngine;
    var ProcessingCore = cfg.processingCore || W.OSCDatasetProcessingCore;

    // tab controllers
    var PlaygroundTab = cfg.playgroundTab || W.OSCPlaygroundTab;
    var DatasetTab = cfg.datasetTab || W.OSCDatasetTab;
    var ModelTab = cfg.modelTab || W.OSCModelTab;
    var TrainerTab = cfg.trainerTab || W.OSCTrainerTab;
    var GenerationTab = cfg.generationTab || W.OSCGenerationTab;
    var EvaluationTab = cfg.evaluationTab || W.OSCEvaluationTab;

    // create store
    var store = cfg.store || (WorkspaceStore ? WorkspaceStore.createMemoryStore() : null);

    // determine default schema
    var defaultSchemaId = cfg.defaultSchemaId || "oscillator";

    // get schema list for layout
    var schemas = [];
    if (SchemaRegistry && typeof SchemaRegistry.listSchemas === "function") {
      schemas = SchemaRegistry.listSchemas();
    }

    // create state
    var stateApi = null;
    if (AppStateCore && typeof AppStateCore.create === "function") {
      stateApi = AppStateCore.create({ defaultSchemaId: defaultSchemaId, defaultTab: "playground" });
    }

    // render layout
    var layoutApi = null;
    if (LayoutRenderer && typeof LayoutRenderer.render === "function") {
      layoutApi = LayoutRenderer.render(mountEl, {
        schemas: schemas,
        defaultSchemaId: defaultSchemaId,
      });
    } else {
      throw new Error("OSCLayoutRendererCore not available");
    }

    var setStatus = layoutApi.setStatus;
    var escapeHtml = layoutApi.escapeHtml;
    var elHelper = layoutApi.el;
    var modal = layoutApi.modal;

    // create tab controllers
    var tabControllers = {};

    if (PlaygroundTab && layoutApi.tabs.playground) {
      tabControllers.playground = PlaygroundTab.create({
        layout: layoutApi.tabs.playground,
        stateApi: stateApi,
        schemaRegistry: SchemaRegistry,
        datasetModules: DatasetModules,
        datasetRuntime: DatasetRuntime,
        oscillatorCore: W.OSCOscillatorDatasetCore || null,
        imageRender: W.OSCImageRenderCore || null,
        escapeHtml: escapeHtml,
        el: elHelper,
      });
    }

    if (DatasetTab && layoutApi.tabs.dataset) {
      tabControllers.dataset = DatasetTab.create({
        layout: layoutApi.tabs.dataset,
        stateApi: stateApi,
        store: store,
        schemaRegistry: SchemaRegistry,
        datasetRuntime: DatasetRuntime,
        datasetModules: DatasetModules,
        processingCore: ProcessingCore,
        uiEngine: UiEngine,
        onStatus: setStatus,
        escapeHtml: escapeHtml,
        el: elHelper,
        modal: modal,
      });
    }

    if (ModelTab && layoutApi.tabs.model) {
      tabControllers.model = ModelTab.create({
        layout: layoutApi.tabs.model,
        stateApi: stateApi,
        store: store,
        schemaRegistry: SchemaRegistry,
        modelGraphCore: ModelGraphCore,
        drawflowAdapter: DrawflowAdapter,
        uiEngine: UiEngine,
        onStatus: setStatus,
        escapeHtml: escapeHtml,
        el: elHelper,
        modal: modal,
      });
    }

    if (TrainerTab && layoutApi.tabs.trainer) {
      tabControllers.trainer = TrainerTab.create({
        layout: layoutApi.tabs.trainer,
        stateApi: stateApi,
        store: store,
        schemaRegistry: SchemaRegistry,
        trainingEngine: TrainingEngine,
        modelBuilder: ModelBuilderCore,
        onStatus: setStatus,
        escapeHtml: escapeHtml,
        el: elHelper,
        modal: modal,
      });
    }

    if (GenerationTab && layoutApi.tabs.generation) {
      tabControllers.generation = GenerationTab.create({
        layout: layoutApi.tabs.generation,
        stateApi: stateApi,
        store: store,
        schemaRegistry: SchemaRegistry,
        modelBuilder: ModelBuilderCore,
        onStatus: setStatus,
        escapeHtml: escapeHtml,
        el: elHelper,
      });
    }

    if (EvaluationTab && layoutApi.tabs.evaluation) {
      tabControllers.evaluation = EvaluationTab.create({
        layout: layoutApi.tabs.evaluation,
        stateApi: stateApi,
        store: store,
        schemaRegistry: SchemaRegistry,
        predictionCore: PredictionCore,
        onStatus: setStatus,
        escapeHtml: escapeHtml,
        el: elHelper,
      });
    }

    // wire tab switching
    var _currentTab = null;
    layoutApi.onTabChange(function (tabId, prevTabId) {
      console.log("[studio] tab change:", prevTabId, "→", tabId, "controllers:", Object.keys(tabControllers));
      // unmount previous
      if (_currentTab && tabControllers[_currentTab] && typeof tabControllers[_currentTab].unmount === "function") {
        tabControllers[_currentTab].unmount();
      }
      _currentTab = tabId;
      // mount new
      if (tabControllers[tabId] && typeof tabControllers[tabId].mount === "function") {
        console.log("[studio] mounting", tabId);
        tabControllers[tabId].mount();
      } else {
        console.warn("[studio] no controller for tab:", tabId);
      }
      if (stateApi) stateApi.setActiveTab(tabId);
    });

    // schema changes are handled by individual tabs (e.g. playground left panel)

    // show default tab
    layoutApi.showTab("playground");

    // public API
    return {
      showTab: function (id) { layoutApi.showTab(id); },
      getState: function () { return stateApi; },
      getStore: function () { return store; },
      getLayout: function () { return layoutApi; },
      destroy: function () {
        Object.keys(tabControllers).forEach(function (k) {
          if (tabControllers[k] && typeof tabControllers[k].unmount === "function") tabControllers[k].unmount();
        });
        layoutApi.destroy();
      },
    };
  }

  return { init: init };
});

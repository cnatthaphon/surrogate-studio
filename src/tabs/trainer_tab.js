(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCTrainerTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(deps) {
    var layout = deps.layout;
    var stateApi = deps.stateApi;
    var store = deps.store;
    var schemaRegistry = deps.schemaRegistry;
    var trainingEngine = deps.trainingEngine;
    var modelBuilder = deps.modelBuilder;
    var uiEngine = deps.uiEngine;
    var modal = deps.modal;
    var onStatus = deps.onStatus || function () {};
    var el = deps.el || function (tag, a, c) {
      var e = document.createElement(tag);
      if (a) Object.keys(a).forEach(function (k) { if (k === "className") e.className = a[k]; else if (k === "textContent") e.textContent = a[k]; else e.setAttribute(k, a[k]); });
      if (c) (Array.isArray(c) ? c : [c]).forEach(function (ch) { if (typeof ch === "string") e.appendChild(document.createTextNode(ch)); else if (ch) e.appendChild(ch); });
      return e;
    };
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };
    var getTf = deps.getTf || function () { var W = typeof window !== "undefined" ? window : {}; return W.tf || null; };

    var _mountId = 0;
    var _configFormApi = null;
    var _isTraining = false;

    function _getSchemaId() { return stateApi ? stateApi.getActiveSchema() : ""; }
    function _listTrainers() { return store && typeof store.listTrainerCards === "function" ? store.listTrainerCards({}) : []; }
    function _listDatasets() { return store && typeof store.listDatasets === "function" ? store.listDatasets({ schemaId: _getSchemaId() }) : []; }
    function _listModels() { return store && typeof store.listModels === "function" ? store.listModels({ schemaId: _getSchemaId() }) : []; }

    // === LEFT ===
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Trainers"));

      var trainers = _listTrainers();
      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      var items = trainers.map(function (t) {
        var statusIcon = t.status === "done" ? "\u2713" : (t.status === "running" ? "\u23f3" : "");
        return {
          id: t.id, title: t.name || t.id, active: t.id === activeId,
          metaLines: [t.schemaId || "", statusIcon + (t.status || ""), t.createdAt ? new Date(t.createdAt).toLocaleTimeString() : ""].filter(Boolean),
          actions: [{ id: "delete", label: "\u2715" }],
        };
      });

      var listMount = el("div", {});
      leftEl.appendChild(listMount);
      if (uiEngine && typeof uiEngine.renderItemList === "function") {
        uiEngine.renderItemList({
          mountEl: listMount, items: items, emptyText: "No trainers. Click + New.",
          onOpen: function (id) { if (stateApi) stateApi.setActiveTrainer(id); _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); },
          onAction: function (id, act) {
            if (act === "delete") {
              if (confirm("Delete trainer?")) { if (store) store.removeTrainerCard(id); if (stateApi && stateApi.getActiveTrainer() === id) stateApi.setActiveTrainer(""); _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
            }
          },
        });
      }

      var newBtn = el("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "+ New Trainer");
      newBtn.addEventListener("click", function () { _openNewModal(); });
      leftEl.appendChild(newBtn);
    }

    function _openNewModal() {
      if (!modal) return;
      var _nameInput, _schemaSelect;
      modal.open({
        title: "New Training Session",
        renderForm: function (mount) {
          var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
          mount.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Name"));
          _nameInput = el("input", { type: "text", placeholder: "train_1", style: "width:100%;padding:6px 8px;margin-bottom:8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          mount.appendChild(_nameInput);
          mount.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Schema"));
          _schemaSelect = el("select", { style: "width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          (schemas).forEach(function (s) { var opt = el("option", { value: s.id }); opt.textContent = s.label || s.id; if (s.id === _getSchemaId()) opt.selected = true; _schemaSelect.appendChild(opt); });
          mount.appendChild(_schemaSelect);
          setTimeout(function () { _nameInput.focus(); }, 50);
        },
        onCreate: function () {
          var name = (_nameInput && _nameInput.value.trim()) || "";
          var sid = _schemaSelect ? _schemaSelect.value : "";
          if (!name) { onStatus("Enter a name"); return; }
          var id = "t_" + Date.now();
          if (store) store.upsertTrainerCard({ id: id, name: name, schemaId: sid, status: "draft", createdAt: Date.now() });
          if (stateApi) { stateApi.setActiveSchema(sid); stateApi.setActiveTrainer(id); }
          onStatus("Created: " + name);
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        },
      });
    }

    // === MIDDLE: session info + epoch log ===
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";
      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      if (!activeId) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Select or create a trainer.")); return; }
      var t = store ? store.getTrainerCard(activeId) : null;
      if (!t) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Not found.")); return; }

      var card = el("div", { className: "osc-card" });
      card.appendChild(el("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, t.name || t.id));
      card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;" },
        "Schema: " + escapeHtml(t.schemaId || "") + " | Status: " + (t.status || "draft") +
        (t.datasetId ? " | Dataset: " + t.datasetId : "") + (t.modelId ? " | Model: " + t.modelId : "")));

      if (t.metrics) {
        card.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;margin-top:4px;" },
          "MAE: " + (t.metrics.mae != null ? Number(t.metrics.mae).toExponential(3) : "—") +
          " | Test MAE: " + (t.metrics.testMae != null ? Number(t.metrics.testMae).toExponential(3) : "—") +
          " | Best epoch: " + (t.metrics.bestEpoch || "—")));
      }

      // epoch log
      var epochs = store && typeof store.getTrainerEpochs === "function" ? store.getTrainerEpochs(activeId) : [];
      if (epochs.length) {
        var table = el("table", { className: "osc-metric-table", style: "margin-top:8px;" });
        var thead = el("tr", {}); ["Epoch", "Loss", "Val Loss", "LR"].forEach(function (h) { thead.appendChild(el("th", {}, h)); });
        table.appendChild(thead);
        epochs.forEach(function (ep) {
          var tr = el("tr", {});
          tr.appendChild(el("td", {}, String(ep.epoch || "")));
          tr.appendChild(el("td", {}, ep.loss != null ? Number(ep.loss).toExponential(3) : "—"));
          tr.appendChild(el("td", {}, ep.val_loss != null ? Number(ep.val_loss).toExponential(3) : "—"));
          tr.appendChild(el("td", {}, ep.current_lr != null ? Number(ep.current_lr).toExponential(2) : "—"));
          table.appendChild(tr);
        });
        card.appendChild(table);
      }

      mainEl.appendChild(card);
    }

    // === RIGHT: training config ===
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      if (_configFormApi && typeof _configFormApi.destroy === "function") { _configFormApi.destroy(); _configFormApi = null; }

      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      if (!activeId) { rightEl.appendChild(el("h3", {}, "Config")); rightEl.appendChild(el("div", { className: "osc-empty" }, "Select a trainer.")); return; }

      rightEl.appendChild(el("h3", {}, "Training Config"));

      // dataset + model selectors
      var datasets = _listDatasets().filter(function (d) { return d.status === "ready"; });
      var models = _listModels();
      var optTypes = trainingEngine ? trainingEngine.OPTIMIZER_TYPES : ["adam", "sgd", "rmsprop", "adagrad"];
      var lrTypes = trainingEngine ? trainingEngine.LR_SCHEDULER_TYPES : ["plateau", "step", "exponential", "cosine", "none"];

      var formSchema = [
        { key: "datasetId", label: "Dataset", type: "select", options: datasets.map(function (d) { return { value: d.id, label: d.name || d.id }; }) },
        { key: "modelId", label: "Model", type: "select", options: models.map(function (m) { return { value: m.id, label: m.name || m.id }; }) },
        { key: "epochs", label: "Epochs", type: "number", value: 20, min: 1, max: 1000 },
        { key: "batchSize", label: "Batch size", type: "number", value: 32, min: 1 },
        { key: "learningRate", label: "Learning rate", type: "number", value: 0.001, min: 0.0000001, step: 0.0001 },
        { key: "optimizerType", label: "Optimizer", type: "select", options: optTypes.map(function (t) { return { value: t, label: t }; }) },
        { key: "lrSchedulerType", label: "LR scheduler", type: "select", options: lrTypes.map(function (t) { return { value: t, label: t }; }) },
        { key: "earlyStoppingPatience", label: "Early stop patience", type: "number", value: 5, min: 0 },
      ];

      if (uiEngine && typeof uiEngine.renderConfigForm === "function") {
        var formMount = el("div", {});
        _configFormApi = uiEngine.renderConfigForm({ mountEl: formMount, schema: formSchema, fieldNamePrefix: "train", rowClassName: "osc-form-row" });
        rightEl.appendChild(formMount);
      }

      var trainBtn = el("button", { className: "osc-btn", style: "width:100%;margin-top:8px;" }, "Start Training");
      trainBtn.addEventListener("click", function () { _handleTrain(); });
      rightEl.appendChild(trainBtn);
    }

    function _handleTrain() {
      if (_isTraining) { onStatus("Already training"); return; }
      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      var tCard = activeId && store ? store.getTrainerCard(activeId) : null;
      if (!tCard) { onStatus("Select a trainer"); return; }

      var config = _configFormApi && typeof _configFormApi.getConfig === "function" ? _configFormApi.getConfig() : {};
      if (!config.datasetId) { onStatus("Select a dataset"); return; }
      if (!config.modelId) { onStatus("Select a model"); return; }

      var dataset = store ? store.getDataset(config.datasetId) : null;
      var model = store ? store.getModel(config.modelId) : null;
      if (!dataset || !dataset.data) { onStatus("Dataset not ready"); return; }
      if (!model || !model.graph) { onStatus("Model has no graph"); return; }
      if (dataset.schemaId !== model.schemaId) { onStatus("Schema mismatch"); return; }

      var tf = getTf();
      if (!tf) { onStatus("TF.js not loaded"); return; }
      if (!modelBuilder) { onStatus("Model builder missing"); return; }
      if (!trainingEngine) { onStatus("Training engine missing"); return; }

      var schemaId = tCard.schemaId || _getSchemaId();
      var allowedOutputKeys = schemaRegistry ? (schemaRegistry.getOutputKeys(schemaId) || ["x"]) : ["x"];
      var defaultTarget = allowedOutputKeys.indexOf("x") >= 0 ? "x" : (allowedOutputKeys[0] || "x");
      var dsData = dataset.data;
      var graphMode = modelBuilder.inferGraphMode(model.graph, "direct");
      var featureSize = Number(dsData.featureSize || (dsData.xTrain && dsData.xTrain[0] && dsData.xTrain[0].length) || 1);

      var buildResult;
      try {
        buildResult = modelBuilder.buildModelFromGraph(tf, model.graph, {
          mode: graphMode, featureSize: featureSize,
          seqFeatureSize: Number(dsData.seqFeatureSize || featureSize),
          windowSize: Number(dsData.windowSize || 1),
          allowedOutputKeys: allowedOutputKeys, defaultTarget: defaultTarget,
          paramNames: dsData.paramNames, paramSize: dsData.paramSize, numClasses: dsData.numClasses || dsData.classCount || 10,
        });
      } catch (err) { onStatus("Build error: " + err.message); return; }

      // update trainer card
      tCard.datasetId = config.datasetId;
      tCard.modelId = config.modelId;
      tCard.status = "running";
      tCard.config = config;
      if (store) store.upsertTrainerCard(tCard);
      _isTraining = true;
      onStatus("Training...");
      _renderLeftPanel(); _renderMainPanel();

      var currentMountId = _mountId;
      trainingEngine.trainModel(tf, {
        model: buildResult.model, isSequence: buildResult.isSequence, headConfigs: buildResult.headConfigs,
        dataset: {
          xTrain: dsData.xTrain, yTrain: dsData.yTrain, seqTrain: dsData.seqTrain,
          xVal: dsData.xVal, yVal: dsData.yVal, seqVal: dsData.seqVal,
          xTest: dsData.xTest, yTest: dsData.yTest, seqTest: dsData.seqTest,
          pTrain: dsData.pTrain, pVal: dsData.pVal, pTest: dsData.pTest,
          targetMode: dsData.targetMode || defaultTarget,
          paramNames: dsData.paramNames, paramSize: dsData.paramSize, numClasses: dsData.numClasses || dsData.classCount,
        },
        epochs: Number(config.epochs || 20), batchSize: Number(config.batchSize || 32),
        learningRate: Number(config.learningRate || 0.001),
        optimizerType: String(config.optimizerType || "adam"),
        lrSchedulerType: String(config.lrSchedulerType || "plateau"),
        earlyStoppingPatience: Number(config.earlyStoppingPatience || 5),
        restoreBestWeights: true,
        onEpochEnd: function (epoch, logs) {
          if (currentMountId !== _mountId) return;
          if (store) store.appendTrainerEpoch(activeId, { epoch: epoch + 1, loss: logs.loss, val_loss: logs.val_loss, current_lr: logs.current_lr });
          _renderMainPanel(); // update epoch table
        },
      }).then(function (result) {
        _isTraining = false;
        if (currentMountId !== _mountId) return;
        tCard.status = "done";
        tCard.metrics = { mae: result.mae, testMae: result.testMae, mse: result.mse, testMse: result.testMse, bestEpoch: result.bestEpoch, bestValLoss: result.bestValLoss, finalLr: result.finalLr, stoppedEarly: result.stoppedEarly };
        if (store) store.upsertTrainerCard(tCard);
        onStatus("Done: MAE=" + (result.mae != null ? Number(result.mae).toExponential(3) : "—"));
        _renderLeftPanel(); _renderMainPanel();
      }).catch(function (err) {
        _isTraining = false;
        tCard.status = "error"; tCard.error = err.message;
        if (store) store.upsertTrainerCard(tCard);
        onStatus("Error: " + err.message);
        _renderLeftPanel(); _renderMainPanel();
      });
    }

    function mount() { _mountId++; _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
    function unmount() { _mountId++; if (_configFormApi && typeof _configFormApi.destroy === "function") _configFormApi.destroy(); _configFormApi = null; layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { mount(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

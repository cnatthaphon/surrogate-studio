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
    var trainingEngine = deps.trainingEngine;       // OSCTrainingEngineCore
    var modelBuilder = deps.modelBuilder;           // OSCModelBuilderCore
    var trainingWorkerBridge = deps.trainingWorkerBridge; // OSCTrainingWorkerBridge (optional)
    var onStatus = deps.onStatus || function () {};
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };
    var elFactory = deps.el || function (tag, attrs, children) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "className") e.className = attrs[k];
        else if (k === "textContent") e.textContent = attrs[k];
        else if (k === "innerHTML") e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
      if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
      return e;
    };

    var _configFormApi = null;
    var _isTraining = false;
    var _epochLogEl = null;

    function _getSchemaId() {
      return stateApi ? stateApi.getActiveSchema() : "";
    }

    function _listTrainers() {
      if (!store) return [];
      var schemaId = _getSchemaId();
      if (typeof store.listTrainerCards === "function") {
        return store.listTrainerCards({ schemaId: schemaId });
      }
      return [];
    }

    function _listDatasetsForSchema() {
      if (!store) return [];
      var schemaId = _getSchemaId();
      if (typeof store.listDatasets === "function") return store.listDatasets({ schemaId: schemaId });
      return [];
    }

    function _listModelsForSchema() {
      if (!store) return [];
      var schemaId = _getSchemaId();
      if (typeof store.listModels === "function") return store.listModels({ schemaId: schemaId });
      return [];
    }

    function _getDefaultTrainConfig() {
      return {
        epochs: 20,
        batchSize: 32,
        learningRate: 0.001,
        optimizerType: "adam",
        lrSchedulerType: "plateau",
        earlyStoppingPatience: 5,
        restoreBestWeights: true,
        gradClipNorm: 0,
        gradClipValue: 0,
      };
    }

    function _buildConfigFields() {
      var defaults = _getDefaultTrainConfig();
      var datasets = _listDatasetsForSchema();
      var models = _listModelsForSchema();

      var dsOptions = datasets.map(function (d) { return { value: d.id, label: d.name || d.id }; });
      var modelOptions = models.map(function (m) { return { value: m.id, label: m.name || m.id }; });

      var optimizerOptions = (trainingEngine && trainingEngine.OPTIMIZER_TYPES || ["adam", "sgd", "rmsprop", "adagrad"])
        .map(function (t) { return { value: t, label: t }; });
      var lrOptions = (trainingEngine && trainingEngine.LR_SCHEDULER_TYPES || ["plateau", "step", "exponential", "cosine", "none"])
        .map(function (t) { return { value: t, label: t }; });

      return [
        { kind: "select", key: "datasetId", label: "Dataset", options: dsOptions, value: "" },
        { kind: "select", key: "modelId", label: "Model", options: modelOptions, value: "" },
        { kind: "number", key: "epochs", label: "Epochs", value: defaults.epochs, min: 1, max: 1000 },
        { kind: "number", key: "batchSize", label: "Batch size", value: defaults.batchSize, min: 1, max: 4096 },
        { kind: "number", key: "learningRate", label: "Learning rate", value: defaults.learningRate, min: 1e-8, max: 1, step: 0.0001 },
        { kind: "select", key: "optimizerType", label: "Optimizer", options: optimizerOptions, value: defaults.optimizerType },
        { kind: "select", key: "lrSchedulerType", label: "LR scheduler", options: lrOptions, value: defaults.lrSchedulerType },
        { kind: "number", key: "earlyStoppingPatience", label: "Early stop patience", value: defaults.earlyStoppingPatience, min: 0, max: 100 },
      ];
    }

    // --- render ---

    function _renderLeftPanel() {
      var el = layout.leftEl;
      el.innerHTML = "";
      el.appendChild(elFactory("h3", {}, "Training Sessions"));

      var trainers = _listTrainers();
      var activeId = stateApi ? stateApi.getActiveTrainer() : "";

      if (!trainers.length) {
        el.appendChild(elFactory("div", { className: "osc-empty" }, "No training sessions yet. Configure and start training."));
      } else {
        var list = elFactory("ul", { className: "osc-item-list" });
        trainers.forEach(function (t) {
          var li = elFactory("li", {
            "data-id": t.id,
            className: t.id === activeId ? "active" : "",
          });
          li.appendChild(elFactory("strong", {}, t.name || t.id));
          var meta = elFactory("div", { style: "font-size:11px;color:#64748b;" });
          meta.textContent = (t.status || "idle") + " | " + (t.schemaId || "");
          li.appendChild(meta);
          li.addEventListener("click", function () {
            if (stateApi) stateApi.setActiveTrainer(t.id);
            _renderLeftPanel();
            _renderMainPanel();
          });
          list.appendChild(li);
        });
        el.appendChild(list);
      }
    }

    function _renderMainPanel() {
      var el = layout.mainEl;
      el.innerHTML = "";

      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      if (activeId) {
        var trainer = store ? store.getTrainerCard(activeId) : null;
        if (!trainer) {
          el.appendChild(elFactory("div", { className: "osc-empty" }, "Session not found"));
          return;
        }

        var card = elFactory("div", { className: "osc-card" });
        card.appendChild(elFactory("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, trainer.name || trainer.id));
        card.appendChild(elFactory("div", { style: "font-size:12px;color:#cbd5e1;margin-bottom:8px;" },
          "Schema: " + escapeHtml(trainer.schemaId || "") +
          " | Dataset: " + escapeHtml(trainer.datasetId || "—") +
          " | Model: " + escapeHtml(trainer.modelId || "—") +
          " | Status: " + escapeHtml(trainer.status || "idle")));

        // metrics summary
        if (trainer.metrics) {
          var mDiv = elFactory("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:8px;" });
          mDiv.innerHTML = "<strong>Val MAE:</strong> " + (trainer.metrics.mae != null ? Number(trainer.metrics.mae).toExponential(3) : "—") +
            " | <strong>Test MAE:</strong> " + (trainer.metrics.testMae != null ? Number(trainer.metrics.testMae).toExponential(3) : "—") +
            " | <strong>Best epoch:</strong> " + (trainer.metrics.bestEpoch || "—");
          card.appendChild(mDiv);
        }

        // epoch log
        var epochs = (store && typeof store.getTrainerEpochs === "function") ? store.getTrainerEpochs(activeId) : [];
        if (epochs.length) {
          var table = elFactory("table", { className: "osc-metric-table" });
          var thead = elFactory("tr", {});
          ["Epoch", "Loss", "Val Loss", "LR"].forEach(function (h) {
            thead.appendChild(elFactory("th", {}, h));
          });
          table.appendChild(thead);
          epochs.forEach(function (ep) {
            var tr = elFactory("tr", {});
            tr.appendChild(elFactory("td", {}, String(ep.epoch || "")));
            tr.appendChild(elFactory("td", {}, ep.loss != null ? Number(ep.loss).toExponential(3) : "—"));
            tr.appendChild(elFactory("td", {}, ep.val_loss != null ? Number(ep.val_loss).toExponential(3) : "—"));
            tr.appendChild(elFactory("td", {}, ep.current_lr != null ? Number(ep.current_lr).toExponential(2) : "—"));
            table.appendChild(tr);
          });
          card.appendChild(table);
        }

        // chart mount point
        var chartMount = elFactory("div", { id: "trainer-chart-mount", style: "margin-top:12px;height:250px;" });
        card.appendChild(chartMount);

        el.appendChild(card);
      } else {
        var card = elFactory("div", { className: "osc-card" });
        card.appendChild(elFactory("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, "New Training Session"));
        card.appendChild(elFactory("p", { style: "color:#94a3b8;font-size:13px;" },
          "Select a dataset and model from the same schema, configure hyperparameters, then start training."));

        _epochLogEl = elFactory("div", { id: "epoch-log", style: "margin-top:12px;font-size:12px;color:#94a3b8;max-height:200px;overflow-y:auto;" });
        card.appendChild(_epochLogEl);
        el.appendChild(card);
      }
    }

    function _renderRightPanel() {
      var el = layout.rightEl;
      el.innerHTML = "";
      el.appendChild(elFactory("h3", {}, "Training Config"));

      var fields = _buildConfigFields();
      var formCard = elFactory("div", { className: "osc-card" });
      fields.forEach(function (field) {
        var row = elFactory("div", { className: "osc-form-row" });
        row.appendChild(elFactory("label", {}, field.label || field.key));
        var input;
        if (field.kind === "select" && Array.isArray(field.options)) {
          input = elFactory("select", { "data-key": field.key });
          field.options.forEach(function (opt) {
            var o = elFactory("option", { value: opt.value });
            o.textContent = opt.label || opt.value;
            if (String(opt.value) === String(field.value)) o.selected = true;
            input.appendChild(o);
          });
        } else {
          input = elFactory("input", {
            type: field.kind === "number" ? "number" : "text",
            value: String(field.value != null ? field.value : ""),
            "data-key": field.key,
          });
          if (field.min != null) input.setAttribute("min", field.min);
          if (field.max != null) input.setAttribute("max", field.max);
          if (field.step != null) input.setAttribute("step", field.step);
        }
        row.appendChild(input);
        formCard.appendChild(row);
      });
      el.appendChild(formCard);

      // train button
      var trainBtn = elFactory("button", {
        className: "osc-btn",
        style: "margin-top:8px;width:100%;",
      }, "Start Training");
      trainBtn.addEventListener("click", function () { _handleTrain(); });
      el.appendChild(trainBtn);

      // export notebook button
      var exportBtn = elFactory("button", {
        className: "osc-btn secondary",
        style: "margin-top:4px;width:100%;",
      }, "Export Notebook");
      exportBtn.addEventListener("click", function () { _handleExport(); });
      el.appendChild(exportBtn);
    }

    function _collectConfig() {
      var config = {};
      var inputs = layout.rightEl.querySelectorAll("input[data-key], select[data-key]");
      inputs.forEach(function (inp) {
        var key = inp.getAttribute("data-key");
        var val = inp.type === "number" ? Number(inp.value) : inp.value;
        config[key] = val;
      });
      return config;
    }

    function _handleTrain() {
      if (_isTraining) { onStatus("Training already in progress"); return; }
      var config = _collectConfig();
      var schemaId = _getSchemaId();

      if (!config.datasetId) { onStatus("Select a dataset first"); return; }
      if (!config.modelId) { onStatus("Select a model first"); return; }

      // verify same schema
      var dataset = store ? store.getDataset(config.datasetId) : null;
      var model = store ? store.getModel(config.modelId) : null;
      if (!dataset) { onStatus("Dataset not found"); return; }
      if (!model) { onStatus("Model not found"); return; }
      if (dataset.schemaId !== model.schemaId) {
        onStatus("Schema mismatch: dataset=" + dataset.schemaId + " model=" + model.schemaId);
        return;
      }

      // create trainer card
      var trainerId = "t_" + Date.now();
      var trainerCard = {
        id: trainerId,
        name: schemaId + "_train_" + trainerId,
        schemaId: schemaId,
        datasetId: config.datasetId,
        modelId: config.modelId,
        config: config,
        status: "running",
        createdAt: Date.now(),
      };
      if (store) store.upsertTrainerCard(trainerCard);
      if (stateApi) stateApi.setActiveTrainer(trainerId);

      _isTraining = true;
      onStatus("Training started: " + trainerId);
      _renderLeftPanel();
      _renderMainPanel();

      // epoch callback
      var onEpochEnd = function (epoch, logs) {
        if (store) store.appendTrainerEpoch(trainerId, {
          epoch: epoch + 1,
          loss: logs.loss,
          val_loss: logs.val_loss,
          current_lr: logs.current_lr,
        });
        if (_epochLogEl) {
          var line = document.createElement("div");
          line.textContent = "Epoch " + (epoch + 1) + ": loss=" +
            (logs.loss != null ? Number(logs.loss).toExponential(3) : "—") +
            " val_loss=" + (logs.val_loss != null ? Number(logs.val_loss).toExponential(3) : "—");
          _epochLogEl.appendChild(line);
          _epochLogEl.scrollTop = _epochLogEl.scrollHeight;
        }
      };

      // Note: actual training would happen here via trainingEngine.trainModel(tf, {...})
      // or via trainingWorkerBridge for off-main-thread execution
      // The full wiring happens in surrogate_studio.js orchestrator
      onStatus("Training session created. Wiring to runtime pending in orchestrator.");
      _isTraining = false;
    }

    function _handleExport() {
      onStatus("Notebook export: pending orchestrator wiring");
    }

    function mount() {
      _renderLeftPanel();
      _renderMainPanel();
      _renderRightPanel();
    }

    function unmount() {
      _configFormApi = null;
      _epochLogEl = null;
      layout.leftEl.innerHTML = "";
      layout.mainEl.innerHTML = "";
      layout.rightEl.innerHTML = "";
    }

    function refresh() {
      _renderLeftPanel();
      _renderMainPanel();
      _renderRightPanel();
    }

    return {
      mount: mount,
      unmount: unmount,
      refresh: refresh,
    };
  }

  return { create: create };
});

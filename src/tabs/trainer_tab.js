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
    var getTf = function () { var W = typeof window !== "undefined" ? window : {}; return W.tf || null; };

    var _mountId = 0;
    var _configFormApi = null;
    var _isTraining = false;
    var _lossChartDiv = null;
    var _epochLogEl = null;
    var _subTab = "train"; // "train" | "test"

    function _getSchemaId() {
      var aid = stateApi ? stateApi.getActiveTrainer() : "";
      if (aid && store) { var t = store.getTrainerCard(aid); if (t && t.schemaId) return t.schemaId; }
      return stateApi ? stateApi.getActiveSchema() : "";
    }
    function _listTrainers() { return store && typeof store.listTrainerCards === "function" ? store.listTrainerCards({}) : []; }
    function _listDatasets(schemaId) { return store && typeof store.listDatasets === "function" ? store.listDatasets({}).filter(function (d) { return d.status === "ready" && (!schemaId || d.schemaId === schemaId); }) : []; }
    function _listModels(schemaId) { return store && typeof store.listModels === "function" ? store.listModels({}).filter(function (m) { return !schemaId || m.schemaId === schemaId; }) : []; }

    // detect available backends
    function _getAvailableBackends() {
      var backends = [{ value: "auto", label: "Auto" }, { value: "cpu", label: "CPU" }];
      var tf = getTf();
      if (tf) {
        try { if (typeof tf.setBackend === "function") { backends.push({ value: "webgl", label: "WebGL (GPU)" }); } } catch (e) {}
        try { backends.push({ value: "wasm", label: "WASM" }); } catch (e) {}
      }
      return backends;
    }

    // === LEFT ===
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Trainers"));

      var trainers = _listTrainers();
      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      var items = trainers.map(function (t) {
        var icon = t.status === "done" ? "\u2713 " : (t.status === "running" ? "\u23f3 " : "");
        return {
          id: t.id, title: t.name || t.id, active: t.id === activeId,
          metaLines: [t.schemaId || "", icon + (t.status || "draft")].filter(Boolean),
          actions: [{ id: "rename", label: "\u270e" }, { id: "delete", label: "\u2715" }],
        };
      });

      var listMount = el("div", {});
      leftEl.appendChild(listMount);
      if (uiEngine && typeof uiEngine.renderItemList === "function") {
        uiEngine.renderItemList({
          mountEl: listMount, items: items, emptyText: "No trainers.",
          onOpen: function (id) {
            if (stateApi) stateApi.setActiveTrainer(id);
            _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          },
          onAction: function (id, act) {
            if (act === "rename") {
              var t = store ? store.getTrainerCard(id) : null;
              if (!t) return;
              var name = prompt("Rename:", t.name || t.id);
              if (name && name.trim()) { t.name = name.trim(); store.upsertTrainerCard(t); _renderLeftPanel(); }
            } else if (act === "delete" && confirm("Delete?")) {
              if (store) store.removeTrainerCard(id);
              if (stateApi && stateApi.getActiveTrainer() === id) stateApi.setActiveTrainer("");
              _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
            }
          },
        });
      }

      var newBtn = el("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "+ New Trainer");
      newBtn.addEventListener("click", _openNewModal);
      leftEl.appendChild(newBtn);
    }

    function _openNewModal() {
      if (!modal) return;
      var _ni, _ss;
      modal.open({
        title: "New Training Session",
        renderForm: function (m) {
          var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
          m.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Name"));
          _ni = el("input", { type: "text", placeholder: "train_1", style: "width:100%;padding:6px 8px;margin-bottom:8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          m.appendChild(_ni);
          m.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Schema"));
          _ss = el("select", { style: "width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          schemas.forEach(function (s) { var o = el("option", { value: s.id }); o.textContent = s.label || s.id; if (s.id === _getSchemaId()) o.selected = true; _ss.appendChild(o); });
          m.appendChild(_ss);
          setTimeout(function () { _ni.focus(); }, 50);
        },
        onCreate: function () {
          var name = (_ni && _ni.value.trim()) || "";
          var sid = _ss ? _ss.value : "";
          if (!name) { onStatus("Enter a name"); return; }
          var id = "t_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
          console.log("[trainer_tab] creating:", id, name, sid);
          if (store) store.upsertTrainerCard({ id: id, name: name, schemaId: sid, status: "draft", createdAt: Date.now() });
          if (stateApi) { stateApi.setActiveSchema(sid); stateApi.setActiveTrainer(id); }
          onStatus("Created: " + name);
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        },
      });
    }

    // === MIDDLE: train/test sub-tabs ===
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";
      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      if (!activeId) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Select or create a trainer.")); return; }
      var t = store ? store.getTrainerCard(activeId) : null;
      if (!t) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Not found.")); return; }

      // header
      var header = el("div", { className: "osc-card", style: "margin-bottom:8px;" });
      header.appendChild(el("h3", { style: "color:#67e8f9;margin:0 0 4px;" }, t.name || t.id));
      header.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;" },
        "Schema: " + escapeHtml(t.schemaId || "") + " | Status: " + (t.status || "draft") +
        (t.datasetId ? " | Dataset: " + (function () { var d = store.getDataset(t.datasetId); return d ? d.name : t.datasetId; })() : "") +
        (t.modelId ? " | Model: " + (function () { var m = store.getModel(t.modelId); return m ? m.name : t.modelId; })() : "")));
      if (t.metrics) {
        header.appendChild(el("div", { style: "font-size:12px;color:#4ade80;margin-top:4px;" },
          "MAE: " + (t.metrics.mae != null ? Number(t.metrics.mae).toExponential(3) : "—") +
          " | Test MAE: " + (t.metrics.testMae != null ? Number(t.metrics.testMae).toExponential(3) : "—") +
          " | Best epoch: " + (t.metrics.bestEpoch || "—")));
      }
      mainEl.appendChild(header);

      // sub-tabs
      var tabBar = el("div", { style: "display:flex;gap:4px;margin-bottom:8px;" });
      ["train", "test"].forEach(function (tabId) {
        var btn = el("button", {
          style: "padding:4px 12px;font-size:12px;border-radius:6px;cursor:pointer;border:1px solid " +
            (_subTab === tabId ? "#0ea5e9" : "#334155") + ";background:" +
            (_subTab === tabId ? "#0c2340" : "#1f2937") + ";color:" +
            (_subTab === tabId ? "#67e8f9" : "#cbd5e1") + ";",
        }, tabId.charAt(0).toUpperCase() + tabId.slice(1));
        btn.addEventListener("click", function () { _subTab = tabId; _renderMainPanel(); });
        tabBar.appendChild(btn);
      });
      mainEl.appendChild(tabBar);

      if (_subTab === "train") {
        _renderTrainSubTab(mainEl, t, activeId);
      } else {
        _renderTestSubTab(mainEl, t, activeId);
      }
    }

    function _renderTrainSubTab(mainEl, t, activeId) {
      // loss chart — always show (empty or with data)
      _lossChartDiv = el("div", { style: "height:280px;margin-bottom:8px;" });
      mainEl.appendChild(_lossChartDiv);

      var epochs = store && typeof store.getTrainerEpochs === "function" ? store.getTrainerEpochs(activeId) : [];
      if (epochs.length) {
        _plotLossChart(epochs);
      } else {
        // empty chart placeholder
        var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
        if (Plotly) {
          Plotly.newPlot(_lossChartDiv, [], {
            paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
            title: { text: "Training Progress (waiting...)", font: { size: 12 } },
            xaxis: { title: "Epoch", gridcolor: "#1e293b" }, yaxis: { title: "Loss", gridcolor: "#1e293b" },
            margin: { t: 30, b: 50, l: 50, r: 10 },
          }, { responsive: true });
        }
      }

      // epoch table — always show header
      var table = el("table", { className: "osc-metric-table" });
      var thead = el("tr", {});
      ["Epoch", "Loss", "Val Loss", "LR", "Improved"].forEach(function (h) { thead.appendChild(el("th", {}, h)); });
      table.appendChild(thead);
      epochs.forEach(function (ep) {
        var tr = el("tr", {});
        tr.appendChild(el("td", {}, String(ep.epoch || "")));
        tr.appendChild(el("td", {}, ep.loss != null ? Number(ep.loss).toExponential(3) : "—"));
        tr.appendChild(el("td", {}, ep.val_loss != null ? Number(ep.val_loss).toExponential(3) : "—"));
        tr.appendChild(el("td", {}, ep.current_lr != null ? Number(ep.current_lr).toExponential(2) : "—"));
        tr.appendChild(el("td", {}, ep.improved ? "\u2713" : ""));
        table.appendChild(tr);
      });
      if (!epochs.length) {
        var emptyRow = el("tr", {});
        emptyRow.appendChild(el("td", { style: "color:#64748b;text-align:center;" }, "—"));
        emptyRow.setAttribute("colspan", "5");
        table.appendChild(emptyRow);
      }
      mainEl.appendChild(table);

      // live log
      _epochLogEl = el("div", { style: "margin-top:8px;font-size:11px;color:#94a3b8;max-height:150px;overflow-y:auto;" });
      if (t.status === "running") _epochLogEl.appendChild(el("div", {}, "Training in progress..."));
      mainEl.appendChild(_epochLogEl);
    }

    function _renderTestSubTab(mainEl, t, activeId) {
      // metrics table — always show with placeholder
      var card = el("div", { className: "osc-card" });
      card.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Test Results"));

      var m = t.metrics || {};
      var rows = [
        ["Val MSE", m.mse != null ? Number(m.mse).toExponential(3) : "—"],
        ["Val MAE", m.mae != null ? Number(m.mae).toExponential(3) : "—"],
        ["Test MSE", m.testMse != null ? Number(m.testMse).toExponential(3) : "—"],
        ["Test MAE", m.testMae != null ? Number(m.testMae).toExponential(3) : "—"],
        ["Best Epoch", m.bestEpoch || "—"],
        ["Best Val Loss", m.bestValLoss != null ? Number(m.bestValLoss).toExponential(3) : "—"],
        ["Final LR", m.finalLr != null ? Number(m.finalLr).toExponential(3) : "—"],
        ["Stopped Early", m.stoppedEarly ? "Yes" : "No"],
        ["Head Count", m.headCount || "—"],
      ];
      var table = el("table", { className: "osc-metric-table" });
      rows.forEach(function (r) {
        var tr = el("tr", {});
        tr.appendChild(el("td", { style: "color:#94a3b8;" }, r[0]));
        tr.appendChild(el("td", { style: r[1] !== "—" ? "color:#4ade80;" : "" }, r[1]));
        table.appendChild(tr);
      });
      card.appendChild(table);
      mainEl.appendChild(card);

      if (!t.metrics) {
        mainEl.appendChild(el("div", { style: "font-size:12px;color:#64748b;padding:8px;" }, "Train first to see test results and predictions."));
        return;
      }

      // pred vs ground truth chart placeholder
      var predCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
      predCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Prediction vs Ground Truth"));
      var predChartDiv = el("div", { style: "height:280px;" });
      predCard.appendChild(predChartDiv);
      mainEl.appendChild(predCard);

      // TODO: actual pred vs truth chart requires running inference on test set
      // For now show summary
      var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
      if (Plotly) {
        var epochs = store && typeof store.getTrainerEpochs === "function" ? store.getTrainerEpochs(activeId) : [];
        if (epochs.length) {
          var trainLoss = epochs.map(function (e) { return e.loss; });
          var valLoss = epochs.map(function (e) { return e.val_loss; });
          var ep = epochs.map(function (e) { return e.epoch; });
          Plotly.newPlot(predChartDiv, [
            { x: ep, y: trainLoss, mode: "lines+markers", name: "Train Loss", line: { color: "#22d3ee" } },
            { x: ep, y: valLoss, mode: "lines+markers", name: "Val Loss", line: { color: "#f59e0b" } },
          ], {
            paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
            title: { text: "Final Training Curves", font: { size: 12 } },
            xaxis: { title: "Epoch", gridcolor: "#1e293b" }, yaxis: { title: "Loss", gridcolor: "#1e293b" },
            legend: { orientation: "h", y: -0.15 },
            margin: { t: 30, b: 50, l: 50, r: 10 },
          }, { responsive: true });
        }
      }
    }

    function _plotLossChart(epochs) {
      var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
      if (!Plotly || !_lossChartDiv || !epochs.length) return;
      var ep = epochs.map(function (e) { return e.epoch; });
      var loss = epochs.map(function (e) { return e.loss; });
      var valLoss = epochs.map(function (e) { return e.val_loss; });
      Plotly.newPlot(_lossChartDiv, [
        { x: ep, y: loss, mode: "lines", name: "Train Loss", line: { color: "#22d3ee" } },
        { x: ep, y: valLoss, mode: "lines", name: "Val Loss", line: { color: "#f59e0b" } },
      ], {
        paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
        title: { text: "Training Progress", font: { size: 12 } },
        xaxis: { title: "Epoch", gridcolor: "#1e293b" }, yaxis: { title: "Loss", gridcolor: "#1e293b" },
        legend: { orientation: "h", y: -0.15 },
        margin: { t: 30, b: 50, l: 50, r: 10 },
      }, { responsive: true });
    }

    // === RIGHT: training config ===
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      if (_configFormApi && typeof _configFormApi.destroy === "function") { _configFormApi.destroy(); _configFormApi = null; }

      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      if (!activeId) { rightEl.appendChild(el("h3", {}, "Config")); rightEl.appendChild(el("div", { className: "osc-empty" }, "Select a trainer.")); return; }
      var t = store ? store.getTrainerCard(activeId) : null;
      if (!t) return;

      var hasTrained = t.status === "done" || t.status === "error" || (store.getTrainerEpochs(activeId) || []).length > 0;
      var isLocked = hasTrained && t.datasetId && t.modelId;

      rightEl.appendChild(el("h3", {}, hasTrained ? "Continue Training" : "Training Config"));

      if (isLocked) {
        var lockInfo = el("div", { style: "font-size:10px;color:#f59e0b;margin-bottom:6px;padding:4px 6px;border:1px solid #7c2d12;border-radius:4px;background:#431407;" });
        lockInfo.textContent = "Dataset + Model locked after training. Clear session to change.";
        rightEl.appendChild(lockInfo);
      }

      // dataset + model selection (same schema)
      var schemaId = t.schemaId || _getSchemaId();
      var datasets = _listDatasets(schemaId);
      var models = _listModels(schemaId);
      var backends = _getAvailableBackends();
      var optTypes = trainingEngine ? trainingEngine.OPTIMIZER_TYPES : ["adam", "sgd", "rmsprop", "adagrad"];
      var lrTypes = trainingEngine ? trainingEngine.LR_SCHEDULER_TYPES : ["plateau", "step", "exponential", "cosine", "none"];

      var formSchema = [
        { key: "datasetId", label: "Dataset (" + schemaId + ")", type: "select", options: datasets.map(function (d) { return { value: d.id, label: d.name || d.id }; }), disabled: isLocked },
        { key: "modelId", label: "Model (" + schemaId + ")", type: "select", options: models.map(function (m) { return { value: m.id, label: m.name || m.id }; }), disabled: isLocked },
        { key: "runtimeBackend", label: "Backend", type: "select", options: backends },
        { key: "epochs", label: "Epochs", type: "number", min: 1, max: 1000 },
        { key: "batchSize", label: "Batch size", type: "number", min: 1 },
        { key: "learningRate", label: "Learning rate", type: "number", min: 0.0000001, step: 0.0001 },
        { key: "optimizerType", label: "Optimizer", type: "select", options: optTypes.map(function (t) { return { value: t, label: t }; }) },
        { key: "lrSchedulerType", label: "LR scheduler", type: "select", options: lrTypes.map(function (t) { return { value: t, label: t }; }) },
        { key: "earlyStoppingPatience", label: "Early stop patience", type: "number", min: 0 },
        { key: "restoreBestWeights", label: "Restore best weights", type: "checkbox" },
        { key: "lrPatience", label: "LR patience", type: "number", min: 1 },
        { key: "lrFactor", label: "LR factor", type: "number", min: 0.05, max: 0.99, step: 0.05 },
        { key: "minLr", label: "Min LR", type: "number", min: 0.0000001, step: 0.0000001 },
        { key: "gradClipNorm", label: "Grad clip norm (0=off)", type: "number", min: 0, step: 0.1 },
        { key: "gradClipValue", label: "Grad clip value (0=off)", type: "number", min: 0, step: 0.1 },
      ];
      var formValue = {
        datasetId: t.datasetId || "", modelId: t.modelId || "",
        runtimeBackend: "auto", epochs: 20, batchSize: 32, learningRate: 0.001,
        optimizerType: "adam", lrSchedulerType: "plateau", earlyStoppingPatience: 5,
        restoreBestWeights: true, lrPatience: 3, lrFactor: 0.5, minLr: 0.000001,
        gradClipNorm: 0, gradClipValue: 0,
      };

      if (uiEngine && typeof uiEngine.renderConfigForm === "function") {
        var formMount = el("div", {});
        _configFormApi = uiEngine.renderConfigForm({ mountEl: formMount, schema: formSchema, value: formValue, fieldNamePrefix: "train", rowClassName: "osc-form-row" });
        rightEl.appendChild(formMount);
      }

      // buttons
      var btnRow = el("div", { style: "display:flex;gap:4px;margin-top:8px;" });
      var trainLabel = hasTrained ? "Continue Training" : "Start Training";
      var trainBtn = el("button", { className: "osc-btn", style: "flex:1;" }, trainLabel);
      trainBtn.addEventListener("click", _handleTrain);
      var exportBtn = el("button", { className: "osc-btn secondary", style: "flex:1;" }, "Export Notebook");
      exportBtn.addEventListener("click", function () { _handleExport(); });
      btnRow.appendChild(trainBtn); btnRow.appendChild(exportBtn);
      rightEl.appendChild(btnRow);

      // clear session button
      if (hasTrained) {
        var clearBtn = el("button", { className: "osc-btn secondary", style: "width:100%;margin-top:4px;border-color:#7c2d12;color:#fdba74;" }, "Clear Session (reset training)");
        clearBtn.addEventListener("click", function () {
          if (!confirm("Clear training history and unlock dataset/model?")) return;
          t.status = "draft";
          t.metrics = null;
          t.datasetId = "";
          t.modelId = "";
          t.modelArtifacts = null;
          if (store) { store.upsertTrainerCard(t); store.replaceTrainerEpochs(activeId, []); }
          onStatus("Session cleared");
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        });
        rightEl.appendChild(clearBtn);
      }

      // info
      rightEl.appendChild(el("div", { style: "margin-top:12px;font-size:10px;color:#64748b;" },
        "Backend: Auto tries WebGPU \u2192 WebGL \u2192 WASM \u2192 CPU. " +
        "file:// uses main-thread fallback (may freeze). Use local server for Worker."));
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
      if (!dataset || !dataset.data) { onStatus("Dataset not ready — generate first"); return; }
      if (!model || !model.graph) { onStatus("Model has no graph — save from Model tab first"); return; }
      if (dataset.schemaId !== model.schemaId) { onStatus("Schema mismatch: " + dataset.schemaId + " vs " + model.schemaId); return; }

      var tf = getTf();
      if (!tf) { onStatus("TF.js not loaded"); return; }
      if (!modelBuilder) { onStatus("Model builder not available"); return; }
      if (!trainingEngine) { onStatus("Training engine not available"); return; }

      // set backend
      var backend = String(config.runtimeBackend || "auto");
      if (backend !== "auto" && typeof tf.setBackend === "function") {
        try { tf.setBackend(backend); } catch (e) { console.warn("Backend set failed:", e.message); }
      }

      var schemaId = tCard.schemaId;
      var allowedOutputKeys = schemaRegistry ? schemaRegistry.getOutputKeys(schemaId) : ["x"];
      var defaultTarget = allowedOutputKeys[0] || "x";
      var dsData = dataset.data;
      // handle bundle format
      var isBundle = dsData.kind === "dataset_bundle" && dsData.datasets;
      var activeDs = isBundle ? dsData.datasets[dsData.activeVariantId || Object.keys(dsData.datasets)[0]] : dsData;
      // normalize dataset format: MNIST uses records.{train,val,test}.{x,y}, oscillator uses xTrain/yTrain
      if (!activeDs.xTrain && activeDs.records) {
        var nClasses = activeDs.classCount || 10;
        function oneHot(label, n) { var arr = new Array(n).fill(0); arr[label] = 1; return arr; }
        var isClassification = defaultTarget === "label" || defaultTarget === "logits";
        activeDs = {
          xTrain: (activeDs.records.train && activeDs.records.train.x) || [],
          yTrain: isClassification ? ((activeDs.records.train && activeDs.records.train.y) || []).map(function (l) { return oneHot(l, nClasses); }) : ((activeDs.records.train && activeDs.records.train.y) || []),
          xVal: (activeDs.records.val && activeDs.records.val.x) || [],
          yVal: isClassification ? ((activeDs.records.val && activeDs.records.val.y) || []).map(function (l) { return oneHot(l, nClasses); }) : ((activeDs.records.val && activeDs.records.val.y) || []),
          xTest: (activeDs.records.test && activeDs.records.test.x) || [],
          yTest: isClassification ? ((activeDs.records.test && activeDs.records.test.y) || []).map(function (l) { return oneHot(l, nClasses); }) : ((activeDs.records.test && activeDs.records.test.y) || []),
          featureSize: activeDs.xTrain ? undefined : ((activeDs.records.train && activeDs.records.train.x && activeDs.records.train.x[0]) ? activeDs.records.train.x[0].length : 784),
          numClasses: nClasses,
          targetMode: isClassification ? "logits" : (activeDs.targetMode || defaultTarget),
        };
      }

      var graphMode = modelBuilder.inferGraphMode(model.graph, "direct");
      var featureSize = Number(activeDs.featureSize || (activeDs.xTrain && activeDs.xTrain[0] && activeDs.xTrain[0].length) || 1);

      var buildResult;
      try {
        buildResult = modelBuilder.buildModelFromGraph(tf, model.graph, {
          mode: graphMode, featureSize: featureSize,
          seqFeatureSize: Number(activeDs.seqFeatureSize || featureSize),
          windowSize: Number(activeDs.windowSize || 1),
          allowedOutputKeys: allowedOutputKeys, defaultTarget: defaultTarget,
          paramNames: activeDs.paramNames, paramSize: activeDs.paramSize, numClasses: activeDs.numClasses || activeDs.classCount || 10,
        });
      } catch (err) { onStatus("Build error: " + err.message); return; }

      // update trainer
      tCard.datasetId = config.datasetId;
      tCard.modelId = config.modelId;
      tCard.status = "running";
      tCard.config = config;
      if (store) { store.upsertTrainerCard(tCard); store.replaceTrainerEpochs(activeId, []); }
      _isTraining = true;
      _subTab = "train";
      onStatus("Training... (serializing model)");
      _renderLeftPanel(); _renderMainPanel();

      var currentMountId = _mountId;

      // serialize model to artifacts for worker
      var W = typeof window !== "undefined" ? window : {};
      var workerBridge = W.OSCTrainingWorkerBridge;

      var useWorker = workerBridge && typeof workerBridge.runTrainingInWorker === "function";
      // test if Worker is available (file:// blocks Workers)
      if (useWorker) {
        try { var _tw = new Worker("./src/training_worker.js"); _tw.terminate(); } catch (e) { useWorker = false; console.warn("[trainer] Worker not available:", e.message); }
      }

      if (useWorker) {
        // === WORKER PATH (non-blocking) ===
        buildResult.model.save(tf.io.withSaveHandler(function (artifacts) {
          onStatus("Training via Worker...");

          workerBridge.runTrainingInWorker({
            runId: activeId,
            modelArtifacts: artifacts,
            isSequence: buildResult.isSequence,
            headConfigs: buildResult.headConfigs,
            dataset: {
              mode: graphMode,
              windowSize: Number(activeDs.windowSize || 1),
              seqFeatureSize: Number(activeDs.seqFeatureSize || featureSize),
              featureSize: featureSize,
              targetMode: activeDs.targetMode || defaultTarget,
              targetSize: buildResult.headConfigs.length === 1 ? (buildResult.headConfigs[0].units || 1) : 1,
              paramSize: Number(activeDs.paramSize || 0),
              paramNames: activeDs.paramNames || [],
              xTrain: activeDs.xTrain, yTrain: activeDs.yTrain, seqTrain: activeDs.seqTrain || [],
              xVal: activeDs.xVal, yVal: activeDs.yVal, seqVal: activeDs.seqVal || [],
              xTest: activeDs.xTest || [], yTest: activeDs.yTest || [], seqTest: activeDs.seqTest || [],
              pTrain: activeDs.pTrain || [], pVal: activeDs.pVal || [], pTest: activeDs.pTest || [],
            },
            runtimeConfig: { runtimeId: "js_client", backend: String(config.runtimeBackend || "auto") },
            epochs: Number(config.epochs || 20),
            batchSize: Number(config.batchSize || 32),
            learningRate: Number(config.learningRate || 0.001),
            optimizerType: String(config.optimizerType || "adam"),
            lrSchedulerType: String(config.lrSchedulerType || "plateau"),
            useLrScheduler: String(config.lrSchedulerType || "plateau") !== "none",
            earlyStoppingPatience: Number(config.earlyStoppingPatience || 5),
            restoreBestWeights: config.restoreBestWeights !== false,
            lrPatience: Number(config.lrPatience || 3),
            lrFactor: Number(config.lrFactor || 0.5),
            minLr: Number(config.minLr || 0.000001),
            gradClipNorm: Number(config.gradClipNorm || 0),
            gradClipValue: Number(config.gradClipValue || 0),
            onEpochData: function (payload) {
              if (currentMountId !== _mountId) return;
              var logEntry = { epoch: payload.epoch, loss: payload.loss, val_loss: payload.val_loss, current_lr: payload.current_lr, improved: payload.improved };
              if (store) store.appendTrainerEpoch(activeId, logEntry);
              var epochs = store.getTrainerEpochs(activeId);
              if (_lossChartDiv) _plotLossChart(epochs);
              if (_epochLogEl) {
                var line = el("div", {}, "Epoch " + payload.epoch + ": loss=" + Number(payload.loss).toExponential(3) + " val=" + (payload.val_loss != null ? Number(payload.val_loss).toExponential(3) : "—"));
                _epochLogEl.appendChild(line);
                _epochLogEl.scrollTop = _epochLogEl.scrollHeight;
              }
            },
            onStatus: function (msg) { onStatus(msg); },
          }, {
            workerPath: (function () {
              // resolve worker path relative to current script
              try {
                var scripts = document.querySelectorAll("script[src*='training_worker']");
                if (scripts.length) return scripts[0].src;
              } catch (e) {}
              return "./src/training_worker.js";
            })(),
          }).then(function (result) {
            _isTraining = false;
            if (currentMountId !== _mountId) return;
            tCard.status = "done";
            tCard.metrics = result;
            if (result.modelArtifacts) tCard.modelArtifacts = result.modelArtifacts; // save weights
            if (store) store.upsertTrainerCard(tCard);
            onStatus("\u2713 Done (Worker): MAE=" + (result.mae != null ? Number(result.mae).toExponential(3) : "—"));
            _renderLeftPanel(); _renderMainPanel();
            buildResult.model.dispose();
          }).catch(function (err) {
            _isTraining = false;
            tCard.status = "error"; tCard.error = err.message;
            if (store) store.upsertTrainerCard(tCard);
            onStatus("Worker error: " + err.message);
            _renderLeftPanel(); _renderMainPanel();
            buildResult.model.dispose();
          });

          return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" } };
        }));

      } else {
        // === FALLBACK: main thread (will freeze UI) ===
        onStatus("Training on main thread (no worker)...");
        trainingEngine.trainModel(tf, {
          model: buildResult.model, isSequence: buildResult.isSequence, headConfigs: buildResult.headConfigs,
          dataset: {
            xTrain: activeDs.xTrain, yTrain: activeDs.yTrain, seqTrain: activeDs.seqTrain,
            xVal: activeDs.xVal, yVal: activeDs.yVal, seqVal: activeDs.seqVal,
            xTest: activeDs.xTest, yTest: activeDs.yTest, seqTest: activeDs.seqTest,
            pTrain: activeDs.pTrain, pVal: activeDs.pVal, pTest: activeDs.pTest,
            targetMode: activeDs.targetMode || defaultTarget,
            paramNames: activeDs.paramNames, paramSize: activeDs.paramSize, numClasses: activeDs.numClasses || activeDs.classCount,
          },
          epochs: Number(config.epochs || 20), batchSize: Number(config.batchSize || 32),
          learningRate: Number(config.learningRate || 0.001),
          optimizerType: String(config.optimizerType || "adam"),
          lrSchedulerType: String(config.lrSchedulerType || "plateau"),
          earlyStoppingPatience: Number(config.earlyStoppingPatience || 5),
          restoreBestWeights: config.restoreBestWeights !== false,
          lrPatience: Number(config.lrPatience || 3),
          lrFactor: Number(config.lrFactor || 0.5),
          minLr: Number(config.minLr || 0.000001),
          gradClipNorm: Number(config.gradClipNorm || 0),
          gradClipValue: Number(config.gradClipValue || 0),
          onEpochEnd: function (epoch, logs) {
            if (currentMountId !== _mountId) return;
            var logEntry = { epoch: epoch + 1, loss: logs.loss, val_loss: logs.val_loss, current_lr: logs.current_lr, improved: logs.improved };
            if (store) store.appendTrainerEpoch(activeId, logEntry);
            var epochs = store.getTrainerEpochs(activeId);
            if (_lossChartDiv) _plotLossChart(epochs);
            if (_epochLogEl) {
              var line = el("div", {}, "Epoch " + (epoch + 1) + ": loss=" + Number(logs.loss).toExponential(3) + " val_loss=" + (logs.val_loss != null ? Number(logs.val_loss).toExponential(3) : "—"));
              _epochLogEl.appendChild(line);
              _epochLogEl.scrollTop = _epochLogEl.scrollHeight;
            }
          },
        }).then(function (result) {
          _isTraining = false;
          if (currentMountId !== _mountId) return;
          tCard.status = "done";
          tCard.metrics = { mae: result.mae, testMae: result.testMae, mse: result.mse, testMse: result.testMse, bestEpoch: result.bestEpoch, bestValLoss: result.bestValLoss, finalLr: result.finalLr, stoppedEarly: result.stoppedEarly };
          if (store) store.upsertTrainerCard(tCard);
          onStatus("\u2713 Done: MAE=" + (result.mae != null ? Number(result.mae).toExponential(3) : "—"));
          _renderLeftPanel(); _renderMainPanel();
          buildResult.model.dispose();
        }).catch(function (err) {
          _isTraining = false;
          tCard.status = "error"; tCard.error = err.message;
          if (store) store.upsertTrainerCard(tCard);
          onStatus("Error: " + err.message);
          _renderLeftPanel(); _renderMainPanel();
          buildResult.model.dispose();
        });
      }
    }

    function _handleExport() {
      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      var tCard = activeId && store ? store.getTrainerCard(activeId) : null;
      if (!tCard) { onStatus("Select a trainer"); return; }
      if (!tCard.datasetId || !tCard.modelId) { onStatus("Set dataset + model first"); return; }

      var dataset = store ? store.getDataset(tCard.datasetId) : null;
      var model = store ? store.getModel(tCard.modelId) : null;
      if (!dataset || !dataset.data) { onStatus("Dataset not ready"); return; }
      if (!model || !model.graph) { onStatus("Model has no graph"); return; }

      var W = typeof window !== "undefined" ? window : {};
      var NBC = W.OSCNotebookCore || null;
      if (!NBC || typeof NBC.createNotebookBundleZipFromConfig !== "function") {
        onStatus("Notebook export module not available");
        return;
      }

      onStatus("Exporting notebook...");
      try {
        var config = _configFormApi && typeof _configFormApi.getConfig === "function" ? _configFormApi.getConfig() : {};
        var dsData = dataset.data;
        var isBundle = dsData.kind === "dataset_bundle" && dsData.datasets;
        var activeDs = isBundle ? dsData.datasets[dsData.activeVariantId || Object.keys(dsData.datasets)[0]] : dsData;

        var exportConfig = {
          schemaId: tCard.schemaId,
          datasetName: dataset.name || dataset.id,
          modelName: model.name || model.id,
          graph: model.graph,
          trainConfig: {
            epochs: Number(config.epochs || 20),
            batchSize: Number(config.batchSize || 32),
            learningRate: Number(config.learningRate || 0.001),
            optimizer: String(config.optimizerType || "adam"),
          },
          dataset: activeDs,
        };

        var result = NBC.createNotebookBundleZipFromConfig(exportConfig);
        if (result && typeof result.then === "function") {
          result.then(function (blob) {
            if (!blob) { onStatus("Export returned empty"); return; }
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = (tCard.name || "notebook") + "_bundle.zip";
            a.click();
            URL.revokeObjectURL(a.href);
            onStatus("\u2713 Exported: " + a.download);
          }).catch(function (err) { onStatus("Export error: " + err.message); });
        } else {
          onStatus("Export: unexpected result type");
        }
      } catch (err) {
        onStatus("Export error: " + err.message);
      }
    }

    function mount() { _mountId++; _subTab = "train"; _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
    function unmount() { _mountId++; if (_configFormApi && typeof _configFormApi.destroy === "function") _configFormApi.destroy(); _configFormApi = null; layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { mount(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

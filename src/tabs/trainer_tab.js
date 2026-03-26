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
    var predictionCore = deps.predictionCore;
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
    var _epochTableBody = null;
    var _subTab = "train"; // "train" | "test"

    function _getSchemaId() {
      var aid = stateApi ? stateApi.getActiveTrainer() : "";
      if (aid && store) { var t = store.getTrainerCard(aid); if (t && t.schemaId) return t.schemaId; }
      return stateApi ? stateApi.getActiveSchema() : "";
    }
    function _listTrainers() { return store && typeof store.listTrainerCards === "function" ? store.listTrainerCards({}) : []; }
    function _listDatasets(schemaId) {
      if (!store || typeof store.listDatasets !== "function") return [];
      return store.listDatasets({}).filter(function (d) { return !schemaId || d.schemaId === schemaId; })
        .sort(function (a, b) { return (a.status === "ready" ? 0 : 1) - (b.status === "ready" ? 0 : 1); });
    }
    function _listModels(schemaId) { return store && typeof store.listModels === "function" ? store.listModels({}).filter(function (m) { return !schemaId || m.schemaId === schemaId; }) : []; }

    var getServerAdapter = function () { var W = typeof window !== "undefined" ? window : {}; return W.OSCServerRuntimeAdapter || null; };
    var _serverAvailable = null; // null = unchecked, true/false = checked
    var _serverUrl = "";
    var _serverInfo = null; // { ok, backend, python, ... }

    // detect available backends
    function _getAvailableBackends() {
      var backends = [{ value: "auto", label: "Auto (best available)" }, { value: "cpu", label: "CPU" }];
      var tf = getTf();
      if (tf) {
        try { if (typeof tf.setBackend === "function") { backends.push({ value: "webgl", label: "WebGL (GPU)" }); } } catch (e) {}
        try { backends.push({ value: "wasm", label: "WASM" }); } catch (e) {}
      }
      return backends;
    }

    // Check server connection
    function _checkServerConnection(url, callback) {
      var sra = getServerAdapter();
      if (!sra) { callback(false); return; }
      var serverUrl = url || _serverUrl || sra.DEFAULT_SERVER;
      sra.checkServer(serverUrl).then(function (ok) {
        _serverAvailable = ok;
        if (ok) {
          // get server info
          fetch(serverUrl.replace(/\/$/, "") + "/api/health").then(function (r) { return r.json(); }).then(function (info) {
            _serverInfo = info;
            callback(true, info);
          }).catch(function () { callback(true, null); });
        } else {
          _serverInfo = null;
          callback(false);
        }
      });
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
        (t.modelId ? " | Model: " + (function () { var m = store.getModel(t.modelId); return m ? m.name : t.modelId; })() : "") +
        (t.backend ? " | Backend: " + String(t.backend) : "") +
        (t.metrics && t.metrics.paramCount ? " | Params: " + Number(t.metrics.paramCount).toLocaleString() : "")));
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

      // epoch table — persistent, rows appended live during training
      var tableWrap = el("div", { style: "max-height:300px;overflow-y:auto;" });
      var table = el("table", { className: "osc-metric-table", style: "width:100%;" });
      var thead = el("tr", {});
      ["Epoch", "Loss", "Val Loss", "LR", "Improved"].forEach(function (h) { thead.appendChild(el("th", {}, h)); });
      table.appendChild(thead);
      var tbody = el("tbody", {});
      table.appendChild(tbody);
      _epochTableBody = tbody;

      // fill existing epochs
      epochs.forEach(function (ep) { _appendEpochRow(ep); });

      if (!epochs.length && t.status !== "running") {
        var emptyRow = el("tr", {});
        emptyRow.appendChild(el("td", { style: "color:#64748b;text-align:center;", colspan: "5" }, "Waiting for training..."));
        tbody.appendChild(emptyRow);
      }

      tableWrap.appendChild(table);
      mainEl.appendChild(tableWrap);
    }

    function _appendEpochRow(ep) {
      if (!_epochTableBody) return;
      // remove "waiting" placeholder if present
      if (_epochTableBody.children.length === 1) {
        var first = _epochTableBody.children[0];
        if (first && first.querySelector && first.querySelector("[colspan]")) {
          _epochTableBody.removeChild(first);
        }
      }
      var tr = el("tr", {});
      tr.appendChild(el("td", {}, String(ep.epoch || "")));
      tr.appendChild(el("td", {}, ep.loss != null ? Number(ep.loss).toExponential(3) : "—"));
      tr.appendChild(el("td", {}, ep.val_loss != null ? Number(ep.val_loss).toExponential(3) : "—"));
      tr.appendChild(el("td", {}, ep.current_lr != null ? Number(ep.current_lr).toExponential(2) : "—"));
      tr.appendChild(el("td", { style: ep.improved ? "color:#4ade80;" : "" }, ep.improved ? "\u2713" : ""));
      _epochTableBody.appendChild(tr);
      // auto-scroll to bottom
      var wrap = _epochTableBody.parentElement && _epochTableBody.parentElement.parentElement;
      if (wrap && wrap.scrollHeight > wrap.clientHeight) wrap.scrollTop = wrap.scrollHeight;
    }

    function _renderTestSubTab(mainEl, t, activeId) {
      var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
      var tf = getTf();
      var pc = predictionCore || (typeof window !== "undefined" && window.OSCPredictionCore) || null;
      var _darkLayout = { paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 }, margin: { t: 30, b: 50, l: 50, r: 10 } };

      if (!t.metrics) {
        mainEl.appendChild(el("div", { style: "font-size:12px;color:#64748b;padding:8px;" }, "Train first to see test results and predictions."));
        return;
      }

      // --- determine task type from model graph (not schema) ---
      var schemaId = t.schemaId;
      var allowedOutputKeys = schemaRegistry ? schemaRegistry.getOutputKeys(schemaId) : ["x"];
      var defaultTarget = (allowedOutputKeys[0] && (allowedOutputKeys[0].key || allowedOutputKeys[0])) || "x";
      // read actual target from model's output node data (raw, not filtered by schema)
      var model = t.modelId ? (store ? store.getModel(t.modelId) : null) : null;
      if (model && model.graph) {
        var gd = modelBuilder ? modelBuilder.extractGraphData(model.graph) : null;
        if (gd) {
          var gids = Object.keys(gd);
          for (var gi = 0; gi < gids.length; gi++) {
            var gn = gd[gids[gi]];
            if (gn && gn.name === "output_layer" && gn.data && gn.data.target) {
              defaultTarget = String(gn.data.target);
              break;
            }
          }
        }
      }
      var isClassification = defaultTarget === "label" || defaultTarget === "logits";

      // --- check if server returned raw predictions (full charts) ---
      var m = t.metrics || {};
      if (m.testPredictions && m.testTruth && m.testPredictions.length) {
        var statusEl = el("div", { style: "font-size:11px;color:#94a3b8;padding:4px 8px;" },
          "Evaluated " + m.testPredictions.length + " test samples (" + (t.backend || "server") + ").");
        mainEl.appendChild(statusEl);
        var metricsContainer = el("div", {});
        mainEl.appendChild(metricsContainer);
        if (isClassification) {
          _renderClassificationMetrics(metricsContainer, m.testPredictions, m.testTruth, m.testPredictions.length,
            (store.getDataset(t.datasetId) && store.getDataset(t.datasetId).data && store.getDataset(t.datasetId).data.classCount) || 10,
            null, [28, 28, 1], {}, Plotly, _darkLayout, pc);
        } else {
          _renderRegressionMetrics(metricsContainer, m.testPredictions, m.testTruth, m.testPredictions.length, Plotly, _darkLayout, pc);
        }
        return;
      }

      // --- client-side evaluation (TF.js rebuild + inference — full charts) ---
      _renderTestSubTabClient(mainEl, t, activeId, Plotly, _darkLayout, pc, schemaId, allowedOutputKeys, defaultTarget, isClassification);
    }

    function _renderTestSubTabClient(mainEl, t, activeId, Plotly, _darkLayout, pc, schemaId, allowedOutputKeys, defaultTarget, isClassification) {
      var tf = getTf();
      // --- load dataset + model for TF.js inference ---
      if (!tf || !t.modelArtifacts || !t.datasetId || !modelBuilder) {
        _renderFallbackCurves(mainEl, activeId, Plotly, _darkLayout);
        return;
      }

      var statusEl = el("div", { style: "font-size:11px;color:#94a3b8;padding:4px 8px;" }, "Running inference on full test set (TF.js)...");
      mainEl.appendChild(statusEl);

      try {
        var dataset = store ? store.getDataset(t.datasetId) : null;
        var modelRec = store ? store.getModel(t.modelId) : null;
        if (!dataset || !dataset.data || !modelRec || !modelRec.graph) {
          statusEl.textContent = "Dataset or model not found.";
          return;
        }

        var dsData = dataset.data;
        var isBundle = dsData.kind === "dataset_bundle" && dsData.datasets;
        var activeDs = isBundle ? dsData.datasets[dsData.activeVariantId || Object.keys(dsData.datasets)[0]] : dsData;
        var rawRecords = activeDs.records || null;
        var nCls = activeDs.classCount || 10;
        var imgShape = Array.isArray(activeDs.imageShape) ? activeDs.imageShape : [28, 28, 1];

        // normalize MNIST format for inference
        if (!activeDs.xTest && activeDs.records) {
          var oh = function (l, n) { var a = new Array(n).fill(0); a[l] = 1; return a; };
          activeDs = {
            xTest: (activeDs.records.test && activeDs.records.test.x) || [],
            yTest: isClassification
              ? ((activeDs.records.test && activeDs.records.test.y) || []).map(function (l) { return oh(l, nCls); })
              : ((activeDs.records.test && activeDs.records.test.y) || []),
            yTestRaw: (activeDs.records.test && activeDs.records.test.y) || [],
            featureSize: (activeDs.records.test && activeDs.records.test.x && activeDs.records.test.x[0]) ? activeDs.records.test.x[0].length : 784,
            numClasses: nCls,
          };
        }

        // rebuild model
        var graphMode = modelBuilder.inferGraphMode(modelRec.graph, "direct");
        var featureSize = Number(activeDs.featureSize || (activeDs.xTest && activeDs.xTest[0] && activeDs.xTest[0].length) || 1);
        var rebuiltModel = modelBuilder.buildModelFromGraph(tf, modelRec.graph, {
          mode: graphMode, featureSize: featureSize, windowSize: 1, seqFeatureSize: featureSize,
          allowedOutputKeys: allowedOutputKeys, defaultTarget: defaultTarget, numClasses: activeDs.numClasses || nCls,
        });

        // load saved weights
        var hasWeights = t.modelArtifacts && t.modelArtifacts.weightSpecs &&
          (t.modelArtifacts.weightData || t.modelArtifacts.weightValues);
        if (hasWeights) {
          try {
            // reconstruct flat float array from either ArrayBuffer or values array
            var flatWeights;
            if (t.modelArtifacts.weightValues && Array.isArray(t.modelArtifacts.weightValues)) {
              flatWeights = new Float32Array(t.modelArtifacts.weightValues);
            } else if (t.modelArtifacts.weightData && t.modelArtifacts.weightData.byteLength) {
              flatWeights = new Float32Array(t.modelArtifacts.weightData);
            } else {
              throw new Error("No weight data available");
            }

            // load by order: match saved specs to rebuilt model weights
            // detect if weights come from PyTorch (transposed) by checking saved specs
            var savedSpecs = t.modelArtifacts.weightSpecs || [];
            var isPytorch = savedSpecs.length > 0 && savedSpecs[0].name && savedSpecs[0].name.match(/^\d+\./);
            var modelWeights = rebuiltModel.model.getWeights();
            var newWeights = [];
            var readOffset = 0;
            for (var wi = 0; wi < modelWeights.length; wi++) {
              var wShape = modelWeights[wi].shape;
              var wSize = wShape.reduce(function (a, b) { return a * b; }, 1);
              if (readOffset + wSize <= flatWeights.length) {
                var raw = flatWeights.subarray(readOffset, readOffset + wSize);
                // PyTorch Dense weights are [out, in], TF.js expects [in, out] — transpose 2D matrices
                if (isPytorch && wShape.length === 2 && savedSpecs[wi] && savedSpecs[wi].shape && savedSpecs[wi].shape.length === 2) {
                  var pyShape = savedSpecs[wi].shape; // [out, in]
                  if (pyShape[0] === wShape[1] && pyShape[1] === wShape[0]) {
                    // needs transpose
                    var transposed = new Float32Array(wSize);
                    var rows = pyShape[0], cols = pyShape[1];
                    for (var tr = 0; tr < rows; tr++) {
                      for (var tc = 0; tc < cols; tc++) {
                        transposed[tc * rows + tr] = raw[tr * cols + tc];
                      }
                    }
                    newWeights.push(tf.tensor(transposed, wShape));
                    readOffset += wSize;
                    continue;
                  }
                }
                newWeights.push(tf.tensor(raw, wShape));
                readOffset += wSize;
              }
            }
            if (newWeights.length === modelWeights.length) {
              rebuiltModel.model.setWeights(newWeights);
            } else {
              console.warn("[test] Weight count mismatch: model=" + modelWeights.length + " loaded=" + newWeights.length);
            }
          } catch (e) {
            console.warn("[test] Weight load failed:", e.message);
          }
        }

        var maxAvailable = (activeDs.xTest || []).length;

        // --- run inference on ALL test data (metrics computed on full set) ---
        var allX = activeDs.xTest;
        var allY = activeDs.yTest;
        var allPreds;
        // batch predict to avoid OOM
        var batchSize = 256;
        var allPredsArr = [];
        for (var bi = 0; bi < maxAvailable; bi += batchSize) {
          var bEnd = Math.min(bi + batchSize, maxAvailable);
          var batchX = allX.slice(bi, bEnd);
          var bTensor = tf.tensor2d(batchX);
          var bRaw = rebuiltModel.model.predict(bTensor);
          var bData = (Array.isArray(bRaw) ? bRaw[0] : bRaw).arraySync();
          allPredsArr = allPredsArr.concat(bData);
          bTensor.dispose();
          if (Array.isArray(bRaw)) bRaw.forEach(function (pt) { pt.dispose(); }); else bRaw.dispose();
        }
        allPreds = allPredsArr;

        statusEl.textContent = "Evaluated " + maxAvailable + " test samples.";

        // container for all metric charts
        var metricsContainer = el("div", {});
        mainEl.appendChild(metricsContainer);

        if (isClassification) {
          _renderClassificationMetrics(metricsContainer, allPreds, allY, maxAvailable, nCls, rawRecords, imgShape, activeDs, Plotly, _darkLayout, pc);
        } else {
          _renderRegressionMetrics(metricsContainer, allPreds, allY, maxAvailable, Plotly, _darkLayout, pc);
        }

        rebuiltModel.model.dispose();

      } catch (e) {
        statusEl.textContent = "Inference error: " + e.message;
      }
    }

    // === Classification metrics ===
    function _renderClassificationMetrics(container, preds, ySlice, testN, nCls, rawRecords, imgShape, activeDs, Plotly, darkLayout, pc) {
      var predLabels = preds.map(function (p) { return p.indexOf(Math.max.apply(null, p)); });
      var trueLabels = ySlice.map(function (y) { return Array.isArray(y) ? y.indexOf(Math.max.apply(null, y)) : Number(y); });

      // overall accuracy — big number card
      var correct = 0;
      for (var ci = 0; ci < testN; ci++) { if (predLabels[ci] === trueLabels[ci]) correct++; }
      var accuracy = correct / testN;

      var accCard = el("div", { className: "osc-card", style: "margin-top:8px;text-align:center;padding:16px;" });
      accCard.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;" }, "Test Accuracy"));
      accCard.appendChild(el("div", { style: "font-size:36px;font-weight:700;color:" + (accuracy >= 0.8 ? "#4ade80" : accuracy >= 0.5 ? "#fbbf24" : "#f43f5e") + ";" }, (accuracy * 100).toFixed(1) + "%"));
      accCard.appendChild(el("div", { style: "font-size:11px;color:#64748b;" }, correct + " / " + testN + " correct"));
      container.appendChild(accCard);

      if (!pc) return;

      // confusion matrix heatmap — normalized by row (recall per class)
      var cm = pc.confusionMatrix(trueLabels, predLabels, nCls);
      var cmNorm = cm.map(function (row) {
        var rowSum = row.reduce(function (a, b) { return a + b; }, 0);
        return row.map(function (v) { return rowSum > 0 ? v / rowSum : 0; });
      });
      if (Plotly) {
        var cmCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
        cmCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Confusion Matrix (row-normalized)"));
        var cmDiv = el("div", { style: "height:380px;" });
        cmCard.appendChild(cmDiv);
        container.appendChild(cmCard);

        var classLabels = [];
        for (var li = 0; li < nCls; li++) classLabels.push(String(li));

        // text annotations: show count + percentage
        var cmText = [];
        for (var tr = 0; tr < nCls; tr++) {
          var textRow = [];
          for (var tc = 0; tc < nCls; tc++) {
            textRow.push(cm[tr][tc] + "\n" + (cmNorm[tr][tc] * 100).toFixed(0) + "%");
          }
          cmText.push(textRow);
        }

        Plotly.newPlot(cmDiv, [{
          z: cmNorm, x: classLabels, y: classLabels, type: "heatmap",
          colorscale: "Blues", showscale: true, zmin: 0, zmax: 1,
          text: cmText, texttemplate: "%{text}", textfont: { size: 9 },
          hoverongaps: false,
          colorbar: { title: "Recall", titleside: "right", tickformat: ".0%", len: 0.9 },
        }], Object.assign({}, darkLayout, {
          title: { text: "True (rows) vs Predicted (columns)", font: { size: 11, color: "#94a3b8" } },
          xaxis: { title: "Predicted Class", gridcolor: "#1e293b", tickvals: classLabels, side: "bottom" },
          yaxis: { title: "True Class", gridcolor: "#1e293b", tickvals: classLabels, autorange: "reversed" },
          margin: { t: 35, b: 60, l: 60, r: 80 },
        }), { responsive: true });
      }

      // per-class precision, recall, F1 table
      var prfData = pc.precisionRecallF1(cm);
      var prfCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
      prfCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Per-Class Metrics"));

      var prfTable = el("table", { style: "width:100%;border-collapse:collapse;font-size:11px;" });
      var thead = el("tr", {});
      ["Class", "Precision", "Recall", "F1", "Support"].forEach(function (h) {
        thead.appendChild(el("th", { style: "text-align:left;padding:4px 8px;color:#94a3b8;border-bottom:1px solid #1e293b;" }, h));
      });
      prfTable.appendChild(thead);

      var macroP = 0, macroR = 0, macroF1 = 0, totalSupport = 0;
      var weakClasses = [];
      prfData.forEach(function (row) {
        var rowTr = el("tr", {});
        rowTr.appendChild(el("td", { style: "padding:4px 8px;color:#e2e8f0;font-weight:600;" }, String(row.class)));
        rowTr.appendChild(_metricBarCell(row.precision));
        rowTr.appendChild(_metricBarCell(row.recall));
        rowTr.appendChild(_metricBarCell(row.f1));
        rowTr.appendChild(el("td", { style: "padding:4px 8px;color:#94a3b8;text-align:right;" }, String(row.support)));
        prfTable.appendChild(rowTr);
        macroP += row.precision; macroR += row.recall; macroF1 += row.f1; totalSupport += row.support;
        if (row.f1 < 0.7) weakClasses.push({ cls: row.class, f1: row.f1, precision: row.precision, recall: row.recall });
      });

      var macroTr = el("tr", { style: "border-top:2px solid #334155;" });
      macroTr.appendChild(el("td", { style: "padding:4px 8px;color:#67e8f9;font-weight:700;" }, "Macro Avg"));
      macroTr.appendChild(_metricBarCell(nCls > 0 ? macroP / nCls : 0));
      macroTr.appendChild(_metricBarCell(nCls > 0 ? macroR / nCls : 0));
      macroTr.appendChild(_metricBarCell(nCls > 0 ? macroF1 / nCls : 0));
      macroTr.appendChild(el("td", { style: "padding:4px 8px;color:#94a3b8;text-align:right;" }, String(totalSupport)));
      prfTable.appendChild(macroTr);
      prfCard.appendChild(prfTable);
      container.appendChild(prfCard);

      // ROC curves (one-vs-rest) + insights
      if (Plotly && preds[0] && Array.isArray(preds[0])) {
        var rocCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
        rocCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "ROC Curves (One-vs-Rest)"));
        var rocDiv = el("div", { style: "height:320px;" });
        rocCard.appendChild(rocDiv);

        var rocColors = ["#22d3ee", "#f59e0b", "#4ade80", "#f43f5e", "#a78bfa", "#fb923c", "#2dd4bf", "#e879f9", "#fbbf24", "#38bdf8"];
        var rocTraces = [];
        var aucPerClass = [];
        for (var rc = 0; rc < nCls; rc++) {
          var rocData = pc.rocCurveOneVsRest(trueLabels, preds, rc);
          aucPerClass.push({ cls: rc, auc: rocData.auc });
          var step = Math.max(1, Math.floor(rocData.fpr.length / 200));
          var fprSub = [], tprSub = [];
          for (var ri = 0; ri < rocData.fpr.length; ri += step) { fprSub.push(rocData.fpr[ri]); tprSub.push(rocData.tpr[ri]); }
          rocTraces.push({
            x: fprSub, y: tprSub, mode: "lines",
            name: "Class " + rc + " (AUC=" + rocData.auc.toFixed(3) + ")",
            line: { color: rocColors[rc % rocColors.length], width: 1.5 },
          });
        }
        rocTraces.push({ x: [0, 1], y: [0, 1], mode: "lines", name: "Random", line: { color: "#475569", dash: "dash", width: 1 }, showlegend: false });

        var meanAuc = aucPerClass.reduce(function (a, b) { return a + b.auc; }, 0) / nCls;
        Plotly.newPlot(rocDiv, rocTraces, Object.assign({}, darkLayout, {
          title: { text: "Mean AUC: " + meanAuc.toFixed(3), font: { size: 12 } },
          xaxis: { title: "False Positive Rate", gridcolor: "#1e293b", range: [0, 1] },
          yaxis: { title: "True Positive Rate", gridcolor: "#1e293b", range: [0, 1] },
          legend: { font: { size: 9 }, bgcolor: "rgba(0,0,0,0)" },
          margin: { t: 35, b: 55, l: 50, r: 10 },
        }), { responsive: true });

        rocCard.appendChild(rocDiv);
        container.appendChild(rocCard);

        // === Insights & Recommendations ===
        var insightCard = el("div", { className: "osc-card", style: "margin-top:8px;border-left:3px solid #a78bfa;" });
        insightCard.appendChild(el("div", { style: "font-size:13px;color:#a78bfa;margin-bottom:8px;font-weight:600;" }, "Insights & Recommendations"));

        var insights = [];
        // overall assessment
        if (meanAuc >= 0.95) {
          insights.push({ icon: "\u2705", text: "Excellent discriminability (mean AUC " + meanAuc.toFixed(3) + "). The model separates classes very well." });
        } else if (meanAuc >= 0.85) {
          insights.push({ icon: "\u2705", text: "Good discriminability (mean AUC " + meanAuc.toFixed(3) + "). Minor improvements possible." });
        } else if (meanAuc >= 0.7) {
          insights.push({ icon: "\u26a0\ufe0f", text: "Moderate discriminability (mean AUC " + meanAuc.toFixed(3) + "). Consider more epochs, larger model, or data augmentation." });
        } else {
          insights.push({ icon: "\u274c", text: "Poor discriminability (mean AUC " + meanAuc.toFixed(3) + "). Model struggles to separate classes. Review architecture or training data." });
        }

        // find weak AUC classes
        var lowAucClasses = aucPerClass.filter(function (a) { return a.auc < 0.8; });
        if (lowAucClasses.length > 0) {
          var lowList = lowAucClasses.map(function (a) { return "class " + a.cls + " (AUC=" + a.auc.toFixed(3) + ")"; }).join(", ");
          insights.push({ icon: "\ud83d\udd0d", text: "Low AUC classes: " + lowList + ". These classes are hard to distinguish from others \u2014 check if they are visually similar or underrepresented." });
        }

        // precision vs recall balance
        if (weakClasses.length > 0) {
          weakClasses.forEach(function (w) {
            var msg = "Class " + w.cls + " (F1=" + (w.f1 * 100).toFixed(1) + "%): ";
            if (w.precision < w.recall) {
              msg += "Low precision \u2014 model often predicts this class incorrectly (too many false positives). The model is over-predicting this class.";
            } else if (w.recall < w.precision) {
              msg += "Low recall \u2014 model misses many samples of this class (too many false negatives). The model is under-detecting this class.";
            } else {
              msg += "Both precision and recall are low \u2014 the model struggles with this class overall.";
            }
            insights.push({ icon: "\u26a0\ufe0f", text: msg });
          });
        }

        // suggestion based on accuracy vs AUC gap
        if (meanAuc > 0.9 && accuracy < 0.8) {
          insights.push({ icon: "\ud83d\udca1", text: "AUC is high but accuracy is relatively low. The model has good ranking ability but the decision boundary may not be optimal. Consider calibration or threshold tuning." });
        }

        if (accuracy >= 0.9 && weakClasses.length === 0) {
          insights.push({ icon: "\ud83c\udf1f", text: "Strong performance across all classes. Ready for deployment or further benchmarking." });
        }

        insights.forEach(function (ins) {
          var line = el("div", { style: "font-size:11px;color:#cbd5e1;padding:3px 0;display:flex;gap:6px;align-items:flex-start;" });
          line.appendChild(el("span", { style: "flex-shrink:0;" }, ins.icon));
          line.appendChild(el("span", {}, ins.text));
          insightCard.appendChild(line);
        });
        container.appendChild(insightCard);
      }

      // image prediction grid — one row per class
      if (rawRecords && rawRecords.test && rawRecords.test.x) {
        var imgW = imgShape[0] || 28, imgH = imgShape[1] || 28;
        var gridCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
        gridCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Predictions vs Ground Truth (by class)"));

        // group by true class
        var byClass = {};
        for (var gi = 0; gi < testN; gi++) {
          var tCls = trueLabels[gi];
          if (!byClass[tCls]) byClass[tCls] = { correct: [], wrong: [] };
          if (predLabels[gi] === tCls) byClass[tCls].correct.push(gi);
          else byClass[tCls].wrong.push(gi);
        }

        var maxPerClass = 8;
        for (var clsI = 0; clsI < nCls; clsI++) {
          var group = byClass[clsI];
          if (!group) continue;
          var classAcc = group.correct.length / (group.correct.length + group.wrong.length);

          var classRow = el("div", { style: "margin-bottom:10px;" });
          var classHeader = el("div", { style: "font-size:11px;margin-bottom:4px;display:flex;align-items:center;gap:8px;" });
          classHeader.appendChild(el("span", { style: "font-weight:700;color:#e2e8f0;" }, "Class " + clsI));
          classHeader.appendChild(el("span", { style: "color:" + (classAcc >= 0.8 ? "#4ade80" : classAcc >= 0.5 ? "#fbbf24" : "#f43f5e") + ";font-size:10px;" },
            (classAcc * 100).toFixed(0) + "% (" + group.correct.length + "/" + (group.correct.length + group.wrong.length) + ")"));
          classRow.appendChild(classHeader);

          var imgRow = el("div", { style: "display:flex;flex-wrap:wrap;gap:3px;" });

          // show some correct (green) then some wrong (red)
          var showCorrect = group.correct.slice(0, maxPerClass);
          var showWrong = group.wrong.slice(0, maxPerClass);

          function _drawImgCell(idx, pLbl, tLbl, isOk) {
            var borderColor = isOk ? "#166534" : "#991b1b";
            var bgColor = isOk ? "#052e16" : "#450a0a";
            var cell = el("div", { style: "text-align:center;border:2px solid " + borderColor + ";border-radius:3px;padding:1px;background:" + bgColor + ";" });
            var canvas = document.createElement("canvas");
            canvas.width = imgW; canvas.height = imgH;
            canvas.style.cssText = "width:32px;height:32px;image-rendering:pixelated;display:block;";
            var pixels = rawRecords.test.x[idx];
            if (pixels) {
              var ctx = canvas.getContext("2d");
              var iData = ctx.createImageData(imgW, imgH);
              var imgCh = imgShape[2] || 1;
              var planeSize = imgW * imgH;
              for (var px = 0; px < planeSize; px++) {
                if (imgCh >= 3) {
                  // RGB: 3 values per pixel (HWC layout)
                  iData.data[px * 4] = Math.round((pixels[px * 3] || 0) * 255);
                  iData.data[px * 4 + 1] = Math.round((pixels[px * 3 + 1] || 0) * 255);
                  iData.data[px * 4 + 2] = Math.round((pixels[px * 3 + 2] || 0) * 255);
                } else {
                  // Grayscale: 1 value per pixel
                  var vv = Math.round((pixels[px] || 0) * 255);
                  iData.data[px * 4] = vv; iData.data[px * 4 + 1] = vv; iData.data[px * 4 + 2] = vv;
                }
                iData.data[px * 4 + 3] = 255;
              }
              ctx.putImageData(iData, 0, 0);
            }
            cell.appendChild(canvas);
            if (!isOk) {
              cell.appendChild(el("div", { style: "font-size:7px;color:#f43f5e;line-height:1;" }, "\u2192" + pLbl));
            }
            return cell;
          }

          showCorrect.forEach(function (idx) { imgRow.appendChild(_drawImgCell(idx, predLabels[idx], trueLabels[idx], true)); });
          if (showCorrect.length && showWrong.length) {
            imgRow.appendChild(el("div", { style: "width:1px;background:#334155;align-self:stretch;margin:0 2px;" }));
          }
          showWrong.forEach(function (idx) { imgRow.appendChild(_drawImgCell(idx, predLabels[idx], trueLabels[idx], false)); });

          classRow.appendChild(imgRow);
          gridCard.appendChild(classRow);
        }
        gridCard.appendChild(el("div", { style: "font-size:9px;color:#64748b;margin-top:6px;" }, "Green border = correct | Red border = misclassified (predicted label shown below)"));
        container.appendChild(gridCard);
      }
    }

    // === Regression metrics ===
    function _renderRegressionMetrics(container, preds, ySlice, testN, Plotly, darkLayout, pc) {
      // For multi-dim regression (e.g. 40-dim reconstruction), flatten ALL values for metrics
      var isMultiDim = ySlice[0] && Array.isArray(ySlice[0]) && ySlice[0].length > 1;
      var truthFlat, predFlat;
      if (isMultiDim) {
        truthFlat = []; predFlat = [];
        for (var fi = 0; fi < testN; fi++) {
          var yt = ySlice[fi], pp = preds[fi];
          if (Array.isArray(yt)) { for (var di = 0; di < yt.length; di++) { truthFlat.push(Number(yt[di] || 0)); predFlat.push(Number((pp && pp[di]) || 0)); } }
          else { truthFlat.push(Number(yt || 0)); predFlat.push(Number((pp && pp[0]) || 0)); }
        }
      } else {
        truthFlat = ySlice.map(function (y) { return Array.isArray(y) ? y[0] : Number(y); });
        predFlat = preds.map(function (p) { return Array.isArray(p) ? p[0] : Number(p); });
      }

      var r2 = pc ? pc.r2Score(truthFlat, predFlat) : 0;
      var regMetrics = pc ? pc.computeRegressionMetrics(truthFlat, predFlat) : { mae: 0, rmse: 0, bias: 0 };
      var residuals = pc ? pc.computeResiduals(truthFlat, predFlat) : [];

      var metricsRow = el("div", { style: "display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;" });

      function bigMetricCard(label, value, color) {
        var c = el("div", { className: "osc-card", style: "flex:1;min-width:100px;text-align:center;padding:12px 8px;" });
        c.appendChild(el("div", { style: "font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;" }, label));
        c.appendChild(el("div", { style: "font-size:24px;font-weight:700;color:" + color + ";margin-top:4px;" }, value));
        return c;
      }

      var r2Color = r2 >= 0.9 ? "#4ade80" : r2 >= 0.7 ? "#fbbf24" : "#f43f5e";
      metricsRow.appendChild(bigMetricCard("R\u00B2", r2.toFixed(4), r2Color));
      metricsRow.appendChild(bigMetricCard("MAE", regMetrics.mae.toExponential(3), "#22d3ee"));
      metricsRow.appendChild(bigMetricCard("RMSE", regMetrics.rmse.toExponential(3), "#f59e0b"));
      metricsRow.appendChild(bigMetricCard("Bias", regMetrics.bias.toExponential(3), "#a78bfa"));
      container.appendChild(metricsRow);

      if (!Plotly) return;

      // pred vs truth scatter with identity line
      var scatterCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
      scatterCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Predicted vs Truth"));
      var scatterDiv = el("div", { style: "height:300px;" });
      scatterCard.appendChild(scatterDiv);
      container.appendChild(scatterCard);

      var minVal = Math.min.apply(null, truthFlat.concat(predFlat));
      var maxVal = Math.max.apply(null, truthFlat.concat(predFlat));
      Plotly.newPlot(scatterDiv, [
        { x: truthFlat, y: predFlat, mode: "markers", name: "Predictions", marker: { size: 4, color: "#22d3ee", opacity: 0.7 } },
        { x: [minVal, maxVal], y: [minVal, maxVal], mode: "lines", name: "Identity", line: { color: "#4ade80", dash: "dash", width: 1.5 } },
      ], Object.assign({}, darkLayout, {
        title: { text: "Pred vs Truth (R\u00B2=" + r2.toFixed(4) + ")", font: { size: 12 } },
        xaxis: { title: "Ground Truth", gridcolor: "#1e293b" },
        yaxis: { title: "Predicted", gridcolor: "#1e293b" },
        legend: { orientation: "h", y: -0.15 },
      }), { responsive: true });

      // residual plot
      var residCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
      residCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Residuals"));
      var residDiv = el("div", { style: "height:260px;" });
      residCard.appendChild(residDiv);
      container.appendChild(residCard);

      Plotly.newPlot(residDiv, [
        { x: predFlat, y: residuals, mode: "markers", name: "Residuals", marker: { size: 4, color: "#f59e0b", opacity: 0.6 } },
        { x: [minVal, maxVal], y: [0, 0], mode: "lines", name: "Zero", line: { color: "#475569", dash: "dash", width: 1 }, showlegend: false },
      ], Object.assign({}, darkLayout, {
        title: { text: "Residuals vs Predicted", font: { size: 12 } },
        xaxis: { title: "Predicted", gridcolor: "#1e293b" },
        yaxis: { title: "Residual (pred - truth)", gridcolor: "#1e293b" },
        margin: { t: 35, b: 55, l: 55, r: 10 },
      }), { responsive: true });

      // time series overlay
      var tsCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
      tsCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Sample Predictions"));
      var tsDiv = el("div", { style: "height:260px;" });
      tsCard.appendChild(tsDiv);
      container.appendChild(tsCard);

      var tsIndices = [];
      for (var ti = 0; ti < testN; ti++) tsIndices.push(ti);
      Plotly.newPlot(tsDiv, [
        { x: tsIndices, y: truthFlat, mode: "lines", name: "Ground Truth", line: { color: "#22d3ee", width: 1.5 } },
        { x: tsIndices, y: predFlat, mode: "lines", name: "Prediction", line: { color: "#f59e0b", dash: "dot", width: 1.5 } },
      ], Object.assign({}, darkLayout, {
        title: { text: "Pred vs Truth (" + testN + " test samples)", font: { size: 12 } },
        xaxis: { title: "Sample", gridcolor: "#1e293b" },
        yaxis: { title: "Value", gridcolor: "#1e293b" },
        legend: { orientation: "h", y: -0.15 },
      }), { responsive: true });

      // insights
      var insightCard = el("div", { className: "osc-card", style: "margin-top:8px;border-left:3px solid #a78bfa;" });
      insightCard.appendChild(el("div", { style: "font-size:13px;color:#a78bfa;margin-bottom:8px;font-weight:600;" }, "Insights & Recommendations"));
      var regInsights = [];
      if (r2 >= 0.95) regInsights.push({ icon: "\u2705", text: "Excellent fit (R\u00B2=" + r2.toFixed(4) + "). Model explains >95% of the variance." });
      else if (r2 >= 0.8) regInsights.push({ icon: "\u2705", text: "Good fit (R\u00B2=" + r2.toFixed(4) + "). Consider more epochs or deeper model for further improvement." });
      else if (r2 >= 0.5) regInsights.push({ icon: "\u26a0\ufe0f", text: "Moderate fit (R\u00B2=" + r2.toFixed(4) + "). Significant unexplained variance. Try larger model, more features, or longer training." });
      else regInsights.push({ icon: "\u274c", text: "Poor fit (R\u00B2=" + r2.toFixed(4) + "). Model barely captures the relationship. Reconsider architecture, features, or data quality." });

      if (Math.abs(regMetrics.bias) > regMetrics.mae * 0.3) {
        regInsights.push({ icon: "\ud83d\udd0d", text: "Systematic bias detected (bias=" + regMetrics.bias.toExponential(3) + "). Model consistently " + (regMetrics.bias > 0 ? "over-predicts" : "under-predicts") + ". Check normalization or add bias correction." });
      }
      if (regMetrics.rmse > regMetrics.mae * 1.5) {
        regInsights.push({ icon: "\u26a0\ufe0f", text: "RMSE >> MAE indicates some large outlier errors. Check residual plot for patterns \u2014 may benefit from robust loss function or outlier handling." });
      }

      regInsights.forEach(function (ins) {
        var line = el("div", { style: "font-size:11px;color:#cbd5e1;padding:3px 0;display:flex;gap:6px;align-items:flex-start;" });
        line.appendChild(el("span", { style: "flex-shrink:0;" }, ins.icon));
        line.appendChild(el("span", {}, ins.text));
        insightCard.appendChild(line);
      });
      container.appendChild(insightCard);
    }

    // === Helper: metric bar cell for P/R/F1 table ===
    function _metricBarCell(val) {
      var pct = Math.round(val * 100);
      var barColor = val >= 0.8 ? "#4ade80" : val >= 0.5 ? "#fbbf24" : "#f43f5e";
      var td = el("td", { style: "padding:4px 8px;position:relative;min-width:80px;" });
      var bar = el("div", { style: "position:absolute;left:0;top:0;bottom:0;width:" + pct + "%;background:" + barColor + ";opacity:0.15;border-radius:2px;" });
      td.appendChild(bar);
      td.appendChild(el("span", { style: "position:relative;color:" + barColor + ";font-weight:600;font-size:11px;" }, (val * 100).toFixed(1) + "%"));
      return td;
    }

    // === Fallback: training curves only ===
    function _renderFallbackCurves(mainEl, activeId, Plotly, darkLayout) {
      var card = el("div", { className: "osc-card", style: "margin-top:8px;" });
      card.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Training Curves"));
      var chartDiv = el("div", { style: "height:280px;" });
      card.appendChild(chartDiv);
      mainEl.appendChild(card);

      if (Plotly) {
        var epochs = store && typeof store.getTrainerEpochs === "function" ? store.getTrainerEpochs(activeId) : [];
        if (epochs.length) {
          Plotly.newPlot(chartDiv, [
            { x: epochs.map(function (e) { return e.epoch; }), y: epochs.map(function (e) { return e.loss; }), mode: "lines+markers", name: "Train Loss", line: { color: "#22d3ee" } },
            { x: epochs.map(function (e) { return e.epoch; }), y: epochs.map(function (e) { return e.val_loss; }), mode: "lines+markers", name: "Val Loss", line: { color: "#f59e0b" } },
          ], Object.assign({}, darkLayout, {
            title: { text: "Training Curves", font: { size: 12 } },
            xaxis: { title: "Epoch", gridcolor: "#1e293b" },
            yaxis: { title: "Loss", gridcolor: "#1e293b" },
            legend: { orientation: "h", y: -0.15 },
          }), { responsive: true });
        }
      }
      mainEl.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;padding:4px 8px;" }, "Model weights not saved \u2014 showing training curves only."));
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

      var hasEpochs = (store.getTrainerEpochs(activeId) || []).length > 0;
      var hasTrained = (t.status === "done" && t.modelArtifacts) || hasEpochs;
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

      var sra = getServerAdapter();
      var defaultServerUrl = sra ? sra.DEFAULT_SERVER : "http://localhost:3777";
      var hasServerAdapter = !!sra;
      var formSchema = [
        { key: "datasetId", label: "Dataset (" + schemaId + ")", type: "select", options: datasets.map(function (d) { return { value: d.id, label: (d.name || d.id) + (d.status === "ready" ? " \u2713" : " (draft)") }; }), disabled: isLocked },
        { key: "modelId", label: "Model (" + schemaId + ")", type: "select", options: models.map(function (m) { return { value: m.id, label: m.name || m.id }; }), disabled: isLocked },
        { key: "runtimeBackend", label: "Backend", type: "select", options: backends },
      ];
      if (hasServerAdapter) {
        formSchema.push({ key: "useServer", label: "Use PyTorch Server", type: "checkbox" });
        formSchema.push({ key: "serverUrl", label: "Server URL", type: "text", placeholder: defaultServerUrl });
      }
      formSchema = formSchema.concat([
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
      ]);
      var formValue = {
        datasetId: t.datasetId || "", modelId: t.modelId || "",
        runtimeBackend: "auto", useServer: true, serverUrl: defaultServerUrl, epochs: 20, batchSize: 32, learningRate: 0.001,
        optimizerType: "adam", lrSchedulerType: "plateau", earlyStoppingPatience: 5,
        restoreBestWeights: true, lrPatience: 3, lrFactor: 0.5, minLr: 0.000001,
        gradClipNorm: 0, gradClipValue: 0,
      };

      // server status element (created before form so onChange can update it)
      var sraForPanel = getServerAdapter();
      var serverPanel = null;
      var serverStatusEl = null;
      if (sraForPanel) {
        serverPanel = el("div", { style: "margin-top:8px;padding:6px 8px;border:1px solid #1e293b;border-radius:6px;background:#0f172a;" });
        serverStatusEl = el("span", { style: "font-size:11px;" });
        if (_serverAvailable === true && _serverInfo) {
          serverStatusEl.style.color = "#4ade80";
          serverStatusEl.textContent = "\u2713 Connected: " + (_serverInfo.backend || "pytorch") + " (" + (_serverInfo.python || "python") + ")";
        } else if (_serverAvailable === false) {
          serverStatusEl.style.color = "#f43f5e";
          serverStatusEl.textContent = "\u2717 Server not reachable";
        } else {
          serverStatusEl.style.color = "#94a3b8";
          serverStatusEl.textContent = "Server: not checked";
        }
      }

      if (uiEngine && typeof uiEngine.renderConfigForm === "function") {
        var formMount = el("div", {});
        _configFormApi = uiEngine.renderConfigForm({
          mountEl: formMount, schema: formSchema, value: formValue,
          fieldNamePrefix: "train", rowClassName: "osc-form-row",
          onChange: function (cfg, ctx) {
            // auto-check server when "Use PyTorch Server" is toggled on
            if (ctx && ctx.key === "useServer" && ctx.value && sraForPanel && serverStatusEl) {
              var urlInput = rightEl.querySelector("input[data-config-key='serverUrl']");
              var url = urlInput ? urlInput.value : "";
              _serverUrl = url;
              serverStatusEl.style.color = "#fbbf24";
              serverStatusEl.textContent = "Checking server...";
              _checkServerConnection(url, function (ok, info) {
                if (ok) {
                  serverStatusEl.style.color = "#4ade80";
                  serverStatusEl.textContent = "\u2713 Connected: " + (info && info.backend || "pytorch");
                  if (info && info.python) serverStatusEl.textContent += " (" + info.python + ")";
                } else {
                  serverStatusEl.style.color = "#f43f5e";
                  serverStatusEl.textContent = "\u2717 Cannot reach server \u2014 will fallback to client";
                }
              });
            }
          },
        });
        rightEl.appendChild(formMount);
      }

      // server connection panel
      if (serverPanel && serverStatusEl) {
        var testBtn = el("button", { style: "margin-left:8px;padding:2px 8px;font-size:10px;border-radius:4px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;" }, "Test Connection");
        testBtn.addEventListener("click", function () {
          var urlInput = rightEl.querySelector("input[data-config-key='serverUrl']");
          var url = urlInput ? urlInput.value : "";
          _serverUrl = url;
          serverStatusEl.style.color = "#fbbf24";
          serverStatusEl.textContent = "Testing...";
          _checkServerConnection(url, function (ok, info) {
            if (ok) {
              serverStatusEl.style.color = "#4ade80";
              serverStatusEl.textContent = "\u2713 Connected: " + (info && info.backend || "pytorch");
              if (info && info.python) serverStatusEl.textContent += " (" + info.python + ")";
            } else {
              serverStatusEl.style.color = "#f43f5e";
              serverStatusEl.textContent = "\u2717 Cannot reach server";
            }
          });
        });
        serverPanel.appendChild(serverStatusEl);
        serverPanel.appendChild(testBtn);
        rightEl.appendChild(serverPanel);
      }

      // buttons — show Stop when training, Start/Continue otherwise
      var btnRow = el("div", { style: "display:flex;gap:4px;margin-top:8px;" });
      if (_isTraining) {
        var stopBtn = el("button", { className: "osc-btn", style: "flex:1;background:linear-gradient(135deg,#dc2626,#991b1b);border-color:#ef4444;" }, "Stop Training");
        stopBtn.addEventListener("click", function () {
          _isTraining = false;
          tCard.status = "stopped";
          if (store) store.upsertTrainerCard(tCard);
          onStatus("Training stopped");
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        });
        btnRow.appendChild(stopBtn);
      } else {
        var trainLabel = hasTrained ? "Continue Training" : "Start Training";
        var trainBtn = el("button", { className: "osc-btn", style: "flex:1;" }, trainLabel);
        trainBtn.addEventListener("click", _handleTrain);
        btnRow.appendChild(trainBtn);
      }
      var exportBtn = el("button", { className: "osc-btn secondary", style: "flex:1;" }, "Export Notebook");
      exportBtn.addEventListener("click", function () { _handleExport(); });
      btnRow.appendChild(exportBtn);
      rightEl.appendChild(btnRow);

      // clear session button
      if (hasTrained) {
        var clearBtn = el("button", { className: "osc-btn secondary", style: "width:100%;margin-top:4px;border-color:#7c2d12;color:#fdba74;" }, "Reset Training (keep dataset/model)");
        clearBtn.addEventListener("click", function () {
          if (!confirm("Reset training history? Dataset and model will be kept.")) return;
          t.status = "draft";
          t.metrics = null;
          t.modelArtifacts = null;
          t.backend = null;
          // keep t.datasetId and t.modelId — just unlock config
          if (store) { store.upsertTrainerCard(t); store.replaceTrainerEpochs(activeId, []); }
          onStatus("Training reset — config unlocked");
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        });
        rightEl.appendChild(clearBtn);
      }

      // info
      rightEl.appendChild(el("div", { style: "margin-top:12px;font-size:10px;color:#64748b;" },
        "Auto = TF.js client (WebGPU \u2192 WebGL \u2192 WASM \u2192 CPU). " +
        "Select 'PyTorch Server' to train on remote GPU."));
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
      // read actual target from model's output node (raw, not filtered)
      if (model && model.graph && modelBuilder) {
        var _gd = modelBuilder.extractGraphData(model.graph);
        if (_gd) {
          var _gids = Object.keys(_gd);
          for (var _gi = 0; _gi < _gids.length; _gi++) {
            var _gn = _gd[_gids[_gi]];
            if (_gn && _gn.name === "output_layer" && _gn.data && _gn.data.target) {
              defaultTarget = String(_gn.data.target); break;
            }
          }
        }
      }
      var dsData = dataset.data;
      var isBundle = dsData.kind === "dataset_bundle" && dsData.datasets;
      var activeDs = isBundle ? dsData.datasets[dsData.activeVariantId || Object.keys(dsData.datasets)[0]] : dsData;
      if (!activeDs.xTrain && activeDs.records) {
        var nClasses = activeDs.classCount || 10;
        function oneHot(label, n) { var arr = new Array(n).fill(0); arr[label] = 1; return arr; }
        var isClassification = defaultTarget === "label" || defaultTarget === "logits";
        var isReconstruction = defaultTarget === "xv" || defaultTarget === "x";
        function getY(split) {
          var raw = (activeDs.records[split] && activeDs.records[split].y) || [];
          if (isClassification) return raw.map(function (l) { return oneHot(l, nClasses); });
          if (isReconstruction) return (activeDs.records[split] && activeDs.records[split].x) || []; // y = x for reconstruction
          return raw;
        }
        activeDs = {
          xTrain: (activeDs.records.train && activeDs.records.train.x) || [],
          yTrain: getY("train"),
          xVal: (activeDs.records.val && activeDs.records.val.x) || [],
          yVal: getY("val"),
          xTest: (activeDs.records.test && activeDs.records.test.x) || [],
          yTest: getY("test"),
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
      _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();

      var currentMountId = _mountId;

      var W = typeof window !== "undefined" ? window : {};
      var backend = String(config.runtimeBackend || "auto");
      var useServer = Boolean(config.useServer);
      var serverAdapter = getServerAdapter();
      var serverUrl = String(config.serverUrl || (serverAdapter && serverAdapter.DEFAULT_SERVER) || "");

      // PyTorch Server: when useServer is checked — try server first, fallback to client
      if (useServer && serverAdapter) {
        onStatus("Checking PyTorch Server...");
        _checkServerConnection(serverUrl, function (ok) {
          _renderRightPanel(); // update server status display with full info
          if (!ok) {
            // first training → fallback to client. Continue training of server model → need server.
            if (tCard.trainedOnServer) {
              onStatus("Server not reachable. This model was trained on server \u2014 restart server to continue, or create new trainer for client.");
              _isTraining = false; tCard.status = tCard.status === "training" ? "done" : tCard.status;
              if (store) store.upsertTrainerCard(tCard);
              _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
              return;
            }
            onStatus("Server not reachable \u2014 training on client (" + backend + ")");
            _runClientTraining();
            return;
          }
          onStatus("Server connected \u2014 training on PyTorch...");
          // server OK — proceed with server training
          serverAdapter.runTrainingOnServer({
          runId: activeId,
          schemaId: schemaId,
          graph: model.graph,
          dataset: {
            mode: graphMode, featureSize: featureSize, targetMode: activeDs.targetMode || defaultTarget,
            xTrain: activeDs.xTrain, yTrain: activeDs.yTrain, xVal: activeDs.xVal, yVal: activeDs.yVal,
            xTest: activeDs.xTest, yTest: activeDs.yTest,
            pTrain: activeDs.pTrain, pVal: activeDs.pVal, pTest: activeDs.pTest,
            paramNames: activeDs.paramNames, paramSize: activeDs.paramSize,
            numClasses: activeDs.numClasses || activeDs.classCount || 0,
          },
          headConfigs: buildResult.headConfigs,
          epochs: Number(config.epochs || 20), batchSize: Number(config.batchSize || 32),
          learningRate: Number(config.learningRate || 0.001), optimizerType: String(config.optimizerType || "adam"),
          lrSchedulerType: String(config.lrSchedulerType || "plateau"),
          earlyStoppingPatience: Number(config.earlyStoppingPatience || 5),
          restoreBestWeights: config.restoreBestWeights !== false,
          gradClipNorm: Number(config.gradClipNorm || 0),
          onEpochData: function (payload) {
            if (currentMountId !== _mountId) return;
            var logEntry = { epoch: payload.epoch, loss: payload.loss, val_loss: payload.val_loss, current_lr: payload.current_lr, improved: payload.improved };
            if (store) store.appendTrainerEpoch(activeId, logEntry);
            var epochs = store.getTrainerEpochs(activeId);
            if (_lossChartDiv) _plotLossChart(epochs);
            _appendEpochRow(logEntry);
          },
          onStatus: function (msg) { onStatus(msg); },
          onReady: function (msg) { onStatus("Server ready: " + (msg.backend || "pytorch")); },
        }, {
          serverUrl: String(config.serverUrl || serverAdapter.DEFAULT_SERVER),
        }).then(function (result) {
          _isTraining = false;
          if (currentMountId !== _mountId) return;
          tCard.status = "done";
          tCard.metrics = result;
          if (!tCard.metrics.paramCount) tCard.metrics.paramCount = buildResult.model.countParams();
          tCard.backend = result.resolvedBackend || result.backend || "pytorch";
          tCard.trainedOnServer = true;
          if (!tCard.config) tCard.config = {};
          tCard.config.useServer = true;
          tCard.config.serverUrl = serverUrl;
          if (result.modelArtifacts) {
            if (result.modelArtifacts.weightData && !result.modelArtifacts.weightValues) {
              result.modelArtifacts.weightValues = result.modelArtifacts.weightData;
              delete result.modelArtifacts.weightData;
            }
            tCard.modelArtifacts = result.modelArtifacts;
          }
          if (store) store.upsertTrainerCard(tCard);
          onStatus("\u2713 Done (PyTorch): MAE=" + (result.mae != null ? Number(result.mae).toExponential(3) : "—"));
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          buildResult.model.dispose();
        }).catch(function (err) {
          _isTraining = false;
          tCard.status = "error"; tCard.error = err.message;
          if (store) store.upsertTrainerCard(tCard);
          onStatus("Server error: " + err.message);
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          buildResult.model.dispose();
        });
        }); // close checkServer.then
        return; // don't fall through to Worker path
      } // close if (useServer)

      _runClientTraining();
      return;

      function _runClientTraining() {
      // === WORKER PATH (non-blocking) ===
      var W = typeof window !== "undefined" ? window : {};
      var workerBridge = W.OSCTrainingWorkerBridge;
      var useWorker = workerBridge && typeof workerBridge.runTrainingInWorker === "function";
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
              _appendEpochRow(logEntry);
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
            tCard.backend = result.resolvedBackend || String(config.runtimeBackend || "auto");
            // convert worker's ArrayBuffer to JSON-safe array before store.upsert
            if (result.modelArtifacts) {
              var wa = result.modelArtifacts;
              if (wa.weightData && wa.weightData.byteLength) {
                wa.weightValues = Array.from(new Float32Array(wa.weightData));
                delete wa.weightData;
              }
              tCard.modelArtifacts = wa;
            }
            if (store) store.upsertTrainerCard(tCard);
            onStatus("\u2713 Done (Worker): MAE=" + (result.mae != null ? Number(result.mae).toExponential(3) : "—"));
            _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
            buildResult.model.dispose();
          }).catch(function (err) {
            _isTraining = false;
            tCard.status = "error"; tCard.error = err.message;
            if (store) store.upsertTrainerCard(tCard);
            onStatus("Worker error: " + err.message);
            _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
            buildResult.model.dispose();
          });

          return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" } };
        }));

      } else {
        // === FALLBACK: main thread (will freeze UI) ===
        onStatus("\u26a0 Training on main thread (UI will freeze). Use http:// server for smooth Worker training.");
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
            _appendEpochRow(logEntry);
          },
        }).then(function (result) {
          _isTraining = false;
          if (currentMountId !== _mountId) return;
          tCard.status = "done";
          tCard.metrics = result;
          if (!tCard.metrics.paramCount) tCard.metrics.paramCount = buildResult.model.countParams();
          tCard.backend = (tf.getBackend && tf.getBackend()) || String(config.runtimeBackend || "auto");
          // save model weights for test inference — extract manually
          try {
            var allWeights = buildResult.model.getWeights();
            var totalBytes = 0;
            var specs = allWeights.map(function (w, i) {
              var shape = w.shape;
              var size = shape.reduce(function (a, b) { return a * b; }, 1);
              var spec = { name: "w" + i, shape: shape, dtype: "float32", offset: totalBytes };
              totalBytes += size * 4;
              return spec;
            });
            var buffer = new ArrayBuffer(totalBytes);
            var offset = 0;
            allWeights.forEach(function (w) {
              var data = w.dataSync();
              new Float32Array(buffer, offset, data.length).set(data);
              offset += data.length * 4;
            });
            // Store as Float32Array values (JSON-serializable) since ArrayBuffer is lost in JSON clone
            var floatArr = Array.from(new Float32Array(buffer));
            tCard.modelArtifacts = { weightSpecs: specs, weightValues: floatArr };
          } catch (e) {
            console.warn("[trainer] Weight save failed:", e.message);
          }
          if (store) store.upsertTrainerCard(tCard);
          onStatus("\u2713 Done: MAE=" + (result.mae != null ? Number(result.mae).toExponential(3) : "—"));
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          buildResult.model.dispose();
        }).catch(function (err) {
          _isTraining = false;
          tCard.status = "error"; tCard.error = err.message;
          if (store) store.upsertTrainerCard(tCard);
          onStatus("Error: " + err.message);
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          buildResult.model.dispose();
        });
      }
      } // end _runClientTraining
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
      var DBA = W.OSCDatasetBundleAdapter || null;
      if (!NBC || typeof NBC.createSingleNotebookFileFromConfig !== "function") {
        onStatus("Notebook export module not available");
        return;
      }

      onStatus("Exporting notebook...");
      try {
        var config = _configFormApi && typeof _configFormApi.getConfig === "function" ? _configFormApi.getConfig() : {};

        var NRA = W.OSCNotebookRuntimeAssets || null;
        var runtimeFiles = NRA && NRA.files ? Object.keys(NRA.files) : [];
        var runtimeLoader = NRA && NRA.files ? function (name) { return NRA.files[name] || ""; } : null;

        NBC.createNotebookBundleZipFromConfig({
          seed: 42,
          zipFileName: String(tCard.name || "trainer").replace(/\s+/g, "_") + "_bundle.zip",
          datasetBundleAdapter: DBA,
          runtimeFiles: runtimeFiles,
          runtimeLoader: runtimeLoader,
          sessions: [{
            id: tCard.id,
            name: tCard.name || "session",
            schemaId: tCard.schemaId,
            graph: model.graph,
            runtime: "python_server",
            epochs: Number(config.epochs || 20),
            batchSize: Number(config.batchSize || 32),
            learningRate: Number(config.learningRate || 0.001),
            datasetData: dataset.data,
            datasetCsvPath: "dataset.csv",
            modelGraphPath: "model_graph.json",
          }],
        }).then(function (result) {
          if (!result) { onStatus("Export returned empty"); return; }
          var blob = result.blob || null;
          var fileName = result.fileName || (tCard.name || "notebook") + ".zip";

          if (!blob) {
            // try to create blob from buffer/text
            var text = result.buffer || result.text || result.notebookText || null;
            if (text) blob = new Blob([text], { type: "application/x-ipynb+json" });
          }
          if (!blob) { onStatus("Export produced no downloadable file"); return; }

          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = fileName;
          a.click();
          URL.revokeObjectURL(a.href);
          onStatus("\u2713 Exported: " + fileName);
        }).catch(function (err) { onStatus("Export error: " + err.message); });
      } catch (err) {
        onStatus("Export error: " + err.message);
      }
    }

    function mount() {
      _mountId++; _subTab = "train";
      _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
      // auto-check server on mount
      if (_serverAvailable === null) {
        _checkServerConnection("", function () { _renderRightPanel(); });
      }
    }
    function unmount() { _mountId++; if (_configFormApi && typeof _configFormApi.destroy === "function") _configFormApi.destroy(); _configFormApi = null; layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { mount(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

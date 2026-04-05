(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCEvaluationTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Evaluation Tab — Multi-model benchmark runner.
   *
   * Left:   Evaluation item list (multiple schemas coexist)
   * Main:   Comparison table + charts + module custom viz
   * Right:  Config (schema, models, dataset, metrics, run button)
   *
   * Uses shared modules: uiEngine.renderItemList(), uiEngine.renderConfigForm()
   * Evaluation items carry their own schemaId — no global schema switching.
   * Generation results pulled from store (persisted by generation tab).
   * Dataset module provides custom evaluators via playgroundApi.getEvaluators().
   */

  var EVAL_TABLE = "evaluations";

  function create(deps) {
    var layout = deps.layout;
    var stateApi = deps.stateApi;
    var store = deps.store;
    var schemaRegistry = deps.schemaRegistry;
    var predictionCore = deps.predictionCore;
    var modelBuilder = deps.modelBuilder;
    var onStatus = deps.onStatus || function () {};
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };
    var el = deps.el || function (tag, attrs, children) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "className") e.className = attrs[k];
        else if (k === "textContent") e.textContent = attrs[k];
        else if (k === "style") e.style.cssText = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
      if (children != null) (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (typeof c === "number") e.appendChild(document.createTextNode(String(c)));
        else if (c && c.nodeType) e.appendChild(c);
      });
      return e;
    };
    var getTf = function () { var W = typeof window !== "undefined" ? window : {}; return W.tf || null; };
    var getUiEngine = function () { var W = typeof window !== "undefined" ? window : {}; return W.OSCUiSharedEngine || null; };
    var getGenerationEngine = function () { var W = typeof window !== "undefined" ? window : {}; return W.OSCGenerationEngineCore || null; };
    var modal = deps.modal;

    var _activeEvalId = null;
    var _isRunning = false;
    var _mountId = 0;

    // init custom table
    if (store && typeof store.initTables === "function") store.initTables({ tables: [EVAL_TABLE] });

    // ─── Store helpers ───
    function _listEvals() {
      return store && typeof store.list === "function" ? store.list({ table: EVAL_TABLE }) : [];
    }
    function _getEval(id) {
      return store && typeof store.get === "function" ? store.get({ table: EVAL_TABLE, id: id }) : null;
    }
    function _saveEval(rec) {
      if (!store || typeof store.save !== "function") return;
      store.save({ table: EVAL_TABLE, values: [rec] });
    }
    function _removeEval(id) {
      if (!store || typeof store.remove !== "function") return;
      store.remove({ table: EVAL_TABLE, id: id });
    }

    // ─── Built-in evaluators ───
    function _getBuiltinEvaluators(isClassification) {
      var list = [];
      if (!isClassification) {
        list.push({ id: "mae", name: "MAE", mode: "test" });
        list.push({ id: "rmse", name: "RMSE", mode: "test" });
        list.push({ id: "r2", name: "R\u00B2", mode: "test" });
        list.push({ id: "bias", name: "Bias", mode: "test" });
      } else {
        list.push({ id: "accuracy", name: "Accuracy", mode: "test" });
        list.push({ id: "macro_f1", name: "Macro F1", mode: "test" });
      }
      list.push({ id: "recon_mse", name: "Reconstruction MSE", mode: "generation" });
      list.push({ id: "mmd_rbf", name: "MMD (RBF)", mode: "generation" });
      list.push({ id: "mean_gap", name: "Mean Gap", mode: "generation" });
      list.push({ id: "std_gap", name: "Std Gap", mode: "generation" });
      list.push({ id: "nn_precision", name: "NN Precision", mode: "generation" });
      list.push({ id: "nn_coverage", name: "NN Coverage", mode: "generation" });
      list.push({ id: "diversity_gap", name: "Diversity Gap", mode: "generation" });
      list.push({ id: "diversity", name: "Pairwise Diversity", mode: "generation" });
      return list;
    }

    // ─── Module evaluators ───
    function _getModuleEvaluators(schemaId) {
      var W = typeof window !== "undefined" ? window : {};
      var dm = W.OSCDatasetModules;
      if (!dm || typeof dm.getModuleForSchema !== "function") return [];
      var mods = dm.getModuleForSchema(schemaId) || [];
      for (var i = 0; i < mods.length; i++) {
        var mod = dm.getModule(mods[i].id);
        if (mod && mod.playgroundApi && typeof mod.playgroundApi.getEvaluators === "function") {
          return mod.playgroundApi.getEvaluators();
        }
      }
      return [];
    }

    function _getAllEvaluators(schemaId, isClassification) {
      return _getBuiltinEvaluators(isClassification).concat(_getModuleEvaluators(schemaId));
    }

    // ─── Get trained trainers for a schema ───
    function _listTrainersForSchema(schemaId) {
      if (!store) return [];
      return (typeof store.listTrainerCards === "function" ? store.listTrainerCards({}) : [])
        .filter(function (t) { return t.modelId && (!schemaId || t.schemaId === schemaId); });
    }

    function _getTrainerArtifacts(trainer, weightSelection) {
      if (!trainer) return null;
      var sel = String(weightSelection || "").trim().toLowerCase();
      if (sel === "best" && trainer.modelArtifactsBest) return trainer.modelArtifactsBest;
      return trainer.modelArtifactsLast || trainer.modelArtifacts || trainer.modelArtifactsBest || null;
    }

    function _getCheckpointRef(artifacts) {
      var checkpoint = artifacts && artifacts.checkpoint && typeof artifacts.checkpoint === "object" ? artifacts.checkpoint : null;
      return String((checkpoint && checkpoint.checkpointRef) || (artifacts && artifacts.checkpointRef) || "").trim();
    }

    function _resolveGenerationInfo(modelRec) {
      if (!modelRec || !modelRec.graph || !modelBuilder) {
        return {
          family: "",
          sampleNodes: [],
          outputNodes: [],
          hasLatentDecoder: false,
          canReconstruct: true,
          canRandomSample: false,
          canClassifierGuide: false,
          canLangevin: false,
          canOptimize: false,
          canInverse: true,
          canDDPM: false,
          defaultMethod: "reconstruct",
        };
      }
      if (typeof modelBuilder.extractGenerationCapabilities === "function") {
        return modelBuilder.extractGenerationCapabilities(modelRec.graph);
      }
      var family = typeof modelBuilder.inferModelFamily === "function" ? modelBuilder.inferModelFamily(modelRec.graph) : "";
      return { family: family, sampleNodes: [], outputNodes: [], hasLatentDecoder: family === "vae", defaultMethod: family === "gan" ? "random" : "reconstruct" };
    }

    function _resolveGenerationMeta(modelRec) {
      var engine = getGenerationEngine();
      var info = _resolveGenerationInfo(modelRec);
      var caps = engine && typeof engine.detectCapabilities === "function"
        ? engine.detectCapabilities(info)
        : { availableMethods: [{ id: "inverse", label: "Inverse / Transfer Learning" }], defaultMethod: "inverse" };
      return { info: info, caps: caps };
    }

    function _getActiveDatasetData(dsData) {
      return dsData && dsData.kind === "dataset_bundle" && dsData.datasets
        ? dsData.datasets[dsData.activeVariantId || Object.keys(dsData.datasets)[0]]
        : dsData;
    }

    function _resolveDatasetSplit(dsData, split) {
      var activeDs = _getActiveDatasetData(dsData);
      var W = typeof window !== "undefined" ? window : {};
      var srcReg = W.OSCDatasetSourceRegistry || null;
      if (srcReg && typeof srcReg.resolveDatasetSplit === "function") {
        var resolved = srcReg.resolveDatasetSplit(activeDs, split);
        if (resolved && resolved.x) return resolved;
      }
      var rec = activeDs && activeDs.records && activeDs.records[split];
      if (rec) return { x: rec.x || [], y: rec.y || [], length: (rec.x || []).length };
      var xKey = "x" + split.charAt(0).toUpperCase() + split.slice(1);
      var yKey = "y" + split.charAt(0).toUpperCase() + split.slice(1);
      return activeDs ? { x: activeDs[xKey] || [], y: activeDs[yKey] || [], length: (activeDs[xKey] || []).length } : { x: [], y: [], length: 0 };
    }

    function _resolveReferenceSplit(dsData, preferredOrder) {
      var order = Array.isArray(preferredOrder) && preferredOrder.length ? preferredOrder : ["test", "val", "train"];
      for (var i = 0; i < order.length; i++) {
        var splitName = String(order[i] || "").trim().toLowerCase();
        if (!splitName) continue;
        var split = _resolveDatasetSplit(dsData, splitName);
        if (split && Array.isArray(split.x) && split.x.length) {
          split.name = splitName;
          return split;
        }
      }
      return { name: "", x: [], y: [], length: 0 };
    }

    function _resolveFeatureSize(dsData, fallbackRows) {
      var activeDs = _getActiveDatasetData(dsData) || {};
      var W = typeof window !== "undefined" ? window : {};
      var srcReg = W.OSCDatasetSourceRegistry || null;
      var fromRegistry = srcReg && typeof srcReg.getFeatureSize === "function" ? srcReg.getFeatureSize(activeDs) : 0;
      if (Number(fromRegistry) > 0) return Number(fromRegistry);
      if (activeDs.featureSize) return Number(activeDs.featureSize);
      var rows = Array.isArray(fallbackRows) ? fallbackRows : [];
      return rows.length && Array.isArray(rows[0]) ? rows[0].length : 0;
    }

    function _makeMethodOptions() {
      return [
        { value: "auto", label: "Auto" },
        { value: "random", label: "Random Sampling" },
        { value: "reconstruct", label: "Reconstruct" },
        { value: "ddpm", label: "DDPM" },
        { value: "langevin", label: "Langevin" },
        { value: "optimize", label: "Latent Optimization" },
        { value: "classifier_guided", label: "Classifier-Guided" },
        { value: "inverse", label: "Inverse" },
      ];
    }

    // ─── Get datasets for a schema ───
    function _listDatasetsForSchema(schemaId) {
      if (!store) return [];
      return (typeof store.listDatasets === "function" ? store.listDatasets({}) : [])
        .filter(function (d) { return d.status === "ready" && (!schemaId || d.schemaId === schemaId); });
    }

    // ─── Get generation runs for a trainer ───
    function _listGenerationRuns(trainerId) {
      if (!store || typeof store.list !== "function") return [];
      return store.list({ table: "generationRuns" }).filter(function (r) { return r.trainerId === trainerId; });
    }

    // ─── LEFT PANEL ───
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Evaluations"));

      var evals = _listEvals();
      var uiEngine = getUiEngine();

      var items = evals.map(function (ev) {
        var nModels = (ev.trainerIds || []).length;
        var statusLabel = ev.status === "done" ? "\u2713 done" : ev.status === "running" ? "\u23f3 running" : "draft";
        return {
          id: ev.id,
          title: ev.name || ev.id,
          active: ev.id === _activeEvalId,
          metaLines: [ev.schemaId || "", nModels + " models", statusLabel].filter(Boolean),
          actions: [
            { id: "rename", label: "\u270e" },
            { id: "delete", label: "\u2715" },
          ],
        };
      });

      var listMount = el("div", {});
      leftEl.appendChild(listMount);
      if (uiEngine && typeof uiEngine.renderItemList === "function") {
        uiEngine.renderItemList({
          mountEl: listMount,
          items: items,
          emptyText: "No evaluations. Click + New.",
          onOpen: function (itemId) {
            _activeEvalId = itemId;
            _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          },
          onAction: function (itemId, actionId) {
            if (actionId === "rename") {
              var ev = _getEval(itemId);
              if (!ev) return;
              var newName = prompt("Rename:", ev.name || ev.id);
              if (newName && newName.trim()) { ev.name = newName.trim(); _saveEval(ev); _renderLeftPanel(); }
            } else if (actionId === "delete") {
              if (confirm("Delete this evaluation?")) { _removeEval(itemId); if (_activeEvalId === itemId) _activeEvalId = null; _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
            }
          },
        });
      }

      // + New Evaluation button
      var newBtn = el("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "+ New Evaluation");
      newBtn.addEventListener("click", function () { _openNewModal(); });
      leftEl.appendChild(newBtn);
    }

    function _openNewModal() {
      if (!modal) return;
      var _nameInput, _schemaSelect;
      modal.open({
        title: "New Evaluation",
        renderForm: function (mount) {
          var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
          mount.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Name"));
          _nameInput = el("input", { type: "text", placeholder: "benchmark_1", style: "width:100%;padding:6px 8px;margin-bottom:8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          mount.appendChild(_nameInput);
          mount.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Schema"));
          _schemaSelect = el("select", { style: "width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          schemas.forEach(function (s) { var o = el("option", { value: s.id }); o.textContent = s.label || s.id; if (s.id === (stateApi ? stateApi.getActiveSchema() : "")) o.selected = true; _schemaSelect.appendChild(o); });
          mount.appendChild(_schemaSelect);
          setTimeout(function () { _nameInput.focus(); }, 50);
        },
        onCreate: function () {
          var name = (_nameInput && _nameInput.value.trim()) || "";
          var sid = _schemaSelect ? _schemaSelect.value : "";
          if (!name) { onStatus("Enter a name"); return; }
          var id = "eval_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
          var rec = {
            id: id,
            name: name,
            schemaId: sid,
            datasetId: "",
            trainerIds: [],
            evaluatorIds: ["mae", "rmse", "r2"],
            runMode: "auto",
            weightSelection: "last",
            generationConfig: {
              runtime: "client",
              method: "auto",
              numSamples: 64,
              steps: 100,
              lr: 0.01,
              temperature: 1,
              seed: 42,
            },
            status: "draft",
            runs: [],
            createdAt: Date.now(),
          };
          _saveEval(rec);
          _activeEvalId = id;
          onStatus("Created: " + name);
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        },
      });
    }

    // ─── MAIN PANEL ───
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";

      if (!_activeEvalId) {
        mainEl.appendChild(el("div", { className: "osc-card" }, [
          el("div", { style: "font-size:13px;color:#67e8f9;font-weight:600;" }, "Multi-Model Benchmark"),
          el("div", { style: "font-size:12px;color:#94a3b8;margin-top:4px;" },
            "Create an evaluation to compare trained models on the same test set. Select a schema, add models, pick metrics, and run."),
        ]));
        return;
      }

      var ev = _getEval(_activeEvalId);
      if (!ev) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Evaluation not found.")); return; }

      // header
      var header = el("div", { className: "osc-card" });
      header.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;font-weight:600;" }, escapeHtml(ev.name)));
      header.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:2px;" },
        "Schema: " + (ev.schemaId || "none") + " | Models: " + (ev.trainerIds || []).length + " | Runs: " + (ev.runs || []).length));
      mainEl.appendChild(header);

      // show latest run results
      var runs = ev.runs || [];
      if (!runs.length) {
        mainEl.appendChild(el("div", { className: "osc-empty", style: "margin-top:8px;" }, "No results yet. Configure and run from the right panel."));
        return;
      }

      // render each run (most recent first)
      for (var ri = runs.length - 1; ri >= 0; ri--) {
        var run = runs[ri];
        var runCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
        var runTime = run.completedAt ? new Date(run.completedAt).toLocaleString() : "in progress";
        runCard.appendChild(el("div", { style: "font-size:12px;color:#67e8f9;font-weight:600;" },
          "Run #" + (ri + 1) + " \u2014 " + runTime));

        var results = run.results || [];
        if (!results.length) { runCard.appendChild(el("div", { style: "color:#64748b;font-size:11px;" }, "No results.")); mainEl.appendChild(runCard); continue; }

        // collect all metric keys
        var metricKeys = [];
        var metricKeySet = {};
        results.forEach(function (r) {
          var m = r.metrics || {};
          Object.keys(m).forEach(function (k) { if (!metricKeySet[k]) { metricKeySet[k] = true; metricKeys.push(k); } });
        });

        // comparison table
        var table = el("table", { className: "osc-metric-table", style: "width:100%;" });
        var thead = el("tr", {});
        thead.appendChild(el("th", {}, "Model"));
        metricKeys.forEach(function (k) { thead.appendChild(el("th", {}, k.toUpperCase())); });
        thead.appendChild(el("th", {}, "N"));
        thead.appendChild(el("th", {}, "Status"));
        table.appendChild(thead);

        // find best values per metric (for highlighting)
        var best = {};
        metricKeys.forEach(function (k) {
          var isLower = k === "mae" || k === "rmse" || k === "bias" || k === "recon_mse" ||
            k === "mmd_rbf" || k === "mean_gap" || k === "std_gap" ||
            k === "nn_precision" || k === "nn_coverage" || k === "diversity_gap";
          var bestVal = isLower ? Infinity : -Infinity;
          results.forEach(function (r) {
            var v = r.metrics && r.metrics[k];
            if (v == null) return;
            if (isLower ? v < bestVal : v > bestVal) bestVal = v;
          });
          best[k] = bestVal;
        });

        results.forEach(function (r) {
          var tr = el("tr", {});
          tr.appendChild(el("td", { style: "font-weight:600;color:#e2e8f0;" }, escapeHtml(r.trainerName || r.modelName || "?")));
          metricKeys.forEach(function (k) {
            var v = r.metrics && r.metrics[k];
            var isBest = v != null && v === best[k];
            var fmt = v != null ? (Math.abs(v) < 0.01 || Math.abs(v) > 1000 ? Number(v).toExponential(3) : Number(v).toFixed(4)) : "\u2014";
            tr.appendChild(el("td", { style: "color:" + (isBest ? "#4ade80" : "#cbd5e1") + ";" }, fmt));
          });
          tr.appendChild(el("td", { style: "color:#64748b;" }, String(r.testN || "\u2014")));
          var sc = r.status === "done" ? "#4ade80" : r.status === "error" ? "#f43f5e" : r.status === "skipped" ? "#64748b" : "#fbbf24";
          tr.appendChild(el("td", { style: "color:" + sc + ";" }, r.status || "pending"));
          table.appendChild(tr);
        });
        runCard.appendChild(table);

        // bar chart
        _renderBarChart(runCard, results, metricKeys);

        // module custom visualization
        _renderModuleViz(runCard, ev, run);

        mainEl.appendChild(runCard);
      }
    }

    function _renderBarChart(container, results, metricKeys, mountId) {
      var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
      if (!Plotly || !results.length || !metricKeys.length) return;

      var doneResults = results.filter(function (r) { return r.status === "done"; });
      if (!doneResults.length) return;

      var chartDiv = el("div", { style: "height:260px;margin-top:8px;" });
      container.appendChild(chartDiv);

      var names = doneResults.map(function (r) { return r.trainerName || r.modelName || "?"; });
      var colors = ["#22d3ee", "#4ade80", "#f59e0b", "#a78bfa", "#f43f5e", "#fb923c"];
      var traces = [];

      metricKeys.forEach(function (k, ki) {
        traces.push({
          x: names,
          y: doneResults.map(function (r) { return r.metrics && r.metrics[k] != null ? r.metrics[k] : 0; }),
          type: "bar", name: k.toUpperCase(),
          marker: { color: colors[ki % colors.length] },
        });
      });

      Plotly.newPlot(chartDiv, traces, {
        paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
        barmode: "group", bargap: 0.15,
        xaxis: { gridcolor: "#1e293b" }, yaxis: { title: "Value", gridcolor: "#1e293b" },
        legend: { orientation: "h", y: -0.2, font: { size: 9 } },
        margin: { t: 10, b: 60, l: 50, r: 10 },
      }, { responsive: true });
    }

    function _renderModuleViz(container, ev, run, mountId) {
      var W = typeof window !== "undefined" ? window : {};
      var dm = W.OSCDatasetModules;
      if (!dm || typeof dm.getModuleForSchema !== "function") return;
      var mods = dm.getModuleForSchema(ev.schemaId) || [];
      for (var i = 0; i < mods.length; i++) {
        var mod = dm.getModule(mods[i].id);
        if (mod && mod.playgroundApi && typeof mod.playgroundApi.renderEvaluationResults === "function") {
          var vizMount = el("div", { style: "margin-top:8px;" });
          container.appendChild(vizMount);
          var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
          mod.playgroundApi.renderEvaluationResults(vizMount, {
            results: run.results, el: el, Plotly: Plotly, schemaId: ev.schemaId,
          });
          return;
        }
      }
    }

    // ─── RIGHT PANEL ───
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      rightEl.appendChild(el("h3", {}, "Eval Config"));

      if (!_activeEvalId) {
        rightEl.appendChild(el("div", { className: "osc-empty" }, "Select or create an evaluation."));
        return;
      }

      var ev = _getEval(_activeEvalId);
      if (!ev) return;

      var configCard = el("div", { className: "osc-card" });

      // schema — locked at creation, read-only label
      configCard.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:6px;" },
        "Schema: " + escapeHtml(ev.schemaId || "none")));

      // dataset selector (filtered by schema)
      var datasets = _listDatasetsForSchema(ev.schemaId);
      var dsRow = el("div", { className: "osc-form-row" });
      dsRow.appendChild(el("label", {}, "Dataset"));
      var dsSel = el("select", { style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
      dsSel.appendChild(el("option", { value: "" }, "-- select --"));
      datasets.forEach(function (d) {
        var opt = el("option", { value: d.id }, (d.name || d.id) + " (" + (d.data && d.data.testCount ? d.data.testCount + " test" : "?") + ")");
        if (d.id === ev.datasetId) opt.selected = true;
        dsSel.appendChild(opt);
      });
      dsSel.addEventListener("change", function () { ev.datasetId = dsSel.value; _saveEval(ev); });
      dsRow.appendChild(dsSel);
      configCard.appendChild(dsRow);

      // trainer selection (checkboxes, filtered by schema)
      var trainers = _listTrainersForSchema(ev.schemaId);
      if (trainers.length) {
        configCard.appendChild(el("div", { style: "font-size:10px;color:#67e8f9;margin:8px 0 4px;font-weight:600;" }, "Models"));
        trainers.forEach(function (t) {
          var row = el("div", { style: "display:flex;align-items:center;gap:6px;margin-bottom:3px;" });
          var cb = el("input", { type: "checkbox" });
          cb.checked = (ev.trainerIds || []).indexOf(t.id) >= 0;
          cb.addEventListener("change", function () {
            if (cb.checked) {
              if ((ev.trainerIds || []).indexOf(t.id) < 0) { ev.trainerIds = (ev.trainerIds || []).concat([t.id]); }
            } else {
              ev.trainerIds = (ev.trainerIds || []).filter(function (id) { return id !== t.id; });
            }
            _saveEval(ev);
          });
          row.appendChild(cb);
          var statusTag = t.status === "done" ? "\u2713" : t.status === "training" ? "\u23f3" : "\u25cb";
          var statusColor = t.status === "done" ? "#4ade80" : t.status === "training" ? "#fbbf24" : "#64748b";
          row.appendChild(el("span", { style: "font-size:11px;color:" + statusColor + ";" }, statusTag));
          row.appendChild(el("span", { style: "font-size:11px;color:#e2e8f0;" }, (t.name || t.id)));
          if (t.metrics && t.metrics.mae != null) {
            row.appendChild(el("span", { style: "font-size:9px;color:#64748b;" }, "MAE=" + Number(t.metrics.mae).toExponential(2)));
          }
          configCard.appendChild(row);
        });
      } else {
        configCard.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin:8px 0;" }, "No models for this schema."));
      }

      // warn about untrained models
      var untrainedSelected = (ev.trainerIds || []).filter(function (tid) {
        var t = store ? store.getTrainerCard(tid) : null;
        return !t || t.status !== "done" || !t.modelArtifacts;
      });
      if (untrainedSelected.length) {
        configCard.appendChild(el("div", { style: "margin-top:6px;padding:6px;background:#1c1917;border:1px solid #854d0e;border-radius:4px;font-size:10px;color:#fbbf24;" },
          untrainedSelected.length + " selected model(s) not trained yet \u2014 they will be skipped."));
      }

      // evaluator selection
      var isClassification = false;
      if (ev.schemaId && schemaRegistry) {
        var outputKeys = schemaRegistry.getOutputKeys(ev.schemaId);
        var defHt = outputKeys && outputKeys[0] ? (outputKeys[0].headType || "regression") : "regression";
        isClassification = defHt === "classification";
      }
      var allEvaluators = _getAllEvaluators(ev.schemaId, isClassification);
      if (allEvaluators.length) {
        configCard.appendChild(el("div", { style: "font-size:10px;color:#67e8f9;margin:8px 0 4px;font-weight:600;" }, "Metrics"));
        allEvaluators.forEach(function (evl) {
          var row = el("div", { style: "display:flex;align-items:center;gap:6px;margin-bottom:2px;" });
          var cb = el("input", { type: "checkbox" });
          cb.checked = (ev.evaluatorIds || []).indexOf(evl.id) >= 0;
          cb.addEventListener("change", function () {
            if (cb.checked) {
              if ((ev.evaluatorIds || []).indexOf(evl.id) < 0) { ev.evaluatorIds = (ev.evaluatorIds || []).concat([evl.id]); }
            } else {
              ev.evaluatorIds = (ev.evaluatorIds || []).filter(function (id) { return id !== evl.id; });
            }
            _saveEval(ev);
          });
          row.appendChild(cb);
          var badge = evl.mode === "generation" ? " (gen)" : evl.mode === "both" ? " (all)" : "";
          row.appendChild(el("span", { style: "font-size:11px;color:#cbd5e1;" }, evl.name + badge));
          configCard.appendChild(row);
        });
      }

      var modeRow = el("div", { className: "osc-form-row", style: "margin-top:8px;" });
      modeRow.appendChild(el("label", {}, "Run Mode"));
      var modeSel = el("select", { style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
      [
        { value: "auto", label: "Auto" },
        { value: "predict", label: "Predictive only" },
        { value: "generate", label: "Generative only" },
        { value: "both", label: "Both" },
      ].forEach(function (opt) {
        var o = el("option", { value: opt.value }, opt.label);
        if (opt.value === String(ev.runMode || "auto")) o.selected = true;
        modeSel.appendChild(o);
      });
      modeSel.addEventListener("change", function () { ev.runMode = modeSel.value; _saveEval(ev); _renderRightPanel(); });
      modeRow.appendChild(modeSel);
      configCard.appendChild(modeRow);

      var selectedEvaluatorDefs = allEvaluators.filter(function (item) { return (ev.evaluatorIds || []).indexOf(item.id) >= 0; });
      var hasGenerationMetrics = selectedEvaluatorDefs.some(function (item) { return item.mode === "generation" || item.mode === "both"; });

      var selectedTrainerCards = (ev.trainerIds || []).map(function (tid) { return store ? store.getTrainerCard(tid) : null; }).filter(Boolean);
      var hasBestWeights = selectedTrainerCards.some(function (t) { return !!t.modelArtifactsBest; });
      var weightRow = el("div", { className: "osc-form-row", style: "margin-top:8px;" });
      weightRow.appendChild(el("label", {}, "Weights"));
      var weightSel = el("select", { style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
      [{ value: "last", label: "Last epoch" }, { value: "best", label: "Best loss" }].forEach(function (opt) {
        var o = el("option", { value: opt.value }, opt.label);
        if (opt.value === String(ev.weightSelection || "last")) o.selected = true;
        if (opt.value === "best" && !hasBestWeights) o.disabled = true;
        weightSel.appendChild(o);
      });
      weightSel.addEventListener("change", function () { ev.weightSelection = weightSel.value; _saveEval(ev); });
      weightRow.appendChild(weightSel);
      configCard.appendChild(weightRow);

      var showGenSettings = String(ev.runMode || "auto") !== "predict" || hasGenerationMetrics;
      if (showGenSettings) {
        if (!ev.generationConfig) ev.generationConfig = {};
        if (!ev.generationConfig.runtime) ev.generationConfig.runtime = "client";
        if (!ev.generationConfig.method) ev.generationConfig.method = "auto";
        if (!Number.isFinite(Number(ev.generationConfig.numSamples))) ev.generationConfig.numSamples = 64;
        if (!Number.isFinite(Number(ev.generationConfig.steps))) ev.generationConfig.steps = 100;
        if (!Number.isFinite(Number(ev.generationConfig.lr))) ev.generationConfig.lr = 0.01;
        if (!Number.isFinite(Number(ev.generationConfig.temperature))) ev.generationConfig.temperature = 1;
        if (!Number.isFinite(Number(ev.generationConfig.seed))) ev.generationConfig.seed = 42;

        configCard.appendChild(el("div", { style: "font-size:10px;color:#67e8f9;margin:8px 0 4px;font-weight:600;" }, "Generation Settings"));

        var genRuntimeRow = el("div", { className: "osc-form-row" });
        genRuntimeRow.appendChild(el("label", {}, "Generation Runtime"));
        var genRuntimeSel = el("select", { style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
        [{ value: "client", label: "Client (TF.js)" }, { value: "server", label: "Server (PyTorch)" }].forEach(function (opt) {
          var o = el("option", { value: opt.value }, opt.label);
          if (opt.value === String(ev.generationConfig.runtime || "client")) o.selected = true;
          genRuntimeSel.appendChild(o);
        });
        genRuntimeSel.addEventListener("change", function () { ev.generationConfig.runtime = genRuntimeSel.value; _saveEval(ev); });
        genRuntimeRow.appendChild(genRuntimeSel);
        configCard.appendChild(genRuntimeRow);

        var genMethodRow = el("div", { className: "osc-form-row" });
        genMethodRow.appendChild(el("label", {}, "Generation Method"));
        var genMethodSel = el("select", { style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
        _makeMethodOptions().forEach(function (opt) {
          var o = el("option", { value: opt.value }, opt.label);
          if (opt.value === String(ev.generationConfig.method || "auto")) o.selected = true;
          genMethodSel.appendChild(o);
        });
        genMethodSel.addEventListener("change", function () { ev.generationConfig.method = genMethodSel.value; _saveEval(ev); });
        genMethodRow.appendChild(genMethodSel);
        configCard.appendChild(genMethodRow);

        [
          { key: "numSamples", label: "Samples", min: 1, max: 512, step: 1 },
          { key: "steps", label: "Steps", min: 1, max: 1000, step: 1 },
          { key: "lr", label: "Learning rate", min: 0.0001, max: 1, step: 0.001 },
          { key: "temperature", label: "Temperature", min: 0.01, max: 5, step: 0.1 },
          { key: "seed", label: "Seed", min: 1, step: 1 },
        ].forEach(function (field) {
          var row = el("div", { className: "osc-form-row" });
          row.appendChild(el("label", {}, field.label));
          var inp = el("input", { type: "number", value: String(ev.generationConfig[field.key]), style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
          if (field.min != null) inp.min = field.min;
          if (field.max != null) inp.max = field.max;
          if (field.step != null) inp.step = field.step;
          inp.addEventListener("change", function () {
            ev.generationConfig[field.key] = Number(inp.value);
            _saveEval(ev);
          });
          row.appendChild(inp);
          configCard.appendChild(row);
        });

        configCard.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin-top:4px;" },
          "Generative evaluation samples fresh outputs from the selected checkpoint and compares them to the best available dataset reference split: test, then val, then train."));
      }

      rightEl.appendChild(configCard);

      // action buttons
      var btnRow = el("div", { style: "display:flex;gap:4px;margin-top:8px;" });
      var runBtn = el("button", { className: "osc-btn", style: "flex:1;" }, _isRunning ? "Running..." : "Run Evaluation");
      if (_isRunning) runBtn.disabled = true;
      runBtn.addEventListener("click", function () { _handleRun(); });
      btnRow.appendChild(runBtn);
      rightEl.appendChild(btnRow);

      // show run count
      if (ev.runs && ev.runs.length) {
        rightEl.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin-top:6px;text-align:center;" },
          ev.runs.length + " run(s) completed"));
      }
    }

    // ─── RUN BENCHMARK ───
    function _handleRun() {
      if (_isRunning) return;
      var ev = _getEval(_activeEvalId);
      if (!ev) return;
      if (!ev.trainerIds || !ev.trainerIds.length) { onStatus("Select at least one model"); return; }
      if (!ev.datasetId) { onStatus("Select a dataset"); return; }
      if (!ev.evaluatorIds || !ev.evaluatorIds.length) { onStatus("Select at least one metric"); return; }

      var tf = getTf();
      var pc = predictionCore || (typeof window !== "undefined" && window.OSCPredictionCore) || null;
      if (!tf || !modelBuilder) { onStatus("TF.js or model builder not available"); return; }

      _isRunning = true;
      onStatus("Running evaluation...");
      var currentMountId = ++_mountId;

      var run = {
        startedAt: Date.now(),
        results: ev.trainerIds.map(function (tid) {
          var t = store.getTrainerCard(tid);
          var m = t ? store.getModel(t.modelId) : null;
          return { trainerId: tid, trainerName: t ? t.name : tid, modelName: m ? m.name : "", status: "pending", metrics: {}, testN: 0 };
        }),
      };
      if (!ev.runs) ev.runs = [];
      ev.runs.push(run);
      ev.status = "running";
      _saveEval(ev);
      _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();

      var idx = 0;
      function evalNext() {
        if (idx >= ev.trainerIds.length || currentMountId !== _mountId) {
          run.completedAt = Date.now();
          ev.status = "done";
          _isRunning = false;
          _saveEval(ev);
          onStatus("Evaluation complete: " + run.results.length + " models");
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          return;
        }

        var tid = ev.trainerIds[idx];
        var r = run.results[idx];
        r.status = "running";
        _saveEval(ev);
        _renderMainPanel();

        _evaluateOneModel(tf, pc, ev, r, tid).then(function () {
          _saveEval(ev);
          _renderMainPanel();
          onStatus("Evaluated " + (idx + 1) + "/" + ev.trainerIds.length + ": " + r.trainerName);
          idx++;
          setTimeout(evalNext, 50);
        });
      }
      evalNext();
    }

    function _getServerAdapter() { var W = typeof window !== "undefined" ? window : {}; return W.OSCServerRuntimeAdapter || null; }

    function _resolveSelectedEvaluators(ev, isClassification) {
      var selectedIds = ev && ev.evaluatorIds ? ev.evaluatorIds : [];
      return _getAllEvaluators(ev && ev.schemaId, isClassification).filter(function (item) {
        return selectedIds.indexOf(item.id) >= 0;
      });
    }

    function _resolveRunNeeds(ev, selectedEvaluatorDefs) {
      var mode = String((ev && ev.runMode) || "auto").trim().toLowerCase();
      var defs = Array.isArray(selectedEvaluatorDefs) ? selectedEvaluatorDefs : [];
      var hasPredictive = defs.some(function (item) { return String(item && item.mode || "test") !== "generation"; });
      var hasGenerative = defs.some(function (item) {
        var itemMode = String(item && item.mode || "test");
        return itemMode === "generation" || itemMode === "both";
      });
      if (mode === "predict") return { predictive: true, generative: false };
      if (mode === "generate") return { predictive: false, generative: true };
      if (mode === "both") return { predictive: hasPredictive, generative: hasGenerative };
      return { predictive: hasPredictive, generative: hasGenerative };
    }

    function _resolveGenerationMethod(meta, requested) {
      var req = String(requested || "auto").trim().toLowerCase();
      if (req && req !== "auto") return req;
      var info = meta && meta.info ? meta.info : {};
      if (info.canRandomSample) return "random";
      if (info.canDDPM) return "ddpm";
      if (info.canLangevin) return "langevin";
      if (info.canReconstruct) return "reconstruct";
      if (info.canInverse) return "inverse";
      return String((meta && meta.caps && meta.caps.defaultMethod) || info.defaultMethod || "reconstruct");
    }

    function _resolveActualWeightSelection(trainer, artifacts, requested) {
      var req = String(requested || "last").trim().toLowerCase();
      if (!trainer) return req || "last";
      if (req === "best" && trainer.modelArtifactsBest && artifacts === trainer.modelArtifactsBest) return "best";
      if (trainer.modelArtifactsLast && artifacts === trainer.modelArtifactsLast) return "last";
      if (trainer.modelArtifacts && artifacts === trainer.modelArtifacts) return req === "best" && trainer.modelArtifactsBest ? "best" : "last";
      return req || "last";
    }

    function _applyPredictionMetrics(pc, r, selectedIds, allPreds, testY, testN, nCls, isClassification) {
      if (!pc) return;
      if (isClassification) {
        var predLabels = allPreds.map(function (p) { return p.indexOf(Math.max.apply(null, p)); });
        var trueLabels = testY.map(function (y) { return Array.isArray(y) ? y.indexOf(Math.max.apply(null, y)) : Number(y); });
        var correct = 0;
        for (var ci = 0; ci < testN; ci++) if (predLabels[ci] === trueLabels[ci]) correct++;
        if (selectedIds.indexOf("accuracy") >= 0) r.metrics.accuracy = correct / testN;
        if (selectedIds.indexOf("macro_f1") >= 0 && pc.confusionMatrix) {
          var cm = pc.confusionMatrix(trueLabels, predLabels, nCls);
          var prf = pc.precisionRecallF1(cm);
          r.metrics.macro_f1 = prf.reduce(function (s, p) { return s + p.f1; }, 0) / Math.max(1, nCls);
        }
        return;
      }

      var truthFlat = [];
      var predFlat = [];
      for (var mi = 0; mi < testN; mi++) {
        var yt = testY[mi];
        var pp = allPreds[mi];
        if (Array.isArray(yt) && yt.length > 1) {
          for (var d = 0; d < yt.length; d++) {
            truthFlat.push(Number(yt[d] || 0));
            predFlat.push(Number((pp && pp[d]) || 0));
          }
        } else {
          truthFlat.push(Number(Array.isArray(yt) ? yt[0] : yt || 0));
          predFlat.push(Number(Array.isArray(pp) ? pp[0] : pp || 0));
        }
      }
      var reg = pc.computeRegressionMetrics(truthFlat, predFlat);
      if (selectedIds.indexOf("mae") >= 0) r.metrics.mae = reg.mae;
      if (selectedIds.indexOf("rmse") >= 0) r.metrics.rmse = reg.rmse;
      if (selectedIds.indexOf("bias") >= 0) r.metrics.bias = reg.bias;
      if (selectedIds.indexOf("r2") >= 0) r.metrics.r2 = pc.r2Score(truthFlat, predFlat);
    }

    function _applyGenerationMetrics(pc, r, selectedIds, comparison, generationResult) {
      if (selectedIds.indexOf("recon_mse") >= 0 && generationResult && generationResult.avgMse != null) r.metrics.recon_mse = Number(generationResult.avgMse);
      if (!comparison) return;
      if (selectedIds.indexOf("mmd_rbf") >= 0) r.metrics.mmd_rbf = Number(comparison.mmdRbf || 0);
      if (selectedIds.indexOf("mean_gap") >= 0) r.metrics.mean_gap = Number(comparison.meanGap || 0);
      if (selectedIds.indexOf("std_gap") >= 0) r.metrics.std_gap = Number(comparison.stdGap || 0);
      if (selectedIds.indexOf("nn_precision") >= 0) r.metrics.nn_precision = Number(comparison.nnPrecision || 0);
      if (selectedIds.indexOf("nn_coverage") >= 0) r.metrics.nn_coverage = Number(comparison.nnCoverage || 0);
      if (selectedIds.indexOf("diversity_gap") >= 0) r.metrics.diversity_gap = Number(comparison.diversityGap || 0);
      if (selectedIds.indexOf("diversity") >= 0) r.metrics.diversity = Number(comparison.diversity || 0);
    }

    function _applyModuleMetrics(schemaId, selectedIds, r, context) {
      var moduleEvals = _getModuleEvaluators(schemaId);
      moduleEvals.forEach(function (mev) {
        if (selectedIds.indexOf(mev.id) < 0 || typeof mev.compute !== "function") return;
        try {
          var result = mev.compute(context);
          if (result && result.value != null) r.metrics[mev.id] = result.value;
        } catch (_) {}
      });
    }

    function _runPredictiveEvaluation(tf, trainer, modelRec, artifacts, allowedOutputKeys, defaultTarget, nCls, featureSize, testX, useServer) {
      var serverAdapter = _getServerAdapter();
      if (useServer && serverAdapter) {
        var serverUrl = (trainer.config && trainer.config.serverUrl) || "";
        return serverAdapter.checkServer(serverUrl).then(function (ok) {
          if (!ok) return null;
          return serverAdapter.predictOnServer({
            graph: modelRec.graph,
            weightValues: artifacts && artifacts.weightValues,
            weightSpecs: artifacts && artifacts.weightSpecs,
            checkpoint: artifacts && artifacts.checkpoint,
            featureSize: featureSize,
            targetSize: featureSize,
            numClasses: nCls,
            xInput: testX,
          }, serverUrl).then(function (result) {
            return result && result.predictions ? result.predictions : [];
          }).catch(function () {
            return null;
          });
        });
      }

      return Promise.resolve().then(function () {
        var graphMode = modelBuilder.inferGraphMode(modelRec.graph, "direct");
        var built = modelBuilder.buildModelFromGraph(tf, modelRec.graph, {
          mode: graphMode,
          featureSize: featureSize,
          windowSize: 1,
          seqFeatureSize: featureSize,
          allowedOutputKeys: allowedOutputKeys,
          defaultTarget: defaultTarget,
          numClasses: nCls,
        });
        _loadWeights(tf, built.model, artifacts);
        var allPreds = [];
        var batchSize = 256;
        for (var bi = 0; bi < testX.length; bi += batchSize) {
          var bEnd = Math.min(bi + batchSize, testX.length);
          var bt = tf.tensor2d(testX.slice(bi, bEnd));
          var br = built.model.predict(bt);
          allPreds = allPreds.concat((Array.isArray(br) ? br[0] : br).arraySync());
          bt.dispose();
          if (Array.isArray(br)) br.forEach(function (t) { t.dispose(); }); else br.dispose();
        }
        built.model.dispose();
        return allPreds;
      });
    }

    function _runGenerativeEvaluation(tf, trainer, modelRec, dataset, artifacts, ev, meta, featureSize, nCls) {
      var engine = getGenerationEngine();
      var serverAdapter = _getServerAdapter();
      if (!engine) return Promise.reject(new Error("Generation engine not available"));

      var gCfg = ev && ev.generationConfig ? ev.generationConfig : {};
      var method = _resolveGenerationMethod(meta, gCfg.method);
      var generationRuntime = String(gCfg.runtime || "client").trim().toLowerCase() === "server" ? "server" : "client";
      var dsData = dataset && dataset.data ? dataset.data : {};
      var activeDs = _getActiveDatasetData(dsData);
      var testSplit = _resolveReferenceSplit(dsData, ["test", "val", "train"]);
      var testX = testSplit.x || [];
      var testY = testSplit.y || [];
      var numSamples = Math.max(1, Number(gCfg.numSamples) || 64);
      var steps = Math.max(1, Number(gCfg.steps) || 100);
      var seed = Number(gCfg.seed) || 42;
      var lr = Number(gCfg.lr || 0.01);
      var temperature = Number(gCfg.temperature || 1);
      var allowedOutputKeys = schemaRegistry ? schemaRegistry.getOutputKeys(ev.schemaId) : [];
      var defaultTarget = (allowedOutputKeys[0] && (allowedOutputKeys[0].key || allowedOutputKeys[0])) || "";
      var graphMode = modelBuilder.inferGraphMode(modelRec.graph, "direct");

      function buildServerConfig() {
        var config = {
          graph: modelRec.graph,
          weightValues: artifacts && artifacts.weightValues,
          weightSpecs: artifacts && artifacts.weightSpecs,
          checkpoint: artifacts && artifacts.checkpoint,
          featureSize: featureSize,
          targetSize: featureSize,
          numClasses: nCls,
          method: method,
          numSamples: numSamples,
          steps: steps,
          lr: lr,
          latentDim: modelBuilder.extractLatentInfo ? (modelBuilder.extractLatentInfo(modelRec.graph).latentDim || featureSize) : featureSize,
          temperature: temperature,
          seed: seed,
          targetClass: Number(gCfg.targetClass || 0),
          guidanceWeight: Number(gCfg.guidanceWeight || 1.0),
          sampleNodeId: "",
          outputNodeId: "",
        };
        if (method === "reconstruct" || method === "optimize") config.originals = testX.slice(0, numSamples);
        if (method === "inverse") {
          var targets = [];
          var targetCount = Math.min(numSamples, testY.length);
          for (var i = 0; i < targetCount; i++) targets.push(Array.isArray(testY[i]) ? testY[i] : [testY[i]]);
          config.target = targets;
        }
        return config;
      }

      function buildClientConfig(built, outputIndex, sampleInputIndex, latentDim, genModel) {
        var cfg = {
          method: method,
          model: genModel,
          latentDim: latentDim,
          numSamples: numSamples,
          steps: steps,
          lr: lr,
          temperature: temperature,
          seed: seed,
          outputIndex: outputIndex,
          sampleInputIndex: sampleInputIndex,
        };
        if (method === "classifier_guided") {
          cfg.classifierModel = built.model;
          cfg.targetClass = Number(gCfg.targetClass || 0);
          cfg.guidanceWeight = Number(gCfg.guidanceWeight || 1.0);
        }
        if (method === "reconstruct") {
          cfg.fullModel = built.model;
          cfg.model = built.model;
          cfg.originals = testX.slice(0, numSamples);
        }
        if (method === "optimize") {
          cfg.objective = engine.objectives && typeof engine.objectives.reconstruction === "function"
            ? engine.objectives.reconstruction(testX.slice(0, numSamples), outputIndex)
            : null;
          if (!cfg.objective) throw new Error("Optimize evaluation requires generation objectives");
        }
        if (method === "langevin") cfg.scoreModel = built.model;
        if (method === "inverse") {
          var targets = [];
          var targetCount = Math.min(numSamples, testY.length);
          for (var i = 0; i < targetCount; i++) targets.push(Array.isArray(testY[i]) ? testY[i] : [testY[i]]);
          cfg.target = targets;
        }
        return cfg;
      }

      if (generationRuntime === "server") {
        if (!serverAdapter) return Promise.reject(new Error("Server runtime adapter unavailable"));
        var serverUrl = (trainer.config && trainer.config.serverUrl) || "";
        return serverAdapter.checkServer(serverUrl).then(function (ok) {
          if (!ok) throw new Error("Server not reachable");
          return serverAdapter.generateOnServer(buildServerConfig(), serverUrl);
        }).then(function (result) {
          result = result || {};
          result.method = result.method || method;
          result.runtime = "server";
          result.checkpointRef = _getCheckpointRef(artifacts);
          result.weightSelection = _resolveActualWeightSelection(trainer, artifacts, ev.weightSelection);
          return result;
        });
      }

      return Promise.resolve().then(function () {
        var built = modelBuilder.buildModelFromGraph(tf, modelRec.graph, {
          mode: graphMode,
          featureSize: featureSize,
          windowSize: 1,
          seqFeatureSize: featureSize,
          allowedOutputKeys: allowedOutputKeys,
          defaultTarget: defaultTarget,
          numClasses: nCls,
        });
        _loadWeights(tf, built.model, artifacts);

        var genModel = built.model;
        var latentInfo = modelBuilder.extractLatentInfo ? modelBuilder.extractLatentInfo(modelRec.graph) : { latentDim: featureSize };
        var latentDim = latentInfo.latentDim || featureSize;
        var genNodes = { sampleNodes: meta.info.sampleNodes || [], outputNodes: meta.info.outputNodes || [] };
        var sampleInputIndex = -1;
        var outputIndex = 0;

        if (genNodes.sampleNodes.length) {
          latentDim = genNodes.sampleNodes[0].dim || latentDim;
          if (built.inputNodes) {
            for (var si = 0; si < built.inputNodes.length; si++) {
              if (built.inputNodes[si].id === genNodes.sampleNodes[0].id) { sampleInputIndex = si; break; }
            }
          }
        }

        if (genNodes.outputNodes.length > 1 && built.headConfigs) {
          var passthrough = genNodes.outputNodes.find(function (item) { return item.loss === "none"; }) || genNodes.outputNodes[0];
          for (var oi = 0; oi < built.headConfigs.length; oi++) {
            if (built.headConfigs[oi].id && built.headConfigs[oi].id.indexOf(passthrough.id + ":") === 0) {
              outputIndex = oi;
              break;
            }
          }
        }

        if (meta.info.hasLatentDecoder && method !== "inverse" && method !== "reconstruct") {
          try {
            var decoder = modelBuilder.extractDecoder(tf, built.model, latentDim);
            if (decoder && decoder.model) {
              genModel = decoder.model;
              latentDim = decoder.latentDim || latentDim;
              outputIndex = 0;
            }
          } catch (_) {}
        }

        var clientConfig = buildClientConfig(built, outputIndex, sampleInputIndex, latentDim, genModel);
        return engine.generate(tf, clientConfig).then(function (result) {
          result = result || {};
          result.method = result.method || method;
          result.runtime = "client";
          result.checkpointRef = _getCheckpointRef(artifacts);
          result.weightSelection = _resolveActualWeightSelection(trainer, artifacts, ev.weightSelection);
          if (genModel !== built.model) try { genModel.dispose(); } catch (_) {}
          built.model.dispose();
          return result;
        }).catch(function (err) {
          if (genModel !== built.model) try { genModel.dispose(); } catch (_) {}
          built.model.dispose();
          throw err;
        });
      });
    }

    function _evaluateOneModel(tf, pc, ev, r, tid) {
      var trainer = store.getTrainerCard(tid);
      if (!trainer) { r.status = "error"; r.error = "Trainer not found"; return Promise.resolve(); }
      var modelRec = store.getModel(trainer.modelId);
      var dataset = store.getDataset(ev.datasetId);
      r.modelName = modelRec ? modelRec.name : trainer.modelId;
      r.metrics = r.metrics || {};

      var artifacts = _getTrainerArtifacts(trainer, ev.weightSelection);
      if (!artifacts) { r.status = "skipped"; r.error = "Not trained"; return Promise.resolve(); }
      if (!modelRec || !modelRec.graph || !dataset || !dataset.data) {
        r.status = "error"; r.error = "Missing model or dataset"; return Promise.resolve();
      }

      var schemaId = ev.schemaId;
      var allowedOutputKeys = schemaRegistry ? schemaRegistry.getOutputKeys(schemaId) : [];
      var defaultTarget = (allowedOutputKeys[0] && (allowedOutputKeys[0].key || allowedOutputKeys[0])) || "";
      var defHeadType = (allowedOutputKeys[0] && allowedOutputKeys[0].headType) || "regression";
      var isClassification = defHeadType === "classification";
      var selectedEvaluatorDefs = _resolveSelectedEvaluators(ev, isClassification);
      var runNeeds = _resolveRunNeeds(ev, selectedEvaluatorDefs);
      var selectedIds = ev.evaluatorIds || [];
      var dsData = dataset.data;
      var activeDs = _getActiveDatasetData(dsData);
      var nCls = activeDs.classCount || activeDs.numClasses || 10;
      var testSplit = _resolveReferenceSplit(dsData, ["test", "val", "train"]);
      var testX = testSplit.x || [];
      var testY = testSplit.y || [];
      var featureSize = _resolveFeatureSize(dsData, testX) || 1;
      var testN = testX.length;

      if (isClassification && testY.length && typeof testY[0] === "number") {
        testY = testY.map(function (l) { var a = new Array(nCls).fill(0); a[l] = 1; return a; });
      }
      if ((runNeeds.predictive || runNeeds.generative) && !testN) {
        r.status = "error";
        r.error = "No test data";
        return Promise.resolve();
      }

      var meta = _resolveGenerationMeta(modelRec);
      var actualWeightSelection = _resolveActualWeightSelection(trainer, artifacts, ev.weightSelection);
      r.testN = testN;
      r.referenceSplit = testSplit.name || "none";
      r.weightSelection = actualWeightSelection;
      r.checkpointRef = _getCheckpointRef(artifacts);
      r.checkpointRuntime = String((artifacts && artifacts.producerRuntime) || (artifacts && artifacts.checkpoint && artifacts.checkpoint.producerRuntime) || (trainer.trainedOnServer ? "python_server" : "js_client"));

      var predictiveResult = null;
      var generationResult = null;
      var comparison = null;
      var useServerPredict = !!(trainer.trainedOnServer && trainer.config && trainer.config.useServer);

      return Promise.resolve()
        .then(function () {
          if (!runNeeds.predictive) return null;
          return _runPredictiveEvaluation(tf, trainer, modelRec, artifacts, allowedOutputKeys, defaultTarget, nCls, featureSize, testX, useServerPredict);
        })
        .then(function (allPreds) {
          predictiveResult = allPreds;
          if (runNeeds.predictive && allPreds == null) {
            return _runPredictiveEvaluation(tf, trainer, modelRec, artifacts, allowedOutputKeys, defaultTarget, nCls, featureSize, testX, false);
          }
          return allPreds;
        })
        .then(function (allPreds) {
          predictiveResult = allPreds;
          if (runNeeds.predictive && Array.isArray(allPreds)) {
            _applyPredictionMetrics(pc, r, selectedIds, allPreds, testY, testN, nCls, isClassification);
          }
          if (!runNeeds.generative) return null;
          return _runGenerativeEvaluation(tf, trainer, modelRec, dataset, artifacts, ev, meta, featureSize, nCls);
        })
        .then(function (genResult) {
          generationResult = genResult;
          if (runNeeds.generative && genResult && pc && typeof pc.computeSetComparisonMetrics === "function") {
            comparison = pc.computeSetComparisonMetrics(testX, genResult.samples || [], {
              seed: Number((ev.generationConfig && ev.generationConfig.seed) || 42),
              referenceLimit: 128,
              generatedLimit: Math.max(16, Number((ev.generationConfig && ev.generationConfig.numSamples) || 64)),
              pairwiseLimit: 64,
              nnReferenceLimit: 128,
              nnGeneratedLimit: 128,
              mmdReferenceLimit: 64,
              mmdGeneratedLimit: 64,
            });
            _applyGenerationMetrics(pc, r, selectedIds, comparison, genResult);
            r.generation = {
              method: genResult.method,
              runtime: genResult.runtime,
              numSamples: genResult.numSamples || ((genResult.samples && genResult.samples.length) || 0),
              checkpointRef: genResult.checkpointRef || r.checkpointRef,
              weightSelection: genResult.weightSelection || actualWeightSelection,
            };
          }
          _applyModuleMetrics(schemaId, selectedIds, r, {
            predictions: predictiveResult,
            truth: testY,
            samples: generationResult && generationResult.samples ? generationResult.samples : null,
            originals: generationResult && generationResult.originals ? generationResult.originals : null,
            referenceSamples: testX,
            datasetData: activeDs,
            trainer: trainer,
            generationMethod: generationResult && generationResult.method,
            generationRuntime: generationResult && generationResult.runtime,
            comparisonMetrics: comparison,
          });
          r.status = "done";
        })
        .catch(function (err) {
          r.status = "error";
          r.error = err && err.message ? err.message : String(err || "Evaluation failed");
        });
    }

    function _loadWeights(tf, model, artifacts) {
      var converter = (typeof window !== "undefined" && window.OSCWeightConverter) ? window.OSCWeightConverter : null;
      if (!converter || typeof converter.loadArtifactsIntoModel !== "function") return;
      converter.loadArtifactsIntoModel(tf, model, artifacts);
    }

    function mount() { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
    function unmount() { _mountId++; layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

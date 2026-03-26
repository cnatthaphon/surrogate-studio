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
      list.push({ id: "diversity", name: "Sample Diversity", mode: "generation" });
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
          var rec = { id: id, name: name, schemaId: sid, datasetId: "", trainerIds: [], evaluatorIds: ["mae", "rmse", "r2"], status: "draft", runs: [], createdAt: Date.now() };
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
          var isLower = k === "mae" || k === "rmse" || k === "bias" || k === "recon_mse";
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
        var defTarget = outputKeys && outputKeys[0] ? (outputKeys[0].key || outputKeys[0]) : "x";
        isClassification = defTarget === "label" || defTarget === "logits";
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

    function _evaluateOneModel(tf, pc, ev, r, tid) {
      var trainer = store.getTrainerCard(tid);
      if (!trainer) { r.status = "error"; r.error = "Trainer not found"; return Promise.resolve(); }
      var modelRec = store.getModel(trainer.modelId);
      var dataset = store.getDataset(ev.datasetId);
      r.modelName = modelRec ? modelRec.name : trainer.modelId;

      if (trainer.status !== "done" || !trainer.modelArtifacts) {
        r.status = "skipped"; r.error = "Not trained"; return Promise.resolve();
      }
      if (!modelRec || !modelRec.graph || !dataset || !dataset.data) {
        r.status = "error"; r.error = "Missing model or dataset"; return Promise.resolve();
      }

      var schemaId = ev.schemaId;
      var allowedOutputKeys = schemaRegistry ? schemaRegistry.getOutputKeys(schemaId) : ["x"];
      var defaultTarget = (allowedOutputKeys[0] && (allowedOutputKeys[0].key || allowedOutputKeys[0])) || "x";
      var isClassification = defaultTarget === "label" || defaultTarget === "logits";

      var dsData = dataset.data;
      var isBundle = dsData.kind === "dataset_bundle" && dsData.datasets;
      var activeDs = isBundle ? dsData.datasets[dsData.activeVariantId || Object.keys(dsData.datasets)[0]] : dsData;
      var nCls = activeDs.classCount || activeDs.numClasses || 10;

      // resolve test data via source registry or legacy
      var W = typeof window !== "undefined" ? window : {};
      var srcReg = W.OSCDatasetSourceRegistry || null;
      var testSplit;
      if (srcReg && typeof srcReg.resolveDatasetSplit === "function") {
        testSplit = srcReg.resolveDatasetSplit(activeDs, "test");
      } else {
        var testXLegacy = activeDs.xTest || (activeDs.records && activeDs.records.test && activeDs.records.test.x) || [];
        var testYLegacy = activeDs.yTest || (activeDs.records && activeDs.records.test && activeDs.records.test.y) || [];
        testSplit = { x: testXLegacy, y: testYLegacy, length: testXLegacy.length };
      }
      var testX = testSplit.x;
      var testY = testSplit.y;
      var featureSize = (srcReg && typeof srcReg.getFeatureSize === "function") ? srcReg.getFeatureSize(activeDs) : 0;
      if (!featureSize && testX.length) featureSize = testX[0].length;
      if (!featureSize) featureSize = 1;

      if (isClassification && testY.length && typeof testY[0] === "number") {
        testY = testY.map(function (l) { var a = new Array(nCls).fill(0); a[l] = 1; return a; });
      }

      var testN = testX.length;
      if (!testN) { r.status = "error"; r.error = "No test data"; return Promise.resolve(); }

      // try server if model was server-trained, fallback to client if unreachable
      if (trainer.trainedOnServer || (trainer.config && trainer.config.useServer)) {
        var serverAdapter = _getServerAdapter();
        if (serverAdapter) {
          var serverUrl = (trainer.config && trainer.config.serverUrl) || "";
          return serverAdapter.checkServer(serverUrl).then(function (ok) {
            if (!ok) {
              r.status = "error"; r.error = "Server not reachable \u2014 retrain on client or restart server";
              return;
            }
            return serverAdapter.predictOnServer({
              graph: modelRec.graph, weightValues: trainer.modelArtifacts.weightValues,
              featureSize: featureSize, targetSize: featureSize, numClasses: nCls,
              xInput: testX,
            }, serverUrl).then(function (result) {
              var allPreds = result.predictions || [];
              _computeMetrics(pc, r, ev, allPreds, testX, testY, testN, nCls, isClassification, activeDs, schemaId);
            }).catch(function (err) {
              r.status = "error"; r.error = "Server error: " + err.message + " \u2014 retrain on client or restart server";
            });
          });
        }
      }

      _evalOnClient();
      return Promise.resolve();

      function _evalOnClient() {

      // client-side TF.js inference
      var graphMode = modelBuilder.inferGraphMode(modelRec.graph, "direct");
      var built = modelBuilder.buildModelFromGraph(tf, modelRec.graph, {
        mode: graphMode, featureSize: featureSize, windowSize: 1, seqFeatureSize: featureSize,
        allowedOutputKeys: allowedOutputKeys, defaultTarget: defaultTarget, numClasses: nCls,
      });
      _loadWeights(tf, built.model, trainer.modelArtifacts);

      var allPreds = [];
      var batchSize = 256;
      for (var bi = 0; bi < testN; bi += batchSize) {
        var bEnd = Math.min(bi + batchSize, testN);
        var bt = tf.tensor2d(testX.slice(bi, bEnd));
        var br = built.model.predict(bt);
        allPreds = allPreds.concat((Array.isArray(br) ? br[0] : br).arraySync());
        bt.dispose();
        if (Array.isArray(br)) br.forEach(function (t) { t.dispose(); }); else br.dispose();
      }

      _computeMetrics(pc, r, ev, allPreds, testX, testY, testN, nCls, isClassification, activeDs, schemaId);
      r.status = "done";
      built.model.dispose();
      } // end _evalOnClient
      return Promise.resolve();
    }

    function _computeMetrics(pc, r, ev, allPreds, testX, testY, testN, nCls, isClassification, activeDs, schemaId) {
      r.testN = testN;
      var selectedIds = ev.evaluatorIds || [];

      if (isClassification && pc) {
        var predLabels = allPreds.map(function (p) { return p.indexOf(Math.max.apply(null, p)); });
        var trueLabels = testY.map(function (y) { return Array.isArray(y) ? y.indexOf(Math.max.apply(null, y)) : Number(y); });
        var correct = 0;
        for (var ci = 0; ci < testN; ci++) if (predLabels[ci] === trueLabels[ci]) correct++;
        if (selectedIds.indexOf("accuracy") >= 0) r.metrics.accuracy = correct / testN;
        if (selectedIds.indexOf("macro_f1") >= 0 && pc.confusionMatrix) {
          var cm = pc.confusionMatrix(trueLabels, predLabels, nCls);
          var prf = pc.precisionRecallF1(cm);
          r.metrics.macro_f1 = prf.reduce(function (s, p) { return s + p.f1; }, 0) / nCls;
        }
      } else if (pc) {
        var truthFlat = [], predFlat = [];
        for (var mi = 0; mi < testN; mi++) {
          var yt = testY[mi], pp = allPreds[mi];
          if (Array.isArray(yt) && yt.length > 1) {
            for (var d = 0; d < yt.length; d++) { truthFlat.push(Number(yt[d] || 0)); predFlat.push(Number((pp && pp[d]) || 0)); }
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

      // generation metrics from stored runs
      var tid = r.trainerId;
      var genRuns = _listGenerationRuns(tid);
      if (genRuns.length) {
        var latestGen = genRuns[genRuns.length - 1];
        if (selectedIds.indexOf("recon_mse") >= 0 && latestGen.avgMse != null) r.metrics.recon_mse = latestGen.avgMse;
        if (selectedIds.indexOf("diversity") >= 0 && latestGen.samples && latestGen.samples.length > 1) r.metrics.diversity = _computeDiversity(latestGen.samples);
      }

      // module custom evaluators
      var moduleEvals = _getModuleEvaluators(schemaId);
      moduleEvals.forEach(function (mev) {
        if (selectedIds.indexOf(mev.id) < 0 || typeof mev.compute !== "function") return;
        try {
          var result = mev.compute({ predictions: allPreds, truth: testY, samples: genRuns.length ? genRuns[genRuns.length - 1].samples : null, originals: genRuns.length ? genRuns[genRuns.length - 1].originals : null, datasetData: activeDs });
          if (result && result.value != null) r.metrics[mev.id] = result.value;
        } catch (e) { /* skip */ }
      });

      r.status = "done";
    }

    function _loadWeights(tf, model, artifacts) {
      var fw;
      if (artifacts.weightValues && Array.isArray(artifacts.weightValues)) {
        fw = new Float32Array(artifacts.weightValues);
      } else if (artifacts.weightData && artifacts.weightData.byteLength) {
        fw = new Float32Array(artifacts.weightData);
      }
      if (!fw) return;
      var savedSpecs = artifacts.weightSpecs || [];
      var isPy = savedSpecs.length > 0 && savedSpecs[0].name && savedSpecs[0].name.match(/^\d+\./);
      var mw = model.getWeights();
      var nw = []; var off = 0;
      for (var i = 0; i < mw.length; i++) {
        var sz = mw[i].shape.reduce(function (a, b) { return a * b; }, 1);
        if (off + sz > fw.length) break;
        var raw = fw.subarray(off, off + sz);
        if (isPy && mw[i].shape.length === 2 && savedSpecs[i] && savedSpecs[i].shape && savedSpecs[i].shape.length === 2 &&
            savedSpecs[i].shape[0] === mw[i].shape[1] && savedSpecs[i].shape[1] === mw[i].shape[0]) {
          var tr = new Float32Array(sz);
          var rows = savedSpecs[i].shape[0], cols = savedSpecs[i].shape[1];
          for (var ti = 0; ti < rows; ti++) for (var tj = 0; tj < cols; tj++) tr[tj * rows + ti] = raw[ti * cols + tj];
          nw.push(tf.tensor(tr, mw[i].shape));
        } else {
          nw.push(tf.tensor(raw, mw[i].shape));
        }
        off += sz;
      }
      if (nw.length === mw.length) model.setWeights(nw);
    }

    function _computeDiversity(samples) {
      if (!samples || samples.length < 2) return 0;
      var n = Math.min(samples.length, 50);
      var totalDist = 0; var count = 0;
      for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
          var d = 0;
          for (var k = 0; k < samples[i].length; k++) {
            var diff = (samples[i][k] || 0) - (samples[j][k] || 0);
            d += diff * diff;
          }
          totalDist += Math.sqrt(d);
          count++;
        }
      }
      return count > 0 ? totalDist / count : 0;
    }

    function mount() { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
    function unmount() { _mountId++; layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

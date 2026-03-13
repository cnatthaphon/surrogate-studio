(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCEvaluationLabCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createRuntime(rawDeps) {
    var deps = rawDeps && typeof rawDeps === "object" ? rawDeps : {};
    var ui = deps.ui && typeof deps.ui === "object" ? deps.ui : {};
    var state = deps.state && typeof deps.state === "object" ? deps.state : {};
    var Plotly = deps.Plotly || (typeof window !== "undefined" ? window.Plotly : null);

    function numFmt(v) {
      return typeof deps.numFmt === "function" ? deps.numFmt(v) : String(v == null ? "-" : v);
    }

    function appendMetricRow(row) {
      var next = row && typeof row === "object" ? Object.assign({}, row) : {};
      if (!next.expId && state.currentExpId) next.expId = state.currentExpId;
      if (!next.configSig && state.currentConfigSig) next.configSig = state.currentConfigSig;
      if (next.configSig) {
        if (!state.metricsBaseConfigSig) {
          state.metricsBaseConfigSig = next.configSig;
        } else if (state.metricsBaseConfigSig !== next.configSig && ui.configMixWarning) {
          ui.configMixWarning.style.display = "block";
          ui.configMixWarning.textContent = "Warning: Metrics table contains mixed configurations. Clear Metrics for clean comparison.";
        }
      }
      var last = state.metricsLog.length ? state.metricsLog[state.metricsLog.length - 1] : null;
      if (last) {
        var same =
          String(last.type || "") === String(next.type || "") &&
          String(last.scenario || "") === String(next.scenario || "") &&
          String(last.model || "") === String(next.model || "") &&
          String(last.valMae || "") === String(next.valMae || "") &&
          String(last.testMae || "") === String(next.testMae || "") &&
          String(last.mae || "") === String(next.mae || "") &&
          String(last.rmse || "") === String(next.rmse || "") &&
          String(last.bias || "") === String(next.bias || "");
        if (same) return;
      }
      state.metricsLog.push(next);
      if (ui.metricsTableBody) {
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + String(next.type || "-") + "</td>" +
          "<td>" + String(next.expId || "-") + "</td>" +
          "<td>" + String(next.scenario || "-") + "</td>" +
          "<td>" + String(next.model || "-") + "</td>" +
          "<td>" + numFmt(next.valMae) + "</td>" +
          "<td>" + numFmt(next.testMae) + "</td>" +
          "<td>" + numFmt(next.mae) + "</td>" +
          "<td>" + numFmt(next.rmse) + "</td>" +
          "<td>" + numFmt(next.bias) + "</td>";
        ui.metricsTableBody.prepend(tr);
      }
      try { localStorage.setItem("osc_benchmark_metrics", JSON.stringify(state.metricsLog)); } catch (_err) {}
      updateBestModelSummary();
      refreshBenchmarkDetailViews();
    }

    function reloadMetricTable() {
      if (!ui.metricsTableBody) return;
      ui.metricsTableBody.innerHTML = "";
      for (var i = state.metricsLog.length - 1; i >= 0; i -= 1) {
        var row = state.metricsLog[i] || {};
        var tr = document.createElement("tr");
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
      if (!ui.scenarioSummaryChart || !Plotly) return;
      var rows = state.metricsLog.filter(function (r) {
        return String(r.type || "").indexOf("benchmark-avg-scenario") === 0 && Number.isFinite(Number(r.mae));
      });
      if (!rows.length) {
        Plotly.newPlot(ui.scenarioSummaryChart, [{ x: [], y: [], type: "bar", name: "MAE" }], {
          paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0" }, title: "Scenario Summary (MAE)",
          xaxis: { title: "scenario | model", gridcolor: "#1e293b" }, yaxis: { title: "MAE", gridcolor: "#1e293b" },
        }, { responsive: true });
        return;
      }
      var latestExpId = String(rows[rows.length - 1].expId || "");
      var picked = latestExpId ? rows.filter(function (r) { return String(r.expId || "") === latestExpId; }) : rows;
      var x = picked.map(function (r) { return String(r.scenario || "-") + " | " + String(r.model || "-"); });
      var y = picked.map(function (r) { return Number(r.mae); });
      Plotly.react(ui.scenarioSummaryChart, [{ x: x, y: y, type: "bar", marker: { color: "#38bdf8" }, name: "MAE" }], {
        paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0" }, title: "Scenario Summary (Latest Exp ID: " + (latestExpId || "n/a") + ")",
        xaxis: { title: "scenario | model", gridcolor: "#1e293b", tickangle: -18 }, yaxis: { title: "MAE", gridcolor: "#1e293b" }, margin: { t: 42, l: 52, r: 20, b: 120 },
      }, { responsive: true });
    }

    function renderWorstCasesTable() {
      if (!ui.worstCasesTableBody) return;
      ui.worstCasesTableBody.innerHTML = "";
      var rows = (state.benchmarkDetails || []).filter(function (r) { return Number.isFinite(Number(r.mae)); });
      if (!rows.length) {
        var tr = document.createElement("tr");
        tr.innerHTML = "<td colspan='6'>No benchmark-detail rows yet. Run Benchmark to populate.</td>";
        ui.worstCasesTableBody.appendChild(tr);
        return;
      }
      var latestExpId = String(rows[rows.length - 1].expId || "");
      var picked = latestExpId ? rows.filter(function (r) { return String(r.expId || "") === latestExpId; }) : rows;
      picked.sort(function (a, b) { return Number(b.mae) - Number(a.mae); });
      picked.slice(0, 12).forEach(function (r) {
        var tr = document.createElement("tr");
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
      var rows = state.metricsLog.filter(function (r) {
        return String(r.type || "").indexOf("benchmark-avg") === 0 && String(r.type || "").indexOf("scenario") < 0 && Number.isFinite(Number(r.mae));
      });
      if (!rows.length) {
        ui.bestModelSummary.textContent = "Best model summary will appear after benchmarks.";
        return;
      }
      rows.sort(function (a, b) { return Number(a.mae) - Number(b.mae); });
      var best = rows[0];
      ui.bestModelSummary.textContent =
        "Best mixed benchmark so far: " + String(best.model || "-") +
        " | MAE=" + numFmt(best.mae) +
        " RMSE=" + numFmt(best.rmse) +
        " Bias=" + numFmt(best.bias) +
        " | Exp ID: " + String(best.expId || "-");
    }

    function loadChecklistState() {
      try {
        var raw = localStorage.getItem("osc_experiment_checklist");
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") state.checklist = parsed;
      } catch (_err) {}
    }

    function saveChecklistState() {
      try { localStorage.setItem("osc_experiment_checklist", JSON.stringify(state.checklist || {})); } catch (_err) {}
    }

    function renderExperimentChecklist() {
      if (!ui.checklistTableBody) return;
      ui.checklistTableBody.innerHTML = "";
      var rows = Array.isArray(deps.experimentChecklist) ? deps.experimentChecklist : [];
      rows.forEach(function (row) {
        var done = Boolean(state.checklist && state.checklist[row.id]);
        var tr = document.createElement("tr");
        tr.innerHTML =
          "<td><input type='checkbox' data-id='" + row.id + "'" + (done ? " checked" : "") + "></td>" +
          "<td>" + row.name + "</td>" +
          "<td>" + row.preset + "</td>" +
          "<td>" + row.target + "</td>" +
          "<td>" + row.inference + "</td>";
        ui.checklistTableBody.appendChild(tr);
      });
    }

    async function runCurrentEvaluation() {
      if (typeof deps.buildCurrentEvaluationPayload !== "function") throw new Error("Evaluation payload builder is not initialized.");
      var payload = deps.buildCurrentEvaluationPayload();
      if (typeof deps.evaluateAndPlot !== "function") throw new Error("Evaluation runtime is not initialized.");
      var result = await deps.evaluateAndPlot(payload);
      if (typeof deps.setStatus === "function") {
        deps.setStatus("Evaluation complete (see chart below Drawflow). MAE=" + result.mae.toExponential(3) + ", RMSE=" + result.rmse.toExponential(3));
      }
      appendMetricRow({
        type: "eval",
        scenario: payload.metricScenarioLabel,
        model: payload.metricModelLabel,
        mae: result.mae,
        rmse: result.rmse,
        bias: result.bias,
      });
      return result;
    }

    async function runRandomDatasetEvaluation() {
      if (typeof deps.buildRandomDatasetEvaluationPayload !== "function") throw new Error("Random dataset evaluation builder is not initialized.");
      var payload = deps.buildRandomDatasetEvaluationPayload();
      if (typeof deps.evaluateDatasetTrajectoryAndPlot !== "function") throw new Error("Random dataset evaluation runtime is not initialized.");
      var result = await deps.evaluateDatasetTrajectoryAndPlot(payload);
      appendMetricRow({
        type: "random-dataset-eval",
        scenario: payload.metricScenarioLabel,
        model: payload.metricModelLabel,
        mae: result.mae,
        rmse: result.rmse,
        bias: result.bias,
      });
      if (typeof deps.setStatus === "function") {
        deps.setStatus("Random dataset vs NN complete (#" + payload.metricTrajectoryIndex + "). MAE=" + result.mae.toExponential(3) + " | " + result.params);
      }
      return result;
    }

    function handleTabAfterShow() {
      if (ui.compareChart && Plotly && Plotly.Plots && typeof deps.resizePlotIfVisible === "function") deps.resizePlotIfVisible(ui.compareChart);
    }

    function handleTabAfterPaint() {
      reloadMetricTable();
    }

    function bindUi() {
      if (ui.qaEvalBtn && !ui.qaEvalBtn.__oscEvalBound) {
        ui.qaEvalBtn.__oscEvalBound = true;
        ui.qaEvalBtn.addEventListener("click", async function () {
          try {
            if (typeof deps.showWorkspaceTab === "function") deps.showWorkspaceTab("eval");
            await runCurrentEvaluation();
          } catch (err) {
            if (typeof deps.setStatus === "function") deps.setStatus("Eval error: " + err.message);
            if (typeof deps.logError === "function") deps.logError(err);
          }
        });
      }
      if (ui.qaRandomDatasetEvalBtn && !ui.qaRandomDatasetEvalBtn.__oscEvalBound) {
        ui.qaRandomDatasetEvalBtn.__oscEvalBound = true;
        ui.qaRandomDatasetEvalBtn.addEventListener("click", async function () {
          try {
            if (typeof deps.showWorkspaceTab === "function") deps.showWorkspaceTab("eval");
            await runRandomDatasetEvaluation();
          } catch (err) {
            if (typeof deps.setStatus === "function") deps.setStatus("Random dataset vs NN error: " + err.message);
            if (typeof deps.logError === "function") deps.logError(err);
          }
        });
      }
      if (ui.clearMetricsBtn && !ui.clearMetricsBtn.__oscEvalBound) {
        ui.clearMetricsBtn.__oscEvalBound = true;
        ui.clearMetricsBtn.addEventListener("click", function () {
          state.metricsLog = [];
          state.metricsBaseConfigSig = "";
          state.benchmarkDetails = [];
          if (ui.metricsTableBody) ui.metricsTableBody.innerHTML = "";
          try { localStorage.removeItem("osc_benchmark_metrics"); } catch (_err) {}
          if (ui.configMixWarning) {
            ui.configMixWarning.style.display = "none";
            ui.configMixWarning.textContent = "";
          }
          updateBestModelSummary();
          refreshBenchmarkDetailViews();
          if (typeof deps.setStatus === "function") deps.setStatus("Performance metrics table cleared.");
        });
      }
      if (ui.clearBenchDetailBtn && !ui.clearBenchDetailBtn.__oscEvalBound) {
        ui.clearBenchDetailBtn.__oscEvalBound = true;
        ui.clearBenchDetailBtn.addEventListener("click", function () {
          state.benchmarkDetails = [];
          refreshBenchmarkDetailViews();
          if (typeof deps.setStatus === "function") deps.setStatus("Benchmark-detail panel cleared.");
        });
      }
      if (ui.clearRunLogBtn && !ui.clearRunLogBtn.__oscEvalBound) {
        ui.clearRunLogBtn.__oscEvalBound = true;
        ui.clearRunLogBtn.addEventListener("click", function () {
          if (ui.runLog) ui.runLog.value = "";
          if (typeof deps.setStatus === "function") deps.setStatus("Run log cleared.");
        });
      }
      if (ui.copyRunLogBtn && !ui.copyRunLogBtn.__oscEvalBound) {
        ui.copyRunLogBtn.__oscEvalBound = true;
        ui.copyRunLogBtn.addEventListener("click", async function () {
          try {
            await navigator.clipboard.writeText(ui.runLog ? ui.runLog.value : "");
            if (typeof deps.setStatus === "function") deps.setStatus("Run log copied to clipboard.");
          } catch (_err) {
            if (typeof deps.setStatus === "function") deps.setStatus("Copy failed. Select log text manually and copy.");
          }
        });
      }
      if (ui.exportMetricsBtn && !ui.exportMetricsBtn.__oscEvalBound) {
        ui.exportMetricsBtn.__oscEvalBound = true;
        ui.exportMetricsBtn.addEventListener("click", function () {
          if (!state.metricsLog.length) {
            if (typeof deps.setStatus === "function") deps.setStatus("No metrics to export.");
            return;
          }
          var head = ["type", "expId", "scenario", "model", "valMae", "testMae", "mae", "rmse", "bias"];
          var rows = state.metricsLog.map(function (r) {
            return head.map(function (k) { return String(r[k] == null ? "" : r[k]); }).join(",");
          });
          if (typeof deps.downloadCsv === "function") {
            deps.downloadCsv("oscillator_benchmark_metrics.csv", [head.join(",")].concat(rows).join("\n"));
          }
          if (typeof deps.setStatus === "function") deps.setStatus("Metrics exported to CSV.");
        });
      }
      if (ui.checklistTableBody && !ui.checklistTableBody.__oscEvalBound) {
        ui.checklistTableBody.__oscEvalBound = true;
        ui.checklistTableBody.addEventListener("change", function (ev) {
          var el = ev.target;
          if (!el || String(el.type || "") !== "checkbox") return;
          var id = String(el.getAttribute("data-id") || "");
          if (!id) return;
          state.checklist[id] = Boolean(el.checked);
          saveChecklistState();
        });
      }
      if (ui.clearChecklistBtn && !ui.clearChecklistBtn.__oscEvalBound) {
        ui.clearChecklistBtn.__oscEvalBound = true;
        ui.clearChecklistBtn.addEventListener("click", function () {
          state.checklist = {};
          saveChecklistState();
          renderExperimentChecklist();
          if (typeof deps.setStatus === "function") deps.setStatus("Experiment checklist cleared.");
        });
      }
    }

    return {
      appendMetricRow: appendMetricRow,
      reloadMetricTable: reloadMetricTable,
      refreshBenchmarkDetailViews: refreshBenchmarkDetailViews,
      renderScenarioSummaryChart: renderScenarioSummaryChart,
      renderWorstCasesTable: renderWorstCasesTable,
      updateBestModelSummary: updateBestModelSummary,
      loadChecklistState: loadChecklistState,
      saveChecklistState: saveChecklistState,
      renderExperimentChecklist: renderExperimentChecklist,
      runCurrentEvaluation: runCurrentEvaluation,
      runRandomDatasetEvaluation: runRandomDatasetEvaluation,
      handleTabAfterShow: handleTabAfterShow,
      handleTabAfterPaint: handleTabAfterPaint,
      bindUi: bindUi,
    };
  }

  return {
    createRuntime: createRuntime,
  };
});
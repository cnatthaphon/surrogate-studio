(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCGenerationLabCore = factory();
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

    function getRowsSorted() {
      var rows = (state.generationRows || []).slice();
      var mode = String((ui.genSortMode && ui.genSortMode.value) || "recent");
      if (mode === "best_mae") rows.sort(function (a, b) { return Number(a.mae || Infinity) - Number(b.mae || Infinity); });
      else if (mode === "worst_mae") rows.sort(function (a, b) { return Number(b.mae || -Infinity) - Number(a.mae || -Infinity); });
      else rows.sort(function (a, b) { return Number(b.ts || 0) - Number(a.ts || 0); });
      return rows;
    }

    function renderMetricsTable() {
      if (!ui.genMetricsTableBody) return;
      ui.genMetricsTableBody.innerHTML = "";
      var rows = state.generationRows || [];
      if (!rows.length) {
        var tr = document.createElement("tr");
        tr.innerHTML = "<td colspan='8'>No generation results yet.</td>";
        ui.genMetricsTableBody.appendChild(tr);
        return;
      }
      rows.forEach(function (r, i) {
        var tr = document.createElement("tr");
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

    function refreshSampleSelect() {
      if (!ui.genSampleSelect) return;
      var rows = getRowsSorted();
      var prev = String(ui.genSampleSelect.value || "");
      ui.genSampleSelect.innerHTML = "";
      if (!rows.length) {
        var emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = "(no sample)";
        ui.genSampleSelect.appendChild(emptyOpt);
        return;
      }
      rows.forEach(function (r) {
        var opt = document.createElement("option");
        opt.value = String(r.id);
        opt.textContent = String(r.scenario || "-") + " | MAE=" + numFmt(r.mae) + " | " + String(r.model || "-");
        ui.genSampleSelect.appendChild(opt);
      });
      var hasPrev = rows.some(function (r) { return String(r.id) === prev; });
      ui.genSampleSelect.value = hasPrev ? prev : String(rows[0].id);
    }

    function renderBatchChart() {
      if (!ui.genBatchChart || !Plotly) return;
      var rows = state.generationRows || [];
      if (!rows.length) {
        Plotly.newPlot(ui.genBatchChart, [{ x: [], y: [], type: "bar", name: "MAE" }], {
          paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0" }, title: "Generation Batch Summary",
          xaxis: { title: "sample", gridcolor: "#1e293b" }, yaxis: { title: "MAE", gridcolor: "#1e293b" },
        }, { responsive: true });
        return;
      }
      var x = rows.map(function (r, i) { return String(i + 1) + ":" + String(r.scenario || "-"); });
      var y = rows.map(function (r) { return Number(r.mae || 0); });
      Plotly.react(ui.genBatchChart, [{ x: x, y: y, type: "bar", name: "MAE", marker: { color: "#38bdf8" } }], {
        paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0" }, title: "Generation Batch Summary (MAE)",
        xaxis: { title: "sample", gridcolor: "#1e293b", tickangle: -20 }, yaxis: { title: "MAE", gridcolor: "#1e293b" }, margin: { t: 42, l: 52, r: 20, b: 120 },
      }, { responsive: true });
    }

    function renderQualityTable() {
      if (!ui.genQualityTableBody) return;
      ui.genQualityTableBody.innerHTML = "";
      var rows = state.generationQualityRows || [];
      if (!rows.length) {
        var tr = document.createElement("tr");
        tr.innerHTML = "<td colspan='6'>Run Quality Check after generation.</td>";
        ui.genQualityTableBody.appendChild(tr);
        return;
      }
      rows.forEach(function (r) {
        var tr = document.createElement("tr");
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

    function renderQualityChart() {
      if (!ui.genQualityChart || !Plotly) return;
      var rows = (state.generationQualityRows || []).filter(function (r) { return String(r.scope) !== "overall"; });
      if (!rows.length) {
        Plotly.newPlot(ui.genQualityChart, [{ x: [], y: [], type: "bar", name: "integrity" }], {
          paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0" }, title: "Quality Overview",
          xaxis: { title: "scenario", gridcolor: "#1e293b" }, yaxis: { title: "score", gridcolor: "#1e293b" }, legend: { orientation: "h" },
        }, { responsive: true });
        return;
      }
      var x = rows.map(function (r) { return String(r.scenario); });
      var yI = rows.map(function (r) { return Number(r.integrity || 0); });
      var yD = rows.map(function (r) { return Number(r.diversityGap || 0); });
      Plotly.react(ui.genQualityChart, [
        { x: x, y: yI, type: "bar", name: "Integrity (lower better)", marker: { color: "#38bdf8" } },
        { x: x, y: yD, type: "bar", name: "Diversity Gap (lower better)", marker: { color: "#f59e0b" } },
      ], {
        barmode: "group", paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0" }, title: "Quality Overview (Feature-based)",
        xaxis: { title: "scenario", gridcolor: "#1e293b" }, yaxis: { title: "score", gridcolor: "#1e293b" }, legend: { orientation: "h" },
      }, { responsive: true });
    }

    async function runQualityCheck() {
      if (typeof deps.computeGenerationQualityRows !== "function") throw new Error("Generation quality runtime is not initialized.");
      var out = await deps.computeGenerationQualityRows();
      state.generationQualityRows = Array.isArray(out) ? out : [];
      renderQualityTable();
      renderQualityChart();
      if (typeof deps.setStatus === "function" && state.generationQualityRows.length) {
        deps.setStatus("Quality check complete. Integrity=" + numFmt(state.generationQualityRows[0].integrity) + " DiversityGap=" + numFmt(state.generationQualityRows[0].diversityGap));
      }
      return state.generationQualityRows;
    }

    function exportRowsCsv() {
      var rows = state.generationRows || [];
      if (!rows.length) {
        if (typeof deps.setStatus === "function") deps.setStatus("No generation rows to export.");
        return;
      }
      var head = ["id", "ts", "scenario", "model", "source", "ratio", "mae", "rmse", "bias", "refTrajIdx"];
      var csv = [head.join(",")].concat(rows.map(function (r) {
        return head.map(function (k) {
          var v = r[k];
          if (v == null) return "";
          var s = String(v);
          return s.indexOf(",") >= 0 ? ("\"" + s.replace(/\"/g, "\"\"") + "\"") : s;
        }).join(",");
      })).join("\n");
      if (typeof deps.downloadCsv === "function") deps.downloadCsv("oscillator_generation_metrics.csv", csv);
      if (typeof deps.setStatus === "function") deps.setStatus("Generation CSV exported.");
    }

    function exportRowsJson() {
      var rows = state.generationRows || [];
      if (!rows.length) {
        if (typeof deps.setStatus === "function") deps.setStatus("No generation rows to export.");
        return;
      }
      if (typeof deps.downloadJson === "function") deps.downloadJson("oscillator_generation_metrics.json", rows);
      if (typeof deps.setStatus === "function") deps.setStatus("Generation JSON exported.");
    }

    async function plotSelectedSample() {
      if (typeof deps.plotGenerationSelectedSample !== "function") throw new Error("Generation preview runtime is not initialized.");
      return deps.plotGenerationSelectedSample();
    }

    function clearResults() {
      state.generationRows = [];
      state.generationQualityRows = [];
      renderMetricsTable();
      renderBatchChart();
      renderQualityTable();
      renderQualityChart();
      refreshSampleSelect();
      if (ui.genSingleChart && Plotly) {
        Plotly.newPlot(ui.genSingleChart, [{ x: [0], y: [0], mode: "lines", name: "comparison" }], {
          paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0" }, title: "Generate + Compare (Single) to render output",
          xaxis: { title: "time (s)", gridcolor: "#1e293b" }, yaxis: { title: "state", gridcolor: "#1e293b" },
        }, { responsive: true });
      }
    }

    function refreshRefOptions() {
      if (typeof deps.refreshGenerationRefOptions !== "function") return;
      deps.refreshGenerationRefOptions();
    }

    async function runSingle() {
      if (typeof deps.runGenerationSingle !== "function") throw new Error("Generation(single) runtime is not initialized.");
      var out = await deps.runGenerationSingle();
      renderMetricsTable();
      renderBatchChart();
      renderQualityTable();
      renderQualityChart();
      refreshSampleSelect();
      return out;
    }

    async function runBatch() {
      if (typeof deps.runGenerationBatch !== "function") throw new Error("Generation(batch) runtime is not initialized.");
      var out = await deps.runGenerationBatch();
      renderMetricsTable();
      renderBatchChart();
      renderQualityTable();
      renderQualityChart();
      refreshSampleSelect();
      return out;
    }

    function handleTabAfterShow() {
      if (!Plotly || !Plotly.Plots || typeof deps.resizePlotIfVisible !== "function") return;
      if (ui.genSingleChart) deps.resizePlotIfVisible(ui.genSingleChart);
      if (ui.genBatchChart) deps.resizePlotIfVisible(ui.genBatchChart);
      if (ui.genQualityChart) deps.resizePlotIfVisible(ui.genQualityChart);
    }

    function handleTabAfterPaint() {
      renderMetricsTable();
      renderQualityTable();
      refreshSampleSelect();
    }

    function bindUi() {
      if (ui.genScenarioType && !ui.genScenarioType.__oscGenBound) {
        ui.genScenarioType.__oscGenBound = true;
        ui.genScenarioType.addEventListener("change", refreshRefOptions);
      }
      if (ui.genSourceMode && !ui.genSourceMode.__oscGenBound) {
        ui.genSourceMode.__oscGenBound = true;
        ui.genSourceMode.addEventListener("change", refreshRefOptions);
      }
      if (ui.genRunOneBtn && !ui.genRunOneBtn.__oscGenBound) {
        ui.genRunOneBtn.__oscGenBound = true;
        ui.genRunOneBtn.addEventListener("click", async function () {
          try {
            await runSingle();
          } catch (err) {
            if (typeof deps.setStatus === "function") deps.setStatus("Generation(single) error: " + err.message);
            if (typeof deps.logError === "function") deps.logError(err);
          }
        });
      }
      if (ui.genRunBatchBtn && !ui.genRunBatchBtn.__oscGenBound) {
        ui.genRunBatchBtn.__oscGenBound = true;
        ui.genRunBatchBtn.addEventListener("click", async function () {
          try {
            await runBatch();
          } catch (err) {
            if (typeof deps.setStatus === "function") deps.setStatus("Generation(batch) error: " + err.message);
            if (typeof deps.logError === "function") deps.logError(err);
          }
        });
      }
      if (ui.genQualityBtn && !ui.genQualityBtn.__oscGenBound) {
        ui.genQualityBtn.__oscGenBound = true;
        ui.genQualityBtn.addEventListener("click", async function () {
          try {
            await runQualityCheck();
          } catch (err) {
            if (typeof deps.setStatus === "function") deps.setStatus("Generation(quality) error: " + err.message);
            if (typeof deps.logError === "function") deps.logError(err);
          }
        });
      }
      if (ui.genClearBtn && !ui.genClearBtn.__oscGenBound) {
        ui.genClearBtn.__oscGenBound = true;
        ui.genClearBtn.addEventListener("click", function () {
          clearResults();
          if (typeof deps.setStatus === "function") deps.setStatus("Generation results cleared.");
        });
      }
      if (ui.genExportCsvBtn && !ui.genExportCsvBtn.__oscGenBound) {
        ui.genExportCsvBtn.__oscGenBound = true;
        ui.genExportCsvBtn.addEventListener("click", exportRowsCsv);
      }
      if (ui.genExportJsonBtn && !ui.genExportJsonBtn.__oscGenBound) {
        ui.genExportJsonBtn.__oscGenBound = true;
        ui.genExportJsonBtn.addEventListener("click", exportRowsJson);
      }
      if (ui.genSortMode && !ui.genSortMode.__oscGenBound) {
        ui.genSortMode.__oscGenBound = true;
        ui.genSortMode.addEventListener("change", refreshSampleSelect);
      }
      if (ui.genJumpBtn && !ui.genJumpBtn.__oscGenBound) {
        ui.genJumpBtn.__oscGenBound = true;
        ui.genJumpBtn.addEventListener("click", async function () {
          try {
            await plotSelectedSample();
          } catch (err) {
            if (typeof deps.setStatus === "function") deps.setStatus("Generation(plot selected) error: " + err.message);
            if (typeof deps.logError === "function") deps.logError(err);
          }
        });
      }
    }

    return {
      getRowsSorted: getRowsSorted,
      renderMetricsTable: renderMetricsTable,
      refreshSampleSelect: refreshSampleSelect,
      renderBatchChart: renderBatchChart,
      renderQualityTable: renderQualityTable,
      renderQualityChart: renderQualityChart,
      runQualityCheck: runQualityCheck,
      exportRowsCsv: exportRowsCsv,
      exportRowsJson: exportRowsJson,
      plotSelectedSample: plotSelectedSample,
      clearResults: clearResults,
      refreshRefOptions: refreshRefOptions,
      runSingle: runSingle,
      runBatch: runBatch,
      handleTabAfterShow: handleTabAfterShow,
      handleTabAfterPaint: handleTabAfterPaint,
      bindUi: bindUi,
    };
  }

  return {
    createRuntime: createRuntime,
  };
});
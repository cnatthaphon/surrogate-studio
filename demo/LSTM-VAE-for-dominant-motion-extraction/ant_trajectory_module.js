/**
 * Ant Trajectory Dataset Module
 *
 * Data embedded in ant_data.js (no fetch needed — works on file://).
 * 1000 timesteps × 40 features (20 ants × x,y), MinMax normalized [0,1].
 * Source: LSTM-VAE-for-dominant-motion-extraction (Arxiv 2021)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
    return;
  }
  var descriptor = factory(root);
  root.OSCDatasetModuleAntTrajectory = descriptor;
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModule === "function") {
    root.OSCDatasetModules.registerModule(descriptor);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function createRng(seed) {
    var s = (Math.floor(seed) >>> 0) || 42;
    return function () { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  }

  function fisherYates(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function getData() {
    // ANT_DATA is loaded from ant_data.js <script> tag (embedded, no fetch)
    var W = typeof window !== "undefined" ? window : root;
    return W.ANT_DATA || null;
  }

  function build(cfg) {
    var config = cfg || {};
    var raw = getData();
    if (!raw || !raw.s) return Promise.reject(new Error("Ant data not loaded. Include ant_data.js before this module."));

    var numAnts = raw.n || 20;
    var numFeatures = raw.f || 40;
    var allSamples = raw.s;
    var seed = Number(config.seed || 42);
    var splitMode = String(config.splitMode || "random");
    var trainFrac = Number(config.trainFrac || 0.8);
    var valFrac = Number(config.valFrac || 0.1);
    var totalCount = Math.min(Number(config.totalCount || allSamples.length), allSamples.length);
    var rng = createRng(seed);

    var indices = [];
    for (var i = 0; i < allSamples.length; i++) indices.push(i);
    if (splitMode !== "original") fisherYates(indices, rng);
    indices = indices.slice(0, totalCount);

    var trainN = Math.max(1, Math.round(totalCount * trainFrac));
    var valN = Math.max(1, Math.round(totalCount * valFrac));
    var testN = Math.max(1, totalCount - trainN - valN);

    function extractSplit(idx) {
      var x = [], y = [];
      for (var i = 0; i < idx.length; i++) {
        x.push(allSamples[idx[i]]);
        y.push(allSamples[idx[i]]); // reconstruction target = input
      }
      return { x: x, y: y };
    }

    var trainIdx = indices.slice(0, trainN);
    var valIdx = indices.slice(trainN, trainN + valN);
    var testIdx = indices.slice(trainN + valN);
    var records = { train: extractSplit(trainIdx), val: extractSplit(valIdx), test: extractSplit(testIdx) };

    return Promise.resolve({
      schemaId: "ant_trajectory",
      datasetModuleId: "ant_trajectory",
      source: "lstm_vae_paper",
      mode: "regression",
      numAnts: numAnts,
      numFeatures: numFeatures,
      featureSize: numFeatures,
      imageShape: null,
      classCount: 0,
      classNames: [],
      splitConfig: { mode: splitMode, train: trainFrac, val: valFrac, test: 1 - trainFrac - valFrac },
      splitCounts: { train: trainIdx.length, val: valIdx.length, test: testIdx.length },
      trainCount: trainIdx.length, valCount: valIdx.length, testCount: testIdx.length,
      xTrain: records.train.x, yTrain: records.train.y,
      xVal: records.val.x, yVal: records.val.y,
      xTest: records.test.x, yTest: records.test.y,
      targetMode: "xv",
      records: records,
      seed: seed,
    });
  }

  // Playground renderer
  function renderPlayground(mountEl, deps) {
    if (!mountEl) return;
    var elF = (deps && deps.el) || function (tag, attrs, text) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "style") e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]);
      });
      if (text) e.textContent = text;
      return e;
    };
    var isCurrent = (deps && typeof deps.isCurrent === "function") ? deps.isCurrent : function () { return true; };
    var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;

    var data = (deps && deps.datasetData) || null;
    if (data) { _renderTrajectories(mountEl, elF, data, Plotly); return; }

    mountEl.innerHTML = "";
    mountEl.appendChild(elF("div", { style: "color:#67e8f9;font-size:13px;" }, "Building ant trajectory data..."));
    build({ totalCount: 10399, seed: 42 }).then(function (ds) {
      if (!isCurrent()) return;
      _renderTrajectories(mountEl, elF, ds, Plotly);
    }).catch(function (err) {
      mountEl.innerHTML = "";
      mountEl.appendChild(elF("div", { style: "color:#f43f5e;" }, "Error: " + (err.message || err)));
    });
  }

  function _renderTrajectories(mountEl, elF, ds, Plotly) {
    mountEl.innerHTML = "";
    var numAnts = ds.numAnts || 20;
    var numFeatures = ds.numFeatures || 40;
    var allX = [].concat(ds.xTrain || [], ds.xVal || [], ds.xTest || []);
    var total = allX.length;

    mountEl.appendChild(elF("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:4px;" },
      "Ant Trajectories | " + numAnts + " ants | " + total + " timesteps | " + numFeatures + " features"));
    mountEl.appendChild(elF("div", { style: "font-size:11px;color:#64748b;margin-bottom:4px;" },
      "Train: " + (ds.trainCount || 0) + " | Val: " + (ds.valCount || 0) + " | Test: " + (ds.testCount || 0)));

    if (!Plotly || !allX.length) return;

    var colors = ["#22d3ee","#f59e0b","#4ade80","#f43f5e","#a78bfa","#fb923c","#2dd4bf","#e879f9","#fbbf24","#38bdf8",
                  "#818cf8","#34d399","#fb7185","#c084fc","#fcd34d","#6ee7b7","#f472b6","#93c5fd","#fdba74","#86efac"];
    var darkBg = { paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 } };
    var gridColor = "#1e293b";

    // ant selector buttons — "All" + one per ant
    var selectedAnt = -1; // -1 = show all
    var btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px;";
    var chartDiv = document.createElement("div");
    chartDiv.style.cssText = "height:380px;";
    var tsDiv = document.createElement("div");
    tsDiv.style.cssText = "height:220px;margin-top:8px;";

    function makeBtn(label, idx, color) {
      var btn = document.createElement("button");
      btn.textContent = label;
      btn.style.cssText = "font-size:9px;padding:2px 6px;border-radius:3px;border:1px solid " + (color || "#334155") + ";background:" + (idx === selectedAnt ? (color || "#334155") : "#111827") + ";color:" + (idx === selectedAnt ? "#fff" : (color || "#94a3b8")) + ";cursor:pointer;";
      btn.addEventListener("click", function () { selectedAnt = idx; renderCharts(); });
      return btn;
    }

    function renderCharts() {
      // rebuild buttons
      btnRow.innerHTML = "";
      btnRow.appendChild(makeBtn("All", -1, "#64748b"));
      for (var i = 0; i < numAnts; i++) btnRow.appendChild(makeBtn("" + i, i, colors[i % colors.length]));

      // path chart
      var pathTraces = [];
      for (var ant = 0; ant < numAnts; ant++) {
        var show = selectedAnt === -1 || selectedAnt === ant;
        var xc = [], yc = [];
        for (var t = 0; t < total; t++) { xc.push(allX[t][ant * 2]); yc.push(allX[t][ant * 2 + 1]); }
        pathTraces.push({
          x: xc, y: yc, mode: "lines", name: "Ant " + ant,
          line: { color: colors[ant % colors.length], width: selectedAnt === ant ? 2.5 : 1 },
          opacity: show ? (selectedAnt === -1 ? 0.7 : 1) : 0,
          visible: show,
        });
      }
      Plotly.react(chartDiv, pathTraces, Object.assign({}, darkBg, {
        title: { text: (selectedAnt >= 0 ? "Ant " + selectedAnt + " Path" : numAnts + " Ant Paths") + " (x vs y)", font: { size: 12 } },
        xaxis: { title: "x", gridcolor: gridColor }, yaxis: { title: "y", gridcolor: gridColor, scaleanchor: "x" },
        legend: { font: { size: 8 }, bgcolor: "rgba(0,0,0,0)" },
        margin: { t: 30, b: 45, l: 50, r: 10 },
      }), { responsive: true });

      // time series — show selected ant(s)
      var maxT = Math.min(total, 2000);
      var tsT = []; for (var si = 0; si < maxT; si++) tsT.push(si);
      var tsTraces = [];
      var antsToShow = selectedAnt >= 0 ? [selectedAnt] : [];
      // if all, show first few to avoid clutter
      if (selectedAnt === -1) { for (var a = 0; a < Math.min(numAnts, 5); a++) antsToShow.push(a); }
      for (var ai = 0; ai < antsToShow.length; ai++) {
        var a = antsToShow[ai];
        tsTraces.push({ x: tsT, y: tsT.map(function (t) { return allX[t][a * 2]; }), mode: "lines", name: "Ant" + a + " x", line: { color: colors[a % colors.length], width: 1.5 } });
        tsTraces.push({ x: tsT, y: tsT.map(function (t) { return allX[t][a * 2 + 1]; }), mode: "lines", name: "Ant" + a + " y", line: { color: colors[a % colors.length], width: 1, dash: "dot" } });
      }
      var tsTitle = selectedAnt >= 0 ? "Ant " + selectedAnt + " Time Series" : "Time Series (first " + antsToShow.length + " ants)";
      Plotly.react(tsDiv, tsTraces, Object.assign({}, darkBg, {
        title: { text: tsTitle + " (" + maxT + " steps)", font: { size: 11 } },
        xaxis: { title: "Timestep", gridcolor: gridColor }, yaxis: { title: "Position", gridcolor: gridColor },
        legend: { font: { size: 8 } }, margin: { t: 25, b: 40, l: 50, r: 10 },
      }), { responsive: true });
    }

    mountEl.appendChild(btnRow);
    mountEl.appendChild(chartDiv);
    mountEl.appendChild(tsDiv);
    renderCharts();
  }

  /**
   * Generation tab renderer — trajectory visualization matching the paper.
   *
   * Paper figure style (Li et al. 2021):
   * - Reconstruct mode: original vs reconstructed ant paths (x vs y), side by side
   * - Random mode: generated ant paths as trajectories (treating samples as time sequence)
   * - Per-ant time series: x(t) and y(t) for selected ants, original vs output overlay
   * - Feature error heatmap: per-sample, per-feature reconstruction error
   *
   * deps: { samples, originals?, method?, el, Plotly, datasetData, schemaId }
   */
  function renderGeneratedSamples(mountEl, deps) {
    if (!mountEl) return;
    var samples = (deps && deps.samples) || [];
    var originals = (deps && deps.originals) || null;
    var method = (deps && deps.method) || "random";
    var elF = (deps && deps.el) || function (tag, attrs, text) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "style") e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]);
      });
      if (text) e.textContent = text;
      return e;
    };
    var Plotly = (deps && deps.Plotly) || (typeof window !== "undefined" && window.Plotly) || null;
    var dsData = (deps && deps.datasetData) || {};
    var numAnts = dsData.numAnts || 20;

    if (!samples.length) {
      mountEl.appendChild(elF("div", { style: "color:#94a3b8;font-size:11px;" }, "No samples generated."));
      return;
    }

    var colors = ["#22d3ee","#f59e0b","#4ade80","#f43f5e","#a78bfa","#fb923c","#2dd4bf","#e879f9","#fbbf24","#38bdf8",
                  "#818cf8","#34d399","#fb7185","#c084fc","#fcd34d","#6ee7b7","#f472b6","#93c5fd","#fdba74","#86efac"];
    var darkBg = { paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 } };
    var gridColor = "#1e293b";

    if (!Plotly) {
      var text = samples.slice(0, 3).map(function (s, i) {
        return "Sample " + (i + 1) + ": [" + s.slice(0, 8).map(function (v) { return v.toFixed(3); }).join(", ") + "...]";
      }).join("\n");
      mountEl.appendChild(elF("pre", { style: "font-size:10px;color:#94a3b8;background:#171d30;padding:6px;border-radius:4px;" }, text));
      return;
    }

    // ─── RECONSTRUCT mode: original vs reconstructed (paper Figure 3 style) ───
    if (method === "reconstruct" && originals && originals.length) {
      mountEl.appendChild(elF("div", { style: "font-size:12px;color:#67e8f9;margin-bottom:8px;font-weight:600;" },
        "Reconstruction: " + samples.length + " test samples, " + numAnts + " ants"));

      // 1. Side-by-side ant paths: Original (left subplot) vs Reconstructed (right subplot)
      //    Each sample is a timestep — plot ant x,y positions across all timesteps
      var pathDiv = document.createElement("div");
      pathDiv.style.cssText = "height:360px;";
      mountEl.appendChild(pathDiv);

      var nT = Math.min(samples.length, originals.length);
      var origTraces = [];
      var reconTraces = [];
      for (var ant = 0; ant < numAnts; ant++) {
        var ox = [], oy = [], rx = [], ry = [];
        for (var t = 0; t < nT; t++) {
          ox.push(originals[t][ant * 2] || 0); oy.push(originals[t][ant * 2 + 1] || 0);
          rx.push(samples[t][ant * 2] || 0);    ry.push(samples[t][ant * 2 + 1] || 0);
        }
        origTraces.push({
          x: ox, y: oy, mode: "lines+markers", name: "Ant " + ant,
          xaxis: "x", yaxis: "y",
          line: { color: colors[ant % 20], width: 1.5 },
          marker: { size: 2 }, showlegend: ant < 5,
        });
        reconTraces.push({
          x: rx, y: ry, mode: "lines+markers", name: "Ant " + ant,
          xaxis: "x2", yaxis: "y2",
          line: { color: colors[ant % 20], width: 1.5 },
          marker: { size: 2 }, showlegend: false,
        });
      }
      Plotly.newPlot(pathDiv, origTraces.concat(reconTraces), Object.assign({}, darkBg, {
        grid: { rows: 1, columns: 2, pattern: "independent", xgap: 0.08 },
        xaxis: { title: "x", gridcolor: gridColor, domain: [0, 0.47] },
        yaxis: { title: "y", gridcolor: gridColor, scaleanchor: "x" },
        xaxis2: { title: "x", gridcolor: gridColor, domain: [0.53, 1] },
        yaxis2: { title: "y", gridcolor: gridColor, scaleanchor: "x2" },
        annotations: [
          { text: "Original", xref: "paper", yref: "paper", x: 0.23, y: 1.06, showarrow: false, font: { size: 12, color: "#94a3b8" } },
          { text: "Reconstructed", xref: "paper", yref: "paper", x: 0.77, y: 1.06, showarrow: false, font: { size: 12, color: "#67e8f9" } },
        ],
        legend: { font: { size: 8 }, bgcolor: "rgba(0,0,0,0)", x: 0, y: -0.15, orientation: "h" },
        margin: { t: 35, b: 60, l: 50, r: 10 },
      }), { responsive: true });

      // 2. Per-ant time series: overlay original (solid) vs reconstructed (dashed)
      //    Show first 4 ants, x and y coordinates over time
      var tsDiv = document.createElement("div");
      tsDiv.style.cssText = "height:280px;margin-top:12px;";
      mountEl.appendChild(tsDiv);

      var showAnts = Math.min(4, numAnts);
      var timeIdx = []; for (var ti = 0; ti < nT; ti++) timeIdx.push(ti);
      var tsTraces = [];
      for (var a = 0; a < showAnts; a++) {
        var origX = [], origY = [], reconX = [], reconY = [];
        for (var t = 0; t < nT; t++) {
          origX.push(originals[t][a * 2]); origY.push(originals[t][a * 2 + 1]);
          reconX.push(samples[t][a * 2]);  reconY.push(samples[t][a * 2 + 1]);
        }
        tsTraces.push({ x: timeIdx, y: origX, mode: "lines", name: "Ant" + a + " x (orig)", line: { color: colors[a * 2], width: 1.5 }, legendgroup: "ant" + a });
        tsTraces.push({ x: timeIdx, y: reconX, mode: "lines", name: "Ant" + a + " x (recon)", line: { color: colors[a * 2], width: 1.5, dash: "dash" }, legendgroup: "ant" + a });
        tsTraces.push({ x: timeIdx, y: origY, mode: "lines", name: "Ant" + a + " y (orig)", line: { color: colors[a * 2 + 1], width: 1 }, legendgroup: "ant" + a, showlegend: false });
        tsTraces.push({ x: timeIdx, y: reconY, mode: "lines", name: "Ant" + a + " y (recon)", line: { color: colors[a * 2 + 1], width: 1, dash: "dash" }, legendgroup: "ant" + a, showlegend: false });
      }
      Plotly.newPlot(tsDiv, tsTraces, Object.assign({}, darkBg, {
        title: { text: "Time Series: Original (solid) vs Reconstructed (dashed)", font: { size: 11 } },
        xaxis: { title: "Timestep", gridcolor: gridColor },
        yaxis: { title: "Position", gridcolor: gridColor },
        legend: { font: { size: 8 }, bgcolor: "rgba(0,0,0,0)" },
        margin: { t: 30, b: 40, l: 50, r: 10 },
      }), { responsive: true });

      // 3. Reconstruction error heatmap: rows=timesteps, cols=features
      var errDiv = document.createElement("div");
      errDiv.style.cssText = "height:260px;margin-top:12px;";
      mountEl.appendChild(errDiv);

      var errMaxT = Math.min(nT, 100);
      var errMatrix = [];
      var featureLabels = [];
      for (var f = 0; f < numAnts; f++) { featureLabels.push("A" + f + ".x"); featureLabels.push("A" + f + ".y"); }
      for (var t = 0; t < errMaxT; t++) {
        var row = [];
        for (var f = 0; f < samples[t].length; f++) {
          row.push(Math.abs(originals[t][f] - samples[t][f]));
        }
        errMatrix.push(row);
      }
      Plotly.newPlot(errDiv, [{
        z: errMatrix, type: "heatmap",
        x: featureLabels, colorscale: [[0, "#0b1220"], [0.25, "#164e63"], [0.5, "#0ea5e9"], [0.75, "#fbbf24"], [1, "#ef4444"]],
        colorbar: { title: { text: "|err|", font: { size: 10 } }, thickness: 12, len: 0.8 },
      }], Object.assign({}, darkBg, {
        title: { text: "Per-Feature Reconstruction Error (|original - reconstructed|)", font: { size: 11 } },
        xaxis: { title: "Feature", tickangle: -45, tickfont: { size: 7 }, gridcolor: gridColor },
        yaxis: { title: "Sample", gridcolor: gridColor },
        margin: { t: 30, b: 60, l: 50, r: 10 },
      }), { responsive: true });

      return;
    }

    // ─── RANDOM / OTHER mode: treat generated samples as a synthetic trajectory ───
    mountEl.appendChild(elF("div", { style: "font-size:12px;color:#67e8f9;margin-bottom:8px;font-weight:600;" },
      "Generated Trajectory: " + samples.length + " timesteps, " + numAnts + " ants (decoded from latent space)"));

    // 1. Ant paths from generated data
    var genPathDiv = document.createElement("div");
    genPathDiv.style.cssText = "height:340px;";
    mountEl.appendChild(genPathDiv);

    var genTraces = [];
    var nT = samples.length;
    for (var ant = 0; ant < numAnts; ant++) {
      var gx = [], gy = [];
      for (var t = 0; t < nT; t++) {
        gx.push(samples[t][ant * 2] || 0);
        gy.push(samples[t][ant * 2 + 1] || 0);
      }
      genTraces.push({
        x: gx, y: gy, mode: "lines+markers", name: "Ant " + ant,
        line: { color: colors[ant % 20], width: 1.5 },
        marker: { size: 2 }, opacity: 0.8,
      });
    }
    Plotly.newPlot(genPathDiv, genTraces, Object.assign({}, darkBg, {
      title: { text: "Generated Ant Paths (x vs y, " + nT + " timesteps)", font: { size: 12 } },
      xaxis: { title: "x", gridcolor: gridColor },
      yaxis: { title: "y", gridcolor: gridColor, scaleanchor: "x" },
      legend: { font: { size: 8 }, bgcolor: "rgba(0,0,0,0)" },
      margin: { t: 30, b: 45, l: 50, r: 10 },
    }), { responsive: true });

    // 2. Compare with real data distribution if available
    var realSamples = dsData.xTrain || dsData.xTest || [];
    if (realSamples.length > 0) {
      // Per-feature mean ± std comparison (bar chart)
      var statsDiv = document.createElement("div");
      statsDiv.style.cssText = "height:260px;margin-top:12px;";
      mountEl.appendChild(statsDiv);

      var dim = samples[0].length;
      var featureLabels = [];
      for (var f = 0; f < numAnts; f++) { featureLabels.push("A" + f + ".x"); featureLabels.push("A" + f + ".y"); }

      function computeStats(arr) {
        var n = arr.length;
        var means = new Array(dim).fill(0);
        for (var i = 0; i < n; i++) for (var j = 0; j < dim; j++) means[j] += arr[i][j];
        for (var j = 0; j < dim; j++) means[j] /= n;
        var stds = new Array(dim).fill(0);
        for (var i = 0; i < n; i++) for (var j = 0; j < dim; j++) { var d = arr[i][j] - means[j]; stds[j] += d * d; }
        for (var j = 0; j < dim; j++) stds[j] = Math.sqrt(stds[j] / n);
        return { means: means, stds: stds };
      }
      var realStats = computeStats(realSamples.slice(0, 200));
      var genStats = computeStats(samples);

      Plotly.newPlot(statsDiv, [
        { x: featureLabels, y: realStats.means, type: "bar", name: "Real mean", marker: { color: "#475569" },
          error_y: { type: "data", array: realStats.stds, visible: true, color: "#64748b" } },
        { x: featureLabels, y: genStats.means, type: "bar", name: "Generated mean", marker: { color: "#38bdf8" },
          error_y: { type: "data", array: genStats.stds, visible: true, color: "#7dd3fc" } },
      ], Object.assign({}, darkBg, {
        title: { text: "Feature Distribution: Real vs Generated (mean ± std)", font: { size: 11 } },
        xaxis: { tickangle: -45, tickfont: { size: 7 }, gridcolor: gridColor },
        yaxis: { title: "Value", gridcolor: gridColor },
        barmode: "group", bargap: 0.15, bargroupgap: 0.05,
        legend: { font: { size: 9 } },
        margin: { t: 30, b: 60, l: 50, r: 10 },
      }), { responsive: true });
    }

    // 3. Time series of first 3 ants
    var tsDiv = document.createElement("div");
    tsDiv.style.cssText = "height:220px;margin-top:12px;";
    mountEl.appendChild(tsDiv);

    var showAnts = Math.min(3, numAnts);
    var timeIdx = []; for (var ti = 0; ti < nT; ti++) timeIdx.push(ti);
    var tsTraces = [];
    for (var a = 0; a < showAnts; a++) {
      tsTraces.push({
        x: timeIdx, y: timeIdx.map(function (t) { return samples[t][a * 2]; }),
        mode: "lines", name: "Ant" + a + " x", line: { color: colors[a * 2], width: 1.5 },
      });
      tsTraces.push({
        x: timeIdx, y: timeIdx.map(function (t) { return samples[t][a * 2 + 1]; }),
        mode: "lines", name: "Ant" + a + " y", line: { color: colors[a * 2 + 1], width: 1, dash: "dot" },
      });
    }
    Plotly.newPlot(tsDiv, tsTraces, Object.assign({}, darkBg, {
      title: { text: "Generated Time Series (first " + showAnts + " ants)", font: { size: 11 } },
      xaxis: { title: "Timestep", gridcolor: gridColor },
      yaxis: { title: "Position", gridcolor: gridColor },
      legend: { font: { size: 8 } },
      margin: { t: 25, b: 40, l: 50, r: 10 },
    }), { responsive: true });
  }

  // ─── Evaluation contract ───
  // All metrics are in normalized [0,1] space (MinMax scaled).
  // A value of 0.01 = 1% of the full position range.
  function getEvaluators() {
    return [
      {
        id: "worst_ant_mae",
        name: "Worst-Ant MAE (norm)",
        mode: "test",
        compute: function (deps) {
          var preds = deps.predictions || [];
          var truth = deps.truth || [];
          var dsData = deps.datasetData || {};
          var numAnts = dsData.numAnts || 20;
          var n = Math.min(preds.length, truth.length);
          if (!n) return { value: null };
          var antErrors = new Array(numAnts).fill(0);
          for (var i = 0; i < n; i++) {
            for (var a = 0; a < numAnts; a++) {
              antErrors[a] += (Math.abs((preds[i][a * 2] || 0) - (truth[i][a * 2] || 0)) +
                               Math.abs((preds[i][a * 2 + 1] || 0) - (truth[i][a * 2 + 1] || 0))) / 2;
            }
          }
          var worst = 0;
          for (var a = 0; a < numAnts; a++) { antErrors[a] /= n; if (antErrors[a] > worst) worst = antErrors[a]; }
          return { value: worst, formatted: (worst * 100).toFixed(2) + "%", details: { antErrors: antErrors } };
        },
      },
      {
        id: "mde",
        name: "Mean Displacement (norm)",
        mode: "test",
        compute: function (deps) {
          var preds = deps.predictions || [];
          var truth = deps.truth || [];
          var dsData = deps.datasetData || {};
          var numAnts = dsData.numAnts || 20;
          var n = Math.min(preds.length, truth.length);
          if (!n) return { value: null };
          var totalDisp = 0;
          for (var i = 0; i < n; i++) {
            for (var a = 0; a < numAnts; a++) {
              var dx = (preds[i][a * 2] || 0) - (truth[i][a * 2] || 0);
              var dy = (preds[i][a * 2 + 1] || 0) - (truth[i][a * 2 + 1] || 0);
              totalDisp += Math.sqrt(dx * dx + dy * dy);
            }
          }
          var mde = totalDisp / (n * numAnts);
          return { value: mde, formatted: (mde * 100).toFixed(2) + "%" };
        },
      },
    ];
  }

  function renderEvaluationResults(mountEl, deps) {
    if (!mountEl) return;
    var results = (deps && deps.results) || [];
    var Plotly = (deps && deps.Plotly) || (typeof window !== "undefined" && window.Plotly) || null;
    var elF = (deps && deps.el) || function (tag, attrs, text) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "style") e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]);
      });
      if (text) e.textContent = text;
      return e;
    };
    if (!Plotly || !results.length) return;

    var doneResults = results.filter(function (r) { return r.status === "done"; });
    if (!doneResults.length) return;

    var hasMde = doneResults.some(function (r) { return r.metrics && (r.metrics.mde != null || r.metrics.worst_ant_mae != null); });
    if (!hasMde) return;

    mountEl.appendChild(elF("div", { style: "font-size:11px;color:#67e8f9;margin-bottom:4px;font-weight:600;" },
      "Trajectory-Specific Metrics (normalized [0,1] space — 1% = 0.01)"));

    var chartDiv = document.createElement("div");
    chartDiv.style.cssText = "height:220px;";
    mountEl.appendChild(chartDiv);

    var names = doneResults.map(function (r) { return r.trainerName || r.modelName || "?"; });
    var mdeVals = doneResults.map(function (r) { return (r.metrics && r.metrics.mde || 0) * 100; });
    var worstVals = doneResults.map(function (r) { return (r.metrics && r.metrics.worst_ant_mae || 0) * 100; });

    Plotly.newPlot(chartDiv, [
      { x: names, y: mdeVals, type: "bar", name: "Mean Displacement (%)", marker: { color: "#22d3ee" },
        text: mdeVals.map(function (v) { return v.toFixed(2) + "%"; }), textposition: "outside", textfont: { size: 10, color: "#94a3b8" } },
      { x: names, y: worstVals, type: "bar", name: "Worst-Ant MAE (%)", marker: { color: "#f43f5e" },
        text: worstVals.map(function (v) { return v.toFixed(2) + "%"; }), textposition: "outside", textfont: { size: 10, color: "#94a3b8" } },
    ], {
      paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
      barmode: "group", bargap: 0.3,
      yaxis: { title: "Error (% of normalized range)", gridcolor: "#1e293b", ticksuffix: "%" },
      xaxis: { gridcolor: "#1e293b" },
      legend: { orientation: "h", y: -0.2, font: { size: 9 } },
      margin: { t: 10, b: 50, l: 55, r: 10 },
    }, { responsive: true });
  }

  return {
    id: "ant_trajectory",
    schemaId: "ant_trajectory",
    label: "Ant Trajectories (LSTM-VAE)",
    description: "20-ant motion trajectories from LSTM-VAE paper. 40 features (20 ants x,y). Normalized [0,1].",
    helpText: "Ant trajectory data for VAE reconstruction. Each sample = 40-dim vector of 20 ant positions.",
    kind: "panel_builder",
    playground: { mode: "trajectory" },
    preconfig: {
      dataset: { seed: 42, totalCount: 10399, splitDefaults: { mode: "random", train: 0.8, val: 0.1, test: 0.1 } },
    },
    build: build,
    playgroundApi: {
      renderPlayground: renderPlayground,
      renderDataset: renderPlayground,
      renderGeneratedSamples: renderGeneratedSamples,
      getEvaluators: getEvaluators,
      renderEvaluationResults: renderEvaluationResults,
    },
    uiApi: null,
  };
});

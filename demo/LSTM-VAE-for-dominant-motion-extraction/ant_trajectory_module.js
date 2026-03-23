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
    var totalCount = Math.min(Number(config.totalCount || 1000), allSamples.length);
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
    build({ totalCount: 1000, seed: 42 }).then(function (ds) {
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
    var allX = [].concat(ds.xTrain || [], ds.xVal || [], ds.xTest || []);
    var total = allX.length;

    mountEl.appendChild(elF("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:4px;" },
      "Ant Trajectories | " + numAnts + " ants | " + total + " timesteps | " + (ds.numFeatures || 40) + " features"));
    mountEl.appendChild(elF("div", { style: "font-size:11px;color:#64748b;margin-bottom:8px;" },
      "Train: " + (ds.trainCount || 0) + " | Val: " + (ds.valCount || 0) + " | Test: " + (ds.testCount || 0)));

    if (!Plotly || !allX.length) return;

    // Ant paths (x vs y)
    var chartDiv = document.createElement("div");
    chartDiv.style.cssText = "height:380px;";
    mountEl.appendChild(chartDiv);

    var colors = ["#22d3ee","#f59e0b","#4ade80","#f43f5e","#a78bfa","#fb923c","#2dd4bf","#e879f9","#fbbf24","#38bdf8",
                  "#818cf8","#34d399","#fb7185","#c084fc","#fcd34d","#6ee7b7","#f472b6","#93c5fd","#fdba74","#86efac"];
    var traces = [];
    for (var ant = 0; ant < numAnts; ant++) {
      var xc = [], yc = [];
      for (var t = 0; t < allX.length; t++) { xc.push(allX[t][ant * 2]); yc.push(allX[t][ant * 2 + 1]); }
      traces.push({ x: xc, y: yc, mode: "lines", name: "Ant " + ant, line: { color: colors[ant % 20], width: 1 }, opacity: 0.7 });
    }
    Plotly.newPlot(chartDiv, traces, {
      paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
      title: { text: numAnts + " Ant Paths (x vs y)", font: { size: 12 } },
      xaxis: { title: "x", gridcolor: "#1e293b" }, yaxis: { title: "y", gridcolor: "#1e293b", scaleanchor: "x" },
      legend: { font: { size: 8 }, bgcolor: "rgba(0,0,0,0)" },
      margin: { t: 30, b: 45, l: 50, r: 10 },
    }, { responsive: true });

    // Time series for first 3 ants
    var tsDiv = document.createElement("div");
    tsDiv.style.cssText = "height:220px;margin-top:8px;";
    mountEl.appendChild(tsDiv);
    var maxT = Math.min(allX.length, 500);
    var tsT = []; for (var si = 0; si < maxT; si++) tsT.push(si);
    var tsTraces = [];
    for (var a = 0; a < Math.min(3, numAnts); a++) {
      tsTraces.push({ x: tsT, y: tsT.map(function (t) { return allX[t][a * 2]; }), mode: "lines", name: "Ant" + a + " x", line: { color: colors[a * 2], width: 1 } });
      tsTraces.push({ x: tsT, y: tsT.map(function (t) { return allX[t][a * 2 + 1]; }), mode: "lines", name: "Ant" + a + " y", line: { color: colors[a * 2 + 1], width: 1, dash: "dot" } });
    }
    Plotly.newPlot(tsDiv, tsTraces, {
      paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
      title: { text: "Time Series (first 3 ants, " + maxT + " steps)", font: { size: 11 } },
      xaxis: { title: "Timestep", gridcolor: "#1e293b" }, yaxis: { title: "Position", gridcolor: "#1e293b" },
      legend: { font: { size: 8 } }, margin: { t: 25, b: 40, l: 50, r: 10 },
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
      dataset: { seed: 42, totalCount: 1000, splitDefaults: { mode: "random", train: 0.8, val: 0.1, test: 0.1 } },
    },
    build: build,
    playgroundApi: { renderPlayground: renderPlayground, renderDataset: renderPlayground },
    uiApi: null,
  };
});

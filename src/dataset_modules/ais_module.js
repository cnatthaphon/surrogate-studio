/**
 * AIS (Automatic Identification System) Dataset Module
 *
 * Maritime vessel trajectory data from the Danish Maritime Authority.
 * Each trajectory: sequence of [lat, lon, sog, cog] normalized to [0,1].
 * Input features: window of timesteps flattened → [windowSize * 4]
 * Target: next position [lat, lon, sog, cog]
 *
 * Region: Baltic Sea (55.5°N-58.0°N, 10.3°E-13.0°E)
 *
 * Reference: Nguyen et al., "TrAISformer — A generative transformer for
 * AIS trajectory prediction", arXiv:2109.03958
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
    return;
  }
  var mod = factory(root);
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.register === "function") {
    root.OSCDatasetModules.register(mod);
  }
  root.OSCDatasetModuleAis = mod;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var MODULE_ID = "ais_dma";
  var SCHEMA_ID = "ais_trajectory";
  var REGION = { latMin: 55.5, latMax: 58.0, lonMin: 10.3, lonMax: 13.0 };

  function denormLat(v) { return REGION.latMin + v * (REGION.latMax - REGION.latMin); }
  function denormLon(v) { return REGION.lonMin + v * (REGION.lonMax - REGION.lonMin); }

  // Inline data is set by the demo's preset.js (avoids XHR/CORS issues on file://)
  var _inlineData = null;

  function setInlineData(data) { _inlineData = data; }

  /**
   * Build dataset for training.
   * Each trajectory becomes multiple training samples:
   *   input: [windowSize * 4] (flattened last N timesteps)
   *   target: [4] (next position lat,lon,sog,cog)
   */
  function build(config) {
    config = config || {};
    var windowSize = Math.max(1, Number(config.windowSize || 16));

    var data = _inlineData;
    if (!data) {
      // Try global inline data
      var W = typeof window !== "undefined" ? window : {};
      data = W._AIS_INLINE_DATA || null;
    }
    if (!data || !data.train) {
      return Promise.reject(new Error("AIS data not loaded. Ensure ais_inline_data.js is included before preset.js"));
    }

    var trainTrajs = data.train || [];
    var valTrajs = data.val || [];

    function buildSamples(trajs) {
      var x = [], y = [];
      for (var ti = 0; ti < trajs.length; ti++) {
        var traj = trajs[ti]; // [[lat,lon,sog,cog], ...]
        for (var t = windowSize; t < traj.length; t++) {
          var input = [];
          for (var w = t - windowSize; w < t; w++) {
            for (var d = 0; d < 4; d++) input.push(traj[w][d]);
          }
          x.push(input);
          y.push(traj[t]);
        }
      }
      return { x: x, y: y };
    }

    var train = buildSamples(trainTrajs);
    var val = buildSamples(valTrajs);
    // use last 20% of val as test
    var testSplit = Math.floor(val.x.length * 0.6);
    var test = { x: val.x.slice(testSplit), y: val.y.slice(testSplit) };
    val = { x: val.x.slice(0, testSplit), y: val.y.slice(0, testSplit) };

    var result = {
      schemaId: SCHEMA_ID,
      name: "AIS DMA (" + trainTrajs.length + " trajectories)",
      mode: "regression",
      featureSize: windowSize * 4,
      targetSize: 4,
      windowSize: windowSize,
      xTrain: train.x, yTrain: train.y,
      xVal: val.x, yVal: val.y,
      xTest: test.x, yTest: test.y,
      region: REGION,
      columns: ["lat", "lon", "sog", "cog"],
      numTrajectories: { train: trainTrajs.length, val: valTrajs.length },
    };

    return Promise.resolve(result);
  }

  var playgroundApi = {
    renderDataset: function (mountEl, deps) {
      var el = deps.el;
      var data = _inlineData || (typeof window !== "undefined" ? window._AIS_INLINE_DATA : null);
      if (!data || !data.train) {
        mountEl.appendChild(el("div", { style: "color:#f59e0b;padding:12px;" }, "AIS data not loaded. Open demo/TrAISformer/index.html to use this module."));
        return;
      }

      var trajs = data.train.slice(0, 80);
      var canvas = document.createElement("canvas");
      canvas.width = 600; canvas.height = 400;
      canvas.style.cssText = "width:100%;max-width:600px;height:auto;border:1px solid #334155;border-radius:6px;background:#0a1628;";
      mountEl.appendChild(canvas);

      var ctx = canvas.getContext("2d");
      var colors = ["#22d3ee", "#4ade80", "#f59e0b", "#a78bfa", "#f43f5e", "#fb923c", "#34d399", "#818cf8"];

      trajs.forEach(function (traj, ti) {
        ctx.beginPath();
        ctx.strokeStyle = colors[ti % colors.length];
        ctx.lineWidth = 0.8;
        ctx.globalAlpha = 0.5;
        for (var i = 0; i < traj.length; i++) {
          var x = traj[i][1] * canvas.width;  // lon → x
          var y = (1 - traj[i][0]) * canvas.height; // lat → y (flip)
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      ctx.globalAlpha = 1;

      mountEl.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:4px;" },
        trajs.length + " trajectories | Baltic Sea (55.5°N–58.0°N, 10.3°E–13.0°E) | Features: lat, lon, SOG, COG"));
    },
  };

  var uiApi = {
    getDatasetConfigSpec: function () {
      return {
        sections: [{
          title: "AIS Trajectory Config",
          schema: [
            { key: "windowSize", label: "Window size (timesteps)", type: "number", default: 16, min: 4, max: 30 },
          ],
          value: { windowSize: 16 },
        }],
      };
    },
  };

  return {
    id: MODULE_ID,
    schemaId: SCHEMA_ID,
    label: "AIS Maritime Trajectories (DMA)",
    description: "Danish Maritime Authority vessel tracking data — Baltic Sea region",
    build: build,
    playgroundApi: playgroundApi,
    uiApi: uiApi,
    setInlineData: setInlineData,
    denormLat: denormLat,
    denormLon: denormLon,
    REGION: REGION,
  };
});

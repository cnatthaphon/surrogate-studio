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
  var descriptor = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = descriptor;
    return;
  }
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModule === "function") {
    root.OSCDatasetModules.registerModule(descriptor);
  }
  root.OSCDatasetModuleAis = descriptor;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var MODULE_ID = "ais_dma";
  var SCHEMA_ID = "ais_trajectory";
  var REGION = { latMin: 55.5, latMax: 58.0, lonMin: 10.3, lonMax: 13.0 };
  var LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  var LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  var _leafletLoaded = false;

  function _ensureLeaflet() {
    if (_leafletLoaded) return Promise.resolve();
    var W = typeof window !== "undefined" ? window : {};
    if (W.L && typeof W.L.map === "function") { _leafletLoaded = true; return Promise.resolve(); }
    return new Promise(function (resolve) {
      // Load CSS
      var link = document.createElement("link");
      link.rel = "stylesheet"; link.href = LEAFLET_CSS;
      document.head.appendChild(link);
      // Load JS
      var script = document.createElement("script");
      script.src = LEAFLET_JS;
      script.onload = function () { _leafletLoaded = true; resolve(); };
      script.onerror = function () { resolve(); }; // graceful fallback
      document.head.appendChild(script);
    });
  }
  var _cachedFetchedData = null;

  function denormLat(v) { return REGION.latMin + v * (REGION.latMax - REGION.latMin); }
  function denormLon(v) { return REGION.lonMin + v * (REGION.lonMax - REGION.lonMin); }

  // Inline data is set by the demo's preset.js (avoids XHR/CORS issues on file://)
  var _inlineData = null;

  function setInlineData(data) { _inlineData = data; }

  function _resolveDataBase() {
    if (typeof document !== "undefined") {
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        var src = scripts[i].src || "";
        if (src.indexOf("ais_module.js") >= 0) {
          return src.replace(/src\/dataset_modules\/ais_module\.js.*$/, "data/ais-dma/");
        }
      }
    }
    return "../../data/ais-dma/";
  }

  var _dataBase = _resolveDataBase();
  var DATA_URL = _dataBase + "ais_dma_small.json";

  function _extractTrajectory(entry) {
    if (!Array.isArray(entry)) return [];
    if (entry.length === 2 && Array.isArray(entry[1]) && Array.isArray(entry[1][0])) return entry[1];
    return entry;
  }

  function _fetchJSON(url) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "text";
      xhr.onload = function () {
        var text = xhr.responseText || "";
        if (!text) {
          reject(new Error("Empty response from " + url));
          return;
        }
        try { resolve(JSON.parse(text)); } catch (err) { reject(err); }
      };
      xhr.onerror = function () {
        reject(new Error("Network error loading " + url));
      };
      xhr.send();
    });
  }

  function loadData() {
    var W = typeof window !== "undefined" ? window : {};
    if (_inlineData) return Promise.resolve(_inlineData);
    if (W._AIS_INLINE_DATA) return Promise.resolve(W._AIS_INLINE_DATA);
    if (_cachedFetchedData) return Promise.resolve(_cachedFetchedData);
    return _fetchJSON(DATA_URL).then(function (data) {
      _cachedFetchedData = data;
      return data;
    });
  }

  /**
   * Build dataset for training.
   * Each trajectory becomes multiple training samples:
   *   input: [windowSize * 4] (flattened last N timesteps)
   *   target: [4] (next position lat,lon,sog,cog)
   */
  function build(config) {
    config = config || {};
    var windowSize = Math.max(1, Number(config.windowSize || 16));

    return loadData().then(function (data) {
      if (!data || !data.train) {
        throw new Error("AIS data not loaded.");
      }
      var trainTrajs = (data.train || []).map(_extractTrajectory).filter(function (traj) { return Array.isArray(traj) && traj.length > windowSize; });
      var valTrajs = (data.val || []).map(_extractTrajectory).filter(function (traj) { return Array.isArray(traj) && traj.length > windowSize; });
      var testTrajs = (data.test || []).map(_extractTrajectory).filter(function (traj) { return Array.isArray(traj) && traj.length > windowSize; });

      function buildSamples(trajs) {
      var x = [], y = [];
        for (var ti = 0; ti < trajs.length; ti++) {
          var traj = trajs[ti];
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
      var test = buildSamples(testTrajs);
      if (!test.x.length && val.x.length) {
        var testSplit = Math.floor(val.x.length * 0.6);
        test = { x: val.x.slice(testSplit), y: val.y.slice(testSplit) };
        val = { x: val.x.slice(0, testSplit), y: val.y.slice(0, testSplit) };
      }

      return {
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
        numTrajectories: { train: trainTrajs.length, val: valTrajs.length, test: testTrajs.length },
      };
    });
  }

  function _renderTrajectoryMap(mountEl, deps, opts) {
    var el = deps.el;
    var options = opts || {};
    var title = String(options.title || "AIS Trajectory Preview");
    var limit = Math.max(1, Number(options.limit || 80));
    mountEl.innerHTML = "";
    mountEl.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;font-weight:600;margin-bottom:6px;" }, title));
    var statusEl = el("div", { style: "font-size:12px;color:#94a3b8;" }, "Loading AIS trajectories...");
    mountEl.appendChild(statusEl);

    Promise.all([loadData(), _ensureLeaflet()]).then(function (results) {
      var data = results[0];
      var trajs = (data.train || []).map(_extractTrajectory).filter(function (traj) { return Array.isArray(traj) && traj.length; }).slice(0, limit);
      statusEl.remove();
      if (!trajs.length) {
        mountEl.appendChild(el("div", { style: "color:#fca5a5;padding:12px;" }, "No AIS trajectories available."));
        return;
      }

      var W = typeof window !== "undefined" ? window : {};
      var L = W.L; // Leaflet

      if (L && typeof L.map === "function") {
        // Leaflet map
        var mapDiv = document.createElement("div");
        mapDiv.style.cssText = "width:100%;height:450px;border-radius:8px;border:1px solid #334155;";
        mountEl.appendChild(mapDiv);

        var map = L.map(mapDiv, { zoomControl: true, attributionControl: true }).setView([56.75, 11.65], 7);

        // Dark tile layer
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
          subdomains: "abcd", maxZoom: 19,
        }).addTo(map);

        var colors = ["#22d3ee", "#4ade80", "#f59e0b", "#a78bfa", "#f43f5e", "#fb923c", "#34d399", "#818cf8"];

        trajs.forEach(function (traj, ti) {
          var latlngs = [];
          for (var i = 0; i < traj.length; i++) {
            var lat = denormLat(Number(traj[i][0] || 0));
            var lon = denormLon(Number(traj[i][1] || 0));
            latlngs.push([lat, lon]);
          }
          L.polyline(latlngs, { color: colors[ti % colors.length], weight: 1.5, opacity: 0.6 }).addTo(map);
        });

        // Fit bounds to data
        var allLats = [], allLons = [];
        trajs.forEach(function (traj) {
          traj.forEach(function (p) {
            allLats.push(denormLat(Number(p[0] || 0)));
            allLons.push(denormLon(Number(p[1] || 0)));
          });
        });
        if (allLats.length) {
          map.fitBounds([[Math.min.apply(null, allLats), Math.min.apply(null, allLons)],
                         [Math.max.apply(null, allLats), Math.max.apply(null, allLons)]], { padding: [20, 20] });
        }
      } else {
        // Fallback: canvas rendering (no Leaflet loaded)
        var canvas = document.createElement("canvas");
        canvas.width = 720; canvas.height = 440;
        canvas.style.cssText = "width:100%;max-width:720px;height:auto;border:1px solid #334155;border-radius:8px;background:#0a1628;";
        mountEl.appendChild(canvas);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#08111d";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        var colors2 = ["#22d3ee", "#4ade80", "#f59e0b", "#a78bfa", "#f43f5e", "#fb923c", "#34d399", "#818cf8"];
        trajs.forEach(function (traj, ti) {
          ctx.beginPath();
          ctx.strokeStyle = colors2[ti % colors2.length];
          ctx.lineWidth = 0.75;
          ctx.globalAlpha = 0.55;
          for (var i = 0; i < traj.length; i++) {
            var x = Number(traj[i][1] || 0) * canvas.width;
            var y = (1 - Number(traj[i][0] || 0)) * canvas.height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        });
        ctx.globalAlpha = 1;
      }

      mountEl.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:4px;" },
        trajs.length + " vessel trajectories | Baltic Sea | Features: lat, lon, SOG, COG"));
    }).catch(function (err) {
      statusEl.textContent = "AIS data load failed: " + String((err && err.message) || err || "unknown error");
      statusEl.style.color = "#fca5a5";
    });
  }

  var playgroundApi = {
    renderDataset: function (mountEl, deps) {
      _renderTrajectoryCanvas(mountEl, deps, { title: "AIS Dataset Preview", limit: 80 });
    },
    renderPlayground: function (mountEl, deps) {
      var el = deps.el;
      if (deps && deps.configEl) {
        deps.configEl.innerHTML = "";
        deps.configEl.appendChild(el("h3", {}, "AIS Info"));
        deps.configEl.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;line-height:1.5;" }, [
          "Autoregressive vessel trajectory prediction.",
          el("div", { style: "margin-top:6px;" }, "Input: 16-step window × 4 features"),
          el("div", {}, "Target: next [lat, lon, sog, cog]"),
          el("div", {}, "Data source: Danish Maritime Authority"),
        ]));
      }
      _renderTrajectoryCanvas(mountEl, deps, { title: "AIS Playground", limit: 120 });
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
    kind: "panel_builder",
    build: build,
    playgroundApi: playgroundApi,
    uiApi: uiApi,
    setInlineData: setInlineData,
    denormLat: denormLat,
    denormLon: denormLon,
    REGION: REGION,
  };
});

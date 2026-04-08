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

        var map = L.map(mapDiv, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([56.75, 11.65], 7);

        // Tile layers — user selects from layer control
        var attr_osm = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>';
        var attr_carto = attr_osm + ' &copy; <a href="https://carto.com/">CARTO</a>';
        // Satellite + labels overlay (default)
        var satTile = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: '&copy; Esri, Maxar, Earthstar', maxZoom: 18 });
        var labelOverlay = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", { attribution: attr_carto, subdomains: "abcd", maxZoom: 19, pane: "overlayPane" });

        var baseLayers = {
          "Satellite + Labels": L.layerGroup([satTile, labelOverlay]),
          "Dark": L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: attr_carto, subdomains: "abcd", maxZoom: 19 }),
          "Light": L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { attribution: attr_carto, subdomains: "abcd", maxZoom: 19 }),
          "Voyager": L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { attribution: attr_carto, subdomains: "abcd", maxZoom: 19 }),
        };
        baseLayers["Satellite + Labels"].addTo(map);
        L.control.layers(baseLayers, null, { collapsed: true, position: "topright" }).addTo(map);

        // Playground: show all trajectories as one set (no split)
        var allTrajs = [];
        ["train", "val", "test"].forEach(function (split) {
          (data[split] || []).map(_extractTrajectory).forEach(function (t) { if (t.length) allTrajs.push(t); });
        });
        allTrajs = allTrajs.slice(0, limit);

        // Color by speed (SOG): blue=slow → red=fast, range from data
        var maxSog = 0;
        allTrajs.forEach(function (traj) {
          for (var i = 0; i < traj.length; i++) {
            var s = Number(traj[i][2] || 0);
            if (s > maxSog) maxSog = s;
          }
        });
        if (maxSog < 0.001) maxSog = 1;

        function sogColor(sog) {
          var t = Math.min(1, Math.max(0, sog / maxSog));
          var r, g, b;
          if (t < 0.25) { r = 0; g = Math.round(255 * t * 4); b = 255; }
          else if (t < 0.5) { r = 0; g = 255; b = Math.round(255 * (1 - (t - 0.25) * 4)); }
          else if (t < 0.75) { r = Math.round(255 * (t - 0.5) * 4); g = 255; b = 0; }
          else { r = 255; g = Math.round(255 * (1 - (t - 0.75) * 4)); b = 0; }
          return "rgb(" + r + "," + g + "," + b + ")";
        }

        var allLats = [], allLons = [];
        // Draw trajectory segments + COG direction markers
        allTrajs.forEach(function (traj, trajIdx) {
          for (var i = 0; i < traj.length - 1; i++) {
            var lat1 = denormLat(Number(traj[i][0] || 0));
            var lon1 = denormLon(Number(traj[i][1] || 0));
            var lat2 = denormLat(Number(traj[i + 1][0] || 0));
            var lon2 = denormLon(Number(traj[i + 1][1] || 0));
            var sog = Number(traj[i][2] || 0);
            var cogNorm = Number(traj[i][3] || 0);
            var cogDeg = cogNorm * 360;
            var line = L.polyline([[lat1, lon1], [lat2, lon2]], { color: sogColor(sog), weight: 1.5, opacity: 0.7 });

            // Popup: clean format
            (function (pt, ti, si, lat, lon, spd, cog) {
              line.bindPopup(function () {
                return "<div style='font-size:12px;line-height:1.6;font-family:monospace;'>" +
                  "<div style='font-weight:700;margin-bottom:4px;border-bottom:1px solid #ccc;padding-bottom:2px;'>Vessel #" + ti + " — Step " + si + "/" + traj.length + "</div>" +
                  "<table style='border-collapse:collapse;'>" +
                  "<tr><td style='padding:1px 8px 1px 0;color:#666;'>Position</td><td>" + lat.toFixed(4) + "°N, " + lon.toFixed(4) + "°E</td></tr>" +
                  "<tr><td style='padding:1px 8px 1px 0;color:#666;'></td><td style='font-size:10px;color:#999;'>(norm: " + Number(pt[0]).toFixed(4) + ", " + Number(pt[1]).toFixed(4) + ")</td></tr>" +
                  "<tr><td style='padding:1px 8px 1px 0;color:#666;'>Speed</td><td>" + spd.toFixed(4) + " <span style='font-size:10px;color:#999;'>(norm)</span></td></tr>" +
                  "<tr><td style='padding:1px 8px 1px 0;color:#666;'>Course</td><td>" + cog.toFixed(1) + "° <span style='font-size:10px;color:#999;'>(norm: " + Number(pt[3]).toFixed(4) + ")</span></td></tr>" +
                  "</table></div>";
              });
            })(traj[i], trajIdx, i, lat1, lon1, sog, cogDeg);
            line.addTo(map);

            // COG triangle marker every N steps
            if (i % 4 === 0 && sog > 0.01) {
              var triIcon = L.divIcon({
                className: "",
                html: "<div style='transform:rotate(" + (cogDeg - 90) + "deg);font-size:8px;color:" + sogColor(sog) + ";opacity:0.8;'>&#9654;</div>",
                iconSize: [10, 10], iconAnchor: [5, 5],
              });
              L.marker([lat1, lon1], { icon: triIcon, interactive: false }).addTo(map);
            }

            allLats.push(lat1); allLons.push(lon1);
          }
          if (traj.length) {
            var last = traj[traj.length - 1];
            allLats.push(denormLat(Number(last[0] || 0)));
            allLons.push(denormLon(Number(last[1] || 0)));
          }
        });

        if (allLats.length) {
          map.fitBounds([[Math.min.apply(null, allLats), Math.min.apply(null, allLons)],
                         [Math.max.apply(null, allLats), Math.max.apply(null, allLons)]], { padding: [20, 20] });
        }

        // SOG color bar legend
        var legend = L.control({ position: "bottomright" });
        legend.onAdd = function () {
          var div = L.DomUtil.create("div");
          div.style.cssText = "background:rgba(0,0,0,0.7);padding:6px 10px;border-radius:4px;font-size:10px;color:#e2e8f0;line-height:1.4;";
          var bar = "";
          for (var gi = 0; gi <= 10; gi++) {
            bar += "<span style='display:inline-block;width:16px;height:10px;background:" + sogColor(maxSog * gi / 10) + ";'></span>";
          }
          div.innerHTML = "<div style='margin-bottom:2px;font-weight:600;'>Speed (SOG)</div>" +
            "<div>" + bar + "</div>" +
            "<div style='display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;'><span>0</span><span>" + maxSog.toFixed(2) + "</span></div>" +
            "<div style='margin-top:4px;font-size:9px;color:#94a3b8;'>&#9654; = course (COG)</div>";
          return div;
        };
        legend.addTo(map);
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
        allTrajs.length + " trajectories | Color: speed (blue=slow, red=fast) | Max SOG: " + maxSog.toFixed(2)));
    }).catch(function (err) {
      statusEl.textContent = "AIS data load failed: " + String((err && err.message) || err || "unknown error");
      statusEl.style.color = "#fca5a5";
    });
  }

  var playgroundApi = {
    renderDataset: function (mountEl, deps) {
      _renderTrajectoryMap(mountEl, deps, { title: "AIS Dataset Preview", limit: 80 });
    },
    renderPlayground: function (mountEl, deps) {
      _renderTrajectoryMap(mountEl, deps, { title: "AIS Trajectory Explorer", limit: 120 });
    },
  };

  var uiApi = {
    getDatasetConfigSpec: function () {
      return { sections: [] };
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

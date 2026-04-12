(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
    return;
  }
  var pack = factory(root);
  root.OSCDatasetModuleHRSIDShip = pack;
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModules === "function") {
    root.OSCDatasetModules.registerModules(pack.modules || []);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  /**
   * HRSID SAR Ship Detection — real SAR satellite imagery with ship bounding boxes.
   * 300 patches (64x64 grayscale) extracted from HRSID dataset.
   * Binary format: [uint32 count][uint32 dim][uint8 pixels...][float32 bboxes (4 per sample)...]
   */

  var IMAGE_W = 64;
  var IMAGE_H = 64;
  var FEATURE_SIZE = IMAGE_W * IMAGE_H;

  function clampInt(v, lo, hi) {
    var n = Number(v);
    if (!Number.isFinite(n)) n = lo;
    return Math.max(lo, Math.min(hi, Math.floor(n)));
  }

  function createRng(seed) {
    var s = (Math.floor(Number(seed) || 42) >>> 0) || 42;
    return function () {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function decodeData() {
    var W = typeof window !== "undefined" ? window : {};
    var b64 = W.HRSID_SHIPS_DATA_B64;
    if (!b64) return null;

    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var view = new DataView(bytes.buffer);
    var count = view.getUint32(0, true);
    var dim = view.getUint32(4, true);

    var imgOffset = 8;
    var bboxOffset = 8 + count * dim;

    var images = [];
    var bboxes = [];
    for (var s = 0; s < count; s++) {
      var img = new Array(dim);
      for (var j = 0; j < dim; j++) img[j] = bytes[imgOffset + s * dim + j] / 255;
      images.push(img);

      var bboxStart = bboxOffset + s * 4 * 4; // 4 floats * 4 bytes
      var bx = view.getFloat32(bboxStart, true);
      var by = view.getFloat32(bboxStart + 4, true);
      var bw = view.getFloat32(bboxStart + 8, true);
      var bh = view.getFloat32(bboxStart + 12, true);
      bboxes.push([bx, by, bw, bh]);
    }
    return { images: images, bboxes: bboxes, count: count, dim: dim };
  }

  var DATA_SCRIPT_URL = "demo/SAR-Ship-Detection/hrsid_ships_64x64.js";

  function _lazyLoadData() {
    var W = typeof window !== "undefined" ? window : {};
    if (W.HRSID_SHIPS_DATA_B64) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      // Try to find the script relative to document or known paths
      var basePaths = ["../../", "../../../", "./", "/"];
      var doc = typeof document !== "undefined" ? document : null;
      if (!doc) { reject(new Error("No document")); return; }
      function tryNext(i) {
        if (i >= basePaths.length) { reject(new Error("Could not load HRSID data")); return; }
        var s = doc.createElement("script");
        s.src = basePaths[i] + DATA_SCRIPT_URL;
        s.onload = function () { if (W.HRSID_SHIPS_DATA_B64) resolve(); else tryNext(i + 1); };
        s.onerror = function () { tryNext(i + 1); };
        doc.head.appendChild(s);
      }
      tryNext(0);
    });
  }

  function buildDataset(cfg) {
    var c = cfg || {};
    var seed = clampInt(c.seed, 0, 2147483647) || 42;
    var rng = createRng(seed);

    var data = decodeData();
    if (!data || !data.count) {
      // Try lazy load, then rebuild
      return _lazyLoadData().then(function () {
        return buildDataset(cfg);
      }).catch(function () {
        return {
          schemaId: "sar_ship_detection", datasetModuleId: "hrsid_ship",
          taskRecipeId: "detection_single_box", mode: "detection",
          imageShape: [IMAGE_H, IMAGE_W, 1], featureSize: FEATURE_SIZE, targetSize: 4,
          targetMode: "bbox", numClasses: 1, classCount: 1, classNames: ["ship"],
          seed: seed, trainCount: 0, valCount: 0, testCount: 0,
          xTrain: [], yTrain: [], xVal: [], yVal: [], xTest: [], yTest: [],
        };
      });
    }

    // Shuffle
    var indices = [];
    for (var i = 0; i < data.count; i++) indices.push(i);
    for (var si = indices.length - 1; si > 0; si--) {
      var sj = Math.floor(rng() * (si + 1));
      var tmp = indices[si]; indices[si] = indices[sj]; indices[sj] = tmp;
    }

    var trainFrac = Number(c.trainFrac) || 0.7;
    var valFrac = Number(c.valFrac) || 0.15;
    var nTrain = Math.max(1, Math.round(data.count * trainFrac));
    var nVal = Math.max(1, Math.round(data.count * valFrac));
    var nTest = Math.max(1, data.count - nTrain - nVal);

    var xTrain = [], yTrain = [], xVal = [], yVal = [], xTest = [], yTest = [];
    for (var ti = 0; ti < nTrain; ti++) { xTrain.push(data.images[indices[ti]]); yTrain.push(data.bboxes[indices[ti]]); }
    for (var vi = 0; vi < nVal; vi++) { xVal.push(data.images[indices[nTrain + vi]]); yVal.push(data.bboxes[indices[nTrain + vi]]); }
    for (var ei = 0; ei < nTest; ei++) { xTest.push(data.images[indices[nTrain + nVal + ei]]); yTest.push(data.bboxes[indices[nTrain + nVal + ei]]); }

    return {
      schemaId: "sar_ship_detection", datasetModuleId: "hrsid_ship",
      taskRecipeId: "detection_single_box", mode: "detection",
      imageShape: [IMAGE_H, IMAGE_W, 1], featureSize: FEATURE_SIZE, targetSize: 4,
      targetMode: "bbox", numClasses: 1, classCount: 1, classNames: ["ship"],
      seed: seed, splitConfig: { mode: "random", train: trainFrac, val: valFrac, test: 1 - trainFrac - valFrac },
      trainCount: nTrain, valCount: nVal, testCount: nTest,
      xTrain: xTrain, yTrain: yTrain, xVal: xVal, yVal: yVal, xTest: xTest, yTest: yTest,
    };
  }

  function renderPlayground(mountEl, deps) {
    if (!mountEl) return;
    var el = deps && deps.el ? deps.el : function (tag, attrs, ch) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "className") e.className = attrs[k];
        else if (k === "textContent") e.textContent = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
      if (ch) (Array.isArray(ch) ? ch : [ch]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
      return e;
    };

    mountEl.innerHTML = "";
    mountEl.appendChild(el("div", { style: "font-size:14px;color:#67e8f9;font-weight:600;margin-bottom:8px;" },
      "HRSID SAR Ship Detection"));
    mountEl.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:12px;" },
      "Synthetic Aperture Radar (SAR) satellite images with ship bounding boxes. 64x64 grayscale patches from HRSID."));

    var data = decodeData();
    if (!data) {
      mountEl.appendChild(el("div", { style: "color:#fbbf24;font-size:12px;" }, "Loading SAR data..."));
      _lazyLoadData().then(function () { renderPlayground(mountEl, deps); }).catch(function () {
        mountEl.innerHTML = "";
        mountEl.appendChild(el("div", { style: "color:#f87171;font-size:12px;" }, "SAR data not available. Open the demo page directly: demo/SAR-Ship-Detection/"));
      });
      return;
    }

    var coreRenderer = (typeof window !== "undefined" && window.OSCImageRenderCore) || null;
    if (!coreRenderer) return;

    var grid = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;" });
    var show = Math.min(12, data.count);
    for (var i = 0; i < show; i++) {
      var wrap = el("div", { style: "position:relative;width:80px;height:80px;" });
      var canvas = document.createElement("canvas");
      canvas.width = IMAGE_W; canvas.height = IMAGE_H;
      canvas.style.cssText = "width:80px;height:80px;border:1px solid #334155;border-radius:3px;image-rendering:pixelated;";
      coreRenderer.drawImageToCanvas(canvas.getContext("2d"), data.images[i], IMAGE_W, IMAGE_H);
      wrap.appendChild(canvas);

      // Draw bbox overlay
      var bbox = data.bboxes[i];
      var bDiv = el("div", {
        style: "position:absolute;border:2px solid #f59e0b;pointer-events:none;border-radius:1px;" +
          "left:" + (bbox[0] * 80) + "px;top:" + (bbox[1] * 80) + "px;" +
          "width:" + (bbox[2] * 80) + "px;height:" + (bbox[3] * 80) + "px;"
      });
      wrap.appendChild(bDiv);
      grid.appendChild(wrap);
    }
    mountEl.appendChild(grid);
    mountEl.appendChild(el("div", { style: "font-size:11px;color:#64748b;margin-top:8px;" },
      data.count + " SAR patches (" + IMAGE_W + "x" + IMAGE_H + "), bbox: [x,y,w,h] normalized"));
  }

  var modules = [{
    id: "hrsid_ship",
    schemaId: "sar_ship_detection",
    label: "HRSID SAR Ships",
    build: buildDataset,
    playgroundApi: { renderPlayground: renderPlayground },
  }];

  return { modules: modules, buildDataset: buildDataset, decodeData: decodeData };
});

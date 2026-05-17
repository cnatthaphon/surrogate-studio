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
   * 3000 patches (64x64 grayscale) extracted from HRSID dataset.
   * Binary format: [uint32 count][uint32 dim][uint8 pixels...][float32 bboxes (4 per sample)...]
   */

  // Image dimensions are derived from the bundled binary at decode
  // time. The format header carries `dim = W * H`; patches are square,
  // so W = H = sqrt(dim). No hardcoded image size: re-extracting the
  // bundle at a different patch size (via env-controlled
  // `scripts/extract_hrsid_bundle.py`) propagates through the demo
  // automatically as long as the preset/schema refer to the same
  // featureSize the bundle reports.
  function _dimsFromBundle(data) {
    if (!data) return { W: 0, H: 0, featureSize: 0 };
    var d = Number(data.dim) || 0;
    var side = Math.max(1, Math.round(Math.sqrt(d)));
    return { W: side, H: side, featureSize: side * side };
  }

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

    var W = typeof window !== "undefined" ? window : {};
    var data = decodeData();
    var dims = _dimsFromBundle(data);

    // Missing script — try lazy load
    if (!data && !W.HRSID_SHIPS_DATA_B64) {
      return _lazyLoadData().then(function () {
        return buildDataset(cfg);
      }).catch(function () {
        return {
          schemaId: "sar_ship_detection", datasetModuleId: "hrsid_ship",
          taskRecipeId: "detection_single_box", mode: "detection",
          imageShape: [dims.H, dims.W, 1], featureSize: dims.featureSize, targetSize: 4,
          targetMode: "bbox", numClasses: 1, classCount: 1, classNames: ["ship"],
          seed: seed, trainCount: 0, valCount: 0, testCount: 0,
          xTrain: [], yTrain: [], xVal: [], yVal: [], xTest: [], yTest: [],
        };
      });
    }

    // Present but empty/invalid payload
    if (!data || !data.count) {
      return {
        schemaId: "sar_ship_detection", datasetModuleId: "hrsid_ship",
        taskRecipeId: "detection_single_box", mode: "detection",
        imageShape: [dims.H, dims.W, 1], featureSize: dims.featureSize, targetSize: 4,
        targetMode: "bbox", numClasses: 1, classCount: 1, classNames: ["ship"],
        seed: seed, trainCount: 0, valCount: 0, testCount: 0,
        xTrain: [], yTrain: [], xVal: [], yVal: [], xTest: [], yTest: [],
      };
    }

    // Shuffle
    var indices = [];
    for (var i = 0; i < data.count; i++) indices.push(i);
    for (var si = indices.length - 1; si > 0; si--) {
      var sj = Math.floor(rng() * (si + 1));
      var tmp = indices[si]; indices[si] = indices[sj]; indices[sj] = tmp;
    }

    var trainFrac = Math.max(0, Math.min(1, Number(c.trainFrac) || 0.7));
    var valFrac   = Math.max(0, Math.min(1, Number(c.valFrac)   || 0.15));
    // Normalize when the two configured fractions overflow the pool: e.g.
    // trainFrac=0.99, valFrac=0.99 over-allocates and leaves a negative
    // test count. Clamp to leave at least one test sample.
    if (trainFrac + valFrac > 0.99) {
      var s = trainFrac + valFrac;
      trainFrac = trainFrac / s * 0.99;
      valFrac   = valFrac   / s * 0.99;
    }
    var nTrain = Math.max(1, Math.round(data.count * trainFrac));
    var nVal   = Math.max(1, Math.round(data.count * valFrac));
    if (nTrain + nVal >= data.count) nVal = Math.max(1, data.count - nTrain - 1);
    if (nTrain + nVal >= data.count) nTrain = Math.max(1, data.count - nVal - 1);
    var nTest  = Math.max(1, data.count - nTrain - nVal);

    var xTrain = [], yTrain = [], xVal = [], yVal = [], xTest = [], yTest = [];
    for (var ti = 0; ti < nTrain; ti++) { xTrain.push(data.images[indices[ti]]); yTrain.push(data.bboxes[indices[ti]]); }
    for (var vi = 0; vi < nVal; vi++) { xVal.push(data.images[indices[nTrain + vi]]); yVal.push(data.bboxes[indices[nTrain + vi]]); }
    for (var ei = 0; ei < nTest; ei++) { xTest.push(data.images[indices[nTrain + nVal + ei]]); yTest.push(data.bboxes[indices[nTrain + nVal + ei]]); }

    return {
      schemaId: "sar_ship_detection", datasetModuleId: "hrsid_ship",
      taskRecipeId: "detection_single_box", mode: "detection",
      imageShape: [dims.H, dims.W, 1], featureSize: dims.featureSize, targetSize: 4,
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
    var dims = _dimsFromBundle(data);
    var imgW = dims.W;
    var imgH = dims.H;

    // Resolve which sample pool(s) to show. When the Dataset tab passes a built
    // dataset payload (deps.datasetData has xTrain/yTrain/...), split into
    // Train/Val/Test pools and render each with its own Random button so the
    // reviewer can re-sample each split independently. Otherwise (Playground
    // tab) fall back to the full unsplit pool with one Random button.
    var providedData = deps && deps.datasetData;
    var splits;
    if (providedData && Array.isArray(providedData.xTrain)) {
      splits = [
        { name: "Train", x: providedData.xTrain || [], y: providedData.yTrain || [] },
        { name: "Val",   x: providedData.xVal || [],   y: providedData.yVal || [] },
        { name: "Test",  x: providedData.xTest || [],  y: providedData.yTest || [] },
      ].filter(function (s) { return s.x.length > 0; });
    } else {
      splits = [{ name: "Samples", x: data.images, y: data.bboxes }];
    }

    var SHOW = 12;
    var CELL = 80;
    var BBOX_COLOR = "#f59e0b";
    var allCells = [];

    function drawCellInto(canvas, bboxOverlay, pixels, bbox) {
      coreRenderer.drawImageToCanvas(canvas.getContext("2d"), pixels, imgW, imgH);
      if (bbox && bboxOverlay) {
        bboxOverlay.style.left   = (bbox[0] * CELL) + "px";
        bboxOverlay.style.top    = (bbox[1] * CELL) + "px";
        bboxOverlay.style.width  = (bbox[2] * CELL) + "px";
        bboxOverlay.style.height = (bbox[3] * CELL) + "px";
        bboxOverlay.style.display = "block";
      } else if (bboxOverlay) {
        bboxOverlay.style.display = "none";
      }
    }

    function resample(cells, randomize) {
      cells.forEach(function (cell, i) {
        if (!cell.pool.length) return;
        var idx = randomize
          ? Math.floor(Math.random() * cell.pool.length)
          : Math.min(i, cell.pool.length - 1);
        var poolIdx = cell.pool[idx];
        drawCellInto(cell.canvas, cell.bboxOverlay, cell.xData[poolIdx], cell.yData[poolIdx]);
        if (cell.idxLabel) cell.idxLabel.textContent = "#" + poolIdx;
      });
    }

    splits.forEach(function (split) {
      if (!split.x.length) return;

      var splitDiv = el("div", { style: "margin-bottom:14px;" });
      splitDiv.appendChild(el("div", { style: "font-size:11px;color:#67e8f9;font-weight:600;margin-bottom:4px;" },
        split.name + " (" + split.x.length + " patches)"));

      var grid = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;" });
      var n = Math.min(SHOW, split.x.length);
      var poolIndices = [];
      for (var p = 0; p < split.x.length; p++) poolIndices.push(p);

      var splitCells = [];
      for (var i = 0; i < n; i++) {
        var wrap = el("div", { style: "position:relative;width:" + CELL + "px;" });
        var canvas = document.createElement("canvas");
        canvas.width = imgW; canvas.height = imgH;
        canvas.style.cssText = "width:" + CELL + "px;height:" + CELL + "px;border:1px solid #334155;border-radius:3px;image-rendering:pixelated;display:block;";
        wrap.appendChild(canvas);

        var bboxOverlay = el("div", {
          style: "position:absolute;border:2px solid " + BBOX_COLOR + ";pointer-events:none;border-radius:1px;left:0;top:0;width:0;height:0;display:none;"
        });
        wrap.appendChild(bboxOverlay);

        var idxLabel = el("div", { style: "font-size:9px;color:#64748b;text-align:center;margin-top:2px;" }, "-");
        wrap.appendChild(idxLabel);

        grid.appendChild(wrap);
        var cell = {
          canvas: canvas, bboxOverlay: bboxOverlay, idxLabel: idxLabel,
          xData: split.x, yData: split.y, pool: poolIndices,
        };
        splitCells.push(cell);
        allCells.push(cell);
      }

      splitDiv.appendChild(grid);

      // Per-split Random button (only when there are multiple splits).
      if (splits.length > 1) {
        var splitBtn = el("button", { style: "margin-top:6px;padding:2px 10px;font-size:10px;border-radius:4px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;" }, "Random " + split.name);
        (function (cells) {
          splitBtn.addEventListener("click", function () { resample(cells, true); });
        })(splitCells);
        splitDiv.appendChild(splitBtn);
      }

      mountEl.appendChild(splitDiv);

      // initial deterministic draw (first N samples) so the grid renders
      // before the user clicks Random.
      resample(splitCells, false);
    });

    // Master Random button: re-sample every visible cell across all splits.
    var masterLabel = splits.length > 1 ? "Random All" : "Random";
    var masterBtn = el("button", { style: "margin-top:4px;padding:5px 14px;font-size:11px;border-radius:6px;border:1px solid #0ea5e9;background:#0284c7;color:#fff;cursor:pointer;font-weight:600;" }, masterLabel);
    masterBtn.addEventListener("click", function () { resample(allCells, true); });
    mountEl.appendChild(masterBtn);

    mountEl.appendChild(el("div", { style: "font-size:11px;color:#64748b;margin-top:8px;" },
      data.count + " SAR patches available (" + imgW + "x" + imgH + "), bbox: [x,y,w,h] normalized"));
  }

  // Mean IoU for bounding boxes in [x, y, w, h] normalized format. The
  // synthetic-detection module exports an IoU implementation that consumes
  // [x0, y0, x1, y1] corners; SAR-Ship's `format="xywh"` needs the corner
  // conversion before the intersection math. Inputs may be flat arrays
  // (4 floats per box) or nested [x, y, w, h] arrays.
  function _coords(box) {
    if (!box) return [0, 0, 0, 0];
    var x = Number(box[0] || 0);
    var y = Number(box[1] || 0);
    var w = Number(box[2] || 0);
    var h = Number(box[3] || 0);
    return [x, y, x + w, y + h];
  }
  function _clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

  function computeMeanIoUxywh(predictions, truth) {
    if (!Array.isArray(predictions) || !Array.isArray(truth) || !predictions.length || !truth.length) return 0;
    var n = Math.min(predictions.length, truth.length);
    var sum = 0;
    for (var i = 0; i < n; i++) {
      var p = _coords(predictions[i]);
      var t = _coords(truth[i]);
      var px0 = _clamp01(p[0]), py0 = _clamp01(p[1]), px1 = _clamp01(p[2]), py1 = _clamp01(p[3]);
      var tx0 = _clamp01(t[0]), ty0 = _clamp01(t[1]), tx1 = _clamp01(t[2]), ty1 = _clamp01(t[3]);
      var ix0 = Math.max(px0, tx0);
      var iy0 = Math.max(py0, ty0);
      var ix1 = Math.min(px1, tx1);
      var iy1 = Math.min(py1, ty1);
      var iw = Math.max(0, ix1 - ix0);
      var ih = Math.max(0, iy1 - iy0);
      var inter = iw * ih;
      var pa = Math.max(0, px1 - px0) * Math.max(0, py1 - py0);
      var ta = Math.max(0, tx1 - tx0) * Math.max(0, ty1 - ty0);
      var union = pa + ta - inter;
      sum += union > 1e-9 ? (inter / union) : 0;
    }
    return sum / Math.max(1, n);
  }

  var modules = [{
    id: "hrsid_ship",
    schemaId: "sar_ship_detection",
    label: "HRSID SAR Ships",
    build: buildDataset,
    playgroundApi: {
      renderPlayground: renderPlayground,
      getEvaluators: function () {
        return [{
          id: "iou_mean",
          name: "Mean IoU",
          mode: "test",
          compute: function (context) {
            return { value: computeMeanIoUxywh(context && context.predictions, context && context.truth) };
          },
        }];
      },
    },
  }];

  return {
    modules: modules,
    buildDataset: buildDataset,
    decodeData: decodeData,
    computeMeanIoUxywh: computeMeanIoUxywh,
  };
});

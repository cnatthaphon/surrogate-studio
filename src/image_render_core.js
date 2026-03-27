(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCImageRenderCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // --- helpers ---
  function defaultEl(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "className") e.className = attrs[k];
      else if (k === "textContent") e.textContent = attrs[k];
      else if (k === "style") e.style.cssText = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (typeof c === "number") e.appendChild(document.createTextNode(String(c)));
        else if (c && c.nodeType) e.appendChild(c);
      });
    }
    return e;
  }

  // --- draw one image to canvas (auto-detects grayscale vs RGB from data length) ---
  function drawImageToCanvas(ctx, pixels, imgW, imgH) {
    var imgData = ctx.createImageData(imgW, imgH);
    var planeSize = imgW * imgH;
    var isRgb = pixels.length >= planeSize * 3;
    for (var p = 0; p < planeSize; p++) {
      if (isRgb) {
        imgData.data[p * 4] = Math.round((pixels[p * 3] || 0) * 255);
        imgData.data[p * 4 + 1] = Math.round((pixels[p * 3 + 1] || 0) * 255);
        imgData.data[p * 4 + 2] = Math.round((pixels[p * 3 + 2] || 0) * 255);
      } else {
        var v = Math.round((pixels[p] || 0) * 255);
        imgData.data[p * 4] = v;
        imgData.data[p * 4 + 1] = v;
        imgData.data[p * 4 + 2] = v;
      }
      imgData.data[p * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  /**
   * renderDatasetResult — standard renderer for any image classification dataset.
   *
   * Reads ALL metadata from the data object (classNames, imageShape, classCount, records).
   * No hardcoded values. Works for grayscale (MNIST) and RGB (CIFAR-10) automatically.
   *
   * @param {Element} mountEl — DOM element to render into
   * @param {Object}  data   — standard dataset result from module.build()
   *   Required: data.records.{train,val,test}.{x,y}, data.classNames, data.imageShape
   * @param {Object}  opts   — optional config
   *   opts.el         — element factory function (default: built-in)
   *   opts.showSplits — show train/val/test separately (default: true)
   *   opts.label      — header label (default: data.schemaId)
   *   opts.canvasSize — CSS pixel size for each image (default: 44)
   */
  function renderDatasetResult(mountEl, data, opts) {
    if (!mountEl || !data) return;
    var options = opts || {};
    var el = options.el || defaultEl;
    var showSplits = options.showSplits !== false;
    var label = options.label || data.schemaId || "Dataset";
    var canvasSize = options.canvasSize || 44;

    // read metadata from data — single source of truth
    var classNames = data.classNames || [];
    var classCount = data.classCount || classNames.length || 10;
    var imageShape = Array.isArray(data.imageShape) ? data.imageShape : [28, 28, 1];
    var imgW = imageShape[0] || 28;
    var imgH = imageShape[1] || 28;

    mountEl.innerHTML = "";

    // header info
    var totalSamples = (data.trainCount || 0) + (data.valCount || 0) + (data.testCount || 0);
    mountEl.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:8px;" },
      label + " | Classes: " + classCount + " | Shape: " + imgW + "x" + imgH + "x" + (imageShape[2] || 1) +
      " | " + totalSamples + " samples" + (data.source ? " (" + data.source + ")" : "")));

    // resolve splits via source registry or legacy records
    var W = typeof root !== "undefined" ? root : {};
    var srcReg = W.OSCDatasetSourceRegistry || null;

    function _resolveSplit(d, splitName) {
      if (srcReg && typeof srcReg.resolveDatasetSplit === "function" && d.sourceId) {
        return srcReg.resolveDatasetSplit(d, splitName);
      }
      var rec = d.records && d.records[splitName];
      return rec ? { x: rec.x || [], y: rec.y || [], length: (rec.x || []).length } : { x: [], y: [], length: 0 };
    }

    var splits;
    if (showSplits) {
      splits = [];
      var train = _resolveSplit(data, "train");
      var val = _resolveSplit(data, "val");
      var test = _resolveSplit(data, "test");
      if (train.length) splits.push({ name: "Train", x: train.x, y: train.y, color: "#22d3ee" });
      if (val.length) splits.push({ name: "Val", x: val.x, y: val.y, color: "#fbbf24" });
      if (test.length) splits.push({ name: "Test", x: test.x, y: test.y, color: "#a78bfa" });
    } else {
      var all = _resolveSplit(data, "train");
      var valA = _resolveSplit(data, "val");
      var testA = _resolveSplit(data, "test");
      splits = [{ name: "Samples", x: [].concat(all.x, valA.x, testA.x), y: [].concat(all.y, valA.y, testA.y), color: "#22d3ee" }];
    }

    var allCanvases = [];

    splits.forEach(function (split) {
      if (!split.x.length) return;
      var splitDiv = el("div", { style: "margin-bottom:12px;" });

      // split header
      splitDiv.appendChild(el("div", { style: "font-size:11px;color:" + split.color + ";font-weight:600;margin-bottom:4px;" },
        split.name + " (" + split.x.length + " samples)"));

      // group by class
      var byClass = {};
      for (var i = 0; i < split.y.length; i++) {
        var cls = Number(split.y[i]);
        if (!byClass[cls]) byClass[cls] = [];
        byClass[cls].push(i);
      }

      // per-class image grid
      var canvases = [];
      var classRow = el("div", { style: "display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;" });
      for (var ci = 0; ci < classCount; ci++) {
        var canvas = document.createElement("canvas");
        canvas.width = imgW;
        canvas.height = imgH;
        canvas.style.cssText = "width:" + canvasSize + "px;height:" + canvasSize + "px;border:1px solid #334155;border-radius:3px;image-rendering:pixelated;background:#000;";
        var cellWrap = el("div", { style: "text-align:center;" });
        cellWrap.appendChild(canvas);
        var idxLabel = el("div", { style: "font-size:8px;color:#64748b;max-width:" + canvasSize + "px;overflow:hidden;text-overflow:ellipsis;" }, classNames[ci] || String(ci));
        cellWrap.appendChild(idxLabel);
        classRow.appendChild(cellWrap);
        canvases.push({ cls: ci, canvas: canvas, idxLabel: idxLabel, byClass: byClass, xData: split.x });
      }
      splitDiv.appendChild(classRow);

      // random button per split
      if (showSplits) {
        var splitRandBtn = el("button", { style: "margin-top:4px;padding:2px 8px;font-size:10px;border-radius:4px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;" }, "Random " + split.name);
        splitRandBtn.addEventListener("click", (function (cvs) {
          return function () { _drawSplitGrid(cvs, imgW, imgH, true); };
        })(canvases.slice()));
        splitDiv.appendChild(splitRandBtn);
      }

      mountEl.appendChild(splitDiv);
      allCanvases = allCanvases.concat(canvases);
    });

    // draw initial grid
    _drawSplitGrid(allCanvases, imgW, imgH, false);

    // random all button
    var randLabel = showSplits ? "Random All" : "Random";
    var randBtn = el("button", { style: "margin-top:8px;padding:4px 12px;font-size:11px;border-radius:6px;border:1px solid #0ea5e9;background:#0284c7;color:#fff;cursor:pointer;" }, randLabel);
    randBtn.addEventListener("click", function () { _drawSplitGrid(allCanvases, imgW, imgH, true); });
    mountEl.appendChild(randBtn);

    // class distribution per split
    splits.forEach(function (split) {
      _renderDistribution(mountEl, el, split.name, split.y, classCount, classNames, split.color);
    });
  }

  function _drawSplitGrid(canvases, w, h, randomize) {
    canvases.forEach(function (item) {
      var indices = item.byClass[item.cls] || [];
      if (!indices.length) return;
      var idx = randomize ? indices[Math.floor(Math.random() * indices.length)] : indices[0];
      var pixels = item.xData[idx];
      if (!pixels) return;
      drawImageToCanvas(item.canvas.getContext("2d"), pixels, w, h);
    });
  }

  function _renderDistribution(parentEl, el, title, yArr, classCount, classNames, color) {
    if (!yArr || !yArr.length) return;
    var hist = {};
    yArr.forEach(function (lbl) { var k = String(lbl); hist[k] = (hist[k] || 0) + 1; });
    var maxCount = 0;
    for (var i = 0; i < classCount; i++) maxCount = Math.max(maxCount, hist[String(i)] || 0);

    var wrap = el("div", { style: "margin-top:8px;margin-bottom:8px;" });
    wrap.appendChild(el("div", { style: "font-size:10px;color:#94a3b8;margin-bottom:2px;font-weight:600;" }, title + " Distribution (" + yArr.length + ")"));

    for (var ci = 0; ci < classCount; ci++) {
      var count = hist[String(ci)] || 0;
      var pct = maxCount > 0 ? (count / maxCount * 100) : 0;
      var row = el("div", { style: "display:flex;align-items:center;gap:4px;margin-bottom:1px;" });
      row.appendChild(el("div", { style: "width:70px;font-size:9px;color:#94a3b8;text-align:right;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;" }, classNames[ci] || String(ci)));
      var bar = el("div", { style: "flex:1;height:10px;background:#1e293b;border-radius:2px;overflow:hidden;" });
      bar.appendChild(el("div", { style: "height:100%;width:" + pct + "%;background:" + (color || "#22d3ee") + ";border-radius:2px;" }));
      row.appendChild(bar);
      row.appendChild(el("div", { style: "width:30px;font-size:9px;color:#64748b;" }, String(count)));
      wrap.appendChild(row);
    }
    parentEl.appendChild(wrap);
  }

  return {
    drawImageToCanvas: drawImageToCanvas,
    renderDatasetResult: renderDatasetResult,
  };
});

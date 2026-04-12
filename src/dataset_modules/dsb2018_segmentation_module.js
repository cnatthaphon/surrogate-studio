(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
    return;
  }
  var pack = factory(root);
  root.OSCDatasetModuleDSB2018 = pack;
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModules === "function") {
    root.OSCDatasetModules.registerModules(pack.modules || []);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var IMAGE_W = 32;
  var IMAGE_H = 32;
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

  /**
   * Decode DSB2018 data from base64 binary blob.
   * Format: [uint32 count][uint32 dim][uint8 images...][uint8 masks...]
   * Produced by scripts/preprocess_dsb2018.py
   */
  function decodeData() {
    var W = typeof window !== "undefined" ? window : {};
    var b64 = W.DSB2018_DATA_B64;
    if (!b64) return null;

    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var view = new DataView(bytes.buffer);
    var count = view.getUint32(0, true);
    var dim = view.getUint32(4, true);

    var imgOffset = 8;
    var maskOffset = 8 + count * dim;
    var images = [];
    var masks = [];
    for (var s = 0; s < count; s++) {
      var img = new Array(dim);
      var mask = new Array(dim);
      for (var j = 0; j < dim; j++) {
        img[j] = bytes[imgOffset + s * dim + j] / 255;
        mask[j] = bytes[maskOffset + s * dim + j] > 127 ? 1 : 0;
      }
      images.push(img);
      masks.push(mask);
    }
    return { images: images, masks: masks, count: count, dim: dim };
  }

  function buildDataset(cfg) {
    var c = cfg || {};
    var seed = clampInt(c.seed, 0, 2147483647) || 42;
    var rng = createRng(seed);

    var data = decodeData();
    if (!data || !data.count) {
      return {
        schemaId: "dsb2018_segmentation", datasetModuleId: "dsb2018_segmentation",
        taskRecipeId: "segmentation_mask", mode: "segmentation",
        imageShape: [IMAGE_H, IMAGE_W, 1], featureSize: FEATURE_SIZE, targetSize: FEATURE_SIZE,
        targetMode: "mask", numClasses: 2, classCount: 2, classNames: ["background", "nucleus"],
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

    var trainFrac = Number(c.trainFrac) || 0.7;
    var valFrac = Number(c.valFrac) || 0.15;
    var nTrain = Math.max(1, Math.round(data.count * trainFrac));
    var nVal = Math.max(1, Math.round(data.count * valFrac));
    var nTest = Math.max(1, data.count - nTrain - nVal);

    var xTrain = [], yTrain = [], xVal = [], yVal = [], xTest = [], yTest = [];
    for (var ti = 0; ti < nTrain; ti++) { xTrain.push(data.images[indices[ti]]); yTrain.push(data.masks[indices[ti]]); }
    for (var vi = 0; vi < nVal; vi++) { xVal.push(data.images[indices[nTrain + vi]]); yVal.push(data.masks[indices[nTrain + vi]]); }
    for (var ei = 0; ei < nTest; ei++) { xTest.push(data.images[indices[nTrain + nVal + ei]]); yTest.push(data.masks[indices[nTrain + nVal + ei]]); }

    return {
      schemaId: "dsb2018_segmentation", datasetModuleId: "dsb2018_segmentation",
      taskRecipeId: "segmentation_mask", mode: "segmentation",
      imageShape: [IMAGE_H, IMAGE_W, 1], featureSize: FEATURE_SIZE, targetSize: FEATURE_SIZE,
      targetMode: "mask", numClasses: 2, classCount: 2, classNames: ["background", "nucleus"],
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
      "DSB 2018 Cell Nuclei Segmentation"));
    mountEl.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:12px;" },
      "Microscopy images with binary nucleus masks. 32x32 grayscale, 300 samples from the 2018 Data Science Bowl."));

    var data = decodeData();
    if (!data) {
      mountEl.appendChild(el("div", { style: "color:#fbbf24;font-size:12px;" }, "Dataset not loaded. Include dsb2018_32x32_data.js."));
      return;
    }

    var coreRenderer = (typeof window !== "undefined" && window.OSCImageRenderCore) || null;
    if (!coreRenderer) return;

    var grid = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;" });
    var show = Math.min(12, data.count);
    for (var i = 0; i < show; i++) {
      var pair = el("div", { style: "display:flex;gap:2px;flex-direction:column;align-items:center;" });
      var imgC = document.createElement("canvas");
      imgC.width = IMAGE_W; imgC.height = IMAGE_H;
      imgC.style.cssText = "width:64px;height:64px;border:1px solid #334155;border-radius:3px;image-rendering:pixelated;";
      coreRenderer.drawImageToCanvas(imgC.getContext("2d"), data.images[i], IMAGE_W, IMAGE_H);
      pair.appendChild(imgC);

      var maskC = document.createElement("canvas");
      maskC.width = IMAGE_W; maskC.height = IMAGE_H;
      maskC.style.cssText = "width:64px;height:64px;border:1px solid #334155;border-radius:3px;image-rendering:pixelated;";
      coreRenderer.drawImageToCanvas(maskC.getContext("2d"), data.masks[i], IMAGE_W, IMAGE_H);
      pair.appendChild(maskC);

      pair.appendChild(el("div", { style: "font-size:9px;color:#64748b;" }, "image / mask"));
      grid.appendChild(pair);
    }
    mountEl.appendChild(grid);
    mountEl.appendChild(el("div", { style: "font-size:11px;color:#64748b;margin-top:8px;" },
      data.count + " samples loaded (" + IMAGE_W + "x" + IMAGE_H + " grayscale)"));
  }

  var modules = [{
    id: "dsb2018_segmentation",
    schemaId: "dsb2018_segmentation",
    label: "DSB 2018 Cell Nuclei",
    build: buildDataset,
    playgroundApi: { renderPlayground: renderPlayground },
  }];

  return { modules: modules, buildDataset: buildDataset, decodeData: decodeData };
});

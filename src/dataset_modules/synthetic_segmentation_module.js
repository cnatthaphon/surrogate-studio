(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
    return;
  }
  var pack = factory(root);
  root.OSCDatasetModuleSyntheticSegmentation = pack;
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
    n = Math.floor(n);
    return Math.max(lo, Math.min(hi, n));
  }

  function createRng(seed) {
    var s = (Math.floor(Number(seed) || 42) >>> 0) || 42;
    return function () {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function normalizeFractions(cfg) {
    var train = Number(cfg && cfg.trainFrac);
    var val = Number(cfg && cfg.valFrac);
    var test = Number(cfg && cfg.testFrac);
    if (!Number.isFinite(train)) train = 0.7;
    if (!Number.isFinite(val)) val = 0.15;
    if (!Number.isFinite(test)) test = 0.15;
    train = Math.max(0.05, train);
    val = Math.max(0.05, val);
    test = Math.max(0.05, test);
    var s = train + val + test;
    return { train: train / s, val: val / s, test: test / s };
  }

  /**
   * Generate a synthetic image with 1-3 random shapes and a corresponding binary mask.
   * Image: grayscale background + filled shapes (circles, rectangles) in varying brightness.
   * Mask: 1 where shape pixels are, 0 for background.
   */
  function generateSample(rng) {
    var pixels = new Array(FEATURE_SIZE);
    var mask = new Array(FEATURE_SIZE);

    // Random background brightness
    var bg = 0.05 + rng() * 0.15;
    for (var i = 0; i < FEATURE_SIZE; i++) {
      pixels[i] = bg + (rng() - 0.5) * 0.04; // slight noise
      mask[i] = 0;
    }

    // Draw 1-3 shapes
    var nShapes = 1 + Math.floor(rng() * 3);
    for (var s = 0; s < nShapes; s++) {
      var brightness = 0.5 + rng() * 0.5;
      var shapeType = rng() < 0.5 ? "circle" : "rect";
      var cx = 4 + Math.floor(rng() * (IMAGE_W - 8));
      var cy = 4 + Math.floor(rng() * (IMAGE_H - 8));

      if (shapeType === "circle") {
        var radius = 3 + Math.floor(rng() * 6);
        for (var y = 0; y < IMAGE_H; y++) {
          for (var x = 0; x < IMAGE_W; x++) {
            var dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy <= radius * radius) {
              var idx = y * IMAGE_W + x;
              pixels[idx] = brightness;
              mask[idx] = 1;
            }
          }
        }
      } else {
        var hw = 2 + Math.floor(rng() * 6);
        var hh = 2 + Math.floor(rng() * 6);
        var x0 = Math.max(0, cx - hw), x1 = Math.min(IMAGE_W - 1, cx + hw);
        var y0 = Math.max(0, cy - hh), y1 = Math.min(IMAGE_H - 1, cy + hh);
        for (var ry = y0; ry <= y1; ry++) {
          for (var rx = x0; rx <= x1; rx++) {
            var ridx = ry * IMAGE_W + rx;
            pixels[ridx] = brightness;
            mask[ridx] = 1;
          }
        }
      }
    }

    // Clamp pixels
    for (var j = 0; j < FEATURE_SIZE; j++) {
      pixels[j] = Math.max(0, Math.min(1, pixels[j]));
    }

    return { pixels: pixels, mask: mask };
  }

  function buildDataset(cfg) {
    var c = cfg || {};
    var seed = clampInt(c.seed, 0, 2147483647) || 42;
    var rng = createRng(seed);
    var fr = normalizeFractions(c);
    var totalCount = clampInt(c.totalCount || c.sourceTotalExamples || 500, 30, 20000);
    var nTrain = Math.max(1, Math.round(totalCount * fr.train));
    var nVal = Math.max(1, Math.round(totalCount * fr.val));
    var nTest = Math.max(1, totalCount - nTrain - nVal);

    var xTrain = [], yTrain = [];
    var xVal = [], yVal = [];
    var xTest = [], yTest = [];

    function genSplit(n, xArr, yArr) {
      for (var i = 0; i < n; i++) {
        var sample = generateSample(rng);
        xArr.push(sample.pixels);
        yArr.push(sample.mask);
      }
    }
    genSplit(nTrain, xTrain, yTrain);
    genSplit(nVal, xVal, yVal);
    genSplit(nTest, xTest, yTest);

    return {
      schemaId: "synthetic_segmentation",
      datasetModuleId: "synthetic_segmentation",
      taskRecipeId: "segmentation_mask",
      mode: "segmentation",
      imageShape: [IMAGE_H, IMAGE_W, 1],
      featureSize: FEATURE_SIZE,
      targetSize: FEATURE_SIZE,
      targetMode: "mask",
      numClasses: 2,
      classCount: 2,
      classNames: ["background", "shape"],
      seed: seed,
      splitConfig: { mode: "random", train: fr.train, val: fr.val, test: fr.test },
      trainCount: nTrain,
      valCount: nVal,
      testCount: nTest,
      xTrain: xTrain,
      yTrain: yTrain,
      xVal: xVal,
      yVal: yVal,
      xTest: xTest,
      yTest: yTest,
    };
  }

  // Playground renderer: show sample images + masks side by side
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
    var isCurrent = deps && deps.isCurrent ? deps.isCurrent : function () { return true; };

    mountEl.innerHTML = "";
    mountEl.appendChild(el("div", { style: "font-size:14px;color:#67e8f9;font-weight:600;margin-bottom:8px;" }, "Synthetic Segmentation Preview"));
    mountEl.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:12px;" },
      "Random shapes (circles + rectangles) on noisy backgrounds. Target: binary pixel mask."));

    var samples = [];
    var rng = createRng(42);
    for (var i = 0; i < 8; i++) samples.push(generateSample(rng));

    var coreRenderer = (typeof window !== "undefined" && window.OSCImageRenderCore) || null;
    if (!coreRenderer) {
      mountEl.appendChild(el("div", { style: "color:#fbbf24;font-size:12px;" }, "Image renderer not available."));
      return;
    }

    var grid = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;" });
    samples.forEach(function (s) {
      var pair = el("div", { style: "display:flex;gap:2px;flex-direction:column;align-items:center;" });

      var imgCanvas = document.createElement("canvas");
      imgCanvas.width = IMAGE_W; imgCanvas.height = IMAGE_H;
      imgCanvas.style.cssText = "width:64px;height:64px;border:1px solid #334155;border-radius:3px;image-rendering:pixelated;";
      coreRenderer.drawImageToCanvas(imgCanvas.getContext("2d"), s.pixels, IMAGE_W, IMAGE_H);
      pair.appendChild(imgCanvas);

      var maskCanvas = document.createElement("canvas");
      maskCanvas.width = IMAGE_W; maskCanvas.height = IMAGE_H;
      maskCanvas.style.cssText = "width:64px;height:64px;border:1px solid #334155;border-radius:3px;image-rendering:pixelated;";
      coreRenderer.drawImageToCanvas(maskCanvas.getContext("2d"), s.mask, IMAGE_W, IMAGE_H);
      pair.appendChild(maskCanvas);

      pair.appendChild(el("div", { style: "font-size:9px;color:#64748b;" }, "img / mask"));
      grid.appendChild(pair);
    });
    mountEl.appendChild(grid);
  }

  var modules = [
    {
      id: "synthetic_segmentation",
      schemaId: "synthetic_segmentation",
      label: "Synthetic Segmentation",
      build: buildDataset,
      playgroundApi: {
        renderPlayground: renderPlayground,
      },
    },
  ];

  return { modules: modules, buildDataset: buildDataset };
});

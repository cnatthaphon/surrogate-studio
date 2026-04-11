(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
    return;
  }
  var pack = factory(root);
  root.OSCDatasetModuleSiamesePairs = pack;
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModules === "function") {
    root.OSCDatasetModules.registerModules(pack.modules || []);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  /**
   * Siamese Pair Dataset — generates pairs of Fashion-MNIST-like images
   * for similarity learning (contrastive classification).
   *
   * Each sample: [img_A (784) | img_B (784)] = 1568 features
   * Label: 1 = same class, 0 = different class
   *
   * Uses synthetic grayscale images (simple shapes per class) so no CDN needed.
   */

  var IMAGE_SIZE = 28;
  var PIXELS = IMAGE_SIZE * IMAGE_SIZE;
  var PAIR_SIZE = PIXELS * 2;
  var NUM_CLASSES = 5;
  var CLASS_NAMES = ["circle", "square", "triangle", "cross", "diamond"];

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

  // Draw simple shapes for each class
  function generateImage(classIdx, rng) {
    var pixels = new Array(PIXELS).fill(0);
    var brightness = 0.6 + rng() * 0.4;
    var cx = 10 + Math.floor(rng() * 8);
    var cy = 10 + Math.floor(rng() * 8);
    var size = 5 + Math.floor(rng() * 4);

    // Add slight background noise
    for (var n = 0; n < PIXELS; n++) pixels[n] = rng() * 0.05;

    if (classIdx === 0) {
      // Circle
      for (var y = 0; y < IMAGE_SIZE; y++) {
        for (var x = 0; x < IMAGE_SIZE; x++) {
          var dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy <= size * size) pixels[y * IMAGE_SIZE + x] = brightness;
        }
      }
    } else if (classIdx === 1) {
      // Square
      var x0 = Math.max(0, cx - size), x1 = Math.min(IMAGE_SIZE - 1, cx + size);
      var y0 = Math.max(0, cy - size), y1 = Math.min(IMAGE_SIZE - 1, cy + size);
      for (var sy = y0; sy <= y1; sy++) for (var sx = x0; sx <= x1; sx++) pixels[sy * IMAGE_SIZE + sx] = brightness;
    } else if (classIdx === 2) {
      // Triangle (pointing up)
      for (var ty = cy - size; ty <= cy + size; ty++) {
        var halfW = Math.max(0, Math.round(size * (ty - (cy - size)) / (2 * size)));
        for (var tx = cx - halfW; tx <= cx + halfW; tx++) {
          if (tx >= 0 && tx < IMAGE_SIZE && ty >= 0 && ty < IMAGE_SIZE) pixels[ty * IMAGE_SIZE + tx] = brightness;
        }
      }
    } else if (classIdx === 3) {
      // Cross
      for (var ci = -size; ci <= size; ci++) {
        var px = cx + ci, py = cy + ci, py2 = cy - ci;
        if (px >= 0 && px < IMAGE_SIZE) {
          if (cy >= 0 && cy < IMAGE_SIZE) pixels[cy * IMAGE_SIZE + px] = brightness; // horizontal
        }
        if (cx >= 0 && cx < IMAGE_SIZE) {
          if (py >= 0 && py < IMAGE_SIZE) pixels[py * IMAGE_SIZE + cx] = brightness; // vertical
        }
      }
    } else {
      // Diamond
      for (var dy2 = -size; dy2 <= size; dy2++) {
        var hw = size - Math.abs(dy2);
        for (var dx2 = -hw; dx2 <= hw; dx2++) {
          var ddx = cx + dx2, ddy = cy + dy2;
          if (ddx >= 0 && ddx < IMAGE_SIZE && ddy >= 0 && ddy < IMAGE_SIZE) pixels[ddy * IMAGE_SIZE + ddx] = brightness;
        }
      }
    }

    return pixels;
  }

  function buildDataset(cfg) {
    var c = cfg || {};
    var seed = clampInt(c.seed, 0, 2147483647) || 42;
    var rng = createRng(seed);
    var totalCount = clampInt(c.totalCount || c.sourceTotalExamples || 1000, 50, 20000);
    var trainFrac = Number(c.trainFrac) || 0.7;
    var valFrac = Number(c.valFrac) || 0.15;
    var nTrain = Math.max(1, Math.round(totalCount * trainFrac));
    var nVal = Math.max(1, Math.round(totalCount * valFrac));
    var nTest = Math.max(1, totalCount - nTrain - nVal);

    // Pre-generate a bank of images per class
    var bank = [];
    var bankSize = 20;
    for (var ci = 0; ci < NUM_CLASSES; ci++) {
      bank[ci] = [];
      for (var bi = 0; bi < bankSize; bi++) bank[ci].push(generateImage(ci, rng));
    }

    function genPair(rng) {
      var same = rng() < 0.5;
      var classA = Math.floor(rng() * NUM_CLASSES);
      var classB = same ? classA : ((classA + 1 + Math.floor(rng() * (NUM_CLASSES - 1))) % NUM_CLASSES);
      var imgA = bank[classA][Math.floor(rng() * bankSize)];
      var imgB = bank[classB][Math.floor(rng() * bankSize)];
      // Concatenate: [imgA | imgB]
      var pair = new Array(PAIR_SIZE);
      for (var i = 0; i < PIXELS; i++) pair[i] = imgA[i];
      for (var j = 0; j < PIXELS; j++) pair[PIXELS + j] = imgB[j];
      return { x: pair, y: same ? 1 : 0 };
    }

    var xTrain = [], yTrain = [], xVal = [], yVal = [], xTest = [], yTest = [];
    function genSplit(n, xArr, yArr) {
      for (var i = 0; i < n; i++) { var p = genPair(rng); xArr.push(p.x); yArr.push(p.y); }
    }
    genSplit(nTrain, xTrain, yTrain);
    genSplit(nVal, xVal, yVal);
    genSplit(nTest, xTest, yTest);

    return {
      schemaId: "siamese_pairs",
      datasetModuleId: "siamese_pairs",
      mode: "classification",
      featureSize: PAIR_SIZE,
      targetSize: 2,
      targetMode: "label",
      numClasses: 2,
      classCount: 2,
      classNames: ["different", "same"],
      shapeClassNames: CLASS_NAMES,
      imageSize: IMAGE_SIZE,
      seed: seed,
      splitConfig: { mode: "random", train: trainFrac, val: valFrac, test: 1 - trainFrac - valFrac },
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
      "Siamese Pair Classification"));
    mountEl.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:12px;" },
      "Pairs of shape images — model learns to classify same vs different. " + NUM_CLASSES + " shape classes: " + CLASS_NAMES.join(", ") + "."));

    var coreRenderer = (typeof window !== "undefined" && window.OSCImageRenderCore) || null;
    if (!coreRenderer) return;

    var rng = createRng(42);
    var grid = el("div", { style: "display:flex;flex-wrap:wrap;gap:12px;" });
    for (var i = 0; i < 8; i++) {
      var same = rng() < 0.5;
      var cA = Math.floor(rng() * NUM_CLASSES);
      var cB = same ? cA : ((cA + 1 + Math.floor(rng() * (NUM_CLASSES - 1))) % NUM_CLASSES);
      var imgA = generateImage(cA, rng);
      var imgB = generateImage(cB, rng);

      var pair = el("div", { style: "display:flex;gap:4px;align-items:center;" });
      var cA_el = document.createElement("canvas");
      cA_el.width = IMAGE_SIZE; cA_el.height = IMAGE_SIZE;
      cA_el.style.cssText = "width:48px;height:48px;border:1px solid #334155;border-radius:3px;image-rendering:pixelated;";
      coreRenderer.drawImageToCanvas(cA_el.getContext("2d"), imgA, IMAGE_SIZE, IMAGE_SIZE);
      pair.appendChild(cA_el);

      var label = same ? "=" : "≠";
      var color = same ? "#4ade80" : "#f87171";
      pair.appendChild(el("span", { style: "font-size:18px;font-weight:700;color:" + color + ";" }, label));

      var cB_el = document.createElement("canvas");
      cB_el.width = IMAGE_SIZE; cB_el.height = IMAGE_SIZE;
      cB_el.style.cssText = "width:48px;height:48px;border:1px solid #334155;border-radius:3px;image-rendering:pixelated;";
      coreRenderer.drawImageToCanvas(cB_el.getContext("2d"), imgB, IMAGE_SIZE, IMAGE_SIZE);
      pair.appendChild(cB_el);

      pair.appendChild(el("span", { style: "font-size:9px;color:#64748b;" }, same ? "same" : "diff"));
      grid.appendChild(pair);
    }
    mountEl.appendChild(grid);
  }

  var modules = [{
    id: "siamese_pairs",
    schemaId: "siamese_pairs",
    label: "Siamese Shape Pairs",
    build: buildDataset,
    playgroundApi: { renderPlayground: renderPlayground },
  }];

  return { modules: modules, buildDataset: buildDataset };
});

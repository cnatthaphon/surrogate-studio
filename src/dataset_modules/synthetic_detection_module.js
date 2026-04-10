(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
    return;
  }
  var pack = factory(root);
  root.OSCDatasetModuleSyntheticDetection = pack;
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModules === "function") {
    root.OSCDatasetModules.registerModules(pack.modules || []);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var IMAGE_W = 32;
  var IMAGE_H = 32;
  var FEATURE_SIZE = IMAGE_W * IMAGE_H;
  var CLASS_NAMES = ["square", "wide_box", "tall_box"];

  function clampInt(v, lo, hi) {
    var n = Number(v);
    if (!Number.isFinite(n)) n = lo;
    n = Math.floor(n);
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }

  function clamp01(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) n = 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
  }

  function createRng(seed) {
    var s = (Math.floor(Number(seed) || 42) >>> 0) || 42;
    return function () {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function oneHot(index, n) {
    var out = new Array(n).fill(0);
    out[clampInt(index, 0, n - 1)] = 1;
    return out;
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

  function splitCounts(total, fr) {
    var n = Math.max(30, clampInt(total, 30, 20000));
    var nTrain = Math.max(1, Math.round(n * fr.train));
    var nVal = Math.max(1, Math.round(n * fr.val));
    var nTest = Math.max(1, n - nTrain - nVal);
    while (nTrain + nVal + nTest > n) {
      if (nTrain >= nVal && nTrain > 1) nTrain -= 1;
      else if (nVal > 1) nVal -= 1;
      else nTest -= 1;
    }
    while (nTrain + nVal + nTest < n) nTrain += 1;
    return { total: n, train: nTrain, val: nVal, test: nTest };
  }

  function drawFilledRect(pixels, x0, y0, x1, y1, value) {
    for (var y = y0; y <= y1; y += 1) {
      for (var x = x0; x <= x1; x += 1) {
        pixels[y * IMAGE_W + x] = value;
      }
    }
  }

  function addBackgroundNoise(pixels, rng) {
    for (var i = 0; i < pixels.length; i += 1) {
      var base = pixels[i];
      var noise = (rng() * 0.05);
      pixels[i] = clamp01(base + noise);
    }
  }

  function makeSample(label, rng) {
    var pixels = new Array(FEATURE_SIZE).fill(0);
    var x0;
    var y0;
    var x1;
    var y1;
    if (label === 0) {
      var side = clampInt(8 + rng() * 8, 8, 15);
      x0 = clampInt(rng() * (IMAGE_W - side - 2), 1, IMAGE_W - side - 1);
      y0 = clampInt(rng() * (IMAGE_H - side - 2), 1, IMAGE_H - side - 1);
      x1 = x0 + side;
      y1 = y0 + side;
    } else if (label === 1) {
      var wide = clampInt(12 + rng() * 8, 12, 20);
      var short = clampInt(6 + rng() * 4, 6, 10);
      x0 = clampInt(rng() * (IMAGE_W - wide - 2), 1, IMAGE_W - wide - 1);
      y0 = clampInt(rng() * (IMAGE_H - short - 2), 1, IMAGE_H - short - 1);
      x1 = x0 + wide;
      y1 = y0 + short;
    } else {
      var narrow = clampInt(6 + rng() * 4, 6, 10);
      var tall = clampInt(12 + rng() * 8, 12, 20);
      x0 = clampInt(rng() * (IMAGE_W - narrow - 2), 1, IMAGE_W - narrow - 1);
      y0 = clampInt(rng() * (IMAGE_H - tall - 2), 1, IMAGE_H - tall - 1);
      x1 = x0 + narrow;
      y1 = y0 + tall;
    }
    drawFilledRect(pixels, x0, y0, x1, y1, 0.9);
    addBackgroundNoise(pixels, rng);
    return {
      x: pixels,
      bbox: [
        clamp01(x0 / (IMAGE_W - 1)),
        clamp01(y0 / (IMAGE_H - 1)),
        clamp01(x1 / (IMAGE_W - 1)),
        clamp01(y1 / (IMAGE_H - 1)),
      ],
      label: label,
    };
  }

  function stratifiedSplit(total, rng) {
    var fr = normalizeFractions(total);
    var counts = splitCounts(total.totalCount, fr);
    return { fractions: fr, counts: counts };
  }

  function computeMeanIoU(predictions, truth) {
    if (!Array.isArray(predictions) || !Array.isArray(truth) || !predictions.length || !truth.length) return 0;
    var n = Math.min(predictions.length, truth.length);
    var sum = 0;
    for (var i = 0; i < n; i += 1) {
      var p = Array.isArray(predictions[i]) ? predictions[i] : [];
      var t = Array.isArray(truth[i]) ? truth[i] : [];
      var px0 = clamp01(Number(p[0] || 0));
      var py0 = clamp01(Number(p[1] || 0));
      var px1 = clamp01(Number(p[2] || 0));
      var py1 = clamp01(Number(p[3] || 0));
      var tx0 = clamp01(Number(t[0] || 0));
      var ty0 = clamp01(Number(t[1] || 0));
      var tx1 = clamp01(Number(t[2] || 0));
      var ty1 = clamp01(Number(t[3] || 0));
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

  function parseClassNames(raw) {
    var items = String(raw || "").split(",").map(function (s) { return String(s || "").trim(); }).filter(Boolean);
    return items.length ? items : CLASS_NAMES.slice();
  }

  function renderGrid(mountEl, datasetData) {
    mountEl.innerHTML = "";
    var splitX = datasetData.xTrain || [];
    var splitB = datasetData.yTrain || [];
    var splitL = datasetData.labelsTrain || [];
    if (!splitX.length && datasetData.sourceDescriptor) {
      var info = document.createElement("div");
      info.style.cssText = "padding:10px;border:1px dashed #334155;border-radius:8px;background:#0b1220;font-size:12px;color:#cbd5e1;";
      info.textContent = "Local source descriptor configured. Preview is unavailable in the browser; use the PyTorch server or notebook runtime to load data from disk.";
      mountEl.appendChild(info);
      return;
    }
    var title = document.createElement("div");
    title.style.cssText = "font-size:12px;color:#cbd5e1;margin-bottom:8px;";
    title.textContent = "Synthetic single-object detection samples";
    mountEl.appendChild(title);
    var grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;";
    mountEl.appendChild(grid);
    for (var i = 0; i < Math.min(8, splitX.length); i += 1) {
      var card = document.createElement("div");
      card.style.cssText = "background:#071220;border:1px solid #1e293b;border-radius:10px;padding:8px;";
      var canvas = document.createElement("canvas");
      canvas.width = IMAGE_W;
      canvas.height = IMAGE_H;
      canvas.style.cssText = "width:100%;max-width:112px;height:auto;image-rendering:pixelated;border:1px solid #334155;border-radius:6px;background:#020617;";
      var ctx = canvas.getContext("2d");
      var img = ctx.createImageData(IMAGE_W, IMAGE_H);
      var pixels = splitX[i];
      for (var p = 0; p < FEATURE_SIZE; p += 1) {
        var v = clamp01(pixels[p]) * 255;
        img.data[p * 4 + 0] = v;
        img.data[p * 4 + 1] = v;
        img.data[p * 4 + 2] = v;
        img.data[p * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      var bbox = splitB[i] || [0, 0, 0, 0];
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        Math.round(clamp01(bbox[0]) * (IMAGE_W - 1)),
        Math.round(clamp01(bbox[1]) * (IMAGE_H - 1)),
        Math.max(1, Math.round((clamp01(bbox[2]) - clamp01(bbox[0])) * (IMAGE_W - 1))),
        Math.max(1, Math.round((clamp01(bbox[3]) - clamp01(bbox[1])) * (IMAGE_H - 1)))
      );
      var labelIdx = Array.isArray(splitL[i]) ? splitL[i].indexOf(Math.max.apply(null, splitL[i])) : Number(splitL[i] || 0);
      var meta = document.createElement("div");
      meta.style.cssText = "margin-top:6px;font-size:11px;color:#cbd5e1;";
      meta.textContent = CLASS_NAMES[Math.max(0, labelIdx)] || ("class " + labelIdx);
      card.appendChild(canvas);
      card.appendChild(meta);
      grid.appendChild(card);
    }
  }

  function buildDataset(cfg) {
    var c = cfg || {};
    if (c.sourceDescriptor) {
      var sourceMeta = c.sourceDescriptor.metadata || {};
      var classNames = parseClassNames(sourceMeta.classNames && sourceMeta.classNames.join ? sourceMeta.classNames.join(",") : sourceMeta.classNames);
      return {
        schemaId: "synthetic_detection",
        datasetModuleId: "synthetic_detection",
        source: "synthetic_detection_source_descriptor",
        mode: "regression",
        taskRecipeId: "detection_single_box",
        imageShape: [IMAGE_H, IMAGE_W, 1],
        featureSize: Math.max(1, Number(sourceMeta.featureSize || FEATURE_SIZE)),
        targetSize: 4,
        targetMode: "bbox",
        numClasses: Math.max(1, Number(sourceMeta.numClasses || classNames.length || CLASS_NAMES.length)),
        classCount: Math.max(1, Number(sourceMeta.numClasses || classNames.length || CLASS_NAMES.length)),
        classNames: classNames,
        trainCount: 0,
        valCount: 0,
        testCount: 0,
        splitCounts: { train: 0, val: 0, test: 0 },
        splitConfig: {
          mode: "random",
          train: Number(c.trainFrac || 0.70),
          val: Number(c.valFrac || 0.15),
          test: Number(c.testFrac || 0.15),
        },
        seed: clampInt(c.seed || 42, 0, 2147483647),
        sourceDescriptor: c.sourceDescriptor,
      };
    }
    var rng = createRng(c.seed);
    var plan = stratifiedSplit({
      totalCount: clampInt(c.totalCount || 900, 90, 12000),
      trainFrac: Number(c.trainFrac),
      valFrac: Number(c.valFrac),
      testFrac: Number(c.testFrac),
    }, rng);
    var totals = plan.counts;
    var all = [];
    for (var i = 0; i < totals.total; i += 1) {
      all.push(makeSample(i % CLASS_NAMES.length, rng));
    }
    for (var j = all.length - 1; j > 0; j -= 1) {
      var k = Math.floor(rng() * (j + 1));
      var tmp = all[j];
      all[j] = all[k];
      all[k] = tmp;
    }

    function take(start, count) { return all.slice(start, start + count); }
    var train = take(0, totals.train);
    var val = take(totals.train, totals.val);
    var test = take(totals.train + totals.val, totals.test);

    function splitX(items) { return items.map(function (it) { return it.x.slice(); }); }
    function splitB(items) { return items.map(function (it) { return it.bbox.slice(); }); }
    function splitL(items) { return items.map(function (it) { return oneHot(it.label, CLASS_NAMES.length); }); }

    return {
      schemaId: "synthetic_detection",
      datasetModuleId: "synthetic_detection",
      source: "synthetic_detection_js",
      mode: "regression",
      taskRecipeId: "detection_single_box",
      imageShape: [IMAGE_H, IMAGE_W, 1],
      featureSize: FEATURE_SIZE,
      targetSize: 4,
      targetMode: "bbox",
      numClasses: CLASS_NAMES.length,
      classCount: CLASS_NAMES.length,
      classNames: CLASS_NAMES.slice(),
      xTrain: splitX(train),
      yTrain: splitB(train),
      labelsTrain: splitL(train),
      xVal: splitX(val),
      yVal: splitB(val),
      labelsVal: splitL(val),
      xTest: splitX(test),
      yTest: splitB(test),
      labelsTest: splitL(test),
      trainCount: train.length,
      valCount: val.length,
      testCount: test.length,
      splitCounts: { train: train.length, val: val.length, test: test.length },
      splitConfig: {
        mode: "random",
        train: plan.fractions.train,
        val: plan.fractions.val,
        test: plan.fractions.test,
      },
      seed: clampInt(c.seed || 42, 0, 2147483647),
    };
  }

  var moduleDef = {
    id: "synthetic_detection",
    schemaId: "synthetic_detection",
    label: "Synthetic Detection",
    description: "Single-object 32x32 grayscale detection dataset with bbox regression and class labels.",
    kind: "panel_builder",
    metadata: {
      taskRecipeId: "detection_single_box",
    },
    build: function (cfg) {
      return Promise.resolve(buildDataset(cfg || {}));
    },
    uiApi: {
      getDatasetConfigSpec: function () {
        return {
          sections: [
            {
              id: "synthetic_detection_config",
              title: "Dataset Config",
              schema: [
                { key: "seed", label: "Random Seed", type: "number", step: 1 },
                { key: "totalCount", label: "Total samples", type: "number", min: 90, max: 12000, step: 30 },
                { key: "trainFrac", label: "Train fraction", type: "number", min: 0.05, max: 0.9, step: 0.01 },
                { key: "valFrac", label: "Val fraction", type: "number", min: 0.05, max: 0.5, step: 0.01 },
                { key: "testFrac", label: "Test fraction", type: "number", min: 0.05, max: 0.5, step: 0.01 },
              ],
              value: {
                seed: "42",
                totalCount: "900",
                trainFrac: "0.70",
                valFrac: "0.15",
                testFrac: "0.15",
              }
            }
          ]
        };
      },
      getSourceDescriptorSpec: function () {
        return {
          title: "Local Source",
          helpText: "Optional: point the detection dataset at a local JSON dataset or CSV manifest for PyTorch server/notebook runtimes.",
          schema: [
            { key: "useSourceDescriptor", label: "Use local source", type: "checkbox" },
            {
              key: "sourceKind", label: "Source type", type: "select",
              options: [
                { value: "local_json_dataset", label: "Local JSON dataset" },
                { value: "local_csv_manifest", label: "Local CSV manifest" }
              ]
            },
            { key: "sourceDatasetPath", label: "Dataset path", type: "text" },
            { key: "sourceManifestPath", label: "Manifest path", type: "text" },
            { key: "sourceRootDir", label: "Root dir", type: "text" },
            { key: "sourceFeatureSize", label: "Feature size", type: "number", min: 1, step: 1 },
            { key: "sourceNumClasses", label: "Classes", type: "number", min: 1, step: 1 },
            { key: "sourceClassNames", label: "Class names CSV", type: "text" },
          ],
          value: {
            useSourceDescriptor: false,
            sourceKind: "local_json_dataset",
            sourceDatasetPath: "",
            sourceManifestPath: "",
            sourceRootDir: "",
            sourceFeatureSize: String(FEATURE_SIZE),
            sourceNumClasses: String(CLASS_NAMES.length),
            sourceClassNames: CLASS_NAMES.join(","),
          }
        };
      }
    },
    playgroundApi: {
      renderDataset: function (mountEl, deps) {
        renderGrid(mountEl, deps && deps.datasetData ? deps.datasetData : {});
      },
      renderPlayground: function (mountEl, deps) {
        renderGrid(mountEl, deps && deps.datasetData ? deps.datasetData : {});
      },
      getEvaluators: function () {
        return [{
          id: "iou_mean",
          name: "Mean IoU",
          mode: "test",
          compute: function (context) {
            return { value: computeMeanIoU(context && context.predictions, context && context.truth) };
          }
        }];
      },
    },
  };

  return { modules: [moduleDef] };
});

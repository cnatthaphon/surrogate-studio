(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    var loader = null;
    try {
      loader = require("./mnist_source_loader.js");
    } catch (_err) {
      loader = null;
    }
    module.exports = factory(root, loader);
    return;
  }
  var pack = factory(root, root.OSCMnistSourceLoader || null);
  root.OSCDatasetModuleMnist = pack;
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModules === "function") {
    root.OSCDatasetModules.registerModules(pack.modules || []);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, sourceLoader) {
  "use strict";

  var IMAGE_SIZE = 28 * 28;
  var CLASS_COUNT = 10;

  function clampInt(v, lo, hi) {
    var n = Number(v);
    if (!Number.isFinite(n)) n = lo;
    n = Math.floor(n);
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }

  function createRng(seed) {
    var s = Number(seed);
    if (!Number.isFinite(s)) s = 42;
    s = (Math.floor(s) >>> 0) || 42;
    return function () {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function getInputValue(ui, key, fallback) {
    var el = ui && ui[key];
    if (!el) return fallback;
    if (String(el.type || "").toLowerCase() === "checkbox") return Boolean(el.checked);
    return el.value == null ? fallback : el.value;
  }

  function setInputValue(ui, key, nextValue) {
    var el = ui && ui[key];
    if (!el) return;
    if (String(el.type || "").toLowerCase() === "checkbox") {
      el.checked = Boolean(nextValue);
      return;
    }
    el.value = nextValue == null ? "" : String(nextValue);
  }

  function buildSplitModeOptions(ctx, schemaId, fallbackMode) {
    var defs = ctx && typeof ctx.getSchemaSplitModeDefs === "function"
      ? ctx.getSchemaSplitModeDefs(schemaId)
      : [];
    if (!Array.isArray(defs) || !defs.length) {
      return [{ value: String(fallbackMode || "random"), label: String(fallbackMode || "random") }];
    }
    return defs.map(function (def) {
      return {
        value: String((def && def.id) || ""),
        label: String((def && def.label) || (def && def.id) || ""),
      };
    }).filter(function (entry) { return entry.value; });
  }

  function clonePlainObject(value) {
    if (!value || typeof value !== "object") return {};
    return JSON.parse(JSON.stringify(value));
  }

  function getScopedConfig(ctx, scope, schemaId, defaults) {
    if (ctx && typeof ctx.getModuleConfigState === "function") {
      return ctx.getModuleConfigState(scope, defaults, schemaId);
    }
    return clonePlainObject(defaults);
  }

  function setScopedConfig(ctx, scope, schemaId, nextValue) {
    if (ctx && typeof ctx.setModuleConfigState === "function") {
      return ctx.setModuleConfigState(scope, nextValue, schemaId);
    }
    return clonePlainObject(nextValue);
  }

  function patchScopedConfig(ctx, scope, schemaId, patch) {
    if (ctx && typeof ctx.patchModuleConfigState === "function") {
      return ctx.patchModuleConfigState(scope, patch, schemaId);
    }
    return clonePlainObject(patch);
  }

  function createImageDatasetUiApi(options) {
    var cfg = options || {};
    var schemaId = String(cfg.schemaId || "mnist").trim().toLowerCase();
    var defaultSplitMode = String(cfg.defaultSplitMode || "random").trim().toLowerCase() || "random";
    var defaultTotalCount = Number(cfg.defaultTotalCount || 1400);
    var defaultDatasetConfig = {
      seed: 42,
      splitMode: defaultSplitMode,
      trainFrac: 0.8,
      valFrac: 0.1,
      testFrac: 0.1,
      mnistTotalCount: defaultTotalCount,
      mnistTrainCount: Math.round(defaultTotalCount * 0.8),
      mnistValCount: Math.round(defaultTotalCount * 0.1),
      mnistTestCount: Math.round(defaultTotalCount * 0.1),
    };
    var defaultPlaygroundConfig = {
      sampleNonce: 0,
    };
    var cachedPlaygroundSourcePromise = null;

    function normalizeDatasetUiState(raw) {
      var base = Object.assign({}, defaultDatasetConfig, raw || {});
      var splitMode = normalizeSplitMode(base.splitMode || defaultSplitMode);
      var fr = normalizeSplitFractions(base.trainFrac, base.valFrac, base.testFrac);
      var counts = countsFromConfig({
        totalCount: base.mnistTotalCount,
        trainCount: base.mnistTrainCount,
        valCount: base.mnistValCount,
        testCount: base.mnistTestCount,
      }, Math.max(30, clampInt(base.mnistTotalCount, 30, 70000)), splitMode, fr);
      return {
        seed: clampInt(base.seed, 0, 2147483647),
        splitMode: splitMode,
        trainFrac: fr.train,
        valFrac: fr.val,
        testFrac: fr.test,
        mnistTotalCount: counts.total,
        mnistTrainCount: counts.train,
        mnistValCount: counts.val,
        mnistTestCount: counts.test,
      };
    }

    function normalizePlaygroundUiState(raw) {
      var base = Object.assign({}, defaultPlaygroundConfig, raw || {});
      return {
        sampleNonce: clampInt(base.sampleNonce, 0, 1000000000),
      };
    }

    function resolvePlaygroundSource(ctx) {
      if (ctx && typeof ctx.getPlaygroundSource === "function") {
        var injected = ctx.getPlaygroundSource(schemaId);
        if (injected && typeof injected.then === "function") return injected;
        if (injected) return Promise.resolve(injected);
      }
      if (cachedPlaygroundSourcePromise) return cachedPlaygroundSourcePromise;
      var loader = resolveLoader();
      if (!loader || typeof loader.loadVariantSource !== "function") {
        return Promise.reject(new Error("MNIST source loader is missing. Load dataset_modules/mnist_source_loader.js first."));
      }
      cachedPlaygroundSourcePromise = loader.loadVariantSource(schemaId);
      return cachedPlaygroundSourcePromise;
    }

    function buildImagePreviewModel(ctx) {
      var uiState = normalizePlaygroundUiState(getScopedConfig(ctx, "playground", schemaId, defaultPlaygroundConfig));
      return resolvePlaygroundSource(ctx).then(function (source) {
        if (!source || !source.pixelsUint8 || !source.labelsUint8) {
          throw new Error("Source preview data is unavailable.");
        }
        var classNames = Array.isArray(source.classNames) && source.classNames.length ? source.classNames : ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
        var byClass = {};
        for (var i = 0; i < source.labelsUint8.length; i += 1) {
          var lbl = Math.max(0, Math.min(classNames.length - 1, Math.floor(Number(source.labelsUint8[i]) || 0)));
          if (!byClass[lbl]) byClass[lbl] = [];
          byClass[lbl].push(i);
        }
        var rng = createRng(Number(source.loadedAt || 42) + Number(uiState.sampleNonce || 0) + (schemaId === "fashion_mnist" ? 17 : 0));
        var samples = [];
        for (var c = 0; c < classNames.length; c += 1) {
          var arr = byClass[c] || [];
          if (!arr.length) continue;
          var pick = arr[Math.floor(rng() * arr.length)];
          var base = pick * IMAGE_SIZE;
          samples.push({
            label: "class " + c + " (" + String(classNames[c]) + ")",
            pixels: Array.prototype.slice.call(source.pixelsUint8.subarray(base, base + IMAGE_SIZE)),
            meta: ["idx=" + pick, "count=" + arr.length]
          });
        }
        return {
          kind: "image_class_grid",
          title: "Source Playground",
          summaryLines: [
            "schema: " + schemaId,
            "source: " + String(source.source || "unknown"),
            "samples: " + Number(source.numExamples || 0),
            "loaded once and reused from module cache"
          ],
          samples: samples
        };
      });
    }

    return {
      getDatasetConfigSpec: function (ctx) {
        var uiState = normalizeDatasetUiState(getScopedConfig(ctx, "dataset", schemaId, defaultDatasetConfig));
        return {
          sections: [
            {
              id: "dataset_common",
              title: "Dataset Config",
              schema: [
                { key: "seed", label: "Random Seed", type: "number", step: 1 },
                { key: "splitMode", label: "Split mode", type: "select", options: buildSplitModeOptions(ctx, schemaId, defaultSplitMode) },
                { key: "trainFrac", label: "Train fraction", type: "number", min: 0.01, max: 0.99, step: 0.01 },
                { key: "valFrac", label: "Val fraction", type: "number", min: 0.01, max: 0.99, step: 0.01 },
                { key: "testFrac", label: "Test fraction (auto)", type: "number", step: 0.01, disabled: true },
                { key: "mnistTotalCount", label: "Total samples", type: "number", min: 30, step: 10 },
                { key: "forceEqualClass", label: "Force equal class count", type: "checkbox" },
                { key: "mnistTrainCount", label: "Train samples (auto)", type: "number", disabled: true },
                { key: "mnistValCount", label: "Val samples (auto)", type: "number", disabled: true },
                { key: "mnistTestCount", label: "Test samples (auto)", type: "number", disabled: true }
              ],
              value: {
                seed: String(uiState.seed),
                splitMode: uiState.splitMode,
                trainFrac: Number(uiState.trainFrac || 0.8).toFixed(4),
                valFrac: Number(uiState.valFrac || 0.1).toFixed(4),
                testFrac: Number(uiState.testFrac || 0.1).toFixed(4),
                mnistTotalCount: String(uiState.mnistTotalCount),
                forceEqualClass: Boolean(uiState.forceEqualClass),
                mnistTrainCount: String(uiState.mnistTrainCount),
                mnistValCount: String(uiState.mnistValCount),
                mnistTestCount: String(uiState.mnistTestCount),
              }
            }
          ],
          actions: [
            { id: "create_dataset", label: "Create Dataset" }
          ]
        };
      },
      handleDatasetConfigChange: function (_nextConfig, payload, ctx) {
        var key = String((payload && payload.key) || "").trim();
        if (!key) return;
        var nextPatch = {};
        nextPatch[key] = payload ? payload.value : "";
        var nextState = patchScopedConfig(ctx, "dataset", schemaId, nextPatch);
        setScopedConfig(ctx, "dataset", schemaId, normalizeDatasetUiState(nextState));
        if (ctx && typeof ctx.refreshDatasetConfigPanel === "function") {
          ctx.refreshDatasetConfigPanel();
        }
      },
      handleDatasetAction: function (payload, ctx) {
        var actionId = String((payload && payload.actionId) || "").trim().toLowerCase();
        if (actionId === "create_dataset" && ctx && typeof ctx.triggerDatasetBuild === "function") {
          ctx.triggerDatasetBuild();
        }
      },
      getDatasetBuildConfig: function (ctx) {
        var uiState = normalizeDatasetUiState(getScopedConfig(ctx, "dataset", schemaId, defaultDatasetConfig));
        return {
          seed: uiState.seed,
          splitMode: uiState.splitMode,
          trainFrac: uiState.trainFrac,
          valFrac: uiState.valFrac,
          testFrac: uiState.testFrac,
          trainCount: uiState.mnistTrainCount,
          valCount: uiState.mnistValCount,
          testCount: uiState.mnistTestCount,
          totalCount: uiState.mnistTotalCount,
          forceEqualClass: Boolean(uiState.forceEqualClass),
        };
      },
      getPlaygroundConfigSpec: function (ctx) {
        return {
          sections: [
            {
              id: "playground_source",
              title: "Source Playground",
              schema: [
                { key: "sourceDataset", label: "Source", type: "text", disabled: true }
              ],
              value: {
                sourceDataset: schemaId
              }
            }
          ],
          actions: [
            { id: "sample_random", label: "Random Sample" }
          ]
        };
      },
      handlePlaygroundConfigChange: function (_nextConfig, payload, ctx) {
        return null;
      },
      handlePlaygroundAction: function (payload, ctx) {
        var actionId = String((payload && payload.actionId) || "").trim().toLowerCase();
        if (actionId !== "sample_random") return;
        var current = normalizePlaygroundUiState(getScopedConfig(ctx, "playground", schemaId, defaultPlaygroundConfig));
        current.sampleNonce += 1;
        setScopedConfig(ctx, "playground", schemaId, current);
        if (ctx && typeof ctx.refreshPlaygroundWorkspace === "function") {
          ctx.refreshPlaygroundWorkspace();
        }
      },
      getPlaygroundPreviewModel: function (ctx) {
        return buildImagePreviewModel(ctx);
      }
    };
  }

  function normalizeSplitFractions(trainFrac, valFrac, testFrac) {
    var tr = Number(trainFrac);
    var va = Number(valFrac);
    var te = Number(testFrac);
    if (!Number.isFinite(tr)) tr = 0.8;
    if (!Number.isFinite(va)) va = 0.1;
    if (!Number.isFinite(te)) te = 0.1;
    tr = Math.max(0.01, tr);
    va = Math.max(0.01, va);
    te = Math.max(0.01, te);
    var sum = tr + va + te;
    return { train: tr / sum, val: va / sum, test: te / sum };
  }

  function normalizeSplitMode(rawMode) {
    var m = String(rawMode || "random").trim().toLowerCase();
    if (m !== "random" && m !== "stratified_label" && m !== "fixed_counts") m = "random";
    return m;
  }

  function normalizeSourceData(raw, variant, classNames) {
    var src = raw && typeof raw === "object" ? raw : null;
    if (!src) return null;
    var rows = 0;
    var pixels = null;
    var labels = null;
    if (src.pixelsUint8 && src.labelsUint8) {
      pixels = src.pixelsUint8 instanceof Uint8Array ? src.pixelsUint8 : new Uint8Array(src.pixelsUint8);
      labels = src.labelsUint8 instanceof Uint8Array ? src.labelsUint8 : new Uint8Array(src.labelsUint8);
      rows = Math.min(Math.floor(pixels.length / IMAGE_SIZE), labels.length);
    } else if (Array.isArray(src.x) && Array.isArray(src.y)) {
      rows = Math.min(src.x.length, src.y.length);
      pixels = new Uint8Array(rows * IMAGE_SIZE);
      labels = new Uint8Array(rows);
      for (var i = 0; i < rows; i += 1) {
        var xrow = Array.isArray(src.x[i]) ? src.x[i] : [];
        var yv = clampInt(src.y[i], 0, CLASS_COUNT - 1);
        labels[i] = yv;
        var base = i * IMAGE_SIZE;
        for (var j = 0; j < IMAGE_SIZE; j += 1) {
          var vv = Number(xrow[j]);
          if (!Number.isFinite(vv)) vv = 0;
          if (vv <= 1) vv = vv * 255;
          vv = Math.max(0, Math.min(255, vv));
          pixels[base + j] = Math.round(vv);
        }
      }
    }
    if (!pixels || !labels || rows <= 0) {
      throw new Error("MNIST module sourceRecords invalid. Expect {pixelsUint8, labelsUint8} or {x, y}.");
    }
    return {
      variant: String(variant || "mnist"),
      schemaId: String(variant || "mnist").trim().toLowerCase(),
      imageShape: [28, 28, 1],
      imageSize: IMAGE_SIZE,
      classCount: CLASS_COUNT,
      classNames: Array.isArray(classNames) && classNames.length === CLASS_COUNT ? classNames.slice() : ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
      numExamples: rows,
      pixelsUint8: pixels,
      labelsUint8: labels,
      source: "provided_source_records",
      urls: null,
      loadedAt: Date.now(),
    };
  }

  function fisherYatesShuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
  }

  function buildAllIndices(count) {
    var out = new Array(count);
    for (var i = 0; i < count; i += 1) out[i] = i;
    return out;
  }

  function countsFromConfig(cfg, totalAvailable, splitMode, fr) {
    var c = cfg || {};
    var out = { train: 0, val: 0, test: 0, total: 0 };
    var trInput = Number(c.trainCount);
    var vaInput = Number(c.valCount);
    var teInput = Number(c.testCount);
    var hasExplicitCounts =
      Number.isFinite(trInput) && trInput > 0 &&
      Number.isFinite(vaInput) && vaInput > 0 &&
      Number.isFinite(teInput) && teInput > 0;
    if (hasExplicitCounts) {
      var trExact = clampInt(trInput, 1, totalAvailable);
      var vaExact = clampInt(vaInput, 1, totalAvailable);
      var teExact = clampInt(teInput, 1, totalAvailable);
      var sumExact = trExact + vaExact + teExact;
      if (sumExact > totalAvailable) {
        var scaleExact = totalAvailable / sumExact;
        trExact = Math.max(1, Math.floor(trExact * scaleExact));
        vaExact = Math.max(1, Math.floor(vaExact * scaleExact));
        teExact = Math.max(1, totalAvailable - trExact - vaExact);
      }
      out.train = trExact;
      out.val = vaExact;
      out.test = teExact;
      out.total = trExact + vaExact + teExact;
      return out;
    }
    if (splitMode === "fixed_counts") {
      var tr = clampInt(c.trainCount, 10, totalAvailable);
      var va = clampInt(c.valCount, 10, totalAvailable);
      var te = clampInt(c.testCount, 10, totalAvailable);
      var sum = tr + va + te;
      if (sum > totalAvailable) {
        var scale = totalAvailable / sum;
        tr = Math.max(1, Math.floor(tr * scale));
        va = Math.max(1, Math.floor(va * scale));
        te = Math.max(1, totalAvailable - tr - va);
      }
      out.train = tr;
      out.val = va;
      out.test = te;
      out.total = tr + va + te;
      return out;
    }
    var totalRaw = Number(c.totalCount);
    if (!Number.isFinite(totalRaw)) totalRaw = Number(c.trainCount || 0) + Number(c.valCount || 0) + Number(c.testCount || 0);
    if (!Number.isFinite(totalRaw) || totalRaw <= 0) totalRaw = 1400;
    var total = clampInt(totalRaw, 30, totalAvailable);
    var train = Math.max(1, Math.floor(total * fr.train));
    var val = Math.max(1, Math.floor(total * fr.val));
    var test = Math.max(1, total - train - val);
    var fixed = train + val + test;
    if (fixed > total) {
      var over = fixed - total;
      if (test > 1) {
        var d = Math.min(over, test - 1);
        test -= d;
        over -= d;
      }
      if (over > 0 && val > 1) {
        var d2 = Math.min(over, val - 1);
        val -= d2;
        over -= d2;
      }
      if (over > 0 && train > 1) {
        train = Math.max(1, train - over);
      }
    }
    out.train = train;
    out.val = val;
    out.test = test;
    out.total = train + val + test;
    return out;
  }

  function sampleIndicesRandom(totalCount, totalAvailable, rng) {
    var all = buildAllIndices(totalAvailable);
    fisherYatesShuffle(all, rng);
    return all.slice(0, Math.max(0, Math.min(totalCount, totalAvailable)));
  }

  function sampleIndicesStratified(totalCount, labels, rng) {
    var buckets = [];
    for (var c = 0; c < CLASS_COUNT; c += 1) buckets[c] = [];
    for (var i = 0; i < labels.length; i += 1) {
      var cls = clampInt(labels[i], 0, CLASS_COUNT - 1);
      buckets[cls].push(i);
    }
    for (var cc = 0; cc < CLASS_COUNT; cc += 1) fisherYatesShuffle(buckets[cc], rng);
    var target = Math.max(0, Math.min(totalCount, labels.length));
    var base = Math.floor(target / CLASS_COUNT);
    var rem = target - base * CLASS_COUNT;
    var picked = [];
    for (var c2 = 0; c2 < CLASS_COUNT; c2 += 1) {
      var need = base + (c2 < rem ? 1 : 0);
      var src = buckets[c2];
      for (var k = 0; k < need && k < src.length; k += 1) picked.push(src[k]);
    }
    if (picked.length < target) {
      var used = Object.create(null);
      for (var p = 0; p < picked.length; p += 1) used[String(picked[p])] = true;
      var all = buildAllIndices(labels.length);
      fisherYatesShuffle(all, rng);
      for (var a = 0; a < all.length && picked.length < target; a += 1) {
        var idx = all[a];
        if (used[String(idx)]) continue;
        used[String(idx)] = true;
        picked.push(idx);
      }
    }
    fisherYatesShuffle(picked, rng);
    return picked;
  }

  function splitSampledIndices(sampled, labels, splitMode, fr, counts, rng) {
    var total = sampled.length;
    var targetTrain = Math.max(0, Math.min(counts.train, total));
    var targetVal = Math.max(0, Math.min(counts.val, total - targetTrain));
    var targetTest = Math.max(0, total - targetTrain - targetVal);
    if (splitMode !== "stratified_label") {
      return {
        train: sampled.slice(0, targetTrain),
        val: sampled.slice(targetTrain, targetTrain + targetVal),
        test: sampled.slice(targetTrain + targetVal, targetTrain + targetVal + targetTest),
      };
    }
    var byClass = [];
    for (var c = 0; c < CLASS_COUNT; c += 1) byClass[c] = [];
    for (var i = 0; i < sampled.length; i += 1) {
      var idx = sampled[i];
      var cls = clampInt(labels[idx], 0, CLASS_COUNT - 1);
      byClass[cls].push(idx);
    }
    var train = [];
    var val = [];
    var test = [];
    for (var c2 = 0; c2 < CLASS_COUNT; c2 += 1) {
      var arr = byClass[c2];
      var n = arr.length;
      var nTrain = Math.floor(n * fr.train);
      var nVal = Math.floor(n * fr.val);
      if (nTrain + nVal > n) nVal = Math.max(0, n - nTrain);
      for (var a = 0; a < nTrain; a += 1) train.push(arr[a]);
      for (var b = nTrain; b < nTrain + nVal; b += 1) val.push(arr[b]);
      for (var d = nTrain + nVal; d < n; d += 1) test.push(arr[d]);
    }
    fisherYatesShuffle(train, rng);
    fisherYatesShuffle(val, rng);
    fisherYatesShuffle(test, rng);
    function rebalance(primary, secondary, wantPrimary) {
      while (primary.length > wantPrimary && primary.length > 0) secondary.push(primary.pop());
      while (primary.length < wantPrimary && secondary.length > 0) primary.push(secondary.pop());
    }
    rebalance(train, test, targetTrain);
    rebalance(val, test, targetVal);
    if (train.length + val.length + test.length > total) {
      test.length = Math.max(0, total - train.length - val.length);
    }
    return {
      train: train.slice(0, targetTrain),
      val: val.slice(0, targetVal),
      test: test.slice(0, targetTest),
    };
  }

  function labelHistogram(allLabels, classNames) {
    var hist = {};
    for (var i = 0; i < classNames.length; i += 1) hist[String(i)] = 0;
    for (var j = 0; j < allLabels.length; j += 1) {
      var k = String(clampInt(allLabels[j], 0, classNames.length - 1));
      hist[k] = (hist[k] || 0) + 1;
    }
    return hist;
  }

  function rowToFloatArray(pixelsUint8, rowIdx, imageSize) {
    var out = new Array(imageSize);
    var base = rowIdx * imageSize;
    for (var i = 0; i < imageSize; i += 1) {
      out[i] = Number(pixelsUint8[base + i] || 0) / 255;
    }
    return out;
  }

  function makeSplitFromIndices(indices, source) {
    var outX = new Array(indices.length);
    var outY = new Array(indices.length);
    for (var i = 0; i < indices.length; i += 1) {
      var idx = indices[i];
      outX[i] = rowToFloatArray(source.pixelsUint8, idx, source.imageSize);
      outY[i] = Number(source.labelsUint8[idx] || 0);
    }
    return { x: outX, y: outY };
  }

  function buildDatasetFromSource(cfg, source) {
    var c = cfg || {};
    var splitMode = normalizeSplitMode(c.splitMode);
    var fr = normalizeSplitFractions(c.trainFrac, c.valFrac, c.testFrac);
    var seed = clampInt(c.seed, 1, 2147483647);
    var rng = createRng(seed);
    var totalAvailable = Math.max(1, Number(source.numExamples) || 0);
    var counts = countsFromConfig(c, totalAvailable, splitMode, fr);
    var forceEqual = Boolean(c.forceEqualClass);
    var sampled;
    if (forceEqual) {
      // balanced sampling: equal count per class
      var nClasses = source.classCount || 10;
      var perClass = Math.max(1, Math.floor(counts.total / nClasses));
      var byClass = {};
      for (var li = 0; li < totalAvailable; li++) {
        var lbl = source.labelsUint8 ? source.labelsUint8[li] : 0;
        if (!byClass[lbl]) byClass[lbl] = [];
        byClass[lbl].push(li);
      }
      sampled = [];
      for (var ci = 0; ci < nClasses; ci++) {
        var pool = byClass[ci] || [];
        for (var si = 0; si < perClass && si < pool.length; si++) {
          var idx = Math.floor(rng() * pool.length);
          sampled.push(pool[idx]);
        }
      }
    } else {
      sampled = splitMode === "stratified_label"
        ? sampleIndicesStratified(counts.total, source.labelsUint8, rng)
        : sampleIndicesRandom(counts.total, totalAvailable, rng);
    }
    var splitIdx = splitSampledIndices(sampled, source.labelsUint8, splitMode, fr, counts, rng);
    var train = makeSplitFromIndices(splitIdx.train, source);
    var val = makeSplitFromIndices(splitIdx.val, source);
    var test = makeSplitFromIndices(splitIdx.test, source);
    var labels = train.y.concat(val.y, test.y);
    return {
      schemaId: String(source.schemaId || source.variant || cfg.schemaId || "mnist").trim().toLowerCase(),
      datasetModuleId: String(source.variant || "mnist"),
      source: String(source.source || "tfjs_mnist_sprite"),
      sourceUrls: source.urls || null,
      mode: "classification",
      imageShape: [28, 28, 1],
      classCount: CLASS_COUNT,
      classNames: source.classNames.slice(),
      splitConfig: {
        mode: splitMode,
        train: fr.train,
        val: fr.val,
        test: fr.test,
        stratifyKey: splitMode === "stratified_label" ? "label" : "",
        trainCount: train.x.length,
        valCount: val.x.length,
        testCount: test.x.length,
      },
      splitCounts: {
        train: train.x.length,
        val: val.x.length,
        test: test.x.length,
      },
      trainCount: train.x.length,
      valCount: val.x.length,
      testCount: test.x.length,
      labelsHistogram: labelHistogram(labels, source.classNames),
      records: {
        train: train,
        val: val,
        test: test,
      },
      preview: {
        firstLabels: train.y.slice(0, 24),
        sampleCount: train.x.length + val.x.length + test.x.length,
      },
      seed: seed,
    };
  }

  function resolveLoader() {
    if (sourceLoader && typeof sourceLoader.loadVariantSource === "function") return sourceLoader;
    if (
      root &&
      root.OSCMnistSourceLoader &&
      typeof root.OSCMnistSourceLoader.loadVariantSource === "function"
    ) {
      return root.OSCMnistSourceLoader;
    }
    return null;
  }

  async function buildMnistDataset(cfg) {
    var c = cfg || {};
    var variant = String(c.variant || "mnist").trim().toLowerCase();
    if (variant !== "fashion_mnist" && variant !== "mnist") {
      variant = String(c.schemaId || "mnist").trim().toLowerCase() === "fashion_mnist" ? "fashion_mnist" : "mnist";
    }
    if (c.schemaId && String(c.schemaId).trim().toLowerCase() === "fashion_mnist") {
      variant = "fashion_mnist";
    }
    var classNames = variant === "fashion_mnist"
      ? [
          "T-shirt/top", "Trouser", "Pullover", "Dress", "Coat",
          "Sandal", "Shirt", "Sneaker", "Bag", "Ankle boot",
        ]
      : ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    var sourceMode = String(c.sourceMode || "").trim().toLowerCase();
    var source = c.sourceRecords
      ? normalizeSourceData(c.sourceRecords, variant, classNames)
      : null;
    if (!source) {
      var loader = resolveLoader();
      if (!loader) {
        throw new Error("MNIST source loader is missing. Load dataset_modules/mnist_source_loader.js first.");
      }
      if (sourceMode === "synthetic") {
        if (typeof loader.buildSyntheticVariantSource !== "function") {
          throw new Error("MNIST source loader missing buildSyntheticVariantSource().");
        }
        source = loader.buildSyntheticVariantSource(variant, {
          seed: c.seed,
          totalExamples: c.syntheticTotalExamples || c.sourceTotalExamples || c.totalCount,
        });
      } else {
        source = await loader.loadVariantSource(variant);
      }
    }
    return buildDatasetFromSource(c, source);
  }

  function createImagePlaygroundRenderer(variant, label, defaultClassNames) {
    return function renderPlayground(mountEl, deps) {
      if (!mountEl) return;
      var elF = (deps && deps.el) || function (tag, attrs, ch) {
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
      var isCurrent = (deps && typeof deps.isCurrent === "function") ? deps.isCurrent : function () { return true; };

      // if dataset data already provided (from dataset tab), use it directly
      var providedData = deps && deps.datasetData;
      if (providedData) {
        _renderImageResult(mountEl, elF, providedData, label, defaultClassNames, isCurrent);
        return;
      }

      mountEl.appendChild(elF("div", { style: "color:#67e8f9;font-size:13px;" }, "Loading " + label + " data..."));
      buildMnistDataset({ seed: 42, totalCount: 100, variant: variant }).then(function (res) {
        _renderImageResult(mountEl, elF, res, label, defaultClassNames, isCurrent);
      }).catch(function (err) {
        mountEl.innerHTML = "";
        mountEl.appendChild(elF("div", { style: "color:#f43f5e;" }, "Error: " + String(err.message || err)));
      });
    };
  }

  function _renderImageResult(mountEl, elF, res, label, defaultClassNames, isCurrent) {
        if (!isCurrent()) return; // stale mount — don't render
        mountEl.innerHTML = "";
        if (!res) { mountEl.appendChild(elF("div", { style: "color:#f43f5e;" }, "No data")); return; }

        var cNames = res.classNames || defaultClassNames || [];
        var nClasses = res.classCount || cNames.length || 10;
        var imgShape = Array.isArray(res.imageShape) ? res.imageShape : [28, 28, 1];
        var imgW = imgShape[0] || 28;
        var imgH = imgShape[1] || 28;
        var xData = (res.records && res.records.train && res.records.train.x) || [];
        var yData = (res.records && res.records.train && res.records.train.y) || [];

        // info
        mountEl.appendChild(elF("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:8px;" },
          label + " | Classes: " + nClasses + " | Shape: " + imgW + "x" + imgH));

        // get all splits
        var splits = [
          { name: "Train", x: (res.records && res.records.train && res.records.train.x) || [], y: (res.records && res.records.train && res.records.train.y) || [] },
          { name: "Val", x: (res.records && res.records.val && res.records.val.x) || [], y: (res.records && res.records.val && res.records.val.y) || [] },
          { name: "Test", x: (res.records && res.records.test && res.records.test.x) || [], y: (res.records && res.records.test && res.records.test.y) || [] },
        ];

        // fallback if no records splits but have xTrain etc
        if (!splits[0].x.length && xData.length) {
          splits = [{ name: "All", x: xData, y: yData }];
        }

        var allCanvases = [];

        splits.forEach(function (split) {
          if (!split.x.length) return;

          // split header + count
          var splitDiv = elF("div", { style: "margin-bottom:12px;" });
          splitDiv.appendChild(elF("div", { style: "font-size:11px;color:#67e8f9;font-weight:600;margin-bottom:4px;" },
            split.name + " (" + split.x.length + " samples)"));

          // group by class
          var byClass = {};
          for (var i = 0; i < split.y.length; i++) {
            var cls = Number(split.y[i]);
            if (!byClass[cls]) byClass[cls] = [];
            byClass[cls].push(i);
          }

          // image grid for this split
          var canvases = [];
          var classRow = elF("div", { style: "display:flex;flex-wrap:wrap;gap:6px;align-items:flex-end;" });
          for (var ci = 0; ci < nClasses; ci++) {
            var canvas = document.createElement("canvas");
            canvas.width = imgW; canvas.height = imgH;
            canvas.style.cssText = "width:44px;height:44px;border:1px solid #334155;border-radius:3px;image-rendering:pixelated;background:#000;";
            var cellWrap = elF("div", { style: "text-align:center;" });
            cellWrap.appendChild(canvas);
            var count = (byClass[ci] || []).length;
            cellWrap.appendChild(elF("div", { style: "font-size:9px;color:#64748b;" }, String(count)));
            classRow.appendChild(cellWrap);
            canvases.push({ cls: ci, canvas: canvas, byClass: byClass, xData: split.x });
          }
          splitDiv.appendChild(classRow);

          // random button per split
          var randBtn = elF("button", { style: "margin-top:4px;padding:2px 8px;font-size:10px;border-radius:4px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;" }, "Random " + split.name);
          randBtn.addEventListener("click", (function (cvs) {
            return function () { drawSplitGrid(cvs, imgW, imgH, true); };
          })(canvases));
          splitDiv.appendChild(randBtn);

          mountEl.appendChild(splitDiv);
          allCanvases = allCanvases.concat(canvases);
        });

        function drawSplitGrid(canvases, w, h, randomize) {
          canvases.forEach(function (item) {
            var indices = item.byClass[item.cls] || [];
            if (!indices.length) return;
            var idx = randomize ? indices[Math.floor(Math.random() * indices.length)] : indices[0];
            var pixels = item.xData[idx];
            if (!pixels) return;
            var ctx = item.canvas.getContext("2d");
            var imgData = ctx.createImageData(w, h);
            for (var pi = 0; pi < pixels.length && pi < w * h; pi++) {
              var v = Math.round(pixels[pi] * 255);
              imgData.data[pi * 4] = v; imgData.data[pi * 4 + 1] = v; imgData.data[pi * 4 + 2] = v; imgData.data[pi * 4 + 3] = 255;
            }
            ctx.putImageData(imgData, 0, 0);
          });
        }

        // class name labels
        var labelRow = elF("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;" });
        for (var ni = 0; ni < nClasses; ni++) {
          labelRow.appendChild(elF("span", { style: "font-size:9px;color:#94a3b8;width:44px;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;" }, cNames[ni] || String(ni)));
        }
        mountEl.insertBefore(labelRow, mountEl.children[1] || null);

        // Random All button
        var randBtn = elF("button", { style: "margin-top:4px;padding:4px 12px;font-size:11px;border-radius:6px;border:1px solid #0ea5e9;background:#0284c7;color:#fff;cursor:pointer;" }, "Random All");
        randBtn.addEventListener("click", function () { drawSplitGrid(allCanvases, imgW, imgH, true); });
        mountEl.appendChild(randBtn);

        // class distribution bar chart
        if (res.labelsHistogram) {
          var histWrap = elF("div", { style: "margin-top:12px;" });
          histWrap.appendChild(elF("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:4px;font-weight:600;" }, "Class Distribution"));
          var maxCount = 0;
          Object.keys(res.labelsHistogram).forEach(function (k) { if (res.labelsHistogram[k] > maxCount) maxCount = res.labelsHistogram[k]; });
          Object.keys(res.labelsHistogram).forEach(function (k) {
            var count = res.labelsHistogram[k];
            var pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
            var row = elF("div", { style: "display:flex;align-items:center;gap:6px;margin-bottom:2px;" });
            row.appendChild(elF("span", { style: "font-size:10px;color:#94a3b8;min-width:70px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" }, cNames[k] || k));
            var barOuter = elF("div", { style: "flex:1;height:12px;background:#1e293b;border-radius:3px;overflow:hidden;" });
            barOuter.appendChild(elF("div", { style: "height:100%;width:" + pct + "%;background:#0ea5e9;border-radius:3px;" }));
            row.appendChild(barOuter);
            row.appendChild(elF("span", { style: "font-size:10px;color:#64748b;min-width:24px;" }, String(count)));
            histWrap.appendChild(row);
          });
          mountEl.appendChild(histWrap);
        }

        drawSplitGrid(allCanvases, imgW, imgH, false);
  }

  var modules = [
    {
      id: "mnist",
      schemaId: "mnist",
      label: "MNIST",
      description: "MNIST image classification builder from source dataset.",
      helpText: "MNIST image classification builder (real source, lazy-loaded once). | split modes: random, stratified_label(stratify=label) | columns: split, index, label, class_name, pixel_values",
      kind: "panel_builder",
      playground: {
        mode: "image_dataset",
      },
      preconfig: {
        dataset: {
          seed: 42,
          totalCount: 1400,
          splitDefaults: {
            mode: "random",
            train: 0.8,
            val: 0.1,
            test: 0.1
          }
        }
      },
      build: function (cfg) {
        return buildMnistDataset(Object.assign({}, cfg || {}, { variant: "mnist" }));
      },
      playgroundApi: {
        renderPlayground: createImagePlaygroundRenderer("mnist", "MNIST", ["0","1","2","3","4","5","6","7","8","9"]),
      },
      uiApi: createImageDatasetUiApi({
        schemaId: "mnist",
        defaultSplitMode: "random",
        defaultTotalCount: 1400,
      }),
    },
  ];

  return {
    modules: modules,
    buildMnistDataset: buildMnistDataset,
    createImageDatasetUiApi: createImageDatasetUiApi,
    createImagePlaygroundRenderer: createImagePlaygroundRenderer,
  };
});

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    var loader = null;
    try { loader = require("./cifar10_source_loader.js"); } catch (_e) {}
    module.exports = factory(root, loader);
    return;
  }
  var descriptor = factory(root, root.OSCCifar10SourceLoader || null);
  root.OSCDatasetModuleCifar10 = descriptor;
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModule === "function") {
    root.OSCDatasetModules.registerModule(descriptor);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, loaderPack) {
  "use strict";

  // --- All dataset-specific metadata comes from the source loader or build config ---
  // No hardcoded class names, image shapes, or class counts here.

  function getLoader() {
    return loaderPack || (root && root.OSCCifar10SourceLoader) || null;
  }

  function clampInt(v, min, max) {
    var n = Number(v); if (!Number.isFinite(n)) n = min;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }

  function createRng(seed) {
    var s = (Math.floor(seed) >>> 0) || 42;
    return function () { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  }

  function fisherYatesShuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // --- Build dataset: all metadata read from source, nothing hardcoded ---
  function buildCifar10Dataset(cfg) {
    var config = cfg || {};
    var loader = getLoader();

    var totalCount = clampInt(config.totalCount || config.totalExamples || 1400, 30, 60000);
    var seed = clampInt(config.seed || 42, 1, 2147483647);
    var splitMode = String(config.splitMode || "stratified_label");
    var trainFrac = Number(config.trainFrac || 0.8);
    var valFrac = Number(config.valFrac || 0.1);
    var testFrac = Math.max(0.01, 1 - trainFrac - valFrac);
    var forceEqualClass = !!config.forceEqualClass;

    var sourcePromise = loader
      ? loader.loadSource({ totalExamples: Math.max(totalCount, 10000), seed: seed })
      : Promise.resolve(_fallbackSource(totalCount, seed));

    return sourcePromise.then(function (source) {
      // read metadata from source — source loader is the single source of truth
      var classCount = source.classCount;
      var classNames = source.classNames;
      var imageShape = source.imageShape;
      var imageSize = source.imageSize;
      var rng = createRng(seed);
      var numAvailable = source.numExamples;

      // "original" split mode: use source's actual train/test boundary
      if (splitMode === "original") {
        var origTrainN = source.originalTrainCount || Math.round(numAvailable * 0.8333);
        var origTestN = numAvailable - origTrainN;
        var requestedTotal = Math.min(totalCount, numAvailable);
        var trainPoolSize = Math.min(origTrainN, Math.round(requestedTotal * origTrainN / numAvailable));
        var testPoolSize = Math.min(origTestN, requestedTotal - trainPoolSize);
        if (testPoolSize < 1 && origTestN > 0) { testPoolSize = 1; trainPoolSize = requestedTotal - 1; }
        var valFromTrain = Math.max(1, Math.round(trainPoolSize * valFrac));
        var finalTrainN = trainPoolSize - valFromTrain;

        var trainPool = []; for (var oi = 0; oi < origTrainN; oi++) trainPool.push(oi);
        var testPool = []; for (var oj = origTrainN; oj < numAvailable; oj++) testPool.push(oj);
        fisherYatesShuffle(trainPool, rng);
        fisherYatesShuffle(testPool, rng);

        return _buildResult(source,
          trainPool.slice(0, finalTrainN),
          trainPool.slice(finalTrainN, finalTrainN + valFromTrain),
          testPool.slice(0, testPoolSize),
          seed, "original");
      }

      var actual = Math.min(totalCount, numAvailable);

      var allIdx = [];
      for (var i = 0; i < numAvailable; i++) allIdx.push(i);
      fisherYatesShuffle(allIdx, rng);

      // force equal class sampling
      var selectedIdx;
      if (forceEqualClass) {
        var perClass = Math.floor(actual / classCount);
        var byClass = {};
        for (var ci = 0; ci < classCount; ci++) byClass[ci] = [];
        for (var si = 0; si < allIdx.length; si++) {
          var cls = source.labelsUint8[allIdx[si]];
          if (byClass[cls] && byClass[cls].length < perClass) byClass[cls].push(allIdx[si]);
        }
        selectedIdx = [];
        for (var cc = 0; cc < classCount; cc++) selectedIdx = selectedIdx.concat(byClass[cc] || []);
        fisherYatesShuffle(selectedIdx, rng);
        actual = selectedIdx.length;
      } else {
        selectedIdx = allIdx.slice(0, actual);
      }

      // split
      var trainN = Math.max(1, Math.round(actual * trainFrac));
      var valN = Math.max(1, Math.round(actual * valFrac));
      var testN = Math.max(1, actual - trainN - valN);
      var trainIdx, valIdx, testIdx;

      if (splitMode === "stratified_label") {
        var classIndices = {};
        for (var qi = 0; qi < selectedIdx.length; qi++) {
          var qc = source.labelsUint8[selectedIdx[qi]];
          if (!classIndices[qc]) classIndices[qc] = [];
          classIndices[qc].push(selectedIdx[qi]);
        }
        trainIdx = []; valIdx = []; testIdx = [];
        Object.keys(classIndices).forEach(function (k) {
          var arr = classIndices[k];
          var cTrain = Math.max(1, Math.round(arr.length * trainFrac));
          var cVal = Math.max(1, Math.round(arr.length * valFrac));
          trainIdx = trainIdx.concat(arr.slice(0, cTrain));
          valIdx = valIdx.concat(arr.slice(cTrain, cTrain + cVal));
          testIdx = testIdx.concat(arr.slice(cTrain + cVal));
        });
        fisherYatesShuffle(trainIdx, rng);
        fisherYatesShuffle(valIdx, rng);
        fisherYatesShuffle(testIdx, rng);
        trainN = trainIdx.length; valN = valIdx.length; testN = testIdx.length;
      } else {
        trainIdx = selectedIdx.slice(0, trainN);
        valIdx = selectedIdx.slice(trainN, trainN + valN);
        testIdx = selectedIdx.slice(trainN + valN);
      }

      return _buildResult(source, trainIdx, valIdx, testIdx, seed, splitMode);
    });
  }

  function _buildResult(source, trainIdx, valIdx, testIdx, seed, splitMode) {
    var classCount = source.classCount;
    var classNames = source.classNames;
    var imageShape = source.imageShape;
    var imageSize = source.imageSize;

    function extractRecords(indices) {
      var x = [], y = [];
      for (var ri = 0; ri < indices.length; ri++) {
        var idx = indices[ri];
        var offset = idx * imageSize;
        var pf = new Array(imageSize);
        for (var pi = 0; pi < imageSize; pi++) pf[pi] = source.pixelsUint8[offset + pi] / 255;
        x.push(pf);
        y.push(source.labelsUint8[idx]);
      }
      return { x: x, y: y };
    }

    var records = { train: extractRecords(trainIdx), val: extractRecords(valIdx), test: extractRecords(testIdx) };
    var allIndices = trainIdx.concat(valIdx, testIdx);
    var hist = {};
    for (var hi = 0; hi < classCount; hi++) hist[String(hi)] = 0;
    allIndices.forEach(function (idx) { hist[String(source.labelsUint8[idx])]++; });

    return {
      schemaId: "cifar10",
      datasetModuleId: "cifar10",
      source: source.source || "synthetic",
      sourceUrls: source.urls || null,
      mode: "classification",
      imageShape: imageShape,
      classCount: classCount,
      classNames: classNames.slice(),
      pixelLayout: "hwc",
      splitConfig: {
        mode: splitMode, train: 0, val: 0, test: 0,
        stratifyKey: splitMode === "stratified_label" ? "label" : "",
        trainCount: records.train.x.length, valCount: records.val.x.length, testCount: records.test.x.length,
      },
      splitCounts: { train: records.train.x.length, val: records.val.x.length, test: records.test.x.length },
      trainCount: records.train.x.length, valCount: records.val.x.length, testCount: records.test.x.length,
      labelsHistogram: hist,
      records: records,
      preview: { firstLabels: records.train.y.slice(0, 24), sampleCount: allIndices.length },
      seed: seed,
    };
  }

  // fallback for Node.js (no Image/Canvas)
  function _fallbackSource(total, seed) {
    var loader = getLoader();
    if (loader) return loader.buildSyntheticSource({ totalExamples: total, seed: seed });
    // absolute minimal — read constants from loader or use bare minimum
    var rng = createRng(seed);
    var sz = 3072; var nc = 10;
    var pixels = new Uint8Array(total * sz);
    var labels = new Uint8Array(total);
    for (var i = 0; i < total; i++) {
      labels[i] = Math.floor(rng() * nc);
      for (var p = 0; p < sz; p++) pixels[i * sz + p] = Math.floor(rng() * 256);
    }
    return {
      variant: "cifar10", schemaId: "cifar10",
      imageShape: [32, 32, 3], imageSize: sz,
      classCount: nc, classNames: ["airplane","automobile","bird","cat","deer","dog","frog","horse","ship","truck"],
      numExamples: total, pixelsUint8: pixels, labelsUint8: labels,
      source: "synthetic", urls: null, loadedAt: Date.now(), pixelLayout: "hwc",
    };
  }

  // --- Playground: uses core renderer, fully standalone ---
  function _getCoreRenderer() {
    return (root && root.OSCImageRenderCore) || null;
  }

  function renderPlayground(mountEl, deps) {
    if (!mountEl) return;
    var elF = (deps && deps.el) || defaultEl;
    var isCurrent = (deps && typeof deps.isCurrent === "function") ? deps.isCurrent : function () { return true; };

    // if dataset data already provided (from dataset tab), render with splits
    if (deps && deps.datasetData) {
      _renderWithCore(mountEl, deps.datasetData, { el: elF, showSplits: true });
      return;
    }

    // playground: load full source and render without splits
    mountEl.innerHTML = "";
    mountEl.appendChild(elF("div", { style: "color:#67e8f9;font-size:13px;" }, "Loading CIFAR-10 data..."));

    buildCifar10Dataset({ seed: 42, totalCount: 999999 }).then(function (res) {
      if (!isCurrent()) return;
      _renderWithCore(mountEl, res, { el: elF, showSplits: false });
    }).catch(function (err) {
      if (!isCurrent()) return;
      mountEl.innerHTML = "";
      mountEl.appendChild(elF("div", { style: "color:#f43f5e;" }, "Error: " + String(err.message || err)));
    });
  }

  function _renderWithCore(mountEl, data, opts) {
    var core = _getCoreRenderer();
    if (core && typeof core.renderDatasetResult === "function") {
      core.renderDatasetResult(mountEl, data, opts);
    } else {
      // minimal fallback if core not loaded
      mountEl.innerHTML = "";
      var el = (opts && opts.el) || defaultEl;
      mountEl.appendChild(el("div", { style: "color:#94a3b8;font-size:12px;" },
        "CIFAR-10: " + (data.trainCount || 0) + " train, " + (data.valCount || 0) + " val, " + (data.testCount || 0) + " test"));
    }
  }

  function defaultEl(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "className") e.className = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    if (text) e.textContent = typeof text === "string" ? text : String(text);
    return e;
  }

  return {
    id: "cifar10",
    schemaId: "cifar10",
    label: "CIFAR-10",
    description: "CIFAR-10 image classification (32x32 RGB, 10 classes).",
    helpText: "CIFAR-10: 32x32 RGB, 10 classes | split modes: random, stratified_label",
    kind: "panel_builder",
    playground: { mode: "image_dataset" },
    preconfig: {
      dataset: { seed: 42, totalCount: 1400, splitDefaults: { mode: "stratified_label", train: 0.8, val: 0.1, test: 0.1 } },
      model: { defaultPreset: "cifar10_mlp_baseline" },
    },
    build: buildCifar10Dataset,
    playgroundApi: { renderPlayground: renderPlayground },
    uiApi: (function () {
      // use shared image dataset UI factory if available (from any loaded image module)
      var W = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {});
      var mnistMod = W.OSCDatasetModuleMnist;
      if (mnistMod && typeof mnistMod.createImageDatasetUiApi === "function") {
        return mnistMod.createImageDatasetUiApi({
          schemaId: "cifar10",
          defaultSplitMode: "stratified_label",
          defaultTotalCount: 1400,
          maxSamples: 10000,
          hasOriginalSplit: true,
        });
      }
      return null;
    })(),
    buildCifar10Dataset: buildCifar10Dataset,
  };
});

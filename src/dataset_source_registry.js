/**
 * Dataset Source Registry — zero-copy data architecture.
 *
 * One source → many datasets. Sources register once (pixels, trajectories),
 * dataset records store only split indices + config. No data duplication.
 *
 * Source contract:
 *   { id, numExamples, featureSize, getRow(i), getLabel(i), meta }
 *
 * getRow(i) returns the feature vector for example i (array or typed array).
 * getLabel(i) returns the label for example i (number or array).
 *
 * resolveDatasetSplit(dataset, split) materializes x/y arrays from indices.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCDatasetSourceRegistry = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var sources = {};

  /**
   * Register a data source.
   *
   * @param {string} id — unique source identifier
   * @param {object} source — { numExamples, featureSize, getRow(i), getLabel(i), meta? }
   */
  function register(id, source) {
    if (!id || !source) return;
    sources[String(id)] = source;
  }

  function get(id) {
    return sources[String(id || "")] || null;
  }

  function has(id) {
    return !!sources[String(id || "")];
  }

  function remove(id) {
    delete sources[String(id || "")];
  }

  function list() {
    return Object.keys(sources).map(function (id) {
      var s = sources[id];
      return { id: id, numExamples: s.numExamples || 0, featureSize: s.featureSize || 0 };
    });
  }

  /**
   * Create a source from raw arrays.
   *
   * @param {object} opts — { id, rows (2D array), labels (1D array), featureSize?, meta? }
   * @returns the registered source
   */
  function createFromArrays(opts) {
    var rows = opts.rows || [];
    var labels = opts.labels || [];
    var featureSize = opts.featureSize || (rows[0] ? rows[0].length : 0);
    var source = {
      numExamples: rows.length,
      featureSize: featureSize,
      getRow: function (i) { return rows[i]; },
      getLabel: function (i) { return labels[i] != null ? labels[i] : rows[i]; },
      meta: opts.meta || {},
    };
    if (opts.id) register(opts.id, source);
    return source;
  }

  /**
   * Create a source from Uint8Array pixels (MNIST/CIFAR).
   *
   * @param {object} opts — { id, pixelsUint8, labelsUint8, numExamples, imageSize, classCount?, meta? }
   * @returns the registered source
   */
  function createFromUint8(opts) {
    var pixels = opts.pixelsUint8;
    var labels = opts.labelsUint8;
    var imageSize = opts.imageSize || 784;
    var n = opts.numExamples || (pixels ? Math.floor(pixels.length / imageSize) : 0);
    var source = {
      numExamples: n,
      featureSize: imageSize,
      getRow: function (i) {
        // normalize Uint8 → float [0,1] on access (no pre-allocation)
        var base = i * imageSize;
        var out = new Array(imageSize);
        for (var j = 0; j < imageSize; j++) {
          out[j] = (pixels[base + j] || 0) / 255;
        }
        return out;
      },
      getLabel: function (i) { return labels ? labels[i] : 0; },
      meta: Object.assign({ classCount: opts.classCount || 0, imageShape: opts.imageShape }, opts.meta || {}),
    };
    if (opts.id) register(opts.id, source);
    return source;
  }

  /**
   * Resolve a dataset split from source + indices.
   *
   * @param {object} datasetData — { sourceId, splitIndices: { train: [...], val: [...], test: [...] } }
   *                                OR legacy { records: { train: { x, y }, ... } }
   * @param {string} split — "train", "val", or "test"
   * @returns {{ x: Array, y: Array, length: number }}
   */
  function resolveDatasetSplit(datasetData, split) {
    var ds = datasetData || {};

    // legacy format: records with inline data
    if (ds.records && ds.records[split] && ds.records[split].x) {
      return { x: ds.records[split].x, y: ds.records[split].y || ds.records[split].x, length: ds.records[split].x.length };
    }

    // legacy format: xTrain/yTrain
    var upperSplit = split.charAt(0).toUpperCase() + split.slice(1);
    if (ds["x" + upperSplit]) {
      return { x: ds["x" + upperSplit], y: ds["y" + upperSplit] || ds["x" + upperSplit], length: ds["x" + upperSplit].length };
    }

    // new format: sourceId + splitIndices
    var sourceId = ds.sourceId;
    var source = sourceId ? get(sourceId) : null;
    var indices = (ds.splitIndices && ds.splitIndices[split]) || [];
    if (!source || !indices.length) {
      return { x: [], y: [], length: 0 };
    }

    var x = new Array(indices.length);
    var y = new Array(indices.length);
    for (var i = 0; i < indices.length; i++) {
      x[i] = source.getRow(indices[i]);
      y[i] = source.getLabel(indices[i]);
    }
    return { x: x, y: y, length: indices.length };
  }

  /**
   * Get feature size from dataset data (any format).
   */
  function getFeatureSize(datasetData) {
    var ds = datasetData || {};
    if (ds.featureSize) return ds.featureSize;
    if (ds.meta && ds.meta.featureSize) return ds.meta.featureSize;
    if (ds.sourceId) {
      var source = get(ds.sourceId);
      if (source) return source.featureSize;
    }
    // legacy
    var sample = (ds.xTrain && ds.xTrain[0]) || (ds.records && ds.records.train && ds.records.train.x && ds.records.train.x[0]);
    return sample ? sample.length : 0;
  }

  return {
    register: register,
    get: get,
    has: has,
    remove: remove,
    list: list,
    createFromArrays: createFromArrays,
    createFromUint8: createFromUint8,
    resolveDatasetSplit: resolveDatasetSplit,
    getFeatureSize: getFeatureSize,
  };
});

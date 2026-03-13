(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCPredictionCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // --- generic evaluation metrics (works for any dataset type) ---

  function computeRegressionMetrics(truth, predicted) {
    var n = Math.min(truth.length, predicted.length);
    if (!n) return { mae: 0, rmse: 0, bias: 0, n: 0 };
    var sumAbs = 0, sumSq = 0, sumErr = 0;
    for (var i = 0; i < n; i++) {
      var err = Number(predicted[i] || 0) - Number(truth[i] || 0);
      sumAbs += Math.abs(err);
      sumSq += err * err;
      sumErr += err;
    }
    return {
      mae: sumAbs / n,
      rmse: Math.sqrt(sumSq / n),
      bias: sumErr / n,
      n: n,
    };
  }

  function computeClassificationMetrics(truthLabels, predictedLabels) {
    var n = Math.min(truthLabels.length, predictedLabels.length);
    if (!n) return { accuracy: 0, n: 0 };
    var correct = 0;
    for (var i = 0; i < n; i++) {
      if (Number(truthLabels[i]) === Number(predictedLabels[i])) correct++;
    }
    return { accuracy: correct / n, n: n };
  }

  function argmax(arr) {
    if (!arr || !arr.length) return -1;
    var best = 0;
    for (var i = 1; i < arr.length; i++) {
      if (arr[i] > arr[best]) best = i;
    }
    return best;
  }

  // --- generic rollout for autoregressive models ---

  function rolloutAutoregressive(tf, model, config) {
    var steps = config.steps || 100;
    var isSequence = Boolean(config.isSequence);
    var buildFeature = config.buildFeature;
    var extractPrediction = config.extractPrediction;
    var warmupValues = config.warmupValues || [];
    var warmupSteps = Math.min(warmupValues.length, steps);

    var predictions = new Array(steps);
    var history = warmupValues.slice();

    // warmup phase
    for (var i = 0; i < warmupSteps; i++) {
      predictions[i] = warmupValues[i];
    }

    // rollout phase
    for (var j = warmupSteps; j < steps; j++) {
      var feature = buildFeature(j, history, predictions);
      var inputTensor = isSequence ? tf.tensor3d([feature]) : tf.tensor2d([feature]);
      var yPred = model.predict(inputTensor);
      var out = (Array.isArray(yPred) ? yPred[0] : yPred).dataSync();
      inputTensor.dispose();
      if (Array.isArray(yPred)) { yPred.forEach(function (t) { t.dispose(); }); } else { yPred.dispose(); }

      var value = extractPrediction(out, j, predictions);
      predictions[j] = value;
      history.push(value);
    }
    return { predictions: predictions };
  }

  // --- generic batch predict for classification ---

  function batchPredict(tf, model, xData, config) {
    var batchSize = config.batchSize || 32;
    var n = xData.length;
    var allPreds = [];
    for (var i = 0; i < n; i += batchSize) {
      var batch = xData.slice(i, Math.min(i + batchSize, n));
      var tensor = tf.tensor2d(batch);
      var predRaw = model.predict(tensor);
      var pred = Array.isArray(predRaw) ? predRaw[0] : predRaw;
      var data = pred.arraySync();
      allPreds = allPreds.concat(data);
      tensor.dispose();
      if (Array.isArray(predRaw)) { predRaw.forEach(function (t) { t.dispose(); }); } else { predRaw.dispose(); }
    }
    return allPreds;
  }

  function batchPredictClassification(tf, model, xData, config) {
    var preds = batchPredict(tf, model, xData, config || {});
    return preds.map(function (row) {
      return Array.isArray(row) ? argmax(row) : Number(row || 0);
    });
  }

  // --- inference method resolution ---

  function resolveInferenceMethod(mode, requested, arCfg) {
    var m = String(mode || "autoregressive");
    var req = String(requested || "auto");
    var padMode = String((arCfg && arCfg.padMode) || "none");
    var defaultAr = padMode === "zero" ? "ar_zero_pad" : (padMode === "edge" ? "ar_edge_pad" : "ar_rk4_warmup");
    if (req === "auto") return m === "direct" ? "direct_only" : defaultAr;
    if (req === "direct_only") return m === "direct" ? "direct_only" : defaultAr;
    if (req === "ar_rk4_warmup" || req === "ar_zero_pad" || req === "ar_edge_pad") {
      return m === "direct" ? "direct_only" : req;
    }
    return m === "direct" ? "direct_only" : defaultAr;
  }

  // --- history window builder ---

  function buildHistoryWindow(series, index, arCfg, padValue) {
    var cfg = arCfg || {};
    var lagMode = String(cfg.lagMode || "contiguous");
    if (lagMode === "exact" && Array.isArray(cfg.lags) && cfg.lags.length) {
      return cfg.lags.map(function (lag) {
        var idx = index - Number(lag || 0);
        return idx >= 0 ? Number(series[idx] || 0) : Number(padValue || 0);
      });
    }
    var w = Math.max(1, Number(cfg.windowSize || 20));
    var out = [];
    for (var j = index - w; j < index; j++) {
      out.push(j >= 0 ? Number(series[j] || 0) : Number(padValue || 0));
    }
    return out;
  }

  return {
    computeRegressionMetrics: computeRegressionMetrics,
    computeClassificationMetrics: computeClassificationMetrics,
    argmax: argmax,
    rolloutAutoregressive: rolloutAutoregressive,
    batchPredict: batchPredict,
    batchPredictClassification: batchPredictClassification,
    resolveInferenceMethod: resolveInferenceMethod,
    buildHistoryWindow: buildHistoryWindow,
  };
});

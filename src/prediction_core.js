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

  // --- confusion matrix ---
  function confusionMatrix(truthLabels, predictedLabels, nClasses) {
    var n = nClasses || 0;
    var len = Math.min(truthLabels.length, predictedLabels.length);
    for (var i = 0; i < len; i++) { n = Math.max(n, Number(truthLabels[i]) + 1, Number(predictedLabels[i]) + 1); }
    var mat = [];
    for (var r = 0; r < n; r++) { mat.push(new Array(n).fill(0)); }
    for (var j = 0; j < len; j++) { mat[Number(truthLabels[j])][Number(predictedLabels[j])]++; }
    return mat;
  }

  // --- precision, recall, f1 per class ---
  function precisionRecallF1(cm) {
    var n = cm.length;
    var results = [];
    for (var c = 0; c < n; c++) {
      var tp = cm[c][c];
      var fp = 0, fn = 0;
      for (var i = 0; i < n; i++) { if (i !== c) { fp += cm[i][c]; fn += cm[c][i]; } }
      var precision = tp + fp > 0 ? tp / (tp + fp) : 0;
      var recall = tp + fn > 0 ? tp / (tp + fn) : 0;
      var f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
      var support = 0;
      for (var k = 0; k < n; k++) support += cm[c][k];
      results.push({ class: c, precision: precision, recall: recall, f1: f1, support: support, tp: tp, fp: fp, fn: fn });
    }
    return results;
  }

  // --- R² score ---
  function r2Score(truth, predicted) {
    var n = Math.min(truth.length, predicted.length);
    if (n < 2) return 0;
    var meanY = 0;
    for (var i = 0; i < n; i++) meanY += Number(truth[i] || 0);
    meanY /= n;
    var ssTot = 0, ssRes = 0;
    for (var j = 0; j < n; j++) {
      var t = Number(truth[j] || 0);
      var p = Number(predicted[j] || 0);
      ssTot += (t - meanY) * (t - meanY);
      ssRes += (t - p) * (t - p);
    }
    return ssTot > 0 ? 1 - ssRes / ssTot : 0;
  }

  // --- ROC curve (one-vs-rest per class) ---
  function rocCurveOneVsRest(truthLabels, predictedProbs, targetClass) {
    var n = truthLabels.length;
    var pairs = [];
    for (var i = 0; i < n; i++) {
      var isPos = Number(truthLabels[i]) === targetClass ? 1 : 0;
      var score = predictedProbs[i] ? (predictedProbs[i][targetClass] || 0) : 0;
      pairs.push({ score: score, label: isPos });
    }
    pairs.sort(function (a, b) { return b.score - a.score; });
    var totalPos = pairs.filter(function (p) { return p.label === 1; }).length;
    var totalNeg = n - totalPos;
    if (totalPos === 0 || totalNeg === 0) return { fpr: [0, 1], tpr: [0, 1], auc: 0.5 };
    var fpr = [0], tpr = [0];
    var tp = 0, fp = 0;
    for (var j = 0; j < pairs.length; j++) {
      if (pairs[j].label === 1) tp++; else fp++;
      tpr.push(tp / totalPos);
      fpr.push(fp / totalNeg);
    }
    // AUC via trapezoidal
    var auc = 0;
    for (var k = 1; k < fpr.length; k++) {
      auc += (fpr[k] - fpr[k - 1]) * (tpr[k] + tpr[k - 1]) / 2;
    }
    return { fpr: fpr, tpr: tpr, auc: auc };
  }

  // --- residuals ---
  function computeResiduals(truth, predicted) {
    var n = Math.min(truth.length, predicted.length);
    var residuals = [];
    for (var i = 0; i < n; i++) {
      residuals.push(Number(predicted[i] || 0) - Number(truth[i] || 0));
    }
    return residuals;
  }

  return {
    computeRegressionMetrics: computeRegressionMetrics,
    computeClassificationMetrics: computeClassificationMetrics,
    argmax: argmax,
    rolloutAutoregressive: rolloutAutoregressive,
    batchPredict: batchPredict,
    batchPredictClassification: batchPredictClassification,
    confusionMatrix: confusionMatrix,
    precisionRecallF1: precisionRecallF1,
    r2Score: r2Score,
    rocCurveOneVsRest: rocCurveOneVsRest,
    computeResiduals: computeResiduals,
    resolveInferenceMethod: resolveInferenceMethod,
    buildHistoryWindow: buildHistoryWindow,
  };
});

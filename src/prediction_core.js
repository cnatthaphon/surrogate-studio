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

  function _lcg(seed) {
    var state = (Number(seed) || 42) >>> 0;
    return function () {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function _selectSampleRows(rows, limit, seed) {
    var list = Array.isArray(rows) ? rows : [];
    var maxRows = Math.max(0, Number(limit) || 0);
    if (!maxRows || list.length <= maxRows) return list.slice();
    var idx = [];
    for (var i = 0; i < list.length; i++) idx.push(i);
    var rand = _lcg(seed);
    for (var j = idx.length - 1; j > 0; j--) {
      var k = Math.floor(rand() * (j + 1));
      var tmp = idx[j];
      idx[j] = idx[k];
      idx[k] = tmp;
    }
    idx = idx.slice(0, maxRows);
    idx.sort(function (a, b) { return a - b; });
    return idx.map(function (i0) { return list[i0]; });
  }

  function _coerceNumericMatrix(rows, limit, seed) {
    var picked = _selectSampleRows(Array.isArray(rows) ? rows : [], limit, seed);
    var out = [];
    for (var i = 0; i < picked.length; i++) {
      var row = picked[i];
      if (!Array.isArray(row) || !row.length) continue;
      out.push(row.map(function (v) {
        var n = Number(v);
        return Number.isFinite(n) ? n : 0;
      }));
    }
    return out;
  }

  function _matrixDim(a, b) {
    var dim = Infinity;
    [a, b].forEach(function (rows) {
      (rows || []).forEach(function (row) {
        if (Array.isArray(row) && row.length) dim = Math.min(dim, row.length);
      });
    });
    return Number.isFinite(dim) && dim > 0 ? dim : 0;
  }

  function _meanVector(rows, dim) {
    var out = new Array(dim).fill(0);
    if (!rows.length || !dim) return out;
    for (var i = 0; i < rows.length; i++) {
      for (var j = 0; j < dim; j++) out[j] += Number(rows[i][j] || 0);
    }
    for (var k = 0; k < dim; k++) out[k] /= rows.length;
    return out;
  }

  function _stdVector(rows, dim, mean) {
    var out = new Array(dim).fill(0);
    if (!rows.length || !dim) return out;
    for (var i = 0; i < rows.length; i++) {
      for (var j = 0; j < dim; j++) {
        var diff = Number(rows[i][j] || 0) - Number(mean[j] || 0);
        out[j] += diff * diff;
      }
    }
    for (var k = 0; k < dim; k++) out[k] = Math.sqrt(out[k] / rows.length);
    return out;
  }

  function _avgAbsDiff(a, b, dim) {
    if (!dim) return 0;
    var sum = 0;
    for (var i = 0; i < dim; i++) sum += Math.abs(Number(a[i] || 0) - Number(b[i] || 0));
    return sum / dim;
  }

  function _rmsDistanceSq(a, b, dim) {
    if (!dim) return 0;
    var sum = 0;
    for (var i = 0; i < dim; i++) {
      var diff = Number(a[i] || 0) - Number(b[i] || 0);
      sum += diff * diff;
    }
    return sum / dim;
  }

  function _avgPairwiseDistance(rows, dim) {
    if (!rows || rows.length < 2 || !dim) return 0;
    var total = 0;
    var count = 0;
    for (var i = 0; i < rows.length; i++) {
      for (var j = i + 1; j < rows.length; j++) {
        total += Math.sqrt(_rmsDistanceSq(rows[i], rows[j], dim));
        count++;
      }
    }
    return count ? total / count : 0;
  }

  function _avgNearestNeighborDistance(sourceRows, targetRows, dim) {
    if (!sourceRows || !sourceRows.length || !targetRows || !targetRows.length || !dim) return 0;
    var total = 0;
    for (var i = 0; i < sourceRows.length; i++) {
      var best = Infinity;
      for (var j = 0; j < targetRows.length; j++) {
        var distSq = _rmsDistanceSq(sourceRows[i], targetRows[j], dim);
        if (distSq < best) best = distSq;
      }
      total += Math.sqrt(best);
    }
    return total / sourceRows.length;
  }

  function _estimateRbfSigma(referenceRows, generatedRows, dim) {
    var pairs = [];
    var refLimit = Math.min(referenceRows.length, 16);
    var genLimit = Math.min(generatedRows.length, 16);
    for (var i = 0; i < refLimit; i++) {
      for (var j = i + 1; j < refLimit; j++) pairs.push(Math.sqrt(_rmsDistanceSq(referenceRows[i], referenceRows[j], dim)));
    }
    for (var g = 0; g < genLimit; g++) {
      for (var h = g + 1; h < genLimit; h++) pairs.push(Math.sqrt(_rmsDistanceSq(generatedRows[g], generatedRows[h], dim)));
    }
    for (var r = 0; r < refLimit; r++) {
      for (var s = 0; s < genLimit; s++) pairs.push(Math.sqrt(_rmsDistanceSq(referenceRows[r], generatedRows[s], dim)));
    }
    if (!pairs.length) return 1;
    pairs.sort(function (a, b) { return a - b; });
    var mid = Math.floor(pairs.length / 2);
    var sigma = pairs[mid];
    return sigma > 1e-8 ? sigma : 1;
  }

  function _rbfKernelFromDistSq(distSq, sigma) {
    var denom = 2 * sigma * sigma;
    return Math.exp(-distSq / Math.max(1e-8, denom));
  }

  function _computeMmdRbf(referenceRows, generatedRows, dim) {
    if (!referenceRows.length || !generatedRows.length || !dim) return 0;
    var sigma = _estimateRbfSigma(referenceRows, generatedRows, dim);
    var xx = 0, yy = 0, xy = 0;
    for (var i = 0; i < referenceRows.length; i++) {
      for (var j = 0; j < referenceRows.length; j++) xx += _rbfKernelFromDistSq(_rmsDistanceSq(referenceRows[i], referenceRows[j], dim), sigma);
    }
    for (var g = 0; g < generatedRows.length; g++) {
      for (var h = 0; h < generatedRows.length; h++) yy += _rbfKernelFromDistSq(_rmsDistanceSq(generatedRows[g], generatedRows[h], dim), sigma);
    }
    for (var r = 0; r < referenceRows.length; r++) {
      for (var s = 0; s < generatedRows.length; s++) xy += _rbfKernelFromDistSq(_rmsDistanceSq(referenceRows[r], generatedRows[s], dim), sigma);
    }
    xx /= (referenceRows.length * referenceRows.length);
    yy /= (generatedRows.length * generatedRows.length);
    xy /= (referenceRows.length * generatedRows.length);
    return Math.max(0, xx + yy - 2 * xy);
  }

  function computeSetComparisonMetrics(referenceSamples, generatedSamples, opts) {
    var cfg = opts && typeof opts === "object" ? opts : {};
    var seed = Number(cfg.seed) || 42;
    var refRows = _coerceNumericMatrix(referenceSamples, Math.max(1, Number(cfg.referenceLimit) || 128), seed);
    var genRows = _coerceNumericMatrix(generatedSamples, Math.max(1, Number(cfg.generatedLimit) || 128), seed + 1);
    var dim = _matrixDim(refRows, genRows);
    if (!refRows.length || !genRows.length || !dim) {
      return {
        referenceCount: refRows.length,
        generatedCount: genRows.length,
        dim: dim,
        meanGap: 0,
        stdGap: 0,
        diversity: 0,
        referenceDiversity: 0,
        diversityGap: 0,
        nnPrecision: 0,
        nnCoverage: 0,
        mmdRbf: 0,
      };
    }
    var refMean = _meanVector(refRows, dim);
    var genMean = _meanVector(genRows, dim);
    var refStd = _stdVector(refRows, dim, refMean);
    var genStd = _stdVector(genRows, dim, genMean);
    var refDiv = _avgPairwiseDistance(_selectSampleRows(refRows, Math.max(2, Number(cfg.pairwiseLimit) || 64), seed + 2), dim);
    var genDiv = _avgPairwiseDistance(_selectSampleRows(genRows, Math.max(2, Number(cfg.pairwiseLimit) || 64), seed + 3), dim);
    var refForNN = _selectSampleRows(refRows, Math.max(1, Number(cfg.nnReferenceLimit) || 128), seed + 4);
    var genForNN = _selectSampleRows(genRows, Math.max(1, Number(cfg.nnGeneratedLimit) || 128), seed + 5);
    return {
      referenceCount: refRows.length,
      generatedCount: genRows.length,
      dim: dim,
      meanGap: _avgAbsDiff(refMean, genMean, dim),
      stdGap: _avgAbsDiff(refStd, genStd, dim),
      diversity: genDiv,
      referenceDiversity: refDiv,
      diversityGap: Math.abs(genDiv - refDiv),
      nnPrecision: _avgNearestNeighborDistance(genForNN, refForNN, dim),
      nnCoverage: _avgNearestNeighborDistance(refForNN, genForNN, dim),
      mmdRbf: _computeMmdRbf(
        _selectSampleRows(refRows, Math.max(2, Number(cfg.mmdReferenceLimit) || 64), seed + 6),
        _selectSampleRows(genRows, Math.max(2, Number(cfg.mmdGeneratedLimit) || 64), seed + 7),
        dim
      ),
    };
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
    computeSetComparisonMetrics: computeSetComparisonMetrics,
    resolveInferenceMethod: resolveInferenceMethod,
    buildHistoryWindow: buildHistoryWindow,
  };
});

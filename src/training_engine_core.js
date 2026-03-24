(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCTrainingEngineCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var OPTIMIZER_TYPES = ["adam", "sgd", "rmsprop", "adagrad"];
  var LR_SCHEDULER_TYPES = ["plateau", "step", "exponential", "cosine", "none"];

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function normalizeOptimizerType(raw, fallback) {
    var fb = String(fallback || "adam").trim().toLowerCase() || "adam";
    var v0 = String(raw == null ? "" : raw).trim().toLowerCase();
    var aliases = { "": fb, adamw: "adam", rms: "rmsprop" };
    var v = aliases[v0] || v0 || fb;
    return OPTIMIZER_TYPES.indexOf(v) >= 0 ? v : fb;
  }

  function normalizeLrSchedulerType(raw, fallback) {
    var fb = String(fallback || "plateau").trim().toLowerCase() || "plateau";
    var v0 = String(raw == null ? "" : raw).trim().toLowerCase();
    var aliases = { "": fb, on: "plateau", off: "none", "true": "plateau", "false": "none",
      reduce_on_plateau: "plateau", step_decay: "step", exponential_decay: "exponential", cosine_annealing: "cosine" };
    var v = aliases[v0] || v0 || fb;
    return LR_SCHEDULER_TYPES.indexOf(v) >= 0 ? v : fb;
  }

  function createOptimizerByType(tf, type, lr) {
    var t = normalizeOptimizerType(type, "adam");
    var r = Math.max(1e-8, Number(lr) || 1e-3);
    if (t === "adam") return tf.train.adam(r);
    if (t === "sgd") return tf.train.sgd(r);
    if (t === "rmsprop") return tf.train.rmsprop(r);
    if (t === "adagrad") return tf.train.adagrad(r);
    return tf.train.adam(r);
  }

  function mapLossAlias(lossName, resolvedGlobal) {
    var v = String(lossName || "mse");
    if (v === "mse") return "meanSquaredError";
    if (v === "mae") return "meanAbsoluteError";
    if (v === "huber") return "huberLoss";
    if (v === "use_global") return "meanSquaredError";
    return String(resolvedGlobal || "meanSquaredError");
  }

  function scalarLossByType(tf, pred, truth, type) {
    if (type === "meanAbsoluteError") return tf.mean(tf.abs(tf.sub(pred, truth)));
    if (type === "huberLoss") {
      var delta = tf.scalar(1.0);
      var err = tf.sub(pred, truth);
      var a = tf.abs(err);
      var quadratic = tf.minimum(a, delta);
      var linear = tf.sub(a, quadratic);
      return tf.mean(tf.add(tf.mul(0.5, tf.square(quadratic)), tf.mul(delta, linear)));
    }
    return tf.mean(tf.square(tf.sub(pred, truth)));
  }

  function makeHeadLoss(tf, head, resolvedGlobal) {
    var target = String((head && head.target) || "x");
    var type = mapLossAlias(head && head.loss, resolvedGlobal);
    var wx = Math.max(0, Number((head && head.wx) || 1));
    var wv = Math.max(0, Number((head && head.wv) || 1));
    var headWeight = Math.max(0, Number((head && head.matchWeight) || 1));
    var klBeta = Math.max(0, Number((head && head.beta) || 1e-3));
    return function (yTrue, yPred) {
      return tf.tidy(function () {
        if (target === "latent_kl") {
          var total = Math.max(2, Number((head && head.units) || (yPred.shape && yPred.shape[1]) || 2));
          var zDim = Math.max(1, Math.floor(total / 2));
          var mu = yPred.slice([0, 0], [-1, zDim]);
          var logvar = tf.clipByValue(yPred.slice([0, zDim], [-1, zDim]), -10, 10);
          var one = tf.onesLike(logvar);
          var klTerm = tf.sub(tf.add(one, logvar), tf.add(tf.square(mu), tf.exp(logvar)));
          var kl = tf.mul(tf.scalar(-0.5), tf.mean(tf.sum(klTerm, -1)));
          return tf.mul(tf.scalar(headWeight * klBeta), kl);
        }
        if (target === "logits" || target === "label") {
          var ce = tf.losses.softmaxCrossEntropy(yTrue, yPred);
          return tf.mul(tf.scalar(headWeight), ce);
        }
        // generic MSE/loss on full output (works for any dimension)
        var l = scalarLossByType(tf, yPred, yTrue, type);
        return tf.mul(tf.scalar(headWeight), l);
      });
    };
  }

  function rowsToTensor(tf, rows, cols) {
    return tf.tensor2d(rows, [rows.length, Math.max(1, cols)]);
  }

  function extractHeadRows(rowsMain, rowsParams, targetMode, head, datasetMeta) {
    var headTarget = String((head && head.targetType) || (head && head.target) || "x");
    if (headTarget === "params") {
      if (!Array.isArray(rowsParams) || !rowsParams.length) throw new Error("Params target requested but parameter targets are missing.");
      var rawSelect = String((head && head.paramsSelect) || "");
      var picks = rawSelect.split(",").map(function (s) { return String(s || "").trim(); }).filter(Boolean);
      var names = Array.isArray(datasetMeta.paramNames) ? datasetMeta.paramNames.map(String) : [];
      if (picks.length && names.length) {
        var idx = picks.map(function (k) { return names.indexOf(k); }).filter(function (i) { return i >= 0; });
        if (idx.length) {
          return rowsParams.map(function (r) {
            var row = Array.isArray(r) ? r : [r];
            return idx.map(function (j) { return Number(row[j] || 0); });
          });
        }
      }
      return rowsParams;
    }
    if (headTarget === "latent_diff" || headTarget === "latent_kl") {
      var n = Array.isArray(rowsMain) ? rowsMain.length : 0;
      var units = Math.max(1, Number(head.units || 1));
      var zeros = new Array(n);
      for (var i = 0; i < n; i++) zeros[i] = new Array(units).fill(0);
      return zeros;
    }
    if (headTarget === "logits" || headTarget === "label") {
      return rowsMain;
    }
    if (headTarget === "xv" || headTarget === "traj") return rowsMain;
    if (headTarget === "x") {
      // if data is multi-dim (e.g. 40 features), return as-is; only extract [0] for 2-col xv format
      if (rowsMain[0] && Array.isArray(rowsMain[0]) && rowsMain[0].length > 2) return rowsMain;
      return rowsMain.map(function (r) { return [Number(Array.isArray(r) ? r[0] : r || 0)]; });
    }
    if (headTarget === "v") {
      if (String(targetMode) === "v") return rowsMain.map(function (r) { return [Number(Array.isArray(r) ? r[0] : r || 0)]; });
      if (rowsMain[0] && Array.isArray(rowsMain[0]) && rowsMain[0].length > 2) return rowsMain;
      return rowsMain.map(function (r) { return [Number(Array.isArray(r) ? (r[1] || 0) : 0)]; });
    }
    return rowsMain;
  }

  function applyGradientClipping(tf, optimizer, gradClipNorm, gradClipValue) {
    if (gradClipNorm <= 0 && gradClipValue <= 0) return;
    var originalApplyGradients = optimizer.applyGradients.bind(optimizer);
    optimizer.applyGradients = function (variableGradients) {
      var isArray = Array.isArray(variableGradients);
      var gnames = [];
      var grads = [];
      if (isArray) {
        variableGradients.forEach(function (entry) {
          if (!entry || !entry.tensor) return;
          gnames.push(String(entry.name || ""));
          grads.push(entry.tensor);
        });
      } else if (variableGradients && typeof variableGradients === "object") {
        Object.keys(variableGradients).forEach(function (name) {
          if (!variableGradients[name]) return;
          gnames.push(String(name || ""));
          grads.push(variableGradients[name]);
        });
      } else {
        return originalApplyGradients(variableGradients);
      }
      if (!grads.length) return originalApplyGradients(variableGradients);
      var clipped = grads;
      var needsDispose = false;
      if (gradClipNorm > 0) {
        var pair = tf.clipByGlobalNorm(clipped, gradClipNorm);
        clipped = pair[0];
        needsDispose = true;
        if (pair[1] && typeof pair[1].dispose === "function") pair[1].dispose();
      }
      if (gradClipValue > 0) {
        var vc = clipped.map(function (g) { return tf.clipByValue(g, -gradClipValue, gradClipValue); });
        if (needsDispose) tf.dispose(clipped);
        clipped = vc;
        needsDispose = true;
      }
      var applyArg = isArray
        ? gnames.map(function (name, idx) { return { name: name, tensor: clipped[idx] }; })
        : (function () { var out = {}; gnames.forEach(function (name, idx) { out[name] = clipped[idx]; }); return out; })();
      try { return originalApplyGradients(applyArg); }
      finally { if (needsDispose) tf.dispose(clipped); }
    };
  }

  // --- main training function ---

  function trainModel(tf, opts) {
    var isRnn = Boolean(opts.isSequence);
    var headConfigs = Array.isArray(opts.headConfigs) && opts.headConfigs.length
      ? opts.headConfigs
      : [{ id: "single", target: String(opts.targetMode || "x"), loss: "mse", wx: 1, wv: 1, matchWeight: 1 }];
    var dataset = opts.dataset;
    if (!dataset) throw new Error("opts.dataset required");
    if (!dataset.yTrain || !dataset.yTrain.length) throw new Error("Dataset split too small.");

    var resolvedGlobal = String(opts.resolvedLossType || "meanSquaredError");

    // create tensors
    var xTrain = isRnn ? tf.tensor3d(dataset.seqTrain || dataset.xTrain) : tf.tensor2d(dataset.xTrain);
    var xVal = isRnn ? tf.tensor3d(dataset.seqVal || dataset.xVal) : tf.tensor2d(dataset.xVal);
    var xTest = (dataset.xTest && dataset.xTest.length)
      ? (isRnn ? tf.tensor3d(dataset.seqTest || dataset.xTest) : tf.tensor2d(dataset.xTest))
      : null;

    var yTrainTensors = [];
    var yValTensors = [];
    var yTestTensors = [];
    var losses = [];
    var targetMode = String(dataset.targetMode || "x");
    var datasetMeta = { paramNames: dataset.paramNames, paramSize: dataset.paramSize };

    headConfigs.forEach(function (head) {
      var target = String(head.target || "x");
      var trainRows = extractHeadRows(dataset.yTrain, dataset.pTrain, targetMode, head, datasetMeta);
      var valRows = extractHeadRows(dataset.yVal, dataset.pVal, targetMode, head, datasetMeta);
      var testRows = (dataset.yTest && dataset.yTest.length)
        ? extractHeadRows(dataset.yTest, dataset.pTest, targetMode, head, datasetMeta)
        : null;
      var inferredCols = trainRows[0] ? (Array.isArray(trainRows[0]) ? trainRows[0].length : 1) : 1;
      var cols = (target === "xv" || target === "traj") ? Math.max(1, inferredCols)
        : (target === "params" ? Math.max(1, Number(dataset.paramSize || inferredCols))
        : (target === "latent_diff" ? Math.max(1, Number(head.units || 1))
        : (target === "latent_kl" ? Math.max(2, Number(head.units || 2))
        : (target === "logits" || target === "label" ? Math.max(1, Number(dataset.numClasses || inferredCols))
        : Math.max(1, inferredCols)))));
      yTrainTensors.push(rowsToTensor(tf, trainRows, cols));
      yValTensors.push(rowsToTensor(tf, valRows, cols));
      if (testRows) yTestTensors.push(rowsToTensor(tf, testRows, cols));
      losses.push(makeHeadLoss(tf, head, resolvedGlobal));
    });

    // optimizer + scheduler config
    var requestedLr = Math.max(1e-8, Number(opts.learningRate) || 1e-3);
    var optimizerType = normalizeOptimizerType(opts.optimizerType, "adam");
    var lrSchedulerType = normalizeLrSchedulerType(opts.lrSchedulerType, opts.useLrScheduler === false ? "none" : "plateau");
    var useLrScheduler = lrSchedulerType !== "none";
    var lrPatience = Math.max(1, Number(opts.lrPatience) || 3);
    var lrFactor = clamp(Number(opts.lrFactor) || 0.5, 0.05, 0.99);
    var minLr = Math.max(1e-8, Number(opts.minLr) || 1e-6);
    var gradClipNorm = Math.max(0, Number(opts.gradClipNorm) || 0);
    var gradClipValue = Math.max(0, Number(opts.gradClipValue) || 0);
    var restoreBestWeights = opts.restoreBestWeights !== false;
    var earlyStoppingPatienceRaw = Number(opts.earlyStoppingPatience);
    var earlyStoppingPatience = Number.isFinite(earlyStoppingPatienceRaw) && earlyStoppingPatienceRaw > 0
      ? Math.max(1, Math.floor(earlyStoppingPatienceRaw)) : 0;

    var currentLr = requestedLr;
    var optimizer = createOptimizerByType(tf, optimizerType, currentLr);
    applyGradientClipping(tf, optimizer, gradClipNorm, gradClipValue);

    var singleHead = headConfigs.length === 1;
    opts.model.compile({
      optimizer: optimizer,
      loss: singleHead ? losses[0] : losses,
      metrics: singleHead ? ["mae"] : headConfigs.map(function () { return "mae"; }),
    });

    var bestValLoss = Number.POSITIVE_INFINITY;
    var bestEpoch = -1;
    var bestWeights = null;
    var staleCount = 0;
    var lrStaleCount = 0;
    var stoppedEarly = false;
    var epochHistory = [];

    var disposeTensorArray = function (arr) {
      if (!Array.isArray(arr)) return;
      arr.forEach(function (t) { try { if (t && typeof t.dispose === "function") t.dispose(); } catch (e) {} });
    };

    var trySetLearningRate = function (nextLr) {
      var v = Math.max(minLr, Number(nextLr) || currentLr);
      currentLr = v;
      try { if (opts.model.optimizer && typeof opts.model.optimizer.setLearningRate === "function") { opts.model.optimizer.setLearningRate(v); return true; } } catch (e) {}
      try { if (opts.model.optimizer) { opts.model.optimizer.learningRate = v; return true; } } catch (e) {}
      return false;
    };

    var progressCb = {
      onEpochEnd: function (epoch, logs) {
        logs = logs || {};
        var valLoss = Number(logs.val_loss);
        var trainLoss = Number(logs.loss);
        var metricForBest = Number.isFinite(valLoss) ? valLoss : trainLoss;
        var improved = false;
        if (Number.isFinite(metricForBest) && metricForBest < bestValLoss) {
          improved = true;
          bestValLoss = metricForBest;
          bestEpoch = epoch + 1;
          if (restoreBestWeights) {
            var nw = opts.model.getWeights().map(function (w) { return w.clone(); });
            disposeTensorArray(bestWeights);
            bestWeights = nw;
          }
          staleCount = 0;
          lrStaleCount = 0;
        } else {
          staleCount += 1;
          lrStaleCount += 1;
        }

        // LR scheduling
        if (useLrScheduler) {
          if (lrSchedulerType === "plateau" && lrStaleCount >= lrPatience && currentLr > minLr) {
            trySetLearningRate(Math.max(minLr, currentLr * lrFactor));
            lrStaleCount = 0;
          } else if (lrSchedulerType === "step" && (epoch + 1) > 0 && (epoch + 1) % Math.max(1, lrPatience) === 0 && currentLr > minLr) {
            trySetLearningRate(Math.max(minLr, currentLr * lrFactor));
          } else if (lrSchedulerType === "exponential" && currentLr > minLr) {
            trySetLearningRate(Math.max(minLr, currentLr * lrFactor));
          } else if (lrSchedulerType === "cosine") {
            var totalEpochs = Math.max(1, Number(opts.epochs) || 1);
            var progress = Math.min(1, Math.max(0, (epoch + 1) / totalEpochs));
            var cosine = 0.5 * (1 + Math.cos(Math.PI * progress));
            trySetLearningRate(Math.max(minLr, minLr + (requestedLr - minLr) * cosine));
          }
        }

        // early stopping
        if (earlyStoppingPatience > 0 && staleCount >= earlyStoppingPatience) {
          stoppedEarly = true;
          try { opts.model.stopTraining = true; } catch (e) {}
        }

        var logEntry = {
          epoch: epoch + 1,
          loss: trainLoss,
          val_loss: valLoss,
          current_lr: currentLr,
          improved: improved,
          stopped_early: stoppedEarly,
        };
        epochHistory.push(logEntry);

        if (typeof opts.onEpochEnd === "function") opts.onEpochEnd(epoch, Object.assign({}, logs, logEntry));
        return Promise.resolve();
      },
      onBatchEnd: function (batch, logs) {
        if (typeof opts.onBatchEnd === "function") opts.onBatchEnd(batch, logs);
        return Promise.resolve();
      },
    };

    // training
    return opts.model.fit(xTrain, singleHead ? yTrainTensors[0] : yTrainTensors, {
      epochs: opts.epochs || 10,
      batchSize: opts.batchSize || 32,
      validationData: [xVal, singleHead ? yValTensors[0] : yValTensors],
      callbacks: [progressCb],
    }).then(function () {
      // restore best weights
      if (restoreBestWeights && Array.isArray(bestWeights) && bestWeights.length) {
        try { opts.model.setWeights(bestWeights); } catch (e) {}
      }

      // compute final metrics
      var predValRaw = opts.model.predict(xVal);
      var predVals = Array.isArray(predValRaw) ? predValRaw : [predValRaw];
      var mse = 0, mae = 0, testMse = 0, testMae = 0;
      for (var i = 0; i < predVals.length; i++) {
        mse += tf.losses.meanSquaredError(yValTensors[i], predVals[i]).dataSync()[0];
        mae += tf.metrics.meanAbsoluteError(yValTensors[i], predVals[i]).dataSync()[0];
      }
      var denom = Math.max(1, predVals.length);
      mse /= denom;
      mae /= denom;

      var testPredictions = null;
      var testTruth = null;
      var testR2 = null;
      var testRmse = null;
      var testBias = null;
      var testN = 0;

      if (xTest && yTestTensors.length) {
        var predTestRaw = opts.model.predict(xTest);
        var predTests = Array.isArray(predTestRaw) ? predTestRaw : [predTestRaw];
        // raw predictions for visualization
        testPredictions = predTests[0].arraySync();
        testTruth = yTestTensors[0].arraySync();
        testN = testPredictions.length;

        for (var j = 0; j < predTests.length; j++) {
          testMse += tf.losses.meanSquaredError(yTestTensors[j], predTests[j]).dataSync()[0];
          testMae += tf.metrics.meanAbsoluteError(yTestTensors[j], predTests[j]).dataSync()[0];
        }
        testMse /= denom;
        testMae /= denom;

        // compute R², RMSE, bias from raw predictions (same as PyTorch)
        if (testPredictions && testTruth) {
          var tFlat = [], pFlat = [];
          for (var ti = 0; ti < testN; ti++) {
            var tRow = testTruth[ti], pRow = testPredictions[ti];
            if (Array.isArray(tRow)) { for (var td = 0; td < tRow.length; td++) { tFlat.push(tRow[td]); pFlat.push(pRow[td]); } }
            else { tFlat.push(tRow); pFlat.push(pRow); }
          }
          var sumErr = 0, sumAbsErr = 0, sumSqErr = 0, meanT = 0;
          for (var fi = 0; fi < tFlat.length; fi++) meanT += tFlat[fi];
          meanT /= tFlat.length || 1;
          var ssTot = 0, ssRes = 0;
          for (var fj = 0; fj < tFlat.length; fj++) {
            var err = pFlat[fj] - tFlat[fj];
            sumErr += err; sumAbsErr += Math.abs(err); sumSqErr += err * err;
            ssTot += (tFlat[fj] - meanT) * (tFlat[fj] - meanT);
            ssRes += err * err;
          }
          testR2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
          testRmse = Math.sqrt(sumSqErr / (tFlat.length || 1));
          testBias = sumErr / (tFlat.length || 1);
        }

        tf.dispose(predTests);
      }

      // cleanup
      var disposeList = [xTrain, xVal].concat(yTrainTensors, yValTensors, yTestTensors, predVals);
      if (xTest) disposeList.push(xTest);
      tf.dispose(disposeList);
      disposeTensorArray(bestWeights);

      return {
        mse: mse, mae: mae, testMse: testMse, testMae: testMae,
        testR2: testR2, testRmse: testRmse, testBias: testBias, testN: testN,
        testPredictions: testPredictions, testTruth: testTruth,
        headCount: headConfigs.length,
        bestEpoch: bestEpoch > 0 ? bestEpoch : null,
        bestValLoss: Number.isFinite(bestValLoss) ? bestValLoss : null,
        finalLr: currentLr,
        stoppedEarly: stoppedEarly,
        epochHistory: epochHistory,
      };
    });
  }

  return {
    trainModel: trainModel,
    makeHeadLoss: makeHeadLoss,
    mapLossAlias: mapLossAlias,
    normalizeOptimizerType: normalizeOptimizerType,
    normalizeLrSchedulerType: normalizeLrSchedulerType,
    createOptimizerByType: createOptimizerByType,
    extractHeadRows: extractHeadRows,
    OPTIMIZER_TYPES: OPTIMIZER_TYPES,
    LR_SCHEDULER_TYPES: LR_SCHEDULER_TYPES,
  };
});

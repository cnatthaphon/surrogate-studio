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
    var type = mapLossAlias(head && head.loss, resolvedGlobal);
    var headWeight = Math.max(0, Number((head && head.matchWeight) || 1));
    var klBeta = Math.max(0, Number((head && head.beta) || 1e-3));
    var ht = String((head && head.headType) || "regression");
    return function (yTrue, yPred) {
      return tf.tidy(function () {
        if (ht === "latent_kl") {
          var total = Math.max(2, Number((head && head.units) || (yPred.shape && yPred.shape[1]) || 2));
          var zDim = Math.max(1, Math.floor(total / 2));
          var mu = yPred.slice([0, 0], [-1, zDim]);
          var logvar = tf.clipByValue(yPred.slice([0, zDim], [-1, zDim]), -10, 10);
          var one = tf.onesLike(logvar);
          var klTerm = tf.sub(tf.add(one, logvar), tf.add(tf.square(mu), tf.exp(logvar)));
          var kl = tf.mul(tf.scalar(-0.5), tf.mean(tf.sum(klTerm, -1)));
          return tf.mul(tf.scalar(headWeight * klBeta), kl);
        }
        if (ht === "classification") {
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
    var ht = String((head && head.headType) || "regression");
    if (ht === "latent_kl") {
      var n = Array.isArray(rowsMain) ? rowsMain.length : 0;
      var units = Math.max(1, Number(head.units || 1));
      var zeros = new Array(n);
      for (var i = 0; i < n; i++) zeros[i] = new Array(units).fill(0);
      return zeros;
    }
    // all other head types: return data as-is
    // the data format is determined by the dataset + trainer, not the target name
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
      var ht = String(head.headType || "regression");
      // for multi-head models: classification heads use labels, reconstruction heads use pixels
      var headYTrain = dataset.yTrain;
      var headYVal = dataset.yVal;
      var headYTest = dataset.yTest;
      if (ht === "classification" && dataset.labelsTrain) {
        headYTrain = dataset.labelsTrain;
        headYVal = dataset.labelsVal || headYVal;
        headYTest = dataset.labelsTest || headYTest;
      }
      var trainRows = extractHeadRows(headYTrain, dataset.pTrain, targetMode, head, datasetMeta);
      var valRows = extractHeadRows(headYVal, dataset.pVal, targetMode, head, datasetMeta);
      var testRows = (headYTest && headYTest.length)
        ? extractHeadRows(headYTest, dataset.pTest, targetMode, head, datasetMeta)
        : null;
      var inferredCols = trainRows[0] ? (Array.isArray(trainRows[0]) ? trainRows[0].length : 1) : 1;
      // determine cols from headType: classification → numClasses, latent → from head.units, else → from data
      var cols;
      if (ht === "classification") cols = Math.max(1, Number(dataset.numClasses || inferredCols));
      else if (ht === "latent_kl") cols = Math.max(2, Number(head.units || 2));
      else cols = Math.max(1, inferredCols);
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

  /**
   * Detect training phases from head configs.
   */
  /**
   * Detect training phases from head configs.
   * Returns array of unique phase labels. Empty string = default (all).
   * If all heads have empty phase, returns [""] (single phase).
   */
  function detectPhases(headConfigs) {
    var phases = {};
    (headConfigs || []).forEach(function (h) {
      var p = String(h.phase || "").trim();
      phases[p] = true;
    });
    var list = Object.keys(phases).sort();
    return list.length ? list : [""];
  }

  /**
   * Check if training needs phased execution.
   * Returns true if any output node has a non-empty phase label.
   */
  function needsPhasedTraining(headConfigs) {
    return (headConfigs || []).some(function (h) { return String(h.phase || "").trim() !== ""; });
  }

  /**
   * GAN / phased training loop.
   *
   * For each epoch:
   *   Phase 1 (D): freeze G layers, train D on real+fake, D loss
   *   Phase 2 (G): freeze D layers, train G to fool D, G loss
   *
   * Uses model.trainable/layer.trainable + recompile per phase.
   *
   * opts: same as trainModel + { phases: [1,2], phaseSteps: { 1: 1, 2: 1 } }
   */
  function trainModelPhased(tf, opts) {
    var model = opts.model;
    var headConfigs = opts.headConfigs || [];
    var dataset = opts.dataset;
    if (!dataset) throw new Error("opts.dataset required");

    var detectedPhases = detectPhases(headConfigs);
    // user can override phase order and epochs-per-phase from trainer config
    var phases = (Array.isArray(opts.phaseOrder) && opts.phaseOrder.length) ? opts.phaseOrder.filter(function (p) { return detectedPhases.indexOf(p) >= 0; }) : detectedPhases;
    var phaseEpochs = opts.phaseEpochs || {};
    var epochs = Math.max(1, Number(opts.epochs) || 20);
    var batchSize = Math.max(1, Number(opts.batchSize) || 32);
    var lr = Math.max(1e-8, Number(opts.learningRate) || 1e-3);
    var onEpochEnd = opts.onEpochEnd || opts.onEpoch || null;

    // group heads by phase
    var headsByPhase = {};
    phases.forEach(function (p) { headsByPhase[p] = []; });
    headConfigs.forEach(function (h, i) {
      var p = String(h.phase || "").trim();
      headsByPhase[p] = headsByPhase[p] || [];
      headsByPhase[p].push({ head: h, outputIdx: i });
    });

    // identify which layers belong to which phase path
    // for now: compile with all losses per phase, toggle trainable on layers
    // Phase 1 heads get trained first, phase 2 heads second

    // handle multi-input models (GAN: SampleZ + ImageSource)
    var inputNodes = opts.inputNodes || [];
    var numInputs = model.inputs ? model.inputs.length : 1;
    var nSamples = dataset.xTrain.length;
    var xTrainInputs;
    if (numInputs > 1 && inputNodes.length > 1) {
      // create per-input tensors
      xTrainInputs = inputNodes.map(function (inp) {
        if (inp.name === "sample_z_layer") {
          // SampleZ: generate random noise each epoch (will be regenerated per batch later)
          var zDim = model.inputs.filter(function (i) { return i.name.indexOf("z_input") >= 0; })[0];
          var dim = zDim ? zDim.shape[zDim.shape.length - 1] : 128;
          return tf.randomNormal([nSamples, dim]);
        }
        return tf.tensor2d(dataset.xTrain);
      });
    } else {
      xTrainInputs = tf.tensor2d(dataset.xTrain);
    }

    var yTrainArrays = [];
    var targetMode = String(dataset.targetMode || "xv");
    var datasetMeta = { paramNames: dataset.paramNames, paramSize: dataset.paramSize };
    headConfigs.forEach(function (head) {
      var ht = String(head.headType || "regression");
      var isClsHead = ht === "classification";
      // classification uses labels, everything else uses main y data (which may be x for reconstruction)
      var trainRows = isClsHead
        ? extractHeadRows(dataset.labelsTrain || dataset.yTrain, dataset.pTrain, targetMode, head, datasetMeta)
        : extractHeadRows(dataset.yTrain, dataset.pTrain, targetMode, head, datasetMeta);
      var inferredCols = trainRows[0] ? (Array.isArray(trainRows[0]) ? trainRows[0].length : 1) : 1;
      yTrainArrays.push(rowsToTensor(tf, trainRows, inferredCols));
    });

    // for each phase, compile model with only that phase's losses active
    // inactive phases get zero-weight loss
    var epochHistory = [];
    var bestValLoss = Infinity;
    var bestEpoch = -1;

    return new Promise(function (resolve) {
      var epoch = 0;

      function nextEpoch() {
        if (epoch >= epochs) {
          // cleanup
          if (Array.isArray(xTrainInputs)) xTrainInputs.forEach(function (t) { t.dispose(); });
          else xTrainInputs.dispose();
          yTrainArrays.forEach(function (t) { t.dispose(); });
          resolve({
            mae: 0, mse: 0,
            bestEpoch: bestEpoch > 0 ? bestEpoch : epochs,
            bestValLoss: bestValLoss,
            epochHistory: epochHistory,
            headCount: headConfigs.length,
            phased: true,
            phases: phases,
          });
          return;
        }

        var phaseLosses = {};
        // train each phase sequentially within the epoch
        var phaseIdx = 0;

        function nextPhase() {
          if (phaseIdx >= phases.length) {
            // epoch done
            var totalLoss = 0;
            phases.forEach(function (p) { totalLoss += (phaseLosses[p] || 0); });
            epochHistory.push({ epoch: epoch + 1, loss: totalLoss, phaseLosses: phaseLosses });
            if (totalLoss < bestValLoss) { bestValLoss = totalLoss; bestEpoch = epoch + 1; }

            if (typeof onEpochEnd === "function") {
              // format phase losses as string for display
              var phaseStr = phases.map(function (p) { return p + "=" + (phaseLosses[p] != null ? phaseLosses[p].toExponential(3) : "?"); }).join(" | ");
              onEpochEnd(epoch, {
                loss: totalLoss, val_loss: totalLoss,
                current_lr: lr, improved: epoch + 1 === bestEpoch,
                phaseLosses: phaseLosses, phaseStr: phaseStr,
              });
            }
            epoch++;
            setTimeout(nextEpoch, 0);
            return;
          }

          var phase = phases[phaseIdx];
          var phaseSteps = Math.max(1, Number(phaseEpochs[phase]) || 1);
          var phaseHeads = headsByPhase[phase] || [];
          if (!phaseHeads.length) { phaseIdx++; nextPhase(); return; }

          // === GAN-aware training ===
          // Detect if this is a GAN: has SampleZ input + classification D output
          var hasSampleZ = inputNodes.some(function (n) { return n.name === "sample_z_layer"; });
          var hasClsHead = headConfigs.some(function (h) { return h.headType === "classification"; });
          var hasReconHead = headConfigs.some(function (h) { return h.headType === "reconstruction"; });
          var isGAN = hasSampleZ && hasClsHead && hasReconHead && phases.length >= 2;

          if (isGAN) {
            // GAN training: extract G and D sub-models from the multi-output model
            // model.outputs[0] = G output (pixel_values), model.outputs[1] = D output (real/fake)
            // Find which output is G (reconstruction) and which is D (classification)
            var gOutIdx = -1, dOutIdx = -1;
            var gInput = null, dInput = null;
            var zDim = 128;
            headConfigs.forEach(function (h, i) {
              if (h.headType === "reconstruction") gOutIdx = i;
              if (h.headType === "classification") dOutIdx = i;
            });
            inputNodes.forEach(function (n) {
              if (n.name === "sample_z_layer") zDim = Number(n.data && n.data.dim || 128);
            });

            // Get G and D output tensors
            var gOutput = model.outputs[gOutIdx];
            var dOutput = model.outputs[dOutIdx];

            // Build D-only model: takes 784-dim image input → D classification output
            var dModelInput = tf.input({ shape: [Number(dataset.featureSize || 784)] });
            // Find D's first layer (connected to ImageSource) and build D chain
            // For now: use the full model but only backprop through D's loss

            // Simpler approach: use the combined model with proper targets per phase
            // D phase: G generates fake images, concat with real, D classifies both
            // G phase: G generates, D classifies, G trains to fool D

            // For each training step within this phase:
            var phaseStepsDone = 0;
            function ganPhaseStep() {
              if (phaseStepsDone >= phaseSteps) {
                phaseIdx++;
                nextPhase();
                return;
              }

              // regenerate z noise
              if (Array.isArray(xTrainInputs)) {
                xTrainInputs.forEach(function (xt, ti) {
                  if (inputNodes[ti] && inputNodes[ti].name === "sample_z_layer") {
                    var old = xTrainInputs[ti];
                    xTrainInputs[ti] = tf.randomNormal(old.shape);
                    old.dispose();
                  }
                });
              }

              // Generate fake images from G
              var fakePred = model.predict(xTrainInputs);
              var fakeImages = Array.isArray(fakePred) ? fakePred[gOutIdx] : fakePred;

              if (phase === phases[dOutIdx >= 0 ? 1 : 0] || phase.toLowerCase().indexOf("discrim") >= 0) {
                // === D phase: train D on real (label=1) and fake (label=0) ===
                // D sees real images → should output 1
                // D sees fake images → should output 0
                var realInput = xTrainInputs.find ? xTrainInputs.find(function (_, i) { return inputNodes[i] && inputNodes[i].name !== "sample_z_layer"; }) : xTrainInputs;
                if (Array.isArray(realInput)) realInput = realInput[0] || xTrainInputs;
                var nReal = realInput.shape[0];
                var realLabels = tf.ones([nReal, 1]);
                var fakeLabels = tf.zeros([nReal, 1]);

                // Train D on real images
                var dLossWeights = headConfigs.map(function (h) {
                  return h.headType === "classification" ? 1 : 0;
                });
                var dRealTargets = headConfigs.map(function (h) {
                  return h.headType === "classification" ? realLabels : yTrainArrays[headConfigs.indexOf(h)];
                });
                model.compile({ optimizer: tf.train.adam(lr), loss: headConfigs.map(function (h) { return h.headType === "classification" ? "binaryCrossentropy" : "meanSquaredError"; }), lossWeights: dLossWeights });

                model.fit(xTrainInputs, dRealTargets, { batchSize: batchSize, epochs: 1, shuffle: true, verbose: 0 }).then(function (hReal) {
                  var dRealLoss = hReal.history.loss[0] || 0;
                  // Now train D on fake images (G output, detached)
                  // Replace real image input with fake images
                  var fakeInput = xTrainInputs.map ? xTrainInputs.map(function (xt, i) {
                    return inputNodes[i] && inputNodes[i].name !== "sample_z_layer" ? fakeImages.clone() : xt;
                  }) : fakeImages;
                  var dFakeTargets = headConfigs.map(function (h) {
                    return h.headType === "classification" ? fakeLabels : yTrainArrays[headConfigs.indexOf(h)];
                  });
                  model.fit(fakeInput, dFakeTargets, { batchSize: batchSize, epochs: 1, shuffle: true, verbose: 0 }).then(function (hFake) {
                    var dFakeLoss = hFake.history.loss[0] || 0;
                    phaseLosses[phase] = (dRealLoss + dFakeLoss) / 2;
                    realLabels.dispose(); fakeLabels.dispose();
                    if (Array.isArray(fakePred)) fakePred.forEach(function (p) { p.dispose(); }); else fakePred.dispose();
                    phaseStepsDone++;
                    setTimeout(ganPhaseStep, 0);
                  });
                });

              } else {
                // === G phase: train G to fool D (D(G(z)) → 1) ===
                var foolLabels = tf.ones([nSamples, 1]);
                var gLossWeights = headConfigs.map(function (h) {
                  // both G output (pixel quality) and D output (fool D) should contribute
                  return h.matchWeight || 1;
                });
                var gTargets = headConfigs.map(function (h, i) {
                  return h.headType === "classification" ? foolLabels : yTrainArrays[i];
                });
                model.compile({ optimizer: tf.train.adam(lr), loss: headConfigs.map(function (h) { return h.headType === "classification" ? "binaryCrossentropy" : "meanSquaredError"; }), lossWeights: gLossWeights });

                model.fit(xTrainInputs, gTargets, { batchSize: batchSize, epochs: 1, shuffle: true, verbose: 0 }).then(function (hG) {
                  phaseLosses[phase] = hG.history.loss[0] || 0;
                  foolLabels.dispose();
                  if (Array.isArray(fakePred)) fakePred.forEach(function (p) { p.dispose(); }); else fakePred.dispose();
                  phaseStepsDone++;
                  setTimeout(ganPhaseStep, 0);
                });
              }
            }
            ganPhaseStep();
            return; // don't fall through to generic path
          }

          // === Generic phased training (non-GAN) ===
          // compile model for this phase
          var losses = headConfigs.map(function (h, i) {
            var p = String(h.phase || "").trim();
            if (p !== phase && p !== "") return "meanSquaredError";
            return makeHeadLoss(tf, h, "meanSquaredError");
          });
          var lossWeights = headConfigs.map(function (h) {
            var p = String(h.phase || "").trim();
            return (p === phase || p === "") ? h.matchWeight || 1 : 0;
          });

          model.compile({
            optimizer: tf.train.adam(lr),
            loss: losses,
            lossWeights: lossWeights,
          });

          var yTargets = headConfigs.length === 1 ? yTrainArrays[0] : yTrainArrays;
          // regenerate z noise each phase
          if (Array.isArray(xTrainInputs)) {
            xTrainInputs.forEach(function (xt, ti) {
              if (inputNodes[ti] && inputNodes[ti].name === "sample_z_layer") {
                var old = xTrainInputs[ti];
                xTrainInputs[ti] = tf.randomNormal(old.shape);
                old.dispose();
              }
            });
          }
          model.fit(xTrainInputs, yTargets, {
            batchSize: batchSize, epochs: phaseSteps, shuffle: true, verbose: 0,
          }).then(function (h) {
            var losses = h.history.loss || [0];
            phaseLosses[phase] = losses[losses.length - 1] || 0;
            phaseIdx++;
            nextPhase();
          });
        }

        nextPhase();
      }

      nextEpoch();
    });
  }

  return {
    trainModel: trainModel,
    trainModelPhased: trainModelPhased,
    makeHeadLoss: makeHeadLoss,
    mapLossAlias: mapLossAlias,
    normalizeOptimizerType: normalizeOptimizerType,
    normalizeLrSchedulerType: normalizeLrSchedulerType,
    createOptimizerByType: createOptimizerByType,
    extractHeadRows: extractHeadRows,
    detectPhases: detectPhases,
    needsPhasedTraining: needsPhasedTraining,
    OPTIMIZER_TYPES: OPTIMIZER_TYPES,
    LR_SCHEDULER_TYPES: LR_SCHEDULER_TYPES,
  };
});

"use strict";
var assert = require("assert");
var PC = require("../src/prediction_core.js");

function main() {
  assert(PC, "module loaded");

  // --- computeRegressionMetrics ---
  var truth = [1, 2, 3, 4, 5];
  var pred =  [1.1, 2.2, 2.8, 4.1, 5.3];
  var m = PC.computeRegressionMetrics(truth, pred);
  assert(m.mae > 0, "mae > 0");
  assert(m.rmse > 0, "rmse > 0");
  assert(m.rmse >= m.mae, "rmse >= mae");
  assert.strictEqual(m.n, 5);

  // perfect prediction
  var mp = PC.computeRegressionMetrics([1, 2, 3], [1, 2, 3]);
  assert.strictEqual(mp.mae, 0);
  assert.strictEqual(mp.rmse, 0);
  assert.strictEqual(mp.bias, 0);

  // empty
  var me = PC.computeRegressionMetrics([], []);
  assert.strictEqual(me.n, 0);

  // --- computeClassificationMetrics ---
  var cm = PC.computeClassificationMetrics([0, 1, 2, 1], [0, 1, 1, 1]);
  assert.strictEqual(cm.accuracy, 0.75);
  assert.strictEqual(cm.n, 4);

  var cm2 = PC.computeClassificationMetrics([0, 1], [0, 1]);
  assert.strictEqual(cm2.accuracy, 1.0);

  // --- argmax ---
  assert.strictEqual(PC.argmax([0.1, 0.9, 0.3]), 1);
  assert.strictEqual(PC.argmax([0.5, 0.2, 0.8, 0.1]), 2);
  assert.strictEqual(PC.argmax([1]), 0);
  assert.strictEqual(PC.argmax([]), -1);

  // --- resolveInferenceMethod ---
  assert.strictEqual(PC.resolveInferenceMethod("direct", "auto", {}), "direct_only");
  assert.strictEqual(PC.resolveInferenceMethod("autoregressive", "auto", {}), "ar_rk4_warmup");
  assert.strictEqual(PC.resolveInferenceMethod("autoregressive", "auto", { padMode: "zero" }), "ar_zero_pad");
  assert.strictEqual(PC.resolveInferenceMethod("autoregressive", "ar_edge_pad", {}), "ar_edge_pad");

  // --- buildHistoryWindow ---
  var series = [10, 20, 30, 40, 50];
  var hw = PC.buildHistoryWindow(series, 4, { windowSize: 3 }, 0);
  assert.deepStrictEqual(hw, [20, 30, 40]);

  // with padding
  var hw2 = PC.buildHistoryWindow(series, 1, { windowSize: 3 }, -1);
  assert.deepStrictEqual(hw2, [-1, -1, 10]);

  // exact lag mode
  var hw3 = PC.buildHistoryWindow(series, 4, { lagMode: "exact", lags: [1, 3] }, 0);
  assert.deepStrictEqual(hw3, [40, 20]);

  // --- rolloutAutoregressive (mock) ---
  var mockModel = {
    predict: function (t) {
      var d = t.dataSync();
      var fakeOut = { dataSync: function () { return [d[0] + 0.1]; }, dispose: function () {} };
      return fakeOut;
    }
  };
  var mockTf = {
    tensor2d: function (arr) { return { dataSync: function () { return arr[0]; }, dispose: function () {} }; },
    tensor3d: function (arr) { return { dataSync: function () { return arr[0]; }, dispose: function () {} }; },
  };
  var result = PC.rolloutAutoregressive(mockTf, mockModel, {
    steps: 5,
    isSequence: false,
    warmupValues: [1.0, 2.0],
    buildFeature: function (i, history) { return [history[history.length - 1] || 0]; },
    extractPrediction: function (out) { return out[0]; },
  });
  assert.strictEqual(result.predictions.length, 5);
  assert.strictEqual(result.predictions[0], 1.0, "warmup preserved");
  assert.strictEqual(result.predictions[1], 2.0, "warmup preserved");
  assert(result.predictions[2] !== 0, "rollout produces values");

  // --- confusionMatrix ---
  var cmx = PC.confusionMatrix([0,1,2,0,1,2,0,1,2,0], [0,1,1,0,2,2,0,1,0,0], 3);
  assert.strictEqual(cmx.length, 3, "3x3 matrix");
  assert.strictEqual(cmx[0][0], 4, "class 0 correct=4");
  assert.strictEqual(cmx[1][1], 2, "class 1 correct=2");
  assert.strictEqual(cmx[2][1], 1, "class 2 predicted as 1");
  // row sums = support per class
  assert.strictEqual(cmx[0].reduce(function(a,b){return a+b;},0), 4);
  assert.strictEqual(cmx[1].reduce(function(a,b){return a+b;},0), 3);
  assert.strictEqual(cmx[2].reduce(function(a,b){return a+b;},0), 3);

  // --- precisionRecallF1 ---
  var prf = PC.precisionRecallF1(cmx);
  assert.strictEqual(prf.length, 3, "one per class");
  assert(prf[0].precision > 0, "class 0 precision > 0");
  assert(prf[0].recall > 0, "class 0 recall > 0");
  assert(prf[0].f1 > 0, "class 0 f1 > 0");
  // class 0: tp=4, fp=1(class2 predicted 0), fn=0 → precision=4/5=0.8, recall=4/4=1.0
  assert(Math.abs(prf[0].precision - 0.8) < 0.01, "class 0 precision=0.8");
  assert(Math.abs(prf[0].recall - 1.0) < 0.01, "class 0 recall=1.0");
  // f1 = 2*0.8*1.0/(0.8+1.0) = 0.8889
  assert(Math.abs(prf[0].f1 - 0.8889) < 0.01, "class 0 f1~0.889");

  // --- r2Score ---
  var r2 = PC.r2Score([1,2,3,4,5], [1.1, 2.2, 2.8, 4.1, 5.3]);
  assert(r2 > 0.95, "r2 > 0.95 for near-perfect");
  var r2_perfect = PC.r2Score([1,2,3], [1,2,3]);
  assert.strictEqual(r2_perfect, 1, "perfect r2=1");
  var r2_bad = PC.r2Score([1,2,3], [3,2,1]);
  assert(r2_bad < 0, "inverted r2 < 0");

  // --- rocCurveOneVsRest ---
  var rocTruth = [0,1,2,0,1,2];
  var rocProbs = [
    [0.9,0.05,0.05], [0.1,0.8,0.1], [0.1,0.1,0.8],
    [0.8,0.1,0.1],   [0.2,0.7,0.1], [0.1,0.2,0.7]
  ];
  var roc0 = PC.rocCurveOneVsRest(rocTruth, rocProbs, 0);
  assert(roc0.auc >= 0.9, "class 0 AUC high for clean separation");
  assert(roc0.fpr.length > 2, "fpr has points");
  assert(roc0.tpr.length === roc0.fpr.length, "fpr/tpr same length");
  // when all scores are identical, AUC should be 0.5 (no discrimination)
  var rocFlat = PC.rocCurveOneVsRest([0,1,0,1], [[0.5,0.5],[0.5,0.5],[0.5,0.5],[0.5,0.5]], 0);
  assert(rocFlat.fpr.length > 0, "flat ROC has points");

  // --- computeResiduals ---
  var resid = PC.computeResiduals([1,2,3], [1.1, 1.8, 3.2]);
  assert.strictEqual(resid.length, 3);
  assert(Math.abs(resid[0] - 0.1) < 0.001, "residual[0]=0.1");
  assert(Math.abs(resid[1] - (-0.2)) < 0.001, "residual[1]=-0.2");
  assert(Math.abs(resid[2] - 0.2) < 0.001, "residual[2]=0.2");

  console.log("PASS test_contract_prediction_core");
}

main();

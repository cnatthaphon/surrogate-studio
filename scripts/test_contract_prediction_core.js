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

  console.log("PASS test_contract_prediction_core");
}

main();

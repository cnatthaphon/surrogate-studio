"use strict";
var assert = require("assert");
var TEC = require("../src/training_engine_core.js");

function main() {
  assert(TEC, "module loaded");

  // --- normalizeOptimizerType ---
  assert.strictEqual(TEC.normalizeOptimizerType("adam", "adam"), "adam");
  assert.strictEqual(TEC.normalizeOptimizerType("adamw", "adam"), "adam");
  assert.strictEqual(TEC.normalizeOptimizerType("sgd", "adam"), "sgd");
  assert.strictEqual(TEC.normalizeOptimizerType("rms", "adam"), "rmsprop");
  assert.strictEqual(TEC.normalizeOptimizerType("unknown", "adam"), "adam");
  assert.strictEqual(TEC.normalizeOptimizerType(null, "sgd"), "sgd");

  // --- normalizeLrSchedulerType ---
  assert.strictEqual(TEC.normalizeLrSchedulerType("plateau", "plateau"), "plateau");
  assert.strictEqual(TEC.normalizeLrSchedulerType("on", "none"), "plateau");
  assert.strictEqual(TEC.normalizeLrSchedulerType("off", "plateau"), "none");
  assert.strictEqual(TEC.normalizeLrSchedulerType("cosine_annealing", "none"), "cosine");
  assert.strictEqual(TEC.normalizeLrSchedulerType(null, "step"), "step");

  // --- mapLossAlias ---
  assert.strictEqual(TEC.mapLossAlias("mse"), "meanSquaredError");
  assert.strictEqual(TEC.mapLossAlias("mae"), "meanAbsoluteError");
  assert.strictEqual(TEC.mapLossAlias("huber"), "huberLoss");
  assert.strictEqual(TEC.mapLossAlias("use_global"), "meanSquaredError");

  // --- extractHeadRows (generalized: returns data as-is, no column extraction) ---
  var yMain = [[1, 2], [3, 4], [5, 6]];
  var pTrain = [[10, 20, 30], [40, 50, 60], [70, 80, 90]];

  // all non-latent_kl heads return rowsMain as-is
  var xRows = TEC.extractHeadRows(yMain, null, "x", { target: "x" }, {});
  assert.deepStrictEqual(xRows, yMain);

  var vRows = TEC.extractHeadRows(yMain, null, "xv", { target: "v" }, {});
  assert.deepStrictEqual(vRows, yMain);

  var xvRows = TEC.extractHeadRows(yMain, null, "xv", { target: "xv" }, {});
  assert.deepStrictEqual(xvRows, yMain);

  // params target (generalized: returns rowsMain as-is, routing handled upstream)
  var pRows = TEC.extractHeadRows(yMain, pTrain, "x", { target: "params", paramsSelect: "m,k" }, { paramNames: ["m", "c", "k"] });
  assert.strictEqual(pRows.length, 3);
  assert.deepStrictEqual(pRows, yMain, "params returns rowsMain as-is");

  // latent_kl target — returns zeros (special case)
  var klRows = TEC.extractHeadRows(yMain, null, "x", { headType: "latent_kl", units: 8 }, {});
  assert.strictEqual(klRows[0].length, 8);
  assert(klRows[0].every(function (v) { return v === 0; }), "latent_kl zeros");

  // logits target (passthrough)
  var logitRows = TEC.extractHeadRows([[0, 0, 1], [1, 0, 0]], null, "x", { target: "logits" }, {});
  assert.deepStrictEqual(logitRows, [[0, 0, 1], [1, 0, 0]]);

  // --- OPTIMIZER_TYPES / LR_SCHEDULER_TYPES ---
  assert(Array.isArray(TEC.OPTIMIZER_TYPES));
  assert(TEC.OPTIMIZER_TYPES.indexOf("adam") >= 0);
  assert(Array.isArray(TEC.LR_SCHEDULER_TYPES));
  assert(TEC.LR_SCHEDULER_TYPES.indexOf("cosine") >= 0);

  console.log("PASS test_contract_training_engine_core");
}

main();

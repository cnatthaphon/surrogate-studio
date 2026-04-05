"use strict";

const assert = require("assert");
const predictionCore = require("../src/prediction_core.js");

function makeRows(count, dim, offset) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const row = [];
    for (let j = 0; j < dim; j++) row.push((i + j + (offset || 0)) / 100);
    out.push(row);
  }
  return out;
}

function run() {
  const reference = makeRows(32, 8, 0);
  const similar = makeRows(32, 8, 1);
  const shifted = makeRows(32, 8, 50);

  const near = predictionCore.computeSetComparisonMetrics(reference, similar, { seed: 42 });
  const far = predictionCore.computeSetComparisonMetrics(reference, shifted, { seed: 42 });

  assert.strictEqual(near.referenceCount > 0, true);
  assert.strictEqual(near.generatedCount > 0, true);
  assert.strictEqual(near.dim, 8);
  assert.strictEqual(typeof near.mmdRbf, "number");
  assert.strictEqual(typeof near.meanGap, "number");
  assert.strictEqual(typeof near.nnPrecision, "number");
  assert.strictEqual(typeof near.diversity, "number");

  assert.ok(far.mmdRbf > near.mmdRbf, "shifted set should have larger MMD");
  assert.ok(far.meanGap > near.meanGap, "shifted set should have larger mean gap");
  assert.ok(far.nnPrecision > near.nnPrecision, "shifted set should have larger NN precision distance");

  console.log("PASS test_generative_evaluation_metrics");
}

run();

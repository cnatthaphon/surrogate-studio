#!/usr/bin/env node
"use strict";

const assert = require("assert");
const core = require("../src/dataset_processing_core.js");

function approx(a, b, eps) {
  return Math.abs(Number(a) - Number(b)) <= (Number(eps) || 1e-9);
}

function main() {
  assert(core && typeof core === "object", "dataset_processing_core missing");
  assert.strictEqual(typeof core.normalizeSplitFractions, "function", "normalizeSplitFractions missing");
  assert.strictEqual(typeof core.computeSplitCounts, "function", "computeSplitCounts missing");
  assert.strictEqual(typeof core.normalizeSplitMode, "function", "normalizeSplitMode missing");

  const fr = core.normalizeSplitFractions(
    { train: 0.6, val: 0.15, test: 0.15 },
    { train: 0.7, val: 0.2, test: 0.1 }
  );
  assert(approx(fr.train + fr.val + fr.test, 1, 1e-9), "fractions must sum to 1");
  assert(fr.train > 0 && fr.val > 0 && fr.test > 0, "fractions must be positive");

  const counts = core.computeSplitCounts(1000, fr, { minEach: 1 });
  assert.strictEqual(Number(counts.total), 1000, "total mismatch");
  assert.strictEqual(Number(counts.train + counts.val + counts.test), 1000, "split count sum mismatch");
  assert(counts.train > 0 && counts.val > 0 && counts.test > 0, "split counts must be positive");

  const modeDefs = [{ id: "random" }, { id: "stratified_label" }];
  assert.strictEqual(core.normalizeSplitMode("stratified_label", modeDefs, "random"), "stratified_label");
  assert.strictEqual(core.normalizeSplitMode("unsupported", modeDefs, "random"), "random");

  console.log("PASS test_contract_dataset_processing_core");
}

try {
  main();
} catch (err) {
  console.error("FAIL test_contract_dataset_processing_core:", err && err.stack ? err.stack : err);
  process.exit(1);
}


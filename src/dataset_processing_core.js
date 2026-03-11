(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCDatasetProcessingCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function toFiniteNumber(value, fallbackValue) {
    var n = Number(value);
    if (Number.isFinite(n)) return n;
    var fb = Number(fallbackValue);
    if (Number.isFinite(fb)) return fb;
    return NaN;
  }

  function clamp(value, min, max) {
    var n = Number(value);
    if (!Number.isFinite(n)) return n;
    if (Number.isFinite(min) && n < min) n = min;
    if (Number.isFinite(max) && n > max) n = max;
    return n;
  }

  function normalizeSplitFractions(rawFractions, fallbackFractions) {
    var raw = (rawFractions && typeof rawFractions === "object") ? rawFractions : {};
    var fb = (fallbackFractions && typeof fallbackFractions === "object") ? fallbackFractions : {};

    var train = toFiniteNumber(raw.train, fb.train);
    var val = toFiniteNumber(raw.val, fb.val);
    var test = toFiniteNumber(raw.test, fb.test);

    if (!Number.isFinite(train) || !Number.isFinite(val) || !Number.isFinite(test)) {
      throw new Error("Split fractions are invalid. Provide finite train/val/test values.");
    }

    train = clamp(train, 0, 1);
    val = clamp(val, 0, 1);
    test = clamp(test, 0, 1);

    if (train + val > 1) {
      val = Math.max(0, 1 - train);
      test = 0;
    }

    var sum = train + val + test;
    if (sum <= 1e-12) {
      throw new Error("Split fractions sum to zero.");
    }

    return {
      train: train / sum,
      val: val / sum,
      test: test / sum,
    };
  }

  function computeSplitCounts(total, fractions, options) {
    var opts = (options && typeof options === "object") ? options : {};
    var normalized = normalizeSplitFractions(fractions, opts.fallbackFractions || {});
    var minEach = Math.max(1, Math.floor(toFiniteNumber(opts.minEach, 1)));
    var minTotal = Math.max(minEach * 3, Math.floor(toFiniteNumber(opts.minTotal, minEach * 3)));
    var totalN = Math.floor(toFiniteNumber(total, minTotal));
    if (!Number.isFinite(totalN) || totalN < minTotal) totalN = minTotal;

    var trainN = Math.max(minEach, Math.floor(totalN * normalized.train));
    var valN = Math.max(minEach, Math.floor(totalN * normalized.val));
    var testN = Math.max(minEach, totalN - trainN - valN);

    if (trainN + valN + testN > totalN) {
      var over = trainN + valN + testN - totalN;
      if (testN - minEach >= over) {
        testN -= over;
        over = 0;
      } else {
        over -= (testN - minEach);
        testN = minEach;
      }
      if (over > 0) {
        if (valN - minEach >= over) {
          valN -= over;
          over = 0;
        } else {
          over -= (valN - minEach);
          valN = minEach;
        }
      }
      if (over > 0) {
        trainN = Math.max(minEach, trainN - over);
      }
    } else if (trainN + valN + testN < totalN) {
      testN += totalN - (trainN + valN + testN);
    }

    return {
      total: totalN,
      train: trainN,
      val: valN,
      test: testN,
      fractions: normalized,
    };
  }

  function normalizeSplitMode(rawMode, modeDefs, fallbackMode) {
    var defs = Array.isArray(modeDefs) ? modeDefs : [];
    var allowed = defs
      .map(function (d) { return String((d && d.id) || "").trim(); })
      .filter(Boolean);
    var mode = String(rawMode || "").trim();
    if (mode && allowed.indexOf(mode) >= 0) return mode;
    var fb = String(fallbackMode || "").trim();
    if (fb && (!allowed.length || allowed.indexOf(fb) >= 0)) return fb;
    if (allowed.length) return allowed[0];
    if (mode) return mode;
    throw new Error("Split mode is invalid and no fallback mode is available.");
  }

  return {
    normalizeSplitFractions: normalizeSplitFractions,
    computeSplitCounts: computeSplitCounts,
    normalizeSplitMode: normalizeSplitMode,
  };
});


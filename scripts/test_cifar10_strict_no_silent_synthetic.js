"use strict";
// Regression test for the CIFAR-10 silent-synthetic-fallback bug
// in src/dataset_modules/cifar10_source_loader.js.
//
// Pre-fix, when both real source paths (Google Cloud Storage sprite
// + GitHub batch) failed (offline, CORS, both services down),
// loadSource() silently substituted geometric synthetic patterns
// labeled with CIFAR-10 class names. Training proceeded, validation
// accuracy looked plausible, but the model never saw a single real
// CIFAR-10 image — the user's "trained CIFAR-10 classifier" was
// actually a classifier of random-color geometric shapes.
//
// Same wrong-data-as-real class as the weight-side audit (PRs #94-
// #102): a successful-looking outcome that hides the underlying
// failure. Fix: synthetic substitution requires an explicit
// opts.allowSyntheticFallback=true opt-in; otherwise throws with a
// descriptive error.

var path = require("path");
var fs = require("fs");

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

var src = fs.readFileSync(
  path.join(__dirname, "..", "src/dataset_modules/cifar10_source_loader.js"), "utf8"
);

// --- Source-level guards.
ok(/opts\.allowSyntheticFallback/.test(src),
  "loadSource recognizes opts.allowSyntheticFallback as the opt-in flag");
ok(/CIFAR-10 source unreachable/.test(src),
  "the strict-error message names 'CIFAR-10 source unreachable'");
ok(/Refusing to silently substitute synthetic/.test(src),
  "the strict-error message references the refusal to silently substitute");
ok(/no actual CIFAR-10 learning/i.test(src),
  "the strict-error message explains the consequence (training would look real but reflect no CIFAR-10 learning)");

// Negative: there should NOT be an unconditional `.catch` that
// returns buildSyntheticSource without the allowSyntheticFallback
// check. (Regression guard against re-introducing the bug.)
ok(!/}\)\.catch\(function \(err\) \{\s*\n\s*console\.warn\("\[CIFAR-10\] All sources failed[\s\S]{0,200}?buildSyntheticSource\(opts\);\s*\n\s*CACHE = source;\s*\n\s*return source;\s*\n\s*\}\);/.test(src),
  "the pre-fix unconditional synthetic substitution is gone");

// --- Behavioral: drive the loader's final-catch logic with both a
// false and true allowSyntheticFallback flag. We can't easily
// trigger the real fetch chain in Node, so simulate the final
// catch step in isolation.
function finalCatch(opts, err, buildSyntheticSourceFn) {
  if (opts.allowSyntheticFallback) {
    return { kind: "synthetic", source: buildSyntheticSourceFn(opts) };
  }
  throw new Error(
    "CIFAR-10 source unreachable: both GCS and GitHub failed (" +
    (err && err.message || "unknown") +
    "). Refusing to silently substitute synthetic geometric patterns — " +
    "training on synthetic would produce metrics that look real but reflect " +
    "no actual CIFAR-10 learning. Check your network connection or pass " +
    "opts.allowSyntheticFallback=true for explicit synthetic use (Node tests, offline development)."
  );
}

// Case 1: both sources failed + no opt-in → THROWS.
(function () {
  var threw = null;
  try {
    finalCatch({}, new Error("HTTP 404 from GitHub"), function () {
      return { variant: "cifar10", source: "synthetic" };
    });
  } catch (e) { threw = e; }
  ok(threw != null,
    "Case 1: both real sources failed + no opt-in → loadSource throws (was: silent synthetic substitution)");
  ok(threw && /CIFAR-10 source unreachable/.test(String(threw.message || "")),
    "Case 1: error names 'CIFAR-10 source unreachable'");
  ok(threw && /Refusing to silently substitute/.test(String(threw.message || "")),
    "Case 1: error references the refusal");
  ok(threw && /HTTP 404 from GitHub/.test(String(threw.message || "")),
    "Case 1: error includes the underlying network failure cause");
  ok(threw && /allowSyntheticFallback=true/.test(String(threw.message || "")),
    "Case 1: error tells the user how to opt in for legitimate synthetic use");
})();

// Case 2: both sources failed + explicit opt-in → returns synthetic.
(function () {
  var threw = null;
  var result = null;
  try {
    result = finalCatch({ allowSyntheticFallback: true }, new Error("offline"), function (opts) {
      return { variant: "cifar10", source: "synthetic", _opts: opts };
    });
  } catch (e) { threw = e; }
  ok(threw == null,
    "Case 2: opt-in opts.allowSyntheticFallback=true → no throw");
  ok(result && result.kind === "synthetic",
    "Case 2: opt-in returns synthetic source (legitimate Node/offline use)");
  ok(result && result.source && result.source.source === "synthetic",
    "Case 2: returned source has source='synthetic' (so consumers can detect it if needed)");
})();

// Case 3: source-level — the explicit opt-in branch logs a warning
// so even when synthetic is requested the user has a console trail.
ok(/falling back to synthetic patterns per opts\.allowSyntheticFallback/.test(src),
  "opt-in path logs an explicit 'per opts.allowSyntheticFallback' message (so it's never silent even when allowed)");

// Case 4: source-level — opt-in synthetic must NOT be written to
// the global CACHE. Reviewer caught this regression on the first
// PR #103 revision: `loadSource({allowSyntheticFallback:true})`
// cached synthetic globally, and a later plain `loadSource()` hit
// the cache (line 187: `if (CACHE) return Promise.resolve(CACHE);`)
// and returned the cached synthetic source — exact same silent
// fake-success the original fix was meant to prevent.
//
// Guard: the synthetic branch must NOT contain a `CACHE = source`
// assignment.
var fallbackBranchMatch = src.match(/if \(opts\.allowSyntheticFallback\)[\s\S]{0,2000}?return buildSyntheticSource\(opts\);/);
ok(fallbackBranchMatch != null, "located the opt-in synthetic branch");
if (fallbackBranchMatch) {
  ok(!/CACHE = source/.test(fallbackBranchMatch[0]) && !/CACHE = buildSyntheticSource/.test(fallbackBranchMatch[0]),
    "Case 4: opt-in synthetic branch does NOT write to global CACHE (reviewer-caught regression)");
}

// Case 5: behavioral end-to-end — drive the real loader with a
// mocked fetch that always rejects. First call WITH opt-in returns
// synthetic. Second call WITHOUT opt-in MUST throw (was: returned
// cached synthetic from the global CACHE).
(function () {
  // Reset module require cache so fresh `var CACHE = null` initializes.
  delete require.cache[require.resolve("../src/dataset_modules/cifar10_source_loader.js")];
  // Mock fetch to always reject — simulates offline.
  var rootStub = {
    fetch: function () {
      return Promise.reject(new Error("simulated offline"));
    },
  };
  // The loader exports via UMD: module.exports = factory(globalThis).
  // We can't directly inject root unless we re-instantiate; use the
  // exported factory pattern. Since the file is UMD self-contained,
  // we re-load and rely on global fetch.
  global.fetch = rootStub.fetch;
  global.Image = function () {};
  var loader = require("../src/dataset_modules/cifar10_source_loader.js");
  ok(loader && typeof loader.loadSource === "function", "loaded the CIFAR-10 source loader for end-to-end test");

  // First call: opt-in synthetic. Must resolve.
  loader.loadSource({ allowSyntheticFallback: true, totalExamples: 100, seed: 42 })
    .then(function (first) {
      ok(first && first.source === "synthetic",
        "Case 5a: opt-in call returns synthetic source (source='" + (first && first.source) + "')");
      // Second call: NO opt-in. Must throw — was: returned cached synthetic.
      return loader.loadSource({ totalExamples: 100, seed: 42 })
        .then(function (second) {
          ok(false,
            "Case 5b [REGRESSION]: plain loadSource() after opt-in synthetic returned source='" +
            (second && second.source) + "' (should have THROWN — cache poisoning regression)");
        })
        .catch(function (err) {
          ok(/CIFAR-10 source unreachable/.test(String(err.message || "")),
            "Case 5b: plain loadSource() after opt-in still throws (reviewer-caught cache poisoning is fixed)");
          ok(/Refusing to silently substitute/.test(String(err.message || "")),
            "Case 5b: thrown error still names the refusal");
        });
    })
    .then(function () {
      // Case 5c: a third call WITH opt-in still works (synthetic
      // path is rebuildable, just not cached).
      return loader.loadSource({ allowSyntheticFallback: true, totalExamples: 100, seed: 42 })
        .then(function (third) {
          ok(third && third.source === "synthetic",
            "Case 5c: subsequent opt-in calls still return synthetic (rebuildable, not stale-cached)");
        });
    })
    .then(function () {
      console.log("\n  " + passed + " passed, " + failed + " failed");
      if (failed) process.exit(1);
    })
    .catch(function (e) {
      console.log("  ✗ Case 5 setup error: " + e.message);
      process.exit(1);
    });
})();

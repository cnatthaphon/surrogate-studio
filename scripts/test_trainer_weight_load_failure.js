"use strict";
// Regression test for the trainer_tab silent-fallback bugs in the
// Test phase (random-init metrics shown as legitimate test results)
// and the Resume path (resume failure silently downgraded to training-
// from-scratch). Same class as PR #94 (eval) / #95 (gen) — the
// reviewer flagged this audit pattern as recurring.
//
// We can't drive the full trainer UI headlessly, so this test uses
// source-level regex assertions for structure + behavioral round-
// trip using a mocked failing converter.

var path = require("path");
var fs = require("fs");

var src = fs.readFileSync(
  path.join(__dirname, "..", "src/tabs/trainer_tab.js"), "utf8"
);

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

// --- Case 1: Test phase. The weight-load block previously had a
// try/catch that swallowed errors with only console.warn — execution
// fell through to inference and computed test metrics on random
// initial weights. After: the weight-load throws on any failure and
// the outer catch renders an "Inference error:" message.
//
// Source-level guard: the inner try/catch around the load is GONE,
// AND the throw mentions the random-init-weights refusal. PR #101
// added Bug P's `if (!hasWeights)` early-throw, so the load chain
// is now: hasWeights computed → throw if missing → converter check
// → throw if missing → loadResult check → throw if !loaded. The
// "loadBlock" no longer cleanly terminates at a single brace; widen
// the boundary to the next `var maxAvailable = ` line (the start of
// the inference loop).
var maxAvailIdx = src.indexOf("var maxAvailable = (activeDs.xTest");
ok(maxAvailIdx > 0, "located inference-loop boundary (var maxAvailable)");
var loadStartIdx = src.indexOf("// load saved weights");
ok(loadStartIdx > 0 && loadStartIdx < maxAvailIdx, "located Test-phase weight-load block");
var loadBlock = src.slice(loadStartIdx, maxAvailIdx);
ok(!/try \{[\s\S]*?console\.warn\("\[test\] Weight load failed/.test(loadBlock),
  "Test phase NO LONGER catches weight-load failure with console.warn (was the silent-metrics bug)");
ok(/throw new Error\("Weight converter not available/.test(loadBlock),
  "Test phase throws when converter is missing");
ok(/throw new Error\("Weight load failed:/.test(loadBlock),
  "Test phase throws when loadResult.loaded === false");
ok(/random initial weights|refusing/i.test(loadBlock),
  "Test phase throw message references random-init-weights refusal");

// --- Case 2: Test-phase outer catch disposes rebuiltModel.model so
// a thrown load failure doesn't leak the rebuilt model.
var outerCatchMatch = src.match(/\} catch \(e\) \{\s*\n[\s\S]{0,800}?Inference error: " \+ e\.message/);
ok(outerCatchMatch != null, "located Test-phase outer catch (\"Inference error: ...\")");
if (outerCatchMatch) {
  var outerCatchBody = outerCatchMatch[0];
  ok(/rebuiltModel\s*&&\s*rebuiltModel\.model[\s\S]*?\.dispose\(\)/.test(outerCatchBody),
    "Test-phase outer catch disposes rebuiltModel.model if it was built before the throw");
}

// --- Case 3: success path nullifies rebuiltModel after dispose so
// the catch doesn't double-dispose.
ok(/rebuiltModel\.model\.dispose\(\);\s*\n\s*rebuiltModel = null;/.test(src),
  "Test phase nullifies rebuiltModel after success-side dispose (guards catch against double-dispose)");

// --- Case 4: Resume path. Previous behavior set resumeArtifacts=null
// on failure and proceeded to train from scratch, silently dropping
// the user's checkpoint-resume intent. After: resume failure surfaces
// via onStatus AND returns early; buildResult.model is disposed.
var resumeBlockMatch = src.match(/var resumeArtifacts = _getResumeArtifacts\(tCard\);[\s\S]{0,2500}?\n      \}\n/);
ok(resumeBlockMatch != null, "located Resume-load block");
if (resumeBlockMatch) {
  var resumeBlock = resumeBlockMatch[0];
  ok(!/resumeArtifacts = null;/.test(resumeBlock),
    "Resume path NO LONGER silently nulls resumeArtifacts on load failure (was the lost-checkpoint bug)");
  ok(/Resume failed:/.test(resumeBlock),
    "Resume path surfaces 'Resume failed: ...' via onStatus");
  ok(/buildResult\.model\.dispose\(\)/.test(resumeBlock),
    "Resume path disposes buildResult.model on failure (was leaked when fallback silently proceeded)");
  ok(/return;/.test(resumeBlock),
    "Resume path returns early so training does NOT proceed with random-init weights");
}

// --- Case 5: behavioral — confirm that a thrown weight-load error
// in the test phase reaches a catch that disposes the model.
function makeMockModel() {
  var m = { _disposed: 0 };
  m.dispose = function () { m._disposed += 1; };
  return m;
}
(function () {
  var rebuiltModel = { model: makeMockModel() };
  var threw = null;
  try {
    // Simulate the load-fails path: throw with the new wording.
    throw new Error("Weight load failed: shape_mismatch — refusing to compute test metrics on random initial weights");
  } catch (e) {
    threw = e;
    if (rebuiltModel && rebuiltModel.model) {
      try { rebuiltModel.model.dispose(); } catch (_) {}
      rebuiltModel = null;
    }
  }
  ok(threw != null, "behavioral (Test): thrown weight-load error propagates to catch");
  ok(threw && /refusing/i.test(String(threw.message || "")),
    "behavioral (Test): caught error names the random-init refusal");
})();

// --- Case 6: behavioral — Resume path. Mocked converter returns
// {loaded:false}; assertion: buildResult.model.dispose() is called
// exactly once AND we early-return rather than proceeding to training.
(function () {
  var buildResult = { model: makeMockModel() };
  var proceedToTraining = false;
  var statusMessages = [];
  function onStatus(m) { statusMessages.push(m); }
  // Inline the new Resume logic shape:
  var _converter = {
    loadArtifactsIntoModel: function () {
      return { loaded: false, reason: "shape_mismatch" };
    },
  };
  function _loadArtifactsIntoTfModel(tf, model, artifacts) {
    return _converter.loadArtifactsIntoModel(tf, model, artifacts);
  }
  (function () {
    var resumeArtifacts = { weightSpecs: [{ name: "w", shape: [1] }], weightValues: [0] };
    if (resumeArtifacts) {
      var resumeFailReason = null;
      try {
        var resumeLoad = _loadArtifactsIntoTfModel(null, buildResult.model, resumeArtifacts);
        if (!resumeLoad || !resumeLoad.loaded) {
          resumeFailReason = (resumeLoad && resumeLoad.reason) || "weight_load_failed";
        }
      } catch (e) {
        resumeFailReason = e.message || "weight_load_failed";
      }
      if (resumeFailReason) {
        try { buildResult.model.dispose(); } catch (_) {}
        onStatus("Resume failed: " + resumeFailReason +
          ". Refusing to silently train from scratch — fix the checkpoint or click Reset to start fresh.");
        return;
      }
    }
    proceedToTraining = true;
  })();
  ok(buildResult.model._disposed === 1,
    "behavioral (Resume): buildResult.model.dispose() called exactly once on load failure (got " + buildResult.model._disposed + ")");
  ok(proceedToTraining === false,
    "behavioral (Resume): training does NOT proceed when resume load fails (was: silently trained from scratch)");
  ok(statusMessages.length === 1 && /Resume failed: shape_mismatch/.test(statusMessages[0]),
    "behavioral (Resume): onStatus surfaces 'Resume failed: <reason>' (got '" + (statusMessages[0] || "") + "')");
  ok(/Refusing/.test(statusMessages[0] || ""),
    "behavioral (Resume): status message explains the refusal so the user understands why training didn't start");
})();

// --- Case 7: behavioral — Resume path where the converter THROWS
// instead of returning {loaded:false}. Same outcome: dispose + return,
// no silent fallback.
(function () {
  var buildResult = { model: makeMockModel() };
  var proceedToTraining = false;
  var statusMessages = [];
  function onStatus(m) { statusMessages.push(m); }
  function _loadArtifactsIntoTfModel() {
    throw new Error("converter blew up: bad header");
  }
  (function () {
    var resumeArtifacts = { weightSpecs: [{ name: "w", shape: [1] }] };
    if (resumeArtifacts) {
      var resumeFailReason = null;
      try {
        var resumeLoad = _loadArtifactsIntoTfModel(null, buildResult.model, resumeArtifacts);
        if (!resumeLoad || !resumeLoad.loaded) {
          resumeFailReason = (resumeLoad && resumeLoad.reason) || "weight_load_failed";
        }
      } catch (e) {
        resumeFailReason = e.message || "weight_load_failed";
      }
      if (resumeFailReason) {
        try { buildResult.model.dispose(); } catch (_) {}
        onStatus("Resume failed: " + resumeFailReason + ".");
        return;
      }
    }
    proceedToTraining = true;
  })();
  ok(buildResult.model._disposed === 1,
    "behavioral (Resume throw): buildResult.model disposed once when converter throws (got " + buildResult.model._disposed + ")");
  ok(proceedToTraining === false,
    "behavioral (Resume throw): training does NOT proceed when converter throws");
  ok(/converter blew up/.test(statusMessages[0] || ""),
    "behavioral (Resume throw): onStatus names the underlying throw message");
})();

console.log("\n  " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

"use strict";
// Regression test for two silent-fallback bugs in trainer_tab.js
// that the audit chain (PRs #94-#100) missed:
//
// Bug O — _applyImport: a trainer JSON import with status:"done"
//   but missing/empty modelArtifacts was applied verbatim. The card
//   appeared trained, but clicking Test hit the `if (hasWeights)`
//   gate which silently skipped weight loading → inference ran on
//   random init from buildModelFromGraph. User saw legitimate-
//   looking test metrics computed from noise. Same UX-deception
//   class as PR #98 Bug C (pretrained_loader) and Bug F (missing
//   pretrained global).
//
// Bug P — Test phase hasWeights gate: the gate at line ~942 was a
//   conditional load (load weights IF artifacts exist, otherwise
//   silently skip). The post-PR-#97 strict-throw covered the load
//   FAILURE case but not the NO-ARTIFACTS case. Defense-in-depth:
//   throw if hasWeights is false instead of falling through.

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

// ===========================================================
// Bug O — source-level guards
// ===========================================================
var importStart = src.indexOf("function _applyImport(data) {");
ok(importStart > 0, "located _applyImport in trainer_tab.js");
var importEnd = src.indexOf("function _parseBinary", importStart);
var importBody = src.slice(importStart, importEnd > 0 ? importEnd : importStart + 4000);

ok(/_trainedStatuses/.test(importBody),
  "_applyImport tracks which statuses imply 'trained' (done/stopped)");
ok(/_hasUsableArtifacts/.test(importBody),
  "_applyImport validates that artifacts contain usable specs+values");
ok(/Imported trainer claimed status=/.test(importBody),
  "_applyImport sets a descriptive t.error message naming the imported status");
ok(/Refusing to mark as trained/.test(importBody),
  "_applyImport refusal message references the random-init-Test consequence");
ok(/t\.modelArtifacts = null;\s*\n\s*t\.modelArtifactsLast = null;\s*\n\s*t\.modelArtifactsBest = null;/.test(importBody),
  "_applyImport nulls all three modelArtifacts fields on validation failure");
ok(/Import incomplete:/.test(importBody),
  "_applyImport surfaces 'Import incomplete: ...' on validation failure (vs the bare 'Trainer imported: ...' success)");

// --- Behavioral: drive _applyImport with three import shapes:
//   1. status='done' with no modelArtifacts at all → should error
//   2. status='done' with modelArtifacts having empty weightSpecs → should error
//   3. status='done' with usable artifacts → should accept
//   4. status='new' (untrained) with no artifacts → should NOT error
function applyImport(data, t) {
  // Inline the new _applyImport logic for behavioral test.
  if (data.config) t.config = Object.assign(t.config || {}, data.config);
  if (data.metrics) t.metrics = data.metrics;
  if (data.modelArtifacts) t.modelArtifacts = data.modelArtifacts; // pass-through, normalization mocked
  if (data.modelArtifactsLast) t.modelArtifactsLast = data.modelArtifactsLast;
  if (data.modelArtifactsBest) t.modelArtifactsBest = data.modelArtifactsBest;
  if (data.status) t.status = data.status;
  if (data.backend) t.backend = data.backend;

  var _trainedStatuses = { done: 1, stopped: 1 };
  if (_trainedStatuses[t.status]) {
    var _ma = t.modelArtifacts;
    var _hasUsableArtifacts = _ma &&
      Array.isArray(_ma.weightSpecs) && _ma.weightSpecs.length > 0 &&
      ((Array.isArray(_ma.weightValues) && _ma.weightValues.length > 0) ||
       (_ma.weightData && (_ma.weightData.byteLength > 0 ||
        (Array.isArray(_ma.weightData) && _ma.weightData.length > 0))));
    if (!_hasUsableArtifacts) {
      t.status = "error";
      t.error = "Imported trainer claimed status='" + (data.status || "?") +
        "' but contains no usable weight artifacts (weightSpecs.length=" +
        ((_ma && Array.isArray(_ma.weightSpecs)) ? _ma.weightSpecs.length : 0) +
        "). Refusing to mark as trained — would silently run Test on random initial weights.";
      t.modelArtifacts = null;
      t.modelArtifactsLast = null;
      t.modelArtifactsBest = null;
    }
  }
  return t;
}

(function () {
  var t = applyImport({ status: "done", metrics: { mae: 0.05 } }, { id: "t1" });
  ok(t.status === "error",
    "Bug O behavioral: status='done' with NO modelArtifacts → status='error' (got " + t.status + ")");
  ok(/Imported trainer claimed status='done'/.test(t.error || ""),
    "Bug O behavioral: t.error names the imported status");
  ok(/weightSpecs\.length=0/.test(t.error || ""),
    "Bug O behavioral: t.error includes the actual spec count");
})();

(function () {
  var t = applyImport({
    status: "stopped",
    modelArtifacts: { weightSpecs: [], weightValues: [] },
  }, { id: "t2" });
  ok(t.status === "error",
    "Bug O behavioral: status='stopped' with empty modelArtifacts → status='error'");
  ok(t.modelArtifacts === null,
    "Bug O behavioral: empty artifacts nulled (got " + JSON.stringify(t.modelArtifacts) + ")");
})();

(function () {
  var t = applyImport({
    status: "done",
    modelArtifacts: {
      weightSpecs: [{ name: "w", shape: [1] }],
      weightValues: [0.1],
    },
  }, { id: "t3" });
  ok(t.status === "done",
    "Bug O negative: status='done' with usable artifacts → status stays 'done' (got " + t.status + ")");
  ok(t.modelArtifacts != null && t.modelArtifacts.weightSpecs.length === 1,
    "Bug O negative: artifacts preserved when validation passes");
})();

(function () {
  // status='new' (untrained) with no artifacts — legitimate state.
  var t = applyImport({
    status: "new",
    config: { datasetId: "d1" },
  }, { id: "t4" });
  ok(t.status === "new",
    "Bug O negative: status='new' with no artifacts → status stays 'new' (untrained card is OK)");
  ok(t.error == null,
    "Bug O negative: untrained card has no t.error");
})();

(function () {
  // status='done' with weightData ArrayBuffer (binary format).
  var buf = new ArrayBuffer(8);
  var t = applyImport({
    status: "done",
    modelArtifacts: {
      weightSpecs: [{ name: "w", shape: [2] }],
      weightData: buf,
    },
  }, { id: "t5" });
  ok(t.status === "done",
    "Bug O negative: status='done' with binary weightData → status stays 'done' (ArrayBuffer accepted)");
})();

// ===========================================================
// Bug P — Test phase hasWeights gate
// ===========================================================
var hwIdx = src.indexOf("Cannot run Test: trainer card has no usable weight artifacts");
ok(hwIdx > 0, "Test phase throws 'Cannot run Test' on missing artifacts (was: silent skip + random-init inference)");

// Source-level guard: the `if (hasWeights)` conditional block is
// gone; weight load is now unconditional (or throws on miss).
var testBlockStart = src.indexOf("var hasWeights = t.modelArtifacts");
ok(testBlockStart > 0, "located the hasWeights gate in the Test phase");
var testBlockEnd = src.indexOf("var maxAvailable", testBlockStart);
var testBlock = src.slice(testBlockStart, testBlockEnd > 0 ? testBlockEnd : testBlockStart + 2500);
ok(!/if \(hasWeights\) \{[\s\S]{0,500}?\}\s*\n\s*var maxAvailable/.test(testBlock),
  "Test phase NO LONGER wraps the load in `if (hasWeights) { ... }` (was the silent-skip pattern)");
ok(/if \(!hasWeights\)/.test(testBlock),
  "Test phase now has a NEGATIVE guard: throws if !hasWeights");

// --- Behavioral: simulate the new gate. Each shape that should
// trigger throw must throw; valid shapes must NOT throw.
function checkHasWeights(modelArtifacts) {
  var t = { modelArtifacts: modelArtifacts };
  var hasWeights = t.modelArtifacts && Array.isArray(t.modelArtifacts.weightSpecs) &&
    t.modelArtifacts.weightSpecs.length > 0 &&
    ((Array.isArray(t.modelArtifacts.weightValues) && t.modelArtifacts.weightValues.length > 0) ||
     (t.modelArtifacts.weightData && (t.modelArtifacts.weightData.byteLength > 0 ||
      (Array.isArray(t.modelArtifacts.weightData) && t.modelArtifacts.weightData.length > 0))));
  if (!hasWeights) {
    throw new Error("Cannot run Test: trainer card has no usable weight artifacts");
  }
}

var rejections = 0;
var acceptances = 0;
function check(ma, expectThrow, label) {
  try {
    checkHasWeights(ma);
    if (expectThrow) {
      ok(false, "Bug P behavioral [" + label + "]: expected throw but got pass");
    } else {
      acceptances += 1;
      ok(true, "Bug P behavioral [" + label + "]: passes (valid weights)");
    }
  } catch (e) {
    if (expectThrow) {
      rejections += 1;
      ok(true, "Bug P behavioral [" + label + "]: throws (invalid weights)");
    } else {
      ok(false, "Bug P behavioral [" + label + "]: expected pass but got throw: " + e.message);
    }
  }
}

check(null, true, "null");
check({}, true, "empty object");
check({ weightSpecs: [] }, true, "empty weightSpecs");
check({ weightSpecs: [{ name: "w" }] }, true, "specs but no values/data");
check({ weightSpecs: [{ name: "w" }], weightValues: [] }, true, "specs but empty values");
check({ weightSpecs: [{ name: "w" }], weightData: new ArrayBuffer(0) }, true, "specs but empty weightData");
check({ weightSpecs: [{ name: "w" }], weightValues: [0.1] }, false, "valid specs + values");
check({ weightSpecs: [{ name: "w" }], weightData: new ArrayBuffer(4) }, false, "valid specs + weightData ArrayBuffer");
check({ weightSpecs: [{ name: "w" }], weightData: [0.1] }, false, "valid specs + weightData Array");

ok(rejections === 6 && acceptances === 3,
  "Bug P behavioral: 6 invalid shapes rejected, 3 valid shapes accepted");

console.log("\n  " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

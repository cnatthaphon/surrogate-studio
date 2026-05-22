"use strict";
// Regression test for the weight-load-failure handling in
// evaluation_tab._loadWeights. Before this fix it logged a warn and
// continued — eval would then run against random initial weights and
// mark the result as r.status="done" with meaningless metrics. After:
// the load failure throws, which propagates to _evaluateOneModel's
// .catch() and sets r.status="error" with a clear message.
//
// We can't drive the full UI headlessly, so this test exercises the
// behavior at the _loadWeights call site via a window stub that
// returns { loaded: false } from loadArtifactsIntoModel.

var path = require("path");
var assert = require("assert");

global.window = global;
global.document = {
  createElement: function () { return { onload: null, onerror: null, style: {} }; },
  getElementsByTagName: function () { return []; },
  head: { appendChild: function () {} },
  body: { appendChild: function () {}, removeChild: function () {} },
};
global.OSCDatasetModules = { registerModule: function () {}, registerModules: function () {} };

// --- Case 1: source-level structural assertion that _loadWeights
// throws on failure (not just warn). The function body must contain
// the throw + error wording, AND must NOT be a pure-warn fallthrough.
var fs = require("fs");
var src = fs.readFileSync(
  path.join(__dirname, "..", "src/tabs/evaluation_tab.js"), "utf8"
);

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

// Extract just the _loadWeights function body.
var lwStart = src.indexOf("function _loadWeights(tf, model, artifacts) {");
ok(lwStart >= 0, "located _loadWeights in evaluation_tab.js");
// Find the matching close brace by counting depth (function has nested braces).
var depth = 0, lwEnd = -1;
for (var i = lwStart; i < src.length; i += 1) {
  if (src[i] === "{") depth += 1;
  else if (src[i] === "}") { depth -= 1; if (depth === 0) { lwEnd = i + 1; break; } }
}
var lwBody = src.slice(lwStart, lwEnd);

ok(/throw new Error\(/.test(lwBody),
  "_loadWeights throws on failure (was previously a silent warn + continue)");
ok(/Weight converter not available/.test(lwBody),
  "throw mentions converter-unavailable case explicitly");
ok(/Weight load failed/.test(lwBody),
  "throw mentions load-failed case explicitly");
ok(/random initial weights/i.test(lwBody) || /refusing/i.test(lwBody),
  "error message references the random-init-weights symptom OR refusal to report");

// --- Case 2: the throw is reachable from _runPredictiveEvaluation
// AND _runGenerativeEvaluation. Both call _loadWeights with no
// surrounding try/catch — so a throw escapes up to _evaluateOneModel's
// .catch(), which sets r.status="error".
function findCallsiteContext(label, startMarker) {
  var s = src.indexOf(startMarker);
  if (s < 0) { failed += 1; console.log("  ✗ " + label + ": call site marker not found"); return; }
  // Look at the next ~50 lines for a try/catch wrapping _loadWeights.
  var window2 = src.slice(s, s + 15000);
  var lwCall = window2.indexOf("_loadWeights(tf, ");
  if (lwCall < 0) { failed += 1; console.log("  ✗ " + label + ": _loadWeights not called in this scope"); return; }
  // Confirm no `try { _loadWeights(...) } catch` wrapping — look for
  // a `try {` within 200 chars before AND its matching catch within
  // 200 chars after. If neither exists, the throw escapes.
  var preWindow = window2.slice(Math.max(0, lwCall - 200), lwCall);
  ok(!/try\s*\{[^}]*$/.test(preWindow),
    label + ": _loadWeights is NOT wrapped in a local try/catch (throw escapes to outer .catch)");
}
findCallsiteContext("predictive eval", "function _runPredictiveEvaluation");
findCallsiteContext("generative eval", "function _runGenerativeEvaluation");

// --- Case 3: the outer _evaluateOneModel routes any .catch via
// r.status = "error". This is the mechanism that converts the throw
// into a visible error row.
var outerCatch = /\.catch\(function \(err\) \{\s*r\.status = "error"/.test(src);
ok(outerCatch,
  "_evaluateOneModel's .catch() sets r.status='error' (so the thrown weight-load error surfaces correctly)");

// --- Case 4: behavioral round-trip. Drive _loadWeights with a
// mocked converter that returns { loaded:false }; assert it throws
// with the expected message. This guards against future refactors
// that might re-add a silent fallthrough.
global.OSCWeightConverter = {
  loadArtifactsIntoModel: function () {
    return { loaded: false, reason: "shape_mismatch" };
  },
};

// Synthesize a minimal _loadWeights call via vm.runInThisContext so
// we can invoke the inner function. Easier: extract the function
// body and eval it.
var thrown = null;
try {
  // Reconstruct the function in our scope so it sees global.window.
  var fn = new Function("tf", "model", "artifacts",
    lwBody.replace(/^function _loadWeights\(tf, model, artifacts\) \{/, "").replace(/\}$/, ""));
  fn({}, {}, { weightSpecs: [{ name: "w", shape: [1] }], weightData: new Float32Array([0]).buffer });
} catch (e) {
  thrown = e;
}
ok(thrown != null, "_loadWeights throws when mocked converter returns { loaded:false }");
ok(thrown && /Weight load failed/.test(String(thrown.message || "")),
  "thrown error names 'Weight load failed'");
ok(thrown && /shape_mismatch/.test(String(thrown.message || "")),
  "thrown error names the underlying reason ('shape_mismatch')");

console.log("\n  " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

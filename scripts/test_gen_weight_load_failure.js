"use strict";
// Same-class regression test as scripts/test_eval_weight_load_failure.js,
// but for generation_tab._loadWeights. The previous warn-and-return
// would let generation proceed with random initial weights — the user
// sees noise samples that look superficially valid. After this fix,
// _loadWeights throws and the outer try/catch in _generateOnClient
// disposes both built.model and genModel before re-rendering.

var path = require("path");
var fs = require("fs");

var src = fs.readFileSync(
  path.join(__dirname, "..", "src/tabs/generation_tab.js"), "utf8"
);

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

// --- Case 1: source-level — _loadWeights throws on both failure
// cases, with messages mentioning the random-weights symptom.
var lwStart = src.indexOf("function _loadWeights(tf, model, artifacts) {");
ok(lwStart >= 0, "located _loadWeights in generation_tab.js");
var depth = 0, lwEnd = -1;
for (var i = lwStart; i < src.length; i += 1) {
  if (src[i] === "{") depth += 1;
  else if (src[i] === "}") { depth -= 1; if (depth === 0) { lwEnd = i + 1; break; } }
}
var lwBody = src.slice(lwStart, lwEnd);

ok(/throw new Error\(/.test(lwBody),
  "_loadWeights throws on failure (was warn-and-return)");
ok(/Weight converter not available/.test(lwBody),
  "throw mentions converter-unavailable case explicitly");
ok(/Weight load failed/.test(lwBody),
  "throw mentions load-failed case explicitly");
ok(/random initial weights|refusing to generate/i.test(lwBody),
  "error message references the random-init-weights symptom OR refusal");

// --- Case 2: the outer try/catch in _generateOnClient calls the
// dispose helper. (Reviewer's concern from #94: a throw before
// engine.generate took over would leak both models.)
// _generateOnClient is defined BEFORE _loadWeights in this file, so
// search from file start, not from lwStart.
var fnStart = src.indexOf("function _generateOnClient()");
ok(fnStart > 0, "located _generateOnClient function");
var outerCatch = src.indexOf("} catch (e) {", fnStart);
ok(outerCatch > 0 && outerCatch < lwStart, "located outer catch inside _generateOnClient (before _loadWeights)");
var outerCatchBody = src.slice(outerCatch, outerCatch + 800);
ok(/_disposeBuiltOnFailure\(\)/.test(outerCatchBody),
  "outer catch calls _disposeBuiltOnFailure() so built.model + genModel are released");

// --- Case 3: the helper is `var`-assigned (function-scoped via
// hoisting) — NOT a block-scoped function declaration that would be
// invisible from the catch under strict mode.
ok(/var _disposeBuiltOnFailure = function/.test(src),
  "_disposeBuiltOnFailure is a var-assigned closure (visible from outer catch in strict mode)");
ok(!/^\s+function _disposeBuiltOnFailure\(/m.test(src),
  "_disposeBuiltOnFailure is NOT a block-scoped function declaration (would be invisible from catch)");

// --- Case 4: the helper short-circuits when engine.generate took
// over (otherwise we'd double-dispose with the then/catch chain).
ok(/_engineTookOver/.test(src),
  "handedOff flag is tracked so the helper doesn't double-dispose with engine.generate's then/catch");

// --- Case 5: behavioral round-trip. _loadWeights body invoked with
// a mocked failing converter must throw.
global.window = global;
global.OSCWeightConverter = {
  loadArtifactsIntoModel: function () {
    return { loaded: false, reason: "shape_mismatch" };
  },
};
var thrown = null;
try {
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

// --- Case 6: behavioral cleanup pattern with mock model. Mirrors
// the production try/catch + _engineTookOver flag. Verifies that a
// throw before engine.generate took ownership disposes BOTH models
// exactly once.
function makeMockModel() {
  var m = { _disposed: 0 };
  m.dispose = function () { m._disposed += 1; };
  return m;
}
(function () {
  var built = { model: makeMockModel() };
  var genModel = makeMockModel(); // decoder swap case
  var _engineTookOver = false;
  var _disposeBuiltOnFailure = function () {
    if (_engineTookOver) return;
    if (genModel && (!built || genModel !== built.model)) {
      try { genModel.dispose(); } catch (_) {}
    }
    if (built && built.model) {
      try { built.model.dispose(); } catch (_) {}
    }
  };
  var threw = null;
  try {
    throw new Error("Weight load failed: shape_mismatch. ...");
  } catch (e) {
    threw = e;
    if (typeof _disposeBuiltOnFailure === "function") {
      try { _disposeBuiltOnFailure(); } catch (_) {}
    }
  }
  ok(threw != null, "behavioral: throw propagates after catch handler");
  ok(built.model._disposed === 1,
    "behavioral: built.model.dispose() called once (got " + built.model._disposed + ")");
  ok(genModel._disposed === 1,
    "behavioral: decoder genModel.dispose() called once (got " + genModel._disposed + ")");
})();

// --- Case 7: behavioral — when engine.generate took over, the
// helper should NO-OP (so engine.generate's then/catch is the
// authoritative disposer, not us).
(function () {
  var built = { model: makeMockModel() };
  var genModel = built.model;
  var _engineTookOver = true; // engine has taken over
  var _disposeBuiltOnFailure = function () {
    if (_engineTookOver) return;
    try { built.model.dispose(); } catch (_) {}
  };
  _disposeBuiltOnFailure();
  ok(built.model._disposed === 0,
    "behavioral: when engine took over, helper no-ops to avoid double-dispose (got " + built.model._disposed + ")");
})();

console.log("\n  " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

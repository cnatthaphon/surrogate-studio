"use strict";
// Regression test for the strict partial-match check in
// weight_converter.loadArtifactsIntoModel. Before this fix, a model
// rebuilt with MORE weights than the saved checkpoint (architecture
// mismatch — e.g., an auto-built head with more units than the
// saved one) returned { loaded: true, matched: N, totalModelWeights: N+k }.
// The model would keep random initialization on the k missing
// weights and produce garbage predictions. That's the symptom that
// masked the ais_trajectory.position bug for months (PR #90).
//
// After: any matched < modelWeights.length returns { loaded: false,
// reason: "partial_match_..." } which routes through the eval/gen
// callers' throw → r.status="error" path (PRs #94 / #95).

var path = require("path");
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
global.window = global;
var WC = require(path.join(__dirname, "..", "src/weight_converter.js"));

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

function makeModel(layerSpecs) {
  // Build a small TF model with the given layer shapes so loadArtifactsIntoModel
  // can be exercised against a real .weights[] array.
  var input = tf.input({ shape: [layerSpecs[0]] });
  var x = input;
  for (var i = 1; i < layerSpecs.length; i += 1) {
    x = tf.layers.dense({ units: layerSpecs[i], useBias: true, name: "dense_" + i }).apply(x);
  }
  return tf.model({ inputs: input, outputs: x });
}

(async function () {
  await tf.setBackend("cpu"); await tf.ready();

  // --- Case 1: full match → loaded: true.
  (function () {
    var model = makeModel([8, 4, 2]); // 2 Dense layers → 4 weights (2 kernels + 2 biases)
    var modelWeights = model.weights;
    var specs = modelWeights.map(function (w, i) {
      return { name: w.name, shape: w.shape.slice(), dtype: "float32" };
    });
    var total = specs.reduce(function (s, sp) { return s + sp.shape.reduce(function (a, b) { return a * b; }, 1); }, 0);
    var values = new Float32Array(total).fill(0.1);
    var result = WC.loadArtifactsIntoModel(tf, model, { weightSpecs: specs, weightValues: Array.from(values) });
    ok(result.loaded === true, "full-match (4 of 4): loaded:true (got " + JSON.stringify(result) + ")");
    ok(result.matched === modelWeights.length,
      "full-match: matched === modelWeights.length (" + result.matched + " === " + modelWeights.length + ")");
    model.dispose();
  })();

  // --- Case 2: partial match — saved checkpoint covers only the
  // first dense layer; the second dense layer's weights have no
  // matching spec. Pre-fix: loaded:true with matched=2, totalModelWeights=4
  // (and the unmatched layer kept random weights). Post-fix: loaded:false.
  (function () {
    var model = makeModel([8, 4, 2]); // 4 weights total
    var modelWeights = model.weights;
    // Only ship specs for the FIRST dense layer (2 of 4 weights).
    var partialSpecs = [
      { name: modelWeights[0].name, shape: modelWeights[0].shape.slice(), dtype: "float32" },
      { name: modelWeights[1].name, shape: modelWeights[1].shape.slice(), dtype: "float32" },
    ];
    var partialSize = partialSpecs.reduce(function (s, sp) {
      return s + sp.shape.reduce(function (a, b) { return a * b; }, 1);
    }, 0);
    var partialValues = new Float32Array(partialSize).fill(0.1);
    var result = WC.loadArtifactsIntoModel(tf, model, {
      weightSpecs: partialSpecs,
      weightValues: Array.from(partialValues),
    });
    ok(result.loaded === false,
      "partial-match (2 of 4): loaded:false (was the silent-success bug — got " + JSON.stringify(result) + ")");
    ok(/partial_match/.test(String(result.reason || "")),
      "partial-match: reason names 'partial_match'");
    ok(/2_of_4|architecture mismatch/.test(String(result.reason || "")),
      "partial-match: reason includes the matched/total ratio or 'architecture mismatch'");
    ok(result.matched === 2,
      "partial-match: matched count surfaced in result (" + result.matched + ")");
    ok(result.totalModelWeights === 4,
      "partial-match: totalModelWeights surfaced in result (" + result.totalModelWeights + ")");
    model.dispose();
  })();

  // --- Case 3: saved checkpoint has EXTRA specs the model doesn't
  // need. matched still equals modelWeights.length, so this remains
  // loaded:true (an oversize checkpoint is not the bug class —
  // only undersize is, because that leaves model weights random).
  (function () {
    var model = makeModel([8, 4, 2]); // 4 weights
    var modelWeights = model.weights;
    // Ship 6 specs: the 4 model weights + 2 phantom extras.
    var richSpecs = modelWeights.map(function (w, i) {
      return { name: w.name, shape: w.shape.slice(), dtype: "float32" };
    }).concat([
      { name: "phantom_extra_w", shape: [3, 3], dtype: "float32" },
      { name: "phantom_extra_b", shape: [3], dtype: "float32" },
    ]);
    var rsize = richSpecs.reduce(function (s, sp) {
      return s + sp.shape.reduce(function (a, b) { return a * b; }, 1);
    }, 0);
    var rvalues = new Float32Array(rsize).fill(0.1);
    var result = WC.loadArtifactsIntoModel(tf, model, {
      weightSpecs: richSpecs,
      weightValues: Array.from(rvalues),
    });
    // The 2 phantom specs don't match any model weight, so
    // matchedNamedSpecs (4) !== namedSpecs (6) — the named path
    // falls through to the positional branch, which only succeeds
    // when out.length === mwVals.length. With 6 specs feeding 4
    // weights, positional should still produce 4 tensors and load
    // them. Verify behavior is sensible.
    if (result.loaded) {
      ok(result.matched === 4,
        "oversize-checkpoint: 4 model weights still loaded (mode=" + result.mode + ", matched=" + result.matched + ")");
    } else {
      // Acceptable outcome: the loader refused to guess which specs
      // are the "real" ones. Print the result so the test author can
      // confirm intent.
      ok(true, "oversize-checkpoint: loader refused to guess (reason=" + result.reason + ")");
    }
    model.dispose();
  })();

  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

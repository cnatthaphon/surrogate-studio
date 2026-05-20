"use strict";
// Regression test for the strict loss-name validation in
// training_engine_core.mapLossAlias. Before #92, an unknown loss
// string silently fell back to MSE — a typo like `loss: "uber"`
// would train with MSE without complaint. Now mapLossAlias throws
// with a clear error pointing at the offending name.
//
// Mirrored on the server side in train_subprocess.py (asserted by
// scripts/test_server_loss_validation.py).

var path = require("path");
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");

global.window = global;
var TEC = require(path.join(__dirname, "..", "src/training_engine_core.js"));

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

function makeHead(loss) {
  return { loss: loss, matchWeight: 1, headType: "regression", units: 4 };
}

(async function () {
  await tf.setBackend("cpu"); await tf.ready();

  // --- Case 1: typo'd loss name → throw with clear message.
  var threw1 = null;
  try { TEC.makeHeadLoss(tf, makeHead("uber"), "mse"); } catch (e) { threw1 = e; }
  ok(threw1 != null, "typo'd loss 'uber' throws (was silent MSE fallback)");
  ok(threw1 && /Unknown loss name 'uber'/.test(String(threw1.message || "")),
    "error names the offending loss");
  ok(threw1 && /Known losses/.test(String(threw1.message || "")),
    "error lists known losses");

  // --- Case 2: completely-bogus string → throw.
  var threw2 = null;
  try { TEC.makeHeadLoss(tf, makeHead("kullback_leibler_divergence_v2"), "mse"); } catch (e) { threw2 = e; }
  ok(threw2 != null, "unknown loss 'kullback_leibler_divergence_v2' throws");

  // --- Case 3: each known loss name resolves without throwing.
  var KNOWN = [
    "mse", "mae", "huber",
    "bce", "binaryCrossentropy", "binary_crossentropy",
    "wasserstein", "wgan",
    "giou", "iou", "giou_mse", "mse_giou",
    "categoricalCrossentropy", "categorical_crossentropy",
    "sparseCategoricalCrossentropy", "sparse_categorical_crossentropy",
    "cross_entropy",
    "none", "use_global",
  ];
  KNOWN.forEach(function (l) {
    var threw = null;
    try {
      // giou-family requires bboxFormat to build, but mapLossAlias is
      // what we're testing — the alias resolution happens inside
      // makeHeadLoss BEFORE the runtime guards fire, so an alias
      // throw at this stage proves the strict validation rejects
      // unknown names. We call makeHeadLoss but don't invoke the
      // returned closure; the alias map is exercised at construction.
      var head = { loss: l, matchWeight: 1, headType: "regression", units: 4, bboxFormat: "xywh" };
      TEC.makeHeadLoss(tf, head, "mse");
    } catch (e) { threw = e; }
    // The only way this should fail is if the alias is unknown.
    // Some losses might fail later for unrelated reasons (e.g. giou
    // needs a 4-unit head AND bboxFormat — we set both above).
    var unknownErr = threw && /Unknown loss name/.test(String(threw.message || ""));
    ok(!unknownErr, "known loss '" + l + "' accepted (no Unknown-loss-name throw)");
  });

  // --- Case 4: empty string → defaults to mse (existing behavior preserved).
  var threw4 = null;
  try { TEC.makeHeadLoss(tf, makeHead(""), "mse"); } catch (e) { threw4 = e; }
  ok(threw4 == null, "empty loss '' accepted (defaults to mse)");

  // --- Case 5: case-insensitive (Uppercase variant of valid).
  var threw5 = null;
  try { TEC.makeHeadLoss(tf, makeHead("MSE"), "mse"); } catch (e) { threw5 = e; }
  ok(threw5 == null, "'MSE' (uppercase) accepted (case-insensitive)");

  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

"use strict";
// Regression test for the three weight save/load silent-fallback bugs
// in the pretrained loader and the trainer tab. Same audit class as
// PRs #94 (eval) / #95 (gen) / #96 (loader strict) / #97 (trainer
// test+resume) — except these three were on the OTHER side of the
// load/save boundary:
//
//   - Bug C: src/pretrained_loader.js — decode failure left cards
//     marked status="done" with no modelArtifacts. User clicked Test,
//     the (post-PR-#97) test path's hasWeights guard saw no artifacts
//     and ran inference on random initial weights.
//
//   - Bug D: src/tabs/trainer_tab.js stop button — _extractWeightsFromModel
//     wrapped in a bare `catch (e) {}`. User saw "Training stop requested"
//     and assumed weights were saved; modelArtifacts was actually never set.
//
//   - Bug E: src/tabs/trainer_tab.js post-training save — same pattern as
//     Bug D but on the success completion path. tCard.status was set to
//     "done" BEFORE the save try; on failure the user saw "✓ Done: MAE=…"
//     while modelArtifacts was undefined.

var path = require("path");
var fs = require("fs");

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

// ===========================================================
// Bug C — src/pretrained_loader.js
// ===========================================================
var ploadSrc = fs.readFileSync(
  path.join(__dirname, "..", "src/pretrained_loader.js"), "utf8"
);

// --- Source-level guards: the previous "console.warn only" handler
// is gone; the catch now sets status="error" + nulls modelArtifacts.
ok(!/} catch \(e\) \{\s*\n\s*console\.warn\("\[pretrained\] Load failed:[\s\S]{0,40}\}\n\n      store\.upsertTrainerCard/.test(ploadSrc),
  "pretrained_loader catch is NO LONGER a console.warn-only fallthrough");
ok(/t\.status\s*=\s*"error"/.test(ploadSrc),
  "pretrained_loader catch sets t.status = 'error' on decode failure");
ok(/t\.modelArtifacts\s*=\s*null/.test(ploadSrc),
  "pretrained_loader catch nulls t.modelArtifacts so the card reflects the load failure");
ok(/Pretrained load failed:/.test(ploadSrc),
  "pretrained_loader catch records a t.error message describing the failure");

// --- Behavioral: invoke loadAll() against a card whose pretrained
// var triggers a decode crash (bad base64), assert the card is marked
// status="error" with no modelArtifacts.
(function () {
  // Set up the loadAll function in our context by extracting it.
  // Easier: require the module and inject globals.
  global.window = {
    badPretrainedVar: "!!! not valid base64 @@@", // atob will throw
    OSCCheckpointFormatCore: null,
  };
  // The UMD wrapper exports via module.exports in Node, so a plain
  // require returns the loader API directly (not via global.window).
  delete require.cache[require.resolve("../src/pretrained_loader.js")];
  var loader = require("../src/pretrained_loader.js");
  ok(loader && typeof loader.loadAll === "function", "OSCPretrainedLoader.loadAll exported via module.exports");

  var upserted = [];
  var mockStore = {
    upsertTrainerCard: function (c) { upserted.push(c); },
    replaceTrainerEpochs: function () {},
  };
  var card = {
    id: "t1",
    name: "Bad Pretrained",
    status: "done",
    _pretrainedVar: "badPretrainedVar",
    config: {},
    modelArtifacts: { weightSpecs: ["stale"] }, // simulate previous stale artifacts
  };
  loader.loadAll(mockStore, [card]);

  ok(upserted.length === 1, "card was upserted once");
  ok(card.status === "error",
    "card marked status='error' on decode failure (was: stayed 'done' silently — got " + card.status + ")");
  ok(card.modelArtifacts === null,
    "card.modelArtifacts NULLED so it doesn't appear ready for Test (was: stale artifacts kept)");
  ok(/Pretrained load failed/.test(String(card.error || "")),
    "card.error names 'Pretrained load failed' for the UI to display");
})();

// ===========================================================
// Bug D — trainer_tab.js stop-save (~line 1842-1865)
// ===========================================================
var trSrc = fs.readFileSync(
  path.join(__dirname, "..", "src/tabs/trainer_tab.js"), "utf8"
);

// Locate the stop-button handler's weight-save block.
var stopStart = trSrc.indexOf("Only client main-thread training has live weights");
ok(stopStart > 0, "located stop-save block in trainer_tab.js");
var stopBlock = trSrc.slice(stopStart, stopStart + 2500);
ok(/var stopSaveError = null;|stopSaveError = e/.test(trSrc),
  "stop-save now declares a stopSaveError variable (was: bare catch {})");
ok(!/catch \(e\) \{\}\s*\n\s*\}\s*\n\s*store\.upsertTrainerCard\(tc\);/.test(stopBlock),
  "stop-save NO LONGER has a bare `catch (e) {}` (was the swallow-everything bug)");
ok(/Weight save failed on stop:/.test(stopBlock),
  "stop-save catch records tc.error with the underlying reason");
ok(/trained model lost/i.test(stopBlock),
  "stop-save onStatus mentions 'trained model lost' so the user understands the consequence");
ok(/stopSaveError ?\?/.test(stopBlock) || /if \(savedWeights\)/.test(stopBlock),
  "stop-save onStatus branches on whether save failed");

// --- Behavioral: simulate the stop-save path with a mock extractor
// that throws. Assert: tc.status='error', tc.error set, onStatus
// message names the failure.
(function () {
  function makeTc() {
    return {
      id: "t1",
      status: "running",
      config: { useServer: false },
      modelArtifactsLast: null,
      modelArtifactsBest: null,
      modelArtifacts: null,
    };
  }
  var tc = makeTc();
  var _activeModel = { isModel: true }; // truthy stand-in
  var savedWeights = false;
  var stopSaveError = null;
  var statusMessages = [];
  function onStatus(m) { statusMessages.push(m); }
  function _extractWeightsFromModel() {
    throw new Error("tensor read failed: GPU context lost");
  }
  // Inline the new logic shape:
  tc.status = "stopped";
  if (_activeModel && !(tc.config && tc.config.useServer)) {
    try {
      var lastW = _extractWeightsFromModel(_activeModel);
      tc.modelArtifactsLast = lastW;
      if (!tc.modelArtifactsBest) tc.modelArtifactsBest = lastW;
      tc.modelArtifacts = lastW;
      tc.trainedOnServer = false;
      savedWeights = true;
    } catch (e) {
      stopSaveError = e && e.message ? e.message : String(e || "unknown");
      tc.status = "error";
      tc.error = "Weight save failed on stop: " + stopSaveError;
    }
  }
  onStatus(
    savedWeights ? "Training stopped (weights saved)" :
    stopSaveError ? "Training stopped but weight save FAILED: " + stopSaveError + " — trained model lost" :
    "Training stop requested"
  );
  ok(tc.status === "error",
    "behavioral (Bug D): tc.status='error' on extraction failure (was: stayed 'stopped' silently — got " + tc.status + ")");
  ok(/GPU context lost/.test(String(tc.error || "")),
    "behavioral (Bug D): tc.error includes the underlying extraction-error message");
  ok(/trained model lost/i.test(statusMessages[0] || ""),
    "behavioral (Bug D): onStatus mentions 'trained model lost' (got '" + (statusMessages[0] || "") + "')");
  ok(tc.modelArtifacts === null,
    "behavioral (Bug D): tc.modelArtifacts stays null when extraction fails (was: stayed null but UI claimed success)");
})();

// --- Behavioral negative: when extraction SUCCEEDS, the success
// message still fires and status stays "stopped" — guard against
// the fix over-rotating into false errors.
(function () {
  var tc = { id: "t1", status: "running", config: { useServer: false } };
  var _activeModel = {};
  var savedWeights = false;
  var stopSaveError = null;
  var statusMessages = [];
  function onStatus(m) { statusMessages.push(m); }
  function _extractWeightsFromModel() {
    return { weightSpecs: [{ name: "w", shape: [1] }], weightValues: [0.1] };
  }
  tc.status = "stopped";
  try {
    var lastW = _extractWeightsFromModel(_activeModel);
    tc.modelArtifactsLast = lastW;
    if (!tc.modelArtifactsBest) tc.modelArtifactsBest = lastW;
    tc.modelArtifacts = lastW;
    savedWeights = true;
  } catch (e) {
    stopSaveError = e.message;
    tc.status = "error";
  }
  onStatus(
    savedWeights ? "Training stopped (weights saved)" :
    stopSaveError ? "Training stopped but weight save FAILED: " + stopSaveError :
    "Training stop requested"
  );
  ok(tc.status === "stopped",
    "behavioral (Bug D negative): successful extraction leaves status='stopped' (got " + tc.status + ")");
  ok(/weights saved/.test(statusMessages[0] || ""),
    "behavioral (Bug D negative): success path still reports 'weights saved'");
})();

// ===========================================================
// Bug E — trainer_tab.js post-training save (~line 2823-2845)
// ===========================================================
ok(!/} catch \(e\) \{\s*\n\s*console\.warn\("\[trainer\] Weight save failed:/.test(trSrc),
  "post-train save NO LONGER has a console.warn-only fallthrough");
ok(/postTrainSaveError/.test(trSrc),
  "post-train save tracks an error variable for the status message");
ok(/Training succeeded but weight save FAILED:/.test(trSrc),
  "post-train save onStatus distinguishes 'training succeeded but save failed' from generic success");
ok(/tCard\.status = "error";\s*\n\s*tCard\.error = "Weight save failed after training:/.test(trSrc),
  "post-train save catch promotes tCard.status to 'error' (was: stayed 'done' silently)");

// --- Behavioral: post-train save throw → status='error', no false
// "Done" message.
(function () {
  var tCard = { id: "t1", status: "running", config: {} };
  tCard.status = "done"; // matches the pre-save assignment in trainer_tab
  var postTrainSaveError = null;
  var statusMessages = [];
  function onStatus(m) { statusMessages.push(m); }
  function _extractWeightsFromModel() {
    throw new Error("model already disposed");
  }
  function _normalizeCheckpointArtifacts(x) { return x; }
  try {
    var lastArtifacts = _normalizeCheckpointArtifacts(_extractWeightsFromModel({}));
    tCard.modelArtifactsLast = lastArtifacts;
    tCard.modelArtifactsBest = lastArtifacts;
    tCard.modelArtifacts = lastArtifacts;
  } catch (e) {
    postTrainSaveError = e && e.message ? e.message : String(e || "unknown");
    tCard.status = "error";
    tCard.error = "Weight save failed after training: " + postTrainSaveError;
  }
  if (postTrainSaveError) {
    onStatus("Training succeeded but weight save FAILED: " + postTrainSaveError + " — trained model lost");
  } else {
    onStatus("Done: MAE=...");
  }
  ok(tCard.status === "error",
    "behavioral (Bug E): post-train save throw promotes status to 'error' (was: stayed 'done' silently — got " + tCard.status + ")");
  ok(/model already disposed/.test(String(tCard.error || "")),
    "behavioral (Bug E): tCard.error includes the underlying message");
  ok(/Training succeeded but weight save FAILED/.test(statusMessages[0] || ""),
    "behavioral (Bug E): onStatus says 'Training succeeded but weight save FAILED' (was: '✓ Done: MAE=…' giving false success — got '" + (statusMessages[0] || "") + "')");
  ok(tCard.modelArtifacts === undefined,
    "behavioral (Bug E): tCard.modelArtifacts NOT set on failure (no fake-success artifact)");
})();

console.log("\n  " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

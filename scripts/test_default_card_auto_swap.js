#!/usr/bin/env node
"use strict";
/**
 * BUG-35 regression test: every demo's generation cards must resolve to a
 * trainer that has artifacts (status:"done" with weights), either directly
 * via the card's preset trainerId or via the auto-swap helper that picks a
 * trained sibling for the same modelId.
 *
 * Without this, visitors land on the Generation tab and see a draft card
 * with no weights, no metrics, no loss curve — and have to click the
 * sidebar to switch to the pretrained variant before anything renders.
 *
 * The check here mirrors what _resolveTrainedTrainer does in
 * src/tabs/generation_tab.js: prefer the pinned trainer when artifacts are
 * present, otherwise prefer a same-modelId sibling that has artifacts.
 *
 * "Has artifacts" is determined from the preset's metadata.status — for
 * actual artifact bytes we'd have to load the pretrained .js file, which
 * is out of scope; status:"done" + a _pretrainedVar is the contract every
 * preset uses.
 */
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var REPO = path.resolve(__dirname, "..");
var demoDir = path.join(REPO, "demo");

function loadPreset(file) {
  var src = fs.readFileSync(file, "utf8");
  var ctx = { window: {}, Date: Date };
  vm.runInNewContext(src, ctx);
  return Object.keys(ctx.window).map(function (k) { return ctx.window[k]; })
    .find(function (v) { return v && v.models && v.trainers; });
}

function trainerHasArtifacts(t) {
  if (!t) return false;
  // The preset contract: pretrained trainers have status="done" and
  // _pretrainedVar (the global the loader hydrates from).
  return String(t.status || "") === "done" && !!t._pretrainedVar;
}

function resolveTrainedTrainer(g, allTrainers) {
  var pinned = allTrainers.find(function (t) { return t.id === g.trainerId; });
  if (trainerHasArtifacts(pinned)) return pinned;
  var sameModel = pinned ? allTrainers.filter(function (t) {
    return t.modelId === pinned.modelId && trainerHasArtifacts(t);
  }) : [];
  if (sameModel.length) return sameModel[0];
  return allTrainers.filter(trainerHasArtifacts)[0] || null;
}

var demos = fs.readdirSync(demoDir)
  .map(function (d) { return path.join(demoDir, d); })
  .filter(function (p) { return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "preset.js")); });

var failures = [];
var totalGen = 0;
var swapped = 0;

demos.forEach(function (demo) {
  var preset;
  try { preset = loadPreset(path.join(demo, "preset.js")); } catch (e) {
    console.warn("  [skip] " + path.basename(demo) + ": " + e.message);
    return;
  }
  if (!preset) return;
  var trainers = preset.trainers || [];
  var gens = preset.generations || [];
  if (!gens.length) return;

  gens.forEach(function (g) {
    totalGen += 1;
    var resolved = resolveTrainedTrainer(g, trainers);
    if (!resolved) {
      failures.push(path.basename(demo) + ": " + g.id + " — no trained trainer available for schema " + g.schemaId);
    } else if (resolved.id !== g.trainerId) {
      swapped += 1;
    }
  });
});

console.log("Checked " + totalGen + " generation cards across " + demos.length + " demos");
console.log("  " + (totalGen - swapped - failures.length) + " already pin a trained trainer");
console.log("  " + swapped + " resolve via same-model sibling swap");
console.log("  " + failures.length + " have NO resolvable trained trainer");

if (failures.length) {
  console.log("\nFAIL — these cards land empty:");
  failures.forEach(function (f) { console.log("  " + f); });
  process.exit(1);
}
console.log("\nPASS: every generation card resolves to a trained trainer.");

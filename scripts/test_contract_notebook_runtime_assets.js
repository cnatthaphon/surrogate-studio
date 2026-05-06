#!/usr/bin/env node
"use strict";
/**
 * Contract test: src/notebook_runtime_assets.js must embed the EXACT
 * current contents of the canonical Python source files.
 *
 * The notebook export path (src/notebook_bundle_core.js, the trainer
 * tab, and the Pyodide/JupyterLite kernel) ships these embedded
 * copies alongside the generated .ipynb. If the embed drifts from
 * the source, fixes to server/checkpoint_format.py or
 * server/runtime_weight_loader.py never reach notebook-trained
 * weights — that's exactly what bit BUG-39 follow-up: server paths
 * were fixed, embedded notebook copies still had the old
 * [i,f,g,o] → [i,g,f,o] swap.
 *
 * To regenerate after editing any embedded source:
 *   node scripts/build_notebook_runtime_assets.js
 *
 * This test fails CI if you forget.
 */
var fs = require("fs");
var path = require("path");

var REPO = path.resolve(__dirname, "..");

// Mirror SOURCES in scripts/build_notebook_runtime_assets.js
var SOURCES = [
  ["oscillator_surrogate_pipeline.py", "oscillator_surrogate_pipeline.py"],
  ["checkpoint_format.py",             "server/checkpoint_format.py"],
  ["runtime_weight_loader.py",         "server/runtime_weight_loader.py"],
  ["dataset_source_loader.py",         "server/dataset_source_loader.py"],
  ["train_subprocess.py",              "server/train_subprocess.py"],
];

// The assets module is an IIFE that resolves its global as
// `typeof window !== "undefined" ? window : globalThis`. Inside Node
// without a window shim it lands on the real globalThis, so just
// require it and read the registration off the global.
require(path.join(REPO, "src/notebook_runtime_assets.js"));
var assets = global.OSCNotebookRuntimeAssets;
if (!assets) {
  console.error("FAIL: src/notebook_runtime_assets.js did not register OSCNotebookRuntimeAssets");
  process.exit(1);
}

var failures = [];

// 1. Every embedded entry must match the source byte-for-byte.
SOURCES.forEach(function (pair) {
  var key = pair[0];
  var srcPath = path.join(REPO, pair[1]);
  if (!fs.existsSync(srcPath)) {
    failures.push("missing source: " + pair[1]);
    return;
  }
  var srcContent = fs.readFileSync(srcPath, "utf8");
  var embedded = assets.get(key);
  if (embedded === null) {
    failures.push("not embedded: " + key);
    return;
  }
  if (embedded !== srcContent) {
    // Find first divergence so the failure message is actionable.
    var minLen = Math.min(embedded.length, srcContent.length);
    var diffAt = -1;
    for (var i = 0; i < minLen; i++) {
      if (embedded[i] !== srcContent[i]) { diffAt = i; break; }
    }
    if (diffAt < 0) diffAt = minLen;
    var lineNo = srcContent.slice(0, diffAt).split("\n").length;
    failures.push(
      key + " drifted from " + pair[1] +
      " (embedded=" + embedded.length + " chars, source=" + srcContent.length +
      " chars, first diff at byte " + diffAt + " line " + lineNo + ")"
    );
  }
});

// 2. The list of embedded keys must match SOURCES exactly (no extras, no missing).
var embeddedKeys = assets.list().slice().sort();
var expectedKeys = SOURCES.map(function (p) { return p[0]; }).slice().sort();
if (JSON.stringify(embeddedKeys) !== JSON.stringify(expectedKeys)) {
  failures.push(
    "embedded key set drifted from SOURCES: embedded=" + JSON.stringify(embeddedKeys) +
    " expected=" + JSON.stringify(expectedKeys)
  );
}

if (failures.length) {
  console.log("FAIL: notebook runtime assets are stale.");
  console.log("Run: node scripts/build_notebook_runtime_assets.js");
  console.log();
  failures.forEach(function (f) { console.log("  - " + f); });
  process.exit(1);
}

console.log("PASS: notebook runtime assets match canonical source (" + SOURCES.length + " files).");

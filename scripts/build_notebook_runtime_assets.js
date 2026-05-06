#!/usr/bin/env node
"use strict";
/**
 * Regenerate src/notebook_runtime_assets.js from the canonical Python
 * source files. The assets module is a flat in-memory FILES map that
 * the export-notebook path (src/notebook_bundle_core.js, the trainer
 * tab, and the JupyterLite/Pyodide kernel) reads to ship Python
 * helpers alongside the generated .ipynb.
 *
 * Without regeneration, fixes to server/checkpoint_format.py and
 * server/runtime_weight_loader.py never reach notebook exports —
 * notebook-trained weights would still go through the old broken
 * LSTM convention even after server paths are fixed (BUG-39 scope).
 *
 * Run after editing any embedded source:
 *   node scripts/build_notebook_runtime_assets.js
 *
 * The contract test scripts/test_contract_notebook_runtime_assets.js
 * fails CI if the embedded copy drifts from the source.
 */
var fs = require("fs");
var path = require("path");

var REPO = path.resolve(__dirname, "..");
var OUT = path.join(REPO, "src/notebook_runtime_assets.js");

// (filename-key-in-FILES, source-path-relative-to-REPO)
var SOURCES = [
  ["oscillator_surrogate_pipeline.py", "oscillator_surrogate_pipeline.py"],
  ["checkpoint_format.py",             "server/checkpoint_format.py"],
  ["runtime_weight_loader.py",         "server/runtime_weight_loader.py"],
  ["dataset_source_loader.py",         "server/dataset_source_loader.py"],
  ["train_subprocess.py",              "server/train_subprocess.py"],
];

function readSource(rel) {
  var full = path.join(REPO, rel);
  if (!fs.existsSync(full)) throw new Error("missing source: " + rel);
  return fs.readFileSync(full, "utf8");
}

var entries = SOURCES.map(function (pair) {
  var key = pair[0];
  var src = readSource(pair[1]);
  return JSON.stringify(key) + ":" + JSON.stringify(src);
});

var contents = ";(function(global){\n" +
  "  \"use strict\";\n" +
  "  var FILES = {" + entries.join(",") + "};\n" +
  "  function get(name) { return FILES[name] || null; }\n" +
  "  function has(name) { return Object.prototype.hasOwnProperty.call(FILES, name); }\n" +
  "  function getAll() { return FILES; }\n" +
  "  function list() { return Object.keys(FILES); }\n" +
  "  global.OSCNotebookRuntimeAssets = { files: FILES, get: get, has: has, list: list };\n" +
  "})(typeof window !== \"undefined\" ? window : globalThis);\n";

fs.writeFileSync(OUT, contents);
var sizeKb = (contents.length / 1024).toFixed(0);
console.log("Wrote " + path.relative(REPO, OUT) + " (" + sizeKb + " KB, " + SOURCES.length + " embedded files)");
SOURCES.forEach(function (pair) {
  var src = readSource(pair[1]);
  console.log("  " + pair[0] + " ← " + pair[1] + " (" + src.length + " chars)");
});

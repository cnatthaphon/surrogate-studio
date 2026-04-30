#!/usr/bin/env node
"use strict";
/**
 * Regenerate src/notebook_runtime_assets.js from its 6 source files.
 *
 * The notebook export embeds these files as base strings inside a single
 * JS asset so the browser can ship a notebook bundle without filesystem
 * access. After editing any of the source .py / .md files below, run this
 * script to refresh the embedded snapshot. (Same regen-gap that surfaced
 * as BUG-22 and BUG-34 — keeping the script in-repo prevents recurrence.)
 *
 * Usage:
 *   node scripts/regen_runtime_assets.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const FILES = [
  ["oscillator_surrogate_pipeline.py", "oscillator_surrogate_pipeline.py"],
  ["train_subprocess.py",              "server/train_subprocess.py"],
  ["checkpoint_format.py",             "server/checkpoint_format.py"],
  ["runtime_weight_loader.py",         "server/runtime_weight_loader.py"],
  ["dataset_source_loader.py",         "server/dataset_source_loader.py"],
  ["README.md",                        "server/README.md"],
];

const obj = {};
for (const [key, rel] of FILES) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.error("MISSING:", p);
    process.exit(1);
  }
  obj[key] = fs.readFileSync(p, "utf8");
}

const banner = ";(function(global){\n  \"use strict\";\n";
const filesLine = "  var FILES = " + JSON.stringify(obj) + ";\n";
const helpers =
  "  function get(name) { return FILES[name] || null; }\n" +
  "  function has(name) { return Object.prototype.hasOwnProperty.call(FILES, name); }\n" +
  "  function getAll() { return FILES; }\n" +
  "  function list() { return Object.keys(FILES); }\n" +
  "  global.OSCNotebookRuntimeAssets = { files: FILES, get: get, has: has, list: list };\n" +
  "})(typeof window !== \"undefined\" ? window : globalThis);\n";

const out = banner + filesLine + helpers;
const target = path.join(ROOT, "src/notebook_runtime_assets.js");
fs.writeFileSync(target, out, "utf8");
console.log("wrote", target, out.length, "bytes");

delete require.cache[require.resolve(target)];
require(target);
const NRA = global.OSCNotebookRuntimeAssets;
console.log("keys:", NRA.list());
console.log("train_subprocess.py size:", NRA.get("train_subprocess.py").length);

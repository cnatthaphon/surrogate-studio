#!/usr/bin/env node
"use strict";
/**
 * Validate README badges and markdown links against actual repo state.
 * Runs in CI to catch drift in demo count, model count, paper count.
 */

var fs = require("fs");
var path = require("path");

var errors = [];
function fail(msg) { errors.push(msg); console.log("  \x1b[31m✗\x1b[0m " + msg); }
function ok(msg) { console.log("  \x1b[32m✓\x1b[0m " + msg); }

// --- 1. Count demos ---
var demoDir = path.join(__dirname, "..", "demo");
var demos = fs.readdirSync(demoDir).filter(function (d) {
  return fs.statSync(path.join(demoDir, d)).isDirectory() &&
    fs.existsSync(path.join(demoDir, d, "README.md"));
});
console.log("\n=== Demo count ===");
console.log("  Found " + demos.length + " demo folders with README.md");

// --- 2. Count models from presets ---
var totalModels = 0;
global.window = global;
global.document = {
  createElement: function () { return { onload: null, onerror: null, style: {} }; },
  head: { appendChild: function () {} },
};
global.OSCDatasetModules = { registerModule: function () {} };

demos.forEach(function (d) {
  var presetPath = path.join(demoDir, d, "preset.js");
  if (!fs.existsSync(presetPath)) return;
  try { require(presetPath); } catch (e) { /* some presets need browser globals */ }
});

var presetKeys = Object.keys(global).filter(function (k) { return k.endsWith("_PRESET"); });
presetKeys.forEach(function (k) {
  var p = global[k];
  totalModels += (p.models || []).length;
});

console.log("\n=== Model count ===");
console.log("  Found " + totalModels + " models across " + presetKeys.length + " presets");

// --- 3. Count papers in DEMOS.md ---
var demosmd = fs.readFileSync(path.join(__dirname, "..", "DEMOS.md"), "utf8");
var paperLines = demosmd.split("\n").filter(function (line) {
  return /^\|.*\d{4}.*\|/.test(line) && !/Paper|---/.test(line);
});
// Only count lines in the "Papers Cited" section
var inPapersSection = false;
var paperCount = 0;
demosmd.split("\n").forEach(function (line) {
  if (/^## Papers Cited/.test(line)) { inPapersSection = true; return; }
  if (inPapersSection && /^## /.test(line)) { inPapersSection = false; return; }
  if (inPapersSection && /^\|/.test(line) && !/Paper|Year|---/.test(line)) {
    paperCount++;
  }
});

console.log("\n=== Paper count ===");
console.log("  Found " + paperCount + " papers in DEMOS.md Papers Cited table");

// --- 4. Check README badges ---
var readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");

console.log("\n=== README badge validation ===");

function checkBadge(label, pattern, expected) {
  var match = readme.match(pattern);
  if (!match) { fail(label + " badge not found"); return; }
  var actual = parseInt(match[1], 10);
  if (actual === expected) {
    ok(label + ": " + actual + " (correct)");
  } else {
    fail(label + ": badge says " + actual + " but actual is " + expected);
  }
}

checkBadge("Demos", /demos-(\d+)/, demos.length);
checkBadge("Models", /models-(\d+)/, totalModels);
checkBadge("Papers", /papers%20cited-(\d+)/, paperCount);

// --- 5. Check all markdown links (images + standard) in a file ---
function checkMarkdownLinks(fileName, content, baseDir) {
  console.log("\n=== " + fileName + " markdown links ===");
  // Collect all link targets: ![alt](src), [text](src), and nested [![...](img)](outer)
  var targets = [];
  // Standard and image links
  var simple = content.match(/!?\[[^\]]*\]\([^)]+\)/g) || [];
  simple.forEach(function (link) {
    var m = link.match(/\]\(([^)]+)\)/);
    if (m) targets.push(m[1]);
  });
  // Nested badge links: [![...](img-url)](outer-target)
  var nested = content.match(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g) || [];
  nested.forEach(function (link) {
    var outer = link.match(/\)\]\(([^)]+)\)$/);
    if (outer) targets.push(outer[1]);
  });
  // Deduplicate
  var seen = {};
  targets = targets.filter(function (t) { if (seen[t]) return false; seen[t] = true; return true; });
  var localChecked = 0;
  targets.forEach(function (src) {
    // skip external URLs and pure anchors
    if (src.startsWith("http") || src.startsWith("#")) return;
    // strip anchor from file#section links
    var filePart = src.split("#")[0];
    if (!filePart) return; // pure anchor like #section
    var fullPath = path.join(baseDir, filePart);
    if (fs.existsSync(fullPath)) {
      localChecked++;
    } else {
      fail(fileName + ": broken link → " + src);
    }
  });
  ok(localChecked + " local links valid");
}

var rootDir = path.join(__dirname, "..");
checkMarkdownLinks("README.md", readme, rootDir);
checkMarkdownLinks("DEMOS.md", demosmd, rootDir);

// --- 7. Check each demo has README with key sections ---
console.log("\n=== Demo README sections ===");
var sectionIssues = 0;
demos.forEach(function (d) {
  var content = fs.readFileSync(path.join(demoDir, d, "README.md"), "utf8");
  var hasHowTo = /## How to Use/.test(content);
  var hasRef = /## Reference/.test(content);
  if (!hasHowTo) { fail(d + ": missing 'How to Use' section"); sectionIssues++; }
  if (!hasRef) { fail(d + ": missing 'References' section"); sectionIssues++; }
});
if (!sectionIssues) ok("All " + demos.length + " demos have How to Use + References");

// --- Summary ---
console.log("\n" + "=".repeat(50));
if (errors.length === 0) {
  console.log("\x1b[32m  PASS: All docs validation checks passed\x1b[0m");
} else {
  console.log("\x1b[31m  FAIL: " + errors.length + " issue(s) found:\x1b[0m");
  errors.forEach(function (e) { console.log("    - " + e); });
  process.exit(1);
}

#!/usr/bin/env node
"use strict";
/**
 * Pretrained weight file integrity check.
 *
 * Walks demo/** /*_pretrained.js, decodes the base64 binary payload, and verifies:
 *   file_size === 4 + header_len + sum(prod(spec.shape) * 4)
 *
 * Usage:
 *   node scripts/check_pretrained_integrity.js [demo-folder]
 */

var fs = require("fs");
var path = require("path");

var demoRoot = process.argv[2] || path.join(__dirname, "..", "demo");
var passed = 0;
var failed = 0;
var errors = [];

function walkDir(dir) {
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach(function (e) {
    var full = path.join(dir, e.name);
    if (e.isDirectory()) { walkDir(full); return; }
    if (!e.name.endsWith("_pretrained.js") && !e.name.endsWith("pretrained.js")) return;
    checkFile(full);
  });
}

function checkFile(filePath) {
  var rel = path.relative(demoRoot, filePath);
  try {
    var src = fs.readFileSync(filePath, "utf8");
    var m = src.match(/=\s*"([A-Za-z0-9+/=]+)"/);
    if (!m) {
      errors.push({ file: rel, error: "No base64 payload found" });
      failed++;
      return;
    }
    var buf = Buffer.from(m[1], "base64");
    if (buf.length < 4) {
      errors.push({ file: rel, error: "Buffer too short (" + buf.length + " bytes)" });
      failed++;
      return;
    }
    var headerLen = buf.readUInt32LE(0);
    if (4 + headerLen > buf.length) {
      errors.push({ file: rel, error: "Header length " + headerLen + " exceeds buffer " + buf.length });
      failed++;
      return;
    }
    var header;
    try {
      header = JSON.parse(buf.slice(4, 4 + headerLen).toString("utf8"));
    } catch (e) {
      errors.push({ file: rel, error: "Invalid JSON header: " + e.message });
      failed++;
      return;
    }
    var specs = header.weightSpecs || [];
    var expectedFloats = specs.reduce(function (sum, s) {
      return sum + (s.shape || []).reduce(function (a, b) { return a * b; }, 1);
    }, 0);
    var expectedBytes = expectedFloats * 4;
    var actualBlob = buf.length - 4 - headerLen;

    if (actualBlob !== expectedBytes) {
      errors.push({
        file: rel,
        error: "Weight blob mismatch: got " + actualBlob + " bytes, expected " + expectedBytes +
          " (" + expectedFloats + " floats from " + specs.length + " specs)",
        headerLen: headerLen,
        backend: header.backend || "?",
      });
      failed++;
      return;
    }
    passed++;
    console.log("  OK  " + rel + " (" + specs.length + " arrays, " + (buf.length / 1024).toFixed(0) + " KB)");
  } catch (e) {
    errors.push({ file: rel, error: e.message });
    failed++;
  }
}

console.log("Checking pretrained files in " + demoRoot + "...\n");
walkDir(demoRoot);

console.log("\n" + (passed + failed) + " files checked: " + passed + " passed, " + failed + " failed");
if (errors.length) {
  console.log("\nFailed files:");
  errors.forEach(function (e) {
    console.log("  FAIL  " + e.file);
    console.log("        " + e.error);
  });
  process.exit(1);
}

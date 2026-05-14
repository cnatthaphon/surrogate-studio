"use strict";
// One-off migration: for shipped *_pretrained.js files predating the
// `extract_pytorch_state` fix, the embedding weight was stored under the
// wrong layout ([embed_dim, vocab]) because the server's Dense transpose
// also applied to nn.Embedding outputs. PyTorch's nn.Embedding.weight is
// [vocab, embed_dim] and TF.js's Embedding layer's `embeddings` weight is
// the same [vocab, embed_dim] layout, so the transpose was a bug that
// permuted the embedded vector across token rows. This script rewrites
// the affected pretrained file with the values restored to the original
// PyTorch order and the spec shape corrected.
//
// Usage: node scripts/migrate_embedding_transpose.js <path/to/pretrained.js>

var fs = require("fs");
var path = require("path");

var target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/migrate_embedding_transpose.js <pretrained.js>");
  process.exit(2);
}

var src = fs.readFileSync(target, "utf8");
var m = src.match(/^([\s\S]*?=\s*)"([A-Za-z0-9+/=]+)"\s*;?\s*$/);
if (!m) {
  console.error("could not parse pretrained file");
  process.exit(1);
}
var prefix = m[1];
var b64 = m[2];
var buf = Buffer.from(b64, "base64");

var jlen = buf.readUInt32LE(0);
var header = JSON.parse(buf.slice(4, 4 + jlen).toString("utf8"));
var specs = header.weightSpecs || [];

var dataStart = 4 + jlen;
var floats = new Float32Array(
  buf.buffer.slice(buf.byteOffset + dataStart, buf.byteOffset + buf.length)
);

var embeddingIdx = specs.findIndex(function (s) {
  return /^tfjs_embed_\d+\.weight$/.test(s.name || "");
});
if (embeddingIdx < 0) {
  console.log("no embedding spec — nothing to migrate");
  process.exit(0);
}

var spec = specs[embeddingIdx];
var origShape = spec.shape || [];
if (origShape.length !== 2) {
  console.error("embedding spec is not 2D; shape=" + JSON.stringify(origShape));
  process.exit(1);
}

var rows = origShape[0];
var cols = origShape[1];

var offsetFloats = 0;
for (var i = 0; i < embeddingIdx; i++) {
  var sh = specs[i].shape || [];
  var n = sh.reduce(function (a, b) { return a * b; }, 1);
  offsetFloats += n;
}

var size = rows * cols;
var slice = floats.slice(offsetFloats, offsetFloats + size);
var transposed = new Float32Array(size);
for (var r = 0; r < rows; r++) {
  for (var c = 0; c < cols; c++) {
    transposed[c * rows + r] = slice[r * cols + c];
  }
}
for (var k = 0; k < size; k++) floats[offsetFloats + k] = transposed[k];

spec.shape = [cols, rows];

// Re-emit header (length may shift slightly since shape array changes a
// digit or two). Pack into a fresh buffer so we don't alias the original.
var newHeaderBuf = Buffer.from(JSON.stringify(header), "utf8");
var newJlen = newHeaderBuf.length;
var dataBytes = Buffer.from(floats.buffer);
var outBuf = Buffer.alloc(4 + newJlen + dataBytes.length);
outBuf.writeUInt32LE(newJlen, 0);
newHeaderBuf.copy(outBuf, 4);
dataBytes.copy(outBuf, 4 + newJlen);

var newB64 = outBuf.toString("base64");
var trailingSemi = /;\s*$/.test(src) ? ";\n" : "\n";
fs.writeFileSync(target, prefix + '"' + newB64 + '"' + trailingSemi, "utf8");

console.log("migrated " + path.basename(target) + ":");
console.log("  embedding spec: " + spec.name + " " + JSON.stringify(origShape) + " → " + JSON.stringify(spec.shape));
console.log("  values transposed: " + size);

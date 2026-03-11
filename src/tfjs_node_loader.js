"use strict";

const fs = require("fs");
const path = require("path");

let cachedTf = null;

function getTfjsDistPath() {
  const base = path.join(__dirname, "..", "node_modules", "@tensorflow", "tfjs", "dist");
  const candidates = [
    "tf.js",
    "tf.es2017.js",
    "tf.node.js",
    "index_with_polyfills.js",
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const full = path.join(base, candidates[i]);
    if (fs.existsSync(full)) return full;
  }
  return path.join(base, "tf.js");
}

function loadTfjs() {
  if (cachedTf) return cachedTf;
  const tfPath = getTfjsDistPath();
  if (!fs.existsSync(tfPath)) {
    throw new Error("TensorFlow.js runtime is missing at '" + tfPath + "'.");
  }
  cachedTf = require(tfPath);
  if (!cachedTf || typeof cachedTf.tensor !== "function" || !cachedTf.layers) {
    throw new Error("Failed to load TensorFlow.js runtime from '" + tfPath + "'.");
  }
  return cachedTf;
}

module.exports = {
  getTfjsDistPath,
  loadTfjs,
};

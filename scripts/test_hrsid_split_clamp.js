"use strict";
// Regression test for the HRSID-Ship dataset module's split-fraction
// clamping. Before fix: trainFrac=0.99, valFrac=0.99 produced
// nTrain≈2970 + nVal≈2970 over a 3000-sample pool, the test slice ran
// past the indices array (filling xTest/yTest with `undefined`), and
// the reported splitConfig.test was negative (`1 - 0.99 - 0.99 = -0.98`).
// After fix: the two configured fractions are normalized so their sum
// is at most 0.99, no slice indexes past the pool, and every reported
// count + fraction is non-negative.

var path = require("path");

// Build a tiny synthetic bundle so buildDataset has real bytes to
// decode. Format: [uint32 count][uint32 dim][uint8 pixels × count × dim][float32 bboxes × count × 4].
function makeBundleB64(count, dim) {
  var headerBytes = 8;
  var imgBytes = count * dim;
  var bboxBytes = count * 4 * 4;
  var buf = new ArrayBuffer(headerBytes + imgBytes + bboxBytes);
  var view = new DataView(buf);
  view.setUint32(0, count, true);
  view.setUint32(4, dim, true);
  var bytes = new Uint8Array(buf);
  for (var i = 0; i < imgBytes; i += 1) bytes[headerBytes + i] = i & 0xff;
  var fview = new Float32Array(buf, headerBytes + imgBytes, count * 4);
  for (var b = 0; b < count * 4; b += 1) fview[b] = (b % 10) / 10;
  // base64-encode the bytes
  var chunkSize = 0x8000;
  var binary = "";
  for (var off = 0; off < bytes.length; off += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(off, off + chunkSize));
  }
  return Buffer.from(binary, "binary").toString("base64");
}

// Stub the minimal browser globals the module reads.
var COUNT = 200;
var DIM = 16; // 4x4 patches, keeps the test fast
global.window = global;
global.atob = function (s) { return Buffer.from(s, "base64").toString("binary"); };
global.HRSID_SHIPS_DATA_B64 = makeBundleB64(COUNT, DIM);

var mod = require(path.join(__dirname, "..", "src/dataset_modules/hrsid_ship_module.js"));
var buildDataset = mod.buildDataset;

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

function hasUndefined(arr) {
  for (var i = 0; i < arr.length; i += 1) if (arr[i] === undefined) return true;
  return false;
}

// Case 1: pathological fractions (both ~1.0). Pre-fix: nTrain+nVal > count.
var bad = buildDataset({ trainFrac: 0.99, valFrac: 0.99, seed: 7 });
ok(bad.trainCount + bad.valCount + bad.testCount === COUNT,
  "0.99/0.99: trainCount+valCount+testCount === " + COUNT +
  " (got " + bad.trainCount + "+" + bad.valCount + "+" + bad.testCount + ")");
ok(bad.testCount >= 1, "0.99/0.99: testCount >= 1 (got " + bad.testCount + ")");
ok(bad.splitConfig && bad.splitConfig.test >= 0,
  "0.99/0.99: splitConfig.test >= 0 (got " + (bad.splitConfig && bad.splitConfig.test) + ")");
ok(!hasUndefined(bad.xTrain) && !hasUndefined(bad.yTrain), "0.99/0.99: xTrain/yTrain have no undefined entries");
ok(!hasUndefined(bad.xVal) && !hasUndefined(bad.yVal), "0.99/0.99: xVal/yVal have no undefined entries");
ok(!hasUndefined(bad.xTest) && !hasUndefined(bad.yTest), "0.99/0.99: xTest/yTest have no undefined entries");
ok(bad.xTrain.length === bad.trainCount && bad.xVal.length === bad.valCount && bad.xTest.length === bad.testCount,
  "0.99/0.99: array lengths match reported counts");

// Case 2: also-pathological 0.7 + 0.5 (sum > 1, less extreme).
var bad2 = buildDataset({ trainFrac: 0.7, valFrac: 0.5, seed: 7 });
ok(bad2.trainCount + bad2.valCount + bad2.testCount === COUNT,
  "0.7/0.5: counts sum to " + COUNT + " (got " + bad2.trainCount + "+" + bad2.valCount + "+" + bad2.testCount + ")");
ok(bad2.testCount >= 1 && bad2.splitConfig.test >= 0, "0.7/0.5: testCount + splitConfig.test non-negative");
ok(!hasUndefined(bad2.xTrain) && !hasUndefined(bad2.xVal) && !hasUndefined(bad2.xTest), "0.7/0.5: no undefined samples");

// Case 3: well-formed defaults still produce the expected ~70/15/15 split.
var good = buildDataset({ trainFrac: 0.7, valFrac: 0.15, seed: 7 });
ok(good.trainCount + good.valCount + good.testCount === COUNT, "0.7/0.15: counts sum to " + COUNT);
ok(Math.abs(good.trainCount - 140) <= 1, "0.7/0.15: trainCount ≈ 140 (got " + good.trainCount + ")");
ok(Math.abs(good.valCount - 30) <= 1, "0.7/0.15: valCount ≈ 30 (got " + good.valCount + ")");
ok(Math.abs(good.testCount - 30) <= 1, "0.7/0.15: testCount ≈ 30 (got " + good.testCount + ")");

// Case 4: empty-bundle fallback returns safe non-zero dims.
// Pre-fix: when the bundle had count=0 (or was missing entirely), the
// fallback payload reported imageShape:[0,0,1], featureSize:0 —
// shape-of-zero would silently propagate into downstream model build
// code on transient/headless load failure. The module is HRSID-64×64;
// the fallback must mirror that.
function assertSafeDims(p, label) {
  ok(p && Array.isArray(p.imageShape) && p.imageShape[0] > 0 && p.imageShape[1] > 0,
    label + ": imageShape has non-zero H/W (got " + JSON.stringify(p && p.imageShape) + ")");
  ok(p && Number(p.featureSize) > 0,
    label + ": featureSize > 0 (got " + (p && p.featureSize) + ")");
}
// Stub the global with an empty bundle (count=0, dim=0). buildDataset
// takes the synchronous "present but empty/invalid payload" branch and
// must still emit safe metadata.
global.HRSID_SHIPS_DATA_B64 = makeBundleB64(0, 0);
delete require.cache[require.resolve(path.join(__dirname, "..", "src/dataset_modules/hrsid_ship_module.js"))];
var modEmpty = require(path.join(__dirname, "..", "src/dataset_modules/hrsid_ship_module.js"));
var empty = modEmpty.buildDataset({});
assertSafeDims(empty, "empty bundle");
ok(empty.trainCount === 0 && empty.valCount === 0 && empty.testCount === 0,
  "empty bundle: split counts all zero (got " + empty.trainCount + "/" + empty.valCount + "/" + empty.testCount + ")");

console.log("\n  " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

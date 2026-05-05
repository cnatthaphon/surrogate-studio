// Verify oscillator dataset emits per-sample labels for VAE+Classifier
"use strict";
var path = require("path");
var REPO = path.resolve(__dirname, "..");
var OSC = require(path.join(REPO, "src/oscillator_dataset_core.js"));
var ds = OSC.generateDataset({
  totalCount: 30,
  seed: 42,
  splitMode: "random", trainFrac: 0.7, valFrac: 0.15, testFrac: 0.15,
  targetMode: "xv",
  windowSize: 20,
  predictionMode: "autoregressive",
  includedScenarios: ["spring", "pendulum", "bouncing"],
  featureConfig: { useX: true, useV: true, useParams: true },
  featureSpec: { useX: true, useV: true, useParams: true, paramMask: { m: true, c: true, k: true } },
});
console.log("classCount:", ds.classCount);
console.log("classNames:", ds.classNames);
console.log("xTrain[0].length:", ds.xTrain[0] && ds.xTrain[0].length);
console.log("yTrain[0]:", ds.yTrain[0]);
console.log("yTrain.length:", ds.yTrain.length);
console.log("labelsTrain.length:", ds.labelsTrain && ds.labelsTrain.length);
console.log("labelsTrain[0..5]:", ds.labelsTrain && ds.labelsTrain.slice(0, 5));
console.log("labelsVal.length:", ds.labelsVal && ds.labelsVal.length);
console.log("labelsTest.length:", ds.labelsTest && ds.labelsTest.length);

// Asserts
if (!ds.labelsTrain || ds.labelsTrain.length !== ds.yTrain.length) {
  console.error("FAIL: labelsTrain.length !== yTrain.length");
  process.exit(1);
}
if (!ds.labelsVal || ds.labelsVal.length !== ds.yVal.length) {
  console.error("FAIL: labelsVal.length !== yVal.length");
  process.exit(1);
}
if (ds.classCount !== 3) {
  console.error("FAIL: classCount should be 3");
  process.exit(1);
}
// Should have labels in {0, 1, 2}
var labelSet = Array.from(new Set(ds.labelsTrain));
console.log("Distinct labels in train:", labelSet);
labelSet.forEach(function (l) {
  if (l < 0 || l >= 3 || !Number.isInteger(Number(l))) {
    console.error("FAIL: invalid label:", l);
    process.exit(1);
  }
});
console.log("PASS: Oscillator dataset emits per-sample scenario labels");

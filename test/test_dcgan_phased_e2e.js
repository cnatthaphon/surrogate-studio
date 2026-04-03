/**
 * Focused DCGAN phased-training regression test.
 *
 * Verifies:
 * 1. Conv / ConvTranspose / BatchNorm blocks carry graph weightTag metadata.
 * 2. D-only step updates discriminator-tagged layers and freezes generator-tagged layers.
 * 3. G-only step updates generator-tagged layers and freezes discriminator-tagged layers.
 */

global.window = global;
var tf = require("@tensorflow/tfjs");
var fs = require("fs");
var mb = require("../src/model_builder_core.js");
var te = require("../src/training_engine_core.js");

eval(fs.readFileSync("./demo/Fashion-MNIST-GAN/preset.js", "utf8"));

var PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("  ✓ " + msg); }
  else { FAIL++; console.log("  ✗ FAIL: " + msg); }
}

function snapshotTagged(model) {
  var out = {};
  model.layers.forEach(function (l) {
    if (!l._weightTag) return;
    var w = l.getWeights();
    if (!w || !w.length) return;
    var stateHead = [];
    if (typeof l.getClassName === "function" && l.getClassName() === "BatchNormalization" && w.length >= 4) {
      stateHead = Array.from(w[2].dataSync().slice(0, 8)).concat(Array.from(w[3].dataSync().slice(0, 8)));
    }
    out[l.name] = {
      tag: l._weightTag,
      cls: typeof l.getClassName === "function" ? l.getClassName() : "",
      head: Array.from(w[0].dataSync().slice(0, 8)),
      stateHead: stateHead,
    };
  });
  return out;
}

function diff(before, after, name) {
  var a = before[name], b = after[name];
  if (!a || !b) return NaN;
  var d = 0;
  for (var i = 0; i < a.head.length; i++) d += Math.abs(a.head[i] - b.head[i]);
  return d;
}

function diffState(before, after, name) {
  var a = before[name], b = after[name];
  if (!a || !b || !a.stateHead || !b.stateHead) return NaN;
  var d = 0;
  for (var i = 0; i < Math.min(a.stateHead.length, b.stateHead.length); i++) d += Math.abs(a.stateHead[i] - b.stateHead[i]);
  return d;
}

var graph = window.FASHION_MNIST_GAN_PRESET.models[1].graph; // DCGAN
var trainerCfg = window.FASHION_MNIST_GAN_PRESET.trainers.find(function (t) { return t.id === "t-dcgan"; }).config;
var built = mb.buildModelFromGraph(tf, graph, {
  mode: "direct",
  featureSize: 784,
  windowSize: 1,
  seqFeatureSize: 784,
  allowedOutputKeys: [{ key: "pixel_values", headType: "reconstruction" }],
  defaultTarget: "pixel_values",
  numClasses: 10,
});
var model = built.model;

console.log("=== 1. DCGAN Build ===");
assert(model.outputs.length === 3, "Model has 3 outputs");
assert(model.outputs[0].shape[1] === 784, "G output shape [null,784]");
assert(model.outputs[1].shape[1] === 1, "D output shape [null,1]");
assert(model.outputs[2].shape[1] === 1, "Label output shape [null,1]");

var taggedLayers = model.layers.filter(function (l) { return !!l._weightTag && l.trainableWeights && l.trainableWeights.length; });
var gLayers = taggedLayers.filter(function (l) { return l._weightTag === "generator"; });
var dLayers = taggedLayers.filter(function (l) { return l._weightTag === "discriminator"; });
var gBn = gLayers.filter(function (l) { return typeof l.getClassName === "function" && l.getClassName() === "BatchNormalization"; });
var dBn = dLayers.filter(function (l) { return typeof l.getClassName === "function" && l.getClassName() === "BatchNormalization"; });
assert(gLayers.length >= 5, "Generator has tagged weight-bearing blocks, got " + gLayers.length);
assert(dLayers.length >= 4, "Discriminator has tagged weight-bearing blocks, got " + dLayers.length);
assert(gBn.length >= 2, "Generator BatchNorm blocks are tagged, got " + gBn.length);
assert(dBn.length >= 1, "Discriminator BatchNorm blocks are tagged, got " + dBn.length);

var xTrain = [];
for (var i = 0; i < 16; i++) {
  var row = [];
  for (var j = 0; j < 784; j++) row.push(Math.random() > 0.5 ? 1 : 0);
  xTrain.push(row);
}

console.log("\n=== 2. D-only Step ===");
var snap1 = snapshotTagged(model);
te.trainModelPhased(tf, {
  model: model,
  headConfigs: built.headConfigs,
  inputNodes: built.inputNodes,
  phaseSwitchConfigs: built.phaseSwitchConfigs,
  shouldStop: function () { return false; },
  dataset: { xTrain: xTrain, yTrain: xTrain, targetMode: "xv", paramNames: [], paramSize: 0 },
  epochs: 1,
  batchSize: 8,
  learningRate: Number(trainerCfg.learningRate || 0.0002),
  optimizerType: String(trainerCfg.optimizerType || "adam"),
  optimizerBeta1: Number(trainerCfg.optimizerBeta1 || 0.5),
  optimizerBeta2: Number(trainerCfg.optimizerBeta2 || 0.999),
  trainingSchedule: [{ epochs: 1, trainableTags: { discriminator: true, generator: false } }],
  rotateSchedule: false,
}).then(function () {
  var snap2 = snapshotTagged(model);
  gLayers.forEach(function (l) {
    var d = diff(snap1, snap2, l.name);
    assert(d < 1e-8, "G block " + l.name + " frozen during D step (d=" + d + ")");
  });
  gBn.forEach(function (l) {
    var ds = diffState(snap1, snap2, l.name);
    assert(ds < 1e-8, "G BatchNorm state " + l.name + " frozen during D step (d=" + ds + ")");
  });
  dLayers.forEach(function (l) {
    var d = diff(snap1, snap2, l.name);
    assert(d > 1e-7, "D block " + l.name + " updated during D step (d=" + d + ")");
  });

  console.log("\n=== 3. G-only Step ===");
  var snap3 = snapshotTagged(model);
  return te.trainModelPhased(tf, {
    model: model,
    headConfigs: built.headConfigs,
    inputNodes: built.inputNodes,
    phaseSwitchConfigs: built.phaseSwitchConfigs,
    shouldStop: function () { return false; },
    dataset: { xTrain: xTrain, yTrain: xTrain, targetMode: "xv", paramNames: [], paramSize: 0 },
    epochs: 1,
    batchSize: 8,
    learningRate: Number(trainerCfg.learningRate || 0.0002),
    optimizerType: String(trainerCfg.optimizerType || "adam"),
    optimizerBeta1: Number(trainerCfg.optimizerBeta1 || 0.5),
    optimizerBeta2: Number(trainerCfg.optimizerBeta2 || 0.999),
    trainingSchedule: [{ epochs: 1, trainableTags: { discriminator: false, generator: true } }],
    rotateSchedule: false,
  }).then(function () {
    var snap4 = snapshotTagged(model);
    dLayers.forEach(function (l) {
      var d = diff(snap3, snap4, l.name);
      assert(d < 1e-8, "D block " + l.name + " frozen during G step (d=" + d + ")");
    });
    dBn.forEach(function (l) {
      var ds = diffState(snap3, snap4, l.name);
      assert(ds < 1e-8, "D BatchNorm state " + l.name + " frozen during G step (d=" + ds + ")");
    });
    gLayers.forEach(function (l) {
      var d = diff(snap3, snap4, l.name);
      assert(d > 1e-7, "G block " + l.name + " updated during G step (d=" + d + ")");
    });

    console.log("\n=== RESULTS ===");
    console.log("PASS: " + PASS + " / FAIL: " + FAIL);
    if (FAIL > 0) process.exit(1);
  });
}).catch(function (e) {
  console.log("ERROR:", e.message);
  console.log(e.stack);
  process.exit(1);
});

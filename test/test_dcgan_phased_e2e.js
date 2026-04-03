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
var graphNodes = graph.drawflow && graph.drawflow.Home && graph.drawflow.Home.data ? graph.drawflow.Home.data : {};
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
var graphReluNodes = Object.keys(graphNodes).map(function (id) { return graphNodes[id]; }).filter(function (n) { return n.name === "relu_layer"; });
var graphGeneratorAffine = Object.keys(graphNodes).map(function (id) { return graphNodes[id]; }).filter(function (n) {
  var blockName = String(n.data && n.data.blockName || "");
  return n.data && n.data.weightTag === "generator" && (n.name === "dense_layer" || n.name === "conv2d_transpose_layer") && blockName !== "G_out";
});
var graphDcAffine = Object.keys(graphNodes).map(function (id) { return graphNodes[id]; }).filter(function (n) {
  return n.data && (n.name === "dense_layer" || n.name === "conv2d_layer" || n.name === "conv2d_transpose_layer") &&
    (n.data.weightTag === "generator" || n.data.weightTag === "discriminator");
});
var graphGeneratorBn = Object.keys(graphNodes).map(function (id) { return graphNodes[id]; }).filter(function (n) {
  return n.name === "batchnorm_layer" && n.data && n.data.weightTag === "generator";
});
assert(graphReluNodes.length >= 2, "Generator graph has explicit ReLU nodes, got " + graphReluNodes.length);
assert(graphGeneratorAffine.every(function (n) { return String(n.data.activation || "linear") === "linear"; }), "Generator affine blocks stay linear before BatchNorm/ReLU");
assert(graphDcAffine.every(function (n) { return n.data.useBias === false; }), "DCGAN graph disables bias on affine blocks");
assert(graphGeneratorBn.every(function (n) {
  return Math.abs(Number(n.data.momentum || 0) - 0.9) < 1e-9 &&
    Math.abs(Number(n.data.epsilon || 0) - 0.00001) < 1e-12 &&
    String(n.data.gammaInitializer || "") === "randomNormal" &&
    Math.abs(Number(n.data.gammaInitMean || 0) - 1) < 1e-9 &&
    Math.abs(Number(n.data.gammaInitStddev || 0) - 0.02) < 1e-9;
}), "Generator BatchNorm uses DCGAN-style momentum/epsilon/gamma init");
assert((trainerCfg.trainingSchedule || []).every(function (step) { return String(step.unit || "epoch") === "batch" && Number(step.batches || 0) === 1; }), "DCGAN trainer uses per-batch phase rotation");
assert(model.outputs.length === 3, "Model has 3 outputs");
assert(model.outputs[0].shape[1] === 784, "G output shape [null,784]");
assert(model.outputs[1].shape[1] === 1, "D output shape [null,1]");
assert(model.outputs[2].shape[1] === 1, "Label output shape [null,1]");
var dcAffineLayers = model.layers.filter(function (l) {
  return l._blockName && (l._weightTag === "generator" || l._weightTag === "discriminator") &&
    (typeof l.useBias === "boolean");
});

var taggedLayers = model.layers.filter(function (l) { return !!l._weightTag && l.trainableWeights && l.trainableWeights.length; });
var gLayers = taggedLayers.filter(function (l) { return l._weightTag === "generator"; });
var dLayers = taggedLayers.filter(function (l) { return l._weightTag === "discriminator"; });
var gRelu = model.layers.filter(function (l) { return typeof l.getClassName === "function" && l.getClassName() === "ReLU"; });
var gBn = gLayers.filter(function (l) { return typeof l.getClassName === "function" && l.getClassName() === "BatchNormalization"; });
var dBn = dLayers.filter(function (l) { return typeof l.getClassName === "function" && l.getClassName() === "BatchNormalization"; });
assert(gLayers.length >= 5, "Generator has tagged weight-bearing blocks, got " + gLayers.length);
assert(dLayers.length >= 4, "Discriminator has tagged weight-bearing blocks, got " + dLayers.length);
assert(dcAffineLayers.every(function (l) { return l.useBias === false; }), "Built DCGAN affine layers disable bias");
assert(gRelu.length >= 2, "Built generator has explicit ReLU layers, got " + gRelu.length);
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

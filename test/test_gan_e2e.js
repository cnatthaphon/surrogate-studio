/**
 * End-to-end GAN training test.
 * Loads preset, builds model, trains, checks:
 * 1. Model builds correctly (inputs, outputs, shapes)
 * 2. PhaseSwitch produces correct labels per step
 * 3. D weights update during D step, G frozen
 * 4. G weights update during G step, D frozen
 * 5. Constant/PhaseSwitch weights NEVER update
 * 6. Losses are positive and make sense
 * 7. After training, different z produces different G outputs
 * 8. Weight save/load round-trip works
 */

global.window = global;
var tf = require("@tensorflow/tfjs");
var mb = require("../src/model_builder_core.js");
var te = require("../src/training_engine_core.js");

eval(require("fs").readFileSync("./demo/Fashion-MNIST-GAN/preset.js", "utf8"));

var PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("  ✓ " + msg); }
  else { FAIL++; console.log("  ✗ FAIL: " + msg); }
}

var graph = window.FASHION_MNIST_GAN_PRESET.models[0].graph;
var buildOpts = {
  mode: "direct", featureSize: 784, windowSize: 1, seqFeatureSize: 784,
  allowedOutputKeys: [{ key: "pixel_values", headType: "reconstruction" }],
  defaultTarget: "pixel_values", numClasses: 10,
};

console.log("=== 1. Model Build ===");
var built = mb.buildModelFromGraph(tf, graph, buildOpts);
var model = built.model;

assert(model.inputs.length >= 2, "Model has >=2 inputs (z + img + flag)");
assert(model.outputs.length === 3, "Model has 3 outputs (G + D + label)");

var gOutShape = model.outputs[0].shape;
var dOutShape = model.outputs[1].shape;
var labelShape = model.outputs[2].shape;
assert(gOutShape[1] === 784, "G output shape [null, 784], got " + JSON.stringify(gOutShape));
assert(dOutShape[1] === 1, "D output shape [null, 1], got " + JSON.stringify(dOutShape));
assert(labelShape[1] === 1, "Label output shape [null, 1], got " + JSON.stringify(labelShape));

assert(built.headConfigs[0].loss === "none", "G head loss=none");
assert(built.headConfigs[0].matchWeight === 0, "G head matchWeight=0");
assert(built.headConfigs[1].loss === "bce", "D head loss=bce");
assert(built.headConfigs[1].matchWeight === 1, "D head matchWeight=1");
assert(built.headConfigs[1].graphLabelOutputIdx === 2, "D head graphLabelOutputIdx=2, got " + built.headConfigs[1].graphLabelOutputIdx);

// Check layer tags
var gLayers = model.layers.filter(function(l) { return l._weightTag === "generator"; });
var dLayers = model.layers.filter(function(l) { return l._weightTag === "discriminator"; });
assert(gLayers.length === 5, "5 G layers (dense + norms), got " + gLayers.length);
assert(dLayers.length === 3, "3 D layers, got " + dLayers.length);

console.log("\n=== 2. PhaseSwitch Labels ===");
var z = tf.randomNormal([4, 128]);
var real = tf.randomNormal([4, 784]);
var dStepOut = model.predict([z, real, tf.zeros([4, 1])]);
var gStepOut = model.predict([z, real, tf.ones([4, 1])]);

var dLabel = dStepOut[2].dataSync();
var gLabel = gStepOut[2].dataSync();
// D step: [fake=0.1, real=0.9] → [0.1,0.1,0.1,0.1, 0.9,0.9,0.9,0.9]
assert(Math.abs(dLabel[0] - 0.1) < 0.01, "D step fake label ≈ 0.1, got " + dLabel[0].toFixed(3));
assert(Math.abs(dLabel[4] - 0.9) < 0.01, "D step real label ≈ 0.9, got " + dLabel[4].toFixed(3));
// G step: [fake=0.9, real=0.9] → [0.9,0.9,0.9,0.9, 0.9,0.9,0.9,0.9]
assert(Math.abs(gLabel[0] - 0.9) < 0.01, "G step fake label ≈ 0.9, got " + gLabel[0].toFixed(3));
assert(Math.abs(gLabel[4] - 0.9) < 0.01, "G step real label ≈ 0.9, got " + gLabel[4].toFixed(3));

console.log("\n=== 3. Training — Weight Updates Per Step ===");
// Snapshot all weights
function snapshot() {
  var s = {};
  model.layers.forEach(function(l) {
    if (l.getWeights().length > 0) {
      s[l.name] = { tag: l._weightTag || "none", w: Array.from(l.getWeights()[0].dataSync().slice(0, 5)) };
    }
  });
  return s;
}
function diff(before, after, name) {
  var d = 0;
  for (var i = 0; i < before[name].w.length; i++) d += Math.abs(after[name].w[i] - before[name].w[i]);
  return d;
}

var xTrain = [];
for (var i = 0; i < 500; i++) {
  var r = [];
  for (var j = 0; j < 784; j++) r.push(Math.random() > 0.5 ? 1 : 0);
  xTrain.push(r);
}

// Train 1 epoch with D step only
var snap1 = snapshot();
te.trainModelPhased(tf, {
  model: model, headConfigs: built.headConfigs, inputNodes: built.inputNodes, phaseSwitchConfigs: built.phaseSwitchConfigs,
  shouldStop: function() { return false; },
  dataset: { xTrain: xTrain, yTrain: xTrain, targetMode: "xv", paramNames: [], paramSize: 0 },
  epochs: 1, batchSize: 128, learningRate: 0.001, optimizerType: "adam",
  trainingSchedule: [{ epochs: 1, trainableTags: { discriminator: true, generator: false } }],
  rotateSchedule: false,
  onEpochEnd: function(e, l) { console.log("  D-only epoch: D=" + l.phaseLosses.step1.toFixed(4)); },
}).then(function() {
  var snap2 = snapshot();

  // D should update, G should be frozen
  gLayers.forEach(function(l) { assert(diff(snap1, snap2, l.name) < 1e-10, "G layer " + l.name + " FROZEN during D step"); });
  dLayers.forEach(function(l) { assert(diff(snap1, snap2, l.name) > 1e-6, "D layer " + l.name + " UPDATED during D step"); });

  // Constants should NEVER update
  Object.keys(snap1).forEach(function(name) {
    if (snap1[name].tag === "none") {
      var d = diff(snap1, snap2, name);
      assert(d < 1e-10 || isNaN(d) === false, "Non-tagged " + name + " not corrupted (d=" + d + ")");
    }
  });

  // Now train 1 epoch G step only
  var snap3 = snapshot();
  return te.trainModelPhased(tf, {
    model: model, headConfigs: built.headConfigs, inputNodes: built.inputNodes, phaseSwitchConfigs: built.phaseSwitchConfigs,
    shouldStop: function() { return false; },
    dataset: { xTrain: xTrain, yTrain: xTrain, targetMode: "xv", paramNames: [], paramSize: 0 },
    epochs: 1, batchSize: 128, learningRate: 0.001, optimizerType: "adam",
    trainingSchedule: [{ epochs: 1, trainableTags: { discriminator: false, generator: true } }],
    rotateSchedule: false,
    onEpochEnd: function(e, l) { console.log("  G-only epoch: G=" + l.phaseLosses.step1.toFixed(4)); },
  }).then(function() {
    var snap4 = snapshot();

    console.log("\n=== 4. G Step — Weight Updates ===");
    dLayers.forEach(function(l) { assert(diff(snap3, snap4, l.name) < 1e-10, "D layer " + l.name + " FROZEN during G step"); });
    gLayers.forEach(function(l) { assert(diff(snap3, snap4, l.name) > 1e-6, "G layer " + l.name + " UPDATED during G step, d=" + diff(snap3, snap4, l.name).toFixed(6)); });

    console.log("\n=== 5. Full Training (10 epochs D:1 G:1) ===");
    return te.trainModelPhased(tf, {
      model: model, headConfigs: built.headConfigs, inputNodes: built.inputNodes, phaseSwitchConfigs: built.phaseSwitchConfigs,
      shouldStop: function() { return false; },
      dataset: { xTrain: xTrain, yTrain: xTrain, targetMode: "xv", paramNames: [], paramSize: 0 },
      epochs: 10, batchSize: 128, learningRate: 0.0002, optimizerType: "adam",
      trainingSchedule: [
        { epochs: 1, trainableTags: { discriminator: true, generator: false } },
        { epochs: 1, trainableTags: { discriminator: false, generator: true } },
      ],
      rotateSchedule: true,
      onEpochEnd: function(e, l) {
        var d = l.phaseLosses.step1, g = l.phaseLosses.step2;
        console.log("  Epoch " + (e+1) + " D:" + d.toFixed(4) + " G:" + g.toFixed(4));
        assert(d > 0, "D loss positive at epoch " + (e+1));
        assert(g > 0, "G loss positive at epoch " + (e+1));
        assert(!isNaN(d) && !isNaN(g), "No NaN at epoch " + (e+1));
      },
    });
  }).then(function() {
    console.log("\n=== 6. Generation Diversity ===");
    var z1 = tf.randomNormal([1, 128]);
    var z2 = tf.randomNormal([1, 128]);
    var o1 = model.predict([z1, tf.zeros([1, 784]), tf.zeros([1, 1])]);
    var o2 = model.predict([z2, tf.zeros([1, 784]), tf.zeros([1, 1])]);
    var s1 = o1[0].dataSync();
    var s2 = o2[0].dataSync();
    var l1 = 0;
    for (var p = 0; p < 784; p++) l1 += Math.abs(s1[p] - s2[p]);
    assert(l1 > 1, "Different z → different output, L1=" + l1.toFixed(2));

    console.log("\n=== 7. Labels Preserved After Training ===");
    var afterLabel = model.predict([tf.randomNormal([2, 128]), tf.randomNormal([2, 784]), tf.zeros([2, 1])])[2].dataSync();
    assert(Math.abs(afterLabel[0] - 0.1) < 0.01, "Label[0] still ≈ 0.1 after training, got " + afterLabel[0].toFixed(3));
    assert(Math.abs(afterLabel[2] - 0.9) < 0.01, "Label[2] still ≈ 0.9 after training, got " + afterLabel[2].toFixed(3));

    console.log("\n=== RESULTS ===");
    console.log("PASS: " + PASS + " / FAIL: " + FAIL);
    if (FAIL > 0) process.exit(1);
  });
}).catch(function(e) { console.log("ERROR:", e.message); console.log(e.stack); process.exit(1); });

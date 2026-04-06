/**
 * Headless diffusion training test:
 * 1. Build all 4 diffusion models
 * 2. Train each for 5 epochs on synthetic data
 * 3. Verify loss decreases, no NaN
 * 4. Test generation (reconstruct + ddpm)
 *
 * Run: node scripts/test_diffusion_train.js
 */
"use strict";
global.window = global;

var tf = require("@tensorflow/tfjs");
var mb = require("../src/model_builder_core.js");
var te = require("../src/training_engine_core.js");
var ge = require("../src/generation_engine_core.js");
var fs = require("fs");

// Load preset
eval(fs.readFileSync("demo/Fashion-MNIST-Diffusion/preset.js", "utf8"));
var preset = window.FASHION_MNIST_DIFFUSION_PRESET;

var PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; process.stdout.write("  \u2713 " + msg + "\n"); }
  else { FAIL++; process.stdout.write("  \u2717 FAIL: " + msg + "\n"); }
}

// Synthetic data (784 pixels)
var N_TRAIN = 200, N_VAL = 40;
var xTrain = [], yTrain = [], xVal = [], yVal = [];
for (var i = 0; i < N_TRAIN; i++) {
  var row = []; for (var j = 0; j < 784; j++) row.push(Math.random() * 0.5 + 0.25);
  xTrain.push(row); yTrain.push(row);
}
for (var k = 0; k < N_VAL; k++) {
  var row2 = []; for (var j2 = 0; j2 < 784; j2++) row2.push(Math.random() * 0.5 + 0.25);
  xVal.push(row2); yVal.push(row2);
}

var models = preset.models;
var midx = 0;

function nextModel() {
  if (midx >= models.length) {
    console.log("\n=============================");
    console.log("TOTAL: " + PASS + " PASS, " + FAIL + " FAIL");
    console.log("=============================");
    process.exit(FAIL > 0 ? 1 : 0);
  }

  var m = models[midx++];
  console.log("\n=== " + m.name + " ===");

  var built;
  try {
    built = mb.buildModelFromGraph(tf, m.graph, {
      mode: "direct", featureSize: 784, windowSize: 1, seqFeatureSize: 784,
      allowedOutputKeys: [{ key: "pixel_values", headType: "reconstruction" }],
      defaultTarget: "pixel_values", numClasses: 10,
    });
    assert(true, "build OK — inputs:" + built.model.inputs.length + " outputs:" + built.model.outputs.length);
  } catch (e) {
    assert(false, "build: " + e.message);
    nextModel(); return;
  }

  built.inputNodes.forEach(function (inp, idx) {
    console.log("    input[" + idx + "] " + inp.name + " shape=" + JSON.stringify(built.model.inputs[idx].shape));
  });

  var isPhased = te.needsPhasedTraining && te.needsPhasedTraining(built.headConfigs);
  assert(!isPhased, "uses standard training (not phased)");

  var epochLogs = [];
  var trainOpts = {
    model: built.model,
    headConfigs: built.headConfigs,
    inputNodes: built.inputNodes || [],
    phaseSwitchConfigs: built.phaseSwitchConfigs || [],
    shouldStop: function () { return false; },
    dataset: {
      xTrain: xTrain, yTrain: yTrain, xVal: xVal, yVal: yVal,
      targetMode: "pixel_values", paramNames: [], paramSize: 0, numClasses: 10,
    },
    epochs: 5, batchSize: 64, learningRate: 0.001, optimizerType: "adam",
    lrSchedulerType: "none", earlyStoppingPatience: 0,
    onEpochEnd: function (epoch, log) {
      epochLogs.push(log);
      console.log("    epoch " + (epoch + 1) + " loss=" + (log.loss != null ? log.loss.toFixed(6) : "null") +
        " val_loss=" + (log.val_loss != null ? log.val_loss.toFixed(6) : "null"));
    },
  };

  te.trainModel(tf, trainOpts).then(function (result) {
    var firstLoss = epochLogs.length ? epochLogs[0].loss : null;
    var finalLoss = epochLogs.length ? epochLogs[epochLogs.length - 1].loss : null;
    assert(finalLoss != null && !isNaN(finalLoss), "final loss not NaN: " + finalLoss);
    assert(firstLoss != null && finalLoss <= firstLoss, "loss did not increase: " + (firstLoss && firstLoss.toFixed(4)) + " -> " + (finalLoss && finalLoss.toFixed(4)));

    // Reconstruct: pass real data through model
    ge.generate(tf, {
      model: built.model, inputNodes: built.inputNodes,
      headConfigs: built.headConfigs,
      method: "reconstruct",
      originals: xVal.slice(0, 4),
      numSamples: 4, seed: 42,
    }).then(function (reconResult) {
      assert(reconResult.samples && reconResult.samples.length === 4, "reconstruct: 4 samples");
      assert(reconResult.avgMse != null && !isNaN(reconResult.avgMse), "reconstruct MSE: " + (reconResult.avgMse && reconResult.avgMse.toFixed(4)));

      // DDPM: iterative generation from noise
      return ge.generate(tf, {
        model: built.model, inputNodes: built.inputNodes,
        headConfigs: built.headConfigs,
        method: "ddpm",
        numSamples: 4, steps: 10, seed: 42,
        latentDim: 784,
      });
    }).then(function (ddpmResult) {
      assert(ddpmResult.samples && ddpmResult.samples.length === 4, "ddpm: 4 samples");
      var mean = 0;
      if (ddpmResult.samples[0]) {
        for (var si = 0; si < ddpmResult.samples[0].length; si++) mean += ddpmResult.samples[0][si];
        mean /= ddpmResult.samples[0].length;
      }
      assert(!isNaN(mean), "ddpm output valid (mean=" + mean.toFixed(4) + ")");

      // Langevin generation
      return ge.generate(tf, {
        model: built.model, inputNodes: built.inputNodes,
        headConfigs: built.headConfigs,
        method: "langevin",
        numSamples: 2, steps: 5, lr: 0.01, seed: 42,
        latentDim: 784,
      });
    }).then(function (langResult) {
      assert(langResult.samples && langResult.samples.length === 2, "langevin: 2 samples");
      var lm = 0;
      if (langResult.samples[0]) {
        for (var li = 0; li < langResult.samples[0].length; li++) lm += langResult.samples[0][li];
        lm /= langResult.samples[0].length;
      }
      assert(!isNaN(lm), "langevin output valid (mean=" + lm.toFixed(4) + ")");

      built.model.dispose();
      nextModel();
    }).catch(function (e) {
      assert(false, "generation error: " + e.message);
      built.model.dispose();
      nextModel();
    });
  }).catch(function (e) {
    assert(false, "train error: " + e.message);
    console.log(e.stack);
    built.model.dispose();
    nextModel();
  });
}

nextModel();

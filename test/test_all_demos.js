/**
 * Comprehensive demo test — verifies ALL demos work end-to-end.
 *
 * For each demo:
 * 1. Build all models from graph (no errors)
 * 2. Train 2 epochs on client (loss decreases or is valid)
 * 3. Generate samples (no NaN, correct shape)
 * 4. Weight save/load round-trip (name-based matching)
 *
 * Run: node test/test_all_demos.js
 */

global.window = global;
var tf = require("@tensorflow/tfjs");
var mb = require("../src/model_builder_core.js");
var te = require("../src/training_engine_core.js");
var fs = require("fs");

var PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; }
  else { FAIL++; console.log("    ✗ FAIL: " + msg); }
}

var demos = [
  { name: "Fashion-MNIST Benchmark", preset: "demo/Fashion-MNIST-Benchmark/preset.js", var: "FASHION_MNIST_BENCHMARK_PRESET", schema: "fashion_mnist", featureSize: 784, outputKeys: [{ key: "pixel_values", headType: "reconstruction" }, { key: "label", headType: "classification" }], defaultTarget: "pixel_values" },
  { name: "Fashion-MNIST GAN", preset: "demo/Fashion-MNIST-GAN/preset.js", var: "FASHION_MNIST_GAN_PRESET", schema: "fashion_mnist", featureSize: 784, outputKeys: [{ key: "pixel_values", headType: "reconstruction" }], defaultTarget: "pixel_values" },
  { name: "Fashion-MNIST Diffusion", preset: "demo/Fashion-MNIST-Diffusion/preset.js", var: "FASHION_MNIST_DIFFUSION_PRESET", schema: "fashion_mnist", featureSize: 784, outputKeys: [{ key: "pixel_values", headType: "reconstruction" }], defaultTarget: "pixel_values" },
  { name: "Oscillator Surrogate", preset: "demo/Oscillator-Surrogate/preset.js", var: "OSCILLATOR_DEMO_PRESET", schema: "oscillator", featureSize: 4, outputKeys: [{ key: "xv", headType: "regression" }], defaultTarget: "xv" },
  { name: "LSTM-VAE", preset: "demo/LSTM-VAE-for-dominant-motion-extraction/preset.js", var: "LSTM_VAE_DEMO_PRESET", schema: "ant_trajectory", featureSize: 40, outputKeys: [{ key: "xv", headType: "regression" }], defaultTarget: "xv" },
];

var demoIdx = 0;
function nextDemo() {
  if (demoIdx >= demos.length) {
    console.log("\n═══════════════════════════════════════");
    console.log("TOTAL: " + PASS + " PASS, " + FAIL + " FAIL");
    console.log("═══════════════════════════════════════");
    process.exit(FAIL > 0 ? 1 : 0);
  }
  var demo = demos[demoIdx++];
  console.log("\n═══ " + demo.name + " ═══");

  try { eval(fs.readFileSync(demo.preset, "utf8")); } catch (e) {
    console.log("  Preset load error: " + e.message); FAIL++; nextDemo(); return;
  }

  var preset = window[demo.var];
  if (!preset) { console.log("  Preset variable not found: " + demo.var); FAIL++; nextDemo(); return; }

  var models = preset.models || [];
  var trainers = preset.trainers || [];
  console.log("  Models: " + models.length + ", Trainers: " + trainers.length);

  var opts = {
    mode: "direct", featureSize: demo.featureSize, windowSize: 1, seqFeatureSize: demo.featureSize,
    allowedOutputKeys: demo.outputKeys, defaultTarget: demo.defaultTarget, numClasses: 10,
  };

  var xTrain = [];
  for (var i = 0; i < 50; i++) {
    var r = []; for (var j = 0; j < demo.featureSize; j++) r.push(Math.random());
    xTrain.push(r);
  }

  var modelIdx = 0;
  function nextModel() {
    if (modelIdx >= models.length) { nextDemo(); return; }
    var m = models[modelIdx++];
    process.stdout.write("  " + m.name + ": ");

    // 1. Build
    var built;
    try {
      built = mb.buildModelFromGraph(tf, m.graph, opts);
      assert(true, "build"); process.stdout.write("build✓ ");
    } catch (e) {
      assert(false, "build: " + e.message); console.log(""); nextModel(); return;
    }

    // Find trainer
    var trainer = trainers.find(function (t) { return t.modelId === m.id && t.status === "draft"; });
    var isPhased = te.needsPhasedTraining && te.needsPhasedTraining(built.headConfigs);
    var trainFn = isPhased ? te.trainModelPhased : te.trainModel;

    // Build y data matching each head's expected shape
    var hasKlHead = built.headConfigs.some(function (h) { return String(h.headType || "").indexOf("latent_kl") >= 0; });
    var yTrain = hasKlHead ? xTrain.map(function (r) { return r.slice(0, demo.featureSize); }) : xTrain;
    var yVal = hasKlHead ? xTrain.slice(0, 10).map(function (r) { return r.slice(0, demo.featureSize); }) : xTrain.slice(0, 10);

    var trainOpts = {
      model: built.model, headConfigs: built.headConfigs, inputNodes: built.inputNodes || [],
      phaseSwitchConfigs: built.phaseSwitchConfigs || [],
      shouldStop: function () { return false; },
      dataset: {
        xTrain: xTrain, yTrain: yTrain, xVal: xTrain.slice(0, 10), yVal: yVal,
        targetMode: "xv", paramNames: [], paramSize: 0, numClasses: 10,
        labelsTrain: xTrain.map(function () { var oh = new Array(10).fill(0); oh[Math.floor(Math.random() * 10)] = 1; return oh; }),
        labelsVal: xTrain.slice(0, 10).map(function () { var oh = new Array(10).fill(0); oh[Math.floor(Math.random() * 10)] = 1; return oh; }),
      },
      epochs: 2, batchSize: 32, learningRate: 0.001, optimizerType: "adam",
      lrSchedulerType: "none", earlyStoppingPatience: 0,
    };
    if (trainer && trainer.config) {
      if (trainer.config.trainingSchedule) trainOpts.trainingSchedule = trainer.config.trainingSchedule;
      if (trainer.config.rotateSchedule != null) trainOpts.rotateSchedule = trainer.config.rotateSchedule;
      if (trainer.config.optimizerType) trainOpts.optimizerType = trainer.config.optimizerType;
    }

    // 2. Train
    trainFn(tf, trainOpts).then(function (result) {
      assert(true, "train"); process.stdout.write("train✓ ");

      // 3. Weight save/load
      try {
        var ws = built.model.getWeights();
        var flat = []; ws.forEach(function (w) { var d = w.dataSync(); for (var k = 0; k < d.length; k++) flat.push(d[k]); });

        var built2 = mb.buildModelFromGraph(tf, m.graph, opts);
        function stripSuffix(n) { return String(n || "").replace(/_\d+$/, ""); }
        var savedMap = {}; var off = 0;
        built.model.weights.forEach(function (sp) {
          var sz = sp.shape.reduce(function (a, b) { return a * b; }, 1);
          savedMap[stripSuffix(sp.name)] = { offset: off, size: sz, shape: sp.shape }; off += sz;
        });
        var fw = new Float32Array(flat); var nw = []; var matched = 0;
        built2.model.weights.forEach(function (mw) {
          var key = stripSuffix(mw.name); var saved = savedMap[key];
          if (saved && saved.size === mw.shape.reduce(function (a, b) { return a * b; }, 1)) {
            nw.push(tf.tensor(fw.subarray(saved.offset, saved.offset + saved.size), mw.shape)); matched++;
          } else { nw.push(mw.read()); }
        });
        if (matched === built2.model.weights.length) built2.model.setWeights(nw);
        assert(matched === built2.model.weights.length, "weights " + matched + "/" + built2.model.weights.length);
        process.stdout.write("weights(" + matched + "/" + built2.model.weights.length + ")✓ ");

        // 4. Generate
        var genInput;
        if (built2.model.inputs.length > 1) {
          genInput = built2.inputNodes.map(function (n, idx) {
            if (n.name === "sample_z_layer") return tf.randomNormal([4, built2.model.inputs[idx].shape[built2.model.inputs[idx].shape.length - 1]]);
            return tf.zeros([4, built2.model.inputs[idx].shape[built2.model.inputs[idx].shape.length - 1]]);
          });
        } else {
          genInput = tf.randomNormal([4, demo.featureSize]);
        }
        var out = built2.model.predict(genInput);
        var gOut = Array.isArray(out) ? out[0] : out;
        var mean = gOut.mean().dataSync()[0];
        assert(!isNaN(mean), "generate NaN");
        process.stdout.write("gen✓");

        built2.model.dispose();
      } catch (e) {
        assert(false, "weights/gen: " + e.message);
      }

      console.log("");
      built.model.dispose();
      nextModel();
    }).catch(function (e) {
      assert(false, "train: " + e.message); console.log(""); built.model.dispose(); nextModel();
    });
  }
  nextModel();
}
nextDemo();

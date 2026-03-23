"use strict";
/**
 * Headless generation pipeline test.
 * Tests: random sampling, latent optimization, inverse mode.
 * Uses a simple 2-layer model as a mock decoder.
 */
var assert = require("assert");
var tf;
try { tf = require("@tensorflow/tfjs"); } catch (e) { tf = require("@tensorflow/tfjs-node"); }

var GenEngine = require("../src/generation_engine_core.js");
var ModelBuilder = require("../src/model_builder_core.js");

function main() {
  console.log("--- Generation Engine Tests ---\n");

  // build a simple decoder model: z(4) → dense(16) → dense(8) → output
  var zInput = tf.input({ shape: [4] });
  var h = tf.layers.dense({ units: 16, activation: "relu" }).apply(zInput);
  var out = tf.layers.dense({ units: 8, activation: "sigmoid" }).apply(h);
  var decoderModel = tf.model({ inputs: zInput, outputs: out });

  // 1. random sampling
  console.log("Test 1: Random sampling");
  GenEngine.generate(tf, {
    method: "random",
    model: decoderModel,
    latentDim: 4,
    numSamples: 8,
    temperature: 1.0,
  }).then(function (result) {
    assert.strictEqual(result.method, "random");
    assert.strictEqual(result.samples.length, 8);
    assert.strictEqual(result.samples[0].length, 8); // output dim
    assert.strictEqual(result.latents.length, 8);
    assert.strictEqual(result.latents[0].length, 4); // latent dim
    console.log("  PASS: " + result.samples.length + " samples, output dim=" + result.samples[0].length);

    // 2. latent optimization
    console.log("\nTest 2: Latent optimization");
    var targetOutput = result.samples[0]; // optimize z to reconstruct first sample
    return GenEngine.generate(tf, {
      method: "optimize",
      model: decoderModel,
      latentDim: 4,
      numSamples: 1,
      steps: 50,
      lr: 0.05,
      temperature: 0.1,
      objective: GenEngine.objectives.reconstruction([targetOutput]),
    });
  }).then(function (result) {
    assert.strictEqual(result.method, "optimize");
    assert.strictEqual(result.samples.length, 1);
    assert(result.lossHistory.length === 50, "50 steps recorded");
    // loss should decrease
    var firstLoss = result.lossHistory[0].loss;
    var lastLoss = result.lossHistory[result.lossHistory.length - 1].loss;
    assert(lastLoss < firstLoss, "Loss decreased: " + firstLoss.toFixed(4) + " → " + lastLoss.toFixed(4));
    console.log("  PASS: loss " + firstLoss.toFixed(4) + " → " + lastLoss.toFixed(4) + " (" + result.lossHistory.length + " steps)");

    // 3. inverse mode
    console.log("\nTest 3: Inverse / Transfer learning");
    // build a simple forward model: input(3) → dense(8) → output(2)
    var xIn = tf.input({ shape: [3] });
    var fh = tf.layers.dense({ units: 8, activation: "relu" }).apply(xIn);
    var fOut = tf.layers.dense({ units: 2 }).apply(fh);
    var forwardModel = tf.model({ inputs: xIn, outputs: fOut });

    var target = [[1.0, -1.0]]; // desired output
    return GenEngine.generate(tf, {
      method: "inverse",
      model: forwardModel,
      target: target,
      steps: 50,
      lr: 0.05,
    });
  }).then(function (result) {
    assert.strictEqual(result.method, "inverse");
    assert(result.lossHistory.length === 50);
    var firstLoss = result.lossHistory[0].loss;
    var lastLoss = result.lossHistory[result.lossHistory.length - 1].loss;
    assert(lastLoss < firstLoss, "Inverse loss decreased");
    assert(result.optimizedInput, "Has optimized input");
    console.log("  PASS: inverse loss " + firstLoss.toFixed(4) + " → " + lastLoss.toFixed(4));
    console.log("  Optimized input: [" + result.optimizedInput[0].map(function (v) { return v.toFixed(3); }).join(", ") + "]");

    // 4. detectCapabilities
    console.log("\nTest 4: Capability detection");
    var vaeCaps = GenEngine.detectCapabilities("vae");
    assert(vaeCaps.canRandomSample, "VAE can random sample");
    assert(vaeCaps.canOptimize, "VAE can optimize");
    assert(vaeCaps.canInverse, "VAE can inverse");
    assert.strictEqual(vaeCaps.defaultMethod, "random");
    console.log("  PASS: VAE methods: " + vaeCaps.availableMethods.map(function (m) { return m.id; }).join(", "));

    var diffCaps = GenEngine.detectCapabilities("diffusion");
    assert(diffCaps.canDDPM, "Diffusion can DDPM");
    assert(diffCaps.canLangevin, "Diffusion can Langevin");
    console.log("  PASS: Diffusion methods: " + diffCaps.availableMethods.map(function (m) { return m.id; }).join(", "));

    var supCaps = GenEngine.detectCapabilities("supervised");
    assert(supCaps.canInverse, "Supervised can inverse");
    assert(!supCaps.canRandomSample, "Supervised cannot random sample");
    console.log("  PASS: Supervised methods: " + supCaps.availableMethods.map(function (m) { return m.id; }).join(", "));

    // 5. extractLatentInfo
    console.log("\nTest 5: Latent info extraction");
    var latentInfo = ModelBuilder.extractLatentInfo ? ModelBuilder.extractLatentInfo({}) : null;
    if (latentInfo) {
      console.log("  PASS: extractLatentInfo returns: family=" + latentInfo.family + " latentDim=" + latentInfo.latentDim);
    } else {
      console.log("  SKIP: extractLatentInfo not available");
    }

    console.log("\n===== PASS test_headless_generation =====");
    decoderModel.dispose();
  }).catch(function (err) {
    console.error("FAIL:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

main();

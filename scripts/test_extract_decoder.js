"use strict";
/**
 * Regression test for extractDecoder() — branched VAE+Cls topology.
 *
 * Bug fixed: extractDecoder previously walked fullModel.layers in topological
 * order and applied them sequentially. For a VAE+Classifier graph (reparam →
 * recon branch AND encoder → classifier branch), this chained the classifier
 * layers onto the reconstruction output, producing a "decoder" that emitted
 * class probabilities ([batch, 10]) instead of the reconstructed image
 * ([batch, 784]). Downstream classifier-guided generation then failed with
 * "expected input_1 to have shape [null,784] but got [16,10]".
 *
 * This test builds a synthetic VAE+Cls-style branched model and asserts that
 * extractDecoder, when told which output is the reconstruction head, returns
 * a decoder whose output dimension matches the reconstruction head — not the
 * classifier head.
 */
var assert = require("assert");
var tf;
try { tf = require("@tensorflow/tfjs"); } catch (e) { tf = require("@tensorflow/tfjs-node"); }

var ModelBuilder = require("../src/model_builder_core.js");

function buildVaeClsLikeModel() {
  // Encoder
  var imgIn = tf.input({ shape: [784], name: "img_input" });
  var enc = tf.layers.dense({ units: 256, activation: "relu", name: "enc_dense" }).apply(imgIn);
  var mu = tf.layers.dense({ units: 16, name: "mu" }).apply(enc);
  var lv = tf.layers.dense({ units: 16, name: "logvar" }).apply(enc);

  // Reparam (named so extractDecoder can find it). Use a simple linear combination
  // — exact correctness of the reparam isn't what's under test; we just need a
  // layer matching the "reparam" name pattern that emits a [16] tensor.
  var reparam = tf.layers.dense({ units: 16, activation: "linear", name: "reparam_z" }).apply(mu);

  // Reconstruction branch (post-reparam)
  var dec1 = tf.layers.dense({ units: 256, activation: "relu", name: "dec1" }).apply(reparam);
  var dec2 = tf.layers.dense({ units: 784, activation: "sigmoid", name: "dec2" }).apply(dec1);

  // Classifier branch (from encoder, NOT from reparam)
  var cls1 = tf.layers.dense({ units: 64, activation: "relu", name: "cls1" }).apply(enc);
  var cls2 = tf.layers.dense({ units: 10, activation: "softmax", name: "cls2" }).apply(cls1);

  return tf.model({ inputs: imgIn, outputs: [dec2, cls2], name: "vae_cls" });
}

function main() {
  console.log("--- extractDecoder branched-graph regression test ---\n");

  var model = buildVaeClsLikeModel();
  console.log("Built VAE+Cls-like model with", model.outputs.length, "outputs");
  model.outputs.forEach(function (t, i) {
    console.log("  output[" + i + "] shape:", JSON.stringify(t.shape));
  });

  // Test 1: target output index 0 (reconstruction) → decoder should emit 784
  var dec0 = ModelBuilder.extractDecoder(tf, model, 16, 0);
  console.log("\nDecoder targeting output[0] (recon):");
  console.log("  outputDim:", dec0.outputDim, "(expected 784)");
  console.log("  latentDim:", dec0.latentDim);
  assert.strictEqual(
    dec0.outputDim,
    784,
    "Decoder output dim must be 784 (reconstruction), got " + dec0.outputDim
  );

  // Test 2: forward pass on the recon decoder works with random latent
  var z = tf.randomNormal([4, 16]);
  var out = dec0.model.predict(z);
  var outShape = out.shape;
  console.log("\nForward pass with z of shape [4,16]:");
  console.log("  decoder output shape:", JSON.stringify(outShape));
  assert.deepStrictEqual(outShape, [4, 784], "Decoder predict() shape mismatch");
  z.dispose(); out.dispose();

  // Test 3: backward-compat — calling without targetOutputIndex defaults to output 0
  var decDefault = ModelBuilder.extractDecoder(tf, model, 16);
  console.log("\nDecoder with no explicit index (default = output 0):");
  console.log("  outputDim:", decDefault.outputDim, "(expected 784)");
  assert.strictEqual(decDefault.outputDim, 784, "Default should target reconstruction (output 0)");

  console.log("\nPASS extractDecoder branched-graph test\n");
}

main();

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
  // This mirrors what ReparameterizeLayer.apply() actually emits in
  // src/model_builder_core.js — TWO separate TF.js layers per reparam block:
  //   reparam_noise_<id>  — Dense(units=latent, kernelInit="zeros") on logvar
  //   reparam_add_<id>    — Add layer combining mu + noiseProj → z
  // The decoder consumes reparam_add_*, NOT reparam_noise_*. A previous
  // version of the test used a single "reparam_z" dense layer and missed the
  // bug where extractDecoder picked the wrong reparam-prefixed layer.
  var imgIn = tf.input({ shape: [784], name: "img_input" });
  var enc = tf.layers.dense({ units: 256, activation: "relu", name: "enc_dense" }).apply(imgIn);
  var mu = tf.layers.dense({ units: 16, name: "mu" }).apply(enc);
  var lv = tf.layers.dense({ units: 16, name: "logvar" }).apply(enc);

  // Reparam block — two layers, matching production topology
  var noiseProj = tf.layers.dense({
    units: 16, activation: "linear",
    kernelInitializer: "zeros", biasInitializer: "zeros",
    name: "reparam_noise_6",
  }).apply(lv);
  var z = tf.layers.add({ name: "reparam_add_6" }).apply([mu, noiseProj]);

  // Reconstruction branch (post-reparam)
  var dec1 = tf.layers.dense({ units: 256, activation: "relu", name: "dec1" }).apply(z);
  var dec2 = tf.layers.dense({ units: 784, activation: "sigmoid", name: "dec2" }).apply(dec1);

  // Classifier branch (from encoder, NOT from reparam)
  var cls1 = tf.layers.dense({ units: 64, activation: "relu", name: "cls1" }).apply(enc);
  var cls2 = tf.layers.dense({ units: 10, activation: "softmax", name: "cls2" }).apply(cls1);

  return tf.model({ inputs: imgIn, outputs: [dec2, cls2], name: "vae_cls" });
}

async function main() {
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

  // Test 4: deep decoder paths must not be rejected by an arbitrary hop cap.
  var deepInput = tf.input({ shape: [784], name: "deep_img" });
  var deepEnc = tf.layers.dense({ units: 16, name: "deep_enc" }).apply(deepInput);
  var deepNoise = tf.layers.dense({ units: 16, name: "deep_reparam_noise_1" }).apply(deepEnc);
  var deepLatent = tf.layers.add({ name: "deep_reparam_add_1" }).apply([deepEnc, deepNoise]);
  var deepX = deepLatent;
  for (var di = 0; di < 270; di++) {
    deepX = tf.layers.dense({ units: 16, activation: "relu", name: "deep_dec_" + di }).apply(deepX);
  }
  var deepOut = tf.layers.dense({ units: 784, name: "deep_out" }).apply(deepX);
  var deepModel = tf.model({ inputs: deepInput, outputs: [deepOut], name: "deep_decoder_model" });
  var deepDec = ModelBuilder.extractDecoder(tf, deepModel, 16, 0);
  console.log("\nDeep decoder path (>256 layers):");
  console.log("  outputDim:", deepDec.outputDim, "(expected 784)");
  assert.strictEqual(deepDec.outputDim, 784, "Deep decoder path should not fail due to a hop cap");

  // Test 5: extractDecoder must FAIL LOUD if backward trace cannot reach the
  // chosen latent layer. Build a model where the recon path doesn't pass
  // through any reparam-named layer at all — the function should throw
  // rather than silently emit a [latent_dim] tensor that would crash the
  // browser later with a confusing shape mismatch.
  var imgIn = tf.input({ shape: [784], name: "img" });
  var enc = tf.layers.dense({ units: 256, name: "enc" }).apply(imgIn);
  var lat = tf.layers.dense({ units: 16, name: "fake_reparam_add" }).apply(enc);
  // recon path bypasses the latent — directly from enc to output
  var dec1b = tf.layers.dense({ units: 256, name: "decB" }).apply(enc);
  var outB = tf.layers.dense({ units: 784, name: "outB" }).apply(dec1b);
  // classifier from latent (so the pretrained-style "reparam_add_*" is reachable
  // from output 1, but recon at output 0 isn't downstream of it)
  var clsB = tf.layers.dense({ units: 10, name: "clsB" }).apply(lat);
  var disjointModel = tf.model({ inputs: imgIn, outputs: [outB, clsB], name: "disjoint" });
  var threw = false;
  var threwMsg = "";
  try {
    ModelBuilder.extractDecoder(tf, disjointModel, 16, 0);
  } catch (err) {
    threw = true;
    threwMsg = String(err && err.message || err);
  }
  console.log("\nNegative test — recon not downstream of latent layer:");
  console.log("  threw:", threw);
  if (threw) console.log("  message:", threwMsg.slice(0, 120) + (threwMsg.length > 120 ? "…" : ""));
  assert.ok(threw, "extractDecoder must throw when backward trace cannot reach the latent layer");
  assert.ok(/did not reach|latent/.test(threwMsg), "error message should explain the missed-reparam case");

  // Test 5: TF.js client-side VAE training smoke test.
  // Codex caught a regression where the reparameterize layer used tf.shape
  // (which doesn't exist in some TF.js builds) and registered without a
  // static className (so the registry didn't actually pick it up). Both
  // surface only when you actually call model.fit() — graph construction
  // passes either way. This test runs a 1-step fit on a tiny VAE-shaped
  // model that goes through ReparameterizeLayer.apply() in train mode.
  console.log("\nClient-side VAE fit() smoke test:");
  var fitImg = tf.input({ shape: [16], name: "fit_img" });
  var fitMu = tf.layers.dense({ units: 4, name: "fit_mu" }).apply(fitImg);
  var fitLv = tf.layers.dense({ units: 4, name: "fit_lv" }).apply(fitImg);
  // Use the actual ReparameterizeLayer from model_builder_core (not a stub).
  // We grab it indirectly by running buildModelFromGraph above — that ensures
  // the layer class is constructed and registered by the same code path the
  // browser exercises.
  var fitGraph = {
    drawflow: { Home: { data: {
      "1": { name: "input_layer", data: { mode: "flat" }, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } } },
      "2": { name: "dense_layer", data: { units: 4, activation: "relu" }, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }, { node: "4", input: "input_1" }] } } },
      "3": { name: "latent_mu_layer", data: { units: 4, group: "z" }, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "5", input: "input_1" }] } } },
      "4": { name: "latent_logvar_layer", data: { units: 4, group: "z" }, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "5", input: "input_2" }] } } },
      "5": { name: "reparam_layer", data: { units: 4, group: "z", beta: 0.001 }, inputs: { input_1: { connections: [{ node: "3", output: "output_1" }] }, input_2: { connections: [{ node: "4", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "6", input: "input_1" }] } } },
      "6": { name: "dense_layer", data: { units: 16, activation: "sigmoid" }, inputs: { input_1: { connections: [{ node: "5", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "7", input: "input_1" }] } } },
      "7": { name: "output_layer", data: { target: "x", targetType: "x", loss: "mse", headType: "reconstruction", units: 16 }, inputs: { input_1: { connections: [{ node: "6", output: "output_1" }] } }, outputs: {} },
    } } }
  };
  var built = ModelBuilder.buildModelFromGraph(tf, fitGraph, {
    mode: "direct", featureSize: 16, windowSize: 1, seqFeatureSize: 16,
    allowedOutputKeys: [{ key: "x", featureSize: 16 }], defaultTarget: "x", numClasses: 0,
  });
  console.log("  built model outputs:", built.model.outputs.length);
  built.model.compile({ optimizer: "adam", loss: "meanSquaredError" });
  var X = tf.randomNormal([8, 16]);
  // built.model has TWO outputs: recon (target=x) and latent_kl (target=zeros).
  // Auto-injected by buildModelFromGraph for VAE-style graphs — we have to
  // feed both for fit() to dispatch.
  var Y_recon = X;
  var Y_kl = tf.zeros([8, 8]);  // latent_kl tensor is concat(mu, logvar) = 4 + 4 dims
  var fitErr = null;
  try {
    var hist = await built.model.fit(X, [Y_recon, Y_kl], { epochs: 1, batchSize: 4, verbose: 0 });
    console.log("  fit() ran. loss after 1 epoch:", hist.history.loss[0].toFixed(6));
  } catch (e) {
    fitErr = e;
    console.log("  fit() threw:", String(e && e.message || e).slice(0, 150));
  }
  X.dispose(); Y_kl.dispose();
  assert.strictEqual(fitErr, null, "TF.js VAE client-side fit() must not throw (was: tf.shape is not a function)");

  // Test 6: ReparameterizeLayer is actually registered for serialization.
  // Codex pointed out the previous registration call hid failures — verify
  // the layer is in the className map.
  console.log("\nReparameterizeLayer serialization registration:");
  var classMap = tf.serialization && tf.serialization.SerializationMap
    && tf.serialization.SerializationMap.getMap()
    && tf.serialization.SerializationMap.getMap().classNameMap;
  var registered = !!(classMap && classMap.ReparameterizeLayer);
  console.log("  registered:", registered);
  assert.ok(registered, "ReparameterizeLayer must be registered with tf.serialization (saved checkpoints fail to load otherwise)");

  console.log("\nPASS extractDecoder branched-graph test\n");
}

main().catch(function (e) {
  console.error("Test failed:", e && e.message || e);
  process.exit(1);
});

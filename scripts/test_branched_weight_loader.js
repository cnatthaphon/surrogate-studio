"use strict";
/**
 * Regression test for branched multi-output pretrained loading.
 *
 * Codex caught a P1 in PR #61: server export names output-head weights
 * `tfjs_out_<id>.weight|bias` while the browser model_builder names them
 * `head_<id>/kernel|bias`. canonicalizeWeightName mapped `out_<id>` to
 * `n<id>/...` (matching Dense layers, not heads), so name-based matching
 * for the classifier head failed and load fell through to positional
 * order. On branched VAE+Classifier graphs, positional order doesn't
 * line up with the browser's topological order — classifier weights
 * landed on recon-path layers, the classifier output became constant,
 * the gradient through the latent was zero, and classifier-guided
 * generation couldn't steer.
 *
 * This test asserts:
 *   1. Loading m6_vae_classifier_pretrained.js completes via mode="name"
 *      (not "positional"). Every named spec must match a model weight.
 *   2. After loading, the classifier output varies with input — i.e. it
 *      is not a constant. Without proper weight assignment the head
 *      collapses to a fixed bias-only response.
 */
var fs = require("fs");
var path = require("path");
var assert = require("assert");
var tf;
try { tf = require("@tensorflow/tfjs"); } catch (e) { tf = require("@tensorflow/tfjs-node"); }

global.window = global;
require(path.resolve(__dirname, "..", "src", "schema_registry.js"));
require(path.resolve(__dirname, "..", "src", "schema_definitions_builtin.js"));
var ModelBuilder = require(path.resolve(__dirname, "..", "src", "model_builder_core.js"));
var WeightConverter = require(path.resolve(__dirname, "..", "src", "weight_converter.js"));

require(path.resolve(__dirname, "..", "demo", "Fashion-MNIST-Benchmark", "preset.js"));

function decodePretrained(filePath) {
  var txt = fs.readFileSync(filePath, "utf8");
  var m = txt.match(/=\s*"([A-Za-z0-9+/=]+)"/);
  if (!m) throw new Error("No base64 blob in " + filePath);
  var buf = Buffer.from(m[1], "base64");
  var metaLen = buf.readUInt32LE(0);
  var meta = JSON.parse(buf.slice(4, 4 + metaLen).toString("utf8"));
  var weightFloats = meta.weightSpecs.reduce(function (s, sp) {
    return s + sp.shape.reduce(function (a, b) { return a * b; }, 1);
  }, 0);
  var aligned = new ArrayBuffer(weightFloats * 4);
  new Uint8Array(aligned).set(new Uint8Array(buf.buffer, buf.byteOffset + 4 + metaLen, weightFloats * 4));
  return {
    weightSpecs: meta.weightSpecs,
    weightValues: Array.from(new Float32Array(aligned)),
    metrics: meta.metrics,
  };
}

async function main() {
  console.log("--- Branched weight loader regression test ---\n");

  var preset = global.FASHION_MNIST_BENCHMARK_PRESET;
  var vaeClsModel = preset.models.find(function (m) { return m.id === "m-vae-cls"; });
  assert(vaeClsModel, "m-vae-cls model in preset");

  var build = ModelBuilder.buildModelFromGraph(tf, vaeClsModel.graph, {
    mode: "direct", featureSize: 784, windowSize: 1, seqFeatureSize: 784,
    allowedOutputKeys: [
      { key: "pixel_values", headType: "reconstruction", featureSize: 784 },
      { key: "label", headType: "classification" },
    ],
    defaultTarget: "pixel_values", numClasses: 10,
  });
  console.log("Built VAE+Cls model:");
  console.log("  outputs:", build.model.outputs.length);
  console.log("  weights:", build.model.weights.length);

  var artifactPath = path.resolve(__dirname, "..", "demo", "Fashion-MNIST-Benchmark", "m6_vae_classifier_pretrained.js");
  var artifacts = decodePretrained(artifactPath);
  console.log("\nLoaded artifact specs:");
  artifacts.weightSpecs.forEach(function (sp) {
    console.log("  " + sp.name + "  [" + sp.shape.join(",") + "]");
  });

  var result = WeightConverter.loadArtifactsIntoModel(tf, build.model, artifacts);
  console.log("\nLoad result:", JSON.stringify({
    loaded: result.loaded,
    mode: result.mode,
    matched: result.matched,
    namedSpecs: result.namedSpecs,
    totalModelWeights: result.totalModelWeights,
  }));

  assert.strictEqual(result.loaded, true, "loadArtifactsIntoModel must succeed");
  assert.strictEqual(result.mode, "name",
    "Branched VAE+Cls weights MUST load by NAME (got " + result.mode + "). " +
    "Positional fallback corrupts the classifier head — see Codex review on PR #61."
  );
  assert.strictEqual(result.matched, build.model.weights.length,
    "All " + build.model.weights.length + " browser weights must be matched, got " + result.matched
  );

  // Test 2: classifier output must vary with input (not constant).
  // After weight corruption, the classifier's class-probabilities become a
  // constant tensor regardless of input — gradient is zero, classifier-
  // guided generation can't steer. With proper name-loading, different
  // inputs produce different class distributions.
  var batch1 = tf.zeros([4, 784]);
  var batch2 = tf.randomUniform([4, 784], 0, 1);
  var pred1 = build.model.predict(batch1);
  var pred2 = build.model.predict(batch2);
  // VAE+Cls outputs [recon, classProbs]; classifier head is index 1.
  var cls1 = Array.isArray(pred1) ? pred1[1] : pred1;
  var cls2 = Array.isArray(pred2) ? pred2[1] : pred2;

  var diff = tf.tidy(function () { return cls2.sub(cls1).abs().mean().arraySync(); });
  console.log("\nClassifier output divergence between zero and random inputs:");
  console.log("  mean |cls2 - cls1| =", diff.toExponential(3));

  batch1.dispose(); batch2.dispose();
  if (Array.isArray(pred1)) pred1.forEach(function (t) { t.dispose(); }); else pred1.dispose();
  if (Array.isArray(pred2)) pred2.forEach(function (t) { t.dispose(); }); else pred2.dispose();

  assert.ok(diff > 1e-4,
    "Classifier output must vary with input after pretrained load (got " +
    diff.toExponential(3) + "). Constant output indicates corrupted weights " +
    "from positional load on branched graph."
  );

  console.log("\nPASS branched weight loader test\n");
}

main().catch(function (e) {
  console.error("Test failed:", e && e.message || e);
  process.exit(1);
});

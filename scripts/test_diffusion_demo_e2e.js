/**
 * Headless E2E test for Fashion-MNIST Diffusion demo:
 * 1. Load preset + pretrained weights
 * 2. Build all 4 models
 * 3. Load pretrained weights into models
 * 4. Run reconstruct + DDPM generation
 * 5. Verify output is valid
 *
 * Run: node scripts/test_diffusion_demo_e2e.js
 */
"use strict";
global.window = global;

var tf = require("@tensorflow/tfjs");
var mb = require("../src/model_builder_core.js");
var ge = require("../src/generation_engine_core.js");
var fs = require("fs");
var path = require("path");

var DEMO = path.resolve(__dirname, "../demo/Fashion-MNIST-Diffusion");

// Load pretrained weight files
["mlp_denoiser", "mlp_ddpm", "ncsn", "score_sde"].forEach(function (name) {
  eval(fs.readFileSync(path.join(DEMO, name + "_pretrained.js"), "utf8"));
});

// Load preset
eval(fs.readFileSync(path.join(DEMO, "preset.js"), "utf8"));
var preset = window.FASHION_MNIST_DIFFUSION_PRESET;

var PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; process.stdout.write("  \u2713 " + msg + "\n"); }
  else { FAIL++; process.stdout.write("  \u2717 FAIL: " + msg + "\n"); }
}

// Parse binary weight format (same as index.html loader)
function parseBinaryWeights(b64) {
  var buf = Buffer.from(b64, "base64");
  var metaLen = buf.readUInt32LE(0);
  var meta = JSON.parse(buf.slice(4, 4 + metaLen).toString("utf8"));
  var specs = meta.weightSpecs || [];
  var offset = 4 + metaLen;
  var totalFloats = specs.reduce(function (s, sp) { return s + sp.shape.reduce(function (a, b) { return a * b; }, 1); }, 0);
  var weightBytes = buf.slice(offset, offset + totalFloats * 4);
  // Copy to aligned buffer
  var aligned = new ArrayBuffer(totalFloats * 4);
  new Uint8Array(aligned).set(new Uint8Array(weightBytes.buffer, weightBytes.byteOffset, weightBytes.byteLength));
  return { meta: meta, specs: specs, values: Array.from(new Float32Array(aligned)) };
}

function stripSuffix(n) { return String(n || "").replace(/_\d+$/, ""); }

// Load weights into model by name matching
function loadWeightsIntoModel(model, specs, values) {
  var savedMap = {};
  var off = 0;
  specs.forEach(function (sp) {
    var sz = sp.shape.reduce(function (a, b) { return a * b; }, 1);
    savedMap[stripSuffix(sp.name)] = { offset: off, size: sz, shape: sp.shape };
    off += sz;
  });
  var flatValues = new Float32Array(values);
  var newWeights = [];
  var matched = 0;
  model.weights.forEach(function (mw) {
    var key = stripSuffix(mw.name);
    var saved = savedMap[key];
    if (saved && saved.size === mw.shape.reduce(function (a, b) { return a * b; }, 1)) {
      newWeights.push(tf.tensor(flatValues.subarray(saved.offset, saved.offset + saved.size), mw.shape));
      matched++;
    } else {
      newWeights.push(mw.read());
    }
  });
  if (matched === model.weights.length) model.setWeights(newWeights);
  return matched;
}

// Pre-trained trainers
var pretrainedTrainers = preset.trainers.filter(function (t) { return t._pretrainedVar && t.status === "done"; });
assert(pretrainedTrainers.length === 4, "4 pre-trained trainers found");

var testIdx = 0;
function nextTest() {
  if (testIdx >= pretrainedTrainers.length) {
    console.log("\n=============================");
    console.log("TOTAL: " + PASS + " PASS, " + FAIL + " FAIL");
    console.log("=============================");
    process.exit(FAIL > 0 ? 1 : 0);
  }

  var trainer = pretrainedTrainers[testIdx++];
  var model = preset.models.find(function (m) { return m.id === trainer.modelId; });
  console.log("\n=== " + model.name + " ===");

  // 1. Parse weights
  var b64 = window[trainer._pretrainedVar];
  assert(!!b64, "pretrained data exists: " + trainer._pretrainedVar);
  var parsed = parseBinaryWeights(b64);
  assert(parsed.specs.length > 0, "weight specs: " + parsed.specs.length + " tensors");

  // 2. Build model
  var built;
  try {
    built = mb.buildModelFromGraph(tf, model.graph, {
      mode: "direct", featureSize: 784, windowSize: 1, seqFeatureSize: 784,
      allowedOutputKeys: [{ key: "pixel_values", headType: "reconstruction" }],
      defaultTarget: "pixel_values", numClasses: 10,
    });
    assert(true, "build OK");
  } catch (e) {
    assert(false, "build: " + e.message);
    nextTest(); return;
  }

  // 3. Load pretrained weights
  var matched = loadWeightsIntoModel(built.model, parsed.specs, parsed.values);
  assert(matched === built.model.weights.length, "weights loaded: " + matched + "/" + built.model.weights.length);

  // 4. Reconstruct test
  var testData = [];
  for (var i = 0; i < 4; i++) {
    var row = []; for (var j = 0; j < 784; j++) row.push(Math.random() * 0.5 + 0.25);
    testData.push(row);
  }

  ge.generate(tf, {
    model: built.model, inputNodes: built.inputNodes,
    headConfigs: built.headConfigs,
    method: "reconstruct",
    originals: testData,
    numSamples: 4, seed: 42,
  }).then(function (result) {
    assert(result.samples && result.samples.length === 4, "reconstruct: 4 samples");
    assert(result.avgMse != null && !isNaN(result.avgMse), "reconstruct MSE: " + result.avgMse.toFixed(4));

    // 5. DDPM generation
    return ge.generate(tf, {
      model: built.model, inputNodes: built.inputNodes,
      headConfigs: built.headConfigs,
      method: "ddpm",
      numSamples: 4, steps: 10, seed: 42,
      latentDim: 784,
    });
  }).then(function (result) {
    assert(result.samples && result.samples.length === 4, "ddpm: 4 samples");
    // Check output is not all zeros/NaN
    var sum = 0, hasNaN = false;
    result.samples[0].forEach(function (v) {
      if (isNaN(v)) hasNaN = true;
      sum += Math.abs(v);
    });
    assert(!hasNaN, "ddpm: no NaN in output");
    assert(sum > 0, "ddpm: non-zero output (sum=" + sum.toFixed(2) + ")");

    built.model.dispose();
    nextTest();
  }).catch(function (e) {
    assert(false, "generation error: " + e.message);
    built.model.dispose();
    nextTest();
  });
}

nextTest();

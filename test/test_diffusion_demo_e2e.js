"use strict";

global.window = global;
var fs = require("fs");
var tf = require("@tensorflow/tfjs");
var mb = require("../src/model_builder_core.js");
var gen = require("../src/generation_engine_core.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  eval(fs.readFileSync("./demo/Fashion-MNIST-Diffusion/preset.js", "utf8"));
  var preset = window.FASHION_MNIST_DIFFUSION_PRESET;
  assert(preset, "diffusion preset loaded");

  var allowedOutputKeys = [{ key: "pixel_values", headType: "reconstruction" }];

  function build(modelId) {
    var rec = preset.models.find(function (m) { return m.id === modelId; });
    assert(rec, "model exists: " + modelId);
    return mb.buildModelFromGraph(tf, rec.graph, {
      mode: "direct",
      featureSize: 784,
      windowSize: 1,
      seqFeatureSize: 784,
      allowedOutputKeys: allowedOutputKeys,
      defaultTarget: "pixel_values",
      numClasses: 10,
    });
  }

  Promise.resolve()
    .then(function () {
      console.log("--- Diffusion Demo Tests ---");

      var ddpm = build("m-mlp-ddpm");
      assert(ddpm.model.inputs.length === 2, "DDPM graph builds with image + timestep inputs");
      assert(ddpm.inputNodes.some(function (n) { return n.name === "time_embed_layer"; }), "DDPM exposes time_embed input node");
      return gen.generate(tf, {
        method: "ddpm",
        model: ddpm.model,
        latentDim: 784,
        numSamples: 2,
        steps: 4,
        outputIndex: 0,
      }).then(function (result) {
        assert(result.samples.length === 2, "ddpm returns 2 samples");
        assert(result.samples[0].length === 784, "ddpm sample has image dimension");
        ddpm.model.dispose();
        console.log("  PASS: DDPM generate");
      });
    })
    .then(function () {
      var ncsn = build("m-ncsn");
      assert(ncsn.model.inputs.length === 2, "NCSN graph builds with image + timestep inputs");
      return gen.generate(tf, {
        method: "langevin",
        model: ncsn.model,
        latentDim: 784,
        numSamples: 2,
        steps: 3,
        lr: 0.01,
        outputIndex: 0,
      }).then(function (result) {
        assert(result.samples.length === 2, "langevin returns 2 samples");
        assert(result.samples[0].length === 784, "langevin sample has image dimension");
        ncsn.model.dispose();
        console.log("  PASS: Langevin generate");
      });
    })
    .then(function () {
      var sde = build("m-score-sde");
      assert(sde.model.inputs.length === 2, "Score SDE graph builds with image + timestep inputs");
      return gen.generate(tf, {
        method: "ddpm",
        model: sde.model,
        latentDim: 784,
        numSamples: 2,
        steps: 4,
        outputIndex: 0,
      }).then(function (result) {
        assert(result.samples.length === 2, "score sde returns 2 samples");
        assert(result.samples[0].length === 784, "score sde sample has image dimension");
        sde.model.dispose();
        console.log("  PASS: Score SDE generate");
      });
    })
    .then(function () {
      var den = build("m-mlp-denoiser");
      var originals = [new Array(784).fill(0.5), new Array(784).fill(0.25)];
      return gen.generate(tf, {
        method: "reconstruct",
        model: den.model,
        fullModel: den.model,
        originals: originals,
        numSamples: 2,
        outputIndex: 0,
      }).then(function (result) {
        assert(result.samples.length === 2, "reconstruct returns 2 samples");
        assert(result.samples[0].length === 784, "reconstruct sample has image dimension");
        den.model.dispose();
        console.log("  PASS: Reconstruct generate");
      });
    })
    .then(function () {
      console.log("PASS test_diffusion_demo_e2e");
    })
    .catch(function (err) {
      console.error("FAIL:", err.message);
      console.error(err.stack);
      process.exit(1);
    });
}

main();

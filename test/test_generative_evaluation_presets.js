"use strict";

global.window = global;
const fs = require("fs");
const assert = require("assert");

function run() {
  eval(fs.readFileSync("./demo/Fashion-MNIST-GAN/preset.js", "utf8"));
  eval(fs.readFileSync("./demo/Fashion-MNIST-Diffusion/preset.js", "utf8"));

  const ganPreset = window.FASHION_MNIST_GAN_PRESET;
  const diffusionPreset = window.FASHION_MNIST_DIFFUSION_PRESET;

  assert.ok(ganPreset && Array.isArray(ganPreset.evaluations), "GAN preset exposes evaluations");
  assert.ok(diffusionPreset && Array.isArray(diffusionPreset.evaluations), "Diffusion preset exposes evaluations");

  const ganEval = ganPreset.evaluations.find((item) => item.id === "e-gan-pretrained-quality");
  assert.ok(ganEval, "GAN generative evaluation preset exists");
  assert.strictEqual(ganEval.runMode, "generate");
  assert.ok(ganEval.evaluatorIds.indexOf("mmd_rbf") >= 0, "GAN eval includes MMD");

  const diffGenEval = diffusionPreset.evaluations.find((item) => item.id === "e-diff-generation-quality");
  const diffReconEval = diffusionPreset.evaluations.find((item) => item.id === "e-diff-reconstruction-quality");
  assert.ok(diffGenEval, "Diffusion generation evaluation preset exists");
  assert.ok(diffReconEval, "Diffusion reconstruction evaluation preset exists");
  assert.strictEqual(diffReconEval.generationConfig.method, "reconstruct");
  assert.ok(diffGenEval.evaluatorIds.indexOf("nn_coverage") >= 0, "Diffusion generation eval includes NN coverage");

  console.log("PASS test_generative_evaluation_presets");
}

run();

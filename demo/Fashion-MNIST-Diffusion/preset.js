/**
 * Fashion-MNIST Diffusion Demo — Iterative Denoising Models
 *
 * Three models demonstrating denoising-based generative modeling:
 * 1. MLP Denoiser — simple noise→clean prediction (baseline)
 * 2. MLP DDPM — timestep-conditioned denoiser (Ho et al. 2020)
 * 3. Conv DDPM — convolutional denoiser with timestep (Radford-style)
 *
 * All use MSE loss: predict clean image from noisy input.
 * Generation: iterative DDPM denoising from pure noise.
 *
 * References:
 *   Ho, Jain & Abbeel, "Denoising Diffusion Probabilistic Models", NeurIPS 2020
 *   Song & Ermon, "Generative Modeling by Estimating Gradients of the Data Distribution", NeurIPS 2019
 */
(function () {
  "use strict";

  var _nid = 0;
  function N(d, name, data, x, y) {
    _nid++;
    d[String(_nid)] = {
      id: _nid, name: name + "_layer", data: data || {}, class: name + "_layer",
      html: "<div><div>" + name + "_layer</div></div>", typenode: false,
      inputs: {}, outputs: {}, pos_x: x, pos_y: y,
    };
    return String(_nid);
  }
  function C(d, from, to, op, ip) {
    op = op || "output_1"; ip = ip || "input_1";
    if (!d[from].outputs[op]) d[from].outputs[op] = { connections: [] };
    d[from].outputs[op].connections.push({ node: to, input: ip });
    if (!d[to].inputs[ip]) d[to].inputs[ip] = { connections: [] };
    d[to].inputs[ip].connections.push({ node: from, output: op });
  }
  function graph(d) { return { drawflow: { Home: { data: d } } }; }

  // ═══════════════════════════════════════════
  // Model 1: MLP Denoiser (baseline)
  // ═══════════════════════════════════════════
  function _mlpDenoiser() {
    _nid = 0; var d = {};
    var img = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 100);
    var noise = N(d, "noise_injection", { scale: 0.3, schedule: "constant" }, 240, 100);
    var d1 = N(d, "dense", { units: 512, activation: "relu" }, 400, 100);
    var d2 = N(d, "dense", { units: 256, activation: "relu" }, 560, 100);
    var d3 = N(d, "dense", { units: 512, activation: "relu" }, 720, 100);
    var d4 = N(d, "dense", { units: 784, activation: "sigmoid" }, 880, 100);
    var out = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", headType: "reconstruction" }, 1040, 100);
    C(d, img, noise); C(d, noise, d1); C(d, d1, d2); C(d, d2, d3); C(d, d3, d4); C(d, d4, out);
    return graph(d);
  }

  // ═══════════════════════════════════════════
  // Model 2: MLP DDPM (Ho 2020) — with timestep conditioning
  // ═══════════════════════════════════════════
  function _mlpDdpm() {
    _nid = 0; var d = {};
    // Noisy image input
    var img = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 80);
    var noise = N(d, "noise_injection", { scale: 0.5, schedule: "linear" }, 240, 80);

    // Timestep embedding
    var tEmb = N(d, "time_embed", { dim: 64 }, 80, 200);

    // Concat noisy image + timestep
    // Feature concat — uses name "concat_block" (no _layer suffix per Drawflow convention)
    _nid++; var _cid = String(_nid);
    d[_cid] = { id: _nid, name: "concat_block", data: {}, class: "concat_block", html: "<div><div>Concat</div></div>", typenode: false, inputs: {}, outputs: {}, pos_x: 400, pos_y: 140 };
    var cat = _cid;
    C(d, noise, cat, "output_1", "input_1");
    C(d, tEmb, cat, "output_1", "input_2");

    // Denoiser network
    var d1 = N(d, "dense", { units: 512, activation: "relu" }, 560, 140);
    var ln1 = N(d, "layernorm", {}, 640, 140);
    var d2 = N(d, "dense", { units: 256, activation: "relu" }, 720, 140);
    var ln2 = N(d, "layernorm", {}, 800, 140);
    var d3 = N(d, "dense", { units: 512, activation: "relu" }, 880, 140);
    var d4 = N(d, "dense", { units: 784, activation: "sigmoid" }, 1040, 140);
    var out = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", headType: "reconstruction" }, 1200, 140);
    C(d, cat, d1); C(d, d1, ln1); C(d, ln1, d2); C(d, d2, ln2); C(d, ln2, d3); C(d, d3, d4); C(d, d4, out);

    C(d, img, noise);

    return graph(d);
  }

  var DS = "demo-diff-ds";
  var sid = "fashion_mnist";

  window.FASHION_MNIST_DIFFUSION_PRESET = {
    dataset: {
      id: DS, name: "Fashion-MNIST (60000)", schemaId: sid, status: "draft",
      config: { seed: 42, splitMode: "stratified_label", trainFrac: 0.8, valFrac: 0.1, testFrac: 0.1, totalCount: 6000, useFullSource: true, classFilter: [0] },
      data: null, createdAt: Date.now(),
    },
    models: [
      { id: "m-mlp-denoiser", name: "1. MLP Denoiser (baseline)",    schemaId: sid, graph: _mlpDenoiser(), createdAt: Date.now() },
      { id: "m-mlp-ddpm",     name: "2. MLP DDPM (Ho 2020)",         schemaId: sid, graph: _mlpDdpm(),     createdAt: Date.now() },
    ],
    trainers: [
      { id: "t-mlp-denoiser", name: "MLP Denoiser Trainer", schemaId: sid, datasetId: DS, modelId: "m-mlp-denoiser", status: "draft",
        config: { epochs: 50, batchSize: 128, learningRate: 0.001, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 10, lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
      { id: "t-mlp-ddpm", name: "MLP DDPM Trainer", schemaId: sid, datasetId: DS, modelId: "m-mlp-ddpm", status: "draft",
        config: { epochs: 100, batchSize: 128, learningRate: 0.001, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 15, lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
    ],
    generations: [
      { id: "g-denoiser-recon", name: "Denoiser Reconstruct", schemaId: sid, trainerId: "t-mlp-denoiser", family: "diffusion", config: { method: "reconstruct", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-ddpm-gen",      name: "DDPM Generate",         schemaId: sid, trainerId: "t-mlp-ddpm",     family: "diffusion", config: { method: "ddpm", numSamples: 16, steps: 50, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-ddpm-recon",    name: "DDPM Reconstruct",      schemaId: sid, trainerId: "t-mlp-ddpm",     family: "diffusion", config: { method: "reconstruct", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
    ],
    evaluations: [],
  };
})();

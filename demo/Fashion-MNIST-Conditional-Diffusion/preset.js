/**
 * Fashion-MNIST Conditional Diffusion Demo
 *
 * Class-conditioned denoising: model learns to denoise while receiving
 * a one-hot class label, enabling targeted generation of specific classes.
 *
 * 3 classes: T-shirt/top (0), Trouser (1), Sneaker (7)
 * 2 models:
 *   1. Conditional MLP DDPM — timestep + class conditioning
 *   2. Conditional MLP Denoiser — class conditioning only (no timestep)
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

  // Concat block helper (no _layer suffix per Drawflow convention)
  function CAT(d, x, y) {
    _nid++;
    var cid = String(_nid);
    d[cid] = { id: _nid, name: "concat_block", data: {}, class: "concat_block",
      html: "<div><div>Concat</div></div>", typenode: false,
      inputs: {}, outputs: {}, pos_x: x, pos_y: y };
    return cid;
  }

  var NUM_CLASSES = 3; // T-shirt(0), Trouser(1), Sneaker(7)

  // ═══════════════════════════════════════════
  // Model 1: Conditional MLP DDPM
  // Inputs: noisy image + time embedding + class one-hot
  // ═══════════════════════════════════════════
  function _condDdpm() {
    _nid = 0; var d = {};
    var img = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 80);
    var noise = N(d, "noise_injection", { scale: 0.5, schedule: "linear" }, 240, 80);

    var tEmb = N(d, "time_embed", { dim: 64 }, 80, 200);
    var cEmb = N(d, "class_embed", { numClasses: NUM_CLASSES }, 80, 300);

    // Concat: noisy image + time + class
    var cat1 = CAT(d, 400, 100);
    C(d, noise, cat1, "output_1", "input_1");
    C(d, tEmb, cat1, "output_1", "input_2");
    var cat2 = CAT(d, 500, 140);
    C(d, cat1, cat2, "output_1", "input_1");
    C(d, cEmb, cat2, "output_1", "input_2");

    // Denoiser: 512 → LayerNorm → 256 → LayerNorm → 512 → 784
    var d1 = N(d, "dense", { units: 512, activation: "relu" }, 620, 140);
    var ln1 = N(d, "layernorm", {}, 700, 140);
    var d2 = N(d, "dense", { units: 256, activation: "relu" }, 780, 140);
    var ln2 = N(d, "layernorm", {}, 860, 140);
    var d3 = N(d, "dense", { units: 512, activation: "relu" }, 940, 140);
    var d4 = N(d, "dense", { units: 784, activation: "sigmoid" }, 1060, 140);
    var out = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", headType: "reconstruction" }, 1200, 140);
    C(d, cat2, d1); C(d, d1, ln1); C(d, ln1, d2); C(d, d2, ln2); C(d, ln2, d3); C(d, d3, d4); C(d, d4, out);

    C(d, img, noise);
    return graph(d);
  }

  // ═══════════════════════════════════════════
  // Model 2: Conditional MLP Denoiser (no timestep, simpler)
  // Inputs: noisy image + class one-hot
  // ═══════════════════════════════════════════
  function _condDenoiser() {
    _nid = 0; var d = {};
    var img = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 100);
    var noise = N(d, "noise_injection", { scale: 0.3, schedule: "constant" }, 240, 100);
    var cEmb = N(d, "class_embed", { numClasses: NUM_CLASSES }, 80, 220);

    // Concat: noisy image + class
    var cat = CAT(d, 400, 140);
    C(d, noise, cat, "output_1", "input_1");
    C(d, cEmb, cat, "output_1", "input_2");

    var d1 = N(d, "dense", { units: 512, activation: "relu" }, 560, 140);
    var d2 = N(d, "dense", { units: 256, activation: "relu" }, 720, 140);
    var d3 = N(d, "dense", { units: 512, activation: "relu" }, 880, 140);
    var d4 = N(d, "dense", { units: 784, activation: "sigmoid" }, 1040, 140);
    var out = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", headType: "reconstruction" }, 1200, 140);
    C(d, cat, d1); C(d, d1, d2); C(d, d2, d3); C(d, d3, d4); C(d, d4, out);

    C(d, img, noise);
    return graph(d);
  }

  var DS = "demo-cond-diff-ds";
  var sid = "fashion_mnist";

  window.FASHION_MNIST_COND_DIFFUSION_PRESET = {
    dataset: {
      id: DS, name: "Fashion-MNIST (3 classes)", schemaId: sid, status: "draft",
      config: { seed: 42, splitMode: "stratified_label", trainFrac: 0.8, valFrac: 0.1, testFrac: 0.1,
                totalCount: 6000, useFullSource: true, classFilter: [0, 1, 7] },
      data: null, createdAt: Date.now(),
    },
    models: [
      { id: "m-cond-ddpm",     name: "1. Conditional DDPM",     schemaId: sid, graph: _condDdpm(),     createdAt: Date.now() },
      { id: "m-cond-denoiser", name: "2. Conditional Denoiser", schemaId: sid, graph: _condDenoiser(), createdAt: Date.now() },
    ],
    trainers: [
      { id: "t-cond-ddpm", name: "Cond. DDPM Trainer", schemaId: sid, datasetId: DS, modelId: "m-cond-ddpm", status: "draft",
        config: { epochs: 50, batchSize: 128, learningRate: 0.001, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 10, lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
      { id: "t-cond-denoiser", name: "Cond. Denoiser Trainer", schemaId: sid, datasetId: DS, modelId: "m-cond-denoiser", status: "draft",
        config: { epochs: 50, batchSize: 128, learningRate: 0.001, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 10, lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
      // Pre-trained
      { id: "t-cond-ddpm-pre", name: "Cond. DDPM (pre-trained)", schemaId: sid, datasetId: DS, modelId: "m-cond-ddpm", status: "done",
        _pretrainedVar: "COND_DDPM_PRETRAINED_BIN_B64",
        config: { epochs: 30, batchSize: 64, learningRate: 0.001, optimizerType: "adam",
                  lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
      { id: "t-cond-denoiser-pre", name: "Cond. Denoiser (pre-trained)", schemaId: sid, datasetId: DS, modelId: "m-cond-denoiser", status: "done",
        _pretrainedVar: "COND_DENOISER_PRETRAINED_BIN_B64",
        config: { epochs: 30, batchSize: 64, learningRate: 0.001, optimizerType: "adam",
                  lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
    ],
    generations: [
      { id: "g-cond-ddpm-gen", name: "Cond. DDPM Generate", schemaId: sid, trainerId: "t-cond-ddpm", family: "diffusion",
        config: { method: "ddpm", numSamples: 16, steps: 50, temperature: 1.0, seed: 42, targetClass: 0 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-cond-ddpm-recon", name: "Cond. DDPM Reconstruct", schemaId: sid, trainerId: "t-cond-ddpm", family: "diffusion",
        config: { method: "reconstruct", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-cond-denoiser-gen", name: "Cond. Denoiser Generate", schemaId: sid, trainerId: "t-cond-denoiser", family: "diffusion",
        config: { method: "ddpm", numSamples: 16, steps: 50, temperature: 1.0, seed: 42, targetClass: 0 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-cond-denoiser-recon", name: "Cond. Denoiser Reconstruct", schemaId: sid, trainerId: "t-cond-denoiser", family: "diffusion",
        config: { method: "reconstruct", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      // Pre-trained generation
      { id: "g-cond-ddpm-random", name: "DDPM → Random (pre-trained)", schemaId: sid, trainerId: "t-cond-ddpm-pre", family: "diffusion",
        config: { method: "ddpm", numSamples: 16, steps: 50, temperature: 1.0, seed: 42, targetClass: -1 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-cond-ddpm-tshirt", name: "DDPM → T-shirt (pre-trained)", schemaId: sid, trainerId: "t-cond-ddpm-pre", family: "diffusion",
        config: { method: "ddpm", numSamples: 16, steps: 50, temperature: 1.0, seed: 42, targetClass: 0 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-cond-ddpm-trouser", name: "DDPM → Trouser (pre-trained)", schemaId: sid, trainerId: "t-cond-ddpm-pre", family: "diffusion",
        config: { method: "ddpm", numSamples: 16, steps: 50, temperature: 1.0, seed: 42, targetClass: 1 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-cond-ddpm-sneaker", name: "DDPM → Sneaker (pre-trained)", schemaId: sid, trainerId: "t-cond-ddpm-pre", family: "diffusion",
        config: { method: "ddpm", numSamples: 16, steps: 50, temperature: 1.0, seed: 42, targetClass: 2 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-cond-denoiser-tshirt", name: "Denoiser → T-shirt (pre-trained)", schemaId: sid, trainerId: "t-cond-denoiser-pre", family: "diffusion",
        config: { method: "ddpm", numSamples: 16, steps: 50, temperature: 1.0, seed: 42, targetClass: 0 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-cond-denoiser-trouser", name: "Denoiser → Trouser (pre-trained)", schemaId: sid, trainerId: "t-cond-denoiser-pre", family: "diffusion",
        config: { method: "ddpm", numSamples: 16, steps: 50, temperature: 1.0, seed: 42, targetClass: 1 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-cond-denoiser-sneaker", name: "Denoiser → Sneaker (pre-trained)", schemaId: sid, trainerId: "t-cond-denoiser-pre", family: "diffusion",
        config: { method: "ddpm", numSamples: 16, steps: 50, temperature: 1.0, seed: 42, targetClass: 2 }, status: "draft", runs: [], createdAt: Date.now() },
    ],
    evaluations: [],
  };
})();

/**
 * Fashion-MNIST Benchmark — 7 Architectures Compared
 *
 * A visual survey of 35 years of neural network research,
 * all trained and evaluated on the same dataset in one browser page.
 *
 * 1. MLP Baseline          — Rumelhart, Hinton, Williams 1986
 * 2. CNN (LeNet-5)          — LeCun et al. 1998
 * 3. Dense Autoencoder      — Hinton & Salakhutdinov 2006
 * 4. Conv Autoencoder       — Masci et al. 2011
 * 5. VAE                    — Kingma & Welling 2013
 * 6. VAE+Classifier         — Multi-task learning
 * 7. Denoising Autoencoder  — Ho, Jain, Abbeel 2020 (diffusion-style)
 *
 * GAN is in a separate demo (phased training needs its own UI).
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
  function C(d, from, to) {
    var op = "output_1", ip = "input_1";
    if (!d[from].outputs[op]) d[from].outputs[op] = { connections: [] };
    d[from].outputs[op].connections.push({ node: to, input: ip });
    if (!d[to].inputs[ip]) d[to].inputs[ip] = { connections: [] };
    d[to].inputs[ip].connections.push({ node: from, output: op });
  }
  function C2(d, from, to, op, ip) {
    if (!d[from].outputs[op]) d[from].outputs[op] = { connections: [] };
    d[from].outputs[op].connections.push({ node: to, input: ip });
    if (!d[to].inputs[ip]) d[to].inputs[ip] = { connections: [] };
    d[to].inputs[ip].connections.push({ node: from, output: op });
  }
  function graph(d) { return { drawflow: { Home: { data: d } } }; }

  // ────────────────────────────────────────────────────────
  // 1. MLP Baseline (Rumelhart 1986)
  // ────────────────────────────────────────────────────────
  function _mlp() {
    _nid = 0; var d = {};
    var a = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 60, 100);
    var b = N(d, "input", { mode: "flat" }, 220, 100);
    var c = N(d, "dense", { units: 256, activation: "relu" }, 380, 100);
    var e = N(d, "dense", { units: 128, activation: "relu" }, 540, 100);
    var f = N(d, "output", { target: "label", targetType: "label", loss: "categoricalCrossentropy", headType: "classification" }, 700, 100);
    C(d,a,b); C(d,b,c); C(d,c,e); C(d,e,f);
    return graph(d);
  }

  // ────────────────────────────────────────────────────────
  // 2. CNN / LeNet-5 (LeCun 1998)
  // ────────────────────────────────────────────────────────
  function _cnn() {
    _nid = 0; var d = {};
    var a = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 60, 80);
    var b = N(d, "reshape", { targetShape: "28,28,1" }, 200, 80);
    var c = N(d, "conv2d", { filters: 32, kernelSize: 5, strides: 1, padding: "same", activation: "relu" }, 340, 80);
    var e = N(d, "maxpool2d", { poolSize: 2, strides: 2 }, 480, 80);
    var f = N(d, "conv2d", { filters: 64, kernelSize: 5, strides: 1, padding: "same", activation: "relu" }, 620, 80);
    var g = N(d, "maxpool2d", { poolSize: 2, strides: 2 }, 760, 80);
    var h = N(d, "flatten", {}, 900, 80);
    var i = N(d, "dense", { units: 256, activation: "relu" }, 1040, 80);
    var j = N(d, "dropout", { rate: 0.3 }, 1180, 80);
    var k = N(d, "output", { target: "label", targetType: "label", loss: "categoricalCrossentropy", headType: "classification" }, 1320, 80);
    C(d,a,b); C(d,b,c); C(d,c,e); C(d,e,f); C(d,f,g); C(d,g,h); C(d,h,i); C(d,i,j); C(d,j,k);
    return graph(d);
  }

  // ────────────────────────────────────────────────────────
  // 3. Dense Autoencoder (Hinton 2006)
  // ────────────────────────────────────────────────────────
  function _ae() {
    _nid = 0; var d = {};
    var a = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 60, 100);
    var b = N(d, "input", { mode: "flat" }, 200, 100);
    var c = N(d, "dense", { units: 256, activation: "relu" }, 340, 100);
    var e = N(d, "dense", { units: 64, activation: "relu" }, 480, 100);
    var f = N(d, "dense", { units: 256, activation: "relu" }, 620, 100);
    var g = N(d, "dense", { units: 784, activation: "sigmoid" }, 760, 100);
    var h = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", headType: "reconstruction" }, 920, 100);
    C(d,a,b); C(d,b,c); C(d,c,e); C(d,e,f); C(d,f,g); C(d,g,h);
    return graph(d);
  }

  // ────────────────────────────────────────────────────────
  // 4. Conv Autoencoder (Masci 2011)
  // ────────────────────────────────────────────────────────
  function _convAe() {
    _nid = 0; var d = {};
    var a = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 60, 80);
    var b = N(d, "reshape", { targetShape: "28,28,1" }, 180, 80);
    var c = N(d, "conv2d", { filters: 32, kernelSize: 3, strides: 2, padding: "same", activation: "relu" }, 300, 80);
    var e = N(d, "conv2d", { filters: 64, kernelSize: 3, strides: 2, padding: "same", activation: "relu" }, 420, 80);
    var f = N(d, "flatten", {}, 540, 80);
    var g = N(d, "dense", { units: 32, activation: "relu" }, 660, 80);
    var h = N(d, "dense", { units: 3136, activation: "relu" }, 780, 80);
    var i = N(d, "reshape", { targetShape: "7,7,64" }, 900, 80);
    var j = N(d, "conv2d_transpose", { filters: 32, kernelSize: 3, strides: 2, padding: "same", activation: "relu" }, 1020, 80);
    var k = N(d, "conv2d_transpose", { filters: 1, kernelSize: 3, strides: 2, padding: "same", activation: "sigmoid" }, 1140, 80);
    var l = N(d, "flatten", {}, 1260, 80);
    var m = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", headType: "reconstruction" }, 1380, 80);
    C(d,a,b); C(d,b,c); C(d,c,e); C(d,e,f); C(d,f,g); C(d,g,h); C(d,h,i); C(d,i,j); C(d,j,k); C(d,k,l); C(d,l,m);
    return graph(d);
  }

  // ────────────────────────────────────────────────────────
  // 5. VAE (Kingma & Welling 2013)
  // ────────────────────────────────────────────────────────
  function _vae() {
    _nid = 0; var d = {};
    var a = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 60, 100);
    var b = N(d, "input", { mode: "flat" }, 200, 100);
    var c = N(d, "dense", { units: 256, activation: "relu" }, 340, 100);
    var mu = N(d, "latent_mu", { units: 16, group: "z" }, 500, 60);
    var lv = N(d, "latent_logvar", { units: 16, group: "z" }, 500, 160);
    var rp = N(d, "reparam", { units: 16, group: "z", beta: 0.001 }, 660, 100);
    var e = N(d, "dense", { units: 256, activation: "relu" }, 820, 100);
    var f = N(d, "dense", { units: 784, activation: "sigmoid" }, 980, 100);
    var g = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", headType: "reconstruction" }, 1140, 100);
    C(d,a,b); C(d,b,c); C(d,c,mu); C(d,c,lv);
    C2(d,mu,rp,"output_1","input_1"); C2(d,lv,rp,"output_1","input_2");
    C(d,rp,e); C(d,e,f); C(d,f,g);
    return graph(d);
  }

  // ────────────────────────────────────────────────────────
  // 6. VAE + Classifier (Multi-task)
  // ────────────────────────────────────────────────────────
  function _vaeCls() {
    _nid = 0; var d = {};
    var a = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 60, 140);
    var b = N(d, "input", { mode: "flat" }, 200, 140);
    var c = N(d, "dense", { units: 256, activation: "relu" }, 340, 140);
    var mu = N(d, "latent_mu", { units: 16, group: "z" }, 500, 80);
    var lv = N(d, "latent_logvar", { units: 16, group: "z" }, 500, 200);
    var rp = N(d, "reparam", { units: 16, group: "z", beta: 0.001 }, 660, 140);
    // reconstruction path
    var e = N(d, "dense", { units: 256, activation: "relu" }, 820, 100);
    var f = N(d, "dense", { units: 784, activation: "sigmoid" }, 980, 100);
    var g = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", matchWeight: 1, headType: "reconstruction" }, 1140, 100);
    // classification path (from shared encoder)
    var h = N(d, "dense", { units: 64, activation: "relu" }, 500, 300);
    var i = N(d, "output", { target: "label", targetType: "label", loss: "categoricalCrossentropy", matchWeight: 0.3, headType: "classification" }, 700, 300);
    C(d,a,b); C(d,b,c); C(d,c,mu); C(d,c,lv); C(d,c,h);
    C2(d,mu,rp,"output_1","input_1"); C2(d,lv,rp,"output_1","input_2");
    C(d,rp,e); C(d,e,f); C(d,f,g); C(d,h,i);
    return graph(d);
  }

  // ────────────────────────────────────────────────────────
  // 7. Denoising Autoencoder / Diffusion (Ho 2020)
  // ────────────────────────────────────────────────────────
  function _denoiser() {
    _nid = 0; var d = {};
    var a = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 60, 100);
    var b = N(d, "noise_injection", { scale: 0.3, schedule: "constant" }, 230, 100);
    var c = N(d, "dense", { units: 512, activation: "relu" }, 400, 100);
    var e = N(d, "dense", { units: 256, activation: "relu" }, 570, 100);
    var f = N(d, "dense", { units: 784, activation: "linear" }, 740, 100);
    var g = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", headType: "reconstruction" }, 910, 100);
    C(d,a,b); C(d,b,c); C(d,c,e); C(d,e,f); C(d,f,g);
    return graph(d);
  }

  // ────────────────────────────────────────────────────────
  // Assemble preset
  // ────────────────────────────────────────────────────────
  var DS_ID = "demo-bench-ds";
  var sid = "fashion_mnist";

  window.FASHION_MNIST_BENCHMARK_PRESET = {
    dataset: {
      id: DS_ID, name: "Fashion-MNIST (60000)", schemaId: sid, status: "draft",
      config: { seed: 42, splitMode: "stratified_label", trainFrac: 0.8, valFrac: 0.1, testFrac: 0.1, totalCount: 60000, useFullSource: true },
      data: null, createdAt: Date.now(),
    },

    models: [
      { id: "m-mlp",      name: "1. MLP Baseline",      schemaId: sid, graph: _mlp(),      createdAt: Date.now() },
      { id: "m-cnn",      name: "2. CNN (LeNet-5)",      schemaId: sid, graph: _cnn(),      createdAt: Date.now() },
      { id: "m-ae",       name: "3. Dense Autoencoder",  schemaId: sid, graph: _ae(),       createdAt: Date.now() },
      { id: "m-conv-ae",  name: "4. Conv Autoencoder",   schemaId: sid, graph: _convAe(),   createdAt: Date.now() },
      { id: "m-vae",      name: "5. VAE",                schemaId: sid, graph: _vae(),      createdAt: Date.now() },
      { id: "m-vae-cls",  name: "6. VAE+Classifier",     schemaId: sid, graph: _vaeCls(),   createdAt: Date.now() },
      { id: "m-denoiser", name: "7. Denoising AE",       schemaId: sid, graph: _denoiser(), createdAt: Date.now() },
    ],

    trainers: [
      { id: "t-mlp",      name: "MLP Trainer",        schemaId: sid, datasetId: DS_ID, modelId: "m-mlp",      status: "draft", config: { epochs: 20, batchSize: 128, learningRate: 0.001, optimizerType: "adam", useServer: true } },
      { id: "t-cnn",      name: "CNN Trainer",         schemaId: sid, datasetId: DS_ID, modelId: "m-cnn",      status: "draft", config: { epochs: 20, batchSize: 128, learningRate: 0.001, optimizerType: "adam", useServer: true } },
      { id: "t-ae",       name: "AE Trainer",          schemaId: sid, datasetId: DS_ID, modelId: "m-ae",       status: "draft", config: { epochs: 20, batchSize: 128, learningRate: 0.001, optimizerType: "adam", useServer: true } },
      { id: "t-conv-ae",  name: "Conv-AE Trainer",     schemaId: sid, datasetId: DS_ID, modelId: "m-conv-ae",  status: "draft", config: { epochs: 20, batchSize: 128, learningRate: 0.001, optimizerType: "adam", useServer: true } },
      { id: "t-vae",      name: "VAE Trainer",         schemaId: sid, datasetId: DS_ID, modelId: "m-vae",      status: "draft", config: { epochs: 20, batchSize: 128, learningRate: 0.0005, optimizerType: "adam", useServer: true } },
      { id: "t-vae-cls",  name: "VAE+Cls Trainer",     schemaId: sid, datasetId: DS_ID, modelId: "m-vae-cls",  status: "draft", config: { epochs: 20, batchSize: 128, learningRate: 0.0005, optimizerType: "adam", useServer: true } },
      { id: "t-denoiser", name: "Denoiser Trainer",    schemaId: sid, datasetId: DS_ID, modelId: "m-denoiser", status: "draft", config: { epochs: 20, batchSize: 128, learningRate: 0.001, optimizerType: "adam", useServer: true } },
    ],

    generations: [
      { id: "g-ae-recon",  name: "AE Reconstruct",       schemaId: sid, trainerId: "t-ae",       family: "supervised", config: { method: "reconstruct", numSamples: 16 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-convae-r",  name: "Conv-AE Reconstruct",  schemaId: sid, trainerId: "t-conv-ae",  family: "supervised", config: { method: "reconstruct", numSamples: 16 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-vae-rand",  name: "VAE Random Sampling",  schemaId: sid, trainerId: "t-vae",      family: "vae",        config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-vae-recon", name: "VAE Reconstruct",      schemaId: sid, trainerId: "t-vae",      family: "vae",        config: { method: "reconstruct", numSamples: 16 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-cls-guide", name: "Classifier-Guided",    schemaId: sid, trainerId: "t-vae-cls",  family: "vae",        config: { method: "classifier_guided", numSamples: 16, steps: 100, lr: 0.01, targetClass: 7, guidanceWeight: 2.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-langevin",  name: "Langevin Denoising",   schemaId: sid, trainerId: "t-denoiser", family: "diffusion",  config: { method: "langevin", numSamples: 16, steps: 100, lr: 0.01, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
    ],

    evaluations: [
      {
        id: "e-cls-bench", name: "Classification: MLP vs CNN", schemaId: sid, datasetId: DS_ID,
        trainerIds: ["t-mlp", "t-cnn"],
        evaluatorIds: ["accuracy", "macro_f1"], status: "draft", runs: [], createdAt: Date.now(),
      },
      {
        id: "e-recon-bench", name: "Reconstruction: AE vs Conv-AE vs VAE vs Denoiser", schemaId: sid, datasetId: DS_ID,
        trainerIds: ["t-ae", "t-conv-ae", "t-vae", "t-denoiser"],
        evaluatorIds: ["mae", "rmse", "r2"], status: "draft", runs: [], createdAt: Date.now(),
      },
    ],
  };
})();

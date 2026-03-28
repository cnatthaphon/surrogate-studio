/**
 * Oscillator Surrogate Demo — Full Platform Showcase
 *
 * 5 model architectures on damped oscillator trajectories:
 * 1. Direct-MLP: params+time → x,v
 * 2. AR-GRU: window history → next step (recurrent)
 * 3. VAE: trajectory reconstruction with latent space
 * 4. VAE+Classifier: shared encoder, reconstruction + scenario classification
 *    → enables classifier-guided generation (optimize z for specific physics)
 * 5. Denoising AE: noisy trajectory → clean trajectory (1D diffusion)
 *    → generation via Langevin dynamics
 *
 * Evaluation: compare all 5 models on same test set
 * Generation: reconstruct, random, classifier-guided, Langevin
 */
(function () {
  "use strict";

  // shared graph builder helpers
  function N(d, id, name, data, x, y) {
    d[String(id)] = { id: id, name: name + "_layer", data: data || {}, class: name + "_layer",
      html: "<div><div>" + name + "</div></div>", typenode: false,
      inputs: {}, outputs: {}, pos_x: x || 0, pos_y: y || 0 };
    return String(id);
  }
  function C(d, from, to, op, ip) {
    op = op || "output_1"; ip = ip || "input_1";
    if (!d[from].outputs[op]) d[from].outputs[op] = { connections: [] };
    d[from].outputs[op].connections.push({ node: to, input: ip });
    if (!d[to].inputs[ip]) d[to].inputs[ip] = { connections: [] };
    d[to].inputs[ip].connections.push({ node: from, output: op });
  }

  // 1. Direct-MLP: Input → Dense(64) → Dense(32) → Output(xv)
  function _mlp() {
    var d = {};
    C(d, N(d,1,"input",{mode:"flat"},60,100), N(d,2,"dense",{units:64,activation:"relu"},230,100));
    C(d, "2", N(d,3,"dense",{units:32,activation:"relu"},400,100));
    C(d, "3", N(d,4,"output",{target:"xv",loss:"mse"},570,100));
    return { drawflow: { Home: { data: d } } };
  }

  // 2. AR-GRU: Input → GRU(64) → Dense(32) → Output(xv)
  function _gru() {
    var d = {};
    C(d, N(d,1,"input",{mode:"flat"},60,100), N(d,2,"gru",{units:64,dropout:0.1,returnseq:"false"},260,100));
    C(d, "2", N(d,3,"dense",{units:32,activation:"relu"},430,100));
    C(d, "3", N(d,4,"output",{target:"xv",loss:"mse"},600,100));
    return { drawflow: { Home: { data: d } } };
  }

  // 3. VAE: Input → Dense(32) → μ(8)/logσ²(8) → Reparam → Dense(32) → Output(xv)
  function _vae() {
    var d = {};
    var inp = N(d,1,"input",{mode:"flat"},60,100);
    var e1 = N(d,2,"dense",{units:32,activation:"relu"},200,100);
    var mu = N(d,3,"latent_mu",{units:8,group:"z"},350,50);
    var lv = N(d,4,"latent_logvar",{units:8,group:"z"},350,150);
    var rep = N(d,5,"reparam",{group:"z",beta:0.001},500,100);
    var d1 = N(d,6,"dense",{units:32,activation:"relu"},650,100);
    var out = N(d,7,"output",{target:"xv",loss:"mse"},800,100);
    C(d, inp, e1); C(d, e1, mu); C(d, e1, lv);
    C(d, mu, rep, "output_1", "input_1"); C(d, lv, rep, "output_1", "input_2");
    C(d, rep, d1); C(d, d1, out);
    return { drawflow: { Home: { data: d } } };
  }

  // 4. VAE+Classifier: shared encoder → reconstruction + scenario classification
  //    Classifier head enables guided generation toward specific physics
  function _vaeCls() {
    var d = {};
    var inp = N(d,1,"input",{mode:"flat"},60,120);
    var e1 = N(d,2,"dense",{units:64,activation:"relu"},200,120);
    var e2 = N(d,3,"dense",{units:32,activation:"relu"},350,120);
    // VAE latent
    var mu = N(d,4,"latent_mu",{units:8,group:"z"},500,60);
    var lv = N(d,5,"latent_logvar",{units:8,group:"z"},500,180);
    var rep = N(d,6,"reparam",{group:"z",beta:0.001},650,120);
    // Decoder → reconstruction
    var d1 = N(d,7,"dense",{units:32,activation:"relu"},800,120);
    var d2 = N(d,8,"dense",{units:64,activation:"relu"},950,120);
    var reconOut = N(d,9,"output",{target:"xv",loss:"mse",matchWeight:1},1100,120);
    // Classifier head → scenario type (spring/pendulum/bouncing)
    var cls1 = N(d,10,"dense",{units:16,activation:"relu"},500,300);
    var clsOut = N(d,11,"output",{target:"label",loss:"categoricalCrossentropy",matchWeight:0.3},650,300);

    C(d, inp, e1); C(d, e1, e2); C(d, e2, mu); C(d, e2, lv);
    C(d, mu, rep, "output_1", "input_1"); C(d, lv, rep, "output_1", "input_2");
    C(d, rep, d1); C(d, d1, d2); C(d, d2, reconOut);
    C(d, e2, cls1); C(d, cls1, clsOut);
    return { drawflow: { Home: { data: d } } };
  }

  // 5. Denoising AE: Input → AddNoise → Dense(64) → Dense(32) → Dense(featureSize) → Output(xv)
  //    1D diffusion: learn to remove noise from trajectories
  function _denoiser() {
    var d = {};
    var inp = N(d,1,"input",{mode:"flat"},60,100);
    var noise = N(d,2,"noise_injection",{scale:0.2,schedule:"constant"},200,100);
    var d1 = N(d,3,"dense",{units:64,activation:"relu"},370,100);
    var d2 = N(d,4,"dense",{units:32,activation:"relu"},540,100);
    var d3 = N(d,5,"dense",{units:64,activation:"relu"},710,100);
    var out = N(d,6,"output",{target:"xv",loss:"mse"},880,100);
    C(d, inp, noise); C(d, noise, d1); C(d, d1, d2); C(d, d2, d3); C(d, d3, out);
    return { drawflow: { Home: { data: d } } };
  }

  window.OSCILLATOR_DEMO_PRESET = {
    dataset: {
      id: "demo-osc-ds",
      name: "Oscillator Trajectories",
      schemaId: "oscillator",
      status: "draft",
      config: { seed: 42, splitMode: "random", trainFrac: 0.8, valFrac: 0.1, testFrac: 0.1 },
      data: null,
      createdAt: Date.now(),
    },
    models: [
      { id: "demo-osc-mlp", name: "Direct-MLP", schemaId: "oscillator", graph: _mlp(), createdAt: Date.now() },
      { id: "demo-osc-gru", name: "AR-GRU", schemaId: "oscillator", graph: _gru(), createdAt: Date.now() },
      { id: "demo-osc-vae", name: "Oscillator VAE", schemaId: "oscillator", graph: _vae(), createdAt: Date.now() },
      { id: "demo-osc-vae-cls", name: "VAE+Classifier (guided)", schemaId: "oscillator", graph: _vaeCls(), createdAt: Date.now() },
      { id: "demo-osc-denoiser", name: "Denoising AE (1D diffusion)", schemaId: "oscillator", graph: _denoiser(), createdAt: Date.now() },
    ],
    trainers: [
      { id: "demo-osc-mlp-t", name: "MLP Trainer", schemaId: "oscillator", datasetId: "demo-osc-ds", modelId: "demo-osc-mlp", status: "draft",
        config: { epochs: 30, batchSize: 32, learningRate: 0.001, optimizerType: "adam", useServer: true } },
      { id: "demo-osc-gru-t", name: "GRU Trainer", schemaId: "oscillator", datasetId: "demo-osc-ds", modelId: "demo-osc-gru", status: "draft",
        config: { epochs: 30, batchSize: 32, learningRate: 0.001, optimizerType: "adam", useServer: true } },
      { id: "demo-osc-vae-t", name: "VAE Trainer", schemaId: "oscillator", datasetId: "demo-osc-ds", modelId: "demo-osc-vae", status: "draft",
        config: { epochs: 30, batchSize: 32, learningRate: 0.0005, optimizerType: "adam", useServer: true } },
      { id: "demo-osc-vae-cls-t", name: "VAE+Classifier Trainer", schemaId: "oscillator", datasetId: "demo-osc-ds", modelId: "demo-osc-vae-cls", status: "draft",
        config: { epochs: 30, batchSize: 32, learningRate: 0.0005, optimizerType: "adam", useServer: true } },
      { id: "demo-osc-den-t", name: "Denoiser Trainer", schemaId: "oscillator", datasetId: "demo-osc-ds", modelId: "demo-osc-denoiser", status: "draft",
        config: { epochs: 30, batchSize: 32, learningRate: 0.001, optimizerType: "adam", useServer: true } },
    ],
    generations: [
      { id: "demo-osc-vae-gen", name: "VAE Reconstruct", schemaId: "oscillator", trainerId: "", family: "",
        config: { method: "reconstruct", numSamples: 16, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "demo-osc-cls-gen", name: "Classifier-Guided", schemaId: "oscillator", trainerId: "", family: "",
        config: { method: "classifier_guided", numSamples: 8, steps: 100, lr: 0.01, targetClass: 0, guidanceWeight: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "demo-osc-lang-gen", name: "Langevin Sampling", schemaId: "oscillator", trainerId: "", family: "",
        config: { method: "langevin", numSamples: 8, steps: 50, lr: 0.01, temperature: 0.5, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
    ],
    evaluations: [
      { id: "demo-osc-eval", name: "All Models Benchmark", schemaId: "oscillator", datasetId: "demo-osc-ds",
        trainerIds: ["demo-osc-mlp-t", "demo-osc-gru-t", "demo-osc-vae-t", "demo-osc-vae-cls-t", "demo-osc-den-t"],
        evaluatorIds: ["mae", "rmse", "r2", "bias"], status: "draft", runs: [], createdAt: Date.now() },
    ],
  };
})();

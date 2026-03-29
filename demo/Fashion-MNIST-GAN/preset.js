/**
 * Fashion-MNIST GAN Demo — Real Adversarial Architecture
 *
 * Graph structure (all composable blocks, no hardcoded training logic):
 *
 *   Generator:     SampleZ(128) → Dense(256) → Dense(512) → Dense(784,σ) → Output(recon, phase=generator)
 *                                                                                ↓ [connectable]
 *                                                                             Detach
 *                                                                                ↓
 *   Discriminator: ImageSource(784) ──────────────────────→ ConcatBatch(real+fake)
 *                                                                                ↓
 *                                                              Dense(512) → Dense(256) → Dense(1,σ) → Output(BCE, phase=discriminator)
 *
 *   Labels:        Constant(1) → PhaseSwitch → (training engine reads as D label source)
 *                  Constant(0) →
 *
 * References:
 *   Goodfellow et al., "Generative Adversarial Nets", NeurIPS 2014
 *   Radford et al., "DCGANs", ICLR 2016
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
  // Model 1: MLP-GAN (Goodfellow 2014)
  // ═══════════════════════════════════════════
  function _mlpGan() {
    _nid = 0; var d = {};

    // --- Generator: noise → image (tagged "generator") ---
    var z =    N(d, "sample_z",     { dim: 128, distribution: "normal" },         80, 60);
    var g1 =   N(d, "dense",        { units: 256, activation: "relu", weightTag: "generator" }, 240, 60);
    var g2 =   N(d, "dense",        { units: 512, activation: "relu", weightTag: "generator" }, 400, 60);
    var g3 =   N(d, "dense",        { units: 784, activation: "sigmoid", weightTag: "generator" }, 560, 60);
    var gOut = N(d, "output",       { target: "pixel_values", targetType: "pixel_values", loss: "mse", matchWeight: 1, phase: "generator", headType: "reconstruction" }, 720, 60);
    C(d, z, g1); C(d, g1, g2); C(d, g2, g3); C(d, g3, gOut);

    // --- G output → Detach → feeds into D ---
    var det =  N(d, "detach",       { activePhase: "discriminator" },             720, 180);
    C(d, gOut, det);

    // --- ConcatBatch: real + fake ---
    var img =  N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 300);
    var cat =  N(d, "concat_batch", {},                                          400, 240);
    C(d, img, cat, "output_1", "input_1");
    C(d, det, cat, "output_1", "input_2");

    // --- Discriminator (tagged "discriminator") ---
    var d1 =   N(d, "dense",        { units: 512, activation: "relu", weightTag: "discriminator" }, 560, 240);
    var d2 =   N(d, "dense",        { units: 256, activation: "relu", weightTag: "discriminator" }, 720, 240);
    var d3 =   N(d, "dense",        { units: 1, activation: "sigmoid", weightTag: "discriminator" }, 880, 240);
    var dOut = N(d, "output",       { target: "label", targetType: "label", loss: "bce", matchWeight: 1, phase: "discriminator", headType: "classification" }, 1040, 240);
    C(d, cat, d1); C(d, d1, d2); C(d, d2, d3); C(d, d3, dOut);

    // --- Label routing: Constant(1) + Constant(0) → PhaseSwitch ---
    // PhaseSwitch output = labels for D (phase 0→input_1, phase 1→input_2)
    // Training engine reads PhaseSwitch output as target override for D
    var c1 =   N(d, "constant",     { value: 1, dim: 1 },                       720, 400);
    var c0 =   N(d, "constant",     { value: 0, dim: 1 },                       720, 480);
    var sw =   N(d, "phase_switch", { activePhase: "discriminator" },             880, 440);
    C(d, c1, sw, "output_1", "input_1");
    C(d, c0, sw, "output_1", "input_2");
    // PhaseSwitch → D Output input_2 (custom label source)
    C(d, sw, dOut, "output_1", "input_2");

    return graph(d);
  }

  // ═══════════════════════════════════════════
  // Model 2: DCGAN (Radford 2015)
  // ═══════════════════════════════════════════
  function _dcGan() {
    _nid = 0; var d = {};

    // --- Conv Generator (tagged "generator") ---
    var z =    N(d, "sample_z",          { dim: 128, distribution: "normal" },    80, 60);
    var gd =   N(d, "dense",             { units: 6272, activation: "relu", weightTag: "generator" }, 240, 60);
    var gr =   N(d, "reshape",           { targetShape: "7,7,128" },             400, 60);
    var gc1 =  N(d, "conv2d_transpose",  { filters: 64, kernelSize: 4, strides: 2, padding: "same", activation: "relu", weightTag: "generator" }, 560, 60);
    var gc2 =  N(d, "conv2d_transpose",  { filters: 1, kernelSize: 4, strides: 2, padding: "same", activation: "sigmoid", weightTag: "generator" }, 720, 60);
    var gf =   N(d, "flatten",           {},                                     880, 60);
    var gOut = N(d, "output",            { target: "pixel_values", targetType: "pixel_values", loss: "mse", matchWeight: 1, phase: "generator", headType: "reconstruction" }, 1040, 60);
    C(d, z, gd); C(d, gd, gr); C(d, gr, gc1); C(d, gc1, gc2); C(d, gc2, gf); C(d, gf, gOut);

    // --- G output → Detach ---
    var det =  N(d, "detach",            { activePhase: "discriminator" },        1040, 180);
    C(d, gOut, det);

    // --- ConcatBatch: real + fake ---
    var img =  N(d, "image_source",      { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 320);
    var cat =  N(d, "concat_batch",      {},                                     400, 260);
    C(d, img, cat, "output_1", "input_1");
    C(d, det, cat, "output_1", "input_2");

    // --- Conv Discriminator (tagged "discriminator") ---
    var dr =   N(d, "reshape",           { targetShape: "28,28,1" },             560, 260);
    var dc1 =  N(d, "conv2d",            { filters: 64, kernelSize: 4, strides: 2, padding: "same", activation: "relu", weightTag: "discriminator" }, 720, 260);
    var dc2 =  N(d, "conv2d",            { filters: 128, kernelSize: 4, strides: 2, padding: "same", activation: "relu", weightTag: "discriminator" }, 880, 260);
    var df =   N(d, "flatten",           {},                                     1040, 260);
    var dd =   N(d, "dense",             { units: 1, activation: "sigmoid", weightTag: "discriminator" }, 1200, 260);
    var dOut = N(d, "output",            { target: "label", targetType: "label", loss: "bce", matchWeight: 1, phase: "discriminator", headType: "classification" }, 1360, 260);
    C(d, cat, dr); C(d, dr, dc1); C(d, dc1, dc2); C(d, dc2, df); C(d, df, dd); C(d, dd, dOut);

    // --- Labels ---
    var c1 =   N(d, "constant",          { value: 1, dim: 1 },                  1040, 420);
    var c0 =   N(d, "constant",          { value: 0, dim: 1 },                  1040, 500);
    var sw =   N(d, "phase_switch",      { activePhase: "discriminator" },        1200, 460);
    C(d, c1, sw, "output_1", "input_1");
    C(d, c0, sw, "output_1", "input_2");
    // PhaseSwitch → D Output input_2 (custom label source)
    C(d, sw, dOut, "output_1", "input_2");

    return graph(d);
  }

  var DS = "demo-gan-ds";
  var sid = "fashion_mnist";

  window.FASHION_MNIST_GAN_PRESET = {
    dataset: {
      id: DS, name: "Fashion-MNIST (60000)", schemaId: sid, status: "draft",
      config: { seed: 42, splitMode: "stratified_label", trainFrac: 0.8, valFrac: 0.1, testFrac: 0.1, totalCount: 60000, useFullSource: true },
      data: null, createdAt: Date.now(),
    },
    models: [
      { id: "m-mlp-gan",  name: "1. MLP-GAN (Goodfellow 2014)", schemaId: sid, graph: _mlpGan(), createdAt: Date.now() },
      { id: "m-dcgan",    name: "2. DCGAN (Radford 2015)",       schemaId: sid, graph: _dcGan(),  createdAt: Date.now() },
    ],
    trainers: [
      { id: "t-mlp-gan", name: "MLP-GAN Trainer", schemaId: sid, datasetId: DS, modelId: "m-mlp-gan", status: "draft",
        config: { epochs: 50, batchSize: 128, learningRate: 0.0002, optimizerType: "adam", useServer: true,
                  phaseOrder: ["discriminator", "generator"], phaseEpochs: { discriminator: 1, generator: 1 } } },
      { id: "t-dcgan", name: "DCGAN Trainer", schemaId: sid, datasetId: DS, modelId: "m-dcgan", status: "draft",
        config: { epochs: 50, batchSize: 128, learningRate: 0.0002, optimizerType: "adam", useServer: true,
                  phaseOrder: ["discriminator", "generator"], phaseEpochs: { discriminator: 1, generator: 1 } } },
    ],
    generations: [
      { id: "g-mlp-gen",  name: "MLP-GAN Generate",  schemaId: sid, trainerId: "t-mlp-gan", family: "gan", config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-dcgan-gen", name: "DCGAN Generate",    schemaId: sid, trainerId: "t-dcgan",   family: "gan", config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
    ],
    evaluations: [],
  };
})();

/**
 * Fashion-MNIST GAN Demo — Real Adversarial Architecture
 *
 * Weight tag freeze: G layers tagged "generator", D layers tagged "discriminator".
 * During D phase → G frozen, D trainable. During G phase → D frozen, G trainable.
 * Gradient flows through frozen D to update G. No Detach needed.
 *
 * Generator output → ConcatBatch(+real images) → Discriminator → Output(BCE)
 * Constant(1)/Constant(0) → PhaseSwitch → D Output (custom label)
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

    // Generator (tagged "generator") — BatchNorm prevents mode collapse by forcing z-dependent statistics
    var z =    N(d, "sample_z",     { dim: 128, distribution: "normal" },         80, 60);
    var g1 =   N(d, "dense",        { units: 256, activation: "relu", weightTag: "generator", blockName: "G1" }, 200, 60);
    var gbn1 = N(d, "layernorm",    {},                                                                          280, 60);
    var g2 =   N(d, "dense",        { units: 512, activation: "relu", weightTag: "generator", blockName: "G2" }, 360, 60);
    var gbn2 = N(d, "layernorm",    {},                                                                          440, 60);
    var g3 =   N(d, "dense",        { units: 784, activation: "sigmoid", weightTag: "generator", blockName: "G3" }, 520, 60);
    var gOut = N(d, "output",       { target: "none", targetType: "none", loss: "none", matchWeight: 0, phase: "generator", headType: "reconstruction" }, 640, 60);
    C(d, z, g1); C(d, g1, gbn1); C(d, gbn1, g2); C(d, g2, gbn2); C(d, gbn2, g3); C(d, g3, gOut);

    // G output → ConcatBatch with real images (no Detach — weight tags handle freeze)
    var img =  N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 240);
    var cat =  N(d, "concat_batch", {},                                          400, 180);
    C(d, gOut, cat, "output_1", "input_1");   // fake images from G
    C(d, img, cat, "output_1", "input_2");    // real images

    // Discriminator (tagged "discriminator") — Dropout stabilizes GAN training (DCGAN paper)
    var d1 =   N(d, "dense",        { units: 512, activation: "relu", weightTag: "discriminator" }, 560, 180);
    var dr1 =  N(d, "dropout",      { rate: 0.3 },                                                 640, 180);
    var d2 =   N(d, "dense",        { units: 256, activation: "relu", weightTag: "discriminator" }, 720, 180);
    var dr2 =  N(d, "dropout",      { rate: 0.3 },                                                 800, 180);
    var d3 =   N(d, "dense",        { units: 1, activation: "sigmoid", weightTag: "discriminator" }, 880, 180);
    var dOut = N(d, "output",       { target: "custom", targetType: "custom", loss: "bce", matchWeight: 1, phase: "discriminator", headType: "classification" }, 1040, 180);
    C(d, cat, d1); C(d, d1, dr1); C(d, dr1, d2); C(d, d2, dr2); C(d, dr2, d3); C(d, d3, dOut);

    // Labels: construct [fake_label, real_label] via ConcatBatch to match data ConcatBatch
    // Label smoothing (0.1/0.9) prevents D from becoming overconfident — standard GAN technique
    // D step: [fake=0.1, real=0.9] — train D to distinguish
    // G step: [fake=0.9, real=0.9] — fool D into thinking fake is real
    var c0 =   N(d, "constant",     { value: 0.1, dim: 1 },                     560, 340);
    var c1 =   N(d, "constant",     { value: 0.9, dim: 1 },                     560, 420);
    var sw =   N(d, "phase_switch", { activePhase: "discriminator" },             720, 380);
    C(d, c0, sw, "output_1", "input_1");   // D step → fake_label=0.1
    C(d, c1, sw, "output_1", "input_2");   // G step → fake_label=0.9
    var cR =   N(d, "constant",     { value: 0.9, dim: 1 },                     720, 460);
    var lcat = N(d, "concat_batch", {},                                          880, 420);
    C(d, sw, lcat, "output_1", "input_1");  // fake_label
    C(d, cR, lcat, "output_1", "input_2");  // real_label (always 1)
    C(d, lcat, dOut, "output_1", "input_2");

    return graph(d);
  }

  // ═══════════════════════════════════════════
  // Model 2: DCGAN (Radford 2015)
  // ═══════════════════════════════════════════
  function _dcGan() {
    _nid = 0; var d = {};

    // Conv Generator (tagged "generator")
    var z =    N(d, "sample_z",          { dim: 128, distribution: "normal" },    80, 60);
    var gd =   N(d, "dense",             { units: 6272, activation: "relu", weightTag: "generator" }, 240, 60);
    var gr =   N(d, "reshape",           { targetShape: "7,7,128" },             400, 60);
    var gc1 =  N(d, "conv2d_transpose",  { filters: 64, kernelSize: 4, strides: 2, padding: "same", activation: "relu", weightTag: "generator" }, 560, 60);
    var gc2 =  N(d, "conv2d_transpose",  { filters: 1, kernelSize: 4, strides: 2, padding: "same", activation: "sigmoid", weightTag: "generator" }, 720, 60);
    var gf =   N(d, "flatten",           {},                                     880, 60);
    var gOut = N(d, "output",            { target: "none", targetType: "none", loss: "none", matchWeight: 0, phase: "generator", headType: "reconstruction" }, 1040, 60);
    C(d, z, gd); C(d, gd, gr); C(d, gr, gc1); C(d, gc1, gc2); C(d, gc2, gf); C(d, gf, gOut);

    // G output → ConcatBatch with real
    var img =  N(d, "image_source",      { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 260);
    var cat =  N(d, "concat_batch",      {},                                     500, 200);
    C(d, gOut, cat, "output_1", "input_1");
    C(d, img, cat, "output_1", "input_2");

    // Conv Discriminator (tagged "discriminator")
    var dr =   N(d, "reshape",           { targetShape: "28,28,1" },             660, 200);
    var dc1 =  N(d, "conv2d",            { filters: 64, kernelSize: 4, strides: 2, padding: "same", activation: "relu", weightTag: "discriminator" }, 820, 200);
    var dc2 =  N(d, "conv2d",            { filters: 128, kernelSize: 4, strides: 2, padding: "same", activation: "relu", weightTag: "discriminator" }, 980, 200);
    var df =   N(d, "flatten",           {},                                     1140, 200);
    var dd =   N(d, "dense",             { units: 1, activation: "sigmoid", weightTag: "discriminator" }, 1300, 200);
    var dOut = N(d, "output",            { target: "custom", targetType: "custom", loss: "bce", matchWeight: 1, phase: "discriminator", headType: "classification" }, 1460, 200);
    C(d, cat, dr); C(d, dr, dc1); C(d, dc1, dc2); C(d, dc2, df); C(d, df, dd); C(d, dd, dOut);

    // Labels: [fake_label, real_label] via ConcatBatch (label smoothing 0.1/0.9)
    var c0 =   N(d, "constant",          { value: 0.1, dim: 1 },                1140, 360);
    var c1 =   N(d, "constant",          { value: 0.9, dim: 1 },                1140, 440);
    var sw =   N(d, "phase_switch",      { activePhase: "discriminator" },       1300, 400);
    C(d, c0, sw, "output_1", "input_1");
    C(d, c1, sw, "output_1", "input_2");
    var cR =   N(d, "constant",          { value: 0.9, dim: 1 },                1300, 480);
    var lcat = N(d, "concat_batch",      {},                                    1460, 440);
    C(d, sw, lcat, "output_1", "input_1");
    C(d, cR, lcat, "output_1", "input_2");
    C(d, lcat, dOut, "output_1", "input_2");

    return graph(d);
  }

  var DS = "demo-gan-ds";
  var sid = "fashion_mnist";

  window.FASHION_MNIST_GAN_PRESET = {
    dataset: {
      id: DS, name: "Fashion-MNIST (60000)", schemaId: sid, status: "draft",
      config: { seed: 42, splitMode: "stratified_label", trainFrac: 1.0, valFrac: 0, testFrac: 0, totalCount: 6000, useFullSource: true, classFilter: [0] },
      data: null, createdAt: Date.now(),
    },
    models: [
      { id: "m-mlp-gan",  name: "1. MLP-GAN (Goodfellow 2014)", schemaId: sid, graph: _mlpGan(), createdAt: Date.now() },
      { id: "m-dcgan",    name: "2. DCGAN (Radford 2015)",       schemaId: sid, graph: _dcGan(),  createdAt: Date.now() },
    ],
    trainers: [
      { id: "t-mlp-gan", name: "MLP-GAN Trainer", schemaId: sid, datasetId: DS, modelId: "m-mlp-gan", status: "draft",
        config: { epochs: 200, batchSize: 128, learningRate: 0.0005, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 0, lrSchedulerType: "none", restoreBestWeights: false,
                  trainingSchedule: [
                    { epochs: 1, trainableTags: { discriminator: true, generator: false } },
                    { epochs: 3, trainableTags: { discriminator: false, generator: true } }
                  ], rotateSchedule: true } },
      { id: "t-dcgan", name: "DCGAN Trainer", schemaId: sid, datasetId: DS, modelId: "m-dcgan", status: "draft",
        config: { epochs: 200, batchSize: 128, learningRate: 0.0005, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 0, lrSchedulerType: "none", restoreBestWeights: false,
                  trainingSchedule: [
                    { epochs: 1, trainableTags: { discriminator: true, generator: false } },
                    { epochs: 2, trainableTags: { discriminator: false, generator: true } }
                  ], rotateSchedule: true } },
    ],
    generations: [
      { id: "g-mlp-gen",  name: "MLP-GAN Generate",  schemaId: sid, trainerId: "t-mlp-gan", family: "gan", config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-dcgan-gen", name: "DCGAN Generate",    schemaId: sid, trainerId: "t-dcgan",   family: "gan", config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
    ],
    evaluations: [],
  };
})();

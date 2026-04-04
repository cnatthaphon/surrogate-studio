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

  function _dcWeightCfg(tag, blockName, extra) {
    return Object.assign({
      activation: "linear",
      useBias: false,
      weightTag: tag,
      blockName: blockName,
      kernelInitializer: "randomNormal",
      kernelInitMean: 0,
      kernelInitStddev: 0.02,
      biasInitializer: "zeros"
    }, extra || {});
  }

  function _dcBatchNormCfg(tag, blockName, extra) {
    return Object.assign({
      weightTag: tag,
      blockName: blockName,
      momentum: 0.9,
      epsilon: 0.00001,
      gammaInitializer: "randomNormal",
      gammaInitMean: 1,
      gammaInitStddev: 0.02,
      betaInitializer: "zeros",
      movingMeanInitializer: "zeros",
      movingVarianceInitializer: "ones"
    }, extra || {});
  }

  // ═══════════════════════════════════════════
  // Model 1: MLP-GAN (Goodfellow 2014)
  // ═══════════════════════════════════════════
  function _mlpGan() {
    _nid = 0; var d = {};

    // Generator (tagged "generator") — LayerNorm prevents mode collapse by forcing z-dependent statistics
    var z =    N(d, "sample_z",     { dim: 128, distribution: "normal" },         80, 60);
    var g1 =   N(d, "dense",        { units: 256, activation: "relu", weightTag: "generator", blockName: "G1" }, 200, 60);
    var gbn1 = N(d, "layernorm",    { weightTag: "generator", blockName: "G1_norm" },                           280, 60);
    var g2 =   N(d, "dense",        { units: 512, activation: "relu", weightTag: "generator", blockName: "G2" }, 360, 60);
    var gbn2 = N(d, "layernorm",    { weightTag: "generator", blockName: "G2_norm" },                           440, 60);
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
    var dr1 =  N(d, "dropout",      { rate: 0.3, weightTag: "discriminator", blockName: "D1_drop" }, 640, 180);
    var d2 =   N(d, "dense",        { units: 256, activation: "relu", weightTag: "discriminator" }, 720, 180);
    var dr2 =  N(d, "dropout",      { rate: 0.3, weightTag: "discriminator", blockName: "D2_drop" }, 800, 180);
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

    // Conv Generator (Radford 2015) — affine -> BatchNorm -> ReLU
    var z =    N(d, "sample_z",          { dim: 128, distribution: "normal" },    80, 60);
    var gd =   N(d, "dense",             _dcWeightCfg("generator", "G_dense", { units: 6272 }), 200, 60);
    var gbn1 = N(d, "batchnorm",         _dcBatchNormCfg("generator", "G_bn1"), 300, 60);
    var grelu1 = N(d, "relu",            {},                                    380, 60);
    var gr =   N(d, "reshape",           { targetShape: "7,7,128" },            460, 60);
    var gc1 =  N(d, "conv2d_transpose",  _dcWeightCfg("generator", "G_conv_t1", { filters: 64, kernelSize: 4, strides: 2, padding: "same" }), 620, 60);
    var gbn2 = N(d, "batchnorm",         _dcBatchNormCfg("generator", "G_bn2"), 720, 60);
    var grelu2 = N(d, "relu",            {},                                    800, 60);
    var gc2 =  N(d, "conv2d_transpose",  _dcWeightCfg("generator", "G_out", { filters: 1, kernelSize: 4, strides: 2, padding: "same", activation: "sigmoid" }), 900, 60);
    var gf =   N(d, "flatten",           {},                                    1060, 60);
    var gOut = N(d, "output",            { target: "none", targetType: "none", loss: "none", matchWeight: 0, phase: "generator", headType: "reconstruction" }, 1220, 60);
    C(d, z, gd); C(d, gd, gbn1); C(d, gbn1, grelu1); C(d, grelu1, gr); C(d, gr, gc1); C(d, gc1, gbn2); C(d, gbn2, grelu2); C(d, grelu2, gc2); C(d, gc2, gf); C(d, gf, gOut);

    // G output → ConcatBatch with real
    var img =  N(d, "image_source",      { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 260);
    var cat =  N(d, "concat_batch",      {},                                     500, 200);
    C(d, gOut, cat, "output_1", "input_1");
    C(d, img, cat, "output_1", "input_2");

    // Conv Discriminator (Radford 2015) — LeakyReLU(0.2) + BatchNorm
    var dr =   N(d, "reshape",           { targetShape: "28,28,1" },             660, 200);
    var dc1 =  N(d, "conv2d",            _dcWeightCfg("discriminator", "D_conv1", { filters: 64, kernelSize: 4, strides: 2, padding: "same" }), 820, 200);
    var dlr1 = N(d, "leaky_relu",        { alpha: 0.2 },                         880, 200);
    var dc2 =  N(d, "conv2d",            _dcWeightCfg("discriminator", "D_conv2", { filters: 128, kernelSize: 4, strides: 2, padding: "same" }), 940, 200);
    var dbn1 = N(d, "batchnorm",         _dcBatchNormCfg("discriminator", "D_bn1"), 1000, 200);
    var dlr2 = N(d, "leaky_relu",        { alpha: 0.2 },                         1060, 200);
    var df =   N(d, "flatten",           {},                                     1140, 200);
    var dd =   N(d, "dense",             _dcWeightCfg("discriminator", "D_out", { units: 1, activation: "sigmoid" }), 1300, 200);
    var dOut = N(d, "output",            { target: "custom", targetType: "custom", loss: "bce", matchWeight: 1, phase: "discriminator", headType: "classification" }, 1460, 200);
    C(d, cat, dr); C(d, dr, dc1); C(d, dc1, dlr1); C(d, dlr1, dc2); C(d, dc2, dbn1); C(d, dbn1, dlr2); C(d, dlr2, df); C(d, df, dd); C(d, dd, dOut);

    // Labels: [fake_label, real_label] via ConcatBatch (paper-faithful 0/1 targets)
    var c0 =   N(d, "constant",          { value: 0, dim: 1 },                  1140, 360);
    var c1 =   N(d, "constant",          { value: 1, dim: 1 },                  1140, 440);
    var sw =   N(d, "phase_switch",      { activePhase: "discriminator" },       1300, 400);
    C(d, c0, sw, "output_1", "input_1");
    C(d, c1, sw, "output_1", "input_2");
    var cR =   N(d, "constant",          { value: 1, dim: 1 },                  1300, 480);
    var lcat = N(d, "concat_batch",      {},                                    1460, 440);
    C(d, sw, lcat, "output_1", "input_1");
    C(d, cR, lcat, "output_1", "input_2");
    C(d, lcat, dOut, "output_1", "input_2");

    return graph(d);
  }

  // ═══════════════════════════════════════════
  // Model 3: MLP-WGAN (Arjovsky 2017)
  // ═══════════════════════════════════════════
  function _mlpWgan() {
    _nid = 0; var d = {};

    // Generator — same as MLP-GAN
    var z =    N(d, "sample_z",     { dim: 128, distribution: "normal" },         80, 60);
    var g1 =   N(d, "dense",        { units: 256, activation: "relu", weightTag: "generator", blockName: "G1" }, 200, 60);
    var gbn1 = N(d, "layernorm",    { weightTag: "generator", blockName: "G1_norm" },                           280, 60);
    var g2 =   N(d, "dense",        { units: 512, activation: "relu", weightTag: "generator", blockName: "G2" }, 360, 60);
    var gbn2 = N(d, "layernorm",    { weightTag: "generator", blockName: "G2_norm" },                           440, 60);
    var g3 =   N(d, "dense",        { units: 784, activation: "sigmoid", weightTag: "generator", blockName: "G3" }, 520, 60);
    var gOut = N(d, "output",       { target: "none", targetType: "none", loss: "none", matchWeight: 0, phase: "generator", headType: "reconstruction" }, 640, 60);
    C(d, z, g1); C(d, g1, gbn1); C(d, gbn1, g2); C(d, g2, gbn2); C(d, gbn2, g3); C(d, g3, gOut);

    var img =  N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 240);
    var cat =  N(d, "concat_batch", {},                                          400, 180);
    C(d, gOut, cat, "output_1", "input_1");
    C(d, img, cat, "output_1", "input_2");

    // Critic (no sigmoid — linear output for Wasserstein distance)
    var d1 =   N(d, "dense",        { units: 512, activation: "relu", weightTag: "discriminator" }, 560, 180);
    var dr1 =  N(d, "dropout",      { rate: 0.3, weightTag: "discriminator", blockName: "D1_drop" }, 640, 180);
    var d2 =   N(d, "dense",        { units: 256, activation: "relu", weightTag: "discriminator" }, 720, 180);
    var dr2 =  N(d, "dropout",      { rate: 0.3, weightTag: "discriminator", blockName: "D2_drop" }, 800, 180);
    var d3 =   N(d, "dense",        { units: 1, activation: "linear", weightTag: "discriminator" }, 880, 180);
    var dOut = N(d, "output",       { target: "custom", targetType: "custom", loss: "wasserstein", matchWeight: 1, phase: "discriminator", headType: "classification" }, 1040, 180);
    C(d, cat, d1); C(d, d1, dr1); C(d, dr1, d2); C(d, d2, dr2); C(d, dr2, d3); C(d, d3, dOut);

    // Labels: Wasserstein uses +1 (real) and -1 (fake)
    // D step: [fake=-1, real=1], G step: [fake=1, real=1]
    var c0 =   N(d, "constant",     { value: -1, dim: 1 },                      560, 340);
    var c1 =   N(d, "constant",     { value: 1, dim: 1 },                       560, 420);
    var sw =   N(d, "phase_switch", { activePhase: "discriminator" },            720, 380);
    C(d, c0, sw, "output_1", "input_1");
    C(d, c1, sw, "output_1", "input_2");
    var cR =   N(d, "constant",     { value: 1, dim: 1 },                       720, 460);
    var lcat = N(d, "concat_batch", {},                                          880, 420);
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
      { id: "m-mlp-wgan", name: "3. MLP-WGAN (Arjovsky 2017)",   schemaId: sid, graph: _mlpWgan(), createdAt: Date.now() },
    ],
    trainers: [
      // Untrained — user trains from scratch
      { id: "t-mlp-gan", name: "MLP-GAN Trainer", schemaId: sid, datasetId: DS, modelId: "m-mlp-gan", status: "draft",
        config: { epochs: 1000, batchSize: 128, learningRate: 0.0005, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 0, lrSchedulerType: "none", weightSelection: "last",
                  trainingSchedule: [
                    { epochs: 10, trainableTags: { discriminator: true, generator: false } },
                    { epochs: 1, trainableTags: { discriminator: false, generator: true } }
                  ], rotateSchedule: true } },
      { id: "t-dcgan", name: "DCGAN Trainer", schemaId: sid, datasetId: DS, modelId: "m-dcgan", status: "draft",
        config: { epochs: 200, batchSize: 128, learningRate: 0.0002, optimizerType: "adam", optimizerBeta1: 0.5, optimizerBeta2: 0.999, useServer: true,
                  earlyStoppingPatience: 0, lrSchedulerType: "none", weightSelection: "last",
                  trainingSchedule: [
                    { unit: "batch", batches: 1, trainableTags: { discriminator: true, generator: false } },
                    { unit: "batch", batches: 1, trainableTags: { discriminator: false, generator: true } }
                  ], rotateSchedule: true } },
      // Pre-trained — generate immediately (weights loaded on init)
      { id: "t-mlp-gan-trained", name: "MLP-GAN (pre-trained)", schemaId: sid, datasetId: DS, modelId: "m-mlp-gan", status: "done",
        _pretrainedVar: "MLP_GAN_PRETRAINED_BIN_B64",
        config: { epochs: 1000, batchSize: 128, learningRate: 0.0005, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 0, lrSchedulerType: "none", weightSelection: "last",
                  trainingSchedule: [
                    { epochs: 10, trainableTags: { discriminator: true, generator: false } },
                    { epochs: 1, trainableTags: { discriminator: false, generator: true } }
                  ], rotateSchedule: true },
        metrics: { bestEpoch: 928, paramCount: 1102230 } },
      { id: "t-dcgan-trained", name: "DCGAN (pre-trained)", schemaId: sid, datasetId: DS, modelId: "m-dcgan", status: "done",
        _pretrainedVar: "DCGAN_PRETRAINED_BIN_B64",
        config: { epochs: 200, batchSize: 128, learningRate: 0.0002, optimizerType: "adam", optimizerBeta1: 0.5, optimizerBeta2: 0.999, useServer: false,
                  earlyStoppingPatience: 0, lrSchedulerType: "none", weightSelection: "last",
                  trainingSchedule: [
                    { unit: "batch", batches: 1, trainableTags: { discriminator: true, generator: false } },
                    { unit: "batch", batches: 1, trainableTags: { discriminator: false, generator: true } }
                  ], rotateSchedule: true },
        metrics: { bestEpoch: 3, paramCount: 1099525 } },
      // WGAN (Arjovsky 2017) — Wasserstein loss, linear critic output
      { id: "t-mlp-wgan", name: "MLP-WGAN Trainer", schemaId: sid, datasetId: DS, modelId: "m-mlp-wgan", status: "draft",
        config: { epochs: 1000, batchSize: 128, learningRate: 0.00005, optimizerType: "rmsprop", useServer: true,
                  earlyStoppingPatience: 0, lrSchedulerType: "none", weightSelection: "last",
                  trainingSchedule: [
                    { epochs: 5, trainableTags: { discriminator: true, generator: false }, clipWeights: 0.01 },
                    { epochs: 1, trainableTags: { discriminator: false, generator: true } }
                  ], rotateSchedule: true } },
      { id: "t-mlp-wgan-trained", name: "MLP-WGAN (pre-trained)", schemaId: sid, datasetId: DS, modelId: "m-mlp-wgan", status: "done",
        _pretrainedVar: "MLP_WGAN_PRETRAINED_BIN_B64",
        config: { epochs: 1000, batchSize: 128, learningRate: 0.00005, optimizerType: "rmsprop", useServer: true,
                  earlyStoppingPatience: 0, lrSchedulerType: "none", weightSelection: "last",
                  trainingSchedule: [
                    { epochs: 5, trainableTags: { discriminator: true, generator: false }, clipWeights: 0.01 },
                    { epochs: 1, trainableTags: { discriminator: false, generator: true } }
                  ], rotateSchedule: true } },
    ],
    generations: [
      { id: "g-mlp-gen",         name: "MLP-GAN Generate",              schemaId: sid, trainerId: "t-mlp-gan",         family: "gan", config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-dcgan-gen",       name: "DCGAN Generate",                schemaId: sid, trainerId: "t-dcgan",           family: "gan", config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-mlp-gen-trained", name: "MLP-GAN Generate (pre-trained)", schemaId: sid, trainerId: "t-mlp-gan-trained", family: "gan", config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-dcgan-gen-trained", name: "DCGAN Generate (pre-trained)", schemaId: sid, trainerId: "t-dcgan-trained",   family: "gan", config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-mlp-wgan-gen",   name: "MLP-WGAN Generate",              schemaId: sid, trainerId: "t-mlp-wgan",        family: "gan", config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-mlp-wgan-gen-trained", name: "MLP-WGAN Generate (pre-trained)", schemaId: sid, trainerId: "t-mlp-wgan-trained", family: "gan", config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
    ],
    evaluations: [],
  };
})();

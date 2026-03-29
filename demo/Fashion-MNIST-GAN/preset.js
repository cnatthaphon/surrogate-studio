/**
 * Fashion-MNIST GAN Demo — Real Adversarial Architecture
 *
 * Generator: SampleZ(128) → Dense(256) → Dense(512) → Dense(784,sigmoid) → Output(pixel_values, phase=generator)
 *                                                                                ↓ [connectable]
 *                                                                             Detach (stop G gradient)
 *                                                                                ↓
 * Discriminator: ImageSource(784) ─────────────────────────────────→ ConcatBatch(real + fake)
 *                                                                                ↓
 *                                                                    Dense(512) → Dense(256) → Dense(1,sigmoid)
 *                                                                                ↓
 * Labels: Constant(1) ──→ PhaseSwitch ──────────────────────────────→ Output(BCE, phase=discriminator)
 *         Constant(0) ──→
 *
 * D phase: D sees real(label=1) + fake(label=0), learns to classify
 * G phase: PhaseSwitch flips to 1, G trains to fool D
 * Detach prevents D gradient from updating G during D phase
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

  // ── MLP-GAN with real adversarial structure ──
  function _mlpGan() {
    _nid = 0; var d = {};

    // === Generator path ===
    var z =   N(d, "sample_z", { dim: 128, distribution: "normal" }, 60, 60);
    var g1 =  N(d, "dense", { units: 256, activation: "relu" }, 220, 60);
    var g2 =  N(d, "dense", { units: 512, activation: "relu" }, 380, 60);
    var g3 =  N(d, "dense", { units: 784, activation: "sigmoid" }, 540, 60);
    var gOut = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", matchWeight: 1, phase: "generator", headType: "reconstruction" }, 700, 60);
    C(d, z, g1); C(d, g1, g2); C(d, g2, g3); C(d, g3, gOut);

    // === G output → Detach → feeds into D (stops G gradient during D phase) ===
    var det = N(d, "detach", {}, 700, 180);
    C(d, gOut, det); // output node is now connectable

    // === ConcatBatch: merge real images + detached fake images ===
    var img =  N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28, 28, 1] }, 60, 300);
    var cat =  N(d, "concat_batch", {}, 400, 300);
    C(d, img, cat, "output_1", "input_1");  // real images → input 1
    C(d, det, cat, "output_1", "input_2");  // fake images (detached) → input 2

    // === Discriminator: classifies real vs fake ===
    var d1 =   N(d, "dense", { units: 512, activation: "relu" }, 560, 300);
    var d2 =   N(d, "dense", { units: 256, activation: "relu" }, 700, 300);
    var d3 =   N(d, "dense", { units: 1, activation: "sigmoid" }, 840, 300);
    C(d, cat, d1); C(d, d1, d2); C(d, d2, d3);

    // === Labels: PhaseSwitch selects real/fake labels based on training phase ===
    var c1 =   N(d, "constant", { value: 1, dim: 1 }, 560, 440);  // real label
    var c0 =   N(d, "constant", { value: 0, dim: 1 }, 560, 520);  // fake label
    var sw =   N(d, "phase_switch", {}, 700, 480);
    C(d, c1, sw, "output_1", "input_1");  // phase 0 (discriminator) → use real labels for real half
    C(d, c0, sw, "output_1", "input_2");  // phase 1 (generator) → not used (G uses fool target)

    // === D Output: BCE classification ===
    var dOut = N(d, "output", { target: "label", targetType: "label", loss: "bce", matchWeight: 1, phase: "discriminator", headType: "classification" }, 960, 380);
    C(d, d3, dOut);

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
      { id: "m-mlp-gan", name: "MLP-GAN (Goodfellow 2014)", schemaId: sid, graph: _mlpGan(), createdAt: Date.now() },
    ],
    trainers: [
      { id: "t-mlp-gan", name: "GAN Trainer", schemaId: sid, datasetId: DS, modelId: "m-mlp-gan", status: "draft",
        config: { epochs: 50, batchSize: 128, learningRate: 0.0002, optimizerType: "adam", useServer: true,
                  phaseOrder: ["discriminator", "generator"], phaseEpochs: { discriminator: 1, generator: 1 } } },
    ],
    generations: [
      { id: "g-gan-gen", name: "GAN Generate", schemaId: sid, trainerId: "t-mlp-gan", family: "gan",
        config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
    ],
    evaluations: [],
  };
})();

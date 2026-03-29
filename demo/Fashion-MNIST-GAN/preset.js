/**
 * Fashion-MNIST GAN Demo — MLP-GAN vs DCGAN
 *
 * Model 1: MLP-GAN (Goodfellow et al. 2014)
 *   Generator:     SampleZ(128) → Dense(256) → Dense(512) → Dense(784, sigmoid)
 *   Discriminator: ImageSource(784) → Dense(512) → Dense(256) → Dense(784, sigmoid)
 *
 * Model 2: DCGAN (Radford et al. 2015)
 *   Generator:     SampleZ(128) → Dense(7*7*128) → Reshape(7,7,128) → ConvT2D(64) → ConvT2D(1, sigmoid)
 *   Discriminator: ImageSource → Reshape(28,28,1) → Conv2D(64) → Conv2D(128) → Flatten → Dense(784, sigmoid)
 *
 * Both use phased training: generator phase + discriminator phase alternate each epoch.
 *
 * References:
 *   Goodfellow et al., "Generative Adversarial Nets", NeurIPS 2014
 *   Radford, Metz, Chintala, "Unsupervised Representation Learning with DCGANs", ICLR 2016
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
  function graph(d) { return { drawflow: { Home: { data: d } } }; }

  // ── Model 1: MLP-GAN (Goodfellow 2014) ──
  function _mlpGan() {
    _nid = 0; var d = {};
    // Generator
    var z = N(d, "sample_z", { dim: 128, distribution: "normal" }, 60, 60);
    var g1 = N(d, "dense", { units: 256, activation: "relu" }, 220, 60);
    var g2 = N(d, "dense", { units: 512, activation: "relu" }, 380, 60);
    var g3 = N(d, "dense", { units: 784, activation: "sigmoid" }, 540, 60);
    var gOut = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", matchWeight: 1, phase: "generator", headType: "reconstruction" }, 700, 60);
    C(d,z,g1); C(d,g1,g2); C(d,g2,g3); C(d,g3,gOut);
    // Discriminator (real images)
    var img = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 60, 240);
    var d1 = N(d, "dense", { units: 512, activation: "relu" }, 260, 240);
    var d2 = N(d, "dense", { units: 256, activation: "relu" }, 420, 240);
    var d3 = N(d, "dense", { units: 784, activation: "sigmoid" }, 580, 240);
    var dOut = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", matchWeight: 1, phase: "discriminator", headType: "reconstruction" }, 740, 240);
    C(d,img,d1); C(d,d1,d2); C(d,d2,d3); C(d,d3,dOut);
    return graph(d);
  }

  // ── Model 2: DCGAN (Radford 2015) ──
  function _dcGan() {
    _nid = 0; var d = {};
    // Generator: z → Dense → Reshape → ConvT2D → ConvT2D(1, sigmoid)
    var z = N(d, "sample_z", { dim: 128, distribution: "normal" }, 60, 60);
    var gd = N(d, "dense", { units: 6272, activation: "relu" }, 220, 60);  // 7*7*128
    var gr = N(d, "reshape", { targetShape: "7,7,128" }, 380, 60);
    var gc1 = N(d, "conv2d_transpose", { filters: 64, kernelSize: 4, strides: 2, padding: "same", activation: "relu" }, 540, 60);  // → 14x14
    var gc2 = N(d, "conv2d_transpose", { filters: 1, kernelSize: 4, strides: 2, padding: "same", activation: "sigmoid" }, 700, 60);  // → 28x28
    var gf = N(d, "flatten", {}, 860, 60);
    var gOut = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", matchWeight: 1, phase: "generator", headType: "reconstruction" }, 1020, 60);
    C(d,z,gd); C(d,gd,gr); C(d,gr,gc1); C(d,gc1,gc2); C(d,gc2,gf); C(d,gf,gOut);
    // Discriminator: Image → Reshape → Conv2D → Conv2D → Flatten → Dense
    var img = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 60, 260);
    var dr = N(d, "reshape", { targetShape: "28,28,1" }, 220, 260);
    var dc1 = N(d, "conv2d", { filters: 64, kernelSize: 4, strides: 2, padding: "same", activation: "relu" }, 380, 260);  // → 14x14
    var dc2 = N(d, "conv2d", { filters: 128, kernelSize: 4, strides: 2, padding: "same", activation: "relu" }, 540, 260);  // → 7x7
    var df = N(d, "flatten", {}, 700, 260);
    var dd = N(d, "dense", { units: 784, activation: "sigmoid" }, 860, 260);
    var dOut = N(d, "output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", matchWeight: 1, phase: "discriminator", headType: "reconstruction" }, 1020, 260);
    C(d,img,dr); C(d,dr,dc1); C(d,dc1,dc2); C(d,dc2,df); C(d,df,dd); C(d,dd,dOut);
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
      { id: "m-mlp-gan", name: "1. MLP-GAN (Goodfellow 2014)", schemaId: sid, graph: _mlpGan(), createdAt: Date.now() },
      { id: "m-dcgan",   name: "2. DCGAN (Radford 2015)",      schemaId: sid, graph: _dcGan(),  createdAt: Date.now() },
    ],
    trainers: [
      { id: "t-mlp-gan", name: "MLP-GAN Trainer", schemaId: sid, datasetId: DS, modelId: "m-mlp-gan", status: "draft",
        config: { epochs: 50, batchSize: 64, learningRate: 0.0002, optimizerType: "adam", useServer: true } },
      { id: "t-dcgan",   name: "DCGAN Trainer",   schemaId: sid, datasetId: DS, modelId: "m-dcgan",   status: "draft",
        config: { epochs: 50, batchSize: 64, learningRate: 0.0002, optimizerType: "adam", useServer: true } },
    ],
    generations: [
      { id: "g-mlp-gan", name: "MLP-GAN Generate", schemaId: sid, trainerId: "t-mlp-gan", family: "gan",
        config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
      { id: "g-dcgan",   name: "DCGAN Generate",   schemaId: sid, trainerId: "t-dcgan",   family: "gan",
        config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
    ],
    evaluations: [
      { id: "e-gan-bench", name: "MLP-GAN vs DCGAN Reconstruction", schemaId: sid, datasetId: DS,
        trainerIds: ["t-mlp-gan", "t-dcgan"],
        evaluatorIds: ["mae", "rmse"], status: "draft", runs: [], createdAt: Date.now() },
    ],
  };
})();

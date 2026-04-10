/**
 * Fashion-MNIST UNet Demo — Image Reconstruction with Skip Connections
 *
 * UNet architecture: encoder (Conv2D + MaxPool) → bottleneck → decoder
 * (UpSample + Concat skip connections + Conv2D) → reconstruction output.
 *
 * Demonstrates that the graph editor supports branching topologies
 * (skip connections) with Conv2D, MaxPool2D, UpSample2D, and Concat nodes.
 *
 * Reference: Ronneberger, Fischer, Brox — "U-Net: Convolutional Networks
 * for Biomedical Image Segmentation", MICCAI 2015. arXiv:1505.04597
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

  // ─── UNet Model ───
  // Encoder: Conv(16) → Pool → Conv(32) → Pool
  // Bottleneck: Conv(64)
  // Decoder: UpSample → Concat(skip2) → Conv(32) → UpSample → Concat(skip1) → Conv(16) → Conv(1)
  function buildUNet() {
    var d = {};
    // Feature block + Input + Reshape to 28x28x1
    var imgSrc  = N(d, "image_source",   { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 50, 300);
    var reshape = N(d, "reshape",        { targetShape: "28,28,1" },            200,  300);

    // Encoder block 1
    var enc1a   = N(d, "conv2d",         { filters: 16, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 380, 200);
    var enc1b   = N(d, "conv2d",         { filters: 16, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 550, 200);
    var pool1   = N(d, "maxpool2d",      { poolSize: 2, strides: 2 },           720, 200);

    // Encoder block 2
    var enc2a   = N(d, "conv2d",         { filters: 32, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 380, 400);
    var enc2b   = N(d, "conv2d",         { filters: 32, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 550, 400);
    var pool2   = N(d, "maxpool2d",      { poolSize: 2, strides: 2 },           720, 400);

    // Bottleneck
    var bottleA = N(d, "conv2d",         { filters: 64, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 550, 600);
    var bottleB = N(d, "conv2d",         { filters: 64, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 720, 600);

    // Decoder block 2
    var up2     = N(d, "upsample2d",     { size: 2 },                           900, 600);
    var cat2    = N(d, "concat",         {},                                     900, 400);
    var dec2a   = N(d, "conv2d",         { filters: 32, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 1080, 400);
    var dec2b   = N(d, "conv2d",         { filters: 32, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 1250, 400);

    // Decoder block 1
    var up1     = N(d, "upsample2d",     { size: 2 },                           1250, 200);
    var cat1    = N(d, "concat",         {},                                     1250, 100);
    var dec1a   = N(d, "conv2d",         { filters: 16, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 1420, 100);
    var dec1b   = N(d, "conv2d",         { filters: 1,  kernelSize: 1, strides: 1, padding: "same", activation: "sigmoid" }, 1590, 100);

    // Flatten + Output
    var flat    = N(d, "flatten",        {},                                     1590, 300);
    var out     = N(d, "output",         { targetType: "x", matchWeight: 1, headType: "reconstruction" }, 1760, 300);

    // Encoder path
    C(d, imgSrc, reshape);
    C(d, reshape, enc1a);
    C(d, enc1a, enc1b);
    C(d, enc1b, pool1);
    C(d, pool1, enc2a);
    C(d, enc2a, enc2b);
    C(d, enc2b, pool2);

    // Bottleneck
    C(d, pool2, bottleA);
    C(d, bottleA, bottleB);

    // Decoder path with skip connections
    C(d, bottleB, up2);
    C(d, up2, cat2, "output_1", "input_1");     // upsampled features
    C(d, enc2b, cat2, "output_1", "input_2");   // skip connection from encoder block 2
    C(d, cat2, dec2a);
    C(d, dec2a, dec2b);

    C(d, dec2b, up1);
    C(d, up1, cat1, "output_1", "input_1");     // upsampled features
    C(d, enc1b, cat1, "output_1", "input_2");   // skip connection from encoder block 1
    C(d, cat1, dec1a);
    C(d, dec1a, dec1b);

    C(d, dec1b, flat);
    C(d, flat, out);

    return graph(d);
  }

  // ─── Simple Conv AE (baseline, no skip connections) ───
  // Uses MaxPool + UpSample+Conv (avoids ConvTranspose dimension issues in PyTorch)
  function buildConvAE() {
    _nid = 100;
    var d = {};
    var imgSrc  = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 50, 300);
    var reshape = N(d, "reshape",    { targetShape: "28,28,1" },   200,  300);
    var e1      = N(d, "conv2d",     { filters: 16, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 380, 300);
    var pool1   = N(d, "maxpool2d",  { poolSize: 2, strides: 2 },  550, 300);
    var e2      = N(d, "conv2d",     { filters: 32, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 720, 300);
    var pool2   = N(d, "maxpool2d",  { poolSize: 2, strides: 2 },  890, 300);
    var up1     = N(d, "upsample2d", { size: 2 },                 1060, 300);
    var d1      = N(d, "conv2d",     { filters: 16, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 1230, 300);
    var up2     = N(d, "upsample2d", { size: 2 },                 1400, 300);
    var d2      = N(d, "conv2d",     { filters: 1,  kernelSize: 1, strides: 1, padding: "same", activation: "sigmoid" }, 1570, 300);
    var flat    = N(d, "flatten",    {},                           1740, 300);
    var out     = N(d, "output",     { targetType: "x", matchWeight: 1, headType: "reconstruction" }, 1910, 300);

    C(d, imgSrc, reshape); C(d, reshape, e1); C(d, e1, pool1); C(d, pool1, e2); C(d, e2, pool2);
    C(d, pool2, up1); C(d, up1, d1); C(d, d1, up2); C(d, up2, d2); C(d, d2, flat); C(d, flat, out);
    return graph(d);
  }

  var DATASET = {
    id: "fashion_unet_ds",
    name: "Fashion-MNIST (all classes)",
    schemaId: "fashion_mnist",
    datasetModuleId: "fashion_mnist",
    source: "tfjs_fashion_mnist_sprite",
    mode: "classification",
    imageShape: [28, 28, 1],
    featureSize: 784,
    classCount: 10,
    classNames: ["T-shirt/top", "Trouser", "Pullover", "Dress", "Coat", "Sandal", "Shirt", "Sneaker", "Bag", "Ankle boot"],
    splitConfig: { mode: "stratified_label", train: 0.8, val: 0.1, test: 0.1 },
    seed: 42,
  };

  var MODELS = [
    { id: "unet_model", name: "UNet (skip connections)", schemaId: "fashion_mnist", graph: buildUNet() },
    { id: "conv_ae_model", name: "Conv AE (baseline)", schemaId: "fashion_mnist", graph: buildConvAE() },
  ];

  var TRAINERS = [
    {
      id: "unet_trainer", name: "UNet Trainer", schemaId: "fashion_mnist",
      datasetId: "fashion_unet_ds", modelId: "unet_model",
      runtime: "server_pytorch", runtimeBackend: "auto", status: "draft",
      trainCfg: { epochs: 20, batchSize: 64, learningRate: 0.001, optimizer: "adam" },
    },
    {
      id: "conv_ae_trainer", name: "Conv AE Trainer", schemaId: "fashion_mnist",
      datasetId: "fashion_unet_ds", modelId: "conv_ae_model",
      runtime: "server_pytorch", runtimeBackend: "auto", status: "draft",
      trainCfg: { epochs: 20, batchSize: 64, learningRate: 0.001, optimizer: "adam" },
    },
  ];

  var GENERATIONS = [
    {
      id: "unet_recon", name: "UNet Reconstruction", schemaId: "fashion_mnist",
      trainerId: "unet_trainer", method: "reconstruct", status: "draft", runs: [],
    },
    {
      id: "conv_ae_recon", name: "Conv AE Reconstruction", schemaId: "fashion_mnist",
      trainerId: "conv_ae_trainer", method: "reconstruct", status: "draft", runs: [],
    },
  ];

  var EVALUATIONS = [
    {
      id: "unet_eval", name: "UNet vs Conv AE", schemaId: "fashion_mnist",
      trainerIds: ["unet_trainer", "conv_ae_trainer"],
      metrics: ["mae", "mse", "r2"], status: "draft",
    },
  ];

  window.FASHION_MNIST_UNET_PRESET = {
    dataset: DATASET,
    models: MODELS,
    trainers: TRAINERS,
    generations: GENERATIONS,
    evaluations: EVALUATIONS,
  };
})();

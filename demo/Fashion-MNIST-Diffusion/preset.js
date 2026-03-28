/**
 * Fashion-MNIST Diffusion (DDPM-style) Demo Preset
 *
 * Denoiser: ImageSource(784) + AddNoise + TimeEmbed(64) → Dense(512) → Dense(256) → Dense(784)
 * Trains to predict noise added to images at various timesteps.
 * Generation: iterative denoising from pure noise.
 */
(function () {
  "use strict";

  function _makeDenoiserGraph() {
    var d = {};
    var id = 0;
    function node(name, data, posX, posY) {
      id++;
      d[String(id)] = {
        id: id, name: name + "_layer", data: data || {}, class: name + "_layer",
        html: "<div><div>" + name + "_layer</div></div>", typenode: false,
        inputs: {}, outputs: {}, pos_x: posX, pos_y: posY,
      };
      return String(id);
    }
    function conn(fromId, toId, outPort, inPort) {
      var from = d[fromId]; var to = d[toId];
      outPort = outPort || "output_1"; inPort = inPort || "input_1";
      if (!from.outputs[outPort]) from.outputs[outPort] = { connections: [] };
      from.outputs[outPort].connections.push({ node: toId, input: inPort });
      if (!to.inputs[inPort]) to.inputs[inPort] = { connections: [] };
      to.inputs[inPort].connections.push({ node: fromId, output: outPort });
    }

    // Image input → noise injection → denoiser → predict noise
    var img = node("image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28, 28, 1] }, 60, 100);
    var noise = node("noise_injection", { scale: 0.3, schedule: "constant" }, 230, 100);
    conn(img, noise);

    // Denoiser network: noisy_image → Dense(512) → Dense(256) → Dense(784)
    var d1 = node("dense", { units: 512, activation: "relu" }, 400, 100);
    var d2 = node("dense", { units: 256, activation: "relu" }, 570, 100);
    var d3 = node("dense", { units: 784, activation: "linear" }, 740, 100);
    conn(noise, d1); conn(d1, d2); conn(d2, d3);

    // Output: predict the clean image (denoising autoencoder)
    var out = node("output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", matchWeight: 1 }, 910, 100);
    conn(d3, out);

    return { drawflow: { Home: { data: d } } };
  }

  window.FASHION_MNIST_DIFFUSION_PRESET = {
    dataset: {
      id: "demo-fmnist-diff-ds",
      name: "Fashion-MNIST (60000)",
      schemaId: "fashion_mnist",
      status: "draft",
      config: { seed: 42, splitMode: "stratified_label", trainFrac: 0.8, valFrac: 0.1, testFrac: 0.1, totalCount: 60000, useFullSource: true },
      data: null,
      createdAt: Date.now(),
    },
    models: [
      { id: "demo-fmnist-denoiser", name: "Denoising Autoencoder", schemaId: "fashion_mnist", graph: _makeDenoiserGraph(), createdAt: Date.now() },
    ],
    trainers: [
      {
        id: "demo-fmnist-diff-trainer", name: "Denoiser Trainer", schemaId: "fashion_mnist",
        datasetId: "demo-fmnist-diff-ds", modelId: "demo-fmnist-denoiser", status: "draft",
        config: { epochs: 20, batchSize: 128, learningRate: 0.001, optimizerType: "adam", useServer: true },
      },
    ],
    generations: [
      { id: "demo-fmnist-diff-gen", name: "Diffusion Generation", schemaId: "fashion_mnist", trainerId: "", family: "", config: { method: "langevin", numSamples: 16, steps: 100, lr: 0.01, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
    ],
    evaluations: [],
  };
})();

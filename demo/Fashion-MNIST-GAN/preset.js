/**
 * Fashion-MNIST GAN Demo Preset
 *
 * Generator: SampleZ(128) → Dense(256) → Dense(512) → Dense(784, sigmoid)
 * Discriminator: ImageSource(784) → Dense(512) → Dense(256) → Dense(1, sigmoid)
 * Phase 1: Train D (real vs fake)
 * Phase 2: Train G (fool D)
 */
(function () {
  "use strict";

  function _makeGanGraph() {
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

    // Generator: z(128) → Dense(256, relu) → Dense(512, relu) → Dense(784, sigmoid)
    var z = node("sample_z", { dim: 128, distribution: "normal" }, 60, 80);
    var g1 = node("dense", { units: 256, activation: "relu" }, 230, 80);
    var g2 = node("dense", { units: 512, activation: "relu" }, 400, 80);
    var g3 = node("dense", { units: 784, activation: "sigmoid" }, 570, 80);
    var gOut = node("output", { target: "xv", targetType: "xv", loss: "mse", matchWeight: 1, phase: 2 }, 740, 80);
    conn(z, g1); conn(g1, g2); conn(g2, g3); conn(g3, gOut);

    // Discriminator: image(784) → Dense(512, relu) → Dense(256, relu) → Dense(1, sigmoid)
    var img = node("image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28, 28, 1] }, 60, 250);
    var d1 = node("dense", { units: 512, activation: "relu" }, 260, 250);
    var d2 = node("dense", { units: 256, activation: "relu" }, 430, 250);
    var d3 = node("dense", { units: 1, activation: "sigmoid" }, 600, 250);
    var dOut = node("output", { target: "label", targetType: "label", loss: "bce", matchWeight: 1, phase: 1 }, 770, 250);
    conn(img, d1); conn(d1, d2); conn(d2, d3); conn(d3, dOut);

    return { drawflow: { Home: { data: d } } };
  }

  window.FASHION_MNIST_GAN_PRESET = {
    dataset: {
      id: "demo-fmnist-gan-ds",
      name: "Fashion-MNIST (60000)",
      schemaId: "fashion_mnist",
      status: "draft",
      config: { seed: 42, splitMode: "stratified_label", trainFrac: 0.8, valFrac: 0.1, testFrac: 0.1, totalCount: 60000, useFullSource: true },
      data: null,
      createdAt: Date.now(),
    },
    models: [
      { id: "demo-fmnist-gan", name: "Fashion-MNIST GAN", schemaId: "fashion_mnist", graph: _makeGanGraph(), createdAt: Date.now() },
    ],
    trainers: [
      {
        id: "demo-fmnist-gan-trainer", name: "GAN Trainer", schemaId: "fashion_mnist",
        datasetId: "demo-fmnist-gan-ds", modelId: "demo-fmnist-gan", status: "draft",
        config: { epochs: 50, batchSize: 64, learningRate: 0.0002, optimizerType: "adam", useServer: true },
      },
    ],
    generations: [
      { id: "demo-fmnist-gan-gen", name: "GAN Generation", schemaId: "fashion_mnist", trainerId: "", family: "", config: { method: "random", numSamples: 16, temperature: 1.0, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
    ],
    evaluations: [],
  };
})();

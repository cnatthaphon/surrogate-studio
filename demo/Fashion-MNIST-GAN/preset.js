/**
 * Fashion-MNIST GAN Demo Preset
 *
 * Generator: SampleZ(128) → Dense(256) → Dense(512) → Dense(784, sigmoid)
 * Discriminator: Dense(512) → Dense(256) → Dense(1, sigmoid)
 *
 * Two output paths sharing the same D layers:
 * 1. G output → Detach → D → Output(phase="discriminator")  [D trains, G frozen via Detach]
 * 2. G output → D → Output(phase="generator")  [G trains through D, D weights included in gradient]
 *
 * Plus real image path through D for discriminator training.
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

    // === Generator ===
    var z = node("sample_z", { dim: 128, distribution: "normal" }, 60, 60);
    var g1 = node("dense", { units: 256, activation: "relu" }, 220, 60);
    var g2 = node("dense", { units: 512, activation: "relu" }, 380, 60);
    var g3 = node("dense", { units: 784, activation: "sigmoid" }, 540, 60);
    conn(z, g1); conn(g1, g2); conn(g2, g3);

    // Generator output — reconstruction target, trains G to produce realistic images
    var gOut = node("output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", matchWeight: 1, phase: "generator" }, 700, 60);
    conn(g3, gOut);

    // === Discriminator (on real images) ===
    var img = node("image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28, 28, 1] }, 60, 240);
    var d1 = node("dense", { units: 512, activation: "relu" }, 260, 240);
    var d2 = node("dense", { units: 256, activation: "relu" }, 420, 240);
    var d3 = node("dense", { units: 784, activation: "sigmoid" }, 580, 240);
    conn(img, d1); conn(d1, d2); conn(d2, d3);

    // Discriminator output — reconstruction on real images
    var dOut = node("output", { target: "pixel_values", targetType: "pixel_values", loss: "mse", matchWeight: 1, phase: "discriminator" }, 740, 240);
    conn(d3, dOut);

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

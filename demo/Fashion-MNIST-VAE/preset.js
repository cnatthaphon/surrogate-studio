/**
 * Fashion-MNIST VAE Demo Preset
 *
 * Pre-configures store with:
 * - Fashion-MNIST dataset (draft, fetches from CDN on generate)
 * - VAE model graph: ImageSource(784) → Dense(512) → Dense(256) → μ(32)/logσ²(32) → Reparam → Dense(256) → Dense(512) → Output(784)
 * - MLP-AE baseline: ImageSource(784) → Dense(512) → Dense(256) → Dense(32) → Dense(256) → Dense(512) → Output(784)
 * - Classifier baseline: ImageSource(784) → Dense(256) → Dense(128) → Output(10, label)
 * - Trainer sessions for each model
 */
(function () {
  "use strict";

  function _makeVaeGraph() {
    var d = {};
    var id = 0;
    function node(name, data, posX, posY, inputs, outputs) {
      id++;
      d[String(id)] = {
        id: id, name: name + "_layer", data: data || {}, class: name + "_layer",
        html: "<div><div>" + name + "_layer</div></div>", typenode: false,
        inputs: inputs || {}, outputs: outputs || {}, pos_x: posX, pos_y: posY,
      };
      return String(id);
    }
    function conn(fromId, toId, outPort, inPort) {
      var from = d[fromId]; var to = d[toId];
      if (!from.outputs[outPort || "output_1"]) from.outputs[outPort || "output_1"] = { connections: [] };
      from.outputs[outPort || "output_1"].connections.push({ node: toId, input: inPort || "input_1" });
      if (!to.inputs[inPort || "input_1"]) to.inputs[inPort || "input_1"] = { connections: [] };
      to.inputs[inPort || "input_1"].connections.push({ node: fromId, output: outPort || "output_1" });
    }

    // Standard VAE for 28x28 grayscale images
    // Paper-common architecture: 784 → 512 → 256 → z(32) → 256 → 512 → 784
    var img = node("image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28, 28, 1] }, 60, 100);
    var e1 = node("dense", { units: 512, activation: "relu" }, 240, 100);
    var e2 = node("dense", { units: 256, activation: "relu" }, 420, 100);
    var mu = node("latent_mu", { units: 32, group: "z_vae" }, 620, 50);
    var logvar = node("latent_logvar", { units: 32, group: "z_vae" }, 620, 170);
    var reparam = node("reparam", { group: "z_vae", beta: 1.0 }, 800, 100);
    var d1 = node("dense", { units: 256, activation: "relu" }, 960, 100);
    var d2 = node("dense", { units: 512, activation: "relu" }, 1120, 100);
    // reconstruction output — target matches input (784 pixels), not class labels
    var out = node("output", { target: "xv", targetType: "xv", loss: "mse", matchWeight: 1 }, 1280, 100);

    conn(img, e1); conn(e1, e2);
    conn(e2, mu); conn(e2, logvar);
    conn(mu, reparam, "output_1", "input_1");
    conn(logvar, reparam, "output_1", "input_2");
    conn(reparam, d1); conn(d1, d2); conn(d2, out);

    return { drawflow: { Home: { data: d } } };
  }

  function _makeAeGraph() {
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
    function conn(fromId, toId) {
      if (!d[fromId].outputs.output_1) d[fromId].outputs.output_1 = { connections: [] };
      d[fromId].outputs.output_1.connections.push({ node: toId, input: "input_1" });
      if (!d[toId].inputs.input_1) d[toId].inputs.input_1 = { connections: [] };
      d[toId].inputs.input_1.connections.push({ node: fromId, output: "output_1" });
    }

    // MLP-AE: 784 → 512 → 256 → 32 → 256 → 512 → 784
    var img = node("image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28, 28, 1] }, 60, 100);
    var e1 = node("dense", { units: 512, activation: "relu" }, 200, 100);
    var e2 = node("dense", { units: 256, activation: "relu" }, 340, 100);
    var bn = node("dense", { units: 32, activation: "relu" }, 480, 100);
    var d1 = node("dense", { units: 256, activation: "relu" }, 620, 100);
    var d2 = node("dense", { units: 512, activation: "relu" }, 760, 100);
    var out = node("output", { target: "xv", targetType: "xv", loss: "mse", matchWeight: 1 }, 900, 100);
    conn(img, e1); conn(e1, e2); conn(e2, bn); conn(bn, d1); conn(d1, d2); conn(d2, out);

    return { drawflow: { Home: { data: d } } };
  }

  function _makeClassifierGraph() {
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
    function conn(fromId, toId) {
      if (!d[fromId].outputs.output_1) d[fromId].outputs.output_1 = { connections: [] };
      d[fromId].outputs.output_1.connections.push({ node: toId, input: "input_1" });
      if (!d[toId].inputs.input_1) d[toId].inputs.input_1 = { connections: [] };
      d[toId].inputs.input_1.connections.push({ node: fromId, output: "output_1" });
    }

    // Classifier: 784 → 256 → 128 → 10 (softmax)
    var img = node("image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28, 28, 1] }, 60, 100);
    var d1 = node("dense", { units: 256, activation: "relu" }, 260, 100);
    var d2 = node("dense", { units: 128, activation: "relu" }, 460, 100);
    var out = node("output", { target: "label", targetType: "label", loss: "categoricalCrossentropy", matchWeight: 1 }, 660, 100);
    conn(img, d1); conn(d1, d2); conn(d2, out);

    return { drawflow: { Home: { data: d } } };
  }

  window.FASHION_MNIST_VAE_PRESET = {
    dataset: {
      id: "demo-fmnist-ds",
      name: "Fashion-MNIST (60000)",
      schemaId: "fashion_mnist",
      status: "draft", // fetches from CDN on generate
      config: {
        seed: 42,
        splitMode: "stratified_label",
        trainFrac: 0.8,
        valFrac: 0.1,
        testFrac: 0.1,
        totalCount: 60000,
      },
      data: null,
      createdAt: Date.now(),
    },

    models: [
      {
        id: "demo-fmnist-vae",
        name: "Fashion-MNIST VAE",
        schemaId: "fashion_mnist",
        graph: _makeVaeGraph(),
        createdAt: Date.now(),
      },
      {
        id: "demo-fmnist-ae",
        name: "Fashion-MNIST AE",
        schemaId: "fashion_mnist",
        graph: _makeAeGraph(),
        createdAt: Date.now(),
      },
      {
        id: "demo-fmnist-classifier",
        name: "Fashion-MNIST Classifier",
        schemaId: "fashion_mnist",
        graph: _makeClassifierGraph(),
        createdAt: Date.now(),
      },
    ],

    trainers: [
      {
        id: "demo-fmnist-vae-trainer",
        name: "VAE Trainer",
        schemaId: "fashion_mnist",
        datasetId: "demo-fmnist-ds",
        modelId: "demo-fmnist-vae",
        status: "draft",
        config: {
          epochs: 20, batchSize: 128, learningRate: 0.001,
          optimizerType: "adam", lrSchedulerType: "plateau",
          earlyStoppingPatience: 10, restoreBestWeights: true,
          useServer: true,
        },
      },
      {
        id: "demo-fmnist-ae-trainer",
        name: "AE Trainer",
        schemaId: "fashion_mnist",
        datasetId: "demo-fmnist-ds",
        modelId: "demo-fmnist-ae",
        status: "draft",
        config: {
          epochs: 20, batchSize: 128, learningRate: 0.001,
          optimizerType: "adam", lrSchedulerType: "plateau",
          earlyStoppingPatience: 10, restoreBestWeights: true,
          useServer: true,
        },
      },
      {
        id: "demo-fmnist-cls-trainer",
        name: "Classifier Trainer",
        schemaId: "fashion_mnist",
        datasetId: "demo-fmnist-ds",
        modelId: "demo-fmnist-classifier",
        status: "draft",
        config: {
          epochs: 10, batchSize: 128, learningRate: 0.001,
          optimizerType: "adam", lrSchedulerType: "plateau",
          earlyStoppingPatience: 5, restoreBestWeights: true,
          useServer: true,
        },
      },
    ],

    generations: [
      {
        id: "demo-fmnist-vae-gen",
        name: "VAE Generation",
        schemaId: "fashion_mnist",
        trainerId: "",  // user selects after training
        family: "",
        config: { method: "reconstruct", numSamples: 16, steps: 100, lr: 0.01, temperature: 1.0, seed: 42 },
        status: "draft", runs: [], createdAt: Date.now(),
      },
    ],

    evaluations: [
      {
        id: "demo-fmnist-eval",
        name: "Fashion-MNIST Benchmark",
        schemaId: "fashion_mnist",
        datasetId: "demo-fmnist-ds",
        trainerIds: ["demo-fmnist-vae-trainer", "demo-fmnist-ae-trainer", "demo-fmnist-cls-trainer"],
        evaluatorIds: ["mae", "rmse", "r2", "accuracy"],
        status: "draft", runs: [], createdAt: Date.now(),
      },
    ],
  };
})();

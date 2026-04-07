/**
 * Fashion-MNIST Transformer Demo — Vision Transformer (ViT)
 *
 * Attention-based image classification without convolutions.
 * Split image into patches, embed, apply self-attention, classify.
 *
 * References:
 *   Dosovitskiy et al., "An Image is Worth 16x16 Words", ICLR 2021
 *
 * 3 models:
 *   1. Tiny ViT — 1 transformer block, 4 heads, 64-dim (baseline)
 *   2. Small ViT — 2 transformer blocks, 4 heads, 64-dim
 *   3. ViT + MLP head — 2 blocks + hidden classification layer
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
  // Model 1: Tiny ViT — 1 block, 4 heads
  // ═══════════════════════════════════════════
  function _tinyVit() {
    _nid = 0; var d = {};
    var img = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 100);
    var pe = N(d, "patch_embed", { patchSize: 7, embedDim: 64 }, 240, 100);
    var tb = N(d, "transformer_block", { numHeads: 4, ffnDim: 128, dropout: 0.1 }, 440, 100);
    var gap = N(d, "global_avg_pool1d", {}, 640, 100);
    var cls = N(d, "dense", { units: 10, activation: "linear" }, 800, 100);
    var out = N(d, "output", { target: "label", targetType: "label", loss: "cross_entropy", headType: "classification" }, 960, 100);
    C(d, img, pe); C(d, pe, tb); C(d, tb, gap); C(d, gap, cls); C(d, cls, out);
    return graph(d);
  }

  // ═══════════════════════════════════════════
  // Model 2: Small ViT — 2 blocks, 4 heads
  // ═══════════════════════════════════════════
  function _smallVit() {
    _nid = 0; var d = {};
    var img = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 100);
    var pe = N(d, "patch_embed", { patchSize: 7, embedDim: 64 }, 220, 100);
    var tb1 = N(d, "transformer_block", { numHeads: 4, ffnDim: 128, dropout: 0.1 }, 400, 100);
    var tb2 = N(d, "transformer_block", { numHeads: 4, ffnDim: 128, dropout: 0.1 }, 580, 100);
    var gap = N(d, "global_avg_pool1d", {}, 740, 100);
    var cls = N(d, "dense", { units: 10, activation: "linear" }, 880, 100);
    var out = N(d, "output", { target: "label", targetType: "label", loss: "cross_entropy", headType: "classification" }, 1020, 100);
    C(d, img, pe); C(d, pe, tb1); C(d, tb1, tb2); C(d, tb2, gap); C(d, gap, cls); C(d, cls, out);
    return graph(d);
  }

  // ═══════════════════════════════════════════
  // Model 3: ViT + MLP head — 2 blocks + Dense(128) before classifier
  // ═══════════════════════════════════════════
  function _vitMlpHead() {
    _nid = 0; var d = {};
    var img = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28,28,1] }, 80, 100);
    var pe = N(d, "patch_embed", { patchSize: 7, embedDim: 64 }, 200, 100);
    var tb1 = N(d, "transformer_block", { numHeads: 4, ffnDim: 128, dropout: 0.1 }, 360, 100);
    var tb2 = N(d, "transformer_block", { numHeads: 4, ffnDim: 128, dropout: 0.1 }, 520, 100);
    var gap = N(d, "global_avg_pool1d", {}, 660, 100);
    var h1 = N(d, "dense", { units: 128, activation: "relu" }, 780, 100);
    var drop = N(d, "dropout", { rate: 0.2 }, 880, 100);
    var cls = N(d, "dense", { units: 10, activation: "linear" }, 960, 100);
    var out = N(d, "output", { target: "label", targetType: "label", loss: "cross_entropy", headType: "classification" }, 1080, 100);
    C(d, img, pe); C(d, pe, tb1); C(d, tb1, tb2); C(d, tb2, gap); C(d, gap, h1); C(d, h1, drop); C(d, drop, cls); C(d, cls, out);
    return graph(d);
  }

  var DS = "demo-vit-ds";
  var sid = "fashion_mnist";

  window.FASHION_MNIST_TRANSFORMER_PRESET = {
    dataset: {
      id: DS, name: "Fashion-MNIST (all classes)", schemaId: sid, status: "draft",
      config: { seed: 42, splitMode: "stratified_label", trainFrac: 0.8, valFrac: 0.1, testFrac: 0.1,
                totalCount: 10000, useFullSource: true },
      data: null, createdAt: Date.now(),
    },
    models: [
      { id: "m-tiny-vit",     name: "1. Tiny ViT (1 block)",         schemaId: sid, graph: _tinyVit(),   createdAt: Date.now() },
      { id: "m-small-vit",    name: "2. Small ViT (2 blocks)",       schemaId: sid, graph: _smallVit(),  createdAt: Date.now() },
      { id: "m-vit-mlp-head", name: "3. ViT + MLP Head (2 blocks)",  schemaId: sid, graph: _vitMlpHead(), createdAt: Date.now() },
    ],
    trainers: [
      { id: "t-tiny-vit", name: "Tiny ViT Trainer", schemaId: sid, datasetId: DS, modelId: "m-tiny-vit", status: "draft",
        config: { epochs: 30, batchSize: 64, learningRate: 0.001, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 10, lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
      { id: "t-small-vit", name: "Small ViT Trainer", schemaId: sid, datasetId: DS, modelId: "m-small-vit", status: "draft",
        config: { epochs: 30, batchSize: 64, learningRate: 0.001, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 10, lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
      { id: "t-vit-mlp-head", name: "ViT + MLP Head Trainer", schemaId: sid, datasetId: DS, modelId: "m-vit-mlp-head", status: "draft",
        config: { epochs: 30, batchSize: 64, learningRate: 0.001, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 10, lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
    ],
    generations: [],
    evaluations: [
      {
        id: "e-vit-classification",
        name: "Classification Benchmark",
        schemaId: sid,
        datasetId: DS,
        trainerIds: ["t-tiny-vit", "t-small-vit", "t-vit-mlp-head"],
        evaluatorIds: ["accuracy", "macro_f1"],
        runMode: "test",
        weightSelection: "best",
        status: "draft",
        runs: [],
        createdAt: Date.now(),
      },
    ],
  };
})();

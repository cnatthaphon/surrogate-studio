/**
 * Siamese Shape Verification — Metric Learning / Similarity Classification
 *
 * Learn to compare pairs of images and classify as same/different.
 * Demonstrates contrastive learning paradigm using standard classification.
 *
 * Input: concatenated pair [img_A(784) | img_B(784)] = 1568 features
 * Output: binary (0=different, 1=same)
 */
(function () {
  "use strict";

  var sid = "siamese_pairs";
  var DS_ID = "siamese_ds";
  var PAIR_SIZE = 28 * 28 * 2; // 1568

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
    if (!d[from].outputs.output_1) d[from].outputs.output_1 = { connections: [] };
    d[from].outputs.output_1.connections.push({ node: to, input: "input_1" });
    if (!d[to].inputs.input_1) d[to].inputs.input_1 = { connections: [] };
    d[to].inputs.input_1.connections.push({ node: from, output: "output_1" });
  }
  function graph(d) { return { drawflow: { Home: { data: d } } }; }

  // Deep Siamese MLP — processes concatenated pair through shared-like layers
  function buildDeepSiamese() {
    _nid = 0;
    var d = {};
    var inp  = N(d, "input",   { featureSize: PAIR_SIZE },            50, 300);
    var d1   = N(d, "dense",   { units: 256, activation: "relu" },   220, 300);
    var bn1  = N(d, "batchnorm", {},                                 380, 300);
    var drop1= N(d, "dropout", { rate: 0.3 },                       520, 300);
    var d2   = N(d, "dense",   { units: 128, activation: "relu" },   660, 300);
    var drop2= N(d, "dropout", { rate: 0.2 },                       800, 300);
    var d3   = N(d, "dense",   { units: 64, activation: "relu" },    940, 300);
    var out  = N(d, "output",  { target: "label", targetType: "label", headType: "classification" }, 1100, 300);
    C(d, inp, d1); C(d, d1, bn1); C(d, bn1, drop1); C(d, drop1, d2);
    C(d, d2, drop2); C(d, drop2, d3); C(d, d3, out);
    return graph(d);
  }

  // Shallow MLP baseline
  function buildShallowMlp() {
    _nid = 100;
    var d = {};
    var inp = N(d, "input",  { featureSize: PAIR_SIZE },            50, 300);
    var d1  = N(d, "dense",  { units: 128, activation: "relu" },  220, 300);
    var d2  = N(d, "dense",  { units: 32, activation: "relu" },   400, 300);
    var out = N(d, "output", { target: "label", targetType: "label", headType: "classification" }, 580, 300);
    C(d, inp, d1); C(d, d1, d2); C(d, d2, out);
    return graph(d);
  }

  window.SIAMESE_SHAPE_VERIFICATION_PRESET = {
    dataset: {
      id: DS_ID,
      name: "Shape Pairs (28x28, 5 classes)",
      schemaId: sid,
      datasetModuleId: "siamese_pairs",
      mode: "classification",
      featureSize: PAIR_SIZE,
      targetSize: 2,
      targetMode: "label",
      numClasses: 2,
      classCount: 2,
      classNames: ["different", "same"],
      splitConfig: { mode: "random", train: 0.7, val: 0.15, test: 0.15 },
      seed: 42,
    },
    models: [
      { id: "deep_siamese", name: "Deep Siamese MLP", schemaId: sid, graph: buildDeepSiamese(), createdAt: Date.now() },
      { id: "shallow_mlp", name: "Shallow MLP Baseline", schemaId: sid, graph: buildShallowMlp(), createdAt: Date.now() },
    ],
    trainers: [
      {
        id: "deep_siamese_trainer", name: "Deep Siamese Trainer", schemaId: sid,
        datasetId: DS_ID, modelId: "deep_siamese",
        runtime: "js_client", runtimeBackend: "auto", status: "draft",
        trainCfg: { epochs: 30, batchSize: 32, learningRate: 0.001, optimizer: "adam" },
      },
      {
        id: "shallow_mlp_trainer", name: "Shallow MLP Trainer", schemaId: sid,
        datasetId: DS_ID, modelId: "shallow_mlp",
        runtime: "js_client", runtimeBackend: "auto", status: "draft",
        trainCfg: { epochs: 30, batchSize: 32, learningRate: 0.001, optimizer: "adam" },
      },
    ],
    generations: [],
    evaluations: [
      {
        id: "siamese_eval", name: "Verification: Deep vs Shallow", schemaId: sid, datasetId: DS_ID,
        trainerIds: ["deep_siamese_trainer", "shallow_mlp_trainer"],
        evaluatorIds: ["accuracy", "macro_f1"],
        status: "draft", runs: [], createdAt: Date.now(),
      },
    ],
  };
})();

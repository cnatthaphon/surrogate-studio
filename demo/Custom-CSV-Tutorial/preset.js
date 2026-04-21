/**
 * Custom CSV Tutorial — Bring Your Own Dataset
 *
 * Demonstrates how to use Surrogate Studio with your own tabular data.
 * Ships with an Iris-like sample dataset (4 features, 3 classes, 150 samples).
 *
 * Tutorial flow:
 * 1. Dataset tab → Generate (uses built-in Iris sample, or upload your own CSV)
 * 2. Model tab → inspect the MLP graph or modify it
 * 3. Trainer tab → train on client (TF.js) or server (PyTorch)
 * 4. Evaluation tab → see accuracy/F1
 */
(function () {
  "use strict";

  var sid = "custom_csv";
  var DS_ID = "custom_csv_ds";

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

  // MLP classifier (4 features → 3 classes)
  function buildMlpClassifier() {
    _nid = 0;
    var d = {};
    var inp  = N(d, "input",   { featureSize: 4, mode: "flat" },     50,  300);
    var d1   = N(d, "dense",   { units: 32, activation: "relu" },   220,  300);
    var bn1  = N(d, "batchnorm", {},                                 380, 300);
    var d2   = N(d, "dense",   { units: 16, activation: "relu" },   540,  300);
    var drop = N(d, "dropout", { rate: 0.2 },                       700,  300);
    var out  = N(d, "output",  { target: "label", targetType: "label", headType: "classification" }, 860, 300);
    C(d, inp, d1); C(d, d1, bn1); C(d, bn1, d2); C(d, d2, drop); C(d, drop, out);
    return graph(d);
  }

  // Simple MLP baseline (no regularization)
  function buildSimpleMlp() {
    _nid = 100;
    var d = {};
    var inp = N(d, "input",  { featureSize: 4, mode: "flat" },     50,  300);
    var d1  = N(d, "dense",  { units: 16, activation: "relu" },  220,  300);
    var out = N(d, "output", { target: "label", targetType: "label", headType: "classification" }, 400, 300);
    C(d, inp, d1); C(d, d1, out);
    return graph(d);
  }

  window.CUSTOM_CSV_TUTORIAL_PRESET = {
    dataset: {
      id: DS_ID,
      name: "Iris Sample (4 features, 3 classes)",
      schemaId: sid,
      datasetModuleId: "custom_csv",
      mode: "classification",
      featureSize: 4,
      targetSize: 3,
      targetMode: "label",
      numClasses: 3,
      classCount: 3,
      classNames: ["class_0 (setosa)", "class_1 (versicolor)", "class_2 (virginica)"],
      splitConfig: { mode: "from_csv", train: 0.7, val: 0.15, test: 0.15 },
      seed: 42,
    },
    models: [
      { id: "csv_mlp", name: "MLP Classifier (with BN + Dropout)", schemaId: sid, graph: buildMlpClassifier(), createdAt: Date.now() },
      { id: "csv_simple", name: "Simple MLP (baseline)", schemaId: sid, graph: buildSimpleMlp(), createdAt: Date.now() },
    ],
    trainers: [
      {
        id: "csv_mlp_trainer", name: "MLP Trainer", schemaId: sid,
        datasetId: DS_ID, modelId: "csv_mlp",
        runtime: "js_client", runtimeBackend: "auto", status: "draft",
        trainCfg: { epochs: 50, batchSize: 16, learningRate: 0.01, optimizer: "adam" },
      },
      {
        id: "csv_simple_trainer", name: "Simple MLP Trainer", schemaId: sid,
        datasetId: DS_ID, modelId: "csv_simple",
        runtime: "js_client", runtimeBackend: "auto", status: "draft",
        trainCfg: { epochs: 50, batchSize: 16, learningRate: 0.01, optimizer: "adam" },
      },
    ],
    generations: [],
    evaluations: [
      {
        id: "csv_eval", name: "MLP vs Simple: Classification", schemaId: sid, datasetId: DS_ID,
        trainerIds: ["csv_mlp_trainer", "csv_simple_trainer"],
        evaluatorIds: ["accuracy", "macro_f1"],
        status: "draft", runs: [], createdAt: Date.now(),
      },
    ],
  };
})();

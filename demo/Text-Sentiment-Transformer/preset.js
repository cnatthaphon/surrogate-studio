/**
 * Text Sentiment Transformer — NLP Classification
 *
 * Transformer-based sentiment classification on synthetic text data.
 * Demonstrates: Embedding → TransformerBlock → GlobalAvgPool1D → Dense → classify.
 *
 * This is the standard NLP transformer pipeline:
 * tokenize → embed → self-attention → pool → classify
 */
(function () {
  "use strict";

  var sid = "text_classification";
  var DS_ID = "text_cls_ds";
  var VOCAB_SIZE = 120; // matches dataset module
  var SEQ_LEN = 12;

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

  // Transformer classifier: Embedding → Reshape → TransformerBlock → GlobalAvgPool1D → Dense → Output
  function buildTransformerClassifier() {
    _nid = 0;
    var d = {};
    var inp     = N(d, "input",            { featureSize: SEQ_LEN, mode: "flat" },                     50,  300);
    var embed   = N(d, "embedding",        { inputDim: VOCAB_SIZE, outputDim: 32 },     220,  300);
    var tb1     = N(d, "transformer_block",{ numHeads: 4, ffnDim: 64 },                 400,  300);
    var pool    = N(d, "global_avg_pool1d",{},                                           800,  300);
    var dense   = N(d, "dense",            { units: 32, activation: "relu" },           1000,  300);
    var drop    = N(d, "dropout",          { rate: 0.2 },                               1150,  300);
    var out     = N(d, "output",           { target: "label", targetType: "label", headType: "classification" }, 1300, 300);

    C(d, inp, embed); C(d, embed, tb1);
    C(d, tb1, pool); C(d, pool, dense); C(d, dense, drop); C(d, drop, out);
    return graph(d);
  }

  // MLP baseline: Input → Dense → Dense → Output (no attention)
  function buildMlpClassifier() {
    _nid = 100;
    var d = {};
    var inp   = N(d, "input",   { featureSize: SEQ_LEN, mode: "flat" },            50,  300);
    var d1    = N(d, "dense",   { units: 64, activation: "relu" },  220,  300);
    var d2    = N(d, "dense",   { units: 32, activation: "relu" },  400,  300);
    var drop  = N(d, "dropout", { rate: 0.2 },                     550,  300);
    var out   = N(d, "output",  { target: "label", targetType: "label", headType: "classification" }, 720, 300);

    C(d, inp, d1); C(d, d1, d2); C(d, d2, drop); C(d, drop, out);
    return graph(d);
  }

  // LSTM baseline: Input → Embedding → Reshape → LSTM → Dense → Output
  function buildLstmClassifier() {
    _nid = 200;
    var d = {};
    var inp     = N(d, "input",     { featureSize: SEQ_LEN, mode: "flat" },                    50,  300);
    var embed   = N(d, "embedding", { inputDim: VOCAB_SIZE, outputDim: 16 },    220,  300);
    var lstm    = N(d, "lstm",      { units: 32, returnSequences: false },       400,  300);
    var dense   = N(d, "dense",     { units: 16, activation: "relu" },           800,  300);
    var out     = N(d, "output",    { target: "label", targetType: "label", headType: "classification" }, 1000, 300);

    C(d, inp, embed); C(d, embed, lstm);
    C(d, lstm, dense); C(d, dense, out);
    return graph(d);
  }

  window.TEXT_SENTIMENT_TRANSFORMER_PRESET = {
    dataset: {
      id: DS_ID,
      name: "Synthetic Sentiment (1000 samples)",
      schemaId: sid,
      datasetModuleId: "text_classification",
      mode: "classification",
      featureSize: SEQ_LEN,
      targetSize: 2,
      targetMode: "label",
      numClasses: 2,
      classCount: 2,
      classNames: ["negative", "positive"],
      splitConfig: { mode: "random", train: 0.7, val: 0.15, test: 0.15 },
      seed: 42,
    },
    models: [
      { id: "text_transformer", name: "Transformer Classifier", schemaId: sid, graph: buildTransformerClassifier(), createdAt: Date.now() },
      { id: "text_lstm", name: "LSTM Classifier", schemaId: sid, graph: buildLstmClassifier(), createdAt: Date.now() },
      { id: "text_mlp", name: "MLP Baseline", schemaId: sid, graph: buildMlpClassifier(), createdAt: Date.now() },
    ],
    trainers: [
      {
        id: "text_tf_trainer", name: "Transformer Trainer", schemaId: sid,
        datasetId: DS_ID, modelId: "text_transformer",
        runtime: "js_client", runtimeBackend: "auto", status: "draft",
        trainCfg: { epochs: 30, batchSize: 32, learningRate: 0.001, optimizer: "adam" },
      },
      {
        id: "text_lstm_trainer", name: "LSTM Trainer", schemaId: sid,
        datasetId: DS_ID, modelId: "text_lstm",
        runtime: "js_client", runtimeBackend: "auto", status: "draft",
        trainCfg: { epochs: 30, batchSize: 32, learningRate: 0.001, optimizer: "adam" },
      },
      {
        id: "text_mlp_trainer", name: "MLP Trainer", schemaId: sid,
        datasetId: DS_ID, modelId: "text_mlp",
        runtime: "js_client", runtimeBackend: "auto", status: "draft",
        trainCfg: { epochs: 30, batchSize: 32, learningRate: 0.001, optimizer: "adam" },
      },
    ],
    generations: [],
    evaluations: [
      {
        id: "text_eval", name: "Sentiment: Transformer vs LSTM vs MLP", schemaId: sid, datasetId: DS_ID,
        trainerIds: ["text_tf_trainer", "text_lstm_trainer", "text_mlp_trainer"],
        evaluatorIds: ["accuracy", "macro_f1"],
        status: "draft", runs: [], createdAt: Date.now(),
      },
    ],
  };
})();

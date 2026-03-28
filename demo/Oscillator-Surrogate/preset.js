/**
 * Oscillator Surrogate Demo Preset
 *
 * Multiple models for damped spring/pendulum/bouncing ball trajectories:
 * 1. Direct-MLP: params+time → x,v (direct prediction)
 * 2. AR-GRU: window history → next step (autoregressive)
 * 3. VAE: trajectory reconstruction with latent space
 */
(function () {
  "use strict";

  function _node(d, id, name, data, posX, posY) {
    d[String(id)] = {
      id: id, name: name + "_layer", data: data || {}, class: name + "_layer",
      html: "<div><div>" + name + "_layer</div></div>", typenode: false,
      inputs: {}, outputs: {}, pos_x: posX || 0, pos_y: posY || 0,
    };
    return String(id);
  }
  function _conn(d, fromId, toId, outPort, inPort) {
    var from = d[fromId]; var to = d[toId];
    outPort = outPort || "output_1"; inPort = inPort || "input_1";
    if (!from.outputs[outPort]) from.outputs[outPort] = { connections: [] };
    from.outputs[outPort].connections.push({ node: toId, input: inPort });
    if (!to.inputs[inPort]) to.inputs[inPort] = { connections: [] };
    to.inputs[inPort].connections.push({ node: fromId, output: outPort });
  }

  function _makeDirectMlpGraph() {
    var d = {};
    var inp = _node(d, 1, "input", { mode: "flat" }, 60, 100);
    var h1 = _node(d, 2, "dense", { units: 64, activation: "relu" }, 230, 100);
    var h2 = _node(d, 3, "dense", { units: 32, activation: "relu" }, 400, 100);
    var out = _node(d, 4, "output", { target: "xv", loss: "mse" }, 570, 100);
    _conn(d, inp, h1); _conn(d, h1, h2); _conn(d, h2, out);
    return { drawflow: { Home: { data: d } } };
  }

  function _makeArGruGraph() {
    var d = {};
    var inp = _node(d, 1, "input", { mode: "flat" }, 60, 100);
    var gru = _node(d, 2, "gru", { units: 64, dropout: 0.1, returnseq: "false" }, 260, 100);
    var h1 = _node(d, 3, "dense", { units: 32, activation: "relu" }, 430, 100);
    var out = _node(d, 4, "output", { target: "xv", loss: "mse" }, 600, 100);
    _conn(d, inp, gru); _conn(d, gru, h1); _conn(d, h1, out);
    return { drawflow: { Home: { data: d } } };
  }

  function _makeVaeGraph() {
    var d = {};
    var inp = _node(d, 1, "input", { mode: "flat" }, 60, 100);
    var e1 = _node(d, 2, "dense", { units: 32, activation: "relu" }, 200, 100);
    var mu = _node(d, 3, "latent_mu", { units: 8, group: "z" }, 350, 50);
    var lv = _node(d, 4, "latent_logvar", { units: 8, group: "z" }, 350, 150);
    var rep = _node(d, 5, "reparam", { group: "z", beta: 0.001 }, 500, 100);
    var d1 = _node(d, 6, "dense", { units: 32, activation: "relu" }, 650, 100);
    var out = _node(d, 7, "output", { target: "xv", loss: "mse" }, 800, 100);
    _conn(d, inp, e1); _conn(d, e1, mu); _conn(d, e1, lv);
    _conn(d, mu, rep, "output_1", "input_1"); _conn(d, lv, rep, "output_1", "input_2");
    _conn(d, rep, d1); _conn(d, d1, out);
    return { drawflow: { Home: { data: d } } };
  }

  window.OSCILLATOR_DEMO_PRESET = {
    dataset: {
      id: "demo-osc-ds",
      name: "Oscillator Trajectories",
      schemaId: "oscillator",
      status: "draft",
      config: { seed: 42, splitMode: "random", trainFrac: 0.8, valFrac: 0.1, testFrac: 0.1 },
      data: null,
      createdAt: Date.now(),
    },
    models: [
      { id: "demo-osc-mlp", name: "Direct-MLP", schemaId: "oscillator", graph: _makeDirectMlpGraph(), createdAt: Date.now() },
      { id: "demo-osc-gru", name: "AR-GRU", schemaId: "oscillator", graph: _makeArGruGraph(), createdAt: Date.now() },
      { id: "demo-osc-vae", name: "Oscillator VAE", schemaId: "oscillator", graph: _makeVaeGraph(), createdAt: Date.now() },
    ],
    trainers: [
      { id: "demo-osc-mlp-t", name: "MLP Trainer", schemaId: "oscillator", datasetId: "demo-osc-ds", modelId: "demo-osc-mlp", status: "draft", config: { epochs: 30, batchSize: 32, learningRate: 0.001, optimizerType: "adam", useServer: true } },
      { id: "demo-osc-gru-t", name: "GRU Trainer", schemaId: "oscillator", datasetId: "demo-osc-ds", modelId: "demo-osc-gru", status: "draft", config: { epochs: 30, batchSize: 32, learningRate: 0.001, optimizerType: "adam", useServer: true } },
      { id: "demo-osc-vae-t", name: "VAE Trainer", schemaId: "oscillator", datasetId: "demo-osc-ds", modelId: "demo-osc-vae", status: "draft", config: { epochs: 30, batchSize: 32, learningRate: 0.0005, optimizerType: "adam", useServer: true } },
    ],
    generations: [
      { id: "demo-osc-gen", name: "VAE Generation", schemaId: "oscillator", trainerId: "", family: "", config: { method: "reconstruct", numSamples: 16, seed: 42 }, status: "draft", runs: [], createdAt: Date.now() },
    ],
    evaluations: [
      { id: "demo-osc-eval", name: "MLP vs GRU vs VAE", schemaId: "oscillator", datasetId: "demo-osc-ds", trainerIds: ["demo-osc-mlp-t", "demo-osc-gru-t", "demo-osc-vae-t"], evaluatorIds: ["mae", "rmse", "r2", "bias"], status: "draft", runs: [], createdAt: Date.now() },
    ],
  };
})();

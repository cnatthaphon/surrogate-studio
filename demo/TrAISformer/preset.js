/**
 * TrAISformer Demo — Transformer-based AIS Trajectory Prediction
 *
 * Autoregressive vessel position prediction in the Baltic Sea.
 * Input: window of (lat, lon, sog, cog) timesteps → predict next position.
 *
 * Simplified from the original paper (8 layers, 768-dim) to be
 * browser-trainable (2 layers, 64-dim, ~91K params).
 *
 * Reference: Nguyen et al., "TrAISformer — A generative transformer for
 * AIS trajectory prediction", arXiv:2109.03958
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

  var WINDOW = 16; // context window (timesteps)
  var FEAT = 4; // lat, lon, sog, cog

  // Helper: add raw node (no _layer suffix)
  function NR(d, name, data, x, y) {
    _nid++;
    d[String(_nid)] = {
      id: _nid, name: name, data: data || {}, class: name,
      html: "<div><div>" + name + "</div></div>", typenode: false,
      inputs: {}, outputs: {}, pos_x: x, pos_y: y,
    };
    return String(_nid);
  }

  // Helper: add AIS feature block → Input node (one block, all features)
  function _aisFeatures(d, inputId, startX, y) {
    var wh = NR(d, "window_hist_block", { featureKeys: ["lat", "lon", "sog", "cog"], windowSize: WINDOW, stride: 1, lagMode: "last", padMode: "zero" }, startX, y);
    C(d, wh, inputId);
  }

  // ═══════════════════════════════════════════
  // Model 1: MLP Baseline — no attention, just Dense layers
  // ═══════════════════════════════════════════
  function _mlpBaseline() {
    _nid = 0; var d = {};
    var inp = N(d, "input", { mode: "flat" }, 280, 100);
    _aisFeatures(d, inp, 60, 100);
    var d1 = N(d, "dense", { units: 128, activation: "relu" }, 440, 100);
    var d2 = N(d, "dense", { units: 64, activation: "relu" }, 600, 100);
    var d3 = N(d, "dense", { units: FEAT, activation: "linear" }, 760, 100);
    var out = N(d, "output", { target: "position", targetType: "position", loss: "mse", headType: "regression" }, 920, 100);
    C(d, inp, d1); C(d, d1, d2); C(d, d2, d3); C(d, d3, out);
    return graph(d);
  }

  // ═══════════════════════════════════════════
  // Model 2: Tiny TrAISformer — 1 transformer block
  // Feature blocks → Input → Reshape [16,4] → Attention → Pool → Output
  // ═══════════════════════════════════════════
  function _tinyTransformer() {
    _nid = 0; var d = {};
    var inp = N(d, "input", { mode: "flat" }, 280, 100);
    _aisFeatures(d, inp, 60, 100);
    var resh = N(d, "reshape", { targetShape: WINDOW + "," + FEAT }, 420, 100);
    var tb = N(d, "transformer_block", { numHeads: 2, ffnDim: 32, dropout: 0.1 }, 580, 100);
    var gap = N(d, "global_avg_pool1d", {}, 740, 100);
    var proj = N(d, "dense", { units: FEAT, activation: "linear" }, 880, 100);
    var out = N(d, "output", { target: "position", targetType: "position", loss: "mse", headType: "regression" }, 1020, 100);
    C(d, inp, resh); C(d, resh, tb); C(d, tb, gap); C(d, gap, proj); C(d, proj, out);
    return graph(d);
  }

  // ═══════════════════════════════════════════
  // Model 3: Small TrAISformer — 2 transformer blocks
  // ═══════════════════════════════════════════
  function _smallTransformer() {
    _nid = 0; var d = {};
    var inp = N(d, "input", { mode: "flat" }, 280, 100);
    _aisFeatures(d, inp, 60, 100);
    var resh = N(d, "reshape", { targetShape: WINDOW + "," + FEAT }, 400, 100);
    var tb1 = N(d, "transformer_block", { numHeads: 2, ffnDim: 32, dropout: 0.1 }, 540, 100);
    var tb2 = N(d, "transformer_block", { numHeads: 2, ffnDim: 32, dropout: 0.1 }, 680, 100);
    var gap = N(d, "global_avg_pool1d", {}, 820, 100);
    var proj = N(d, "dense", { units: FEAT, activation: "linear" }, 940, 100);
    var out = N(d, "output", { target: "position", targetType: "position", loss: "mse", headType: "regression" }, 1060, 100);
    C(d, inp, resh); C(d, resh, tb1); C(d, tb1, tb2); C(d, tb2, gap); C(d, gap, proj); C(d, proj, out);
    return graph(d);
  }

  var DS = "demo-ais-ds";
  var sid = "ais_trajectory";

  window.TRAISFORMER_PRESET = {
    dataset: {
      id: DS, name: "AIS DMA (1000 trajectories)", schemaId: sid, status: "draft",
      config: { seed: 42, windowSize: WINDOW, maxTrajectories: 180 },
      data: null, createdAt: Date.now(),
    },
    models: [
      { id: "m-mlp-baseline", name: "1. MLP Baseline",             schemaId: sid, graph: _mlpBaseline(),      createdAt: Date.now() },
      { id: "m-tiny-trais",   name: "2. Tiny TrAISformer (1 block)", schemaId: sid, graph: _tinyTransformer(), createdAt: Date.now() },
      { id: "m-small-trais",  name: "3. Small TrAISformer (2 blocks)", schemaId: sid, graph: _smallTransformer(), createdAt: Date.now() },
    ],
    trainers: [
      { id: "t-mlp-baseline", name: "MLP Baseline Trainer", schemaId: sid, datasetId: DS, modelId: "m-mlp-baseline", status: "draft",
        config: { epochs: 30, batchSize: 64, learningRate: 0.001, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 10, lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
      { id: "t-tiny-trais", name: "Tiny TrAISformer Trainer", schemaId: sid, datasetId: DS, modelId: "m-tiny-trais", status: "draft",
        config: { epochs: 30, batchSize: 64, learningRate: 0.001, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 10, lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
      { id: "t-small-trais", name: "Small TrAISformer Trainer", schemaId: sid, datasetId: DS, modelId: "m-small-trais", status: "draft",
        config: { epochs: 30, batchSize: 64, learningRate: 0.001, optimizerType: "adam", useServer: true,
                  earlyStoppingPatience: 10, lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5 } },
    ],
    generations: [],
    evaluations: [
      {
        id: "e-trajectory-prediction",
        name: "Trajectory Prediction Benchmark",
        schemaId: sid,
        datasetId: DS,
        trainerIds: ["t-mlp-baseline", "t-tiny-trais", "t-small-trais"],
        evaluatorIds: ["mae", "rmse", "r2"],
        runMode: "test",
        weightSelection: "best",
        status: "draft",
        runs: [],
        createdAt: Date.now(),
      },
    ],
  };
})();

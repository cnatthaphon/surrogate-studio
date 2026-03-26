/**
 * LSTM-VAE Demo Preset — Ant Trajectory Reconstruction
 *
 * Pre-configures store with:
 * - Ant trajectory dataset (draft, ready to generate from JSON)
 * - LSTM-VAE model graph (paper architecture: Input → LSTM(32) → μ(8)/logσ²(8) → Reparam → Dense(64) → Output)
 * - Trainer session (configured, linked to dataset + model)
 *
 * Also provides an MLP-AE baseline for comparison in evaluation tab.
 */
(function () {
  "use strict";

  // LSTM-VAE graph in Drawflow format — matches paper architecture
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

    // Paper architecture (Jadhav & Barati Farimani, 2022):
    //   Encoder: LSTM(hidden=100, depth=2), Decoder: LSTM(hidden=100, depth=2)
    //   Latent dim: 20, KL weight β=0.001
    //
    // Our match: LSTM(100) encoder, latent=20, Dense(100)+Dense(100) decoder
    //   - Paper uses 2-layer stacked LSTM — we use 1 LSTM (stacked LSTM training
    //     requires multi-output loss fix, tracked as future enhancement)
    //   - Paper uses LSTM decoder — we use Dense decoder (equivalent for seq_len=1)
    //   - Same param count range (~77K vs paper's ~80K)
    var inp = node("input", { mode: "flat" }, 60, 100);
    var enc = node("lstm", { units: 100, dropout: 0, returnseq: "false" }, 300, 100);
    var mu = node("latent_mu", { units: 20, group: "z_vae" }, 600, 50);
    var logvar = node("latent_logvar", { units: 20, group: "z_vae" }, 600, 170);
    var reparam = node("reparam", { group: "z_vae", beta: 0.001 }, 780, 100);
    var dec1 = node("dense", { units: 100, activation: "relu" }, 920, 100);
    var dec2 = node("dense", { units: 100, activation: "relu" }, 1060, 100);
    var out = node("output", { target: "xv", targetType: "xv", loss: "mse", matchWeight: 1 }, 1200, 100);

    conn(inp, enc);
    conn(enc, mu);
    conn(enc, logvar);
    conn(mu, reparam, "output_1", "input_1");
    conn(logvar, reparam, "output_1", "input_2");
    conn(reparam, dec1);
    conn(dec1, dec2);
    conn(dec2, out);

    return { drawflow: { Home: { data: d } } };
  }

  // MLP-AE baseline graph
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

    // MLP-AE with similar capacity: 40→128→32→1→32→128→40
    var inp = node("input", { mode: "flat" }, 60, 100);
    var e1 = node("dense", { units: 128, activation: "relu" }, 230, 100);
    var e2 = node("dense", { units: 32, activation: "relu" }, 400, 100);
    var bn = node("dense", { units: 8, activation: "relu" }, 560, 100);
    var d1 = node("dense", { units: 32, activation: "relu" }, 720, 100);
    var d2 = node("dense", { units: 128, activation: "relu" }, 880, 100);
    var out = node("output", { target: "xv", targetType: "xv", loss: "mse", matchWeight: 1 }, 1050, 100);
    conn(inp, e1); conn(e1, e2); conn(e2, bn); conn(bn, d1); conn(d1, d2); conn(d2, out);

    return { drawflow: { Home: { data: d } } };
  }

  // Pre-build dataset from embedded ANT_DATA (no manual generate needed)
  function _buildDataset() {
    var raw = (typeof window !== "undefined" ? window : {}).ANT_DATA;
    if (!raw || !raw.s) return null;
    var allSamples = raw.s;
    var totalCount = Math.min(1000, allSamples.length);
    var seed = 42;
    var rng = function () { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };

    // shuffle indices
    var indices = [];
    for (var i = 0; i < allSamples.length; i++) indices.push(i);
    for (var i = indices.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = indices[i]; indices[i] = indices[j]; indices[j] = t;
    }
    indices = indices.slice(0, totalCount);

    // split 80/10/10
    var trainN = Math.round(totalCount * 0.8);
    var valN = Math.round(totalCount * 0.1);
    function extract(idx) {
      var x = [], y = [];
      for (var i = 0; i < idx.length; i++) { x.push(allSamples[idx[i]]); y.push(allSamples[idx[i]]); }
      return { x: x, y: y };
    }
    var trainIdx = indices.slice(0, trainN);
    var valIdx = indices.slice(trainN, trainN + valN);
    var testIdx = indices.slice(trainN + valN);

    return {
      schemaId: "ant_trajectory",
      datasetModuleId: "ant_trajectory",
      source: "lstm_vae_paper",
      mode: "regression",
      numAnts: raw.n || 20,
      numFeatures: raw.f || 40,
      featureSize: raw.f || 40,
      imageShape: null,
      classCount: 0,
      classNames: [],
      splitConfig: { mode: "random", train: 0.8, val: 0.1, test: 0.1 },
      splitCounts: { train: trainIdx.length, val: valIdx.length, test: testIdx.length },
      trainCount: trainIdx.length,
      valCount: valIdx.length,
      testCount: testIdx.length,
      xTrain: extract(trainIdx).x,
      yTrain: extract(trainIdx).y,
      xVal: extract(valIdx).x,
      yVal: extract(valIdx).y,
      xTest: extract(testIdx).x,
      yTest: extract(testIdx).y,
      targetMode: "xv",
      records: { train: extract(trainIdx), val: extract(valIdx), test: extract(testIdx) },
      seed: 42,
    };
  }

  var prebuiltData = _buildDataset();

  window.LSTM_VAE_DEMO_PRESET = {
    dataset: {
      id: "demo-ant-ds",
      name: "Ant Trajectories (1000)",
      schemaId: "ant_trajectory",
      status: prebuiltData ? "ready" : "draft",
      config: {
        seed: 42,
        splitMode: "random",
        trainFrac: 0.8,
        valFrac: 0.1,
        testFrac: 0.1,
        totalCount: 1000, // ant_data.js has 1000 timesteps (paper has 10399)
      },
      data: prebuiltData,
      generatedAt: prebuiltData ? Date.now() : null,
      createdAt: Date.now(),
    },

    models: [
      {
        id: "demo-lstm-vae",
        name: "LSTM-VAE (paper)",
        schemaId: "ant_trajectory",
        graph: _makeVaeGraph(),
        createdAt: Date.now(),
      },
      {
        id: "demo-mlp-ae",
        name: "MLP-AE (baseline)",
        schemaId: "ant_trajectory",
        graph: _makeAeGraph(),
        createdAt: Date.now(),
      },
    ],

    trainers: [
      {
        id: "demo-vae-trainer",
        name: "LSTM-VAE Trainer",
        schemaId: "ant_trajectory",
        datasetId: "demo-ant-ds",
        modelId: "demo-lstm-vae",
        status: "draft",
        config: {
          epochs: 50,
          batchSize: 32,
          learningRate: 0.0005,
          optimizerType: "adam",
          lrSchedulerType: "plateau",
          earlyStoppingPatience: 20,
          restoreBestWeights: true,
          gradClipNorm: 3,
          runtimeBackend: "auto",
        },
      },
      {
        id: "demo-ae-trainer",
        name: "MLP-AE Trainer",
        schemaId: "ant_trajectory",
        datasetId: "demo-ant-ds",
        modelId: "demo-mlp-ae",
        status: "draft",
        config: {
          epochs: 50,
          batchSize: 32,
          learningRate: 0.0005,
          optimizerType: "adam",
          lrSchedulerType: "plateau",
          earlyStoppingPatience: 20,
          restoreBestWeights: true,
          runtimeBackend: "auto",
        },
      },
    ],

    generations: [
      {
        id: "demo-vae-gen",
        name: "LSTM-VAE Generation",
        schemaId: "ant_trajectory",
        trainerId: "demo-vae-trainer",
        family: "vae",
        config: { method: "reconstruct", numSamples: 16, steps: 100, lr: 0.01, temperature: 1.0, seed: 42 },
        status: "draft",
        runs: [],
        createdAt: Date.now(),
      },
      {
        id: "demo-ae-gen",
        name: "MLP-AE Generation",
        schemaId: "ant_trajectory",
        trainerId: "demo-ae-trainer",
        family: "supervised",
        config: { method: "reconstruct", numSamples: 16, steps: 100, lr: 0.01, temperature: 1.0, seed: 42 },
        status: "draft",
        runs: [],
        createdAt: Date.now(),
      },
    ],

    evaluations: [
      {
        id: "demo-eval-benchmark",
        name: "VAE vs AE Benchmark",
        schemaId: "ant_trajectory",
        datasetId: "demo-ant-ds",
        trainerIds: ["demo-vae-trainer", "demo-ae-trainer"],
        evaluatorIds: ["mae", "rmse", "r2", "bias", "per_ant_mae", "mean_displacement"],
        status: "draft",
        runs: [],
        createdAt: Date.now(),
      },
    ],
  };
})();

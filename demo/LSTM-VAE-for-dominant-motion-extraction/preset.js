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

    // Paper uses LSTM with seq_len=1, which is equivalent to Dense.
    // For browser training we use Dense (avoids sequence reshape complexity).
    // Paper: LSTM(40→32, 2 layers) → μ(8) → z(8) → Dense(32) → Dense(128) → Output(40)
    // LSTM with flat input auto-reshapes to [batch, 1, features]
    var inp = node("input", { mode: "flat" }, 60, 100);
    var enc = node("lstm", { units: 32, dropout: 0, returnseq: "false" }, 300, 100);
    // Paper uses latent_length=1 for dominant motion extraction.
    // For better reconstruction, use latent_length=8.
    var mu = node("latent_mu", { units: 8, group: "z_vae" }, 600, 50);
    var logvar = node("latent_logvar", { units: 8, group: "z_vae" }, 600, 170);
    var reparam = node("reparam", { group: "z_vae", beta: 0.001 }, 780, 100);
    var dec1 = node("dense", { units: 32, activation: "relu" }, 920, 100);
    var dec2 = node("dense", { units: 128, activation: "relu" }, 1060, 100);
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

  window.LSTM_VAE_DEMO_PRESET = {
    dataset: {
      id: "demo-ant-ds",
      name: "Ant Trajectories (1000)",
      schemaId: "ant_trajectory",
      status: "draft",
      config: {
        seed: 42,
        splitMode: "random",
        trainFrac: 0.8,
        valFrac: 0.1,
        testFrac: 0.1,
        totalCount: 1000,
      },
      data: null,
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
          epochs: 100,
          batchSize: 32,
          learningRate: 0.0005,
          optimizerType: "adam",
          lrSchedulerType: "plateau",
          earlyStoppingPatience: 15,
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
          epochs: 100,
          batchSize: 32,
          learningRate: 0.0005,
          optimizerType: "adam",
          lrSchedulerType: "plateau",
          earlyStoppingPatience: 8,
          restoreBestWeights: true,
          runtimeBackend: "auto",
        },
      },
    ],
  };
})();

/**
 * Schema definition for Ant Trajectory dataset.
 * Registered at runtime from demo folder — no modifications to core files needed.
 */
(function (root) {
  "use strict";

  var sr = root.OSCSchemaRegistry;
  if (!sr || typeof sr.registerSchema !== "function") {
    console.warn("[ant_trajectory_schema] OSCSchemaRegistry not found, skipping registration");
    return;
  }

  sr.registerSchema({
    id: "ant_trajectory",
    label: "ant_trajectory",
    description: "Ant trajectory data for LSTM-VAE reconstruction (20 ants, x/y positions, 40 features)",
    dataset: {
      id: "ant_trajectory",
      label: "Ant Trajectories",
      sampleType: "trajectory",
      splitUnit: "sample",
      splitDefaults: { mode: "random", train: 0.80, val: 0.10, test: 0.10 },
      metadata: {
        ui: { sidebarMode: "generic", viewer: "trajectory" },
        splitModes: [
          { id: "random", label: "Random (global)", stratifyKey: "" },
          { id: "original", label: "Original (sequential)", stratifyKey: "" },
        ],
        display: { chartType: "time_series" },
      },
    },
    model: {
      outputs: [
        { key: "xv", label: "reconstruction (40-dim)" },
        { key: "traj", label: "trajectory" },
      ],
      params: [],
      presets: [
        {
          id: "ant_lstm_vae",
          label: "Dense-VAE (paper, seq_len=1)",
          metadata: {
            graphSpec: {
              nodes: [
                { key: "input_seq", type: "input", x: 80, y: 80, config: { mode: "flat" } },
                { key: "enc_dense", type: "dense", x: 300, y: 80, config: { units: 32, activation: "relu" } },
                { key: "mu", type: "latent_mu", x: 520, y: 40, config: { units: 1, group: "z_vae" } },
                { key: "logvar", type: "latent_logvar", x: 520, y: 140, config: { units: 1, group: "z_vae" } },
                { key: "reparam", type: "reparam", x: 720, y: 80, config: { group: "z_vae", beta: 0.001 } },
                { key: "dec_dense", type: "dense", x: 920, y: 80, config: { units: 64, activation: "relu" } },
                { key: "output", type: "output", x: 1120, y: 80, config: { target: "xv", targetType: "xv", loss: "mse", matchWeight: 1 } },
              ],
              edges: [
                { from: "input_seq", to: "enc_dense", out: "output_1", in: "input_1" },
                { from: "enc_dense", to: "mu", out: "output_1", in: "input_1" },
                { from: "enc_dense", to: "logvar", out: "output_1", in: "input_1" },
                { from: "mu", to: "reparam", out: "output_1", in: "input_1" },
                { from: "logvar", to: "reparam", out: "output_1", in: "input_2" },
                { from: "reparam", to: "dec_dense", out: "output_1", in: "input_1" },
                { from: "dec_dense", to: "output", out: "output_1", in: "input_1" },
              ],
            },
          },
        },
        {
          id: "ant_mlp_ae",
          label: "MLP Autoencoder (baseline)",
          metadata: {
            graphSpec: {
              nodes: [
                { key: "input", type: "input", x: 80, y: 80, config: { mode: "flat" } },
                { key: "enc1", type: "dense", x: 280, y: 80, config: { units: 32, activation: "relu" } },
                { key: "bottleneck", type: "dense", x: 480, y: 80, config: { units: 8, activation: "relu" } },
                { key: "dec1", type: "dense", x: 680, y: 80, config: { units: 32, activation: "relu" } },
                { key: "output", type: "output", x: 880, y: 80, config: { target: "xv", targetType: "xv", loss: "mse", matchWeight: 1 } },
              ],
              edges: [
                { from: "input", to: "enc1", out: "output_1", in: "input_1" },
                { from: "enc1", to: "bottleneck", out: "output_1", in: "input_1" },
                { from: "bottleneck", to: "dec1", out: "output_1", in: "input_1" },
                { from: "dec1", to: "output", out: "output_1", in: "input_1" },
              ],
            },
          },
        },
      ],
      metadata: {
        featureNodes: {
          trajectory: [
            { key: "ant_positions", label: "ant positions (40-dim)", featureSize: 40 },
          ],
          policy: {
            allowHistory: false,
            allowWindowHistory: false,
            allowParams: false,
            allowOneHot: false,
            allowImageSource: false,
          },
          palette: {
            // use same palette as core trajectory schemas (from OSCSchemaBuiltinPalettes)
            items: (function () {
              var W = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {});
              if (W.OSCSchemaBuiltinPalettes && typeof W.OSCSchemaBuiltinPalettes.trajectory === "function") {
                return W.OSCSchemaBuiltinPalettes.trajectory();
              }
              // fallback: minimal palette
              return [
                { type: "input", label: "Input", group: "NN" },
                { type: "dense", label: "Dense", group: "NN", config: { units: 32, activation: "relu" } },
                { type: "output", label: "Output", group: "Output", config: { target: "xv", loss: "mse" } },
              ];
            })(),
          },
        },
      },
    },
    preconfig: {
      dataset: {
        defaultModuleId: "ant_trajectory",
        splitDefaults: { mode: "random", train: 0.80, val: 0.10, test: 0.10 },
      },
      model: { defaultPreset: "ant_lstm_vae" },
    },
  });

  console.log("[ant_trajectory_schema] Registered schema: ant_trajectory");
})(typeof globalThis !== "undefined" ? globalThis : this);

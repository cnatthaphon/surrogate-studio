(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./schema_registry.js"));
    return;
  }
  root.OSCSchemaDefinitionsBuiltin = factory(root.OSCSchemaRegistry);
})(typeof globalThis !== "undefined" ? globalThis : this, function (schemaRegistry) {
  "use strict";

  if (!schemaRegistry) {
    throw new Error("OSCSchemaDefinitionsBuiltin requires OSCSchemaRegistry.");
  }

  function _clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  var registerSchema = schemaRegistry.registerSchema;

  function _paletteItem(uiKey, type, label, section, config) {
    return {
      uiKey: String(uiKey || "").trim(),
      type: String(type || "").trim(),
      label: String(label || type || "").trim(),
      section: String(section || "Nodes").trim(),
      config: (config && typeof config === "object") ? _clone(config) : {},
    };
  }

  function _trajectoryPaletteItems() {
    return [
      _paletteItem("addWindowHistBtn", "window_hist", "WindowHistory", "Feature Nodes", { featureKey: "x", windowSize: 20, stride: 1, lagMode: "contiguous", lagCsv: "1,2,3,4,5", padMode: "none" }),
      _paletteItem("addHistBtn", "history", "History", "Feature Nodes", { featureKey: "x" }),
      _paletteItem("addParamsBtn", "params", "Features", "Feature Nodes", { paramMask: { m: true, c: true, k: true, e: true, x0: true, v0: true, gm: true, gk: true, gc: true, rkm: false, rcm: false, rgl: false } }),
      _paletteItem("addScenarioBtn", "onehot", "OneHot", "Feature Nodes", { oneHotKey: "scenario" }),
      _paletteItem("addInputBtn", "input", "Input", "NN", { mode: "auto" }),
      _paletteItem("addDenseBtn", "dense", "Dense", "NN", { units: 32, activation: "relu" }),
      _paletteItem("addRnnBtn", "rnn", "RNN", "NN", { units: 64, dropout: 0.1, returnseq: "auto" }),
      _paletteItem("addGruBtn", "gru", "GRU", "NN", { units: 64, dropout: 0.1, returnseq: "auto" }),
      _paletteItem("addLstmBtn", "lstm", "LSTM", "NN", { units: 64, dropout: 0.1, returnseq: "auto" }),
      _paletteItem("addConv1dBtn", "conv1d", "Conv1D", "NN", { filters: 64, kernelSize: 3, stride: 1, activation: "relu" }),
      _paletteItem("addDropoutBtn", "dropout", "Dropout", "NN", { rate: 0.1 }),
      _paletteItem("addReLUBtn", "relu", "ReLU", "NN", {}),
      _paletteItem("addBatchNormBtn", "batchnorm", "BatchNorm", "NN", { momentum: 0.99, epsilon: 1e-3 }),
      _paletteItem("addLayerNormBtn", "layernorm", "LayerNorm", "NN", { epsilon: 1e-3 }),
      _paletteItem("addLatentBtn", "latent", "Latent Z", "NN", { units: 16, group: "z_shared", matchWeight: 1 }),
      _paletteItem("addLatentMuBtn", "latent_mu", "Latent μ", "NN", { units: 16, group: "z_shared", matchWeight: 1 }),
      _paletteItem("addLatentLogVarBtn", "latent_logvar", "Latent logσ²", "NN", { units: 16, group: "z_shared", matchWeight: 1 }),
      _paletteItem("addReparamBtn", "reparam", "Reparam z", "NN", { group: "z_shared", beta: 1e-3, matchWeight: 1 }),
      _paletteItem("addTimeSecBtn", "time_sec", "TimeSec", "Utils", {}),
      _paletteItem("addTimeNormBtn", "time_norm", "TimeNorm", "Utils", {}),
      _paletteItem("addSinNormBtn", "sin_norm", "SinNorm", "Utils", {}),
      _paletteItem("addCosNormBtn", "cos_norm", "CosNorm", "Utils", {}),
      _paletteItem("addNoiseScheduleBtn", "noise_schedule", "NoiseSchedule", "Utils", {}),
      _paletteItem("addConcatBtn", "concat", "Concat", "Utils", { numInputs: 2 }),
      _paletteItem("addDetachBtn", "detach", "Detach", "Gradient", {}),
      _paletteItem("addSampleZBtn", "sample_z", "SampleZ", "Gradient", { dim: 128, distribution: "normal" }),
      _paletteItem("addNoiseInjBtn", "noise_injection", "AddNoise", "Gradient", { scale: 0.1, schedule: "constant" }),
      _paletteItem("addTimeEmbBtn", "time_embed", "TimeEmbed", "Gradient", { dim: 64 }),
      _paletteItem("addOutputMultiBtn", "output", "Output", "Output", { target: "x", targetType: "x", loss: "mse" }),
    ];
  }

  function _imagePaletteItems() {
    return [
      _paletteItem("addImageSourceBtn", "image_source", "ImageSource", "Feature Nodes", { sourceKey: "pixel_values", featureSize: 784, imageShape: [28, 28, 1], imageHeight: 28, imageWidth: 28, imageChannels: 1 }),
      _paletteItem("addScenarioBtn", "onehot", "OneHot", "Feature Nodes", { oneHotKey: "label" }),
      _paletteItem("addInputBtn", "input", "Input", "NN", { mode: "flat" }),
      _paletteItem("addDenseBtn", "dense", "Dense", "NN", { units: 32, activation: "relu" }),
      _paletteItem("addConv1dBtn", "conv1d", "Conv1D", "NN", { filters: 32, kernelSize: 3, stride: 1, activation: "relu" }),
      _paletteItem("addConstantBtn", "constant", "Constant", "Gradient", { value: 1, dim: 1 }),
      _paletteItem("addConcatBatchBtn", "concat_batch", "ConcatBatch", "Gradient", {}),
      _paletteItem("addPhaseSwitchBtn", "phase_switch", "PhaseSwitch", "Gradient", {}),
      _paletteItem("addEmbeddingBtn", "embedding", "Embedding", "NN", { inputDim: 10000, outputDim: 256 }),
      _paletteItem("addConv2dBtn", "conv2d", "Conv2D", "Conv", { filters: 32, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }),
      _paletteItem("addMaxPool2dBtn", "maxpool2d", "MaxPool2D", "Conv", { poolSize: 2, strides: 2 }),
      _paletteItem("addConv2dTransposeBtn", "conv2d_transpose", "ConvT2D", "Conv", { filters: 32, kernelSize: 3, strides: 2, padding: "same", activation: "relu" }),
      _paletteItem("addUpSample2dBtn", "upsample2d", "UpSample2D", "Conv", { size: 2 }),
      _paletteItem("addFlattenBtn", "flatten", "Flatten", "Conv", {}),
      _paletteItem("addReshapeBtn", "reshape", "Reshape", "Conv", { targetShape: "28,28,1" }),
      _paletteItem("addGlobalAvgPool2dBtn", "global_avg_pool2d", "GlobalAvgPool2D", "Conv", {}),
      _paletteItem("addRnnBtn", "rnn", "RNN", "NN", { units: 64, dropout: 0.1, returnseq: "auto" }),
      _paletteItem("addGruBtn", "gru", "GRU", "NN", { units: 64, dropout: 0.1, returnseq: "auto" }),
      _paletteItem("addLstmBtn", "lstm", "LSTM", "NN", { units: 64, dropout: 0.1, returnseq: "auto" }),
      _paletteItem("addDropoutBtn", "dropout", "Dropout", "NN", { rate: 0.1 }),
      _paletteItem("addReLUBtn", "relu", "ReLU", "NN", {}),
      _paletteItem("addBatchNormBtn", "batchnorm", "BatchNorm", "NN", { momentum: 0.99, epsilon: 1e-3 }),
      _paletteItem("addLayerNormBtn", "layernorm", "LayerNorm", "NN", { epsilon: 1e-3 }),
      _paletteItem("addLatentBtn", "latent", "Latent Z", "NN", { units: 16, group: "z_shared", matchWeight: 1 }),
      _paletteItem("addLatentMuBtn", "latent_mu", "Latent μ", "NN", { units: 16, group: "z_shared", matchWeight: 1 }),
      _paletteItem("addLatentLogVarBtn", "latent_logvar", "Latent logσ²", "NN", { units: 16, group: "z_shared", matchWeight: 1 }),
      _paletteItem("addReparamBtn", "reparam", "Reparam z", "NN", { group: "z_shared", beta: 1e-3, matchWeight: 1 }),
      _paletteItem("addNoiseScheduleBtn", "noise_schedule", "NoiseSchedule", "Utils", {}),
      _paletteItem("addConcatBtn", "concat", "Concat", "Utils", { numInputs: 2 }),
      _paletteItem("addPatchEmbedBtn", "patch_embed", "PatchEmbed", "Transformer", { patchSize: 7, embedDim: 64 }),
      _paletteItem("addTransformerBlockBtn", "transformer_block", "TransformerBlock", "Transformer", { numHeads: 4, ffnDim: 128, dropout: 0.1 }),
      _paletteItem("addGlobalAvgPool1dBtn", "global_avg_pool1d", "GlobalAvgPool1D", "Transformer", {}),
      _paletteItem("addOutputMultiBtn", "output", "Output", "Output", { target: "label", targetType: "label", loss: "cross_entropy" }),
    ];
  }

  registerSchema({
    id: "oscillator",
    label: "oscillator",
    description: "ODE oscillator trajectories (spring / pendulum / bouncing)",
    dataset: {
      id: "oscillator",
      label: "Oscillator trajectories",
      sampleType: "trajectory",
      splitUnit: "trajectory",
      splitDefaults: {
        mode: "stratified_scenario",
        train: 0.70,
        val: 0.15,
        test: 0.15,
      },
      metadata: {
        ui: {
          sidebarMode: "oscillator",
          viewer: "trajectory",
        },
        splitModes: [
          { id: "stratified_scenario", label: "Stratified by scenario", stratifyKey: "scenario" },
          { id: "random", label: "Random (global)", stratifyKey: "" }
        ],
        display: {
          chartType: "trajectory",
          tableColumns: [
            "traj", "step", "t", "x", "v", "scenario", "m", "c", "k_slg", "k_slg_role", "g_global", "e", "x0", "v0", "ground", "k_g", "c_g"
          ]
        }
      }
    },
    model: {
      outputs: [
        { key: "x", label: "x", headType: "regression" },
        { key: "v", label: "v", headType: "regression" },
        { key: "xv", label: "x+v", headType: "regression" },
        { key: "traj", label: "traj (full sequence)", headType: "regression" },
        { key: "params", label: "params", headType: "regression" },
      ],
      params: [
        { key: "m", label: "m" },
        { key: "c", label: "c" },
        { key: "k", label: "k_slg" },
        { key: "e", label: "e" },
        { key: "x0", label: "x0" },
        { key: "v0", label: "v0" },
        { key: "gm", label: "gm" },
        { key: "gk", label: "gk" },
        { key: "gc", label: "gc" },
        { key: "rkm", label: "k/m" },
        { key: "rcm", label: "c/m" },
        { key: "rgl", label: "g/L" }
      ],
      presets:         [
                {
                        "id": "direct_mlp_strong",
                        "label": "Quick: Direct-MLP-Strong",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "params",
                                                        "type": "params",
                                                        "x": 360,
                                                        "y": 40,
                                                        "config": {
                                                                "paramMask": {
                                                                        "m": true,
                                                                        "c": true,
                                                                        "k": true,
                                                                        "e": true,
                                                                        "x0": true,
                                                                        "v0": true,
                                                                        "gm": true,
                                                                        "gk": true,
                                                                        "gc": true,
                                                                        "rkm": false,
                                                                        "rcm": false,
                                                                        "rgl": false
                                                                }
                                                        }
                                                },
                                                {
                                                        "key": "time_sec",
                                                        "type": "time_sec",
                                                        "x": 520,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "time_norm",
                                                        "type": "time_norm",
                                                        "x": 680,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "onehot",
                                                        "type": "onehot",
                                                        "x": 840,
                                                        "y": 40,
                                                        "config": {
                                                                "oneHotKey": "scenario"
                                                        }
                                                },
                                                {
                                                        "key": "sin_norm",
                                                        "type": "sin_norm",
                                                        "x": 1000,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "cos_norm",
                                                        "type": "cos_norm",
                                                        "x": 1160,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "concat",
                                                        "type": "concat",
                                                        "x": 1320,
                                                        "y": 40,
                                                        "config": {
                                                                "numInputs": 6
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 1480,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "flat"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 1640,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 128,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "dense_2",
                                                        "type": "dense",
                                                        "x": 1840,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 64,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "dense_3",
                                                        "type": "dense",
                                                        "x": 2040,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 32,
                                                                "activation": "tanh"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 2240,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "x",
                                                                "targetType": "x",
                                                                "loss": "mse",
                                                                "wx": 1,
                                                                "wv": 1,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "params",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "time_sec",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_2"
                                                },
                                                {
                                                        "from": "time_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_3"
                                                },
                                                {
                                                        "from": "onehot",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_4"
                                                },
                                                {
                                                        "from": "sin_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_5"
                                                },
                                                {
                                                        "from": "cos_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_6"
                                                },
                                                {
                                                        "from": "concat",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "dense_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_2",
                                                        "to": "dense_3",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_3",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "ar_gru_strong",
                        "label": "Quick: AR-GRU-Strong",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "hist_x",
                                                        "type": "window_hist_x",
                                                        "x": 40,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "hist_v",
                                                        "type": "window_hist_v",
                                                        "x": 200,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "params",
                                                        "type": "params",
                                                        "x": 540,
                                                        "y": 40,
                                                        "config": {
                                                                "paramMask": {
                                                                        "m": true,
                                                                        "c": true,
                                                                        "k": true,
                                                                        "e": true,
                                                                        "x0": true,
                                                                        "v0": true,
                                                                        "gm": true,
                                                                        "gk": true,
                                                                        "gc": true,
                                                                        "rkm": false,
                                                                        "rcm": false,
                                                                        "rgl": false
                                                                }
                                                        }
                                                },
                                                {
                                                        "key": "time_sec",
                                                        "type": "time_sec",
                                                        "x": 700,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "time_norm",
                                                        "type": "time_norm",
                                                        "x": 860,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "onehot",
                                                        "type": "onehot",
                                                        "x": 1020,
                                                        "y": 40,
                                                        "config": {
                                                                "oneHotKey": "scenario"
                                                        }
                                                },
                                                {
                                                        "key": "sin_norm",
                                                        "type": "sin_norm",
                                                        "x": 1180,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "cos_norm",
                                                        "type": "cos_norm",
                                                        "x": 1340,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "concat",
                                                        "type": "concat",
                                                        "x": 1500,
                                                        "y": 40,
                                                        "config": {
                                                                "numInputs": 8
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 1660,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "sequence"
                                                        }
                                                },
                                                {
                                                        "key": "seq_1",
                                                        "type": "gru",
                                                        "x": 1820,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 96,
                                                                "dropout": 0.1,
                                                                "returnseq": "true"
                                                        }
                                                },
                                                {
                                                        "key": "seq_2",
                                                        "type": "gru",
                                                        "x": 2020,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 48,
                                                                "dropout": 0.1,
                                                                "returnseq": "false"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 2220,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 32,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 2420,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "x",
                                                                "targetType": "x",
                                                                "loss": "mse",
                                                                "wx": 1,
                                                                "wv": 1,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "hist_x",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "hist_v",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_2"
                                                },
                                                {
                                                        "from": "params",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_3"
                                                },
                                                {
                                                        "from": "time_sec",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_4"
                                                },
                                                {
                                                        "from": "time_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_5"
                                                },
                                                {
                                                        "from": "onehot",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_6"
                                                },
                                                {
                                                        "from": "sin_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_7"
                                                },
                                                {
                                                        "from": "cos_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_8"
                                                },
                                                {
                                                        "from": "concat",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "seq_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_1",
                                                        "to": "seq_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_2",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "ar_lstm_strong",
                        "label": "Quick: AR-LSTM-Strong",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "hist_x",
                                                        "type": "window_hist_x",
                                                        "x": 40,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "hist_v",
                                                        "type": "window_hist_v",
                                                        "x": 200,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "params",
                                                        "type": "params",
                                                        "x": 540,
                                                        "y": 40,
                                                        "config": {
                                                                "paramMask": {
                                                                        "m": true,
                                                                        "c": true,
                                                                        "k": true,
                                                                        "e": true,
                                                                        "x0": true,
                                                                        "v0": true,
                                                                        "gm": true,
                                                                        "gk": true,
                                                                        "gc": true,
                                                                        "rkm": false,
                                                                        "rcm": false,
                                                                        "rgl": false
                                                                }
                                                        }
                                                },
                                                {
                                                        "key": "time_sec",
                                                        "type": "time_sec",
                                                        "x": 700,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "time_norm",
                                                        "type": "time_norm",
                                                        "x": 860,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "onehot",
                                                        "type": "onehot",
                                                        "x": 1020,
                                                        "y": 40,
                                                        "config": {
                                                                "oneHotKey": "scenario"
                                                        }
                                                },
                                                {
                                                        "key": "sin_norm",
                                                        "type": "sin_norm",
                                                        "x": 1180,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "cos_norm",
                                                        "type": "cos_norm",
                                                        "x": 1340,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "concat",
                                                        "type": "concat",
                                                        "x": 1500,
                                                        "y": 40,
                                                        "config": {
                                                                "numInputs": 8
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 1660,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "sequence"
                                                        }
                                                },
                                                {
                                                        "key": "seq_1",
                                                        "type": "lstm",
                                                        "x": 1820,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 96,
                                                                "dropout": 0.1,
                                                                "returnseq": "true"
                                                        }
                                                },
                                                {
                                                        "key": "seq_2",
                                                        "type": "lstm",
                                                        "x": 2020,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 48,
                                                                "dropout": 0.1,
                                                                "returnseq": "false"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 2220,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 32,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 2420,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "x",
                                                                "targetType": "x",
                                                                "loss": "mse",
                                                                "wx": 1,
                                                                "wv": 1,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "hist_x",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "hist_v",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_2"
                                                },
                                                {
                                                        "from": "params",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_3"
                                                },
                                                {
                                                        "from": "time_sec",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_4"
                                                },
                                                {
                                                        "from": "time_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_5"
                                                },
                                                {
                                                        "from": "onehot",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_6"
                                                },
                                                {
                                                        "from": "sin_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_7"
                                                },
                                                {
                                                        "from": "cos_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_8"
                                                },
                                                {
                                                        "from": "concat",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "seq_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_1",
                                                        "to": "seq_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_2",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "direct_mlp_ratio",
                        "label": "Quick: Direct-MLP-Ratio",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "params",
                                                        "type": "params",
                                                        "x": 360,
                                                        "y": 40,
                                                        "config": {
                                                                "paramMask": {
                                                                        "m": true,
                                                                        "c": true,
                                                                        "k": true,
                                                                        "e": true,
                                                                        "x0": true,
                                                                        "v0": true,
                                                                        "gm": true,
                                                                        "gk": true,
                                                                        "gc": true,
                                                                        "rkm": true,
                                                                        "rcm": true,
                                                                        "rgl": true
                                                                }
                                                        }
                                                },
                                                {
                                                        "key": "time_sec",
                                                        "type": "time_sec",
                                                        "x": 520,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "time_norm",
                                                        "type": "time_norm",
                                                        "x": 680,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "onehot",
                                                        "type": "onehot",
                                                        "x": 840,
                                                        "y": 40,
                                                        "config": {
                                                                "oneHotKey": "scenario"
                                                        }
                                                },
                                                {
                                                        "key": "sin_norm",
                                                        "type": "sin_norm",
                                                        "x": 1000,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "cos_norm",
                                                        "type": "cos_norm",
                                                        "x": 1160,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "concat",
                                                        "type": "concat",
                                                        "x": 1320,
                                                        "y": 40,
                                                        "config": {
                                                                "numInputs": 6
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 1480,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "flat"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 1640,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 128,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "dense_2",
                                                        "type": "dense",
                                                        "x": 1840,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 64,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "dense_3",
                                                        "type": "dense",
                                                        "x": 2040,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 32,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 2240,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "x",
                                                                "targetType": "x",
                                                                "loss": "mse",
                                                                "wx": 1,
                                                                "wv": 1,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "params",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "time_sec",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_2"
                                                },
                                                {
                                                        "from": "time_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_3"
                                                },
                                                {
                                                        "from": "onehot",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_4"
                                                },
                                                {
                                                        "from": "sin_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_5"
                                                },
                                                {
                                                        "from": "cos_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_6"
                                                },
                                                {
                                                        "from": "concat",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "dense_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_2",
                                                        "to": "dense_3",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_3",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "ar_gru_ratio",
                        "label": "Quick: AR-GRU-Ratio",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "hist_x",
                                                        "type": "window_hist_x",
                                                        "x": 40,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "hist_v",
                                                        "type": "window_hist_v",
                                                        "x": 200,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "params",
                                                        "type": "params",
                                                        "x": 540,
                                                        "y": 40,
                                                        "config": {
                                                                "paramMask": {
                                                                        "m": true,
                                                                        "c": true,
                                                                        "k": true,
                                                                        "e": true,
                                                                        "x0": true,
                                                                        "v0": true,
                                                                        "gm": true,
                                                                        "gk": true,
                                                                        "gc": true,
                                                                        "rkm": true,
                                                                        "rcm": true,
                                                                        "rgl": true
                                                                }
                                                        }
                                                },
                                                {
                                                        "key": "time_sec",
                                                        "type": "time_sec",
                                                        "x": 700,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "time_norm",
                                                        "type": "time_norm",
                                                        "x": 860,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "onehot",
                                                        "type": "onehot",
                                                        "x": 1020,
                                                        "y": 40,
                                                        "config": {
                                                                "oneHotKey": "scenario"
                                                        }
                                                },
                                                {
                                                        "key": "sin_norm",
                                                        "type": "sin_norm",
                                                        "x": 1180,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "cos_norm",
                                                        "type": "cos_norm",
                                                        "x": 1340,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "concat",
                                                        "type": "concat",
                                                        "x": 1500,
                                                        "y": 40,
                                                        "config": {
                                                                "numInputs": 8
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 1660,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "sequence"
                                                        }
                                                },
                                                {
                                                        "key": "seq_1",
                                                        "type": "gru",
                                                        "x": 1820,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 96,
                                                                "dropout": 0.1,
                                                                "returnseq": "true"
                                                        }
                                                },
                                                {
                                                        "key": "seq_2",
                                                        "type": "gru",
                                                        "x": 2020,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 48,
                                                                "dropout": 0.1,
                                                                "returnseq": "false"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 2220,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 32,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 2420,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "x",
                                                                "targetType": "x",
                                                                "loss": "mse",
                                                                "wx": 1,
                                                                "wv": 1,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "hist_x",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "hist_v",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_2"
                                                },
                                                {
                                                        "from": "params",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_3"
                                                },
                                                {
                                                        "from": "time_sec",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_4"
                                                },
                                                {
                                                        "from": "time_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_5"
                                                },
                                                {
                                                        "from": "onehot",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_6"
                                                },
                                                {
                                                        "from": "sin_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_7"
                                                },
                                                {
                                                        "from": "cos_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_8"
                                                },
                                                {
                                                        "from": "concat",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "seq_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_1",
                                                        "to": "seq_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_2",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "ar_lstm_ratio",
                        "label": "Quick: AR-LSTM-Ratio",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "hist_x",
                                                        "type": "window_hist_x",
                                                        "x": 40,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "hist_v",
                                                        "type": "window_hist_v",
                                                        "x": 200,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "params",
                                                        "type": "params",
                                                        "x": 540,
                                                        "y": 40,
                                                        "config": {
                                                                "paramMask": {
                                                                        "m": true,
                                                                        "c": true,
                                                                        "k": true,
                                                                        "e": true,
                                                                        "x0": true,
                                                                        "v0": true,
                                                                        "gm": true,
                                                                        "gk": true,
                                                                        "gc": true,
                                                                        "rkm": true,
                                                                        "rcm": true,
                                                                        "rgl": true
                                                                }
                                                        }
                                                },
                                                {
                                                        "key": "time_sec",
                                                        "type": "time_sec",
                                                        "x": 700,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "time_norm",
                                                        "type": "time_norm",
                                                        "x": 860,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "onehot",
                                                        "type": "onehot",
                                                        "x": 1020,
                                                        "y": 40,
                                                        "config": {
                                                                "oneHotKey": "scenario"
                                                        }
                                                },
                                                {
                                                        "key": "sin_norm",
                                                        "type": "sin_norm",
                                                        "x": 1180,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "cos_norm",
                                                        "type": "cos_norm",
                                                        "x": 1340,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "concat",
                                                        "type": "concat",
                                                        "x": 1500,
                                                        "y": 40,
                                                        "config": {
                                                                "numInputs": 8
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 1660,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "sequence"
                                                        }
                                                },
                                                {
                                                        "key": "seq_1",
                                                        "type": "lstm",
                                                        "x": 1820,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 96,
                                                                "dropout": 0.1,
                                                                "returnseq": "true"
                                                        }
                                                },
                                                {
                                                        "key": "seq_2",
                                                        "type": "lstm",
                                                        "x": 2020,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 48,
                                                                "dropout": 0.1,
                                                                "returnseq": "false"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 2220,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 32,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 2420,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "x",
                                                                "targetType": "x",
                                                                "loss": "mse",
                                                                "wx": 1,
                                                                "wv": 1,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "hist_x",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "hist_v",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_2"
                                                },
                                                {
                                                        "from": "params",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_3"
                                                },
                                                {
                                                        "from": "time_sec",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_4"
                                                },
                                                {
                                                        "from": "time_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_5"
                                                },
                                                {
                                                        "from": "onehot",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_6"
                                                },
                                                {
                                                        "from": "sin_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_7"
                                                },
                                                {
                                                        "from": "cos_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_8"
                                                },
                                                {
                                                        "from": "concat",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "seq_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_1",
                                                        "to": "seq_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_2",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "exp_ar_cnn_strong",
                        "label": "EXP: AR-CNN-Strong",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "hist_x",
                                                        "type": "window_hist_x",
                                                        "x": 40,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "hist_v",
                                                        "type": "window_hist_v",
                                                        "x": 200,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "params",
                                                        "type": "params",
                                                        "x": 540,
                                                        "y": 40,
                                                        "config": {
                                                                "paramMask": {
                                                                        "m": true,
                                                                        "c": true,
                                                                        "k": true,
                                                                        "e": true,
                                                                        "x0": true,
                                                                        "v0": true,
                                                                        "gm": true,
                                                                        "gk": true,
                                                                        "gc": true,
                                                                        "rkm": false,
                                                                        "rcm": false,
                                                                        "rgl": false
                                                                }
                                                        }
                                                },
                                                {
                                                        "key": "time_sec",
                                                        "type": "time_sec",
                                                        "x": 700,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "time_norm",
                                                        "type": "time_norm",
                                                        "x": 860,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "onehot",
                                                        "type": "onehot",
                                                        "x": 1020,
                                                        "y": 40,
                                                        "config": {
                                                                "oneHotKey": "scenario"
                                                        }
                                                },
                                                {
                                                        "key": "sin_norm",
                                                        "type": "sin_norm",
                                                        "x": 1180,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "cos_norm",
                                                        "type": "cos_norm",
                                                        "x": 1340,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "concat",
                                                        "type": "concat",
                                                        "x": 1500,
                                                        "y": 40,
                                                        "config": {
                                                                "numInputs": 8
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 1660,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "sequence"
                                                        }
                                                },
                                                {
                                                        "key": "seq_1",
                                                        "type": "conv1d",
                                                        "x": 1820,
                                                        "y": 120,
                                                        "config": {
                                                                "filters": 64,
                                                                "kernelSize": 5,
                                                                "stride": 1,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "seq_2",
                                                        "type": "conv1d",
                                                        "x": 2020,
                                                        "y": 120,
                                                        "config": {
                                                                "filters": 32,
                                                                "kernelSize": 3,
                                                                "stride": 1,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 2220,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 32,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 2420,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "x",
                                                                "targetType": "x",
                                                                "loss": "mse",
                                                                "wx": 1,
                                                                "wv": 1,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "hist_x",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "hist_v",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_2"
                                                },
                                                {
                                                        "from": "params",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_3"
                                                },
                                                {
                                                        "from": "time_sec",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_4"
                                                },
                                                {
                                                        "from": "time_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_5"
                                                },
                                                {
                                                        "from": "onehot",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_6"
                                                },
                                                {
                                                        "from": "sin_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_7"
                                                },
                                                {
                                                        "from": "cos_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_8"
                                                },
                                                {
                                                        "from": "concat",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "seq_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_1",
                                                        "to": "seq_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_2",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "exp_ar_gru_window_to_x_zero_pad",
                        "label": "EXP: AR-GRU ZeroPad (x-only)",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "hist_x",
                                                        "type": "window_hist_x",
                                                        "x": 40,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "zero"
                                                        }
                                                },
                                                {
                                                        "key": "hist_v",
                                                        "type": "window_hist_v",
                                                        "x": 200,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "zero"
                                                        }
                                                },
                                                {
                                                        "key": "params",
                                                        "type": "params",
                                                        "x": 540,
                                                        "y": 40,
                                                        "config": {
                                                                "paramMask": {
                                                                        "m": true,
                                                                        "c": true,
                                                                        "k": true,
                                                                        "e": true,
                                                                        "x0": true,
                                                                        "v0": true,
                                                                        "gm": true,
                                                                        "gk": true,
                                                                        "gc": true,
                                                                        "rkm": false,
                                                                        "rcm": false,
                                                                        "rgl": false
                                                                }
                                                        }
                                                },
                                                {
                                                        "key": "time_sec",
                                                        "type": "time_sec",
                                                        "x": 700,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "time_norm",
                                                        "type": "time_norm",
                                                        "x": 860,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "onehot",
                                                        "type": "onehot",
                                                        "x": 1020,
                                                        "y": 40,
                                                        "config": {
                                                                "oneHotKey": "scenario"
                                                        }
                                                },
                                                {
                                                        "key": "sin_norm",
                                                        "type": "sin_norm",
                                                        "x": 1180,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "cos_norm",
                                                        "type": "cos_norm",
                                                        "x": 1340,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "concat",
                                                        "type": "concat",
                                                        "x": 1500,
                                                        "y": 40,
                                                        "config": {
                                                                "numInputs": 8
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 1660,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "sequence"
                                                        }
                                                },
                                                {
                                                        "key": "seq_1",
                                                        "type": "gru",
                                                        "x": 1820,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 96,
                                                                "dropout": 0.1,
                                                                "returnseq": "true"
                                                        }
                                                },
                                                {
                                                        "key": "seq_2",
                                                        "type": "gru",
                                                        "x": 2020,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 48,
                                                                "dropout": 0.1,
                                                                "returnseq": "false"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 2220,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 32,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 2420,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "x",
                                                                "targetType": "x",
                                                                "loss": "mse",
                                                                "wx": 1,
                                                                "wv": 1,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "hist_x",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "hist_v",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_2"
                                                },
                                                {
                                                        "from": "params",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_3"
                                                },
                                                {
                                                        "from": "time_sec",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_4"
                                                },
                                                {
                                                        "from": "time_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_5"
                                                },
                                                {
                                                        "from": "onehot",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_6"
                                                },
                                                {
                                                        "from": "sin_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_7"
                                                },
                                                {
                                                        "from": "cos_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_8"
                                                },
                                                {
                                                        "from": "concat",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "seq_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_1",
                                                        "to": "seq_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_2",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "exp_ar_gru_window_to_x_rk4_warmup",
                        "label": "EXP: AR-GRU RK4 Warmup (x-only)",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "hist_x",
                                                        "type": "window_hist_x",
                                                        "x": 40,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "hist_v",
                                                        "type": "window_hist_v",
                                                        "x": 200,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "params",
                                                        "type": "params",
                                                        "x": 540,
                                                        "y": 40,
                                                        "config": {
                                                                "paramMask": {
                                                                        "m": true,
                                                                        "c": true,
                                                                        "k": true,
                                                                        "e": true,
                                                                        "x0": true,
                                                                        "v0": true,
                                                                        "gm": true,
                                                                        "gk": true,
                                                                        "gc": true,
                                                                        "rkm": false,
                                                                        "rcm": false,
                                                                        "rgl": false
                                                                }
                                                        }
                                                },
                                                {
                                                        "key": "time_sec",
                                                        "type": "time_sec",
                                                        "x": 700,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "time_norm",
                                                        "type": "time_norm",
                                                        "x": 860,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "onehot",
                                                        "type": "onehot",
                                                        "x": 1020,
                                                        "y": 40,
                                                        "config": {
                                                                "oneHotKey": "scenario"
                                                        }
                                                },
                                                {
                                                        "key": "sin_norm",
                                                        "type": "sin_norm",
                                                        "x": 1180,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "cos_norm",
                                                        "type": "cos_norm",
                                                        "x": 1340,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "concat",
                                                        "type": "concat",
                                                        "x": 1500,
                                                        "y": 40,
                                                        "config": {
                                                                "numInputs": 8
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 1660,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "sequence"
                                                        }
                                                },
                                                {
                                                        "key": "seq_1",
                                                        "type": "gru",
                                                        "x": 1820,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 96,
                                                                "dropout": 0.1,
                                                                "returnseq": "true"
                                                        }
                                                },
                                                {
                                                        "key": "seq_2",
                                                        "type": "gru",
                                                        "x": 2020,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 48,
                                                                "dropout": 0.1,
                                                                "returnseq": "false"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 2220,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 32,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 2420,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "x",
                                                                "targetType": "x",
                                                                "loss": "mse",
                                                                "wx": 1,
                                                                "wv": 1,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "hist_x",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "hist_v",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_2"
                                                },
                                                {
                                                        "from": "params",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_3"
                                                },
                                                {
                                                        "from": "time_sec",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_4"
                                                },
                                                {
                                                        "from": "time_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_5"
                                                },
                                                {
                                                        "from": "onehot",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_6"
                                                },
                                                {
                                                        "from": "sin_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_7"
                                                },
                                                {
                                                        "from": "cos_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_8"
                                                },
                                                {
                                                        "from": "concat",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "seq_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_1",
                                                        "to": "seq_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "seq_2",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "exp_dual_latent_match_direct",
                        "label": "EXP: Dual Encoder Z-Match (Direct)",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "params",
                                                        "type": "params",
                                                        "x": 160,
                                                        "y": 80,
                                                        "config": {
                                                                "paramMask": {
                                                                        "m": true,
                                                                        "c": true,
                                                                        "k": true,
                                                                        "e": true,
                                                                        "x0": true,
                                                                        "v0": true,
                                                                        "gm": true,
                                                                        "gk": true,
                                                                        "gc": true,
                                                                        "rkm": false,
                                                                        "rcm": false,
                                                                        "rgl": false
                                                                }
                                                        }
                                                },
                                                {
                                                        "key": "time_sec",
                                                        "type": "time_sec",
                                                        "x": 320,
                                                        "y": 80,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "time_norm",
                                                        "type": "time_norm",
                                                        "x": 480,
                                                        "y": 80,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "onehot",
                                                        "type": "onehot",
                                                        "x": 640,
                                                        "y": 80,
                                                        "config": {
                                                                "oneHotKey": "scenario"
                                                        }
                                                },
                                                {
                                                        "key": "sin_norm",
                                                        "type": "sin_norm",
                                                        "x": 800,
                                                        "y": 80,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "cos_norm",
                                                        "type": "cos_norm",
                                                        "x": 960,
                                                        "y": 80,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "concat",
                                                        "type": "concat",
                                                        "x": 1120,
                                                        "y": 80,
                                                        "config": {
                                                                "numInputs": 6
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 1260,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "flat"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 1420,
                                                        "y": 70,
                                                        "config": {
                                                                "units": 96,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "dense_2",
                                                        "type": "dense",
                                                        "x": 1420,
                                                        "y": 190,
                                                        "config": {
                                                                "units": 96,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "latent_1",
                                                        "type": "latent",
                                                        "x": 1580,
                                                        "y": 70,
                                                        "config": {
                                                                "units": 16,
                                                                "group": "z_shared",
                                                                "matchWeight": 1
                                                        }
                                                },
                                                {
                                                        "key": "latent_2",
                                                        "type": "latent",
                                                        "x": 1580,
                                                        "y": 190,
                                                        "config": {
                                                                "units": 16,
                                                                "group": "z_shared",
                                                                "matchWeight": 1
                                                        }
                                                },
                                                {
                                                        "key": "dense_3",
                                                        "type": "dense",
                                                        "x": 1740,
                                                        "y": 70,
                                                        "config": {
                                                                "units": 64,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "dense_4",
                                                        "type": "dense",
                                                        "x": 1900,
                                                        "y": 70,
                                                        "config": {
                                                                "units": 32,
                                                                "activation": "tanh"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 2060,
                                                        "y": 70,
                                                        "config": {
                                                                "target": "x",
                                                                "targetType": "x",
                                                                "loss": "mse",
                                                                "wx": 1,
                                                                "wv": 1,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "params",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "time_sec",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_2"
                                                },
                                                {
                                                        "from": "time_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_3"
                                                },
                                                {
                                                        "from": "onehot",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_4"
                                                },
                                                {
                                                        "from": "sin_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_5"
                                                },
                                                {
                                                        "from": "cos_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_6"
                                                },
                                                {
                                                        "from": "concat",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "dense_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "latent_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_2",
                                                        "to": "latent_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "latent_1",
                                                        "to": "dense_3",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_3",
                                                        "to": "dense_4",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_4",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "exp_ar_gru_latent_match",
                        "label": "EXP: AR-GRU + Z-Match",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "hist_x",
                                                        "type": "window_hist_x",
                                                        "x": 40,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "hist_v",
                                                        "type": "window_hist_v",
                                                        "x": 200,
                                                        "y": 40,
                                                        "config": {
                                                                "windowSize": 20,
                                                                "stride": 1,
                                                                "lagMode": "contiguous",
                                                                "lagCsv": "1,2,3,4,5",
                                                                "padMode": "none"
                                                        }
                                                },
                                                {
                                                        "key": "params",
                                                        "type": "params",
                                                        "x": 360,
                                                        "y": 40,
                                                        "config": {
                                                                "paramMask": {
                                                                        "m": true,
                                                                        "c": true,
                                                                        "k": true,
                                                                        "e": true,
                                                                        "x0": true,
                                                                        "v0": true,
                                                                        "gm": true,
                                                                        "gk": true,
                                                                        "gc": true,
                                                                        "rkm": false,
                                                                        "rcm": false,
                                                                        "rgl": false
                                                                }
                                                        }
                                                },
                                                {
                                                        "key": "time_norm",
                                                        "type": "time_norm",
                                                        "x": 520,
                                                        "y": 40,
                                                        "config": {}
                                                },
                                                {
                                                        "key": "onehot",
                                                        "type": "onehot",
                                                        "x": 680,
                                                        "y": 40,
                                                        "config": {
                                                                "oneHotKey": "scenario"
                                                        }
                                                },
                                                {
                                                        "key": "concat",
                                                        "type": "concat",
                                                        "x": 840,
                                                        "y": 40,
                                                        "config": {
                                                                "numInputs": 5
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 980,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "sequence"
                                                        }
                                                },
                                                {
                                                        "key": "gru_1",
                                                        "type": "gru",
                                                        "x": 1140,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 96,
                                                                "dropout": 0.1,
                                                                "returnseq": "true"
                                                        }
                                                },
                                                {
                                                        "key": "gru_2",
                                                        "type": "gru",
                                                        "x": 1300,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 48,
                                                                "dropout": 0.1,
                                                                "returnseq": "false"
                                                        }
                                                },
                                                {
                                                        "key": "latent_1",
                                                        "type": "latent",
                                                        "x": 1460,
                                                        "y": 80,
                                                        "config": {
                                                                "units": 16,
                                                                "group": "z_shared",
                                                                "matchWeight": 1
                                                        }
                                                },
                                                {
                                                        "key": "latent_2",
                                                        "type": "latent",
                                                        "x": 1460,
                                                        "y": 200,
                                                        "config": {
                                                                "units": 16,
                                                                "group": "z_shared",
                                                                "matchWeight": 1
                                                        }
                                                },
                                                {
                                                        "key": "dense",
                                                        "type": "dense",
                                                        "x": 1620,
                                                        "y": 80,
                                                        "config": {
                                                                "units": 32,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 1780,
                                                        "y": 80,
                                                        "config": {
                                                                "target": "x",
                                                                "targetType": "x",
                                                                "loss": "mse",
                                                                "wx": 1,
                                                                "wv": 1,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "hist_x",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "hist_v",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_2"
                                                },
                                                {
                                                        "from": "params",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_3"
                                                },
                                                {
                                                        "from": "time_norm",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_4"
                                                },
                                                {
                                                        "from": "onehot",
                                                        "to": "concat",
                                                        "out": "output_1",
                                                        "in": "input_5"
                                                },
                                                {
                                                        "from": "concat",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "gru_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "gru_1",
                                                        "to": "gru_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "gru_2",
                                                        "to": "latent_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "gru_2",
                                                        "to": "latent_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "latent_1",
                                                        "to": "dense",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                }
        ],

      metadata: {
        featureNodes: {
          historySeries: [
            { key: "x", label: "x(t)" },
            { key: "v", label: "v(t)" }
          ],
          oneHot: [
            { key: "scenario", label: "scenario", values: ["spring", "pendulum", "bouncing"] }
          ],
          policy: {
            allowHistory: true,
            allowWindowHistory: true,
            allowParams: true,
            allowOneHot: true,
            allowImageSource: false
          },
          palette: {
            items: _trajectoryPaletteItems()
          }
        }
      }
    },
    preconfig: {
      dataset: {
        defaultModuleId: "oscillator",
        splitDefaults: {
          mode: "stratified_scenario",
          train: 0.70,
          val: 0.15,
          test: 0.15,
        },
      },
      model: {
        defaultPreset: "direct_mlp_strong",
      },
    }
  }, { makeDefault: true });

  registerSchema({
    id: "mnist",
    label: "mnist",
    description: "MNIST digit dataset schema for image-classification style experiments",
    dataset: {
      id: "mnist",
      label: "MNIST images",
      sampleType: "image",
      splitUnit: "sample",
      splitDefaults: {
        mode: "random",
        train: 0.80,
        val: 0.10,
        test: 0.10,
      },
      metadata: {
        ui: {
          sidebarMode: "generic",
          viewer: "image",
        },
        splitModes: [
          { id: "original", label: "Original (source train/test)", stratifyKey: "" },
          { id: "random", label: "Random (global)", stratifyKey: "" },
          { id: "stratified_label", label: "Stratified by label", stratifyKey: "label" }
        ],
        display: {
          chartType: "label_histogram",
          tableColumns: ["split", "index", "label", "class_name", "pixel_values"]
        }
      }
    },
    model: {
      outputs: [
        { key: "pixel_values", label: "image reconstruction", headType: "reconstruction" },
        { key: "label", label: "digit label (0-9)", headType: "classification" },
        { key: "logits", label: "class logits", headType: "classification" }
      ],
      params: [],
      presets:         [
                {
                        "id": "mnist_mlp_baseline",
                        "label": "MNIST: MLP Baseline",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "image",
                                                        "type": "image_source",
                                                        "x": 140,
                                                        "y": 60,
                                                        "config": {
                                                                "sourceKey": "pixel_values"
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 420,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "flat"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 620,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 256,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "dropout_1",
                                                        "type": "dropout",
                                                        "x": 800,
                                                        "y": 120,
                                                        "config": {
                                                                "rate": 0.2
                                                        }
                                                },
                                                {
                                                        "key": "dense_2",
                                                        "type": "dense",
                                                        "x": 980,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 128,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 1160,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "label",
                                                                "targetType": "label",
                                                                "loss": "cross_entropy",
                                                                "units": 10,
                                                                "unitsHint": 10,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "image",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "dropout_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dropout_1",
                                                        "to": "dense_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_2",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "mnist_direct_mlp_strong",
                        "label": "MNIST: Direct-MLP-Strong",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "image",
                                                        "type": "image_source",
                                                        "x": 140,
                                                        "y": 60,
                                                        "config": {
                                                                "sourceKey": "pixel_values"
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 420,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "flat"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 620,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 384,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "bn_1",
                                                        "type": "batchnorm",
                                                        "x": 800,
                                                        "y": 120,
                                                        "config": {
                                                                "momentum": 0.99,
                                                                "epsilon": 0.001
                                                        }
                                                },
                                                {
                                                        "key": "dropout_1",
                                                        "type": "dropout",
                                                        "x": 980,
                                                        "y": 120,
                                                        "config": {
                                                                "rate": 0.25
                                                        }
                                                },
                                                {
                                                        "key": "dense_2",
                                                        "type": "dense",
                                                        "x": 1160,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 192,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "dropout_2",
                                                        "type": "dropout",
                                                        "x": 1340,
                                                        "y": 120,
                                                        "config": {
                                                                "rate": 0.15
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 1520,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "label",
                                                                "targetType": "label",
                                                                "loss": "cross_entropy",
                                                                "units": 10,
                                                                "unitsHint": 10,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "image",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "bn_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "bn_1",
                                                        "to": "dropout_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dropout_1",
                                                        "to": "dense_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_2",
                                                        "to": "dropout_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dropout_2",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                }
        ],

      metadata: {
        featureNodes: {
          imageSource: [
            { key: "pixel_values", label: "pixel values (28x28)", featureSize: 784, shape: [28, 28, 1] }
          ],
          oneHot: [
            { key: "label", label: "label", values: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] }
          ],
          policy: {
            allowHistory: false,
            allowWindowHistory: false,
            allowParams: false,
            allowOneHot: true,
            allowImageSource: true
          },
          palette: {
            items: _imagePaletteItems()
          }
        }
      },
    },
    preconfig: {
      dataset: {
        defaultModuleId: "mnist",
        splitDefaults: {
          mode: "random",
          train: 0.80,
          val: 0.10,
          test: 0.10,
        },
      },
      model: {
        defaultPreset: "mnist_mlp_baseline",
      },
    }
  });

  registerSchema({
    id: "fashion_mnist",
    label: "fashion_mnist",
    description: "Fashion-MNIST image dataset schema for classification experiments",
    dataset: {
      id: "fashion_mnist",
      label: "Fashion-MNIST images",
      sampleType: "image",
      splitUnit: "sample",
      splitDefaults: {
        mode: "stratified_label",
        train: 0.80,
        val: 0.10,
        test: 0.10,
      },
      metadata: {
        ui: {
          sidebarMode: "generic",
          viewer: "image",
        },
        splitModes: [
          { id: "original", label: "Original (source train/test)", stratifyKey: "" },
          { id: "random", label: "Random (global)", stratifyKey: "" },
          { id: "stratified_label", label: "Stratified by label", stratifyKey: "label" }
        ],
        display: {
          chartType: "label_histogram",
          tableColumns: ["split", "index", "label", "class_name", "pixel_values"]
        }
      }
    },
    model: {
      outputs: [
        { key: "pixel_values", label: "image reconstruction", headType: "reconstruction" },
        { key: "label", label: "label (0-9)", headType: "classification" },
        { key: "logits", label: "class logits", headType: "classification" }
      ],
      params: [],
      presets:         [
                {
                        "id": "fashion_mnist_mlp_baseline",
                        "label": "Fashion-MNIST: MLP Baseline",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "image",
                                                        "type": "image_source",
                                                        "x": 140,
                                                        "y": 60,
                                                        "config": {
                                                                "sourceKey": "pixel_values"
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 420,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "flat"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 620,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 256,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "dropout_1",
                                                        "type": "dropout",
                                                        "x": 800,
                                                        "y": 120,
                                                        "config": {
                                                                "rate": 0.2
                                                        }
                                                },
                                                {
                                                        "key": "dense_2",
                                                        "type": "dense",
                                                        "x": 980,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 128,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 1160,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "label",
                                                                "targetType": "label",
                                                                "loss": "cross_entropy",
                                                                "units": 10,
                                                                "unitsHint": 10,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "image",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "dropout_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dropout_1",
                                                        "to": "dense_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_2",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "fashion_mnist_direct_mlp_strong",
                        "label": "Fashion-MNIST: Direct-MLP-Strong",
                        "metadata": {
                                "graphSpec": {
                                        "nodes": [
                                                {
                                                        "key": "image",
                                                        "type": "image_source",
                                                        "x": 140,
                                                        "y": 60,
                                                        "config": {
                                                                "sourceKey": "pixel_values"
                                                        }
                                                },
                                                {
                                                        "key": "input",
                                                        "type": "input",
                                                        "x": 420,
                                                        "y": 120,
                                                        "config": {
                                                                "mode": "flat"
                                                        }
                                                },
                                                {
                                                        "key": "dense_1",
                                                        "type": "dense",
                                                        "x": 620,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 384,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "bn_1",
                                                        "type": "batchnorm",
                                                        "x": 800,
                                                        "y": 120,
                                                        "config": {
                                                                "momentum": 0.99,
                                                                "epsilon": 0.001
                                                        }
                                                },
                                                {
                                                        "key": "dropout_1",
                                                        "type": "dropout",
                                                        "x": 980,
                                                        "y": 120,
                                                        "config": {
                                                                "rate": 0.25
                                                        }
                                                },
                                                {
                                                        "key": "dense_2",
                                                        "type": "dense",
                                                        "x": 1160,
                                                        "y": 120,
                                                        "config": {
                                                                "units": 192,
                                                                "activation": "relu"
                                                        }
                                                },
                                                {
                                                        "key": "dropout_2",
                                                        "type": "dropout",
                                                        "x": 1340,
                                                        "y": 120,
                                                        "config": {
                                                                "rate": 0.15
                                                        }
                                                },
                                                {
                                                        "key": "output",
                                                        "type": "output",
                                                        "x": 1520,
                                                        "y": 120,
                                                        "config": {
                                                                "target": "label",
                                                                "targetType": "label",
                                                                "loss": "cross_entropy",
                                                                "units": 10,
                                                                "unitsHint": 10,
                                                                "matchWeight": 1
                                                        }
                                                }
                                        ],
                                        "edges": [
                                                {
                                                        "from": "image",
                                                        "to": "input",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "input",
                                                        "to": "dense_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_1",
                                                        "to": "bn_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "bn_1",
                                                        "to": "dropout_1",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dropout_1",
                                                        "to": "dense_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dense_2",
                                                        "to": "dropout_2",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                },
                                                {
                                                        "from": "dropout_2",
                                                        "to": "output",
                                                        "out": "output_1",
                                                        "in": "input_1"
                                                }
                                        ]
                                }
                        }
                },
                {
                        "id": "fashion_mnist_cnn_lenet",
                        "label": "Fashion-MNIST: CNN (LeNet-5)",
                        "metadata": { "graphSpec": { "nodes": [
                                { "key": "image", "type": "image_source", "x": 60, "y": 80, "config": { "sourceKey": "pixel_values" } },
                                { "key": "reshape", "type": "reshape", "x": 200, "y": 80, "config": { "targetShape": "28,28,1" } },
                                { "key": "conv1", "type": "conv2d", "x": 340, "y": 80, "config": { "filters": 32, "kernelSize": 3, "strides": 1, "padding": "same", "activation": "relu" } },
                                { "key": "pool1", "type": "maxpool2d", "x": 480, "y": 80, "config": { "poolSize": 2, "strides": 2 } },
                                { "key": "conv2", "type": "conv2d", "x": 620, "y": 80, "config": { "filters": 64, "kernelSize": 3, "strides": 1, "padding": "same", "activation": "relu" } },
                                { "key": "pool2", "type": "maxpool2d", "x": 760, "y": 80, "config": { "poolSize": 2, "strides": 2 } },
                                { "key": "flat", "type": "flatten", "x": 900, "y": 80, "config": {} },
                                { "key": "dense1", "type": "dense", "x": 1040, "y": 80, "config": { "units": 128, "activation": "relu" } },
                                { "key": "drop1", "type": "dropout", "x": 1180, "y": 80, "config": { "rate": 0.25 } },
                                { "key": "output", "type": "output", "x": 1320, "y": 80, "config": { "target": "label", "targetType": "label", "loss": "categoricalCrossentropy", "headType": "classification" } }
                        ], "edges": [
                                { "from": "image", "to": "reshape", "out": "output_1", "in": "input_1" },
                                { "from": "reshape", "to": "conv1", "out": "output_1", "in": "input_1" },
                                { "from": "conv1", "to": "pool1", "out": "output_1", "in": "input_1" },
                                { "from": "pool1", "to": "conv2", "out": "output_1", "in": "input_1" },
                                { "from": "conv2", "to": "pool2", "out": "output_1", "in": "input_1" },
                                { "from": "pool2", "to": "flat", "out": "output_1", "in": "input_1" },
                                { "from": "flat", "to": "dense1", "out": "output_1", "in": "input_1" },
                                { "from": "dense1", "to": "drop1", "out": "output_1", "in": "input_1" },
                                { "from": "drop1", "to": "output", "out": "output_1", "in": "input_1" }
                        ] } }
                },
                {
                        "id": "fashion_mnist_conv_ae",
                        "label": "Fashion-MNIST: Conv Autoencoder",
                        "metadata": { "graphSpec": { "nodes": [
                                { "key": "image", "type": "image_source", "x": 60, "y": 80, "config": { "sourceKey": "pixel_values" } },
                                { "key": "reshape", "type": "reshape", "x": 180, "y": 80, "config": { "targetShape": "28,28,1" } },
                                { "key": "enc1", "type": "conv2d", "x": 300, "y": 80, "config": { "filters": 32, "kernelSize": 3, "strides": 2, "padding": "same", "activation": "relu" } },
                                { "key": "enc2", "type": "conv2d", "x": 420, "y": 80, "config": { "filters": 64, "kernelSize": 3, "strides": 2, "padding": "same", "activation": "relu" } },
                                { "key": "flat", "type": "flatten", "x": 540, "y": 80, "config": {} },
                                { "key": "latent", "type": "dense", "x": 660, "y": 80, "config": { "units": 32, "activation": "relu" } },
                                { "key": "dec_dense", "type": "dense", "x": 780, "y": 80, "config": { "units": 3136, "activation": "relu" } },
                                { "key": "dec_reshape", "type": "reshape", "x": 900, "y": 80, "config": { "targetShape": "7,7,64" } },
                                { "key": "dec1", "type": "conv2d_transpose", "x": 1020, "y": 80, "config": { "filters": 32, "kernelSize": 3, "strides": 2, "padding": "same", "activation": "relu" } },
                                { "key": "dec2", "type": "conv2d_transpose", "x": 1140, "y": 80, "config": { "filters": 1, "kernelSize": 3, "strides": 2, "padding": "same", "activation": "sigmoid" } },
                                { "key": "out_flat", "type": "flatten", "x": 1260, "y": 80, "config": {} },
                                { "key": "output", "type": "output", "x": 1380, "y": 80, "config": { "target": "pixel_values", "targetType": "pixel_values", "loss": "mse", "headType": "reconstruction" } }
                        ], "edges": [
                                { "from": "image", "to": "reshape", "out": "output_1", "in": "input_1" },
                                { "from": "reshape", "to": "enc1", "out": "output_1", "in": "input_1" },
                                { "from": "enc1", "to": "enc2", "out": "output_1", "in": "input_1" },
                                { "from": "enc2", "to": "flat", "out": "output_1", "in": "input_1" },
                                { "from": "flat", "to": "latent", "out": "output_1", "in": "input_1" },
                                { "from": "latent", "to": "dec_dense", "out": "output_1", "in": "input_1" },
                                { "from": "dec_dense", "to": "dec_reshape", "out": "output_1", "in": "input_1" },
                                { "from": "dec_reshape", "to": "dec1", "out": "output_1", "in": "input_1" },
                                { "from": "dec1", "to": "dec2", "out": "output_1", "in": "input_1" },
                                { "from": "dec2", "to": "out_flat", "out": "output_1", "in": "input_1" },
                                { "from": "out_flat", "to": "output", "out": "output_1", "in": "input_1" }
                        ] } }
                }
        ],

      metadata: {
        featureNodes: {
          imageSource: [
            { key: "pixel_values", label: "pixel values (28x28)", featureSize: 784, shape: [28, 28, 1] }
          ],
          oneHot: [
            { key: "label", label: "label", values: ["T-shirt/top", "Trouser", "Pullover", "Dress", "Coat", "Sandal", "Shirt", "Sneaker", "Bag", "Ankle boot"] }
          ],
          policy: {
            allowHistory: false,
            allowWindowHistory: false,
            allowParams: false,
            allowOneHot: true,
            allowImageSource: true
          },
          palette: {
            items: _imagePaletteItems()
          }
        }
      },
    },
    preconfig: {
      dataset: {
        defaultModuleId: "fashion_mnist",
        splitDefaults: {
          mode: "stratified_label",
          train: 0.80,
          val: 0.10,
          test: 0.10,
        },
      },
      model: {
        defaultPreset: "fashion_mnist_mlp_baseline",
      },
    }
  });
  // ===== CIFAR-10 =====
  registerSchema({
    id: "cifar10",
    label: "cifar10",
    description: "CIFAR-10 image dataset schema — 32x32 RGB, 10 classes",
    dataset: {
      id: "cifar10",
      label: "CIFAR-10 images",
      sampleType: "image",
      splitUnit: "sample",
      splitDefaults: { mode: "stratified_label", train: 0.80, val: 0.10, test: 0.10 },
      metadata: {
        ui: { sidebarMode: "generic", viewer: "image" },
        splitModes: [
          { id: "original", label: "Original (source train/test)", stratifyKey: "" },
          { id: "random", label: "Random (global)", stratifyKey: "" },
          { id: "stratified_label", label: "Stratified by label", stratifyKey: "label" }
        ],
        display: { chartType: "label_histogram", tableColumns: ["split", "index", "label", "class_name", "pixel_values"] }
      }
    },
    model: {
      outputs: [
        { key: "label", label: "class label (0-9)", headType: "classification" },
        { key: "logits", label: "class logits", headType: "classification" }
      ],
      params: [],
      presets: [
        {
          id: "cifar10_mlp_baseline",
          label: "CIFAR-10: MLP Baseline",
          metadata: {
            graphSpec: {
              nodes: [
                { key: "image", type: "image_source", x: 140, y: 60, config: { sourceKey: "pixel_values" } },
                { key: "input", type: "input", x: 420, y: 120, config: { mode: "flat" } },
                { key: "dense_1", type: "dense", x: 620, y: 120, config: { units: 512, activation: "relu" } },
                { key: "dropout_1", type: "dropout", x: 800, y: 120, config: { rate: 0.3 } },
                { key: "dense_2", type: "dense", x: 980, y: 120, config: { units: 256, activation: "relu" } },
                { key: "dropout_2", type: "dropout", x: 1160, y: 120, config: { rate: 0.2 } },
                { key: "output", type: "output", x: 1340, y: 120, config: { target: "label", targetType: "label", loss: "cross_entropy", units: 10, unitsHint: 10, matchWeight: 1 } }
              ],
              edges: [
                { from: "image", to: "input", out: "output_1", in: "input_1" },
                { from: "input", to: "dense_1", out: "output_1", in: "input_1" },
                { from: "dense_1", to: "dropout_1", out: "output_1", in: "input_1" },
                { from: "dropout_1", to: "dense_2", out: "output_1", in: "input_1" },
                { from: "dense_2", to: "dropout_2", out: "output_1", in: "input_1" },
                { from: "dropout_2", to: "output", out: "output_1", in: "input_1" }
              ]
            }
          }
        }
      ],
      metadata: {
        featureNodes: {
          imageSource: [
            { key: "pixel_values", label: "pixel values (32x32x3)", featureSize: 3072, shape: [32, 32, 3] }
          ],
          oneHot: [
            { key: "label", label: "label", values: ["airplane", "automobile", "bird", "cat", "deer", "dog", "frog", "horse", "ship", "truck"] }
          ],
          policy: { allowHistory: false, allowWindowHistory: false, allowParams: false, allowOneHot: true, allowImageSource: true },
          palette: { items: _imagePaletteItems() }
        }
      },
    },
    preconfig: {
      dataset: { defaultModuleId: "cifar10", splitDefaults: { mode: "stratified_label", train: 0.80, val: 0.10, test: 0.10 } },
      model: { defaultPreset: "cifar10_mlp_baseline" },
    }
  });

  var exports = {
    registeredSchemaIds: schemaRegistry.listSchemas().map(function (x) { return String(x.id || ""); }),
    trajectoryPaletteItems: _trajectoryPaletteItems,
    imagePaletteItems: _imagePaletteItems,
  };
  // make palette builders accessible globally for demo schemas
  var W = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {});
  if (W) W.OSCSchemaBuiltinPalettes = { trajectory: _trajectoryPaletteItems, image: _imagePaletteItems };
  return exports;
});

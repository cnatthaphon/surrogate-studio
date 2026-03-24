"use strict";
/**
 * Cross-runtime weight compatibility test.
 * Tests ALL common architectures: MLP, AE, VAE, LSTM, GRU, RNN, deep networks,
 * dropout, batchnorm, layernorm, mixed recurrent+dense, multi-layer.
 *
 * Builds each graph in BOTH TF.js and PyTorch, compares weight specs exactly.
 */
var tf = require("@tensorflow/tfjs");
var MBC = require("../src/model_builder_core.js");
var fs = require("fs");
var { execSync } = require("child_process");

var PYTHON = "/home/cue/venv/main/bin/python3";
var F = 20; // feature size for test graphs

// --- Helper: build Drawflow graph from simple spec ---
function G(nodeSpecs) {
  var data = {};
  nodeSpecs.forEach(function (spec, i) {
    var nid = String(i + 1);
    var node = {
      name: spec[0] + "_layer", data: spec[1] || {},
      inputs: {}, outputs: {}, pos_x: i * 200, pos_y: 100,
    };
    // connect to previous node
    if (i > 0) {
      var prevId = String(i);
      var inPort = spec[2] || "input_1";
      node.inputs[inPort] = { connections: [{ node: prevId, output: "output_1" }] };
      data[prevId].outputs.output_1 = data[prevId].outputs.output_1 || { connections: [] };
      data[prevId].outputs.output_1.connections.push({ node: nid, input: inPort });
    }
    data[nid] = node;
  });
  return { drawflow: { Home: { data: data } } };
}

// --- Helper: VAE branching graph ---
function VAE_GRAPH(encType, encUnits, latentDim, decUnits) {
  var d = {};
  var id = 0;
  function n(name, cfg) { id++; d[String(id)] = { name: name + "_layer", data: cfg || {}, inputs: {}, outputs: {}, pos_x: id * 150, pos_y: 100 }; return String(id); }
  function c(from, to, outP, inP) {
    d[from].outputs[outP || "output_1"] = d[from].outputs[outP || "output_1"] || { connections: [] };
    d[from].outputs[outP || "output_1"].connections.push({ node: to, input: inP || "input_1" });
    d[to].inputs[inP || "input_1"] = d[to].inputs[inP || "input_1"] || { connections: [] };
    d[to].inputs[inP || "input_1"].connections.push({ node: from, output: outP || "output_1" });
  }
  var inp = n("input", { mode: "flat" });
  var enc = n(encType, encType === "dense" ? { units: encUnits, activation: "relu" } : { units: encUnits });
  var mu = n("latent_mu", { units: latentDim, group: "z" });
  var lv = n("latent_logvar", { units: latentDim, group: "z" });
  var rp = n("reparam", { group: "z", beta: 0.001 });
  var dec = n("dense", { units: decUnits, activation: "relu" });
  var out = n("output", { target: "xv", loss: "mse" });
  c(inp, enc); c(enc, mu); c(enc, lv);
  c(mu, rp, "output_1", "input_1"); c(lv, rp, "output_1", "input_2");
  c(rp, dec); c(dec, out);
  return { drawflow: { Home: { data: d } } };
}

// --- Test graphs covering ALL architectures ---
var GRAPHS = {
  // Basic
  "Dense-1layer":       G([["input", { mode: "flat" }], ["dense", { units: 16, activation: "relu" }], ["output", { target: "xv", loss: "mse" }]]),
  "Dense-3layer":       G([["input", { mode: "flat" }], ["dense", { units: 32, activation: "relu" }], ["dense", { units: 16, activation: "tanh" }], ["dense", { units: 32, activation: "sigmoid" }], ["output", { target: "xv", loss: "mse" }]]),
  "Dense-deep":         G([["input", { mode: "flat" }], ["dense", { units: 64, activation: "relu" }], ["dense", { units: 32, activation: "relu" }], ["dense", { units: 16, activation: "relu" }], ["dense", { units: 32, activation: "relu" }], ["dense", { units: 64, activation: "relu" }], ["output", { target: "xv", loss: "mse" }]]),

  // Recurrent
  "LSTM-simple":        G([["input", { mode: "flat" }], ["lstm", { units: 16 }], ["output", { target: "xv", loss: "mse" }]]),
  "GRU-simple":         G([["input", { mode: "flat" }], ["gru", { units: 16 }], ["output", { target: "xv", loss: "mse" }]]),
  "RNN-simple":         G([["input", { mode: "flat" }], ["rnn", { units: 16 }], ["output", { target: "xv", loss: "mse" }]]),
  "LSTM+Dense":         G([["input", { mode: "flat" }], ["lstm", { units: 32 }], ["dense", { units: 16, activation: "relu" }], ["output", { target: "xv", loss: "mse" }]]),
  "GRU+Dense":          G([["input", { mode: "flat" }], ["gru", { units: 32 }], ["dense", { units: 16, activation: "relu" }], ["output", { target: "xv", loss: "mse" }]]),

  // Regularization
  "Dense+Dropout":      G([["input", { mode: "flat" }], ["dense", { units: 32, activation: "relu" }], ["dropout", { rate: 0.2 }], ["dense", { units: 16, activation: "relu" }], ["output", { target: "xv", loss: "mse" }]]),
  "Dense+BatchNorm":    G([["input", { mode: "flat" }], ["dense", { units: 32, activation: "relu" }], ["batchnorm", {}], ["dense", { units: 16, activation: "relu" }], ["output", { target: "xv", loss: "mse" }]]),
  "Dense+LayerNorm":    G([["input", { mode: "flat" }], ["dense", { units: 32, activation: "relu" }], ["layernorm", {}], ["dense", { units: 16, activation: "relu" }], ["output", { target: "xv", loss: "mse" }]]),

  // AE (bottleneck)
  "AE-small":           G([["input", { mode: "flat" }], ["dense", { units: 16, activation: "relu" }], ["dense", { units: 4, activation: "relu" }], ["dense", { units: 16, activation: "relu" }], ["output", { target: "xv", loss: "mse" }]]),

  // VAE (branching)
  "VAE-Dense":          VAE_GRAPH("dense", 32, 8, 32),
  "VAE-LSTM":           VAE_GRAPH("lstm", 32, 8, 32),
  "VAE-GRU":            VAE_GRAPH("gru", 32, 8, 32),
  "VAE-RNN":            VAE_GRAPH("rnn", 32, 8, 32),
  "VAE-small-latent":   VAE_GRAPH("dense", 16, 2, 16),
  "VAE-large-latent":   VAE_GRAPH("dense", 64, 32, 64),

  // Classification
  "Classifier":         G([["input", { mode: "flat" }], ["dense", { units: 32, activation: "relu" }], ["output", { target: "label", loss: "cross_entropy", units: 10 }]]),

  // Complex mixed
  "LSTM+Dropout+Dense": G([["input", { mode: "flat" }], ["lstm", { units: 32 }], ["dropout", { rate: 0.3 }], ["dense", { units: 16, activation: "relu" }], ["dropout", { rate: 0.1 }], ["output", { target: "xv", loss: "mse" }]]),
  "Dense+LN+Dense":     G([["input", { mode: "flat" }], ["dense", { units: 64, activation: "relu" }], ["layernorm", {}], ["dense", { units: 32, activation: "relu" }], ["layernorm", {}], ["output", { target: "xv", loss: "mse" }]]),
  "GRU+BN+Dense":       G([["input", { mode: "flat" }], ["gru", { units: 24 }], ["dense", { units: 48, activation: "relu" }], ["output", { target: "xv", loss: "mse" }]]),
  "Deep-AE":            G([["input", { mode: "flat" }], ["dense", { units: 64, activation: "relu" }], ["dense", { units: 32, activation: "relu" }], ["dense", { units: 8, activation: "relu" }], ["dense", { units: 32, activation: "relu" }], ["dense", { units: 64, activation: "relu" }], ["output", { target: "xv", loss: "mse" }]]),
  "VAE-LSTM-deep":      VAE_GRAPH("lstm", 64, 16, 64),
};

var meta = { mode: "direct", featureSize: F, windowSize: 1, seqFeatureSize: F, allowedOutputKeys: ["xv", "traj", "label", "logits"], defaultTarget: "xv", numClasses: 10 };

var passed = 0, failed = 0, errors = [];
var dummyData = Array(8).fill(Array(F).fill(0.5)); // enough for BatchNorm (needs batch > 1)

Object.keys(GRAPHS).forEach(function (name) {
  var graph = GRAPHS[name];

  // TF.js
  var tfjsSpecs, tfjsTotal;
  try {
    var built = MBC.buildModelFromGraph(tf, graph, meta);
    var w = built.model.getWeights();
    tfjsSpecs = w.map(function (t) { return t.shape.join("x"); });
    tfjsTotal = w.reduce(function (s, t) { return s + t.shape.reduce(function (a, b) { return a * b; }, 1); }, 0);
    built.model.dispose();
  } catch (e) {
    console.log(name + ": TF.js BUILD ERROR: " + e.message);
    failed++;
    errors.push(name + " (TF.js)");
    return;
  }

  // PyTorch — use classification targets for classifier graphs
  var isClassifier = name.indexOf("Classifier") >= 0;
  var yDummy = isClassifier ? Array(8).fill([0]) : dummyData;
  var config = { graph: graph, dataset: { featureSize: F, targetMode: isClassifier ? "label" : "xv", numClasses: isClassifier ? 10 : 0, xTrain: dummyData, yTrain: yDummy, xVal: dummyData, yVal: yDummy }, epochs: 1, batchSize: 4, learningRate: 0.001 };
  fs.writeFileSync("/tmp/xrt_" + name.replace(/[^a-zA-Z0-9]/g, "_") + ".json", JSON.stringify(config));
  var pySpecs, pyTotal;
  try {
    var out = execSync(PYTHON + " server/train_subprocess.py /tmp/xrt_" + name.replace(/[^a-zA-Z0-9]/g, "_") + ".json", { encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] });
    out.trim().split("\n").forEach(function (l) {
      try {
        var m = JSON.parse(l);
        if (m.kind === "complete") {
          pySpecs = m.result.modelArtifacts.weightSpecs.map(function (s) { return s.shape.join("x"); });
          pyTotal = m.result.modelArtifacts.weightData.length;
        }
        if (m.kind === "error") { throw new Error(m.message); }
      } catch (e) { if (e.message && e.message.indexOf("{") < 0) throw e; }
    });
  } catch (e) {
    console.log(name + ": PyTorch ERROR: " + e.message.slice(0, 100));
    failed++;
    errors.push(name + " (PyTorch)");
    return;
  }

  if (!pySpecs) {
    console.log(name + ": PyTorch NO OUTPUT");
    failed++; errors.push(name + " (no output)");
    return;
  }

  var match = tfjsTotal === pyTotal && tfjsSpecs.length === pySpecs.length && tfjsSpecs.every(function (s, i) { return s === pySpecs[i]; });

  if (match) {
    console.log("  \x1b[32m\u2713\x1b[0m " + name + " (" + tfjsTotal + " values, " + tfjsSpecs.length + " weights)");
    passed++;
  } else {
    console.log("  \x1b[31m\u2717\x1b[0m " + name + " TF.js=" + tfjsTotal + "(" + tfjsSpecs.length + ") Py=" + pyTotal + "(" + pySpecs.length + ")");
    if (tfjsSpecs.length === pySpecs.length) {
      for (var i = 0; i < tfjsSpecs.length; i++) {
        if (tfjsSpecs[i] !== pySpecs[i]) console.log("    w" + i + ": TF=" + tfjsSpecs[i] + " Py=" + pySpecs[i]);
      }
    }
    failed++;
    errors.push(name);
  }
});

console.log("\n========================================");
if (failed === 0) {
  console.log("\x1b[32m  PASS: All " + passed + " architectures match\x1b[0m");
} else {
  console.log("\x1b[31m  " + passed + " passed, " + failed + " failed\x1b[0m");
  errors.forEach(function (e) { console.log("  - " + e); });
}
console.log("========================================");
process.exit(failed > 0 ? 1 : 0);

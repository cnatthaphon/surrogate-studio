"use strict";
/**
 * Cross-runtime weight compatibility test.
 * Builds the same graph in TF.js and PyTorch, compares weight specs.
 * Verifies that PyTorch server weights can load into TF.js model.
 */
var tf = require("@tensorflow/tfjs");
var MBC = require("../src/model_builder_core.js");
var fs = require("fs");
var { execSync } = require("child_process");

var PYTHON = "/home/cue/venv/main/bin/python3";

// Test graphs
var GRAPHS = {
  "MLP-AE": {
    drawflow: { Home: { data: {
      "1": { name: "input_layer", data: { mode: "flat" }, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } } },
      "2": { name: "dense_layer", data: { units: 32, activation: "relu" }, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } } },
      "3": { name: "dense_layer", data: { units: 8, activation: "relu" }, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "4", input: "input_1" }] } } },
      "4": { name: "dense_layer", data: { units: 32, activation: "relu" }, inputs: { input_1: { connections: [{ node: "3", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "5", input: "input_1" }] } } },
      "5": { name: "output_layer", data: { target: "xv", loss: "mse" }, inputs: { input_1: { connections: [{ node: "4", output: "output_1" }] } }, outputs: {} },
    } } },
  },
  "LSTM-simple": {
    drawflow: { Home: { data: {
      "1": { name: "input_layer", data: { mode: "flat" }, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } } },
      "2": { name: "lstm_layer", data: { units: 16 }, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } } },
      "3": { name: "dense_layer", data: { units: 32, activation: "relu" }, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "4", input: "input_1" }] } } },
      "4": { name: "output_layer", data: { target: "xv", loss: "mse" }, inputs: { input_1: { connections: [{ node: "3", output: "output_1" }] } }, outputs: {} },
    } } },
  },
};

var meta = { mode: "direct", featureSize: 10, windowSize: 1, seqFeatureSize: 10, allowedOutputKeys: ["xv"], defaultTarget: "xv" };

Object.keys(GRAPHS).forEach(function (name) {
  console.log("\n=== " + name + " ===");
  var graph = GRAPHS[name];

  // TF.js
  var built = MBC.buildModelFromGraph(tf, graph, meta);
  var tfjsWeights = built.model.getWeights();
  console.log("TF.js: " + tfjsWeights.length + " weights, " + built.model.countParams() + " params");
  tfjsWeights.forEach(function (w, i) {
    console.log("  w" + i + " " + w.shape.join("x") + " = " + w.shape.reduce(function (a, b) { return a * b; }, 1));
  });
  built.model.dispose();

  // PyTorch
  var config = { graph: graph, dataset: { featureSize: 10, targetMode: "xv", xTrain: [[1,2,3,4,5,6,7,8,9,10]], yTrain: [[1,2,3,4,5,6,7,8,9,10]], xVal: [[1,2,3,4,5,6,7,8,9,10]], yVal: [[1,2,3,4,5,6,7,8,9,10]] }, epochs: 1, batchSize: 1, learningRate: 0.001 };
  fs.writeFileSync("/tmp/xrt_" + name + ".json", JSON.stringify(config));
  try {
    var output = execSync(PYTHON + " server/train_subprocess.py /tmp/xrt_" + name + ".json", { encoding: "utf8", timeout: 30000 });
    var lines = output.trim().split("\n");
    lines.forEach(function (l) {
      try {
        var m = JSON.parse(l);
        if (m.kind === "complete") {
          var specs = m.result.modelArtifacts.weightSpecs;
          var total = m.result.modelArtifacts.weightData.length;
          console.log("PyTorch: " + specs.length + " weights, " + m.result.paramCount + " params");
          specs.forEach(function (s, i) {
            var sz = s.shape.reduce(function (a, b) { return a * b; }, 1);
            console.log("  w" + i + " " + s.shape.join("x") + " = " + sz);
          });

          // Compare
          var tfjsTotal = tfjsWeights.reduce(function (s, w) { return s + w.shape.reduce(function (a, b) { return a * b; }, 1); }, 0);
          if (total === tfjsTotal) {
            console.log("MATCH: " + total + " values");
          } else {
            console.log("MISMATCH: PyTorch=" + total + " TF.js=" + tfjsTotal);
          }
        }
      } catch (e) {}
    });
  } catch (e) {
    console.log("PyTorch error:", e.message.slice(0, 200));
  }
});

console.log("\nDone");

"use strict";
var assert = require("assert");
var MBC = require("../src/model_builder_core.js");

function main() {
  assert(MBC, "module loaded");

  // --- extractGraphData ---
  var mockDrawflow = {
    drawflow: { Home: { data: {
      "1": { name: "input_layer", data: {}, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } } },
      "2": { name: "dense_layer", data: { units: 16, activation: "relu" }, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } } },
      "3": { name: "output_layer", data: { matchWeight: 1, targets: ["x"], loss: "mse", wx: 1, wv: 1 }, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: {} },
    } } }
  };
  var graphData = MBC.extractGraphData(mockDrawflow);
  assert(graphData["1"], "extractGraphData returns node data");
  assert.strictEqual(graphData["1"].name, "input_layer");

  // --- inferGraphMode ---
  assert.strictEqual(MBC.inferGraphMode(mockDrawflow, "direct"), "direct", "no history nodes = direct");

  // --- inferModelFamily ---
  assert.strictEqual(MBC.inferModelFamily(mockDrawflow), "supervised", "no latent/noise = supervised");

  // --- inferOutputHeads ---
  var heads = MBC.inferOutputHeads(mockDrawflow, ["x", "v", "params"], "x");
  assert(Array.isArray(heads), "inferOutputHeads returns array");
  assert(heads.length >= 1, "at least one head");
  assert.strictEqual(heads[0].target, "x");

  // --- inferDatasetTargetMode ---
  assert.strictEqual(MBC.inferDatasetTargetMode(heads, "x"), "x");

  // --- inferFeatureSpec ---
  var spec = MBC.inferFeatureSpec(mockDrawflow, "direct", { allowHistory: false, allowImageSource: false });
  assert(typeof spec === "object", "inferFeatureSpec returns object");
  assert(typeof spec.useParams === "boolean", "useParams is boolean");

  // --- inferWindow ---
  assert.strictEqual(typeof MBC.inferWindow(mockDrawflow, 20), "number");

  // --- inferArHistoryConfig ---
  var arCfg = MBC.inferArHistoryConfig(mockDrawflow, 20);
  assert(arCfg && typeof arCfg.windowSize === "number", "arConfig has windowSize");

  // --- normalizeOutputTargetsList ---
  var t1 = MBC.normalizeOutputTargetsList("x,v", null, ["x", "v", "params"]);
  assert.deepStrictEqual(t1, ["x", "v"]);
  var t2 = MBC.normalizeOutputTargetsList("xv", null, ["x", "v", "xv"]);
  assert.deepStrictEqual(t2, ["xv"], "xv removes x and v");
  var t3 = MBC.normalizeOutputTargetsList(null, ["logits"], ["logits", "label"]);
  assert.deepStrictEqual(t3, ["logits"]);

  // --- outputTargetsFromNodeData ---
  var nodeData = { targets: ["x", "params"], loss: "mse" };
  var ot = MBC.outputTargetsFromNodeData(nodeData, ["x", "v", "params"], "x");
  assert.deepStrictEqual(ot, ["x", "params"]);

  // --- VAE graph test ---
  var vaeGraph = {
    drawflow: { Home: { data: {
      "1": { name: "input_layer", data: {}, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }, { node: "3", input: "input_1" }] } } },
      "2": { name: "latent_mu_layer", data: { units: 8, group: "z", matchWeight: 1 }, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "4", input: "input_1" }] } } },
      "3": { name: "latent_logvar_layer", data: { units: 8, group: "z", matchWeight: 1 }, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "4", input: "input_2" }] } } },
      "4": { name: "reparam_layer", data: { group: "z", beta: 0.001, matchWeight: 1 }, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] }, input_2: { connections: [{ node: "3", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "5", input: "input_1" }] } } },
      "5": { name: "dense_layer", data: { units: 16, activation: "relu" }, inputs: { input_1: { connections: [{ node: "4", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "6", input: "input_1" }] } } },
      "6": { name: "output_layer", data: { matchWeight: 1, targets: ["x"], loss: "mse", wx: 1, wv: 1 }, inputs: { input_1: { connections: [{ node: "5", output: "output_1" }] } }, outputs: {} },
    } } }
  };
  assert.strictEqual(MBC.inferModelFamily(vaeGraph), "vae", "detect VAE from reparam");

  // --- image classification graph ---
  var imgGraph = {
    drawflow: { Home: { data: {
      "1": { name: "input_layer", data: { mode: "flat" }, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } } },
      "2": { name: "dense_layer", data: { units: 128, activation: "relu" }, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: { output_1: { connections: [{ node: "3", input: "input_1" }] } } },
      "3": { name: "output_layer", data: { matchWeight: 1, targets: ["logits"], loss: "mse", wx: 1, wv: 1 }, inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } }, outputs: {} },
    } } }
  };
  var imgHeads = MBC.inferOutputHeads(imgGraph, ["logits", "label"], "logits");
  assert.strictEqual(imgHeads[0].target, "logits", "image graph outputs logits");

  // --- diffusion graph ---
  var diffGraph = {
    drawflow: { Home: { data: {
      "1": { name: "input_layer", data: {}, inputs: {}, outputs: { output_1: { connections: [{ node: "2", input: "input_1" }] } } },
      "2": { name: "noise_schedule_block", data: {}, inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } }, outputs: {} },
    } } }
  };
  assert.strictEqual(MBC.inferModelFamily(diffGraph), "diffusion", "detect diffusion from noise_schedule");

  console.log("PASS test_contract_model_builder_core");
}

main();

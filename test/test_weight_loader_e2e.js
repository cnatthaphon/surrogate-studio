/**
 * Regression test for named artifact loading.
 *
 * Verifies that:
 * 1. Server-style named artifacts load by canonical name, not position.
 * 2. BatchNorm running stats land on the correct tensors even if artifact order is scrambled.
 * 3. Unmatched non-exported weights (for example constant/phase-switch helpers) remain unchanged.
 */

global.window = global;
var fs = require("fs");
var tf = require("@tensorflow/tfjs");
var mb = require("../src/model_builder_core.js");
var wc = require("../src/weight_converter.js");

eval(fs.readFileSync("./demo/Fashion-MNIST-GAN/preset.js", "utf8"));

var PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("  ✓ " + msg); }
  else { FAIL++; console.log("  ✗ FAIL: " + msg); }
}

function stripSuffix(name) {
  return String(name || "").replace(/_\d+$/, "");
}

function tensorHead(t, n) {
  return Array.from(t.dataSync().slice(0, n || 16));
}

function diffHead(a, b) {
  var d = 0;
  for (var i = 0; i < Math.min(a.length, b.length); i++) d += Math.abs(Number(a[i] || 0) - Number(b[i] || 0));
  return d;
}

function snapshotHeads(model, n) {
  var tensors = model.getWeights();
  var out = {};
  model.weights.forEach(function (mw, i) {
    out[stripSuffix(mw.name)] = tensorHead(tensors[i], n);
  });
  return out;
}

function toServerSpec(layer, modelWeightName, shape) {
  var base = stripSuffix(modelWeightName);
  var m = base.match(/^n(\d+)\/(.+)$/);
  if (!m || !layer) return null;
  var id = m[1];
  var slot = m[2];
  var cls = typeof layer.getClassName === "function" ? layer.getClassName() : "";

  if (cls === "Dense" && (slot === "kernel" || slot === "bias")) {
    return { name: "tfjs_dense_" + id + "." + (slot === "kernel" ? "weight" : "bias"), shape: shape.slice() };
  }
  if (cls === "Conv2D" && (slot === "kernel" || slot === "bias")) {
    return { name: "tfjs_conv2d_" + id + "." + (slot === "kernel" ? "weight" : "bias"), shape: shape.slice() };
  }
  if (cls === "Conv2DTranspose" && (slot === "kernel" || slot === "bias")) {
    return { name: "tfjs_convt2d_" + id + "." + (slot === "kernel" ? "weight" : "bias"), shape: shape.slice() };
  }
  if (cls === "BatchNormalization") {
    var bnMap = {
      gamma: "weight",
      beta: "bias",
      moving_mean: "running_mean",
      moving_variance: "running_var",
    };
    if (bnMap[slot]) return { name: "tfjs_bn_" + id + "." + bnMap[slot], shape: shape.slice() };
  }
  if (cls === "LayerNormalization") {
    var lnMap = {
      gamma: "weight",
      beta: "bias",
      moving_mean: "running_mean",
      moving_variance: "running_var",
    };
    if (lnMap[slot]) return { name: "tfjs_ln_" + id + "." + lnMap[slot], shape: shape.slice() };
  }
  return null;
}

function makeArtifacts(model) {
  var layerMap = {};
  var tensors = model.getWeights();
  var rows = [];
  model.layers.forEach(function (layer) { layerMap[layer.name] = layer; });

  model.weights.forEach(function (mw, i) {
    var base = stripSuffix(mw.name);
    var layerName = base.split("/")[0];
    var layer = layerMap[layerName];
    if (!layer || !layer._weightTag) return;
    var spec = toServerSpec(layer, base, mw.shape);
    if (!spec) return;
    rows.push({
      modelName: base,
      spec: spec,
      values: Array.from(tensors[i].dataSync()),
    });
  });

  rows.sort(function (a, b) {
    if (a.spec.name < b.spec.name) return 1;
    if (a.spec.name > b.spec.name) return -1;
    return 0;
  });

  var specs = [];
  var values = [];
  rows.forEach(function (row) {
    specs.push({ name: row.spec.name, shape: row.spec.shape });
    for (var vi = 0; vi < row.values.length; vi++) values.push(row.values[vi]);
  });

  return {
    weightSpecs: specs,
    weightValues: values,
    includedNames: rows.map(function (row) { return row.modelName; }),
  };
}

var graph = window.FASHION_MNIST_GAN_PRESET.models[1].graph; // DCGAN
var buildOpts = {
  mode: "direct",
  featureSize: 784,
  windowSize: 1,
  seqFeatureSize: 784,
  allowedOutputKeys: [{ key: "pixel_values", headType: "reconstruction" }],
  defaultTarget: "pixel_values",
  numClasses: 10,
};

var source = mb.buildModelFromGraph(tf, graph, buildOpts);
var target = mb.buildModelFromGraph(tf, graph, buildOpts);

var sourceHeads = snapshotHeads(source.model, 16);
var targetBefore = snapshotHeads(target.model, 16);
var artifacts = makeArtifacts(source.model);

console.log("=== 1. Artifact Coverage ===");
assert(artifacts.weightSpecs.length > 0, "Created named artifacts for tagged DCGAN blocks");
assert(artifacts.includedNames.some(function (n) { return /moving_mean|moving_variance/.test(n); }), "Artifacts include BatchNorm running stats");
assert(Object.keys(targetBefore).some(function (n) { return artifacts.includedNames.indexOf(n) < 0; }), "Model also has unmatched helper weights");

console.log("\n=== 2. Named Load ===");
var result = wc.loadArtifactsIntoModel(tf, target.model, artifacts);
assert(!!result && !!result.loaded, "Named loader succeeded");
assert(result && result.mode === "name", "Loader used canonical name matching");

var targetAfter = snapshotHeads(target.model, 16);
var included = {};
artifacts.includedNames.forEach(function (name) { included[name] = true; });

var matchedCount = 0;
Object.keys(included).forEach(function (name) {
  matchedCount++;
  var d = diffHead(sourceHeads[name], targetAfter[name]);
  assert(d < 1e-8, "Loaded weight matches source for " + name + " (d=" + d + ")");
});
assert(matchedCount === artifacts.includedNames.length, "All included named weights were checked");

console.log("\n=== 3. Unmatched Weights Preserved ===");
Object.keys(targetBefore).forEach(function (name) {
  if (included[name]) return;
  var d = diffHead(targetBefore[name], targetAfter[name]);
  assert(d < 1e-8, "Unmatched weight preserved for " + name + " (d=" + d + ")");
});

console.log("\n=== RESULTS ===");
console.log("PASS: " + PASS + " / FAIL: " + FAIL);
source.model.dispose();
target.model.dispose();
if (FAIL > 0) process.exit(1);

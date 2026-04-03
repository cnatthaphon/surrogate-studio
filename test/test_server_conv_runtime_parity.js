/**
 * Cross-runtime conv parity regression test.
 *
 * Verifies that TF.js and the server PyTorch reload path produce the same
 * outputs for:
 * 1. Conv2D -> Flatten
 * 2. Conv2DTranspose -> Flatten
 *
 * This specifically guards NHWC/NCHW reshape/flatten semantics and
 * ConvTranspose2D "same" output cropping on the server path.
 */

var fs = require("fs");
var path = require("path");
var child = require("child_process");
var loader = require("../src/tfjs_node_loader.js");
var tf = loader.loadTfjs();
var MBC = require("../src/model_builder_core.js");

var PYTHON = process.env.SURROGATE_STUDIO_PYTHON || "/home/cue/venv/main/bin/python3";
var REPO_ROOT = path.resolve(__dirname, "..");
var PREDICT = path.join(REPO_ROOT, "server", "predict_subprocess.py");

if (!fs.existsSync(PYTHON)) {
  console.log("SKIP test_server_conv_runtime_parity (python env missing: " + PYTHON + ")");
  process.exit(0);
}

var PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("  \u2713 " + msg); }
  else { FAIL++; console.log("  \u2717 FAIL: " + msg); }
}

function G(nodes) {
  var data = {};
  nodes.forEach(function (spec, i) {
    var nid = String(i + 1);
    data[nid] = {
      name: spec[0] + "_layer",
      data: spec[1] || {},
      inputs: {},
      outputs: {},
      pos_x: i * 180,
      pos_y: 100,
    };
    if (i > 0) {
      var prevId = String(i);
      data[nid].inputs.input_1 = { connections: [{ node: prevId, output: "output_1" }] };
      data[prevId].outputs.output_1 = data[prevId].outputs.output_1 || { connections: [] };
      data[prevId].outputs.output_1.connections.push({ node: nid, input: "input_1" });
    }
  });
  return { drawflow: { Home: { data: data } } };
}

function flattenMaxDiff(a, b) {
  var maxDiff = 0;
  for (var i = 0; i < a.length; i++) {
    var ra = a[i], rb = b[i];
    for (var j = 0; j < ra.length; j++) {
      var d = Math.abs(Number(ra[j]) - Number(rb[j]));
      if (d > maxDiff) maxDiff = d;
    }
  }
  return maxDiff;
}

async function runCase(name, graph, featureSize, xInput) {
  var built = MBC.buildModelFromGraph(tf, graph, {
    mode: "direct",
    featureSize: featureSize,
    windowSize: 1,
    seqFeatureSize: featureSize,
    allowedOutputKeys: [{ key: "custom", headType: "reconstruction" }],
    defaultTarget: "custom",
    numClasses: 0,
  });

  var x = tf.tensor2d(xInput);
  var tfPred = built.model.predict(x);
  var tfArr = await tfPred.array();

  var artifacts = null;
  await built.model.save(tf.io.withSaveHandler(async function (a) {
    artifacts = a;
    return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" } };
  }));

  var cfg = {
    graph: graph,
    featureSize: featureSize,
    targetSize: tfArr[0].length,
    numClasses: 0,
    xInput: xInput,
    weightValues: Array.from(new Float32Array(artifacts.weightData)),
  };
  var cfgPath = path.join("/tmp", "surrogate_studio_conv_parity_" + name + ".json");
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));

  var proc = child.spawnSync(PYTHON, [PREDICT, cfgPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30000,
  });
  if (proc.status !== 0) {
    throw new Error(name + " python failed: " + (proc.stderr || proc.stdout));
  }
  var lines = String(proc.stdout || "").trim().split("\n").filter(Boolean);
  var result = null;
  lines.forEach(function (line) {
    var msg = JSON.parse(line);
    if (msg.kind === "result") result = msg.result;
    if (msg.kind === "error") throw new Error(msg.message);
  });
  if (!result || !result.predictions) throw new Error(name + " missing predictions");

  var maxDiff = flattenMaxDiff(tfArr, result.predictions);
  assert(maxDiff < 1e-6, name + " matches server reload path (maxDiff=" + maxDiff + ")");

  built.model.dispose();
  x.dispose();
  tfPred.dispose();
}

(async function main() {
  console.log("=== 1. Conv2D Parity ===");
  await runCase(
    "conv2d_flatten",
    G([
      ["input", { mode: "flat" }],
      ["reshape", { targetShape: "4,4,1" }],
      ["conv2d", { filters: 2, kernelSize: 3, strides: 1, padding: "same", activation: "linear", useBias: true }],
      ["flatten", {}],
      ["output", { target: "custom", targetType: "custom", loss: "none" }],
    ]),
    16,
    Array.from({ length: 3 }, function (_, r) {
      return Array.from({ length: 16 }, function (_, c) { return ((r + 1) * (c + 1)) / 50; });
    })
  );

  console.log("\n=== 2. Conv2DTranspose Parity ===");
  await runCase(
    "convt2d_flatten",
    G([
      ["input", { mode: "flat" }],
      ["reshape", { targetShape: "2,2,2" }],
      ["conv2d_transpose", { filters: 1, kernelSize: 3, strides: 2, padding: "same", activation: "linear", useBias: true }],
      ["flatten", {}],
      ["output", { target: "custom", targetType: "custom", loss: "none" }],
    ]),
    8,
    Array.from({ length: 3 }, function (_, r) {
      return Array.from({ length: 8 }, function (_, c) { return ((r + 2) * (c + 1)) / 30; });
    })
  );

  console.log("\n=== RESULTS ===");
  console.log("PASS: " + PASS + " / FAIL: " + FAIL);
  if (FAIL > 0) process.exit(1);
})();

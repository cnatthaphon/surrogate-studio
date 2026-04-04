/**
 * Server builder default-initializer contract test.
 *
 * When the graph omits initializers, the PyTorch builder should use the same
 * defaults the TF.js builder would have used for weight-bearing blocks.
 */

var fs = require("fs");
var path = require("path");
var child = require("child_process");

var PYTHON = process.env.SURROGATE_STUDIO_PYTHON || "/home/cue/venv/main/bin/python3";
var REPO_ROOT = path.resolve(__dirname, "..");
var SERVER_DIR = path.join(REPO_ROOT, "server");

if (!fs.existsSync(PYTHON)) {
  console.log("SKIP test_server_default_initializer_contract (python env missing: " + PYTHON + ")");
  process.exit(0);
}

var PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("  \u2713 " + msg); }
  else { FAIL++; console.log("  \u2717 FAIL: " + msg); }
}

function pyStringLiteral(v) {
  return JSON.stringify(String(v));
}

function runPython(code) {
  var proc = child.spawnSync(PYTHON, ["-c", code], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30000,
  });
  if (proc.status !== 0) {
    throw new Error((proc.stderr || proc.stdout || "python failed").trim());
  }
  return JSON.parse(String(proc.stdout || "").trim());
}

console.log("=== 1. Dense Defaults ===");
var denseInfo = runPython([
  "import json, pathlib, sys",
  "sys.path.insert(0, " + pyStringLiteral(SERVER_DIR) + ")",
  "from train_subprocess import build_model_from_graph",
  "graph = {'drawflow': {'Home': {'data': {",
  "  '1': {'name': 'input_layer', 'data': {'mode': 'flat'}, 'inputs': {}, 'outputs': {'output_1': {'connections': [{'node': '2', 'input': 'input_1'}]}}},",
  "  '2': {'name': 'dense_layer', 'data': {'units': 256, 'activation': 'relu', 'useBias': True}, 'inputs': {'input_1': {'connections': [{'node': '1', 'output': 'output_1'}]}}, 'outputs': {}}",
  "}}}}",
  "model = build_model_from_graph(graph, 128, 256, 0)",
  "params = dict(model.named_parameters())",
  "w = params['dense_2.weight'].detach().cpu()",
  "b = params['dense_2.bias'].detach().cpu()",
  "print(json.dumps({'w_max': float(w.abs().max()), 'b_max': float(b.abs().max())}))",
].join("\n"));
var denseBound = Math.sqrt(6 / (128 + 256));
assert(denseInfo.b_max === 0, "dense default bias is zeros");
assert(denseInfo.w_max <= denseBound + 0.01, "dense default kernel stays within glorot-uniform bound");

console.log("\n=== 2. Conv Defaults ===");
var convInfo = runPython([
  "import json, pathlib, sys",
  "sys.path.insert(0, " + pyStringLiteral(SERVER_DIR) + ")",
  "from train_subprocess import build_model_from_graph",
  "graph = {'drawflow': {'Home': {'data': {",
  "  '1': {'name': 'input_layer', 'data': {'mode': 'flat'}, 'inputs': {}, 'outputs': {'output_1': {'connections': [{'node': '2', 'input': 'input_1'}]}}},",
  "  '2': {'name': 'reshape_layer', 'data': {'targetShape': '28,28,1'}, 'inputs': {'input_1': {'connections': [{'node': '1', 'output': 'output_1'}]}}, 'outputs': {'output_1': {'connections': [{'node': '3', 'input': 'input_1'}]}}},",
  "  '3': {'name': 'conv2d_layer', 'data': {'filters': 64, 'kernelSize': 4, 'strides': 2, 'padding': 'same', 'activation': 'relu', 'useBias': True}, 'inputs': {'input_1': {'connections': [{'node': '2', 'output': 'output_1'}]}}, 'outputs': {}}",
  "}}}}",
  "model = build_model_from_graph(graph, 784, 3136, 0)",
  "params = dict(model.named_parameters())",
  "w = params['conv2d_3.weight'].detach().cpu()",
  "b = params['conv2d_3.bias'].detach().cpu()",
  "print(json.dumps({'w_max': float(w.abs().max()), 'b_max': float(b.abs().max())}))",
].join("\n"));
var convFanIn = 1 * 4 * 4;
var convFanOut = 64 * 4 * 4;
var convBound = Math.sqrt(6 / (convFanIn + convFanOut));
assert(convInfo.b_max === 0, "conv default bias is zeros");
assert(convInfo.w_max <= convBound + 0.01, "conv default kernel stays within glorot-uniform bound");

console.log("\n=== RESULTS ===");
console.log("PASS: " + PASS + " / FAIL: " + FAIL);
if (FAIL > 0) process.exit(1);

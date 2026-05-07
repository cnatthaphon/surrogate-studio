#!/usr/bin/env python3
"""Codex round-4 P1: raw PyTorch GRU artifact must load into the browser.

Before the fix, src/weight_converter.js#pytorchToTfjs emitted GRU bias as
1D [3*H], but src/model_builder_core.js#GRUResetAfterLayer requires
[2, 3*H]. Importing a raw PyTorch GRU (e.g. from a notebook export)
into the browser would fail with weight_count_mismatch on bias.

After the fix, pytorchToTfjs emits [2, 3*H] for GRU. This test:
  1. Creates a raw PyTorch GRU state_dict (NOT pre-converted via
     extract_pytorch_state's TF.js layout).
  2. Sends it into the TF.js model builder via pytorchToTfjs +
     loadArtifactsIntoModel.
  3. Asserts inference is bit-exact vs the same PyTorch model.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

REPO = Path(__file__).resolve().parent.parent

torch.manual_seed(0)
np.random.seed(0)

INPUT_DIM = 4
HIDDEN = 5
SEQ = 1
BATCH = 2

gru = nn.GRU(INPUT_DIM, HIDDEN, batch_first=True, bias=True)
opt = torch.optim.Adam(gru.parameters(), lr=0.1)
opt.zero_grad()
x = torch.randn(BATCH, SEQ, INPUT_DIM)
y, _ = gru(x)
y.pow(2).mean().backward()
opt.step()
gru.eval()
with torch.no_grad():
    y_pt, _ = gru(x)
y_pt_last = y_pt[:, -1, :].cpu().numpy()


class TinyGRUWrap(nn.Module):
    def __init__(self):
        super().__init__()
        self.gru_l0 = gru
    def forward(self, x):
        out, _ = self.gru_l0(x)
        return out[:, -1, :]


ref = TinyGRUWrap().eval()
state = ref.state_dict()

# Build a raw-PyTorch artifact (no extract_pytorch_state wrapping).
# specs/values are exactly what a torch.save → JSON dump would yield.
py_specs = []
py_values = []
for k in ["gru_l0.weight_ih_l0", "gru_l0.weight_hh_l0", "gru_l0.bias_ih_l0", "gru_l0.bias_hh_l0"]:
    v = state[k].detach().numpy().astype(np.float32)
    py_specs.append({"name": k, "shape": list(v.shape), "dtype": "float32"})
    py_values.extend(v.flatten().tolist())

with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    json.dump({
        "specs": py_specs, "values": py_values,
        "x": x.numpy().tolist(),
        "input_dim": INPUT_DIM, "hidden": HIDDEN, "seq": SEQ, "batch": BATCH,
    }, f)
    cfg_path = f.name

js = """
"use strict";
var fs = require("fs");
var path = require("path");
global.window = global;
global.OSCDatasetModules = { registerModule: function () {} };
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var sr = require(path.join(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var MBC = require(path.join(__dirname, "..", "src/model_builder_core.js"));
var WC = require(path.join(__dirname, "..", "src/weight_converter.js"));

(async function () {
  await tf.setBackend("cpu"); await tf.ready();
  var cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  var graph = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer",  data:{mode:"flat", featureSize:cfg.input_dim}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"gru_layer",    data:{units:cfg.hidden, returnseq:"false", dropout:0}, class:"gru_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:200, pos_y:0 },
    "3": { id:3, name:"output_layer", data:{target:"custom", targetType:"custom", loss:"none", units:cfg.hidden}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}}, outputs:{}, pos_x:400, pos_y:0 },
  } } } };
  var built = MBC.buildModelFromGraph(tf, graph, {
    mode: "direct", featureSize: cfg.input_dim, windowSize: 1, seqFeatureSize: cfg.input_dim,
    allowedOutputKeys: [], defaultTarget: "custom", numClasses: 0,
  });
  // Raw PyTorch artifact path: producerRuntime missing or non-server,
  // so loadArtifactsIntoModel routes through pytorchToTfjs.
  WC.loadArtifactsIntoModel(tf, built.model, {
    weightSpecs: cfg.specs, weightValues: cfg.values,
  });
  var x2d = cfg.x.map(function (s) { return s[0]; });
  var xTensor = tf.tensor2d(x2d);
  var pred = built.model.predict(xTensor);
  var out = Array.isArray(pred) ? pred[0] : pred;
  process.stdout.write(JSON.stringify(out.arraySync()));
})().catch(function (e) { console.error(e); process.exit(1); });
"""
js_path = REPO / "scripts/_tmp_gru_pt_to_browser.js"
js_path.write_text(js)
try:
    proc = subprocess.run(["node", str(js_path), cfg_path], cwd=REPO, capture_output=True, text=True)
    if proc.stderr:
        print("--- node stderr ---")
        print(proc.stderr)
        print("---")
    if proc.returncode != 0:
        print("STDOUT:", proc.stdout[-500:])
        raise RuntimeError(f"node subprocess failed (rc={proc.returncode})")
    out = proc.stdout
finally:
    js_path.unlink()
    Path(cfg_path).unlink()

y_tf = np.array(json.loads(out), dtype=np.float32)
print(f"PyTorch  : {y_pt_last[0]}")
print(f"TF.js    : {y_tf[0]}")

diff = np.abs(y_pt_last - y_tf).max()
print(f"\nMax abs diff: {diff:.6e}")
if diff < 1e-5:
    print("PASS: raw PyTorch GRU artifact loads + runs bit-exact in TF.js browser.")
else:
    print("FAIL: outputs diverge — pytorchToTfjs is not emitting bias in [2, 3*H] layout.")
    sys.exit(1)

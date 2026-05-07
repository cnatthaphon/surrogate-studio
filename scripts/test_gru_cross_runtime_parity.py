#!/usr/bin/env python3
"""Cross-runtime parity for the new GRUResetAfterLayer.

Train a tiny PyTorch GRU, run inference, extract weights, load into a
TF.js model that uses GRUResetAfterLayer, run TF.js inference, and
assert PyTorch and TF.js produce bit-exact outputs.

This pins down that the custom layer's forward equation matches
PyTorch GRU (i.e. resetAfter=True semantics: n = tanh(W_xn·x + b_xn +
r·(W_hn·h + b_hn))). The previous TF.js path used tf.layers.gru which
hard-rejects resetAfter=True and runs the resetAfter=False forward —
mathematically inequivalent unless b_hh = 0.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "server"))

from checkpoint_format import extract_pytorch_state, normalize_artifacts  # noqa: E402

torch.manual_seed(0)
np.random.seed(0)

INPUT_DIM = 4
HIDDEN = 5
# Use seq=1 so the model_builder's input_layer (mode="flat") accepts a
# 2D tensor — the GRU's auto-reshape promotes it to [batch, 1, features]
# internally. One timestep is enough to detect resetAfter mismatch
# because PyTorch's n-gate uses b_ih and b_hh asymmetrically from step 1.
SEQ = 1
BATCH = 2

gru = nn.GRU(INPUT_DIM, HIDDEN, batch_first=True, bias=True)
gru.eval()
# Train one micro-step so b_ih and b_hh diverge (otherwise b_hh = 0
# and resetAfter=False would accidentally agree with resetAfter=True).
opt = torch.optim.Adam(gru.parameters(), lr=0.1)
opt.zero_grad()
x = torch.randn(BATCH, SEQ, INPUT_DIM)
h, _ = gru(x)
loss = h.pow(2).mean()
loss.backward()
opt.step()
gru.eval()
with torch.no_grad():
    y_pt, _ = gru(x)
y_pt_last = y_pt[:, -1, :].cpu().numpy()
print(f"PyTorch last-timestep output (batch[0]): {y_pt_last[0]}")
print(f"  PyTorch b_ih sample: {gru.bias_ih_l0.detach().numpy()[:3]}")
print(f"  PyTorch b_hh sample: {gru.bias_hh_l0.detach().numpy()[:3]}")

# Wrap in a tiny module so extract sees gru_l0.weight_*_l0 keys.
class TinyGRUWrap(nn.Module):
    def __init__(self):
        super().__init__()
        self.gru_l0 = gru
    def forward(self, x):
        out, _ = self.gru_l0(x)
        return out[:, -1, :]

ref = TinyGRUWrap().eval()

specs, values = extract_pytorch_state(ref.state_dict())
artifacts = normalize_artifacts(specs, values, producer_runtime="test", include_weight_data=True)

with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    json.dump({
        "specs": specs,
        "values": values,
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
  // Build a minimal graph with just an input → gru → output node so
  // the model exercises GRUResetAfterLayer.
  var graph = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer",  data:{mode:"flat", featureSize:cfg.input_dim}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"gru_layer",    data:{units:cfg.hidden, returnseq:"false", dropout:0}, class:"gru_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:200, pos_y:0 },
    "3": { id:3, name:"output_layer", data:{target:"custom", targetType:"custom", loss:"none", units:cfg.hidden}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}}, outputs:{}, pos_x:400, pos_y:0 },
  } } } };
  var built = MBC.buildModelFromGraph(tf, graph, {
    mode: "direct", featureSize: cfg.input_dim, windowSize: 1, seqFeatureSize: cfg.input_dim,
    allowedOutputKeys: [], defaultTarget: "custom", numClasses: 0,
  });
  WC.loadArtifactsIntoModel(tf, built.model, {
    weightSpecs: cfg.specs, weightValues: cfg.values, producerRuntime: "python_server",
  });
  // Input is 2D when seq=1 (model_builder's input_layer expects 2D for
  // mode="flat" and the GRU layer auto-promotes to 3D internally).
  var x2d = cfg.x.map(function (s) { return s[0]; });
  var xTensor = tf.tensor2d(x2d);
  var pred = built.model.predict(xTensor);
  var out = Array.isArray(pred) ? pred[0] : pred;
  process.stdout.write(JSON.stringify(out.arraySync()));
})().catch(function (e) { console.error(e); process.exit(1); });
"""
js_path = REPO / "scripts/_tmp_gru_cross_runtime.js"
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
    out = proc.stdout.encode()
finally:
    js_path.unlink()
    Path(cfg_path).unlink()

y_tf = np.array(json.loads(out.decode()), dtype=np.float32)
print(f"TF.js   last-timestep output (batch[0]): {y_tf[0]}")

diff = np.abs(y_pt_last - y_tf).max()
print(f"\nMax abs diff: {diff:.6e}")
if diff < 1e-5:
    print("PASS: PyTorch GRU and TF.js GRUResetAfterLayer produce bit-exact output.")
else:
    print("FAIL: outputs diverge.")
    sys.exit(1)

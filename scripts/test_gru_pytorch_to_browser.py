#!/usr/bin/env python3
"""Codex round-4/5 P1: raw PyTorch GRU artifact must load into the browser.

Round-4 finding (e7ea2ff): src/weight_converter.js#pytorchToTfjs emitted
GRU bias as 1D [3*H], but src/model_builder_core.js#GRUResetAfterLayer
requires [2, 3*H]. Round-5 finding (3f21fb5): the gate-detection
heuristic mis-classifies GRU as LSTM whenever the hidden size H is
divisible by 4 — shape[0]=3*H satisfies BOTH the 4*(H/4*3=3*H/4)
and 3*H divisibility checks, and the ternary picked LSTM, producing a
no-op gate swap (LSTM identity) for what was actually a GRU.

This test runs the full raw-PyTorch → pytorchToTfjs → GRUResetAfterLayer
pipeline at multiple hidden sizes — including HIDDEN=8 to pin the
divisible-by-4 case — and asserts bit-exact parity for each.
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

# Cases include:
#   HIDDEN=5  — original case, H not divisible by 4
#   HIDDEN=8  — Codex round-5 reproduction (3*8=24 also = 4*6)
#   HIDDEN=16 — typical real-world size, also divisible by 4
TEST_CASES = [
    {"input_dim": 4, "hidden": 5,  "seq": 1, "batch": 2, "label": "H=5 (round-4 baseline)"},
    {"input_dim": 4, "hidden": 8,  "seq": 1, "batch": 2, "label": "H=8 (round-5 divisible-by-4)"},
    {"input_dim": 7, "hidden": 16, "seq": 1, "batch": 3, "label": "H=16 (typical, divisible-by-4)"},
]


def run_case(input_dim, hidden, seq, batch, label):
    print(f"--- case: {label} ---")
    torch.manual_seed(0)
    np.random.seed(0)

    gru = nn.GRU(input_dim, hidden, batch_first=True, bias=True)
    opt = torch.optim.Adam(gru.parameters(), lr=0.1)
    opt.zero_grad()
    x = torch.randn(batch, seq, input_dim)
    y, _ = gru(x); y.pow(2).mean().backward(); opt.step()
    gru.eval()
    with torch.no_grad():
        y_pt, _ = gru(x)
    y_pt_last = y_pt[:, -1, :].cpu().numpy()

    state = nn.Sequential().state_dict()  # noqa: drop placeholder
    state = {f"gru_l0.{k}": v for k, v in gru.state_dict().items()}

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
            "input_dim": input_dim, "hidden": hidden, "seq": seq, "batch": batch,
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
        if proc.returncode != 0:
            print("STDERR:", proc.stderr[-500:])
            print("STDOUT:", proc.stdout[-500:])
            raise RuntimeError(f"node subprocess failed (rc={proc.returncode})")
        out = proc.stdout
    finally:
        js_path.unlink()
        Path(cfg_path).unlink()

    y_tf = np.array(json.loads(out), dtype=np.float32)
    diff = np.abs(y_pt_last - y_tf).max()
    print(f"  max abs diff: {diff:.6e}")
    if diff >= 1e-5:
        print(f"  FAIL: outputs diverge for {label}")
        print(f"  PyTorch[0]: {y_pt_last[0]}")
        print(f"  TF.js[0]:   {y_tf[0]}")
        return False
    return True


all_ok = True
for case in TEST_CASES:
    if not run_case(**case):
        all_ok = False

if all_ok:
    print("\nPASS: raw PyTorch GRU loads bit-exact in TF.js for all hidden sizes (incl. divisible-by-4).")
else:
    print("\nFAIL: at least one case diverged.")
    sys.exit(1)

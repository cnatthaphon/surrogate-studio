#!/usr/bin/env python3
"""BUG-39 root-cause probe: PyTorch LSTM ↔ TF.js LSTM weight transfer parity.

Hypothesis: server/checkpoint_format.py:152 swaps gate blocks 1 and 2
(f ↔ g) under the assumption that TF.js LSTM uses [i, c, f, o] order.
Keras (which TF.js mirrors) actually uses [i, f, c, o] where Keras's
"c" is exactly PyTorch's "g" (cell candidate). If that's right, the
swap is wrong and PyTorch [i,f,g,o] maps directly to TF.js [i,f,c,o]
without a swap.

This test:
  1. Trains a tiny LSTM on a deterministic input/output in PyTorch.
  2. Exports weights two ways:
       (a) WITH the current swap (status quo)
       (b) WITHOUT the swap
  3. Loads each into a TF.js LSTM and runs the same input.
  4. Compares to PyTorch's output. Whichever matches is the correct
     convention.
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

torch.manual_seed(0)
INPUT_DIM = 3
HIDDEN = 4
SEQ = 5
BATCH = 2

lstm = nn.LSTM(INPUT_DIM, HIDDEN, batch_first=True, bias=True)
lstm.eval()

x = torch.randn(BATCH, SEQ, INPUT_DIM)
with torch.no_grad():
    y_pt, (h_pt, c_pt) = lstm(x)
y_pt = y_pt.numpy()

w_ih = lstm.weight_ih_l0.detach().numpy()  # [4*H, INPUT]
w_hh = lstm.weight_hh_l0.detach().numpy()  # [4*H, H]
b_ih = lstm.bias_ih_l0.detach().numpy()    # [4*H]
b_hh = lstm.bias_hh_l0.detach().numpy()    # [4*H]
H = HIDDEN


def with_swap(w):
    chunks = [w[j * H:(j + 1) * H] for j in range(4)]
    return np.concatenate([chunks[0], chunks[2], chunks[1], chunks[3]], axis=0)


def without_swap(w):
    return w


def export(swap_fn):
    kernel = swap_fn(w_ih).T  # [INPUT, 4*H]
    recurrent = swap_fn(w_hh).T  # [H, 4*H]
    bias = swap_fn(b_ih + b_hh)  # [4*H]
    return kernel, recurrent, bias


def run_tfjs(kernel, recurrent, bias, x_np):
    js = """
"use strict";
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
(async function () {
  await tf.setBackend("cpu"); await tf.ready();
  var cfg = JSON.parse(process.argv[2]);
  var lstm = tf.layers.lstm({
    units: cfg.units, returnSequences: true, useBias: true,
    activation: "tanh", recurrentActivation: "sigmoid",
    kernelInitializer: "zeros", recurrentInitializer: "zeros", biasInitializer: "zeros",
  });
  var inp = tf.input({ shape: [cfg.seq, cfg.input] });
  var out = lstm.apply(inp);
  var model = tf.model({ inputs: inp, outputs: out });
  lstm.setWeights([
    tf.tensor(cfg.kernel, [cfg.input, 4 * cfg.units]),
    tf.tensor(cfg.recurrent, [cfg.units, 4 * cfg.units]),
    tf.tensor(cfg.bias, [4 * cfg.units]),
  ]);
  var x = tf.tensor3d(cfg.x, [cfg.batch, cfg.seq, cfg.input]);
  var y = model.predict(x);
  process.stdout.write(JSON.stringify(y.arraySync()));
})();
"""
    cfg = {
        "units": HIDDEN, "seq": SEQ, "input": INPUT_DIM, "batch": BATCH,
        "kernel": kernel.flatten().tolist(),
        "recurrent": recurrent.flatten().tolist(),
        "bias": bias.flatten().tolist(),
        "x": x_np.flatten().tolist(),
    }
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, dir=REPO) as f:
        f.write(js)
        js_path = f.name
    try:
        out = subprocess.check_output(["node", js_path, json.dumps(cfg)], cwd=REPO)
    finally:
        os.unlink(js_path)
    return np.array(json.loads(out.decode()))


print("PyTorch reference output (last sample, last timestep):")
print(y_pt[0, -1])

for label, swap_fn in [("WITH-swap (current convention)", with_swap),
                       ("WITHOUT-swap", without_swap)]:
    k, r, b = export(swap_fn)
    y_tf = run_tfjs(k, r, b, x.numpy())
    diff = np.abs(y_pt - y_tf).max()
    print(f"\n{label}: max abs diff vs PyTorch = {diff:.6e}")
    print(f"  TF.js last sample, last timestep: {y_tf[0, -1]}")

    if diff < 1e-4:
        print(f"  → MATCH. {label} is the correct convention.")

#!/usr/bin/env python3
"""Parametrized BUG-38 / DCGAN parity test.

Asserts that the BROWSER's conv2d_transpose code path
(tf.layers.conv2dTranspose padding=valid + tf.layers.cropping2D with the
formula in src/model_builder_core.js) matches the SERVER's PyTorch path
(nn.ConvTranspose2d pad=0 + crop with the formula in
server/train_subprocess.py:_convt_crop) — for ALL kernel/stride combos
the demos use, not just Conv-AE's odd-kernel case.

The original BUG-38 fix landed only odd-kernel parity (Conv-AE 3x3/s=2):
crop bottom/right only. For DCGAN's even kernel (4x4/s=2), the server
crops symmetrically (1 each from top/bottom/left/right) while the
browser was still cropping bottom/right only — max_abs_diff ≈ 9.

This test parametrizes (kernel, stride) so a regression on either
runtime breaks CI loudly.
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import torch
import torch.nn as nn

CASES = [
    # (kernel, stride, in_h)
    (3, 2, 4),  # Conv-AE
    (4, 2, 4),  # DCGAN — the case the reviewer flagged
    (5, 2, 4),  # extra coverage: odd kernel, total crop = 3 (asymmetric)
    (3, 2, 7),  # Conv-AE second transpose layer (7 → 14)
]

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def server_crop(y_full: torch.Tensor, ks: int, st: int, in_h: int, in_w: int) -> np.ndarray:
    """Apply the server's crop formula from train_subprocess.py:1367."""
    crop_y = max(0, (ks - st) // 2)
    crop_x = max(0, (ks - st) // 2)
    target_h = in_h * st
    target_w = in_w * st
    return y_full[0, 0, crop_y:crop_y + target_h, crop_x:crop_x + target_w].detach().numpy()


def browser_crop_call(x_tfjs, w_tfjs, ks: int, st: int) -> np.ndarray:
    """Apply the browser's (post-fix) formula via tf.layers.conv2dTranspose
    padding=valid + cropping2D — exactly what model_builder_core.js does."""
    total_crop = max(0, ks - st)
    crop_top = total_crop // 2
    crop_bottom = total_crop - crop_top
    crop_left = total_crop // 2
    crop_right = total_crop - crop_left
    js = f"""
"use strict";
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
(async function () {{
  await tf.setBackend("cpu"); await tf.ready();
  var x = tf.tensor4d({json.dumps(x_tfjs)});
  var W = tf.tensor4d({json.dumps(w_tfjs)});
  var convt = tf.layers.conv2dTranspose({{
    filters: 1, kernelSize: {ks}, strides: {st}, padding: "valid",
    useBias: false, kernelInitializer: "zeros"
  }});
  var raw = convt.apply(x);
  convt.setWeights([W]);
  var rawWithW = convt.apply(x);
  var cropped = ({crop_top} > 0 || {crop_bottom} > 0 || {crop_left} > 0 || {crop_right} > 0)
    ? tf.layers.cropping2D({{ cropping: [[{crop_top}, {crop_bottom}], [{crop_left}, {crop_right}]] }}).apply(rawWithW)
    : rawWithW;
  process.stdout.write(JSON.stringify(cropped.arraySync()));
}})();
"""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, dir=REPO) as f:
        f.write(js)
        js_path = f.name
    try:
        out = subprocess.check_output(["node", js_path], cwd=REPO)
    finally:
        os.unlink(js_path)
    raw_out = json.loads(out.decode())  # [1, H, W, 1]
    H = len(raw_out[0])
    W = len(raw_out[0][0])
    return np.array([[raw_out[0][i][j][0] for j in range(W)] for i in range(H)], dtype=np.float32)


failures = []
for ks, st, in_h in CASES:
    in_w = in_h
    torch.manual_seed(0)
    x = torch.arange(1.0, in_h * in_w + 1).view(1, 1, in_h, in_w)
    # Deterministic kernel — values picked so any spatial misalignment is visible.
    W_pytorch = torch.linspace(0.1, ks * ks * 0.1, ks * ks).view(1, 1, ks, ks)

    # PyTorch (server convention): pad=0 + crop
    convt = nn.ConvTranspose2d(1, 1, kernel_size=ks, stride=st, padding=0, output_padding=0, bias=False)
    convt.weight.data = W_pytorch.clone()
    y_full = convt(x)
    y_server = server_crop(y_full, ks, st, in_h, in_w)

    # TF.js (browser convention): valid + cropping2D with new formula
    W_tfjs = W_pytorch.permute(2, 3, 1, 0).tolist()  # PyTorch [out, in, kH, kW] (with out=in=1) → TF.js [kH, kW, in, out]
    x_tfjs = x.permute(0, 2, 3, 1).tolist()  # NCHW → NHWC
    y_browser = browser_crop_call(x_tfjs, W_tfjs, ks, st)

    diff = np.abs(y_server - y_browser)
    label = f"k={ks} s={st} in={in_h}"
    print(f"{label}: shape server={y_server.shape} browser={y_browser.shape} max_abs_diff={diff.max():.6f}")
    if y_server.shape != y_browser.shape or diff.max() > 1e-4:
        failures.append((label, float(diff.max())))

if failures:
    print("\nFAIL:")
    for label, d in failures:
        print(f"  {label}: max_abs_diff={d:.6f}")
    sys.exit(1)
print("\nPASS: server and browser conv2d_transpose crop formulas match for all (k, s) cases.")

#!/usr/bin/env python3
"""BUG-38 verification: PyTorch ConvTranspose2d(pad=1, out_pad=1) MUST match
TF.js conv2dTranspose(padding='same') value-for-value.

Pre-fix: server used pad=0 + top-left crop, which produced output values
SHIFTED by (kernel-1)//2 pixels relative to TF.js "same". Conv-AE trained
with this convention but ran inference under TF.js's symmetric "same" →
~10x runtime MSE inflation.

Post-fix: server uses pad=(kernel-1)//2, output_padding=stride-1 which
PyTorch documents as equivalent to TF.js "same" for the standard
kernel/stride combos this codebase uses (3/2 in Conv-AE, 4/2 in DCGAN).
"""
import torch
import torch.nn as nn
import json
import subprocess
import sys

# Deterministic input + kernel — values picked to make boundary effects visible.
torch.manual_seed(0)
x = torch.arange(1.0, 17.0).view(1, 1, 4, 4)
W_pytorch = torch.tensor([[[
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6],
    [0.7, 0.8, 0.9],
]]])  # [out=1, in=1, kH=3, kW=3] — PyTorch ConvTranspose2d.weight layout

# (1) PyTorch with the SERVER convention (pad=0 + top-left crop to in*stride).
conv = nn.ConvTranspose2d(1, 1, kernel_size=3, stride=2, padding=0, output_padding=0, bias=False)
conv.weight.data = W_pytorch.clone()
y_full = conv(x)
crop_y = max(0, (3 - 2) // 2)
crop_x = max(0, (3 - 2) // 2)
target_h = 4 * 2
target_w = 4 * 2
y_pytorch = y_full[0, 0, crop_y:crop_y+target_h, crop_x:crop_x+target_w].detach().numpy()
print(f"PyTorch ConvTranspose(pad=0)+crop output shape: {y_pytorch.shape}")

# (2) TF.js via inline node script. tf.layers.conv2dTranspose stores weights
# in [kH, kW, outDepth, inDepth] = [3, 3, 1, 1], so PyTorch [1,1,3,3] needs
# permute (2,3,1,0) to land in TF.js layout. PyTorch nn.ConvTranspose2d
# weight is already [in=1, out=1, kH, kW] but here in==out==1 so no swap.
W_tfjs = W_pytorch.permute(2, 3, 1, 0).tolist()  # [3, 3, 1, 1]
x_tfjs = x.permute(0, 2, 3, 1).tolist()  # [1, 4, 4, 1] NHWC

js_code = f"""
"use strict";
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
(async function () {{
  await tf.setBackend("cpu"); await tf.ready();
  var x = tf.tensor4d({json.dumps(x_tfjs)});
  var W = tf.tensor4d({json.dumps(W_tfjs)});
  var layer = tf.layers.conv2dTranspose({{ filters: 1, kernelSize: 3, strides: 2, padding: "same", useBias: false, kernelInitializer: "zeros" }});
  layer.apply(x);
  layer.setWeights([W]);
  var y = layer.apply(x);
  process.stdout.write(JSON.stringify(y.arraySync()));
}})();
"""
import tempfile, os
with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, dir=os.path.dirname(os.path.abspath(__file__))) as f:
    f.write(js_code)
    js_path = f.name

try:
    out = subprocess.check_output(["node", js_path], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
finally:
    os.unlink(js_path)

# TF.js output is [batch, H, W, channels]. Squeeze to [H, W].
y_tfjs_raw = json.loads(out.decode())
y_tfjs = [[y_tfjs_raw[0][i][j][0] for j in range(8)] for i in range(8)]

import numpy as np
y_pytorch_arr = np.asarray(y_pytorch)
y_tfjs_arr = np.asarray(y_tfjs)
diff = np.abs(y_pytorch_arr - y_tfjs_arr)
print(f"\nMax abs diff (PyTorch vs TF.js): {diff.max():.6f}")
print(f"Mean abs diff: {diff.mean():.6f}")

if diff.max() < 1e-4:
    print("\nPASS: PyTorch ConvTranspose(pad=1, out_pad=1) matches TF.js conv2dTranspose('same')")
else:
    print("\nFAIL: outputs differ — server still trains under wrong padding convention")
    print("\nPyTorch:"); print(y_pytorch_arr)
    print("\nTF.js:"); print(y_tfjs_arr)
    sys.exit(1)

#!/usr/bin/env python3
"""Codex round-7 P1: GRU bias-format detection must accept browser names.

Browser-trained checkpoints emit weight specs as `n<id>/kernel`,
`n<id>/recurrent_kernel`, `n<id>/bias` (Keras layer convention).
runtime_weight_loader.py's pre-scan previously only matched
`tfjs_kernel`/`kernel` etc., so browser-trained GRU artifacts fell
through, the GRU branch saw no bias shape, defaulted to legacy [3*H],
read 3*H bytes instead of 6*H, and the offset shift corrupted every
following weight (dense, output head, etc.). Codex repro showed
max diff 0.553502 after reload.

This test fabricates a browser-style artifact (n2/* names + a trailing
n3/{kernel,bias} dense head), loads it into a fresh PyTorch model with
the new format ([2, 3*H] bias), and asserts bit-exact reload.
"""
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "server"))

from checkpoint_format import extract_pytorch_state, normalize_artifacts  # noqa: E402
from runtime_weight_loader import load_weights_into_model  # noqa: E402


class GRUWithDense(nn.Module):
    def __init__(self, in_dim=4, hidden=5, out=2):
        super().__init__()
        self.gru_l0 = nn.GRU(in_dim, hidden, batch_first=True, bias=True)
        self.dense_out = nn.Linear(hidden, out)

    def forward(self, x):
        g, _ = self.gru_l0(x)
        return self.dense_out(g[:, -1])


torch.manual_seed(0)
np.random.seed(0)

ref = GRUWithDense().eval()
opt = torch.optim.Adam(ref.parameters(), lr=0.05)
opt.zero_grad()
x = torch.randn(3, 4, 4)
ref(x).pow(2).mean().backward()
opt.step()
ref.eval()
with torch.no_grad():
    y_ref = ref(x).cpu().numpy()

# Server-side extract produces tfjs_* names; rewrite them to browser
# convention (n2/kernel, n2/recurrent_kernel, n2/bias for the GRU,
# n3/kernel + n3/bias for the dense head).
specs, values = extract_pytorch_state(ref.state_dict())
remap = {
    "tfjs_kernel": "n2/kernel",
    "tfjs_recurrent_kernel": "n2/recurrent_kernel",
    "tfjs_bias": "n2/bias",
    "tfjs_dense_out.weight": "n3/kernel",
    "tfjs_dense_out.bias": "n3/bias",
}
for sp in specs:
    if sp["name"] in remap:
        sp["name"] = remap[sp["name"]]

# Sanity: this is the actual scenario the bug appears under.
print("Renamed specs:")
for sp in specs:
    print(f"  {sp['name']} shape={sp['shape']}")

artifacts = normalize_artifacts(specs, values, producer_runtime="browser-test", include_weight_data=True)

torch.manual_seed(99)
fresh = GRUWithDense().eval()
ok = load_weights_into_model(fresh, artifacts)
if not ok:
    print("FAIL: load_weights_into_model returned False")
    sys.exit(1)

with torch.no_grad():
    y_fresh = fresh(x).cpu().numpy()

diff = float(np.abs(y_ref - y_fresh).max())
print(f"\nMax abs diff: {diff:.6e}")
if diff < 1e-6:
    print("PASS: browser-named GRU artifact reloads bit-exact.")
else:
    print("FAIL: outputs diverge — bias-format detection didn't recognize n*/bias.")
    sys.exit(1)

#!/usr/bin/env python3
"""BUG-40 round-2 review: legacy GRU artifact must not crash the loader.

Pre-PR-70 main extracted GRU under the LSTM-pattern (4-chunk swap +
single combined bias [3*H]). The PR #70 loader expects [2, 3*H] bias
and would crash on shape mismatch.

This test fabricates a legacy-format GRU artifact (bias shape [3*H])
and confirms load_weights_into_model returns True with no exception.
The reloaded model produces approximate output (the legacy extract
itself was mathematically wrong for GRU), but the load doesn't abort
resume/predict/generate.

Pinned by Codex P1 finding on PR #70.
"""
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "server"))

from runtime_weight_loader import load_weights_into_model  # noqa: E402


class TinyGRU(nn.Module):
    def __init__(self, in_dim=3, hidden=4):
        super().__init__()
        self.gru_l0 = nn.GRU(in_dim, hidden, batch_first=True, bias=True)
        self.dense_l1 = nn.Linear(hidden, 2)

    def forward(self, x):
        out, _ = self.gru_l0(x)
        return self.dense_l1(out[:, -1])


# Fabricate a legacy artifact directly: pack tfjs_kernel, tfjs_recurrent_kernel,
# tfjs_bias [3*H] (single combined). This mirrors what main's
# extract_pytorch_state would have produced under the broken LSTM-pattern path.
torch.manual_seed(0)
np.random.seed(0)
H = 4
IN = 3
weight_ih = np.random.randn(3 * H, IN).astype(np.float32)
weight_hh = np.random.randn(3 * H, H).astype(np.float32)
bias_combined = np.random.randn(3 * H).astype(np.float32)
dense_w = np.random.randn(H, 2).astype(np.float32)
dense_b = np.random.randn(2).astype(np.float32)

# Legacy on-disk layout: shapes match what pre-PR-70 emit produced.
specs = [
    {"name": "tfjs_kernel",                  "shape": [IN, 3 * H],  "dtype": "float32", "offset": 0},
    {"name": "tfjs_recurrent_kernel",        "shape": [H,  3 * H],  "dtype": "float32", "offset": IN * 3 * H * 4},
    {"name": "tfjs_bias",                    "shape": [3 * H],      "dtype": "float32", "offset": (IN * 3 * H + H * 3 * H) * 4},
    {"name": "tfjs_dense_l1.weight",         "shape": [H, 2],       "dtype": "float32", "offset": (IN * 3 * H + H * 3 * H + 3 * H) * 4},
    {"name": "tfjs_dense_l1.bias",           "shape": [2],          "dtype": "float32", "offset": (IN * 3 * H + H * 3 * H + 3 * H + H * 2) * 4},
]
values = (
    weight_ih.T.flatten().tolist() +     # extract emits .T to match TF.js layout
    weight_hh.T.flatten().tolist() +
    bias_combined.flatten().tolist() +
    dense_w.flatten().tolist() +
    dense_b.flatten().tolist()
)

artifacts = {"weightSpecs": specs, "weightValues": values, "producerRuntime": "test_legacy"}

torch.manual_seed(42)
fresh = TinyGRU(IN, H).eval()
try:
    ok = load_weights_into_model(fresh, artifacts)
except Exception as e:
    print(f"FAIL: legacy load crashed: {type(e).__name__}: {e}")
    sys.exit(1)

if not ok:
    print("FAIL: load_weights_into_model returned False on legacy artifact")
    sys.exit(1)

# Sanity: forward must run without shape errors.
with torch.no_grad():
    x = torch.randn(2, 5, IN)
    y = fresh(x).cpu().numpy()
print(f"Legacy load output range: [{y.min():.3f}, {y.max():.3f}]")
print("PASS: legacy GRU artifact loads without crashing.")
print("      (Forward output is approximate vs original PyTorch — the")
print("       legacy extract itself was mathematically wrong for GRU —")
print("       but load no longer aborts resume/predict/generate.)")

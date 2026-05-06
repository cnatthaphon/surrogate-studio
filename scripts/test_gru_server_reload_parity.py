#!/usr/bin/env python3
"""GRU server-side reload regression for BUG-39 follow-up.

The BUG-39 fix in runtime_weight_loader.py originally forced *every*
recurrent model into the LSTM-specific positional reload block. That
block assumes a 4*H gate layout, which works for LSTM but crashes GRU
(3*H) and simple RNN (H) with shape mismatches like
`expected [30, 3] but got [28, 3]` (Codex finding on PR #68).

This test confirms a GRU model can be extracted and reloaded without
crashing, and that the round-trip preserves the inference output.

The trigger that forces the positional path is now structural (4*H
gate ratio detection), so GRU stays on the named-load path. If anyone
re-broadens the trigger to all recurrent types, this test catches it.
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


class TinyGRU(nn.Module):
    """GRU at hidden_size=10 to match the Codex finding's repro."""

    def __init__(self, input_dim: int = 3, hidden: int = 10):
        super().__init__()
        self.gru_l0 = nn.GRU(input_dim, hidden, batch_first=True, bias=True)
        self.dense_l1 = nn.Linear(hidden, 2)

    def forward(self, x):
        out, _ = self.gru_l0(x)
        return self.dense_l1(out[:, -1])


torch.manual_seed(0)
np.random.seed(0)

x = torch.randn(4, 5, 3)

ref = TinyGRU().eval()
opt = torch.optim.Adam(ref.parameters(), lr=0.01)
ref.train()
for _ in range(5):
    opt.zero_grad()
    y = ref(x)
    loss = y.pow(2).mean()
    loss.backward()
    opt.step()
ref.eval()
with torch.no_grad():
    ref_out = ref(x).cpu().numpy()
print(f"Reference output: {ref_out[0]}")

specs, values = extract_pytorch_state(ref.state_dict())
artifacts = normalize_artifacts(specs, values, producer_runtime="test", include_weight_data=True)

torch.manual_seed(42)
fresh = TinyGRU().eval()
try:
    ok = load_weights_into_model(fresh, artifacts)
except Exception as e:
    print(f"FAIL: load_weights_into_model crashed: {type(e).__name__}: {e}")
    sys.exit(1)

if not ok:
    print("FAIL: load_weights_into_model returned False")
    sys.exit(1)

with torch.no_grad():
    reload_out = fresh(x).cpu().numpy()

# BUG-40 fix: extract emits 4 specs for GRU (kernel, recurrent_kernel,
# bias = b_ih + b_hh, bias_hh_residual = b_hh) with the proper
# [r,z,n] → [z,r,h] swap. Server reload reads all 4 specs and recovers
# b_ih = combined - residual exactly. Round trip is bit-exact.
print(f"Reload output:    {reload_out[0]}")
diff = np.abs(ref_out - reload_out).max()
print(f"Max abs diff: {diff:.6e}")
if diff < 1e-5:
    print("PASS: GRU server-side round trip is bit-exact.")
else:
    print(f"FAIL: GRU server-side round trip diverges (diff {diff:.6e}).")
    sys.exit(1)

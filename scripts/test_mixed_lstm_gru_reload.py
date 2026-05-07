#!/usr/bin/env python3
"""Codex round-4 P1: GRU bias detection must not be poisoned by LSTM bias.

Pre-fix, runtime_weight_loader.py's pre-scan collected every tfjs_bias
spec into gru_bias_shapes. In a checkpoint with an LSTM block before a
GRU block, the LSTM's [4*H] bias would land at index 0; the GRU branch
would then read shape [4*H] (1D, not 2D), classify the GRU as legacy,
and deserialize with the broken LSTM-pattern unswap — bit-wrong weights
on a brand-new artifact.

Fix: only collect biases that immediately follow a recurrent_kernel
spec whose shape says GRU (cols/rows == 3). Biases from LSTM triples
are skipped from gru_bias_shapes.

This test fabricates a mixed LSTM+GRU artifact in the new format and
asserts the GRU portion still loads bit-exact (i.e. is recognized as
new-format, not misclassified as legacy).
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


class MixedLSTMGRU(nn.Module):
    """LSTM block, then GRU block stacked. Both single-layer."""
    def __init__(self, in_dim=4, lstm_h=5, gru_h=6, out=2):
        super().__init__()
        self.lstm_l0 = nn.LSTM(in_dim, lstm_h, batch_first=True, bias=True)
        self.gru_l0 = nn.GRU(lstm_h, gru_h, batch_first=True, bias=True)
        self.dense_out = nn.Linear(gru_h, out)

    def forward(self, x):
        h, _ = self.lstm_l0(x)
        g, _ = self.gru_l0(h)
        return self.dense_out(g[:, -1])


torch.manual_seed(0)
np.random.seed(0)
ref = MixedLSTMGRU().eval()
# Random one-step train so b_ih and b_hh diverge for both blocks
opt = torch.optim.Adam(ref.parameters(), lr=0.05)
opt.zero_grad()
x = torch.randn(3, 4, 4)
out = ref(x)
out.pow(2).mean().backward()
opt.step()
ref.eval()

with torch.no_grad():
    y_ref = ref(x).cpu().numpy()

specs, values = extract_pytorch_state(ref.state_dict())
artifacts = normalize_artifacts(specs, values, producer_runtime="test", include_weight_data=True)

# Brand-new fresh model (no inheritance) for a clean reload
torch.manual_seed(99)
fresh = MixedLSTMGRU().eval()
ok = load_weights_into_model(fresh, artifacts)
if not ok:
    print("FAIL: load_weights_into_model returned False")
    sys.exit(1)

with torch.no_grad():
    y_fresh = fresh(x).cpu().numpy()

diff = np.abs(y_ref - y_fresh).max()
print(f"Max abs diff: {diff:.6e}")
if diff < 1e-6:
    print("PASS: mixed LSTM+GRU checkpoint reloads bit-exact (GRU bias not poisoned by LSTM).")
else:
    print("FAIL: outputs diverge — GRU likely mis-classified as legacy due to LSTM bias contamination.")
    sys.exit(1)

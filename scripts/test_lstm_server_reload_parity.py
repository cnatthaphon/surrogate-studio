#!/usr/bin/env python3
"""BUG-39 regression: server-side LSTM round-trip parity.

The bug had two halves with the same swap formula:
  - server/checkpoint_format.py (extract): pre-fix swapped gates on EXPORT
  - server/runtime_weight_loader.py (load): pre-fix unswapped on RELOAD

If both halves apply the same swap, a server-only round trip
(extract → reload into a fresh PyTorch model) cancels out and looks
fine. The corruption is only visible when one path runs WITHOUT the
swap, e.g. when the browser loads the same checkpoint or when only
one of the two paths gets fixed in isolation.

This test pins the no-swap convention end-to-end on the SERVER side:

  1. Train a tiny PyTorch LSTM-classifier on a deterministic input.
  2. Run inference, capture reference output.
  3. Extract weights via server/checkpoint_format.extract_pytorch_state.
  4. Build a FRESH PyTorch LSTM (random init), load via
     server/runtime_weight_loader.load_weights_into_model.
  5. Run inference on the same input. Output must match the reference.

Pre-fix (status quo across PR #68 export side, before this commit on
the loader side): the loader's [i,f,g,o]→[i,g,f,o] unswap on reload
runs with no matching swap on extract, so the reloaded model is
broken — outputs diverge.

Post-fix: both extract and reload are no-swap. Round trip is exact.
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


class TinyLSTM(nn.Module):
    """Wraps an LSTM in a tiny module so its state_dict keys look like
    `lstm_l0.weight_ih_l0` etc., matching what the platform's training
    engine produces."""

    def __init__(self, input_dim: int = 3, hidden: int = 4):
        super().__init__()
        self.lstm_l0 = nn.LSTM(input_dim, hidden, batch_first=True, bias=True)
        self.dense_l1 = nn.Linear(hidden, 2)

    def forward(self, x):
        out, _ = self.lstm_l0(x)
        return self.dense_l1(out[:, -1])


torch.manual_seed(0)
np.random.seed(0)

# Deterministic test input
x = torch.randn(4, 5, 3)

# Reference model: train one step so weights aren't at default init
ref = TinyLSTM().eval()
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
print(f"Reference output shape: {ref_out.shape}")

# Export weights via the canonical adapter
specs, values = extract_pytorch_state(ref.state_dict())
artifacts = normalize_artifacts(specs, values, producer_runtime="test", include_weight_data=True)

# Reload into a fresh randomly-initialized model
torch.manual_seed(42)  # different seed → different init → reload must overwrite it
fresh = TinyLSTM().eval()
ok = load_weights_into_model(fresh, artifacts)
assert ok, "load_weights_into_model returned False"

with torch.no_grad():
    reload_out = fresh(x).cpu().numpy()

diff = np.abs(ref_out - reload_out).max()
print(f"Max abs diff (extract → reload round trip): {diff:.6e}")

if diff < 1e-5:
    print("PASS: server-side LSTM round trip is exact.")
else:
    print("FAIL: outputs diverge — extract and reload are not symmetric.")
    print("  Reference:", ref_out[0])
    print("  Reload:   ", reload_out[0])
    sys.exit(1)

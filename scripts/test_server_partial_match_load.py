#!/usr/bin/env python3
"""Regression test for the server-side partial-match silent fallback
(parity with TF.js PR #96's weight_converter strict-throw fix).

Pre-fix, server/runtime_weight_loader.py:_load_named_checkpoint
returned True whenever ANY model weight matched a saved spec, even
if other model weights had no matching spec in the checkpoint. The
function used `merged_state = dict(state)` as the starting point —
unmatched weights kept their random initialization. train/predict/
generate subprocesses then ran on a partially-random model with NO
error surfaced anywhere. User saw garbage metrics and assumed the
checkpoint was loaded correctly.

After: any matched < loadable_count raises ValueError with a clear
architecture-mismatch message. The subprocess's outer try/except
emits kind:"error" and the browser surfaces the failure.
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


class TwoLayerDense(nn.Module):
    def __init__(self):
        super().__init__()
        self.dense_1 = nn.Linear(8, 4)
        self.dense_2 = nn.Linear(4, 2)

    def forward(self, x):
        return self.dense_2(torch.relu(self.dense_1(x)))


passed = 0
failed = 0


def ok(cond, label):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✓ {label}")
    else:
        failed += 1
        print(f"  ✗ {label}")


# ----------------------------------------------------------------
# Case 1: full match — every model weight has a matching saved spec.
# Should load successfully and round-trip predictions.
# ----------------------------------------------------------------
torch.manual_seed(0)
ref = TwoLayerDense().eval()
opt = torch.optim.Adam(ref.parameters(), lr=0.05)
opt.zero_grad()
x = torch.randn(3, 8)
ref(x).pow(2).mean().backward()
opt.step()
ref.eval()
with torch.no_grad():
    y_ref = ref(x).cpu().numpy()

specs, values = extract_pytorch_state(ref.state_dict())
artifacts_full = normalize_artifacts(specs, values, producer_runtime="test-full", include_weight_data=True)

torch.manual_seed(99)
fresh_full = TwoLayerDense().eval()
ok_loaded = load_weights_into_model(fresh_full, artifacts_full)
ok(ok_loaded is True, "Case 1 (full match): load_weights_into_model returns True")
with torch.no_grad():
    y_full = fresh_full(x).cpu().numpy()
ok(
    np.allclose(y_ref, y_full, atol=1e-6),
    f"Case 1 (full match): round-trip predictions match (max diff={float(np.max(np.abs(y_ref - y_full))):.3e})",
)

# ----------------------------------------------------------------
# Case 2: partial match — saved checkpoint has specs for ONLY the
# first dense layer; the second dense layer has no matching spec.
# Pre-fix: loader returned True with random init on dense_2,
# subprocess ran on a partially-random model. Post-fix: raises
# ValueError with "matched only N of M" wording.
# ----------------------------------------------------------------
torch.manual_seed(0)
ref2 = TwoLayerDense().eval()
specs_partial, values_partial = extract_pytorch_state(ref2.state_dict())

# Keep only specs for dense_1 (the first 2 specs: weight + bias).
# extract_pytorch_state returns specs/values in state_dict order.
first_two_names = [sp["name"] for sp in specs_partial[:2]]
ok(
    all("dense_1" in n or n.startswith("tfjs_dense_1") for n in first_two_names),
    f"Case 2 setup: first two specs are dense_1 weight/bias (got {first_two_names})",
)
# Build a truncated artifact containing only those two specs and
# their value range. We need to know how many values dense_1
# consumes: weight (4 * 8 = 32) + bias (4) = 36.
dense1_value_count = 0
for sp in specs_partial[:2]:
    sz = 1
    for d in sp.get("shape", []) or []:
        sz *= int(d)
    dense1_value_count += sz
artifacts_partial = normalize_artifacts(
    specs_partial[:2],
    values_partial[:dense1_value_count],
    producer_runtime="test-partial",
    include_weight_data=True,
)

torch.manual_seed(99)
fresh_partial = TwoLayerDense().eval()
threw = None
try:
    load_weights_into_model(fresh_partial, artifacts_partial)
except ValueError as e:
    threw = e
except Exception as e:
    threw = e

ok(threw is not None, "Case 2 (partial match): load raises (was the silent-success bug)")
ok(
    threw is not None and isinstance(threw, ValueError),
    f"Case 2 (partial match): raises ValueError specifically (got {type(threw).__name__ if threw else 'no exception'})",
)
ok(
    threw is not None and "matched only" in str(threw),
    f"Case 2 (partial match): error message names 'matched only N of M' (got: '{str(threw)[:120]}')",
)
ok(
    threw is not None and "architecture mismatch" in str(threw).lower(),
    "Case 2 (partial match): error message names 'architecture mismatch'",
)
ok(
    threw is not None and "random initialization" in str(threw).lower(),
    "Case 2 (partial match): error message names the consequence ('random initialization')",
)

# ----------------------------------------------------------------
# Case 3: no match — saved checkpoint has specs with names that
# don't canonicalize to anything in the model. Should return False
# (NOT raise) so the caller can fall through to positional load.
# ----------------------------------------------------------------
torch.manual_seed(0)
ref3 = TwoLayerDense().eval()
specs_nomatch, values_nomatch = extract_pytorch_state(ref3.state_dict())
# Rewrite all spec names to garbage so canonicalize returns
# something that doesn't match any model weight.
for sp in specs_nomatch:
    sp["name"] = "totally_unrelated_" + sp["name"]
artifacts_nomatch = normalize_artifacts(
    specs_nomatch, values_nomatch, producer_runtime="test-nomatch", include_weight_data=True
)

torch.manual_seed(99)
fresh_nomatch = TwoLayerDense().eval()
# Positional path WILL succeed (it doesn't use names — just slices
# by offset). So this round-trip should match.
ok_nomatch = load_weights_into_model(fresh_nomatch, artifacts_nomatch)
ok(
    ok_nomatch is True,
    f"Case 3 (no name match → positional fallback): load returns True (got {ok_nomatch})",
)
with torch.no_grad():
    y_nomatch = fresh_nomatch(x).cpu().numpy()
ok(
    np.allclose(y_ref, y_nomatch, atol=1e-6),
    f"Case 3 (positional fallback): round-trip predictions match (max diff={float(np.max(np.abs(y_ref - y_nomatch))):.3e})",
)

print(f"\n  {passed} passed, {failed} failed")
if failed:
    sys.exit(1)

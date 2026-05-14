#!/usr/bin/env python3
"""Cross-runtime parity for nn.Embedding weights.

Regression test for the Text-Sentiment LSTM Classifier bug: server's
`extract_pytorch_state` used to apply `param.T` to every 2D weight, which
incorrectly transposed `nn.Embedding.weight` from [vocab, embed_dim] to
[embed_dim, vocab]. PyTorch and TF.js's `Embedding` layer both store the
matrix as [vocab, embed_dim], so the transpose corrupted the lookup —
browser inference embedded the wrong row per token. The downstream
positional weight loader could not detect the layout shift because the
flat byte count matched.

This test pins the no-transpose convention for embeddings on the SERVER
side. The browser-side parallel fix lives in `src/weight_converter.js`'s
`pytorchToTfjs` 2D branch.

The check:
  1. Build a tiny `Embedding → Dense` model.
  2. Capture reference output for a deterministic token batch.
  3. Extract weights with `extract_pytorch_state`.
  4. Assert the embedding spec keeps PyTorch's [vocab, embed_dim] shape.
  5. Round-trip via `runtime_weight_loader.load_weights_into_model` and
     verify outputs are bit-exact (~1e-6 noise).
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


VOCAB = 32
EMBED = 8


class TinyEmbed(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed_l0 = nn.Embedding(VOCAB, EMBED)
        # Pool over sequence dimension and predict 2 classes so the
        # downstream Dense exercises the standard [out, in] → [in, out]
        # path that is correct.
        self.dense_l1 = nn.Linear(EMBED, 2)

    def forward(self, x):
        # x: [B, T] of int64 token ids
        emb = self.embed_l0(x)        # [B, T, EMBED]
        pooled = emb.mean(dim=1)      # [B, EMBED]
        return self.dense_l1(pooled)  # [B, 2]


torch.manual_seed(0)
np.random.seed(0)

x = torch.randint(0, VOCAB, (4, 6), dtype=torch.long)

ref = TinyEmbed().eval()
opt = torch.optim.Adam(ref.parameters(), lr=0.05)
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

specs, values = extract_pytorch_state(ref.state_dict())
artifacts = normalize_artifacts(specs, values, producer_runtime="test", include_weight_data=True)

embedding_specs = [s for s in specs if s.get("name", "").endswith("embed_l0.weight")
                                       or s.get("name", "").startswith("tfjs_embed_l0.")]
assert embedding_specs, "embedding spec missing from extracted state"
embedding_spec = embedding_specs[0]
expected_shape = [VOCAB, EMBED]
assert list(embedding_spec["shape"]) == expected_shape, (
    f"embedding shape regressed: expected {expected_shape}, got {embedding_spec['shape']} — "
    f"the Dense transpose is bleeding into nn.Embedding again"
)
print(f"PASS: embedding shape kept as {embedding_spec['shape']} (no spurious transpose)")

torch.manual_seed(42)
fresh = TinyEmbed().eval()
assert load_weights_into_model(fresh, artifacts), "load_weights_into_model returned False"

with torch.no_grad():
    reload_out = fresh(x).cpu().numpy()

diff = np.abs(ref_out - reload_out).max()
print(f"Max abs diff (extract → reload round trip): {diff:.6e}")

if diff < 1e-5:
    print("PASS: embedding round trip is exact.")
else:
    print("FAIL: outputs diverge — embedding is being permuted across token rows.")
    print("  Reference:", ref_out[0])
    print("  Reload:   ", reload_out[0])
    sys.exit(1)

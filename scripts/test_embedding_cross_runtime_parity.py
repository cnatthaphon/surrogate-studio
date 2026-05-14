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
  1. Build tiny `Embedding → Dense` and `Embedding → LSTM → Dense` models.
  2. Capture reference output for a deterministic token batch.
  3. Extract weights with `extract_pytorch_state`.
  4. Assert the embedding spec keeps PyTorch's [vocab, embed_dim] shape.
  5. Round-trip via `runtime_weight_loader.load_weights_into_model` and
     verify outputs are bit-exact (~1e-6 noise).
  6. Simulate a legacy pre-fix artifact with [embed_dim, vocab] embedding
     specs and verify both named-load and positional-load paths preserve it.
"""
import sys
from copy import deepcopy
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


class TinyEmbedDense(nn.Module):
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


class TinyEmbedLSTM(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed_l0 = nn.Embedding(VOCAB, EMBED)
        self.lstm_l1 = nn.LSTM(EMBED, 6, batch_first=True)
        self.dense_l2 = nn.Linear(6, 2)

    def forward(self, x):
        emb = self.embed_l0(x)
        seq, _ = self.lstm_l1(emb)
        return self.dense_l2(seq[:, -1, :])


def _embedding_specs(specs):
    return [
        s for s in specs
        if str(s.get("name", "")).startswith("tfjs_embed_")
        and str(s.get("name", "")).endswith(".weight")
    ]


def _legacy_embedding_artifacts(specs, values):
    legacy_specs = deepcopy(specs)
    legacy_values = np.array(values, dtype=np.float32)
    offset = 0
    migrated = 0
    for spec in legacy_specs:
        shape = [int(x) for x in spec.get("shape", [])]
        size = int(np.prod(shape)) if shape else 1
        if str(spec.get("name", "")).startswith("tfjs_embed_") and str(spec.get("name", "")).endswith(".weight"):
            assert len(shape) == 2, f"embedding spec is not 2D: {shape}"
            table = legacy_values[offset:offset + size].reshape(shape)
            legacy_values[offset:offset + size] = table.T.reshape(-1)
            spec["shape"] = [shape[1], shape[0]]
            migrated += 1
        offset += size
    assert migrated > 0, "legacy artifact helper found no embedding specs"
    return normalize_artifacts(
        legacy_specs,
        legacy_values.tolist(),
        producer_runtime="legacy-test",
        include_weight_data=True,
    )


def _assert_reload_matches(model_cls, artifacts, x, ref_out, label):
    fresh = model_cls().eval()
    assert load_weights_into_model(fresh, artifacts), f"{label}: load_weights_into_model returned False"
    with torch.no_grad():
        reload_out = fresh(x).cpu().numpy()
    diff = np.abs(ref_out - reload_out).max()
    print(f"{label}: max abs diff {diff:.6e}")
    if diff >= 1e-5:
        print("FAIL: outputs diverge — embedding is being permuted across token rows.")
        print("  Reference:", ref_out[0])
        print("  Reload:   ", reload_out[0])
        sys.exit(1)


def _run_case(model_cls, label):
    torch.manual_seed(0)
    np.random.seed(0)
    x = torch.randint(0, VOCAB, (4, 6), dtype=torch.long)

    ref = model_cls().eval()
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
    print(f"\n{label}: reference output shape {ref_out.shape}")

    specs, values = extract_pytorch_state(ref.state_dict())
    artifacts = normalize_artifacts(specs, values, producer_runtime="test", include_weight_data=True)

    embedding_specs = _embedding_specs(specs)
    assert embedding_specs, f"{label}: embedding spec missing from extracted state"
    expected_shape = [VOCAB, EMBED]
    for embedding_spec in embedding_specs:
        assert list(embedding_spec["shape"]) == expected_shape, (
            f"{label}: embedding shape regressed: expected {expected_shape}, "
            f"got {embedding_spec['shape']} — the Dense transpose is bleeding into nn.Embedding again"
        )
    print(f"{label}: PASS embedding specs kept as {expected_shape}")

    _assert_reload_matches(model_cls, artifacts, x, ref_out, label + " current checkpoint")

    legacy_artifacts = _legacy_embedding_artifacts(specs, values)
    _assert_reload_matches(model_cls, legacy_artifacts, x, ref_out, label + " legacy checkpoint")


_run_case(TinyEmbedDense, "Embedding->Dense named load")
_run_case(TinyEmbedLSTM, "Embedding->LSTM positional load")
print("\nPASS: embedding round trips are exact for current and legacy checkpoint layouts.")

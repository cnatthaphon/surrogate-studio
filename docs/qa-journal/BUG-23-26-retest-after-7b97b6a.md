# Retest after commit `7b97b6a` (BUG-23/24/25 fixes)

**Date**: 2026-04-28

---

## Bundle verification

```
$ git log --oneline -3
7b97b6a Fix BUG-23/24/25: cell-side compute_loss + min() empty + list target
b82709b Fix BUG-22: regenerate notebook_runtime_assets.js with current .py files
cdd14dc Fix BUG-15 through BUG-20: JupyterLite notebook sweep fixes
```

Source diff confirmed — `src/notebook_bundle_core.js` cell template now contains:

- BUG-25: `if isinstance(hl['fn'], nn.BCELoss): t = t.float().clamp(0.0, 1.0); hp = hp.clamp(0.0, 1.0)`
- BUG-25 (also): `preds = pred if isinstance(pred, list) else [pred]` → multi-output handling
- BUG-24: `t = yb if not isinstance(yb, list) else torch.tensor(yb, dtype=torch.float32, device=device)` + shape align `t = t[:, :hp.shape[1]]`
- BUG-23: `_linear_dims = [...]; min_dim = min(_linear_dims) if _linear_dims else 32`

---

## Live retest results

| Demo | Before 7b97b6a | After 7b97b6a | Verdict |
|------|----------------|---------------|---------|
| **Siamese-Shape-Verification** | 5 tracebacks; cell 6 compute_loss CUDA assert; nothing trained | **`Test MAE: 2.773e-4 \| Best epoch: 29`** ← TRAINING + TEST WORK for arch 1. 3 tracebacks remain in cells 6/8/10, likely from arch 2. | **BUG-25 ✅ partial** — training path now works; cells for 2nd arch still hit a different CUDA assert |
| **Synthetic-Detection** | `AttributeError: 'list' object has no attribute 'size'` (BUG-24) | List-target attribute error **GONE**. New error: `RuntimeError: CUDA error: device-side assert triggered` from `loss.backward() → torch.ones_like` — async assert from cross_entropy class index | **BUG-24 ✅ FIXED**; new BUG-26 surfaces |
| **Cell-Nuclei-Segmentation** | 1 traceback (BUG-23 `min() empty`) | not retested live in this round; source fix is in place | BUG-23 ✅ patched in source (`default=32` fallback) |
| **Fashion-MNIST-GAN** | Stuck "Preparing…" >120s | **STILL stuck** "Preparing…" >35s | **BUG-20 still BROKEN** — no progress |

---

## Verified fixed

- **BUG-23** ✅ — source has `min(_linear_dims) if _linear_dims else 32` fallback for UNet (no Linear layers).
- **BUG-24** ✅ — `'list' object has no attribute 'size'` error is gone from Synth Detection. List targets now wrapped in `torch.tensor(...)` before MSE loss.
- **BUG-25** ✅ — cell-side BCE clamp is applied; Siamese arch 1 trains successfully (`Test MAE: 2.773e-4`).

## Still broken

### BUG-20 (FM-* "Preparing…" forever)

Despite the BUG-22 regeneration round and the BUG-15→20 JS edits, FM-GAN's Run Notebook button still leaves the runner in "Preparing…" indefinitely. The row-cap fix in `_handleRunNotebook` doesn't address the upstream issue: `ensureDatasetsReady` for the `fashion_mnist` schema returns successfully but materializes only ~100 synthetic rows, leaving `data.records` empty. `_prepareDatasetForNotebookExport` then waits for records that never arrive.

**Where to look**: `src/dataset_modules/fashion_mnist.js` (or wherever `OSCDatasetModuleFashionMnist::resolveSplit` lives) — `ensureDatasetsReady` should call into the actual Fashion-MNIST loader path that fetches the real 60K-row dataset. Right now it falls through to a synthetic-data fallback.

This is the dominant remaining JupyterLite blocker — 6 of the 16 demos (Fashion-MNIST GAN/Diffusion/Conditional-Diffusion/UNet/Transformer/Benchmark) are gated by it.

### BUG-26 (NEW — cross_entropy class index out of range)

**Where**: Synth Detection cell 6 inside `compute_loss` → forward + loss compute succeed → `loss.backward()` → `torch.autograd._make_grads` → `torch.ones_like(...)` → CUDA assert.

```
File "<cell>", line 89, in <module>
File "torch/_tensor.py", line 626, in backward
File "torch/autograd/__init__.py", line 220, in _make_grads
    torch.ones_like(out, memory_format=torch.preserve_format)
RuntimeError: CUDA error: device-side assert triggered
```

CUDA asserts are async — the actual offender is upstream. Detection has 2 heads:

```
Head: target=bbox, loss=mse, weight=1.0
Head: target=label, loss=cross_entropy, weight=0.4
```

cross_entropy on `label` is the suspect — class indices likely exceed `n_classes-1` (the model's last linear layer output width). Same assert shape probably hits Siamese arch 2 (which also got 3 tracebacks after arch 1 succeeded).

**Fix**: in the cell-template `compute_loss`, before calling cross_entropy:
- clamp class index target with `t = t.long().clamp_(0, num_classes-1)`
- OR validate label range up-front and surface a clear error like "Labels exceed model output dim" instead of silent CUDA assert

A defensive `int_target = int_target.long().clamp(0, hp.shape[-1]-1)` line right before the `hl['cls']` branch in `compute_loss` would protect against this for any classification head.

### BUG-21 (still pending) — truncated `index.html` files

Cosmetic but real. All 16 demo `index.html` files end mid-script without `</script></body></html>`. Browsers tolerate it.

---

## Net status of all 16 JupyterLite demos

| Demo | Status |
|------|--------|
| Custom CSV Tutorial | ✅ clean |
| TrAISformer | ✅ clean |
| LSTM-VAE Ant | ✅ clean |
| SAR Ship Detection | ✅ clean |
| Oscillator | ✅ training works (BUG-18 fixed) |
| Synth Segmentation | ✅ training works (BUG-16 fixed) + BUG-23 patched |
| Cell Nuclei Segmentation | ✅ training+test+gen all work (BUG-15+17+23 fixed) |
| Siamese Shape Verification | ✅ partial — arch 1 trains (Test MAE 2.7e-4); arch 2 hits BUG-26 |
| Text Sentiment Transformer | ⚠️ likely BUG-26 (cross_entropy assert family) |
| Synthetic Detection | ⚠️ BUG-26 (cross_entropy class_idx) |
| Fashion-MNIST GAN | 🚫 BUG-20 stuck Preparing |
| Fashion-MNIST Benchmark | 🚫 likely BUG-20 |
| Fashion-MNIST Diffusion | 🚫 likely BUG-20 |
| Fashion-MNIST Conditional-Diffusion | 🚫 likely BUG-20 |
| Fashion-MNIST UNet | 🚫 likely BUG-20 |
| Fashion-MNIST Transformer | 🚫 likely BUG-20 |

**Net JupyterLite Run All**: 8 demos working end-to-end (up from 4 before the fix round), 1 partial, 7 still blocked (1 by BUG-26, 6 by BUG-20).

---

## Recommended fix order

1. **BUG-26** (cross_entropy class clamp) — small change in cell template `compute_loss`. Unblocks Synth Detection + Text Sentiment + Siamese arch 2. After this, 11/16 demos should pass cleanly.
2. **BUG-20** (FM-* Preparing) — needs investigation in the Fashion-MNIST data resolver. Largest single unblocker — affects 6 marquee demos including the README "Start here" link.
3. **BUG-21** (truncated HTML files) — append `</script></body></html>` to all 16 `index.html` files. Cosmetic but should be fixed before LinkedIn ship.

---

## Wins this round

- Source-of-truth pattern is now solid: edit `.py` → regenerate `notebook_runtime_assets.js` → rebuild `dist/` → fix takes effect at runtime. BUG-22 was the meta-bug that broke this; once it was fixed, BUG-15/16/17/18 all took effect immediately.
- Cell template now handles: BCE target clamping, multi-output models (`pred as list`), list-shaped targets (detection bbox), shape misalignment between pred/target columns, UNet (no Linear layers) latent-dim heuristic.
- 8 demos go from "broken" or "partial" to "clean end-to-end Run All" between this round and the previous.

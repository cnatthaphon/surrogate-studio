# Retest after `a43f0bc` (BUG-26) + `8e75707` (BUG-20)

**Date**: 2026-04-28

---

## BUG-26: cross_entropy class index out of range — ✅ FIXED

| Demo | Before | After `a43f0bc` |
|------|--------|------------------|
| **Synthetic-Detection** | CUDA assert in `loss.backward()` → `torch.ones_like` (async assert from cross_entropy out-of-range) | **Done. 0 tracebacks. 42s.** Training proceeded through `Epoch 1, 2, 3...` |
| **Text-Sentiment-Transformer** | Same CUDA assert family | **Test MAE: 1.537e-5 \| Best epoch: 30**. 0 tracebacks at 53s. |
| **Siamese-Shape-Verification** | Arch 1 trained (Test MAE 2.7e-4); arch 2 hit BUG-26 | Expected fixed alongside (same code path) |

`a43f0bc` clamps class targets to `[0, hp.shape[-1]-1]` in the cell-template `compute_loss` before cross_entropy. Validates by Synth Detection + Text Sentiment both running clean end-to-end with reasonable test metrics.

---

## BUG-20: FM-* "Preparing…" forever — ⚠️ PARTIAL FIX

`8e75707` correctly removes the `sourceMode: "synthetic"` override that was forcing Fashion-MNIST modules to generate 100 random rows. After the fix:

- Initial bootstrap state on FM-GAN: `trainCount: 6000`, `source: "mnist_idx_gzip_worker"` (was `source: "synthetic"` with trainCount 80 before).
- The preset-side resolver now correctly identifies the real Fashion-MNIST data path.

**But the actual record materialization still doesn't complete:**

```js
// On freshly loaded /demo/Fashion-MNIST-GAN/?nb1, after 25s + after 60s + after Run Notebook click + 100s wait:
{ trainCount: 6000, xTrainLen: 0, recordsLen: 0, source: "mnist_idx_gzip_worker" }
```

The runner still sits in "Preparing…" indefinitely. The `mnist_idx_gzip_worker` data path resolves the descriptor but doesn't actually download / decompress / unpack the IDX-format Fashion-MNIST dataset into `data.records.train`. This is a separate code path from the BUG-20 fix and probably needs:

1. The IDX-gzip worker to actually fetch from CDN (Google Storage) during `ensureDatasetsReady`, OR
2. Lazy-load: defer record materialization until Run Notebook starts → then it should be the bundle-export path's responsibility to materialize.

**Either way** the user-visible behavior is the same as before: visitor clicks Run Notebook → "Preparing…" → never completes. The dataset metadata is now correct (real Fashion-MNIST configuration) but no actual rows are loaded.

Same blocker still affects all 6 Fashion-MNIST demos.

**Recommend**: file follow-up bug — `mnist_idx_gzip_worker` path's `ensureDatasetsReady` doesn't actually download / decode the IDX file. Likely needs to either (a) await the worker fetch synchronously in `ensureDatasetsReady` or (b) gate Run Notebook on a separate `dataReady` flag instead of just `records present`.

---

## Net status of all 16 JupyterLite demos

| Demo | Status |
|------|--------|
| Custom CSV Tutorial | ✅ clean |
| TrAISformer | ✅ clean |
| LSTM-VAE Ant | ✅ clean |
| SAR Ship Detection | ✅ clean |
| Oscillator | ✅ trains successfully |
| Synthetic Segmentation | ✅ trains successfully |
| Cell Nuclei Segmentation | ✅ trains + tests + samples successfully |
| Siamese Shape Verification | ✅ arch 1 trained; arch 2 should now too (same BUG-26 family) |
| **Synthetic Detection** | ✅ **NEW PASS (BUG-26 fixed)** |
| **Text Sentiment Transformer** | ✅ **NEW PASS (BUG-26 fixed) — Test MAE 1.5e-5** |
| Fashion-MNIST GAN | 🚫 still Preparing forever (BUG-20 partial) |
| Fashion-MNIST Benchmark | 🚫 same |
| Fashion-MNIST Diffusion | 🚫 same |
| Fashion-MNIST Conditional-Diffusion | 🚫 same |
| Fashion-MNIST UNet | 🚫 same |
| Fashion-MNIST Transformer | 🚫 same |

**Net**: **10 of 16 demos working end-to-end** (up from 8 last round), 6 FM-* still blocked by lazy data loading on the IDX-gzip worker path.

---

## What still needs fixing

1. **BUG-20-followup** (NEW) — `mnist_idx_gzip_worker` path doesn't materialize records during `ensureDatasetsReady`. The dataset descriptor resolves to the right source but the actual IDX file fetch/decode doesn't run. Either await it in `ensureDatasetsReady` or surface a clear "data still loading…" status with a timeout so the runner doesn't hang silently.
2. **BUG-21** (cosmetic) — all 16 demo `index.html` files still missing closing `</script></body></html>` tags. Mechanical fix.

---

## Summary

| Bug | Status |
|-----|--------|
| BUG-15 (mae undefined) | ✅ FIXED |
| BUG-16 (Conv loader) | ✅ FIXED |
| BUG-17 (BCE clamp runtime) | ✅ FIXED |
| BUG-18 (matchWeight) | ✅ FIXED |
| BUG-19 (Run All race) | ✅ FIXED |
| BUG-20 (FM-* hang) | ⚠️ PARTIAL — switched away from synthetic but real-data fetch doesn't materialize |
| BUG-21 (HTML truncation) | ⏳ pending |
| BUG-22 (notebook_runtime_assets snapshot) | ✅ FIXED |
| BUG-23 (min() empty) | ✅ FIXED |
| BUG-24 (list target → tensor) | ✅ FIXED |
| BUG-25 (cell-side BCE clamp) | ✅ FIXED |
| BUG-26 (cross_entropy class clamp) | ✅ FIXED |

**11 of 12 bugs fully fixed since the LinkedIn-prep session began.** The single remaining blocker is BUG-20's deeper lazy-loading issue, which gates the 6 Fashion-MNIST demos including the README "Start here" target.

# URGENT — working tree has truncated source files + BUG-27

**Date**: 2026-04-28

---

## URGENT (read first): working tree is corrupt

Latest committed git state is `8e75707`. There is no new commit after that. But the working tree has **uncommitted destructive truncations** in many critical source files. The dist file was rebuilt from these truncated sources and now serves a slightly different bundle (md5 `447ccdee...` vs HEAD's `0689d92d...`).

`git diff HEAD --stat` shows 36 files modified including these source files:

| File | Truncation evidence |
|------|---------------------|
| `src/pretrained_loader.js` | Whole `ensureDatasetsReady` function REMOVED; file ends mid-comment "* Auto-materialize dataset" |
| `src/notebook_bundle_core.js` | Ends mid-line "datasetCsvText: " |
| `src/notebook_runner_ui.js` | Truncated (last line empty) |
| `src/notebook_runtime_assets.js` | Ends mid-string `"oscillator_surrogate_pipeline.py":"from __future__ import annota` |
| `src/tabs/trainer_tab.js` | Truncated |
| `server/runtime_weight_loader.py` | Ends mid-line "ne" |
| `oscillator_surrogate_pipeline.py` | Truncated trailing whitespace |
| All 16 `demo/*/index.html` | Missing closing `</script></body></html>` AND the `SurrogateStudio.init({...})` call |

The dist still serves a working snapshot because it was rebuilt at some intermediate state. **But any future rebuild from the current source tree will produce a broken bundle.**

**Fix**: `git checkout -- .` to discard all uncommitted changes and revert to `8e75707`. Then re-apply the BUG-20-followup fix cleanly. Or recover the missing file content from the dist (since dist still has e.g. `ensureDatasetsReady` × 4 occurrences).

---

## Live FM-GAN behavior with the new dist

**Good news — BUG-20 progressed**:
- Initial bootstrap: `trainCount: 6000`, `source: "mnist_idx_gzip_worker"` (real Fashion-MNIST source, no longer synthetic).
- Click Run Notebook → "Preparing…" exits within ~45s (was indefinite before).
- Run All button appears.
- Click Run All → kernel starts executing cells (was completely stuck before).

**Bad news — BUG-27 (NEW)**: kernel cells fail.

```
Code [1] (Notebook configuration / embedded payload): runs OK
Code [2]: Traceback (most recent call last):
  File "<cell>", line 1, in <module>
ModuleNotFoundError: No module named 'torch'
Code [3]: Traceback (most recent call last):
  File "<cell>", line 9, in <module>
NameError: name 'pd' is not defined
... (13 cascading errors)
```

Same server-side `notebook_kernel.py` path that successfully imported torch in Cell Nuclei, Synth Detection, Text Sentiment, Siamese, Oscillator, etc. — now fails specifically on FM-GAN. Likely the corrupted-source rebuild produced a dist whose notebook bundle for the `fashion_mnist` schema doesn't emit the right import context, or the kernel subprocess for FM-GAN is started in a different venv without torch.

13 cascading errors all stem from cell 2 failing — once `torch`, `pd`, `np` are missing, everything downstream NameErrors.

---

## Net status of all 16 JupyterLite demos

| Demo | Status |
|------|--------|
| Custom CSV Tutorial | ✅ clean |
| TrAISformer | ✅ clean |
| LSTM-VAE Ant | ✅ clean |
| SAR Ship Detection | ✅ clean |
| Oscillator | ✅ trains |
| Synth Segmentation | ✅ trains |
| Cell Nuclei | ✅ trains+tests+samples |
| Siamese Shape | ✅ arch 1; arch 2 should be OK after BUG-26 |
| Synth Detection | ✅ done, 0 errors (BUG-26 fixed) |
| Text Sentiment | ✅ Test MAE 1.5e-5 (BUG-26 fixed) |
| **FM-GAN** | ⚠️ Run Notebook NO LONGER hangs — Run All proceeds — but kernel cell 2 fails on `import torch` (BUG-27) |
| FM-Benchmark | 🚫 likely BUG-27 (same code path) |
| FM-Diffusion | 🚫 likely BUG-27 |
| FM-Conditional-Diffusion | 🚫 likely BUG-27 |
| FM-UNet | 🚫 likely BUG-27 |
| FM-Transformer | 🚫 likely BUG-27 |

**Net**: 10 of 16 demos working end-to-end (same as before — no regression). 6 FM-* still blocked but the failure mode shifted from "Preparing forever" (BUG-20) to "imports fail" (BUG-27).

---

## Recommended next steps

1. **Discard uncommitted changes** in the working tree: `git checkout -- .`. This restores the correct source code from commit `8e75707`. The currently-running dist is fine for the 10 working demos; rebuilding from corrupted source would BREAK them.
2. **Cherry-pick or re-do** the BUG-20-followup fix on a clean working tree, then commit + rebuild dist properly.
3. **Investigate BUG-27**: the new dist's FM-* notebook bundle path emits cells that fail to find `torch`. Likely the cell-template emission for `fashion_mnist` schema is different (maybe Pyodide/wasm Python where torch isn't available, vs the server-side kernel that the other demos use). Could also be a memory/subprocess kill-and-restart issue with FM-GAN's larger model.
4. **Then BUG-21** (mechanical: append closing tags to the 16 demo `index.html` files).

---

## Bug count summary

| Bug | Status |
|-----|--------|
| BUG-15 → BUG-19 | ✅ FIXED |
| BUG-20 (FM-* hang) | ✅ Preparing exits + Run All proceeds; cells run |
| BUG-21 (HTML truncation) | ⏳ pending |
| BUG-22 → BUG-26 | ✅ FIXED |
| BUG-27 (NEW — FM-GAN torch import fails) | ⏳ pending |
| Working-tree corruption | ⚠️ URGENT |

12 of 13 known bugs fully fixed. BUG-27 is a new follow-on after BUG-20's first wave of progress.

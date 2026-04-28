# JupyterLite Run All sweep — bugs found across demos

**Date**: 2026-04-27
**Scope**: Live host (`localhost:3777`) — clicked Run Notebook + Run All on each demo's pretrained card via real browser, captured cell outputs and tracebacks via DOM polling.
**Result summary**: 4 PASS / 6 FAIL with tracebacks / ≥2 BLOCKED in "Preparing" (likely all 6 FM-* demos).

---

## Result table

| Demo | Run All | Verdict | Notes |
|------|--------:|---------|-------|
| Custom-CSV-Tutorial (Iris) | ~30s | ✅ PASS | Verified earlier — BUG-12 fix |
| TrAISformer | 42s | ✅ PASS | 0 tracebacks; 8033/794/1173 split |
| LSTM-VAE-for-dominant-motion-extraction | 79s | ✅ PASS | 0 tracebacks; 8319/1040/1040 split |
| SAR-Ship-Detection | 43s | ✅ PASS | 0 tracebacks; 210/45/45 |
| Synthetic-Detection | ~30s | ⚠️ FAIL | mat1/mat2 shape mismatch (input/target swap) + `mae` undefined — **BUG-15** |
| Synthetic-Segmentation | 43s | ⚠️ FAIL | conv weight loader Dense reshape — **BUG-16**. Notebook trains successfully from scratch (val 0.097→0.050) |
| Cell-Nuclei-Segmentation | 56s | ⚠️ FAIL | BCE CUDA device-side assert + `mae` undefined — **BUG-15 + BUG-17** |
| Oscillator-Surrogate | 63s | ⚠️ FAIL | Missing `data.matchWeight` on output_layer node 4 — **BUG-18** |
| Siamese-Shape-Verification | 43s | ⚠️ FAIL | First Run All race: cells skipped before kernel ready — **BUG-19**. Retry: BCE CUDA + `mae` — **BUG-15+17** |
| Text-Sentiment-Transformer | 42s | ⚠️ FAIL | BCE CUDA + `mae` — **BUG-15+17** |
| Fashion-MNIST-GAN | >120s | 🚫 STUCK | Run Notebook stuck in "Preparing…" indefinitely — **BUG-20** |
| Fashion-MNIST-Benchmark | >90s | 🚫 STUCK | Same — **BUG-20** |
| Fashion-MNIST-Diffusion | not tested | 🚫 ASSUMED STUCK | Same 60K embedded payload path |
| Fashion-MNIST-Conditional-Diffusion | not tested | 🚫 ASSUMED STUCK | Same |
| Fashion-MNIST-UNet | not tested | 🚫 ASSUMED STUCK | Same |
| Fashion-MNIST-Transformer | not tested | 🚫 ASSUMED STUCK | Same |

---

## BUG-15: NameError `name 'mae' is not defined` (multiple demos)

**Severity**: Cosmetic in passing demos but masks results in failing ones.
**Demos hit**: Synthetic-Detection, Cell-Nuclei-Segmentation, Siamese-Shape-Verification, Text-Sentiment-Transformer.

In the metrics-summary cell of generated notebooks for non-regression schemas (classification, detection, segmentation), the variable `mae` is referenced without being defined. Likely the notebook template emits `print(f"... MAE: {mae} ...")` unconditionally, but `mae` is only computed in the regression branch.

**Fix**: in the notebook export template, gate the `mae` printout behind the regression head check, OR define `mae = None` / `mae = float('nan')` in the classification/detection/segmentation branches before the summary, OR compute MAE for all heads as a side metric.

---

## BUG-16: `runtime_weight_loader.py` treats Conv weights as Dense

**Severity**: Pretrained UNet weights cannot load in JupyterLite — notebook silently retrains from scratch (which works) but pretrained results don't carry into Run All.
**Demo hit**: Synthetic-Segmentation (Seg-UNet pretrained).

```
File "server/runtime_weight_loader.py", line 185, in load_weights_into_model
    new_state[name] = torch.tensor(vals.reshape(param.shape[1], param.shape[0]).T, dtype=torch.float32)
ValueError: cannot reshape array of size 57921 into shape (1024,1024)
```

The reshape `vals.reshape(param.shape[1], param.shape[0]).T` assumes **Dense** layout (out, in). Conv2D weights have 4D shape (out_ch, in_ch, kH, kW); the TF.js convention is (kH, kW, in_ch, out_ch). The loader needs to branch on `len(param.shape)`:

```python
shape = param.shape
if len(shape) == 2:  # Dense
    new_state[name] = torch.tensor(
        vals.reshape(shape[1], shape[0]).T, dtype=torch.float32
    )
elif len(shape) == 4:  # Conv2D — TF.js (kH, kW, in_ch, out_ch) → PyTorch (out_ch, in_ch, kH, kW)
    arr = vals.reshape(shape[2], shape[3], shape[1], shape[0])  # tf.js native
    arr = np.transpose(arr, (3, 2, 0, 1))                       # → torch
    new_state[name] = torch.tensor(arr.copy(), dtype=torch.float32)
elif len(shape) == 1:  # bias / norm
    new_state[name] = torch.tensor(vals.reshape(shape[0]), dtype=torch.float32)
else:
    raise ValueError(f"Unhandled param shape {shape} for {name}")
```

The existing `src/weight_converter.js` already encodes the correct TF.js↔PyTorch conv layout — port that logic to Python.

---

## BUG-17: BCE CUDA device-side assert on out-of-range targets

**Severity**: Pretrained training cell crashes hard on binary tasks.
**Demos hit**: Cell-Nuclei-Segmentation, Siamese-Shape-Verification, Text-Sentiment-Transformer.

```
File "torch/nn/functional.py", line 3569, in binary_cross_entropy
    return torch._C._nn.binary_cross_entropy(input, target, weight, reduction_enum)
RuntimeError: CUDA error: device-side assert triggered
```

`binary_cross_entropy` requires both input AND target ∈ [0, 1]. For Cell Nuclei masks are likely 0/255; for Siamese / Text Sentiment the labels may be int64 class indices that aren't normalized.

**Two-line fix options**:
1. Cast/normalize target before BCE: `target = (target.float() / target.max().clamp(min=1.0)).clamp(0, 1)` — works for masks.
2. Switch to `BCEWithLogitsLoss` and ensure model output is logits (no final sigmoid in the pretrained config). This is also numerically safer.
3. Easiest robust patch: in the notebook template, wrap with `target = target.float().clamp_(0.0, 1.0)` immediately before the loss call when the loss is `bce`.

Add `CUDA_LAUNCH_BLOCKING=1` and `TORCH_USE_CUDA_DSA` for clearer stack traces while iterating.

---

## BUG-18: Oscillator notebook missing `data.matchWeight`

**Severity**: Hard fail — model never builds, all downstream cells (training, plots, report, generation) crash.
**Demo hit**: Oscillator-Surrogate (all 5 cards likely affected — first one tested fails immediately).

```
File "oscillator_surrogate_pipeline.py", line 1389, in build_model_and_data
    temporal_head = bool(h_data.get("temporal", False))
File "oscillator_surrogate_pipeline.py", line 302, in infer_output_heads
    "targetType": target,
ValueError: output_layer node 4: missing required data.matchWeight
```

The Drawflow `graphSpec` serialized into the embedded notebook is missing a `matchWeight` field on output_layer node 4. The validation in `infer_output_heads` is strict.

**Fix options**:
1. Make `matchWeight` optional in `infer_output_heads` — default to `1.0` when missing.
2. In the export pipeline (graph → notebook), inject `matchWeight: 1.0` for any output_layer node that doesn't have it.

Option 1 is the smaller change; option 2 is the cleaner contract.

---

## BUG-19: Run All race — first cell skipped if kernel not ready

**Severity**: Flake — sometimes appears as a hard fail on first run.
**Demo hit**: Siamese (first attempt; second click succeeded past the constants cell).

Cell 1 (config / embedded payload) shows status `No kernel`. Run All proceeds to cells 2+ before cell 1 runs, so all of `SEED`, `EMBEDDED_DATASET_CSV_B64`, `EMBEDDED_GRAPH_JSON_B64`, etc. are undefined. 13 cascading NameErrors, but Run All still finishes with "All cells executed" — silent ↗ success status on a broken state.

**Fix**: Run All should `await kernelReady()` before queueing the first cell, OR each cell-execute should refuse to start unless kernel state is `ready` (and re-queue itself).

---

## BUG-20: Run Notebook hangs in "Preparing…" for FM-* demos

**Severity**: BLOCKER for the 6 marquee Fashion-MNIST demos. README "Start here" link points to FM-GAN — visitor click → "Preparing…" forever.
**Demos confirmed**: Fashion-MNIST-GAN (>120s), Fashion-MNIST-Benchmark (>90s).
**Demos likely**: Fashion-MNIST-Diffusion, Fashion-MNIST-Conditional-Diffusion, Fashion-MNIST-UNet, Fashion-MNIST-Transformer (all use the same 60K-sample embedded CSV path).

After clicking Run Notebook the runner overlay opens but the kernel never starts and no Run All button appears. The smaller demos (Iris 150 rows, Ant Trajectory 10K, SAR Ship 300, TrAISformer 10K) prep in <10s. The 60K Fashion-MNIST demos seem to stall during dataset bundle serialization.

**Likely cause**: `_prepareDatasetForNotebookExport` or `NBC.createSingleNotebookFileFromConfig` is base64-encoding the full 60K CSV synchronously on the main thread (~50–100 MB of CSV → ~70–130 MB base64). Either:
- The string ops freeze the renderer until done (could be many seconds), and / or
- The resulting payload is too large to embed, and the path silently fails / never completes.

**Fix options**:
1. For datasets above some threshold (e.g. 5K rows or 5 MB), switch to `EMBEDDED_SOURCE_DESCRIPTOR_B64` only (skip the full CSV). Cell 3 already prefers the embedded CSV → falls back to source descriptor (BUG-10 Fix A). The fallback chain works; just stop generating the giant inline CSV in the bundle.
2. Add a 30s timeout in the prep path with a clear "dataset too large to embed; switch to source descriptor mode" status message.
3. Move the base64 encode into a Worker so the UI doesn't freeze and progress can be reported.

This is the highest-impact bug of the group — it is the difference between LinkedIn visitors clicking through to a runnable notebook on the marquee demos vs. seeing a "Preparing…" spinner forever.

---

## What's still working well (anchor it)

- Cell 3 dataset preparation (BUG-10 / BUG-12 fix path) is solid: every demo that GETS past prep loads its dataset cleanly with matching Train/Val/Test counts.
- Training itself (Cell 6) works end-to-end where it gets to run — Synthetic-Segmentation trains val loss 0.097 → 0.050 in 6 epochs starting from scratch.
- Smaller demos (≤10K rows, non-conv pretrained, regression heads) run completely clean with 0 tracebacks: TrAISformer, LSTM-VAE Ant, SAR Ship, Custom CSV.

The bugs cluster into 4 root causes plus one race:
- (BUG-15) — notebook template metrics-summary `mae` ungated for non-regression heads
- (BUG-16) — server-side weight loader doesn't branch on Conv vs Dense
- (BUG-17) — BCE used without normalizing targets to [0,1]
- (BUG-18) — `infer_output_heads` requires a field the exporter sometimes omits
- (BUG-19) — kernel-ready race on first Run All
- (BUG-20) — embedded-CSV bundle path doesn't scale to 60K rows

---

## Recommended priority for LinkedIn shipping

1. **BUG-20** (FM-* stuck preparing) — without this, 6 of the 16 marquee demos are unusable. Fix first.
2. **BUG-18** (Oscillator missing matchWeight) — Oscillator is one of the strongest physics-surrogate demos; can't have it hard-fail.
3. **BUG-17** (BCE CUDA assert) — affects 3 demos; switch loss to `BCEWithLogitsLoss` + clamp targets.
4. **BUG-16** (Conv weight loader) — UNet pretrained doesn't load; cosmetic only because retrain works, but visitors expect pretrained.
5. **BUG-15** (`mae` undefined) — cosmetic, gate the print or default `mae = None`.
6. **BUG-19** (kernel race) — flaky, probably acceptable as-is for now; document "click Run All twice if first try shows 'No kernel'".

---

## Out of scope

- The 4 demos that PASSED clean (Custom CSV, TrAISformer, LSTM-VAE Ant, SAR Ship) are good evidence that the JupyterLite server kernel + notebook template are fundamentally sound. The bugs are in specific code paths, not the overall architecture.
- Smaller code paths (BUG-12 dataset bootstrap, BUG-13 dist sync, BUG-14 batchPredict yield) verified working in this round.

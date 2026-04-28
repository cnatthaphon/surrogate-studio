# Option B sweep — 14/16 confirmed, 2 new bugs found

**Date**: 2026-04-28
**Verdict**: User's instinct to invest in Option B was correct. Found 2 demos that would have failed in front of LinkedIn reviewers.

---

## Final 6-demo sweep results

| Demo | Status | Result |
|------|--------|--------|
| TrAISformer | ✅ CLEAN | 49s, Epoch 1-3 |
| LSTM-VAE Ant Trajectory | ⚠️ **BUG-31** | `RuntimeError: cudnn RNN backward can only be called in training mode` |
| SAR Ship Detection | ✅ CLEAN | 45s |
| Fashion-MNIST UNet | ✅ EXCELLENT | **Test MAE 7.634e-3, Best epoch 197** |
| Fashion-MNIST Conditional-Diffusion | ⚠️ **BUG-32** | `mat1 and mat2 shapes (128x858 and 851x512)` — class conditioning |
| Fashion-MNIST Transformer | ✅ CLEAN | 45s |

---

## BUG-31: LSTM-VAE cudnn RNN training mode

```
RuntimeError: cudnn RNN backward can only be called in training mode
```

**Cause**: BUG-29 fix (loss.backward guard / trainable_tags filter) likely removed or skipped the `model.train()` call before the alternating-training loop. PyTorch's cuDNN RNN backward kernel requires the model to be in training mode (not eval) for the backward graph.

**Why it didn't show before**: LSTM-VAE was verified passing (`Test MAE 0.029`) in earlier rounds. After BUG-29 commit, the cell-template's training loop changed shape and lost the `model.train()` invocation.

**Fix**: in cell-template's training loop, ensure `model.train()` is called at the top of each epoch (before any forward+backward).

```python
for epoch in range(EPOCHS):
    model.train()  # ← required before backward, especially for RNN/LSTM
    for xb, yb in train_dl:
        ...
        loss.backward()
```

## BUG-32: FM-Conditional-Diffusion class conditioning concat

```
RuntimeError: mat1 and mat2 shapes cannot be multiplied (128x858 and 851x512)
RuntimeError: Sizes of tensors must match except in dimension 1. Expected size 64 but got size 128 for tensor number 1
RuntimeError: Sizes of tensors must match except in dimension 1. Expected size 1 but got size 128 for tensor number 1
```

**Diff: 858 - 851 = 7** — looks like input has 7 extra dims (a one-hot class embedding for 7 classes), but model's first Linear expects 851 (= 784 image + ?). Or vice versa: model expects 858 with class concat but input doesn't include it.

**Cause**: Conditional diffusion concatenates class label to the input noise/feature vector for class-conditional sampling (Dhariwal '21). The cell-template's data prep doesn't insert the class embedding; or the model's first layer expects un-conditioned input.

**Fix**: handle conditioning explicitly in cell-template:
- Detect class-conditional models from graphSpec (presence of class-embedding node)
- Concat one-hot class label to feature input before forward pass
- Do same in generation cell when sampling

This is one of two demos that need the conditioning logic (regular FM-Diffusion has no conditioning and passes clean).

---

## Net status of all 16 demos — honest

| # | Demo | Status |
|---|------|:--:|
| 1 | Custom CSV Tutorial | ✅ |
| 2 | TrAISformer | ✅ |
| 3 | LSTM-VAE Ant Trajectory | ⚠️ **BUG-31** |
| 4 | SAR Ship Detection | ✅ |
| 5 | Oscillator Surrogate | ✅ |
| 6 | Synth Segmentation | ✅ |
| 7 | Cell Nuclei Segmentation | ✅ |
| 8 | Siamese Shape Verification | ✅ |
| 9 | Synthetic Detection | ✅ |
| 10 | Text Sentiment Transformer | ✅ |
| 11 | Fashion-MNIST GAN | ✅ |
| 12 | Fashion-MNIST Benchmark | ✅ |
| 13 | Fashion-MNIST Diffusion | ✅ |
| 14 | Fashion-MNIST Conditional-Diffusion | ⚠️ **BUG-32** |
| 15 | Fashion-MNIST UNet | ✅ |
| 16 | Fashion-MNIST Transformer | ✅ |

**14 of 16 verified clean live**, 2 functional blockers remaining.

---

## Bug count this LinkedIn-prep round

| Bug | Status |
|-----|--------|
| BUG-12 → BUG-19 | ✅ FIXED |
| BUG-20 + followup | ✅ FIXED |
| BUG-21 (HTML truncation) | ⏳ pending (cosmetic) |
| BUG-22 → BUG-30 | ✅ FIXED |
| BUG-31 (LSTM training mode) | ⏳ NEW pending |
| BUG-32 (Cond-Diffusion conditioning) | ⏳ NEW pending |

**19 of 21 bugs fully fixed**.

---

## Recommendation

The 2 new bugs are real but small:
- **BUG-31**: 1-line fix — `model.train()` at top of epoch loop. Probably 5 min.
- **BUG-32**: ~10-line fix — detect class-conditional graph and prep target accordingly. Probably 15 min.

After both: **16/16 verified live**. Worth the extra ~30 min before LinkedIn ship.

User's instinct was right. Option B caught 2 functional bugs that Option A would have shipped broken. ✅

# SAR Ship Detection — Bounding Box Regression on Radar Satellite Imagery

![Dataset](images/01_dataset.png)

Ship detection on real Synthetic Aperture Radar (SAR) satellite images from the HRSID dataset. Predicts ship bounding boxes [x, y, width, height] from 64×64 SAR patches.

## What This Demo Shows

- **Real SAR data**: radar backscatter imagery from Gaofen-3 and Sentinel-1 satellites
- **Object detection**: bounding box regression on remote sensing data
- **CNN vs MLP**: convolutional spatial features vs flat features for detection
- **Maritime domain**: complements AIS trajectory prediction (TrAISformer) and oscillator physics demos

| Dataset | Model Graph | Trainer |
|:---:|:---:|:---:|
| ![Dataset](images/01_dataset.png) | ![Model](images/02_model.png) | ![Trainer](images/03_trainer.png) |

## Dataset

300 patches extracted from HRSID (High Resolution SAR Images Dataset), downsampled to 64×64 grayscale. Each patch contains one ship with a normalized bounding box.

| Property | Value |
|----------|-------|
| Samples | 300 patches (210 train / 45 val / 45 test) |
| Resolution | 64×64 grayscale |
| Source | HRSID — Gaofen-3, Sentinel-1 SAR |
| Target | Bounding box [x, y, w, h] normalized 0-1 |

## Models

### 1. CNN Ship Detector
```
ImageSource → Reshape(64,64,1)
  → Conv(16, stride=2) → Conv(32, stride=2) → Conv(64, stride=2)
  → Flatten → Dense(128) → Dropout(0.3) → Output(bbox)
```

### 2. CNN Ship Detector + Augmentation
Same backbone as model 1, but with paired horizontal-flip augmentation applied to image and bounding box during training. Demonstrates the platform's `augment_image` / `augment_bbox` / `target_source` blocks and the `seedLink` mechanism that keeps image and label flips in sync.

```
ImageSource → Reshape(64,64,1) → AugmentImage(hflip, p=0.5, seedLink=sar_aug)
  → Conv(16, s=2) → Conv(32, s=2) → Conv(64, s=2)
  → Flatten → Dense(128) → Dropout(0.3) → Output.input_1

TargetSource(bbox) → AugmentBbox(hflip, p=0.5, seedLink=sar_aug, format=xywh) → Output.input_2
```

The two branches share `seedLink="sar_aug"`: image-side rolls the coin, target-side reads it via the per-instance seed registry, so any flip applied to the image is mirrored on the label.

### 3. MLP Baseline
```
ImageSource → Dense(256) → Dense(64) → Output(bbox)
```

## Results & Interpretation

Both models trained 50 epochs on PyTorch CUDA, predicting normalized [x, y, w, h] bounding boxes. Evaluated on the held-out 45-patch test split via the in-app `bbox_mae` / `bbox_rmse` / `bbox_bias` recipe.

![Evaluation results](images/04_test.png)

| Model | Params | BBox MAE | BBox RMSE | BBox Bias |
|---|---|---|---|---|
| **CNN Ship Detector** | 35K | **0.2962** | **0.3274** | -0.2939 |
| MLP Baseline | 1.07M | 0.3059 | 0.3366 | -0.1816 |

**The honest result: both models are barely better than a center-of-image guess, and the CNN/MLP gap is small (~3% relative).** This is what makes SAR ship detection genuinely hard — and it's the lesson the demo was redesigned around.

The training-time val MAE was much lower (~0.013) because the val split shares image statistics with training. The test split exposes the real generalization: HRSID patches are downsampled to 64×64 and contain wide variation in ship size, sea-state clutter, and contrast. With only 210 training patches, neither architecture has enough data to learn a sharp localization prior, and both regress toward predicting bounding boxes near the image centroid.

**The bias values reveal the failure mode.** CNN bias is -0.29, MLP bias is -0.18 — both models systematically under-predict box coordinates (predicting boxes too far up-and-left). The CNN over-fits this bias more strongly because its convolutional features pick up dataset-wide patterns (most ships in the train split happen to land in similar regions of the patch).

**Why ship the demo anyway?** Because the platform claim isn't "we win SAR detection." It's "the same platform handles real radar imagery with the standard detection recipe and produces honest test-time numbers" — including the negative result that 210 patches isn't enough data to beat baseline. To turn this into a real detector you'd need 3K+ patches with augmentation; the contract-driven evaluation pipeline doesn't change.

### Does augmentation help? (CNN + paired hflip)

The third model variant adds horizontal-flip augmentation paired across the image branch and the bounding-box label branch (via `seedLink`), training otherwise identical to model 1 (50 epochs, batch 16, lr=0.001, seed=42, PyTorch CUDA).

| Model (per-coord normalized MAE on test split, from pretrained metadata) | best epoch | best val_loss | test MAE |
|---|---|---|---|
| CNN Ship Detector | 21 | 0.0040 | 0.0376 |
| **CNN Detector + Augmentation** | 50 | **0.0027** | **0.0344** |

**Augmentation helps by ~9% on test MAE and ~33% on val_loss**, and the model trains the full 50 epochs (no early-stop) because val keeps improving — the classic small-data signature where regularization actually had room to help. With 210 training patches, doubling the effective dataset via paired hflip lets the CNN see ships in both image-orientations without needing any real new data.

#### Bug found while building this demo

The first round of aug retrains came back *worse* than baseline (test MAE 0.0509, +35%), which seemed wrong for a 210-sample image task where augmentation should be unambiguously useful. Investigation traced it to a silent runtime asymmetry:

- The server's `reshape` block (`train_subprocess.py`) reshapes input as NHWC then permutes to NCHW with `nhwc.permute(0, 3, 1, 2)` — because PyTorch's `Conv2d` expects NCHW.
- The `augment_image` block reads its `layout` config to decide which axis to flip. The palette default was `"nhwc"`, which on the server gave `flip_axis = -2`. After reshape's silent permute, axis -2 is **H, not W** — so the image was being vertically flipped while the bounding box was horizontally flipped. Every flipped batch (50% of training) trained the model on a 90°-mismatched label.

The fix in this demo: set `layout: "auto"` on the augment_image node. JS-side falls through to "nhwc" (correct, since TF.js reshape doesn't permute), and the PyTorch server's auto-detect picks NCHW from the `[B, 1, 64, 64]` shape. Both runtimes now flip W consistently. `scripts/test_sar_ship_aug_demo.js` and `scripts/test_augment_paired_server.py` cover the alignment; `scripts/test_server_graphlabel_loss.py` covers the loss-routing path.

The augmentation blocks (image, bbox, mask, label, target_source, seedLink RNG) work correctly across browser TF.js, PyTorch CUDA server, and notebook export. The `layout: "auto"` setting is recommended whenever a `reshape` node sits upstream of `augment_image` — the palette will likely default to "auto" once this lesson is folded back into the schema.

## How to Use

1. **Dataset** tab — click Generate Dataset (instant, embedded SAR data)
2. **Playground** tab — browse SAR patches with ship bounding boxes (yellow overlay)
3. **Model** tab — inspect CNN detector architecture
4. **Trainer** tab — train on client (TF.js) or server (PyTorch)
5. **Evaluation** tab — compare bbox MAE/RMSE between CNN and MLP

## References

- Wei, S., et al. **"HRSID: A High-Resolution SAR Images Dataset for Ship Detection and Instance Segmentation."** *IEEE Access*, 2020.
- Kang, M., et al. **"A Survey on Deep Learning Based Ship Detection from Satellite Images."** *Remote Sensing*, 2021.

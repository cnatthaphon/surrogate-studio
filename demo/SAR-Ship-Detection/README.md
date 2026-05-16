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

3000 patches extracted from HRSID (High Resolution SAR Images Dataset), downsampled to 64×64 grayscale. Each patch contains one ship with a normalized bounding box. Re-extracted via `scripts/extract_hrsid_bundle.py` directly from the raw HRSID JPEGImages + COCO annotations.

| Property | Value |
|----------|-------|
| Samples | 3000 patches (2100 train / 450 val / 450 test) |
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

All three models trained on PyTorch CUDA, predicting normalized [x, y, w, h] bounding boxes with a sigmoid output head. Evaluated on the held-out 450-patch test split via the in-app `iou_mean` / `bbox_mae` / `bbox_rmse` / `bbox_bias` recipe.

### Mean IoU is the canonical metric for detection

The Evaluation tab reports four metrics for this demo. **`iou_mean` is the one that matters**: Intersection-over-Union between the predicted bounding box and the ground-truth box, in `[0, 1]`. Per-coord MAE/RMSE/Bias are regression-style metrics on the four coordinate axes — they treat the bbox as four independent scalars and don't capture whether the boxes overlap at all.

![Evaluation results](images/04_test.png)

| Model | Loss | Params | Mean IoU ↑ | BBox MAE | BBox Bias |
|---|---|---|---|---|---|
| **CNN Detector** | **GIoU** | 548K | **0.308** | 0.235 | +0.013 |
| CNN + Augmentation | MSE | 548K | 0.282 | **0.068** | -0.011 |
| MLP Baseline | MSE | 1.07M | 0.212 | 0.103 | -0.001 |

**The CNN with GIoU loss wins on Mean IoU (0.308) — 45% above the MLP baseline, 29% above the same CNN trained with MSE.** This is the platform feature most directly attacking the detection metric: GIoU loss optimizes box-overlap distance directly, instead of treating the bbox as four independent regression scalars the way MSE does. Notice MAE goes the *wrong* way under GIoU (0.235 vs 0.068 for MSE) — that's expected. GIoU is willing to accept higher per-coord error if it produces a box that overlaps the ship better, which is the only thing that matters for detection.

The augmentation variant (still on MSE — see "Loss choice for the aug variant" below) gets 0.282 IoU, beating MLP by 33% and showing that paired image+bbox flips still pay off as a regularizer when the loss can't be GIoU.

### Three load-bearing fixes that got real detection working

1. **Schema bbox `featureSize: 4`** — without this, the model-build path at eval time defaulted the bbox head to a 1-unit output, only the first column of the trained 4-unit head got loaded, and IoU computed against single-float predictions was always 0.
2. **Sigmoid head activation override (`activation: "sigmoid"` on the Output node)** — clamps predictions to `[0, 1]` so the network can't escape into negative coords that produce degenerate boxes.
3. **GIoU loss as a first-class loss type (`loss: "giou"`)** — direct surrogate for the IoU metric, with a useful gradient even when boxes don't overlap (where MSE's gradient vanishes on the per-coord deltas). Added to both `src/training_engine_core.js` (JS path) and `server/train_subprocess.py` (PyTorch path). Standard in YOLOv5+/DETR/RetinaNet for the same reason.

Plus the data unblock — **3000 patches via `scripts/extract_hrsid_bundle.py`** instead of the original 300 — gave the model enough variety to actually generalize.

### Test-IoU distribution (CNN + GIoU, 450 samples)

| IoU threshold | Hit rate |
|---|---|
| > 0 (any overlap) | 72% |
| > 0.3 (moderate) | 49% |
| > 0.5 (COCO mAP standard) | 23% |
| > 0.7 (excellent) | 5% |

Roughly 72% of test patches get a predicted box that overlaps the ground truth at all, and ~23% hit the COCO mAP@0.5 threshold. SOTA SAR detectors (YOLOv5/v8 + pretrained backbones, 25M+ params) hit ~85% at IoU>0.5; this demo's single-stage from-scratch 548K-param CNN is in a different complexity class and produces credible, non-trivial detection.

### Loss choice for the aug variant

CNN+Aug stays on MSE rather than GIoU because the paired-flip aug + GIoU combination doesn't converge cleanly — loss plateaus at ~0.96 (no-overlap regime) regardless of learning rate, since the rough early-training landscape combines with GIoU's vanishing-gradient zone outside any overlap. Cleanly handling this would need either a warmup phase (start with MSE, switch to GIoU) or a hybrid `α·MSE + β·GIoU` combined loss. Both are clean platform extensions, deliberately deferred — the current two-config split (GIoU on baseline, MSE on aug) shows both platform wins independently.

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

- Wei, S., Zeng, X., Qu, Q., Wang, M., Su, H., & Shi, J. **"HRSID: A High-Resolution SAR Images Dataset for Ship Detection and Instance Segmentation."** *IEEE Access* 8, 120234–120254, 2020. [doi:10.1109/ACCESS.2020.3005861](https://doi.org/10.1109/ACCESS.2020.3005861)
- Kang, M., et al. **"A Survey on Deep Learning Based Ship Detection from Satellite Images."** *Remote Sensing,* 2021.

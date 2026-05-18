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
Same backbone as model 1, but with paired horizontal+vertical flip augmentation applied to image and bounding box during training, and a `giou_mse` hybrid loss head. Demonstrates the platform's `augment_image` / `augment_bbox` / `target_source` blocks plus the `seedLink` mechanism that keeps image and label flips in sync, and the hybrid loss the platform exposes for single-stage detectors that need to converge from random init.

```
ImageSource → Reshape(64,64,1) → AugmentImage(hflip+vflip, p=0.5, seedLink=sar_aug)
  → Conv(16, s=2) → Conv(32, s=2) → Conv(64, s=2)
  → Flatten → Dense(128) → Dropout(0.3) → Output(loss=giou_mse).input_1

TargetSource(bbox) → AugmentBbox(hflip+vflip, p=0.5, seedLink=sar_aug, format=xywh) → Output.input_2
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

| Model | Loss | Params | Mean IoU ↑ | BBox MAE | BBox RMSE | BBox Bias |
|---|---|---|---|---|---|---|
| **CNN + Augmentation** | **`giou_mse`** | 548K | **0.342** | 0.133 | 0.197 | 0.040 |
| CNN Detector (baseline) | `giou` | 548K | 0.292 | 0.249 | 0.378 | 0.080 |
| MLP Baseline | MSE | 1.07M | 0.212 | **0.103** | **0.161** | **~0** |

**CNN + Augmentation with the `giou_mse` hybrid loss wins on every overlap-style metric — 61% above the MLP baseline on Mean IoU, +17% over the pure-GIoU CNN baseline.** The hybrid combines both platform features that move the IoU needle: the `giou_mse` loss (50/50 MSE + GIoU) directly optimizes box overlap while MSE's smooth gradient keeps training healthy through the early no-overlap regime where pure GIoU is flat; paired image+bbox horizontal+vertical flips (via the `seedLink` augmentation contract) 4×s the effective training set without breaking the bbox label. Per-coord MAE goes up vs. the MLP (0.133 vs 0.103) because GIoU-family losses accept larger per-axis error in exchange for better overlap — that's the design, and the IoU jump is what shows it works.

### Three load-bearing fixes that got real detection working

1. **Schema bbox `featureSize: 4`** — without this, the model-build path at eval time defaulted the bbox head to a 1-unit output, only the first column of the trained 4-unit head got loaded, and IoU computed against single-float predictions was always 0.
2. **Sigmoid head activation override (`activation: "sigmoid"` on the Output node)** — clamps predictions to `[0, 1]` so the network can't escape into negative coords that produce degenerate boxes.
3. **GIoU loss as a first-class loss type (`loss: "giou"`)** — direct surrogate for the IoU metric. MSE still has a coordinate gradient for non-overlapping boxes, but it optimizes per-axis error rather than box overlap, and on a noisy 64×64 SAR backbone that gap matters: minimizing per-coord MSE lets the model settle into a "small box near the center" minimum that scores well on MAE while still missing the ship. GIoU pulls predictions toward the IoU metric directly. Added to both `src/training_engine_core.js` (JS path) and `server/train_subprocess.py` (PyTorch path). Standard in YOLOv5+/DETR/RetinaNet for the same reason.

Plus the data unblock — **3000 patches via `scripts/extract_hrsid_bundle.py`** instead of the original 300 — gave the model enough variety to actually generalize.

### Test-IoU distribution (450 samples)

Per-threshold hit rate on the test split — all three pretrained models evaluated under the same in-app `iou_mean` recipe. Raw counts shown alongside percentages so the ratios in the prose below are checkable:

| IoU threshold | CNN + Aug (`giou_mse`) | CNN (`giou` baseline) | MLP Baseline |
|---|---|---|---|
| > 0 (any overlap) | 382 / 450 (84.9%) | 430 / 450 (95.6%) | 268 / 450 (59.6%) |
| > 0.3 (moderate) | **231 / 450 (51.3%)** | 202 / 450 (44.9%) | 162 / 450 (36.0%) |
| > 0.5 (COCO mAP standard) | **167 / 450 (37.1%)** | 139 / 450 (30.9%) | 65 / 450 (14.4%) |
| > 0.7 (excellent) | **79 / 450 (17.6%)** | 51 / 450 (11.3%) | 11 / 450 (2.4%) |

CNN+Aug+`giou_mse` hits 37% at COCO mAP@0.5 vs. 23% for the previous pretrained config (MSE-only). At the excellent threshold (IoU > 0.7) it gets 79 patches right vs. 11 for the MLP — **7.2× the MLP**, and 1.5× the pure-GIoU baseline. SOTA SAR detectors (YOLOv5/v8 + pretrained backbones, 25M+ params) hit ~85% at IoU>0.5; this demo's single-stage from-scratch 548K-param CNN is in a different complexity class and produces credible, non-trivial detection. Note the inversion at IoU>0: the pure-GIoU baseline produces *some* overlap on 96% of test samples but rarely good overlap, while the hybrid is more confident — slightly fewer "any overlap" predictions but many more crossing the meaningful thresholds.

### Loss choice for the aug variant — why `giou_mse`

Earlier iterations of this demo shipped CNN+Aug on pure MSE because the paired-flip aug + pure-GIoU combination didn't converge from random init — loss plateaued at ~0.96 (no-overlap regime) regardless of learning rate, since the rough early-training landscape combines with GIoU's vanishing-gradient zone outside any overlap. The fix is `loss: "giou_mse"` (50/50 MSE + GIoU hybrid): MSE supplies a smooth gradient through the early no-overlap phase, GIoU takes over once boxes begin to overlap. Standard recipe for single-stage detectors that need to converge from scratch (YOLOv5+/DETR/RetinaNet train with similar hybrids). Zero hardcoded coefficients — the hybrid weighting lives in `training_engine_core._giouLoss` and `server/train_subprocess._build_giou_head_loss`, both reading the `bboxFormat` declared on the schema's bbox output (`sar_ship_detection` declares `"xywh"`).

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

# Synthetic Detection — Single-Object Detection Baseline

![Dataset](images/01_dataset.png)

Single-object detection on synthetic grayscale images. Demonstrates the `detection_single_box` task recipe with bounding box regression and optional classification heads.

## What This Demo Shows

- **Detection task recipe**: bounding box prediction driven by the `detection_single_box` recipe — no detection-specific logic in core tabs
- **Multi-head output**: bbox regression + class label from the same model
- **Anchor-free detection**: direct regression to [x, y, w, h] coordinates

| Dataset | Model Graph | Trainer |
|:---:|:---:|:---:|
| ![Dataset](images/01_dataset.png) | ![Model](images/02_model.png) | ![Trainer](images/03_trainer.png) |

## Dataset

Synthetically generated 32×32 grayscale images with one shape (square, wide box, or tall box) per image. Target: normalized bounding box [x, y, w, h] + class label.

| Class | Shape |
|-------|-------|
| 0 | Square |
| 1 | Wide Box |
| 2 | Tall Box |

## Models

### 1. CNN Detector
```
ImageSource → Reshape(32,32,1) → Conv(16) → Conv(32)
  → Flatten → Dense(64,relu) → Output(bbox, MSE)
```

### 2. MLP Baseline
```
ImageSource → Dense(128,relu) → Dense(64,relu) → Output(bbox, MSE)
```

## How to Use

1. **Dataset** tab — click Generate Dataset (instant, synthetic)
2. **Playground** tab — browse images with orange bounding boxes
3. **Model** tab — inspect detection network
4. **Trainer** tab — train on client (TF.js) or server (PyTorch)
5. **Evaluation** tab — bbox MAE, mean IoU, class accuracy

## References

This demo uses synthetic data with no external dataset. The detection approach follows the standard single-shot regression paradigm:

- Redmon, J., et al. **"You Only Look Once: Unified, Real-Time Object Detection."** *CVPR 2016.* [arXiv:1506.02640](https://arxiv.org/abs/1506.02640) — Inspired the direct bbox regression approach.

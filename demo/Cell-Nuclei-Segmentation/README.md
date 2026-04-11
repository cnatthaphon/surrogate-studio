# Cell Nuclei Segmentation — 2018 Data Science Bowl

Binary segmentation of cell nuclei from microscopy images. This is the same class of biomedical image segmentation task that the original UNet paper (Ronneberger et al., MICCAI 2015) was designed for.

## Dataset

300 images from the 2018 Data Science Bowl `stage1_train`, downsampled to 32x32 grayscale. Individual per-nucleus masks merged into single binary masks.

| Split | Samples |
|-------|---------|
| Train | 210 |
| Val | 45 |
| Test | 45 |

Source: [2018 Data Science Bowl](https://www.kaggle.com/c/data-science-bowl-2018) — Kaggle

## Models

### 1. Nucleus UNet (skip connections)
```
ImageSource -> Reshape(32,32,1)
  -> Conv(16) -> [skip1] -> MaxPool
  -> Conv(32) -> [skip2] -> MaxPool
  -> Conv(64) [bottleneck]
  -> UpSample -> Concat(skip2) -> Conv(32)
  -> UpSample -> Concat(skip1) -> Conv(16)
  -> Conv(1,sigmoid) -> Flatten -> Output(mask, BCE)
```

### 2. MLP Baseline
```
ImageSource -> Dense(256,relu) -> Dense(1024,sigmoid) -> Output(mask, BCE)
```

## Evaluation

| Metric | Description |
|--------|-------------|
| **Mask IoU** | Intersection over union of predicted vs true nucleus mask |
| **Dice Score** | 2 * intersection / (pred + truth) — pixel-level F1 |
| **Pixel Accuracy** | Fraction of correctly classified pixels |

## How to Use

1. **Dataset** tab — click Generate Dataset (instant, data embedded)
2. **Playground** tab — browse microscopy images + nucleus masks
3. **Model** tab — inspect UNet graph with skip connections
4. **Trainer** tab — train on client (TF.js) or server (PyTorch)
5. **Evaluation** tab — compare IoU/Dice between UNet and MLP

## Reference

Ronneberger, O., Fischer, P., & Brox, T. **"U-Net: Convolutional Networks for Biomedical Image Segmentation."** *MICCAI 2015.* [arXiv:1505.04597](https://arxiv.org/abs/1505.04597)

This demo uses real biomedical cell images from the 2018 Data Science Bowl — the same domain as the original UNet paper. The architecture is a simplified 2-level UNet adapted for 32x32 input resolution.

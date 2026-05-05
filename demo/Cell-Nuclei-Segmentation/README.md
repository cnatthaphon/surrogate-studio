# Cell Nuclei Segmentation — 2018 Data Science Bowl

![Dataset](images/01_dataset.png)

Binary segmentation of cell nuclei from microscopy images. This is the same class of biomedical image segmentation task that the original UNet paper (Ronneberger et al., MICCAI 2015) was designed for.

| Dataset | Model Graph | Trainer |
|:---:|:---:|:---:|
| ![Dataset](images/01_dataset.png) | ![Model](images/02_model.png) | ![Trainer](images/03_trainer.png) |

| Evaluation | Generation |
|:---:|:---:|
| ![Evaluation](images/04_test.png) | ![Generation](images/05_generation.png) |

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

## Results & Interpretation

Both models trained 50 epochs on PyTorch CUDA. Evaluated on the held-out 45-image test split via the in-app `mask_iou` / `dice` / `pixel_accuracy` recipe.

![Evaluation results](images/04_test.png)

| Model | Params | Mask IoU | Dice Score | Pixel Accuracy |
|---|---|---|---|---|
| **Nucleus UNet** | 58K | **0.4834** | **0.6252** | 0.9123 |
| MLP Baseline | 1.31M | 0.0000 | 0.0000 | 0.8670 |

**The MLP collapses to "predict background everywhere."** Pixel accuracy looks deceptively high (0.87) because nuclei are sparse — most pixels really *are* background, and a constant zero-prediction scores ~87% by default. But IoU and Dice expose the truth: the MLP's nucleus mask is empty (IoU = 0). It learned the trivial solution.

The UNet, in contrast, achieves **0.48 IoU and 0.63 Dice** on real biomedical data — solid for a 2-level skip-connection network with only 58K parameters trained on 210 images. The skip connections preserve nucleus boundary information through the bottleneck; convolutions encode locality for free. With 23x fewer parameters than the MLP, the UNet wins because it has the right inductive bias for the task.

**This is why segmentation is reported as IoU/Dice, never raw accuracy.** The MLP scoring 87% "accuracy" while producing zero useful segmentation is exactly the failure mode that pixel accuracy hides. IoU is the diagnostic.

**What to look for in the Playground tab:** UNet predictions trace nucleus boundaries crisply. MLP predictions are uniformly black masks — it has given up. To improve the MLP you'd need orders-of-magnitude more training data to overcome the missing spatial prior; the UNet gets the same task done on 210 images.

## How to Use

1. **Dataset** tab — click Generate Dataset (instant, data embedded)
2. **Playground** tab — browse microscopy images + nucleus masks
3. **Model** tab — inspect UNet graph with skip connections
4. **Trainer** tab — train on client (TF.js) or server (PyTorch)
5. **Evaluation** tab — compare IoU/Dice between UNet and MLP

## Reference

Ronneberger, O., Fischer, P., & Brox, T. **"U-Net: Convolutional Networks for Biomedical Image Segmentation."** *MICCAI 2015.* [arXiv:1505.04597](https://arxiv.org/abs/1505.04597)

This demo uses real biomedical cell images from the 2018 Data Science Bowl — the same domain as the original UNet paper. The architecture is a simplified 2-level UNet adapted for 32x32 input resolution.

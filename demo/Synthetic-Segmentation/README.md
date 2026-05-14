# Synthetic Segmentation — Binary Pixel Mask Prediction

![Dataset](images/01_dataset.png)

Pixel-wise binary segmentation on synthetic shape images. Demonstrates the `segmentation_mask` task recipe with mask-specific evaluation metrics (IoU, Dice, pixel accuracy).

## What This Demo Shows

- **Task recipe architecture**: segmentation is a recipe, not hardcoded logic — the schema declares `taskRecipeId: "segmentation_mask"` and evaluation reads mask metrics from the recipe contract
- **Mask as target**: model predicts a flat array of 0-1 values per pixel, compared against ground truth mask
- **UNet skip connections vs MLP**: same segmentation task, different architectures

| Dataset | Model Graph | Trainer |
|:---:|:---:|:---:|
| ![Dataset](images/01_dataset.png) | ![Model](images/02_model.png) | ![Trainer](images/03_trainer.png) |

## Dataset

Synthetically generated 32×32 grayscale images with 1-3 random shapes (circles, rectangles) on noisy backgrounds. Target: binary mask (1 = shape pixel, 0 = background).

## Models

### 1. Seg-UNet (skip connections)
```
ImageSource → Reshape(32,32,1) → Conv(16) → MaxPool
  → Conv(32) → MaxPool → Conv(64) [bottleneck]
  → UpSample → Concat(skip2) → Conv(32)
  → UpSample → Concat(skip1) → Conv(16) → Conv(1,sigmoid)
  → Flatten → Output(mask, BCE)
```

### 2. Seg-UNet + Augmentation
Same backbone with paired horizontal + vertical flip augmentation. The image branch flows through `augment_image`; the mask label flows through `target_source → augment_mask → flatten` with shared `seedLink="segshape_aug"` so both flips happen on the mask in lockstep with the image. Both `hflipProb` and `vflipProb` are 0.5: synthetic shapes have no canonical orientation, so both axes are physically reasonable transforms.

```
ImageSource → Reshape → AugmentImage(hflip+vflip, seedLink=segshape_aug)
  → UNet encoder-decoder → Conv(1,sigmoid) → Flatten → Output.input_1

TargetSource(mask,[32,32]) → AugmentMask(hflip+vflip, seedLink=segshape_aug)
  → Flatten → Output.input_2
```

The flatten on the mask branch reshapes the augmented `[B,32,32]` mask back to `[B,1024]` so it matches the prediction's flat shape for BCE.

### 3. MLP Baseline
```
ImageSource → Dense(256,relu) → Dense(1024,sigmoid) → Output(mask, BCE)
```

## Evaluation Metrics

| Metric | Description |
|--------|-------------|
| **Mask IoU** | Intersection over union between predicted and target binary masks |
| **Dice Score** | F1 at pixel level: 2×intersection / (pred_sum + truth_sum) |
| **Pixel Accuracy** | Fraction of correctly classified pixels |

## Results & Interpretation

Both models trained 30 epochs on PyTorch CUDA. Evaluated on the held-out 75-image test split via the in-app `mask_iou` / `dice` / `pixel_accuracy` recipe.

![Evaluation results](images/04_test.png)

| Model | Mask IoU | Dice Score | Pixel Accuracy |
|---|---|---|---|
| **Seg-UNet** | **0.9253** | **0.9606** | **0.9669** |
| MLP Baseline | 0.6987 | 0.8143 | 0.9380 |

**The story: UNet beats MLP by 22 IoU points and 15 Dice points** while pixel accuracy only gaps by ~3 points. That gap-shape is the diagnostic — pixel accuracy looks deceptively close because most pixels are background, and predicting "background everywhere" already scores high. IoU and Dice are the metrics that actually expose segmentation quality, and the UNet wins decisively because skip connections preserve boundary detail through the bottleneck.

The MLP can roughly localize each shape (its 0.81 Dice means it gets the right *region*) but smears the boundaries (the 22-point IoU gap means the mask shape is wrong). The UNet recovers both region and boundary because convolutions encode spatial locality and the skip connections route high-resolution feature maps directly to the decoder.

This is why segmentation is always reported as IoU/Dice rather than raw accuracy: the trivial "all zero" baseline scores ~85% pixel accuracy on sparse masks but ~0 IoU.

### Does augmentation help here? (paired image + mask hflip + vflip)

Both Seg-UNet variants retrained at the same code rev, same seed=42, 30 epochs PyTorch CUDA. The synthetic dataset is clean enough that both converge near the BCE floor — so the absolute val_loss numbers are tiny and the comparison is more about "does the pipeline work correctly" than "does augmentation rescue a hard task."

| Variant (from pretrained metadata) | best epoch | best val_loss | MAE |
|---|---|---|---|
| Seg-UNet | 29 | 2.6e-5 | 2.1e-5 |
| **Seg-UNet + Augmentation** (hflip + vflip, p=0.5 each) | 30 | **2.0e-5** | **1.6e-5** |

Aug helps ~19% in relative terms but at this absolute floor the difference is mostly numerical noise — both models effectively solve the task. The educational point here is the **multi-runtime pipeline**, not the headline number:

- `target_source(targetKey="mask", targetShape=[32,32])` emits a rank-3 mask tensor for `augment_mask` to flip
- The PyTorch server's `target_source` dispatch honors `targetShape` to reshape flat `[B,1024]` rows into `[B,32,32]` (parity with the TF.js `tf.input` shape declaration)
- The `seedLink="segshape_aug"` registry guarantees image flip == mask flip every batch

For datasets where segmentation is genuinely hard, the same blocks pay off more visibly — see Cell-Nuclei-Segmentation, where this exact pattern reduces val_loss by ~10% on a 210-image biomedical task.

## How to Use

1. **Dataset** tab — click Generate Dataset (instant, synthetic)
2. **Playground** tab — browse images alongside their ground truth masks
3. **Model** tab — inspect UNet graph with skip connections
4. **Trainer** tab — train on client (TF.js) or server (PyTorch)
5. **Evaluation** tab — compare IoU/Dice between UNet and MLP

## References

- Ronneberger, O., Fischer, P., & Brox, T. **"U-Net: Convolutional Networks for Biomedical Image Segmentation."** *MICCAI 2015.* [arXiv:1505.04597](https://arxiv.org/abs/1505.04597) — The UNet architecture used in the skip-connection model.
- Long, J., Shelhamer, E., & Darrell, T. **"Fully Convolutional Networks for Semantic Segmentation."** *CVPR 2015.* [arXiv:1411.4038](https://arxiv.org/abs/1411.4038) — Foundational work on pixel-wise prediction.

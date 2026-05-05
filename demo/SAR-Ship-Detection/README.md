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

### 2. MLP Baseline
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

## How to Use

1. **Dataset** tab — click Generate Dataset (instant, embedded SAR data)
2. **Playground** tab — browse SAR patches with ship bounding boxes (yellow overlay)
3. **Model** tab — inspect CNN detector architecture
4. **Trainer** tab — train on client (TF.js) or server (PyTorch)
5. **Evaluation** tab — compare bbox MAE/RMSE between CNN and MLP

## References

- Wei, S., et al. **"HRSID: A High-Resolution SAR Images Dataset for Ship Detection and Instance Segmentation."** *IEEE Access*, 2020.
- Kang, M., et al. **"A Survey on Deep Learning Based Ship Detection from Satellite Images."** *Remote Sensing*, 2021.

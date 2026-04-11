# SAR Ship Detection — Bounding Box Regression on Radar Satellite Imagery

Ship detection on real Synthetic Aperture Radar (SAR) satellite images from the HRSID dataset. Demonstrates object detection (bounding box regression) on remote sensing data.

## What This Demo Shows

- **Real SAR data**: not RGB aerial photos — actual radar backscatter imagery from Gaofen-3 and Sentinel-1 satellites
- **Object detection**: predict ship bounding box [x, y, width, height] from image patch
- **CNN vs MLP**: convolutional features vs flat features for spatial detection
- **Maritime domain**: complements the AIS trajectory (TrAISformer) and oscillator demos

## Dataset

300 patches extracted from HRSID (High Resolution SAR Images Dataset). Each 64×64 grayscale SAR patch contains one ship with a normalized bounding box.

| Property | Value |
|----------|-------|
| Images | 300 patches |
| Resolution | 64×64 grayscale |
| Source | HRSID (Gaofen-3, Sentinel-1) |
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

## How to Use

1. **Dataset** tab — click Generate Dataset (instant, embedded SAR data)
2. **Playground** tab — browse SAR patches with ship bounding boxes (yellow overlay)
3. **Model** tab — inspect CNN detector architecture
4. **Trainer** tab — train on client (TF.js) or server (PyTorch)
5. **Evaluation** tab — compare bbox MAE/RMSE between CNN and MLP

## References

- HRSID: Wei, S., et al. "HRSID: A High-Resolution SAR Images Dataset for Ship Detection and Instance Segmentation." *IEEE Access*, 2020.
- SAR Ship Detection Survey: Kang, M., et al. "A Survey on Deep Learning Based Ship Detection from Satellite Images." *Remote Sensing*, 2021.

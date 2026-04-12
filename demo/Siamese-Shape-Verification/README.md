# Siamese Shape Verification — Metric Learning

Learn to compare image pairs and classify as same or different. Demonstrates the contrastive/metric learning paradigm using the platform's standard classification pipeline.

## What This Demo Shows

- **Metric learning**: model learns image similarity, not class identity
- **Pair-based input**: concatenated `[img_A | img_B]` as a single feature vector
- **Verification task**: binary output (same class / different class)
- **Application pattern**: signature verification, face verification, duplicate detection

## Dataset

Synthetic 28x28 grayscale shape images from 5 classes (circle, square, triangle, cross, diamond). Pairs are formed with 50/50 same/different class balance.

| Class | Shape |
|-------|-------|
| 0 | Circle |
| 1 | Square |
| 2 | Triangle |
| 3 | Cross |
| 4 | Diamond |

## Models

### 1. Deep Siamese MLP
```
Input(1568) → Dense(256,relu) → BatchNorm → Dropout(0.3)
  → Dense(128,relu) → Dropout(0.2) → Dense(64,relu) → Output(classification)
```

### 2. Shallow MLP Baseline
```
Input(1568) → Dense(128,relu) → Dense(32,relu) → Output(classification)
```

## Evaluation

| Metric | Description |
|--------|-------------|
| **Accuracy** | Correct same/different classification rate |
| **Macro F1** | Average F1 across same/different classes |

## How to Use

1. **Dataset** tab — click Generate Dataset (instant, synthetic pairs)
2. **Playground** tab — browse image pairs with same/different labels
3. **Model** tab — inspect network architecture
4. **Trainer** tab — train on client (TF.js)
5. **Evaluation** tab — compare deep vs shallow verification accuracy

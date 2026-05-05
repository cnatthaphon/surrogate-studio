# Siamese Shape Verification — Metric Learning

![Dataset](images/01_dataset.png)

Learn to compare image pairs and classify as same or different. Demonstrates the contrastive/metric learning paradigm for verification tasks — signature verification, face verification, duplicate detection.

## What This Demo Shows

- **Metric learning**: model learns image similarity, not class identity
- **Pair-based input**: concatenated [img_A | img_B] as a single feature vector
- **Verification task**: binary output (same class / different class)
- **Application pattern**: the same approach used in facial recognition (FaceNet), signature verification, and one-shot learning

| Dataset | Model Graph | Trainer |
|:---:|:---:|:---:|
| ![Dataset](images/01_dataset.png) | ![Model](images/02_model.png) | ![Trainer](images/03_trainer.png) |

## Dataset

Synthetic 28×28 grayscale shape images from 5 classes. Pairs are formed with 50/50 same/different class balance.

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
  → Dense(128,relu) → Dropout(0.2) → Dense(64,relu) → Output(same/different)
```

### 2. Shallow MLP Baseline
```
Input(1568) → Dense(128,relu) → Dense(32,relu) → Output(same/different)
```

## Results & Interpretation

Both models trained 30 epochs on PyTorch CUDA. Evaluated on a held-out 150-pair test split via the `accuracy` / `macro_f1` recipe.

![Evaluation results](images/04_test.png)

| Model | Accuracy | Macro F1 |
|---|---|---|
| Deep Siamese MLP | 0.8200 | 0.8198 |
| **Shallow MLP** | **0.8333** | **0.8333** |

**The shallow MLP narrowly beats the deep one (~1.3 accuracy points).** This is a real result and the interesting one. On 5-class synthetic shapes presented as concatenated pixel pairs, depth doesn't just provide no advantage — the extra capacity slightly *overfits* on a 350-pair training set. BatchNorm and dropout in the deep network mitigate but don't fully fix it.

The educational point of this demo is *the architectural pattern*, not a benchmark race. The shallow baseline exists to show that depth matters only when the underlying similarity function is genuinely non-linear in pixel space. For real verification tasks (faces, signatures), depth wins because the similarity is heavily non-linear; for clean synthetic shapes paired by exact class match, a shallow MLP with two hidden layers solves the task and any extra capacity is hurting more than helping.

**Both models cluster around 82-83% accuracy on a 50/50 same/different split**, where random guessing would be 50%. The lift over baseline is the proof of concept — verification through pair classification works. To get a meaningful depth-vs-shallow gap, swap the dataset for Fashion-MNIST pairs; the comparison stops being trivial.

## How to Use

1. **Dataset** tab — click Generate Dataset (instant, synthetic pairs)
2. **Playground** tab — browse image pairs with same (=) / different (≠) labels
3. **Model** tab — inspect network architecture
4. **Trainer** tab — train on client (TF.js)
5. **Evaluation** tab — compare deep vs shallow verification accuracy

## References

- Bromley, J., et al. **"Signature Verification using a 'Siamese' Time Delay Neural Network."** *NeurIPS 1993.*
- Koch, G., et al. **"Siamese Neural Networks for One-shot Image Recognition."** *ICML Deep Learning Workshop, 2015.*
- Schroff, F., et al. **"FaceNet: A Unified Embedding for Face Recognition and Clustering."** *CVPR 2015.* [arXiv:1503.03832](https://arxiv.org/abs/1503.03832)

This demo uses a simplified pair classification approach rather than contrastive loss, demonstrating the verification concept within the existing supervised classification pipeline.

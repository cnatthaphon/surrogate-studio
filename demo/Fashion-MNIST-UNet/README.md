# Fashion-MNIST UNet — Image Reconstruction with Skip Connections

Encoder-decoder architecture with skip connections for image reconstruction on Fashion-MNIST. Demonstrates that the visual graph editor supports **branching topologies** — the UNet's skip connections are standard Concat nodes wired across the encoder-decoder boundary.

## What This Demo Shows

- **Skip connections as graph wiring**: no special UNet node — just Conv2D, MaxPool2D, UpSample2D, and Concat composed in the graph editor
- **Spatial concat**: Concat node preserves 4D tensor layout (channel-axis concatenation) instead of flattening
- **Comparison**: UNet (with skip connections) vs plain Conv Autoencoder (without)
- **Same training engine**: no UNet-specific training code — the graph defines everything

## Models

### 1. UNet (skip connections)
```
Input(784) → Reshape(28,28,1)
  → Conv(16) → Conv(16) → [skip1] → MaxPool
  → Conv(32) → Conv(32) → [skip2] → MaxPool
  → Conv(64) → Conv(64)                         ← bottleneck
  → UpSample → Concat(skip2) → Conv(32) → Conv(32)
  → UpSample → Concat(skip1) → Conv(16) → Conv(1,sigmoid)
  → Flatten → Output(x)
```
~42K parameters. Skip connections preserve spatial detail from encoder.

### 2. Conv Autoencoder (baseline)
```
Input(784) → Reshape(28,28,1)
  → Conv(16, stride=2) → Conv(32, stride=2)
  → ConvTranspose(16, stride=2) → ConvTranspose(1, stride=2, sigmoid)
  → Flatten → Output(x)
```
~5K parameters. No skip connections — bottleneck must encode everything.

## How to Use

1. **Dataset** tab — click Generate Dataset to fetch Fashion-MNIST from CDN
2. **Model** tab — inspect the UNet graph: notice how Concat nodes merge encoder features with decoder features
3. **Trainer** tab — train both models (server recommended for Conv2D performance)
4. **Generation** tab — compare reconstructions: UNet should preserve more detail
5. **Evaluation** tab — benchmark reconstruction MSE side by side

## Reference

Ronneberger, O., Fischer, P., & Brox, T. **"U-Net: Convolutional Networks for Biomedical Image Segmentation."** *MICCAI 2015.* [arXiv:1505.04597](https://arxiv.org/abs/1505.04597)

This demo uses the UNet architecture for image reconstruction (autoencoder) rather than segmentation, to demonstrate skip connections within the existing Fashion-MNIST pipeline.

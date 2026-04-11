# Fashion-MNIST UNet — Skip Connection Architecture

UNet-style encoder-decoder with skip connections for image reconstruction on Fashion-MNIST. Demonstrates that the visual graph editor supports **branching topologies** — skip connections are standard Concat nodes wired across the encoder-decoder boundary.

## What This Demo Shows

- **Skip connections as graph wiring**: no special UNet node — just Conv2D, MaxPool2D, UpSample2D, and Concat composed in the graph editor
- **Spatial concat**: Concat node preserves 4D tensor layout (channel-axis concatenation) instead of flattening
- **Comparison**: encoder-decoder with skip connections vs without (plain Conv AE)
- **Same training engine**: no architecture-specific training code — the graph defines everything

## Architecture

This is a **UNet-style** architecture — same structural pattern as the original (encoder + skip connections + decoder) — adapted for image reconstruction instead of segmentation.

### Comparison with Original UNet

| Aspect | Ronneberger et al. 2015 | This Demo |
|--------|------------------------|-----------|
| **Task** | Biomedical image segmentation | Image reconstruction (autoencoder) |
| **Input** | 572x572 microscopy images | 28x28 Fashion-MNIST |
| **Encoder depth** | 4 levels (64-128-256-512-1024) | 2 levels (16-32-64) |
| **Skip connections** | Crop + concatenate | Concatenate (same padding) |
| **Upsampling** | Learned 2x2 up-convolution | Nearest-neighbor UpSample2D |
| **Output** | Per-pixel class probabilities (softmax) | Reconstructed image (sigmoid) |
| **Parameters** | ~31M | ~116K |

The core contribution of the UNet paper — **skip connections that pass spatial detail from encoder to decoder** — is what this demo implements and validates.

## Models

### 1. UNet-style (with skip connections)
```
ImageSource -> Reshape(28,28,1)
  -> Conv(16)x2 -> [skip1] -> MaxPool
  -> Conv(32)x2 -> [skip2] -> MaxPool
  -> Conv(64)x2                           <- bottleneck
  -> UpSample -> Concat(skip2) -> Conv(32)x2
  -> UpSample -> Concat(skip1) -> Conv(16) -> Conv(1,sigmoid)
  -> Flatten -> Output
```
115,665 parameters.

### 2. Conv Autoencoder (baseline, no skip connections)
```
ImageSource -> Reshape(28,28,1)
  -> Conv(16) -> MaxPool -> Conv(32) -> MaxPool
  -> UpSample -> Conv(16) -> UpSample -> Conv(1,sigmoid)
  -> Flatten -> Output
```
9,441 parameters. Same encoder-decoder structure without skip connections.

## Results

Trained on Fashion-MNIST, 200 epochs, PyTorch CUDA:

| Model | Params | Test MAE | Best Epoch |
|-------|:------:|:--------:|:----------:|
| **UNet-style** | 115,665 | **0.0076** | 197 |
| Conv AE (baseline) | 9,441 | 0.027 | 200 |

Skip connections give 3.5x lower reconstruction error.

## How to Use

1. **Dataset** tab — click Generate Dataset to fetch Fashion-MNIST from CDN
2. **Model** tab — inspect the graph: Concat nodes merge encoder features with decoder features
3. **Trainer** tab — pre-trained weights included, or train from scratch via PyTorch server
4. **Generation** tab — compare reconstructions (requires dataset loaded first)
5. **Evaluation** tab — benchmark reconstruction quality side by side

## Reference

Ronneberger, O., Fischer, P., & Brox, T. **"U-Net: Convolutional Networks for Biomedical Image Segmentation."** *MICCAI 2015.* [arXiv:1505.04597](https://arxiv.org/abs/1505.04597)

This demo adapts the UNet architecture (encoder + skip connections + decoder) for reconstruction rather than segmentation, to demonstrate skip connection support within the graph editor.

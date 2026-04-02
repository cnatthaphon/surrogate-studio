# Fashion-MNIST Diffusion — Denoising Generative Models

**Train denoising models that generate images by iteratively removing noise — all defined in the visual graph editor.**

Same engine as GAN and supervised demos. No hardcoded diffusion logic — the graph defines noise injection, timestep conditioning, and denoising network using composable building blocks.

## Presets

### 1. MLP Denoiser (baseline)

```
ImageSource → AddNoise(σ=0.3) → Dense(512, relu) → Dense(256, relu)
  → Dense(512, relu) → Dense(784, sigmoid) → Output(loss=MSE, target=pixel_values)
```

- Simple one-step denoiser: learns to reconstruct clean images from noisy input
- No timestep conditioning — single fixed noise level
- Baseline for comparison with timestep-conditioned models

### 2. MLP DDPM (Ho 2020)

```
ImageSource → AddNoise(σ=0.5, schedule=linear)
                ↓
TimeEmbed(dim=64) → Concat([noisy_image, t_embedding])
                ↓
Dense(512, relu) → LayerNorm → Dense(256, relu) → LayerNorm
  → Dense(512, relu) → Dense(784, sigmoid) → Output(loss=MSE, target=pixel_values)
```

- Timestep-conditioned denoiser: learns to denoise at multiple noise levels
- TimeEmbed provides sinusoidal position encoding of the noise timestep
- Generation: iterative DDPM sampling from pure noise through T denoising steps

## Building Blocks Used

| Block | Purpose |
|---|---|
| **ImageSource** | Clean training images (28×28 Fashion-MNIST) |
| **NoiseInjection** | Adds Gaussian noise at configurable scale/schedule |
| **TimeEmbed** | Sinusoidal timestep embedding for noise level conditioning |
| **Concat** | Merges noisy image + timestep embedding (feature-axis) |
| **LayerNorm** | Stabilizes deep network training |
| **Dense** | Fully-connected denoiser layers |

## Training

Standard supervised learning (MSE loss) — no adversarial dynamics:
- Input: noisy image (+ optional timestep)
- Target: clean image (reconstruction)
- Uses `model.fit()` (fast, GPU-optimized)

## Generation

| Method | Description |
|---|---|
| **Reconstruct** | Pass test images through noise → denoise (shows quality) |
| **DDPM** | Iterative: start from pure noise, denoise T steps → generates new images |

## How to Use

1. Open `index.html` in a browser
2. Generate Fashion-MNIST dataset (T-shirt class, 6000 images, 80/10/10 split)
3. Select a trainer, click Start Training
4. Generation tab: Reconstruct (test denoising) or DDPM (generate from noise)

## References

1. Ho, Jain, Abbeel. **"Denoising Diffusion Probabilistic Models."** *NeurIPS 2020*. [arXiv:2006.11239](https://arxiv.org/abs/2006.11239)

2. Song, Ermon. **"Generative Modeling by Estimating Gradients of the Data Distribution."** *NeurIPS 2019*. [arXiv:1907.05600](https://arxiv.org/abs/1907.05600)

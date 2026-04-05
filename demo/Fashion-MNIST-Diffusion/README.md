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

### 3. NCSN (Song & Ermon 2019)

```
ImageSource → AddNoise(σ=0.5, linear) + TimeEmbed(64) → Concat
  → Dense(512, relu) → LayerNorm → Dense(512, relu) → LayerNorm
  → Dense(512, relu) → Dense(784, sigmoid) → Output(loss=MSE)
```

- Deeper score network (3×512 hidden layers)
- Same training as DDPM (MSE on clean reconstruction)
- Generation: Langevin dynamics (iterative gradient ascent on learned score)

### 4. Score SDE (Song et al. 2021)

```
ImageSource → AddNoise(σ=0.5, cosine) + TimeEmbed(128) → Concat
  → Dense(512, relu) → LayerNorm → Dense(256, relu)
                                        ↓
  Skip concat(encoder_mid + bottleneck) → Dense(512, relu) → LayerNorm
    → Dense(784, sigmoid) → Output(loss=MSE)
```

- Cosine noise schedule (smoother than linear)
- Larger timestep embedding (128-dim)
- Skip connection from encoder to decoder (UNet-like)
- Unified framework: DDPM and NCSN as discretizations of SDEs

## How to Use

1. Open `index.html` in a browser
2. Generate Fashion-MNIST dataset (T-shirt class, 6000 images, 80/10/10 split)
3. Select a trainer, click Start Training
4. Generation tab: Reconstruct (test denoising) or DDPM/Langevin (generate from noise)
5. Evaluation tab:
   - `Generation Quality` compares sampled outputs to the dataset test split with standard set metrics (`MMD`, mean/std gaps, nearest-neighbor precision/coverage, diversity)
   - `Reconstruction Quality` compares denoised reconstructions with `Reconstruction MSE`

## References

1. Ho, Jain, Abbeel. **"Denoising Diffusion Probabilistic Models."** *NeurIPS 2020*. [arXiv:2006.11239](https://arxiv.org/abs/2006.11239)

2. Song, Ermon. **"Generative Modeling by Estimating Gradients of the Data Distribution."** *NeurIPS 2019*. [arXiv:1907.05600](https://arxiv.org/abs/1907.05600)

3. Song, Sohl-Dickstein, Kingma, Kumar, Ermon, Poole. **"Score-Based Generative Modeling through Stochastic Differential Equations."** *ICLR 2021*. [arXiv:2011.13456](https://arxiv.org/abs/2011.13456)

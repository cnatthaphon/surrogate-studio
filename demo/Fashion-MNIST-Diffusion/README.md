# Fashion-MNIST Diffusion — Denoising Generative Models

![Demo Workflow](images/demo_workflow.gif)

**Train denoising models that generate images by iteratively removing noise — all defined in the visual graph editor.**

Same engine as GAN and supervised demos. No hardcoded diffusion logic — the graph defines noise injection, timestep conditioning, and denoising network using composable building blocks.

Pre-trained weights are included for all four diffusion models, so you can generate and evaluate immediately before training from scratch.

## Pretrained Results

Trained on Fashion-MNIST T-shirt class (6K images), PyTorch CUDA:

| Model | Params | Val Loss | Generation |
|---|---|---|---|
| MLP Denoiser (baseline) | ~810K | ~0.008 | Single-pass reconstruction |
| MLP DDPM (Ho 2020) | ~930K | ~0.007 | DDPM 50-step reverse process |
| NCSN (Song & Ermon 2019) | ~1.3M | ~0.007 | Langevin dynamics |
| Score SDE (Song et al. 2021) | ~1.3M | ~0.007 | DDPM or Langevin |

### Generation Quality (in-app evaluation)

Run via the Evaluation tab using the `Generation Quality` recipe — samples 75 generations per model and compares against the held-out reference set with set-level distribution metrics.

![Generation quality comparison](images/04_test.png)

| Model | MMD ↓ | Mean Gap ↓ | NN Coverage ↑ | NN Precision ↑ | Diversity Gap ↓ |
|---|---|---|---|---|---|
| **MLP DDPM** | **0.072** | 0.228 | **0.525** | 0.090 | 0.533 |
| NCSN | 0.092 | 0.186 | 0.333 | **0.102** | **0.288** |
| Score SDE | 0.081 | **0.085** | 0.340 | 0.103 | 0.540 |

**No single model wins every metric** — that's the honest, real-world picture. MLP DDPM has the best distribution matching (lowest MMD) and highest coverage. Score SDE has the lowest mean gap, meaning its sample mean lands closest to the reference distribution. NCSN trades coverage for diversity, producing samples that fall closer to real images on average.

The educational point is structural: three different sampling philosophies (forward-noise→reverse, score-matching+Langevin, unified SDE) all produce reasonable generations on this small T-shirt dataset, and the platform's evaluation pipeline scores them under the same protocol so the comparison is meaningful.

### Comparison with Original Papers

| Aspect | Original DDPM (Ho et al.) | Our Simplified Version |
|--------|--------------------------|----------------------|
| **Architecture** | UNet with residual blocks + attention | MLP (Dense layers + LayerNorm) |
| **Image size** | 32x32 (CIFAR-10), 256x256 (LSUN) | 28x28 (Fashion-MNIST, flattened) |
| **Diffusion steps** | T=1000 | T=50 |
| **Prediction** | Noise prediction (epsilon) | Clean image prediction (x0, sigmoid) |
| **Parameters** | ~35M | ~1M |
| **Training** | Days on 8 V100s | Minutes on single GPU |

Our x0-prediction variant with sigmoid output works for normalized images in [0,1] and avoids the numerical instability of noise-prediction at low timesteps.

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

## Generation

| Method | Description |
|---|---|
| **Reconstruct** | Pass test images through noise → denoise (shows quality) |
| **DDPM** | Iterative: start from pure noise, denoise T steps → new images |
| **Langevin** | Annealed iterative denoising from noise → new images |

## How to Use

1. Open `index.html` in a browser
2. Generate Fashion-MNIST dataset (T-shirt class, 6000 images, 80/10/10 split)
3. **Immediate generation**: in the Generation tab, use the `(pre-trained)` cards first if you want to inspect the shipped checkpoints without retraining
4. **Train from scratch**: in the Trainer tab, select the plain trainer cards and click `Start Training`
5. Generation tab: use `Reconstruct` to inspect denoising quality, or `DDPM` / `Langevin` to sample from noise
6. Evaluation tab:
   - `Generation Quality` compares sampled outputs to the best available reference split (`test`, then `val`, then `train`) with standard set metrics (`MMD`, mean/std gaps, nearest-neighbor precision/coverage, diversity)
   - `Reconstruction Quality` compares denoised reconstructions with `Reconstruction MSE`
7. Use the `Weights` selector to compare `Last epoch` and `Best loss` when a trainer has both checkpoints saved

## References

- Ho, J., Jain, A., & Abbeel, P. **"Denoising Diffusion Probabilistic Models."** *NeurIPS 2020.* [arXiv:2006.11239](https://arxiv.org/abs/2006.11239)
- Song, Y., & Ermon, S. **"Generative Modeling by Estimating Gradients of the Data Distribution."** *NeurIPS 2019.* [arXiv:1907.05600](https://arxiv.org/abs/1907.05600)
- Song, Y., Sohl-Dickstein, J., Kingma, D., Kumar, A., Ermon, S., & Poole, B. **"Score-Based Generative Modeling through Stochastic Differential Equations."** *ICLR 2021.* [arXiv:2011.13456](https://arxiv.org/abs/2011.13456)

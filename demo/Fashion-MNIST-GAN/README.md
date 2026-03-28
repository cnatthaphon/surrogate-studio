# Fashion-MNIST GAN — Surrogate Studio Demo

**Train a Generative Adversarial Network on Fashion-MNIST in the browser.**

Uses phased training: Phase 1 trains the Discriminator, Phase 2 trains the Generator. Both phases alternate each epoch.

## Architecture

### Generator (Phase 2)
```
SampleZ(128) → Dense(256, relu) → Dense(512, relu) → Dense(784, sigmoid)
```
Takes random noise z~N(0,1) and generates 28×28 images.

### Discriminator (Phase 1)
```
ImageSource(784) → Dense(512, relu) → Dense(256, relu) → Dense(1, sigmoid)
```
Classifies real vs generated images.

### Training
- Phase 1: Train D on real images (label=1) + generated (label=0)
- Phase 2: Train G to fool D (generated → D → target label=1)
- Alternates each epoch

## How to Use

1. Open `index.html` in Chrome/Edge
2. **Dataset tab**: Generate Fashion-MNIST dataset (~30MB CDN download)
3. **Model tab**: GAN graph pre-loaded — Generator (top) + Discriminator (bottom)
4. **Trainer tab**: Click Start Training — phased training shows D-loss and G-loss per epoch
5. **Generation tab**: After training, sample from z → Generator → images

## Files

| File | Description |
|------|-------------|
| `index.html` | Loads core from `../../src/` + preset |
| `preset.js` | Pre-configured GAN graph + trainer |

## Reference

GAN architecture based on the original:
> **Generative Adversarial Nets** — Goodfellow et al., 2014
> [arXiv:1406.2661](https://arxiv.org/abs/1406.2661)

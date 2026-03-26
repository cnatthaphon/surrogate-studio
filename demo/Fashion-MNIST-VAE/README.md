# Fashion-MNIST VAE — Surrogate Studio Demo

**Train a Variational Autoencoder on Fashion-MNIST entirely in the browser.**

This demo trains three models on the full Fashion-MNIST dataset (60,000 images) and compares reconstruction quality, generation, and classification accuracy.

---

## Models

### VAE (784 → 32 → 784)

```
ImageSource(784) → Dense(512,relu) → Dense(256,relu) → μ(32)/logσ²(32) → Reparam(β=1.0) → Dense(256,relu) → Dense(512,relu) → Output(784)
```

- **Encoder**: 784 → 512 → 256 → latent (32-dim)
- **Decoder**: 32 → 256 → 512 → 784
- **Loss**: BCE reconstruction + β·KL divergence
- **Parameters**: ~670K

### MLP-AE (baseline)

```
ImageSource(784) → Dense(512,relu) → Dense(256,relu) → Dense(32,relu) → Dense(256,relu) → Dense(512,relu) → Output(784)
```

- Same capacity, no stochastic latent, MSE loss
- For comparison: does the VAE's structured latent help?

### Classifier (baseline)

```
ImageSource(784) → Dense(256,relu) → Dense(128,relu) → Output(10, softmax)
```

- Standard MLP classifier for accuracy benchmark
- Cross-entropy loss, 10 classes

## Dataset

- **Source**: Fashion-MNIST (Zalando Research, 2017)
- **Size**: 60,000 training + 10,000 test images
- **Format**: 28×28 grayscale, 10 classes
- **Classes**: T-shirt/top, Trouser, Pullover, Dress, Coat, Sandal, Shirt, Sneaker, Bag, Ankle boot
- **Fetched from CDN** on first generate (not embedded — ~30MB download)

## How to Use

1. Open `index.html` in Chrome/Edge
2. **Dataset tab**: click "Generate Dataset" — downloads Fashion-MNIST from CDN (~30MB, one-time)
3. **Model tab**: VAE, AE, and Classifier graphs pre-loaded
4. **Trainer tab**: select a trainer → Start Training
5. **Generation tab**: after training VAE/AE → reconstruct or sample
6. **Evaluation tab**: benchmark all three models

### Optional: PyTorch Server

```bash
cd server && npm install && node training_server.js
```

Server is checked by default. If available, trains on PyTorch (CUDA). If not, falls back to TF.js.

## Architecture

**Zero core modifications.** Uses built-in `fashion_mnist` schema and module. The demo only adds:

| File | Description |
|------|-------------|
| `index.html` | Loads core from `../../src/` + preset |
| `preset.js` | Pre-configured store: 1 dataset, 3 models, 3 trainers, 1 generation, 1 evaluation |

## Fashion-MNIST Classes

| Label | Class |
|:-----:|-------|
| 0 | T-shirt/top |
| 1 | Trouser |
| 2 | Pullover |
| 3 | Dress |
| 4 | Coat |
| 5 | Sandal |
| 6 | Shirt |
| 7 | Sneaker |
| 8 | Bag |
| 9 | Ankle boot |

## Reference

> **Fashion-MNIST: a Novel Image Dataset for Benchmarking Machine Learning Algorithms**
> — Han Xiao, Kashif Rasul, Roland Vollgraf (Zalando Research, 2017)
> [arXiv:1708.07747](https://arxiv.org/abs/1708.07747)

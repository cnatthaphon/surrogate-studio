# Surrogate Studio

[![CI](https://github.com/cnatthaphon/surrogate-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/cnatthaphon/surrogate-studio/actions/workflows/ci.yml) ![Demos](https://img.shields.io/badge/demos-15-orange) ![Models](https://img.shields.io/badge/models-43-blue) ![Tests](https://img.shields.io/badge/E2E%20checks-297%20pass-brightgreen) ![Papers](https://img.shields.io/badge/papers%20cited-18-blueviolet) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**A visual ML platform that reproduces 15 published papers — trainable in the browser with no install.**

One person built a drag-and-drop neural network editor covering GAN, Diffusion, Transformer, UNet, detection, segmentation, NLP, and metric learning. Models train in TF.js (browser) or PyTorch (server) from the same visual graph. Cross-runtime weight conversion included.

### [Try it now](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Benchmark/) — no install, runs entirely in your browser.

![Demo Workflow](demo/Fashion-MNIST-Benchmark/images/demo_workflow.gif)

---

## What It Does

| Feature | Detail |
|---------|--------|
| **Visual Graph Editor** | Drag-and-drop model design with 35+ node types (MLP, CNN, RNN, VAE, GAN, Diffusion, Transformer) |
| **Dual Runtime** | Train with TF.js in browser or PyTorch via Node.js server — same graph, same UI |
| **Cross-Runtime Weights** | Automatic weight conversion: Dense transpose, LSTM gate swap, Conv dim shuffle, BatchNorm stats |
| **15 Paper Reproductions** | Self-contained demos with pretrained weights, benchmarks, and citations |
| **Notebook Export** | Export `.ipynb` + `dataset.csv` + `model.graph.json` for reproducible PyTorch training |
| **Plugin Architecture** | Each demo is a plugin — zero core code changes needed to add a new paper reproduction |

---

## 15 Demos

Every demo runs on [GitHub Pages](https://cnatthaphon.github.io/surrogate-studio/) — click any link to try it.

| Demo | Domain | Architecture | Paper |
|------|--------|-------------|-------|
| [Fashion-MNIST Benchmark](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Benchmark/) | Classification | MLP, CNN, AE, VAE, Denoising AE (7 models) | Rumelhart '86 through Ho '20 |
| [Fashion-MNIST GAN](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-GAN/) | Generation | MLP-GAN, DCGAN, WGAN | Goodfellow '14, Radford '16, Arjovsky '17 |
| [Fashion-MNIST Diffusion](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Diffusion/) | Generation | DDPM, NCSN, Score SDE | Ho '20, Song '19, Song '21 |
| [Conditional Diffusion](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Conditional-Diffusion/) | Generation | Class-conditioned DDPM | Ho '20 + Dhariwal '21 |
| [Fashion-MNIST UNet](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-UNet/) | Reconstruction | Encoder-decoder + skip connections | Ronneberger '15 |
| [Vision Transformer](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Transformer/) | Classification | PatchEmbed + self-attention (ViT) | Dosovitskiy '21 |
| [TrAISformer](https://cnatthaphon.github.io/surrogate-studio/demo/TrAISformer/) | Trajectory | Transformer on AIS vessel data + Leaflet map | Nguyen '21 |
| [LSTM-VAE](https://cnatthaphon.github.io/surrogate-studio/demo/LSTM-VAE-for-dominant-motion-extraction/) | Reconstruction | LSTM encoder-decoder with VAE latent | Jadhav '22 |
| [Oscillator Surrogate](https://cnatthaphon.github.io/surrogate-studio/demo/Oscillator-Surrogate/) | Regression | MLP, GRU, VAE, guided generation, Langevin | Physics surrogates |
| [Cell Nuclei Segmentation](https://cnatthaphon.github.io/surrogate-studio/demo/Cell-Nuclei-Segmentation/) | Segmentation | UNet on real microscopy (DSB 2018) | Ronneberger '15 |
| [Synthetic Segmentation](https://cnatthaphon.github.io/surrogate-studio/demo/Synthetic-Segmentation/) | Segmentation | UNet vs MLP on binary masks | Ronneberger '15 |
| [Synthetic Detection](https://cnatthaphon.github.io/surrogate-studio/demo/Synthetic-Detection/) | Detection | CNN with bbox + class heads | Redmon '16 |
| [SAR Ship Detection](https://cnatthaphon.github.io/surrogate-studio/demo/SAR-Ship-Detection/) | Detection | CNN on real HRSID radar imagery | Wei '20 |
| [Text Sentiment](https://cnatthaphon.github.io/surrogate-studio/demo/Text-Sentiment-Transformer/) | NLP | Embedding + Transformer + classify | Vaswani '17 |
| [Siamese Verification](https://cnatthaphon.github.io/surrogate-studio/demo/Siamese-Shape-Verification/) | Metric Learning | Pair-based similarity classification | Bromley '93 |

Each demo has its own README with architecture details, benchmark results, and how-to-use guide. See [DEMOS.md](DEMOS.md) for the full breakdown.

---

## Quick Start

### Browser (no install)

Open any demo directly on GitHub Pages:
```
https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Benchmark/
```

### Local Server

```bash
npm install
npm start        # http://localhost:3777
```

Serves all demos + PyTorch training API. CUDA is used automatically if available.

---

## Architecture

```
Browser (TF.js)                    Server (PyTorch)
┌──────────────────────┐          ┌─────────────────────┐
│  Visual Graph Editor │          │  training_server.js  │
│  (Drawflow, 35+ nodes)│  ──────>│  train_subprocess.py │
│  Training Engine     │  SSE     │  generate_subprocess │
│  Generation Engine   │  <────── │  predict_subprocess  │
│  Evaluation / Export │          │  CUDA auto-detected  │
└──────────────────────┘          └─────────────────────┘
         │                                  │
         └──── weight_converter.js ────────┘
              (cross-runtime mapping)
```

**Core principles**: zero hardcode (everything from schema/config), plugin demos (no core changes per paper), same contract across TF.js/PyTorch/notebook.

See [Architecture Details](DEMOS.md#architecture) for the full file map.

---

## Testing

| Suite | Coverage |
|-------|----------|
| Contract tests | 31 scripts |
| Multi-schema pipeline | 11 schemas (5 full train+eval, 6 module-verified) |
| GitHub Pages E2E | 297 checks across all 15 demos |

```bash
npm test                                    # contract suite
npm run test:pipeline                       # headless multi-schema
node scripts/test_github_pages_e2e.js       # E2E on live site
```

---

## License

[MIT](LICENSE)

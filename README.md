# Surrogate Studio

![Status](https://img.shields.io/badge/status-active%20development-brightgreen) ![Models](https://img.shields.io/badge/models-25-blue) ![Demos](https://img.shields.io/badge/demos-7-orange)

**A schema-driven, browser-first ML experimentation platform.**

**[Live Demo](https://cnatthaphon.github.io/surrogate-studio/)** | [Benchmark](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Benchmark/) | [GAN](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-GAN/) | [Diffusion](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Diffusion/) | [Conditional Diffusion](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Conditional-Diffusion/) | [Transformer](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Transformer/) | [LSTM-VAE](https://cnatthaphon.github.io/surrogate-studio/demo/LSTM-VAE-for-dominant-motion-extraction/) | [Oscillator](https://cnatthaphon.github.io/surrogate-studio/demo/Oscillator-Surrogate/)

**[Contributing](CONTRIBUTING.md)** | **[Developer Docs](docs/README.md)** | **[Server Notes](server/README.md)** | **[Schema Notes](schemas/README.md)**

Build datasets, design neural network architectures visually, train models, generate samples, and benchmark results from a single page. It works fully in the browser, with an optional PyTorch server for faster training and cross-runtime checks.

Each demo folder also includes its own README with a `How to Use` section, so the root README can stay high-level while the demo README explains the exact trainer/generation/evaluation flow.

![Demo Workflow](demo/Fashion-MNIST-Benchmark/images/demo_workflow.gif)

---

## Key Features

- **Visual Model Builder** — drag-and-drop neural network design with [Drawflow](https://github.com/jerosoler/Drawflow). 35+ node types across MLP, CNN, RNN, VAE, GAN, and Diffusion architectures.
- **Schema-Driven** — everything reads from schema and config. Zero hardcoded target names in core paths. New dataset types are plugins, not code changes. Each output node carries explicit `headType` (classification/regression/reconstruction) from schema metadata.
- **Dual Runtime** — train with TF.js in the browser or with PyTorch via the optional Node.js server. Same graph contract, same trainer UI, same artifact flow.
- **Cross-Runtime Weights** — per-node-type weight mapping between TF.js and PyTorch (Dense transpose, LSTM gate swap, GRU gate reorder, Conv dimension shuffle, BatchNorm running stats).
- **Notebook Export** — export either a single `.ipynb` file or a ZIP bundle with `dataset.csv`, `model.graph.json`, and `run.ipynb` for reproducible PyTorch training outside the browser.
- **Paper Reproductions** — self-contained demo folders that reproduce published research, with benchmarks and screenshots. No core modifications needed.

---

## Demos

### [Fashion-MNIST Benchmark](demo/Fashion-MNIST-Benchmark/) — 7 Architectures Compared

Live: [GitHub Pages](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Benchmark/) | Guide: [README](demo/Fashion-MNIST-Benchmark/README.md)

A visual survey of 35 years of neural network research, trained and evaluated on the same dataset.

| Model | Training | Test | Generation |
|:---:|:---:|:---:|:---:|
| ![Model](demo/Fashion-MNIST-Benchmark/images/12_model_0.png) | ![Train](demo/Fashion-MNIST-Benchmark/images/02_trainer.png) | ![Test](demo/Fashion-MNIST-Benchmark/images/04_test_mlp_classification.png) | ![Gen](demo/Fashion-MNIST-Benchmark/images/06_gen_ae_reconstruct.png) |

| # | Architecture | Params | Paper |
|---|---|---|---|
| 1 | MLP Baseline | ~235K | Rumelhart et al. 1986 |
| 2 | CNN (LeNet-5) | ~860K | LeCun et al. 1998 |
| 3 | Dense Autoencoder | ~450K | Hinton & Salakhutdinov 2006 |
| 4 | Conv Autoencoder | ~85K | Masci et al. 2011 |
| 5 | VAE | ~414K | Kingma & Welling 2014 |
| 6 | VAE+Classifier | ~414K | Multi-task learning |
| 7 | Denoising AE | ~734K | Ho et al. 2020 |

### [Fashion-MNIST GAN](demo/Fashion-MNIST-GAN/) — 3 Adversarial Architectures

Live: [GitHub Pages](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-GAN/) | Guide: [README](demo/Fashion-MNIST-GAN/README.md)

Real adversarial training with no hardcoded GAN logic — everything from Drawflow graph blocks (ConcatBatch, PhaseSwitch, Constant, weight tags).

| MLP-GAN (Client) | DCGAN (Client) | WGAN (Client) |
|:---:|:---:|:---:|
| ![MLP](demo/Fashion-MNIST-GAN/images/mlp_gan_client.png) | ![DCGAN](demo/Fashion-MNIST-GAN/images/dcgan_client.png) | ![WGAN](demo/Fashion-MNIST-GAN/images/wgan_client.png) |

| # | Architecture | Loss | Paper |
|---|---|---|---|
| 1 | MLP-GAN (LayerNorm + Dropout) | BCE + label smoothing | Goodfellow 2014 |
| 2 | DCGAN (BatchNorm + LeakyReLU) | BCE (0/1 targets) | Radford 2016 |
| 3 | MLP-WGAN (linear critic, weight clipping) | Wasserstein | Arjovsky 2017 |

Pre-trained weights included for all 3 models — generate T-shirt images immediately without training. The screenshots above are client-generated examples; you can train on client (TF.js WebGL) or server (PyTorch CUDA).

The GAN demo also includes blank trainer cards alongside the pre-trained ones. Use the cards with `(pre-trained)` for immediate generation, and use the plain `... Trainer` cards when you want to train from scratch.

### [Fashion-MNIST Diffusion](demo/Fashion-MNIST-Diffusion/) — 4 Denoising Models

Live: [GitHub Pages](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Diffusion/) | Guide: [README](demo/Fashion-MNIST-Diffusion/README.md)

Iterative denoising from noise to images. Standard supervised MSE training — no adversarial dynamics.

| # | Architecture | Method | Paper |
|---|---|---|---|
| 1 | MLP Denoiser (baseline) | Single-step denoise | — |
| 2 | MLP DDPM (timestep-conditioned) | Iterative DDPM | Ho 2020 |
| 3 | NCSN (deep score network) | Langevin dynamics | Song & Ermon 2019 |
| 4 | Score SDE (skip connections, cosine schedule) | SDE sampling | Song et al. 2021 |

### [Fashion-MNIST Conditional Diffusion](demo/Fashion-MNIST-Conditional-Diffusion/) — Class-Conditioned Generation

Live: [GitHub Pages](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Conditional-Diffusion/) | Guide: [README](demo/Fashion-MNIST-Conditional-Diffusion/README.md)

Generate specific Fashion-MNIST classes by conditioning the denoiser on a one-hot class label. Uses the new **ClassEmbed** graph node — select T-shirt, Trouser, or Sneaker from a dropdown.

| # | Architecture | Conditioning | Paper |
|---|---|---|---|
| 1 | Conditional DDPM | image + time + class | Ho 2020 + class concat |
| 2 | Conditional Denoiser | image + class | Baseline + class concat |

3 classes (T-shirt/top, Trouser, Sneaker), pretrained on 18K real Fashion-MNIST images. Evaluations included: generation quality, reconstruction quality, per-class comparison.

### [Fashion-MNIST Transformer](demo/Fashion-MNIST-Transformer/) — Vision Transformer Classification

Live: [GitHub Pages](https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Transformer/) | Guide: [README](demo/Fashion-MNIST-Transformer/README.md)

Attention-based image classification without convolutions using the graph editor's `PatchEmbed`, `TransformerBlock`, and `GlobalAvgPool1D` nodes. Pretrained on PyTorch CUDA, evaluated in TF.js browser.

| Model | Params | Test Accuracy | Macro F1 |
|-------|:------:|:-------------:|:--------:|
| Tiny ViT (1 block) | 45,624 | 80.70% | 0.8058 |
| **Small ViT (2 blocks)** | 87,288 | **82.50%** | **0.8260** |
| ViT + MLP Head (2 blocks) | 96,248 | 81.30% | 0.8141 |

> Paper: *"An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale"* — Dosovitskiy et al., ICLR 2021. [arXiv:2010.11929](https://arxiv.org/abs/2010.11929)

### [TrAISformer](demo/TrAISformer/) — Transformer-based AIS Trajectory Prediction

Live: [GitHub Pages](https://cnatthaphon.github.io/surrogate-studio/demo/TrAISformer/) | Guide: [README](demo/TrAISformer/README.md)

Predict vessel positions in the Baltic Sea from AIS (Automatic Identification System) data using transformer-based sequence models. Interactive Leaflet map with satellite tiles, speed-colored trajectories, and course-heading markers.

| Model | Params | Test MAE | Test RMSE | Test R² |
|-------|:------:|:--------:|:---------:|:-------:|
| **MLP Baseline** | 16,836 | **0.0225** | **0.0741** | **0.924** |
| Tiny TrAISformer (1 block) | 10,884 | 0.0382 | 0.0884 | 0.891 |
| Small TrAISformer (2 blocks) | 21,476 | 0.0400 | 0.0893 | 0.889 |

> Paper: *"TrAISformer — A generative transformer for AIS trajectory prediction"* — Nguyen et al., 2021. [arXiv:2109.03958](https://arxiv.org/abs/2109.03958)

### [LSTM-VAE for Dominant Motion Extraction](demo/LSTM-VAE-for-dominant-motion-extraction/)

Live: [GitHub Pages](https://cnatthaphon.github.io/surrogate-studio/demo/LSTM-VAE-for-dominant-motion-extraction/) | Guide: [README](demo/LSTM-VAE-for-dominant-motion-extraction/README.md)

Reproduces the LSTM-VAE from Jadhav & Barati Farimani (2022) for ant trajectory reconstruction.

| Training | Generation |
|:---:|:---:|
| ![Training](demo/LSTM-VAE-for-dominant-motion-extraction/images/training.gif) | ![Generation](demo/LSTM-VAE-for-dominant-motion-extraction/images/generation.gif) |

| Model | Params | Test R² | Test RMSE |
|-------|:------:|:-------:|:---------:|
| LSTM-VAE | 77,100 | **0.9970** | 0.0164 |
| MLP-AE (baseline) | 19,312 | 0.9882 | 0.0325 |

> Paper: *"Dominant motion identification of multi-particle system using deep learning from video"* — Jadhav & Barati Farimani, 2022. [arXiv:2104.12722](https://arxiv.org/abs/2104.12722)

### [Oscillator Surrogate](demo/Oscillator-Surrogate/)

Live: [GitHub Pages](https://cnatthaphon.github.io/surrogate-studio/demo/Oscillator-Surrogate/) | Guide: [README](demo/Oscillator-Surrogate/README.md)

5 model architectures on RK4-simulated physics trajectories (spring, pendulum, bouncing ball). Full platform showcase: training, generation (reconstruct, random, classifier-guided, Langevin), and evaluation.

| Model | Params | Test MAE | Test R² |
|-------|:------:|:--------:|:-------:|
| Direct-MLP | 4,962 | 0.0282 | 0.963 |
| AR-GRU | 22,882 | 0.0277 | 0.966 |
| VAE (8-dim latent) | 2,362 | 0.0278 | 0.949 |
| **VAE+Classifier** | 8,605 | **0.0251** | **0.970** |
| Denoising AE | 7,138 | 0.0420 | 0.944 |

---

## Tabs

| Tab | Purpose |
|-----|---------|
| **Playground** | Browse schemas, preview dataset modules (trajectory plots, image grids) |
| **Dataset** | Generate and manage datasets from registered modules |
| **Model** | Visual graph editor with schema-driven palette and presets |
| **Trainer** | Train models, monitor loss curves, view test metrics (accuracy, R², confusion matrix, scatter plots) |
| **Generation** | Reconstruct, random sample, classifier-guided, Langevin dynamics, DDPM |
| **Evaluation** | Compare multiple trained models on the same test data (benchmark) |

---

## Supported Schemas

| Schema | Type | Features | Dataset Module |
|--------|------|----------|---------------|
| `oscillator` | Trajectory | RK4 physics (spring, pendulum, bouncing ball) | Built-in |
| `mnist` | Image | 28x28 grayscale, 10 classes | Lazy-fetch from CDN |
| `fashion_mnist` | Image | 28x28 grayscale, 10 classes | Lazy-fetch from CDN |
| `cifar10` | Image | 32x32 RGB, 10 classes | Lazy-fetch from CDN |
| `ais_trajectory` | Trajectory | Window of (lat, lon, sog, cog), predict next position | Built-in |
| `ant_trajectory` | Trajectory | 20 ants x (x,y), 40 features | Demo plugin |

---

## Node Types (35+)

| Category | Nodes |
|----------|-------|
| **MLP** | Input, Dense, Dropout, BatchNorm, LayerNorm, Output |
| **CNN** | Conv2D, Conv2DTranspose, MaxPool2D, UpSample2D, Flatten, Reshape, GlobalAvgPool2D |
| **Transformer** | PatchEmbed, TransformerBlock, GlobalAvgPool1D |
| **RNN** | SimpleRNN, GRU, LSTM, Conv1D, Concat |
| **VAE** | Latent mu, Latent logvar, Reparameterize |
| **GAN** | SampleZ, Detach |
| **Diffusion** | AddNoise (GaussianNoise), NoiseSchedule, TimeEmbed, ClassEmbed |
| **NLP** | Embedding |
| **Feature** | ImageSource, History, WindowHistory, Params, OneHot |
| **Utility** | SinNorm, CosNorm, TimeNorm, TimeSec |

---

## Quick Start

### Browser / GitHub Pages

Open the full app on GitHub Pages:

```text
https://cnatthaphon.github.io/surrogate-studio/
```

Direct demo entrypoints:

```text
https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Benchmark/
https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-GAN/
https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Diffusion/
https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Conditional-Diffusion/
https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Transformer/
https://cnatthaphon.github.io/surrogate-studio/demo/LSTM-VAE-for-dominant-motion-extraction/
https://cnatthaphon.github.io/surrogate-studio/demo/Oscillator-Surrogate/
```

Each demo README linked above explains how to use that demo inside the app.

```
Open `index.html` in Chrome/Edge (works on `file://`)
```

Or serve locally:

```bash
npx serve .
# -> http://localhost:3000
```

### Demo

```
Open demo/Fashion-MNIST-Benchmark/index.html
```

Dataset loads from CDN. Select a trainer, click **Start Training**, watch the loss curve.

### PyTorch Server (optional, faster)

```bash
cd server
npm install
node training_server.js
```

Check `Use PyTorch Server` in the Trainer config before training. CUDA will be used if available.

---

## Architecture

```
index.html
  |-- src/schema_registry.js          -- schema definitions + palette + headType
  |-- src/dataset_modules.js          -- module registry + build contract
  |-- src/model_builder_core.js       -- graph -> TF.js model (MLP, CNN, VAE, GAN, etc.)
  |-- src/model_graph_core.js         -- Drawflow node factories + preset renderer
  |-- src/training_engine_core.js     -- train loop (multi-head, phased, headType-driven)
  |-- src/generation_engine_core.js   -- reconstruct, random, classifier-guided, Langevin, DDPM
  |-- src/weight_converter.js         -- per-node-type PyTorch <-> TF.js weight mapping
  |-- src/notebook_bundle_core.js     -- ZIP export (dataset + graph + notebook)
  |-- src/workspace_store.js          -- in-memory store (datasets, models, trainers)
  |-- src/dataset_source_registry.js  -- zero-copy source management (60K images, no duplication)
  |-- src/server_runtime_adapter.js   -- gzip streaming to PyTorch server
  |-- src/surrogate_studio.js         -- orchestrator: init -> layout -> tabs -> wiring
  +-- src/tabs/*.js                   -- tab controllers (dataset, model, trainer, generation, evaluation)

server/
  |-- training_server.js              -- Node.js HTTP server, SSE epoch streaming
  |-- train_subprocess.py             -- PyTorch training (graph -> model, phased, headType)
  |-- generate_subprocess.py          -- PyTorch generation (reconstruct, random, Langevin, DDPM)
  +-- predict_subprocess.py           -- PyTorch batch prediction

demo/<paper>/
  |-- preset.js                       -- pre-configured store (dataset + models + trainers + generations + evaluations)
  |-- index.html                      -- loads core from ../../src/ + preset
  |-- README.md                       -- paper citation, architecture, benchmark results
  +-- images/                         -- screenshots + GIF (captured via Puppeteer)
```

### Core Principles

1. **Zero hardcode** — everything from schema/config. Classification detected via `headType`, not target name strings.
2. **Module reuse** — compose existing modules, don't rewrite
3. **Plugin demos** — paper reproductions need zero core changes
4. **No build step** — UMD/IIFE modules, script load order = dependencies
5. **Same contract everywhere** — TF.js browser, PyTorch server, and exported notebook all return identical result format

---

## Validation

The public branch is still active development, so these are the most useful checks before pushing:

```bash
# Contract suite
npm test

# Browser UI checks
npm run test:browser

# Headless multi-schema pipeline
npm run test:pipeline

# Benchmark / full flow with server running
node scripts/test_benchmark_full.js

# Notebook export verification
node scripts/test_headless_notebook_export.js
node scripts/test_headless_export_verify.js
node scripts/test_notebook_kernel_api.js
node scripts/test_browser_notebook_runner.js

# Capture demo screenshots + GIF
node scripts/capture_demo_assets.js demo/Fashion-MNIST-Benchmark 5

# Cross-runtime weight verification
node scripts/test_cross_runtime_weights.js
```

---

## Papers Cited

| Paper | Year | Demo |
|-------|------|------|
| Rumelhart, Hinton, Williams — "Learning representations by back-propagating errors" | 1986 | Benchmark |
| LeCun, Bottou, Bengio, Haffner — "Gradient-Based Learning Applied to Document Recognition" | 1998 | Benchmark |
| Hinton & Salakhutdinov — "Reducing the Dimensionality of Data with Neural Networks" | 2006 | Benchmark |
| Masci et al. — "Stacked Convolutional Auto-Encoders" | 2011 | Benchmark |
| Kingma & Welling — "Auto-Encoding Variational Bayes" | 2013 | Benchmark |
| Goodfellow et al. — "Generative Adversarial Nets" | 2014 | GAN |
| Radford, Metz, Chintala — "Unsupervised Representation Learning with DCGANs" | 2015 | GAN |
| Ho, Jain, Abbeel — "Denoising Diffusion Probabilistic Models" | 2020 | Benchmark |
| Jadhav & Barati Farimani — "LSTM-VAE for dominant motion extraction" | 2022 | LSTM-VAE |

## Adding a New Demo

1. Create `demo/<paper-name>/`
2. Write `preset.js` with pre-configured store entries (dataset, models, trainers, generations, evaluations)
3. Create `index.html` that loads core from `../../src/` + your preset
4. Write `README.md` with paper citation, architecture, benchmark results
5. Capture screenshots: `node scripts/capture_demo_assets.js demo/<paper-name> 5`

No core files need to change. All demos are plugins.

---

## License

See repository for license details.

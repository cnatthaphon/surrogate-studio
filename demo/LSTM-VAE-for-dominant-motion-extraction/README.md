# LSTM-VAE for Dominant Motion Extraction — Surrogate Studio Demo

Reproduction of the LSTM Variational Autoencoder from [LSTM-VAE-for-dominant-motion-extraction](https://github.com/your-username/LSTM-VAE-for-dominant-motion-extraction) (Arxiv 2021, [paper](https://arxiv.org/pdf/2104.12722.pdf)).

## Dataset

**Ant trajectory data** — 20 ants tracked over 10,399 timesteps, each with 2D position (x, y).

- **Source**: `data/ant_dataset_gt.mat` from the original repo
- **Format**: 1,000 timesteps x 40 features (20 ants x 2 coordinates)
- **Normalization**: MinMax scaled to [0, 1]
- **Embedded**: data is included as `ant_data.js` (237KB) — no network fetch required

## Network Architecture

### LSTM-VAE (paper architecture)

```
Input (40-dim) → LSTM(32) → [μ(8), logσ²(8)] → Reparam z(8, β=0.001) → Dense(64, relu) → Output(40-dim)
```

- **Encoder**: LSTM with 32 hidden units, no return sequences
- **Latent**: 8-dimensional, reparameterization trick with KL weight β=0.001
- **Decoder**: Dense(64, relu) → output reconstruction (40-dim)
- **Loss**: MSE(reconstruction) + β * KL(z)

### MLP-AE (baseline)

```
Input (40-dim) → Dense(32, relu) → Dense(8, relu) → Dense(32, relu) → Output(40-dim)
```

Simple autoencoder for comparison — no stochastic latent, no KL loss.

## How to Use

1. Open `index.html` in a browser (works on `file://`)
2. **Dataset tab**: click "Generate Dataset" to build train/val/test splits from embedded data
3. **Model tab**: LSTM-VAE and MLP-AE graphs are pre-loaded in Drawflow editor
4. **Trainer tab**: select dataset + model, click Train
5. **Evaluation tab**: after training both models, compare reconstruction error
6. **Generation tab**: sample from the VAE latent space or optimize latent to match a target

## Files

| File | Description |
|------|-------------|
| `index.html` | Demo page — loads Surrogate Studio core + demo-specific modules |
| `ant_data.js` | Embedded ant trajectory data (1000 x 40, JS variable) |
| `ant_trajectory_schema.js` | Registers "ant_trajectory" schema at runtime |
| `ant_trajectory_module.js` | Dataset module — reads `ANT_DATA`, splits, renders trajectories |
| `preset.js` | Pre-configures store with dataset, 2 models, 2 trainers |

## Architecture

This demo uses **zero modifications to Surrogate Studio core files**. Everything is loaded from the demo folder:

- Schema registered via `OSCSchemaRegistry.registerSchema()` at runtime
- Dataset module registered via `OSCDatasetModules.registerModule()` at runtime
- Store pre-populated via `OSCWorkspaceStore.createMemoryStore()` + `upsertDataset/Model/TrainerCard`
- Core scripts loaded from `../../src/` via relative paths

## Reference

- **Paper**: "Extraction of dominant motion patterns in multi-particle trajectory data using deep learning" ([arXiv:2104.12722](https://arxiv.org/pdf/2104.12722.pdf))
- **Original repo**: [LSTM-VAE-for-dominant-motion-extraction](https://github.com/your-username/LSTM-VAE-for-dominant-motion-extraction)
- **Data**: 20-ant ground truth trajectories (`ant_dataset_gt.mat`)

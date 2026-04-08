# TrAISformer Demo — Transformer-based AIS Trajectory Prediction

Predict future vessel positions from historical AIS (Automatic Identification System) data using attention-based models. Vessels in the Baltic Sea transmit latitude, longitude, speed, and course — the model learns to predict the next position from a window of past observations.

## Results

Trained on 2,000 trajectories (89K training samples), 20 epochs, PyTorch CUDA:

| Model | Params | Test MAE | Test RMSE | Test R² |
|-------|--------|----------|-----------|---------|
| **MLP Baseline** | 16,836 | **0.0225** | **0.0741** | **0.924** |
| Tiny TrAISformer (1 block) | 10,884 | 0.0382 | 0.0884 | 0.891 |
| Small TrAISformer (2 blocks) | 21,476 | 0.0400 | 0.0893 | 0.889 |

The MLP baseline outperforms the simplified transformers on this task because:
1. Attention needs higher embedding dimensions to be effective (our 32-dim vs paper's 768-dim)
2. The paper uses discrete tokenization (250 lat bins × 270 lon bins), not continuous regression
3. The full TrAISformer has 8 layers with 8 heads — our simplified version has 1-2 layers with 4 heads

The demo shows the **infrastructure works** — training, evaluation, weight export, cross-runtime parity — even if the simplified model doesn't match the full paper's results.

## Models

### 1. MLP Baseline
Standard feedforward: `WindowHistory(lat,lon,sog,cog) → Input → Dense(128) → Dense(64) → Dense(4) → Output`

### 2. Tiny TrAISformer (1 block)
`WindowHistory → Input → Reshape[16,4] → Dense(32) projection → TransformerBlock(4 heads) → GlobalAvgPool1D → Dense(4)`

### 3. Small TrAISformer (2 blocks)
Same as Tiny but with 2 stacked TransformerBlocks for deeper cross-timestep reasoning.

## Data

**Source:** Danish Maritime Authority (DMA) — 12,126 cleaned trajectories from the Baltic Sea (55.5°N–58.0°N, 10.3°E–13.0°E).

| Split | Trajectories | Samples (window=16) |
|-------|-------------|---------------------|
| Train | 9,327 | ~566K |
| Val | 1,318 | ~83K |
| Test | 1,481 | ~97K |

Pre-processed per the paper: min 36 steps, max 120 steps, normalized [0,1], no NaN.

## How to Use

1. **Playground** — explore vessel trajectories on interactive Leaflet map (satellite + speed coloring)
2. **Dataset** → Generate — creates windowed training samples
3. **Model** — graph shows `WindowHistory → Input → ... → Output` with feature blocks
4. **Trainer** → use pre-trained cards for immediate evaluation, or train from scratch
5. **Evaluation** → benchmark all 3 models on test set

## Reference

Nguyen, Nguyen, & Matthias. **"TrAISformer — A generative transformer for AIS trajectory prediction."** *arXiv:2109.03958*, 2021. [Paper](https://arxiv.org/abs/2109.03958)

This demo reproduces a simplified version (2 layers, 32-dim, continuous regression) to run in the browser. The original uses 8 layers, 768-dim, discrete tokenization (612 bins).

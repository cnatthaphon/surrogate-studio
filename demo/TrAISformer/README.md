# TrAISformer Demo — Transformer-based AIS Trajectory Prediction

Predict future vessel positions from historical AIS (Automatic Identification System) data using attention-based models. Vessels in the Baltic Sea transmit latitude, longitude, speed, and course — the model learns to predict the next position from a window of past observations.

## Models

### 1. MLP Baseline

Standard feedforward network. Flattened window of past positions → Dense layers → next position.

### 2. Tiny TrAISformer (1 block)

Reshape the flat input into a sequence of timesteps, then apply one Transformer block (self-attention + FFN). Global average pooling across timesteps → prediction.

### 3. Small TrAISformer (2 blocks)

Two stacked Transformer blocks for deeper cross-timestep reasoning.

## Data

**Source:** Danish Maritime Authority (DMA) — public AIS records from the Baltic Sea region (55.5°N–58.0°N, 10.3°E–13.0°E).

Each trajectory is a sequence of `[latitude, longitude, SOG, COG]` normalized to [0, 1]. The dataset module creates sliding-window training samples: input = last N timesteps (flattened), target = next position.

The playground shows vessel tracks on a Leaflet map, colored by speed (blue = slow, red = fast).

## How to Use

1. **Playground** — explore vessel trajectories on the interactive map
2. **Dataset** → Generate — creates train/val/test samples from trajectory windows
3. **Model** — each preset shows `WindowHistory → Input → ... → Output` with feature blocks declaring the data source
4. **Trainer** → train MLP baseline vs Transformer, compare loss curves
5. **Evaluation** → benchmark all 3 models on the same test set

## Reference

Nguyen, Nguyen, & Matthias. **"TrAISformer — A generative transformer for AIS trajectory prediction."** *arXiv:2109.03958*, 2021. [Paper](https://arxiv.org/abs/2109.03958)

This demo reproduces a simplified version of the architecture (2 layers, 4-dim features) to run in the browser. The original paper uses 8 layers with 768-dim embeddings and discretized output bins.

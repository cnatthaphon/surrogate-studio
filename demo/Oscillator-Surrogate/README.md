# Oscillator Surrogate — Full Platform Demo

![Demo Workflow](images/demo_workflow.gif)

**5 model architectures on physics-based trajectory data. Demonstrates every feature of Surrogate Studio: training, generation, evaluation, and cross-runtime weight parity.**

## Results

Trained on 300 trajectories (37K training samples), 20 epochs, PyTorch CUDA:

| Model | Params | Test MAE | Test RMSE | Test R² |
|-------|:------:|:--------:|:---------:|:-------:|
| Direct-MLP | 4,962 | 0.0282 | 0.1044 | 0.963 |
| AR-GRU | 22,882 | 0.0277 | 0.0998 | 0.966 |
| VAE (8-dim latent) | 2,362 | 0.0278 | 0.1234 | 0.949 |
| **VAE+Classifier** | 8,605 | **0.0251** | — | **0.970** |
| Denoising AE | 7,138 | 0.0420 | 0.1286 | 0.944 |

The VAE+Classifier achieves the best R² by combining reconstruction with scenario classification — the shared encoder learns physics-aware features. The AR-GRU is a close second, exploiting temporal ordering through its recurrent state.

### Why This Matters for Surrogate Modeling

Traditional physics simulation (RK4) is exact but slow for parameter sweeps. A trained surrogate predicts trajectories in milliseconds:

| Aspect | RK4 Simulation | Trained Surrogate |
|--------|---------------|-------------------|
| Speed | ~1ms per trajectory | ~0.01ms per trajectory |
| Accuracy | Exact (to numerical precision) | R² = 0.966 (AR-GRU) |
| Use case | Reference data generation | Real-time parameter exploration, optimization |

Surrogate models enable interactive "what-if" analysis: drag a slider to change damping coefficient, instantly see the predicted trajectory — without re-running the ODE solver.

## Models

### 1. Direct-MLP
```
Params(m,c,k) + WindowHistory(x,v) → Input → Dense(64,relu) → Dense(32,relu) → Output(x,v)
```
Flat feedforward baseline. All history concatenated into a single vector.

### 2. AR-GRU (Autoregressive)
```
Params(m,c,k) + WindowHistory(x,v) → Input → GRU(64) → Dense(32,relu) → Output(x,v)
```
Recurrent model processes the window as a sequence. GRU hidden state captures oscillation phase.

### 3. VAE (Variational Autoencoder)
```
Params + WindowHistory → Input → Dense(32) → μ(8)/logσ²(8) → Reparameterize → Dense(32) → Output(x,v)
```
Latent space model (8D). Enables random sampling for trajectory generation.

### 4. VAE+Classifier (Guided Generation)
```
Params + WindowHistory → Input → Dense(64) → Dense(32) → μ(8)/logσ²(8) → Reparameterize → Dense(32) → Dense(64) → Output(x,v)
                                                      └→ Dense(16) → Output(label)
```
Shared encoder with classification head. Enables classifier-guided generation: optimize latent z to produce trajectories matching specific physics (spring vs pendulum vs bouncing ball).

### 5. Denoising AE (1D Diffusion)
```
Params + WindowHistory → Input → AddNoise(0.2) → Dense(64) → Dense(32) → Dense(64) → Output(x,v)
```
Learns to remove noise from trajectories. Enables Langevin dynamics generation from pure noise.

## Generation Methods

| Method | Model(s) | Description |
|--------|----------|-------------|
| **Reconstruct** | VAE, Denoiser | Pass test trajectories through model → compare original vs reconstructed |
| **Random Sampling** | VAE | Sample z ~ N(0,1) → decoder → synthetic trajectories |
| **Classifier-Guided** | VAE+Classifier | Optimize z to generate trajectories matching target physics class |
| **Langevin Dynamics** | Denoiser | Iterative denoising from random noise → clean trajectory |

## Dataset

RK4-simulated oscillator trajectories (generated at runtime):

| Scenario | Equation | Parameters |
|----------|----------|------------|
| **Spring** | m x'' + c x' + k x = 0 | mass, damping, stiffness |
| **Pendulum** | theta'' + (c/m) theta' + (g/L) sin(theta) = 0 | length, damping, gravity |
| **Bouncing Ball** | y'' = -g with impact restitution | mass, restitution, gravity |

300 trajectories, 200 timesteps each, window size 20. Features: position (x), velocity (v), physical parameters (m, c, k).

## How to Use

1. **Dataset** tab — generate oscillator trajectories (300 trajectories, 3 scenarios)
2. **Model** tab — inspect 5 architecture graphs with feature blocks showing data pipeline
3. **Trainer** tab — pre-trained cards show immediate test metrics (R², MAE), or train from scratch
4. **Generation** tab — reconstruct, random sample, classifier-guided, or Langevin dynamics
5. **Evaluation** tab — benchmark all models on same test set with MAE, RMSE, R², Bias

## Context

This demo showcases the full Surrogate Studio pipeline applied to computational physics. Surrogate modeling replaces expensive simulations with learned approximations — a technique widely used in engineering design optimization, uncertainty quantification, and real-time control.

The oscillator system is a canonical test case: simple enough to generate exact reference data, complex enough (3 scenarios, parameter variation, nonlinear dynamics) to challenge different model architectures.

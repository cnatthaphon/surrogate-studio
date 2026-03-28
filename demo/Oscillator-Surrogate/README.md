# Oscillator Surrogate — Surrogate Studio Demo

**Train multiple surrogate models for damped oscillator dynamics and compare them.**

Three architectures trained on the same RK4-generated trajectory data:
1. **Direct-MLP**: params+time → x,v (direct prediction)
2. **AR-GRU**: window history → next step (autoregressive with recurrence)
3. **VAE**: trajectory reconstruction with latent space for generation

## Features Demonstrated

- **Dataset**: RK4-simulated spring/pendulum/bouncing ball trajectories (generated at runtime)
- **Model comparison**: 3 architectures in evaluation benchmark (MAE, RMSE, R², Bias)
- **Generation**: VAE reconstruct + random sampling from latent space
- **All from graph**: no hardcodes, every model defined purely by Drawflow nodes

## How to Use

1. Open `index.html` — oscillator playground shows trajectory previews
2. **Dataset tab**: Generate oscillator trajectories
3. **Model tab**: 3 model graphs pre-loaded (MLP, GRU, VAE)
4. **Trainer tab**: Train each model (3 trainers pre-configured)
5. **Evaluation tab**: "MLP vs GRU vs VAE" benchmark pre-configured → Run
6. **Generation tab**: VAE generation session → Reconstruct or Random

## Architecture

Uses built-in oscillator schema — no custom module needed. Just preset.js + index.html.

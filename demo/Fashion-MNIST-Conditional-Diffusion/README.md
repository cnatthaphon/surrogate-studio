# Fashion-MNIST Conditional Diffusion Demo

Class-conditioned denoising: the model receives a one-hot class label alongside the noisy image, enabling targeted generation of specific Fashion-MNIST classes.

**3 classes**: T-shirt/top (0), Trouser (1), Sneaker (7)

## Models

### 1. Conditional DDPM

Timestep + class conditioning. Three inputs: noisy image (784), sinusoidal time embedding (64), one-hot class (3). Concatenated and passed through Dense(512) + LayerNorm + Dense(256) + LayerNorm + Dense(512) + Dense(784, sigmoid).

- **Inputs**: image_source + noise_injection + time_embed + class_embed
- **Training**: MSE loss, reconstruction target = clean image
- **Generation**: DDPM reverse process (x0-prediction), 50 steps

### 2. Conditional Denoiser

Class conditioning only (no timestep). Two inputs: noisy image (784), one-hot class (3). Simpler architecture for baseline comparison.

- **Inputs**: image_source + noise_injection + class_embed
- **Training**: MSE loss, constant noise scale 0.3
- **Generation**: DDPM reverse process or single-pass reconstruction

## How to Use

1. **Open** `index.html` in Chrome/Edge
2. **Dataset tab**: Click Generate to load Fashion-MNIST (3 classes, ~18K images)
3. **Generation tab**: Select a pretrained generation config from the left panel
   - *DDPM -> T-shirt/Trouser/Sneaker*: generates specific class via DDPM reverse process
   - *DDPM -> Random*: each sample gets a random class
   - Change the **Target class** dropdown on the right to switch classes
4. **Evaluation tab**: Run Generation Quality or Reconstruction Quality benchmarks

## Pretrained Weights

Both models are pretrained on 18K real Fashion-MNIST images (T-shirt + Trouser + Sneaker) for 30 epochs. Weights are embedded as base64 JS files and loaded automatically.

| Model | Params | Val Loss | File |
|-------|--------|----------|------|
| Conditional DDPM | 1.10M | 0.0072 | `cond_ddpm_pretrained.js` |
| Conditional Denoiser | 1.07M | 0.0064 | `cond_denoiser_pretrained.js` |

## Key Concept: ClassEmbed Node

The `ClassEmbed` node is a new graph block that provides a one-hot class vector as model input. During training, the engine reads class labels from the dataset. During generation, the user selects a target class from a dropdown (with class names resolved from the schema).

This node works across all three runtimes:
- **Client (TF.js)**: one-hot tensor from `dataset.labelsTrain`
- **Server (PyTorch)**: 3rd DataLoader tensor, set as `model._class_labels`
- **Notebook**: same as server, auto-detected from graph

## Evaluations

| Evaluation | Metrics | Description |
|-----------|---------|-------------|
| Generation Quality | MMD, Mean Gap, Std Gap, NN Precision/Coverage, Diversity | Compare generated vs real distribution |
| Reconstruction Quality | MSE | How well the model denoises |
| Per-Class Generation | MMD, Mean Gap, Diversity | Quality per target class |

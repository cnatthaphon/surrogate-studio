# Fashion-MNIST Autoencoder Generation — Dense vs Conv

![Demo Workflow](images/demo_workflow.gif)


**Train autoencoders, then generate new images from the decoder (latent space sampling).**

Two architectures compared: Dense AE vs Convolutional AE. Train as reconstruction, generate from random latent vectors through the decoder.

## Models

| # | Model | Encoder | Decoder (Generator) | Bottleneck |
|---|---|---|---|---|
| 1 | **Dense AE** | 784 → 512 → 128 | 128 → 512 → 784 | 128-dim |
| 2 | **Conv AE** | 28x28 → Conv(32) → Conv(64) → 128 | 128 → 7x7x64 → ConvT(32) → ConvT(1) → 28x28 | 128-dim |

## How to Use

1. Open `index.html`, generate Fashion-MNIST dataset
2. **Trainer tab**: Train both models (20 epochs recommended)
3. **Generation tab**: Reconstruct → see original vs decoded pairs
4. **Evaluation tab**: Compare Dense vs Conv reconstruction quality

## Generation

After training, the decoder acts as a generator:
- **Reconstruct**: Input → Encoder → Decoder → Output (compare with original)
- The latent bottleneck (128-dim) captures compressed features
- Conv AE preserves spatial structure → sharper reconstructions

## Reference

Autoencoder-based generation:
> **Generative Adversarial Nets** — Goodfellow et al., 2014. [arXiv:1406.2661](https://arxiv.org/abs/1406.2661)

DCGAN architecture:
> **Unsupervised Representation Learning with Deep Convolutional Generative Adversarial Networks** — Radford et al., 2015. [arXiv:1511.06434](https://arxiv.org/abs/1511.06434)

Convolutional autoencoders:
> **Stacked Convolutional Auto-Encoders** — Masci et al., 2011. [Springer](https://doi.org/10.1007/978-3-642-21735-7_7)

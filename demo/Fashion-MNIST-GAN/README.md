# Fashion-MNIST GAN — Real Adversarial Training

![Demo Workflow](images/demo_workflow.gif)


**Train a GAN with real adversarial structure — all defined in the visual graph editor.**

No hardcoded GAN logic in the engine. The graph itself defines the full adversarial architecture using composable building blocks: ConcatBatch (merge real+fake), PhaseSwitch (label routing by phase), Constant (label values), weight tags (freeze control).

## Presets

### 1. MLP-GAN (Goodfellow 2014)

```
Generator:
  SampleZ(128) → Dense(256, relu) → LayerNorm → Dense(512, relu) → LayerNorm
    → Dense(784, sigmoid) → Output(loss=none)

Discriminator:
  ConcatBatch(fake + real) → Dense(512, relu) → Dropout(0.3)
    → Dense(256, relu) → Dropout(0.3) → Dense(1, sigmoid) → Output(loss=BCE)

Labels:
  Constant(0.1) → PhaseSwitch(activePhase=discriminator) ← Constant(0.9)
  ConcatBatch([fake_label, real_label=0.9]) → D Output
    D step: [0.1, 0.9]  — train D to distinguish
    G step: [0.9, 0.9]  — fool D into thinking fake is real
```

- Weight-tag freeze: G layers tagged `generator`, D layers tagged `discriminator`
- Training schedule: D:10 epochs, G:1 epoch (rotating)
- LR = 0.0005, Adam, batch size 128
- Pre-trained weights included (1000 epochs on T-shirt class)

### 2. DCGAN (Radford 2015)

```
Generator:
  SampleZ(128) → Dense(6272, relu) → BatchNorm → Reshape(7,7,128)
    → ConvT2D(64, 4, stride=2, same, relu) → BatchNorm
    → ConvT2D(1, 4, stride=2, same, sigmoid) → Flatten → Output(loss=none)

Discriminator:
  ConcatBatch(fake + real) → Reshape(28,28,1)
    → Conv2D(64, 4, stride=2, same, linear) → LeakyReLU(0.2)
    → Conv2D(128, 4, stride=2, same, linear) → BatchNorm → LeakyReLU(0.2)
    → Flatten → Dense(1, sigmoid) → Output(loss=BCE)

Labels:
  Same PhaseSwitch + ConcatBatch label routing as MLP-GAN (smoothing 0.1/0.9)
```

- Training schedule: D:1 epoch, G:2 epochs (rotating)
- LR = 0.0005, Adam, batch size 128
- Note: DCGAN training is slow on browser WebGL; recommended to train on PyTorch server

### 3. MLP-WGAN (Arjovsky 2017)

```
Generator:
  Same as MLP-GAN (LayerNorm + Dense)

Critic (not "discriminator" — WGAN terminology):
  ConcatBatch(fake + real) → Dense(512, relu) → Dropout(0.3)
    → Dense(256, relu) → Dropout(0.3) → Dense(1, linear) → Output(loss=wasserstein)

Labels:
  Wasserstein uses +1 (real) and -1 (fake) instead of smoothed 0.1/0.9
  Constant(-1) → PhaseSwitch(activePhase=discriminator) ← Constant(1)
  ConcatBatch([fake_label, real_label=1]) → D Output
    D step: [-1, 1]  — maximize mean(D(real)) - mean(D(fake))
    G step: [1, 1]   — minimize -mean(D(fake))
```

- Key difference: D has **linear output** (no sigmoid) — computes Wasserstein distance
- LR = 0.00005, **RMSprop** (paper recommendation, not Adam), batch size 128
- Training schedule: D:5 epochs, G:1 epoch (critic trains more per the paper)

## Building Blocks Used

| Block | Purpose |
|---|---|
| **SampleZ** | Random noise input for generator |
| **ConcatBatch** | Merges real + fake images (and labels) into one batch for D |
| **PhaseSwitch** | Routes labels by training phase: D step gets fake=0.1, G step gets fake=0.9 |
| **Constant** | Produces label tensors (0.1 = smoothed fake, 0.9 = smoothed real) |
| **Weight tags** | `generator` / `discriminator` tags control which layers are frozen per phase |
| **LayerNorm** | Normalizes G activations (MLP-GAN) — prevents mode collapse |
| **BatchNorm** | Normalizes conv activations (DCGAN) — stabilizes deep conv training |
| **LeakyReLU** | D activation (DCGAN) — allows gradient flow for negative inputs |
| **Dropout** | D regularization (MLP-GAN) — prevents D from overpowering G |

## Training Phases

| Phase | What happens |
|---|---|
| **Discriminator** | D sees real images (label=0.9) + G output (label=0.1). G weights frozen via tag. |
| **Generator** | PhaseSwitch flips fake label to 0.9. D weights frozen. Gradient flows through D to update G. |

## How to Use

1. Open `index.html` in a browser (Chrome/Edge recommended)
2. Generate Fashion-MNIST dataset (T-shirt class, 6000 images)
3. **Pre-trained**: Select "MLP-GAN (pre-trained)" or "MLP-WGAN (pre-trained)" generation card to generate immediately
4. **Train from scratch**: Select a trainer, click Start Training, watch D/G loss curves
5. **Generation tab**: Random sampling from latent z to generate new images

## References

1. Goodfellow, Pouget-Abadie, Mirza, Xu, Warde-Farley, Ozair, Courville, Bengio. **"Generative Adversarial Nets."** *NeurIPS 2014*. [arXiv:1406.2661](https://arxiv.org/abs/1406.2661)

2. Radford, Metz, Chintala. **"Unsupervised Representation Learning with Deep Convolutional Generative Adversarial Networks."** *ICLR 2016*. [arXiv:1511.06434](https://arxiv.org/abs/1511.06434)

3. Arjovsky, Chintala, Bottou. **"Wasserstein Generative Adversarial Networks."** *ICML 2017*. [arXiv:1701.07875](https://arxiv.org/abs/1701.07875)

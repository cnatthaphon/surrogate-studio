# Fashion-MNIST GAN — MLP-GAN vs DCGAN

![Demo Workflow](images/demo_workflow.gif)


**Train and compare two generative adversarial network architectures in the browser.**

Phased training: Generator and Discriminator alternate each epoch, exactly as described in the original papers.

## Models

| # | Model | Generator | Discriminator | Paper |
|---|---|---|---|---|
| 1 | **MLP-GAN** | z(128) → Dense(256) → Dense(512) → Dense(784) | Dense(512) → Dense(256) → Dense(784) | Goodfellow 2014 |
| 2 | **DCGAN** | z(128) → Dense(6272) → Reshape(7,7,128) → ConvT2D(64) → ConvT2D(1) | Reshape(28,28,1) → Conv2D(64) → Conv2D(128) → Flatten → Dense(784) | Radford 2015 |

## How to Use

1. Open `index.html`, generate Fashion-MNIST dataset
2. **Trainer tab**: Train MLP-GAN and DCGAN (phased training — watch G-loss and D-loss)
3. **Generation tab**: Generate images from both models → compare quality
4. **Evaluation tab**: Run benchmark → compare reconstruction metrics

## Training Phases

Both models use phased training (the key GAN innovation):
- **Generator phase**: Generator creates fake images, loss = how different from real images
- **Discriminator phase**: Discriminator trains on real images, learns reconstruction

Phases alternate each epoch. The generator never sees real data directly — it learns only through the training signal.

## Reference

Original GAN:
> **Generative Adversarial Nets** — Goodfellow, Pouget-Abadie, Mirza, Xu, Warde-Farley, Ozair, Courville, Bengio, 2014
> [arXiv:1406.2661](https://arxiv.org/abs/1406.2661)

DCGAN:
> **Unsupervised Representation Learning with Deep Convolutional Generative Adversarial Networks** — Radford, Metz, Chintala, 2015
> [arXiv:1511.06434](https://arxiv.org/abs/1511.06434)

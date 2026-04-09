# Fashion-MNIST Transformer — Vision Transformer (ViT) Classification

Attention-based image classification on Fashion-MNIST without convolutions. Split images into patches, embed them as tokens, apply self-attention, and classify — all built from drag-and-drop nodes in the visual graph editor.

![Model Graph](images/model_graph.png)

## What This Demo Shows

- **Vision Transformer from composable nodes**: PatchEmbed + TransformerBlock + GlobalAvgPool1D — no monolithic ViT block, each component is a separate node
- **Cross-runtime parity**: train on PyTorch CUDA server, load weights in TF.js browser — same accuracy
- **Classification pipeline**: dataset generation, training with learning rate scheduling, evaluation with accuracy and macro F1

## Results

Trained on 8,000 Fashion-MNIST images (10 classes), 20 epochs, PyTorch CUDA:

| Model | Params | Test Accuracy | Macro F1 | Best Val Loss |
|-------|:------:|:-------------:|:--------:|:-------------:|
| Tiny ViT (1 block) | 45,624 | 80.70% | 0.8058 | 0.6392 |
| **Small ViT (2 blocks)** | 87,288 | **82.50%** | **0.8260** | **0.5594** |
| ViT + MLP Head (2 blocks) | 96,248 | 81.30% | 0.8141 | 0.5638 |

![Evaluation Benchmark](images/evaluation_benchmark.png)

### Comparison with Original Paper

| Aspect | Original ViT (Dosovitskiy et al.) | Our Simplified Version |
|--------|-----------------------------------|----------------------|
| **Dataset** | ImageNet-21K (14M images), fine-tuned on ImageNet-1K | Fashion-MNIST (8K train, 28x28 grayscale) |
| **Architecture** | ViT-Base: 12 layers, 12 heads, 768-dim | 1-2 layers, 4 heads, 64-dim |
| **Parameters** | 86M (ViT-Base) | 45K-96K |
| **Patch size** | 16x16 on 224x224 images (196 patches) | 7x7 on 28x28 images (16 patches) |
| **Positional encoding** | Learned 1D positional embeddings | Learned positional embeddings |
| **Classification** | [CLS] token | Global average pooling |
| **Pre-training** | Self-supervised on massive dataset | Supervised from scratch |
| **ImageNet accuracy** | 77.9% (ViT-B/16 from scratch), 84.2% (pre-trained) | N/A (Fashion-MNIST only) |

### Context: Why These Results Make Sense

- **80-82% on Fashion-MNIST is reasonable** for a small ViT trained from scratch. CNNs achieve ~93% on the same dataset, but they have strong inductive biases (translation equivariance, locality) that transformers lack.
- **ViT needs scale**: the original paper shows ViT underperforms CNNs on small datasets but excels when pre-trained on large data. Our 8K training set is tiny — transformers shine at 10K+ images.
- **64-dim embeddings are very compressed**: each 7x7=49 pixel patch is projected to a 64-dim vector. The original uses 768-dim, giving attention much more room to capture relationships.
- **The demo proves the infrastructure**: PatchEmbed, TransformerBlock, GlobalAvgPool1D, cross-runtime weight transfer, and evaluation all work correctly.

## Models

### 1. Tiny ViT (1 block)
```
ImageSource(784) → PatchEmbed(7x7, 64-dim) → TransformerBlock(4 heads, ffn=128) → GlobalAvgPool1D → Dense(10) → Output
```
Minimal vision transformer: one attention layer over 16 patch tokens.

### 2. Small ViT (2 blocks)
```
ImageSource → PatchEmbed(7x7, 64-dim) → TransformerBlock × 2 → GlobalAvgPool1D → Dense(10) → Output
```
Two stacked transformer blocks for deeper inter-patch reasoning.

### 3. ViT + MLP Head (2 blocks)
```
ImageSource → PatchEmbed(7x7, 64-dim) → TransformerBlock × 2 → GlobalAvgPool1D → Dense(128, relu) → Dropout(0.2) → Dense(10) → Output
```
Same backbone as Small ViT but with an MLP classification head instead of a single linear layer.

## How to Use

1. **Dataset** tab — generate Fashion-MNIST (default: 10K samples, stratified split)
2. **Model** tab — view graph with PatchEmbed → TransformerBlock → classifier pipeline
3. **Trainer** tab — pre-trained cards show immediate test metrics, or train from scratch via PyTorch server
4. **Evaluation** tab — benchmark all 3 models with accuracy and macro F1

## Reference

Dosovitskiy, A., Beyer, L., Kolesnikov, A., Weissenborn, D., Zhai, X., Unterthiner, T., ... & Houlsby, N. **"An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale."** *ICLR 2021.* [Paper](https://arxiv.org/abs/2010.11929)

This demo reproduces a simplified ViT (2 layers, 64-dim, 7x7 patches on 28x28 images) to validate the platform's transformer and patch embedding support. The original uses 12+ layers, 768-dim, 16x16 patches on 224x224 images with massive pre-training.

# Text Sentiment Transformer — NLP Classification

![Dataset](images/01_dataset.png)

Transformer-based text classification on synthetic sentiment data. Demonstrates the standard NLP pipeline — tokenize, embed, self-attention, pool, classify — built entirely from graph editor nodes.

## What This Demo Shows

- **NLP in the same platform**: text classification uses the same graph editor, training engine, and evaluation as image/trajectory tasks
- **Embedding + Transformer**: token sequences → learned embeddings → multi-head self-attention → classification
- **Three architectures compared**: Transformer vs LSTM vs MLP on the same text data

| Dataset | Model Graph | Trainer |
|:---:|:---:|:---:|
| ![Dataset](images/01_dataset.png) | ![Model](images/02_model.png) | ![Trainer](images/03_trainer.png) |

## Dataset

Synthetically generated sentences with ~120-word vocabulary. Each sentence is 3-8 words, labeled positive or negative based on sentiment word presence. Tokenized to fixed 12-token sequences (padded with 0).

## Models

### 1. Transformer Classifier
```
Input(12 tokens) → Embedding(120→32) → TransformerBlock(4 heads, ffn=64)
  → GlobalAvgPool1D → Dense(32,relu) → Dropout(0.2) → Output(classification)
```

### 2. LSTM Classifier
```
Input(12 tokens) → Embedding(120→16) → LSTM(32) → Dense(16,relu)
  → Output(classification)
```

### 3. MLP Baseline
```
Input(12 tokens) → Dense(64,relu) → Dense(32,relu) → Dropout(0.2)
  → Output(classification)
```

## How to Use

1. **Dataset** tab — click Generate Dataset (instant, synthetic)
2. **Playground** tab — browse sample sentences with sentiment labels
3. **Model** tab — inspect Transformer graph: Embedding → TransformerBlock → classify
4. **Trainer** tab — train all 3 models on client (TF.js)
5. **Evaluation** tab — compare accuracy/F1: Transformer vs LSTM vs MLP

## References

- Vaswani, A., et al. **"Attention Is All You Need."** *NeurIPS 2017.* [arXiv:1706.03762](https://arxiv.org/abs/1706.03762)
- Devlin, J., et al. **"BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding."** *NAACL 2019.* [arXiv:1810.04805](https://arxiv.org/abs/1810.04805)

This demo uses a simplified single-layer transformer on synthetic data to demonstrate that the platform handles NLP tasks through the same graph editor and training engine as vision tasks.

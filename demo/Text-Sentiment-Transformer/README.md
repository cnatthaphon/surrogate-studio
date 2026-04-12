# Text Sentiment Transformer — NLP Classification

Transformer-based text classification on synthetic sentiment data. Demonstrates the standard NLP pipeline: tokenize → embed → self-attention → pool → classify, all built from graph editor nodes.

## What This Demo Shows

- **NLP in the same platform**: text classification uses the same graph editor, training engine, and evaluation as image/trajectory tasks
- **Embedding + Transformer**: token sequences → learned embeddings → multi-head self-attention → classification
- **Three architectures compared**: Transformer vs LSTM vs MLP on the same text data

## Dataset

Synthetically generated sentences with ~120-word vocabulary. Each sentence is 3-8 words, labeled positive or negative based on sentiment word presence. Tokenized to fixed 12-token sequences.

## Models

### 1. Transformer Classifier
```
Input(12 tokens) → Embedding(120→32) → Reshape(12,32)
  → TransformerBlock(4 heads, ffn=64) → GlobalAvgPool1D
  → Dense(32,relu) → Dropout(0.2) → Output(classification)
```

### 2. LSTM Classifier
```
Input(12 tokens) → Embedding(120→16) → Reshape(12,16)
  → LSTM(32) → Dense(16,relu) → Output(classification)
```

### 3. MLP Baseline
```
Input(12 tokens) → Dense(64,relu) → Dense(32,relu)
  → Dropout(0.2) → Output(classification)
```

## Evaluation

| Metric | Description |
|--------|-------------|
| **Accuracy** | Classification accuracy on test set |
| **Macro F1** | Average F1 across positive/negative classes |

## How to Use

1. **Dataset** tab — click Generate Dataset (instant, synthetic)
2. **Playground** tab — browse sample sentences with sentiment labels
3. **Model** tab — inspect Transformer graph: Embedding → TransformerBlock → classify
4. **Trainer** tab — train all 3 models on client (TF.js)
5. **Evaluation** tab — compare accuracy/F1: Transformer vs LSTM vs MLP

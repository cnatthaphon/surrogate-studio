# Screenshot Capture Guide — Fashion-MNIST Transformer Demo

## 1. `images/model_graph.png` — Model Graph
- Model tab, select "2. Small ViT (2 blocks)"
- Show: ImageSource → PatchEmbed → TransformerBlock × 2 → GlobalAvgPool1D → Dense → Output
- Click a TransformerBlock to show config (numHeads: 4, ffnDim: 128)

## 2. `images/evaluation_benchmark.png` — Evaluation Results
- Generate dataset first, then run evaluation
- Show comparison table with accuracy and macro F1 for all 3 models
- Show bar chart below

## 3. `images/training_curves.png` — Training Loss Curves
- Trainer tab, select a pretrained trainer
- Show loss/val_loss curves over 20 epochs

## 4. `images/test_confusion.png` — Test Tab Confusion Matrix
- Trainer tab → Test sub-tab for a pretrained model
- Generate dataset first, then view test results
- Show confusion matrix and per-class accuracy

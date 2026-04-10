# Synthetic Detection

This demo is the first additive object-detection recipe on top of the shared Surrogate Studio contracts.

It is intentionally small:

- one object per image
- one bounding box head
- one class head
- no hardcoded detection runtime outside the existing multi-head graph/trainer flow

## What It Shows

- `taskRecipeId = detection_single_box` attached through schema metadata
- image dataset module owns data generation and preview rendering
- model graph stays generic: `ImageSource -> Conv -> Pool -> Conv -> Pool -> Dense -> {bbox,label}`
- PyTorch server can train the same graph using the shared checkpoint/runtime path

## Dataset

The dataset is synthetic 32x32 grayscale imagery with one object per sample:

- `square`
- `wide_box`
- `tall_box`

Targets:

- `bbox`: normalized `[x0, y0, x1, y1]`
- `label`: one-hot class label

## How To Use

1. Open the `Dataset` tab and click `Generate Dataset`.
2. Inspect the sample previews with orange bounding boxes.
3. Open the `Model` tab and inspect the dual-head detector graph.
4. Train in the `Trainer` tab. PyTorch server is the recommended runtime.
5. Run `BBox Quality` in `Evaluation` to measure bounding-box MAE, class accuracy, and mean IoU.

## Scope

This is not a full COCO-style detector yet.

It is the smallest honest step toward:

- detection task recipes
- local/server dataset references
- structured detection losses and evaluation

The next step after this baseline is variable-length annotations plus recipe-level collate/postprocess support.

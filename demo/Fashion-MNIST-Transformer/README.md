# Fashion-MNIST Transformer

Vision Transformer-style image classification on Fashion-MNIST, built entirely from the graph editor.

Live demo:

```text
https://cnatthaphon.github.io/surrogate-studio/demo/Fashion-MNIST-Transformer/
```

## Included Models

1. `Tiny ViT (1 block)`  
   Patch embedding -> 1 transformer block -> global average pool -> classifier
2. `Small ViT (2 blocks)`  
   Same backbone with 2 transformer blocks
3. `ViT + MLP Head (2 blocks)`  
   Two transformer blocks plus an extra dense classification head

## Graph Nodes Used

- `ImageSource`
- `PatchEmbed`
- `TransformerBlock`
- `GlobalAvgPool1D`
- `Dense`
- `Output`

## How To Use

1. Open the demo and go to `Dataset`.
2. Generate the Fashion-MNIST dataset.
3. Go to `Trainer`.
4. Pick one of the three transformer trainers.
5. Train on client or server.
6. Go to `Evaluation` to compare `accuracy` and `macro_f1`.

This demo is classification-only. It does not use the `Generation` tab.

## Notes

- `PatchEmbed` expects a square flattened image input.
- `TransformerBlock` in this demo uses the platform's graph-driven dense-attention approximation, so client and server now follow the same contract.
- Use `Evaluation` instead of `Generation` to compare these models.

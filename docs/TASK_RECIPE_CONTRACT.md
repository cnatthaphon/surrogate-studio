# Task Recipe Contract

`taskRecipe` is the additive contract layer between:

- schema semantics
- dataset module behavior
- trainer/runtime execution
- evaluation defaults

It exists so new task families can extend the platform without hardcoding special cases into the main trainer loop.

## Direction

The dependency chain is:

`schema -> taskRecipe -> dataset module hooks + graph/model contract + evaluation contract`

That means:

- schema declares the task family through `taskRecipeId`
- dataset modules stay responsible for loading, parsing, preview, and task-specific helper logic
- graph editor still defines the network
- client, server, and notebook runtimes execute against the same recipe metadata

## Built-in Recipes

Current built-in recipe ids:

- `supervised_standard`
- `sequence_forecast`
- `gan_phased`
- `diffusion_denoise`
- `detection_single_box`

Today these are mostly metadata and routing contracts. They are the foundation for stronger per-task train/test/eval hooks.

## Current Contract Surface

Schema:

- `taskRecipeId`

Dataset payload:

- standard embedded arrays for browser-first workflows
- optional `sourceDescriptor` for server-side loading of large local datasets

Server training payload:

- `taskRecipeId`
- `dataset.sourceDescriptor`

Server dataset source descriptors currently support:

- `local_csv_manifest`
- `local_json_dataset`

## Design Rules

- Do not let dataset modules arbitrarily override the trainer.
- Do not hardcode task-specific logic in `main` flows when it belongs to a recipe.
- Keep the graph as the source of truth for model structure.
- Keep checkpoints canonical across runtimes.
- Let dataset modules provide helpers that recipes consume:
  - parsing
  - collate helpers
  - visualization
  - task-specific evaluators

## Why This Exists

This contract is the path toward tasks that need more than plain fixed-shape regression/classification, including:

- object detection
- segmentation
- structured sequence prediction
- large local datasets loaded directly by the PyTorch server or notebook runtime

The first additive recipe using this path is `detection_single_box`, demonstrated by the `Synthetic-Detection` demo.

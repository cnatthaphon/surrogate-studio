# Architecture Notes (Apr 2026)

## Goal

Keep Surrogate Studio schema-driven and browser-first while allowing the same model/trainer/checkpoint contracts to work across:

- TF.js in the browser
- optional PyTorch server runtime
- exported notebook flow

## Current Shape

1. Product surface
- single-page app with Playground, Dataset, Model, Trainer, Generation, and Evaluation tabs
- demo folders are self-contained plugin-style presets

2. Core contracts
- schemas define allowed features, outputs, presets, and palette metadata
- model graphs are stored as declarative Drawflow payloads
- trainer records bind dataset + model + runtime config + history
- checkpoints are moving toward one canonical runtime-neutral format

3. Runtime model
- browser path is primary
- PyTorch server is optional and uses the same graph/checkpoint contract
- notebook export should preserve the same identifiers and model/trainer assumptions

## Stable Rules

1. No model-family hardcode in the core path
- behavior should come from schema, graph, trainer config, and checkpoint metadata

2. One checkpoint source of truth
- browser and server may adapt the checkpoint differently
- exported trainer/checkpoint format should stay runtime-neutral

3. Shared contracts before shared UI shortcuts
- if two runtimes disagree, fix the contract/adapter first
- do not patch behavior with model-specific branches

4. Browser-first product behavior
- client path should remain the default UX
- server features should improve speed, parity checking, or heavy workloads, not redefine the core product

## Current Gaps

1. Server runtime is still per-run
- each training run starts a fresh subprocess
- checkpoints persist; live optimizer/runtime state does not

2. Cross-runtime parity is improved but not perfect
- TF.js and PyTorch can share checkpoints and generate from them
- numeric traces and image samples still will not be bit-identical

3. Diffusion coverage still needs more end-to-end validation
- graph/runtime support exists
- research-faithful training semantics still need more verification

## Working Priorities

1. Keep contracts explicit and versioned
2. Reduce stale docs when runtime behavior changes
3. Add targeted regression tests when a cross-runtime bug is fixed
4. Keep `main` clean and branch work short-lived

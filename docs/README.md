# Developer Documentation

Internal design contracts and architecture references for Surrogate Studio.

For platform overview, see the [main README](../README.md).

## Contracts

| Document | Description |
|----------|-------------|
| [Architecture Plan](ARCHITECTURE_PLAN.md) | High-level goals and strategy (schema-first, multi-runtime) |
| [Dataset/Model/Trainer Contract](DATASET_MODEL_TRAINER_CONTRACT.md) | Module contracts for dataset, model, and trainer |
| [Store Contract](STORE_CONTRACT.md) | Storage adapter interface (save, load, list, query) |
| [Tab Render Contract](TAB_RENDER_CONTRACT.md) | Shared 3-panel render contract for all tabs |
| [Worker Runtime Contract](WORKER_RUNTIME_CONTRACT.md) | Contract between main thread, Worker, and server runtimes |

## Adding a New Demo

See the [main README's "Adding a New Demo" section](../README.md#adding-a-new-demo) and the [LSTM-VAE demo](../demo/LSTM-VAE-for-dominant-motion-extraction/) as a reference implementation.

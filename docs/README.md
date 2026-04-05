# Developer Docs

Use this folder for technical contracts and runtime notes. Keep workflow/process rules in [CONTRIBUTING.md](../CONTRIBUTING.md), not scattered across tool-specific files.

Primary entry points:

| Document | Purpose |
|----------|---------|
| [README.md](../README.md) | Public product overview and demo entrypoint |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Branch workflow, merge policy, validation expectations |
| [server/README.md](../server/README.md) | Optional PyTorch server runtime and API notes |
| [schemas/README.md](../schemas/README.md) | Schema and IR contract overview |

Technical references:

| Document | Description |
|----------|-------------|
| [ARCHITECTURE_PLAN.md](ARCHITECTURE_PLAN.md) | Current architecture notes and engineering rules |
| [DATASET_MODEL_TRAINER_CONTRACT.md](DATASET_MODEL_TRAINER_CONTRACT.md) | Dataset/model/trainer module contracts |
| [STORE_CONTRACT.md](STORE_CONTRACT.md) | Workspace store contract |
| [TAB_RENDER_CONTRACT.md](TAB_RENDER_CONTRACT.md) | Shared 3-panel tab render contract |
| [WORKER_RUNTIME_CONTRACT.md](WORKER_RUNTIME_CONTRACT.md) | Main thread / worker / server runtime contract |

## Demo Authoring

See [README.md#adding-a-new-demo](../README.md#adding-a-new-demo). The [LSTM-VAE demo](../demo/LSTM-VAE-for-dominant-motion-extraction/) is still a good reference for a self-contained demo folder.

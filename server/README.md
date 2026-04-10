# PyTorch Server

This folder is the optional PyTorch runtime used by the browser app for faster training, prediction, testing, and generation.

The normal public workflow is still browser-first. The server exists to:

- train with PyTorch/CUDA when available
- run cross-runtime checks against TF.js
- generate or evaluate from the same saved trainer checkpoint

## Current Entry Point

Start the server with:

```bash
npm install
npm run server:install:py
npm run server:start
```

If you need a CUDA-specific PyTorch wheel, install that first and then re-run:

```bash
python3 -m pip install -r server/requirements.txt
```

Default URL:

```text
http://localhost:3777
```

## Main API

`training_server.js` is the active browser-facing server.

Endpoints:

- `GET /api/health`
- `POST /api/train`
- `GET /api/train/:id`
  SSE stream for status + epoch events
- `POST /api/train/:id/stop`
  graceful stop request
- `GET /api/train/:id/result`
  full result including saved artifacts
- `POST /api/test`
- `POST /api/predict`
- `POST /api/generate`

## Runtime Files

- `training_server.js`
  Node HTTP server and SSE orchestration
- `train_subprocess.py`
  PyTorch training path
- `predict_subprocess.py`
  PyTorch batch prediction path
- `test_subprocess.py`
  PyTorch evaluation path
- `generate_subprocess.py`
  PyTorch generation path
- `runtime_weight_loader.py`
  canonical checkpoint -> PyTorch loader
- `checkpoint_format.py`
  canonical checkpoint helpers

## Checkpoint Behavior

The current direction is one canonical checkpoint format shared across runtimes:

- browser TF.js can load it directly
- server PyTorch can reverse-load it
- generation and resume paths use the same saved trainer artifact

Server runtime is still ephemeral per run:

- each train request starts a fresh subprocess
- model/dataset/config are sent for that run
- live PyTorch state is destroyed after completion or stop
- the saved checkpoint is the durable source of truth

## Large Local Datasets

The server now supports dataset source descriptors for server-side loading.

That means a dataset card can carry either:

- embedded arrays for browser-first workflows
- a `sourceDescriptor` pointing at a local CSV manifest or JSON dataset on disk

Current supported descriptor kinds:

- `local_csv_manifest`
- `local_json_dataset`

This is the foundation for larger local datasets that should stay on disk for the PyTorch server and notebook runtimes instead of being copied into the browser payload.

## Legacy Scripts

These files still exist, but they are not the main browser runtime path:

- `node_python_orchestrator.mjs`
- `python_train_worker.py`
- `export_notebook_bundle.py`

Treat them as legacy or experimental utilities unless you are working on that specific flow.

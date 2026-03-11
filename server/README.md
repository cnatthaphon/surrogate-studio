# Server Orchestration (Optional Path)

No-server (client-only) is the primary flow.
This folder is the optional server path when users want remote/background training jobs.

## What it does
- `node_python_orchestrator.mjs` launches a Python worker as subprocess.
- `python_train_worker.py` trains selected model family from `.model.json` files.
- Progress is emitted as:
  - `progress.jsonl` (append-only event log)
  - `latest.json` (current status snapshot)
- Final metrics are written to:
  - `metrics.json`
  - `metrics.csv`

This is compatible with:
- Node server polling progress files
- Web client polling `latest.json` / reading `metrics.json`

## Requirements
- Python environment with notebook dependencies installed.
- `OSC_SURROGATE_NOTEBOOKS_DIR` set to a compatible notebook-runtime directory that contains
  `oscillator_surrogate_pipeline.py` and the expected `helpers/` package.
- This staging repo does not ship the old `notebooks/` runtime tree from the legacy workspace.
- CUDA available if `--require-gpu true`.
- Use the same interpreter as notebook env:
  - CLI: `--python /home/cue/venv/main/bin/python`
  - or env: `export OSC_PYTHON=/home/cue/venv/main/bin/python`

## Runtime note
- Supported here today: `runtime=python_server`
- Planned from Training tab selector: `js_client`, `node_server`, `python_server`, `notebook_local`

## Example 1: Run direct family (python_server)
```bash
export OSC_SURROGATE_NOTEBOOKS_DIR=/path/to/notebook_runtime
node server/node_python_orchestrator.mjs \
  --project-dir /path/to/surrogate-studio \
  --runtime python_server \
  --family direct \
  --run-id direct_run_01 \
  --epochs 40 \
  --batch-size 256 \
  --lr 1e-3 \
  --split-mode from_csv \
  --require-gpu true
```

## Example 2: Run score-based diffusion
```bash
export OSC_SURROGATE_NOTEBOOKS_DIR=/path/to/notebook_runtime
node server/node_python_orchestrator.mjs \
  --project-dir /path/to/surrogate-studio \
  --runtime python_server \
  --family score \
  --run-id score_run_01 \
  --epochs 40 \
  --split-mode from_csv \
  --require-gpu true
```

## Optional config file
You can pass `--config path/to/config.json`:
```json
{
  "notebooks_dir": "/path/to/notebook_runtime",
  "dataset_csv": "/path/to/exported_dataset.csv",
  "family": "ar",
  "split_mode": "from_csv",
  "epochs": 40,
  "batch_size": 256,
  "lr": 0.001,
  "seed": 42,
  "require_gpu": true
}
```

## Event format (`progress.jsonl`)
Each line is JSON:
```json
{"ts": 1730000000.0, "event": "model_start", "index": 1, "total": 3, "graph_file": "direct_mlp_strong.model.json"}
```

Typical events:
- `worker_start`
- `model_start`
- `model_done`
- `worker_done`
- `error`

## Export runnable notebook bundle (reference implementation)
Create a self-contained notebook folder/zip from shared artifacts.
This mirrors the client-side export contract (`schemas/notebook.bundle.spec.schema.json`).

Note:
- this server-side exporter is still an optional scaffold and still assumes a legacy
  notebook-runtime directory layout.
- the current baseline notebook path is the client-side export flow from `Training Lab`.

```bash
python server/export_notebook_bundle.py \
  --project-dir /path/to/surrogate-studio \
  --dataset-csv /path/to/exported_dataset.csv \
  --trainers js_client,python_server \
  --layout single \
  --out-dir /tmp/osc_bundle \
  --zip-output /tmp/osc_bundle/notebook_bundle.zip \
  --require-gpu
```

Output:
- `/tmp/osc_bundle/notebooks/` with:
  - notebooks + helpers + pipeline
  - `dataset/*.csv` + `*.split_manifest.json`
  - selected model files
  - `notebook.config.json`
  - `bundle_manifest.json`

Optional multi-session input:
- `--sessions-json path/to/sessions.json`
- `--layout per_session` to create `sessions/<session_id>/notebooks/*`

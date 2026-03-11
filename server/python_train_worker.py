#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List

import pandas as pd


def _now() -> float:
    return float(time.time())


class ProgressWriter:
    def __init__(self, jsonl_path: Path | None, latest_path: Path | None):
        self.jsonl_path = jsonl_path
        self.latest_path = latest_path
        if self.jsonl_path is not None:
            self.jsonl_path.parent.mkdir(parents=True, exist_ok=True)
        if self.latest_path is not None:
            self.latest_path.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, event: str, payload: Dict[str, Any] | None = None) -> None:
        msg = {"ts": _now(), "event": str(event)}
        if payload:
            msg.update(payload)
        line = json.dumps(msg, ensure_ascii=False)
        print(line, flush=True)
        if self.jsonl_path is not None:
            with self.jsonl_path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
        if self.latest_path is not None:
            self.latest_path.write_text(json.dumps(msg, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_config(path: Path | None) -> Dict[str, Any]:
    if path is None:
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _split_csv(v: str | None) -> List[str]:
    if not v:
        return []
    return [x.strip() for x in str(v).split(",") if x.strip()]


def _select_models(
    *,
    models_dir: Path,
    family: str,
    include: List[str],
    exclude: List[str],
):
    from helpers import select_models

    fam = str(family).strip().lower()
    if fam == "score":
        base = select_models(models_dir, family="diffusion")
        out = [p for p in base if "score" in p.name.lower()]
    else:
        out = select_models(models_dir, family=fam)

    if include:
        out = [p for p in out if any(k in p.name.lower() for k in include)]
    if exclude:
        out = [p for p in out if not any(k in p.name.lower() for k in exclude)]
    return sorted(out)


def main() -> int:
    ap = argparse.ArgumentParser(description="Train graph family via python worker (for node subprocess orchestration).")
    ap.add_argument("--runtime", type=str, default="python_server", help="Runtime label for reporting.")
    ap.add_argument("--session-id", type=str, default="", help="Optional training session id.")
    ap.add_argument("--config", type=str, default="", help="Optional JSON config path (values are defaults).")
    ap.add_argument("--train-spec", type=str, default="", help="Optional train spec JSON path.")
    ap.add_argument("--eval-spec", type=str, default="", help="Optional eval spec JSON path.")
    ap.add_argument("--notebooks-dir", type=str, default="", help="Absolute notebooks dir. If empty, use OSC_SURROGATE_NOTEBOOKS_DIR.")
    ap.add_argument("--dataset-csv", type=str, default="dataset/oscillator_dataset_autoregressive_seed42.csv")
    ap.add_argument("--models-dir", type=str, default="", help="Optional models dir. Defaults to PROJECT/models.")
    ap.add_argument("--family", type=str, required=True, help="direct|ar|ae|vae|diffusion|score")
    ap.add_argument("--include", type=str, default="", help="Comma-separated substrings to include.")
    ap.add_argument("--exclude", type=str, default="", help="Comma-separated substrings to exclude.")
    ap.add_argument("--split-mode", type=str, default="from_csv")
    ap.add_argument("--train-frac", type=float, default=0.70)
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--test-frac", type=float, default=0.15)
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch-size", type=int, default=256)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--require-gpu", action="store_true", default=False)
    ap.add_argument("--use-lr-scheduler", action="store_true", default=True)
    ap.add_argument("--out-json", type=str, default="", help="Output metrics JSON path.")
    ap.add_argument("--out-csv", type=str, default="", help="Output metrics CSV path.")
    ap.add_argument("--progress-jsonl", type=str, default="", help="Optional progress jsonl path.")
    ap.add_argument("--latest-json", type=str, default="", help="Optional latest-status json path.")
    args = ap.parse_args()

    cfg = _load_config(Path(args.config).resolve()) if args.config else {}

    def pick(name: str, cli_val):
        if cli_val not in ("", None):
            return cli_val
        return cfg.get(name)

    notebooks_dir = pick("notebooks_dir", args.notebooks_dir) or os.environ.get("OSC_SURROGATE_NOTEBOOKS_DIR", "")
    if not notebooks_dir:
        raise RuntimeError("notebooks_dir is required (arg or OSC_SURROGATE_NOTEBOOKS_DIR).")
    notebooks_dir = Path(str(notebooks_dir)).expanduser().resolve()
    if str(notebooks_dir) not in sys.path:
        sys.path.insert(0, str(notebooks_dir))

    from helpers import setup_context, SplitConfig, TrainConfig
    from helpers.train import train_one_graph
    from helpers.eval import result_to_row

    progress = ProgressWriter(
        Path(args.progress_jsonl).expanduser().resolve() if args.progress_jsonl else None,
        Path(args.latest_json).expanduser().resolve() if args.latest_json else None,
    )

    runtime = str(args.runtime or "python_server").strip().lower()
    session_id = str(args.session_id or "").strip()
    progress.emit("worker_start", {"family": args.family, "runtime": runtime, "session_id": session_id})

    ctx = setup_context(
        notebooks_dir=notebooks_dir,
        dataset_csv=str(pick("dataset_csv", args.dataset_csv) or args.dataset_csv),
        require_gpu_only=bool(cfg.get("require_gpu", args.require_gpu)),
        seed=int(pick("seed", args.seed) or args.seed),
    )
    models_dir = Path(str(pick("models_dir", args.models_dir) or (ctx["PROJECT_DIR"] / "models"))).expanduser().resolve()
    dataset_path = Path(str(ctx["DATASET"])).resolve()

    include = [x.lower() for x in _split_csv(str(pick("include", args.include) or args.include))]
    exclude = [x.lower() for x in _split_csv(str(pick("exclude", args.exclude) or args.exclude))]
    family = str(pick("family", args.family) or args.family).strip().lower()

    model_paths = _select_models(models_dir=models_dir, family=family, include=include, exclude=exclude)
    if not model_paths:
        progress.emit("error", {"reason": "no_models", "family": family, "models_dir": str(models_dir)})
        return 2

    train_spec = _load_config(Path(args.train_spec).expanduser().resolve()) if args.train_spec else {}
    eval_spec = _load_config(Path(args.eval_spec).expanduser().resolve()) if args.eval_spec else {}

    split_cfg = SplitConfig(
        mode=str(pick("split_mode", args.split_mode) or args.split_mode),
        train_frac=float(pick("train_frac", args.train_frac) or args.train_frac),
        val_frac=float(pick("val_frac", args.val_frac) or args.val_frac),
        test_frac=float(pick("test_frac", args.test_frac) or args.test_frac),
    )
    train_cfg = TrainConfig(
        epochs=int(train_spec.get("training", {}).get("epochs", pick("epochs", args.epochs) or args.epochs)),
        batch_size=int(train_spec.get("training", {}).get("batchSize", pick("batch_size", args.batch_size) or args.batch_size)),
        lr=float(train_spec.get("optimizer", {}).get("lr", pick("lr", args.lr) or args.lr)),
        seed=int(train_spec.get("seed", pick("seed", args.seed) or args.seed)),
        device=str(ctx["DEVICE"]),
        use_lr_scheduler=bool(
            cfg.get(
                "use_lr_scheduler",
                (
                    train_spec.get("scheduler", {}).get("name", "none") != "none"
                    if train_spec else args.use_lr_scheduler
                ),
            )
        ),
    )

    rows: List[Dict[str, Any]] = []
    runs = {}

    for i, mp in enumerate(model_paths, start=1):
        progress.emit("model_start", {"index": i, "total": len(model_paths), "graph_file": mp.name})
        run = train_one_graph(
            osp=ctx["osp"],
            model_path=mp,
            dataset_path=dataset_path,
            split=split_cfg,
            train=train_cfg,
        )
        runs[mp.name] = run
        rows.append(result_to_row(mp, run["bundle"], run["result"], train_cfg.epochs, train_cfg.batch_size, train_cfg.lr))
        progress.emit(
            "model_done",
            {
                "index": i,
                "total": len(model_paths),
                "graph_file": mp.name,
                "test_mae": rows[-1].get("test_mae"),
                "test_rmse": rows[-1].get("test_rmse"),
            },
        )

    df = pd.DataFrame(rows).sort_values(["test_mae", "test_rmse"]).reset_index(drop=True) if rows else pd.DataFrame()
    payload = {
        "runtime": runtime,
        "session_id": session_id,
        "family": family,
        "models_dir": str(models_dir),
        "dataset": str(dataset_path),
        "split": asdict(split_cfg),
        "train": asdict(train_cfg),
        "train_spec": train_spec,
        "eval_spec": eval_spec,
        "rows": df.to_dict(orient="records"),
    }

    out_json = Path(args.out_json).expanduser().resolve() if args.out_json else None
    out_csv = Path(args.out_csv).expanduser().resolve() if args.out_csv else None
    if out_json is not None:
        out_json.parent.mkdir(parents=True, exist_ok=True)
        out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    if out_csv is not None:
        out_csv.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(out_csv, index=False)

    best = payload["rows"][0] if payload["rows"] else {}
    progress.emit(
        "worker_done",
        {
            "family": family,
            "runtime": runtime,
            "session_id": session_id,
            "n_models": int(len(payload["rows"])),
            "best_graph_file": best.get("graph_file"),
            "best_test_mae": best.get("test_mae"),
            "best_test_rmse": best.get("test_rmse"),
            "out_json": str(out_json) if out_json else "",
            "out_csv": str(out_csv) if out_csv else "",
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

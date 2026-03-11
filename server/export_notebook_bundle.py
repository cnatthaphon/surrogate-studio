#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import zipfile
from pathlib import Path
from typing import Dict, List, Tuple


NOTEBOOK_FILES = [
    "00_setup_data.ipynb",
    "10_direct_ar_baselines.ipynb",
    "20_ae_study.ipynb",
    "30_vae_study.ipynb",
    "40_diffusion_ddpm.ipynb",
    "50_diffusion_score_based.ipynb",
    "90_final_comparison.ipynb",
    "oscillator_surrogate_pipeline.py",
    "requirements.txt",
    "README.md",
]

DEFAULT_MODEL_PATTERNS = [
    "direct_mlp_*.model.json",
    "ar_*_strong.model.json",
    "exp_ar_cnn_strong.model.json",
    "exp_ae_traj_*_zmatch.model.json",
    "exp_vae_traj_*_zmatch.model.json",
    "exp_diffusion_denoise_1d.model.json",
    "exp_score_denoise_1d.model.json",
]


def _copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
    else:
        shutil.copy2(src, dst)


def _normalize_trainers(raw: str | List[str] | None) -> List[str]:
    if raw is None:
        return ["js_client"]
    if isinstance(raw, list):
        vals = [str(x).strip() for x in raw if str(x).strip()]
    else:
        vals = [x.strip() for x in str(raw).split(",") if x.strip()]
    out = []
    for v in vals:
        key = v.lower()
        if key in ("js", "client", "client_js", "js_client"):
            out.append("js_client")
        elif key in ("python", "python_server", "py_server"):
            out.append("python_server")
        elif key in ("node", "node_server", "tfjs_node"):
            out.append("node_server")
        elif key in ("notebook", "notebook_local"):
            out.append("notebook_local")
    return sorted(set(out)) or ["js_client"]


def _resolve_model_paths(models_dir: Path, model_files: List[str]) -> List[Path]:
    out: List[Path] = []
    for name in model_files:
        p = (models_dir / name).resolve()
        if not p.exists():
            raise FileNotFoundError(f"Model file not found: {p}")
        out.append(p)
    return out


def _pick_default_models(models_dir: Path) -> List[Path]:
    picked: List[Path] = []
    for pat in DEFAULT_MODEL_PATTERNS:
        picked.extend(sorted(models_dir.glob(pat)))
    dedup = {p.name: p for p in picked}
    return [dedup[k] for k in sorted(dedup.keys())]


def _dataset_and_manifest(project_dir: Path, dataset_csv: str) -> Tuple[Path, Path]:
    src = Path(dataset_csv)
    if not src.is_absolute():
        src = (project_dir / src).resolve()
    if not src.exists():
        raise FileNotFoundError(f"Dataset CSV not found: {src}")
    mani = src.with_suffix(".split_manifest.json")
    if not mani.exists():
        raise FileNotFoundError(
            f"Split manifest not found: {mani} "
            "(export dataset CSV + split manifest from web first)"
        )
    return src, mani


def _load_sessions(args, project_dir: Path, models_dir: Path) -> List[Dict]:
    if args.sessions_json:
        p = Path(args.sessions_json).expanduser().resolve()
        payload = json.loads(p.read_text(encoding="utf-8"))
        sessions = payload.get("sessions", payload) if isinstance(payload, dict) else payload
        if not isinstance(sessions, list) or not sessions:
            raise ValueError("sessions_json must contain non-empty list or {sessions:[...]}.")
        out = []
        for i, s in enumerate(sessions, start=1):
            sid = str(s.get("session_id") or f"session_{i:03d}")
            ds_csv = str(s.get("dataset_csv") or args.dataset_csv)
            ds_path, ds_manifest = _dataset_and_manifest(project_dir, ds_csv)
            mfiles = [str(x).strip() for x in s.get("model_files", []) if str(x).strip()]
            models = _resolve_model_paths(models_dir, mfiles) if mfiles else _pick_default_models(models_dir)
            out.append(
                {
                    "session_id": sid,
                    "dataset_csv_path": ds_path,
                    "split_manifest_path": ds_manifest,
                    "model_paths": models,
                    "trainers": _normalize_trainers(s.get("trainers", args.trainers)),
                    "train_spec": s.get("train_spec", {}),
                    "eval_spec": s.get("eval_spec", {}),
                    "notes": str(s.get("notes", "")),
                }
            )
        return out

    # Single-session fallback from CLI options.
    ds_path, ds_manifest = _dataset_and_manifest(project_dir, args.dataset_csv)
    model_files = [x.strip() for x in str(args.model_files).split(",") if x.strip()]
    models = _resolve_model_paths(models_dir, model_files) if model_files else _pick_default_models(models_dir)
    return [
        {
            "session_id": "session_001",
            "dataset_csv_path": ds_path,
            "split_manifest_path": ds_manifest,
            "model_paths": models,
            "trainers": _normalize_trainers(args.trainers),
            "train_spec": {},
            "eval_spec": {},
            "notes": "single-session export",
        }
    ]


def _copy_notebook_runtime(notebooks_dir: Path, out_root: Path) -> None:
    out_root.mkdir(parents=True, exist_ok=True)
    for name in NOTEBOOK_FILES:
        src = notebooks_dir / name
        if src.exists():
            _copy(src, out_root / name)
    helpers_src = notebooks_dir / "helpers"
    if helpers_src.exists():
        _copy(helpers_src, out_root / "helpers")


def _write_json(path: Path, payload: Dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _export_single_layout(
    *,
    project_dir: Path,
    notebooks_dir: Path,
    out_nb: Path,
    sessions: List[Dict],
    seed: int,
    require_gpu: bool,
) -> Dict:
    _copy_notebook_runtime(notebooks_dir, out_nb)
    (out_nb / "dataset").mkdir(parents=True, exist_ok=True)
    (out_nb / "models").mkdir(parents=True, exist_ok=True)
    (out_nb / "sessions").mkdir(parents=True, exist_ok=True)

    # Copy unique datasets and models once.
    ds_seen = {}
    md_seen = {}
    for s in sessions:
        ds = s["dataset_csv_path"]
        sm = s["split_manifest_path"]
        if ds.name not in ds_seen:
            _copy(ds, out_nb / "dataset" / ds.name)
            ds_seen[ds.name] = True
        if sm.name not in ds_seen:
            _copy(sm, out_nb / "dataset" / sm.name)
            ds_seen[sm.name] = True
        for mp in s["model_paths"]:
            if mp.name not in md_seen:
                _copy(mp, out_nb / "models" / mp.name)
                md_seen[mp.name] = True

    session_refs = []
    for s in sessions:
        payload = {
            "irVersion": "1.0",
            "session_id": s["session_id"],
            "dataset_csv": f"dataset/{s['dataset_csv_path'].name}",
            "split_manifest": f"dataset/{s['split_manifest_path'].name}",
            "model_files": [f"models/{p.name}" for p in s["model_paths"]],
            "trainers": s["trainers"],
            "train_spec": s.get("train_spec", {}),
            "eval_spec": s.get("eval_spec", {}),
            "notes": s.get("notes", ""),
        }
        rel = f"sessions/{s['session_id']}.session.json"
        _write_json(out_nb / rel, payload)
        session_refs.append(rel)

    default_dataset = sessions[0]["dataset_csv_path"].name if sessions else ""
    _write_json(
        out_nb / "notebook.config.json",
        {
            "dataset_csv": f"dataset/{default_dataset}",
            "require_gpu_only": bool(require_gpu),
            "seed": int(seed),
            "session_files": session_refs,
        },
    )
    summary = {
        "irVersion": "1.0",
        "project_dir": str(project_dir),
        "bundle_dir": str(out_nb),
        "layout": "single",
        "n_sessions": len(sessions),
        "session_files": session_refs,
        "n_models_unique": len(md_seen),
        "models_unique": sorted(md_seen.keys()),
    }
    _write_json(out_nb / "bundle_manifest.json", summary)
    return summary


def _export_per_session_layout(
    *,
    project_dir: Path,
    notebooks_dir: Path,
    out_nb: Path,
    sessions: List[Dict],
    seed: int,
    require_gpu: bool,
) -> Dict:
    (out_nb / "sessions").mkdir(parents=True, exist_ok=True)
    session_dirs = []
    for s in sessions:
        sd = out_nb / "sessions" / s["session_id"] / "notebooks"
        _copy_notebook_runtime(notebooks_dir, sd)
        (sd / "dataset").mkdir(parents=True, exist_ok=True)
        (sd / "models").mkdir(parents=True, exist_ok=True)
        _copy(s["dataset_csv_path"], sd / "dataset" / s["dataset_csv_path"].name)
        _copy(s["split_manifest_path"], sd / "dataset" / s["split_manifest_path"].name)
        for mp in s["model_paths"]:
            _copy(mp, sd / "models" / mp.name)
        _write_json(
            sd / "notebook.config.json",
            {
                "dataset_csv": f"dataset/{s['dataset_csv_path'].name}",
                "require_gpu_only": bool(require_gpu),
                "seed": int(seed),
                "session_id": s["session_id"],
                "trainers": s["trainers"],
                "train_spec": s.get("train_spec", {}),
                "eval_spec": s.get("eval_spec", {}),
            },
        )
        _write_json(
            sd / "session_manifest.json",
            {
                "irVersion": "1.0",
                "session_id": s["session_id"],
                "dataset_csv": f"dataset/{s['dataset_csv_path'].name}",
                "split_manifest": f"dataset/{s['split_manifest_path'].name}",
                "model_files": [f"models/{p.name}" for p in s["model_paths"]],
                "trainers": s["trainers"],
                "train_spec": s.get("train_spec", {}),
                "eval_spec": s.get("eval_spec", {}),
                "notes": s.get("notes", ""),
            },
        )
        session_dirs.append(str(sd.relative_to(out_nb)))

    summary = {
        "irVersion": "1.0",
        "project_dir": str(project_dir),
        "bundle_dir": str(out_nb),
        "layout": "per_session",
        "n_sessions": len(sessions),
        "session_dirs": session_dirs,
    }
    _write_json(out_nb / "bundle_manifest.json", summary)
    return summary


def _zip_dir(src_dir: Path, out_zip: Path) -> Path:
    out_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(src_dir.rglob("*")):
            if p.is_file():
                zf.write(p, p.relative_to(src_dir))
    return out_zip


def main() -> int:
    ap = argparse.ArgumentParser(description="Export runnable notebook bundle from shared artifacts.")
    ap.add_argument("--project-dir", type=str, required=True)
    ap.add_argument("--dataset-csv", type=str, required=True, help="Absolute or project-relative dataset CSV path.")
    ap.add_argument("--model-files", type=str, default="", help="Comma-separated model filenames from models dir.")
    ap.add_argument("--sessions-json", type=str, default="", help="Optional sessions definition JSON.")
    ap.add_argument("--trainers", type=str, default="js_client", help="Comma list: js_client,python_server,node_server,notebook_local")
    ap.add_argument("--layout", type=str, default="single", choices=["single", "per_session"])
    ap.add_argument("--out-dir", type=str, required=True, help="Bundle output directory.")
    ap.add_argument("--zip-output", type=str, default="", help="Optional output zip path.")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--require-gpu", action="store_true", default=False)
    args = ap.parse_args()

    project_dir = Path(args.project_dir).expanduser().resolve()
    notebooks_dir = (project_dir / "notebooks").resolve()
    models_dir = (project_dir / "models").resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_nb = out_dir / "notebooks"

    if not notebooks_dir.exists():
        raise FileNotFoundError(f"Notebooks dir not found: {notebooks_dir}")
    if not models_dir.exists():
        raise FileNotFoundError(f"Models dir not found: {models_dir}")

    sessions = _load_sessions(args, project_dir, models_dir)
    out_nb.mkdir(parents=True, exist_ok=True)

    if args.layout == "single":
        summary = _export_single_layout(
            project_dir=project_dir,
            notebooks_dir=notebooks_dir,
            out_nb=out_nb,
            sessions=sessions,
            seed=args.seed,
            require_gpu=args.require_gpu,
        )
    else:
        summary = _export_per_session_layout(
            project_dir=project_dir,
            notebooks_dir=notebooks_dir,
            out_nb=out_nb,
            sessions=sessions,
            seed=args.seed,
            require_gpu=args.require_gpu,
        )

    if args.zip_output:
        out_zip = Path(args.zip_output).expanduser().resolve()
        _zip_dir(out_nb, out_zip)
        summary["zip_output"] = str(out_zip)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

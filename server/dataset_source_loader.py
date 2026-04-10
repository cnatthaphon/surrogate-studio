from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any, Dict, List

import numpy as np


def _read_json(path: Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _split_key(name: str) -> str:
    v = str(name or "").strip().lower()
    return v if v in ("train", "val", "test") else "train"


def _ensure_split(out: Dict[str, List[Any]], key: str) -> None:
    if key not in out:
        out[key] = []


def _load_csv_manifest(dataset_path: Path, manifest: Dict[str, Any]) -> Dict[str, Any]:
    x = {"train": [], "val": [], "test": []}
    y = {"train": [], "val": [], "test": []}
    labels = {"train": [], "val": [], "test": []}

    feature_cols = None
    target_cols = None
    with dataset_path.open("r", encoding="utf-8", newline="") as fh:
      reader = csv.DictReader(fh)
      header = reader.fieldnames or []
      feature_cols = [h for h in header if str(h).startswith("f")]
      target_cols = [h for h in header if str(h).startswith("t")]
      for row in reader:
        split = _split_key(row.get("split", "train"))
        fvals = [float(row.get(col, 0) or 0) for col in feature_cols]
        tvals = [float(row.get(col, 0) or 0) for col in target_cols]
        x[split].append(fvals)
        y[split].append(tvals)
        labels[split].append(tvals)

    class_count = int(manifest.get("classCount", 0) or 0)
    mode = str(manifest.get("mode", "regression") or "regression").strip().lower()
    dataset = {
      "schemaId": str(manifest.get("schemaId", "")).strip().lower(),
      "mode": mode,
      "featureSize": len(feature_cols or []),
      "targetSize": len(target_cols or []),
      "xTrain": x["train"],
      "yTrain": y["train"],
      "xVal": x["val"],
      "yVal": y["val"],
      "xTest": x["test"],
      "yTest": y["test"],
    }
    if class_count > 0 or mode == "classification":
      dataset["numClasses"] = max(class_count, len(target_cols or []))
      dataset["labelsTrain"] = labels["train"]
      dataset["labelsVal"] = labels["val"]
      dataset["labelsTest"] = labels["test"]
    return dataset


def _load_json_dataset(dataset_path: Path) -> Dict[str, Any]:
    payload = _read_json(dataset_path)
    if isinstance(payload, dict) and isinstance(payload.get("dataset"), dict):
      return payload["dataset"]
    return payload


def load_dataset_from_source_descriptor(source_descriptor: Dict[str, Any]) -> Dict[str, Any]:
    desc = source_descriptor or {}
    kind = str(desc.get("kind", "") or "").strip().lower()
    if not kind:
      raise ValueError("sourceDescriptor.kind is required")

    dataset_path = Path(str(desc.get("datasetPath", "") or "")).expanduser()
    manifest_path = Path(str(desc.get("manifestPath", "") or "")).expanduser() if desc.get("manifestPath") else None
    root_dir = Path(str(desc.get("rootDir", "") or "")).expanduser() if desc.get("rootDir") else None

    if root_dir and not dataset_path.is_absolute():
      dataset_path = root_dir / dataset_path
    if root_dir and manifest_path and not manifest_path.is_absolute():
      manifest_path = root_dir / manifest_path

    if kind == "local_csv_manifest":
      if manifest_path is None:
        raise ValueError("local_csv_manifest requires manifestPath")
      manifest = _read_json(manifest_path)
      if not dataset_path:
        rel = str(manifest.get("datasetFile", "") or "").strip()
        if not rel:
          raise ValueError("Manifest missing datasetFile")
        dataset_path = manifest_path.parent / rel
      return _load_csv_manifest(dataset_path, manifest)

    if kind == "local_json_dataset":
      if not dataset_path:
        raise ValueError("local_json_dataset requires datasetPath")
      return _load_json_dataset(dataset_path)

    raise ValueError("Unsupported dataset source descriptor kind: " + kind)


def resolve_dataset_payload(dataset_payload: Dict[str, Any]) -> Dict[str, Any]:
    ds = dict(dataset_payload or {})
    has_embedded = bool(ds.get("xTrain")) or bool(ds.get("seqTrain"))
    source_desc = ds.get("sourceDescriptor")
    if has_embedded or not isinstance(source_desc, dict):
      return ds
    loaded = load_dataset_from_source_descriptor(source_desc)
    merged = dict(ds)
    merged.update(loaded)
    return merged

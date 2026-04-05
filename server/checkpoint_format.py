"""Canonical checkpoint helpers shared by PyTorch-side runtime adapters."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List

SCHEMA_VERSION = "osc-checkpoint-v1"
DEFAULT_TENSOR_LAYOUT = "osc-tensor-layout-v1"
DEFAULT_VALUE_ENCODING = "float32-le"


def _fnv1a_update(hash_value: int, byte_value: int) -> int:
    hash_value ^= (byte_value & 0xFF)
    hash_value = (hash_value * 0x01000193) & 0xFFFFFFFF
    return hash_value


def _hash_string(hash_value: int, text: str) -> int:
    for ch in str(text or ""):
        code = ord(ch)
        hash_value = _fnv1a_update(hash_value, code & 0xFF)
        hash_value = _fnv1a_update(hash_value, (code >> 8) & 0xFF)
    return hash_value


def _build_checkpoint_ref(specs: List[Dict[str, Any]], values: List[float]) -> str:
    import struct
    hash_value = 0x811C9DC5
    for sp in specs or []:
        hash_value = _hash_string(hash_value, str((sp or {}).get("name", "")))
        hash_value = _hash_string(hash_value, "x".join(str(x) for x in ((sp or {}).get("shape", []) or [])))
        hash_value = _hash_string(hash_value, str((sp or {}).get("dtype", "float32")))
    for v in values or []:
        for b in struct.pack("<f", float(v)):
            hash_value = _fnv1a_update(hash_value, b)
    return f"ckpt-{hash_value:08x}"


def _infer_tensor_role(name: str) -> str:
    raw = str(name or "").strip().lower()
    if not raw:
        return "tensor"
    tail = raw.split("/")[-1]
    if tail in ("kernel", "recurrent_kernel", "bias", "gamma", "beta"):
        return tail
    if tail in ("moving_mean", "running_mean"):
        return "moving_mean"
    if tail in ("moving_variance", "running_var"):
        return "moving_variance"
    if "kernel" in tail:
        return "kernel"
    if "bias" in tail:
        return "bias"
    return "tensor"


def extract_weight_values(source: Any) -> List[float]:
    if not isinstance(source, dict):
        return []
    if source.get("weightValues"):
        return list(source.get("weightValues") or [])
    if source.get("weightData"):
        return list(source.get("weightData") or [])
    if isinstance(source.get("modelArtifacts"), dict):
        vals = extract_weight_values(source["modelArtifacts"])
        if vals:
            return vals
    if isinstance(source.get("checkpoint"), dict):
        vals = extract_weight_values(source["checkpoint"])
        if vals:
            return vals
    return []


def extract_weight_specs(source: Any) -> List[Dict[str, Any]]:
    if not isinstance(source, dict):
        return []
    if isinstance(source.get("weightSpecs"), list):
        return deepcopy(source.get("weightSpecs") or [])
    if isinstance(source.get("modelArtifacts"), dict):
        specs = extract_weight_specs(source["modelArtifacts"])
        if specs:
            return specs
    if isinstance(source.get("checkpoint"), dict):
        specs = extract_weight_specs(source["checkpoint"])
        if specs:
            return specs
    return []


def describe_artifacts(weight_specs: List[Dict[str, Any]], total_values: int, producer_runtime: str = "") -> Dict[str, Any]:
    specs = deepcopy(weight_specs or [])
    return {
        "schemaVersion": SCHEMA_VERSION,
        "tensorLayout": DEFAULT_TENSOR_LAYOUT,
        "valueEncoding": DEFAULT_VALUE_ENCODING,
        "producerRuntime": str(producer_runtime or ""),
        "checkpointRef": "",
        "tensorCount": len(specs),
        "totalValues": int(total_values or 0),
        "tensors": [
            {
                "name": str((sp or {}).get("name", "")),
                "shape": list((sp or {}).get("shape", []) or []),
                "dtype": str((sp or {}).get("dtype", "float32")),
                "offset": int((sp or {}).get("offset", 0) or 0),
                "layout": DEFAULT_TENSOR_LAYOUT,
                "role": _infer_tensor_role(str((sp or {}).get("name", ""))),
            }
            for sp in specs
        ],
    }


def normalize_artifacts(weight_specs: List[Dict[str, Any]], weight_values: List[float], producer_runtime: str = "", include_weight_data: bool = False) -> Dict[str, Any]:
    specs = deepcopy(weight_specs or [])
    values = list(weight_values or [])
    checkpoint = describe_artifacts(specs, len(values), producer_runtime)
    checkpoint["checkpointRef"] = _build_checkpoint_ref(specs, values)
    out = {
        "weightSpecs": specs,
        "checkpointSchemaVersion": SCHEMA_VERSION,
        "tensorLayout": DEFAULT_TENSOR_LAYOUT,
        "valueEncoding": DEFAULT_VALUE_ENCODING,
        "producerRuntime": str(producer_runtime or ""),
        "checkpointRef": checkpoint.get("checkpointRef", ""),
        "tensors": checkpoint.get("tensors", []),
        "checkpoint": checkpoint,
    }
    if include_weight_data:
        out["weightData"] = values
    else:
        out["weightValues"] = values
    return out

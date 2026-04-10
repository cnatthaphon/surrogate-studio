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


def extract_pytorch_state(state_dict: Dict[str, Any]) -> tuple:
    """Extract weights from a PyTorch state_dict in TF.js-compatible layout.

    Canonical mapping (same for server training + notebook export):
      - Dense: [out,in] → [in,out] transpose
      - Conv2D/Conv2DTranspose: NCHW → NHWC
      - LSTM: gate reorder (i,f,g,o → i,g,f,o), merge biases, transpose kernels
      - BatchNorm: running stats separated and appended at end
      - Skips num_batches_tracked

    Returns (weight_specs, weight_values) in canonical order.
    """
    import numpy as np

    bn_running = [k for k in state_dict if "running_mean" in k or "running_var" in k]
    regular = [k for k in state_dict if "num_batches_tracked" not in k and k not in bn_running]
    ordered_keys = regular + bn_running

    weight_specs: List[Dict[str, Any]] = []
    weight_arrays: list = []
    offset = 0
    i = 0
    while i < len(ordered_keys):
        name = ordered_keys[i]
        param = state_dict[name].detach().cpu().numpy()

        # LSTM: combine weight_ih + weight_hh + bias_ih + bias_hh
        if "weight_ih_l0" in name and i + 3 < len(ordered_keys) and "weight_hh_l0" in ordered_keys[i + 1]:
            w_ih = state_dict[ordered_keys[i]].detach().cpu().numpy()
            w_hh = state_dict[ordered_keys[i + 1]].detach().cpu().numpy()
            b_ih = state_dict[ordered_keys[i + 2]].detach().cpu().numpy()
            b_hh = state_dict[ordered_keys[i + 3]].detach().cpu().numpy()
            H = w_ih.shape[0] // 4

            def _swap_gates(w: Any) -> Any:
                chunks = [w[j * H:(j + 1) * H] for j in range(4)]
                return np.concatenate([chunks[0], chunks[2], chunks[1], chunks[3]], axis=0)

            kernel = _swap_gates(w_ih).T
            recurrent = _swap_gates(w_hh).T
            bias = _swap_gates(b_ih + b_hh)
            for arr, suffix in [(kernel, "kernel"), (recurrent, "recurrent_kernel"), (bias, "bias")]:
                flat = arr.astype(np.float32).flatten()
                weight_specs.append({"name": f"tfjs_{suffix}", "shape": list(arr.shape), "dtype": "float32", "offset": offset})
                weight_arrays.append(flat)
                offset += flat.size * 4
            i += 4
            continue

        # Conv2D / Conv2DTranspose: NCHW → NHWC
        if param.ndim == 4 and ".weight" in name and any(name.startswith(p) for p in ("conv2d_", "convt2d_", "pe_proj_")):
            param = np.transpose(param, (2, 3, 1, 0))
        # Dense: [out, in] → [in, out]
        elif param.ndim == 2:
            param = param.T

        flat = param.astype(np.float32).flatten()
        weight_specs.append({"name": f"tfjs_{name}", "shape": list(param.shape), "dtype": "float32", "offset": offset})
        weight_arrays.append(flat)
        offset += flat.size * 4
        i += 1

    if weight_arrays:
        weight_values = np.concatenate(weight_arrays).tolist()
    else:
        weight_values = []
    return weight_specs, weight_values


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

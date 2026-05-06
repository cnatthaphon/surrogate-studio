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
      - LSTM: merge bias_ih + bias_hh, transpose kernels. Gate ORDER is
        identical between PyTorch and Keras/TF.js — both use i, f, g, o
        (Keras names the third gate "c" but it is the same cell-candidate
        gate PyTorch calls "g"). No reorder needed. Earlier code applied
        an [i,f,g,o] → [i,g,f,o] swap that broke LSTM inference end-to-
        end (see scripts/test_lstm_gate_parity.py).
      - GRU: apply [r,z,n] → [z,r,h] gate swap (PyTorch and Keras differ
        here — they really are different conventions). Emit 4 specs:
        kernel, recurrent_kernel, bias (= b_ih + b_hh, matches Keras/TF.js
        resetAfter=False forward), and bias_hh_residual (= b_hh alone, an
        extra spec the client ignores but the server uses to reconstruct
        b_ih and b_hh exactly on reload). Without the residual, splitting
        the combined bias as (combined, 0) would corrupt PyTorch GRU's
        n-gate which uses bias_ih and bias_hh asymmetrically:
          n = tanh(W_in·x + b_in + r·(W_hn·h + b_hn))
        — bit-exact server round trip needs both biases preserved.
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
    # GRU emits an extra "bias_hh_residual" spec the SERVER uses to recover
    # b_ih and b_hh exactly; the client only needs kernel/recurrent_kernel
    # /bias (3 specs) and reads the value blob positionally. To keep
    # client positional reads aligned across multi-layer graphs, residual
    # specs are deferred and appended AFTER all primary specs — the
    # client consumes the prefix; server-side named-load picks up
    # residuals from anywhere in the spec list.
    residual_specs: List[Dict[str, Any]] = []
    residual_arrays: list = []
    offset = 0
    i = 0
    while i < len(ordered_keys):
        name = ordered_keys[i]
        param = state_dict[name].detach().cpu().numpy()

        # Recurrent layers: weight_ih_l0/weight_hh_l0/bias_ih_l0/bias_hh_l0
        # bundle. Use the gate ratio (4*H = LSTM, 3*H = GRU, 1*H = simple
        # RNN) to choose the right per-type extract path.
        if "weight_ih_l0" in name and i + 3 < len(ordered_keys) and "weight_hh_l0" in ordered_keys[i + 1]:
            w_ih = state_dict[ordered_keys[i]].detach().cpu().numpy()
            w_hh = state_dict[ordered_keys[i + 1]].detach().cpu().numpy()
            b_ih = state_dict[ordered_keys[i + 2]].detach().cpu().numpy()
            b_hh = state_dict[ordered_keys[i + 3]].detach().cpu().numpy()
            H = w_hh.shape[1]
            gate_ratio = w_ih.shape[0] // H if H > 0 else 0

            if gate_ratio == 4:
                # LSTM. Gate order [i,f,g,o] is identical to Keras [i,f,c,o].
                # No reorder; transpose kernels and sum biases.
                kernel = w_ih.T
                recurrent = w_hh.T
                bias = b_ih + b_hh
                for arr, suffix in [(kernel, "kernel"), (recurrent, "recurrent_kernel"), (bias, "bias")]:
                    flat = arr.astype(np.float32).flatten()
                    weight_specs.append({"name": f"tfjs_{suffix}", "shape": list(arr.shape), "dtype": "float32", "offset": offset})
                    weight_arrays.append(flat)
                    offset += flat.size * 4
                i += 4
                continue

            if gate_ratio == 3:
                # GRU. PyTorch [r,z,n] vs Keras [z,r,h] — real reorder.
                def _gru_swap(w: Any) -> Any:
                    chunks = [w[j * H:(j + 1) * H] for j in range(3)]
                    return np.concatenate([chunks[1], chunks[0], chunks[2]], axis=0)

                kernel = _gru_swap(w_ih).T
                recurrent = _gru_swap(w_hh).T
                # Combined bias matches Keras GRU resetAfter=False forward.
                bias = _gru_swap(b_ih + b_hh)
                # Residual: b_hh alone, swapped. Server reload uses it to
                # recover b_ih = combined - residual exactly. Client TF.js
                # ignores this spec, so it goes into the residual bucket
                # that's appended at the end of the value blob.
                bias_hh_residual = _gru_swap(b_hh)
                for arr, suffix in [(kernel, "kernel"), (recurrent, "recurrent_kernel"), (bias, "bias")]:
                    flat = arr.astype(np.float32).flatten()
                    weight_specs.append({"name": f"tfjs_{suffix}", "shape": list(arr.shape), "dtype": "float32", "offset": offset})
                    weight_arrays.append(flat)
                    offset += flat.size * 4
                # Defer the residual spec — appended after all primary
                # specs below. Its offset is fixed up there.
                residual_flat = bias_hh_residual.astype(np.float32).flatten()
                residual_specs.append({"name": "tfjs_bias_hh_residual", "shape": list(bias_hh_residual.shape), "dtype": "float32", "offset": -1})
                residual_arrays.append(residual_flat)
                i += 4
                continue

            # Simple RNN (gate_ratio == 1) or unrecognized: fall through
            # to the per-weight generic 2D path so each tensor is emitted
            # under its own name. Server reload's named-load matches.

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

    # Append residual specs/arrays (e.g. GRU bias_hh_residual) AFTER all
    # primary tensors so client positional reads stay aligned. Fix up the
    # placeholder offsets to point into the tail of the value blob.
    for spec, flat in zip(residual_specs, residual_arrays):
        spec["offset"] = offset
        weight_specs.append(spec)
        weight_arrays.append(flat)
        offset += flat.size * 4

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

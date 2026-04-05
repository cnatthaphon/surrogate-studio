"""Runtime-neutral checkpoint loader for PyTorch models."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

import numpy as np

from checkpoint_format import extract_weight_specs, extract_weight_values


def _strip_suffix(name: str) -> str:
    return re.sub(r"_\d+$", "", str(name or ""))


def _canonicalize_weight_name(raw_name: str) -> str:
    name = _strip_suffix(raw_name)
    if not name:
        return ""
    if name.startswith("tfjs_"):
        name = name[5:]
    if "/" in name:
        return _strip_suffix(name)

    m = re.match(r"^(dense|conv1d|conv2d|convt2d|embed|out)_(\d+)\.(weight|bias)$", name)
    if m:
        return f"n{m.group(2)}/{'kernel' if m.group(3) == 'weight' else 'bias'}"

    m = re.match(r"^(bn|ln)_(\d+)\.(weight|bias|running_mean|running_var)$", name)
    if m:
        tail_map = {
            "weight": "gamma",
            "bias": "beta",
            "running_mean": "moving_mean",
            "running_var": "moving_variance",
        }
        return f"n{m.group(2)}/{tail_map[m.group(3)]}"

    m = re.match(r"^(rnn|gru|lstm)_(\d+)\.(kernel|recurrent_kernel|bias)$", name)
    if m:
        return f"n{m.group(2)}/{m.group(3)}"

    return name


def _spec_size(shape: List[int]) -> int:
    total = 1
    for dim in shape or []:
        total *= int(dim)
    return total


def _build_saved_tensor_map(config: Any) -> Tuple[Dict[str, Dict[str, Any]], np.ndarray]:
    specs = extract_weight_specs(config)
    values = extract_weight_values(config)
    flat = np.array(values, dtype=np.float32) if values else np.array([], dtype=np.float32)
    saved_map: Dict[str, Dict[str, Any]] = {}
    offset = 0
    for idx, spec in enumerate(specs):
        shape = list((spec or {}).get("shape", []) or [])
        size = _spec_size(shape)
        key = _canonicalize_weight_name((spec or {}).get("name", ""))
        if key:
            saved_map[key] = {
                "offset": offset,
                "size": size,
                "shape": shape,
                "index": idx,
                "name": str((spec or {}).get("name", "")),
            }
        offset += size
    return saved_map, flat


def _load_named_checkpoint(model: Any, saved_map: Dict[str, Dict[str, Any]], flat: np.ndarray) -> bool:
    import torch

    if not saved_map:
        return False

    state = model.state_dict()
    new_state = {}
    matched = 0
    matched_specs = set()

    for name, param in state.items():
        if "num_batches_tracked" in name:
            continue
        key = _canonicalize_weight_name(name)
        saved = saved_map.get(key)
        if not saved:
            continue
        vals = flat[saved["offset"]:saved["offset"] + saved["size"]]
        expected_size = int(param.numel())
        if vals.size != expected_size:
            continue
        matched_specs.add(key)
        if param.dim() == 2:
            new_state[name] = torch.tensor(vals.reshape(param.shape[1], param.shape[0]).T, dtype=torch.float32)
        elif param.dim() == 3 and name.startswith("conv1d_"):
            tf_shape = (param.shape[2], param.shape[1], param.shape[0])
            new_state[name] = torch.tensor(vals.reshape(tf_shape).transpose(2, 1, 0), dtype=torch.float32)
        elif param.dim() == 4 and (name.startswith("conv2d_") or name.startswith("convt2d_")):
            tf_shape = (param.shape[2], param.shape[3], param.shape[1], param.shape[0])
            new_state[name] = torch.tensor(vals.reshape(tf_shape).transpose(3, 2, 0, 1), dtype=torch.float32)
        else:
            new_state[name] = torch.tensor(vals.reshape(param.shape), dtype=torch.float32)
        matched += 1

    if not matched:
        return False

    merged_state = dict(state)
    merged_state.update(new_state)
    model.load_state_dict(merged_state)
    return True


def load_weights_into_model(model: Any, config: Any) -> bool:
    """Load canonical checkpoint weights into a PyTorch model in-place."""
    import torch

    saved_map, flat = _build_saved_tensor_map(config)
    if flat.size == 0:
        return False

    if _load_named_checkpoint(model, saved_map, flat):
        return True

    state = model.state_dict()
    bn_running = [k for k in state if "running_mean" in k or "running_var" in k]
    regular = [k for k in state if "num_batches_tracked" not in k and k not in bn_running]
    keys = regular + bn_running

    offset = 0
    new_state = {}
    i = 0
    while i < len(keys):
        name = keys[i]
        param = state[name]

        if "weight_ih_l0" in name and i + 3 < len(keys) and "weight_hh_l0" in keys[i + 1]:
            H = param.shape[0] // 4
            in_dim = param.shape[1]
            hid_dim = state[keys[i + 1]].shape[1]
            kernel_t = flat[offset:offset + in_dim * 4 * H].reshape(in_dim, 4 * H)
            offset += in_dim * 4 * H
            rec_t = flat[offset:offset + hid_dim * 4 * H].reshape(hid_dim, 4 * H)
            offset += hid_dim * 4 * H
            bias_combined = flat[offset:offset + 4 * H]
            offset += 4 * H

            def unswap(w, axis):
                if axis == 1:
                    c = [w[:, j * H:(j + 1) * H] for j in range(4)]
                    return np.concatenate([c[0], c[2], c[1], c[3]], axis=1)
                c = [w[j * H:(j + 1) * H] for j in range(4)]
                return np.concatenate([c[0], c[2], c[1], c[3]], axis=0)

            new_state[keys[i]] = torch.tensor(unswap(kernel_t, axis=1).T, dtype=torch.float32)
            new_state[keys[i + 1]] = torch.tensor(unswap(rec_t, axis=1).T, dtype=torch.float32)
            bias_unswapped = unswap(bias_combined.reshape(1, -1), axis=1).flatten()
            new_state[keys[i + 2]] = torch.tensor(bias_unswapped / 2, dtype=torch.float32)
            new_state[keys[i + 3]] = torch.tensor(bias_unswapped / 2, dtype=torch.float32)
            i += 4
            continue

        size = param.numel()
        vals = flat[offset:offset + size]
        offset += size
        if param.dim() == 2:
            new_state[name] = torch.tensor(vals.reshape(param.shape[1], param.shape[0]).T, dtype=torch.float32)
        elif param.dim() == 3 and name.startswith("conv1d_"):
            new_state[name] = torch.tensor(vals.reshape(param.shape[2], param.shape[1], param.shape[0]).transpose(2, 1, 0), dtype=torch.float32)
        elif param.dim() == 4 and (name.startswith("conv2d_") or name.startswith("convt2d_")):
            tf_shape = (param.shape[2], param.shape[3], param.shape[1], param.shape[0])
            new_state[name] = torch.tensor(vals.reshape(tf_shape).transpose(3, 2, 0, 1), dtype=torch.float32)
        else:
            new_state[name] = torch.tensor(vals.reshape(param.shape), dtype=torch.float32)
        i += 1

    model.load_state_dict(new_state)
    return True

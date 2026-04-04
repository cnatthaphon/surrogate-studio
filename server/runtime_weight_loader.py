"""Runtime-neutral checkpoint loader for PyTorch models."""

from __future__ import annotations

from typing import Any

import numpy as np

from checkpoint_format import extract_weight_values


def load_weights_into_model(model: Any, config: Any) -> bool:
    """Load canonical checkpoint weights into a PyTorch model in-place."""
    import torch

    weight_values = extract_weight_values(config)
    if not weight_values:
      return False

    flat = np.array(weight_values, dtype=np.float32)
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

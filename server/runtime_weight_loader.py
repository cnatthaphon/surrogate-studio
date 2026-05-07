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

    m = re.match(r"^pe_proj_(\d+)\.(weight|bias)$", name)
    if m:
        return f"n{m.group(1)}_proj/{'kernel' if m.group(2) == 'weight' else 'bias'}"

    m = re.match(r"^tb_(ln1|ln2)_(\d+)\.(weight|bias)$", name)
    if m:
        return f"n{m.group(2)}_{m.group(1)}/{'gamma' if m.group(3) == 'weight' else 'beta'}"

    m = re.match(r"^tb_(q|k|v|attn_proj|ffn1|ffn2)_(\d+)\.(weight|bias)$", name)
    if m:
        return f"n{m.group(2)}_{m.group(1)}/{'kernel' if m.group(3) == 'weight' else 'bias'}"

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
        # Reshape based on dimensionality (not name prefix) for general Conv/Dense support
        if param.dim() == 2:
            new_state[name] = torch.tensor(vals.reshape(param.shape[1], param.shape[0]).T, dtype=torch.float32)
        elif param.dim() == 4:
            # Conv2D/ConvTranspose2D: TF.js (kH, kW, in_ch, out_ch) -> PyTorch (out_ch, in_ch, kH, kW)
            tf_shape = (param.shape[2], param.shape[3], param.shape[1], param.shape[0])
            new_state[name] = torch.tensor(vals.reshape(tf_shape).transpose(3, 2, 0, 1), dtype=torch.float32)
        elif param.dim() == 3:
            # Conv1D: TF.js (kW, in_ch, out_ch) -> PyTorch (out_ch, in_ch, kW)
            tf_shape = (param.shape[2], param.shape[1], param.shape[0])
            new_state[name] = torch.tensor(vals.reshape(tf_shape).transpose(2, 1, 0), dtype=torch.float32)
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

    state = model.state_dict()

    # LSTM and GRU weights are emitted by extract_pytorch_state as bare
    # tensors named "tfjs_kernel"/"tfjs_recurrent_kernel"/"tfjs_bias"
    # (plus "tfjs_bias_hh_residual" for GRU) — no module prefix — and
    # consume 4 state_dict entries (weight_ih_l0, weight_hh_l0,
    # bias_ih_l0, bias_hh_l0). The named-load path uses a different
    # offset model, so a partial match there (e.g. on adjacent dense
    # weights) would skip the recurrent block and short-circuit the
    # whole load. Force the positional path when LSTM or GRU is present.
    #
    # Detection is structural (4*H or 3*H gate ratio), not name-based —
    # this lets the matching extract/reload pair stay in lockstep
    # regardless of how the user names their recurrent module.
    def _gate_ratio(state, k):
        v = state[k]
        hh_name = k.replace("weight_ih_l0", "weight_hh_l0")
        if v.dim() != 2 or hh_name not in state:
            return 0
        h_dim = state[hh_name].shape[1]
        return v.shape[0] // h_dim if h_dim > 0 else 0

    has_recurrent_special = any(
        "weight_ih_l0" in k and _gate_ratio(state, k) in (3, 4)
        for k in state.keys()
    )
    if not has_recurrent_special and _load_named_checkpoint(model, saved_map, flat):
        return True

    # Pre-walk specs so the GRU branch can detect old-format checkpoints
    # (single combined bias, shape [3*H]) emitted by main before the
    # PR #70 [2, 3*H] format. Falls back to a legacy load that splits
    # the combined bias as (combined, 0) — approximate vs PyTorch's
    # asymmetric n-gate but doesn't crash. Multi-GRU graphs are
    # supported by indexing in GRU encounter order.
    #
    # Only count biases that follow a GRU recurrent_kernel triple
    # (kernel + recurrent_kernel + bias), not arbitrary tfjs_bias specs.
    # In a mixed checkpoint (LSTM block before GRU), an unfiltered list
    # would put the LSTM's [4*H] bias ahead of the GRU's bias and the
    # GRU branch would consume the LSTM shape, mis-classify the
    # checkpoint as legacy, and deserialize with wrong gate semantics.
    # Compare by the suffix after any "tfjs_" prefix and any "<layer>/"
    # path so the matcher accepts every naming convention this codebase
    # produces:
    #   server-emit:    tfjs_kernel / tfjs_recurrent_kernel / tfjs_bias
    #   raw PyTorch:    kernel      / recurrent_kernel      / bias
    #   browser-emit:   n2/kernel   / n2/recurrent_kernel   / n2/bias
    # Earlier this matcher only knew the first two; browser-trained GRU
    # checkpoints (n*/...) silently fell through, the GRU branch saw no
    # bias shape, defaulted to legacy [3*H], read 3*H bytes instead of
    # 6*H, and the offset shift corrupted every following weight.
    def _suffix(name: str) -> str:
        s = str(name or "")
        if s.startswith("tfjs_"):
            s = s[5:]
        if "/" in s:
            s = s.split("/")[-1]
        return s

    gru_bias_shapes = []
    spec_list = list(extract_weight_specs(config))
    for j in range(len(spec_list) - 2):
        s0 = spec_list[j] or {}
        s1 = spec_list[j + 1] or {}
        s2 = spec_list[j + 2] or {}
        if _suffix(s0.get("name")) != "kernel":
            continue
        if _suffix(s1.get("name")) != "recurrent_kernel":
            continue
        if _suffix(s2.get("name")) != "bias":
            continue
        rec_shape = list(s1.get("shape") or [])
        if len(rec_shape) != 2 or rec_shape[0] <= 0:
            continue
        # Recurrent kernel shape is [H, gate*H]; gate=3 ⇒ GRU, 4 ⇒ LSTM.
        if rec_shape[1] // rec_shape[0] != 3:
            continue
        gru_bias_shapes.append(list(s2.get("shape") or []))
    gru_bias_idx = 0

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
            in_dim = param.shape[1]
            hid_dim = state[keys[i + 1]].shape[1]
            gate_ratio = param.shape[0] // hid_dim if hid_dim > 0 else 0
            H = hid_dim

            if gate_ratio == 4:
                # LSTM: 3 specs (kernel, recurrent_kernel, bias).
                kernel_t = flat[offset:offset + in_dim * 4 * H].reshape(in_dim, 4 * H)
                offset += in_dim * 4 * H
                rec_t = flat[offset:offset + hid_dim * 4 * H].reshape(hid_dim, 4 * H)
                offset += hid_dim * 4 * H
                bias_combined = flat[offset:offset + 4 * H]
                offset += 4 * H

                # PyTorch [i,f,g,o] is byte-identical to Keras/TF.js
                # [i,f,c,o]. No gate reorder; just transpose kernels and
                # split the combined bias evenly. The original earlier
                # [i,f,g,o] → [i,g,f,o] unswap broke LSTM inference end
                # -to-end (BUG-39). Verified by
                # scripts/test_lstm_server_reload_parity.py.
                new_state[keys[i]] = torch.tensor(kernel_t.T, dtype=torch.float32)
                new_state[keys[i + 1]] = torch.tensor(rec_t.T, dtype=torch.float32)
                new_state[keys[i + 2]] = torch.tensor(bias_combined / 2, dtype=torch.float32)
                new_state[keys[i + 3]] = torch.tensor(bias_combined / 2, dtype=torch.float32)
                i += 4
                continue

            if gate_ratio == 3:
                # GRU. Two bias formats supported:
                #   new (PR #70+): bias shape [2, 3*H]. Rows are
                #     [b_ih, b_hh], both gate-swapped to [z, r, h].
                #     Bit-exact PyTorch round trip.
                #   legacy (pre-PR #70 main): bias shape [3*H].
                #     The extract emitted a single combined bias under
                #     the wrong LSTM-pattern (4-chunk) swap. Match that
                #     broken extract's inverse so the artifact loads to
                #     ITS ORIGINAL (wrong-but-stable) state — same math
                #     production was running on. Better than crashing
                #     resume/predict/generate.
                bias_shape = gru_bias_shapes[gru_bias_idx] if gru_bias_idx < len(gru_bias_shapes) else None
                gru_bias_idx += 1
                is_new_format = bias_shape and len(bias_shape) == 2 and bias_shape[0] == 2

                kernel_t = flat[offset:offset + in_dim * 3 * H].reshape(in_dim, 3 * H)
                offset += in_dim * 3 * H
                rec_t = flat[offset:offset + hid_dim * 3 * H].reshape(hid_dim, 3 * H)
                offset += hid_dim * 3 * H

                if is_new_format:
                    bias_2x = flat[offset:offset + 2 * 3 * H].reshape(2, 3 * H)
                    offset += 2 * 3 * H

                    def _gru_unswap_axis1(w):
                        c = [w[:, j * H:(j + 1) * H] for j in range(3)]
                        return np.concatenate([c[1], c[0], c[2]], axis=1)

                    def _gru_unswap_axis0(w):
                        c = [w[j * H:(j + 1) * H] for j in range(3)]
                        return np.concatenate([c[1], c[0], c[2]], axis=0)

                    weight_ih = _gru_unswap_axis1(kernel_t).T
                    weight_hh = _gru_unswap_axis1(rec_t).T
                    bias_ih = _gru_unswap_axis0(bias_2x[0])
                    bias_hh = _gru_unswap_axis0(bias_2x[1])
                else:
                    # Legacy 3*H bias. The kernels were also extracted with
                    # the wrong LSTM-pattern swap (4-chunk). Apply the
                    # matching unswap so values land where the legacy
                    # in-production model expected them. Math is incorrect
                    # vs PyTorch GRU, but matches the legacy extract — the
                    # artifact loads to its prior wrong-but-stable state
                    # rather than to garbage.
                    bias_combined = flat[offset:offset + 3 * H]
                    offset += 3 * H

                    # 4-chunk LSTM-pattern unswap requires 4*H_lstm = 3*H.
                    # H_lstm = 3*H // 4 is integer only when H % 4 == 0.
                    # Most production GRUs use units divisible by 4
                    # (Oscillator: 64). For other widths, fall back to no
                    # swap on the kernels; bias still split evenly.
                    if (3 * H) % 4 == 0:
                        H_lstm = (3 * H) // 4

                        def _lstm_unswap_axis1(w):
                            c = [w[:, j * H_lstm:(j + 1) * H_lstm] for j in range(4)]
                            return np.concatenate([c[0], c[2], c[1], c[3]], axis=1)

                        def _lstm_unswap_axis0(w):
                            c = [w[j * H_lstm:(j + 1) * H_lstm] for j in range(4)]
                            return np.concatenate([c[0], c[2], c[1], c[3]], axis=0)

                        weight_ih = _lstm_unswap_axis1(kernel_t).T
                        weight_hh = _lstm_unswap_axis1(rec_t).T
                        bias_combined_unswapped = _lstm_unswap_axis0(bias_combined.reshape(1, -1)).flatten()
                    else:
                        weight_ih = kernel_t.T
                        weight_hh = rec_t.T
                        bias_combined_unswapped = bias_combined
                    bias_ih = bias_combined_unswapped / 2
                    bias_hh = bias_combined_unswapped / 2

                new_state[keys[i]] = torch.tensor(weight_ih, dtype=torch.float32)
                new_state[keys[i + 1]] = torch.tensor(weight_hh, dtype=torch.float32)
                new_state[keys[i + 2]] = torch.tensor(bias_ih, dtype=torch.float32)
                new_state[keys[i + 3]] = torch.tensor(bias_hh, dtype=torch.float32)
                i += 4
                continue
            # gate_ratio == 1 (simple RNN) or unrecognized: fall through
            # to per-tensor generic handling below.

        size = param.numel()
        vals = flat[offset:offset + size]
        offset += size
        # Reshape based on dimensionality (not name prefix) for general Conv/Dense support
        if param.dim() == 2:
            new_state[name] = torch.tensor(vals.reshape(param.shape[1], param.shape[0]).T, dtype=torch.float32)
        elif param.dim() == 4:
            tf_shape = (param.shape[2], param.shape[3], param.shape[1], param.shape[0])
            new_state[name] = torch.tensor(vals.reshape(tf_shape).transpose(3, 2, 0, 1), dtype=torch.float32)
        elif param.dim() == 3:
            tf_shape = (param.shape[2], param.shape[1], param.shape[0])
            new_state[name] = torch.tensor(vals.reshape(tf_shape).transpose(2, 1, 0), dtype=torch.float32)
        else:
            new_state[name] = torch.tensor(vals.reshape(param.shape), dtype=torch.float32)
        i += 1

    model.load_state_dict(new_state)
    return True

#!/usr/bin/env python3
"""
Server-side batch prediction.

Rebuilds model from graph, loads trained weights, runs inference.
Returns raw predictions (no metric computation — that's evaluation's job).

Protocol: prints JSON line {"kind": "result", "result": {...}}
"""
import json
import sys
import numpy as np


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"kind": "error", "message": "Usage: predict_subprocess.py <config.json>"}))
        sys.exit(1)

    with open(sys.argv[1]) as f:
        config = json.load(f)

    import torch

    sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
    from train_subprocess import build_model_from_graph
    from test_subprocess import main as _unused  # ensure weight-loading helpers are importable

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    graph = config.get("graph", {})
    feature_size = int(config.get("featureSize", 40))
    target_size = int(config.get("targetSize", feature_size))
    num_classes = int(config.get("numClasses", 0))
    x_input = np.array(config.get("xInput", []), dtype=np.float32)

    if x_input.size == 0:
        print(json.dumps({"kind": "error", "message": "No input data"}))
        sys.exit(1)

    # Build + load weights (reuse test_subprocess weight loading)
    model = build_model_from_graph(graph, feature_size, target_size, num_classes)
    model = model.to(device)
    _load_weights(model, config)

    # Inference
    model.eval()
    batch_size = int(config.get("batchSize", 512))
    all_preds = []
    for i in range(0, len(x_input), batch_size):
        batch = torch.tensor(x_input[i:i + batch_size], dtype=torch.float32).to(device)
        with torch.no_grad():
            pred = model(batch).cpu().numpy()
        all_preds.append(pred)

    predictions = np.concatenate(all_preds, axis=0).tolist()
    print(json.dumps({"kind": "result", "result": {"predictions": predictions, "N": len(predictions)}}))


def _load_weights(model, config):
    """Load weights from config — same logic as test_subprocess.py."""
    weight_values = config.get("weightValues", [])
    if not weight_values:
        artifacts = config.get("modelArtifacts", {})
        weight_values = artifacts.get("weightValues", artifacts.get("weightData", []))
    if not weight_values:
        return

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
            kernel_t = flat[offset:offset + in_dim * 4 * H].reshape(in_dim, 4 * H); offset += in_dim * 4 * H
            rec_t = flat[offset:offset + hid_dim * 4 * H].reshape(hid_dim, 4 * H); offset += hid_dim * 4 * H
            bias_combined = flat[offset:offset + 4 * H]; offset += 4 * H

            def unswap(w, axis):
                if axis == 1:
                    c = [w[:, j * H:(j + 1) * H] for j in range(4)]
                    return np.concatenate([c[0], c[2], c[1], c[3]], axis=1)
                else:
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
        vals = flat[offset:offset + size]; offset += size
        if param.dim() == 2:
            new_state[name] = torch.tensor(vals.reshape(param.shape[1], param.shape[0]).T, dtype=torch.float32)
        else:
            new_state[name] = torch.tensor(vals.reshape(param.shape), dtype=torch.float32)
        i += 1

    model.load_state_dict(new_state)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(json.dumps({"kind": "error", "message": f"{type(e).__name__}: {e}\n{traceback.format_exc()}"}))
        sys.exit(1)

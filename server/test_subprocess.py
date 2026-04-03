#!/usr/bin/env python3
"""
Server-side test evaluation.

Rebuilds model from graph, loads trained weights, runs inference on test data,
computes metrics. All in PyTorch — no cross-runtime weight transfer.

Protocol: prints JSON line {"kind": "result", "result": {...}}
"""
import json
import sys
import numpy as np


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"kind": "error", "message": "Usage: test_subprocess.py <config.json>"}))
        sys.exit(1)

    with open(sys.argv[1]) as f:
        config = json.load(f)

    import torch
    import torch.nn as nn

    sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
    from train_subprocess import build_model_from_graph

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    graph = config.get("graph", {})
    ds = config.get("dataset", {})
    feature_size = int(ds.get("featureSize", 40))
    x_test = np.array(ds.get("xTest", []), dtype=np.float32)
    y_test = np.array(ds.get("yTest", []), dtype=np.float32)

    if x_test.size == 0:
        print(json.dumps({"kind": "error", "message": "No test data"}))
        sys.exit(1)

    target_size = y_test.shape[1] if y_test.ndim > 1 else 1
    num_classes = int(ds.get("numClasses", 0))

    # Build model
    model = build_model_from_graph(graph, feature_size, target_size, num_classes)
    model = model.to(device)

    # Load weights
    weight_values = config.get("weightValues", [])
    if not weight_values:
        artifacts = config.get("modelArtifacts", {})
        weight_values = artifacts.get("weightValues", artifacts.get("weightData", []))

    if weight_values:
        flat = np.array(weight_values, dtype=np.float32)

        # Reverse the export transformation: undo gate swap + transpose
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
                # LSTM: exported as [kernel.T(gate-swapped), recurrent.T(gate-swapped), bias(gate-swapped)]
                # Reverse: read transposed+swapped, un-swap gates, un-transpose
                H = param.shape[0] // 4
                in_dim = param.shape[1]
                hid_dim = state[keys[i + 1]].shape[1]

                # kernel [in, 4*H] → transpose to [4*H, in], un-swap gates
                kernel_t = flat[offset:offset + in_dim * 4 * H].reshape(in_dim, 4 * H)
                offset += in_dim * 4 * H
                # recurrent [hid, 4*H] → transpose to [4*H, hid], un-swap
                rec_t = flat[offset:offset + hid_dim * 4 * H].reshape(hid_dim, 4 * H)
                offset += hid_dim * 4 * H
                # bias [4*H]
                bias_combined = flat[offset:offset + 4 * H]
                offset += 4 * H

                def unswap(w, axis):
                    """TF.js [i,c,f,o] → PyTorch [i,f,c,o]"""
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
            vals = flat[offset:offset + size]
            offset += size

            if param.dim() == 2:
                # Un-transpose: TF.js [in, out] → PyTorch [out, in]
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

    # Run inference
    model.eval()
    x_t = torch.tensor(x_test, dtype=torch.float32).to(device)
    with torch.no_grad():
        pred = model(x_t).cpu().numpy()

    # Compute metrics
    truth = y_test
    is_classification = ds.get("targetMode") in ("label", "logits")

    result = {"testN": len(x_test)}

    if is_classification and num_classes > 0:
        pred_labels = pred.argmax(axis=1)
        true_labels = truth.flatten().astype(int) if truth.ndim == 1 or truth.shape[1] == 1 else truth.argmax(axis=1)
        correct = int((pred_labels == true_labels).sum())
        result["accuracy"] = correct / len(x_test)
        # confusion matrix + per-class metrics
        cm = np.zeros((num_classes, num_classes), dtype=int)
        for i in range(len(pred_labels)):
            cm[int(true_labels[i])][int(pred_labels[i])] += 1
        result["confusionMatrix"] = cm.tolist()
        # per-class precision, recall, F1
        per_class = []
        for c in range(num_classes):
            tp = int(cm[c][c])
            fp = int(cm[:, c].sum() - tp)
            fn = int(cm[c, :].sum() - tp)
            prec = tp / (tp + fp) if (tp + fp) > 0 else 0
            rec = tp / (tp + fn) if (tp + fn) > 0 else 0
            f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0
            per_class.append({"class": c, "precision": prec, "recall": rec, "f1": f1, "support": int(cm[c, :].sum())})
        result["perClassMetrics"] = per_class
        result["macroF1"] = float(np.mean([p["f1"] for p in per_class]))
    else:
        # Flatten all dims for metrics
        t_flat = truth.flatten()
        p_flat = pred.flatten()
        result["mae"] = float(np.mean(np.abs(p_flat - t_flat)))
        result["rmse"] = float(np.sqrt(np.mean((p_flat - t_flat) ** 2)))
        result["bias"] = float(np.mean(p_flat - t_flat))
        ss_tot = float(np.sum((t_flat - t_flat.mean()) ** 2))
        ss_res = float(np.sum((t_flat - p_flat) ** 2))
        result["r2"] = 1 - ss_res / ss_tot if ss_tot > 0 else 0

    print(json.dumps({"kind": "result", "result": result}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(json.dumps({"kind": "error", "message": f"{type(e).__name__}: {e}\n{traceback.format_exc()}"}))
        sys.exit(1)

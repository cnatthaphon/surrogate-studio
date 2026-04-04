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
    from runtime_weight_loader import load_weights_into_model

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
    load_weights_into_model(model, config)

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

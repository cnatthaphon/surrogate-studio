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
    from runtime_weight_loader import load_weights_into_model

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
    load_weights_into_model(model, config)

    # Inference
    model.eval()
    batch_size = int(config.get("batchSize", 512))
    all_preds = []
    head_outputs = None
    for i in range(0, len(x_input), batch_size):
        batch = torch.tensor(x_input[i:i + batch_size], dtype=torch.float32).to(device)
        with torch.no_grad():
            pred = model(batch)
        if isinstance(pred, (list, tuple)):
            pred_items = [p.detach().cpu().numpy() for p in pred]
            if head_outputs is None:
                head_outputs = [[] for _ in range(len(pred_items))]
            for idx, item in enumerate(pred_items):
                head_outputs[idx].append(item)
            all_preds.append(pred_items[0])
        else:
            all_preds.append(pred.detach().cpu().numpy())

    predictions = np.concatenate(all_preds, axis=0).tolist()
    result = {"predictions": predictions, "N": len(predictions)}
    if head_outputs:
        result["headOutputs"] = [np.concatenate(items, axis=0).tolist() for items in head_outputs]
    print(json.dumps({"kind": "result", "result": result}))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(json.dumps({"kind": "error", "message": f"{type(e).__name__}: {e}\n{traceback.format_exc()}"}))
        sys.exit(1)

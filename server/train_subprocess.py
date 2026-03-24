#!/usr/bin/env python3
"""
Surrogate Studio — PyTorch Training Subprocess

Reads training config JSON from a file, builds model from Drawflow graph,
trains with PyTorch, prints epoch logs as JSON lines to stdout.

Protocol (stdout JSON lines):
  {"kind": "status", "message": "..."}
  {"kind": "epoch", "epoch": 1, "loss": 0.01, "val_loss": 0.02, "current_lr": 0.001, "improved": true}
  {"kind": "complete", "result": { "mae": ..., "modelArtifacts": { "weightSpecs": [...], "weightData": [...] }, ... }}
  {"kind": "error", "message": "..."}
"""

import json
import sys
import os
import traceback
import numpy as np

def status(msg):
    print(json.dumps({"kind": "status", "message": str(msg)}), flush=True)

def epoch_log(epoch, loss, val_loss, current_lr, improved):
    print(json.dumps({
        "kind": "epoch",
        "epoch": epoch,
        "loss": float(loss),
        "val_loss": float(val_loss) if val_loss is not None else None,
        "current_lr": float(current_lr),
        "improved": bool(improved),
    }), flush=True)

def complete(result):
    print(json.dumps({"kind": "complete", "result": result}), flush=True)

def error(msg):
    print(json.dumps({"kind": "error", "message": str(msg)}), flush=True)

def main():
    if len(sys.argv) < 2:
        error("Usage: train_subprocess.py <config.json>")
        sys.exit(1)

    config_path = sys.argv[1]
    with open(config_path) as f:
        config = json.load(f)

    try:
        import torch
        import torch.nn as nn
        from torch.utils.data import DataLoader, TensorDataset
    except ImportError:
        error("PyTorch not available. Install: pip install torch")
        sys.exit(1)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    status(f"PyTorch {torch.__version__} on {device}")

    # --- Extract data ---
    ds = config.get("dataset", {})
    x_train = np.array(ds.get("xTrain", []), dtype=np.float32)
    y_train = np.array(ds.get("yTrain", []), dtype=np.float32)
    x_val = np.array(ds.get("xVal", []), dtype=np.float32)
    y_val = np.array(ds.get("yVal", []), dtype=np.float32)

    if x_train.size == 0:
        error("Empty training data")
        sys.exit(1)

    feature_size = x_train.shape[1] if x_train.ndim > 1 else 1
    target_size = y_train.shape[1] if y_train.ndim > 1 else 1
    status(f"Data: {x_train.shape[0]} train, {x_val.shape[0]} val, features={feature_size}, targets={target_size}")

    # --- Build model from graph ---
    graph = config.get("graph", {})
    model = build_model_from_graph(graph, feature_size, target_size, ds.get("numClasses", 0))
    model = model.to(device)
    param_count = sum(p.numel() for p in model.parameters())
    status(f"Model: {param_count} params")

    # --- Training config ---
    epochs = int(config.get("epochs", 20))
    batch_size = int(config.get("batchSize", 32))
    lr = float(config.get("learningRate", 1e-3))
    optimizer_type = config.get("optimizerType", "adam")
    patience = int(config.get("earlyStoppingPatience", 5))
    grad_clip = float(config.get("gradClipNorm", 0))

    # --- Optimizer ---
    if optimizer_type == "sgd":
        optimizer = torch.optim.SGD(model.parameters(), lr=lr)
    elif optimizer_type == "rmsprop":
        optimizer = torch.optim.RMSprop(model.parameters(), lr=lr)
    else:
        optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=3, factor=0.5, min_lr=1e-6)

    # --- DataLoaders ---
    train_ds = TensorDataset(torch.tensor(x_train), torch.tensor(y_train))
    train_dl = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    val_ds = TensorDataset(torch.tensor(x_val), torch.tensor(y_val))
    val_dl = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    # --- Determine loss ---
    head_configs = config.get("headConfigs", [])
    target_mode = ds.get("targetMode", "xv")
    is_classification = target_mode in ("label", "logits") or (ds.get("numClasses", 0) > 0 and target_mode not in ("xv", "traj", "x", "v"))
    loss_fn = nn.CrossEntropyLoss() if is_classification else nn.MSELoss()

    # --- Train ---
    best_val_loss = float("inf")
    best_epoch = 0
    best_state = None
    no_improve = 0

    for ep in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        n_batches = 0
        for xb, yb in train_dl:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad()
            pred = model(xb)
            if is_classification:
                loss = loss_fn(pred, yb.long().squeeze(-1))
            else:
                loss = loss_fn(pred, yb)
            loss.backward()
            if grad_clip > 0:
                torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
            optimizer.step()
            train_loss += loss.item()
            n_batches += 1

        train_loss /= max(n_batches, 1)

        # Validate
        model.eval()
        val_loss = 0.0
        n_val = 0
        with torch.no_grad():
            for xb, yb in val_dl:
                xb, yb = xb.to(device), yb.to(device)
                pred = model(xb)
                if is_classification:
                    loss = loss_fn(pred, yb.long().squeeze(-1))
                else:
                    loss = loss_fn(pred, yb)
                val_loss += loss.item()
                n_val += 1
        val_loss /= max(n_val, 1)

        improved = val_loss < best_val_loss
        if improved:
            best_val_loss = val_loss
            best_epoch = ep
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            no_improve = 0
        else:
            no_improve += 1

        current_lr = optimizer.param_groups[0]["lr"]
        scheduler.step(val_loss)

        epoch_log(ep, train_loss, val_loss, current_lr, improved)

        if patience > 0 and no_improve >= patience:
            status(f"Early stopping at epoch {ep} (patience={patience})")
            break

    # Restore best weights
    if best_state:
        model.load_state_dict(best_state)

    # --- Extract weights in TF.js-compatible format ---
    # PyTorch Dense: [out, in] → TF.js: [in, out] (transpose)
    # PyTorch LSTM: weight_ih [4*hidden, input], weight_hh [4*hidden, hidden], bias_ih, bias_hh
    # TF.js LSTM: kernel [input, 4*hidden], recurrent_kernel [hidden, 4*hidden], bias [4*hidden]
    weight_specs = []
    weight_values = []
    offset = 0

    state = model.state_dict()
    keys = list(state.keys())
    i = 0
    while i < len(keys):
        name = keys[i]
        param = state[name].detach().cpu().numpy()

        # Check if this is an LSTM weight_ih (followed by weight_hh, bias_ih, bias_hh)
        if "rnn.weight_ih" in name and i + 3 < len(keys):
            w_ih = state[keys[i]].detach().cpu().numpy()     # [4*H, input]
            w_hh = state[keys[i+1]].detach().cpu().numpy()   # [4*H, hidden]
            b_ih = state[keys[i+2]].detach().cpu().numpy()    # [4*H]
            b_hh = state[keys[i+3]].detach().cpu().numpy()    # [4*H]

            # TF.js format: kernel = w_ih.T [input, 4*H], recurrent = w_hh.T [hidden, 4*H], bias = b_ih + b_hh
            kernel = w_ih.T  # transpose
            recurrent = w_hh.T  # transpose
            bias = b_ih + b_hh  # combine biases

            for arr, suffix, shape in [
                (kernel, "kernel", list(kernel.shape)),
                (recurrent, "recurrent_kernel", list(recurrent.shape)),
                (bias, "bias", list(bias.shape)),
            ]:
                data = arr.flatten().tolist()
                weight_specs.append({"name": f"tfjs_{suffix}", "shape": shape, "dtype": "float32", "offset": offset})
                weight_values.extend(data)
                offset += len(data) * 4
            i += 4
            continue

        # Regular param: transpose 2D weights (Dense layers)
        if param.ndim == 2:
            param = param.T  # [out, in] → [in, out]

        data = param.flatten().tolist()
        shape = list(param.shape)
        weight_specs.append({"name": f"tfjs_{name}", "shape": shape, "dtype": "float32", "offset": offset})
        weight_values.extend(data)
        offset += len(data) * 4
        i += 1

    # --- Compute final metrics ---
    model.eval()
    with torch.no_grad():
        x_val_t = torch.tensor(x_val).to(device)
        pred_val = model(x_val_t).cpu().numpy()
        mae = float(np.mean(np.abs(pred_val - y_val)))
        mse = float(np.mean((pred_val - y_val) ** 2))

    result = {
        "mae": mae,
        "mse": mse,
        "bestEpoch": best_epoch,
        "bestValLoss": float(best_val_loss),
        "finalLr": float(optimizer.param_groups[0]["lr"]),
        "stoppedEarly": no_improve >= patience if patience > 0 else False,
        "headCount": len(head_configs) or 1,
        "backend": str(device),
        "paramCount": param_count,
        "modelArtifacts": {
            "weightSpecs": weight_specs,
            "weightData": weight_values,  # flat float array (JSON-safe)
        },
    }

    complete(result)


def build_model_from_graph(graph, feature_size, target_size, num_classes=0):
    """Build PyTorch model from Drawflow graph JSON."""
    import torch
    import torch.nn as nn

    class _RNNWrapper(nn.Module):
        """Flat input [batch, features] → unsqueeze → RNN → last hidden."""
        def __init__(self, rnn_cls, input_size, hidden_size):
            super().__init__()
            self.rnn = rnn_cls(input_size=input_size, hidden_size=hidden_size, num_layers=1, batch_first=True)
        def forward(self, x):
            if x.dim() == 2:
                x = x.unsqueeze(1)
            out, _ = self.rnn(x)
            return out[:, -1, :]

    # Extract graph nodes
    data = {}
    if "drawflow" in graph and "Home" in graph["drawflow"]:
        data = graph["drawflow"]["Home"].get("data", {})
    elif "Home" in graph:
        data = graph["Home"].get("data", {})
    else:
        data = graph

    # Collect layers in topological order
    layers = []
    node_ids = sorted(data.keys(), key=lambda k: int(k) if k.isdigit() else 0)

    for nid in node_ids:
        node = data[nid]
        name = str(node.get("name", "")).replace("_layer", "").replace("_block", "")
        cfg = node.get("data", {})
        layers.append({"id": nid, "type": name, "config": cfg})

    # Build sequential model (simplified — follows node order)
    modules = []
    in_dim = feature_size
    out_dim = target_size

    for layer in layers:
        t = layer["type"]
        c = layer["config"]

        if t == "input":
            continue  # skip input node
        elif t == "dense":
            units = int(c.get("units", 32))
            act = str(c.get("activation", "relu"))
            modules.append(nn.Linear(in_dim, units))
            if act == "relu": modules.append(nn.ReLU())
            elif act == "tanh": modules.append(nn.Tanh())
            elif act == "sigmoid": modules.append(nn.Sigmoid())
            in_dim = units
        elif t == "dropout":
            rate = float(c.get("rate", 0.1))
            modules.append(nn.Dropout(rate))
        elif t == "batchnorm":
            modules.append(nn.BatchNorm1d(in_dim))
        elif t == "layernorm":
            modules.append(nn.LayerNorm(in_dim))
        elif t in ("latent_mu", "latent_logvar", "latent"):
            units = int(c.get("units", 8))
            modules.append(nn.Linear(in_dim, units))
            in_dim = units
        elif t == "reparam":
            # Match TF.js: dense(logvar → noise) + add(mu, noise)
            # In Sequential mode, we add a Linear layer that learns noise projection from logvar
            # This matches TF.js reparam_noise layer
            modules.append(nn.Linear(in_dim, in_dim))
            # in_dim stays the same (output = mu + noise projection)
        elif t == "output":
            # output layer: project to target size
            target = str(c.get("target", "xv"))
            if target in ("label", "logits") and num_classes > 0:
                modules.append(nn.Linear(in_dim, num_classes))
            else:
                modules.append(nn.Linear(in_dim, out_dim))
        elif t in ("lstm", "gru", "rnn"):
            units = int(c.get("units", 32))
            # Use actual RNN layer to match TF.js weight layout
            rnn_cls = {"lstm": nn.LSTM, "gru": nn.GRU, "rnn": nn.RNN}[t]
            modules.append(_RNNWrapper(rnn_cls, in_dim, units))
            in_dim = units
        elif t == "image_source":
            continue
        elif t == "concat":
            continue
        elif t == "conv1d":
            continue  # skip for now
        elif t == "noise_schedule":
            continue
        else:
            status(f"Unknown node type: {t}, skipping")

    if not modules:
        # Fallback: simple linear
        modules = [nn.Linear(feature_size, target_size)]

    return nn.Sequential(*modules)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        error(f"{type(e).__name__}: {e}\n{traceback.format_exc()}")
        sys.exit(1)

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
    # Separate: regular weights first, then BN running stats at end (matching TF.js order)
    bn_running_keys = [k for k in state.keys() if "running_mean" in k or "running_var" in k]
    regular_keys = [k for k in state.keys() if "num_batches_tracked" not in k and k not in bn_running_keys]
    keys = regular_keys + bn_running_keys
    i = 0
    while i < len(keys):
        name = keys[i]
        param = state[name].detach().cpu().numpy()

        # Check if this is an RNN weight_ih (followed by weight_hh, bias_ih, bias_hh)
        if "weight_ih_l0" in name and i + 3 < len(keys) and "weight_hh_l0" in keys[i+1]:
            w_ih = state[keys[i]].detach().cpu().numpy()     # [4*H, input]
            w_hh = state[keys[i+1]].detach().cpu().numpy()   # [4*H, hidden]
            b_ih = state[keys[i+2]].detach().cpu().numpy()    # [4*H]
            b_hh = state[keys[i+3]].detach().cpu().numpy()    # [4*H]

            # TF.js format: kernel = w_ih.T [input, 4*H], recurrent = w_hh.T [hidden, 4*H], bias = b_ih + b_hh
            # CRITICAL: PyTorch gate order = [i, f, g, o], TF.js = [i, g, f, o]
            # Must swap forget (f) and cell candidate (g) gate blocks
            H = w_ih.shape[0] // 4
            def swap_gates(w):
                """Swap gate blocks 1 (forget) and 2 (cell) for PyTorch→TF.js"""
                chunks = [w[i*H:(i+1)*H] for i in range(4)]  # i, f, g, o
                return np.concatenate([chunks[0], chunks[2], chunks[1], chunks[3]], axis=0)  # i, g, f, o

            kernel = swap_gates(w_ih).T  # reorder gates then transpose
            recurrent = swap_gates(w_hh).T  # reorder gates then transpose
            bias = swap_gates(b_ih + b_hh)  # combine biases then reorder

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
        "paramCount": len(weight_values),  # use exported count (matches TF.js after bias combining)
        "modelArtifacts": {
            "weightSpecs": weight_specs,
            "weightData": weight_values,  # flat float array (JSON-safe)
        },
    }

    complete(result)


def build_model_from_graph(graph, feature_size, target_size, num_classes=0):
    """Build PyTorch model from Drawflow graph using functional API.

    Mirrors TF.js model_builder_core.js exactly:
    - Topological sort of graph nodes
    - Follow edges for branching (VAE mu/logvar fork)
    - Same layer types, same weight shapes
    - Reparam = concat(mu, logvar) → dense(noise) → add(mu, noise)
    """
    import torch
    import torch.nn as nn

    # --- Extract Drawflow graph ---
    raw = {}
    if "drawflow" in graph and "Home" in graph["drawflow"]:
        raw = graph["drawflow"]["Home"].get("data", {})
    elif "Home" in graph:
        raw = graph["Home"].get("data", {})
    else:
        raw = graph

    # Parse nodes + edges
    nodes = {}
    edges_out = {}  # nid → [{ to, from_port, to_port }]
    edges_in = {}   # nid → [{ from, from_port, to_port }]
    for nid in sorted(raw.keys(), key=lambda k: int(k) if k.isdigit() else 0):
        n = raw[nid]
        t = str(n.get("name", "")).replace("_layer", "").replace("_block", "")
        nodes[nid] = {"type": t, "config": n.get("data", {})}
        edges_out[nid] = []
        edges_in.setdefault(nid, [])
        for ok, ov in (n.get("outputs", {}) or {}).items():
            for conn in (ov or {}).get("connections", []):
                to_id = str(conn.get("node", ""))
                to_port = str(conn.get("input", "input_1"))
                edges_out[nid].append({"to": to_id, "from_port": ok, "to_port": to_port})
                edges_in.setdefault(to_id, [])
                edges_in[to_id].append({"from": nid, "from_port": ok, "to_port": to_port})

    # Topological sort
    indeg = {k: len(edges_in.get(k, [])) for k in nodes}
    q = sorted([k for k in nodes if indeg[k] == 0], key=lambda x: int(x) if x.isdigit() else 0)
    topo = []
    while q:
        cur = q.pop(0)
        topo.append(cur)
        for e in edges_out.get(cur, []):
            indeg[e["to"]] -= 1
            if indeg[e["to"]] == 0:
                q.append(e["to"])
                q.sort(key=lambda x: int(x) if x.isdigit() else 0)

    # --- Build model using nn.Module with named submodules ---
    class _GraphModel(nn.Module):
        def __init__(self):
            super().__init__()
            self.topo = topo
            self.node_types = {nid: nodes[nid]["type"] for nid in topo}
            self.node_configs = {nid: nodes[nid]["config"] for nid in topo}
            self.input_id = None
            self.output_ids = []
            self._edges_in = edges_in

            dim_map = {}

            for nid in topo:
                t = self.node_types[nid]
                c = self.node_configs[nid]
                # get input dim from parents
                parents = edges_in.get(nid, [])
                # sort parents by port (input_1 before input_2)
                parents.sort(key=lambda p: p["to_port"])
                parent_dims = [dim_map[p["from"]] for p in parents if p["from"] in dim_map]
                in_dim = parent_dims[0] if parent_dims else feature_size

                if t == "input":
                    self.input_id = nid
                    dim_map[nid] = feature_size
                elif t == "dense":
                    units = int(c.get("units", 32))
                    setattr(self, f"dense_{nid}", nn.Linear(in_dim, units))
                    act = str(c.get("activation", "relu"))
                    if act == "relu": setattr(self, f"act_{nid}", nn.ReLU())
                    elif act == "tanh": setattr(self, f"act_{nid}", nn.Tanh())
                    elif act == "sigmoid": setattr(self, f"act_{nid}", nn.Sigmoid())
                    dim_map[nid] = units
                elif t in ("latent_mu", "latent_logvar", "latent"):
                    units = int(c.get("units", 8))
                    setattr(self, f"dense_{nid}", nn.Linear(in_dim, units))
                    dim_map[nid] = units
                elif t == "reparam":
                    # TF.js: dense(logvar → noise, init=zeros) + add(mu, noise)
                    # Match: zero-initialized Linear applied to logvar input
                    layer = nn.Linear(in_dim, in_dim)
                    nn.init.zeros_(layer.weight)
                    nn.init.zeros_(layer.bias)
                    setattr(self, f"reparam_noise_{nid}", layer)
                    dim_map[nid] = in_dim
                elif t in ("lstm", "gru", "rnn"):
                    units = int(c.get("units", 32))
                    rnn_cls = {"lstm": nn.LSTM, "gru": nn.GRU, "rnn": nn.RNN}[t]
                    setattr(self, f"rnn_{nid}", rnn_cls(
                        input_size=in_dim, hidden_size=units, num_layers=1, batch_first=True))
                    dim_map[nid] = units
                elif t == "dropout":
                    setattr(self, f"drop_{nid}", nn.Dropout(float(c.get("rate", 0.1))))
                    dim_map[nid] = in_dim
                elif t == "batchnorm":
                    setattr(self, f"bn_{nid}", nn.BatchNorm1d(in_dim))
                    dim_map[nid] = in_dim
                elif t == "layernorm":
                    setattr(self, f"ln_{nid}", nn.LayerNorm(in_dim))
                    dim_map[nid] = in_dim
                elif t == "output":
                    target = str(c.get("target", "xv"))
                    odim = num_classes if (target in ("label", "logits") and num_classes > 0) else target_size
                    setattr(self, f"out_{nid}", nn.Linear(in_dim, odim))
                    dim_map[nid] = odim
                    self.output_ids.append(nid)
                else:
                    dim_map[nid] = in_dim

        def forward(self, x):
            tensors = {}
            for nid in self.topo:
                t = self.node_types[nid]
                parents = self._edges_in.get(nid, [])
                parents_sorted = sorted(parents, key=lambda p: p["to_port"])

                if t == "input":
                    tensors[nid] = x
                    continue

                # get input tensor (first parent)
                inp = tensors[parents_sorted[0]["from"]] if parents_sorted else x

                if t == "dense" or t in ("latent_mu", "latent_logvar", "latent"):
                    out = getattr(self, f"dense_{nid}")(inp)
                    act = getattr(self, f"act_{nid}", None)
                    if act is not None:
                        out = act(out)
                    tensors[nid] = out
                elif t == "reparam":
                    # TF.js: noise = dense(logvar), output = mu + noise
                    # input_1 = mu (first parent), input_2 = logvar (second parent)
                    mu_tensor = inp  # first parent
                    logvar_tensor = tensors[parents_sorted[1]["from"]] if len(parents_sorted) > 1 else inp
                    noise = getattr(self, f"reparam_noise_{nid}")(logvar_tensor)
                    tensors[nid] = mu_tensor + noise
                elif t in ("lstm", "gru", "rnn"):
                    rnn = getattr(self, f"rnn_{nid}")
                    h = inp
                    if h.dim() == 2:
                        h = h.unsqueeze(1)
                    out, _ = rnn(h)
                    tensors[nid] = out[:, -1, :]
                elif t == "dropout":
                    tensors[nid] = getattr(self, f"drop_{nid}")(inp)
                elif t == "batchnorm":
                    tensors[nid] = getattr(self, f"bn_{nid}")(inp)
                elif t == "layernorm":
                    tensors[nid] = getattr(self, f"ln_{nid}")(inp)
                elif t == "output":
                    tensors[nid] = getattr(self, f"out_{nid}")(inp)
                else:
                    tensors[nid] = inp

            # return first output
            if self.output_ids:
                return tensors[self.output_ids[0]]
            return x

    return _GraphModel()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        error(f"{type(e).__name__}: {e}\n{traceback.format_exc()}")
        sys.exit(1)

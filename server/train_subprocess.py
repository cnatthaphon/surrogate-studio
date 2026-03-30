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
    status("Loading config...")
    # use orjson for fast JSON parsing if available (5-10x faster for large payloads)
    try:
        import orjson
        with open(config_path, "rb") as f:
            config = orjson.loads(f.read())
    except ImportError:
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
    status("Loading dataset into memory...")
    ds = config.get("dataset", {})
    x_train = np.array(ds.get("xTrain", []), dtype=np.float32)
    y_train = np.array(ds.get("yTrain", []), dtype=np.float32)
    x_val = np.array(ds.get("xVal", []), dtype=np.float32)
    y_val = np.array(ds.get("yVal", []), dtype=np.float32)

    if x_train.size == 0:
        error("Empty training data")
        sys.exit(1)

    feature_size = x_train.shape[1] if x_train.ndim > 1 else 1
    # determine classification from headConfigs headType (set by schema, not target names)
    graph = config.get("graph", {})
    head_configs = config.get("headConfigs", [])
    _head_types = [str(hc.get("headType", "regression")) for hc in head_configs] if head_configs else ["regression"]
    _is_all_cls = all(ht == "classification" for ht in _head_types)
    target_size = 1 if _is_all_cls else feature_size
    status(f"Data: {x_train.shape[0]} train, {x_val.shape[0]} val, features={feature_size}, targets={target_size}")

    # --- Build model from graph ---
    num_classes = ds.get("numClasses", 0)
    model = build_model_from_graph(graph, feature_size, target_size, num_classes)
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

    # --- Determine loss + prepare labels ---
    # head_configs already extracted above from config
    is_classification = _is_all_cls
    # check if any head uses BCE (needs float labels, not int)
    _any_bce = any(str(hc.get("loss", "")).lower() == "bce" for hc in head_configs) if head_configs else False
    if is_classification and not _any_bce:
        loss_fn = nn.CrossEntropyLoss()
        # CrossEntropyLoss expects integer labels, not one-hot float
        if y_train.ndim > 1 and y_train.shape[1] > 1:
            y_train = y_train.argmax(axis=1).astype(np.int64)
        else:
            y_train = y_train.flatten().astype(np.int64)
        if y_val.ndim > 1 and y_val.shape[1] > 1:
            y_val = y_val.argmax(axis=1).astype(np.int64)
        else:
            y_val = y_val.flatten().astype(np.int64)
    else:
        loss_fn = nn.BCELoss() if _any_bce else nn.MSELoss()

    # --- DataLoaders (after label conversion) ---
    train_ds = TensorDataset(torch.tensor(x_train), torch.tensor(y_train))
    train_dl = DataLoader(train_ds, batch_size=batch_size, shuffle=True)
    val_ds = TensorDataset(torch.tensor(x_val), torch.tensor(y_val))
    val_dl = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    # --- Detect phases from headConfigs ---
    phases = sorted(set(str(h.get("phase", "")).strip() for h in head_configs)) if head_configs else [""]
    is_phased = any(p != "" for p in phases)

    # per-head loss functions — loss field takes priority, headType as fallback
    head_losses = []
    for hc in (head_configs or [{}]):
        htype = str(hc.get("headType", "regression")).lower()
        hl = str(hc.get("loss", "mse")).lower()
        hw = float(hc.get("matchWeight", 1.0))
        hp = str(hc.get("phase", "")).strip()
        # explicit loss field takes priority
        if hl == "none":
            head_losses.append({"fn": None, "weight": 0, "phase": hp, "cls": False, "skip": True})
        elif hl == "bce":
            head_losses.append({"fn": nn.BCELoss(), "weight": hw, "phase": hp, "cls": False, "bce_binary": True})
        elif hl in ("categoricalcrossentropy", "categorical_crossentropy", "cross_entropy", "sparsecategoricalcrossentropy"):
            head_losses.append({"fn": nn.CrossEntropyLoss(), "weight": hw, "phase": hp, "cls": True})
        elif hl == "mae":
            head_losses.append({"fn": nn.L1Loss(), "weight": hw, "phase": hp, "cls": False})
        elif htype == "classification":
            head_losses.append({"fn": nn.CrossEntropyLoss(), "weight": hw, "phase": hp, "cls": True})
        else:
            head_losses.append({"fn": nn.MSELoss(), "weight": hw, "phase": hp, "cls": False})

    if not head_losses:
        head_losses = [{"fn": loss_fn, "weight": 1.0, "phase": "", "cls": is_classification}]

    # per-head y data (reconstruction heads use x, classification heads use labels)
    labels_train = np.array(ds.get("labelsTrain", []), dtype=np.float32) if ds.get("labelsTrain") else None
    labels_val = np.array(ds.get("labelsVal", []), dtype=np.float32) if ds.get("labelsVal") else None

    n_heads = len(head_losses)

    def compute_loss(pred, xb, yb, active_phase):
        """Compute weighted loss across heads for active phase."""
        total = torch.tensor(0.0, device=device)
        # pred can be a list (multi-output) or single tensor
        preds = pred if isinstance(pred, list) else [pred]
        for i, hl in enumerate(head_losses):
            if hl.get("skip"):
                continue  # loss=none, passthrough
            if hl["phase"] != active_phase and hl["phase"] != "" and active_phase != "":
                continue  # skip heads not in this phase
            # get this head's prediction (by index, or first if single-output)
            head_pred = preds[i] if i < len(preds) else preds[0]
            # determine target for this head
            if hl.get("bce_binary"):
                # BCE head with 1-dim output: target = ones (real images during D phase)
                target = torch.ones(head_pred.shape[0], 1, device=device)
            elif hl["cls"]:
                target = yb.long().squeeze(-1) if yb.dtype != torch.long else yb.squeeze(-1)
                total = total + hl["weight"] * hl["fn"](head_pred, target)
                continue
            else:
                target = yb
            # match target shape to prediction shape
            if target.shape != head_pred.shape:
                if head_pred.shape[-1] == 1 and target.dim() > 1:
                    target = torch.ones_like(head_pred)  # default: all 1s for BCE
            total = total + hl["weight"] * hl["fn"](head_pred, target)
        return total

    # --- Train ---
    best_val_loss = float("inf")
    best_epoch = 0
    best_state = None
    no_improve = 0

    for ep in range(1, epochs + 1):
        phase_losses = {}
        for phase in phases:
            model.train()
            train_loss = 0.0
            n_batches = 0
            for xb, yb in train_dl:
                xb, yb = xb.to(device), yb.to(device)
                optimizer.zero_grad()
                pred = model(xb)
                loss = compute_loss(pred, xb, yb, phase)
                loss.backward()
                if grad_clip > 0:
                    torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
                optimizer.step()
                train_loss += loss.item()
                n_batches += 1
            phase_losses[phase] = train_loss / max(n_batches, 1)

        total_train_loss = sum(phase_losses.values()) / max(len(phase_losses), 1)

        # Validate
        model.eval()
        val_loss = 0.0
        n_val = 0
        with torch.no_grad():
            for xb, yb in val_dl:
                xb, yb = xb.to(device), yb.to(device)
                pred = model(xb)
                loss = compute_loss(pred, xb, yb, "")  # empty = all phases
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

        epoch_log(ep, total_train_loss, val_loss, current_lr, improved)

        if patience > 0 and no_improve >= patience:
            status(f"Early stopping at epoch {ep} (patience={patience})")
            break

    # Restore best weights
    if best_state:
        model.load_state_dict(best_state)

    status("Training complete. Extracting weights...")
    # --- Extract weights in TF.js-compatible format ---
    # PyTorch Dense: [out, in] → TF.js: [in, out] (transpose)
    # PyTorch LSTM: weight_ih [4*hidden, input], weight_hh [4*hidden, hidden], bias_ih, bias_hh
    # TF.js LSTM: kernel [input, 4*hidden], recurrent_kernel [hidden, 4*hidden], bias [4*hidden]
    weight_specs = []
    weight_arrays = []  # collect numpy arrays, concatenate at end (much faster than Python list)
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
            w_ih = state[keys[i]].detach().cpu().numpy()
            w_hh = state[keys[i+1]].detach().cpu().numpy()
            b_ih = state[keys[i+2]].detach().cpu().numpy()
            b_hh = state[keys[i+3]].detach().cpu().numpy()

            H = w_ih.shape[0] // 4
            def swap_gates(w):
                chunks = [w[i*H:(i+1)*H] for i in range(4)]
                return np.concatenate([chunks[0], chunks[2], chunks[1], chunks[3]], axis=0)

            kernel = swap_gates(w_ih).T
            recurrent = swap_gates(w_hh).T
            bias = swap_gates(b_ih + b_hh)

            for arr, suffix, shape in [
                (kernel, "kernel", list(kernel.shape)),
                (recurrent, "recurrent_kernel", list(recurrent.shape)),
                (bias, "bias", list(bias.shape)),
            ]:
                flat = arr.astype(np.float32).flatten()
                weight_specs.append({"name": f"tfjs_{suffix}", "shape": shape, "dtype": "float32", "offset": offset})
                weight_arrays.append(flat)
                offset += flat.size * 4
            i += 4
            continue

        # Regular param: transpose 2D weights (Dense layers)
        if param.ndim == 2:
            param = param.T  # [out, in] → [in, out]

        flat = param.astype(np.float32).flatten()
        shape = list(param.shape)
        weight_specs.append({"name": f"tfjs_{name}", "shape": shape, "dtype": "float32", "offset": offset})
        weight_arrays.append(flat)
        offset += flat.size * 4
        i += 1

    # concatenate all weight arrays into one flat list (numpy concat is fast)
    if weight_arrays:
        weight_values = np.concatenate(weight_arrays).tolist()
    else:
        weight_values = []

    status("Computing test metrics...")
    # --- Compute final metrics (val + test) ---
    model.eval()
    with torch.no_grad():
        x_val_t = torch.tensor(x_val).to(device)
        raw_val = model(x_val_t)
        pred_val = (raw_val[0] if isinstance(raw_val, list) else raw_val).cpu().numpy()
        if is_classification:
            pred_labels = pred_val.argmax(axis=1)
            true_labels = y_val.flatten().astype(int)
            mae = float(np.mean(np.abs(pred_labels - true_labels)))
            mse = float(np.mean((pred_labels - true_labels) ** 2))
        else:
            mae = float(np.mean(np.abs(pred_val - y_val)))
            mse = float(np.mean((pred_val - y_val) ** 2))

        # Test metrics (if test data provided)
        x_test_raw = ds.get("xTest", [])
        y_test_raw = ds.get("yTest", [])
        test_metrics = {}
        if x_test_raw and y_test_raw:
            x_test = np.array(x_test_raw, dtype=np.float32)
            y_test = np.array(y_test_raw, dtype=np.float32)
            # batch prediction to avoid OOM on large test sets
            batch_sz = 512
            pred_chunks = []
            for bi in range(0, len(x_test), batch_sz):
                chunk = torch.tensor(x_test[bi:bi+batch_sz]).to(device)
                raw = model(chunk)
                pred_chunks.append((raw[0] if isinstance(raw, list) else raw).cpu().numpy())
            pred_test = np.concatenate(pred_chunks, axis=0)
            t_flat = y_test.flatten()
            p_flat = pred_test.flatten()
            test_metrics["testMae"] = float(np.mean(np.abs(p_flat - t_flat)))
            test_metrics["testMse"] = float(np.mean((p_flat - t_flat) ** 2))
            test_metrics["testRmse"] = float(np.sqrt(test_metrics["testMse"]))
            test_metrics["testBias"] = float(np.mean(p_flat - t_flat))
            ss_tot = float(np.sum((t_flat - t_flat.mean()) ** 2))
            ss_res = float(np.sum((t_flat - p_flat) ** 2))
            test_metrics["testR2"] = 1 - ss_res / ss_tot if ss_tot > 0 else 0
            test_metrics["testN"] = len(x_test)
            # skip raw predictions for large outputs (client re-predicts from weights)
            # only include for small outputs (classification, small regression)
            if pred_test.shape[1] <= 20:
                test_metrics["testPredictions"] = pred_test.tolist()
                test_metrics["testTruth"] = y_test.tolist()

            # Classification metrics: confusion matrix, per-class P/R/F1
            if is_classification and num_classes > 0:
                pred_labels = pred_test.argmax(axis=1)
                true_labels = y_test.flatten().astype(int) if y_test.ndim == 1 or y_test.shape[1] == 1 else y_test.argmax(axis=1)
                test_metrics["testAccuracy"] = float((pred_labels == true_labels).sum()) / len(x_test)
                # Confusion matrix [num_classes x num_classes]
                cm = np.zeros((num_classes, num_classes), dtype=int)
                for tl, pl in zip(true_labels, pred_labels):
                    if 0 <= tl < num_classes and 0 <= pl < num_classes:
                        cm[tl][pl] += 1
                test_metrics["confusionMatrix"] = cm.tolist()
                # Per-class precision, recall, F1
                per_class = []
                for c in range(num_classes):
                    tp = int(cm[c][c])
                    fp = int(cm[:, c].sum() - tp)
                    fn = int(cm[c, :].sum() - tp)
                    prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
                    rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
                    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
                    per_class.append({"precision": round(prec, 4), "recall": round(rec, 4), "f1": round(f1, 4)})
                test_metrics["perClassMetrics"] = per_class
                macro_f1 = float(np.mean([pc["f1"] for pc in per_class]))
                test_metrics["testMacroF1"] = round(macro_f1, 4)

    result = {
        "mae": mae,
        "mse": mse,
        "bestEpoch": best_epoch,
        "bestValLoss": float(best_val_loss),
        "finalLr": float(optimizer.param_groups[0]["lr"]),
        "stoppedEarly": no_improve >= patience if patience > 0 else False,
        "headCount": len(head_configs) or 1,
        "backend": str(device),
        "paramCount": len(weight_values),
        "modelArtifacts": {
            "weightSpecs": weight_specs,
            "weightData": weight_values,
        },
    }
    result.update(test_metrics)

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
                elif t == "noise_injection":
                    # Gaussian noise (training only) — passthrough with same dim
                    scale = float(c.get("scale", 0.1))
                    setattr(self, f"noise_scale_{nid}", scale)
                    dim_map[nid] = in_dim
                elif t == "detach":
                    # gradient stop — passthrough with same dim
                    dim_map[nid] = in_dim
                elif t == "sample_z":
                    # random input — like another input node
                    zdim = int(c.get("dim", 128))
                    dim_map[nid] = zdim
                elif t == "image_source":
                    # image input — like input node
                    dim_map[nid] = int(c.get("featureSize", feature_size))
                elif t == "embedding":
                    vocab_size = int(c.get("inputDim", 10000))
                    embed_dim = int(c.get("outputDim", 256))
                    setattr(self, f"embed_{nid}", nn.Embedding(vocab_size, embed_dim))
                    dim_map[nid] = embed_dim
                elif t == "reshape":
                    shape_str = str(c.get("targetShape", "28,28,1"))
                    shape = [max(1, int(s.strip())) for s in shape_str.split(",")]
                    self._reshape_shapes = getattr(self, '_reshape_shapes', {})
                    self._reshape_shapes[nid] = shape
                    dim_map[nid] = shape  # track as tuple for conv layers
                elif t == "conv2d":
                    filters = int(c.get("filters", 32))
                    ks = int(c.get("kernelSize", 3))
                    st = int(c.get("strides", 1))
                    pad_mode = str(c.get("padding", "same"))
                    pad = ks // 2 if pad_mode == "same" else 0
                    in_ch = in_dim[-1] if isinstance(in_dim, list) else 1
                    setattr(self, f"conv2d_{nid}", nn.Conv2d(in_ch, filters, ks, st, pad))
                    act = str(c.get("activation", "relu"))
                    if act == "relu": setattr(self, f"act_{nid}", nn.ReLU())
                    elif act == "tanh": setattr(self, f"act_{nid}", nn.Tanh())
                    elif act == "sigmoid": setattr(self, f"act_{nid}", nn.Sigmoid())
                    if isinstance(in_dim, list):
                        h, w = in_dim[0], in_dim[1]
                        if pad_mode == "same": dim_map[nid] = [h // st, w // st, filters]
                        else: dim_map[nid] = [(h - ks) // st + 1, (w - ks) // st + 1, filters]
                    else:
                        dim_map[nid] = [1, 1, filters]
                elif t == "conv2d_transpose":
                    filters = int(c.get("filters", 32))
                    ks = int(c.get("kernelSize", 3))
                    st = int(c.get("strides", 2))
                    pad_mode = str(c.get("padding", "same"))
                    pad = ks // 2 if pad_mode == "same" else 0
                    out_pad = st - 1 if pad_mode == "same" else 0
                    in_ch = in_dim[-1] if isinstance(in_dim, list) else 1
                    setattr(self, f"convt2d_{nid}", nn.ConvTranspose2d(in_ch, filters, ks, st, pad, out_pad))
                    act = str(c.get("activation", "relu"))
                    if act == "relu": setattr(self, f"act_{nid}", nn.ReLU())
                    elif act == "tanh": setattr(self, f"act_{nid}", nn.Tanh())
                    elif act == "sigmoid": setattr(self, f"act_{nid}", nn.Sigmoid())
                    if isinstance(in_dim, list):
                        dim_map[nid] = [in_dim[0] * st, in_dim[1] * st, filters]
                    else:
                        dim_map[nid] = [1, 1, filters]
                elif t == "maxpool2d":
                    ps = int(c.get("poolSize", 2))
                    st = int(c.get("strides", ps))
                    setattr(self, f"pool_{nid}", nn.MaxPool2d(ps, st))
                    if isinstance(in_dim, list):
                        dim_map[nid] = [in_dim[0] // st, in_dim[1] // st, in_dim[2]]
                    else:
                        dim_map[nid] = in_dim
                elif t == "upsample2d":
                    sz = int(c.get("size", 2))
                    setattr(self, f"up_{nid}", nn.Upsample(scale_factor=sz, mode='nearest'))
                    if isinstance(in_dim, list):
                        dim_map[nid] = [in_dim[0] * sz, in_dim[1] * sz, in_dim[2]]
                    else:
                        dim_map[nid] = in_dim
                elif t == "flatten":
                    if isinstance(in_dim, list):
                        flat_dim = 1
                        for dd in in_dim: flat_dim *= dd
                        dim_map[nid] = flat_dim
                    else:
                        dim_map[nid] = in_dim
                elif t == "global_avg_pool2d":
                    if isinstance(in_dim, list):
                        dim_map[nid] = in_dim[-1]  # channels
                    else:
                        dim_map[nid] = in_dim
                elif t == "output":
                    htype = str(c.get("headType", "regression")).lower()
                    oloss = str(c.get("loss", "mse")).lower()
                    if oloss == "bce":
                        odim = 1
                    elif htype == "classification" and num_classes > 0:
                        odim = num_classes
                    else:
                        odim = target_size
                    out_in = in_dim if isinstance(in_dim, int) else (in_dim[-1] if isinstance(in_dim, list) else in_dim)
                    # skip linear projection if input dim already matches output dim
                    if out_in == odim:
                        setattr(self, f"out_{nid}", nn.Identity())
                    else:
                        setattr(self, f"out_{nid}", nn.Linear(out_in, odim))
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
                if t == "image_source":
                    tensors[nid] = x
                    continue
                if t == "sample_z":
                    # generate fresh random noise each forward pass (like TF.js SampleZ)
                    zdim = int(self.node_configs[nid].get("dim", 128))
                    tensors[nid] = torch.randn(x.shape[0], zdim, device=x.device)
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
                elif t == "noise_injection":
                    scale = getattr(self, f"noise_scale_{nid}", 0.1)
                    if self.training:
                        tensors[nid] = inp + torch.randn_like(inp) * scale
                    else:
                        tensors[nid] = inp
                elif t == "detach":
                    tensors[nid] = inp.detach()
                elif t == "embedding":
                    tensors[nid] = getattr(self, f"embed_{nid}")(inp.long())
                elif t == "reshape":
                    shapes = getattr(self, '_reshape_shapes', {})
                    shape = shapes.get(nid, [28, 28, 1])
                    # TF.js: [batch, H, W, C] → PyTorch: [batch, C, H, W]
                    tensors[nid] = inp.view(inp.shape[0], shape[2], shape[0], shape[1])
                    continue
                elif t == "conv2d":
                    out = getattr(self, f"conv2d_{nid}")(inp)
                    act = getattr(self, f"act_{nid}", None)
                    tensors[nid] = act(out) if act else out
                elif t == "conv2d_transpose":
                    out = getattr(self, f"convt2d_{nid}")(inp)
                    act = getattr(self, f"act_{nid}", None)
                    tensors[nid] = act(out) if act else out
                elif t == "maxpool2d":
                    tensors[nid] = getattr(self, f"pool_{nid}")(inp)
                elif t == "upsample2d":
                    tensors[nid] = getattr(self, f"up_{nid}")(inp)
                elif t == "flatten":
                    tensors[nid] = inp.view(inp.shape[0], -1)
                elif t == "global_avg_pool2d":
                    # [batch, C, H, W] → [batch, C]
                    tensors[nid] = inp.mean(dim=[2, 3]) if inp.dim() == 4 else inp
                elif t == "output":
                    # flatten conv output if needed before linear
                    out_inp = inp.view(inp.shape[0], -1) if inp.dim() > 2 else inp
                    tensors[nid] = getattr(self, f"out_{nid}")(out_inp)
                else:
                    tensors[nid] = inp

            # return outputs
            if self.output_ids:
                if len(self.output_ids) == 1:
                    return tensors[self.output_ids[0]]
                # multi-output: return list of all outputs
                return [tensors[oid] for oid in self.output_ids]
            return x

    return _GraphModel()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        error(f"{type(e).__name__}: {e}\n{traceback.format_exc()}")
        sys.exit(1)

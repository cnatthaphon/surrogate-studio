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
import math
import signal
import traceback
import numpy as np
from checkpoint_format import normalize_artifacts, extract_pytorch_state
from runtime_weight_loader import load_weights_into_model
from dataset_source_loader import resolve_dataset_payload

_STOP_REQUESTED = False

def _request_stop(signum, frame):
    global _STOP_REQUESTED
    if _STOP_REQUESTED:
        return
    _STOP_REQUESTED = True
    try:
        status("Stop requested. Finishing current batch and saving weights...")
    except Exception:
        pass

def _should_stop():
    return bool(_STOP_REQUESTED)

def status(msg):
    print(json.dumps({"kind": "status", "message": str(msg)}), flush=True)

def epoch_log(epoch, loss, val_loss, current_lr, improved, phase_losses=None):
    msg = {
        "kind": "epoch",
        "epoch": epoch,
        "loss": float(loss),
        "val_loss": float(val_loss) if val_loss is not None else None,
        "current_lr": float(current_lr),
        "improved": bool(improved),
    }
    if phase_losses:
        msg["phaseLosses"] = {k: float(v) for k, v in phase_losses.items()}
    print(json.dumps(msg), flush=True)

def complete(result):
    print(json.dumps({"kind": "complete", "result": result}), flush=True)

def error(msg):
    print(json.dumps({"kind": "error", "message": str(msg)}), flush=True)

def _cfg_float(v, fallback):
    try:
        n = float(v)
        return n if np.isfinite(n) else fallback
    except Exception:
        return fallback

def _cfg_bool(v, fallback=True):
    if v is None:
        return bool(fallback)
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in ("false", "0", "no", "off"):
        return False
    if s in ("true", "1", "yes", "on"):
        return True
    return bool(fallback)

def _normalize_rng_seed(v, fallback=42):
    try:
        seed = int(v)
    except (TypeError, ValueError, OverflowError):
        seed = int(fallback)
    # NumPy requires [0, 2**32 - 1]. Use the same normalized value for
    # Python and Torch so one config seed drives all runtimes consistently.
    return seed % (2 ** 32)

def _resolve_optimizer_config(config):
    opt = config.get("optimizer", {})
    if isinstance(opt, str):
        opt = {"name": opt}
    elif not isinstance(opt, dict):
        opt = {}
    betas = opt.get("betas", []) if isinstance(opt, dict) else []
    return {
        "type": str(config.get("optimizerType", opt.get("name", "adam"))).strip().lower() or "adam",
        "beta1": min(0.999999, max(0.0, _cfg_float(config.get("optimizerBeta1", betas[0] if len(betas) > 0 else 0.9), 0.9))),
        "beta2": min(0.999999, max(0.0, _cfg_float(config.get("optimizerBeta2", betas[1] if len(betas) > 1 else 0.999), 0.999))),
        "momentum": max(0.0, _cfg_float(config.get("optimizerMomentum", opt.get("momentum", 0.0)), 0.0)),
        "rho": min(0.999999, max(0.0, _cfg_float(config.get("optimizerRho", opt.get("rho", 0.9)), 0.9))),
        "epsilon": max(1e-8, _cfg_float(config.get("optimizerEpsilon", opt.get("epsilon", 1e-7)), 1e-7)),
    }

def _resolve_restore_best_weights(config, head_configs):
    if isinstance(config.get("restoreBestWeights"), bool):
        return bool(config.get("restoreBestWeights"))
    weight_selection = str(config.get("weightSelection", "") or "").strip().lower()
    if weight_selection == "last":
        return False
    if weight_selection == "best":
        return True
    schedule = config.get("trainingSchedule")
    if isinstance(schedule, list) and len(schedule) > 0:
        return False
    if any(str((hc or {}).get("phase", "") or "").strip() for hc in (head_configs or [])):
        return False
    return True

def main():
    global _STOP_REQUESTED
    _STOP_REQUESTED = False
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
    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    # Seed every RNG that affects training (Python random, numpy, torch CPU,
    # torch CUDA). Without this, GAN-style runs land in different basins each
    # time and pretrained weights can't be regenerated reproducibly. Reads
    # config.seed (matching the dataset preset's seed convention) and falls
    # back to 42 when unspecified.
    _train_seed = _normalize_rng_seed(config.get("seed", 42), 42)
    import random as _py_random
    _py_random.seed(_train_seed)
    np.random.seed(_train_seed)
    torch.manual_seed(_train_seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed(_train_seed)
        torch.cuda.manual_seed_all(_train_seed)
    status(f"Seeded training RNGs with seed={_train_seed}")

    # --- Extract data ---
    status("Loading dataset into memory...")
    ds = resolve_dataset_payload(config.get("dataset", {}) or {})
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
    target_size = int(ds.get("targetSize", 0) or 0)
    if target_size <= 0:
        target_size = 1 if _is_all_cls else feature_size
    status(f"Data: {x_train.shape[0]} train, {x_val.shape[0]} val, features={feature_size}, targets={target_size}")

    # --- Build model from graph ---
    num_classes = ds.get("numClasses", 0)
    model = build_model_from_graph(graph, feature_size, target_size, num_classes)
    model = model.to(device)
    resumed_from_checkpoint = load_weights_into_model(model, config)
    param_count = sum(p.numel() for p in model.parameters())
    status(f"Model: {param_count} params")
    if resumed_from_checkpoint:
        status("Resuming training from checkpoint weights...")

    # --- Training config ---
    # Config can be at top level OR nested under "config" key.
    # Merge nested config into top level so downstream reads work uniformly.
    if isinstance(config.get("config"), dict):
        nested = config["config"]
        for k, v in nested.items():
            config.setdefault(k, v)
    epochs = int(config.get("epochs", 20))
    batch_size = int(config.get("batchSize", 32))
    lr = float(config.get("learningRate", 1e-3))
    optimizer_cfg = _resolve_optimizer_config(config)
    optimizer_type = optimizer_cfg["type"]
    patience = int(config.get("earlyStoppingPatience", 5))
    # disable early stopping when no val set (GAN etc.)
    if x_val.size == 0 and patience > 0 and config.get("earlyStoppingPatience") is None:
        patience = 0
    grad_clip = float(config.get("gradClipNorm", 0))

    # --- Optimizers ---
    # Match the client phased trainer: each schedule step keeps its own optimizer state.
    def _make_optimizer():
        if optimizer_type == "sgd":
            return torch.optim.SGD(model.parameters(), lr=lr, momentum=optimizer_cfg["momentum"])
        if optimizer_type == "rmsprop":
            return torch.optim.RMSprop(
                model.parameters(),
                lr=lr,
                alpha=optimizer_cfg["rho"],
                momentum=optimizer_cfg["momentum"],
                eps=optimizer_cfg["epsilon"],
            )
        return torch.optim.Adam(
            model.parameters(),
            lr=lr,
            betas=(optimizer_cfg["beta1"], optimizer_cfg["beta2"]),
            eps=optimizer_cfg["epsilon"],
        )

    optimizer = _make_optimizer()
    _step_optimizers = {"all": optimizer}

    def _get_optimizer(key):
        k = str(key or "all")
        if k not in _step_optimizers:
            opt = _make_optimizer()
            base_lr = optimizer.param_groups[0]["lr"]
            for pg in opt.param_groups:
                pg["lr"] = base_lr
            _step_optimizers[k] = opt
        return _step_optimizers[k]

    def _sync_optimizer_lrs():
        base_lr = optimizer.param_groups[0]["lr"]
        for opt in _step_optimizers.values():
            for pg in opt.param_groups:
                pg["lr"] = base_lr

    # LR scheduler from config (not hardcoded)
    lr_scheduler_type = str(config.get("lrSchedulerType", "plateau")).lower()
    lr_patience = int(config.get("lrPatience", 3))
    lr_factor = float(config.get("lrFactor", 0.5))
    lr_min = float(config.get("minLr", 1e-6))
    if lr_scheduler_type == "none":
        scheduler = None
    else:
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=lr_patience, factor=lr_factor, min_lr=lr_min, threshold=1e-3)

    # --- Determine loss + prepare labels ---
    # head_configs already extracted above from config
    is_classification = _is_all_cls
    # check if any head uses BCE (needs float labels, not int)
    _bce_aliases = {"bce", "binarycrossentropy", "binary_crossentropy"}
    _any_bce = any(str(hc.get("loss", "")).lower().replace("_", "").replace("-", "") in _bce_aliases or str(hc.get("loss", "")).lower() in _bce_aliases for hc in head_configs) if head_configs else False
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

    # --- Extract graph node data for class_embed detection ---
    graph_data = {}
    try:
        graph_data = graph.get("drawflow", {}).get("Home", {}).get("data", {})
    except Exception:
        pass

    # --- Detect class_embed nodes to include label data in DataLoader ---
    _has_class_embed = any(
        str(n.get("name", "")).replace("_layer", "") == "class_embed"
        for n in graph_data.values() if isinstance(n, dict)
    )
    _class_num = 10
    for n in graph_data.values():
        if isinstance(n, dict) and str(n.get("name", "")).replace("_layer", "") == "class_embed":
            _class_num = int((n.get("data") or {}).get("numClasses", 10))

    # --- Check if any head needs classification labels (evaluated after labels_train is set below) ---
    _any_cls_head = any(
        str((hc.get("loss") or hc.get("headType") or "")).lower()
        in ("categoricalcrossentropy", "categorical_crossentropy", "cross_entropy",
            "sparsecategoricalcrossentropy", "classification")
        for hc in (head_configs or [])
    )

    # (DataLoaders built after labels_train is loaded — see below)

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
        # latent_kl heads are auto-injected by model_builder_core.js for the
        # browser path (mu+logvar concat tensor with MSE-against-zero as KL
        # surrogate). On the server side, the PyTorch model only emits real
        # output_layer outputs — latent_kl is computed directly inside the
        # reparam node forward (see Kingma-Welling block above) and added to
        # `model._kl_total`. Including a latent_kl head here would dereference
        # a non-existent prediction (preds[i] falls back to preds[0] = recon)
        # and run MSE against the wrong target tensor → confusing shape
        # mismatches. Skip it explicitly.
        if htype == "latent_kl":
            head_losses.append({"fn": None, "weight": 0, "phase": hp, "cls": False, "skip": True})
            continue
        # explicit loss field takes priority
        if hl == "none":
            head_losses.append({"fn": None, "weight": 0, "phase": hp, "cls": False, "skip": True})
        elif hl in ("bce", "binarycrossentropy", "binary_crossentropy"):
            head_losses.append({"fn": nn.BCELoss(), "weight": hw, "phase": hp, "cls": False, "binary_target": True, "bce_binary": True})
        elif hl in ("wasserstein", "wgan"):
            # Wasserstein loss: -mean(truth * pred)
            head_losses.append({"fn": lambda p, t: -torch.mean(t * p), "weight": hw, "phase": hp, "cls": False, "binary_target": True})
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

    # --- Build canonical class-compaction LUTs from training labels ---
    # When the graph has class_embed nodes whose declared numClasses is smaller
    # than the labels' width (e.g. classFilter=[0,1,7] → 3 model classes vs
    # 10-wide one-hot), the class_embed forward needs a stable LUT to remap
    # original→compact IDs. Building this lazily inside the forward pass would
    # see only one batch's classes; later batches' unseen classes would then
    # silently clamp to compact 0 — corrupted conditioning. Pre-build here from
    # the FULL training labels (or classFilter) so every forward (train, val,
    # test, sampling) shares the same mapping.
    def _build_canonical_class_lut(label_arr, target_n, class_filter=None):
        if class_filter is not None and len(class_filter) > 0:
            uniq = sorted(int(c) for c in class_filter)
            unique_vals = torch.tensor(uniq, dtype=torch.long)
        elif label_arr is not None and len(label_arr) > 0:
            t = torch.tensor(label_arr, dtype=torch.float32)
            if t.ndim >= 2 and t.shape[-1] > 1:
                idx = t.argmax(dim=-1).long()
            else:
                idx = t.long().reshape(-1)
            if idx.numel() == 0:
                return None, 0
            unique_vals = torch.unique(idx).sort().values
        else:
            return None, 0
        if unique_vals.numel() > target_n:
            unique_vals = unique_vals[:target_n]
        max_orig = int(unique_vals.max().item()) + 1 if unique_vals.numel() else target_n
        lut = torch.full((max(max_orig, target_n),), -1, dtype=torch.long)
        for ci, cv in enumerate(unique_vals.tolist()):
            lut[int(cv)] = ci
        return lut, int(unique_vals.numel())

    if _has_class_embed and labels_train is not None and len(labels_train) > 0:
        if not hasattr(model, "_class_compact_luts"):
            model._class_compact_luts = {}
        _ds_class_filter = config.get("classFilter") or (ds.get("classFilter") if isinstance(ds, dict) else None)
        for _gid, _gnode in (graph.get("drawflow", {}).get("Home", {}).get("data", {}) or {}).items():
            if not isinstance(_gnode, dict): continue
            if str(_gnode.get("name", "")).replace("_layer", "") != "class_embed": continue
            _ndata = _gnode.get("data") or {}
            _nc = int(_ndata.get("numClasses", 10))
            _lut, _compact_count = _build_canonical_class_lut(labels_train, _nc, _ds_class_filter)
            if _lut is not None:
                _train_width = int(labels_train.shape[-1]) if hasattr(labels_train, "shape") and len(labels_train.shape) >= 2 else 0
                model._class_compact_luts[(str(_gid), int(_train_width))] = _lut
                print(f"[class_embed nid={_gid}] canonical LUT built from training labels: "
                      f"{_compact_count}/{_nc} compact slots filled")

    # --- Build DataLoaders (now that labels_train is available) ---
    _include_labels = (_has_class_embed or _any_cls_head) and labels_train is not None and len(labels_train) > 0
    if _include_labels:
        train_ds = TensorDataset(torch.tensor(x_train), torch.tensor(y_train), torch.tensor(labels_train))
        val_ds = TensorDataset(torch.tensor(x_val), torch.tensor(y_val),
                               torch.tensor(labels_val) if labels_val is not None else torch.zeros(len(x_val), _class_num))
    else:
        train_ds = TensorDataset(torch.tensor(x_train), torch.tensor(y_train))
        val_ds = TensorDataset(torch.tensor(x_val), torch.tensor(y_val))
    shuffle_train = bool(config.get("shuffleTrain", True))
    train_dl = DataLoader(train_ds, batch_size=batch_size, shuffle=shuffle_train)
    val_dl = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    n_heads = len(head_losses)

    def compute_loss(pred, xb, yb, active_phase, lb=None):
        """Compute weighted loss across heads. lb = label batch for classification heads."""
        total = torch.tensor(0.0, device=device)
        preds = pred if isinstance(pred, list) else [pred]
        for i, hl in enumerate(head_losses):
            if hl.get("skip"):
                continue  # loss=none, passthrough
            # with schedule: all losses active (weight freeze handles updates)
            # without schedule: filter by phase name
            if not _use_schedule and hl["phase"] != active_phase and hl["phase"] != "" and active_phase != "":
                continue
            # head_configs may include phantom heads (e.g. latent_kl auto-injected
            # by model_builder_core.js for the browser path) that don't correspond
            # to a real model output on the PyTorch side. Skip those — the falsy-
            # fallback `preds[0]` would otherwise reuse the recon tensor and
            # MSE-it against the wrong target shape.
            if i >= len(preds):
                continue
            # get this head's prediction (by index)
            head_pred = preds[i]
            # determine target for this head
            if hl.get("binary_target"):
                # Segmentation/mask heads: use real yb targets
                head_htype = str(head_configs[i].get("headType", "")) if i < len(head_configs) else ""
                head_target = str(head_configs[i].get("target", head_configs[i].get("targetType", ""))) if i < len(head_configs) else ""
                if head_htype == "segmentation" or head_target in ("mask", "segmentation_mask"):
                    target = yb
                else:
                    # GAN: use labels from graph (PhaseSwitch + ConcatBatch constructs them)
                    custom_labels = getattr(model, '_custom_labels', {})
                    oid = model.output_ids[i] if i < len(model.output_ids) else None
                    if oid and oid in custom_labels:
                        target = custom_labels[oid]
                        if target.shape[0] != head_pred.shape[0]:
                            target = target.expand_as(head_pred)
                    else:
                        target = torch.ones_like(head_pred)
            elif hl["cls"]:
                # Classification head: use label batch if available, else fall back to yb
                cls_src = lb if lb is not None else yb
                # Convert one-hot to integer indices if needed
                if cls_src.dim() > 1 and cls_src.shape[-1] > 1:
                    target = cls_src.argmax(dim=-1).long()
                else:
                    target = cls_src.long().squeeze(-1)
                total = total + hl["weight"] * hl["fn"](head_pred, target)
                continue
            else:
                # Reconstruction/autoencoder/denoiser heads use input (xb) as target
                head_htype2 = str(head_configs[i].get("headType", "")) if i < len(head_configs) else ""
                if head_htype2 in ("reconstruction", "autoencoder", "denoiser"):
                    target = xb
                else:
                    target = yb
            # match target shape to prediction shape
            if target.shape != head_pred.shape:
                if head_pred.shape[-1] == 1 and target.dim() > 1:
                    target = target[:, :1] if target.shape[-1] >= 1 else torch.ones_like(head_pred)
            # BCE requires both pred and target in [0,1]
            if hl.get("bce_binary"):
                target = target.float().clamp(0.0, 1.0)
                head_pred = head_pred.clamp(0.0, 1.0)
            total = total + hl["weight"] * hl["fn"](head_pred, target)
        return total

    # --- Training Schedule ---
    # Read schedule from config or build from phases
    raw_schedule = config.get("trainingSchedule", None)
    rotate_schedule = config.get("rotateSchedule", True)
    _use_schedule = raw_schedule is not None
    def _schedule_step_unit(step):
        unit = str((step or {}).get("unit", (step or {}).get("intervalUnit", "epoch"))).strip().lower()
        return "batch" if unit == "batch" else "epoch"

    def _schedule_step_count(step, unit):
        raw = None
        if step is not None:
            raw = step.get("count", step.get("repeat", None))
            if raw is None:
                raw = step.get("batches" if unit == "batch" else "epochs", 1)
        try:
            return max(1, int(raw))
        except Exception:
            return 1

    def _schedule_step_phase_name(step, idx):
        explicit = str((step or {}).get("_phase", "") or "").strip()
        if explicit:
            return explicit
        tags = (step or {}).get("trainableTags", None)
        if isinstance(tags, dict):
            enabled = [str(k).strip() for k, v in tags.items() if _cfg_bool(v, False) and str(k).strip()]
            if len(enabled) == 1:
                return enabled[0]
        return f"step{idx + 1}"

    if raw_schedule and isinstance(raw_schedule, list) and len(raw_schedule) > 0:
        schedule = raw_schedule
    else:
        schedule = [{"epochs": 1, "trainableTags": None, "_phase": p} for p in phases]
    schedule_uses_batch_unit = len(schedule) > 0 and all(_schedule_step_unit(step) == "batch" for step in schedule)

    # collect weight tags from graph nodes → map to model param names
    _gd = graph.get("drawflow", {}).get("Home", {}).get("data", graph)
    _node_tags = {}
    for nid in _gd:
        nd = _gd[nid] if isinstance(_gd[nid], dict) else {}
        tag = (nd.get("data") or {}).get("weightTag", "")
        if tag:
            _node_tags[nid] = tag

    weight_tags = {}
    for name, param in model.named_parameters():
        for nid, tag in _node_tags.items():
            if (
                f"_{nid}" in name or f".{nid}." in name or
                name.startswith(f"dense_{nid}") or
                name.startswith(f"conv2d_{nid}") or
                name.startswith(f"convt2d_{nid}") or
                name.startswith(f"embed_{nid}") or
                name.startswith(f"bn_{nid}") or
                name.startswith(f"ln_{nid}") or
                name.startswith(f"rnn_{nid}") or
                name.startswith(f"act_{nid}")
            ):
                weight_tags[name] = tag
                break

    module_tags = {}
    for name, module in model.named_modules():
        if not name:
            continue
        for nid, tag in _node_tags.items():
            if name.endswith(f"_{nid}"):
                module_tags[name] = tag
                break

    def freeze_by_tags(trainable_tags, phase_name=""):
        """Freeze/unfreeze params by weight tag"""
        if trainable_tags is None and not phase_name and not weight_tags:
            return
        for name, param in model.named_parameters():
            tag = weight_tags.get(name, "")
            if tag and trainable_tags is not None:
                param.requires_grad = bool(trainable_tags.get(tag, True))
            elif tag and phase_name:
                param.requires_grad = (tag == phase_name)
            else:
                param.requires_grad = True

    def apply_module_modes(trainable_tags=None, phase_name=""):
        """Frozen tagged modules run in eval mode so internal state stops updating."""
        if not module_tags:
            return
        for name, module in model.named_modules():
            if not name:
                continue
            tag = module_tags.get(name, "")
            if not tag:
                continue
            enabled = True
            if trainable_tags is not None:
                enabled = bool(trainable_tags.get(tag, True))
            elif phase_name:
                enabled = (tag == phase_name)
            module.train(enabled)

    def unfreeze_all():
        for param in model.parameters():
            param.requires_grad = True

    # --- Train ---
    best_val_loss = float("inf")
    best_epoch = 0
    best_state = None
    no_improve = 0
    schedule_done = False
    stopped_by_user = False

    for ep in range(1, epochs + 1):
        if _should_stop():
            stopped_by_user = True
            break
        phase_losses = {}

        if schedule_done:
            # no rotate: train all unfrozen
            unfreeze_all()
            model.train()
            train_loss = 0.0
            n_batches = 0
            opt_all = _get_optimizer("all")
            for _batch in train_dl:
                if _should_stop():
                    stopped_by_user = True
                    break
                xb, yb = _batch[0].to(device), _batch[1].to(device)
                lb = _batch[2].to(device) if len(_batch) > 2 else None
                if lb is not None:
                    model._class_labels = lb
                opt_all.zero_grad()
                # Reset VAE KL accumulator before forward; reparam nodes add to
                # it during forward for training and validation objective
                # evaluation. Non-VAE graphs leave it at 0.
                model._kl_total = torch.tensor(0.0, device=device)
                # #146 Codex round-7 P1: bind the batch target to the
                # model so target_source forward dispatch can read it.
                # Falls back to None on inference paths where yb is unset.
                model._runtime_target = yb if yb is not None else None
                pred = model(xb)
                loss = compute_loss(pred, xb, yb, "", lb=lb) + model._kl_total
                loss.backward()
                if grad_clip > 0:
                    torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
                opt_all.step()
                train_loss += loss.item()
                n_batches += 1
            if stopped_by_user and n_batches == 0:
                break
            phase_losses["all"] = train_loss / max(n_batches, 1)
        else:
            if schedule_uses_batch_unit:
                step_sums = {}
                step_counts = {}
                train_iter = iter(train_dl)
                n_total_batches = len(train_dl)
                batch_idx = 0
                schedule_idx = 0
                while batch_idx < n_total_batches and not _should_stop():
                    si = schedule_idx % len(schedule)
                    step = schedule[si]
                    repeat_batches = _schedule_step_count(step, "batch")
                    trainable_tags = step.get("trainableTags", None)
                    phase_name = _schedule_step_phase_name(step, si)
                    clip_val = float(step.get("clipWeights", 0))

                    freeze_by_tags(trainable_tags, phase_name)
                    model._phase_idx = si
                    model._phase_name = phase_name
                    model.train()
                    apply_module_modes(trainable_tags, phase_name)
                    step_opt = _get_optimizer(phase_name)

                    for _ in range(repeat_batches):
                        if batch_idx >= n_total_batches or _should_stop():
                            if _should_stop():
                                stopped_by_user = True
                            break
                        _batch2 = next(train_iter)
                        xb, yb = _batch2[0].to(device), _batch2[1].to(device)
                        lb = _batch2[2].to(device) if len(_batch2) > 2 else None
                        if lb is not None:
                            model._class_labels = lb
                        step_opt.zero_grad()
                        model._kl_total = torch.tensor(0.0, device=device)
                        model._runtime_target = yb if yb is not None else None
                        pred = model(xb)
                        loss = compute_loss(pred, xb, yb, phase_name, lb=lb) + model._kl_total
                        if loss.requires_grad:
                            loss.backward()
                            if grad_clip > 0:
                                torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
                            step_opt.step()
                            if clip_val > 0:
                                for p in model.parameters():
                                    if p.requires_grad:
                                        p.data.clamp_(-clip_val, clip_val)
                        step_sums[phase_name] = step_sums.get(phase_name, 0.0) + float(loss.item())
                        step_counts[phase_name] = step_counts.get(phase_name, 0) + 1
                        batch_idx += 1
                    if _should_stop():
                        stopped_by_user = True
                        break
                    schedule_idx += 1
                for phase_name, total in step_sums.items():
                    phase_losses[phase_name] = total / max(step_counts.get(phase_name, 1), 1)
            else:
                for si, step in enumerate(schedule):
                    if _should_stop():
                        stopped_by_user = True
                        break
                    step_epochs = _schedule_step_count(step, "epoch")
                    trainable_tags = step.get("trainableTags", None)
                    phase_name = _schedule_step_phase_name(step, si)

                    freeze_by_tags(trainable_tags, phase_name)
                    model._phase_idx = si  # legacy fallback for PhaseSwitch
                    model._phase_name = phase_name
                    model.train()
                    apply_module_modes(trainable_tags, phase_name)
                    step_opt = _get_optimizer(phase_name)
                    step_loss = 0.0
                    n_batches = 0
                    for _ in range(step_epochs):
                        if _should_stop():
                            stopped_by_user = True
                            break
                        for _batch3 in train_dl:
                            if _should_stop():
                                stopped_by_user = True
                                break
                            xb, yb = _batch3[0].to(device), _batch3[1].to(device)
                            lb = _batch3[2].to(device) if len(_batch3) > 2 else None
                            if lb is not None:
                                model._class_labels = lb
                            step_opt.zero_grad()
                            model._kl_total = torch.tensor(0.0, device=device)
                            model._runtime_target = yb if yb is not None else None
                            pred = model(xb)
                            loss = compute_loss(pred, xb, yb, phase_name, lb=lb) + model._kl_total
                            if loss.requires_grad:
                                loss.backward()
                                if grad_clip > 0:
                                    torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
                                step_opt.step()
                                # Weight clipping (WGAN): clip to [-c, c]
                                clip_val = float(step.get("clipWeights", 0))
                                if clip_val > 0:
                                    for p in model.parameters():
                                        if p.requires_grad:
                                            p.data.clamp_(-clip_val, clip_val)
                            step_loss += loss.item()
                            n_batches += 1
                        if stopped_by_user:
                            break
                    phase_losses[phase_name] = step_loss / max(n_batches, 1)
                    if stopped_by_user:
                        break

            if not rotate_schedule:
                schedule_done = True

        if not phase_losses and stopped_by_user:
            break
        # Match the client phased trainer: total epoch loss is the sum of
        # per-phase average losses, not the mean across phases.
        total_train_loss = sum(phase_losses.values())

        # Validate (skip if no val data)
        val_loss = None
        if not stopped_by_user and x_val.size > 0:
            model._phase_name = ""
            model.eval()
            model._accumulate_kl = True
            val_loss = 0.0
            n_val = 0
            with torch.no_grad():
                for _batchv in val_dl:
                    xb, yb = _batchv[0].to(device), _batchv[1].to(device)
                    lb = _batchv[2].to(device) if len(_batchv) > 2 else None
                    if lb is not None:
                        model._class_labels = lb
                    model._kl_total = torch.tensor(0.0, device=device)
                    model._runtime_target = yb if yb is not None else None
                    pred = model(xb)
                    loss = compute_loss(pred, xb, yb, "", lb=lb) + model._kl_total
                    val_loss += loss.item()
                    n_val += 1
            model._accumulate_kl = False
            val_loss /= max(n_val, 1)

        # use val_loss if available, else train loss for early stopping
        check_loss = val_loss if val_loss is not None else total_train_loss
        improved = check_loss < best_val_loss
        if improved:
            best_val_loss = check_loss
            best_epoch = ep
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            no_improve = 0
        else:
            no_improve += 1

        current_lr = optimizer.param_groups[0]["lr"]
        if scheduler is not None:
            scheduler.step(check_loss)
            _sync_optimizer_lrs()

        epoch_log(ep, total_train_loss, val_loss, current_lr, improved, phase_losses)

        if stopped_by_user:
            status(f"Training stop requested at epoch {ep}. Saving current weights...")
            break

        if patience > 0 and no_improve >= patience:
            status(f"Early stopping at epoch {ep} (patience={patience})")
            break

    # Restore best weights (from config — default true for supervised, false for GAN)
    restore_best = (not stopped_by_user) and _resolve_restore_best_weights(config, head_configs)
    if restore_best and best_state:
        model.load_state_dict(best_state)

    status("Training complete. Extracting weights...")
    # Use shared canonical checkpoint extraction (same path for server + notebook)
    weight_specs, weight_values = extract_pytorch_state(model.state_dict())

    status("Computing test metrics...")
    # --- Compute final metrics (val + test) ---
    model.eval()
    mae = 0.0; mse = 0.0
    # Determine if any output head is reconstruction-style (used for val + test
    # metric truth selection — see test-block below for the same pattern).
    _is_recon_head = any(
        str((hc or {}).get("headType", "")).lower() in ("reconstruction", "autoencoder", "denoiser")
        for hc in (head_configs or [])
    )

    with torch.no_grad():
        if x_val.size > 0:
            x_val_t = torch.tensor(x_val).to(device)
            raw_val = model(x_val_t)
            pred_val = (raw_val[0] if isinstance(raw_val, list) else raw_val).cpu().numpy()
            if is_classification:
                pred_labels = pred_val.argmax(axis=1)
                true_labels = y_val.flatten().astype(int)
                mae = float(np.mean(np.abs(pred_labels - true_labels)))
                mse = float(np.mean((pred_labels - true_labels) ** 2))
            else:
                # Reconstruction heads compare prediction against input (x), not labels (y)
                _truth_val = x_val if (_is_recon_head and pred_val.shape == x_val.shape) else y_val
                mae = float(np.mean(np.abs(pred_val - _truth_val)))
                mse = float(np.mean((pred_val - _truth_val) ** 2))

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
            # Reconstruction heads compare prediction against input (x), not
            # labels (y) — same logic as the val block above. _is_recon_head is
            # computed once above this `with torch.no_grad()`.
            truth_for_metrics = x_test if (_is_recon_head and pred_test.shape == x_test.shape) else y_test
            t_flat = truth_for_metrics.flatten()
            p_flat = pred_test.flatten()
            # Guard: when the model has multiple output heads (e.g. classifier
            # logits + auxiliary), pred_test.flatten() can differ in size from
            # y_test.flatten(). Skip element-wise regression metrics in that
            # case rather than crashing the whole retrain. testN is still
            # populated so downstream code knows the test split was evaluated.
            if p_flat.shape == t_flat.shape:
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
        "stoppedByUser": bool(stopped_by_user),
        "headCount": len(head_configs) or 1,
        "backend": str(device),
        "paramCount": len(weight_values),
        "modelArtifacts": normalize_artifacts(weight_specs, weight_values, producer_runtime="python_server", include_weight_data=True),
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

    def _normalize_init_name(raw_name, fallback="default"):
        fb = str(fallback or "default").strip().lower() or "default"
        v = str(raw_name or "").strip().lower().replace("_", "").replace("-", "").replace(" ", "")
        aliases = {
            "": fb,
            "default": "default",
            "auto": "default",
            "inherit": "default",
            "xavieruniform": "glorotuniform",
            "xaviernormal": "glorotnormal",
            "kaiminguniform": "heuniform",
            "kaimingnormal": "henormal",
            "normal": "randomnormal",
            "uniform": "randomuniform",
        }
        return aliases.get(v, v or fb)

    def _fan_in_out(tensor):
        shape = list(getattr(tensor, "shape", []) or [])
        if not shape:
            return 1, 1
        if len(shape) == 2:
            return max(1, int(shape[1])), max(1, int(shape[0]))
        if len(shape) > 2:
            receptive = 1
            for dim in shape[2:]:
                receptive *= max(1, int(dim))
            fan_in = max(1, int(shape[1]) * receptive)
            fan_out = max(1, int(shape[0]) * receptive)
            return fan_in, fan_out
        return max(1, int(shape[0])), max(1, int(shape[0]))

    def _apply_tensor_initializer(tensor, cfg, prefix, fallback="default"):
        if tensor is None:
            return
        init_name = _normalize_init_name(cfg.get(f"{prefix}Initializer"), fallback)
        mean = _cfg_float(cfg.get(f"{prefix}InitMean", 1.0 if prefix == "gamma" else 0.0), 1.0 if prefix == "gamma" else 0.0)
        std = max(1e-8, _cfg_float(cfg.get(f"{prefix}InitStddev", 0.05), 0.05))
        minv = _cfg_float(cfg.get(f"{prefix}InitMin", -0.05), -0.05)
        maxv = _cfg_float(cfg.get(f"{prefix}InitMax", 0.05), 0.05)
        value = _cfg_float(cfg.get(f"{prefix}InitValue", 1.0 if prefix == "movingVariance" else 0.0), 1.0 if prefix == "movingVariance" else 0.0)
        if init_name == "default":
            return
        with torch.no_grad():
            if init_name == "zeros":
                nn.init.zeros_(tensor); return
            if init_name == "ones":
                nn.init.ones_(tensor); return
            if init_name == "constant":
                nn.init.constant_(tensor, value); return
            if init_name == "randomnormal":
                nn.init.normal_(tensor, mean=mean, std=std); return
            if init_name == "randomuniform":
                nn.init.uniform_(tensor, a=minv, b=maxv); return
            if init_name == "glorotuniform":
                nn.init.xavier_uniform_(tensor); return
            if init_name == "glorotnormal":
                nn.init.xavier_normal_(tensor); return
            if init_name == "heuniform":
                nn.init.kaiming_uniform_(tensor, a=0.0, mode="fan_in", nonlinearity="relu"); return
            if init_name == "henormal":
                nn.init.kaiming_normal_(tensor, a=0.0, mode="fan_in", nonlinearity="relu"); return
            if init_name == "orthogonal":
                nn.init.orthogonal_(tensor); return
            fan_in, _ = _fan_in_out(tensor)
            if init_name == "lecununiform":
                bound = np.sqrt(3.0 / max(1.0, float(fan_in)))
                nn.init.uniform_(tensor, a=-bound, b=bound); return
            if init_name == "lecunnormal":
                nn.init.normal_(tensor, mean=0.0, std=np.sqrt(1.0 / max(1.0, float(fan_in)))); return

    def _apply_module_initializers(module, cfg, layer_type):
        if module is None or not isinstance(cfg, dict):
            return
        t = str(layer_type or "")
        # Match TF.js defaults when the graph leaves initializers unspecified.
        if t in ("dense", "conv1d", "conv2d", "conv2d_transpose"):
            _apply_tensor_initializer(getattr(module, "weight", None), cfg, "kernel", "glorotuniform")
            _apply_tensor_initializer(getattr(module, "bias", None), cfg, "bias", "zeros")
            return
        if t == "embedding":
            _apply_tensor_initializer(getattr(module, "weight", None), cfg, "kernel", "randomuniform")
            _apply_tensor_initializer(getattr(module, "bias", None), cfg, "bias", "zeros")
            return
        if t == "batchnorm":
            _apply_tensor_initializer(getattr(module, "weight", None), cfg, "gamma", "ones")
            _apply_tensor_initializer(getattr(module, "bias", None), cfg, "beta", "zeros")
            _apply_tensor_initializer(getattr(module, "running_mean", None), cfg, "movingMean", "zeros")
            _apply_tensor_initializer(getattr(module, "running_var", None), cfg, "movingVariance", "ones")
            return
        if t == "layernorm":
            _apply_tensor_initializer(getattr(module, "weight", None), cfg, "gamma", "ones")
            _apply_tensor_initializer(getattr(module, "bias", None), cfg, "beta", "zeros")
            return
        if t in ("lstm", "gru", "rnn"):
            for name, param in module.named_parameters():
                if name.startswith("weight_hh"):
                    _apply_tensor_initializer(param, cfg, "recurrent", "orthogonal")
                elif name.startswith("weight_ih") or name.startswith("weight"):
                    _apply_tensor_initializer(param, cfg, "kernel", "glorotuniform")
                elif name.startswith("bias"):
                    _apply_tensor_initializer(param, cfg, "bias", "zeros")

    def _normalize_node_type(raw_name):
        t = str(raw_name or "")
        if t.endswith("_layer"):
            t = t[:-6]
        if t.endswith("_block") and t not in ("transformer_block",):
            t = t[:-6]
        return t

    # Feature blocks are visual/declarative only — skip them
    _feature_block_types = {"window_hist", "hist", "params", "sliding_window", "window_hist_x", "window_hist_v", "time_sec", "time_norm", "sin_norm", "cos_norm", "onehot"}

    # Parse nodes + edges (skip feature blocks)
    nodes = {}
    edges_out = {}  # nid → [{ to, from_port, to_port }]
    edges_in = {}   # nid → [{ from, from_port, to_port }]
    for nid in sorted(raw.keys(), key=lambda k: int(k) if k.isdigit() else 0):
        n = raw[nid]
        t = _normalize_node_type(n.get("name", ""))
        # Skip feature blocks (visual/declarative only)
        if t in _feature_block_types:
            continue
        nodes[nid] = {"type": t, "config": n.get("data", {})}
        edges_out[nid] = []
        edges_in.setdefault(nid, [])
        for ok, ov in (n.get("outputs", {}) or {}).items():
            for conn in (ov or {}).get("connections", []):
                to_id = str(conn.get("node", ""))
                to_port = str(conn.get("input", "input_1"))
                # Skip connections from feature blocks
                target_name = _normalize_node_type((raw.get(to_id) or {}).get("name", ""))
                source_name = t
                if target_name in _feature_block_types or source_name in _feature_block_types:
                    continue
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
            # VAE KL accumulator. The reparam node (Kingma-Welling sampling)
            # accumulates the KL-divergence-to-N(0,1) term here during training
            # and validation-objective forward passes. The training loop resets
            # this to 0 before each batch and adds it to the loss after
            # compute_loss.
            # Stays 0 for non-VAE graphs.
            self._kl_total = torch.tensor(0.0)
            self._accumulate_kl = False

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
                    use_bias = _cfg_bool(c.get("useBias", True), True)
                    # auto-flatten spatial dims: [H,W,C] → H*W*C
                    flat_dim = in_dim if isinstance(in_dim, int) else int(in_dim[0]) * int(in_dim[1]) * int(in_dim[2]) if isinstance(in_dim, list) and len(in_dim) == 3 else int(in_dim[0]) if isinstance(in_dim, list) else in_dim
                    dense_mod = nn.Linear(flat_dim, units, bias=use_bias)
                    _apply_module_initializers(dense_mod, c, t)
                    setattr(self, f"dense_{nid}", dense_mod)
                    act = str(c.get("activation", "relu"))
                    if act == "relu": setattr(self, f"act_{nid}", nn.ReLU())
                    elif act == "tanh": setattr(self, f"act_{nid}", nn.Tanh())
                    elif act == "sigmoid": setattr(self, f"act_{nid}", nn.Sigmoid())
                    dim_map[nid] = units
                elif t in ("latent_mu", "latent_logvar", "latent"):
                    units = int(c.get("units", 8))
                    use_bias = _cfg_bool(c.get("useBias", True), True)
                    flat_dim = in_dim if isinstance(in_dim, int) else int(in_dim[0]) * int(in_dim[1]) * int(in_dim[2]) if isinstance(in_dim, list) and len(in_dim) == 3 else int(in_dim[0]) if isinstance(in_dim, list) else in_dim
                    latent_mod = nn.Linear(flat_dim, units, bias=use_bias)
                    _apply_module_initializers(latent_mod, c, "dense")
                    setattr(self, f"dense_{nid}", latent_mod)
                    dim_map[nid] = units
                elif t == "reparam":
                    # Proper Kingma-Welling reparameterization:
                    #   z = mu + exp(0.5 * logvar) * epsilon  where epsilon ~ N(0, 1)
                    # Previous version used a zero-init Linear projection of logvar
                    # which is NOT reparameterization (no random sampling, no
                    # stochasticity) — the encoder was always deterministic so
                    # the decoder couldn't generalize to random N(0,1) latents.
                    # The new TF.js side uses a custom ReparameterizeLayer; the
                    # PyTorch side does the same operation directly in forward
                    # without learnable parameters. No nn.Module to register.
                    dim_map[nid] = in_dim
                elif t in ("lstm", "gru", "rnn"):
                    units = int(c.get("units", 32))
                    use_bias = _cfg_bool(c.get("useBias", True), True)
                    rnn_cls = {"lstm": nn.LSTM, "gru": nn.GRU, "rnn": nn.RNN}[t]
                    rnn_mod = rnn_cls(
                        input_size=in_dim, hidden_size=units, num_layers=1, batch_first=True, bias=use_bias)
                    _apply_module_initializers(rnn_mod, c, t)
                    setattr(self, f"rnn_{nid}", rnn_mod)
                    dim_map[nid] = units
                elif t == "dropout":
                    setattr(self, f"drop_{nid}", nn.Dropout(float(c.get("rate", 0.1))))
                    dim_map[nid] = in_dim
                elif t == "relu":
                    setattr(self, f"relu_{nid}", nn.ReLU())
                    dim_map[nid] = in_dim
                elif t == "batchnorm":
                    # Use BatchNorm2d for spatial dims, BatchNorm1d for flat
                    tfjs_momentum = min(0.999999, max(0.0, _cfg_float(c.get("momentum", 0.99), 0.99)))
                    bn_eps = max(1e-6, _cfg_float(c.get("epsilon", 1e-3), 1e-3))
                    torch_momentum = min(0.999999, max(1e-6, 1.0 - tfjs_momentum))
                    if isinstance(in_dim, list) and len(in_dim) == 3:
                        bn_mod = nn.BatchNorm2d(in_dim[2], eps=bn_eps, momentum=torch_momentum)
                    else:
                        bn_mod = nn.BatchNorm1d(in_dim if isinstance(in_dim, int) else in_dim[0], eps=bn_eps, momentum=torch_momentum)
                    _apply_module_initializers(bn_mod, c, t)
                    setattr(self, f"bn_{nid}", bn_mod)
                    dim_map[nid] = in_dim
                elif t == "layernorm":
                    ln_dim = in_dim if isinstance(in_dim, int) else int(in_dim[-1])
                    ln_mod = nn.LayerNorm(ln_dim, eps=max(1e-6, _cfg_float(c.get("epsilon", 1e-3), 1e-3)))
                    _apply_module_initializers(ln_mod, c, t)
                    setattr(self, f"ln_{nid}", ln_mod)
                    dim_map[nid] = in_dim
                elif t == "relu":
                    setattr(self, f"relu_{nid}", nn.ReLU())
                    dim_map[nid] = in_dim
                elif t == "leaky_relu":
                    alpha = float(c.get("alpha", 0.2))
                    setattr(self, f"lrelu_{nid}", nn.LeakyReLU(alpha))
                    dim_map[nid] = in_dim
                elif t == "noise_injection":
                    # Gaussian noise (training only) — passthrough with same dim
                    scale = float(c.get("scale", 0.1))
                    setattr(self, f"noise_scale_{nid}", scale)
                    dim_map[nid] = in_dim
                elif t == "augment_image":
                    # Image augmentation (training only): config-driven
                    # geometric transform; identity at eval. Mirrors
                    # AugmentImageLayer in src/model_builder_core.js so
                    # browser-trained and server-trained models converge
                    # to the same training distribution.
                    transform = str(c.get("transform", "horizontal_flip")).lower()
                    p = c.get("probability", 0.5)
                    try:
                        p = float(p)
                    except (TypeError, ValueError):
                        # Unparseable → safely disable (0.0). Earlier code
                        # fell back to 0.5, which silently re-enabled
                        # augmentation for malformed configs and diverged
                        # from the JS side, which clamps the same way to 0.
                        p = 0.0
                    if not (p == p) or p < 0:  # NaN-safe
                        p = 0.0
                    if p > 1:
                        p = 1.0
                    layout = str(c.get("layout", "nhwc")).lower()
                    if layout not in ("nhwc", "nchw"):
                        layout = "nhwc"
                    setattr(self, f"aug_transform_{nid}", transform)
                    setattr(self, f"aug_probability_{nid}", p)
                    setattr(self, f"aug_seedlink_{nid}", str(c.get("seedLink", "")))
                    setattr(self, f"aug_layout_{nid}", layout)
                    dim_map[nid] = in_dim
                elif t == "augment_bbox":
                    # Paired bbox augment — reads coin from seedLink
                    # registry (populated by upstream augment_image).
                    # Mirrors x0/x1 (hflip) or y0/y1 (vflip) using
                    # configured imageWidth / imageHeight. Eval mode is
                    # identity passthrough.
                    transform = str(c.get("transform", "horizontal_flip")).lower()
                    p = c.get("probability", 0.5)
                    try:
                        p = float(p)
                    except (TypeError, ValueError):
                        p = 0.0
                    if not (p == p) or p < 0:
                        p = 0.0
                    if p > 1:
                        p = 1.0
                    setattr(self, f"aug_transform_{nid}", transform)
                    setattr(self, f"aug_probability_{nid}", p)
                    setattr(self, f"aug_seedlink_{nid}", str(c.get("seedLink", "")))
                    setattr(self, f"aug_imgw_{nid}", float(c.get("imageWidth", 1)))
                    setattr(self, f"aug_imgh_{nid}", float(c.get("imageHeight", 1)))
                    fmt = str(c.get("format", "x0y0x1y1")).lower()
                    if fmt not in ("x0y0x1y1", "xywh"):
                        fmt = "x0y0x1y1"
                    setattr(self, f"aug_format_{nid}", fmt)
                    setattr(self, f"aug_node_kind_{nid}", "bbox")
                    dim_map[nid] = in_dim
                elif t == "augment_mask":
                    transform = str(c.get("transform", "horizontal_flip")).lower()
                    p = c.get("probability", 0.5)
                    try:
                        p = float(p)
                    except (TypeError, ValueError):
                        p = 0.0
                    if not (p == p) or p < 0:
                        p = 0.0
                    if p > 1:
                        p = 1.0
                    layout = str(c.get("layout", "nhwc")).lower()
                    if layout not in ("nhwc", "nchw"):
                        layout = "nhwc"
                    setattr(self, f"aug_transform_{nid}", transform)
                    setattr(self, f"aug_probability_{nid}", p)
                    setattr(self, f"aug_seedlink_{nid}", str(c.get("seedLink", "")))
                    setattr(self, f"aug_layout_{nid}", layout)
                    setattr(self, f"aug_node_kind_{nid}", "mask")
                    dim_map[nid] = in_dim
                elif t == "augment_label":
                    # Pure passthrough — class labels are flip-invariant
                    # in this codebase's tasks.
                    setattr(self, f"aug_seedlink_{nid}", str(c.get("seedLink", "")))
                    setattr(self, f"aug_node_kind_{nid}", "label")
                    dim_map[nid] = in_dim
                elif t == "patch_embed":
                    ps = int(c.get("patchSize", 7))
                    ed = int(c.get("embedDim", 64))
                    flat_dim = int(in_dim if isinstance(in_dim, int) else np.prod(in_dim))
                    img_size = int(round(flat_dim ** 0.5))
                    if img_size <= 0 or img_size * img_size != flat_dim:
                        raise ValueError(f"PatchEmbed expects square flattened image input, got featureSize={flat_dim}")
                    num_patches = (img_size // ps) ** 2
                    use_bias = _cfg_bool(c.get("useBias", True), True)
                    pe_proj = nn.Conv2d(1, ed, kernel_size=ps, stride=ps, padding=0, bias=use_bias)
                    _apply_module_initializers(pe_proj, c, "conv2d")
                    setattr(self, f"pe_proj_{nid}", pe_proj)
                    setattr(self, f"pe_num_patches_{nid}", num_patches)
                    setattr(self, f"pe_img_size_{nid}", img_size)
                    setattr(self, f"pe_embed_dim_{nid}", ed)
                    dim_map[nid] = [num_patches, ed]
                elif t == "transformer_block":
                    embed_dim = int(in_dim[-1] if isinstance(in_dim, list) else in_dim)
                    ffn = int(c.get("ffnDim", 128))
                    drop = float(c.get("dropout", 0.1))
                    ln_eps = max(1e-6, _cfg_float(c.get("epsilon", 1e-3), 1e-3))
                    ln1 = nn.LayerNorm(embed_dim, eps=ln_eps)
                    ln2 = nn.LayerNorm(embed_dim, eps=ln_eps)
                    q = nn.Linear(embed_dim, embed_dim, bias=True)
                    k = nn.Linear(embed_dim, embed_dim, bias=True)
                    v = nn.Linear(embed_dim, embed_dim, bias=True)
                    attn_proj = nn.Linear(embed_dim * 3, embed_dim, bias=True)
                    ffn1 = nn.Linear(embed_dim, ffn, bias=True)
                    ffn2 = nn.Linear(ffn, embed_dim, bias=True)
                    for mod, kind in ((ln1, "layernorm"), (ln2, "layernorm")):
                        _apply_module_initializers(mod, c, kind)
                    for mod in (q, k, v, attn_proj, ffn1, ffn2):
                        _apply_module_initializers(mod, c, "dense")
                    setattr(self, f"tb_ln1_{nid}", ln1)
                    setattr(self, f"tb_q_{nid}", q)
                    setattr(self, f"tb_k_{nid}", k)
                    setattr(self, f"tb_v_{nid}", v)
                    setattr(self, f"tb_attn_proj_{nid}", attn_proj)
                    setattr(self, f"tb_attn_drop_{nid}", nn.Dropout(drop))
                    setattr(self, f"tb_ln2_{nid}", ln2)
                    setattr(self, f"tb_ffn1_{nid}", ffn1)
                    setattr(self, f"tb_ffn_drop_{nid}", nn.Dropout(drop))
                    setattr(self, f"tb_ffn2_{nid}", ffn2)
                    dim_map[nid] = list(in_dim) if isinstance(in_dim, list) else in_dim
                elif t == "global_avg_pool1d":
                    dim_map[nid] = int(in_dim[-1]) if isinstance(in_dim, list) else in_dim
                elif t == "global_avg_pool2d":
                    dim_map[nid] = int(in_dim[-1]) if isinstance(in_dim, list) else in_dim
                elif t == "detach":
                    dim_map[nid] = in_dim
                elif t == "concat_batch":
                    # concat along batch axis: feature dim stays same
                    dim_map[nid] = in_dim
                elif t == "concat":
                    # concat along feature/channel axis
                    parent_dims = [dim_map.get(p["from"], in_dim) for p in parents if p["from"] in dim_map]
                    if parent_dims and all(isinstance(d, list) and len(d) == 3 for d in parent_dims):
                        # spatial: [H, W, C] — sum channels, keep H/W from first parent
                        total_c = sum(d[2] for d in parent_dims)
                        dim_map[nid] = [parent_dims[0][0], parent_dims[0][1], total_c]
                    else:
                        # flat: sum scalar dims
                        total_dim = sum(d if isinstance(d, (int, float)) else (d[0] * d[1] * d[2] if isinstance(d, list) and len(d) == 3 else 0) for d in parent_dims)
                        dim_map[nid] = total_dim if total_dim > 0 else in_dim
                elif t == "phase_switch":
                    dim_map[nid] = in_dim
                elif t == "constant":
                    cdim = int(c.get("dim", 1))
                    dim_map[nid] = cdim
                elif t == "sample_z":
                    # random input — like another input node
                    zdim = int(c.get("dim", 128))
                    dim_map[nid] = zdim
                elif t == "time_embed":
                    tdim = int(c.get("dim", 64))
                    dim_map[nid] = max(1, tdim)
                elif t == "class_embed":
                    nclasses = int(c.get("numClasses", 10))
                    dim_map[nid] = max(2, nclasses)
                elif t == "image_source":
                    # image input — like input node
                    dim_map[nid] = int(c.get("featureSize", feature_size))
                elif t == "embedding":
                    vocab_size = int(c.get("inputDim", 10000))
                    embed_dim = int(c.get("outputDim", 256))
                    emb_mod = nn.Embedding(vocab_size, embed_dim)
                    _apply_module_initializers(emb_mod, c, t)
                    setattr(self, f"embed_{nid}", emb_mod)
                    dim_map[nid] = embed_dim
                elif t == "reshape":
                    shape_str = str(c.get("targetShape", "28,28,1"))
                    shape = [max(1, int(s.strip())) for s in shape_str.split(",")]
                    self._reshape_shapes = getattr(self, '_reshape_shapes', {})
                    self._reshape_shapes[nid] = shape
                    # For conv layers: track as list. For sequence [seq, dim]: track last dim as int.
                    dim_map[nid] = shape[-1] if len(shape) == 2 else shape
                elif t == "conv2d":
                    filters = int(c.get("filters", 32))
                    ks = int(c.get("kernelSize", 3))
                    st = int(c.get("strides", 1))
                    pad_mode = str(c.get("padding", "same"))
                    use_bias = _cfg_bool(c.get("useBias", True), True)
                    # BUG-38 part B: TF.js conv2d(padding="same") uses
                    # ASYMMETRIC padding when stride > 1 — pad_top + pad_bottom
                    # are unequal so output starts at input[0,0] not input[-1,-1].
                    # PyTorch nn.Conv2d.padding accepts only a single SYMMETRIC
                    # value; for stride=1 with odd kernels they coincide
                    # (pad=(k-1)//2 on both sides), but for stride=2 they don't.
                    # Numerical evidence: 4x4 input, k=3, s=2 →
                    #   PyTorch nn.Conv2d(pad=1)        : output (2,2) = [11.1, 21.7; 36.3, 57.3]
                    #   TF.js conv2d(padding="same")   : output (2,2) = [34.8, 25.2; 27.4, 17.5]
                    # → max abs diff 39.8.
                    # Fix: use F.pad asymmetrically before a pad=0 conv to match
                    # TF.js exactly. Compute output size = ceil(in / stride),
                    # total pad = (out-1)*stride + k - in, split as
                    # pad_top = total // 2, pad_bottom = total - pad_top.
                    pad = 0  # we apply explicit pad in forward
                    in_ch = in_dim[-1] if isinstance(in_dim, list) else 1
                    conv_mod = nn.Conv2d(in_ch, filters, ks, st, pad, bias=use_bias)
                    _apply_module_initializers(conv_mod, c, t)
                    setattr(self, f"conv2d_{nid}", conv_mod)
                    if pad_mode == "same" and isinstance(in_dim, list):
                        self._conv2d_pad = getattr(self, "_conv2d_pad", {})
                        h, w = in_dim[0], in_dim[1]
                        out_h = -(-h // st)
                        out_w = -(-w // st)
                        ph_total = max(0, (out_h - 1) * st + ks - h)
                        pw_total = max(0, (out_w - 1) * st + ks - w)
                        ph_top = ph_total // 2
                        ph_bot = ph_total - ph_top
                        pw_left = pw_total // 2
                        pw_right = pw_total - pw_left
                        # F.pad arg is (left, right, top, bottom)
                        self._conv2d_pad[nid] = (pw_left, pw_right, ph_top, ph_bot)
                    act = str(c.get("activation", "relu"))
                    if act == "relu": setattr(self, f"act_{nid}", nn.ReLU())
                    elif act == "tanh": setattr(self, f"act_{nid}", nn.Tanh())
                    elif act == "sigmoid": setattr(self, f"act_{nid}", nn.Sigmoid())
                    if isinstance(in_dim, list):
                        h, w = in_dim[0], in_dim[1]
                        if pad_mode == "same": dim_map[nid] = [-(-h // st), -(-w // st), filters]
                        else: dim_map[nid] = [(h - ks) // st + 1, (w - ks) // st + 1, filters]
                    else:
                        dim_map[nid] = [1, 1, filters]
                elif t == "conv2d_transpose":
                    filters = int(c.get("filters", 32))
                    ks = int(c.get("kernelSize", 3))
                    st = int(c.get("strides", 2))
                    pad_mode = str(c.get("padding", "same"))
                    use_bias = _cfg_bool(c.get("useBias", True), True)
                    # Match TF.js conv2dTranspose "same" by running the full transposed conv
                    # and cropping the extra bottom/right border down to input * stride.
                    # See BUG-38 analysis in src/model_builder_core.js — the TF.js side
                    # also uses pad=valid + top-left crop (not native "same") so train
                    # and inference now follow the same convention end-to-end.
                    pad = 0
                    out_pad = 0
                    in_ch = in_dim[-1] if isinstance(in_dim, list) else 1
                    convt_mod = nn.ConvTranspose2d(in_ch, filters, ks, st, pad, out_pad, bias=use_bias)
                    _apply_module_initializers(convt_mod, c, t)
                    setattr(self, f"convt2d_{nid}", convt_mod)
                    if pad_mode == "same" and isinstance(in_dim, list):
                        self._convt_crop = getattr(self, "_convt_crop", {})
                        crop_y = max(0, (ks - st) // 2)
                        crop_x = max(0, (ks - st) // 2)
                        self._convt_crop[nid] = [crop_y, crop_x, in_dim[0] * st, in_dim[1] * st]
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
                    target_key = str(c.get("targetType", c.get("target", ""))).strip().lower()
                    htype = str(c.get("headType", "regression")).lower()
                    oloss = str(c.get("loss", "mse")).lower()
                    out_in = in_dim if isinstance(in_dim, int) else (in_dim[-1] if isinstance(in_dim, list) else in_dim)
                    node_units = int(c.get("units", c.get("unitsHint", 0)) or 0)
                    if node_units > 0:
                        odim = node_units
                    elif oloss in ("bce", "binarycrossentropy", "binary_crossentropy"):
                        # Segmentation masks: output full target_size, not 1
                        odim = target_size if (htype == "segmentation" or target_key in ("mask", "segmentation_mask")) else 1
                    elif target_key in ("custom", "none", "") and out_in:
                        odim = out_in
                    elif htype == "classification" and num_classes > 0 and target_key in ("label", "logits"):
                        odim = num_classes
                    elif htype in ("reconstruction", "autoencoder", "denoiser") or target_key == "pixel_values":
                        # Reconstruction heads output an image-shaped tensor matching
                        # the input feature dim, not the label dim. Without this
                        # branch the fallback `odim = target_size` would shrink the
                        # output to label dim (10 for Fashion-MNIST classification
                        # datasets), and any upstream Dense(units=784, sigmoid)
                        # would be replaced by a Linear(784→10) projection on the
                        # PyTorch side — making MSE-against-image impossible.
                        odim = out_in if isinstance(out_in, int) and out_in > 0 else feature_size
                    else:
                        odim = target_size
                    # skip linear projection if input dim already matches output dim
                    if out_in == odim:
                        setattr(self, f"out_{nid}", nn.Identity())
                    else:
                        out_mod = nn.Linear(out_in, odim, bias=_cfg_bool(c.get("useBias", True), True))
                        _apply_module_initializers(out_mod, c, "dense")
                        setattr(self, f"out_{nid}", out_mod)
                    dim_map[nid] = odim
                    self.output_ids.append(nid)
                else:
                    dim_map[nid] = in_dim

        def forward(self, x):
            def _make_time_embedding(tensor, dim):
                d = max(1, int(dim or 1))
                if d == 1:
                    return tensor
                half = max(1, d // 2)
                if half == 1:
                    freqs = torch.ones((1, 1), device=tensor.device, dtype=tensor.dtype)
                else:
                    idx = torch.arange(half, device=tensor.device, dtype=tensor.dtype)
                    freqs = torch.exp(-math.log(10000.0) * idx / max(1, half - 1)).view(1, half)
                angles = tensor * freqs
                emb = torch.cat([torch.sin(angles), torch.cos(angles)], dim=1)
                if emb.shape[1] == d:
                    return emb
                if emb.shape[1] > d:
                    return emb[:, :d]
                pad = torch.zeros((emb.shape[0], d - emb.shape[1]), device=tensor.device, dtype=tensor.dtype)
                return torch.cat([emb, pad], dim=1)

            def _flatten_tf_layout(tensor):
                if tensor.dim() == 4:
                    return tensor.permute(0, 2, 3, 1).contiguous().view(tensor.shape[0], -1)
                if tensor.dim() > 2:
                    return tensor.contiguous().view(tensor.shape[0], -1)
                return tensor

            tensors = {}
            runtime_time = None
            # Reset the augmentation seedLink registry at the start of
            # every forward so paired bbox/mask layers can never read a
            # coin from a previous batch (Codex PR #72 round-1/2/3 P1:
            # "Reset seedLink coin registry at each forward start").
            # The per-passthrough-path clears in augment_image already
            # cover the common case, but explicit forward-start reset
            # makes the freshness guarantee unconditional regardless of
            # graph topology (e.g. graph that has paired bbox without
            # any matching upstream image augment).
            self._aug_seed_registry = {}
            for nid in self.topo:
                t = self.node_types[nid]
                parents = self._edges_in.get(nid, [])
                parents_sorted = sorted(parents, key=lambda p: p["to_port"])

                if t == "input":
                    tensors[nid] = x
                    continue
                if t == "target_source":
                    # #146 Codex round-6 P1: feed the dataset target
                    # tensor (self._runtime_target) as graph data so
                    # paired augment_bbox/mask/label downstream can
                    # transform it. If unset (e.g. inference path),
                    # falls through to feature input as a safe default
                    # (won't flip if bbox layer's shape guard rejects).
                    if hasattr(self, "_runtime_target") and self._runtime_target is not None:
                        tensors[nid] = self._runtime_target
                    else:
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
                if t == "time_embed":
                    tdim = int(self.node_configs[nid].get("dim", 64))
                    if hasattr(self, "_runtime_time") and self._runtime_time is not None:
                        runtime_time = self._runtime_time
                    if runtime_time is None:
                        runtime_time = torch.rand(x.shape[0], 1, device=x.device, dtype=x.dtype)
                    tensors[nid] = _make_time_embedding(runtime_time, tdim)
                    continue
                if t == "class_embed":
                    # one-hot class label: prefer model._class_labels (set by the
                    # cell-template / data loader). Robust to two common drifts:
                    #   (a) BUG-32 width: labels were left at dataset width when the
                    #       model declares a smaller numClasses (compactified subset).
                    #       Remap to compact one-hot at the model's nclasses.
                    #   (b) BUG-34 batch: stale labels from the last training batch
                    #       leak into a sampling cell's forward. If labels carry
                    #       batch==1, broadcast; otherwise fall back to random
                    #       per-batch labels so sampling cells never crash on a
                    #       torch.cat batch-dim mismatch.
                    # Stability contract (Codex P1):
                    #   The original→compact LUT must be FIT FROM A CANONICAL
                    #   SOURCE (cell-template stashes it on model._class_compact_luts
                    #   built from training labels / classFilter). Per-batch lazy
                    #   build is incorrect because batch 1 doesn't observe all
                    #   training classes; later batches' classes would silently
                    #   map to compact 0 via a clamp_min. Here we ONLY use the
                    #   pre-stashed LUT; if missing, we report and fall back to
                    #   random per-batch labels rather than building a broken LUT.
                    nclasses = int(self.node_configs[nid].get("numClasses", 10))
                    cl = getattr(self, "_class_labels", None)
                    batch_n = x.shape[0]
                    lut_cache = getattr(self, "_class_compact_luts", None) or {}

                    def _looked_up_lut(dataset_width):
                        return lut_cache.get((str(nid), int(dataset_width)))

                    def _compact_to_nclasses(t):
                        if t.dim() < 2 or t.shape[-1] == nclasses:
                            return t
                        idx = t.argmax(dim=-1) if t.shape[-1] > 1 else t.long().squeeze(-1)
                        if idx.numel() == 0:
                            return torch.zeros(0, nclasses, device=t.device)
                        lut = _looked_up_lut(int(t.shape[-1]))
                        if lut is None:
                            # No canonical LUT was provided. Building one here from
                            # the current idx alone would corrupt later batches,
                            # so report once and fall back to random labels.
                            if not getattr(self, "_class_lut_warned", False):
                                self._class_lut_warned = True
                                print(f"[class_embed nid={nid}] no canonical LUT on model; "
                                      f"falling back to random labels. Cell-template should "
                                      f"build _class_compact_luts from training labels.",
                                      file=sys.stderr)
                            rand_cls = torch.randint(0, nclasses, (idx.shape[0],), device=t.device)
                            return torch.nn.functional.one_hot(rand_cls, nclasses).float()
                        # Move LUT to idx device if needed
                        if lut.device != idx.device:
                            lut = lut.to(idx.device)
                        # Extend if idx exceeds LUT range — extension positions stay -1
                        max_idx = int(idx.max().item())
                        if max_idx >= lut.shape[0]:
                            new_lut = torch.full((max_idx + 1,), -1, dtype=torch.long, device=lut.device)
                            new_lut[: lut.shape[0]] = lut
                            lut = new_lut
                        raw = lut[idx]
                        unseen = (raw == -1)
                        if unseen.any():
                            # Surface the breadcrumb instead of silently clamping —
                            # operator can widen classFilter or clean the dataset.
                            unseen_origs = sorted(set(idx[unseen].tolist()))
                            print(f"[class_embed nid={nid}] {int(unseen.sum().item())} samples "
                                  f"reference classes {unseen_origs} not in training/filter set; "
                                  f"mapping to compact 0 as fallback.",
                                  file=sys.stderr)
                        compact = raw.clamp_min(0)
                        return torch.nn.functional.one_hot(compact, nclasses).float()

                    if cl is not None and cl.shape[0] == batch_n:
                        tensors[nid] = _compact_to_nclasses(cl)
                    elif cl is not None and cl.shape[0] == 1 and cl.dim() >= 2:
                        # single class label — compact + broadcast across the batch
                        compact = _compact_to_nclasses(cl)
                        if compact.shape[0] == 0:
                            rand_cls = torch.randint(0, nclasses, (batch_n,), device=x.device)
                            tensors[nid] = torch.nn.functional.one_hot(rand_cls, nclasses).float()
                        else:
                            tensors[nid] = compact.expand(batch_n, -1).contiguous()
                    else:
                        # no labels or batch mismatch beyond broadcasting — random per-batch
                        rand_cls = torch.randint(0, nclasses, (batch_n,), device=x.device)
                        tensors[nid] = torch.nn.functional.one_hot(rand_cls, nclasses).float()
                    continue

                # get input tensor (first parent)
                inp = tensors[parents_sorted[0]["from"]] if parents_sorted else x

                if t == "dense" or t in ("latent_mu", "latent_logvar", "latent"):
                    # auto-flatten 4D conv output (NCHW → flat), but NOT 3D sequence
                    if inp.dim() == 4:
                        inp = _flatten_tf_layout(inp)
                    out = getattr(self, f"dense_{nid}")(inp)
                    act = getattr(self, f"act_{nid}", None)
                    if act is not None:
                        out = act(out)
                    tensors[nid] = out
                elif t == "reparam":
                    # Kingma-Welling: z = mu + exp(0.5 * logvar) * epsilon
                    # input_1 = mu (first parent), input_2 = logvar (second parent)
                    mu_tensor = inp  # first parent
                    logvar_tensor = tensors[parents_sorted[1]["from"]] if len(parents_sorted) > 1 else inp
                    # clip logvar so exp(0.5*logvar) stays numerically stable
                    logvar_clipped = torch.clamp(logvar_tensor, min=-10.0, max=10.0)
                    std = torch.exp(0.5 * logvar_clipped)
                    should_accumulate_kl = self.training or bool(getattr(self, "_accumulate_kl", False))
                    if self.training:
                        eps = torch.randn_like(mu_tensor)
                    else:
                        # Deterministic at inference/validation — encoder sees
                        # mu, decoder sees mu. Validation can still accumulate
                        # KL via _accumulate_kl so checkpoint selection uses the
                        # same objective as training without injecting noise.
                        eps = torch.zeros_like(mu_tensor)
                    if should_accumulate_kl:
                        # Accumulate KL divergence to standard normal prior:
                        #   KL(q(z|x) || N(0,1)) = -0.5 * sum(1 + logvar - mu^2 - exp(logvar))
                        # Without this regularizer, logvar collapses to a very
                        # negative value (deterministic encoder) and the
                        # decoder doesn't generalize to random N(0,1) latents,
                        # which is exactly what makes "VAE Random Sampling"
                        # produce noise. beta is read from the reparam node
                        # config (preset.js sets beta: 0.001 by default).
                        try:
                            beta = float(self.node_configs[nid].get("beta", 0.001))
                        except (TypeError, ValueError):
                            beta = 0.001
                        kl_per_sample = -0.5 * torch.sum(
                            1.0 + logvar_clipped - mu_tensor.pow(2) - logvar_clipped.exp(),
                            dim=tuple(range(1, mu_tensor.dim()))
                        )
                        kl_term = beta * kl_per_sample.mean()
                        # _kl_total is reset to 0 at the start of each forward
                        # call by the training loop (see compute_loss caller).
                        self._kl_total = self._kl_total + kl_term
                    tensors[nid] = mu_tensor + std * eps
                elif t in ("lstm", "gru", "rnn"):
                    rnn = getattr(self, f"rnn_{nid}")
                    h = inp
                    if h.dim() == 2:
                        h = h.unsqueeze(1)
                    out, _ = rnn(h)
                    tensors[nid] = out[:, -1, :]
                elif t == "dropout":
                    tensors[nid] = getattr(self, f"drop_{nid}")(inp)
                elif t == "relu":
                    tensors[nid] = getattr(self, f"relu_{nid}")(inp)
                elif t == "batchnorm":
                    tensors[nid] = getattr(self, f"bn_{nid}")(inp)
                elif t == "layernorm":
                    if inp.dim() == 4:
                        nhwc = inp.permute(0, 2, 3, 1).contiguous()
                        ln_out = getattr(self, f"ln_{nid}")(nhwc)
                        tensors[nid] = ln_out.permute(0, 3, 1, 2).contiguous()
                    else:
                        tensors[nid] = getattr(self, f"ln_{nid}")(inp)
                elif t == "relu":
                    tensors[nid] = getattr(self, f"relu_{nid}")(inp)
                elif t == "leaky_relu":
                    tensors[nid] = getattr(self, f"lrelu_{nid}")(inp)
                elif t == "noise_injection":
                    scale = getattr(self, f"noise_scale_{nid}", 0.1)
                    if self.training:
                        tensors[nid] = inp + torch.randn_like(inp) * scale
                    else:
                        tensors[nid] = inp
                elif t == "augment_image":
                    # Initialize per-instance coin registry. Codex round-1
                    # P1 fix: explicitly clear stale entries on passthrough
                    # paths so paired layers fall back to own RNG instead
                    # of reading a coin from a previous batch.
                    if not hasattr(self, "_aug_seed_registry"):
                        self._aug_seed_registry = {}
                    transform = getattr(self, f"aug_transform_{nid}", "horizontal_flip")
                    prob = float(getattr(self, f"aug_probability_{nid}", 0.5))
                    seedlink = getattr(self, f"aug_seedlink_{nid}", "")
                    # Eval mode: identity passthrough.
                    if not self.training:
                        if seedlink and seedlink in self._aug_seed_registry:
                            del self._aug_seed_registry[seedlink]
                        tensors[nid] = inp
                        continue
                    if transform == "identity" or prob <= 0.0 or inp.dim() != 4:
                        # Identity transform, p=0, or non-4D input → passthrough.
                        # Clear any prior coin so paired readers fall back.
                        if seedlink and seedlink in self._aug_seed_registry:
                            del self._aug_seed_registry[seedlink]
                        tensors[nid] = inp
                    elif transform in ("horizontal_flip", "vertical_flip"):
                        # Whole-batch coin flip at the configured probability,
                        # matching AugmentImageLayer (Keras RandomFlip
                        # semantics).
                        #
                        # Layout is read from explicit config. Codex
                        # round-1 P1 flagged that the server's "reshape"
                        # block permutes NHWC→NCHW (line ~1974), so the
                        # typical `reshape → augment_image` graph carries
                        # NCHW tensors here even though the palette
                        # default is nhwc. We auto-detect this specific
                        # mismatch (config=nhwc but shape[1] is small
                        # like a channel count and shape[-1] is large
                        # like H/W) and override to nchw with a stderr
                        # warning so the user notices.
                        layout = getattr(self, f"aug_layout_{nid}", "nhwc")
                        if layout == "nhwc" and inp.dim() == 4:
                            ch_axis_1 = inp.shape[1]
                            last_axis = inp.shape[-1]
                            # NCHW signature: small channel count at
                            # axis 1, large H/W at axis -1. Codex
                            # round-3 P1: lowered threshold from > 8
                            # to > 4 so legitimate small images (8x8
                            # CIFAR patches, etc.) trigger the override
                            # too. Channel counts are typically 1-4
                            # so > 4 is sufficient to distinguish.
                            if ch_axis_1 in (1, 2, 3, 4) and last_axis > 4:
                                if not getattr(self, f"_aug_layout_warned_{nid}", False):
                                    sys.stderr.write(
                                        f"[augment_image] node {nid}: layout=nhwc "
                                        f"but input shape {tuple(inp.shape)} looks NCHW; "
                                        f"auto-overriding to nchw. Set layout='nchw' explicitly "
                                        f"to silence this warning.\n"
                                    )
                                    setattr(self, f"_aug_layout_warned_{nid}", True)
                                layout = "nchw"
                        if layout == "nchw":
                            flip_axis = -1 if transform == "horizontal_flip" else -2
                        else:
                            flip_axis = -2 if transform == "horizontal_flip" else -3
                        # Roll a coin; publish to the seedLink registry
                        # so paired bbox/mask layers downstream make the
                        # same flip decision. Topological order in the
                        # node loop guarantees augment_image runs before
                        # paired augments within a single forward pass.
                        coin = float(torch.rand(()).item())
                        if seedlink:
                            self._aug_seed_registry[seedlink] = coin
                        if coin < prob:
                            tensors[nid] = torch.flip(inp, dims=[flip_axis])
                        else:
                            tensors[nid] = inp
                    else:
                        # Unknown transform fallthrough — also clear so
                        # paired layers don't read a stale prior coin
                        # (Codex round-3 P2).
                        if seedlink and seedlink in self._aug_seed_registry:
                            del self._aug_seed_registry[seedlink]
                        tensors[nid] = inp
                elif t == "augment_bbox":
                    # Paired bbox augment — reads coin from registry.
                    if not self.training:
                        tensors[nid] = inp
                        continue
                    transform = getattr(self, f"aug_transform_{nid}", "horizontal_flip")
                    prob = float(getattr(self, f"aug_probability_{nid}", 0.5))
                    seedlink = getattr(self, f"aug_seedlink_{nid}", "")
                    if transform == "identity" or prob <= 0.0:
                        tensors[nid] = inp
                        continue
                    # bbox shape: [B, 4] or [B, N, 4] in x0y0x1y1.
                    if inp.dim() not in (2, 3) or inp.shape[-1] != 4:
                        tensors[nid] = inp
                        continue
                    # Read shared coin from upstream augment_image with
                    # same seedLink. Codex round-6 P1: if seedlink is set
                    # but no coin published yet (upstream image augment
                    # ran later in topo order, or doesn't exist), the
                    # silent own-RNG fallback hides a desync bug. Now:
                    # only fall back to own RNG when seedlink is empty
                    # (genuinely unpaired). Otherwise warn loudly.
                    if not hasattr(self, "_aug_seed_registry"):
                        self._aug_seed_registry = {}
                    if seedlink:
                        coin = self._aug_seed_registry.get(seedlink)
                        if coin is None:
                            sys.stderr.write(
                                f"[augment_bbox] node {nid}: seedLink='{seedlink}' "
                                f"set but no upstream augment_image published a coin "
                                f"for it in this forward pass. Skipping augmentation "
                                f"to avoid desync. Check graph topology.\n"
                            )
                            tensors[nid] = inp
                            continue
                    else:
                        coin = float(torch.rand(()).item())
                    if coin >= prob:
                        tensors[nid] = inp
                        continue
                    img_w = float(getattr(self, f"aug_imgw_{nid}", 1.0))
                    img_h = float(getattr(self, f"aug_imgh_{nid}", 1.0))
                    fmt = getattr(self, f"aug_format_{nid}", "x0y0x1y1")
                    a = inp[..., 0]; b = inp[..., 1]; c = inp[..., 2]; d = inp[..., 3]
                    if transform == "horizontal_flip":
                        if fmt == "xywh":
                            # x_new = W - x - w; w/y/h unchanged
                            na, nb, nc, nd = img_w - a - c, b, c, d
                        else:
                            # x0y0x1y1: swap about W
                            na, nb, nc, nd = img_w - c, b, img_w - a, d
                    elif transform == "vertical_flip":
                        if fmt == "xywh":
                            na, nb, nc, nd = a, img_h - b - d, c, d
                        else:
                            na, nb, nc, nd = a, img_h - d, c, img_h - b
                    else:
                        tensors[nid] = inp
                        continue
                    tensors[nid] = torch.stack([na, nb, nc, nd], dim=-1)
                elif t == "augment_mask":
                    if not self.training:
                        tensors[nid] = inp
                        continue
                    transform = getattr(self, f"aug_transform_{nid}", "horizontal_flip")
                    prob = float(getattr(self, f"aug_probability_{nid}", 0.5))
                    seedlink = getattr(self, f"aug_seedlink_{nid}", "")
                    if transform == "identity" or prob <= 0.0:
                        tensors[nid] = inp
                        continue
                    # Codex round-8 P2: support both rank-3 [B, H, W]
                    # and rank-4 [B, H, W, C] / [B, C, H, W] masks.
                    # 3D promotes to 4D NHWC ([B, H, W, 1]), flips,
                    # then squeezes back. Other ranks skip.
                    orig_rank = inp.dim()
                    if orig_rank not in (3, 4):
                        tensors[nid] = inp
                        continue
                    if transform not in ("horizontal_flip", "vertical_flip"):
                        tensors[nid] = inp
                        continue
                    promoted = inp.unsqueeze(-1) if orig_rank == 3 else inp
                    # Same NCHW auto-detect as augment_image (Codex
                    # round-2 P1: "Mirror augment_image layout override
                    # in augment_mask"). Otherwise paired image+mask
                    # diverge after a `reshape → augment_image
                    # → augment_mask` chain on server, where the image
                    # gets axis -1 (after override) but mask gets axis
                    # -2 (no override).
                    layout = getattr(self, f"aug_layout_{nid}", "nhwc")
                    # When promoted from rank-3, the synthetic last dim
                    # is always the channel slot (NHWC). Force NHWC
                    # layout for that case so we flip real spatial
                    # axes (H/W), not the synthetic size-1 dim.
                    # Mirrors the JS fix from round-7 P2.
                    if orig_rank == 3:
                        layout = "nhwc"
                    elif layout == "nhwc":
                        # Same NCHW auto-detect as augment_image.
                        ch_axis_1 = promoted.shape[1]
                        last_axis = promoted.shape[-1]
                        if ch_axis_1 in (1, 2, 3, 4) and last_axis > 4:
                            if not getattr(self, f"_aug_layout_warned_{nid}", False):
                                sys.stderr.write(
                                    f"[augment_mask] node {nid}: layout=nhwc "
                                    f"but input shape {tuple(promoted.shape)} looks NCHW; "
                                    f"auto-overriding to nchw.\n"
                                )
                                setattr(self, f"_aug_layout_warned_{nid}", True)
                            layout = "nchw"
                    if layout == "nchw":
                        flip_axis = -1 if transform == "horizontal_flip" else -2
                    else:
                        flip_axis = -2 if transform == "horizontal_flip" else -3
                    if not hasattr(self, "_aug_seed_registry"):
                        self._aug_seed_registry = {}
                    if seedlink:
                        coin = self._aug_seed_registry.get(seedlink)
                        if coin is None:
                            sys.stderr.write(
                                f"[augment_mask] node {nid}: seedLink='{seedlink}' "
                                f"set but no upstream augment_image published a coin. "
                                f"Skipping to avoid desync.\n"
                            )
                            tensors[nid] = inp
                            continue
                    else:
                        coin = float(torch.rand(()).item())
                    if coin < prob:
                        flipped = torch.flip(promoted, dims=[flip_axis])
                        tensors[nid] = flipped.squeeze(-1) if orig_rank == 3 else flipped
                    else:
                        tensors[nid] = inp
                elif t == "augment_label":
                    # Pure passthrough.
                    tensors[nid] = inp
                elif t == "patch_embed":
                    img_size = getattr(self, f"pe_img_size_{nid}")
                    embed_dim = getattr(self, f"pe_embed_dim_{nid}")
                    if inp.dim() == 2:
                        image = inp.view(inp.shape[0], 1, img_size, img_size)
                    elif inp.dim() == 4:
                        image = inp if inp.shape[1] == 1 else inp.permute(0, 3, 1, 2).contiguous()
                    else:
                        raise ValueError(f"PatchEmbed expects 2D flat input or 4D image tensor, got ndim={inp.dim()}")
                    projected = getattr(self, f"pe_proj_{nid}")(image)
                    tensors[nid] = projected.permute(0, 2, 3, 1).contiguous().view(inp.shape[0], -1, embed_dim)
                elif t == "transformer_block":
                    ln1 = getattr(self, f"tb_ln1_{nid}")
                    q = getattr(self, f"tb_q_{nid}")
                    k = getattr(self, f"tb_k_{nid}")
                    v = getattr(self, f"tb_v_{nid}")
                    attn_proj = getattr(self, f"tb_attn_proj_{nid}")
                    attn_drop = getattr(self, f"tb_attn_drop_{nid}")
                    ln2 = getattr(self, f"tb_ln2_{nid}")
                    ffn1 = getattr(self, f"tb_ffn1_{nid}")
                    ffn_drop = getattr(self, f"tb_ffn_drop_{nid}")
                    ffn2 = getattr(self, f"tb_ffn2_{nid}")
                    normed = ln1(inp)
                    qkv = torch.cat([q(normed), k(normed), v(normed)], dim=-1)
                    attn_out = attn_drop(attn_proj(qkv))
                    res1 = inp + attn_out
                    normed2 = ln2(res1)
                    ffn_hidden = ffn_drop(torch.relu(ffn1(normed2)))
                    tensors[nid] = res1 + ffn2(ffn_hidden)
                elif t == "global_avg_pool1d":
                    # [batch, seq, dim] → [batch, dim]
                    if inp.dim() == 3:
                        tensors[nid] = inp.mean(dim=1)
                    else:
                        tensors[nid] = inp
                elif t == "global_avg_pool2d":
                    if inp.dim() == 4:
                        tensors[nid] = inp.mean(dim=[2, 3])
                    else:
                        tensors[nid] = inp
                elif t == "detach":
                    tensors[nid] = inp.detach()
                elif t == "concat_batch":
                    # concat along batch axis — auto-flatten if shapes differ
                    parent_tensors = [tensors[p["from"]] for p in parents_sorted if p["from"] in tensors]
                    if len(parent_tensors) >= 2:
                        # flatten all to 2D if any are not matching
                        shapes = [pt.shape[1:] for pt in parent_tensors]
                        if any(s != shapes[0] for s in shapes):
                            parent_tensors = [_flatten_tf_layout(pt) for pt in parent_tensors]
                        tensors[nid] = torch.cat(parent_tensors, dim=0)
                    else:
                        tensors[nid] = inp
                    continue
                elif t == "concat":
                    # concat along feature/channel axis
                    parent_tensors = [tensors[p["from"]] for p in parents_sorted if p["from"] in tensors]
                    if len(parent_tensors) >= 2:
                        all_4d = all(pt.dim() == 4 for pt in parent_tensors)
                        if all_4d:
                            # spatial concat: channel axis (dim=1 in NCHW) — UNet skip connections
                            tensors[nid] = torch.cat(parent_tensors, dim=1)
                        else:
                            # flatten to 2D then concat on feature axis — diffusion (noisy_image + time_embed)
                            parent_tensors = [_flatten_tf_layout(pt) if pt.dim() > 2 else pt for pt in parent_tensors]
                            tensors[nid] = torch.cat(parent_tensors, dim=-1)
                    else:
                        tensors[nid] = inp
                    continue
                elif t == "phase_switch":
                    # Select branch from graph-defined activePhase, not schedule position.
                    phase_idx = getattr(self, '_phase_idx', 0)
                    current_phase = str(getattr(self, "_phase_name", "") or "").strip()
                    active_phase = str(self.node_configs[nid].get("activePhase", "") or "").strip()
                    parent_tensors = [tensors[p["from"]] for p in parents_sorted if p["from"] in tensors]
                    use_first = False
                    if active_phase and current_phase:
                        use_first = active_phase == current_phase
                    else:
                        use_first = phase_idx == 0
                    if use_first and len(parent_tensors) >= 1:
                        tensors[nid] = parent_tensors[0]
                    elif len(parent_tensors) >= 2:
                        tensors[nid] = parent_tensors[1]
                    else:
                        tensors[nid] = inp
                    continue
                elif t == "constant":
                    # output constant tensor matching batch size
                    cdim = int(self.node_configs[nid].get("dim", 1))
                    cval = float(self.node_configs[nid].get("value", 1))
                    tensors[nid] = torch.full((x.shape[0], cdim), cval, device=x.device)
                    continue
                elif t == "embedding":
                    tensors[nid] = getattr(self, f"embed_{nid}")(inp.long())
                elif t == "reshape":
                    shapes = getattr(self, '_reshape_shapes', {})
                    shape = shapes.get(nid, [28, 28, 1])
                    if len(shape) == 2:
                        tensors[nid] = inp.contiguous().view(inp.shape[0], shape[0], shape[1])
                    else:
                        nhwc = inp.contiguous().view(inp.shape[0], shape[0], shape[1], shape[2])
                        tensors[nid] = nhwc.permute(0, 3, 1, 2).contiguous()
                    continue  # must be outside if/else, at elif level
                elif t == "conv2d":
                    # BUG-38 part B: apply asymmetric padding to match TF.js
                    # conv2d(padding="same") for stride > 1. When stride=1 and
                    # kernel is odd, this is equivalent to symmetric pad=(k-1)//2
                    # so the change is a no-op for the common case.
                    pad_cfg = getattr(self, "_conv2d_pad", {}).get(nid)
                    conv_inp = inp
                    if pad_cfg is not None and inp.dim() == 4:
                        # F.pad expects (left, right, top, bottom).
                        import torch.nn.functional as _F
                        conv_inp = _F.pad(inp, list(pad_cfg))
                    out = getattr(self, f"conv2d_{nid}")(conv_inp)
                    act = getattr(self, f"act_{nid}", None)
                    tensors[nid] = act(out) if act else out
                elif t == "conv2d_transpose":
                    out = getattr(self, f"convt2d_{nid}")(inp)
                    crop = getattr(self, "_convt_crop", {}).get(nid)
                    if crop and out.dim() == 4:
                        out = out[:, :, crop[0]:crop[0] + crop[2], crop[1]:crop[1] + crop[3]]
                    act = getattr(self, f"act_{nid}", None)
                    tensors[nid] = act(out) if act else out
                elif t == "maxpool2d":
                    tensors[nid] = getattr(self, f"pool_{nid}")(inp)
                elif t == "upsample2d":
                    tensors[nid] = getattr(self, f"up_{nid}")(inp)
                elif t == "flatten":
                    tensors[nid] = _flatten_tf_layout(inp)
                elif t == "global_avg_pool2d":
                    # [batch, C, H, W] → [batch, C]
                    tensors[nid] = inp.mean(dim=[2, 3]) if inp.dim() == 4 else inp
                elif t == "output":
                    # flatten conv output if needed before linear using TF.js NHWC ordering
                    out_inp = _flatten_tf_layout(inp) if inp.dim() > 2 else inp
                    tensors[nid] = getattr(self, f"out_{nid}")(out_inp)
                    # if target=custom, store input_2 as label (from PhaseSwitch/Constant)
                    if len(parents_sorted) >= 2:
                        label_parent = parents_sorted[1]["from"]
                        if label_parent in tensors:
                            if not hasattr(self, '_custom_labels'):
                                self._custom_labels = {}
                            self._custom_labels[nid] = tensors[label_parent]
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

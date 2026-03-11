from __future__ import annotations

import json
import math
import copy
import os
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
import matplotlib.pyplot as plt
from torch.utils.data import DataLoader, TensorDataset


SCENARIOS = ("spring", "pendulum", "bouncing")


def set_all_seeds(seed: int = 42) -> None:
    seed = int(seed)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
    # Required for deterministic CuBLAS paths on CUDA >= 10.2
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    try:
        torch.use_deterministic_algorithms(True, warn_only=True)
    except Exception:
        pass
    if hasattr(torch.backends, "cudnn"):
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False


def default_param_mask() -> Dict[str, bool]:
    return {
        "m": True,
        "c": True,
        "k": True,
        "e": True,
        "x0": True,
        "v0": True,
        "gm": True,
        "gk": True,
        "gc": True,
        "rkm": False,
        "rcm": False,
        "rgl": False,
    }


def normalize_param_mask(mask: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    out = default_param_mask()
    if not mask:
        return out
    for k in out:
        if k in mask:
            out[k] = bool(mask[k]) if k in ("rkm", "rcm", "rgl") else (mask[k] is not False)
    return out


def scenario_one_hot(s: str) -> List[float]:
    return [1.0 if s == "spring" else 0.0, 1.0 if s == "pendulum" else 0.0, 1.0 if s == "bouncing" else 0.0]


def parse_graph_json(graph_json: Any) -> Dict[str, Any]:
    """Parse drawflow payload or payload path.

    Supported inputs:
    - dict/list payload that already holds drawflow JSON
    - str path to a JSON file
    - pathlib.Path object
    """
    payload: Any
    if isinstance(graph_json, dict):
        payload = graph_json
    elif isinstance(graph_json, list):
        # Some payloads may be passed as list of nodes; keep compatible as-is.
        payload = {"nodes": graph_json}
    elif isinstance(graph_json, (str, Path)):
        payload = json.loads(Path(graph_json).read_text(encoding="utf-8"))
    else:
        raise TypeError("graph_json must be dict, list, str path, or Path")

    if isinstance(payload, dict) and isinstance(payload.get("nodes"), dict):
        return payload["nodes"]
    if "drawflow" in payload and "Home" in payload["drawflow"]:
        return payload["drawflow"]["Home"]["data"]
    if "drawflow" in payload and "drawflow" in payload["drawflow"]:
        return payload["drawflow"]["drawflow"]["Home"]["data"]
    if "Home" in payload:
        return payload["Home"]["data"]
    raise ValueError("Could not locate Drawflow Home.data in JSON")


def _parse_port_idx(name: str) -> int:
    if not name:
        return 10**9
    try:
        return int(name.split("_")[-1])
    except Exception:
        return 10**9


def get_input_node_ids(nodes: Dict[str, Any]) -> List[str]:
    return sorted([nid for nid, n in nodes.items() if n.get("name") == "input_layer"], key=lambda x: int(x))


def outgoing_edges(nodes: Dict[str, Any], nid: str) -> List[Tuple[str, str, str, str]]:
    n = nodes[nid]
    out = []
    for ok, ov in (n.get("outputs") or {}).items():
        for c in (ov.get("connections") or []):
            out.append((nid, str(c["node"]), str(ok), str(c.get("input", ""))))
    return out


def incoming_edges(nodes: Dict[str, Any], nid: str) -> List[Tuple[str, str, str, str]]:
    n = nodes[nid]
    ins = []
    for ik, iv in (n.get("inputs") or {}).items():
        for c in (iv.get("connections") or []):
            ins.append((str(c["node"]), nid, str(c.get("output", "")), str(ik)))
    ins.sort(key=lambda e: _parse_port_idx(e[3]))
    return ins


def reachable_from_input(nodes: Dict[str, Any], input_id: str) -> List[str]:
    q = [input_id]
    seen = {input_id}
    while q:
        cur = q.pop(0)
        for _, to, _, _ in outgoing_edges(nodes, cur):
            if to not in seen:
                seen.add(to)
                q.append(to)
    return sorted(list(seen), key=lambda x: int(x))


def topological_order(nodes: Dict[str, Any], reachable: Sequence[str]) -> List[str]:
    rset = set(reachable)
    indeg = {nid: 0 for nid in reachable}
    for nid in reachable:
        for _, to, _, _ in outgoing_edges(nodes, nid):
            if to in rset:
                indeg[to] += 1
    q = sorted([nid for nid, d in indeg.items() if d == 0], key=lambda x: int(x))
    out: List[str] = []
    while q:
        cur = q.pop(0)
        out.append(cur)
        for _, to, _, _ in outgoing_edges(nodes, cur):
            if to not in indeg:
                continue
            indeg[to] -= 1
            if indeg[to] == 0:
                q.append(to)
                q.sort(key=lambda x: int(x))
    if len(out) != len(reachable):
        raise ValueError("Graph contains cycle(s).")
    return out


def infer_graph_mode(nodes: Dict[str, Any], reachable: Sequence[str]) -> str:
    # Trajectory reconstruction heads explicitly indicate trajectory-level AE/VAE mode.
    for nid in reachable:
        n = nodes.get(nid, {})
        if n.get("name") != "output_layer":
            continue
        d = n.get("data") or {}
        target = str(d.get("targetType", d.get("target", "x"))).strip().lower()
        if target == "traj":
            return "trajectory_ae"
    input_count = len(get_input_node_ids(nodes))
    if input_count >= 2:
        return "trajectory_ae"
    names = {nodes[nid].get("name") for nid in reachable}
    has_hist = any(n in names for n in (
        "hist_block", "hist_x_block", "hist_v_block", "x_block", "v_block", "window_hist_block", "window_hist_x_block", "window_hist_v_block", "sliding_window_block"
    ))
    return "autoregressive" if has_hist else "direct"


def infer_model_family(nodes: Dict[str, Any], reachable: Sequence[str]) -> str:
    names = {nodes[nid].get("name") for nid in reachable}
    if "noise_schedule_block" in names:
        return "diffusion"
    if any(n in names for n in ("latent_layer", "latent_mu_layer", "latent_logvar_layer", "reparam_layer")):
        return "vae"
    return "supervised"


def _history_field(node: Dict[str, Any]) -> str:
    name = str((node or {}).get("name") or "")
    d = (node or {}).get("data") or {}
    if name in ("hist_x_block", "x_block", "window_hist_x_block"):
        return "x"
    if name in ("hist_v_block", "v_block", "window_hist_v_block"):
        return "v"
    if name in ("hist_block", "window_hist_block"):
        fk = str(d.get("featureKey", "x")).strip().lower()
        return "v" if fk == "v" else "x"
    return ""


def infer_feature_spec(nodes: Dict[str, Any], reachable: Sequence[str], mode: str) -> Dict[str, Any]:
    names = {nodes[nid].get("name") for nid in reachable}
    params_nodes = [nodes[nid] for nid in reachable if nodes[nid].get("name") == "params_block"]
    pm = normalize_param_mask((params_nodes[0].get("data") or {}).get("paramMask") if params_nodes else None)
    hist_fields = [_history_field(nodes[nid]) for nid in reachable]

    spec = {
        "useX": ("x" in hist_fields),
        "useV": ("v" in hist_fields),
        "useParams": "params_block" in names,
        "useTimeSec": "time_sec_block" in names,
        "useTimeNorm": ("time_norm_block" in names) or ("time_block" in names),
        "useScenario": "scenario_block" in names,
        "useSinNorm": ("sin_norm_block" in names) or ("trig_block" in names),
        "useCosNorm": ("cos_norm_block" in names) or ("trig_block" in names),
        "useNoiseSchedule": ("noise_schedule_block" in names),
        "paramMask": pm,
    }
    if mode == "direct" and not any([spec["useParams"], spec["useTimeSec"], spec["useTimeNorm"], spec["useScenario"], spec["useSinNorm"], spec["useCosNorm"], spec["useNoiseSchedule"]]):
        spec["useParams"] = True
        spec["useTimeNorm"] = True
    if mode == "autoregressive" and not any([spec["useX"], spec["useV"], spec["useParams"]]):
        spec["useX"] = True
        spec["useParams"] = True
    return spec


def infer_ar_history(nodes: Dict[str, Any], reachable: Sequence[str]) -> Dict[str, Any]:
    fallback = {"windowSize": 20, "stride": 1, "lagMode": "contiguous", "lags": None, "padMode": "none"}
    candidates = [nodes[nid] for nid in reachable if nodes[nid].get("name") in ("window_hist_block", "window_hist_x_block", "window_hist_v_block", "sliding_window_block")]
    if not candidates:
        names = {nodes[nid].get("name") for nid in reachable}
        if any(n in names for n in ("hist_block", "hist_x_block", "hist_v_block", "x_block", "v_block")):
            return {"windowSize": 1, "stride": 1, "lagMode": "contiguous", "lags": None, "padMode": "none"}
        return fallback
    d = candidates[0].get("data") or {}
    w = max(5, int(d.get("windowSize", 20)))
    stride = max(1, int(d.get("stride", 1)))
    lag_mode = str(d.get("lagMode", "contiguous"))
    pad_mode = str(d.get("padMode", "none"))
    if pad_mode not in ("none", "zero", "edge"):
        pad_mode = "none"
    if lag_mode != "exact":
        return {"windowSize": w, "stride": stride, "lagMode": "contiguous", "lags": None, "padMode": pad_mode}
    raw = str(d.get("lagCsv", ""))
    lags = []
    for p in raw.split(","):
        p = p.strip()
        if not p:
            continue
        try:
            v = int(float(p))
            if v >= 1:
                lags.append(v)
        except Exception:
            pass
    lags = sorted(list(set(lags)))
    if not lags:
        return {"windowSize": w, "stride": stride, "lagMode": "contiguous", "lags": None, "padMode": pad_mode}
    return {"windowSize": len(lags), "stride": stride, "lagMode": "exact", "lags": lags, "padMode": pad_mode}


def infer_output_heads(nodes: Dict[str, Any], reachable: Sequence[str], param_size: int) -> List[Dict[str, Any]]:
    out = []
    for nid in sorted(reachable, key=lambda x: int(x)):
        n = nodes[nid]
        if n.get("name") != "output_layer":
            continue
        d = n.get("data") or {}
        target = str(d.get("targetType", d.get("target", "x")))
        if target not in ("x", "v", "xv", "params", "traj"):
            raise ValueError(f"output_layer node {nid}: unsupported target '{target}'")
        if "matchWeight" not in d:
            raise ValueError(f"output_layer node {nid}: missing required data.matchWeight")
        match_weight = float(d["matchWeight"])
        if not math.isfinite(match_weight) or match_weight < 0:
            raise ValueError(f"output_layer node {nid}: invalid data.matchWeight={d.get('matchWeight')!r} (must be finite >= 0)")
        params_select_raw = d.get("paramsSelect", "")
        if isinstance(params_select_raw, list):
            params_select = [str(x).strip() for x in params_select_raw if str(x).strip()]
        else:
            params_select = [p.strip() for p in str(params_select_raw or "").split(",") if p.strip()]
        units = 2 if target == "xv" else (param_size if target == "params" else 1)
        if target == "params" and params_select:
            units = len(params_select)
        out.append({
            "id": str(nid),
            "target": target,
            "targetType": target,
            "paramsSelect": params_select,
            "units": max(1, int(units)),
            "loss": str(d.get("loss", "use_global")),
            "wx": float(d.get("wx", 1.0)),
            "wv": float(d.get("wv", 1.0)),
            "matchWeight": match_weight,
        })
    if not out:
        raise ValueError("No output_layer nodes found in graph.")
    return out


def print_output_heads_summary(graph_json_path: str | Path | Dict[str, Any], output_heads: Sequence[Dict[str, Any]]) -> None:
    """Print resolved output heads so each run is auditable before training."""
    if isinstance(graph_json_path, dict):
        gname = "graph_payload"
    elif isinstance(graph_json_path, Path):
        gname = graph_json_path.name
    else:
        gname = Path(str(graph_json_path)).name
    rows: List[Dict[str, Any]] = []
    for i, h in enumerate(output_heads):
        params_sel = list(h.get("paramsSelect", []) or [])
        rows.append({
            "head_idx": i,
            "node_id": str(h.get("id", "")),
            "target": str(h.get("targetType", h.get("target", "x"))),
            "params_select": ",".join([str(x) for x in params_sel]) if params_sel else "-",
            "units": int(h.get("units", 1)),
            "loss": str(h.get("loss", "use_global")),
            "matchWeight": float(h.get("matchWeight", 1.0)),
        })
    print(f"[model heads] {gname}")
    try:
        display(pd.DataFrame(rows))
    except Exception:
        for r in rows:
            print(
                f"  head[{r['head_idx']}] node={r['node_id']} target={r['target']} "
                f"params={r['params_select']} units={r['units']} loss={r['loss']}"
            )


def _static_params(p: Dict[str, Any], pm: Dict[str, bool]) -> List[float]:
    m = max(1e-9, float(p.get("m", 1.0)))
    c = float(p.get("c", 0.0))
    k = float(p.get("k_slg", p.get("k", 0.0)))
    g = float(p.get("g_global", p.get("g", 9.81)))
    gm = 1.0 if str(p.get("groundModel", p.get("ground", "rigid"))) == "compliant" else 0.0
    out: List[float] = []
    if pm["m"]:
        out.append(m)
    if pm["c"]:
        out.append(c)
    if pm["k"]:
        out.append(k)
    if pm["e"]:
        out.append(float(p.get("restitution", p.get("e", 0.8))))
    if pm["x0"]:
        out.append(float(p.get("x0", 0.0)))
    if pm["v0"]:
        out.append(float(p.get("v0", 0.0)))
    if pm["gm"]:
        out.append(gm)
    if pm["gk"]:
        out.append(float(p.get("groundK", p.get("k_g", 2500.0))))
    if pm["gc"]:
        out.append(float(p.get("groundC", p.get("c_g", 90.0))))
    if pm["rkm"]:
        out.append(k / m)
    if pm["rcm"]:
        out.append(c / m)
    if pm["rgl"]:
        out.append(g / max(1e-9, k))
    return out


def static_param_names(pm: Dict[str, bool]) -> List[str]:
    out: List[str] = []
    if pm["m"]:
        out.append("m")
    if pm["c"]:
        out.append("c")
    if pm["k"]:
        out.append("k")
    if pm["e"]:
        out.append("e")
    if pm["x0"]:
        out.append("x0")
    if pm["v0"]:
        out.append("v0")
    if pm["gm"]:
        out.append("gm")
    if pm["gk"]:
        out.append("gk")
    if pm["gc"]:
        out.append("gc")
    if pm["rkm"]:
        out.append("rkm")
    if pm["rcm"]:
        out.append("rcm")
    if pm["rgl"]:
        out.append("rgl")
    return out


def _direct_features(t: float, params: Dict[str, Any], duration: float, spec: Dict[str, Any]) -> List[float]:
    T = max(1e-9, float(duration))
    tn = float(t) / T
    out: List[float] = []
    if spec["useTimeSec"]:
        out.append(float(t))
    if spec["useTimeNorm"]:
        out.append(tn)
    if spec["useSinNorm"]:
        out.append(math.sin(2.0 * math.pi * tn))
    if spec["useCosNorm"]:
        out.append(math.cos(2.0 * math.pi * tn))
    if spec.get("useNoiseSchedule", False):
        beta_min = 1e-4
        beta_max = 2e-2
        beta_t = beta_min + (beta_max - beta_min) * tn
        alpha_bar = math.exp(-(beta_min * tn + 0.5 * (beta_max - beta_min) * tn * tn))
        sigma_t = math.sqrt(max(1e-9, 1.0 - alpha_bar))
        out.extend([beta_t, alpha_bar, sigma_t])
    if spec["useScenario"]:
        out.extend(scenario_one_hot(str(params["scenario"])))
    if spec["useParams"]:
        out.extend(_static_params(params, spec["paramMask"]))
    return out if out else [tn]


def _ar_features(hist_x: Sequence[float], hist_v: Sequence[float], params: Dict[str, Any], spec: Dict[str, Any], as_sequence: bool) -> List[float] | List[List[float]]:
    static = _static_params(params, spec["paramMask"])
    scen = scenario_one_hot(str(params["scenario"]))
    if not as_sequence:
        out: List[float] = []
        if spec["useX"]:
            out.extend([float(v) for v in hist_x])
        if spec["useV"]:
            out.extend([float(v) for v in hist_v])
        if spec["useParams"]:
            out.extend(static)
        if spec["useScenario"]:
            out.extend(scen)
        return out
    seq: List[List[float]] = []
    for i in range(len(hist_x)):
        row: List[float] = []
        if spec["useX"]:
            row.append(float(hist_x[i]))
        if spec["useV"]:
            row.append(float(hist_v[i]))
        if spec["useParams"]:
            row.extend(static)
        if spec["useScenario"]:
            row.extend(scen)
        seq.append(row)
    return seq


@dataclass
class Trajectory:
    trajectory: int
    t: np.ndarray
    x: np.ndarray
    v: np.ndarray
    params: Dict[str, Any]


def load_trajectory_csv(path: str | Path) -> List[Trajectory]:
    df = pd.read_csv(path)
    required = {"trajectory", "t", "x", "v", "scenario"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Dataset missing columns: {sorted(missing)}")

    out: List[Trajectory] = []
    for tid, g in df.groupby("trajectory"):
        g = g.sort_values("step" if "step" in g.columns else "t")
        row0 = g.iloc[0]
        params = {
            "scenario": str(row0.get("scenario", "spring")),
            "m": float(row0.get("m", 1.0)),
            "c": float(row0.get("c", 0.0)),
            "k_slg": float(row0.get("k_slg", row0.get("k", 0.0))),
            "g_global": float(row0.get("g_global", row0.get("g", 9.81))),
            "restitution": float(row0.get("restitution", row0.get("e", 0.8))),
            "x0": float(row0.get("x0", 0.0)),
            "v0": float(row0.get("v0", 0.0)),
            "groundModel": str(row0.get("groundModel", row0.get("ground", "rigid"))),
            "groundK": float(row0.get("groundK", row0.get("k_g", 2500.0))),
            "groundC": float(row0.get("groundC", row0.get("c_g", 90.0))),
            "_split": str(row0.get("split", "")).strip().lower(),
        }
        out.append(
            Trajectory(
                trajectory=int(tid),
                t=g["t"].to_numpy(dtype=np.float32),
                x=g["x"].to_numpy(dtype=np.float32),
                v=g["v"].to_numpy(dtype=np.float32),
                params=params,
            )
        )
    out.sort(key=lambda tr: tr.trajectory)
    return out


def split_trajectories(trajectories: List[Trajectory], seed: int = 42, mode: str = "stratified_scenario", train: float = 0.7, val: float = 0.15, test: float = 0.15) -> Dict[int, str]:
    mode = str(mode or "stratified_scenario").strip().lower()

    if mode in ("from_csv", "frozen", "manifest"):
        out_from_csv: Dict[int, str] = {}
        valid = {"train", "val", "test"}
        for i, tr in enumerate(trajectories):
            b = str((tr.params or {}).get("_split", "")).strip().lower()
            if b not in valid:
                raise ValueError(
                    "split_mode='from_csv' requires split column with values in {train,val,test} "
                    f"(missing/invalid at trajectory index {i}, trajectory id={tr.trajectory})"
                )
            out_from_csv[i] = b
        return out_from_csv

    s = max(1e-9, train + val + test)
    train, val, test = train / s, val / s, test / s

    groups: Dict[str, List[int]] = {}
    for i, tr in enumerate(trajectories):
        key = tr.params["scenario"] if mode == "stratified_scenario" else "all"
        groups.setdefault(key, []).append(i)

    out: Dict[int, str] = {}
    for gi, (_, idxs) in enumerate(groups.items()):
        rng = np.random.default_rng(seed + (gi + 1) * 1009)
        idxs = list(idxs)
        rng.shuffle(idxs)
        n = len(idxs)
        n_train = int(math.floor(n * train))
        n_val = int(math.floor(n * val))
        n_test = n - n_train - n_val
        if n >= 3:
            if n_train < 1:
                n_train = 1
            if n_val < 1:
                n_val = 1
            n_test = n - n_train - n_val
            if n_test < 1:
                n_test = 1
                if n_train > n_val and n_train > 1:
                    n_train -= 1
                elif n_val > 1:
                    n_val -= 1
        for k, idx in enumerate(idxs):
            if k < n_train:
                out[idx] = "train"
            elif k < n_train + n_val:
                out[idx] = "val"
            else:
                out[idx] = "test"
    return out


def build_supervised_arrays(trajectories: List[Trajectory], graph_nodes: Dict[str, Any], split_map: Dict[int, str], mode: str, feature_spec: Dict[str, Any], ar_cfg: Dict[str, Any], target_mode: str) -> Dict[str, np.ndarray]:
    X_flat = {"train": [], "val": [], "test": []}
    X_seq = {"train": [], "val": [], "test": []}
    y_x = {"train": [], "val": [], "test": []}
    y_v = {"train": [], "val": [], "test": []}
    y_xv = {"train": [], "val": [], "test": []}
    y_params = {"train": [], "val": [], "test": []}
    meta_scenario = {"train": [], "val": [], "test": []}
    meta_traj = {"train": [], "val": [], "test": []}
    meta_t = {"train": [], "val": [], "test": []}

    for i, tr in enumerate(trajectories):
        bucket = split_map[i]
        t = tr.t
        x = tr.x
        v = tr.v
        params = tr.params
        dur = float(max(1e-9, float(t[-1]) if len(t) else 1.0))

        if mode == "direct":
            for j in range(len(t)):
                X_flat[bucket].append(_direct_features(float(t[j]), params, dur, feature_spec))
                y_x[bucket].append([float(x[j])])
                y_v[bucket].append([float(v[j])])
                y_xv[bucket].append([float(x[j]), float(v[j])])
                y_params[bucket].append(_static_params(params, feature_spec["paramMask"]))
                meta_scenario[bucket].append(str(params["scenario"]))
                meta_traj[bucket].append(int(tr.trajectory))
                meta_t[bucket].append(float(t[j]))
        else:
            pad_mode = str(ar_cfg.get("padMode", "none"))
            use_zero_pad = pad_mode == "zero"
            use_edge_pad = pad_mode == "edge"
            if ar_cfg["lagMode"] == "exact" and ar_cfg["lags"]:
                lags = ar_cfg["lags"]
                stride = max(1, int(ar_cfg["stride"]))
                pad_x = float(x[0]) if (len(x) and use_edge_pad) else 0.0
                pad_v = float(v[0]) if (len(v) and use_edge_pad) else 0.0
                for j in range(0, len(t), stride):
                    hx: List[float] = []
                    hv: List[float] = []
                    valid = True
                    for lag in lags:
                        idx = j - int(lag)
                        if idx >= 0:
                            hx.append(float(x[idx]))
                            hv.append(float(v[idx]))
                        elif use_zero_pad or use_edge_pad:
                            hx.append(pad_x if use_edge_pad else 0.0)
                            hv.append(pad_v if use_edge_pad else 0.0)
                        else:
                            valid = False
                            break
                    if not valid:
                        continue
                    X_flat[bucket].append(_ar_features(hx, hv, params, feature_spec, as_sequence=False))
                    X_seq[bucket].append(_ar_features(hx, hv, params, feature_spec, as_sequence=True))
                    y_x[bucket].append([float(x[j])])
                    y_v[bucket].append([float(v[j])])
                    y_xv[bucket].append([float(x[j]), float(v[j])])
                    y_params[bucket].append(_static_params(params, feature_spec["paramMask"]))
                    meta_scenario[bucket].append(str(params["scenario"]))
                    meta_traj[bucket].append(int(tr.trajectory))
                    meta_t[bucket].append(float(t[j]))
            else:
                w = max(1, int(ar_cfg["windowSize"]))
                stride = max(1, int(ar_cfg["stride"]))
                pad_x = float(x[0]) if (len(x) and use_edge_pad) else 0.0
                pad_v = float(v[0]) if (len(v) and use_edge_pad) else 0.0
                for j in range(0, len(t), stride):
                    hx: List[float] = []
                    hv: List[float] = []
                    valid = True
                    for k in range(j - w, j):
                        if k >= 0:
                            hx.append(float(x[k]))
                            hv.append(float(v[k]))
                        elif use_zero_pad or use_edge_pad:
                            hx.append(pad_x if use_edge_pad else 0.0)
                            hv.append(pad_v if use_edge_pad else 0.0)
                        else:
                            valid = False
                            break
                    if not valid:
                        continue
                    X_flat[bucket].append(_ar_features(hx, hv, params, feature_spec, as_sequence=False))
                    X_seq[bucket].append(_ar_features(hx, hv, params, feature_spec, as_sequence=True))
                    y_x[bucket].append([float(x[j])])
                    y_v[bucket].append([float(v[j])])
                    y_xv[bucket].append([float(x[j]), float(v[j])])
                    y_params[bucket].append(_static_params(params, feature_spec["paramMask"]))
                    meta_scenario[bucket].append(str(params["scenario"]))
                    meta_traj[bucket].append(int(tr.trajectory))
                    meta_t[bucket].append(float(t[j]))

    def _arr(d: Dict[str, List[Any]], k: str, dtype=np.float32) -> np.ndarray:
        a = np.asarray(d[k], dtype=dtype)
        if a.size == 0:
            return np.zeros((0, 1), dtype=np.float32)
        return a

    return {
        "X_flat_train": _arr(X_flat, "train"),
        "X_flat_val": _arr(X_flat, "val"),
        "X_flat_test": _arr(X_flat, "test"),
        "X_seq_train": _arr(X_seq, "train"),
        "X_seq_val": _arr(X_seq, "val"),
        "X_seq_test": _arr(X_seq, "test"),
        "y_x_train": _arr(y_x, "train"),
        "y_x_val": _arr(y_x, "val"),
        "y_x_test": _arr(y_x, "test"),
        "y_v_train": _arr(y_v, "train"),
        "y_v_val": _arr(y_v, "val"),
        "y_v_test": _arr(y_v, "test"),
        "y_xv_train": _arr(y_xv, "train"),
        "y_xv_val": _arr(y_xv, "val"),
        "y_xv_test": _arr(y_xv, "test"),
        "y_params_train": _arr(y_params, "train"),
        "y_params_val": _arr(y_params, "val"),
        "y_params_test": _arr(y_params, "test"),
        "meta_scenario_train": np.asarray(meta_scenario["train"], dtype=object),
        "meta_scenario_val": np.asarray(meta_scenario["val"], dtype=object),
        "meta_scenario_test": np.asarray(meta_scenario["test"], dtype=object),
        "meta_traj_train": np.asarray(meta_traj["train"], dtype=np.int64),
        "meta_traj_val": np.asarray(meta_traj["val"], dtype=np.int64),
        "meta_traj_test": np.asarray(meta_traj["test"], dtype=np.int64),
        "meta_t_train": np.asarray(meta_t["train"], dtype=np.float32),
        "meta_t_val": np.asarray(meta_t["val"], dtype=np.float32),
        "meta_t_test": np.asarray(meta_t["test"], dtype=np.float32),
        "target_mode": target_mode,
        "param_names": static_param_names(feature_spec["paramMask"]),
    }


def _trajectory_input_array(
    tr: Trajectory,
    input_mode: str = "flat",
) -> np.ndarray:
    x = np.asarray(tr.x, dtype=np.float32)
    if str(input_mode) == "sequence":
        return x[:, None].astype(np.float32)
    return x.astype(np.float32)


def build_trajectory_ae_arrays(
    trajectories: List[Trajectory],
    split_map: Dict[int, str],
    input_ids: Sequence[str],
    input_roles: Dict[str, str],
    input_modes: Dict[str, str],
    param_mask: Dict[str, bool],
) -> Dict[str, np.ndarray]:
    x_inputs: Dict[str, Dict[str, List[np.ndarray]]] = {
        iid: {"train": [], "val": [], "test": []} for iid in input_ids
    }
    y_x = {"train": [], "val": [], "test": []}
    y_v = {"train": [], "val": [], "test": []}
    y_xv = {"train": [], "val": [], "test": []}
    y_params = {"train": [], "val": [], "test": []}
    meta_scenario = {"train": [], "val": [], "test": []}
    meta_traj = {"train": [], "val": [], "test": []}
    meta_t = {"train": [], "val": [], "test": []}

    for i, tr in enumerate(trajectories):
        bucket = split_map[i]
        static = np.asarray(_static_params(tr.params, param_mask), dtype=np.float32)
        x_traj = np.asarray(tr.x, dtype=np.float32)
        v_traj = np.asarray(tr.v, dtype=np.float32)
        t_last = float(tr.t[-1]) if len(tr.t) else 0.0

        for iid in input_ids:
            role = str(input_roles.get(iid, "trajectory"))
            mode = str(input_modes.get(iid, "flat"))
            if role in ("params", "condition"):
                x_inputs[iid][bucket].append(static.copy())
            else:
                x_inputs[iid][bucket].append(_trajectory_input_array(tr, mode))

        y_x[bucket].append(x_traj.copy())
        y_v[bucket].append(v_traj.copy())
        y_xv[bucket].append(np.stack([x_traj, v_traj], axis=1))
        y_params[bucket].append(static.copy())
        meta_scenario[bucket].append(str(tr.params["scenario"]))
        meta_traj[bucket].append(int(tr.trajectory))
        meta_t[bucket].append(t_last)

    out: Dict[str, np.ndarray] = {}
    for iid in input_ids:
        for split in ("train", "val", "test"):
            vals = x_inputs[iid][split]
            if not vals:
                out[f"X_input_{iid}_{split}"] = np.zeros((0, 1), dtype=np.float32)
            else:
                a = np.asarray(vals, dtype=np.float32)
                out[f"X_input_{iid}_{split}"] = a

    def _arr(d: Dict[str, List[Any]], k: str, dtype=np.float32) -> np.ndarray:
        a = np.asarray(d[k], dtype=dtype)
        if a.size == 0:
            return np.zeros((0, 1), dtype=np.float32)
        return a

    out.update(
        {
            "X_flat_train": np.zeros((0, 1), dtype=np.float32),
            "X_flat_val": np.zeros((0, 1), dtype=np.float32),
            "X_flat_test": np.zeros((0, 1), dtype=np.float32),
            "X_seq_train": np.zeros((0, 1, 1), dtype=np.float32),
            "X_seq_val": np.zeros((0, 1, 1), dtype=np.float32),
            "X_seq_test": np.zeros((0, 1, 1), dtype=np.float32),
            "y_x_train": _arr(y_x, "train"),
            "y_x_val": _arr(y_x, "val"),
            "y_x_test": _arr(y_x, "test"),
            "y_v_train": _arr(y_v, "train"),
            "y_v_val": _arr(y_v, "val"),
            "y_v_test": _arr(y_v, "test"),
            "y_xv_train": _arr(y_xv, "train"),
            "y_xv_val": _arr(y_xv, "val"),
            "y_xv_test": _arr(y_xv, "test"),
            "y_params_train": _arr(y_params, "train"),
            "y_params_val": _arr(y_params, "val"),
            "y_params_test": _arr(y_params, "test"),
            "meta_scenario_train": np.asarray(meta_scenario["train"], dtype=object),
            "meta_scenario_val": np.asarray(meta_scenario["val"], dtype=object),
            "meta_scenario_test": np.asarray(meta_scenario["test"], dtype=object),
            "meta_traj_train": np.asarray(meta_traj["train"], dtype=np.int64),
            "meta_traj_val": np.asarray(meta_traj["val"], dtype=np.int64),
            "meta_traj_test": np.asarray(meta_traj["test"], dtype=np.int64),
            "meta_t_train": np.asarray(meta_t["train"], dtype=np.float32),
            "meta_t_val": np.asarray(meta_t["val"], dtype=np.float32),
            "meta_t_test": np.asarray(meta_t["test"], dtype=np.float32),
            "target_mode": "x",
            "param_names": static_param_names(param_mask),
        }
    )
    return out


class DrawflowTorchModel(nn.Module):
    def __init__(
        self,
        nodes: Dict[str, Any],
        topo: List[str],
        input_ids: Sequence[str],
        reachable: List[str],
        input_dim_map: Dict[str, int],
        seq_input_map: Dict[str, bool],
        output_heads: List[Dict[str, Any]],
    ):
        super().__init__()
        self.nodes = nodes
        self.topo = topo
        self.input_ids = [str(i) for i in input_ids]
        if not self.input_ids:
            raise ValueError("DrawflowTorchModel requires at least one input node")
        self.input_id = self.input_ids[0]
        self.reachable = set(reachable)
        self.seq_input_map = {str(k): bool(v) for k, v in seq_input_map.items()}
        self.seq_input = bool(self.seq_input_map.get(self.input_id, False))
        self.output_heads = output_heads

        self.modules_by_id = nn.ModuleDict()
        self._conv_activation: Dict[str, str] = {}
        self._temporal_activation: Dict[str, str] = {}
        self._repeat_steps: Dict[str, int] = {}
        self._output_temporal: Dict[str, bool] = {}
        self._output_detach: Dict[str, bool] = {}
        self._seq_pool_mode: Dict[str, str] = {}
        self._resample_cfg: Dict[str, Dict[str, Any]] = {}
        self._node_is_sequence: Dict[str, bool] = {}
        self._node_dim: Dict[str, int] = {}
        for iid in self.input_ids:
            if iid not in input_dim_map:
                raise ValueError(f"Missing input dim for input id={iid}")
            self._node_is_sequence[iid] = bool(self.seq_input_map.get(iid, False))
            self._node_dim[iid] = int(input_dim_map[iid])

        # Infer dims in topo order and create modules.
        for idx, nid in enumerate(self.topo):
            if nid in self.input_ids:
                continue
            n = self.nodes[nid]
            name = n.get("name")
            ins = [e for e in incoming_edges(self.nodes, nid) if e[0] in self.reachable]
            if not ins:
                continue
            in_ids = [e[0] for e in ins]
            in_seq = [self._node_is_sequence[iid] for iid in in_ids]
            in_dims = [self._node_dim[iid] for iid in in_ids]
            if len(set(in_seq)) > 1:
                raise ValueError(f"Node {nid}/{name} mixes sequence and flat inputs")
            is_seq = in_seq[0]
            in_dim = sum(in_dims) if len(in_dims) > 1 else in_dims[0]

            if name == "concat_block":
                self._node_is_sequence[nid] = is_seq
                self._node_dim[nid] = in_dim
                continue

            if name == "dense_layer":
                units = max(1, int((n.get("data") or {}).get("units", 32)))
                self.modules_by_id[nid] = nn.Linear(in_dim, units)
                self._node_is_sequence[nid] = is_seq
                self._node_dim[nid] = units
                continue

            if name == "dropout_layer":
                rate = float((n.get("data") or {}).get("rate", 0.1))
                self.modules_by_id[nid] = nn.Dropout(p=max(0.0, min(0.9, rate)))
                self._node_is_sequence[nid] = is_seq
                self._node_dim[nid] = in_dim
                continue

            if name in ("latent_layer", "latent_mu_layer", "latent_logvar_layer"):
                units = max(2, int((n.get("data") or {}).get("units", 16)))
                self.modules_by_id[nid] = nn.Linear(in_dim, units)
                self._node_is_sequence[nid] = is_seq
                self._node_dim[nid] = units
                continue

            if name == "reparam_layer":
                if len(ins) != 2:
                    raise ValueError("reparam_layer requires exactly 2 inputs (mu, logvar)")
                if in_dims[0] != in_dims[1]:
                    raise ValueError(f"reparam_layer input dims mismatch: mu={in_dims[0]} logvar={in_dims[1]}")
                self._node_is_sequence[nid] = is_seq
                self._node_dim[nid] = in_dims[0]
                continue

            if name in ("rnn_layer", "gru_layer", "lstm_layer"):
                if not is_seq:
                    raise ValueError(f"{name} requires sequence input")
                d = n.get("data") or {}
                units = max(1, int(d.get("units", 64)))
                dropout = max(0.0, min(0.8, float(d.get("dropout", 0.1))))
                rs = str(d.get("returnseq", "auto"))
                later_names = [self.nodes[k].get("name") for k in self.topo[idx + 1:]]
                has_later_rnn = any(v in ("rnn_layer", "gru_layer", "lstm_layer") for v in later_names)
                return_seq = True if rs == "true" else False if rs == "false" else has_later_rnn

                if name == "rnn_layer":
                    layer = nn.RNN(input_size=in_dim, hidden_size=units, batch_first=True)
                elif name == "gru_layer":
                    layer = nn.GRU(input_size=in_dim, hidden_size=units, batch_first=True)
                else:
                    layer = nn.LSTM(input_size=in_dim, hidden_size=units, batch_first=True)
                self.modules_by_id[nid] = layer
                self._node_is_sequence[nid] = return_seq
                self._node_dim[nid] = units
                self.modules_by_id[f"{nid}:postdrop"] = nn.Dropout(p=dropout) if dropout > 0 else nn.Identity()
                continue

            if name == "conv1d_layer":
                if not is_seq:
                    raise ValueError("conv1d_layer requires sequence input")
                d = n.get("data") or {}
                filters = max(1, int(d.get("filters", 64)))
                kernel_size = max(1, int(d.get("kernelSize", 3)))
                stride = max(1, int(d.get("stride", 1)))
                pad = max(0, (kernel_size - 1) // 2)
                self.modules_by_id[nid] = nn.Conv1d(in_channels=in_dim, out_channels=filters, kernel_size=kernel_size, stride=stride, padding=pad)
                self._node_is_sequence[nid] = True
                self._node_dim[nid] = filters
                self._conv_activation[nid] = str(d.get("activation", "relu")).lower()
                continue

            if name == "repeat_layer":
                if is_seq:
                    raise ValueError("repeat_layer requires flat input")
                d = n.get("data") or {}
                steps = max(1, int(d.get("steps", 1)))
                self._repeat_steps[nid] = steps
                self._node_is_sequence[nid] = True
                self._node_dim[nid] = in_dim
                continue

            if name == "seq_pool_layer":
                if not is_seq:
                    raise ValueError("seq_pool_layer requires sequence input")
                d = n.get("data") or {}
                mode = str(d.get("mode", "last")).lower()
                if mode not in ("last", "mean"):
                    mode = "last"
                self._seq_pool_mode[nid] = mode
                self._node_is_sequence[nid] = False
                self._node_dim[nid] = in_dim
                continue

            if name == "resample_layer":
                if not is_seq:
                    raise ValueError("resample_layer requires sequence input")
                d = n.get("data") or {}
                method = str(d.get("method", "linear_down_up_half")).strip()
                keep_ratio = float(d.get("keepRatio", d.get("keep_ratio", 1.0)))
                keep_ratio = max(0.01, min(1.0, keep_ratio))
                self._resample_cfg[nid] = {
                    "method": method,
                    "keep_ratio": keep_ratio,
                }
                self._node_is_sequence[nid] = True
                self._node_dim[nid] = in_dim
                continue

            if name == "temporal_dense_layer":
                if not is_seq:
                    raise ValueError("temporal_dense_layer requires sequence input")
                d = n.get("data") or {}
                units = max(1, int(d.get("units", 32)))
                self.modules_by_id[nid] = nn.Linear(in_dim, units)
                self._temporal_activation[nid] = str(d.get("activation", "relu")).lower()
                self._node_is_sequence[nid] = True
                self._node_dim[nid] = units
                continue

            if name == "output_layer":
                d = n.get("data") or {}
                temporal = bool(d.get("temporal", False))
                detach_to_shared = bool(d.get("detachToShared", False))
                units = max(1, int(next((h["units"] for h in output_heads if h["id"] == nid), 1)))
                self.modules_by_id[nid] = nn.Linear(in_dim, units)
                self._output_temporal[nid] = temporal
                self._output_detach[nid] = detach_to_shared
                self._node_is_sequence[nid] = bool(is_seq and temporal)
                self._node_dim[nid] = units
                continue

            raise ValueError(f"Unsupported node type in torch builder: {name}")

        # Latent diff groups (same group + same latent node type).
        self.latent_groups: Dict[str, List[str]] = {}
        for nid in self.topo:
            n = self.nodes[nid]
            if n.get("name") in ("latent_layer", "latent_mu_layer", "latent_logvar_layer"):
                d = n.get("data") or {}
                if "group" not in d or not str(d.get("group", "")).strip():
                    raise ValueError(f"latent node {nid} ({n.get('name')}): missing required data.group")
                g = str(d.get("group"))
                gn = str(n.get("name") or "latent_layer")
                self.latent_groups.setdefault(f"{g}::{gn}", []).append(nid)
        self.reparam_nodes: List[str] = [
            nid for nid in self.topo
            if self.nodes[nid].get("name") == "reparam_layer"
        ]

    def _activation(self, x: torch.Tensor, act: str) -> torch.Tensor:
        a = (act or "relu").lower()
        if a == "relu":
            return torch.relu(x)
        if a == "tanh":
            return torch.tanh(x)
        if a == "sigmoid":
            return torch.sigmoid(x)
        if a in ("linear", "none"):
            return x
        return torch.relu(x)

    def forward(
        self,
        x: torch.Tensor | Dict[str, torch.Tensor] | Sequence[torch.Tensor],
        overrides: Optional[Dict[str, torch.Tensor]] = None,
    ) -> Tuple[List[torch.Tensor], Dict[str, torch.Tensor]]:
        tensors: Dict[str, torch.Tensor] = {}
        if isinstance(x, dict):
            for iid in self.input_ids:
                if iid not in x:
                    raise ValueError(f"Missing input tensor for id={iid}")
                tensors[iid] = x[iid]
        elif isinstance(x, (list, tuple)):
            if len(x) != len(self.input_ids):
                raise ValueError(f"Expected {len(self.input_ids)} inputs, got {len(x)}")
            for iid, xt in zip(self.input_ids, x):
                tensors[iid] = xt
        else:
            if len(self.input_ids) != 1:
                raise ValueError("Graph has multiple input nodes; pass dict or sequence of tensors")
            tensors[self.input_id] = x
        if overrides:
            for k, v in overrides.items():
                tensors[str(k)] = v

        for nid in self.topo:
            if nid in self.input_ids:
                continue
            if overrides and nid in overrides:
                continue
            n = self.nodes[nid]
            name = n.get("name")
            ins = [e for e in incoming_edges(self.nodes, nid) if e[0] in self.reachable]
            if not ins:
                continue
            xin = [tensors[e[0]] for e in ins if e[0] in tensors]
            if not xin:
                continue
            h = xin[0] if len(xin) == 1 else torch.cat(xin, dim=-1)

            if name == "concat_block":
                tensors[nid] = h
            elif name == "dense_layer":
                h = self.modules_by_id[nid](h)
                act = str((n.get("data") or {}).get("activation", "relu"))
                tensors[nid] = self._activation(h, act)
            elif name == "dropout_layer":
                tensors[nid] = self.modules_by_id[nid](h)
            elif name in ("latent_layer", "latent_mu_layer", "latent_logvar_layer"):
                tensors[nid] = self.modules_by_id[nid](h)
            elif name == "reparam_layer":
                if len(xin) != 2:
                    raise ValueError("reparam_layer requires exactly 2 input tensors (mu, logvar)")
                mu = xin[0]
                logvar = torch.clamp(xin[1], min=-10.0, max=10.0)
                eps = torch.randn_like(mu)
                tensors[nid] = mu + torch.exp(0.5 * logvar) * eps
            elif name in ("rnn_layer", "gru_layer", "lstm_layer"):
                out, _ = self.modules_by_id[nid](h)
                out = self.modules_by_id[f"{nid}:postdrop"](out)
                if self._node_is_sequence[nid]:
                    tensors[nid] = out
                else:
                    tensors[nid] = out[:, -1, :]
            elif name == "conv1d_layer":
                x1 = h.transpose(1, 2)  # [N, C, T]
                y1 = self.modules_by_id[nid](x1)
                act = self._conv_activation.get(nid, "relu")
                if act == "tanh":
                    y1 = torch.tanh(y1)
                elif act == "sigmoid":
                    y1 = torch.sigmoid(y1)
                elif act == "linear":
                    y1 = y1
                else:
                    y1 = torch.relu(y1)
                tensors[nid] = y1.transpose(1, 2)  # [N, T, C]
            elif name == "repeat_layer":
                steps = max(1, int(self._repeat_steps.get(nid, 1)))
                tensors[nid] = h.unsqueeze(1).repeat(1, steps, 1)
            elif name == "seq_pool_layer":
                mode = self._seq_pool_mode.get(nid, "last")
                if mode == "mean":
                    tensors[nid] = torch.mean(h, dim=1)
                else:
                    tensors[nid] = h[:, -1, :]
            elif name == "resample_layer":
                tensors[nid] = self._apply_resample(h, nid)
            elif name == "temporal_dense_layer":
                y = self.modules_by_id[nid](h)
                act = self._temporal_activation.get(nid, "relu")
                if act == "tanh":
                    y = torch.tanh(y)
                elif act == "sigmoid":
                    y = torch.sigmoid(y)
                elif act in ("linear", "none"):
                    y = y
                else:
                    y = torch.relu(y)
                tensors[nid] = y
            elif name == "output_layer":
                temporal = bool(self._output_temporal.get(nid, False))
                detach_to_shared = bool(self._output_detach.get(nid, False))
                h_in = h.detach() if detach_to_shared else h
                if h.ndim == 3 and temporal:
                    y = self.modules_by_id[nid](h_in)  # [N, T, U]
                    if y.shape[-1] == 1:
                        y = y.squeeze(-1)  # [N, T]
                    tensors[nid] = y
                else:
                    if h_in.ndim == 3:
                        h_in = h_in[:, -1, :]
                    tensors[nid] = self.modules_by_id[nid](h_in)

        outs: List[torch.Tensor] = []
        for hcfg in self.output_heads:
            hid = hcfg["id"]
            if hid in tensors:
                outs.append(tensors[hid])

        # Append latent diffs as auxiliary outputs.
        for g, ids in self.latent_groups.items():
            if len(ids) < 2:
                continue
            ref = tensors.get(ids[0])
            if ref is None:
                continue
            for iid in ids[1:]:
                cur = tensors.get(iid)
                if cur is None:
                    continue
                if ref.ndim == 3:
                    r = ref[:, -1, :]
                else:
                    r = ref
                if cur.ndim == 3:
                    c = cur[:, -1, :]
                else:
                    c = cur
                outs.append(r - c)

        # Append VAE KL helper outputs as concat([mu, logvar]) for each reparam node.
        for nid in self.reparam_nodes:
            ins = [e for e in incoming_edges(self.nodes, nid) if e[0] in self.reachable]
            if len(ins) != 2:
                continue
            mu = tensors.get(ins[0][0])
            logvar = tensors.get(ins[1][0])
            if mu is None or logvar is None:
                continue
            if mu.ndim == 3:
                mu = mu[:, -1, :]
            if logvar.ndim == 3:
                logvar = logvar[:, -1, :]
            outs.append(torch.cat([mu, logvar], dim=-1))

        return outs, tensors

    def _keep_idx(self, T: int, keep_ratio: float, device: torch.device) -> torch.Tensor:
        m = int(max(2, round(float(T) * float(keep_ratio))))
        if m >= T:
            return torch.arange(T, device=device, dtype=torch.long)
        idx = torch.linspace(0.0, float(T - 1), steps=m, device=device)
        idx = torch.clamp(torch.round(idx), 0, T - 1).to(torch.long)
        idx = torch.unique(idx)
        return idx

    def _apply_resample(self, x: torch.Tensor, nid: str) -> torch.Tensor:
        # x: [N, T, C]
        cfg = self._resample_cfg.get(nid, {})
        method = str(cfg.get("method", "linear_down_up_half"))
        keep_ratio = float(cfg.get("keep_ratio", 1.0))
        if x.ndim != 3:
            return x
        N, T, C = x.shape
        if T <= 2 or keep_ratio >= 0.999:
            return x

        idx = self._keep_idx(T, keep_ratio, x.device)
        x_t = x.transpose(1, 2)  # [N, C, T]
        x_keep = x_t.index_select(2, idx)  # [N, C, m]
        y = F.interpolate(x_keep, size=T, mode="linear", align_corners=True)  # [N, C, T]

        if "conv" in method:
            # Fixed smoothing proxy for conv/inconv-style reconstruction.
            k = torch.tensor([1.0, 2.0, 3.0, 2.0, 1.0], device=x.device, dtype=x.dtype)
            k = (k / torch.sum(k)).view(1, 1, 5).repeat(C, 1, 1)
            y = F.conv1d(y, k, padding=2, groups=C)

        # Enforce exact values at sampled points.
        y.index_copy_(2, idx, x_t.index_select(2, idx))
        return y.transpose(1, 2)


def map_loss_name(loss: str, global_loss: str) -> str:
    l = str(loss or "use_global")
    if l == "mse":
        return "mse"
    if l == "mae":
        return "mae"
    if l == "huber":
        return "huber"
    return str(global_loss)


def compute_head_loss(pred: torch.Tensor, truth: torch.Tensor, head: Dict[str, Any], global_loss: str) -> torch.Tensor:
    target = head["target"]
    lname = map_loss_name(head.get("loss", "use_global"), global_loss)
    if target == "latent_kl":
        total = int(pred.shape[1]) if pred.ndim == 2 else int(head.get("units", 2))
        zdim = max(1, total // 2)
        mu = pred[:, :zdim]
        logvar = torch.clamp(pred[:, zdim:2 * zdim], min=-10.0, max=10.0)
        kl = -0.5 * torch.mean(torch.sum(1.0 + logvar - (mu ** 2) - torch.exp(logvar), dim=1))
        beta = max(0.0, float(head.get("beta", 1e-3)))
        return kl * beta * float(head.get("matchWeight", 1.0))
    if target == "xv":
        wx = max(0.0, float(head.get("wx", 1.0)))
        wv = max(0.0, float(head.get("wv", 1.0)))
        s = max(1e-9, wx + wv)
        lx = torch.mean(torch.abs(pred[:, :1] - truth[:, :1])) if lname == "mae" else (
            torch.mean((pred[:, :1] - truth[:, :1]) ** 2) if lname == "mse" else torch.nn.functional.huber_loss(pred[:, :1], truth[:, :1])
        )
        lv = torch.mean(torch.abs(pred[:, 1:2] - truth[:, 1:2])) if lname == "mae" else (
            torch.mean((pred[:, 1:2] - truth[:, 1:2]) ** 2) if lname == "mse" else torch.nn.functional.huber_loss(pred[:, 1:2], truth[:, 1:2])
        )
        return (wx / s) * lx + (wv / s) * lv

    if lname == "mae":
        l = torch.mean(torch.abs(pred - truth))
    elif lname == "huber":
        l = torch.nn.functional.huber_loss(pred, truth)
    else:
        l = torch.mean((pred - truth) ** 2)
    return l * float(head.get("matchWeight", 1.0))


def select_targets(arr: Dict[str, np.ndarray], split: str, target: str, head: Optional[Dict[str, Any]] = None) -> np.ndarray:
    if target == "x":
        return arr[f"y_x_{split}"]
    if target == "traj":
        return arr[f"y_x_{split}"]
    if target == "v":
        return arr[f"y_v_{split}"]
    if target == "xv":
        return arr[f"y_xv_{split}"]
    if target == "params":
        y = arr[f"y_params_{split}"]
        if head is None:
            return y
        names = [str(x) for x in list(arr.get("param_names", []))]
        picks = [str(p).strip() for p in list(head.get("paramsSelect", []) or []) if str(p).strip()]
        if not picks or not names:
            return y
        idx = [names.index(p) for p in picks if p in names]
        if not idx:
            return y
        return y[:, idx]
    raise ValueError(f"Unsupported target: {target}")


def build_model_and_data(graph_json_path: str | Path | Dict[str, Any], dataset_csv_path: str | Path, seed: int = 42, split_mode: str = "stratified_scenario", train_frac: float = 0.70, val_frac: float = 0.15, test_frac: float = 0.15) -> Dict[str, Any]:
    nodes = parse_graph_json(graph_json_path)

    # Use all nodes for mode/feature inference (new graphs use explicit feature blocks).
    all_node_ids = sorted(list(nodes.keys()), key=lambda x: int(x))

    trajectories = load_trajectory_csv(dataset_csv_path)
    split = split_trajectories(trajectories, seed=seed, mode=split_mode, train=train_frac, val=val_frac, test=test_frac)

    mode = infer_graph_mode(nodes, all_node_ids)
    model_family = infer_model_family(nodes, all_node_ids)
    feature_spec = infer_feature_spec(nodes, all_node_ids, mode)
    ar_cfg = infer_ar_history(nodes, all_node_ids)
    if mode == "trajectory_ae":
        # Param width can be inferred directly from static param mask.
        if not trajectories:
            raise ValueError("No trajectories loaded from dataset.")
        param_size = len(_static_params(trajectories[0].params, feature_spec["paramMask"]))
        arr = None
    else:
        # First build once to know params width.
        arr = build_supervised_arrays(trajectories, nodes, split, mode, feature_spec, ar_cfg, target_mode="xv")
        param_size = int(arr["y_params_train"].shape[1]) if arr["y_params_train"].ndim == 2 else 1

    output_heads = infer_output_heads(nodes, all_node_ids, param_size=param_size)
    target_mode = "x"
    if any(h["target"] == "xv" for h in output_heads):
        target_mode = "xv"
    elif any(h["target"] == "v" for h in output_heads):
        target_mode = "v"

    if mode != "trajectory_ae":
        arr = build_supervised_arrays(trajectories, nodes, split, mode, feature_spec, ar_cfg, target_mode=target_mode)

    # Build NN subgraph. If graph has explicit feature blocks, synthesize one input node.
    nn_names = {
        "concat_block", "dense_layer", "dropout_layer", "rnn_layer", "gru_layer", "lstm_layer",
        "conv1d_layer", "seq_pool_layer", "repeat_layer", "resample_layer", "temporal_dense_layer",
        "output_layer", "latent_layer", "latent_mu_layer", "latent_logvar_layer", "reparam_layer",
    }
    input_ids = get_input_node_ids(nodes)
    model_nodes = json.loads(json.dumps(nodes))
    if not input_ids:
        # Backward-compatible synthetic single input for graphs without explicit input node.
        nn_ids = [nid for nid in all_node_ids if model_nodes[nid].get("name") in nn_names]
        if not nn_ids:
            raise ValueError("No NN nodes found in graph.")
        indeg = {nid: 0 for nid in nn_ids}
        nset = set(nn_ids)
        for nid in nn_ids:
            for src, _, _, _ in incoming_edges(model_nodes, nid):
                if src in nset:
                    indeg[nid] += 1
        roots = [nid for nid in nn_ids if indeg[nid] == 0]
        if not roots:
            raise ValueError("Could not infer NN roots for synthetic input.")
        new_id = str(max(int(k) for k in model_nodes.keys()) + 1)
        model_nodes[new_id] = {
            "id": int(new_id),
            "name": "input_layer",
            "data": {"mode": "auto", "role": "trajectory"},
            "inputs": {},
            "outputs": {"output_1": {"connections": []}},
        }
        for rid in roots:
            rnode = model_nodes[rid]
            in_map = rnode.get("inputs") or {}
            next_idx = max([_parse_port_idx(k) for k in in_map.keys()], default=0) + 1
            in_key = f"input_{next_idx}"
            in_map[in_key] = {"connections": [{"node": new_id, "output": "output_1"}]}
            rnode["inputs"] = in_map
            model_nodes[new_id]["outputs"]["output_1"]["connections"].append({"node": rid, "input": in_key})
        input_ids = [new_id]

    # Reachable/topo from union of all input roots.
    reachable_set: set[str] = set()
    for iid in input_ids:
        reachable_set.update(reachable_from_input(model_nodes, iid))
    reachable = sorted(list(reachable_set), key=lambda x: int(x))
    topo = topological_order(model_nodes, reachable)

    # Input metadata.
    input_roles: Dict[str, str] = {}
    input_modes: Dict[str, str] = {}
    for idx, iid in enumerate(input_ids):
        d = model_nodes[iid].get("data") or {}
        role = str(d.get("role", "")).strip().lower()
        if role not in ("trajectory", "params", "condition"):
            role = "trajectory" if idx == 0 else "params"
        input_roles[iid] = role
        input_modes[iid] = str(d.get("mode", "flat"))

    # Trajectory-level AE mode uses trajectory-as-sample arrays and multiple inputs.
    if mode == "trajectory_ae":
        arr = build_trajectory_ae_arrays(
            trajectories=trajectories,
            split_map=split,
            input_ids=input_ids,
            input_roles=input_roles,
            input_modes=input_modes,
            param_mask=feature_spec["paramMask"],
        )
        # Trajectory outputs should be full-length vectors.
        traj_len = int(arr["y_x_train"].shape[1]) if arr["y_x_train"].ndim == 2 else 1
        for h in output_heads:
            h_node = nodes.get(str(h.get("id")), {})
            h_data = h_node.get("data") or {}
            temporal_head = bool(h_data.get("temporal", False))
            if h["target"] == "x":
                h["units"] = traj_len
            elif h["target"] == "traj":
                h["units"] = 1 if temporal_head else traj_len
            elif h["target"] == "v":
                h["units"] = traj_len
            elif h["target"] == "xv":
                h["units"] = 2 * traj_len
            elif h["target"] == "params":
                names = [str(x) for x in list(arr.get("param_names", []))]
                picks = [str(p).strip() for p in list(h.get("paramsSelect", []) or []) if str(p).strip()]
                if picks:
                    valid = [p for p in picks if p in names]
                    h["paramsSelect"] = valid
                    h["units"] = max(1, len(valid))
                else:
                    h["units"] = param_size
    # Validate/resolve selected params for any params head.
    param_names = [str(x) for x in list(arr.get("param_names", []))]
    for h in output_heads:
        if h.get("target") != "params":
            continue
        picks = [str(p).strip() for p in list(h.get("paramsSelect", []) or []) if str(p).strip()]
        if picks and param_names:
            valid = [p for p in picks if p in param_names]
            h["paramsSelect"] = valid
            h["units"] = max(1, len(valid))
    print_output_heads_summary(graph_json_path, output_heads)
    # Input tensors by input-id.
    x_train_map: Dict[str, np.ndarray] = {}
    x_val_map: Dict[str, np.ndarray] = {}
    x_test_map: Dict[str, np.ndarray] = {}
    seq_input_map: Dict[str, bool] = {}
    input_dim_map: Dict[str, int] = {}
    for iid in input_ids:
        if mode == "trajectory_ae":
            xtr = arr[f"X_input_{iid}_train"]
            xva = arr[f"X_input_{iid}_val"]
            xte = arr[f"X_input_{iid}_test"]
            is_seq = (xtr.ndim == 3)
        else:
            has_recurrent = any(model_nodes[nid].get("name") in ("rnn_layer", "gru_layer", "lstm_layer", "conv1d_layer") for nid in reachable)
            m = str(input_modes.get(iid, "auto"))
            is_seq = True if m == "sequence" else False if m == "flat" else has_recurrent
            xtr = arr["X_seq_train"] if is_seq else arr["X_flat_train"]
            xva = arr["X_seq_val"] if is_seq else arr["X_flat_val"]
            xte = arr["X_seq_test"] if is_seq else arr["X_flat_test"]
        if xtr.size == 0 or xva.size == 0 or xte.size == 0:
            raise ValueError("One of train/val/test splits is empty. Increase trajectories or adjust split.")
        x_train_map[iid] = xtr
        x_val_map[iid] = xva
        x_test_map[iid] = xte
        seq_input_map[iid] = bool(is_seq)
        input_dim_map[iid] = int(xtr.shape[-1])

    model = DrawflowTorchModel(
        nodes=model_nodes,
        topo=topo,
        input_ids=input_ids,
        reachable=reachable,
        input_dim_map=input_dim_map,
        seq_input_map=seq_input_map,
        output_heads=output_heads,
    )

    return {
        "model": model,
        "nodes": nodes,
        "mode": mode,
        "model_family": model_family,
        "is_sequence": bool(seq_input_map.get(input_ids[0], False)),
        "feature_spec": feature_spec,
        "ar_cfg": ar_cfg,
        "output_heads": output_heads,
        "arrays": arr,
        "input_ids": input_ids,
        "input_roles": input_roles,
        "x_train_map": x_train_map,
        "x_val_map": x_val_map,
        "x_test_map": x_test_map,
        "x_train": x_train_map[input_ids[0]],
        "x_val": x_val_map[input_ids[0]],
        "x_test": x_test_map[input_ids[0]],
        "trajectories": trajectories,
        "split": split,
    }


def make_dataloader(x_list: Sequence[np.ndarray], ys: List[np.ndarray], batch_size: int, shuffle: bool) -> DataLoader:
    tensors = [torch.tensor(x, dtype=torch.float32) for x in x_list]
    tensors.extend([torch.tensor(y, dtype=torch.float32) for y in ys])
    ds = TensorDataset(*tensors)
    return DataLoader(ds, batch_size=batch_size, shuffle=shuffle, drop_last=False)


def _fit_standardizer(x: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    if x.ndim == 2:
        mu = np.mean(x, axis=0, keepdims=True)
        sd = np.std(x, axis=0, keepdims=True)
    elif x.ndim == 3:
        mu = np.mean(x, axis=(0, 1), keepdims=True)
        sd = np.std(x, axis=(0, 1), keepdims=True)
    else:
        raise ValueError(f"Unsupported tensor rank for standardization: {x.ndim}")
    sd = np.where(np.isfinite(sd) & (sd > 1e-8), sd, 1.0)
    return mu.astype(np.float32), sd.astype(np.float32)


def _apply_standardizer(x: np.ndarray, mu: np.ndarray, sd: np.ndarray) -> np.ndarray:
    return ((x - mu) / sd).astype(np.float32)


def _inverse_standardizer(x: np.ndarray, mu: np.ndarray, sd: np.ndarray) -> np.ndarray:
    return (x * sd + mu).astype(np.float32)


def train_model(
    bundle: Dict[str, Any],
    epochs: int = 40,
    batch_size: int = 64,
    lr: float = 1e-3,
    seed: int = 42,
    global_loss: str = "mse",
    device: Optional[str] = None,
    use_lr_scheduler: bool = True,
    scheduler_patience: int = 3,
    scheduler_factor: float = 0.5,
    scheduler_min_lr: float = 1e-6,
    select_best_on_val: bool = True,
    early_stopping_patience: Optional[int] = None,
    log_every: int = 10,
) -> Dict[str, Any]:
    # Reset RNG per training call so repeated runs are reproducible.
    set_all_seeds(seed)

    model: DrawflowTorchModel = bundle["model"]
    output_heads: List[Dict[str, Any]] = bundle["output_heads"]
    arr = bundle["arrays"]

    # Add latent-diff pseudo heads to align with model forward output order.
    latent_heads: List[Dict[str, Any]] = []
    for g, ids in model.latent_groups.items():
        if len(ids) < 2:
            continue
        # Read matchWeight from the first latent node in the group.
        _ld = (model.nodes[ids[0]].get("data") or {})
        if "matchWeight" not in _ld:
            raise ValueError(f"latent node {ids[0]}: missing required data.matchWeight")
        _lmw = float(_ld["matchWeight"])
        if not math.isfinite(_lmw) or _lmw < 0:
            raise ValueError(f"latent node {ids[0]}: invalid data.matchWeight={_ld.get('matchWeight')!r} (must be finite >= 0)")
        for _ in ids[1:]:
            latent_heads.append({"target": "latent_diff", "loss": "mse", "matchWeight": _lmw, "units": model._node_dim[ids[0]], "wx": 1.0, "wv": 1.0})
    vae_heads: List[Dict[str, Any]] = []
    for nid in model.reparam_nodes:
        n = model.nodes[nid]
        d = n.get("data") or {}
        if "group" not in d or not str(d.get("group", "")).strip():
            raise ValueError(f"reparam_layer node {nid}: missing required data.group")
        if "beta" not in d:
            raise ValueError(f"reparam_layer node {nid}: missing required data.beta")
        if "matchWeight" not in d:
            raise ValueError(f"reparam_layer node {nid}: missing required data.matchWeight")
        g = str(d.get("group"))
        beta = float(d["beta"])
        if not math.isfinite(beta) or beta < 0:
            raise ValueError(f"reparam_layer node {nid}: invalid data.beta={d.get('beta')!r} (must be finite >= 0)")
        ins = [e for e in incoming_edges(model.nodes, nid) if e[0] in model.reachable]
        if len(ins) != 2:
            continue
        mu_id = ins[0][0]
        units = int(model._node_dim.get(mu_id, 2))
        _vmw = float(d["matchWeight"])
        if not math.isfinite(_vmw) or _vmw < 0:
            raise ValueError(f"reparam_layer node {nid}: invalid data.matchWeight={d.get('matchWeight')!r} (must be finite >= 0)")
        vae_heads.append({
            "target": "latent_kl",
            "loss": "mse",
            "matchWeight": _vmw,
            "units": max(2, units * 2),
            "wx": 1.0,
            "wv": 1.0,
            "beta": beta,
            "id": f"latent_kl:{g}:{nid}",
        })
    all_heads = output_heads + latent_heads + vae_heads

    input_ids: List[str] = list(bundle.get("input_ids", [model.input_id]))
    x_train_map: Dict[str, np.ndarray] = dict(bundle.get("x_train_map", {model.input_id: bundle["x_train"]}))
    x_val_map: Dict[str, np.ndarray] = dict(bundle.get("x_val_map", {model.input_id: bundle["x_val"]}))
    x_test_map: Dict[str, np.ndarray] = dict(bundle.get("x_test_map", {model.input_id: bundle["x_test"]}))

    n_train = int(x_train_map[input_ids[0]].shape[0])
    n_val = int(x_val_map[input_ids[0]].shape[0])
    n_test = int(x_test_map[input_ids[0]].shape[0])
    y_train = [select_targets(arr, "train", h["target"], h) if h["target"] not in ("latent_diff", "latent_kl") else np.zeros((n_train, int(h.get("units", 1))), dtype=np.float32) for h in all_heads]
    y_val = [select_targets(arr, "val", h["target"], h) if h["target"] not in ("latent_diff", "latent_kl") else np.zeros((n_val, int(h.get("units", 1))), dtype=np.float32) for h in all_heads]
    y_test = [select_targets(arr, "test", h["target"], h) if h["target"] not in ("latent_diff", "latent_kl") else np.zeros((n_test, int(h.get("units", 1))), dtype=np.float32) for h in all_heads]

    # Fit one scaler per input branch (train-only), apply to val/test.
    x_norm_stats: Dict[str, Tuple[np.ndarray, np.ndarray]] = {}
    x_train_n_map: Dict[str, np.ndarray] = {}
    x_val_n_map: Dict[str, np.ndarray] = {}
    x_test_n_map: Dict[str, np.ndarray] = {}
    for iid in input_ids:
        x_mu, x_sd = _fit_standardizer(x_train_map[iid])
        x_norm_stats[iid] = (x_mu, x_sd)
        x_train_n_map[iid] = _apply_standardizer(x_train_map[iid], x_mu, x_sd)
        x_val_n_map[iid] = _apply_standardizer(x_val_map[iid], x_mu, x_sd)
        x_test_n_map[iid] = _apply_standardizer(x_test_map[iid], x_mu, x_sd)

    y_stats: List[Optional[Tuple[np.ndarray, np.ndarray]]] = []
    y_train_n: List[np.ndarray] = []
    y_val_n: List[np.ndarray] = []
    y_test_n: List[np.ndarray] = []
    for i, h in enumerate(all_heads):
        tgt = str(h.get("target", "x"))
        # Keep helper pseudo-heads in raw zero-space.
        if tgt in ("latent_diff", "latent_kl"):
            y_stats.append(None)
            y_train_n.append(y_train[i].astype(np.float32))
            y_val_n.append(y_val[i].astype(np.float32))
            y_test_n.append(y_test[i].astype(np.float32))
            continue
        y_mu, y_sd = _fit_standardizer(y_train[i])
        y_stats.append((y_mu, y_sd))
        y_train_n.append(_apply_standardizer(y_train[i], y_mu, y_sd))
        y_val_n.append(_apply_standardizer(y_val[i], y_mu, y_sd))
        y_test_n.append(_apply_standardizer(y_test[i], y_mu, y_sd))

    dl_train = make_dataloader([x_train_n_map[iid] for iid in input_ids], y_train_n, batch_size=batch_size, shuffle=True)
    dl_val = make_dataloader([x_val_n_map[iid] for iid in input_ids], y_val_n, batch_size=batch_size, shuffle=False)
    dl_test = make_dataloader([x_test_n_map[iid] for iid in input_ids], y_test_n, batch_size=batch_size, shuffle=False)

    dev = torch.device(device if device else ("cuda" if torch.cuda.is_available() else "cpu"))
    model.to(dev)
    opt = torch.optim.Adam(model.parameters(), lr=lr)

    history = {"train_loss": [], "val_loss": [], "lr": []}
    scheduler = None
    if use_lr_scheduler:
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            opt,
            mode="min",
            factor=max(1e-3, float(scheduler_factor)),
            patience=max(0, int(scheduler_patience)),
            min_lr=max(1e-9, float(scheduler_min_lr)),
        )
    best_val = float("inf")
    best_epoch = -1
    best_state = None

    for ep in range(epochs):
        model.train()
        tr_losses = []
        for batch in dl_train:
            xb_list = [batch[i].to(dev) for i in range(len(input_ids))]
            yb = [t.to(dev) for t in batch[len(input_ids):]]
            xb = {iid: xb_list[i] for i, iid in enumerate(input_ids)} if len(input_ids) > 1 else xb_list[0]
            pred, _ = model(xb)
            if len(pred) != len(all_heads):
                raise RuntimeError(f"Pred/heads mismatch: {len(pred)} vs {len(all_heads)}")
            loss = torch.zeros((), device=dev)
            for i, h in enumerate(all_heads):
                loss = loss + compute_head_loss(pred[i], yb[i], h, global_loss=global_loss)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            tr_losses.append(float(loss.detach().cpu().item()))

        model.eval()
        va_losses = []
        with torch.no_grad():
            for batch in dl_val:
                xb_list = [batch[i].to(dev) for i in range(len(input_ids))]
                yb = [t.to(dev) for t in batch[len(input_ids):]]
                xb = {iid: xb_list[i] for i, iid in enumerate(input_ids)} if len(input_ids) > 1 else xb_list[0]
                pred, _ = model(xb)
                loss = torch.zeros((), device=dev)
                for i, h in enumerate(all_heads):
                    loss = loss + compute_head_loss(pred[i], yb[i], h, global_loss=global_loss)
                va_losses.append(float(loss.detach().cpu().item()))

        tr = float(np.mean(tr_losses)) if tr_losses else float("nan")
        va = float(np.mean(va_losses)) if va_losses else float("nan")
        history["train_loss"].append(tr)
        history["val_loss"].append(va)
        cur_lr = float(opt.param_groups[0]["lr"]) if opt.param_groups else float(lr)
        history["lr"].append(cur_lr)
        if scheduler is not None and np.isfinite(va):
            scheduler.step(va)
        improved = False
        if select_best_on_val and np.isfinite(va) and va < best_val:
            best_val = va
            best_epoch = ep + 1
            best_state = copy.deepcopy(model.state_dict())
            improved = True
        marker = " (best)" if improved else ""
        do_log = (
            ((ep + 1) == epochs)
            or (((ep + 1) % max(1, int(log_every))) == 0)
        )
        if do_log:
            print(f"epoch {ep+1:03d}/{epochs}: train={tr:.6e} val={va:.6e} lr={cur_lr:.3e}{marker}")
        if (
            early_stopping_patience is not None
            and best_epoch > 0
            and (ep + 1 - best_epoch) >= int(max(1, early_stopping_patience))
        ):
            print(f"early stop at epoch {ep+1}: no val improvement for {int(early_stopping_patience)} epochs")
            break

    if select_best_on_val and best_state is not None:
        model.load_state_dict(best_state)

    # Test metrics on first trajectory-like head (x/xv/v/traj)
    primary = None
    for i, h in enumerate(all_heads):
        if h["target"] in ("x", "v", "xv", "traj"):
            primary = i
            break
    if primary is None:
        raise RuntimeError("No trajectory output head found (x/v/xv/traj)")

    def _eval_primary(dl: DataLoader) -> Tuple[np.ndarray, np.ndarray, float, float, float]:
        preds: List[np.ndarray] = []
        trues: List[np.ndarray] = []
        model.eval()
        with torch.no_grad():
            for batch in dl:
                xb_list = [batch[i].to(dev) for i in range(len(input_ids))]
                xb = {iid: xb_list[i] for i, iid in enumerate(input_ids)} if len(input_ids) > 1 else xb_list[0]
                yb = batch[len(input_ids) + primary].to(dev)
                out, _ = model(xb)
                yp = out[primary]
                preds.append(yp.detach().cpu().numpy())
                trues.append(yb.detach().cpu().numpy())
        yhat = np.concatenate(preds, axis=0) if preds else np.zeros((0, 1), dtype=np.float32)
        ytru = np.concatenate(trues, axis=0) if trues else np.zeros((0, 1), dtype=np.float32)
        if primary is not None and primary < len(y_stats) and y_stats[primary] is not None:
            y_mu, y_sd = y_stats[primary]
            yhat = _inverse_standardizer(yhat, y_mu, y_sd)
            ytru = _inverse_standardizer(ytru, y_mu, y_sd)
        mae = float(np.mean(np.abs(yhat - ytru))) if yhat.size else float("nan")
        rmse = float(np.sqrt(np.mean((yhat - ytru) ** 2))) if yhat.size else float("nan")
        bias = float(np.mean(yhat - ytru)) if yhat.size else float("nan")
        return yhat, ytru, mae, rmse, bias

    yhat_val, ytru_val, mae_val, rmse_val, bias_val = _eval_primary(dl_val)
    yhat_test, ytru_test, mae_test, rmse_test, bias_test = _eval_primary(dl_test)

    return {
        "model": model,
        "device": str(dev),
        "global_loss": str(global_loss),
        "train_objective": "weighted_head_loss_on_normalized_targets",
        "history": history,
        "best_epoch": int(best_epoch if best_epoch > 0 else len(history["val_loss"])),
        "best_val_loss": float(best_val if np.isfinite(best_val) else np.nan),
        "norm": {
            "x_stats": {iid: {"mu": x_norm_stats[iid][0], "sd": x_norm_stats[iid][1]} for iid in input_ids},
            "x_mu": x_norm_stats[input_ids[0]][0],
            "x_sd": x_norm_stats[input_ids[0]][1],
            "y_stats": y_stats,
            "primary_idx": int(primary),
        },
        "val": {"mae": mae_val, "rmse": rmse_val, "bias": bias_val},
        "test": {"mae": mae_test, "rmse": rmse_test, "bias": bias_test},
        "y_pred_val": yhat_val,
        "y_true_val": ytru_val,
        "y_pred_test": yhat_test,
        "y_true_test": ytru_test,
        # Backward-compatible aliases: keep pointing to test split.
        "y_pred": yhat_test,
        "y_true": ytru_test,
        "heads": all_heads,
    }


def train_many_graphs(
    graph_json_paths: Sequence[str | Path],
    dataset_csv_path: str | Path,
    seed: int = 42,
    split_mode: str = "stratified_scenario",
    train_frac: float = 0.70,
    val_frac: float = 0.15,
    test_frac: float = 0.15,
    epochs: int = 40,
    batch_size: int = 64,
    lr: float = 1e-3,
    global_loss: str = "mse",
    device: Optional[str] = None,
) -> pd.DataFrame:
    rows: List[Dict[str, Any]] = []
    for p in graph_json_paths:
        # Reset before each model so every graph starts from the same RNG state.
        set_all_seeds(seed)
        gp = Path(p)
        print(f"=== training graph: {gp.name} ===")
        bundle = build_model_and_data(
            graph_json_path=gp,
            dataset_csv_path=dataset_csv_path,
            seed=seed,
            split_mode=split_mode,
            train_frac=train_frac,
            val_frac=val_frac,
            test_frac=test_frac,
        )
        result = train_model(
            bundle,
            epochs=epochs,
            batch_size=batch_size,
            lr=lr,
            seed=seed,
            global_loss=global_loss,
            device=device,
        )
        row = {
            "graph_file": gp.name,
            "mode": bundle["mode"],
            "model_family": bundle.get("model_family", "supervised"),
            "is_sequence": bool(bundle["is_sequence"]),
            "test_mae": float(result["test"]["mae"]),
            "test_rmse": float(result["test"]["rmse"]),
            "test_bias": float(result["test"]["bias"]),
            "device": result["device"],
        }
        rows.append(row)
        print(
            f"[{gp.name}] family={row['model_family']} mode={row['mode']} mae={row['test_mae']:.6e} "
            f"rmse={row['test_rmse']:.6e} bias={row['test_bias']:.6e}"
        )
    df = pd.DataFrame(rows)
    if len(df):
        df = df.sort_values(["test_mae", "test_rmse"], ascending=[True, True]).reset_index(drop=True)
    return df


def run_experiment_folder(
    experiment_dir: str | Path,
    dataset_pattern: str = "*.csv",
    graph_pattern: str = "*.json",
    seed: int = 42,
    split_mode: str = "stratified_scenario",
    train_frac: float = 0.70,
    val_frac: float = 0.15,
    test_frac: float = 0.15,
    epochs: int = 40,
    batch_size: int = 64,
    lr: float = 1e-3,
    global_loss: str = "mse",
    device: Optional[str] = None,
    out_csv_name: str = "batch_benchmark_summary.csv",
) -> Tuple[pd.DataFrame, Path]:
    exp = Path(experiment_dir)
    if not exp.exists():
        raise FileNotFoundError(f"Experiment folder not found: {exp}")

    datasets = sorted(exp.glob(dataset_pattern))
    datasets = [p for p in datasets if p.suffix.lower() == ".csv"]
    if not datasets:
        raise FileNotFoundError(f"No dataset CSV found in {exp} matching pattern: {dataset_pattern}")
    dataset_csv = datasets[0]

    graphs = sorted(exp.glob(graph_pattern))
    graphs = [p for p in graphs if p.suffix.lower() == ".json"]
    if not graphs:
        raise FileNotFoundError(f"No graph JSON files found in {exp} matching pattern: {graph_pattern}")

    df = train_many_graphs(
        graph_json_paths=graphs,
        dataset_csv_path=dataset_csv,
        seed=seed,
        split_mode=split_mode,
        train_frac=train_frac,
        val_frac=val_frac,
        test_frac=test_frac,
        epochs=epochs,
        batch_size=batch_size,
        lr=lr,
        global_loss=global_loss,
        device=device,
    )
    out_csv = exp / out_csv_name
    df.to_csv(out_csv, index=False)
    return df, out_csv


def _pca2(x: np.ndarray) -> np.ndarray:
    if x.ndim != 2:
        raise ValueError("PCA input must be rank-2")
    xc = x - np.mean(x, axis=0, keepdims=True)
    u, s, _ = np.linalg.svd(xc, full_matrices=False)
    if u.shape[1] < 2:
        z1 = u[:, :1] * s[:1]
        z2 = np.zeros_like(z1)
        return np.concatenate([z1, z2], axis=1)
    return u[:, :2] * s[:2]


def _split_arrays(arr: Dict[str, np.ndarray], split: str) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    # Prefer explicit trajectory-AE inputs when present.
    x = None
    pref = f"X_input_"
    suffix = f"_{split}"
    keys = [k for k in arr.keys() if k.startswith(pref) and k.endswith(suffix)]
    if keys:
        # Use first declared model input tensor.
        cand = arr[keys[0]]
        if isinstance(cand, np.ndarray) and cand.shape[0] > 0:
            x = cand

    if x is None:
        xs = arr.get(f"X_seq_{split}", np.zeros((0, 1, 1), dtype=np.float32))
        xf = arr.get(f"X_flat_{split}", np.zeros((0, 1), dtype=np.float32))
        x = xs if (isinstance(xs, np.ndarray) and xs.ndim == 3 and xs.shape[0] > 0) else xf

    scen = arr.get(f"meta_scenario_{split}", np.asarray([], dtype=object))
    traj = arr.get(f"meta_traj_{split}", np.asarray([], dtype=np.int64))
    return x, scen, traj


def latent_space_report(
    bundle: Dict[str, Any],
    trained: Dict[str, Any],
    out_dir: str | Path,
    split: str = "test",
    max_points: int = 3000,
) -> Dict[str, Any]:
    outp = Path(out_dir)
    outp.mkdir(parents=True, exist_ok=True)

    model: DrawflowTorchModel = trained["model"]
    dev = torch.device(trained["device"])
    arr = bundle["arrays"]

    split_try = [str(split), "val", "train"]
    x = scen = traj = None
    used_split = None
    for sp in split_try:
        xx, ss, tt = _split_arrays(arr, sp)
        if isinstance(xx, np.ndarray) and xx.shape[0] > 0:
            x, scen, traj = xx, ss, tt
            used_split = sp
            break
    if x is None or x.shape[0] == 0:
        raise ValueError(f"No samples in split={split} (or fallback val/train)")

    if x.shape[0] > max_points:
        rng = np.random.default_rng(42)
        idx = np.sort(rng.choice(np.arange(x.shape[0]), size=max_points, replace=False))
        x = x[idx]
        scen = scen[idx]
        traj = traj[idx]

    xt = torch.tensor(x, dtype=torch.float32, device=dev)
    model.eval()
    with torch.no_grad():
        _, tensors = model(xt)

    latent_ids: List[str] = []
    for nid in model.topo:
        nm = model.nodes[nid].get("name")
        if nm in ("reparam_layer", "latent_layer", "latent_mu_layer", "latent_logvar_layer"):
            if nid in tensors:
                latent_ids.append(nid)

    if not latent_ids:
        return {"status": "no_latent_nodes"}

    rows = []
    plots = []
    cmap = {"spring": "#00d4ff", "pendulum": "#b58cff", "bouncing": "#ffb000"}
    for nid in latent_ids:
        z = tensors[nid]
        if z.ndim == 3:
            z = z[:, -1, :]
        z_np = z.detach().cpu().numpy().astype(np.float64)
        z2 = _pca2(z_np)
        df = pd.DataFrame(
            {
                "node_id": nid,
                "pc1": z2[:, 0],
                "pc2": z2[:, 1],
                "scenario": scen,
                "trajectory": traj,
            }
        )
        csv_path = outp / f"latent_{nid}_{used_split}.csv"
        df.to_csv(csv_path, index=False)
        rows.append(str(csv_path))

        fig, ax = plt.subplots(figsize=(8, 6))
        for s in SCENARIOS:
            m = df["scenario"] == s
            if m.any():
                ax.scatter(df.loc[m, "pc1"], df.loc[m, "pc2"], s=10, alpha=0.65, label=s, c=cmap.get(s, "#cccccc"))
        ax.set_title(f"Latent PCA ({used_split}) node={nid}")
        ax.set_xlabel("PC1")
        ax.set_ylabel("PC2")
        ax.legend(loc="best")
        ax.grid(alpha=0.3)
        png_path = outp / f"latent_{nid}_{used_split}.png"
        fig.tight_layout()
        fig.savefig(png_path, dpi=160)
        plt.close(fig)
        plots.append(str(png_path))

    return {"status": "ok", "csv": rows, "plots": plots, "latent_nodes": latent_ids}


def latent_interpolation_demo(
    bundle: Dict[str, Any],
    trained: Dict[str, Any],
    out_dir: str | Path,
    split: str = "test",
    n_alpha: int = 7,
) -> Dict[str, Any]:
    outp = Path(out_dir)
    outp.mkdir(parents=True, exist_ok=True)

    model: DrawflowTorchModel = trained["model"]
    dev = torch.device(trained["device"])
    arr = bundle["arrays"]
    x, scen, traj = _split_arrays(arr, split)
    tvals = arr[f"meta_t_{split}"]
    if x.shape[0] < 3:
        return {"status": "not_enough_samples"}

    model.eval()
    xt = torch.tensor(x, dtype=torch.float32, device=dev)
    with torch.no_grad():
        outs, tensors = model(xt)

    # Primary output head.
    head_idx = None
    head_target = "x"
    for i, h in enumerate(trained["heads"]):
        if h["target"] in ("x", "v", "xv", "traj"):
            head_idx = i
            head_target = h["target"]
            break
    if head_idx is None:
        return {"status": "no_primary_head"}

    # Pick best latent candidate for override.
    latent_id = None
    for nid in model.topo:
        nm = model.nodes[nid].get("name")
        if nm == "reparam_layer" and nid in tensors:
            latent_id = nid
            break
    if latent_id is None:
        for nid in model.topo:
            nm = model.nodes[nid].get("name")
            if nm in ("latent_layer", "latent_mu_layer", "latent_logvar_layer") and nid in tensors:
                latent_id = nid
                break
    if latent_id is None:
        return {"status": "no_latent_for_interpolation"}

    z = tensors[latent_id]
    if z.ndim == 3:
        z = z[:, -1, :]
    z_np = z.detach().cpu().numpy()

    # Use one trajectory as a base time-series sweep if possible.
    counts = pd.Series(traj).value_counts()
    base_traj = int(counts.index[0])
    idxs = np.where(traj == base_traj)[0]
    if idxs.size < 16:
        idxs = np.arange(min(256, x.shape[0]))
    idxs = idxs[np.argsort(tvals[idxs])]

    xa = xt[idxs]
    z_a = torch.tensor(z_np[idxs[0]], dtype=torch.float32, device=dev)
    z_b = torch.tensor(z_np[idxs[min(len(idxs) - 1, max(1, len(idxs)//2))]], dtype=torch.float32, device=dev)
    alphas = np.linspace(0.0, 1.0, n_alpha)

    cols = ["alpha", "sample_idx", "t", "scenario", "traj", "y0", "y1"]
    rows = []
    curves = []
    with torch.no_grad():
        for a in alphas:
            z_cur = (1.0 - float(a)) * z_a + float(a) * z_b
            z_batch = z_cur.unsqueeze(0).repeat(xa.shape[0], 1)
            pred, _ = model(xa, overrides={latent_id: z_batch})
            yp = pred[head_idx].detach().cpu().numpy()
            if yp.ndim == 1:
                yp = yp[:, None]
            if yp.shape[1] == 1:
                y0 = yp[:, 0]
                y1 = np.zeros_like(y0)
            else:
                y0 = yp[:, 0]
                y1 = yp[:, 1]
            curves.append((a, y0.copy(), y1.copy()))
            for k, ii in enumerate(idxs):
                rows.append([a, int(ii), float(tvals[ii]), str(scen[ii]), int(traj[ii]), float(y0[k]), float(y1[k])])

    df = pd.DataFrame(rows, columns=cols)
    csv_path = outp / f"latent_interp_{split}.csv"
    df.to_csv(csv_path, index=False)

    fig, ax = plt.subplots(figsize=(10, 5))
    for a, y0, _ in curves:
        ax.plot(tvals[idxs], y0, linewidth=1.8, label=f"alpha={a:.2f}")
    ax.set_title(f"Latent interpolation ({head_target}) traj={base_traj}, node={latent_id}")
    ax.set_xlabel("time")
    ax.set_ylabel("prediction")
    ax.grid(alpha=0.3)
    ax.legend(loc="best", ncol=2, fontsize=8)
    fig.tight_layout()
    png_path = outp / f"latent_interp_{split}.png"
    fig.savefig(png_path, dpi=160)
    plt.close(fig)
    return {
        "status": "ok",
        "csv": str(csv_path),
        "plot": str(png_path),
        "latent_node": latent_id,
        "head_target": head_target,
    }


def vae_prior_sampling_demo(
    bundle: Dict[str, Any],
    trained: Dict[str, Any],
    out_dir: str | Path,
    split: str = "test",
    n_samples: int = 5,
) -> Dict[str, Any]:
    outp = Path(out_dir)
    outp.mkdir(parents=True, exist_ok=True)

    model: DrawflowTorchModel = trained["model"]
    dev = torch.device(trained["device"])
    arr = bundle["arrays"]
    x, scen, traj = _split_arrays(arr, split)
    tvals = arr[f"meta_t_{split}"]
    if x.shape[0] < 32:
        return {"status": "not_enough_samples"}

    model.eval()
    xt = torch.tensor(x, dtype=torch.float32, device=dev)
    with torch.no_grad():
        outs, tensors = model(xt)

    head_idx = None
    head_target = "x"
    for i, h in enumerate(trained["heads"]):
        if h["target"] in ("x", "v", "xv", "traj"):
            head_idx = i
            head_target = h["target"]
            break
    if head_idx is None:
        return {"status": "no_primary_head"}

    latent_id = None
    for nid in model.topo:
        if model.nodes[nid].get("name") == "reparam_layer" and nid in tensors:
            latent_id = nid
            break
    if latent_id is None:
        return {"status": "no_reparam_latent"}

    z = tensors[latent_id]
    if z.ndim == 3:
        z = z[:, -1, :]
    zdim = int(z.shape[-1])

    counts = pd.Series(traj).value_counts()
    base_traj = int(counts.index[0])
    idxs = np.where(traj == base_traj)[0]
    idxs = idxs[np.argsort(tvals[idxs])]
    if idxs.size < 16:
        idxs = np.arange(min(256, x.shape[0]))
    xa = xt[idxs]

    rng = np.random.default_rng(123)
    rows = []
    fig, ax = plt.subplots(figsize=(10, 5))
    with torch.no_grad():
        for sidx in range(n_samples):
            z_rand = torch.tensor(rng.standard_normal(size=(zdim,)), dtype=torch.float32, device=dev)
            z_batch = z_rand.unsqueeze(0).repeat(xa.shape[0], 1)
            pred, _ = model(xa, overrides={latent_id: z_batch})
            yp = pred[head_idx].detach().cpu().numpy()
            if yp.ndim == 1:
                yp = yp[:, None]
            y0 = yp[:, 0]
            ax.plot(tvals[idxs], y0, linewidth=1.4, alpha=0.85, label=f"sample {sidx+1}")
            for k, ii in enumerate(idxs):
                rows.append([sidx + 1, int(ii), float(tvals[ii]), str(scen[ii]), int(traj[ii]), float(y0[k])])

    ax.set_title(f"VAE prior samples ({head_target}) traj={base_traj}, node={latent_id}")
    ax.set_xlabel("time")
    ax.set_ylabel("prediction")
    ax.grid(alpha=0.3)
    ax.legend(loc="best", ncol=2, fontsize=8)
    fig.tight_layout()

    csv_path = outp / f"vae_prior_samples_{split}.csv"
    pd.DataFrame(rows, columns=["sample_id", "sample_idx", "t", "scenario", "traj", "y0"]).to_csv(csv_path, index=False)
    png_path = outp / f"vae_prior_samples_{split}.png"
    fig.savefig(png_path, dpi=160)
    plt.close(fig)
    return {"status": "ok", "csv": str(csv_path), "plot": str(png_path), "latent_node": latent_id, "head_target": head_target}

#!/usr/bin/env python3
"""
Server-side generation (reconstruct / random sampling).

Rebuilds model from graph, loads trained weights, runs generation.
Supports: reconstruct (input→model→output), random (z→decoder→output).

Protocol: prints JSON line {"kind": "result", "result": {...}}
"""
import json
import sys
import numpy as np

def _extract_graph_data(graph):
    if not isinstance(graph, dict):
        return {}
    if "drawflow" in graph and isinstance(graph.get("drawflow"), dict):
        if "Home" in graph["drawflow"]:
            return graph["drawflow"]["Home"].get("data", {})
        if "drawflow" in graph["drawflow"]:
            return graph["drawflow"]["drawflow"].get("Home", {}).get("data", {})
    if "Home" in graph and isinstance(graph.get("Home"), dict):
        return graph["Home"].get("data", {})
    if "nodes" in graph and isinstance(graph.get("nodes"), dict):
        return graph["nodes"]
    return graph

def _extract_generation_nodes(graph):
    data = _extract_graph_data(graph)
    sample_nodes = []
    output_nodes = []
    def _sort_key(item):
        try:
            return int(item[0])
        except Exception:
            return 10**9
    for nid, nd in sorted((data or {}).items(), key=_sort_key):
        name = str((nd or {}).get("name", "") or "")
        cfg = (nd or {}).get("data", {}) or {}
        if name == "sample_z_layer":
            sample_nodes.append({
                "id": str(nid),
                "dim": int(cfg.get("dim", 128) or 128),
                "distribution": str(cfg.get("distribution", "normal") or "normal"),
            })
        elif name == "output_layer":
            output_nodes.append({
                "id": str(nid),
                "loss": str(cfg.get("loss", "mse") or "mse").lower(),
                "target": str(cfg.get("targetType", cfg.get("target", "")) or "").lower(),
            })
    return {"sampleNodes": sample_nodes, "outputNodes": output_nodes}

def _pick_output(pred, output_index):
    if isinstance(pred, list):
        idx = max(0, min(int(output_index or 0), len(pred) - 1))
        return pred[idx]
    return pred

def _make_time_embedding_gen(t_scalar, dim, batch, device):
    """Sinusoidal time embedding for generation (matches training engine)."""
    import torch as _torch
    half = max(1, dim // 2)
    freqs = _torch.exp(-np.log(10000) * _torch.arange(half, dtype=_torch.float32, device=device) / max(1, half - 1))
    t = _torch.full((batch, 1), t_scalar, dtype=_torch.float32, device=device)
    angles = t * freqs.unsqueeze(0)
    emb = _torch.cat([_torch.sin(angles), _torch.cos(angles)], dim=1)
    if emb.shape[1] > dim:
        emb = emb[:, :dim]
    elif emb.shape[1] < dim:
        emb = _torch.cat([emb, _torch.zeros(batch, dim - emb.shape[1], device=device)], dim=1)
    return emb

def _forward_with_time(model, x, t_norm, batch, graph_data, device, output_index=0):
    """Forward pass that sets time_embed and class_embed before model(x)."""
    import torch as _torch
    model._runtime_time = _torch.full((batch, 1), t_norm, dtype=_torch.float32, device=device)
    return model(x)

def _resolve_output_index(model, graph, output_node_id=""):
    output_ids = [str(x) for x in getattr(model, "output_ids", []) or []]
    if not output_ids:
        return 0
    wanted = str(output_node_id or "").strip()
    if wanted and wanted in output_ids:
        return output_ids.index(wanted)
    gen_nodes = _extract_generation_nodes(graph)
    for node in gen_nodes["outputNodes"]:
        if node["loss"] == "none" and node["id"] in output_ids:
            return output_ids.index(node["id"])
    return 0


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"kind": "error", "message": "Usage: generate_subprocess.py <config.json>"}))
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
    feature_size = int(config.get("featureSize", 40))
    target_size = int(config.get("targetSize", feature_size))
    num_classes = int(config.get("numClasses", 0))
    method = config.get("method", "reconstruct")
    num_samples = int(config.get("numSamples", 16))
    latent_dim = int(config.get("latentDim", 20))
    temperature = float(config.get("temperature", 1.0))
    seed = int(config.get("seed", 42))
    output_node_id = str(config.get("outputNodeId", "") or "").strip()

    # Build + load weights. Generation is meaningless without trained
    # weights — pre-fix this discarded the load return value and
    # silently produced samples from a randomly-initialized model
    # (noise that looks like generated data). Refuse to run on
    # random init; raise so the outer try/except emits kind:"error".
    model = build_model_from_graph(graph, feature_size, target_size, num_classes)
    model = model.to(device)
    if not load_weights_into_model(model, config):
        print(json.dumps({
            "kind": "error",
            "message": (
                "Server generate requires checkpoint weights, but load_weights_into_model "
                "returned False — request likely had no weightSpecs/weightValues, or the "
                "saved checkpoint couldn't be matched against the rebuilt model. Refusing "
                "to generate samples from a randomly-initialized model."
            ),
        }))
        sys.exit(1)
    model.eval()
    output_index = _resolve_output_index(model, graph, output_node_id)
    gen_nodes = _extract_generation_nodes(graph)

    torch.manual_seed(seed)

    # Set class labels for class_embed nodes
    graph_data = _extract_graph_data(graph)
    _has_class_embed = any(
        str(n.get("name", "")).replace("_layer", "") == "class_embed"
        for n in graph_data.values() if isinstance(n, dict)
    )
    if _has_class_embed:
        target_cls = int(config.get("targetClass", -1))
        _nclasses = 10
        for n in graph_data.values():
            if isinstance(n, dict) and str(n.get("name", "")).replace("_layer", "") == "class_embed":
                _nclasses = int((n.get("data") or {}).get("numClasses", 10))
        if target_cls >= 0:
            cls_tensor = torch.zeros(num_samples, _nclasses, device=device)
            cls_tensor[:, min(target_cls, _nclasses - 1)] = 1.0
        else:
            rand_cls = torch.randint(0, _nclasses, (num_samples,), device=device)
            cls_tensor = torch.nn.functional.one_hot(rand_cls, _nclasses).float()
        model._class_labels = cls_tensor

    # Set time=0 for reconstruct (clean input)
    model._runtime_time = torch.zeros(num_samples, 1, dtype=torch.float32, device=device)

    if method == "reconstruct":
        originals = np.array(config.get("originals", []), dtype=np.float32)
        if originals.size == 0:
            print(json.dumps({"kind": "error", "message": "reconstruct requires originals"}))
            sys.exit(1)
        n = min(num_samples, len(originals))
        x = torch.tensor(originals[:n], dtype=torch.float32).to(device)
        if hasattr(model, "_class_labels") and getattr(model, "_class_labels") is not None:
            model._class_labels = model._class_labels[:n]
        model._runtime_time = torch.zeros(n, 1, dtype=torch.float32, device=device)
        with torch.no_grad():
            pred = _pick_output(model(x), output_index).cpu().numpy()
        # per-sample MSE
        metrics = []
        for i in range(n):
            mse = float(np.mean((originals[i] - pred[i]) ** 2))
            metrics.append({"idx": i, "mse": mse})
        avg_mse = float(np.mean([m["mse"] for m in metrics]))
        print(json.dumps({"kind": "result", "result": {
            "method": "reconstruct", "samples": pred.tolist(), "originals": originals[:n].tolist(),
            "numSamples": n, "avgMse": avg_mse, "metrics": metrics, "latents": [], "lossHistory": [],
        }}))

    elif method == "random":
        # For graph-defined sample nodes (GAN-style), run the full graph and select the configured output head.
        if gen_nodes["sampleNodes"]:
            selected = gen_nodes["sampleNodes"][0]
            sample_node_id = str(config.get("sampleNodeId", "") or "").strip()
            for node in gen_nodes["sampleNodes"]:
                if node["id"] == sample_node_id:
                    selected = node
                    break
            dummy = torch.zeros(num_samples, feature_size, device=device)
            with torch.no_grad():
                samples = _pick_output(model(dummy), output_index).cpu().numpy()
            print(json.dumps({"kind": "result", "result": {
                "method": "random", "samples": samples.tolist(), "numSamples": num_samples,
                "latentDim": int(selected.get("dim", latent_dim)),
                "latents": [],
                "lossHistory": [],
            }}))
        else:
            # Extract decoder: find reparam layer, build decoder from there
            decoder, actual_latent_dim = _extract_decoder(model, latent_dim, graph=graph)
            if decoder is None:
                z = torch.randn(num_samples, feature_size, device=device) * temperature
                with torch.no_grad():
                    samples = _pick_output(model(z), output_index).cpu().numpy()
                print(json.dumps({"kind": "result", "result": {
                    "method": "random", "samples": samples.tolist(), "numSamples": num_samples,
                    "latentDim": feature_size, "latents": z.cpu().numpy().tolist(), "lossHistory": [],
                }}))
            else:
                z = torch.randn(num_samples, actual_latent_dim, device=device) * temperature
                with torch.no_grad():
                    samples = decoder(z).cpu().numpy()
                print(json.dumps({"kind": "result", "result": {
                    "method": "random", "samples": samples.tolist(), "numSamples": num_samples,
                    "latentDim": actual_latent_dim, "latents": z.cpu().numpy().tolist(), "lossHistory": [],
                }}))

    elif method == "classifier_guided":
        # optimize z so decoded output is classified as target class
        target_class = int(config.get("targetClass", 0))
        guidance_weight = float(config.get("guidanceWeight", 1.0))
        # Prior weight on ||z||² — anchors the latent near N(0,1) so the
        # decoder produces in-distribution samples instead of adversarial
        # textures that fool the classifier. Mirrors the TF.js side
        # (objectives.classifierGuidance in generation_engine_core.js).
        prior_weight = float(config.get("priorWeight", 0.5))
        steps = int(config.get("steps", 100))
        lr_cg = float(config.get("lr", 0.01))
        # Graph-driven decoder extraction: walks the graph from the reparam
        # node forward to the reconstruction output, ignoring the classifier
        # branch. Without this, branched models (VAE+Classifier) collected
        # classifier-head Dense layers into the decoder Sequential and
        # produced shape mismatches at dec(z).
        decoder, actual_dim = _extract_decoder(model, latent_dim, graph=graph)
        dec = decoder if decoder else model
        # Identify which output head is the classifier so we can score the
        # generated samples against P(target_class) instead of guessing the
        # head index. Falls back to head 0 only when no classification head
        # exists (in which case classifier-guidance is a no-op anyway).
        cls_idx = _find_classifier_output_index(model, graph)
        z = torch.randn(num_samples, actual_dim, device=device, requires_grad=True)
        opt = torch.optim.Adam([z], lr=lr_cg)
        loss_history = []
        for step in range(steps):
            opt.zero_grad()
            generated = dec(z)
            # Run the full model to get all output heads; pick the
            # classification head explicitly.
            full_out = model(generated)
            cls_out = _pick_output(full_out, cls_idx if cls_idx is not None else 0)
            if cls_idx is None or (hasattr(cls_out, "shape") and cls_out.shape[-1] <= 1):
                # No classifier head — use reconstruction variance as a
                # weak surrogate signal so generation still produces something.
                loss = generated.var() * guidance_weight
            else:
                # maximize probability of target class
                # Apply softmax in case the head outputs raw logits (PyTorch
                # CE expects logits but here we already have post-softmax in
                # most demos; clamp guards either way).
                if cls_out.dim() > 1 and cls_out.shape[-1] > 1:
                    probs = torch.softmax(cls_out, dim=-1)
                else:
                    probs = cls_out
                target_idx = max(0, min(target_class, probs.shape[-1] - 1))
                log_prob = torch.log(probs[:, target_idx].clamp(min=1e-8))
                loss = -log_prob.mean() * guidance_weight
                if prior_weight > 0:
                    loss = loss + prior_weight * z.pow(2).mean()
            loss.backward()
            opt.step()
            loss_history.append({"step": step, "loss": float(loss.item())})
        samples = dec(z).detach().cpu().numpy()
        print(json.dumps({"kind": "result", "result": {
            "method": "classifier_guided", "samples": samples.tolist(), "numSamples": num_samples,
            "latentDim": actual_dim, "latents": z.detach().cpu().numpy().tolist(), "lossHistory": loss_history,
        }}))

    elif method == "optimize":
        # optimize z to minimize reconstruction toward target
        originals = np.array(config.get("originals", []), dtype=np.float32)
        decoder, actual_dim = _extract_decoder(model, latent_dim, graph=graph)
        dec = decoder if decoder else model
        z = torch.randn(num_samples, actual_dim, device=device, requires_grad=True)
        opt = torch.optim.Adam([z], lr=float(config.get("lr", 0.01)))
        target = torch.tensor(originals[:num_samples], dtype=torch.float32).to(device) if originals.size > 0 else None
        loss_history = []
        for step in range(int(config.get("steps", 100))):
            opt.zero_grad()
            out = dec(z)
            if dec is model:
                out = _pick_output(out, output_index)
            if target is not None:
                loss = torch.nn.MSELoss()(out, target)
            else:
                loss = out.var()  # minimize variance as fallback
            loss.backward()
            opt.step()
            loss_history.append({"step": step, "loss": float(loss.item())})
        final_out = dec(z)
        if dec is model:
            final_out = _pick_output(final_out, output_index)
        samples = final_out.detach().cpu().numpy()
        print(json.dumps({"kind": "result", "result": {
            "method": "optimize", "samples": samples.tolist(), "numSamples": num_samples,
            "latentDim": actual_dim, "latents": z.detach().cpu().numpy().tolist(), "lossHistory": loss_history,
        }}))

    elif method == "langevin":
        # Two algorithms gated by config["init"]:
        #   "noise" (default): legacy. x ~ N(0, T). Each step: x = model(x) + noise.
        #     Works for time-conditional / multi-σ score networks.
        #   "uniform": walk-jump (Saremi & Hyvärinen 2019). x ~ U(0,1). Each step:
        #     x_noisy = x + N(0, walkNoise * t_norm); x = model(x_noisy). Required
        #     for single-noise-scale denoisers because they cannot refine OOD
        #     inputs — the input must stay inside the {x_clean + N(0, σ_train)}
        #     manifold or all samples collapse to the model's "default OOD
        #     response" attractor.
        steps = int(config.get("steps", 50))
        epsilon = float(config.get("lr", 0.3))
        init_mode = str(config.get("init", "noise")).lower()
        walk_noise = float(config.get("walkNoise", 0.0))
        clean_fraction = float(config.get("cleanFraction", 0.2))
        gen = torch.Generator(device=device).manual_seed(seed)
        if init_mode == "uniform":
            x = torch.rand(num_samples, feature_size, device=device, generator=gen)
        else:
            x = torch.randn(num_samples, feature_size, device=device, generator=gen) * temperature
        loss_history = []
        with torch.no_grad():
            for step in range(steps):
                t_norm = (steps - 1 - step) / max(1, steps - 1)

                # Walk-jump σ schedule:
                #   t_norm > cleanFraction → constant σ = walkNoise (mixing)
                #   t_norm ≤ cleanFraction → linear decay to 0 (settling)
                # Constant σ during the walk phase lets the Markov chain mix
                # toward the data distribution; linear decay only at the end
                # gives the model room to denoise to a clean final sample.
                x_perturbed = x
                if walk_noise > 0:
                    if 0 < clean_fraction < 1:
                        sigma_t = walk_noise if t_norm > clean_fraction else walk_noise * (t_norm / clean_fraction)
                    else:
                        sigma_t = walk_noise * t_norm
                    if sigma_t > 0:
                        x_perturbed = x + torch.randn(x.shape, device=device, generator=gen) * sigma_t

                x0_pred = _pick_output(_forward_with_time(model, x_perturbed, t_norm, num_samples, graph_data, device, output_index), output_index)
                mse = float(((x0_pred - x) ** 2).mean().item())
                loss_history.append({"step": step, "loss": mse})

                # Output-space Langevin noise (typically 0 for walk-jump).
                noise_level = max(0, (1 - (step + 1) / steps)) * epsilon
                if noise_level > 0:
                    x = x0_pred + torch.randn(x.shape, device=device, generator=gen) * noise_level
                else:
                    x = x0_pred
        samples = x.cpu().numpy()
        print(json.dumps({"kind": "result", "result": {
            "method": "langevin", "samples": samples.tolist(), "numSamples": num_samples,
            "latentDim": feature_size, "latents": [], "lossHistory": loss_history,
        }}))

    elif method == "inverse":
        # optimize input x to match target output
        target = np.array(config.get("target", config.get("originals", [])), dtype=np.float32)
        if target.size == 0:
            print(json.dumps({"kind": "error", "message": "inverse requires target"})); sys.exit(1)
        n = min(num_samples, len(target))
        target_t = torch.tensor(target[:n], dtype=torch.float32).to(device)
        x_opt = torch.randn(n, feature_size, device=device, requires_grad=True)
        opt = torch.optim.Adam([x_opt], lr=float(config.get("lr", 0.01)))
        loss_history = []
        for step in range(int(config.get("steps", 100))):
            opt.zero_grad()
            pred = _pick_output(model(x_opt), output_index)
            loss = torch.nn.MSELoss()(pred, target_t)
            loss.backward()
            opt.step()
            loss_history.append({"step": step, "loss": float(loss.item())})
        samples = _pick_output(model(x_opt), output_index).detach().cpu().numpy()
        print(json.dumps({"kind": "result", "result": {
            "method": "inverse", "samples": samples.tolist(), "numSamples": n,
            "latentDim": feature_size, "latents": x_opt.detach().cpu().numpy().tolist(), "lossHistory": loss_history,
        }}))

    elif method == "ddpm":
        # DDPM reverse process with x0-prediction (sigmoid denoisers predict clean image)
        T = int(config.get("steps", 50))
        beta_end = min(0.5, 0.02 * 1000 / max(1, T))  # scale for fewer steps
        betas = np.linspace(0.0001, beta_end, T)
        alphas = 1 - betas
        alpha_bar = np.cumprod(alphas)
        x_t = torch.randn(num_samples, feature_size, device=device)
        with torch.no_grad():
            for t in reversed(range(T)):
                x0_pred = _pick_output(_forward_with_time(model, x_t, t / T, num_samples, graph_data, device, output_index), output_index)
                alpha_bar_prev = alpha_bar[t - 1] if t > 0 else 1.0
                coeff1 = (alpha_bar_prev ** 0.5) * betas[t] / (1 - alpha_bar[t])
                coeff2 = (alphas[t] ** 0.5) * (1 - alpha_bar_prev) / (1 - alpha_bar[t])
                x_prev = x0_pred * coeff1 + x_t * coeff2
                if t > 0:
                    sigma = (betas[t] * (1 - alpha_bar_prev) / (1 - alpha_bar[t])) ** 0.5
                    x_prev = x_prev + sigma * torch.randn_like(x_prev)
                x_t = x_prev
        samples = x_t.cpu().numpy()
        print(json.dumps({"kind": "result", "result": {
            "method": "ddpm", "samples": samples.tolist(), "numSamples": num_samples,
            "latentDim": feature_size, "latents": [], "lossHistory": [],
        }}))

    else:
        print(json.dumps({"kind": "error", "message": f"Unsupported method: {method}"}))
        sys.exit(1)


def _extract_decoder(model, default_latent_dim, graph=None):
    """Graph-driven decoder extraction: trace the path from the reparam node
    forward to the *reconstruction* output head, collect only nodes on that
    path, and rebuild a Sequential from the corresponding torch modules.

    Mirrors src/model_builder_core.js:extractDecoder. Critical for branched
    architectures (VAE+Classifier) where the classifier head shares the
    encoder and would otherwise be incorrectly included by a naive
    "all-layers-after-reparam" sweep — producing shape mismatches like
    `mat1 and mat2 shapes cannot be multiplied (2x16 and 784x256)` because
    the classifier's first dense layer (16→256) ends up after the decoder's
    Dense(784) output in module-registration order.

    Returns (decoder_module, latent_dim). If the graph is missing or the
    trace fails, falls back to the legacy "after-reparam" heuristic so
    pure-sequential VAEs still work.
    """
    try:
        graph_data = _extract_graph_data(graph) if graph else {}
        if graph_data:
            decoder_seq, latent_d = _build_decoder_from_graph(model, graph_data, default_latent_dim)
            if decoder_seq is not None:
                return decoder_seq, latent_d
        return _extract_decoder_legacy(model, default_latent_dim)
    except Exception:
        try:
            return _extract_decoder_legacy(model, default_latent_dim)
        except Exception:
            return None, default_latent_dim


def _build_decoder_from_graph(model, graph_data, default_latent_dim):
    """Trace reparam → reconstruction-output path and assemble decoder."""
    import torch.nn as nn

    if not isinstance(graph_data, dict) or not graph_data:
        return None, default_latent_dim

    nodes = {str(k): v for k, v in graph_data.items() if isinstance(v, dict)}
    if not nodes:
        return None, default_latent_dim

    def _node_name(nid):
        return str(nodes.get(nid, {}).get("name", "") or "").replace("_layer", "")

    def _node_data(nid):
        return nodes.get(nid, {}).get("data", {}) or {}

    def _outgoing(nid):
        outs = (nodes.get(nid, {}).get("outputs", {}) or {})
        edges = []
        for port_name, port in outs.items():
            for c in (port or {}).get("connections", []) or []:
                edges.append(str(c.get("node", "") or ""))
        return [e for e in edges if e]

    def _is_recon_output(nid):
        if _node_name(nid) != "output":
            return False
        # Reconstruction = "produces a target the decoder is meant to fit"
        # = "not a classifier head AND not a latent KL aux output."
        d = _node_data(nid)
        if _is_classification_node_data(d):
            return False
        head = str(d.get("headType", "") or "").strip().lower()
        if head == "latent_kl":
            return False
        return True

    # Find reparam node (preferred: explicit reparam_layer; fallback: node
    # whose name contains "reparam" — the JS side names internal layers
    # `reparam_add_<id>` and `reparam_noise_<id>` so we accept both).
    reparam_id = None
    for nid in nodes:
        name = _node_name(nid)
        if name == "reparam" or "reparam" in name:
            reparam_id = nid
            break
    if reparam_id is None:
        return None, default_latent_dim

    # Find the reconstruction output reachable from reparam (ignore
    # classification heads). BFS forward.
    recon_output_id = None
    seen = set()
    queue = [reparam_id]
    while queue:
        cur = queue.pop(0)
        if cur in seen:
            continue
        seen.add(cur)
        if cur != reparam_id and _is_recon_output(cur):
            recon_output_id = cur
            break
        for nxt in _outgoing(cur):
            if nxt not in seen:
                queue.append(nxt)
    if recon_output_id is None:
        return None, default_latent_dim

    # Collect ordered node IDs on the path from reparam to recon_output via
    # forward BFS, restricting to nodes that lead to recon_output. Two-pass:
    # (1) reachable forward from reparam, (2) reachable backward from
    # recon_output. Intersection is the decoder path.
    forward_reach = set()
    queue = [reparam_id]
    while queue:
        cur = queue.pop(0)
        if cur in forward_reach:
            continue
        forward_reach.add(cur)
        for nxt in _outgoing(cur):
            queue.append(nxt)

    # Build reverse adjacency for backward reach.
    reverse_adj = {}
    for nid in nodes:
        for nxt in _outgoing(nid):
            reverse_adj.setdefault(nxt, []).append(nid)

    backward_reach = set()
    queue = [recon_output_id]
    while queue:
        cur = queue.pop(0)
        if cur in backward_reach:
            continue
        backward_reach.add(cur)
        for prev in reverse_adj.get(cur, []):
            queue.append(prev)

    on_path = forward_reach & backward_reach
    on_path.discard(reparam_id)  # reparam itself is not part of the decoder
    on_path.discard(recon_output_id)  # output_layer adds no new params

    # Topo-sort the path nodes by graph dependency order, NOT numeric ID.
    # Codex caught this: numeric ID is creation order, which only happens
    # to coincide with dependency order for the demo presets we ship; a
    # user-built graph that creates nodes out of dependency order would
    # break the decoder Sequential's input/output dim chain.
    # Standard Kahn's algorithm restricted to the on_path subgraph.
    indegree_path = {nid: 0 for nid in on_path}
    for nid in on_path:
        for nxt in _outgoing(nid):
            if nxt in indegree_path:
                indegree_path[nxt] += 1
    # Stable tie-break by numeric ID so the order is deterministic across
    # equivalent topo sorts.
    def _stable_key(nid):
        try:
            return int(nid)
        except Exception:
            return 10**9
    ready = sorted([nid for nid, d in indegree_path.items() if d == 0], key=_stable_key)
    ordered = []
    while ready:
        cur = ready.pop(0)
        ordered.append(cur)
        for nxt in _outgoing(cur):
            if nxt in indegree_path:
                indegree_path[nxt] -= 1
                if indegree_path[nxt] == 0:
                    # Insertion-sort into ready by stable key.
                    nxt_key = _stable_key(nxt)
                    inserted = False
                    for i, existing in enumerate(ready):
                        if _stable_key(existing) > nxt_key:
                            ready.insert(i, nxt)
                            inserted = True
                            break
                    if not inserted:
                        ready.append(nxt)
    if len(ordered) != len(on_path):
        # Cycle detected — fall back to numeric ID order so we still produce
        # something rather than crashing. (Should never happen on a valid
        # graph; cycle would have been caught at training time too.)
        ordered = sorted(on_path, key=_stable_key)

    # Map each node to its registered torch module. Naming follows
    # train_subprocess.py: dense_<id>, rnn_<id>, drop_<id>, bn_<id>, ln_<id>,
    # relu_<id>, lrelu_<id>, etc. Unknown node types are skipped (they may
    # be metadata-only, e.g., reshape/feature blocks that don't add params).
    decoder_layers = []
    layer_prefixes = ["dense", "rnn", "drop", "bn", "ln", "relu", "lrelu", "act"]
    for nid in ordered:
        for prefix in layer_prefixes:
            attr = f"{prefix}_{nid}"
            if hasattr(model, attr):
                decoder_layers.append(getattr(model, attr))

    if not decoder_layers:
        return None, default_latent_dim

    # Determine the actual latent dim from the FIRST decoder linear layer's
    # in_features, falling back to default if unavailable.
    latent_dim_actual = default_latent_dim
    for layer in decoder_layers:
        if isinstance(layer, nn.Linear):
            latent_dim_actual = layer.in_features
            break

    class Decoder(nn.Module):
        def __init__(self, layers):
            super().__init__()
            self.layers = nn.ModuleList(layers)

        def forward(self, z):
            x = z
            for layer in self.layers:
                if isinstance(layer, (nn.LSTM, nn.GRU, nn.RNN)):
                    if x.dim() == 2:
                        x = x.unsqueeze(1)
                    x, _ = layer(x)
                    if x.dim() == 3:
                        x = x[:, -1, :]
                else:
                    x = layer(x)
            return x

    device = next(model.parameters()).device
    return Decoder(decoder_layers).to(device), latent_dim_actual


_RECON_HEAD_TYPES = ("reconstruction", "autoencoder", "denoiser", "segmentation_mask", "segmentation")
_RECON_TARGETS = (
    "pixel_values", "pixels", "image", "images",
    "mask", "masks", "segmentation_mask", "seg_mask", "binary_mask",
    "reconstruction", "recon", "xv",
)
_LABEL_TARGETS = ("label", "labels", "logits", "class", "classes", "target_class", "scenario")
_CE_LOSSES = (
    "ce", "crossentropy", "categoricalcrossentropy",
    "sparsecategoricalcrossentropy", "binarycrossentropy",
)


def _is_reconstruction_node_data(node_data):
    """Positive recon-head signals. BCE-loss image VAEs and segmentation
    UNets are valid reconstruction heads — explicit recon signals must
    override classifier-side detection so they aren't false-positived."""
    if not isinstance(node_data, dict):
        return False
    head = str(node_data.get("headType", "") or "").strip().lower()
    if head in _RECON_HEAD_TYPES:
        return True
    for target_field in ("target", "targetType"):
        tgt = str(node_data.get(target_field, "") or "").strip().lower()
        if tgt in _RECON_TARGETS:
            return True
    return False


def _is_classification_node_data(node_data):
    """Single source of truth for "is this output node a classification head?"
    Used by both _is_recon_output (to exclude classifiers from decoder
    extraction) and _find_classifier_output_index (to pick the classifier
    for guided-generation scoring).

    Codex review history embedded in this function:

      Round-1: only checked headType — missed graphs with loss=ce / no
        headType. Fixed by also checking loss aliases.
      Round-3: the two helpers drifted (filter checked target, resolver
        didn't). Fixed by extracting this shared helper.
      Round-4: BCE was treated as classification by itself, but BCE is
        ALSO the standard loss for image VAEs (sigmoid pixel outputs)
        and binary segmentation masks. Such heads were being routed
        away from decoder extraction. Fixed: when an explicit recon
        signal (headType ∈ {reconstruction, autoencoder, denoiser,
        segmentation, segmentation_mask} OR target ∈ {pixel_values,
        mask, segmentation_mask, reconstruction, ...}) is present, the
        node is NOT classification — even if loss=BCE.

    Decision order:
      1. Explicit classification signals (headType=classification OR
         label-like target) → True. These are unambiguous.
      2. Explicit reconstruction signals → False, even with CE/BCE loss.
         Required for BCE-loss image VAEs and seg-mask UNets.
      3. CE-family loss WITHOUT recon signal → True. Catches legacy
         classifier graphs that omit headType/target.
      4. Otherwise → False.
    """
    if not isinstance(node_data, dict):
        return False

    head = str(node_data.get("headType", "") or "").strip().lower()
    # (1) unambiguous classification headType
    if head == "classification":
        return True
    # (1b) label-like target → unambiguous classification
    for target_field in ("target", "targetType"):
        tgt = str(node_data.get(target_field, "") or "").strip().lower()
        if tgt in _LABEL_TARGETS:
            return True
    # (2) explicit recon signal overrides loss-based classifier detection.
    if _is_reconstruction_node_data(node_data):
        return False
    # (3) CE-family loss without an explicit recon signal → classifier.
    loss = str(node_data.get("loss", "") or "").strip().lower().replace("_", "").replace("-", "")
    if loss in _CE_LOSSES:
        return True
    return False


def _find_classifier_output_index(model, graph):
    """Return the index in model.output_ids that corresponds to the
    classification head, or None if no classifier output exists.

    Used by classifier_guided generation: after decoding z, run the full
    model to get all heads, then pick the classifier head explicitly via
    this index. Mirrors the JS-side classifierOutputIndex resolution in
    src/tabs/generation_tab.js. Uses the same _is_classification_node_data
    triple-filter as decoder extraction so the two stay consistent."""
    output_ids = [str(x) for x in getattr(model, "output_ids", []) or []]
    if not output_ids:
        return None
    graph_data = _extract_graph_data(graph) if graph else {}
    for nid in output_ids:
        nd = (graph_data or {}).get(nid, {}) or {}
        d = nd.get("data", {}) or {}
        if _is_classification_node_data(d):
            return output_ids.index(nid)
    return None


def _extract_decoder_legacy(model, default_latent_dim):
    """Legacy "all-layers-after-reparam" extraction. Kept as fallback for
    pure-sequential VAEs where the graph isn't passed in."""
    import torch.nn as nn
    named = list(model.named_modules())
    reparam_idx = -1
    reparam_out_dim = default_latent_dim

    for idx, (name, mod) in enumerate(named):
        if "reparam" in name.lower():
            reparam_idx = idx
            if hasattr(mod, "weight"):
                reparam_out_dim = mod.out_features if hasattr(mod, "out_features") else default_latent_dim
            break

    if reparam_idx < 0:
        min_dim = float("inf")
        for idx, (name, mod) in enumerate(named):
            if hasattr(mod, "out_features") and mod.out_features < min_dim:
                min_dim = mod.out_features
                reparam_idx = idx
                reparam_out_dim = min_dim

    if reparam_idx < 0:
        return None, default_latent_dim

    decoder_layers = []
    for idx, (name, mod) in enumerate(named):
        if idx <= reparam_idx:
            continue
        if isinstance(mod, (nn.Linear, nn.LSTM, nn.GRU, nn.RNN, nn.ReLU, nn.Tanh, nn.Sigmoid,
                            nn.BatchNorm1d, nn.LayerNorm, nn.Dropout)):
            decoder_layers.append(mod)

    if not decoder_layers:
        return None, default_latent_dim

    class Decoder(nn.Module):
        def __init__(self, layers):
            super().__init__()
            self.layers = nn.ModuleList(layers)

        def forward(self, z):
            x = z
            for layer in self.layers:
                if isinstance(layer, (nn.LSTM, nn.GRU, nn.RNN)):
                    if x.dim() == 2:
                        x = x.unsqueeze(1)
                    x, _ = layer(x)
                    if x.dim() == 3:
                        x = x[:, -1, :]
                else:
                    x = layer(x)
            return x

    return Decoder(decoder_layers).to(next(model.parameters()).device), reparam_out_dim


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(json.dumps({"kind": "error", "message": f"{type(e).__name__}: {e}\n{traceback.format_exc()}"}))
        sys.exit(1)

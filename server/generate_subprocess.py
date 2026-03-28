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
    from predict_subprocess import _load_weights

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

    # Build + load weights
    model = build_model_from_graph(graph, feature_size, target_size, num_classes)
    model = model.to(device)
    _load_weights(model, config)
    model.eval()

    torch.manual_seed(seed)

    if method == "reconstruct":
        originals = np.array(config.get("originals", []), dtype=np.float32)
        if originals.size == 0:
            print(json.dumps({"kind": "error", "message": "reconstruct requires originals"}))
            sys.exit(1)
        n = min(num_samples, len(originals))
        x = torch.tensor(originals[:n], dtype=torch.float32).to(device)
        with torch.no_grad():
            pred = model(x).cpu().numpy()
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
        # Extract decoder: find reparam layer, build decoder from there
        decoder, actual_latent_dim = _extract_decoder(model, latent_dim)
        if decoder is None:
            # no decoder found — use full model with random input
            z = torch.randn(num_samples, feature_size, device=device) * temperature
            with torch.no_grad():
                samples = model(z).cpu().numpy()
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
        steps = int(config.get("steps", 100))
        lr_cg = float(config.get("lr", 0.01))
        decoder, actual_dim = _extract_decoder(model, latent_dim)
        dec = decoder if decoder else model
        z = torch.randn(num_samples, actual_dim, device=device, requires_grad=True)
        opt = torch.optim.Adam([z], lr=lr_cg)
        loss_history = []
        for step in range(steps):
            opt.zero_grad()
            generated = dec(z)
            # use full model as classifier
            cls_out = model(generated)
            if cls_out.shape[-1] <= 1:
                # model doesn't have classification output — use reconstruction loss
                loss = generated.var() * guidance_weight
            else:
                # maximize probability of target class
                log_prob = torch.log(cls_out[:, target_class].clamp(min=1e-8))
                loss = -log_prob.mean() * guidance_weight
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
        decoder, actual_dim = _extract_decoder(model, latent_dim)
        dec = decoder if decoder else model
        z = torch.randn(num_samples, actual_dim, device=device, requires_grad=True)
        opt = torch.optim.Adam([z], lr=float(config.get("lr", 0.01)))
        target = torch.tensor(originals[:num_samples], dtype=torch.float32).to(device) if originals.size > 0 else None
        loss_history = []
        for step in range(int(config.get("steps", 100))):
            opt.zero_grad()
            out = dec(z)
            if target is not None:
                loss = torch.nn.MSELoss()(out, target)
            else:
                loss = out.var()  # minimize variance as fallback
            loss.backward()
            opt.step()
            loss_history.append({"step": step, "loss": float(loss.item())})
        samples = dec(z).detach().cpu().numpy()
        print(json.dumps({"kind": "result", "result": {
            "method": "optimize", "samples": samples.tolist(), "numSamples": num_samples,
            "latentDim": actual_dim, "latents": z.detach().cpu().numpy().tolist(), "lossHistory": loss_history,
        }}))

    elif method == "langevin":
        # Langevin dynamics: iterative denoising from noise
        steps = int(config.get("steps", 50))
        lr = float(config.get("lr", 0.01))
        x = torch.randn(num_samples, feature_size, device=device, requires_grad=True)
        loss_history = []
        for step in range(steps):
            pred = model(x)
            score = (pred - x).mean()
            grad = torch.autograd.grad(score, x, create_graph=False)[0]
            noise = torch.randn_like(x) * (lr ** 0.5) * temperature
            x = (x + lr * grad + noise).detach().requires_grad_(True)
            loss_history.append({"step": step, "loss": float(score.item())})
        samples = x.detach().cpu().numpy()
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
            pred = model(x_opt)
            loss = torch.nn.MSELoss()(pred, target_t)
            loss.backward()
            opt.step()
            loss_history.append({"step": step, "loss": float(loss.item())})
        samples = model(x_opt).detach().cpu().numpy()
        print(json.dumps({"kind": "result", "result": {
            "method": "inverse", "samples": samples.tolist(), "numSamples": n,
            "latentDim": feature_size, "latents": x_opt.detach().cpu().numpy().tolist(), "lossHistory": loss_history,
        }}))

    elif method == "ddpm":
        # DDPM iterative denoising
        T = int(config.get("steps", 50))
        betas = np.linspace(0.0001, 0.02, T)
        alphas = 1 - betas
        alpha_bar = np.cumprod(alphas)
        x_t = torch.randn(num_samples, feature_size, device=device)
        with torch.no_grad():
            for t in reversed(range(T)):
                pred = model(x_t)
                noise_pred = (x_t - pred * alpha_bar[t]**0.5) / max((1 - alpha_bar[t])**0.5, 1e-8)
                x_prev = (x_t - betas[t] / max((1 - alpha_bar[t])**0.5, 1e-8) * noise_pred) / alphas[t]**0.5
                if t > 0:
                    x_prev = x_prev + betas[t]**0.5 * torch.randn_like(x_prev)
                x_t = x_prev
        samples = x_t.cpu().numpy()
        print(json.dumps({"kind": "result", "result": {
            "method": "ddpm", "samples": samples.tolist(), "numSamples": num_samples,
            "latentDim": feature_size, "latents": [], "lossHistory": [],
        }}))

    else:
        print(json.dumps({"kind": "error", "message": f"Unsupported method: {method}"}))
        sys.exit(1)


def _extract_decoder(model, default_latent_dim):
    """Try to extract decoder layers after the reparam/bottleneck point."""
    try:
        named = list(model.named_modules())
        reparam_idx = -1
        reparam_out_dim = default_latent_dim

        # find reparam or bottleneck
        for idx, (name, mod) in enumerate(named):
            if "reparam" in name.lower():
                reparam_idx = idx
                # try to get output dim from the noise projection layer
                if hasattr(mod, "weight"):
                    reparam_out_dim = mod.out_features if hasattr(mod, "out_features") else default_latent_dim
                break

        if reparam_idx < 0:
            # find bottleneck: smallest linear layer
            min_dim = float("inf")
            for idx, (name, mod) in enumerate(named):
                if hasattr(mod, "out_features") and mod.out_features < min_dim:
                    min_dim = mod.out_features
                    reparam_idx = idx
                    reparam_out_dim = min_dim

        if reparam_idx < 0:
            return None, default_latent_dim

        # Build sequential decoder from layers after reparam
        import torch.nn as nn
        decoder_layers = []
        found_start = False
        for idx, (name, mod) in enumerate(named):
            if idx <= reparam_idx:
                continue
            if not found_start:
                found_start = True
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

    except Exception:
        return None, default_latent_dim


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(json.dumps({"kind": "error", "message": f"{type(e).__name__}: {e}\n{traceback.format_exc()}"}))
        sys.exit(1)

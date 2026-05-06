#!/usr/bin/env python3
"""Server-side parity test for walk-jump Langevin.

Runs server/generate_subprocess.py with the FM-Benchmark Denoiser graph +
pretrained weights, once with legacy init=noise and once with init=uniform +
walkNoise=0.3, and checks that walk-jump produces visibly more diverse
samples — the same property the client-side Node test verifies.
"""
import base64
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent

# Load preset graph for m-denoiser via Node (preset.js is browser-shaped JS).
ext_js = """
const fs = require("fs");
const vm = require("vm");
const ctx = { window: {}, Date: Date };
vm.runInNewContext(fs.readFileSync(process.argv[2], "utf8"), ctx);
const preset = Object.keys(ctx.window).map(k => ctx.window[k]).find(v => v && v.models);
const m = preset.models.find(m => m.id === "m-denoiser");
process.stdout.write(JSON.stringify(m.graph));
"""
ext_path = REPO / "tmp_extract_denoiser.js"
ext_path.write_text(ext_js)
try:
    out = subprocess.check_output(
        ["node", str(ext_path), str(REPO / "demo/Fashion-MNIST-Benchmark/preset.js")]
    )
    graph = json.loads(out.decode())
finally:
    ext_path.unlink()

# Load pretrained artifact
art_src = (REPO / "demo/Fashion-MNIST-Benchmark/m7_denoising_ae_pretrained.js").read_text()
b64 = re.search(r'=\s*"([A-Za-z0-9+/=]+)"', art_src).group(1)
b = base64.b64decode(b64)
hdr_len = struct.unpack("<I", b[:4])[0]
hdr = json.loads(b[4:4 + hdr_len].decode("utf-8"))
weight_bytes = b[4 + hdr_len:]
n_floats = sum(int(np.prod(s["shape"])) for s in hdr["weightSpecs"])
weights = np.frombuffer(weight_bytes[:n_floats * 4], dtype="<f4").copy().tolist()


def run_server_langevin(label: str, extra_cfg: dict) -> dict:
    cfg = {
        "graph": graph,
        "weightSpecs": hdr["weightSpecs"],
        "weightValues": weights,
        "featureSize": 784,
        "targetSize": 784,
        "numClasses": 10,
        "method": "langevin",
        "numSamples": 16,
        "steps": 100,
        "lr": 0.0,
        "temperature": 1.0,
        "seed": 42,
    }
    cfg.update(extra_cfg)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(cfg, f)
        cfg_path = f.name
    try:
        # Use the Python that has torch installed. Caller can override via
        # SURROGATE_SERVER_PY (e.g. the server's venv). Default: sys.executable
        # — works whenever torch is in the same env that runs this script.
        py = os.environ.get("SURROGATE_SERVER_PY") or sys.executable
        proc = subprocess.run(
            [py, str(REPO / "server/generate_subprocess.py"), cfg_path],
            capture_output=True, text=True, timeout=300,
        )
    finally:
        Path(cfg_path).unlink()

    if proc.returncode != 0:
        print("STDERR:", proc.stderr[-2000:])
        print("STDOUT:", proc.stdout[-2000:])
        raise RuntimeError(f"{label}: server subprocess failed")

    result = None
    for line in proc.stdout.splitlines():
        try:
            msg = json.loads(line)
        except Exception:
            continue
        if msg.get("kind") == "result":
            result = msg["result"]
            break
    if result is None:
        print("STDOUT:", proc.stdout[-1000:])
        raise RuntimeError(f"{label}: no result line in stdout")

    samples = np.array(result["samples"], dtype=np.float32)  # [16, 784]
    per_pixel_std = samples.std(axis=0).mean()
    diffs = []
    for i in range(samples.shape[0]):
        for j in range(i + 1, samples.shape[0]):
            diffs.append(np.linalg.norm(samples[i] - samples[j]))
    avg_l2 = float(np.mean(diffs))
    out = {
        "per_pixel_std": float(per_pixel_std),
        "pairwise_l2": avg_l2,
        "min": float(samples.min()),
        "max": float(samples.max()),
    }
    print(label)
    print(f"  per-pixel std avg: {out['per_pixel_std']:.4f}")
    print(f"  pairwise L2 avg:   {out['pairwise_l2']:.4f}")
    print(f"  output range:      [{out['min']:.3f}, {out['max']:.3f}]")
    return out


print("=== Server-side legacy Langevin (init=noise) ===")
legacy = run_server_langevin("legacy", {})
print()
print("=== Server-side walk-jump (init=uniform, walkNoise=0.3) ===")
walk = run_server_langevin("walkjump", {"init": "uniform", "walkNoise": 0.3, "lr": 0.0})
print()
print("=== Verdict ===")
ratio = walk["pairwise_l2"] / max(1e-6, legacy["pairwise_l2"])
print(f"Diversity ratio (walkjump / legacy L2): {ratio:.2f}x")
if walk["pairwise_l2"] > 1.0 and walk["per_pixel_std"] > 0.05:
    print("PASS: walk-jump produces visibly different samples on server.")
else:
    print("FAIL: server walk-jump samples still look collapsed.")
    sys.exit(1)

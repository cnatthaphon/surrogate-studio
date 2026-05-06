#!/usr/bin/env python3
"""End-to-end BUG-38 verification:

  1. Load the shipped Conv-AE pretrained artifact
  2. Run forward through the SAME PyTorch model that produced the artifact
     (using train_subprocess.py's build_model_from_graph + the artifact's
     ORIGINAL state_dict reconstructed from the tfjs-layout weights)
  3. Run the SAME input through TF.js using the new model_builder_core.js
     conv2dTranspose path (valid + crop)
  4. Assert pixel-level parity: max abs diff < 1e-3

Before BUG-38 fix, TF.js used native `padding="same"` which gave outputs
shifted by (kernel-1)//2 pixels relative to PyTorch's pad=0+crop. After
the fix, TF.js uses `padding="valid"` + cropping2D to match the server
exactly. This test catches regressions on either side.
"""
import json
import subprocess
import sys
import re
import base64
import struct
import os
from pathlib import Path
import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "server"))

import torch

# Load shipped Conv-AE artifact.
art_path = REPO / "demo/Fashion-MNIST-Benchmark/m4_conv_autoencoder_pretrained.js"
src = art_path.read_text()
m = re.search(r'=\s*"([A-Za-z0-9+/=]+)"', src)
b = base64.b64decode(m.group(1))
hdr_len = struct.unpack("<I", b[:4])[0]
hdr = json.loads(b[4:4 + hdr_len].decode("utf-8"))
weight_bytes = b[4 + hdr_len:]
n_floats = sum(int(np.prod(s["shape"])) for s in hdr["weightSpecs"])
weight_buf = np.frombuffer(weight_bytes[:n_floats * 4], dtype="<f4").copy()

# Synthetic test input — Fashion-MNIST-like distribution (mostly dark with a
# centered "garment" patch). Real Fashion-MNIST would be ideal but this is
# representative enough to expose a (kernel-1)//2 pixel shift.
np.random.seed(0)
img = np.zeros((28, 28), dtype=np.float32)
img[8:20, 8:20] = 0.3 + 0.4 * np.random.rand(12, 12).astype(np.float32)  # garment region
flat_img = img.flatten().tolist()

# (1) PyTorch forward via train_subprocess's build_model_from_graph.
from train_subprocess import build_model_from_graph

# Load preset graph for m-conv-ae
preset_src = (REPO / "demo/Fashion-MNIST-Benchmark/preset.js").read_text()
ext_js = """
const fs = require("fs");
const vm = require("vm");
const ctx = { window: {}, Date: Date };
vm.runInNewContext(fs.readFileSync(process.argv[2], "utf8"), ctx);
const preset = Object.keys(ctx.window).map(k => ctx.window[k]).find(v => v && v.models);
const m = preset.models.find(m => m.id === "m-conv-ae");
process.stdout.write(JSON.stringify(m.graph));
"""
ext_path = REPO / "tmp_extract.js"
ext_path.write_text(ext_js)
try:
    out = subprocess.check_output(["node", str(ext_path), str(REPO / "demo/Fashion-MNIST-Benchmark/preset.js")])
    graph = json.loads(out.decode())
finally:
    ext_path.unlink()

# Build PyTorch model + load weights from tfjs-layout artifact.
# train_subprocess + runtime_weight_loader handles the tfjs→torch unpermute
# automatically (it's the inverse of extract_pytorch_state).
from runtime_weight_loader import load_weights_into_model
torch_model = build_model_from_graph(graph, 784, 784, 0).to("cpu").eval()
load_weights_into_model(torch_model, {
    "weightSpecs": hdr["weightSpecs"],
    "weightValues": weight_buf.tolist(),
    "producerRuntime": "python_server",
})

x_torch = torch.tensor(flat_img, dtype=torch.float32).unsqueeze(0)
with torch.no_grad():
    y_torch_full = torch_model(x_torch)
    y_torch = (y_torch_full[0] if isinstance(y_torch_full, (list, tuple)) else y_torch_full).cpu().numpy()
print(f"PyTorch output shape: {y_torch.shape}")
print(f"  PyTorch mean: {y_torch.mean():.6f} min: {y_torch.min():.4f} max: {y_torch.max():.4f}")

# (2) TF.js forward via the new model_builder_core (post-BUG-38 fix).
js_diag = """
"use strict";
var path = require("path");
var fs = require("fs");
var vm = require("vm");
var REPO = process.argv[2];
var imgFlat = JSON.parse(process.argv[3]);
global.window = global;
global.OSCDatasetModules = { registerModule: function () {} };
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var schemaReg = require(path.join(REPO, "src/schema_registry.js"));
global.OSCSchemaRegistry = schemaReg;
require(path.join(REPO, "src/schema_definitions_builtin.js"));
var MBC = require(path.join(REPO, "src/model_builder_core.js"));
var WC = require(path.join(REPO, "src/weight_converter.js"));

(async function () {
  await tf.setBackend("cpu"); await tf.ready();
  var artSrc = fs.readFileSync(path.join(REPO, "demo/Fashion-MNIST-Benchmark/m4_conv_autoencoder_pretrained.js"), "utf8");
  var match = artSrc.match(/=\\s*"([A-Za-z0-9+/=]+)"/);
  var b = Buffer.from(match[1], "base64");
  var hdrLen = b.readUInt32LE(0);
  var hdr = JSON.parse(b.slice(4, 4 + hdrLen).toString("utf8"));
  var weightBytes = b.slice(4 + hdrLen);
  var buf = Buffer.alloc(weightBytes.length);
  weightBytes.copy(buf);
  var weightValues = Array.from(new Float32Array(buf.buffer, 0, Math.floor(buf.length / 4)));

  var presetSrc = fs.readFileSync(path.join(REPO, "demo/Fashion-MNIST-Benchmark/preset.js"), "utf8");
  var sandbox = { window: {}, Date: Date };
  vm.runInNewContext(presetSrc, sandbox);
  var preset = Object.keys(sandbox.window).map(function (k) { return sandbox.window[k]; }).find(function (v) { return v && v.models; });
  var convAe = preset.models.find(function (m) { return m.id === "m-conv-ae"; });

  var built = MBC.buildModelFromGraph(tf, convAe.graph, {
    mode: "direct", featureSize: 784, windowSize: 1, seqFeatureSize: 784,
    targetSize: 784,
    allowedOutputKeys: schemaReg.getOutputKeys("fashion_mnist") || [{ key: "pixel_values", featureSize: 784, headType: "reconstruction" }],
    defaultTarget: "pixel_values", numClasses: 10,
  });
  var artifacts = { weightSpecs: hdr.weightSpecs, weightValues: weightValues, producerRuntime: "python_server" };
  WC.loadArtifactsIntoModel(tf, built.model, artifacts);
  var x = tf.tensor2d([imgFlat]);
  var pred = built.model.predict(x);
  var preds = Array.isArray(pred) ? pred : [pred];
  process.stdout.write(JSON.stringify(preds[0].arraySync()[0]));
})().catch(function (e) { console.error(e); process.exit(1); });
"""
js_path = REPO / "tmp_tfjs_diag.js"
js_path.write_text(js_diag)
try:
    out = subprocess.check_output(["node", str(js_path), str(REPO), json.dumps(flat_img)], stderr=subprocess.PIPE)
    y_tfjs = np.array(json.loads(out.decode()), dtype=np.float32)
finally:
    js_path.unlink()

print(f"\nTF.js output shape: {y_tfjs.shape}")
print(f"  TF.js mean: {y_tfjs.mean():.6f} min: {y_tfjs.min():.4f} max: {y_tfjs.max():.4f}")

# Compare
y_torch_flat = y_torch.flatten()
diff = np.abs(y_torch_flat - y_tfjs)
print(f"\nMax abs diff (PyTorch vs TF.js): {diff.max():.6f}")
print(f"Mean abs diff: {diff.mean():.6f}")

if diff.max() < 1e-3:
    print("\nPASS: Conv-AE PyTorch and TF.js produce matching pixel outputs (BUG-38 fixed)")
else:
    print("\nFAIL: outputs differ — BUG-38 still present")
    sys.exit(1)

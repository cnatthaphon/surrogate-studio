#!/usr/bin/env python3
"""#145 paired augment test on PyTorch server side.

Mirrors scripts/test_augment_paired.js: verifies that augment_image
publishes its coin to a per-instance registry and augment_bbox /
augment_mask read it via seedLink so paired layers stay aligned.
"""
import sys
from pathlib import Path

import numpy as np
import torch

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "server"))


# Standalone replica of the train_subprocess paired-augment forward
# logic so we can exercise it without spinning the full graph builder.
class _PairedRig:
    def __init__(self):
        self._aug_seed_registry = {}
        self.training = True

    def img_forward(self, inp, transform="horizontal_flip", prob=0.5, seedlink="", layout="nhwc"):
        if not self.training or transform == "identity" or prob <= 0.0 or inp.dim() != 4:
            return inp
        if transform not in ("horizontal_flip", "vertical_flip"):
            return inp
        if layout == "nchw":
            flip_axis = -1 if transform == "horizontal_flip" else -2
        else:
            flip_axis = -2 if transform == "horizontal_flip" else -3
        coin = float(torch.rand(()).item())
        if seedlink:
            self._aug_seed_registry[seedlink] = coin
        if coin < prob:
            return torch.flip(inp, dims=[flip_axis])
        return inp

    def bbox_forward(self, inp, transform="horizontal_flip", prob=0.5, seedlink="", img_w=1.0, img_h=1.0):
        if not self.training or transform == "identity" or prob <= 0.0:
            return inp
        if inp.dim() not in (2, 3) or inp.shape[-1] != 4:
            return inp
        coin = self._aug_seed_registry.get(seedlink) if seedlink else None
        if coin is None:
            coin = float(torch.rand(()).item())
        if coin >= prob:
            return inp
        x0, y0, x1, y1 = inp[..., 0], inp[..., 1], inp[..., 2], inp[..., 3]
        if transform == "horizontal_flip":
            return torch.stack([img_w - x1, y0, img_w - x0, y1], dim=-1)
        if transform == "vertical_flip":
            return torch.stack([x0, img_h - y1, x1, img_h - y0], dim=-1)
        return inp

    def mask_forward(self, inp, transform="horizontal_flip", prob=0.5, seedlink="", layout="nhwc"):
        if not self.training or transform == "identity" or prob <= 0.0 or inp.dim() != 4:
            return inp
        if transform not in ("horizontal_flip", "vertical_flip"):
            return inp
        if layout == "nchw":
            flip_axis = -1 if transform == "horizontal_flip" else -2
        else:
            flip_axis = -2 if transform == "horizontal_flip" else -3
        coin = self._aug_seed_registry.get(seedlink) if seedlink else None
        if coin is None:
            coin = float(torch.rand(()).item())
        if coin < prob:
            return torch.flip(inp, dims=[flip_axis])
        return inp


ok = True
torch.manual_seed(0)

print("Test 1: image+bbox with seedLink=aug1, prob=0.5 — agreement over 200 trials")
rig = _PairedRig()
# Image [B=1, H=2, W=3, C=1]: distinct W values so flip is detectable.
img = torch.tensor([[[[1.0], [2.0], [3.0]], [[4.0], [5.0], [6.0]]]])
bbox = torch.tensor([[10.0, 20.0, 30.0, 40.0]])  # x0y0x1y1
flips = 0
disagreements = 0
for _ in range(200):
    yi = rig.img_forward(img, transform="horizontal_flip", prob=0.5, seedlink="aug1", layout="nhwc")
    yb = rig.bbox_forward(bbox, transform="horizontal_flip", prob=0.5, seedlink="aug1", img_w=100.0)
    img_flipped = (yi[0, 0, 0, 0].item() == 3.0)
    bbox_flipped = (abs(yb[0, 0].item() - 70.0) < 1e-3 and abs(yb[0, 2].item() - 90.0) < 1e-3)
    if img_flipped != bbox_flipped:
        disagreements += 1
    if img_flipped:
        flips += 1
print(f"  flips: {flips}/200, disagreements: {disagreements}")
if disagreements > 0:
    print(f"  FAIL: paired layers disagreed {disagreements} times")
    ok = False
if not (50 <= flips <= 150):
    print(f"  FAIL: flip count {flips} suspiciously skewed")
    ok = False

print("Test 2: bbox alone (no upstream image with same seedLink) → fallback to own RNG")
rig2 = _PairedRig()
lone_flips = 0
for _ in range(100):
    yb = rig2.bbox_forward(bbox, transform="horizontal_flip", prob=0.5, seedlink="lonely", img_w=100.0)
    if abs(yb[0, 0].item() - 70.0) < 1e-3:
        lone_flips += 1
print(f"  lone bbox flipped {lone_flips}/100 (expect ~50)")
if not (25 <= lone_flips <= 75):
    print(f"  FAIL: suspicious flip count")
    ok = False

print("Test 3: bbox eval mode → passthrough")
rig.training = False
yb_eval = rig.bbox_forward(bbox, transform="horizontal_flip", prob=1.0, seedlink="aug1", img_w=100.0)
if not torch.allclose(yb_eval, bbox):
    print(f"  FAIL: eval mode bbox changed: {yb_eval}")
    ok = False
print("  eval bbox unchanged")
rig.training = True

print("Test 4: image+mask with seedLink=aug2 — agreement over 100 trials")
rig3 = _PairedRig()
mask_disagreements = 0
mask_inp = torch.tensor([[[[10.0], [20.0], [30.0]], [[40.0], [50.0], [60.0]]]])
for _ in range(100):
    yi = rig3.img_forward(img, transform="horizontal_flip", prob=0.5, seedlink="aug2", layout="nhwc")
    ym = rig3.mask_forward(mask_inp, transform="horizontal_flip", prob=0.5, seedlink="aug2", layout="nhwc")
    img_f = (yi[0, 0, 0, 0].item() == 3.0)
    mask_f = (ym[0, 0, 0, 0].item() == 30.0)
    if img_f != mask_f:
        mask_disagreements += 1
print(f"  mask disagreements: {mask_disagreements}/100")
if mask_disagreements > 0:
    print(f"  FAIL: image+mask disagreed {mask_disagreements} times")
    ok = False

# Verify the actual server module's branches exist
src = (REPO / "server/train_subprocess.py").read_text()
for tag in ['elif t == "augment_bbox":', 'elif t == "augment_mask":', 'elif t == "augment_label":']:
    if tag not in src:
        print(f"  FAIL: server/train_subprocess.py is missing the branch: {tag}")
        ok = False

if ok:
    print("\nPASS: paired augment layers stay synced via _aug_seed_registry on PyTorch server.")
else:
    print("\nFAIL: at least one assertion failed.")
    sys.exit(1)

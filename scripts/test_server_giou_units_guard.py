#!/usr/bin/env python3
"""Server-side mirror of the JS-side GIoU/units guard.

`src/model_builder_core.js` raises when an Output node carries
`loss: "giou"` (or aliases) but resolves to a non-4-unit head.
`server/train_subprocess.py` must mirror that: a head config arriving
with `loss in ("iou","giou","giou_mse","mse_giou")` and `units != 4`
is a misconfiguration the server should reject before training, not a
shape mismatch that surfaces deep inside the loss tensor op.

Structural test: the loss-dispatch block must read the head's `units`
field and raise ValueError before constructing the GIoU loss closure.
"""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
src = (REPO / "server/train_subprocess.py").read_text()

ok = True

# 1. The GIoU branch must read head_config["units"].
giou_block_start = src.find('elif hl in ("iou", "giou", "giou_mse", "mse_giou"):')
if giou_block_start < 0:
    print("  FAIL: GIoU loss-dispatch block not found")
    sys.exit(1)
# Pull a window of source after the marker — enough to cover the guard
# but not so wide that we accidentally hit unrelated code.
giou_block_end = src.find('elif htype == "classification":', giou_block_start)
if giou_block_end < 0:
    giou_block_end = giou_block_start + 4000
block = src[giou_block_start:giou_block_end]

required_markers = [
    'hc.get("units"',         # reads units from head config
    'raise ValueError(',      # rejects bad config
    '4-unit',                 # error explains the requirement
    'GIoU loss requires',     # error mentions GIoU
]
for marker in required_markers:
    if marker not in block:
        print(f"  FAIL: GIoU guard is missing marker '{marker}'")
        ok = False
if ok:
    print("  ✓ GIoU loss block reads head units and raises ValueError on mismatch")

# 2. The guard must run before the loss closure is appended.
guard_pos = block.find('raise ValueError(')
giou_loss_append = block.find('"fn": _giou_loss')
if guard_pos < 0 or giou_loss_append < 0 or guard_pos > giou_loss_append:
    print("  FAIL: ValueError guard must precede appending the GIoU loss closure")
    ok = False
else:
    print("  ✓ guard precedes the head_losses.append call")

if ok:
    print("\nPASS: server-side GIoU/units guard present.")
else:
    print("\nFAIL: at least one structural check failed.")
    sys.exit(1)

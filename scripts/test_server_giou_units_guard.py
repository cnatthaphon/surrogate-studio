#!/usr/bin/env python3
"""Runtime test for server-side GIoU head gating.

`src/training_engine_core.js` (JS) routes classification heads to softmax
CE *before* they hit a regression loss, and the schema-driven UI only
offers GIoU on heads where the schema declared a `bboxFormat`. The
server has no equivalent routing — it picks the loss purely off
`hc["loss"]`. Without explicit gates a 4-unit classification head with
stale `loss: "giou"` would silently train with bbox math while the
browser would route it correctly. That's the divergence this guard
prevents.

Exercises `_build_giou_head_loss` (helper extracted from
`server/train_subprocess.py`) directly so the dispatch contract is
covered without spinning up the full training loop.

Covered cases:
  - 4-unit regression + bboxFormat="xywh" or "xyxy" → builds OK
  - 4-unit classification + loss="giou" → ValueError (headType)
  - non-4-unit regression + loss="giou" → ValueError (units)
  - missing bboxFormat → ValueError (no silent xywh fallback)
  - unrecognized bboxFormat → ValueError
  - giou_mse alias inherits the same gating
  - the returned loss closure honors xywh vs xyxy on the reviewer's
    reproduction inputs (0.8299 vs 1.0794)
"""
import sys
import importlib.util
from pathlib import Path

import torch  # required to import the module — train_subprocess imports torch at top

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "server"))  # let train_subprocess resolve sibling imports
spec = importlib.util.spec_from_file_location("train_subprocess", REPO / "server/train_subprocess.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

ok = True

def fail(msg):
    global ok
    print(f"  FAIL: {msg}")
    ok = False

def expect_raises(label, exc_type, fn, match=None):
    try:
        fn()
    except exc_type as e:
        if match and match not in str(e):
            fail(f"{label}: error message did not contain {match!r} (got {str(e)!r})")
            return
        print(f"  ✓ {label}")
        return
    except Exception as e:
        fail(f"{label}: expected {exc_type.__name__}, got {type(e).__name__}: {e}")
        return
    fail(f"{label}: expected {exc_type.__name__}, no error raised")

def expect_ok(label, fn):
    try:
        result = fn()
        print(f"  ✓ {label}")
        return result
    except Exception as e:
        fail(f"{label}: unexpected {type(e).__name__}: {e}")
        return None

# --- Case 1: well-formed xywh regression head builds OK.
expect_ok(
    "4-unit regression + bboxFormat=xywh builds",
    lambda: mod._build_giou_head_loss({
        "id": "h1", "loss": "giou", "units": 4,
        "headType": "regression", "bboxFormat": "xywh", "matchWeight": 1.0,
    }),
)

# --- Case 2: 4-unit *classification* head with stale loss="giou" → ValueError.
# This is exactly the divergence the reviewer flagged: JS routes
# classification to softmax CE; the server must reject it instead of
# silently training with bbox math.
expect_raises(
    "4-unit classification + loss=giou → ValueError",
    ValueError,
    lambda: mod._build_giou_head_loss({
        "id": "h2", "loss": "giou", "units": 4,
        "headType": "classification", "bboxFormat": "xywh", "matchWeight": 1.0,
    }),
    match="regression heads",
)

# --- Case 3: non-4-unit regression head → ValueError on units.
expect_raises(
    "10-unit regression + loss=giou → ValueError (units)",
    ValueError,
    lambda: mod._build_giou_head_loss({
        "id": "h3", "loss": "giou", "units": 10,
        "headType": "regression", "bboxFormat": "xywh", "matchWeight": 1.0,
    }),
    match="4-unit",
)

# --- Case 4: regression head, no bboxFormat declared → ValueError.
# Previously the server defaulted to xywh, which is the exact silent
# wrong-geometry bug the JS gate was added to prevent.
expect_raises(
    "regression + missing bboxFormat → ValueError",
    ValueError,
    lambda: mod._build_giou_head_loss({
        "id": "h4", "loss": "giou", "units": 4,
        "headType": "regression", "matchWeight": 1.0,
    }),
    match="bboxFormat",
)

# --- Case 5: unrecognized bboxFormat → ValueError.
expect_raises(
    "regression + bboxFormat='cxcywh' → ValueError",
    ValueError,
    lambda: mod._build_giou_head_loss({
        "id": "h5", "loss": "giou", "units": 4,
        "headType": "regression", "bboxFormat": "cxcywh", "matchWeight": 1.0,
    }),
    match="bboxFormat",
)

# --- Case 6: giou_mse alias inherits all the same gating.
expect_raises(
    "4-unit classification + loss=giou_mse → ValueError",
    ValueError,
    lambda: mod._build_giou_head_loss({
        "id": "h6", "loss": "giou_mse", "units": 4,
        "headType": "classification", "bboxFormat": "xywh", "matchWeight": 1.0,
    }),
    match="regression heads",
)

# --- Case 7: explicit xyxy head builds OK.
ok_entry = expect_ok(
    "4-unit regression + bboxFormat=xyxy builds",
    lambda: mod._build_giou_head_loss({
        "id": "h7", "loss": "giou", "units": 4,
        "headType": "regression", "bboxFormat": "xyxy", "matchWeight": 1.0,
    }),
)

# --- Case 8: the returned closure computes correct geometry for each
# format. Reviewer's reproduction: boxes [0.2,0.2,0.4,0.4] and
# [0.3,0.3,0.5,0.5] → xyxy GIoU loss ≈ 1.0794, xywh ≈ 0.8299.
p = torch.tensor([[0.2, 0.2, 0.4, 0.4]], dtype=torch.float32)
t = torch.tensor([[0.3, 0.3, 0.5, 0.5]], dtype=torch.float32)
xyxy_head = mod._build_giou_head_loss({
    "id": "h8x", "loss": "giou", "units": 4,
    "headType": "regression", "bboxFormat": "xyxy", "matchWeight": 1.0,
})
xywh_head = mod._build_giou_head_loss({
    "id": "h8w", "loss": "giou", "units": 4,
    "headType": "regression", "bboxFormat": "xywh", "matchWeight": 1.0,
})
v_xyxy = float(xyxy_head["fn"](p, t).item())
v_xywh = float(xywh_head["fn"](p, t).item())
if abs(v_xyxy - 1.0794) > 1e-3:
    fail(f"xyxy GIoU loss expected ≈ 1.0794, got {v_xyxy:.4f}")
else:
    print(f"  ✓ xyxy closure returns ≈ 1.0794 (got {v_xyxy:.4f})")
if abs(v_xywh - 0.8299) > 1e-3:
    fail(f"xywh GIoU loss expected ≈ 0.8299, got {v_xywh:.4f}")
else:
    print(f"  ✓ xywh closure returns ≈ 0.8299 (got {v_xywh:.4f})")

# --- Case 9: structural — main dispatch must use the helper, not inline math.
src = (REPO / "server/train_subprocess.py").read_text()
if "_build_giou_head_loss(hc)" not in src:
    fail("main dispatch must call _build_giou_head_loss(hc) so the gates run for every GIoU head")
else:
    print("  ✓ main dispatch routes through _build_giou_head_loss")

if ok:
    print("\nPASS: server-side GIoU gating mirrors JS and rejects misconfigured heads.")
else:
    print("\nFAIL: at least one case failed.")
    sys.exit(1)

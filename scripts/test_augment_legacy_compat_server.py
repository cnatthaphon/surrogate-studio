#!/usr/bin/env python3
"""#184 P2 (server mirror): saved/exported graphs with legacy
{transform, probability} fields must produce working augment nodes on
the PyTorch server, not silent no-ops.

Tests the _resolve_aug_probs helper added to server/train_subprocess.py
and verifies the helper is wired into all three augment dispatches.
"""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "server"))

# Import the helpers directly from the module without running main().
import importlib.util
spec = importlib.util.spec_from_file_location("train_subprocess", REPO / "server/train_subprocess.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

ok = True

def fail(msg):
    global ok
    print(f"  FAIL: {msg}")
    ok = False

def assert_eq(label, got, want):
    if got != want:
        fail(f"{label}: expected {want!r}, got {got!r}")

# Test 1: new shape passthrough
print("Test 1: new {hflipProb,vflipProb} shape passes through unchanged")
hp, vp = mod._resolve_aug_probs({"hflipProb": 0.5, "vflipProb": 0.3})
assert_eq("new hflip", hp, 0.5)
assert_eq("new vflip", vp, 0.3)

# Test 2: legacy horizontal_flip
print("Test 2: legacy {transform:'horizontal_flip', probability:0.7} → hflipProb=0.7, vflipProb=0")
hp, vp = mod._resolve_aug_probs({"transform": "horizontal_flip", "probability": 0.7})
assert_eq("legacy hflip → hflipProb", hp, 0.7)
assert_eq("legacy hflip → vflipProb", vp, 0)

# Test 3: legacy vertical_flip
print("Test 3: legacy {transform:'vertical_flip', probability:1} → hflipProb=0, vflipProb=1")
hp, vp = mod._resolve_aug_probs({"transform": "vertical_flip", "probability": 1})
assert_eq("legacy vflip → hflipProb", hp, 0)
assert_eq("legacy vflip → vflipProb", vp, 1)

# Test 4: legacy identity (and unrecognized) → both 0
print("Test 4: legacy {transform:'identity', probability:1} → both 0")
hp, vp = mod._resolve_aug_probs({"transform": "identity", "probability": 1})
assert_eq("legacy identity", (hp, vp), (0, 0))

hp, vp = mod._resolve_aug_probs({"transform": "rotate_90", "probability": 0.5})
assert_eq("unknown transform", (hp, vp), (0, 0))

# Test 5: defensive — missing config / empty dict
print("Test 5: None / empty dict / missing fields → (0, 0)")
assert_eq("None cfg", mod._resolve_aug_probs(None), (0.0, 0.0))
assert_eq("empty cfg", mod._resolve_aug_probs({}), (0.0, 0.0))
assert_eq("no probs no transform", mod._resolve_aug_probs({"seedLink": "x"}), (0.0, 0.0))

# Test 6: probability clamps
print("Test 6: legacy probability clamps to [0,1]")
hp, vp = mod._resolve_aug_probs({"transform": "horizontal_flip", "probability": -0.5})
assert_eq("negative clamps to 0", hp, 0)
hp, vp = mod._resolve_aug_probs({"transform": "horizontal_flip", "probability": 5})
assert_eq(">1 clamps to 1", hp, 1)
hp, vp = mod._resolve_aug_probs({"transform": "horizontal_flip", "probability": float("nan")})
assert_eq("NaN clamps to 0", hp, 0)

# Test 7: structural — all three augment dispatches must use _resolve_aug_probs
print("Test 7: all three augment dispatches in train_subprocess.py use _resolve_aug_probs")
src = (REPO / "server/train_subprocess.py").read_text()
# The three augment_image / augment_bbox / augment_mask init branches each
# need hp, vp = _resolve_aug_probs(c). Count occurrences.
n = src.count("hp, vp = _resolve_aug_probs(c)")
if n < 3:
    fail(f"_resolve_aug_probs(c) should appear in all 3 augment dispatches; found {n}")
else:
    print(f"  ✓ found {n} _resolve_aug_probs(c) call sites (≥3 = image/bbox/mask covered)")

# Test 8: new shape STILL takes precedence over legacy (if both present)
print("Test 8: when both new and legacy fields present, new wins")
hp, vp = mod._resolve_aug_probs({
    "hflipProb": 0.5, "vflipProb": 0.5,
    "transform": "horizontal_flip", "probability": 1.0,
})
assert_eq("new wins (hp)", hp, 0.5)
assert_eq("new wins (vp)", vp, 0.5)

if ok:
    print("\nPASS: server _resolve_aug_probs handles both shapes and is wired into all augment dispatches.")
else:
    print("\nFAIL: at least one assertion failed.")
    sys.exit(1)

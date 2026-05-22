#!/usr/bin/env python3
"""Server-side strict loss-name validation + classification-alias
consolidation (PR #92).

Three places in train_subprocess.py must agree on "what loss strings
count as classification":
  1. _KNOWN_LOSS_NAMES — allowlist of accepted loss strings
  2. CE dispatch — `elif hl in _CLASSIFICATION_LOSS_ALIASES`
  3. _any_cls_head — decides whether labelsTrain must ship

Reviewer of PR #92's second revision caught that these had drifted —
specifically _any_cls_head still used an inline tuple that omitted
the new aliases. The fix is to root all three on a single module-
level _CLASSIFICATION_LOSS_ALIASES constant. This test asserts:

  - the constant is defined
  - it contains every required classification alias
  - all three call sites reference the constant (no inline drift)
  - the ValueError guard fires before the dispatch chain
"""
import sys
import importlib.util
from pathlib import Path

import torch  # train_subprocess imports torch lazily inside helpers

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "server"))

spec = importlib.util.spec_from_file_location("train_subprocess", REPO / "server/train_subprocess.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

src = (REPO / "server/train_subprocess.py").read_text()
ok = True

# 1. The shared classification-alias constant exists at module level.
if not hasattr(mod, "_CLASSIFICATION_LOSS_ALIASES"):
    print("  FAIL: _CLASSIFICATION_LOSS_ALIASES constant not defined at module level")
    sys.exit(1)
print(f"  ✓ _CLASSIFICATION_LOSS_ALIASES defined ({len(mod._CLASSIFICATION_LOSS_ALIASES)} aliases)")

# 2. The constant covers every classification alias the system should
# accept — including the legacy aliases that the first revision of
# this PR rejected and the second revision allowlisted but the
# detection code missed.
required_cls = {
    "categoricalcrossentropy",
    "categorical_crossentropy",
    "sparsecategoricalcrossentropy",
    "sparse_categorical_crossentropy",
    "cross_entropy",
    "ce",
    "crossentropy",
    "classification",
}
missing = required_cls - set(mod._CLASSIFICATION_LOSS_ALIASES)
if missing:
    print(f"  FAIL: _CLASSIFICATION_LOSS_ALIASES is missing required aliases: {missing}")
    ok = False
else:
    print(f"  ✓ _CLASSIFICATION_LOSS_ALIASES contains all {len(required_cls)} required aliases")

# 3. All three call sites reference the constant, not an inline tuple.
# Definition (1) + allowlist union (1) + CE dispatch (1) + _any_cls_head (1)
# = 4 minimum references.
ref_count = src.count("_CLASSIFICATION_LOSS_ALIASES")
if ref_count < 4:
    print(f"  FAIL: _CLASSIFICATION_LOSS_ALIASES referenced {ref_count} times — expected ≥4 (definition + 3 use sites)")
    ok = False
else:
    print(f"  ✓ _CLASSIFICATION_LOSS_ALIASES referenced {ref_count}× across the file")

# 4. _any_cls_head uses the constant. (Reviewer's specific concern: it
# was an inline tuple that drifted.)
detect_start = src.find("_any_cls_head = any(")
detect_end = src.find(")", detect_start + 200)
if detect_start < 0:
    print("  FAIL: _any_cls_head detection not found")
    ok = False
else:
    detect_block = src[detect_start:detect_end + 1]
    if "_CLASSIFICATION_LOSS_ALIASES" not in detect_block:
        print("  FAIL: _any_cls_head still uses an inline alias tuple (the bug review caught)")
        ok = False
    else:
        print("  ✓ _any_cls_head routes through _CLASSIFICATION_LOSS_ALIASES (no inline-tuple drift)")

# 5. CE dispatch uses the constant.
ce_dispatch_pattern = "elif hl in _CLASSIFICATION_LOSS_ALIASES:"
if ce_dispatch_pattern not in src:
    print("  FAIL: CE dispatch branch does not use _CLASSIFICATION_LOSS_ALIASES")
    ok = False
else:
    print("  ✓ CE dispatch branch routes through _CLASSIFICATION_LOSS_ALIASES")

# 6. The unknown-loss guard still fires before the dispatch chain.
guard_pos = src.find("if hl not in _KNOWN_LOSS_NAMES:")
first_dispatch = src.find("if hl == \"none\":", guard_pos)
if guard_pos < 0:
    print("  FAIL: unknown-loss guard not found")
    ok = False
elif first_dispatch < 0 or first_dispatch <= guard_pos:
    print("  FAIL: unknown-loss guard must precede the dispatch chain")
    ok = False
else:
    print("  ✓ unknown-loss guard runs before the dispatch chain")

# 7. The unknown-loss guard raises ValueError with a clear message.
guard_block = src[guard_pos:guard_pos + 1500]
if "raise ValueError(" not in guard_block:
    print("  FAIL: unknown-loss guard does not raise ValueError")
    ok = False
elif "Unknown loss name" not in guard_block:
    print("  FAIL: unknown-loss error message missing 'Unknown loss name'")
    ok = False
elif "Known losses" not in guard_block:
    print("  FAIL: unknown-loss error message missing 'Known losses' enumeration")
    ok = False
else:
    print("  ✓ unknown-loss guard raises ValueError with the right message shape")

if ok:
    print("\nPASS: server-side strict loss-name validation + classification consolidation present.")
else:
    print("\nFAIL: at least one structural check failed.")
    sys.exit(1)

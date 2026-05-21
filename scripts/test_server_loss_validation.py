#!/usr/bin/env python3
"""Server-side mirror of the strict loss-name validation (PR #92).

train_subprocess.py used to fall through to MSELoss on any unknown
loss string. A typo like `loss: "uber"` would silently train with
MSE — no error, no warning. The fix is a `_KNOWN_LOSS_NAMES` set
checked before the dispatch chain. Any name outside the set raises
ValueError pointing at the offending head and the known set.

Structural test: assert the validation block is present in source
and runs before the dispatch chain.
"""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
src = (REPO / "server/train_subprocess.py").read_text()

ok = True

# 1. The known-name set is declared and includes every alias the
# system handles.
required_aliases = [
    '"mse"', '"mae"', '"huber"',
    '"bce"', '"binarycrossentropy"',
    '"wasserstein"', '"wgan"',
    '"iou"', '"giou"', '"giou_mse"', '"mse_giou"',
    '"categoricalcrossentropy"', '"sparsecategoricalcrossentropy"', '"cross_entropy"',
    # Legacy classification aliases tolerated by training_worker.js:117.
    # Rejected by the first revision of PR #92 — restored after review.
    '"ce"', '"crossentropy"', '"classification"',
    '"none"', '"use_global"',
]
known_block_start = src.find("_KNOWN_LOSS_NAMES = {")
if known_block_start < 0:
    print("  FAIL: _KNOWN_LOSS_NAMES set not found")
    sys.exit(1)
known_block_end = src.find("}", known_block_start)
known_block = src[known_block_start:known_block_end + 1]
for alias in required_aliases:
    if alias not in known_block:
        print(f"  FAIL: _KNOWN_LOSS_NAMES is missing {alias}")
        ok = False
if ok:
    print(f"  ✓ _KNOWN_LOSS_NAMES contains all {len(required_aliases)} required aliases")

# 2. The ValueError is raised when hl is not in the set.
if "if hl not in _KNOWN_LOSS_NAMES:" not in src:
    print("  FAIL: missing 'if hl not in _KNOWN_LOSS_NAMES' guard")
    ok = False
elif "raise ValueError(" not in src[src.find("if hl not in _KNOWN_LOSS_NAMES:"):src.find("if hl not in _KNOWN_LOSS_NAMES:") + 600]:
    print("  FAIL: guard does not raise ValueError")
    ok = False
else:
    print("  ✓ unknown-loss-name raises ValueError")

# 3. The error message names the offending loss + lists known losses.
guard_start = src.find("if hl not in _KNOWN_LOSS_NAMES:")
guard_block = src[guard_start:guard_start + 1500]
if "Unknown loss name" not in guard_block:
    print("  FAIL: error message missing 'Unknown loss name'")
    ok = False
elif "Known losses" not in guard_block:
    print("  FAIL: error message missing 'Known losses' enumeration")
    ok = False
else:
    print("  ✓ ValueError message names the offending loss + lists known losses")

# 4. The guard runs BEFORE the dispatch chain.
guard_pos = src.find("if hl not in _KNOWN_LOSS_NAMES:")
first_dispatch = src.find("if hl == \"none\":", guard_pos)
if first_dispatch < 0 or first_dispatch <= guard_pos:
    print("  FAIL: guard must precede the loss dispatch chain")
    ok = False
else:
    print("  ✓ guard runs before the dispatch chain (no silent fallthrough)")

# 5. The final MSE fallback `else:` after the chain is still there, but
# only handles known "" / "mse" cases — NOT unknown strings (those are
# caught by the guard above).
# Sanity check: the existing demos use a mix of these aliases; the
# guard must not regress them. (Covered by python_all suite.)

# 6. Legacy classification aliases route through CrossEntropyLoss, not
# the silent-MSE final fallback. (Reviewer flagged the first revision
# of #92 for breaking these: just allowlisting them without a
# dispatch branch would still silently fall through to MSELoss.)
for alias in ['"ce"', '"crossentropy"', '"classification"']:
    # Must appear inside a tuple alongside the existing CE aliases.
    ce_block_start = src.find('"categoricalcrossentropy"')
    if ce_block_start < 0:
        print("  FAIL: categoricalcrossentropy CE branch not found")
        ok = False
        break
    ce_block_end = src.find("nn.CrossEntropyLoss()", ce_block_start)
    if ce_block_end < 0 or alias not in src[ce_block_start:ce_block_end]:
        print(f"  FAIL: legacy alias {alias} not routed through CE dispatch branch")
        ok = False
        continue
    print(f"  ✓ legacy alias {alias} routes through CrossEntropyLoss")

if ok:
    print("\nPASS: server-side strict loss-name validation present.")
else:
    print("\nFAIL: at least one structural check failed.")
    sys.exit(1)

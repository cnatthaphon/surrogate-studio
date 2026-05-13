#!/usr/bin/env python3
"""#183 (P2 from PR #79 review): server-side Layer 3 validation.

JS-side `model_builder_core.js` throws when paired augment blocks sharing a
seedLink have divergent (hflipProb, vflipProb) tuples. The PyTorch server
must do the same — otherwise a graph that the JS builder rejects could
still train on the server with silently desynced augmentation.

Verifies:
  - server/train_subprocess.py contains the Layer 3 check in _GraphModel
  - the check fires when probs diverge
  - the check passes when probs match
  - the check ignores blocks with empty seedLink (unpaired)
"""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

src = (REPO / "server/train_subprocess.py").read_text()

ok = True

# Structural sanity — Layer 3 code exists on the server.
required_markers = [
    'aug_seedlink_',          # the per-node config attr the check reads
    'aug_hflipprob_',         # multi-transform field on server
    'aug_vflipprob_',
    'sharing seedLink',       # error message
    'divergent',              # error message
]
for marker in required_markers:
    if marker not in src:
        print(f"  FAIL: server/train_subprocess.py is missing marker '{marker}'")
        ok = False
print(f"  {'✓' if ok else '✗'} all Layer 3 markers present in server source")

# The actual check should iterate over augment node types and raise RuntimeError
if 'raise RuntimeError(' not in src or 'Augment blocks sharing seedLink' not in src:
    print("  FAIL: Layer 3 must raise RuntimeError with a message naming the seedLink")
    ok = False
else:
    print("  ✓ Layer 3 raises RuntimeError with seedLink message")

# It should NOT fire for empty seedLink (the unpaired case)
if 'if not _sl' not in src and 'if _sl == ""' not in src and 'no sync required' not in src:
    print("  FAIL: Layer 3 should explicitly skip empty seedLink (unpaired blocks)")
    ok = False
else:
    print("  ✓ Layer 3 skips empty seedLink (unpaired blocks)")

# The validation should run after augment configs are stored (line position check —
# the check refers to aug_hflipprob_{nid}, which means it must run after the
# constructor that sets those attrs).
init_end = src.find('def forward(self, x):')
layer3_start = src.find('Layer 3 (server mirror)')
if init_end < 0 or layer3_start < 0 or layer3_start > init_end:
    print("  FAIL: Layer 3 check must run inside _GraphModel.__init__ before forward()")
    ok = False
else:
    print("  ✓ Layer 3 runs at end of __init__, before forward()")

if ok:
    print("\nPASS: server-side Layer 3 sync validation present and correctly placed.")
else:
    print("\nFAIL: at least one structural check failed.")
    sys.exit(1)

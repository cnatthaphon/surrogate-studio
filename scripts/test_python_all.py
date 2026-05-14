#!/usr/bin/env python3
"""Run every scripts/test_*.py and aggregate pass/fail.

Mirrors the role of `scripts/test_contract_all.js` for the JS side. Used by
CI to make sure all server-side parity tests (LSTM, GRU, Embedding,
ConvTranspose, augment, etc.) keep passing — the JS contract runner does
not cover any of these because they import `torch` and other Python deps.

Exits non-zero if any single test exits non-zero or times out. Each test
gets its own subprocess so an exception in one cannot mask another.
"""
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO / "scripts"
TIMEOUT_SECONDS = 120

tests = sorted(p.name for p in SCRIPTS_DIR.glob("test_*.py") if p.name != Path(__file__).name)
if not tests:
    print("no Python tests found under scripts/")
    sys.exit(1)

print(f"Running {len(tests)} Python test scripts (timeout {TIMEOUT_SECONDS}s each)\n")

passed = []
failed = []
for name in tests:
    path = SCRIPTS_DIR / name
    print(f"--- {name} ---")
    try:
        result = subprocess.run(
            [sys.executable, str(path)],
            cwd=str(REPO),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
        ok = result.returncode == 0
        tail = (result.stdout.splitlines() or [""])[-3:]
        for line in tail:
            print(f"    {line}")
        if not ok:
            err_tail = (result.stderr.splitlines() or [""])[-5:]
            for line in err_tail:
                print(f"    [stderr] {line}")
        print(f"  -> {'PASS' if ok else f'FAIL (rc={result.returncode})'}\n")
        (passed if ok else failed).append(name)
    except subprocess.TimeoutExpired:
        print(f"  -> FAIL (timeout after {TIMEOUT_SECONDS}s)\n")
        failed.append(name)

total = len(tests)
print("=" * 60)
print(f"Summary: {len(passed)} passed, {len(failed)} failed of {total}")
if failed:
    print("\nFailed tests:")
    for name in failed:
        print(f"  - {name}")
    sys.exit(1)

print("\nAll Python parity tests passed.")

#!/bin/bash
# Build a single concatenated JS bundle from dependency-ordered source files.
# Load order extracted from index.html (canonical dependency list).
# Usage: bash scripts/build_bundle.sh
# Output: dist/surrogate-studio.js

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/dist"
OUT_FILE="$OUT_DIR/surrogate-studio.js"

mkdir -p "$OUT_DIR"

SCRIPTS=$(grep 'src="./src/' "$ROOT/index.html" | sed 's/.*src="\.\///' | sed 's/?.*//' | sed 's/".*//')

echo "// Surrogate Studio — concatenated bundle" > "$OUT_FILE"
echo "// Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT_FILE"
echo "// Source files: $(echo "$SCRIPTS" | wc -l)" >> "$OUT_FILE"
echo "" >> "$OUT_FILE"

COUNT=0
for SCRIPT in $SCRIPTS; do
  FILE="$ROOT/$SCRIPT"
  if [ ! -f "$FILE" ]; then
    echo "WARNING: $SCRIPT not found" >&2
    continue
  fi
  echo "" >> "$OUT_FILE"
  echo "// ──── $SCRIPT ────" >> "$OUT_FILE"
  cat "$FILE" >> "$OUT_FILE"
  echo "" >> "$OUT_FILE"
  COUNT=$((COUNT + 1))
done

SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo "Built: $OUT_FILE ($COUNT files, $SIZE)"

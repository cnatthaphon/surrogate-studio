#!/usr/bin/env python3
"""Re-extract HRSID 64x64 single-ship patches from the raw dataset.

The bundled demo/SAR-Ship-Detection/hrsid_ships_64x64.js currently ships
3000 patches with bounding boxes. Run this script to regenerate that
file from a local HRSID copy, e.g. if you want more samples or different
crop logic.

Expected layout under HRSID_ROOT:
  HRSID_ROOT/JPEGImages/*.jpg              (800×800 SAR tiles)
  HRSID_ROOT/annotations/train_test2017.json  (COCO format)

For each ship annotation: pick a random offset around the bbox so the
ship is somewhere inside a 192×192 region of the source image, crop,
resize to 64×64, record normalized [x, y, w, h] in the crop's coord
space. Filters out segmentation-noise (<6px), border-clipped crops, and
ships that fill more than 85% of the patch.

Output binary layout (consumed by `src/dataset_modules/hrsid_ship_module.js`):
  [uint32 count][uint32 dim][uint8 pixels × count × dim][float32 bboxes × count × 4]
then base64-encoded into a JS bundle that assigns
`window.HRSID_SHIPS_DATA_B64 = "...";`.
"""
import base64
import json
import os
import random
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

random.seed(42)
np.random.seed(42)

HRSID = Path(os.environ.get("HRSID_ROOT", "/mnt/f/Data/Datasets/ship_data/HRSID_JPG"))
ANN_PATH = HRSID / "annotations" / "train_test2017.json"
IMG_DIR = HRSID / "JPEGImages"
OUT_PATH = Path(__file__).resolve().parent.parent / "demo/SAR-Ship-Detection/hrsid_ships_64x64.js"

TARGET_COUNT = int(os.environ.get("HRSID_TARGET_COUNT", "3000"))
PATCH_SIZE = 64
SRC_CROP_SIZE = 192
MIN_BBOX_PX = 6
MAX_BBOX_FRAC = 0.85

if not ANN_PATH.exists():
    print(f"HRSID annotations not found at {ANN_PATH}.")
    print("Set HRSID_ROOT to the directory containing JPEGImages/ + annotations/.")
    sys.exit(1)

print(f"Loading annotations from {ANN_PATH} ...")
with ANN_PATH.open() as f:
    coco = json.load(f)
images_by_id = {img["id"]: img for img in coco["images"]}
print(f"  images: {len(images_by_id)}  annotations: {len(coco['annotations'])}")

random.shuffle(coco["annotations"])

patches = []
bboxes = []
skipped_small = 0
skipped_border = 0
skipped_big_bbox = 0
loaded_imgs = {}

for ann in coco["annotations"]:
    if len(patches) >= TARGET_COUNT:
        break
    bx, by, bw, bh = ann["bbox"]
    if bw < MIN_BBOX_PX or bh < MIN_BBOX_PX:
        skipped_small += 1
        continue
    img_meta = images_by_id.get(ann["image_id"])
    if not img_meta:
        continue
    iw, ih = img_meta["width"], img_meta["height"]
    ship_cx = bx + bw / 2
    ship_cy = by + bh / 2
    max_off_x = max(2, SRC_CROP_SIZE / 2 - bw / 2 - 4)
    max_off_y = max(2, SRC_CROP_SIZE / 2 - bh / 2 - 4)
    off_x = random.uniform(-max_off_x, max_off_x)
    off_y = random.uniform(-max_off_y, max_off_y)
    crop_cx = ship_cx + off_x
    crop_cy = ship_cy + off_y
    crop_x0 = int(round(crop_cx - SRC_CROP_SIZE / 2))
    crop_y0 = int(round(crop_cy - SRC_CROP_SIZE / 2))
    if crop_x0 < 0 or crop_y0 < 0 or crop_x0 + SRC_CROP_SIZE > iw or crop_y0 + SRC_CROP_SIZE > ih:
        skipped_border += 1
        continue
    fn = img_meta["file_name"]
    if fn not in loaded_imgs:
        if len(loaded_imgs) > 30:
            del loaded_imgs[next(iter(loaded_imgs))]
        try:
            loaded_imgs[fn] = Image.open(IMG_DIR / fn).convert("L")
        except FileNotFoundError:
            continue
    src = loaded_imgs[fn]
    crop = src.crop((crop_x0, crop_y0, crop_x0 + SRC_CROP_SIZE, crop_y0 + SRC_CROP_SIZE))
    patch = crop.resize((PATCH_SIZE, PATCH_SIZE), Image.BILINEAR)
    crop_bx = bx - crop_x0
    crop_by = by - crop_y0
    scale = PATCH_SIZE / SRC_CROP_SIZE
    nx = (crop_bx * scale) / PATCH_SIZE
    ny = (crop_by * scale) / PATCH_SIZE
    nw = (bw * scale) / PATCH_SIZE
    nh = (bh * scale) / PATCH_SIZE
    if nw > MAX_BBOX_FRAC or nh > MAX_BBOX_FRAC:
        skipped_big_bbox += 1
        continue
    if nx < 0 or ny < 0 or nx + nw > 1 or ny + nh > 1:
        skipped_border += 1
        continue
    patches.append(np.array(patch, dtype=np.uint8).flatten())
    bboxes.append((nx, ny, nw, nh))

print(f"\nKept {len(patches)} patches (skipped small={skipped_small}, border={skipped_border}, big={skipped_big_bbox})")
if not patches:
    sys.exit(1)

xs = np.array([b[0] for b in bboxes])
ys = np.array([b[1] for b in bboxes])
ws = np.array([b[2] for b in bboxes])
hs = np.array([b[3] for b in bboxes])
print(f"  x: mean={xs.mean():.3f} sd={xs.std():.3f}")
print(f"  y: mean={ys.mean():.3f} sd={ys.std():.3f}")
print(f"  w: mean={ws.mean():.3f} sd={ws.std():.3f}")
print(f"  h: mean={hs.mean():.3f} sd={hs.std():.3f}")

count = len(patches)
dim = PATCH_SIZE * PATCH_SIZE
buf = bytearray()
buf += struct.pack("<II", count, dim)
for p in patches:
    buf += p.tobytes()
for b in bboxes:
    buf += struct.pack("<ffff", *b)
b64 = base64.b64encode(buf).decode("ascii")
OUT_PATH.write_text(f'window.HRSID_SHIPS_DATA_B64 = "{b64}";\n')
print(f"\nWrote {OUT_PATH} ({(len(buf) * 4 / 3) / 1024:.1f} KB base64, {count} patches)")

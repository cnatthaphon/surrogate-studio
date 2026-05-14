# Augmentation Contract — Engineering Retrospective

The augmentation feature shipped to Surrogate Studio across **10 merged PRs** between April 22 and May 14, 2026 (PRs #71 → #80). What started as "add a horizontal flip to SAR-Ship so the bbox detector sees more data" turned into a substantive piece of platform engineering — paired image+label sync, three layers of build-time validation, multi-transform per block, full back-compat for legacy graphs, and cross-runtime parity across browser TF.js, PyTorch CUDA server, and the notebook-export bundle.

This document records the technical decisions, the bugs found in code review, and what each round actually changed. It's grounded in real PR history (`git log --grep=augment`) so anyone reading the codebase can map any line back to the conversation that produced it.

---

## Why the work exists

The platform shipped 16 demos and 47 models without any input-level data augmentation. The graph supported layer-level dropout but had no concept of "transform the input image and its label together while preserving the alignment." That's a textbook regularization technique for small-data tasks like Cell-Nuclei (210 microscopy images) and SAR-Ship (210 radar patches) — and its absence was an honest hole in the platform claim "schema-driven, plugin demos, same contract everywhere."

The first design constraint was that augmentation had to be a **graph node**, not a dataset-module preprocessing hook. That choice carried real consequences:

- The flip decision (a coin flip per batch) has to be visible to multiple graph branches at once: the image branch flips the tensor, the bbox/mask branch applies the corresponding label math. If they roll their own coins, the label drifts away from the image and the model trains on garbage.
- Augmentation must round-trip through model save/load, the cross-runtime weight contract, and the notebook export pipeline — same as every other node type.
- Build-time validation has to fire across all three runtimes (TF.js, PyTorch, notebook). Silent passthrough at runtime is worse than a wrong shape — it produces healthy-looking training loss curves with un-augmented data.

These constraints shaped everything that came after.

---

## Timeline

| PR | Title | What landed |
|---|---|---|
| #71 | `#144`: augment_image_layer | TF.js custom layer (`AugmentImageLayer`), horizontal_flip, eval-mode passthrough |
| #72 | `#145`: paired augment blocks + seedLink RNG sync | `augment_bbox` / `augment_mask` / `augment_label`, module-level coin registry keyed by `seedLink` string |
| #73 | `#146`: target_source block + engine target-input wiring | `target_source` node emits dataset target as a graph tensor so paired augments can transform it before reaching `output_layer.input_2` |
| #74 | `#147`: SAR-Ship augmentation demo + server-side graph-label loss fix | The first real demo using paired image+bbox aug; server `compute_loss` routes through `_custom_labels[node_id]` when `graphLabelOutputIdx >= 0` |
| #75 | `#173`: fix eval for target_source models + `tf.keep` tensor leak | `prediction_core.buildPredictInputs()` pads multi-input models for inference; removed `tf.keep` from augment eval passthroughs that was leaking 1 tensor per `predict()` |
| #76 | `#172`: Layer 2 type validation | Walk back from each augment node to its root; reject augment_bbox wired to image data, etc. |
| #77 | docs: feature #8 + SAR-Ship row | Top-level README augmentation row |
| #78 | `#181`: aug variants on Cell-Nuclei + FM-Benchmark + Synth-Detection + Synth-Seg | 5 demos now exercise the contract |
| #79 | `#182`: multi-transform per block + Layer 3 paired-config sync | One block can carry hflipProb=0.5 AND vflipProb=0.5; build-time check that paired blocks have matching probabilities |
| #80 | docs: refresh DEMOS.md + recapture eval screenshots | Doc surface caught up with the code |

---

## The bug list — what code review found that I didn't

Every PR in this chain had at least one P1 or P2 finding in review (initially from Codex, then user-relayed reviewer commentary). Listing them honestly because the patterns are instructive — they show where my mental model was wrong and what fixed it.

### Cross-runtime layout drift (PR #74 → #147 round-2)

**Bug**: The first SAR-Ship aug retrain produced *worse* test MAE than baseline (0.0509 vs 0.0376, +35%). Initial diagnosis was "domain physics — radar imagery isn't flip-invariant." The user pushed back: *"i think augment should help not destroy. maybe something wrong?"*

**Root cause**: The PyTorch server's `reshape` block silently permutes NHWC → NCHW because `Conv2d` expects NCHW. But the augment block's `layout` config defaulted to `"nhwc"`, which selected flip axis = -2. On a post-permute NCHW tensor, axis -2 is **H, not W**. So the image was being vertically flipped while the bbox was horizontally flipped — every flipped batch (50%) trained on a 90°-mismatched label.

**Fix**: `layout: "auto"` opt-in detection on the server. TF.js's reshape doesn't permute (so browser stays NHWC); server detects NCHW from `[B, 1, 64, 64]` shape. Both runtimes now flip W consistently. Result: test MAE 0.0509 → 0.0344, val_loss ↓33%.

**Lesson**: Hand-waving domain explanations ("SAR is azimuth-asymmetric") sound plausible and are tempting cover for a bug. The user's instinct that augmentation should help was right; mine that it was honest negative result was wrong.

### `tf.keep` inside `tf.tidy` leaks tensors (PR #75)

**Symptom**: After capturing a fresh `04_test.png` screenshot for SAR-Ship aug, the eval ran multiple `predict()` calls — and the eval table showed the new aug row but `numTensors` went up by 1 every call. Specifically: `tf.memory().numTensors` baseline 22 → after 1 predict 23 → after 2 predicts 24, monotonically.

**Root cause**: All four augment layers returned `tf.keep(x.clone())` from their eval-mode passthrough. But `tf.keep` is for keeping a tensor alive past a `tf.tidy()` boundary — and `tf.tidy` already preserves the return value automatically. Inside `tf.tidy(() => tf.keep(x.clone()))`, the `tf.keep` increments the reference count of a tensor that's already being returned. The result is a tensor that escapes the tidy scope AND has +1 kept-count, which prevents downstream `dispose()` from actually freeing it.

**Fix**: Drop `tf.keep`, return `x.clone()` directly. Test 3 of `test_predict_multi_input.js` was added to lock this down.

**Lesson**: I had a defensive `tf.keep` everywhere I was returning a clone, on the theory "make sure it survives." It was harmful, not safe. Read the docs more carefully.

### Multi-input model.predict() shape routing (PR #75)

**Symptom**: SAR-Ship aug demo's Evaluation tab showed three rows but the CNN+Aug row had error: *"Expected to see 2 Tensor(s), but instead got 1 Tensor(s)"*. The aug model has 2 inputs (image + target_source) but `evaluation_tab.js` called `model.predict(singleTensor)`.

**Fix**: `prediction_core.buildPredictInputs()` pads missing inputs with zero tensors of the right shape. In v1 I matched by tensor rank — which broke when target_source happened to be first in `model.inputs` (both image `[B,4096]` and target `[B,4]` are rank-2). PR #75 round-2 fixed this: match by **full trailing shape**, not just rank.

**Lesson**: When you're routing N tensors into M slots, rank is necessary but not sufficient. Trailing shape gives you the actual matching identity.

### Layer 2 type validation — six rounds of refinement (PR #76)

This was the longest review thread. Each round caught a real flaw in the previous round:

| Round | Issue | Fix |
|---|---|---|
| 1 | `augment_mask` wrongly bucketed with `augment_image` (rejected target_source roots) | `augment_mask` made permissive — masks legitimately flow from either side (paired with image OR from target_source) |
| 2 | Walked past declared source nodes when they had feature-block metadata parents | Stop at any declared source/input node |
| 3 | Round-2 created a bypass: `image_source → target_source → augment_bbox` built OK | Stop only when `realInc.length === 0`, otherwise keep walking — a source with a real tensor parent is acting as a passthrough |
| 4 | Name-only check let `target_source(targetKey="label", featureSize=4) → augment_bbox` slip through | Inspect the root's `data.targetKey`; reject when not `"bbox"` |
| 5 | Unset `targetKey` rejected, but the existing builder defaults missing key to `"bbox"` | Default `(targetKey) || "bbox"` to match the builder |
| 6 | Walked all incoming parents, but tensor construction filters by `reachable[]` | Apply same `reachable[]` filter to lineage walk; ignore dangling unreachable parents |

By the end the lineage check covered 13 cases including all the bypasses. Each round was driven by a reviewer reproduction script that I hadn't anticipated. **Lesson**: defensive code is hard to get right by inspection; you find the holes by writing tests that try to drill through.

### Multi-transform refactor — auto-layout coercion and palette factory miss (PR #79)

PR #79 introduced per-transform probability: `hflipProb`, `vflipProb` per block, with build-time validation that paired blocks have matching probs (Layer 3). Three review rounds:

1. **`layout: "auto"` was silently coerced to `"nhwc"` in JS** — TF.js stays NHWC after reshape (server permutes; browser doesn't), so functionally `auto == nhwc` in browser. But coercing the stored value meant the config didn't round-trip, and the UI label "Auto (recommended)" was misleading. Fix: accept `"auto"` as a first-class stored value.

2. **Layer 3 was JS-only** — server accepted divergent paired probs and only warned at runtime when one coin was missing. Mirror in `server/train_subprocess.py`'s `_GraphModel.__init__`.

3. **Palette → factory still wrote the legacy shape** — `schema_definitions_builtin.js` sent `hflipProb`/`vflipProb` to the factories, but `addAugmentImageNode` / `addAugmentBboxNode` / `addAugmentMaskNode` were reading old `transform`/`probability` fields and writing only the legacy pair into `node.data`. Builder then read missing `hflipProb` → 0 → no-op augment. Fixed by porting `_resolveAugProbsFromData()` into the factories.

4. **Builder bypass for saved graphs** — round-3 fixed the factory path but saved/exported graphs hit the JS builder + PyTorch server directly, not through the factory. Builder still defaulted missing fields to 0. Fix: move the legacy-translation helper into both runtimes' builder paths so any legacy graph translates correctly.

**Lesson**: A refactor isn't done when the new code path works — it's done when every entry point reaches the new shape. Editor click, saved graph load, preset.js import, notebook export embed: each is a different entry point, and they don't share migration code automatically.

---

## What's in the contract today

After PR #79 / #80 merged:

**Block types** (5 augment-category nodes):
- `augment_image` — flips a 4D tensor (NHWC or NCHW), per-transform probability
- `augment_bbox` — applies bbox flip math; supports `x0y0x1y1` and `xywh` formats
- `augment_mask` — same as image but with 3D ↔ 4D rank promotion
- `augment_label` — passthrough (class labels are flip-invariant for current demos)
- `target_source` — emits the dataset target as a graph tensor so paired augments can transform it before reaching `output_layer.input_2`

**Per-block config**:
- `hflipProb`, `vflipProb` ∈ [0, 1] (each transform independent; 0 = disabled)
- `seedLink: string` — paired blocks sharing this string share their per-transform coin
- `layout: "auto" | "nhwc" | "nchw"` (image, mask only)
- `format: "x0y0x1y1" | "xywh"`, `imageWidth`, `imageHeight` (bbox only)

**Build-time validation**:
- **Layer 1 — shape**: wrong rank or wrong last-dim throws with a hint at the typical correct upstream
- **Layer 2 — type lineage**: walks back to root source; rejects e.g. augment_bbox wired to image_source
- **Layer 3 — config sync**: paired blocks sharing a `seedLink` must have identical `(hflipProb, vflipProb)` tuples

**Back-compat**: builder accepts both `{hflipProb, vflipProb}` (new) and `{transform, probability}` (legacy) field shapes. Saved graphs from before PR #79 keep working.

**Cross-runtime parity**: all four block types implemented identically in `src/model_builder_core.js` (TF.js), `server/train_subprocess.py` (PyTorch), and `src/notebook_runtime_assets.js` (embedded notebook bundle).

---

## Demos exercising the contract

| Demo | Variants | Aug effect on best val_loss | Reading |
|---|---|---|---|
| SAR-Ship Detection | CNN / CNN+Aug / MLP | ↓33% (0.0040 → 0.0027) | Paired image+bbox hflip on 210 real radar patches. Clear win. |
| Cell-Nuclei Segmentation | UNet / UNet+Aug / MLP | ↓10.5% (0.1734 → 0.1551) | Paired image+mask hflip on 210 microscopy images. The canonical UNet task. IoU: 0.4834 → 0.5292. |
| Synthetic Detection | Detector / Detector+Aug | ↓9% (0.00115 → 0.00105) | Paired image+bbox on 4200 synthetic shapes. Small consistent improvement. |
| Synthetic Segmentation | Seg-UNet / Seg-UNet+Aug / MLP | floor-saturated | Both UNet variants hit ~2e-5 BCE on clean synthetic shapes. Aug pipeline works correctly but the dataset is too easy to show a headline win. |
| FM-Benchmark CNN | CNN / CNN+Aug | ~equal (0.2692 → 0.2656) | 6000-sample FM-MNIST + saturated CNN. Aug effectively neutral. Documented honestly. |

The spread is the textbook "when does augmentation help" — gains scale inversely with how saturated the model already is on the data. Small + real ≫ Synthetic + clean. Documented in each demo's README, not curated to highlight only successes.

---

## Test coverage

- **12 JavaScript tests** in `scripts/test_augment_*.js` covering: paired sync (0/200 disagreements over 200 trials with both transforms enabled), shape validation, type lineage, multi-transform composition, layout round-trip, multi-input prediction, legacy back-compat, palette → factory wiring, full SAR-Ship build + fit.
- **5 Python tests** in `scripts/test_*server*.py` covering: server-side augment dispatch parity with JS, paired sync via `_aug_seed_registry`, graphLabelOutputIdx loss routing, Layer 3 sync validation present and correctly placed, legacy compat helper coverage.
- **1 headless browser test** (`test_browser_sar_ship_aug.js`) — 16 assertions on the live SAR-Ship demo page: page loads, preset registers all 3 models, all pretrained globals defined and non-trivial, model builds with 2 inputs / 2 outputs, headConfigs[0].graphLabelOutputIdx === 1, predict returns correct [B,4] shape, zero JS errors.
- **1 notebook export test** (`test_headless_sar_aug_notebook_export.js`) — verifies the generic platform notebook export handles augment graphs end-to-end with 13 assertions on round-trip integrity.

All tests run under `node scripts/test_contract_all.js`.

---

## What's deliberately out of scope

- **Rotation transforms** — would need bilinear interpolation (image), nearest-neighbor (mask), and non-axis-aligned bbox math. Rotated bbox either becomes a loose axis-aligned bounding rect (information loss) or a 5-tuple (breaks the `[x,y,x,y]` contract). Real design question, not a quick add.
- **Random crop** — changes output shape, which breaks the platform's "augment is shape-preserving" invariant. Would need to be a separate node category or change the build-time shape contract.
- **Color jitter / brightness / contrast** — image-only, easy to add, but most current demos are grayscale so the payoff is small. Deferred until a colored-image demo motivates it.
- **Multi-transform composition order configurability** — currently fixed at `hflip → vflip`. Configurable order would help if more transforms get added.

The extension point is clear: one keyed entry in the per-block transform loop on both runtimes plus tests, no architecture change needed.

---

## What this work demonstrates

For anyone reading the codebase to evaluate engineering depth:

1. **Cross-runtime parity is treated as a hard contract, not a soft goal.** Every augment dispatch exists in JS and Python with matching semantics; the embedded notebook bundle is regenerated from the canonical server source and a contract test fails CI on drift.

2. **Validation evolves under adversarial review.** The Layer 2 type-lineage check went through six rounds of reviewer-supplied counterexamples — each landed a real reproduction case that the previous round missed. The final form covers metadata-only parents, passthrough sources, unreachable dangles, and wrong-key targets. Hard to design from first principles; arrived at by listening to actual bug reports.

3. **Negative results are documented honestly.** FM-Benchmark CNN+Aug doesn't beat baseline; the demo README says so. Synthetic-Segmentation both variants saturate at the BCE floor; the README says so. The portfolio claim is "the pipeline works correctly across all task types," not "augmentation always wins."

4. **The bug history is the design history.** The cross-runtime layout drift (PR #74 round-2), the tf.keep tensor leak (PR #75), the trailing-shape match (PR #75 round-2), the six rounds of Layer 2, the factory bypass (PR #79 round-3), the builder bypass (PR #79 round-4) — each one is a load-bearing line in the current code and a corresponding test that locks it down.

If you want to see the actual conversation that produced any of these, the PR descriptions and commit messages reference the specific findings.

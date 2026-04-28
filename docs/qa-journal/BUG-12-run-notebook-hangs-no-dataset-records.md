# BUG-12: Run Notebook hangs forever when dataset records are not materialized

**Severity**: User-facing — first-impression bug. Visitor opens any demo, sees pretrained card with `status: "done"`, clicks **Run Notebook** → spinner stays "Preparing…" indefinitely with no error.

**Discovered**: While verifying BUG-10/BUG-11 fix end-to-end on real demo notebooks (not fabricated test fixtures).

---

## Reproduction

1. Open `http://localhost:3777/demo/Custom-CSV-Tutorial/` (or `Synthetic-Segmentation`, or any demo with shipped pretrained cards but lazy dataset)
2. Wait for page to bootstrap. Pretrained cards visible: `MLP (pre-trained)`, status `done`, weights ✅
3. Click the pretrained card → **Continue Training** panel appears, `Run Notebook` button visible
4. Inspect store state via console:
   ```
   ds.data.records  // undefined OR empty
   ds.ready         // false
   ```
5. Click **Run Notebook** → button text changes to **Preparing…** → stays that way for 25+ seconds with no progress, no error, no overlay opens.

---

## Pattern (verified on multiple demos)

| Demo | Pretrained card loads? | Dataset records on load? | Run Notebook? |
|------|-----------------------:|-------------------------:|---------------|
| Custom CSV Tutorial (Iris) | ✅ | ❌ empty | ❌ hangs "Preparing…" |
| Synthetic Segmentation | ✅ | ❌ empty | ❌ same |
| Fashion-MNIST Diffusion | ✅ | (assumed same — auto-bootstrap not happening) | (likely same) |

The Generation tab still works for these demos because each `Generation Session` carries its own `sourceDescriptor` and resolves the data lazily inside the session's runtime — that path doesn't depend on the live store's `dataset.records`.

But **Run Notebook** in `src/tabs/trainer_tab.js::_handleRunNotebook` calls
`_prepareDatasetForNotebookExport(dataset.data, W)` which only succeeds if `dataset.data.records` (or `dataset.data.xTrain`) is populated. When records are empty:

- `_limitNotebookDatasetRows` produces a 0-row preview
- `NBC.createSingleNotebookFileFromConfig` sits there serializing a giant empty dataset CSV
- Or it hangs inside the `fetch` → `mnist_source_loader.js`-style code path that quietly never resolves

Either way: silent hang. No timeout. No "dataset not loaded — generate first" message.

---

## What the fix needs to do

**Architectural choice — pick one:**

### Option A — Auto-materialize records at demo bootstrap (cleanest UX)

When a demo's `preset.js` calls `store.upsertDataset({ ... })` for a dataset that has a `sourceDescriptor` or `splitIndices`, also resolve and attach `records: { train, val, test }` synchronously (or with an awaitable promise). Pretrained cards already encode the assumption that everything is ready — make it actually true.

The dataset-source-loader infrastructure already exists (`src/dataset_source_registry.js::resolveDatasetSplit`). Just call it eagerly during preset apply.

### Option B — Make Run Notebook fail loudly + fast (defensive)

In `src/tabs/trainer_tab.js::_handleRunNotebook`, before calling `setTimeout(...)` to build the notebook, check:

```js
if (!dataset.data || (!dataset.data.records && !dataset.data.xTrain && !Array.isArray(dataset.data.trajectories))) {
  onStatus("Dataset records not loaded yet — switch to Dataset tab and click Generate Dataset, then retry.");
  _isNotebookPreparing = false;
  if (runner && typeof runner.updateBusy === "function") runner.updateBusy("Dataset not ready", "error");
  return;
}
```

This is a 5-line defensive guard. It surfaces the problem instead of hiding it inside a 25+ second hang.

### Option C — Both (recommended)

Do A for the "pretrained card user experience" (nothing else makes sense — the card claims status:done, demo should be ready), and do B as a defensive guard so any future preset that forgets to materialize fails loudly.

---

## Why this matters before LinkedIn post

A reviewer opening any demo from the post link will:
1. See pretrained card (✓ done, looks complete)
2. Click Run Notebook (it's a prominent feature in the README)
3. Stare at "Preparing…" for 30+ seconds
4. Conclude "this is broken" and leave

This is the worst-case demo failure mode for a portfolio project. **High user-facing impact even though the math/training/weights are all correct.**

---

## Acceptance criteria

- Open any demo with shipped pretrained cards, click pretrained card, click Run Notebook → either:
  - Notebook Runner overlay opens within ≤ 5 seconds with cells visible, **or**
  - Clear error message in status bar mentioning the missing dataset, with retry path

- Running the same flow on Custom-CSV-Tutorial (Iris, 150 samples) and Synthetic-Segmentation must succeed end-to-end (Run All produces non-error cell outputs, dataset cell prints `Train: ..., Val: ..., Test: ...` like in BUG-10 fix verification).

- No silent hang. No more than 5 seconds between click and visible state change.

---

## Related context

- BUG-3 had a similar symptom ("Dataset ready but Train/Val/Test = 0") for a different code path — fix was on dataset_processing_core. This is **a separate code path** in the trainer's notebook export.
- Recent E2E behavioral verification confirmed all 45 pretrained cards have valid `metrics` from real training (proving train pipeline works). The bug is specifically in the **notebook export → runner open** path when records aren't in memory.

---

## Out of scope

- This is NOT a Pyodide / JupyterLite bug. The notebook never gets built — the failure is upstream in the JS-side dataset preparation.
- This is NOT a bug in the BUG-10 fix (Cell 3 priority). Once a notebook DOES get built (e.g. on Fashion-MNIST GAN where records are loaded), BUG-10 fix works correctly.

# BUG-13: 14 of 16 demos blank-page after BUG-12 fix

**Severity**: BLOCKER — visitor opens any of 14 demos → blank white screen → JS exception in console → portfolio looks broken.

**Discovered**: While verifying BUG-12 fix end-to-end on Fashion-MNIST UNet demo. Browser console shows:

```
TypeError: OSCPretrainedLoader.ensureDatasetsReady is not a function
    at http://localhost:3777/demo/Fashion-MNIST-UNet/:28:26
```

The page renders blank because the inline `<script>` calling `ensureDatasetsReady` throws during demo bootstrap.

---

## Root cause

The BUG-12 fix (commit `14ab15f`) made three changes:

1. ✅ Added new `ensureDatasetsReady` function to **`src/pretrained_loader.js`**
2. ✅ Added inline `OSCPretrainedLoader.ensureDatasetsReady(store)` call to **all 16 demo `index.html` files**
3. ❌ **Only updated `<script>` import for 2 of 16 demos** to load the new `src/pretrained_loader.js` directly

The other 14 demos load only `<script src="../../dist/surrogate-studio.js"></script>` — that bundle has the **old** `OSCPretrainedLoader` without `ensureDatasetsReady`. The dist bundle was not rebuilt.

### Demos that work (loaded src/ directly)

| Demo | dist | src/pretrained_loader |
|------|:---:|:---:|
| Custom-CSV-Tutorial | ✅ | ✅ |
| Fashion-MNIST-Benchmark | ✅ | ✅ |

### Demos that are broken (blank page)

All 14 others, including the marquee demos:

```
Cell-Nuclei-Segmentation
Fashion-MNIST-Conditional-Diffusion
Fashion-MNIST-Diffusion
Fashion-MNIST-GAN          ← README "Start here" link
Fashion-MNIST-Transformer
Fashion-MNIST-UNet
LSTM-VAE-for-dominant-motion-extraction
Oscillator-Surrogate
SAR-Ship-Detection
Siamese-Shape-Verification
Synthetic-Detection
Synthetic-Segmentation
Text-Sentiment-Transformer
TrAISformer
```

The README's "Start here" link points to `demo/Fashion-MNIST-GAN/` — that demo is **broken**. First impression for any LinkedIn visitor: blank page + console error.

---

## Required fix (pick one — both work)

### Option A — Rebuild `dist/surrogate-studio.js` (cleanest)

The dist bundle is a concatenation of `src/*.js` files. Whatever build script produced it needs to be re-run after `src/pretrained_loader.js` changes. After rebuild, all 14 demos work without HTML changes.

If there's no build script, this is the right time to add one (or document the manual concat order in a Makefile / npm script).

### Option B — Add `<script src="../../src/pretrained_loader.js"></script>` to 14 demo index.html

Mechanical: copy the line from `Custom-CSV-Tutorial/index.html` into the other 14, after the `dist/` script tag. Keeps dist as-is.

### Option C — Defensive fallback (also recommended regardless)

In each demo's inline script, guard the call:

```js
if (typeof OSCPretrainedLoader !== "undefined" && typeof OSCPretrainedLoader.ensureDatasetsReady === "function") {
  OSCPretrainedLoader.ensureDatasetsReady(store);
}
```

This ensures that even if `dist/` and `src/` go out of sync in the future, a missing function does not blank the page. The defensive guard is cheap insurance.

**Recommended: do Option A + Option C.** A solves the immediate breakage, C prevents future recurrence.

---

## Acceptance criteria

1. Open every one of the 16 demos at `http://localhost:3777/demo/<name>/`. **No JS exception in console**, no blank page.
2. `OSCPretrainedLoader.ensureDatasetsReady` available in `window.OSCPretrainedLoader` regardless of whether `src/` is loaded explicitly or only `dist/` is loaded.
3. Run the existing browser-side integrity sweep on all 16 — pass rate stays at 16/16 demos load + 45/45 cards integrity match.

---

## How this should have been caught earlier

Two missed safety nets:

1. **Bundle drift detection**: dist bundle should fail a CI check if it's older than any source file. A simple `find src -newer dist/surrogate-studio.js` in `npm test` would have flagged this.
2. **Demo bootstrap smoke test**: load each demo's index.html headlessly (Puppeteer or jsdom), assert no uncaught JS errors, then assert at least one button text appears in DOM. 16 demos × ~5 seconds each = trivial CI time.

Both worth adding to prevent future similar regressions.

---

## Out of scope (do not touch)

- The behaviour of `ensureDatasetsReady` itself is correct — verified against Custom-CSV-Tutorial: Iris records auto-materialize (105 train rows), notebook Run All produces clean output. Bug is purely deployment / build-step inconsistency.
- BUG-12 architectural fix (Option A + Option B in BUG-12 report) is correct. Just needs the dist rebuild + script include to actually reach all demos.

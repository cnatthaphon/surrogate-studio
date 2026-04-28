# BUG-22: BUG-15→20 retest report — only 2 of 6 fixes actually take effect

**Date**: 2026-04-27 evening, after commit `cdd14dc`
**Scope**: Re-ran JupyterLite Run All on the previously failing demos to verify the 6 BUG-15→20 fixes. Two pass, four still fail with the **same exact error string** as before. Root cause traced to a stale embedded snapshot in `src/notebook_runtime_assets.js`.

---

## Retest result table

| Bug | Fix file (per commit msg) | Fix in `.py` source? | Fix in `dist/surrogate-studio.js`? | Live retest |
|-----|---------------------------|----------------------|------------------------------------|-------------|
| BUG-15 (`mae` undefined) | `src/notebook_bundle_core.js` | n/a (JS only) | ✅ in dist | not retested live yet |
| BUG-16 (Conv weight loader) | `server/runtime_weight_loader.py` | ✅ source has 6 hits of `param.dim()` | ❌ **0 hits in dist** | likely still broken |
| BUG-17 (BCE clamp) | `server/train_subprocess.py` | ✅ source has 2 hits of `target.float().clamp` | ❌ **0 hits in dist** | likely still broken |
| BUG-18 (matchWeight optional) | `oscillator_surrogate_pipeline.py` | ✅ source has `match_weight = float(d.get("matchWeight", 1.0))` | ❌ dist still has `missing required data.matchWeight` | **CONFIRMED still broken** — Oscillator Run All produces same exact ValueError |
| BUG-19 (Run All race) | `src/notebook_runner_ui.js` | n/a (JS only) | ✅ in dist | not retested live yet |
| BUG-20 (FM-* Preparing) | `src/tabs/trainer_tab.js` | n/a (JS only) | ✅ `maxValues = 500000` cap is in dist | **STILL BROKEN** — FM-GAN runner still hangs in "Preparing…" >120s; deeper issue than the row-cap fix addresses |

JS-only fixes (BUG-15, BUG-19) are in the bundle. Of the 4 fixes that touch a `.py` source file or rely on the JupyterLite kernel reading current Python, **none** actually reach the kernel.

---

## Root cause

`src/notebook_runtime_assets.js` (last touched **2026-03-11**) bakes a stringified copy of every `.py` file the kernel needs:

- `oscillator_surrogate_pipeline.py`
- `server/runtime_weight_loader.py`
- `server/train_subprocess.py`
- (and probably others — file is 100K+ chars, full inventory not enumerated here)

At Run-Notebook time, `_handleRunNotebook` calls `loadRuntimeSources()` in `src/notebook_bundle_core.js`. That function consults `window.OSCNotebookRuntimeAssets.files[name]` first — i.e. the embedded snapshot — *before* falling back to fetching `./notebooks/<name>` from disk. So the kernel always uses the snapshot, never the live source.

Claude Code's commit `cdd14dc` correctly edited the three `.py` files and rebuilt `dist/surrogate-studio.js`, but **did not regenerate `src/notebook_runtime_assets.js`**. The dist now contains:

- ✅ the new compiled JS for `notebook_bundle_core.js` and `trainer_tab.js`
- ✅ the new `notebook_runner_ui.js`
- ❌ the **same March-11 stale snapshot** of all the `.py` files

Result: run the kernel and you get the OLD logic back — verbatim, including the exact error message `"output_layer node 4: missing required data.matchWeight"` that no longer exists in any current `.py` source file.

---

## Reproduction (all I had to do)

```bash
$ grep -c "missing required data.matchWeight" dist/surrogate-studio.js
1                                                              # ← stale string still bundled

$ grep -c "match_weight = float(d.get(\"matchWeight\", 1.0))" dist/surrogate-studio.js
0                                                              # ← new fix not bundled

$ grep -c "param.dim()" dist/surrogate-studio.js               # BUG-16 branching
0

$ grep -c "head_pred.clamp\|target.float().clamp" dist/surrogate-studio.js   # BUG-17 clamp
0

$ stat -c '%y' src/notebook_runtime_assets.js
2026-03-11 12:13:14    # ← never regenerated since
```

Then in browser, Oscillator Run All produces:

```
File "oscillator_surrogate_pipeline.py", line 302, in infer_output_heads
    "targetType": target,
ValueError: output_layer node 4: missing required data.matchWeight
```

— line 302 in the **current** source has `"targetType": target,` (matches), but the validation that raises is the OLD one from before the fix.

---

## Required fix

**Option A (preferred)**: regenerate `src/notebook_runtime_assets.js` from current `.py` files, then rebuild `dist/`. There's almost certainly a build script that does this; if not, this one-liner generates the right shape:

```bash
node -e '
  const fs = require("fs");
  const files = {};
  const sources = [
    "oscillator_surrogate_pipeline.py",
    "server/runtime_weight_loader.py",
    "server/train_subprocess.py",
    "server/notebook_kernel.py",
    "server/dataset_source_loader.py",
    // ... full list per current notebook_runtime_assets.js
  ];
  for (const p of sources) {
    const name = p.split("/").pop();
    files[name] = fs.readFileSync(p, "utf8");
  }
  const out =
    "(function(g){\n" +
    "  g.OSCNotebookRuntimeAssets = { files: " + JSON.stringify(files) + " };\n" +
    "})(typeof globalThis !== \"undefined\" ? globalThis : this);\n";
  fs.writeFileSync("src/notebook_runtime_assets.js", out);
'
```

Then rerun the dist-build step.

**Option B (defensive — also do this)**: add a CI / build-time check:

```bash
# fail the build if any embedded source is older than its .py
for f in oscillator_surrogate_pipeline.py server/runtime_weight_loader.py server/train_subprocess.py; do
  if [ "$f" -nt "src/notebook_runtime_assets.js" ]; then
    echo "ERROR: $f is newer than embedded runtime assets — rebuild needed"
    exit 1
  fi
done
```

This would have caught the discrepancy before the commit landed.

**Option C (architectural — separate change)**: stop embedding the `.py` files. Have the notebook bundle path always `fetch("./notebooks/<name>")` from the served filesystem. The whole "embed snapshot" pattern only exists because the demo can be opened from `file://`, but for `localhost:3777` deployments and GitHub Pages, fetch works fine. This eliminates the entire class of "I edited the .py but forgot to rebake" bugs.

---

## Side findings discovered during retest

### BUG-21 (already filed): all 16 demo `index.html` files are truncated

After commit `0dffbe9` (BUG-13 typeof guard insertion), every demo `index.html` lost its closing `</script></body></html>` tags. File ends mid-inline-script:

```bash
$ for d in demo/*/; do echo "$d"; tail -1 "$d/index.html"; done
demo/Cell-Nuclei-Segmentation/
   if (preset.evaluations) preset.evaluations.forEach(...);
demo/Custom-CSV-Tutorial/
   ...
# all 16 the same
```

Browsers tolerate this and most demos still work, but it's malformed HTML. Fix: append `\n  </script>\n</body>\n</html>\n` to all 16 `index.html` files.

### BUG-20 fix is incomplete — FM-GAN still hangs

`maxValues = 500000` cap in `trainer_tab.js::_handleRunNotebook` is in the dist. But Fashion-MNIST GAN's Run Notebook button still leaves the runner in "Preparing…" indefinitely. Probing the live page state at >120s:

```js
window.store.snapshot().datasetsById["demo-gan-ds"].data
// → object with splitConfig/splitIndices/preview but
//    NO records, NO xTrain/yTrain
//    trainCount: 80, valCount: 10, testCount: 10
//    source: "synthetic"   ← but preset says fashion_mnist!
```

`ensureDatasetsReady` returns successfully but materializes only **100 rows of synthetic data**, not the 6000 Fashion-MNIST rows the preset requested (`totalCount: 6000, classFilter: [0]`). Records arrays remain empty, and `_prepareDatasetForNotebookExport` then waits for records that never come.

This is a separate bug from the row-cap fix — the cap addresses CSV size, but the underlying data-source-resolution path for the `fashion_mnist` schema fails to actually fetch real Fashion-MNIST data and silently substitutes synthetic. Needs a deeper investigation in `OSCDatasetModuleFashionMnist::resolveSplit` and the `useFullSource` / `classFilter` handling.

---

## Bottom line

- **BUG-22** (this report): biggest one — Python fixes are committed but not reaching the runtime. Blocks BUG-16, BUG-17, BUG-18. **Fix this first** — it unblocks 3 other bugs without further code changes.
- **BUG-20**: row-cap fix doesn't address the actual hang on FM-GAN. Needs separate investigation.
- **BUG-21**: cosmetic but real; quick fix.
- **BUG-15** & **BUG-19**: properly bundled; need a clean live retest now.

Recommended order:
1. Regenerate `src/notebook_runtime_assets.js` + rebuild `dist`. Verify `grep -c "missing required data.matchWeight" dist/surrogate-studio.js` returns 0.
2. Live retest Oscillator + Cell Nuclei + Synth Seg + Siamese — should all pass cleanly now if BUG-22 was the only blocker.
3. Investigate FM-GAN `data: null` issue separately.
4. Patch the 16 truncated `index.html`.
5. Re-sweep all 16 demos for any remaining issues.

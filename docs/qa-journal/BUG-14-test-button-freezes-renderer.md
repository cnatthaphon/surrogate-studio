# BUG-14: Test/Predict button freezes the renderer (no worker, no yield)

**Severity**: User-facing UX bug. Click Test on **any** pretrained card → page becomes unresponsive
for 30 seconds to several minutes depending on test set size. No spinner, no progress, no error
— just frozen UI. User will think the page crashed.

**Discovered**: Verifying BUG-13 fix end-to-end via UI clicks. Train uses Web Worker (BUG-9 fix
verified), so I expected Test to also yield. It does not.

---

## Reproduction

1. Open any demo with a pretrained card (e.g. `http://localhost:3777/demo/Custom-CSV-Tutorial/`)
2. Wait for bootstrap (BUG-12 fix: dataset records auto-materialize → 105 train / 22 test)
3. Click **MLP (pre-trained)** card
4. Click the **Test** button on the trainer page
5. Observe: page hangs. CDP `Runtime.evaluate` and `Page.captureScreenshot` calls time out at 45s
   → confirms the JS main thread is busy / not yielding.

Same pattern on every demo I tried (Custom CSV Iris 22-sample test, Fashion-MNIST GAN 60K test
froze 80+ seconds before I gave up).

---

## Why this surprised me

Train was already routed through `training_worker.js` (BUG-9 fix verified the `{kind: "stop"}`
message handling). So I expected Test/Predict to use the same pattern.

Inspection of `window` shows:

- `OSCTrainingWorkerBridge.runTrainingInWorker` ✅ (training off-thread)
- `OSCPredictionCore` exposes `batchPredict`, `computeRegressionMetrics`, etc. — **all sync**, all
  on the main thread
- No `OSCPredictionWorkerBridge` or equivalent

So when the user clicks **Test**:
- `_handleTestClick` (or similar in `src/tabs/trainer_tab.js`) calls
  `OSCPredictionCore.batchPredict(model, xTest)` directly
- TF.js `model.predict(...)` runs **synchronously** on the WebGL/WASM/CPU backend on the main
  thread; it doesn't yield
- For 22 Iris samples and a 867-param MLP this is technically <100ms of CPU work, but the
  renderer also has to reshape weights via tf.tensor allocations, run softmax, compute
  argmax, accuracy, confusion matrix — all sync, all without `await tf.nextFrame()`
- For Fashion-MNIST 60K + a GAN this can be 60+ seconds of unbroken sync work

End result: identical UX to a hard crash from the user's perspective.

---

## Required fix (architectural — pick one)

### Option A — Route Test through a worker (cleanest, mirrors Train)

Create `src/prediction_worker.js` + `src/prediction_worker_bridge.js` that mirror the training
worker pair:

- Worker receives `{kind: "predict", graphSpec, modelArtifacts, dataset}` payload
- Builds the model in worker context (TF.js works in workers via `OffscreenCanvas` or pure WASM
  backend)
- Runs predict + metrics
- Posts back `{kind: "complete", result: {predictions, metrics}}`

Bridge sets a busy flag + spinner, mirroring `runTrainingInWorker`. UI stays responsive.

This is the right long-term fix and matches the existing architecture for Train.

### Option B — Async-yield Test on the main thread (quick patch)

In `OSCPredictionCore.batchPredict`, split the work into chunks and `await tf.nextFrame()`
between chunks. The user gets a busy spinner instead of a frozen tab. Implementation is small,
~10 lines:

```js
async function batchPredict(model, xTest, batchSize = 64) {
  const out = [];
  for (let i = 0; i < xTest.length; i += batchSize) {
    const chunk = xTest.slice(i, i + batchSize);
    const t = tf.tensor(chunk);
    const yp = model.predict(t);
    out.push(...await yp.array());
    tf.dispose([t, yp]);
    await tf.nextFrame();   // yield to renderer
  }
  return out;
}
```

This is a much smaller change — fix it now to unblock LinkedIn shipping, then do Option A
properly later.

### Option C — Add a "Testing…" busy overlay so the freeze is at least communicated

Even with sync work, calling `setBusy(true)` synchronously **before** the predict loop wouldn't
help (the busy state can't render until the JS thread yields). So this option requires Option B
internally too. Not really a separate option.

**Recommended: Option B now (15 min fix), Option A later (cleaner architecture).**

---

## Acceptance criteria

1. Click Test on any pretrained card with a small test set (Iris 22, Synth Det 90, etc.) →
   results visible within 1 second.
2. Click Test on Fashion-MNIST GAN (60K test) → busy spinner / progress visible, page remains
   interactive (other tabs clickable, scroll works), result appears within ~30 sec.
3. CDP `Runtime.evaluate` running concurrently does NOT time out — proves main thread stays
   responsive.

---

## Related context

- BUG-9 (UX): Stop Training stuck on TF.js phased — was about Train worker not yielding
  to a stop signal. Same family of "long-running TF.js work blocking UI" but for the Train path.
  That fix is verified in place. Test path was missed.
- BUG-12: dataset records not materialized → Test would error fast. Now (with BUG-12 fix)
  records ARE materialized so Test actually runs prediction → exposes the freeze.
- BUG-14 was hidden by BUG-12. Now that BUG-12 is fixed, BUG-14 is visible.

This is a small but high-impact UX bug. Anyone clicking Test on a pretrained card from a
LinkedIn visitor's browser will see a frozen page for 30+ seconds. Worth fixing before post.

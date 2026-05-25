(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCPretrainedLoader = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Load pretrained weights from base64-encoded binary into trainer cards.
   *
   * Trainers with `_pretrainedVar` + `status: "done"` will have their weights
   * decoded from `window[_pretrainedVar]` and loaded into modelArtifacts.
   *
   * Binary format: [4-byte metaLen LE][JSON meta][Float32 weights]
   * Meta contains: weightSpecs, config, metrics, epochs, backend
   *
   * Usage:
   *   OSCPretrainedLoader.loadAll(store, preset.trainers);
   */

  function loadAll(store, trainers) {
    if (!store || !Array.isArray(trainers)) return;
    var W = typeof window !== "undefined" ? window : {};
    var fmt = W.OSCCheckpointFormatCore || null;

    trainers.forEach(function (t) {
      // Three short-circuit cases — only the FIRST TWO are
      // intentional skips. The third (pretrained var named but
      // global missing) is the silent-fallback bug reviewer caught
      // on PR #98: a trainer with _pretrainedVar:"DOES_NOT_EXIST"
      // used to be upserted unchanged at status="done" with no
      // artifacts. The Test tab's `if (!t.modelArtifacts)` guard
      // (PR #97) prevented the random-init inference symptom, but
      // the card still LOOKED successful. Surface the missing
      // asset explicitly so the user can fix the build / preset.
      if (!t._pretrainedVar || t.status !== "done") {
        store.upsertTrainerCard(t);
        return;
      }
      if (!W[t._pretrainedVar]) {
        console.error("[pretrained] Asset missing:", t.name, t._pretrainedVar);
        t.status = "error";
        t.error = "Pretrained asset missing: window." + t._pretrainedVar +
          " was not loaded (check the preset's pretrained <script> tag or bundle).";
        t.modelArtifacts = null;
        t.modelArtifactsLast = null;
        t.modelArtifactsBest = null;
        store.upsertTrainerCard(t);
        return;
      }

      try {
        var b64 = W[t._pretrainedVar];
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        var buf = bytes.buffer;
        var view = new DataView(buf);
        var metaLen = view.getUint32(0, true);
        var meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, metaLen)));
        var specs = meta.weightSpecs || [];
        var totalFloats = specs.reduce(function (s, sp) {
          return s + sp.shape.reduce(function (a, b) { return a * b; }, 1);
        }, 0);
        var weightBytes = new Uint8Array(buf, 4 + metaLen, totalFloats * 4);
        var alignedBuf = new ArrayBuffer(totalFloats * 4);
        new Uint8Array(alignedBuf).set(weightBytes);
        var weightValues = Array.from(new Float32Array(alignedBuf));

        t.modelArtifacts = fmt && typeof fmt.normalizeArtifacts === "function"
          ? fmt.normalizeArtifacts({ weightSpecs: specs, weightValues: weightValues }, { producerRuntime: meta.backend || "" })
          : { weightSpecs: specs, weightValues: weightValues };
        t.modelArtifactsLast = t.modelArtifacts;
        if (meta.config) t.config = Object.assign(t.config || {}, meta.config);
        if (meta.metrics) t.metrics = meta.metrics;
        if (meta.epochs && meta.epochs.length) store.replaceTrainerEpochs(t.id, meta.epochs);
      } catch (e) {
        // The previous handler only console.warn'd and left the card
        // at its inbound status="done" (the loader only runs on
        // already-"done" trainers). After the trainer_tab Test phase
        // strict-throw fix (PR #97), the Test path's weight-load
        // guard checks for non-empty t.modelArtifacts BEFORE
        // attempting load — so when this catch silently skipped the
        // artifact assignment, the user's "click Test" went through
        // a `hasWeights=false` branch and ran inference on random
        // initial weights. Same class as the test-path silent
        // fallback we just fixed; the failure point was upstream in
        // the pretrained decode. Mark the card as error explicitly
        // and null modelArtifacts so the trainer UI shows a real
        // failure instead of fake-success.
        console.error("[pretrained] Load failed:", t.name, e.message);
        t.status = "error";
        t.error = "Pretrained load failed: " + (e.message || "unknown");
        t.modelArtifacts = null;
        t.modelArtifactsLast = null;
        t.modelArtifactsBest = null;
      }

      store.upsertTrainerCard(t);
    });
  }

  /**
   * Auto-materialize dataset records for any dataset in the store that has
   * a module but no records. Called after loadAll so pretrained cards have
   * their datasets ready for Run Notebook without manual Generate step.
   *
   * Idempotent: skips datasets that already carry any recognized form of data
   * (records / xTrain / sourceDescriptor / splitIndices+sourceId / trajectories).
   *
   * Stashes the in-flight Promise on `store._datasetsReadyPromise` so other
   * consumers (e.g. the Run Notebook gate) can await readiness without
   * re-entering this function.
   *
   * Returns a Promise that resolves when all datasets are built (or immediately
   * if all are already populated).
   *
   * Usage:
   *   OSCPretrainedLoader.loadAll(store, preset.trainers);
   *   OSCPretrainedLoader.ensureDatasetsReady(store).then(function () { ... });
   */
  function ensureDatasetsReady(store) {
    if (!store || typeof store.listDatasets !== "function") return Promise.resolve();
    var W = typeof window !== "undefined" ? window : {};
    var dm = W.OSCDatasetModules || null;
    var reg = W.OSCDatasetSourceRegistry || null;
    var hasData = reg && typeof reg.hasDatasetData === "function"
      ? reg.hasDatasetData
      : function (ds) {
          var d = (ds && ds.data) || ds || {};
          return !!((d.records && (d.records.train || d.records.val)) ||
                    (d.xTrain && d.xTrain.length > 0) ||
                    d.sourceDescriptor ||
                    (d.sourceId && d.splitIndices && (
                      (d.splitIndices.train && d.splitIndices.train.length) ||
                      (d.splitIndices.val && d.splitIndices.val.length) ||
                      (d.splitIndices.test && d.splitIndices.test.length)
                    )));
        };
    if (!dm || typeof dm.getModuleForSchema !== "function") {
      var noopP = Promise.resolve();
      try { store._datasetsReadyPromise = noopP; } catch (_e) {}
      return noopP;
    }

    var datasets = store.listDatasets();
    var pending = [];
    datasets.forEach(function (ds) {
      if (hasData(ds)) return;
      // Find module for this dataset's schema
      var d = ds.data || ds;
      var schemaId = ds.schemaId || d.schemaId || "";
      var moduleId = ds.datasetModuleId || d.datasetModuleId || "";
      var modList = dm.getModuleForSchema(schemaId);
      if (!modList || !modList.length) return;
      var mod = dm.getModule(moduleId || modList[0].id);
      if (!mod || typeof mod.build !== "function") return;

      // Build the dataset — don't force sourceMode; let the module + preset config decide
      var cfg = Object.assign({
        seed: d.seed || ds.seed || 42,
        schemaId: schemaId,
        moduleId: mod.id,
      }, d.config || ds.config || {}, d.splitConfig ? { splitConfig: d.splitConfig } : {});
      if (d.totalCount || d.sourceTotalExamples) cfg.totalCount = d.totalCount || d.sourceTotalExamples;

      // Three silent-fallback failure modes existed pre-fix:
      //   1. mod.build(cfg) threw synchronously → console.warn + return,
      //      dataset card stayed at its prior status (often "new") with
      //      no error visible to the user
      //   2. async build resolved with falsy result → `if (!result) return;`
      //      silently skipped without marking the card
      //   3. async build rejected → console.warn-only catch, dataset
      //      stayed at prior status
      // In all three cases, the user saw the dataset card in its
      // pre-build state and could not tell why generation didn't run.
      // Same silent-fallback class as PR #98 Bug C (pretrained weight
      // decode) on the dataset side. Mark status="error" with a
      // descriptive ds.error message so the dataset_tab renderer
      // (PR-this Bug R) can surface it.
      function _markDatasetBuildFailure(reason) {
        if (typeof console !== "undefined" && console.error) {
          console.error("[pretrained] Dataset build failed:", ds.id, reason);
        }
        var failed = Object.assign({}, ds, {
          status: "error",
          error: "Dataset build failed: " + String(reason || "unknown"),
        });
        try { store.upsertDataset(failed); } catch (_e) { /* store unavailable */ }
      }

      var p;
      try {
        p = mod.build(cfg);
      } catch (e) {
        _markDatasetBuildFailure(e && e.message ? e.message : e);
        return;
      }
      if (!p || typeof p.then !== "function") p = Promise.resolve(p);

      pending.push(p.then(function (result) {
        if (!result) {
          _markDatasetBuildFailure("module returned no result (null/undefined)");
          return;
        }
        var updated = Object.assign({}, ds, { data: result, status: "ready", generatedAt: Date.now() });
        store.upsertDataset(updated);
      }).catch(function (e) {
        _markDatasetBuildFailure(e && e.message ? e.message : e);
      }));
    });

    var readyP = pending.length ? Promise.all(pending).then(function () {}) : Promise.resolve();
    try { store._datasetsReadyPromise = readyP; } catch (_e) {}
    return readyP;
  }

  /**
   * Await the in-flight readiness Promise stashed by ensureDatasetsReady,
   * if any. Resolves immediately if no build was kicked off (or it has
   * already completed).
   */
  function awaitDatasetsReady(store) {
    if (!store) return Promise.resolve();
    var p = store._datasetsReadyPromise;
    return (p && typeof p.then === "function") ? p : Promise.resolve();
  }

  return { loadAll: loadAll, ensureDatasetsReady: ensureDatasetsReady, awaitDatasetsReady: awaitDatasetsReady };
});

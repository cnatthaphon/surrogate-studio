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
      if (!t._pretrainedVar || t.status !== "done" || !W[t._pretrainedVar]) {
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
        console.warn("[pretrained] Load failed:", t.name, e.message);
      }

      store.upsertTrainerCard(t);
    });
  }

  /**
   * Auto-materialize dataset records for any dataset in the store that has
   * a module but no records. Called after loadAll so pretrained cards have
   * their datasets ready for Run Notebook without manual Generate step.
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
    if (!dm || typeof dm.getModuleForSchema !== "function") return Promise.resolve();

    var datasets = store.listDatasets();
    var pending = [];
    datasets.forEach(function (ds) {
      // Skip if records already populated
      var d = ds.data || ds;
      if ((d.records && (d.records.train || d.records.val)) ||
          (d.xTrain && d.xTrain.length > 0)) {
        return;
      }
      // Find module for this dataset's schema
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

      var p;
      try { p = mod.build(cfg); } catch (e) { console.warn("[pretrained] Dataset build failed:", ds.id, e.message); return; }
      if (!p || typeof p.then !== "function") p = Promise.resolve(p);

      pending.push(p.then(function (result) {
        if (!result) return;
        var updated = Object.assign({}, ds, { data: result, status: "ready", generatedAt: Date.now() });
        store.upsertDataset(updated);
      }).catch(function (e) {
        console.warn("[pretrained] Dataset build failed:", ds.id, e.message);
      }));
    });

    return pending.length ? Promise.all(pending) : Promise.resolve();
  }

  return { loadAll: loadAll, ensureDatasetsReady: ensureDatasetsReady };
});

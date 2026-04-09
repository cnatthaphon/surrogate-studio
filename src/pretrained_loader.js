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

  return { loadAll: loadAll };
});

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCDatasetSourceDescriptor = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function _clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function normalize(raw) {
    var d = raw && typeof raw === "object" ? raw : {};
    var kind = String(d.kind || d.deliveryMode || "").trim().toLowerCase();
    if (!kind) return null;
    return {
      kind: kind,
      schemaId: String(d.schemaId || "").trim().toLowerCase(),
      datasetModuleId: String(d.datasetModuleId || "").trim().toLowerCase(),
      format: String(d.format || "").trim().toLowerCase(),
      datasetPath: String(d.datasetPath || "").trim(),
      manifestPath: String(d.manifestPath || "").trim(),
      rootDir: String(d.rootDir || "").trim(),
      recipeId: String(d.recipeId || d.taskRecipeId || "").trim().toLowerCase(),
      deliveryMode: String(d.deliveryMode || "").trim().toLowerCase(),
      preferServerSource: d.preferServerSource !== false,
      metadata: (d.metadata && typeof d.metadata === "object") ? _clone(d.metadata) : {},
    };
  }

  function shouldUseServerReference(desc) {
    var d = normalize(desc);
    if (!d) return false;
    if (d.preferServerSource === false) return false;
    return d.kind === "local_csv_manifest" || d.kind === "local_json_dataset" || d.deliveryMode === "server_reference";
  }

  return {
    normalize: normalize,
    shouldUseServerReference: shouldUseServerReference,
  };
});

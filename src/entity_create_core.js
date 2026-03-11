(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCEntityCreateCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function pickOptionValue(options, preferred) {
    var list = Array.isArray(options) ? options : [];
    var want = String(preferred || "").trim();
    if (want) {
      var hasWant = list.some(function (x) {
        return String((x && x.value) || "").trim() === want;
      });
      if (hasWant) return want;
    }
    return String((list[0] && list[0].value) || "").trim();
  }

  function buildSchemaOptions(schemaEntries, resolveSchemaId) {
    var resolve = typeof resolveSchemaId === "function"
      ? resolveSchemaId
      : function (x) { return String(x || "oscillator"); };
    var rows = Array.isArray(schemaEntries) ? schemaEntries : [];
    return rows
      .map(function (s) {
        if (!s || typeof s !== "object") return null;
        var sid = String(resolve(s.id || "oscillator") || "").trim();
        if (!sid) return null;
        return {
          value: sid,
          label: String(s.label || sid),
        };
      })
      .filter(Boolean);
  }

  function normalizeCreateForm(ctx, rawCfg, api) {
    var c = (ctx && typeof ctx === "object") ? ctx : {};
    var cfg = (rawCfg && typeof rawCfg === "object") ? rawCfg : {};
    var a = (api && typeof api === "object") ? api : {};
    var resolveSchemaId = typeof a.resolveSchemaId === "function"
      ? a.resolveSchemaId
      : function (x) { return String(x || "oscillator"); };
    var normalizeRuntimeId = typeof a.normalizeRuntimeId === "function"
      ? a.normalizeRuntimeId
      : function (x) { return String(x || "js_client"); };
    var normalizeRuntimeBackend = typeof a.normalizeRuntimeBackend === "function"
      ? a.normalizeRuntimeBackend
      : function (_runtime, backend) { return String(backend || "auto"); };
    var schemaOptions = buildSchemaOptions(c.schemaEntries || [], resolveSchemaId);
    var defaultSchema = pickOptionValue(schemaOptions, c.defaultSchemaId || "oscillator") || "oscillator";
    var schemaId = resolveSchemaId(
      pickOptionValue(schemaOptions, cfg.schemaId || defaultSchema) || defaultSchema
    );
    var runtime = normalizeRuntimeId(cfg.runtime || c.defaultRuntime || "js_client");
    var runtimeBackend = normalizeRuntimeBackend(runtime, cfg.runtimeBackend || c.defaultRuntimeBackend || "auto");

    var out = {
      name: String(cfg.name || "").trim(),
      schemaId: schemaId,
      moduleId: "",
      datasetId: "",
      modelId: "",
      runtime: runtime,
      runtimeBackend: runtimeBackend,
    };

    var kind = String(c.kind || "").trim().toLowerCase();
    if (kind === "trainer") {
      out.schemaId = resolveSchemaId(schemaId || defaultSchema);
      out.modelId = "";
      out.datasetId = "";
      return out;
    }

    return out;
  }

  return {
    pickOptionValue: pickOptionValue,
    buildSchemaOptions: buildSchemaOptions,
    normalizeCreateForm: normalizeCreateForm,
  };
});

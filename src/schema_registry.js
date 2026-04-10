(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCSchemaRegistry = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var _schemas = {};
  var _defaultSchemaId = "oscillator";

  function _clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function _id(raw) {
    var v = String(raw == null ? "" : raw).trim().toLowerCase();
    v = v.replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
    return v || "oscillator";
  }

  function _normalizeModel(model, fallbackId, fallbackLabel) {
    var m = model || {};
    var outputs = Array.isArray(m.outputs) ? m.outputs.slice() : [];
    outputs = outputs
      .map(function (o) {
        var key = String(o && o.key != null ? o.key : "").trim().toLowerCase();
        if (!key) return null;
        var ht = String(o && o.headType != null ? o.headType : "regression").trim().toLowerCase();
        return {
          key: key,
          label: String(o && o.label != null ? o.label : key),
          headType: ht,
        };
      })
      .filter(Boolean);
    // no hardcoded fallback — if schema has no outputs, return empty
    // the schema MUST define its own output keys

    var params = Array.isArray(m.params) ? m.params.slice() : [];
    params = params
      .map(function (p) {
        var key = String(p && p.key != null ? p.key : "").trim().toLowerCase();
        if (!key) return null;
        return {
          key: key,
          label: String(p && p.label != null ? p.label : key),
        };
      })
      .filter(Boolean);

    var presets = Array.isArray(m.presets) ? m.presets.slice() : [];
    presets = presets
      .map(function (p) {
        if (typeof p === "string" || typeof p === "number") {
          var pid0 = String(p).trim();
          if (!pid0) return null;
          return { id: pid0, label: pid0, metadata: {} };
        }
        if (!p || typeof p !== "object") return null;
        var pid = String(p.id != null ? p.id : p.key != null ? p.key : "").trim();
        if (!pid) return null;
        return {
          id: pid,
          label: String(p.label != null ? p.label : pid),
          metadata: (p.metadata && typeof p.metadata === "object") ? _clone(p.metadata) : {},
        };
      })
      .filter(Boolean);

    return {
      id: _id(m.id || fallbackId),
      label: String(m.label || fallbackLabel || fallbackId || "schema"),
      outputs: outputs,
      params: params,
      presets: presets,
      metadata: (m.metadata && typeof m.metadata === "object") ? _clone(m.metadata) : {},
    };
  }

  function _normalizeTaskRecipeId(def, dataset, metadata) {
    var raw = (def && (def.taskRecipeId || def.taskRecipe || def.recipeId)) ||
      (dataset && dataset.metadata && (dataset.metadata.taskRecipeId || dataset.metadata.taskRecipe)) ||
      (metadata && (metadata.taskRecipeId || metadata.taskRecipe)) ||
      "supervised_standard";
    return _id(raw, "supervised_standard");
  }

  function _normalizeDataset(dataset, fallbackId, fallbackLabel) {
    var d = dataset || {};
    var splitDefaults = (d.splitDefaults && typeof d.splitDefaults === "object") ? d.splitDefaults : {};
    return {
      id: _id(d.id || fallbackId),
      label: String(d.label || fallbackLabel || fallbackId || "dataset"),
      sampleType: String(d.sampleType || "trajectory"),
      splitUnit: String(d.splitUnit || "trajectory"),
      splitDefaults: {
        mode: String(splitDefaults.mode || "stratified_scenario"),
        train: Number.isFinite(Number(splitDefaults.train)) ? Number(splitDefaults.train) : 0.70,
        val: Number.isFinite(Number(splitDefaults.val)) ? Number(splitDefaults.val) : 0.15,
        test: Number.isFinite(Number(splitDefaults.test)) ? Number(splitDefaults.test) : 0.15,
      },
      metadata: (d.metadata && typeof d.metadata === "object") ? _clone(d.metadata) : {},
    };
  }

  function _normalizeSplitDefaults(raw) {
    return {
      mode: String((raw && raw.mode) || "random").trim() || "random",
      train: Number.isFinite(Number(raw && raw.train)) ? Number(raw.train) : 0.70,
      val: Number.isFinite(Number(raw && raw.val)) ? Number(raw.val) : 0.15,
      test: Number.isFinite(Number(raw && raw.test)) ? Number(raw.test) : 0.15,
    };
  }

  function _normalizePreconfig(preconfig) {
    var cfg = preconfig || {};
    var ds = cfg.dataset || {};
    var model = cfg.model || {};
    return {
      dataset: {
        defaultModuleId: String(ds.defaultModuleId || ds.defaultModule || "").trim().toLowerCase(),
        splitDefaults: _normalizeSplitDefaults(ds.splitDefaults || {}),
      },
      model: {
        defaultPreset: String(model.defaultPreset || model.defaultPresetId || "").trim(),
      },
    };
  }

  function _coalescePreconfig(rawPreconfig, schemaEntry) {
    var p = _normalizePreconfig(rawPreconfig);

    if (!p.dataset.defaultModuleId && schemaEntry && schemaEntry.id) {
      p.dataset.defaultModuleId = String(schemaEntry.id);
    }
    if (!schemaEntry) {
      return p;
    }

    if (!p.dataset.splitDefaults.mode && schemaEntry.splitDefaults && schemaEntry.splitDefaults.mode) {
      p.dataset.splitDefaults.mode = String(schemaEntry.splitDefaults.mode);
    }
    if (!Number.isFinite(Number(rawPreconfig && rawPreconfig.dataset && rawPreconfig.dataset.splitDefaults && rawPreconfig.dataset.splitDefaults.train)) &&
        Number.isFinite(Number(schemaEntry.splitDefaults && schemaEntry.splitDefaults.train))) {
      p.dataset.splitDefaults.train = Number(schemaEntry.splitDefaults.train);
    }
    if (!Number.isFinite(Number(rawPreconfig && rawPreconfig.dataset && rawPreconfig.dataset.splitDefaults && rawPreconfig.dataset.splitDefaults.val)) &&
        Number.isFinite(Number(schemaEntry.splitDefaults && schemaEntry.splitDefaults.val))) {
      p.dataset.splitDefaults.val = Number(schemaEntry.splitDefaults.val);
    }
    if (!Number.isFinite(Number(rawPreconfig && rawPreconfig.dataset && rawPreconfig.dataset.splitDefaults && rawPreconfig.dataset.splitDefaults.test)) &&
        Number.isFinite(Number(schemaEntry.splitDefaults && schemaEntry.splitDefaults.test))) {
      p.dataset.splitDefaults.test = Number(schemaEntry.splitDefaults.test);
    }

    return p;
  }
  function registerSchema(schemaDef, opts) {
    var def = (schemaDef && typeof schemaDef === "object") ? schemaDef : {};
    var sid = _id(def.id || def.schemaId || (def.dataset && def.dataset.id) || (def.model && def.model.id));
    var label = String(def.label || (def.dataset && def.dataset.label) || (def.model && def.model.label) || sid);

    var modelSource = (def.model && typeof def.model === "object") ? def.model : def;
    var model = _normalizeModel(modelSource, sid, label);
    var dataset = _normalizeDataset(def.dataset, sid, label);
    var preconfig = _coalescePreconfig(def.preconfig, dataset);

    var entry = {
      id: sid,
      label: label,
      description: String(def.description || ""),
      dataset: dataset,
      model: model,
      taskRecipeId: _normalizeTaskRecipeId(def, dataset, def.metadata),
      preconfig: preconfig,
      metadata: (def.metadata && typeof def.metadata === "object") ? _clone(def.metadata) : {},
    };

    _schemas[sid] = entry;
    if (!_defaultSchemaId || !_schemas[_defaultSchemaId] || (opts && opts.makeDefault === true)) {
      _defaultSchemaId = sid;
    }
    return _clone(entry);
  }

  function registerSchemas(items, opts) {
    var arr = Array.isArray(items) ? items : [];
    var out = [];
    for (var i = 0; i < arr.length; i += 1) {
      out.push(registerSchema(arr[i], opts));
    }
    return out;
  }

  function unregisterSchema(schemaId) {
    var sid = _id(schemaId);
    if (!_schemas[sid]) return false;
    delete _schemas[sid];
    if (_defaultSchemaId === sid) {
      var keys = Object.keys(_schemas);
      _defaultSchemaId = keys.length ? keys[0] : "";
    }
    return true;
  }

  function resolveSchemaId(raw, fallback) {
    var fid = _id(fallback || _defaultSchemaId || "oscillator");
    var sid = _id(raw || fid);
    if (_schemas[sid]) return sid;
    if (_schemas[fid]) return fid;
    var keys = Object.keys(_schemas);
    return keys.length ? keys[0] : "oscillator";
  }

  function getSchema(schemaId) {
    var sid = resolveSchemaId(schemaId);
    return _schemas[sid] ? _clone(_schemas[sid]) : null;
  }

  function getModelSchema(schemaId) {
    var s = getSchema(schemaId);
    return s ? _clone(s.model) : null;
  }

  function getDatasetSchema(schemaId) {
    var s = getSchema(schemaId);
    return s ? _clone(s.dataset) : null;
  }

  function getTaskRecipeId(schemaId) {
    var s = getSchema(schemaId);
    return s ? String(s.taskRecipeId || "supervised_standard") : "supervised_standard";
  }

  function listSchemas() {
    return Object.keys(_schemas)
      .sort()
      .map(function (sid) {
        var s = _schemas[sid];
        return {
          id: sid,
          label: String(s.label || sid),
          description: String(s.description || ""),
          taskRecipeId: String(s.taskRecipeId || "supervised_standard"),
          model: {
            outputs: Array.isArray(s.model && s.model.outputs) ? s.model.outputs.length : 0,
            params: Array.isArray(s.model && s.model.params) ? s.model.params.length : 0,
            presets: Array.isArray(s.model && s.model.presets) ? s.model.presets.length : 0,
          },
        };
      });
  }

  function getOutputKeys(schemaId) {
    var m = getModelSchema(schemaId);
    if (!m || !Array.isArray(m.outputs)) return [{ key: "x", headType: "regression" }];
    return m.outputs.map(function (o) { return { key: String(o.key), headType: String(o.headType || "regression") }; });
  }

  function getParamDefs(schemaId) {
    var m = getModelSchema(schemaId);
    return (m && Array.isArray(m.params)) ? _clone(m.params) : [];
  }

  function getPresetList(schemaId) {
    var m = getModelSchema(schemaId);
    if (!m || !Array.isArray(m.presets)) return [];
    return m.presets.map(function (p) { return String((p && p.id) || ""); }).filter(Boolean);
  }

  function getPresetDefs(schemaId) {
    var m = getModelSchema(schemaId);
    return (m && Array.isArray(m.presets)) ? _clone(m.presets) : [];
  }

  function getPreconfig(schemaId) {
    var sid = resolveSchemaId(schemaId);
    return _schemas[sid] ? _clone(_schemas[sid].preconfig || {}) : null;
  }

  function getDatasetPreconfig(schemaId) {
    var p = getPreconfig(schemaId);
    return p && p.dataset ? _clone(p.dataset) : {};
  }

  function getModelPreconfig(schemaId) {
    var p = getPreconfig(schemaId);
    return p && p.model ? _clone(p.model) : {};
  }

  function getDefaultDatasetModuleId(schemaId) {
    var p = getDatasetPreconfig(schemaId);
    return String((p && p.defaultModuleId) || "").trim().toLowerCase();
  }

  function getDefaultModelPresetId(schemaId) {
    var p = getModelPreconfig(schemaId);
    return String((p && p.defaultPreset) || "").trim();
  }

  function getDefaultSchemaId() {
    return resolveSchemaId(_defaultSchemaId || "oscillator");
  }

  return {
    registerSchema: registerSchema,
    registerSchemas: registerSchemas,
    unregisterSchema: unregisterSchema,
    resolveSchemaId: resolveSchemaId,
    getSchema: getSchema,
    getModelSchema: getModelSchema,
    getDatasetSchema: getDatasetSchema,
    getTaskRecipeId: getTaskRecipeId,
    listSchemas: listSchemas,
    getOutputKeys: getOutputKeys,
    getParamDefs: getParamDefs,
    getPresetList: getPresetList,
    getPresetDefs: getPresetDefs,
    getPreconfig: getPreconfig,
    getDatasetPreconfig: getDatasetPreconfig,
    getModelPreconfig: getModelPreconfig,
    getDefaultDatasetModuleId: getDefaultDatasetModuleId,
    getDefaultModelPresetId: getDefaultModelPresetId,
    getDefaultSchemaId: getDefaultSchemaId,
  };
});

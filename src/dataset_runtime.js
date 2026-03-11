(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      (typeof globalThis !== "undefined" ? globalThis.OSCSchemaRegistry : null),
      (typeof globalThis !== "undefined" ? globalThis.OSCDatasetModules : null)
    );
    return;
  }
  root.OSCDatasetRuntime = factory(root.OSCSchemaRegistry, root.OSCDatasetModules);
})(typeof globalThis !== "undefined" ? globalThis : this, function (schemaRegistry, datasetModules) {
  "use strict";

  if (!schemaRegistry) {
    throw new Error("OSCDatasetRuntime requires OSCSchemaRegistry.");
  }

  function resolveSchemaId(schemaId, fallback) {
    return schemaRegistry.resolveSchemaId(schemaId, fallback || "oscillator");
  }

  function getDatasetSchema(schemaId) {
    var sid = resolveSchemaId(schemaId, "oscillator");
    return schemaRegistry.getDatasetSchema(sid) || {
      id: sid,
      label: sid,
      sampleType: "trajectory",
      splitUnit: "trajectory",
      splitDefaults: {
        mode: "random",
        train: 0.7,
        val: 0.15,
        test: 0.15,
      },
      metadata: {},
    };
  }

  function getDatasetPreconfig(schemaId) {
    var sid = resolveSchemaId(schemaId, "oscillator");
    if (typeof schemaRegistry.getDatasetPreconfig === "function") {
      return schemaRegistry.getDatasetPreconfig(sid) || {};
    }
    return {};
  }

  function getModelPreconfig(schemaId) {
    var sid = resolveSchemaId(schemaId, "oscillator");
    if (typeof schemaRegistry.getModelPreconfig === "function") {
      return schemaRegistry.getModelPreconfig(sid) || {};
    }
    return {};
  }

  function getDefaultModelPresetId(schemaId) {
    var preset = "";
    var p = getModelPreconfig(schemaId);
    if (p && typeof p.defaultPreset === "string") {
      preset = String(p.defaultPreset || "").trim();
    }
    return preset;
  }

  function getSplitModeDefs(schemaId) {
    var schema = getDatasetSchema(schemaId);
    var raw = (schema && schema.metadata && Array.isArray(schema.metadata.splitModes))
      ? schema.metadata.splitModes
      : [];
    var defs = raw
      .map(function (x) {
        if (!x || typeof x !== "object") return null;
        var id = String(x.id || "").trim();
        if (!id) return null;
        return {
          id: id,
          label: String(x.label || id),
          stratifyKey: String(x.stratifyKey || "").trim(),
        };
      })
      .filter(Boolean);
    if (defs.length) return defs;
    var fallbackMode = String((schema && schema.splitDefaults && schema.splitDefaults.mode) || "random");
    return [{ id: fallbackMode, label: fallbackMode, stratifyKey: "" }];
  }

  function getDisplayColumns(schemaId) {
    var schema = getDatasetSchema(schemaId);
    var cols = (schema && schema.metadata && schema.metadata.display && Array.isArray(schema.metadata.display.tableColumns))
      ? schema.metadata.display.tableColumns
      : [];
    return cols.map(function (x) { return String(x || "").trim(); }).filter(Boolean);
  }

  function getUiProfile(schemaId) {
    var schema = getDatasetSchema(schemaId);
    var sid = resolveSchemaId(schemaId, "oscillator");
    var md = (schema && schema.metadata && typeof schema.metadata === "object") ? schema.metadata : {};
    var ui = (md.ui && typeof md.ui === "object") ? md.ui : {};
    var sampleType = String(schema && schema.sampleType || "trajectory").trim().toLowerCase();
    var sidebarMode = String(ui.sidebarMode || "").trim().toLowerCase();
    if (!sidebarMode) sidebarMode = sid === "oscillator" ? "oscillator" : "generic";
    var viewer = String(ui.viewer || "").trim().toLowerCase();
    if (!viewer) viewer = sampleType === "image" ? "image" : "trajectory";
    return {
      sidebarMode: sidebarMode,
      viewer: viewer,
    };
  }

  function _modulesApi() {
    if (!datasetModules) {
      return {
        listModules: function () {
          return [{
            id: "oscillator",
            schemaId: "oscillator",
            label: "Oscillator",
            description: "RK4 oscillator dataset builder",
            kind: "builtin_sidebar",
          }];
        },
        getModule: function (moduleId) {
          return String(moduleId || "").trim().toLowerCase() === "oscillator"
            ? this.listModules()[0]
            : null;
        },
      };
    }
    return datasetModules;
  }

  function listModules() {
    var api = _modulesApi();
    var raw = (api && typeof api.listModules === "function") ? api.listModules() : [];
    return Array.isArray(raw) ? raw
      .map(function (m) {
        if (!m || typeof m !== "object") return null;
        var id = String(m.id || "").trim().toLowerCase();
        if (!id) return null;
        var sid = resolveSchemaId(m.schemaId || "oscillator", "oscillator");
        return {
          id: id,
          schemaId: sid,
          label: String(m.label || id),
          description: String(m.description || ""),
          kind: String(m.kind || "panel_builder"),
        };
      })
      .filter(Boolean)
      : [];
  }

  function getModule(moduleId) {
    var id = String(moduleId || "").trim().toLowerCase();
    var api = _modulesApi();
    if (!api || typeof api.getModule !== "function") return null;
    var m = api.getModule(id);
    if (!m || typeof m !== "object") return null;
    return m;
  }

  function getModulesForSchema(schemaId) {
    var sid = resolveSchemaId(schemaId, "oscillator");
    return listModules().filter(function (m) {
      return resolveSchemaId(m.schemaId || "oscillator", "oscillator") === sid;
    });
  }

  function buildDataset(moduleId, cfg) {
    var mod = getModule(moduleId);
    if (!mod || typeof mod.build !== "function") {
      throw new Error("Dataset module '" + String(moduleId || "") + "' does not provide a build function.");
    }
    var out = mod.build(cfg || {});
    if (out && typeof out.then === "function") {
      return out.then(function (dsAsync) {
        if (!dsAsync || typeof dsAsync !== "object") {
          throw new Error("Dataset module '" + String(moduleId || "") + "' build failed.");
        }
        dsAsync.schemaId = resolveSchemaId(dsAsync.schemaId || mod.schemaId || "oscillator", "oscillator");
        return dsAsync;
      });
    }
    if (!out || typeof out !== "object") {
      throw new Error("Dataset module '" + String(moduleId || "") + "' build failed.");
    }
    out.schemaId = resolveSchemaId(out.schemaId || mod.schemaId || "oscillator", "oscillator");
    return out;
  }

  function pickDefaultModuleForSchema(schemaId) {
    var sid = resolveSchemaId(schemaId, "oscillator");
    var cfg = getDatasetPreconfig(sid);
    if (cfg && cfg.defaultModuleId) {
      var candidate = String(cfg.defaultModuleId).trim().toLowerCase();
      if (candidate && getModule(candidate)) return candidate;
      if (candidate) {
        throw new Error("Schema '" + sid + "' declares defaultModuleId '" + candidate + "' but no matching dataset module is registered.");
      }
    }
    throw new Error("Schema '" + sid + "' does not declare dataset.preconfig.defaultModuleId.");
  }

  return {
    resolveSchemaId: resolveSchemaId,
    getDatasetSchema: getDatasetSchema,
    getDatasetPreconfig: getDatasetPreconfig,
    getModelPreconfig: getModelPreconfig,
    getDefaultModelPresetId: getDefaultModelPresetId,
    getSplitModeDefs: getSplitModeDefs,
    getDisplayColumns: getDisplayColumns,
    getUiProfile: getUiProfile,
    listModules: listModules,
    getModule: getModule,
    getModulesForSchema: getModulesForSchema,
    pickDefaultModuleForSchema: pickDefaultModuleForSchema,
    buildDataset: buildDataset,
  };
});

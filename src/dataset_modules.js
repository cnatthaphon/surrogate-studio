(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    function safeRequire(path) {
      try {
        return require(path);
      } catch (_err) {
        return null;
      }
    }
    module.exports = factory(
      typeof globalThis !== "undefined" ? globalThis : this,
      [
        safeRequire("./dataset_modules/oscillator_module.js"),
        safeRequire("./dataset_modules/mnist_module.js"),
        safeRequire("./dataset_modules/fashion_mnist_module.js"),
      ]
    );
    return;
  }
  root.OSCDatasetModules = factory(root, []);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, preloadedSources) {
  "use strict";

  var modulesById = Object.create(null);

  function normalizeModule(moduleLike) {
    if (!moduleLike || typeof moduleLike !== "object") return null;
    var id = String(moduleLike.id || "").trim().toLowerCase();
    if (!id) return null;
    return {
      id: id,
      schemaId: String(moduleLike.schemaId || id).trim().toLowerCase(),
      label: String(moduleLike.label || id),
      description: String(moduleLike.description || ""),
      helpText: String(moduleLike.helpText || ""),
      kind: String(moduleLike.kind || "panel_builder"),
      metadata: (moduleLike.metadata && typeof moduleLike.metadata === "object") ? moduleLike.metadata : null,
      preconfig: (moduleLike.preconfig && typeof moduleLike.preconfig === "object") ? moduleLike.preconfig : null,
      playground: (moduleLike.playground && typeof moduleLike.playground === "object") ? moduleLike.playground : null,
      playgroundApi: (moduleLike.playgroundApi && typeof moduleLike.playgroundApi === "object") ? moduleLike.playgroundApi : null,
      uiApi: (moduleLike.uiApi && typeof moduleLike.uiApi === "object") ? moduleLike.uiApi : null,
      bindUi: moduleLike.uiApi && typeof moduleLike.uiApi.bindUi === "function" ? moduleLike.uiApi.bindUi : null,
      build: typeof moduleLike.build === "function" ? moduleLike.build : null,
    };
  }

  function cloneModule(moduleDef, includeBuild) {
    if (!moduleDef) return null;
    return {
      id: moduleDef.id,
      schemaId: moduleDef.schemaId,
      label: moduleDef.label,
      description: moduleDef.description,
      helpText: moduleDef.helpText || "",
      kind: moduleDef.kind,
      metadata: moduleDef.metadata || null,
      preconfig: moduleDef.preconfig || null,
      playground: moduleDef.playground || null,
      playgroundApi: moduleDef.playgroundApi || null,
      uiApi: moduleDef.uiApi || null,
      bindUi: moduleDef.bindUi || null,
      build: includeBuild ? moduleDef.build : undefined,
    };
  }

  function collectModuleDefs(source) {
    if (!source) return [];
    if (Array.isArray(source)) return source.slice();
    if (typeof source !== "object") return [];
    if (Array.isArray(source.modules)) return source.modules.slice();
    if (source.id) return [source];
    return [];
  }

  function registerModule(moduleLike, options) {
    var normalized = normalizeModule(moduleLike);
    if (!normalized) return null;
    var overwrite = !!(options && options.overwrite);
    if (!overwrite && modulesById[normalized.id]) return cloneModule(modulesById[normalized.id], true);
    modulesById[normalized.id] = normalized;
    return cloneModule(normalized, true);
  }

  function registerModules(moduleList, options) {
    if (!Array.isArray(moduleList)) return 0;
    var added = 0;
    for (var i = 0; i < moduleList.length; i += 1) {
      if (registerModule(moduleList[i], options)) added += 1;
    }
    return added;
  }

  function listModules() {
    return Object.keys(modulesById).map(function (id) {
      return cloneModule(modulesById[id], false);
    });
  }

  function getModule(moduleId) {
    var id = String(moduleId || "").trim().toLowerCase();
    return modulesById[id] ? cloneModule(modulesById[id], true) : null;
  }

  function getModuleForSchema(schemaId) {
    var sid = String(schemaId || "").trim().toLowerCase();
    return listModules().filter(function (m) {
      return String(m.schemaId || "").toLowerCase() === sid;
    });
  }

  function bootstrapFromSource(source) {
    registerModules(collectModuleDefs(source), { overwrite: false });
  }

  function bootstrapFromGlobals() {
    if (!root || typeof root !== "object") return;
    var keys = Object.keys(root);
    for (var i = 0; i < keys.length; i += 1) {
      var k = keys[i];
      if (k === "OSCDatasetModules") continue;
      if (!/^OSCDatasetModule[A-Za-z0-9_]*$/.test(k)) continue;
      bootstrapFromSource(root[k]);
    }
  }

  if (Array.isArray(preloadedSources)) {
    for (var i = 0; i < preloadedSources.length; i += 1) {
      bootstrapFromSource(preloadedSources[i]);
    }
  }
  bootstrapFromGlobals();

  if (!Object.keys(modulesById).length) {
    registerModule({
      id: "oscillator",
      schemaId: "oscillator",
      label: "Oscillator",
      description: "RK4 oscillator dataset builder (existing sidebar controls).",
      kind: "builtin_sidebar",
      build: null,
    });
  }

  return {
    listModules: listModules,
    getModule: getModule,
    getModuleForSchema: getModuleForSchema,
    registerModule: registerModule,
    registerModules: registerModules,
  };
});

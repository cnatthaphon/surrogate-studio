(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCTaskRecipeRegistry = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var _recipes = Object.create(null);
  var _defaultRecipeId = "supervised_standard";

  function _clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function _id(raw, fallback) {
    var v = String(raw == null ? "" : raw).trim().toLowerCase();
    v = v.replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
    return v || String(fallback || _defaultRecipeId);
  }

  function _normalize(raw) {
    var def = raw && typeof raw === "object" ? raw : {};
    var id = _id(def.id || def.recipeId, _defaultRecipeId);
    return {
      id: id,
      label: String(def.label || id),
      description: String(def.description || ""),
      family: String(def.family || "supervised").trim().toLowerCase() || "supervised",
      trainMode: String(def.trainMode || "standard").trim().toLowerCase() || "standard",
      supportsLocalDatasetSource: def.supportsLocalDatasetSource !== false,
      supportsNotebookRuntime: def.supportsNotebookRuntime !== false,
      supportsBrowserRuntime: def.supportsBrowserRuntime !== false,
      supportsServerRuntime: def.supportsServerRuntime !== false,
      metadata: (def.metadata && typeof def.metadata === "object") ? _clone(def.metadata) : {},
    };
  }

  function registerRecipe(raw, opts) {
    var next = _normalize(raw);
    var overwrite = !!(opts && opts.overwrite);
    if (!overwrite && _recipes[next.id]) return _clone(_recipes[next.id]);
    _recipes[next.id] = next;
    if (!_defaultRecipeId || !_recipes[_defaultRecipeId] || (opts && opts.makeDefault)) {
      _defaultRecipeId = next.id;
    }
    return _clone(next);
  }

  function registerRecipes(items, opts) {
    var arr = Array.isArray(items) ? items : [];
    var out = [];
    for (var i = 0; i < arr.length; i += 1) out.push(registerRecipe(arr[i], opts));
    return out;
  }

  function resolveRecipeId(raw, fallback) {
    var fid = _id(fallback || _defaultRecipeId, _defaultRecipeId);
    var rid = _id(raw || fid, fid);
    if (_recipes[rid]) return rid;
    if (_recipes[fid]) return fid;
    var keys = Object.keys(_recipes);
    return keys.length ? keys[0] : _defaultRecipeId;
  }

  function getRecipe(recipeId) {
    var rid = resolveRecipeId(recipeId);
    return _recipes[rid] ? _clone(_recipes[rid]) : null;
  }

  function listRecipes() {
    return Object.keys(_recipes).sort().map(function (id) { return _clone(_recipes[id]); });
  }

  function getDefaultRecipeId() {
    return resolveRecipeId(_defaultRecipeId);
  }

  return {
    registerRecipe: registerRecipe,
    registerRecipes: registerRecipes,
    resolveRecipeId: resolveRecipeId,
    getRecipe: getRecipe,
    listRecipes: listRecipes,
    getDefaultRecipeId: getDefaultRecipeId,
  };
});

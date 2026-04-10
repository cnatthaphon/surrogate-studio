(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCTaskRecipeRuntime = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function _asArray(x) {
    return Array.isArray(x) ? x : [];
  }

  function _normId(raw, fallback) {
    var v = String(raw == null ? "" : raw).trim().toLowerCase();
    v = v.replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
    return v || String(fallback || "");
  }

  function resolveRecipe(schemaRegistry, taskRecipeRegistry, schemaId, datasetData, explicitRecipeId) {
    if (!taskRecipeRegistry || typeof taskRecipeRegistry.getRecipe !== "function") return null;
    var recipeId = _normId(explicitRecipeId || "", "");
    if (!recipeId && schemaRegistry && typeof schemaRegistry.getTaskRecipeId === "function") {
      recipeId = _normId(schemaRegistry.getTaskRecipeId(schemaId), "");
    }
    if (!recipeId && datasetData && datasetData.taskRecipeId) {
      recipeId = _normId(datasetData.taskRecipeId, "");
    }
    if (!recipeId && datasetData && datasetData.metadata && datasetData.metadata.taskRecipeId) {
      recipeId = _normId(datasetData.metadata.taskRecipeId, "");
    }
    return taskRecipeRegistry.getRecipe(recipeId || "supervised_standard");
  }

  function getPredictiveMode(recipe, allowedOutputKeys) {
    var fam = String(recipe && recipe.family || "supervised").trim().toLowerCase();
    if (fam === "detection") return "detection";
    var keys = _asArray(allowedOutputKeys);
    var hasClassification = keys.some(function (k) { return String(k && k.headType || "").trim().toLowerCase() === "classification"; });
    var hasNonClassification = keys.some(function (k) { return String(k && k.headType || "").trim().toLowerCase() !== "classification"; });
    if (hasClassification && !hasNonClassification) return "classification";
    return "regression";
  }

  function getSuggestedMetricIds(recipe, fallbackIds) {
    var fallback = _asArray(fallbackIds).filter(Boolean);
    var fromRecipe = _asArray(recipe && recipe.metadata && recipe.metadata.suggestedMetrics)
      .map(function (id) { return _normId(id, ""); })
      .filter(Boolean);
    return fromRecipe.length ? fromRecipe : fallback;
  }

  function getFamily(recipe) {
    return String(recipe && recipe.family || "supervised").trim().toLowerCase();
  }

  function isDetectionRecipe(recipe) {
    return getFamily(recipe) === "detection";
  }

  return {
    resolveRecipe: resolveRecipe,
    getPredictiveMode: getPredictiveMode,
    getSuggestedMetricIds: getSuggestedMetricIds,
    getFamily: getFamily,
    isDetectionRecipe: isDetectionRecipe,
  };
});

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
    if (fam === "segmentation") return "segmentation";
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

  function isSegmentationRecipe(recipe) {
    return getFamily(recipe) === "segmentation";
  }

  function _cloneRows(rows) {
    return _asArray(rows).map(function (row) {
      return Array.isArray(row) ? row.slice() : row;
    });
  }

  function _oneHot(label, nClasses) {
    var n = Math.max(1, Math.floor(Number(nClasses) || 1));
    var idx = Math.max(0, Math.min(n - 1, Math.round(Number(label) || 0)));
    var row = new Array(n);
    for (var i = 0; i < n; i += 1) row[i] = 0;
    row[idx] = 1;
    return row;
  }

  function _headType(head) {
    return String(head && head.headType || head && head.targetType || "").trim().toLowerCase();
  }

  function _target(head) {
    return String(head && (head.target || head.targetType || head.key) || "").trim().toLowerCase();
  }

  function _hasHeadType(heads, type) {
    var want = String(type || "").trim().toLowerCase();
    return _asArray(heads).some(function (h) { return _headType(h) === want; });
  }

  function _hasRegressionLikeHead(heads) {
    return _asArray(heads).some(function (h) {
      var ht = _headType(h);
      var target = _target(h);
      return ht !== "classification" || target === "bbox" || target === "x" || target === "traj" || target === "params";
    });
  }

  function _resolveSplit(ds, split, sourceRegistry) {
    if (sourceRegistry && typeof sourceRegistry.resolveDatasetSplit === "function") {
      var resolved = sourceRegistry.resolveDatasetSplit(ds, split) || {};
      return {
        x: _cloneRows(resolved.x),
        y: _cloneRows(resolved.y),
        labels: _cloneRows(resolved.labels || resolved.label || []),
        length: Number(resolved.length || (Array.isArray(resolved.x) ? resolved.x.length : 0)) || 0,
      };
    }
    var rec = ds && ds.records && ds.records[split] ? ds.records[split] : {};
    return {
      x: _cloneRows(rec.x),
      y: _cloneRows(rec.y),
      labels: _cloneRows(rec.labels || rec.label || []),
      length: Array.isArray(rec.x) ? rec.x.length : 0,
    };
  }

  function _normalizeSourceDescriptor(ds, helper, schemaId, recipeId) {
    var raw = ds && ds.sourceDescriptor ? ds.sourceDescriptor : null;
    if (!raw) return null;
    if (helper && typeof helper.normalize === "function") {
      return helper.normalize(Object.assign({}, raw, {
        schemaId: raw.schemaId || schemaId || "",
        taskRecipeId: raw.taskRecipeId || raw.recipeId || recipeId || "",
      }));
    }
    return raw;
  }

  function _shouldUseSourceReference(desc, helper) {
    if (!desc) return false;
    if (helper && typeof helper.shouldUseServerReference === "function") {
      return !!helper.shouldUseServerReference(desc);
    }
    return true;
  }

  function _mapPrimaryTarget(splitData, mode, defaultTarget, defaultHeadType, isDetection, isSegmentation, nClasses) {
    var target = String(defaultTarget || "").trim().toLowerCase();
    var headType = String(defaultHeadType || "").trim().toLowerCase();
    if (isDetection || target === "bbox") return _cloneRows(splitData.y);
    if (isSegmentation || headType === "segmentation" || target === "mask" || target === "segmentation_mask") return _cloneRows(splitData.y);
    if (mode === "classification" || headType === "classification" || target === "label" || target === "logits") {
      return _cloneRows(splitData.y).map(function (label) {
        return typeof label === "number" ? _oneHot(label, nClasses) : (Array.isArray(label) ? label.slice() : label);
      });
    }
    if (headType === "reconstruction" || target === "x") return _cloneRows(splitData.x);
    return _cloneRows(splitData.y);
  }

  function _labelRows(splitData, nClasses) {
    var labels = splitData.labels && splitData.labels.length ? splitData.labels : splitData.y;
    return _cloneRows(labels).map(function (label) {
      return typeof label === "number" ? _oneHot(label, nClasses) : (Array.isArray(label) ? label.slice() : label);
    });
  }

  function prepareDatasetForTraining(schemaRegistry, taskRecipeRegistry, schemaId, datasetData, opts) {
    var options = opts || {};
    var ds = datasetData && typeof datasetData === "object" ? datasetData : {};
    var recipe = resolveRecipe(schemaRegistry, taskRecipeRegistry, schemaId, ds, options.taskRecipeId);
    var recipeId = String(recipe && recipe.id || options.taskRecipeId || ds.taskRecipeId || "supervised_standard");
    var heads = _asArray(options.inferredHeads || options.headConfigs);
    var allowedOutputKeys = _asArray(options.allowedOutputKeys);
    var mode = getPredictiveMode(recipe, heads.length ? heads : allowedOutputKeys);
    var detection = isDetectionRecipe(recipe);
    var segmentation = isSegmentationRecipe(recipe);
    var defaultTarget = String(options.defaultTarget || ds.targetMode || (detection ? "bbox" : (segmentation ? "mask" : "x"))).trim().toLowerCase();
    var defaultHeadType = String(options.defaultHeadType || (heads[0] && heads[0].headType) || "").trim().toLowerCase();
    var nClasses = Math.max(1, Number(ds.numClasses || ds.classCount || (ds.classNames && ds.classNames.length) || options.numClasses || 10));
    var sourceDescriptor = _normalizeSourceDescriptor(ds, options.sourceDescriptorHelper, schemaId, recipeId);
    var useSourceReference = _shouldUseSourceReference(sourceDescriptor, options.sourceDescriptorHelper);
    var hasClassificationHead = _hasHeadType(heads, "classification");
    var hasRegressionLikeHead = _hasRegressionLikeHead(heads);

    if (Array.isArray(ds.xTrain) || Array.isArray(ds.seqTrain)) {
      var direct = Object.assign({}, ds, {
        taskRecipeId: String(ds.taskRecipeId || recipeId),
        targetMode: String(ds.targetMode || defaultTarget),
        numClasses: nClasses,
        classCount: Math.max(1, Number(ds.classCount || nClasses)),
      });
      if (sourceDescriptor) direct.sourceDescriptor = sourceDescriptor;
      return { dataset: direct, recipe: recipe, mode: mode, sourceDescriptor: sourceDescriptor, useSourceReference: useSourceReference };
    }

    if (useSourceReference) {
      var sourceMeta = sourceDescriptor && sourceDescriptor.metadata || {};
      var featureSize = Number(ds.featureSize || sourceMeta.featureSize || options.featureSize || 0);
      var sourceBacked = Object.assign({}, ds, {
        xTrain: [], yTrain: [],
        xVal: [], yVal: [],
        xTest: [], yTest: [],
        labelsTrain: _cloneRows(ds.labelsTrain),
        labelsVal: _cloneRows(ds.labelsVal),
        labelsTest: _cloneRows(ds.labelsTest),
        featureSize: Math.max(0, featureSize),
        seqFeatureSize: Number(ds.seqFeatureSize || sourceMeta.seqFeatureSize || 0) || undefined,
        windowSize: Number(ds.windowSize || sourceMeta.windowSize || 0) || undefined,
        targetMode: defaultTarget,
        taskRecipeId: recipeId,
        numClasses: Math.max(1, Number(ds.numClasses || sourceMeta.numClasses || nClasses)),
        classCount: Math.max(1, Number(ds.classCount || sourceMeta.numClasses || nClasses)),
        classNames: _asArray(ds.classNames && ds.classNames.length ? ds.classNames : sourceMeta.classNames).slice(),
        sourceDescriptor: sourceDescriptor,
      });
      return { dataset: sourceBacked, recipe: recipe, mode: mode, sourceDescriptor: sourceDescriptor, useSourceReference: true };
    }

    var sourceRegistry = options.sourceRegistry || null;
    var train = _resolveSplit(ds, "train", sourceRegistry);
    var val = _resolveSplit(ds, "val", sourceRegistry);
    var test = _resolveSplit(ds, "test", sourceRegistry);
    var resolvedFeatureSize = Number(ds.featureSize || options.featureSize || 0);
    if (!resolvedFeatureSize && sourceRegistry && typeof sourceRegistry.getFeatureSize === "function") {
      resolvedFeatureSize = Number(sourceRegistry.getFeatureSize(ds) || 0);
    }
    if (!resolvedFeatureSize && train.x.length && Array.isArray(train.x[0])) resolvedFeatureSize = train.x[0].length;

    var prepared = Object.assign({}, ds, {
      xTrain: train.x,
      yTrain: _mapPrimaryTarget(train, mode, defaultTarget, defaultHeadType, detection, segmentation, nClasses),
      xVal: val.x,
      yVal: _mapPrimaryTarget(val, mode, defaultTarget, defaultHeadType, detection, segmentation, nClasses),
      xTest: test.x,
      yTest: _mapPrimaryTarget(test, mode, defaultTarget, defaultHeadType, detection, segmentation, nClasses),
      featureSize: resolvedFeatureSize || Number(ds.featureSize || 1),
      numClasses: nClasses,
      classCount: Math.max(1, Number(ds.classCount || nClasses)),
      targetMode: defaultTarget,
      taskRecipeId: recipeId,
    });
    if (sourceDescriptor) prepared.sourceDescriptor = sourceDescriptor;
    if (hasClassificationHead && (mode !== "classification" || hasRegressionLikeHead)) {
      prepared.labelsTrain = _labelRows(train, nClasses);
      prepared.labelsVal = _labelRows(val, nClasses);
      prepared.labelsTest = _labelRows(test, nClasses);
    }
    return { dataset: prepared, recipe: recipe, mode: mode, sourceDescriptor: sourceDescriptor, useSourceReference: false };
  }

  return {
    resolveRecipe: resolveRecipe,
    getPredictiveMode: getPredictiveMode,
    getSuggestedMetricIds: getSuggestedMetricIds,
    getFamily: getFamily,
    isDetectionRecipe: isDetectionRecipe,
    isSegmentationRecipe: isSegmentationRecipe,
    prepareDatasetForTraining: prepareDatasetForTraining,
  };
});

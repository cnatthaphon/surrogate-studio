(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      require("./schema_registry.js"),
      require("./model_graph_core.js")
    );
    return;
  }
  root.OSCModelGraphDrawflowAdapter = factory(
    root.OSCSchemaRegistry,
    root.OSCModelGraphCore
  );
})(typeof globalThis !== "undefined" ? globalThis : this, function (schemaRegistry, modelGraphCore) {
  "use strict";

  function ensureDeps() {
    if (!schemaRegistry || typeof schemaRegistry.resolveSchemaId !== "function") {
      throw new Error("OSCModelGraphDrawflowAdapter requires schema registry.");
    }
    if (!modelGraphCore || typeof modelGraphCore.createRuntime !== "function") {
      throw new Error("OSCModelGraphDrawflowAdapter requires model graph core.");
    }
  }

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function clamp(v, lo, hi) {
    var n = Number(v);
    if (!Number.isFinite(n)) n = Number(lo || 0);
    if (Number.isFinite(lo)) n = Math.max(Number(lo), n);
    if (Number.isFinite(hi)) n = Math.min(Number(hi), n);
    return n;
  }

  function getSchemaEntry(schemaId) {
    var sid = schemaRegistry.resolveSchemaId(schemaId, schemaRegistry.getDefaultSchemaId());
    return schemaRegistry.getSchema(sid) || {};
  }

  function getFeatureNodesMeta(schemaId) {
    var schema = getSchemaEntry(schemaId);
    var model = schema && schema.model && typeof schema.model === "object" ? schema.model : {};
    var meta = model.metadata && typeof model.metadata === "object" ? model.metadata : {};
    return meta.featureNodes && typeof meta.featureNodes === "object" ? meta.featureNodes : {};
  }

  function getSchemaPresetDefById(schemaId, presetId) {
    var sid = schemaRegistry.resolveSchemaId(schemaId, schemaRegistry.getDefaultSchemaId());
    var pid = String(presetId || "").trim();
    var defs = typeof schemaRegistry.getPresetDefs === "function" ? schemaRegistry.getPresetDefs(sid) : [];
    for (var i = 0; i < defs.length; i += 1) {
      var def = defs[i];
      if (String((def && def.id) || "").trim() === pid) return clone(def);
    }
    return null;
  }

  function getOutputDefs(schemaId) {
    var schema = getSchemaEntry(schemaId);
    var model = schema && schema.model && typeof schema.model === "object" ? schema.model : {};
    return Array.isArray(model.outputs) ? model.outputs.slice() : [];
  }

  function normalizeOutputTargetsList(raw, fallback, schemaId) {
    var valid = getOutputDefs(schemaId).map(function (x) { return String((x && x.key) || "").trim(); }).filter(Boolean);
    var fallbackList = Array.isArray(fallback) ? fallback.slice() : [fallback];
    var items = [];
    if (Array.isArray(raw)) items = raw.slice();
    else if (typeof raw === "string") items = raw.split(",");
    else if (raw != null) items = [raw];
    items = items.map(function (x) { return String(x || "").trim(); }).filter(Boolean);
    items = items.filter(function (x, idx) { return items.indexOf(x) === idx; });
    var filtered = items.filter(function (x) { return valid.indexOf(x) >= 0; });
    if (filtered.length) return filtered;
    var fallbackFiltered = fallbackList
      .map(function (x) { return String(x || "").trim(); })
      .filter(function (x) { return valid.indexOf(x) >= 0; });
    return fallbackFiltered.length ? fallbackFiltered : (valid.length ? [valid[0]] : ["x"]);
  }

  function outputTargetsSummaryText(targets, schemaId) {
    var defs = getOutputDefs(schemaId);
    var labelByKey = {};
    defs.forEach(function (def) {
      labelByKey[String((def && def.key) || "").trim()] = String((def && def.label) || (def && def.key) || "");
    });
    var list = Array.isArray(targets) ? targets : [targets];
    return list
      .map(function (key) {
        var kk = String(key || "").trim();
        return labelByKey[kk] || kk;
      })
      .filter(Boolean)
      .join(" + ");
  }

  function normalizeHistorySeriesKey(raw, schemaId) {
    var meta = getFeatureNodesMeta(schemaId);
    var defs = Array.isArray(meta.historySeries) ? meta.historySeries : [];
    var valid = defs.map(function (x) { return String((x && x.key) || "").trim(); }).filter(Boolean);
    var key = String(raw || "").trim();
    if (valid.indexOf(key) >= 0) return key;
    return valid.length ? valid[0] : "x";
  }

  function historySeriesLabel(raw, schemaId) {
    var key = normalizeHistorySeriesKey(raw, schemaId);
    var defs = getFeatureNodesMeta(schemaId).historySeries || [];
    for (var i = 0; i < defs.length; i += 1) {
      if (String((defs[i] && defs[i].key) || "").trim() === key) {
        return String((defs[i] && defs[i].label) || key);
      }
    }
    return key;
  }

  function getImageSourceSpec(raw, schemaId) {
    var defs = getFeatureNodesMeta(schemaId).imageSource || [];
    var requested = String(raw || "").trim();
    var pick = null;
    for (var i = 0; i < defs.length; i += 1) {
      if (String((defs[i] && defs[i].key) || "").trim() === requested) {
        pick = defs[i];
        break;
      }
    }
    if (!pick) pick = defs[0] || { key: "pixel_values", label: "pixel_values", featureSize: 1, shape: [1, 1, 1] };
    var shape = Array.isArray(pick.shape) ? pick.shape.slice() : [28, 28, 1];
    return {
      sourceKey: String(pick.key || "pixel_values"),
      label: String(pick.label || pick.key || "pixel_values"),
      featureSize: Math.max(1, Number(pick.featureSize || (shape[0] || 1) * (shape[1] || 1) * (shape[2] || 1))),
      shape: shape,
      width: Math.max(1, Number(shape[0] || 1)),
      height: Math.max(1, Number(shape[1] || 1)),
      channels: Math.max(1, Number(shape[2] || 1)),
    };
  }

  function defaultParamMask() {
    return { m: true, c: true, k: true, e: true, x0: true, v0: true, gm: true, gk: true, gc: true, rkm: false, rcm: false, rgl: false };
  }

  function normalizeParamMask(raw) {
    var base = defaultParamMask();
    var src = raw && typeof raw === "object" ? raw : {};
    Object.keys(base).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(src, key)) base[key] = Boolean(src[key]);
    });
    return base;
  }

  function countStaticParams(mask) {
    var mm = normalizeParamMask(mask);
    return Object.keys(mm).reduce(function (acc, key) {
      return acc + (mm[key] ? 1 : 0);
    }, 0);
  }

  function normalizeOneHotKey(raw, schemaId) {
    var defs = getFeatureNodesMeta(schemaId).oneHot || [];
    var valid = defs.map(function (x) { return String((x && x.key) || "").trim(); }).filter(Boolean);
    var key = String(raw || "").trim();
    if (valid.indexOf(key) >= 0) return key;
    return valid.length ? valid[0] : "scenario";
  }

  function oneHotLabel(raw, schemaId) {
    var key = normalizeOneHotKey(raw, schemaId);
    var defs = getFeatureNodesMeta(schemaId).oneHot || [];
    for (var i = 0; i < defs.length; i += 1) {
      if (String((defs[i] && defs[i].key) || "").trim() === key) {
        return String((defs[i] && defs[i].label) || key);
      }
    }
    return key;
  }

  function makeFakeEditor() {
    var nextId = 1;
    var data = {};

    function makePorts(count, portKind) {
      var out = {};
      var n = Math.max(0, Number(count || 0));
      for (var i = 1; i <= n; i += 1) {
        out[portKind + "_" + i] = { connections: [] };
      }
      return out;
    }

    return {
      clear: function () {
        nextId = 1;
        data = {};
      },
      addNode: function (name, inputs, outputs, x, y, className, nodeData, html) {
        var id = nextId++;
        data[String(id)] = {
          id: id,
          name: String(name || ""),
          data: clone(nodeData || {}),
          class: String(className || name || ""),
          html: String(html || ""),
          typenode: false,
          inputs: makePorts(inputs, "input"),
          outputs: makePorts(outputs, "output"),
          pos_x: Number(x) || 0,
          pos_y: Number(y) || 0,
        };
        return id;
      },
      addConnection: function (fromId, toId, outPort, inPort) {
        var fromNode = data[String(fromId)];
        var toNode = data[String(toId)];
        if (!fromNode || !toNode) throw new Error("Connection references missing node.");
        if (!fromNode.outputs[outPort]) fromNode.outputs[outPort] = { connections: [] };
        if (!toNode.inputs[inPort]) toNode.inputs[inPort] = { connections: [] };
        fromNode.outputs[outPort].connections.push({ node: String(toId), input: String(inPort) });
        toNode.inputs[inPort].connections.push({ node: String(fromId), output: String(outPort) });
      },
      exportGraph: function () {
        return {
          drawflow: {
            Home: {
              data: clone(data),
            },
          },
        };
      },
    };
  }

  function createRuntime(schemaId) {
    ensureDeps();
    var sid = schemaRegistry.resolveSchemaId(schemaId, schemaRegistry.getDefaultSchemaId());
    return modelGraphCore.createRuntime({
      clamp: clamp,
      resolveSchemaId: function (raw, fallback) {
        return schemaRegistry.resolveSchemaId(raw, fallback || sid);
      },
      getCurrentSchemaId: function () {
        return sid;
      },
      getSchemaPresetDefById: getSchemaPresetDefById,
      normalizeOutputTargetsList: normalizeOutputTargetsList,
      outputTargetsSummaryText: outputTargetsSummaryText,
      clearEditor: function (editor) {
        if (editor && typeof editor.clear === "function") editor.clear();
      },
      normalizeHistorySeriesKey: normalizeHistorySeriesKey,
      historySeriesLabel: historySeriesLabel,
      getImageSourceSpec: getImageSourceSpec,
      normalizeParamMask: normalizeParamMask,
      defaultParamMask: defaultParamMask,
      oneHotLabel: oneHotLabel,
      normalizeOneHotKey: normalizeOneHotKey,
      countStaticParams: countStaticParams,
      estimateNodeFeatureWidth: function () {
        return 0;
      },
    });
  }

  function createDrawflowGraphFromGraphSpec(schemaId, graphSpec) {
    var sid = schemaRegistry.resolveSchemaId(schemaId, schemaRegistry.getDefaultSchemaId());
    var runtime = createRuntime(sid);
    var editor = makeFakeEditor();
    runtime.renderPresetGraphSpec(editor, graphSpec, sid);
    return editor.exportGraph();
  }

  function createDrawflowGraphFromPreset(schemaId, presetId) {
    var sid = schemaRegistry.resolveSchemaId(schemaId, schemaRegistry.getDefaultSchemaId());
    var runtime = createRuntime(sid);
    var editor = makeFakeEditor();
    runtime.seedPreconfigGraph(editor, presetId, sid);
    return editor.exportGraph();
  }

  return {
    createRuntime: createRuntime,
    createDrawflowGraphFromGraphSpec: createDrawflowGraphFromGraphSpec,
    createDrawflowGraphFromPreset: createDrawflowGraphFromPreset,
  };
});

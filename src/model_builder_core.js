(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCModelBuilderCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // --- graph helpers (pure, no DOM) ---

  function getNodeByName(nodes, name) {
    var values = Object.values(nodes || {});
    for (var i = 0; i < values.length; i++) {
      if (values[i] && values[i].name === name) return values[i];
    }
    return null;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function extractGraphData(drawflowExport) {
    if (!drawflowExport) return {};
    var d = drawflowExport;
    if (d.drawflow && d.drawflow.Home && d.drawflow.Home.data) return d.drawflow.Home.data;
    if (d.Home && d.Home.data) return d.Home.data;
    return d;
  }

  function getUpstreamFeatureNodeNamesFromData(graphData) {
    var names = {};
    var inputNode = getNodeByName(graphData, "input_layer") || getNodeByName(graphData, "image_source_block") || getNodeByName(graphData, "image_source_layer");
    if (!inputNode) return names;
    var startIds = [];
    Object.keys(inputNode.inputs || {}).forEach(function (k) {
      var conns = (inputNode.inputs[k] && inputNode.inputs[k].connections) || [];
      conns.forEach(function (c) { startIds.push(String(c.node)); });
    });
    if (!startIds.length) return names;
    var seen = {};
    var walk = function (id) {
      if (seen[id]) return;
      seen[id] = true;
      var node = graphData[id];
      if (!node) return;
      names[node.name] = true;
      Object.keys(node.inputs || {}).forEach(function (k) {
        var conns = (node.inputs[k] && node.inputs[k].connections) || [];
        conns.forEach(function (c) { walk(String(c.node)); });
      });
    };
    startIds.forEach(walk);
    return names;
  }

  function getUpstreamFeatureNodesFromData(graphData) {
    var nodesByName = {};
    var inputNode = getNodeByName(graphData, "input_layer") || getNodeByName(graphData, "image_source_block") || getNodeByName(graphData, "image_source_layer");
    if (!inputNode) return nodesByName;
    var startIds = [];
    Object.keys(inputNode.inputs || {}).forEach(function (k) {
      var conns = (inputNode.inputs[k] && inputNode.inputs[k].connections) || [];
      conns.forEach(function (c) { startIds.push(String(c.node)); });
    });
    var seen = {};
    var all = [];
    var walk = function (id) {
      if (seen[id]) return;
      seen[id] = true;
      var node = graphData[id];
      if (!node) return;
      if (!nodesByName[node.name]) nodesByName[node.name] = node;
      all.push(node);
      Object.keys(node.inputs || {}).forEach(function (k) {
        var conns = (node.inputs[k] && node.inputs[k].connections) || [];
        conns.forEach(function (c) { walk(String(c.node)); });
      });
    };
    startIds.forEach(walk);
    nodesByName.__all = all;
    return nodesByName;
  }

  function normalizeHistorySeriesKey(raw) {
    return String(raw || "").trim().toLowerCase();
  }

  function nodeUsesHistoryField(node, fieldKey) {
    if (!node) return false;
    var d = node.data || {};
    // read featureKey from node config — no hardcoded block name matching
    var nodeKey = normalizeHistorySeriesKey(d.featureKey || d.sourceKey || "");
    return nodeKey === String(fieldKey || "");
  }

  // --- output target helpers ---

  /**
   * Get the single target for an output node.
   * One output node = one target. If you want multiple targets, use multiple output nodes.
   */
  // helper: extract key string from output key (string or {key, headType} object)
  function _okKey(ok) { return typeof ok === "object" && ok !== null ? String(ok.key || "") : String(ok || ""); }

  function normalizeOutputTargetsList(raw, fallbackTargets, allowedKeys) {
    // extract single target from raw value
    var target = "";
    if (typeof raw === "string") target = raw.trim().toLowerCase();
    else if (Array.isArray(raw) && raw.length) target = String(raw[0] || "").trim().toLowerCase();
    else if (raw != null) target = String(raw || "").trim().toLowerCase();

    // if comma-separated (legacy), take the first
    if (target.indexOf(",") >= 0) target = target.split(",")[0].trim();

    if (!target) {
      // fallback from schema allowedKeys first, then provided fallbackTargets
      var allowed = Array.isArray(allowedKeys) ? allowedKeys : [];
      if (allowed.length) {
        target = _okKey(allowed[0]);
      } else if (Array.isArray(fallbackTargets) && fallbackTargets.length) {
        target = _okKey(fallbackTargets[0]);
      } else if (typeof fallbackTargets === "string" && fallbackTargets) {
        target = fallbackTargets.trim().toLowerCase();
      }
    }
    return target ? [target] : [];
  }

  function _lookupOutputSpec(target, allowedOutputKeys) {
    var key = String(target || "").trim().toLowerCase();
    if (!key || !Array.isArray(allowedOutputKeys)) return null;
    for (var i = 0; i < allowedOutputKeys.length; i++) {
      var ok = allowedOutputKeys[i];
      if (typeof ok === "object" && ok !== null && String(ok.key || "").trim().toLowerCase() === key) return ok;
      if (typeof ok === "string" && String(ok).trim().toLowerCase() === key) return { key: key, headType: "regression" };
    }
    return null;
  }

  // helper: look up headType for a target key from allowedOutputKeys
  function _lookupHeadType(target, allowedOutputKeys) {
    var spec = _lookupOutputSpec(target, allowedOutputKeys);
    return spec ? String(spec.headType || "regression") : "regression";
  }

  function outputTargetsFromNodeData(data, allowedKeys, fallbackTarget) {
    var d = data || {};
    // read single target from node — no multi-target, no CSV
    var raw = d.target || d.targetType || fallbackTarget || "";
    return normalizeOutputTargetsList(raw, fallbackTarget ? [String(fallbackTarget)] : [], allowedKeys);
  }

  function _applyLayerMetadata(layer, node) {
    if (!layer || !node || !node.data) return layer;
    if (node.data.weightTag) layer._weightTag = String(node.data.weightTag);
    if (node.data.blockName) layer._blockName = String(node.data.blockName);
    return layer;
  }

  function _normalizeInitializerName(raw, fallback) {
    var fb = String(fallback == null ? "default" : fallback).trim().toLowerCase() || "default";
    var v = String(raw == null ? "" : raw).trim().toLowerCase().replace(/[\s_\-]/g, "");
    var aliases = {
      "": fb,
      "default": "default",
      "auto": "default",
      "inherit": "default",
      "xavieruniform": "glorotuniform",
      "xaviernormal": "glorotnormal",
      "kaiminguniform": "heuniform",
      "kaimingnormal": "henormal",
      "normal": "randomnormal",
      "uniform": "randomuniform"
    };
    return aliases[v] || v || fb;
  }

  function _numOr(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : Number(fallback);
  }

  function _resolveUseBias(nodeData, fallback) {
    var d = nodeData || {};
    var fb = fallback !== false;
    if (!Object.prototype.hasOwnProperty.call(d, "useBias")) return fb;
    if (d.useBias === false) return false;
    var raw = String(d.useBias == null ? "" : d.useBias).trim().toLowerCase();
    if (!raw) return fb;
    if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
    if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
    return fb;
  }

  function _buildInitializer(tf, nodeData, prefix, fallbackName) {
    var d = nodeData || {};
    var initName = _normalizeInitializerName(d[prefix + "Initializer"], fallbackName);
    var mean = _numOr(d[prefix + "InitMean"], prefix === "gamma" ? 1 : 0);
    var stddev = Math.max(1e-8, _numOr(d[prefix + "InitStddev"], 0.05));
    var minval = _numOr(d[prefix + "InitMin"], -0.05);
    var maxval = _numOr(d[prefix + "InitMax"], 0.05);
    var value = _numOr(d[prefix + "InitValue"], prefix === "movingVariance" ? 1 : 0);
    if (initName === "default") return null;
    if (initName === "zeros") return tf.initializers.zeros();
    if (initName === "ones") return tf.initializers.ones();
    if (initName === "constant") return tf.initializers.constant({ value: value });
    if (initName === "randomnormal") return tf.initializers.randomNormal({ mean: mean, stddev: stddev });
    if (initName === "randomuniform") return tf.initializers.randomUniform({ minval: minval, maxval: maxval });
    if (initName === "glorotuniform") return tf.initializers.glorotUniform({});
    if (initName === "glorotnormal") return tf.initializers.glorotNormal({});
    if (initName === "heuniform") return tf.initializers.heUniform({});
    if (initName === "henormal") return tf.initializers.heNormal({});
    if (initName === "lecununiform") return tf.initializers.varianceScaling({ scale: 1, mode: "fanIn", distribution: "uniform" });
    if (initName === "lecunnormal") return tf.initializers.varianceScaling({ scale: 1, mode: "fanIn", distribution: "truncatedNormal" });
    return null;
  }

  function _assignInitializer(layerCfg, layerKey, tf, nodeData, prefix, fallbackName) {
    var init = _buildInitializer(tf, nodeData, prefix, fallbackName);
    if (init) layerCfg[layerKey] = init;
  }

  // --- graph inference (pure, no DOM, no state) ---

  function inferGraphMode(graphData, fallbackMode) {
    var data = extractGraphData(graphData);
    var names = getUpstreamFeatureNodeNamesFromData(data);
    // detect autoregressive by presence of any history/window feature nodes upstream of input
    var nameKeys = Object.keys(names);
    var hasHistory = nameKeys.some(function (n) {
      return n.indexOf("hist") >= 0 || n.indexOf("window") >= 0 || n.indexOf("sliding") >= 0;
    });
    return hasHistory ? "autoregressive" : String(fallbackMode || "direct");
  }

  function extractGenerationNodes(graphData) {
    var data = extractGraphData(graphData);
    var ids = Object.keys(data || {});
    var sampleNodes = [];
    var outputNodes = [];
    ids.forEach(function (id) {
      var nd = data[id];
      if (!nd) return;
      var name = String(nd.name || "");
      var d = nd.data || {};
      if (name === "sample_z_layer") {
        sampleNodes.push({ id: id, dim: Number(d.dim || 128), distribution: String(d.distribution || "normal"), blockName: String(d.blockName || "") });
      }
      if (name === "output_layer") {
        outputNodes.push({ id: id, loss: String(d.loss || "mse"), phase: String(d.phase || ""), headType: String(d.headType || ""), target: String(d.target || ""), blockName: String(d.blockName || ""), matchWeight: Number(d.matchWeight != null ? d.matchWeight : 1) });
      }
    });
    return { sampleNodes: sampleNodes, outputNodes: outputNodes };
  }

  function extractGenerationCapabilities(graphData) {
    var data = extractGraphData(graphData);
    var ids = Object.keys(data || {});
    var names = ids.map(function (id) { return String((data[id] && data[id].name) || ""); });
    var genNodes = extractGenerationNodes(graphData);
    var hasNoiseSchedule = names.some(function (n) { return n.indexOf("noise_schedule") >= 0 || n.indexOf("noise_injection") >= 0; });
    var hasReparam = names.some(function (n) { return n.indexOf("reparam") >= 0; });
    var hasLatentStats = names.some(function (n) { return n.indexOf("latent_mu") >= 0 || n.indexOf("latent_logvar") >= 0 || n === "latent_layer"; });
    var hasSampleNodes = genNodes.sampleNodes.length > 0;
    var hasPassthroughOutput = genNodes.outputNodes.some(function (o) { return String(o.loss || "").toLowerCase() === "none"; });
    var hasStructuredOutput = genNodes.outputNodes.some(function (o) {
      var target = String(o.target || "").toLowerCase();
      return target && target !== "none";
    });
    var canRandomSample = hasSampleNodes || hasReparam || hasLatentStats;
    var canReconstruct = !hasSampleNodes || hasReparam || hasLatentStats || hasNoiseSchedule;
    var canOptimize = hasReparam || hasLatentStats;
    var canClassifierGuide = hasReparam || hasLatentStats;
    var canLangevin = hasNoiseSchedule;
    var canDDPM = hasNoiseSchedule;
    var canInverse = !hasSampleNodes && hasStructuredOutput;
    var defaultMethod = canReconstruct ? "reconstruct" : (canRandomSample ? "random" : (canInverse ? "inverse" : "reconstruct"));
    if (hasSampleNodes && hasPassthroughOutput && !hasReparam && !hasLatentStats && !hasNoiseSchedule) defaultMethod = "random";
    return {
      family: inferModelFamily(graphData),
      sampleNodes: genNodes.sampleNodes,
      outputNodes: genNodes.outputNodes,
      hasSampleNodes: hasSampleNodes,
      hasPassthroughOutput: hasPassthroughOutput,
      hasStructuredOutput: hasStructuredOutput,
      hasNoiseSchedule: hasNoiseSchedule,
      hasLatentDecoder: hasReparam || hasLatentStats,
      canReconstruct: canReconstruct,
      canRandomSample: canRandomSample,
      canClassifierGuide: canClassifierGuide,
      canLangevin: canLangevin,
      canOptimize: canOptimize,
      canInverse: canInverse,
      canDDPM: canDDPM,
      defaultMethod: defaultMethod,
    };
  }

  function inferModelFamily(graphData) {
    var data = extractGraphData(graphData);
    var ids = Object.keys(data || {});
    var names = ids.map(function (id) { return String((data[id] && data[id].name) || ""); });
    // detect by node name patterns, not exact names
    var hasNoise = names.some(function (n) { return n.indexOf("noise_injection") >= 0 || n.indexOf("noise_schedule") >= 0; });
    var hasReparam = names.some(function (n) { return n.indexOf("reparam") >= 0; });
    var hasLatent = names.some(function (n) { return n.indexOf("latent_mu") >= 0 || n.indexOf("latent_logvar") >= 0; });
    var hasSampleZ = names.some(function (n) { return n.indexOf("sample_z") >= 0; });
    if (hasNoise) return "diffusion";
    if (hasReparam || hasLatent) return "vae";
    if (hasSampleZ) return "gan";
    return "supervised";
  }

  function inferWindow(graphData, fallbackWindow) {
    var wFallback = Math.max(5, Number(fallbackWindow) || 20);
    var data = extractGraphData(graphData);
    var nodes = getUpstreamFeatureNodesFromData(data);
    // find any window/sliding node by name pattern (not hardcoded block names)
    var allNodes = nodes.__all || [];
    var winNode = allNodes.find(function (n) { var nm = n.name || ""; return nm.indexOf("window") >= 0 || nm.indexOf("sliding") >= 0; });
    if (winNode) return Math.max(5, Number((winNode.data && winNode.data.windowSize) || wFallback));
    var histNode = allNodes.find(function (n) { var nm = n.name || ""; return nm.indexOf("hist") >= 0; });
    if (histNode) return 1;
    return wFallback;
  }

  function inferArHistoryConfig(graphData, fallbackWindow) {
    var fallback = {
      windowSize: Math.max(5, Number(fallbackWindow) || 20),
      stride: 1, lagMode: "contiguous", lags: null, padMode: "none"
    };
    var data = extractGraphData(graphData);
    var nodes = getUpstreamFeatureNodesFromData(data);
    // find window/sliding node by name pattern
    var allNodes = nodes.__all || [];
    var n = allNodes.find(function (nd) { var nm = nd.name || ""; return nm.indexOf("window") >= 0 || nm.indexOf("sliding") >= 0; });
    if (n) {
      var d = n.data || {};
      var windowSize = Math.max(5, Number(d.windowSize || fallback.windowSize));
      var stride = Math.max(1, Number(d.stride || 1));
      var lagMode = String(d.lagMode || "contiguous");
      var padMode = (String(d.padMode || "none") === "zero" || String(d.padMode || "none") === "edge")
        ? String(d.padMode || "none") : "none";
      if (lagMode !== "exact") {
        return { windowSize: windowSize, stride: stride, lagMode: "contiguous", lags: null, padMode: padMode };
      }
      var lags = String(d.lagCsv || "").split(",")
        .map(function (s) { return Number(s.trim()); })
        .filter(function (v) { return Number.isFinite(v) && v >= 1; })
        .map(function (v) { return Math.floor(v); });
      var uniq = [];
      lags.forEach(function (v) { if (uniq.indexOf(v) < 0) uniq.push(v); });
      uniq.sort(function (a, b) { return a - b; });
      if (!uniq.length) return { windowSize: windowSize, stride: stride, lagMode: "contiguous", lags: null, padMode: padMode };
      return { windowSize: uniq.length, stride: stride, lagMode: "exact", lags: uniq, padMode: padMode };
    }
    // hist-only node (no window): single-step
    var histNode = allNodes.find(function (nd) { var nm = nd.name || ""; return nm.indexOf("hist") >= 0; });
    if (histNode) {
      return { windowSize: 1, stride: 1, lagMode: "contiguous", lags: null, padMode: "none" };
    }
    return fallback;
  }

  function inferOutputHeads(graphData, allowedOutputKeys, fallbackTarget) {
    var data = extractGraphData(graphData);
    // fallback from caller (which gets it from schema), never hardcoded
    var fallback = typeof fallbackTarget === "object" ? _okKey(fallbackTarget) : String(fallbackTarget || "");
    if (!fallback && Array.isArray(allowedOutputKeys) && allowedOutputKeys.length) fallback = _okKey(allowedOutputKeys[0]);
    var ids = Object.keys(data || {});
    var inputNodeNames = { "input_layer": true, "image_source_block": true, "image_source_layer": true, "sample_z_layer": true, "time_embed_layer": true, "class_embed_layer": true };
    // Feature blocks are visual/declarative — they don't create model inputs
    var featureBlockNames = { "window_hist_block": true, "window_hist_x_block": true, "window_hist_v_block": true, "hist_block": true, "params_block": true, "params_layer": true, "sliding_window_block": true, "time_sec_layer": true, "time_norm_layer": true, "sin_norm_layer": true, "cos_norm_layer": true, "onehot_layer": true };
    var inputIds = ids.filter(function (id) { return data[id] && inputNodeNames[data[id].name]; });
    if (!inputIds.length) return [{ id: "fallback", target: fallback, loss: "mse", headType: _lookupHeadType(fallback, allowedOutputKeys) }];
    var reachable = {};
    var q = inputIds.map(String);
    q.forEach(function (id) { reachable[id] = true; });
    while (q.length) {
      var id = q.shift();
      var n = data[id];
      if (!n || !n.outputs) continue;
      Object.keys(n.outputs).forEach(function (ok) {
        var conns = (n.outputs[ok] && n.outputs[ok].connections) || [];
        conns.forEach(function (c) {
          var to = String(c.node);
          if (!reachable[to]) { reachable[to] = true; q.push(to); }
        });
      });
    }
    var outputNodes = Object.keys(data || {})
      .map(function (id) { return { id: String(id), node: data[id] }; })
      .filter(function (x) { return reachable[x.id] && x.node && x.node.name === "output_layer"; })
      .sort(function (a, b) { return Number(a.id) - Number(b.id); });
    if (!outputNodes.length) return fallback ? [{ id: "fallback", target: fallback, loss: "mse", headType: _lookupHeadType(fallback, allowedOutputKeys) }] : [];
    var heads = [];
    outputNodes.forEach(function (x) {
      var d = x.node.data || {};
      var targets = outputTargetsFromNodeData(d, allowedOutputKeys, fallback);
      var normalizedLoss = String(d.loss || "mse");
      if (normalizedLoss === "use_global") normalizedLoss = "mse";
      targets.forEach(function (target, ti) {
        // headType: read from node config first, then look up in schema outputKeys
        var ht = String(d.headType || "").trim().toLowerCase();
        if (!ht || ht === "auto") ht = _lookupHeadType(target, allowedOutputKeys);
        heads.push({
          id: x.id + ":" + String(target) + ":" + String(ti + 1),
          nodeId: x.id, target: target, targetType: target,
          loss: normalizedLoss, headType: ht,
          matchWeight: Math.max(0, Number(d.matchWeight || 1)),
          phase: String(d.phase || ""),
        });
      });
    });
    return heads.length ? heads : (fallback ? [{ id: "fallback", target: fallback, loss: "mse", headType: _lookupHeadType(fallback, allowedOutputKeys) }] : []);
  }

  function inferDatasetTargetMode(heads, fallback) {
    // returns the first head's target — no hardcoded target name assumptions
    var list = Array.isArray(heads) ? heads : [];
    if (list.length && list[0].target) return list[0].target;
    return String(fallback || "");
  }

  function inferFeatureSpec(graphData, mode, featurePolicy) {
    var data = extractGraphData(graphData);
    var policy = featurePolicy || {};
    var names = getUpstreamFeatureNodeNamesFromData(data);
    var nodes = getUpstreamFeatureNodesFromData(data);
    var allNodes = Array.isArray(nodes.__all) ? nodes.__all : [];
    var genericUseX = allNodes.some(function (n) {
      var nm = String((n && n.name) || "");
      if (nm !== "hist_block" && nm !== "window_hist_block") return false;
      return nodeUsesHistoryField(n, "x");
    });
    var genericUseV = allNodes.some(function (n) {
      var nm = String((n && n.name) || "");
      if (nm !== "hist_block" && nm !== "window_hist_block") return false;
      return nodeUsesHistoryField(n, "v");
    });
    var allowHistory = policy.allowHistory !== false;
    var allowParams = policy.allowParams !== false;
    var allowOneHot = policy.allowOneHot !== false;
    var allowImageSource = Boolean(policy.allowImageSource);
    var spec = {
      useX: allowHistory ? Boolean(genericUseX || names.hist_x_block || names.x_block || names.window_hist_x_block) : false,
      useV: allowHistory ? Boolean(genericUseV || names.hist_v_block || names.v_block || names.window_hist_v_block) : false,
      useParams: allowParams ? Boolean(names.params_block) : false,
      useTimeSec: Boolean(names.time_sec_block),
      useTimeNorm: Boolean(names.time_norm_block || names.time_block),
      useScenario: allowOneHot ? Boolean(names.scenario_block) : false,
      useSinNorm: Boolean(names.sin_norm_block || names.trig_block),
      useCosNorm: Boolean(names.cos_norm_block || names.trig_block),
      useNoiseSchedule: Boolean(names.noise_schedule_block),
      useImageSource: allowImageSource ? Boolean(names.image_source_block) : false,
    };
    if (mode === "direct") {
      if (allowImageSource) {
        if (!spec.useImageSource) spec.useImageSource = true;
        spec.useParams = false; spec.useTimeSec = false; spec.useTimeNorm = false;
        spec.useSinNorm = false; spec.useCosNorm = false; spec.useNoiseSchedule = false;
      }
      if (!spec.useImageSource && !spec.useParams && !spec.useTimeSec && !spec.useTimeNorm &&
          !spec.useScenario && !spec.useSinNorm && !spec.useCosNorm && !spec.useNoiseSchedule) {
        spec.useParams = true; spec.useTimeNorm = true;
      }
    } else {
      if (!spec.useX && !spec.useV && !spec.useParams) {
        spec.useX = true; spec.useParams = true;
      }
    }
    return spec;
  }

  // --- model building (requires tf) ---

  function buildModelFromGraph(tf, graphData, datasetMeta) {
    var moduleData = extractGraphData(graphData);
    var ids = Object.keys(moduleData || {});
    if (!ids.length) throw new Error("Graph is empty.");

    var inputNodeNames = { "input_layer": true, "image_source_block": true, "image_source_layer": true, "sample_z_layer": true, "time_embed_layer": true, "class_embed_layer": true };
    // Feature blocks are visual/declarative — they don't create model inputs
    var featureBlockNames = { "window_hist_block": true, "window_hist_x_block": true, "window_hist_v_block": true, "hist_block": true, "params_block": true, "params_layer": true, "sliding_window_block": true, "time_sec_layer": true, "time_norm_layer": true, "sin_norm_layer": true, "cos_norm_layer": true, "onehot_layer": true };
    // only nodes with NO incoming connections are true external inputs
    // (e.g., Input node connected FROM ImageSource is NOT an external input)
    var inputIds = ids.filter(function (id) {
      if (!moduleData[id] || !inputNodeNames[moduleData[id].name]) return false;
      var ins = moduleData[id].inputs || {};
      // Ignore incoming connections from feature blocks (visual/declarative only)
      var hasRealIncoming = Object.keys(ins).some(function (k) {
        var conns = (ins[k] && ins[k].connections) || [];
        return conns.some(function (c) {
          var fromNode = moduleData[String(c.node)];
          return fromNode && !featureBlockNames[fromNode.name];
        });
      });
      return !hasRealIncoming;
    });
    if (!inputIds.length) throw new Error("Graph must contain at least one Input/ImageSource/SampleZ node.");
    var inputId = String(inputIds[0]); // primary input
    var allInputIds = inputIds.map(String);

    var allowedOutputKeys = Array.isArray(datasetMeta.allowedOutputKeys) ? datasetMeta.allowedOutputKeys : [];
    var fallbackTarget = datasetMeta.defaultTarget || (allowedOutputKeys.length ? _okKey(allowedOutputKeys[0]) : "");

    var parsePortIndex = function (name) {
      var m = String(name || "").match(/_(\d+)$/);
      return m ? Number(m[1]) : 9999;
    };
    var getOutgoing = function (id) {
      var n = moduleData[id];
      if (!n || !n.outputs) return [];
      var out = [];
      Object.keys(n.outputs).forEach(function (ok) {
        var conns = (n.outputs[ok] && n.outputs[ok].connections) || [];
        conns.forEach(function (c) { out.push({ from: String(id), to: String(c.node), fromPort: String(ok), toPort: String(c.input || "") }); });
      });
      return out;
    };
    var getIncoming = function (id) {
      var n = moduleData[id];
      if (!n || !n.inputs) return [];
      var ins = [];
      Object.keys(n.inputs).forEach(function (ik) {
        var conns = (n.inputs[ik] && n.inputs[ik].connections) || [];
        conns.forEach(function (c) { ins.push({ from: String(c.node), to: String(id), fromPort: String(c.output || ""), toPort: String(ik) }); });
      });
      ins.sort(function (a, b) { return parsePortIndex(a.toPort) - parsePortIndex(b.toPort); });
      return ins;
    };

    // reachability from input + root nodes (Constant, PhaseSwitch have no parents)
    var reachable = {};
    var q = allInputIds.slice();
    allInputIds.forEach(function (iid) { reachable[iid] = true; });
    // add rootless nodes (no incoming connections, not input nodes)
    ids.forEach(function (id) {
      var n = moduleData[id];
      if (!n || reachable[id]) return;
      var nm = n.name || "";
      if (nm === "constant_layer" || nm === "phase_switch_layer") {
        var ins = n.inputs || {};
        var hasParentFromInput = Object.keys(ins).some(function (k) { return (ins[k].connections || []).length > 0; });
        // constant has no parents, phase_switch has parents from constants
        reachable[id] = true;
        q.push(id);
      }
    });
    while (q.length) {
      var cid = q.shift();
      getOutgoing(cid).forEach(function (e) {
        if (!reachable[e.to]) { reachable[e.to] = true; q.push(e.to); }
      });
    }
    var reachableIds = Object.keys(reachable);
    var outputIds = reachableIds.filter(function (id) { return moduleData[id] && moduleData[id].name === "output_layer"; });
    if (!outputIds.length) throw new Error("Graph must have at least one Output node connected from Input.");

    // determine sequence mode
    var hasRecurrent = reachableIds.some(function (id) {
      var name = moduleData[id] && moduleData[id].name;
      return name === "rnn_layer" || name === "gru_layer" || name === "lstm_layer" || name === "conv1d_layer";
    });
    var inputNode = moduleData[inputId];
    var inputMode = String((inputNode.data && inputNode.data.mode) || "auto");
    var isSequence = inputMode === "sequence" ? true : (inputMode === "flat" ? false : hasRecurrent);
    // Allow LSTM in direct mode by reshaping flat input to [batch, 1, features] (seq_len=1)
    // Skip if Embedding is a direct child of the primary input — embedding creates the sequence dim
    var inputDirectChildIsEmbedding = getOutgoing(inputId).some(function (e) {
      return reachable[e.to] && moduleData[e.to] && moduleData[e.to].name === "embedding_layer";
    });
    var needsReshapeForRecurrent = !isSequence && hasRecurrent && inputMode !== "sequence" && !inputDirectChildIsEmbedding;

    // topological sort
    var indegree = {};
    reachableIds.forEach(function (id) { indegree[id] = 0; });
    reachableIds.forEach(function (id) {
      getOutgoing(id).forEach(function (e) { if (reachable[e.to]) indegree[e.to] += 1; });
    });
    var topo = [];
    var tq = reachableIds.filter(function (id) { return indegree[id] === 0; }).sort(function (a, b) { return Number(a) - Number(b); });
    while (tq.length) {
      var tid = tq.shift();
      topo.push(tid);
      getOutgoing(tid).forEach(function (e) {
        if (!reachable[e.to]) return;
        indegree[e.to] -= 1;
        if (indegree[e.to] === 0) tq.push(e.to);
      });
      tq.sort(function (a, b) { return Number(a) - Number(b); });
    }
    if (topo.length !== reachableIds.length) throw new Error("Graph contains cycle(s).");

    // build TF.js model — create input tensors for ALL input nodes
    var allInputTensors = []; // { id, tensor, name }
    var tensorById = {};

    allInputIds.forEach(function (iid) {
      var inode = moduleData[iid];
      var iname = inode ? inode.name : "";
      var itensor;
      if (iname === "sample_z_layer") {
        var zDim = Math.max(1, Number((inode.data && inode.data.dim) || 128));
        itensor = tf.input({ shape: [zDim], name: "z_input_" + iid });
      } else if (iname === "time_embed_layer") {
        var tDim = Math.max(1, Number((inode.data && inode.data.dim) || 64));
        itensor = tf.input({ shape: [tDim], name: "time_input_" + iid });
      } else if (iname === "class_embed_layer") {
        var nClasses = Math.max(2, Number((inode.data && inode.data.numClasses) || 10));
        itensor = tf.input({ shape: [nClasses], name: "class_input_" + iid });
      } else if (iname === "constant_layer") {
        // Constant needs a dummy input to derive batch size — use featureSize=1
        itensor = tf.input({ shape: [1], name: "const_input_" + iid });
      } else if (isSequence && iid === inputId) {
        itensor = tf.input({ shape: [datasetMeta.windowSize, datasetMeta.seqFeatureSize], name: "seq_input" });
      } else {
        var fs = Number((inode && inode.data && inode.data.featureSize) || datasetMeta.featureSize || 1);
        itensor = tf.input({ shape: [fs], name: "input_" + iid });
      }
      allInputTensors.push({ id: iid, tensor: itensor, name: iname });
      // for recurrent: reshape flat input
      if (needsReshapeForRecurrent && iid === inputId) {
        tensorById[iid] = tf.layers.reshape({ targetShape: [1, datasetMeta.featureSize] }).apply(itensor);
      } else {
        tensorById[iid] = itensor;
      }
    });

    var inputTensor = allInputTensors[0].tensor; // primary input for backward compat
    var outTensors = [];
    var headConfigs = [];
    var latentGroups = {};
    var vaeKLGroups = {};
    var _headLabelTensors = {};
    var _phaseFlagInput = null;
    var _phaseSwitchConfigs = [];

    // VAE reparameterization — proper Kingma-Welling sampling:
    //   z = mu + exp(0.5 * logvar) * epsilon  where epsilon ~ N(0, 1)
    //
    // Previous version used `z = mu + Linear_init=0(logvar)` which compiles in
    // every TF.js version but is NOT reparameterization — there's no random
    // sampling, the "noise projection" is a learnable dense layer initialized
    // to zero. Without true stochasticity at training time the decoder only
    // ever sees encoder-mu values, so generating from a random N(0,1) latent
    // (VAE Random Sampling) outputs noise. This was the root cause of
    // demoting VAE Random Sampling and Classifier-Guided.
    //
    // Implementation: a custom Layer subclass with random sampling in call().
    // Registered with tf.serialization.registerClass() so saved models can
    // round-trip through tf.loadLayersModel without "Unknown layer" errors.
    var _reparamCount = 0;
    var ReparameterizeLayer = (function () {
      if (!tf || typeof tf.layers !== "object" || typeof tf.layers.Layer !== "function") {
        // tf.layers.Layer not available — return a fallback that throws a
        // clear error if anyone tries to use it. The previous Linear-init=0
        // workaround is intentionally NOT preserved here because it produces
        // a silently-wrong VAE, which is worse than failing loud.
        function RLStub() {}
        RLStub.apply = function () {
          throw new Error("Reparameterize layer requires tf.layers.Layer (TF.js >= 4.x)");
        };
        return RLStub;
      }
      class RL extends tf.layers.Layer {
        constructor(config) {
          super(config || {});
        }
        computeOutputShape(inputShape) {
          // mu and logvar have the same shape; output matches that shape.
          return Array.isArray(inputShape) && Array.isArray(inputShape[0]) ? inputShape[0] : inputShape;
        }
        call(inputs, kwargs) {
          // Training: z = mu + exp(0.5*logvar) * eps (stochastic — needed for VAE).
          // Inference: z = mu (deterministic — keeps Reconstruct outputs clean
          // rather than injecting noise into every demo render). Random Sampling
          // bypasses this layer entirely (extractDecoder feeds fresh random z
          // into the decoder), so this only affects the encode→reparam→decode
          // path in Reconstruct mode.
          var isTraining = kwargs && kwargs.training === true;
          return tf.tidy(function () {
            var arr = Array.isArray(inputs) ? inputs : [inputs];
            var mu = arr[0];
            if (!isTraining) return tf.add(mu, tf.zerosLike(mu));
            var logvar = tf.clipByValue(arr[1], -10, 10);
            // Use mu.shape (a regular number[] from the resolved tensor at
            // forward time), NOT tf.shape(mu). The tf.shape free function isn't
            // exposed in every TF.js build, and tf.randomNormal expects an
            // Array<number>, not a 1-D tensor of shape values. With tf.shape
            // we'd silently fail under model.fit() runtime even when graph
            // construction passes.
            var eps = tf.randomNormal(mu.shape, 0, 1, mu.dtype);
            var std = tf.exp(tf.mul(tf.scalar(0.5), logvar));
            return tf.add(mu, tf.mul(std, eps));
          });
        }
      }
      // Static className is what tf.serialization.registerClass actually reads
      // to populate its classNameMap. Without it, registerClass silently
      // succeeds but the layer is NOT findable by name on tf.loadLayersModel
      // (saved checkpoints fail with "Unknown layer: ReparameterizeLayer").
      // Codex caught this — the previous version only exposed getClassName()
      // (an instance method) which isn't read by the registry.
      RL.className = "ReparameterizeLayer";
      if (tf.serialization && typeof tf.serialization.registerClass === "function") {
        try {
          tf.serialization.registerClass(RL);
        } catch (e) {
          // Surface registration failures rather than silently swallowing them
          // (the previous version had a catch-all that hid this exact bug).
          if (typeof console !== "undefined" && console.warn) {
            console.warn("ReparameterizeLayer registerClass failed:", e && e.message || e);
          }
        }
      }
      // Static helper that wires the symbolic mu/logvar tensors through the
      // layer with deterministic naming for downstream extractDecoder lookup
      // (`reparam_<nid>`). The trailing `_add_<nid>` alias keeps the trace
      // backwards-compatible with the previous topology where the latent
      // output was named `reparam_add_*`.
      RL.apply = function (muTensor, logvarTensor, nodeId) {
        _reparamCount++;
        var nid = nodeId || _reparamCount;
        var layer = new RL({ name: "reparam_add_" + nid });
        return layer.apply([muTensor, logvarTensor]);
      };
      return RL;
    })();

    // ─── GRU layer with resetAfter=True (PyTorch semantics) ──────
    // tf.layers.gru hard-rejects resetAfter=True (throws at TF.js
    // tf.js:73422). PyTorch GRU's forward equation matches Keras
    // resetAfter=True, NOT the resetAfter=False that TF.js ships.
    // The math difference is in the n-gate's reset-gate placement:
    //     resetAfter=False: n = tanh(W_xn·x + b_xn + r·W_hn·h + r·b_hn)  [Keras default]
    //     resetAfter=True:  n = tanh(W_xn·x + b_xn + r·(W_hn·h + b_hn)) [PyTorch / CuDNN]
    // The two are inequivalent unless b_hn = 0.
    //
    // To get PyTorch ↔ TF.js bit-exact GRU inference we provide our own
    // recurrent layer that runs the resetAfter=True forward inside
    // tf.tidy. Weight layout matches Keras:
    //   kernel:           [in,  3*H]  in [z, r, h] gate order
    //   recurrentKernel:  [H,   3*H]  in [z, r, h] gate order
    //   bias:             [2,   3*H]  row 0 = b_x*, row 1 = b_h*
    //
    // Registered with tf.serialization so it round-trips through
    // tf.loadLayersModel.
    var GRUResetAfterLayer = (function () {
      if (!tf || typeof tf.layers !== "object" || typeof tf.layers.Layer !== "function") {
        function Stub() {}
        Stub.apply = function () { throw new Error("GRUResetAfterLayer requires tf.layers.Layer (TF.js >= 4.x)"); };
        return Stub;
      }
      function _initBy(name) {
        var n = String(name || "").toLowerCase();
        if (n === "zeros") return tf.initializers.zeros();
        if (n === "ones") return tf.initializers.ones();
        if (n === "orthogonal") return tf.initializers.orthogonal({});
        if (n === "glorotuniform" || n === "glorot_uniform") return tf.initializers.glorotUniform({});
        if (n === "glorotnormal" || n === "glorot_normal") return tf.initializers.glorotNormal({});
        return tf.initializers.glorotUniform({});
      }
      // Accept either an initializer instance (what _assignInitializer
      // emits via tf.initializers.X()) or a string name; fall back to
      // the named default. Without this, the layer silently ignored
      // user-configured kernelInitializer/recurrentInitializer/
      // biasInitializer in rnnCfg and always rebuilt with the layer's
      // hardcoded defaults.
      function _resolveInit(cfgInit, fallbackName) {
        if (cfgInit && typeof cfgInit.apply === "function") return cfgInit;
        if (typeof cfgInit === "string" && cfgInit) return _initBy(cfgInit);
        return _initBy(fallbackName);
      }
      class GRURALayer extends tf.layers.Layer {
        constructor(config) {
          super(config || {});
          this.units = Math.max(1, Number((config && config.units) || 1));
          this.returnSequences = !!(config && config.returnSequences);
          this.useBias = config && config.useBias !== false;
          // Input dropout matching tf.layers.gru's `dropout` arg (Keras
          // semantics): per-call dropout mask applied to xt during
          // training. Clamp to [0, 1) so a dropout of 1 doesn't zero out
          // the entire input.
          var dropRate = Number((config && config.dropout) || 0);
          if (!isFinite(dropRate) || dropRate < 0) dropRate = 0;
          if (dropRate >= 1) dropRate = 0.9999;
          this.dropout = dropRate;
          this._kernelInit = _resolveInit(config && config.kernelInitializer, "glorotUniform");
          this._recurrentInit = _resolveInit(config && config.recurrentInitializer, "orthogonal");
          this._biasInit = _resolveInit(config && config.biasInitializer, "zeros");
        }
        build(inputShape) {
          // inputShape is [batch, seq, features] (or [batch, features] for
          // unbatched single-step). Last dim = features = inDim.
          var shape = Array.isArray(inputShape) && Array.isArray(inputShape[0]) ? inputShape[0] : inputShape;
          var inDim = shape[shape.length - 1];
          var H = this.units;
          this.kernel = this.addWeight("kernel", [inDim, 3 * H], "float32", this._kernelInit);
          this.recurrentKernel = this.addWeight("recurrent_kernel", [H, 3 * H], "float32", this._recurrentInit);
          if (this.useBias) {
            this.bias = this.addWeight("bias", [2, 3 * H], "float32", this._biasInit);
          }
          this.built = true;
        }
        computeOutputShape(inputShape) {
          var shape = Array.isArray(inputShape) && Array.isArray(inputShape[0]) ? inputShape[0] : inputShape;
          var batch = shape[0];
          var seq = shape.length === 3 ? shape[1] : null;
          // returnSequences=true must always preserve the time axis,
          // even when seq is null (dynamic / unknown timestep length).
          // Earlier this branch dropped to [batch, units] whenever seq
          // was null, breaking downstream Layer-shape inference for
          // any graph where the recurrent layer feeds another sequence
          // op without a fixed timestep.
          if (this.returnSequences) return [batch, seq, this.units];
          return [batch, this.units];
        }
        call(inputs, kwargs) {
          var self = this;
          var training = !!(kwargs && (kwargs.training === true || kwargs.training === 1));
          return tf.tidy(function () {
            var x = Array.isArray(inputs) ? inputs[0] : inputs;
            // Promote 2D → 3D (single timestep) so the loop is uniform.
            if (x.shape.length === 2) x = tf.expandDims(x, 1);
            var batch = x.shape[0];
            var seq = x.shape[1];
            var H = self.units;
            var kernel = self.kernel.read();
            var recurrent = self.recurrentKernel.read();
            var biasX = null, biasH = null;
            if (self.useBias && self.bias) {
              var biasFull = self.bias.read();
              biasX = biasFull.slice([0, 0], [1, 3 * H]).reshape([3 * H]);
              biasH = biasFull.slice([1, 0], [1, 3 * H]).reshape([3 * H]);
            }
            // Per-call input dropout mask (Keras `dropout` semantics: same
            // mask reused across timesteps within one call). Inactive when
            // not training or rate=0 — purely a scaling op then.
            var inputMask = null;
            if (training && self.dropout > 0) {
              var keepProb = 1 - self.dropout;
              var inDim = x.shape[x.shape.length - 1];
              var noise = tf.randomUniform([batch, inDim], 0, 1);
              inputMask = tf.div(tf.cast(tf.greaterEqual(noise, self.dropout), "float32"), tf.scalar(keepProb));
            }
            var h = tf.zeros([batch, H]);
            var outputs = [];
            for (var t = 0; t < seq; t++) {
              // Slice timestep and squeeze the seq dim → [batch, inDim]
              var xt = x.slice([0, t, 0], [-1, 1, -1]).reshape([batch, x.shape[2]]);
              if (inputMask) xt = tf.mul(xt, inputMask);
              var xProj = tf.matMul(xt, kernel);
              if (biasX) xProj = tf.add(xProj, biasX);
              var hProj = tf.matMul(h, recurrent);
              if (biasH) hProj = tf.add(hProj, biasH);
              // [z, r, h] gate order matching Keras.
              var xz = xProj.slice([0, 0],     [-1, H]);
              var xr = xProj.slice([0, H],     [-1, H]);
              var xn = xProj.slice([0, 2 * H], [-1, H]);
              var hz = hProj.slice([0, 0],     [-1, H]);
              var hr = hProj.slice([0, H],     [-1, H]);
              var hn = hProj.slice([0, 2 * H], [-1, H]);
              var z = tf.sigmoid(tf.add(xz, hz));
              var r = tf.sigmoid(tf.add(xr, hr));
              // resetAfter=True: r multiplies (W_hn·h + b_hn) BEFORE adding to x-side.
              var n = tf.tanh(tf.add(xn, tf.mul(r, hn)));
              // h = (1 - z) * n + z * h_prev
              h = tf.add(tf.mul(tf.sub(tf.scalar(1), z), n), tf.mul(z, h));
              if (self.returnSequences) outputs.push(h);
            }
            if (self.returnSequences) return tf.stack(outputs, 1);
            return tf.keep(h);
          });
        }
        getConfig() {
          var cfg = super.getConfig();
          cfg.units = this.units;
          cfg.returnSequences = this.returnSequences;
          cfg.useBias = this.useBias;
          cfg.dropout = this.dropout;
          return cfg;
        }
      }
      GRURALayer.className = "GRUResetAfterLayer";
      if (tf.serialization && typeof tf.serialization.registerClass === "function") {
        try { tf.serialization.registerClass(GRURALayer); } catch (e) {
          if (typeof console !== "undefined" && console.warn) {
            console.warn("GRUResetAfterLayer registerClass failed:", e && e.message || e);
          }
        }
      }
      return GRURALayer;
    })();

    // Determine output units per head. Priority (contract-driven):
    // 1. Explicit units/unitsHint on the output node
    // 2. Schema-declared featureSize on the matching allowedOutputKeys entry
    // 3. Universal target-key conventions (label/logits→numClasses, params, pixel_values, custom)
    // 4. headType (classification→numClasses)
    // 5. datasetMeta.targetSize
    // 6. Simple-regression default = 1 (don't infer from hidden upstream width)
    var targetUnitsFromMode = function (target, paramsSelectRaw, nodeData, headType, upstreamUnits) {
      var nd = nodeData || {};
      // 1. explicit units on the output node
      if (nd.units && Number(nd.units) > 0) return Number(nd.units);
      if (nd.unitsHint && Number(nd.unitsHint) > 0) return Number(nd.unitsHint);

      // 2. schema-declared featureSize for this target key (preferred contract path)
      var spec = _lookupOutputSpec(target, datasetMeta.allowedOutputKeys);
      if (spec && Number(spec.featureSize) > 0) {
        return Math.max(1, Number(spec.featureSize));
      }

      var targetKey = String(target || nd.targetType || nd.target || "").trim().toLowerCase();

      // 3. universal target-key conventions
      if (targetKey === "label" || targetKey === "logits") {
        return Math.max(1, Number(datasetMeta.numClasses || datasetMeta.classCount || 1));
      }
      if (targetKey === "params") {
        var raw = String(paramsSelectRaw || nd.paramsSelect || "");
        var picks = raw.split(",").map(function (s) { return String(s || "").trim(); }).filter(Boolean);
        return Math.max(1, picks.length || Number(datasetMeta.paramSize || 1));
      }
      if (targetKey === "pixel_values") {
        // reconstruction targets the input shape; falling back to upstream width is
        // legitimate for autoencoders that already taper the bottleneck back up
        return Math.max(1, Number(datasetMeta.featureSize || upstreamUnits || 1));
      }
      if ((targetKey === "custom" || targetKey === "none") && Number(upstreamUnits) > 0) {
        return Math.max(1, Number(upstreamUnits));
      }

      // 4. headType-driven
      var ht = String(headType || (spec && spec.headType) || "regression");
      if (ht === "classification") {
        return Math.max(1, Number(datasetMeta.numClasses || datasetMeta.classCount || upstreamUnits || 1));
      }

      // 5. dataset-side targetSize
      if (Number(datasetMeta.targetSize) > 0) {
        return Math.max(1, Number(datasetMeta.targetSize));
      }

      // 6. simple-regression default. Don't infer from upstream hidden width:
      // hidden width is incidental to the model architecture, not the target.
      // Multi-output regression should declare width via output-node units,
      // schema featureSize, or datasetMeta.targetSize.
      return 1;
    };

    var applyNodeOp = function (node, inTensor, laterHasRecurrent, nodeId) {
      var _n = "n" + String(nodeId || ""); // deterministic layer name from graph node ID
      // input/image_source that receives from another node: passthrough
      if (node.name === "input_layer" || node.name === "image_source_layer" || node.name === "image_source_block" || node.name === "time_embed_layer" || node.name === "class_embed_layer") {
        return inTensor;
      }
      if (node.name === "dense_layer") {
        var units = Math.max(1, Number(node.data.units || 32));
        var activation = String(node.data.activation || "relu");
        var denseCfg = { units: units, activation: activation, useBias: _resolveUseBias(node.data, true), name: _n };
        _assignInitializer(denseCfg, "kernelInitializer", tf, node.data, "kernel", "default");
        if (denseCfg.useBias) _assignInitializer(denseCfg, "biasInitializer", tf, node.data, "bias", "default");
        var denseLayer = _applyLayerMetadata(tf.layers.dense(denseCfg), node);
        return denseLayer.apply(inTensor);
      }
      if (node.name === "conv1d_layer") {
        if (!isSequence) throw new Error("Conv1D requires sequence input mode.");
        var filters = Math.max(1, Number((node.data && node.data.filters) || 64));
        var kernelSize = Math.max(1, Number((node.data && node.data.kernelSize) || 3));
        var strides = Math.max(1, Number((node.data && node.data.stride) || 1));
        var activ = String((node.data && node.data.activation) || "relu");
        var conv1dCfg = { filters: filters, kernelSize: kernelSize, strides: strides, padding: "same", activation: activ, useBias: _resolveUseBias(node.data, true), name: _n };
        _assignInitializer(conv1dCfg, "kernelInitializer", tf, node.data, "kernel", "default");
        if (conv1dCfg.useBias) _assignInitializer(conv1dCfg, "biasInitializer", tf, node.data, "bias", "default");
        return _applyLayerMetadata(tf.layers.conv1d(conv1dCfg), node).apply(inTensor);
      }
      // --- GAN building blocks ---
      if (node.name === "constant_layer") {
        // Constant: outputs tensor filled with constant value, matching batch dim of inTensor
        // Implementation: Dense(dim, bias=constVal, kernel=0, trainable=false)
        var constVal = Number((node.data && node.data.value) != null ? node.data.value : 1);
        var constDim = Math.max(1, Number((node.data && node.data.dim) || 1));
        var constLayer = tf.layers.dense({
          units: constDim, useBias: true, trainable: false, name: _n,
          kernelInitializer: "zeros",
          biasInitializer: tf.initializers.constant({ value: constVal }),
        });
        return constLayer.apply(inTensor);
      }
      if (node.name === "concat_batch_layer") {
        // Handled in multi-input section above
        return inTensor;
      }
      if (node.name === "phase_switch_layer") {
        // Handled in multi-input section above
        return inTensor;
      }
      if (node.name === "embedding_layer") {
        var vocabSize = Math.max(1, Number((node.data && node.data.inputDim) || 10000));
        var embedDim = Math.max(1, Number((node.data && node.data.outputDim) || 256));
        var embedCfg = { inputDim: vocabSize, outputDim: embedDim, name: _n };
        _assignInitializer(embedCfg, "embeddingsInitializer", tf, node.data, "kernel", "default");
        return _applyLayerMetadata(tf.layers.embedding(embedCfg), node).apply(inTensor);
      }
      // --- Conv2D family ---
      if (node.name === "reshape_layer") {
        var shapeStr = String((node.data && node.data.targetShape) || "28,28,1");
        var shape = shapeStr.split(",").map(function (s) { return Math.max(1, parseInt(s.trim()) || 1); });
        return tf.layers.reshape({ targetShape: shape, name: _n }).apply(inTensor);
      }
      if (node.name === "conv2d_layer") {
        var f2 = Math.max(1, Number((node.data && node.data.filters) || 32));
        var k2 = Math.max(1, Number((node.data && node.data.kernelSize) || 3));
        var s2 = Math.max(1, Number((node.data && node.data.strides) || 1));
        var p2 = String((node.data && node.data.padding) || "same");
        var a2 = String((node.data && node.data.activation) || "relu");
        var conv2dCfg = { filters: f2, kernelSize: k2, strides: s2, padding: p2, activation: a2, useBias: _resolveUseBias(node.data, true), name: _n };
        _assignInitializer(conv2dCfg, "kernelInitializer", tf, node.data, "kernel", "default");
        if (conv2dCfg.useBias) _assignInitializer(conv2dCfg, "biasInitializer", tf, node.data, "bias", "default");
        return _applyLayerMetadata(tf.layers.conv2d(conv2dCfg), node).apply(inTensor);
      }
      if (node.name === "conv2d_transpose_layer") {
        var ft = Math.max(1, Number((node.data && node.data.filters) || 32));
        var kt = Math.max(1, Number((node.data && node.data.kernelSize) || 3));
        var st = Math.max(1, Number((node.data && node.data.strides) || 2));
        var pt = String((node.data && node.data.padding) || "same");
        var at = String((node.data && node.data.activation) || "relu");
        // BUG-38 fix: TF.js's native conv2dTranspose(padding="same") uses
        // a different padding/cropping convention from PyTorch's
        // ConvTranspose2d(pad=0) + top-left crop (which is what
        // train_subprocess.py uses on the server). The two produce
        // outputs that differ by ~3.13 max abs diff on a synthetic
        // 3x3 kernel test — i.e. the trained weights produce different
        // pixel values when applied via the two algorithms. Conv-AE
        // train val_loss 0.011 vs runtime MSE 0.114 (~10x inflation)
        // was the visible symptom.
        //
        // Fix: when padding="same", use TF.js's "valid" (no pad) and
        // then manually crop the output's bottom-right border to
        // input * stride. This matches the server's convention exactly:
        //   raw output: (in-1)*stride + kernel
        //   crop to:    in*stride (drop kernel-stride from top-right edge)
        //
        // PyTorch conv_transpose2d with pad=0 + crop is also what we do
        // here (TF.js valid + crop), so train and inference now produce
        // identical pixel values for the same weights.
        var transposeCfg = {
          filters: ft, kernelSize: kt, strides: st,
          padding: pt === "same" ? "valid" : pt,
          activation: at, useBias: _resolveUseBias(node.data, true), name: _n,
        };
        _assignInitializer(transposeCfg, "kernelInitializer", tf, node.data, "kernel", "default");
        if (transposeCfg.useBias) _assignInitializer(transposeCfg, "biasInitializer", tf, node.data, "bias", "default");
        var rawOut = _applyLayerMetadata(tf.layers.conv2dTranspose(transposeCfg), node).apply(inTensor);
        if (pt === "same") {
          // Crop the raw output (size: (in-1)*stride + kernel) down to
          // in*stride. Total crop = (kernel - stride). Split it as
          // floor on top/left, ceil on bottom/right — must match the
          // server's PyTorch crop formula (train_subprocess.py:1367)
          // which starts the slice at (ks - st) // 2. For odd kernels
          // with stride=2 (e.g. Conv-AE 3x3) the crop is bottom/right
          // only; for even kernels (e.g. DCGAN 4x4) it is symmetric.
          var inH = inTensor.shape && inTensor.shape[1];
          var inW = inTensor.shape && inTensor.shape[2];
          if (inH && inW) {
            var totalCropH = Math.max(0, kt - st);
            var totalCropW = Math.max(0, kt - st);
            var cropTop = Math.floor(totalCropH / 2);
            var cropBottom = totalCropH - cropTop;
            var cropLeft = Math.floor(totalCropW / 2);
            var cropRight = totalCropW - cropLeft;
            if (cropTop > 0 || cropBottom > 0 || cropLeft > 0 || cropRight > 0) {
              return tf.layers.cropping2D({
                cropping: [[cropTop, cropBottom], [cropLeft, cropRight]],
                name: _n + "_crop",
              }).apply(rawOut);
            }
          }
        }
        return rawOut;
      }
      if (node.name === "maxpool2d_layer") {
        var ps = Math.max(1, Number((node.data && node.data.poolSize) || 2));
        var ss = Math.max(1, Number((node.data && node.data.strides) || ps));
        return tf.layers.maxPooling2d({ poolSize: ps, strides: ss, name: _n }).apply(inTensor);
      }
      if (node.name === "flatten_layer") {
        return tf.layers.flatten({ name: _n }).apply(inTensor);
      }
      if (node.name === "upsample2d_layer") {
        var us = Math.max(1, Number((node.data && node.data.size) || 2));
        return tf.layers.upSampling2d({ size: [us, us], name: _n }).apply(inTensor);
      }
      if (node.name === "global_avg_pool2d_layer") {
        return tf.layers.globalAveragePooling2d({ name: _n }).apply(inTensor);
      }
      if (node.name === "global_avg_pool1d_layer") {
        return tf.layers.globalAveragePooling1d({ name: _n }).apply(inTensor);
      }
      if (node.name === "latent_layer" || node.name === "latent_mu_layer" || node.name === "latent_logvar_layer") {
        var u = Math.max(2, Number((node.data && node.data.units) || 16));
        var latentCfg = { units: u, activation: "linear", useBias: _resolveUseBias(node.data, true), name: _n };
        _assignInitializer(latentCfg, "kernelInitializer", tf, node.data, "kernel", "default");
        if (latentCfg.useBias) _assignInitializer(latentCfg, "biasInitializer", tf, node.data, "bias", "default");
        return tf.layers.dense(latentCfg).apply(inTensor);
      }
      if (node.name === "reparam_layer") {
        throw new Error("Reparam node is handled as a special two-input op.");
      }
      if (node.name === "dropout_layer") {
        var rate = clamp(Number(node.data.rate || 0.1), 0, 0.9);
        return _applyLayerMetadata(tf.layers.dropout({ rate: rate, name: _n }), node).apply(inTensor);
      }
      if (node.name === "batchnorm_layer") {
        var momentum = clamp(Number((node.data && node.data.momentum) || 0.99), 0.1, 0.999);
        var epsilon = Math.max(1e-6, Number((node.data && node.data.epsilon) || 1e-3));
        var bnCfg = { momentum: momentum, epsilon: epsilon, name: _n };
        _assignInitializer(bnCfg, "gammaInitializer", tf, node.data, "gamma", "default");
        _assignInitializer(bnCfg, "betaInitializer", tf, node.data, "beta", "default");
        _assignInitializer(bnCfg, "movingMeanInitializer", tf, node.data, "movingMean", "default");
        _assignInitializer(bnCfg, "movingVarianceInitializer", tf, node.data, "movingVariance", "default");
        return _applyLayerMetadata(tf.layers.batchNormalization(bnCfg), node).apply(inTensor);
      }
      if (node.name === "layernorm_layer") {
        var eps = Math.max(1e-6, Number((node.data && node.data.epsilon) || 1e-3));
        var lnCfg = { axis: -1, epsilon: eps, name: _n };
        _assignInitializer(lnCfg, "gammaInitializer", tf, node.data, "gamma", "default");
        _assignInitializer(lnCfg, "betaInitializer", tf, node.data, "beta", "default");
        return _applyLayerMetadata(tf.layers.layerNormalization(lnCfg), node).apply(inTensor);
      }
      if (node.name === "relu_layer") {
        return tf.layers.reLU({ name: _n }).apply(inTensor);
      }
      if (node.name === "relu_layer") {
        return tf.layers.activation({ activation: "relu", name: _n }).apply(inTensor);
      }
      if (node.name === "leaky_relu_layer") {
        var alpha = clamp(Number((node.data && node.data.alpha) || 0.2), 0.01, 0.5);
        return tf.layers.leakyReLU({ alpha: alpha, name: _n }).apply(inTensor);
      }
      if (node.name === "rnn_layer" || node.name === "gru_layer" || node.name === "lstm_layer") {
        var rnnUnits = Math.max(1, Number(node.data.units || 64));
        var dropout = clamp(Number(node.data.dropout || 0), 0, 0.8);
        var rsSetting = String(node.data.returnseq || "auto");
        var returnSeq = rsSetting === "true" ? true : (rsSetting === "false" ? false : laterHasRecurrent);
        var rnnCfg = { units: rnnUnits, returnSequences: returnSeq, dropout: dropout, useBias: _resolveUseBias(node.data, true), recurrentInitializer: "glorotUniform" };
        _assignInitializer(rnnCfg, "kernelInitializer", tf, node.data, "kernel", "default");
        _assignInitializer(rnnCfg, "recurrentInitializer", tf, node.data, "recurrent", "glorotUniform");
        if (rnnCfg.useBias) _assignInitializer(rnnCfg, "biasInitializer", tf, node.data, "bias", "default");
        // auto-reshape 2D → 3D if needed (e.g., Dense output → LSTM in decoder)
        var rnnIn = inTensor;
        if (inTensor.shape.length === 2) {
          var reshDim = inTensor.shape[inTensor.shape.length - 1];
          rnnIn = tf.layers.reshape({ targetShape: [1, reshDim], name: _n + "_reshape" }).apply(inTensor);
        }
        rnnCfg.name = _n;
        if (node.name === "rnn_layer") return _applyLayerMetadata(tf.layers.simpleRNN(rnnCfg), node).apply(rnnIn);
        if (node.name === "gru_layer") {
          // Use the resetAfter=True custom layer so PyTorch ↔ TF.js GRU
          // inference is bit-exact. tf.layers.gru defaults to
          // resetAfter=False (n-gate uses r·b_hn outside the inner sum)
          // and refuses to flip it (throws at TF.js tf.js:73422).
          return _applyLayerMetadata(new GRUResetAfterLayer(rnnCfg), node).apply(rnnIn);
        }
        return _applyLayerMetadata(tf.layers.lstm(rnnCfg), node).apply(rnnIn);
      }
      if (node.name === "concat_block") return inTensor;
      // Detach: identity forward, stop gradient backward
      // TF.js doesn't have a built-in stopGradient layer,
      // but we mark it and handle in phased training engine
      if (node.name === "detach_layer") {
        // Phase-conditional gradient stop:
        // activePhase set → only stop gradient during that phase, passthrough otherwise
        // activePhase empty → stop gradient always
        var detachLayer = tf.layers.activation({ activation: "linear" });
        detachLayer._isDetach = true;
        detachLayer._detachActivePhase = String((node.data && node.data.activePhase) || "");
        return detachLayer.apply(inTensor);
      }
      // NoiseInjection: add Gaussian noise (training only)
      if (node.name === "noise_injection_layer") {
        var noiseScale = Number((node.data && node.data.scale) || 0.1);
        return _applyLayerMetadata(tf.layers.gaussianNoise({ stddev: noiseScale, name: _n }), node).apply(inTensor);
      }

      // PatchEmbed: flattened square image → non-overlapping patch tokens.
      if (node.name === "patch_embed_layer") {
        var pePS = Math.max(1, Number((node.data && node.data.patchSize) || 7));
        var peED = Math.max(1, Number((node.data && node.data.embedDim) || 64));
        var peFlat = Number(inTensor.shape[inTensor.shape.length - 1] || 0);
        var peImgSize = Math.round(Math.sqrt(peFlat));
        if (!Number.isFinite(peImgSize) || peImgSize <= 0 || peImgSize * peImgSize !== peFlat) {
          throw new Error("PatchEmbed expects square flattened image input, got featureSize=" + String(peFlat));
        }
        var pePatchesPerSide = Math.floor(peImgSize / pePS);
        var peNumPatches = pePatchesPerSide * pePatchesPerSide;
        var peImage = tf.layers.reshape({ targetShape: [peImgSize, peImgSize, 1], name: _n + "_image" }).apply(inTensor);
        var peConvCfg = {
          filters: peED,
          kernelSize: [pePS, pePS],
          strides: [pePS, pePS],
          padding: "valid",
          activation: "linear",
          useBias: _resolveUseBias(node.data, true),
          name: _n + "_proj"
        };
        _assignInitializer(peConvCfg, "kernelInitializer", tf, node.data, "kernel", "default");
        if (peConvCfg.useBias) _assignInitializer(peConvCfg, "biasInitializer", tf, node.data, "bias", "default");
        var peProjectedMap = tf.layers.conv2d(peConvCfg).apply(peImage);
        return tf.layers.reshape({ targetShape: [peNumPatches, peED], name: _n + "_tokens" }).apply(peProjectedMap);
      }

      // TransformerBlock: [batch, seqLen, embedDim] → [batch, seqLen, embedDim]
      // Implements: LayerNorm → MultiHeadAttention → Residual → LayerNorm → FFN → Residual
      if (node.name === "transformer_block_layer") {
        var tbHeads = Math.max(1, Number((node.data && node.data.numHeads) || 4));
        var tbFFN = Math.max(1, Number((node.data && node.data.ffnDim) || 128));
        var tbDrop = Number((node.data && node.data.dropout) || 0.1);
        var tbEps = Math.max(1e-6, Number((node.data && node.data.epsilon) || 1e-3));
        var tbDim = inTensor.shape[inTensor.shape.length - 1]; // embedDim
        var tbSeqLen = inTensor.shape[inTensor.shape.length - 2]; // numPatches

        // LayerNorm 1
        var tbNorm1 = tf.layers.layerNormalization({ axis: -1, epsilon: tbEps, name: _n + "_ln1" }).apply(inTensor);

        // Multi-Head Self-Attention (implemented via Dense projections)
        // Q, K, V projections: [batch, seq, dim] → [batch, seq, dim]
        var tbQ = tf.layers.timeDistributed({ layer: tf.layers.dense({ units: tbDim, name: _n + "_q_inner" }), name: _n + "_q" }).apply(tbNorm1);
        var tbK = tf.layers.timeDistributed({ layer: tf.layers.dense({ units: tbDim, name: _n + "_k_inner" }), name: _n + "_k" }).apply(tbNorm1);
        var tbV = tf.layers.timeDistributed({ layer: tf.layers.dense({ units: tbDim, name: _n + "_v_inner" }), name: _n + "_v" }).apply(tbNorm1);

        // Scaled dot-product attention: softmax(QK^T / sqrt(d)) * V
        // Using a Lambda-like approach via Dense → we approximate attention with a learned mixing layer
        // Full attention would need custom layer; for demo we use a simplified version:
        // Concatenate Q,K,V → project down to embed_dim (captures cross-token interactions)
        var tbQKV = tf.layers.concatenate({ axis: -1, name: _n + "_qkv" }).apply([tbQ, tbK, tbV]);
        var tbAttnOut = tf.layers.timeDistributed({
          layer: tf.layers.dense({ units: tbDim, name: _n + "_attn_proj_inner" }),
          name: _n + "_attn_proj"
        }).apply(tbQKV);

        if (tbDrop > 0) {
          tbAttnOut = tf.layers.dropout({ rate: tbDrop, name: _n + "_attn_drop" }).apply(tbAttnOut);
        }

        // Residual 1
        var tbRes1 = tf.layers.add({ name: _n + "_res1" }).apply([inTensor, tbAttnOut]);

        // LayerNorm 2
        var tbNorm2 = tf.layers.layerNormalization({ axis: -1, epsilon: tbEps, name: _n + "_ln2" }).apply(tbRes1);

        // FFN: Dense(ffnDim, relu) → Dense(embedDim)
        var tbFFN1 = tf.layers.timeDistributed({
          layer: tf.layers.dense({ units: tbFFN, activation: "relu", name: _n + "_ffn1_inner" }),
          name: _n + "_ffn1"
        }).apply(tbNorm2);
        if (tbDrop > 0) {
          tbFFN1 = tf.layers.dropout({ rate: tbDrop, name: _n + "_ffn_drop" }).apply(tbFFN1);
        }
        var tbFFN2 = tf.layers.timeDistributed({
          layer: tf.layers.dense({ units: tbDim, name: _n + "_ffn2_inner" }),
          name: _n + "_ffn2"
        }).apply(tbFFN1);

        // Residual 2
        var tbRes2 = tf.layers.add({ name: _n + "_res2" }).apply([tbRes1, tbFFN2]);
        return tbRes2;
      }

      throw new Error("Unsupported node type: " + node.name);
    };

    // walk topological order, build tensors
    for (var ti = 0; ti < topo.length; ti++) {
      var id = topo[ti];
      if (allInputIds.indexOf(id) >= 0) continue;
      var node = moduleData[id];
      if (!node) continue;
      var ins = getIncoming(id).filter(function (e) { return reachable[e.from]; });
      if (!ins.length && node.name !== "constant_layer") continue;
      var incomingTensors = ins.map(function (e) { return tensorById[e.from]; }).filter(Boolean);
      // Constant node: no parents — use primary input as dummy to derive batch size
      if (!incomingTensors.length && node.name === "constant_layer") {
        incomingTensors = [inputTensor]; // use primary model input
      }
      if (!incomingTensors.length) continue;
      var inTensor = incomingTensors[0];
      if (incomingTensors.length > 1) {
        var multiInputNodes = { "concat_block": true, "reparam_layer": true, "concat_batch_layer": true, "phase_switch_layer": true, "output_layer": true };
        if (!multiInputNodes[node.name]) {
          throw new Error("Node '" + node.name + "' has multiple inputs but is not a multi-input node.");
        }
        if (node.name === "concat_block") {
          inTensor = tf.layers.concatenate({ axis: -1 }).apply(incomingTensors);
        }
        if (node.name === "concat_batch_layer") {
          // Batch-axis concat: [N, D] + [N, D] → [2N, D]
          inTensor = tf.layers.concatenate({ axis: 0 }).apply(incomingTensors);
        }
        if (node.name === "phase_switch_layer") {
          // PhaseSwitch: select between input_1 and input_2 based on a flag input.
          // flag=0 → input_1, flag=1 → input_2
          // output = input_1 + flag * (input_2 - input_1)
          // Using: diff = subtract(in2, in1), scaled = multiply(diff, flag), output = add(in1, scaled)
          if (!_phaseFlagInput) {
            _phaseFlagInput = tf.input({ shape: [1], name: "phase_flag_input" });
            allInputTensors.push({ id: "phase_flag", tensor: _phaseFlagInput, name: "phase_flag_input" });
          }
          var psIn1 = incomingTensors[0];
          var psIn2 = incomingTensors.length > 1 ? incomingTensors[1] : incomingTensors[0];
          // output = in1*(1-flag) + in2*flag using only multiply + add (no Dense, no subtract)
          // = in1 - in1*flag + in2*flag = in1 + flag*(in2 - in1)
          // TF.js has no subtract layer, so: in2 - in1 via activation trick not clean.
          // Simpler: out = in1 + flag*in2 - flag*in1 = (1-flag)*in1 + flag*in2
          // Compute separately: s1 = in1*flag, s2 = in2*flag, out = in1 - s1 + s2 = in1 + (s2 - s1)
          // Still no subtract... Use: in1 + flag*(in2 + (-1)*in1)
          // Negate in1 via activation layer? No clean way.
          // Simplest: two multiply + one add. flag*in2 + (1-flag)*in1
          // (1-flag) via: create constant 1, subtract... still no subtract.
          // Just use the Dense(kernel=-1, bias=1) approach but mark it non-trainable properly
          var psOneMinusFlag = tf.layers.dense({ units: 1, useBias: true, trainable: false,
            kernelInitializer: tf.initializers.constant({ value: -1 }),
            biasInitializer: tf.initializers.constant({ value: 1 }),
            name: "ps_inv_" + id
          }).apply(_phaseFlagInput);
          var scaled1 = tf.layers.multiply({ name: "ps_mul1_" + id }).apply([psIn1, psOneMinusFlag]);
          var scaled2 = tf.layers.multiply({ name: "ps_mul2_" + id }).apply([psIn2, _phaseFlagInput]);
          inTensor = tf.layers.add({ name: "ps_add_" + id }).apply([scaled1, scaled2]);
          _phaseSwitchConfigs.push({ nodeId: id, activePhase: String((node.data && node.data.activePhase) || "") });
        }
        if (node.name === "output_layer") {
          // Output can have 2 inputs: data (input_1) + label source (input_2)
          inTensor = incomingTensors[0];
          if (incomingTensors.length > 1 && incomingTensors[1]) {
            _headLabelTensors[String(id)] = incomingTensors[1];
          }
        }
      }

      if (node.name === "output_layer") {
        var odata = node.data || {};
        var headMatchWeight = Math.max(0, Number(odata.matchWeight != null ? odata.matchWeight : 1));
        var targets = outputTargetsFromNodeData(odata, allowedOutputKeys, fallbackTarget);
        var rawLossName = String((odata && odata.loss) || "mse").trim().toLowerCase();
        // Normalize BCE aliases once
        var lossName = (rawLossName === "binarycrossentropy" || rawLossName === "binary_crossentropy") ? "bce" : rawLossName;
        var paramsSelect = String((odata && odata.paramsSelect) || "");
        var inForHead = (inTensor.shape && inTensor.shape.length === 3)
          ? tf.layers.globalAveragePooling1d().apply(inTensor) : inTensor;
        var generated = [];
        targets.forEach(function (target, tti) {
          // headType from node config or schema lookup — no string matching on target names
          var ht = String(odata.headType || "").trim().toLowerCase();
          if (!ht || ht === "auto") ht = _lookupHeadType(target, allowedOutputKeys);
          var upstreamUnits = Number(inForHead.shape && inForHead.shape[inForHead.shape.length - 1] || 0);
          var hasExplicitUnits = (Number(odata.units || 0) > 0) || (Number(odata.unitsHint || 0) > 0);
          var units, act;
          if (lossName === "none") {
            // loss=none: passthrough, no head Dense
            units = upstreamUnits || 1;
            outTensors.push(inForHead);
            generated.push(inForHead);
          } else if (lossName === "bce") {
            // BCE: sigmoid output. For segmentation/mask use target_size, else 1.
            var isMaskHead = ht === "segmentation" || String(odata.target || odata.targetType || "").toLowerCase().indexOf("mask") >= 0;
            units = Number(odata.units || (isMaskHead ? (datasetMeta && datasetMeta.targetSize ? datasetMeta.targetSize : upstreamUnits) : 1));
            act = "sigmoid";
            var upDim = upstreamUnits;
            if (upDim === units) {
              // upstream already has matching shape — passthrough
              outTensors.push(inForHead);
              generated.push(inForHead);
            } else {
              var headCfg = { units: units, activation: act, useBias: _resolveUseBias(odata, true), name: "head_" + id };
              _assignInitializer(headCfg, "kernelInitializer", tf, odata, "kernel", "default");
              if (headCfg.useBias) _assignInitializer(headCfg, "biasInitializer", tf, odata, "bias", "default");
              var headT = tf.layers.dense(headCfg).apply(inForHead);
              outTensors.push(headT);
              generated.push(headT);
            }
          } else {
            units = targetUnitsFromMode(target, paramsSelect, odata, ht, upstreamUnits);
            var normalizedLoss = String(lossName || "").trim().toLowerCase();
            if (normalizedLoss === "wgan") normalizedLoss = "wasserstein";
            act = (normalizedLoss === "wasserstein")
              ? "linear"
              : ((ht === "classification" && units > 1) ? "softmax" : "linear");
            if (!hasExplicitUnits && upstreamUnits === units && act === "linear") {
              outTensors.push(inForHead);
              generated.push(inForHead);
            } else {
              var headCfg2 = { units: units, activation: act, useBias: _resolveUseBias(odata, true), name: "head_" + id };
              _assignInitializer(headCfg2, "kernelInitializer", tf, odata, "kernel", "default");
              if (headCfg2.useBias) _assignInitializer(headCfg2, "biasInitializer", tf, odata, "bias", "default");
              var headTensor = tf.layers.dense(headCfg2).apply(inForHead);
              outTensors.push(headTensor);
              generated.push(headTensor);
            }
          }
          var _labelIdx = -1;
          if (_headLabelTensors[String(id)]) {
            outTensors.push(_headLabelTensors[String(id)]);
            _labelIdx = outTensors.length - 1;
          }
          headConfigs.push({
            id: String(id) + ":" + String(target) + ":" + String(tti + 1),
            nodeId: String(id), target: target, targetType: target, headType: ht,
            paramsSelect: paramsSelect, units: units, loss: lossName,
            matchWeight: headMatchWeight,
            phase: String(odata.phase || ""),
            graphLabelOutputIdx: _labelIdx,
          });
        });
        tensorById[id] = generated[0];
      } else {
        var laterHasRecurrent = topo.slice(ti + 1).some(function (nid) {
          var nm = moduleData[nid] && moduleData[nid].name;
          return nm === "rnn_layer" || nm === "gru_layer" || nm === "lstm_layer" || nm === "conv1d_layer";
        });
        var out;
        if (node.name === "reparam_layer") {
          if (incomingTensors.length !== 2) throw new Error("Reparam node requires exactly 2 inputs.");
          out = ReparameterizeLayer.apply(incomingTensors[0], incomingTensors[1], id);
          var rd = node.data || {};
          var g = String(rd.group || "default").trim();
          var beta = Math.max(0, Number(rd.beta || 1e-3));
          var mw = Math.max(0, Number(rd.matchWeight || 1));
          if (!vaeKLGroups[g]) vaeKLGroups[g] = [];
          vaeKLGroups[g].push({
            id: String(id), mu: incomingTensors[0], logvar: incomingTensors[1],
            beta: beta, matchWeight: mw,
            units: Math.max(2, Number(out.shape && out.shape[out.shape.length - 1] || 2)),
          });
        } else {
          out = applyNodeOp(node, inTensor, laterHasRecurrent, id);
        }
        tensorById[id] = out;
        if (node.name === "latent_layer" || node.name === "latent_mu_layer" || node.name === "latent_logvar_layer") {
          var ld = node.data || {};
          var latentType = String(node.name);
          var lg = String(ld.group || "default").trim();
          var gk = lg + "::" + latentType;
          var lmw = Math.max(0, Number(ld.matchWeight || 1));
          if (!latentGroups[gk]) latentGroups[gk] = [];
          latentGroups[gk].push({
            id: String(id), group: lg, latentType: latentType,
            tensor: out, units: Math.max(2, Number((ld && ld.units) || 16)), matchWeight: lmw,
          });
        }
      }
    }

    // latent diff heads
    Object.keys(latentGroups).forEach(function (gk) {
      var items = latentGroups[gk] || [];
      if (items.length < 2) return;
      var ref = items[0];
      for (var i = 1; i < items.length; i++) {
        var it = items[i];
        if (Number(ref.units) !== Number(it.units)) {
          throw new Error("Latent group units mismatch (" + ref.units + " vs " + it.units + ").");
        }
        var diff = tf.layers.subtract().apply([ref.tensor, it.tensor]);
        outTensors.push(diff);
        headConfigs.push({
          id: "latent_diff:" + ref.group + ":" + ref.latentType + ":" + String(i),
          target: "latent_diff", headType: "latent_kl", units: Number(ref.units), loss: "mse", wx: 1, wv: 1,
          matchWeight: Math.max(0, Number((ref.matchWeight + it.matchWeight) / 2 || 1)),
        });
      }
    });

    // VAE KL heads
    Object.keys(vaeKLGroups).forEach(function (g) {
      var items = vaeKLGroups[g] || [];
      items.forEach(function (it, i) {
        var klTensor = tf.layers.concatenate({ axis: -1 }).apply([it.mu, it.logvar]);
        outTensors.push(klTensor);
        headConfigs.push({
          id: "latent_kl:" + g + ":" + String(i + 1),
          target: "latent_kl", headType: "latent_kl",
          units: Math.max(2, Number(it.units || 2)) * 2,
          loss: "mse", wx: 1, wv: 1,
          matchWeight: Math.max(0, Number(it.matchWeight || 1)),
          beta: Math.max(0, Number(it.beta || 1e-3)),
        });
      });
    });

    if (!outTensors.length) throw new Error("No valid Output heads were built.");
    var outputs = outTensors.length === 1 ? outTensors[0] : outTensors;
    var modelInputs = allInputTensors.length === 1 ? inputTensor : allInputTensors.map(function (t) { return t.tensor; });
    return {
      model: tf.model({ inputs: modelInputs, outputs: outputs }),
      isSequence: isSequence,
      headConfigs: headConfigs,
      inputNodes: allInputTensors.map(function (t) { return { id: t.id, name: t.name }; }),
      phaseSwitchConfigs: _phaseSwitchConfigs,
    };
  }

  // --- subgraph extraction for generation ---

  /**
   * extractLatentInfo(graphData) → { family, latentDim, reparamNodes, latentNodes, hasDecoder }
   * Analyzes the graph to find latent space dimensions and structure.
   */
  function extractLatentInfo(graphData) {
      var data = extractGraphData(graphData);
      var family = inferModelFamily(graphData);
      var ids = Object.keys(data || {});
      var latentDim = 0;
      var reparamNodes = [];
      var latentNodes = [];

      ids.forEach(function (id) {
        var n = data[id];
        if (!n) return;
        var name = String(n.name || "");
        var d = n.data || {};
        if (name === "reparam_layer") {
          var units = Math.max(1, Number(d.units || d.latentDim || 16));
          reparamNodes.push({ id: id, group: String(d.group || "default"), units: units, beta: Number(d.beta || 1e-3) });
          if (units > latentDim) latentDim = units;
        }
        if (name === "latent_layer" || name === "latent_mu_layer" || name === "latent_logvar_layer") {
          var lu = Math.max(1, Number(d.units || 16));
          latentNodes.push({ id: id, type: name, group: String(d.group || "default"), units: lu });
          if (lu > latentDim) latentDim = lu;
        }
      });

      // find output nodes downstream of reparam
      var hasDecoder = reparamNodes.length > 0;
      return { family: family, latentDim: latentDim, reparamNodes: reparamNodes, latentNodes: latentNodes, hasDecoder: hasDecoder };
    }

    /**
     * extractDecoder(tf, fullModel, latentDim) → { model, latentDim, outputDim }
     * Given a full trained model with a Reparameterize layer,
     * creates a new model: z_input [latentDim] → (decoder layers) → output.
     *
     * Strategy: find the reparameterize layer in the model, get its output tensor,
     * trace all layers downstream to the outputs, and create a new model.
     */
    function extractDecoder(tf, fullModel, latentDim, targetOutputIndex) {
      if (!tf || !fullModel) throw new Error("extractDecoder: tf and fullModel required");
      var dim = latentDim || 16;

      // Find the latent (z) output layer. The reparam block is implemented as
      // two TF.js layers internally:
      //   reparam_noise_<id>  — Dense(units=latent, init=0) applied to logvar
      //   reparam_add_<id>    — Add layer combining mu + noiseProj → z
      // The "z" tensor that feeds the decoder is reparam_add_*'s output, NOT
      // reparam_noise_*. Picking reparam_noise here causes the backward trace
      // from the recon output to never reach the chosen layer (recon depends
      // on reparam_add, not reparam_noise), so the path-collection step
      // falls back to wrong layers.
      // Match priority:
      //   1. exact prefix "reparam_add" (the canonical latent output)
      //   2. layer class name containing "reparam" (custom subclass case)
      //   3. any layer whose name contains "reparam" but NOT "reparam_noise"
      var reparamLayer = null;
      function _checkReparamCandidate(layer) {
        if (reparamLayer) return;
        var outShape = layer.outputShape;
        if (Array.isArray(outShape) && outShape.length >= 2) {
          dim = outShape[outShape.length - 1] || dim;
        }
        reparamLayer = layer;
      }
      for (var i = 0; i < fullModel.layers.length; i++) {
        var layer = fullModel.layers[i];
        var lname = String(layer.name || "").toLowerCase();
        if (lname.indexOf("reparam_add") === 0 || lname.indexOf("reparam_add_") >= 0) {
          _checkReparamCandidate(layer);
          break;
        }
      }
      if (!reparamLayer) {
        for (var i2 = 0; i2 < fullModel.layers.length; i2++) {
          var layer2 = fullModel.layers[i2];
          var lclass = String(layer2.getClassName ? layer2.getClassName() : "").toLowerCase();
          if (lclass.indexOf("reparam") >= 0) {
            _checkReparamCandidate(layer2);
            break;
          }
        }
      }
      if (!reparamLayer) {
        for (var i3 = 0; i3 < fullModel.layers.length; i3++) {
          var layer3 = fullModel.layers[i3];
          var lname3 = String(layer3.name || "").toLowerCase();
          if (lname3.indexOf("reparam") >= 0 && lname3.indexOf("reparam_noise") < 0) {
            _checkReparamCandidate(layer3);
            break;
          }
        }
      }

      // If no reparam found, try to find a layer named "latent" or with small dimension (bottleneck)
      if (!reparamLayer) {
        var minUnits = Infinity;
        var bottleneckLayer = null;
        for (var j = 1; j < fullModel.layers.length - 1; j++) {
          var bl = fullModel.layers[j];
          var shape = bl.outputShape;
          var units = Array.isArray(shape) ? shape[shape.length - 1] : 0;
          if (units > 0 && units < minUnits) {
            minUnits = units;
            bottleneckLayer = bl;
          }
        }
        if (bottleneckLayer) {
          reparamLayer = bottleneckLayer;
          dim = minUnits;
        }
      }

      if (!reparamLayer) throw new Error("extractDecoder: no reparameterize or bottleneck layer found");

      // Pick which model output the decoder should terminate at. For branched
      // multi-head models (VAE+Cls: [recon, classProbs]), the caller passes the
      // index of the reconstruction head — otherwise we default to output 0.
      var modelOutputs = (fullModel.outputs && fullModel.outputs.length) ? fullModel.outputs : null;
      var oi = (typeof targetOutputIndex === "number" && targetOutputIndex >= 0) ? targetOutputIndex : 0;
      var targetTensor = modelOutputs ? (modelOutputs[oi] || modelOutputs[0]) : null;
      if (!targetTensor) {
        throw new Error("extractDecoder: model has no output tensor at index " + oi);
      }

      // Walk the GRAPH backward from the chosen output tensor to the reparam
      // layer, recording layers in reverse topological order. A purely
      // sequential apply over fullModel.layers (the previous implementation)
      // would chain layers from a parallel branch (e.g. classifier head) onto
      // the reconstruction path because it ignored graph structure entirely.
      // Here we follow each layer's first inbound tensor — the recon path
      // between reparam and the recon output is linear, so a single-input
      // backtrack is sufficient. (Multi-input layers like Concat would need a
      // BFS variant; none exist on the recon path in the demos that ship.)
      var pathLayers = [];
      var cursor = targetTensor;
      var seen = new Set();
      var reachedReparam = false;
      var hops = 0;
      while (cursor) {
        var src = cursor.sourceLayer;
        if (!src || seen.has(src)) break;
        seen.add(src);
        if (src === reparamLayer) {
          pathLayers.reverse();
          reachedReparam = true;
          break;
        }
        pathLayers.push(src);
        // Get this layer's input tensor via inboundNodes — DO NOT use
        // src.input, which throws "ill-defined" once a layer has been applied
        // more than once (e.g. when extractDecoder is called twice on the same
        // model for repeat builds). The first inboundNode is the original
        // construction call; that's the edge we want to follow.
        var nextTensor = null;
        if (src.inboundNodes && src.inboundNodes.length) {
          var ibn = src.inboundNodes[0];
          if (ibn && ibn.inputTensors && ibn.inputTensors.length) {
            nextTensor = ibn.inputTensors[0];
          }
        }
        cursor = nextTensor;
        hops++;
      }
      if (!reachedReparam) {
        // Backward trace from the chosen output tensor never hit the
        // designated latent layer. Failing here is the right thing — the
        // alternatives (silently emit a [latent_dim] tensor, or chain
        // unrelated layers) produce decoders that crash downstream with
        // confusing shape mismatches in the browser. Common cause: this
        // function picked the wrong layer as the latent (e.g. reparam_noise
        // instead of reparam_add) so the recon path was never going to
        // intersect it.
        throw new Error(
          "extractDecoder: backward trace from output[" + oi + "] " +
          "(shape " + JSON.stringify(targetTensor.shape) + ") did not reach " +
          "the latent layer '" + (reparamLayer.name || "<unnamed>") + "'. " +
          "Trace length: " + hops + ". " +
          "The latent layer is likely a sibling of the recon path rather " +
          "than its origin — verify the reparam matcher picked the correct " +
          "layer (e.g. reparam_add_* should be preferred over reparam_noise_*)."
        );
      }

      // Build decoder by applying the path layers to a fresh latent input.
      var zInput = tf.input({ shape: [dim], name: "z_input" });
      var x = zInput;
      for (var k = 0; k < pathLayers.length; k++) {
        var dl = pathLayers[k];
        // skip multi-input merge layers (none on a typical recon path; this
        // is just a guard for the fallback walk above)
        if (dl.inboundNodes && dl.inboundNodes.length && dl.inboundNodes[0].inputTensors && dl.inboundNodes[0].inputTensors.length > 1) continue;
        try {
          x = dl.apply(x);
        } catch (e) {
          continue;
        }
      }

      var decoderModel = tf.model({ inputs: zInput, outputs: x, name: "decoder" });
      var outputShape = decoderModel.outputShape;
      var outputDim = Array.isArray(outputShape) ? outputShape[outputShape.length - 1] : 0;
      return { model: decoderModel, latentDim: dim, outputDim: outputDim };
    }

  // --- public API ---

  return {
    extractGraphData: extractGraphData,
    getNodeByName: getNodeByName,
    getUpstreamFeatureNames: getUpstreamFeatureNodeNamesFromData,
    getUpstreamFeatureNodes: getUpstreamFeatureNodesFromData,
    normalizeOutputTargetsList: normalizeOutputTargetsList,
    outputTargetsFromNodeData: outputTargetsFromNodeData,
    inferGraphMode: inferGraphMode,
    inferModelFamily: inferModelFamily,
    inferWindow: inferWindow,
    inferArHistoryConfig: inferArHistoryConfig,
    inferOutputHeads: inferOutputHeads,
    inferDatasetTargetMode: inferDatasetTargetMode,
    inferFeatureSpec: inferFeatureSpec,
    buildModelFromGraph: buildModelFromGraph,
    extractLatentInfo: extractLatentInfo,
    extractDecoder: extractDecoder,
    extractGenerationNodes: extractGenerationNodes,
    extractGenerationCapabilities: extractGenerationCapabilities,
  };
});

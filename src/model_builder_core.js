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

  // helper: look up headType for a target key from allowedOutputKeys
  function _lookupHeadType(target, allowedOutputKeys) {
    if (!Array.isArray(allowedOutputKeys)) return "regression";
    for (var i = 0; i < allowedOutputKeys.length; i++) {
      var ok = allowedOutputKeys[i];
      if (typeof ok === "object" && ok !== null && ok.key === target) return String(ok.headType || "regression");
    }
    return "regression";
  }

  function outputTargetsFromNodeData(data, allowedKeys, fallbackTarget) {
    var d = data || {};
    // read single target from node — no multi-target, no CSV
    var raw = d.target || d.targetType || fallbackTarget || "";
    return normalizeOutputTargetsList(raw, fallbackTarget ? [String(fallbackTarget)] : [], allowedKeys);
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
    var inputNodeNames = { "input_layer": true, "image_source_block": true, "image_source_layer": true, "sample_z_layer": true, "time_embed_layer": true };
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

    var inputNodeNames = { "input_layer": true, "image_source_block": true, "image_source_layer": true, "sample_z_layer": true };
    // only nodes with NO incoming connections are true external inputs
    // (e.g., Input node connected FROM ImageSource is NOT an external input)
    var inputIds = ids.filter(function (id) {
      if (!moduleData[id] || !inputNodeNames[moduleData[id].name]) return false;
      var ins = moduleData[id].inputs || {};
      var hasIncoming = Object.keys(ins).some(function (k) {
        return ins[k] && ins[k].connections && ins[k].connections.length > 0;
      });
      return !hasIncoming;
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
    var needsReshapeForRecurrent = !isSequence && hasRecurrent && inputMode !== "sequence";

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

    // VAE reparameterization — uses tf.layers.add as the merge layer
    // instead of a custom Layer (which has broken init in TF.js 4.x browser).
    // Approach: z = mu + dense(logvar) where the dense learns sqrt(exp(logvar/2))
    // The KL loss on the separate mu/logvar heads enforces proper VAE behavior.
    var _reparamCount = 0;
    var ReparameterizeLayer = (function () {
      function RL() {}
      RL.apply = function (muTensor, logvarTensor) {
        _reparamCount++;
        // use add layer: z = mu + noise_projection(logvar)
        // noise_projection is a trainable dense that approximates std * eps
        var latentDim = muTensor.shape[muTensor.shape.length - 1];
        var noiseProj = tf.layers.dense({
          units: latentDim, activation: "linear",
          name: "reparam_noise_" + _reparamCount,
          kernelInitializer: "zeros", biasInitializer: "zeros",
        }).apply(logvarTensor);
        return tf.layers.add({ name: "reparam_add_" + _reparamCount }).apply([muTensor, noiseProj]);
      };
      return RL;
    })();

    // Determine output units per head. Priority:
    // 1. Explicit units/unitsHint in the output node config
    // 2. Schema-defined output keys (with featureSize)
    // 3. Infer from target type + dataset metadata
    var targetUnitsFromMode = function (target, paramsSelectRaw, nodeData, headType) {
      // 1. explicit units on the output node
      var nd = nodeData || {};
      if (nd.units && Number(nd.units) > 0) return Number(nd.units);
      if (nd.unitsHint && Number(nd.unitsHint) > 0) return Number(nd.unitsHint);

      // 2. from headType (set by schema, not hardcoded target names)
      var ht = String(headType || "regression");
      if (ht === "classification") {
        return Math.max(1, Number(datasetMeta.numClasses || 10));
      }
      // regression / reconstruction: output = input feature size
      return Math.max(1, Number(datasetMeta.featureSize || 1));
    };

    var applyNodeOp = function (node, inTensor, laterHasRecurrent, nodeId) {
      var _n = "n" + String(nodeId || ""); // deterministic layer name from graph node ID
      // input/image_source that receives from another node: passthrough
      if (node.name === "input_layer" || node.name === "image_source_layer" || node.name === "image_source_block") {
        return inTensor;
      }
      if (node.name === "dense_layer") {
        var units = Math.max(1, Number(node.data.units || 32));
        var activation = String(node.data.activation || "relu");
        var denseLayer = tf.layers.dense({ units: units, activation: activation, name: _n });
        if (node.data.weightTag) denseLayer._weightTag = String(node.data.weightTag);
        return denseLayer.apply(inTensor);
      }
      if (node.name === "conv1d_layer") {
        if (!isSequence) throw new Error("Conv1D requires sequence input mode.");
        var filters = Math.max(1, Number((node.data && node.data.filters) || 64));
        var kernelSize = Math.max(1, Number((node.data && node.data.kernelSize) || 3));
        var strides = Math.max(1, Number((node.data && node.data.stride) || 1));
        var activ = String((node.data && node.data.activation) || "relu");
        return tf.layers.conv1d({ filters: filters, kernelSize: kernelSize, strides: strides, padding: "same", activation: activ, name: _n }).apply(inTensor);
      }
      // --- GAN building blocks ---
      if (node.name === "constant_layer") {
        // Constant: outputs tensor filled with constant value, matching batch dim of inTensor
        // Implementation: Dense(dim, bias=constVal, kernel=0, trainable=false)
        var constVal = Number((node.data && node.data.value) != null ? node.data.value : 1);
        var constDim = Math.max(1, Number((node.data && node.data.dim) || 1));
        var constLayer = tf.layers.dense({
          units: constDim, useBias: true, trainable: false,
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
        return tf.layers.embedding({ inputDim: vocabSize, outputDim: embedDim, name: _n }).apply(inTensor);
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
        return tf.layers.conv2d({ filters: f2, kernelSize: k2, strides: s2, padding: p2, activation: a2, name: _n }).apply(inTensor);
      }
      if (node.name === "conv2d_transpose_layer") {
        var ft = Math.max(1, Number((node.data && node.data.filters) || 32));
        var kt = Math.max(1, Number((node.data && node.data.kernelSize) || 3));
        var st = Math.max(1, Number((node.data && node.data.strides) || 2));
        var pt = String((node.data && node.data.padding) || "same");
        var at = String((node.data && node.data.activation) || "relu");
        return tf.layers.conv2dTranspose({ filters: ft, kernelSize: kt, strides: st, padding: pt, activation: at, name: _n }).apply(inTensor);
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
      if (node.name === "latent_layer" || node.name === "latent_mu_layer" || node.name === "latent_logvar_layer") {
        var u = Math.max(2, Number((node.data && node.data.units) || 16));
        return tf.layers.dense({ units: u, activation: "linear" }).apply(inTensor);
      }
      if (node.name === "reparam_layer") {
        throw new Error("Reparam node is handled as a special two-input op.");
      }
      if (node.name === "dropout_layer") {
        var rate = clamp(Number(node.data.rate || 0.1), 0, 0.9);
        return tf.layers.dropout({ rate: rate, name: _n }).apply(inTensor);
      }
      if (node.name === "batchnorm_layer") {
        var momentum = clamp(Number((node.data && node.data.momentum) || 0.99), 0.1, 0.999);
        var epsilon = Math.max(1e-6, Number((node.data && node.data.epsilon) || 1e-3));
        return tf.layers.batchNormalization({ momentum: momentum, epsilon: epsilon, name: _n }).apply(inTensor);
      }
      if (node.name === "layernorm_layer") {
        var eps = Math.max(1e-6, Number((node.data && node.data.epsilon) || 1e-3));
        return tf.layers.layerNormalization({ axis: -1, epsilon: eps, name: _n }).apply(inTensor);
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
        var rnnCfg = { units: rnnUnits, returnSequences: returnSeq, dropout: dropout, recurrentInitializer: "glorotUniform" };
        // auto-reshape 2D → 3D if needed (e.g., Dense output → LSTM in decoder)
        var rnnIn = inTensor;
        if (inTensor.shape.length === 2) {
          var reshDim = inTensor.shape[inTensor.shape.length - 1];
          rnnIn = tf.layers.reshape({ targetShape: [1, reshDim] }).apply(inTensor);
        }
        if (node.name === "rnn_layer") return tf.layers.simpleRNN(rnnCfg).apply(rnnIn);
        if (node.name === "gru_layer") return tf.layers.gru(rnnCfg).apply(rnnIn);
        return tf.layers.lstm(rnnCfg).apply(rnnIn);
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
        return tf.layers.gaussianNoise({ stddev: noiseScale, name: _n }).apply(inTensor);
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
        var lossName = String((odata && odata.loss) || "mse");
        var paramsSelect = String((odata && odata.paramsSelect) || "");
        var inForHead = (inTensor.shape && inTensor.shape.length === 3)
          ? tf.layers.globalAveragePooling1d().apply(inTensor) : inTensor;
        var generated = [];
        targets.forEach(function (target, tti) {
          // headType from node config or schema lookup — no string matching on target names
          var ht = String(odata.headType || "").trim().toLowerCase();
          if (!ht || ht === "auto") ht = _lookupHeadType(target, allowedOutputKeys);
          var units, act;
          if (lossName === "none") {
            // loss=none: passthrough, no head Dense
            units = inForHead.shape[inForHead.shape.length - 1] || 1;
            outTensors.push(inForHead);
            generated.push(inForHead);
          } else if (lossName === "bce") {
            // BCE: binary output (1 unit, sigmoid)
            units = Number(odata.units || 1);
            act = "sigmoid";
            var upDim = inForHead.shape[inForHead.shape.length - 1];
            if (upDim === units) {
              // upstream already has matching shape — passthrough
              outTensors.push(inForHead);
              generated.push(inForHead);
            } else {
              var headT = tf.layers.dense({ units: units, activation: act }).apply(inForHead);
              outTensors.push(headT);
              generated.push(headT);
            }
          } else {
            units = targetUnitsFromMode(target, paramsSelect, odata, ht);
            act = (ht === "classification") ? "softmax" : "linear";
            var headTensor = tf.layers.dense({ units: units, activation: act }).apply(inForHead);
            outTensors.push(headTensor);
            generated.push(headTensor);
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
          out = ReparameterizeLayer.apply(incomingTensors[0], incomingTensors[1]);
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
          target: "latent_diff", units: Number(ref.units), loss: "mse", wx: 1, wv: 1,
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
          target: "latent_kl", units: Math.max(2, Number(it.units || 2)) * 2,
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
    function extractDecoder(tf, fullModel, latentDim) {
      if (!tf || !fullModel) throw new Error("extractDecoder: tf and fullModel required");
      var dim = latentDim || 16;

      // Find reparam layer by class name or layer name
      var reparamLayer = null;
      var reparamOutput = null;
      for (var i = 0; i < fullModel.layers.length; i++) {
        var layer = fullModel.layers[i];
        var lname = String(layer.name || "").toLowerCase();
        var lclass = String(layer.getClassName ? layer.getClassName() : "").toLowerCase();
        if (lname.indexOf("reparam") >= 0 || lclass.indexOf("reparam") >= 0) {
          reparamLayer = layer;
          reparamOutput = layer.output;
          // get latent dim from layer output shape
          var outShape = layer.outputShape;
          if (Array.isArray(outShape) && outShape.length >= 2) {
            dim = outShape[outShape.length - 1] || dim;
          }
          break;
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
          reparamOutput = bottleneckLayer.output;
          dim = minUnits;
        }
      }

      if (!reparamLayer) throw new Error("extractDecoder: no reparameterize or bottleneck layer found");

      // Build decoder: new input [dim] → trace from reparam output to model outputs
      var zInput = tf.input({ shape: [dim], name: "z_input" });

      // Simple approach: build a sequential decoder from the layers after reparam
      var reparamIdx = fullModel.layers.indexOf(reparamLayer);
      var x = zInput;
      for (var k = reparamIdx + 1; k < fullModel.layers.length; k++) {
        var dl = fullModel.layers[k];
        // skip input/merge layers that expect multiple inputs
        if (dl.inboundNodes && dl.inboundNodes.length && dl.inboundNodes[0].inputTensors && dl.inboundNodes[0].inputTensors.length > 1) continue;
        try {
          x = dl.apply(x);
        } catch (e) {
          // skip layers that can't be applied (shape mismatch from encoder path)
          continue;
        }
      }

      var decoderModel = tf.model({ inputs: zInput, outputs: x, name: "decoder" });

      // get output dim
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
  };
});

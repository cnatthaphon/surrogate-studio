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
    var inputNode = getNodeByName(graphData, "input_layer");
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
    var inputNode = getNodeByName(graphData, "input_layer");
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
    var key = String(raw || "").trim().toLowerCase();
    return key || "x";
  }

  function nodeUsesHistoryField(node, fieldKey) {
    if (!node) return false;
    var name = String(node.name || "");
    var d = node.data || {};
    if (name === "hist_x_block" || name === "x_block" || name === "window_hist_x_block") return fieldKey === "x";
    if (name === "hist_v_block" || name === "v_block" || name === "window_hist_v_block") return fieldKey === "v";
    if (name === "hist_block" || name === "window_hist_block") return normalizeHistorySeriesKey(d.featureKey || "x") === String(fieldKey || "");
    return false;
  }

  // --- output target helpers ---

  function normalizeOutputTargetsList(raw, fallbackTargets, allowedKeys) {
    var allowed = Array.isArray(allowedKeys) ? allowedKeys : ["x"];
    var defaultTarget = allowed.indexOf("x") >= 0
      ? "x"
      : (allowed.indexOf("logits") >= 0 ? "logits" : String(allowed[0] || "x"));
    var list = [];
    if (Array.isArray(raw)) {
      list = raw.map(function (x) { return String(x || "").trim().toLowerCase(); });
    } else if (typeof raw === "string") {
      list = raw.split(",").map(function (x) { return String(x || "").trim().toLowerCase(); });
    } else if (raw != null) {
      list = [String(raw || "").trim().toLowerCase()];
    }
    list = list.filter(function (x) { return x && allowed.indexOf(x) >= 0; });
    if (!list.length) {
      var fb = Array.isArray(fallbackTargets) ? fallbackTargets : [String(fallbackTargets || defaultTarget)];
      list = fb.map(function (x) { return String(x || "").trim().toLowerCase(); })
        .filter(function (x) { return x && allowed.indexOf(x) >= 0; });
    }
    if (!list.length) list = [defaultTarget];
    var uniq = [];
    list.forEach(function (x) { if (uniq.indexOf(x) < 0) uniq.push(x); });
    if (uniq.indexOf("xv") >= 0) {
      return uniq.filter(function (x) { return x !== "x" && x !== "v"; });
    }
    return uniq;
  }

  function outputTargetsFromNodeData(data, allowedKeys, fallbackTarget) {
    var d = data || {};
    var allowed = Array.isArray(allowedKeys) ? allowedKeys : ["x"];
    var defaultTarget = allowed.indexOf("x") >= 0
      ? "x"
      : (allowed.indexOf("logits") >= 0 ? "logits" : String(allowed[0] || "x"));
    var raw = (Array.isArray(d.targets) && d.targets.length) ? d.targets
      : (typeof d.targetsCsv === "string" ? d.targetsCsv : (d.targetType || d.target || fallbackTarget || defaultTarget));
    return normalizeOutputTargetsList(raw, [String(fallbackTarget || d.targetType || d.target || defaultTarget)], allowed);
  }

  // --- graph inference (pure, no DOM, no state) ---

  function inferGraphMode(graphData, fallbackMode) {
    var data = extractGraphData(graphData);
    var names = getUpstreamFeatureNodeNamesFromData(data);
    var hasHistory = Boolean(
      names.hist_block || names.hist_x_block || names.hist_v_block ||
      names.x_block || names.v_block ||
      names.window_hist_block || names.window_hist_x_block || names.window_hist_v_block ||
      names.sliding_window_block
    );
    return hasHistory ? "autoregressive" : String(fallbackMode || "direct");
  }

  function inferModelFamily(graphData) {
    var data = extractGraphData(graphData);
    var ids = Object.keys(data || {});
    var names = ids.map(function (id) { return String((data[id] && data[id].name) || ""); });
    if (names.indexOf("noise_schedule_block") >= 0) return "diffusion";
    if (names.indexOf("reparam_layer") >= 0) return "vae";
    if (names.indexOf("latent_layer") >= 0 || names.indexOf("latent_mu_layer") >= 0 || names.indexOf("latent_logvar_layer") >= 0) return "vae";
    return "supervised";
  }

  function inferWindow(graphData, fallbackWindow) {
    var wFallback = Math.max(5, Number(fallbackWindow) || 20);
    var data = extractGraphData(graphData);
    var nodes = getUpstreamFeatureNodesFromData(data);
    var n = nodes.window_hist_block || nodes.window_hist_x_block || nodes.window_hist_v_block || nodes.sliding_window_block;
    if (n) return Math.max(5, Number((n.data && n.data.windowSize) || wFallback));
    if (nodes.hist_block || nodes.hist_x_block || nodes.hist_v_block || nodes.x_block || nodes.v_block) return 1;
    return wFallback;
  }

  function inferArHistoryConfig(graphData, fallbackWindow) {
    var fallback = {
      windowSize: Math.max(5, Number(fallbackWindow) || 20),
      stride: 1, lagMode: "contiguous", lags: null, padMode: "none"
    };
    var data = extractGraphData(graphData);
    var nodes = getUpstreamFeatureNodesFromData(data);
    var n = nodes.window_hist_block || nodes.window_hist_x_block || nodes.window_hist_v_block || nodes.sliding_window_block;
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
    if (nodes.hist_block || nodes.hist_x_block || nodes.hist_v_block || nodes.x_block || nodes.v_block) {
      return { windowSize: 1, stride: 1, lagMode: "contiguous", lags: null, padMode: "none" };
    }
    return fallback;
  }

  function inferOutputHeads(graphData, allowedOutputKeys, fallbackTarget) {
    var data = extractGraphData(graphData);
    var fallback = String(fallbackTarget || "x");
    var ids = Object.keys(data || {});
    var inputIds = ids.filter(function (id) { return data[id] && data[id].name === "input_layer"; });
    if (!inputIds.length) return [{ id: "fallback", target: fallback, loss: "mse", wx: 1, wv: 1 }];
    var reachable = {};
    var q = [String(inputIds[0])];
    reachable[String(inputIds[0])] = true;
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
    if (!outputNodes.length) return [{ id: "fallback", target: fallback, loss: "mse", wx: 1, wv: 1 }];
    var heads = [];
    outputNodes.forEach(function (x) {
      var d = x.node.data || {};
      var targets = outputTargetsFromNodeData(d, allowedOutputKeys, fallback);
      var normalizedLoss = (function () {
        var v = String(d.loss || "mse");
        if (v === "use_global") return "mse";
        return (v === "mse" || v === "mae" || v === "huber") ? v : "mse";
      })();
      targets.forEach(function (target, ti) {
        heads.push({
          id: x.id + ":" + String(target) + ":" + String(ti + 1),
          nodeId: x.id, target: target, targetType: target,
          paramsSelect: String(d.paramsSelect || ""),
          loss: normalizedLoss,
          wx: Math.max(0, Number(d.wx || 1)),
          wv: Math.max(0, Number(d.wv || 1)),
        });
      });
    });
    return heads.length ? heads : [{ id: "fallback", target: fallback, loss: "mse", wx: 1, wv: 1 }];
  }

  function inferDatasetTargetMode(heads, fallback) {
    var list = Array.isArray(heads) ? heads : [];
    var hasX = list.some(function (h) { var t = String(h.target || ""); return t === "x" || t === "xv" || t === "traj"; });
    var hasV = list.some(function (h) { return String(h.target) === "v" || String(h.target) === "xv"; });
    if (hasX && hasV) return "xv";
    if (hasV) return "v";
    if (hasX) return "x";
    return String(fallback || "x");
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

    var inputIds = ids.filter(function (id) { return moduleData[id] && moduleData[id].name === "input_layer"; });
    if (inputIds.length !== 1) throw new Error("Graph must contain exactly one Input node.");
    var inputId = String(inputIds[0]);

    var allowedOutputKeys = Array.isArray(datasetMeta.allowedOutputKeys) ? datasetMeta.allowedOutputKeys : ["x"];
    var fallbackTarget = datasetMeta.defaultTarget || "x";

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

    // reachability from input
    var reachable = {};
    var q = [inputId];
    reachable[inputId] = true;
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
    if (datasetMeta.mode === "direct" && isSequence) {
      throw new Error("Direct mode requires flat graph input.");
    }

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

    // build TF.js model
    var inputTensor = isSequence
      ? tf.input({ shape: [datasetMeta.windowSize, datasetMeta.seqFeatureSize] })
      : tf.input({ shape: [datasetMeta.featureSize] });

    var tensorById = {};
    tensorById[inputId] = inputTensor;
    var outTensors = [];
    var headConfigs = [];
    var latentGroups = {};
    var vaeKLGroups = {};

    // VAE reparameterization layer
    var ReparameterizeLayer = (function () {
      function RL(config) { tf.layers.Layer.call(this, config || {}); }
      RL.prototype = Object.create(tf.layers.Layer.prototype);
      RL.prototype.constructor = RL;
      RL.prototype.computeOutputShape = function (inputShape) { return Array.isArray(inputShape) ? inputShape[0] : inputShape; };
      RL.prototype.call = function (inputs) {
        return tf.tidy(function () {
          var arr = Array.isArray(inputs) ? inputs : [inputs];
          var mu = arr[0];
          var logvar = tf.clipByValue(arr[1], -10, 10);
          var eps = tf.randomNormal(tf.shape(mu), 0, 1, mu.dtype);
          var std = tf.exp(tf.mul(tf.scalar(0.5), logvar));
          return tf.add(mu, tf.mul(std, eps));
        });
      };
      RL.className = "ReparameterizeLayer";
      return RL;
    })();

    var targetUnitsFromMode = function (target, paramsSelectRaw) {
      if (target === "xv") return 2;
      if (target === "params") {
        var pnames = Array.isArray(datasetMeta.paramNames) ? datasetMeta.paramNames.map(String) : [];
        var picks = String(paramsSelectRaw || "").split(",").map(function (s) { return String(s || "").trim(); }).filter(Boolean);
        if (picks.length && pnames.length) {
          var count = picks.filter(function (k) { return pnames.indexOf(k) >= 0; }).length;
          return Math.max(1, count);
        }
        return Math.max(1, Number(datasetMeta.paramSize || 1));
      }
      if (target === "logits" || target === "label") {
        return Math.max(1, Number(datasetMeta.numClasses || 10));
      }
      return 1;
    };

    var applyNodeOp = function (node, inTensor, laterHasRecurrent) {
      if (node.name === "dense_layer") {
        var units = Math.max(1, Number(node.data.units || 32));
        var activation = String(node.data.activation || "relu");
        return tf.layers.dense({ units: units, activation: activation }).apply(inTensor);
      }
      if (node.name === "conv1d_layer") {
        if (!isSequence) throw new Error("Conv1D requires sequence input mode.");
        var filters = Math.max(1, Number((node.data && node.data.filters) || 64));
        var kernelSize = Math.max(1, Number((node.data && node.data.kernelSize) || 3));
        var strides = Math.max(1, Number((node.data && node.data.stride) || 1));
        var activ = String((node.data && node.data.activation) || "relu");
        return tf.layers.conv1d({ filters: filters, kernelSize: kernelSize, strides: strides, padding: "same", activation: activ }).apply(inTensor);
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
        return tf.layers.dropout({ rate: rate }).apply(inTensor);
      }
      if (node.name === "batchnorm_layer") {
        var momentum = clamp(Number((node.data && node.data.momentum) || 0.99), 0.1, 0.999);
        var epsilon = Math.max(1e-6, Number((node.data && node.data.epsilon) || 1e-3));
        return tf.layers.batchNormalization({ momentum: momentum, epsilon: epsilon }).apply(inTensor);
      }
      if (node.name === "layernorm_layer") {
        var eps = Math.max(1e-6, Number((node.data && node.data.epsilon) || 1e-3));
        return tf.layers.layerNormalization({ axis: -1, epsilon: eps }).apply(inTensor);
      }
      if (node.name === "rnn_layer" || node.name === "gru_layer" || node.name === "lstm_layer") {
        if (!isSequence) throw new Error("RNN/GRU/LSTM layers require sequence input mode.");
        var rnnUnits = Math.max(1, Number(node.data.units || 64));
        var dropout = clamp(Number(node.data.dropout || 0), 0, 0.8);
        var rsSetting = String(node.data.returnseq || "auto");
        var returnSeq = rsSetting === "true" ? true : (rsSetting === "false" ? false : laterHasRecurrent);
        var rnnCfg = { units: rnnUnits, returnSequences: returnSeq, dropout: dropout, recurrentInitializer: "glorotUniform" };
        if (node.name === "rnn_layer") return tf.layers.simpleRNN(rnnCfg).apply(inTensor);
        if (node.name === "gru_layer") return tf.layers.gru(rnnCfg).apply(inTensor);
        return tf.layers.lstm(rnnCfg).apply(inTensor);
      }
      if (node.name === "concat_block") return inTensor;
      throw new Error("Unsupported node type: " + node.name);
    };

    // walk topological order, build tensors
    for (var ti = 0; ti < topo.length; ti++) {
      var id = topo[ti];
      if (id === inputId) continue;
      var node = moduleData[id];
      if (!node) continue;
      var ins = getIncoming(id).filter(function (e) { return reachable[e.from]; });
      if (!ins.length) continue;
      var incomingTensors = ins.map(function (e) { return tensorById[e.from]; }).filter(Boolean);
      if (!incomingTensors.length) continue;
      var inTensor = incomingTensors[0];
      if (incomingTensors.length > 1) {
        if (node.name !== "concat_block" && node.name !== "reparam_layer") {
          throw new Error("Node '" + node.name + "' has multiple inputs but is not Concat/Reparam.");
        }
        if (node.name === "concat_block") {
          inTensor = tf.layers.concatenate({ axis: -1 }).apply(incomingTensors);
        }
      }

      if (node.name === "output_layer") {
        var odata = node.data || {};
        var headMatchWeight = Math.max(0, Number(odata.matchWeight || 1));
        var targets = outputTargetsFromNodeData(odata, allowedOutputKeys, fallbackTarget);
        var lossName = String((odata && odata.loss) || "mse");
        var paramsSelect = String((odata && odata.paramsSelect) || "");
        var inForHead = (inTensor.shape && inTensor.shape.length === 3)
          ? tf.layers.globalAveragePooling1d().apply(inTensor) : inTensor;
        var generated = [];
        targets.forEach(function (target, tti) {
          var units = targetUnitsFromMode(target, paramsSelect);
          var act = (target === "logits" || target === "label") ? "softmax" : "linear";
          var headTensor = tf.layers.dense({ units: units, activation: act }).apply(inForHead);
          outTensors.push(headTensor);
          generated.push(headTensor);
          headConfigs.push({
            id: String(id) + ":" + String(target) + ":" + String(tti + 1),
            nodeId: String(id), target: target, targetType: target,
            paramsSelect: paramsSelect, units: units, loss: lossName,
            wx: Math.max(0, Number((odata && odata.wx) || 1)),
            wv: Math.max(0, Number((odata && odata.wv) || 1)),
            matchWeight: headMatchWeight,
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
          out = new ReparameterizeLayer({}).apply([incomingTensors[0], incomingTensors[1]]);
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
          out = applyNodeOp(node, inTensor, laterHasRecurrent);
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
    return { model: tf.model({ inputs: inputTensor, outputs: outputs }), isSequence: isSequence, headConfigs: headConfigs };
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
  };
});

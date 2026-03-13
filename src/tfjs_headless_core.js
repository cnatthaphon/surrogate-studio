"use strict";

const schemaRegistry = require("./schema_registry.js");
const { loadTfjs } = require("./tfjs_node_loader.js");

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function resolveSchemaId(raw, fallback) {
  return schemaRegistry.resolveSchemaId(raw, fallback || schemaRegistry.getDefaultSchemaId());
}

function getSchema(schemaId) {
  return schemaRegistry.getSchema(resolveSchemaId(schemaId));
}

function getDatasetSchema(schemaId) {
  return schemaRegistry.getDatasetSchema(resolveSchemaId(schemaId));
}

function getOutputKeys(schemaId) {
  return schemaRegistry.getOutputKeys(resolveSchemaId(schemaId));
}

function clamp(value, lo, hi) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = Number(lo || 0);
  if (Number.isFinite(lo)) n = Math.max(Number(lo), n);
  if (Number.isFinite(hi)) n = Math.min(Number(hi), n);
  return n;
}

function outputTargetDefaultForSchema(schemaId) {
  const allowed = getOutputKeys(schemaId);
  if (allowed.indexOf("x") >= 0) return "x";
  if (allowed.indexOf("logits") >= 0) return "logits";
  return String(allowed[0] || "x");
}

function normalizeOutputTargetsList(raw, fallbackTargets, schemaId) {
  const allowed = getOutputKeys(schemaId);
  const defaultTarget = outputTargetDefaultForSchema(schemaId);
  let list = [];
  if (Array.isArray(raw)) list = raw.slice();
  else if (typeof raw === "string") list = raw.split(",");
  else if (raw != null) list = [raw];
  list = list
    .map(function (x) { return String(x || "").trim().toLowerCase(); })
    .filter(function (x) { return x && allowed.indexOf(x) >= 0; });
  if (!list.length) {
    const fb = Array.isArray(fallbackTargets) ? fallbackTargets : [fallbackTargets || defaultTarget];
    list = fb
      .map(function (x) { return String(x || "").trim().toLowerCase(); })
      .filter(function (x) { return x && allowed.indexOf(x) >= 0; });
  }
  if (!list.length) list = [defaultTarget];
  const uniq = [];
  list.forEach(function (x) {
    if (uniq.indexOf(x) < 0) uniq.push(x);
  });
  if (uniq.indexOf("xv") >= 0) {
    return uniq.filter(function (x) { return x !== "x" && x !== "v"; });
  }
  return uniq;
}

function outputTargetsFromNodeData(data, schemaId, fallbackTarget) {
  const d = data || {};
  const raw = (Array.isArray(d.targets) && d.targets.length)
    ? d.targets
    : (typeof d.targetsCsv === "string" ? d.targetsCsv : (d.targetType || d.target || fallbackTarget || outputTargetDefaultForSchema(schemaId)));
  return normalizeOutputTargetsList(raw, [fallbackTarget || d.targetType || d.target || outputTargetDefaultForSchema(schemaId)], schemaId);
}

function isClassificationOutputTarget(targetKey) {
  const t = String(targetKey || "").trim().toLowerCase();
  return t === "label" || t === "logits";
}

function normalizeHeadLossType(rawLoss, targets) {
  const list = Array.isArray(targets) ? targets : [targets];
  const hasClassTarget = list.some(function (t) { return isClassificationOutputTarget(t); });
  const allowed = hasClassTarget
    ? ["sparse_cross_entropy", "categorical_cross_entropy", "mse", "mae", "huber"]
    : ["mse", "mae", "huber"];
  let v = String(rawLoss || "").trim().toLowerCase();
  if (v === "cross_entropy") v = "sparse_cross_entropy";
  if (allowed.indexOf(v) >= 0) return v;
  return allowed[0];
}

function shouldUseFromLogits(rawValue, targets, lossType) {
  const hasClassTarget = (Array.isArray(targets) ? targets : [targets]).some(function (t) {
    return isClassificationOutputTarget(t);
  });
  if (!hasClassTarget) return false;
  const normalizedLoss = normalizeHeadLossType(lossType, targets);
  if (normalizedLoss !== "sparse_cross_entropy" && normalizedLoss !== "categorical_cross_entropy") return false;
  if (rawValue == null || rawValue === "") return true;
  return Boolean(rawValue);
}

function getDrawflowData(rawGraph) {
  const graph = rawGraph || {};
  if (graph.drawflow && graph.drawflow.Home && graph.drawflow.Home.data) return graph.drawflow.Home.data;
  if (graph.Home && graph.Home.data) return graph.Home.data;
  if (graph.data && typeof graph.data === "object") return graph.data;
  if (typeof graph === "object") return graph;
  throw new Error("Invalid drawflow graph payload.");
}

function parsePortIndex(name) {
  const m = String(name || "").match(/_(\d+)$/);
  return m ? Number(m[1]) : 9999;
}

function getOutgoing(moduleData, id) {
  const node = moduleData[String(id)];
  if (!node || !node.outputs) return [];
  const out = [];
  Object.keys(node.outputs).forEach(function (portKey) {
    const conns = (node.outputs[portKey] && node.outputs[portKey].connections) || [];
    conns.forEach(function (c) {
      out.push({
        from: String(id),
        to: String(c.node),
        fromPort: String(portKey),
        toPort: String(c.input || ""),
      });
    });
  });
  return out;
}

function getIncoming(moduleData, id) {
  const node = moduleData[String(id)];
  if (!node || !node.inputs) return [];
  const ins = [];
  Object.keys(node.inputs).forEach(function (portKey) {
    const conns = (node.inputs[portKey] && node.inputs[portKey].connections) || [];
    conns.forEach(function (c) {
      ins.push({
        from: String(c.node),
        to: String(id),
        fromPort: String(c.output || ""),
        toPort: String(portKey),
      });
    });
  });
  ins.sort(function (a, b) {
    return parsePortIndex(a.toPort) - parsePortIndex(b.toPort);
  });
  return ins;
}

function getInputNodeIds(moduleData) {
  return Object.keys(moduleData || {}).filter(function (id) {
    return moduleData[id] && moduleData[id].name === "input_layer";
  });
}

function buildReachableTopo(moduleData, inputId) {
  const reachable = {};
  const q = [String(inputId)];
  reachable[String(inputId)] = true;
  while (q.length) {
    const id = q.shift();
    getOutgoing(moduleData, id).forEach(function (edge) {
      if (!reachable[edge.to]) {
        reachable[edge.to] = true;
        q.push(edge.to);
      }
    });
  }
  const reachableIds = Object.keys(reachable);
  const indegree = {};
  reachableIds.forEach(function (id) {
    indegree[id] = 0;
  });
  reachableIds.forEach(function (id) {
    getOutgoing(moduleData, id).forEach(function (edge) {
      if (reachable[edge.to]) indegree[edge.to] += 1;
    });
  });
  const topo = reachableIds
    .filter(function (id) { return indegree[id] === 0; })
    .sort(function (a, b) { return Number(a) - Number(b); });
  const out = [];
  while (topo.length) {
    const id = topo.shift();
    out.push(id);
    getOutgoing(moduleData, id).forEach(function (edge) {
      if (!reachable[edge.to]) return;
      indegree[edge.to] -= 1;
      if (indegree[edge.to] === 0) topo.push(edge.to);
    });
    topo.sort(function (a, b) { return Number(a) - Number(b); });
  }
  if (out.length !== reachableIds.length) {
    throw new Error("Graph contains cycle(s). Please use acyclic connections.");
  }
  return {
    reachableIds: reachableIds,
    topo: out,
  };
}

function deriveImageFeatureSize(dataset) {
  const shape = Array.isArray(dataset.imageShape) ? dataset.imageShape.slice() : [28, 28, 1];
  const total = shape.reduce(function (acc, value) {
    return acc * Math.max(1, Number(value) || 1);
  }, 1);
  const rec = dataset.records || {};
  const train = rec.train || {};
  const first = Array.isArray(train.x) && train.x.length ? train.x[0] : null;
  if (Array.isArray(first) && first.length) return first.length;
  return total;
}

function normalizeImageDataset(dataset, schemaId) {
  const dsSchema = getDatasetSchema(schemaId);
  if (!dsSchema || String(dsSchema.sampleType || "").trim().toLowerCase() !== "image") {
    throw new Error("tfjs headless training currently supports image schemas only.");
  }
  const records = dataset && dataset.records ? dataset.records : {};
  const train = records.train || {};
  const val = records.val || {};
  const test = records.test || {};
  if (!Array.isArray(train.x) || !Array.isArray(train.y) || !train.x.length || !train.y.length) {
    throw new Error("Dataset is missing image training records.");
  }
  const featureSize = deriveImageFeatureSize(dataset || {});
  const classCount = Math.max(1, Number((dataset && dataset.classCount) || 10));
  const classNames = Array.isArray(dataset && dataset.classNames) ? dataset.classNames.slice() : [];
  const cloneRows = function (rows) {
    return Array.isArray(rows) ? rows.map(function (row) { return Array.isArray(row) ? row.slice() : []; }) : [];
  };
  const cloneLabels = function (rows) {
    return Array.isArray(rows) ? rows.map(function (row) {
      const n = Number(row);
      return Number.isFinite(n) ? Math.max(0, Math.min(classCount - 1, Math.round(n))) : 0;
    }) : [];
  };
  return {
    schemaId: schemaId,
    sampleType: "image",
    featureSize: featureSize,
    classCount: classCount,
    classNames: classNames,
    imageShape: Array.isArray(dataset && dataset.imageShape) ? dataset.imageShape.slice() : [28, 28, 1],
    xTrain: cloneRows(train.x),
    yTrainLabels: cloneLabels(train.y),
    xVal: cloneRows(val.x),
    yValLabels: cloneLabels(val.y),
    xTest: cloneRows(test.x),
    yTestLabels: cloneLabels(test.y),
  };
}

function targetUnitsFromMode(target, datasetMeta, nodeData) {
  const data = nodeData || {};
  if (target === "label" || target === "logits") {
    const nodeUnits = Number(data.units || data.unitsHint || 0);
    if (Number.isFinite(nodeUnits) && nodeUnits > 0) return Math.max(1, Math.round(nodeUnits));
    return Math.max(1, Number(datasetMeta.classCount || 1));
  }
  if (target === "xv") return 2;
  if (target === "params") {
    const raw = String(data.paramsSelect || "");
    const picks = raw.split(",").map(function (s) { return String(s || "").trim(); }).filter(Boolean);
    return Math.max(1, picks.length || Number(datasetMeta.paramSize || 1));
  }
  return 1;
}

function buildModelFromDrawflowGraph(rawGraph, datasetMeta, schemaId) {
  const tf = loadTfjs();
  const moduleData = getDrawflowData(rawGraph);
  const ids = Object.keys(moduleData || {});
  if (!ids.length) throw new Error("Drawflow graph is empty.");
  const inputIds = getInputNodeIds(moduleData);
  if (inputIds.length !== 1) {
    throw new Error("Graph must contain exactly one Input node.");
  }
  const inputId = String(inputIds[0]);
  const reach = buildReachableTopo(moduleData, inputId);
  const outputIds = reach.reachableIds.filter(function (id) {
    return moduleData[id] && moduleData[id].name === "output_layer";
  });
  if (!outputIds.length) {
    throw new Error("Graph must have at least one Output node connected from Input.");
  }
  const hasRecurrent = reach.reachableIds.some(function (id) {
    const name = moduleData[id] && moduleData[id].name;
    return name === "rnn_layer" || name === "gru_layer" || name === "lstm_layer" || name === "conv1d_layer";
  });
  const inputNode = moduleData[inputId] || {};
  const inputMode = String((inputNode.data && inputNode.data.mode) || "auto").trim().toLowerCase();
  const isSequence = inputMode === "sequence" ? true : (inputMode === "flat" ? false : hasRecurrent);
  if (datasetMeta.sampleType === "image" && isSequence) {
    throw new Error("Image classification graph must use flat input mode.");
  }

  const inputTensor = isSequence
    ? tf.input({ shape: [datasetMeta.windowSize, datasetMeta.seqFeatureSize] })
    : tf.input({ shape: [datasetMeta.featureSize] });

  class ReparameterizeLayer extends tf.layers.Layer {
    computeOutputShape(inputShape) {
      return Array.isArray(inputShape) ? inputShape[0] : inputShape;
    }
    call(inputs) {
      return tf.tidy(function () {
        const arr = Array.isArray(inputs) ? inputs : [inputs];
        const mu = arr[0];
        const logvar = tf.clipByValue(arr[1], -10, 10);
        const eps = tf.randomNormal(tf.shape(mu), 0, 1, mu.dtype);
        const std = tf.exp(tf.mul(tf.scalar(0.5), logvar));
        return tf.add(mu, tf.mul(std, eps));
      });
    }
    getClassName() {
      return "ReparameterizeLayer";
    }
  }

  function requiredNonNegativeNumber(data, key, nodeName, nodeId) {
    if (!data || !Object.prototype.hasOwnProperty.call(data, key)) {
      throw new Error("Node '" + String(nodeId) + "' (" + String(nodeName) + ") missing required data." + String(key));
    }
    const v = Number(data[key]);
    if (!Number.isFinite(v) || v < 0) {
      throw new Error("Node '" + String(nodeId) + "' (" + String(nodeName) + ") invalid data." + String(key) + " (must be finite >= 0).");
    }
    return v;
  }

  function requiredNonEmptyString(data, key, nodeName, nodeId) {
    if (!data || !Object.prototype.hasOwnProperty.call(data, key)) {
      throw new Error("Node '" + String(nodeId) + "' (" + String(nodeName) + ") missing required data." + String(key));
    }
    const v = String(data[key] == null ? "" : data[key]).trim();
    if (!v) {
      throw new Error("Node '" + String(nodeId) + "' (" + String(nodeName) + ") invalid data." + String(key) + " (must be non-empty).");
    }
    return v;
  }

  function applyNodeOp(node, inTensor, laterHasRecurrent) {
    if (node.name === "dense_layer") {
      const units = Math.max(1, Number(node.data && node.data.units || 32));
      const activation = String(node.data && node.data.activation || "relu");
      return tf.layers.dense({ units: units, activation: activation }).apply(inTensor);
    }
    if (node.name === "dropout_layer") {
      const rate = clamp(node.data && node.data.rate || 0.1, 0, 0.9);
      return tf.layers.dropout({ rate: rate }).apply(inTensor);
    }
    if (node.name === "batchnorm_layer") {
      const momentum = clamp(node.data && node.data.momentum || 0.99, 0.1, 0.999);
      const epsilon = Math.max(1e-6, Number(node.data && node.data.epsilon || 1e-3));
      return tf.layers.batchNormalization({ momentum: momentum, epsilon: epsilon }).apply(inTensor);
    }
    if (node.name === "layernorm_layer") {
      const epsilon = Math.max(1e-6, Number(node.data && node.data.epsilon || 1e-3));
      return tf.layers.layerNormalization({ axis: -1, epsilon: epsilon }).apply(inTensor);
    }
    if (node.name === "conv1d_layer") {
      if (!isSequence) throw new Error("Conv1D requires sequence input mode.");
      const filters = Math.max(1, Number(node.data && node.data.filters || 64));
      const kernelSize = Math.max(1, Number(node.data && node.data.kernelSize || 3));
      const strides = Math.max(1, Number(node.data && node.data.stride || 1));
      const activation = String(node.data && node.data.activation || "relu");
      return tf.layers.conv1d({
        filters: filters,
        kernelSize: kernelSize,
        strides: strides,
        padding: "same",
        activation: activation,
      }).apply(inTensor);
    }
    if (node.name === "rnn_layer" || node.name === "gru_layer" || node.name === "lstm_layer") {
      if (!isSequence) throw new Error(node.name + " requires sequence input mode.");
      const units = Math.max(1, Number(node.data && node.data.units || 64));
      const dropout = clamp(node.data && node.data.dropout || 0, 0, 0.8);
      const rsSetting = String(node.data && node.data.returnseq || "auto");
      const returnSeq = rsSetting === "true" ? true : (rsSetting === "false" ? false : laterHasRecurrent);
      if (node.name === "rnn_layer") {
        return tf.layers.simpleRNN({
          units: units,
          returnSequences: returnSeq,
          dropout: dropout,
          recurrentInitializer: "glorotUniform",
        }).apply(inTensor);
      }
      if (node.name === "gru_layer") {
        return tf.layers.gru({
          units: units,
          returnSequences: returnSeq,
          dropout: dropout,
          recurrentInitializer: "glorotUniform",
        }).apply(inTensor);
      }
      return tf.layers.lstm({
        units: units,
        returnSequences: returnSeq,
        dropout: dropout,
        recurrentInitializer: "glorotUniform",
      }).apply(inTensor);
    }
    if (node.name === "latent_layer" || node.name === "latent_mu_layer" || node.name === "latent_logvar_layer") {
      const units = Math.max(2, Number(node.data && node.data.units || 16));
      return tf.layers.dense({ units: units, activation: "linear" }).apply(inTensor);
    }
    if (node.name === "reparam_layer") {
      throw new Error("Reparam node is handled as a special two-input op.");
    }
    if (node.name === "concat_block") {
      return inTensor;
    }
    throw new Error("Unsupported node type in headless model path: " + String(node.name || ""));
  }

  const tensorById = {};
  tensorById[inputId] = inputTensor;
  const outTensors = [];
  const headConfigs = [];
  const latentGroups = {};
  const vaeKLGroups = {};

  for (let ti = 0; ti < reach.topo.length; ti += 1) {
    const id = reach.topo[ti];
    if (id === inputId) continue;
    const node = moduleData[id];
    if (!node) continue;
    const ins = getIncoming(moduleData, id).filter(function (edge) { return reach.reachableIds.indexOf(edge.from) >= 0; });
    if (!ins.length) continue;
    const incomingTensors = ins.map(function (edge) { return tensorById[edge.from]; }).filter(Boolean);
    if (!incomingTensors.length) continue;
    let inTensor = incomingTensors[0];
    if (incomingTensors.length > 1) {
      if (node.name !== "concat_block" && node.name !== "reparam_layer") {
        throw new Error("Node '" + String(node.name) + "' has multiple inputs but is not Concat/Reparam.");
      }
      if (node.name === "concat_block") {
        inTensor = tf.layers.concatenate({ axis: -1 }).apply(incomingTensors);
      }
    }

    if (node.name === "output_layer") {
      const data = node.data || {};
      const targets = outputTargetsFromNodeData(data, schemaId, "x");
      const lossName = normalizeHeadLossType(data.loss, targets);
      const fromLogits = shouldUseFromLogits(data.fromLogits, targets, lossName);
      const paramsSelect = String(data.paramsSelect || "");
      const headMatchWeight = requiredNonNegativeNumber(data, "matchWeight", "output_layer", id);
      const inForHead = (inTensor.shape && inTensor.shape.length === 3)
        ? tf.layers.globalAveragePooling1d().apply(inTensor)
        : inTensor;
      const generated = [];
      targets.forEach(function (target, targetIdx) {
        const units = targetUnitsFromMode(target, datasetMeta, data);
        const headTensor = tf.layers.dense({ units: units, activation: "linear" }).apply(inForHead);
        outTensors.push(headTensor);
        generated.push(headTensor);
        headConfigs.push({
          id: String(id) + ":" + String(target) + ":" + String(targetIdx + 1),
          nodeId: String(id),
          target: target,
          targetType: target,
          paramsSelect: paramsSelect,
          units: units,
          loss: lossName,
          fromLogits: fromLogits,
          wx: Math.max(0, Number(data.wx || 1)),
          wv: Math.max(0, Number(data.wv || 1)),
          matchWeight: headMatchWeight,
        });
      });
      tensorById[id] = generated[0];
    } else {
      const laterHasRecurrent = reach.topo.slice(ti + 1).some(function (nid) {
        const nm = moduleData[nid] && moduleData[nid].name;
        return nm === "rnn_layer" || nm === "gru_layer" || nm === "lstm_layer" || nm === "conv1d_layer";
      });
      let out;
      if (node.name === "reparam_layer") {
        if (incomingTensors.length !== 2) {
          throw new Error("Reparam node requires exactly 2 inputs: μ then logσ².");
        }
        const muTensor = incomingTensors[0];
        const logvarTensor = incomingTensors[1];
        out = new ReparameterizeLayer({}).apply([muTensor, logvarTensor]);
        const data = node.data || {};
        const group = requiredNonEmptyString(data, "group", "reparam_layer", id);
        const beta = requiredNonNegativeNumber(data, "beta", "reparam_layer", id);
        const matchWeight = requiredNonNegativeNumber(data, "matchWeight", "reparam_layer", id);
        if (!vaeKLGroups[group]) vaeKLGroups[group] = [];
        vaeKLGroups[group].push({
          id: String(id),
          mu: muTensor,
          logvar: logvarTensor,
          beta: beta,
          matchWeight: matchWeight,
          units: Math.max(2, Number(out.shape && out.shape[out.shape.length - 1] || 2)),
        });
      } else {
        out = applyNodeOp(node, inTensor, laterHasRecurrent);
      }
      tensorById[id] = out;
      if (node.name === "latent_layer" || node.name === "latent_mu_layer" || node.name === "latent_logvar_layer") {
        const data = node.data || {};
        const latentType = String(node.name || "latent_layer");
        const group = requiredNonEmptyString(data, "group", latentType, id);
        const groupKey = group + "::" + latentType;
        const matchWeight = requiredNonNegativeNumber(data, "matchWeight", latentType, id);
        if (!latentGroups[groupKey]) latentGroups[groupKey] = [];
        latentGroups[groupKey].push({
          id: String(id),
          group: group,
          latentType: latentType,
          tensor: out,
          units: Math.max(2, Number(data.units || 16)),
          matchWeight: matchWeight,
        });
      }
    }
  }

  Object.keys(latentGroups).forEach(function (groupKey) {
    const items = latentGroups[groupKey] || [];
    if (items.length < 2) return;
    const ref = items[0];
    for (let i = 1; i < items.length; i += 1) {
      const it = items[i];
      if (Number(ref.units) !== Number(it.units)) {
        throw new Error("Latent group '" + ref.group + "' (" + ref.latentType + ") units mismatch (" + ref.units + " vs " + it.units + ").");
      }
      const diff = tf.layers.subtract().apply([ref.tensor, it.tensor]);
      outTensors.push(diff);
      headConfigs.push({
        id: "latent_diff:" + ref.group + ":" + ref.latentType + ":" + String(i),
        target: "latent_diff",
        targetType: "latent_diff",
        units: Number(ref.units),
        loss: "mse",
        fromLogits: false,
        wx: 1,
        wv: 1,
        matchWeight: Math.max(0, Number((ref.matchWeight + it.matchWeight) / 2 || 1)),
      });
    }
  });

  Object.keys(vaeKLGroups).forEach(function (group) {
    const items = vaeKLGroups[group] || [];
    items.forEach(function (it, idx) {
      const klTensor = tf.layers.concatenate({ axis: -1 }).apply([it.mu, it.logvar]);
      outTensors.push(klTensor);
      headConfigs.push({
        id: "latent_kl:" + group + ":" + String(idx + 1),
        target: "latent_kl",
        targetType: "latent_kl",
        units: Math.max(2, Number(it.units || 2)) * 2,
        loss: "mse",
        fromLogits: false,
        wx: 1,
        wv: 1,
        matchWeight: Math.max(0, Number(it.matchWeight || 1)),
        beta: Math.max(0, Number(it.beta || 1e-3)),
      });
    });
  });

  if (!outTensors.length) {
    throw new Error("No valid output heads were built from graph.");
  }
  return {
    model: tf.model({
      inputs: inputTensor,
      outputs: outTensors.length === 1 ? outTensors[0] : outTensors,
    }),
    isSequence: isSequence,
    headConfigs: headConfigs,
  };
}

function oneHotRows(labels, classCount) {
  return (Array.isArray(labels) ? labels : []).map(function (label) {
    const idx = Math.max(0, Math.min(classCount - 1, Math.round(Number(label) || 0)));
    const row = new Array(classCount).fill(0);
    row[idx] = 1;
    return row;
  });
}

function createOptimizerByType(tf, type, lr) {
  const v = String(type || "adam").toLowerCase().trim();
  const learningRate = Math.max(1e-8, Number(lr) || 1e-3);
  if (v === "sgd") return tf.train.sgd(learningRate);
  if (v === "momentum" || v === "nesterov") return tf.train.momentum(learningRate, 0.9, true);
  if (v === "rmsprop") return tf.train.rmsprop(learningRate);
  if (v === "adadelta") return tf.train.adadelta(learningRate);
  if (v === "adagrad") return tf.train.adagrad(learningRate);
  if (v === "adamax") return tf.train.adamax(learningRate);
  return tf.train.adam(learningRate);
}

function applyGradClip(tf, optimizer, gradClipNorm, gradClipValue) {
  if (gradClipNorm <= 0 && gradClipValue <= 0) return;
  const originalApplyGradients = optimizer.applyGradients.bind(optimizer);
  optimizer.applyGradients = function (variableGradients) {
    const isArray = Array.isArray(variableGradients);
    const names = [];
    const grads = [];
    if (isArray) {
      variableGradients.forEach(function (entry) {
        if (!entry || !entry.tensor) return;
        names.push(String(entry.name || ""));
        grads.push(entry.tensor);
      });
    } else if (variableGradients && typeof variableGradients === "object") {
      Object.keys(variableGradients).forEach(function (name) {
        const tensor = variableGradients[name];
        if (!tensor) return;
        names.push(String(name || ""));
        grads.push(tensor);
      });
    } else {
      return originalApplyGradients(variableGradients);
    }
    if (!grads.length) return originalApplyGradients(variableGradients);
    let clipped = grads;
    let needsDispose = false;
    if (gradClipNorm > 0) {
      const pair = tf.clipByGlobalNorm(clipped, gradClipNorm);
      clipped = pair[0];
      needsDispose = true;
      if (pair[1] && typeof pair[1].dispose === "function") pair[1].dispose();
    }
    if (gradClipValue > 0) {
      const next = clipped.map(function (g) {
        return tf.clipByValue(g, -gradClipValue, gradClipValue);
      });
      if (needsDispose) tf.dispose(clipped);
      clipped = next;
      needsDispose = true;
    }
    const applyArg = isArray
      ? names.map(function (name, idx) { return { name: name, tensor: clipped[idx] }; })
      : (function () {
        const out = {};
        names.forEach(function (name, idx) {
          out[name] = clipped[idx];
        });
        return out;
      })();
    try {
      return originalApplyGradients(applyArg);
    } finally {
      if (needsDispose) tf.dispose(clipped);
    }
  };
}

function createHeadLoss(tf, head, preparedDataset) {
  const target = String((head && head.target) || "x");
  const lossType = normalizeHeadLossType(head && head.loss, [target]);
  const matchWeight = Math.max(0, Number((head && head.matchWeight) || 1));
  const fromLogits = Boolean(head && head.fromLogits);
  const wx = Math.max(0, Number((head && head.wx) || 1));
  const wv = Math.max(0, Number((head && head.wv) || 1));
  const klBeta = Math.max(0, Number((head && head.beta) || 1e-3));

  function reduceClassificationLoss(yTrue, yPred, useCategorical) {
    return tf.tidy(function () {
      const oneHot = useCategorical
        ? yTrue
        : (yTrue.rank === 1 ? tf.oneHot(yTrue.toInt(), preparedDataset.classCount) : yTrue);
      const logits = yPred;
      let logProb;
      if (fromLogits) {
        logProb = tf.logSoftmax(logits);
      } else {
        const clipped = tf.clipByValue(logits, 1e-7, 1);
        logProb = tf.log(clipped);
      }
      const per = tf.neg(tf.sum(tf.mul(oneHot, logProb), -1));
      return tf.mul(tf.scalar(matchWeight), tf.mean(per));
    });
  }

  function scalarLoss(pred, truth, type) {
    if (type === "mae") return tf.mean(tf.abs(tf.sub(pred, truth)));
    if (type === "huber") {
      const delta = tf.scalar(1.0);
      const err = tf.sub(pred, truth);
      const absErr = tf.abs(err);
      const quadratic = tf.minimum(absErr, delta);
      const linear = tf.sub(absErr, quadratic);
      return tf.mean(tf.add(tf.mul(0.5, tf.square(quadratic)), tf.mul(delta, linear)));
    }
    return tf.mean(tf.square(tf.sub(pred, truth)));
  }

  if (target === "label" || target === "logits") {
    const useCategorical = lossType === "categorical_cross_entropy";
    return function (yTrue, yPred) {
      return reduceClassificationLoss(yTrue, yPred, useCategorical);
    };
  }
  if (target === "latent_kl") {
    return function (_yTrue, yPred) {
      return tf.tidy(function () {
        const total = Math.max(2, Number((head && head.units) || (yPred.shape && yPred.shape[1]) || 2));
        const zDim = Math.max(1, Math.floor(total / 2));
        const mu = yPred.slice([0, 0], [-1, zDim]);
        const logvar = tf.clipByValue(yPred.slice([0, zDim], [-1, zDim]), -10, 10);
        const one = tf.onesLike(logvar);
        const klTerm = tf.sub(tf.add(one, logvar), tf.add(tf.square(mu), tf.exp(logvar)));
        const kl = tf.mul(tf.scalar(-0.5), tf.mean(tf.sum(klTerm, -1)));
        return tf.mul(tf.scalar(matchWeight * klBeta), kl);
      });
    };
  }
  return function (yTrue, yPred) {
    return tf.tidy(function () {
      if (target !== "xv") {
        return tf.mul(tf.scalar(matchWeight), scalarLoss(yPred, yTrue, lossType));
      }
      const wsum = Math.max(1e-9, wx + wv);
      const nx = wx / wsum;
      const nv = wv / wsum;
      const tx = yTrue.slice([0, 0], [-1, 1]);
      const tv = yTrue.slice([0, 1], [-1, 1]);
      const px = yPred.slice([0, 0], [-1, 1]);
      const pv = yPred.slice([0, 1], [-1, 1]);
      const lx = scalarLoss(px, tx, lossType);
      const lv = scalarLoss(pv, tv, lossType);
      const value = tf.add(tf.mul(tf.scalar(nx), lx), tf.mul(tf.scalar(nv), lv));
      return tf.mul(tf.scalar(matchWeight), value);
    });
  };
}

async function saveModelArtifacts(tf, model) {
  var captured = null;
  await model.save(tf.io.withSaveHandler(async function (artifacts) {
    captured = artifacts;
    return {
      modelArtifactsInfo: tf.io && typeof tf.io.getModelArtifactsInfoForJSON === "function"
        ? tf.io.getModelArtifactsInfoForJSON(artifacts)
        : {
          dateSaved: new Date(),
          modelTopologyType: artifacts && artifacts.modelTopology ? "JSON" : "Unknown",
          modelTopologyBytes: 0,
          weightSpecsBytes: 0,
          weightDataBytes: artifacts && artifacts.weightData ? artifacts.weightData.byteLength || 0 : 0,
        },
    };
  }));
  return captured;
}

function buildHistoryRows(history) {
  return {
    epoch: history.epoch.slice(),
    loss: history.loss.slice(),
    train_loss: history.loss.slice(),
    val_loss: history.val_loss.slice(),
    lr: history.lr.slice(),
  };
}

function parseAccuracy(tf, yTrueTensor, yPredTensor) {
  return tf.tidy(function () {
    const trueIdx = tf.argMax(yTrueTensor, -1);
    const predIdx = tf.argMax(yPredTensor, -1);
    const acc = tf.mean(tf.cast(tf.equal(trueIdx, predIdx), "float32"));
    const value = Number(acc.dataSync()[0] || 0);
    trueIdx.dispose();
    predIdx.dispose();
    return value;
  });
}

function computeRegressionMetrics(tf, yTrueTensor, yPredTensor) {
  const mse = Number(tf.losses.meanSquaredError(yTrueTensor, yPredTensor).dataSync()[0] || 0);
  const mae = Number(tf.metrics.meanAbsoluteError(yTrueTensor, yPredTensor).dataSync()[0] || 0);
  return { mse: mse, mae: mae };
}

async function runTrainer(rawCtx) {
  const ctx = rawCtx || {};
  const tf = loadTfjs();
  await tf.ready();
  const modelRef = ctx.model || null;
  const datasetRef = ctx.dataset || null;
  if (!modelRef || !datasetRef) {
    throw new Error("tfjs headless trainer requires model and dataset.");
  }
  const schemaId = resolveSchemaId(modelRef.schemaId || datasetRef.schemaId || ctx.schemaId || "fashion_mnist");
  const preparedDataset = normalizeImageDataset(datasetRef, schemaId);
  const built = buildModelFromDrawflowGraph(modelRef.drawflowGraph || modelRef.drawflow || modelRef.graph || {}, preparedDataset, schemaId);
  const model = built.model;
  const headConfigs = built.headConfigs;
  if (!headConfigs.length) {
    throw new Error("No output heads were produced for tfjs training.");
  }

  const trainCfg = Object.assign({}, ctx.trainCfg || {});
  const requestedLr = Math.max(1e-8, Number(trainCfg.learningRate || 1e-3));
  const optimizer = createOptimizerByType(tf, trainCfg.optimizerType || "adam", requestedLr);
  const gradClipNorm = Math.max(0, Number(trainCfg.gradClipNorm || 0));
  const gradClipValue = Math.max(0, Number(trainCfg.gradClipValue || 0));
  applyGradClip(tf, optimizer, gradClipNorm, gradClipValue);

  const xTrain = built.isSequence
    ? tf.tensor3d(preparedDataset.seqTrain || [])
    : tf.tensor2d(preparedDataset.xTrain, [preparedDataset.xTrain.length, preparedDataset.featureSize]);
  const xVal = built.isSequence
    ? tf.tensor3d(preparedDataset.seqVal || [])
    : tf.tensor2d(preparedDataset.xVal, [preparedDataset.xVal.length, preparedDataset.featureSize]);
  const xTest = built.isSequence
    ? tf.tensor3d(preparedDataset.seqTest || [])
    : tf.tensor2d(preparedDataset.xTest, [preparedDataset.xTest.length, preparedDataset.featureSize]);

  const yTrainRows = oneHotRows(preparedDataset.yTrainLabels, preparedDataset.classCount);
  const yValRows = oneHotRows(preparedDataset.yValLabels, preparedDataset.classCount);
  const yTestRows = oneHotRows(preparedDataset.yTestLabels, preparedDataset.classCount);
  const yTrain = tf.tensor2d(yTrainRows, [yTrainRows.length, preparedDataset.classCount]);
  const yVal = tf.tensor2d(yValRows, [yValRows.length, preparedDataset.classCount]);
  const yTest = tf.tensor2d(yTestRows, [yTestRows.length, preparedDataset.classCount]);

  const singleHead = headConfigs.length === 1;
  const losses = headConfigs.map(function (head) {
    return createHeadLoss(tf, head, preparedDataset);
  });
  model.compile({
    optimizer: optimizer,
    loss: singleHead ? losses[0] : losses,
  });

  const lrSchedulerType = String(trainCfg.lrSchedulerType || "plateau").trim().toLowerCase();
  const useLrScheduler = trainCfg.useLrScheduler !== false && lrSchedulerType !== "none";
  const lrPatience = Math.max(1, Number(trainCfg.lrPatience || 3));
  const lrFactor = clamp(trainCfg.lrFactor || 0.5, 0.05, 0.99);
  const minLr = Math.max(1e-8, Number(trainCfg.minLr || 1e-6));
  const restoreBestWeights = trainCfg.restoreBestWeights !== false;
  const earlyStoppingPatience = Math.max(0, Number(trainCfg.earlyStoppingPatience || 0));
  let currentLr = requestedLr;
  let bestValLoss = Number.POSITIVE_INFINITY;
  let bestEpoch = -1;
  let bestWeights = null;
  let staleCount = 0;
  let lrStaleCount = 0;
  let stoppedEarly = false;

  function disposeTensorArray(arr) {
    if (!Array.isArray(arr)) return;
    arr.forEach(function (tensor) {
      try {
        if (tensor && typeof tensor.dispose === "function") tensor.dispose();
      } catch (_) {}
    });
  }

  function trySetLearningRate(nextLr) {
    const value = Math.max(minLr, Number(nextLr) || currentLr);
    currentLr = value;
    try {
      if (model && model.optimizer && typeof model.optimizer.setLearningRate === "function") {
        model.optimizer.setLearningRate(value);
        return true;
      }
    } catch (_) {}
    try {
      if (model && model.optimizer) {
        model.optimizer.learningRate = value;
        return true;
      }
    } catch (_) {}
    return false;
  }

  const history = { epoch: [], loss: [], val_loss: [], lr: [] };
  await model.fit(xTrain, singleHead ? yTrain : [yTrain], {
    epochs: Math.max(1, Number(trainCfg.epochs || 1)),
    batchSize: Math.max(1, Number(trainCfg.batchSize || 32)),
    validationData: [xVal, singleHead ? yVal : [yVal]],
    callbacks: [{
      onEpochEnd: function (epoch, logs) {
        logs = logs || {};
        const valLoss = Number(logs.val_loss);
        const trainLoss = Number(logs.loss);
        const metricForBest = Number.isFinite(valLoss) ? valLoss : trainLoss;
        let improved = false;
        if (Number.isFinite(metricForBest) && metricForBest < bestValLoss) {
          improved = true;
          bestValLoss = metricForBest;
          bestEpoch = epoch + 1;
          if (restoreBestWeights) {
            const nextWeights = model.getWeights().map(function (w) { return w.clone(); });
            disposeTensorArray(bestWeights);
            bestWeights = nextWeights;
          }
          staleCount = 0;
          lrStaleCount = 0;
        } else {
          staleCount += 1;
          lrStaleCount += 1;
        }
        if (useLrScheduler) {
          if (lrSchedulerType === "plateau") {
            if (lrStaleCount >= lrPatience && currentLr > minLr) {
              const next = Math.max(minLr, currentLr * lrFactor);
              if (next < currentLr - 1e-12) trySetLearningRate(next);
              lrStaleCount = 0;
            }
          } else if (lrSchedulerType === "step") {
            const epoch1 = epoch + 1;
            if (epoch1 > 0 && epoch1 % Math.max(1, lrPatience) === 0 && currentLr > minLr) {
              const next = Math.max(minLr, currentLr * lrFactor);
              if (next < currentLr - 1e-12) trySetLearningRate(next);
            }
          } else if (lrSchedulerType === "exponential") {
            const next = Math.max(minLr, currentLr * lrFactor);
            if (next < currentLr - 1e-12) trySetLearningRate(next);
          } else if (lrSchedulerType === "cosine") {
            const totalEpochs = Math.max(1, Number(trainCfg.epochs || 1));
            const progress = Math.min(1, Math.max(0, (epoch + 1) / totalEpochs));
            const cosine = 0.5 * (1 + Math.cos(Math.PI * progress));
            const next = Math.max(minLr, minLr + (requestedLr - minLr) * cosine);
            trySetLearningRate(next);
          }
        }
        if (earlyStoppingPatience > 0 && staleCount >= earlyStoppingPatience) {
          stoppedEarly = true;
          try { model.stopTraining = true; } catch (_) {}
        }
        history.epoch.push(epoch + 1);
        history.loss.push(trainLoss);
        history.val_loss.push(valLoss);
        history.lr.push(currentLr);
      },
    }],
  });

  if (restoreBestWeights && Array.isArray(bestWeights) && bestWeights.length) {
    try { model.setWeights(bestWeights); } catch (_) {}
  }

  const predValRaw = model.predict(xVal);
  const predTestRaw = model.predict(xTest);
  const predVal = Array.isArray(predValRaw) ? predValRaw[0] : predValRaw;
  const predTest = Array.isArray(predTestRaw) ? predTestRaw[0] : predTestRaw;
  const valLossTensor = losses[0](yVal, predVal);
  const testLossTensor = losses[0](yTest, predTest);
  const valLossFinal = Number(valLossTensor.dataSync()[0] || 0);
  const testLossFinal = Number(testLossTensor.dataSync()[0] || 0);
  const valAccuracy = parseAccuracy(tf, yVal, predVal);
  const testAccuracy = parseAccuracy(tf, yTest, predTest);
  const regVal = computeRegressionMetrics(tf, yVal, predVal);
  const regTest = computeRegressionMetrics(tf, yTest, predTest);
  valLossTensor.dispose();
  testLossTensor.dispose();

  const modelArtifacts = await saveModelArtifacts(tf, model);
  const historyOut = buildHistoryRows(history);

  const disposeList = [xTrain, xVal, xTest, yTrain, yVal, yTest, predVal, predTest];
  tf.dispose(disposeList);
  disposeTensorArray(bestWeights);
  model.dispose();

  return {
    runtimeFamily: "tfjs",
    schemaId: schemaId,
    generatedBy: "tfjs_headless_core",
    isSequence: built.isSequence,
    headConfigs: clone(headConfigs),
    preparedDatasetMeta: {
      sampleType: preparedDataset.sampleType,
      featureSize: preparedDataset.featureSize,
      classCount: preparedDataset.classCount,
      imageShape: preparedDataset.imageShape.slice(),
      splitCounts: {
        train: preparedDataset.xTrain.length,
        val: preparedDataset.xVal.length,
        test: preparedDataset.xTest.length,
      },
    },
    history: historyOut,
    metrics: {
      mse: regVal.mse,
      mae: regVal.mae,
      testMse: regTest.mse,
      testMae: regTest.mae,
      valLoss: valLossFinal,
      testLoss: testLossFinal,
      valAccuracy: valAccuracy,
      testAccuracy: testAccuracy,
      accuracy: testAccuracy,
      headCount: headConfigs.length,
      bestEpoch: bestEpoch > 0 ? bestEpoch : null,
      bestValLoss: Number.isFinite(bestValLoss) ? bestValLoss : null,
      finalLr: currentLr,
      stoppedEarly: stoppedEarly,
    },
    modelArtifacts: modelArtifacts,
  };
}

module.exports = {
  normalizeOutputTargetsList,
  outputTargetsFromNodeData,
  buildModelFromDrawflowGraph,
  runTrainer,
};

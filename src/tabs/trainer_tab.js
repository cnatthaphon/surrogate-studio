(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCTrainerTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(deps) {
    var layout = deps.layout;
    var stateApi = deps.stateApi;
    var store = deps.store;
    var schemaRegistry = deps.schemaRegistry;
    var trainingEngine = deps.trainingEngine;
    var modelBuilder = deps.modelBuilder;
    var uiEngine = deps.uiEngine;
    var modal = deps.modal;
    var predictionCore = deps.predictionCore;
    var onStatus = deps.onStatus || function () {};
    var el = deps.el || function (tag, a, c) {
      var e = document.createElement(tag);
      if (a) Object.keys(a).forEach(function (k) { if (k === "className") e.className = a[k]; else if (k === "textContent") e.textContent = a[k]; else e.setAttribute(k, a[k]); });
      if (c) (Array.isArray(c) ? c : [c]).forEach(function (ch) { if (typeof ch === "string") e.appendChild(document.createTextNode(ch)); else if (ch) e.appendChild(ch); });
      return e;
    };
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };
    var getTf = function () { var W = typeof window !== "undefined" ? window : {}; return W.tf || null; };
    var getCheckpointFormat = function () { var W = typeof window !== "undefined" ? window : {}; return W.OSCCheckpointFormatCore || null; };

    var _mountId = 0;
    var _configFormApi = null;
    var _isTraining = false;
    var _isNotebookPreparing = false;
    var _trainingRunId = 0; // increments on each training start — old runs detect new run and stop
    var _activeModel = null; // reference to model during training (for weight save on stop)
    var _activeTrainingCancel = null; // best-effort cancel for worker/server runs
    var _stopRequestedTrainingId = "";
    var _stopRequestedRunId = 0;

    function _extractWeightsFromModel(tfModel) {
      var allW = tfModel.getWeights();
      var weightMeta = tfModel.weights || [];
      var totalBytes = 0;
      var specs = allW.map(function (w, i) {
        var shape = w.shape;
        var size = shape.reduce(function (a, b) { return a * b; }, 1);
        var wName = (weightMeta[i] && weightMeta[i].name) || ("w" + i);
        var spec = { name: wName, shape: shape, dtype: "float32", offset: totalBytes };
        totalBytes += size * 4;
        return spec;
      });
      var buffer = new ArrayBuffer(totalBytes);
      var offset = 0;
      allW.forEach(function (w) {
        var data = w.dataSync();
        new Float32Array(buffer, offset, data.length).set(data);
        offset += data.length * 4;
      });
      var artifacts = { weightSpecs: specs, weightValues: Array.from(new Float32Array(buffer)) };
      var fmt = getCheckpointFormat();
      if (fmt && typeof fmt.normalizeArtifacts === "function") {
        return fmt.normalizeArtifacts(artifacts, { producerRuntime: "js_client" });
      }
      return artifacts;
    }

    function _normalizeCheckpointArtifacts(artifacts, producerRuntime) {
      if (!artifacts) return null;
      var fmt = getCheckpointFormat();
      if (fmt && typeof fmt.normalizeArtifacts === "function") {
        return fmt.normalizeArtifacts(artifacts, { producerRuntime: String(producerRuntime || "") });
      }
      return artifacts;
    }

    function _describeCheckpointArtifacts(artifacts, producerRuntime) {
      if (!artifacts) return null;
      var fmt = getCheckpointFormat();
      if (fmt && typeof fmt.describeArtifacts === "function") {
        return fmt.describeArtifacts(artifacts, { producerRuntime: String(producerRuntime || "") });
      }
      return null;
    }

    function _resolveArtifactProducerRuntime(tCard, artifacts) {
      var checkpoint = artifacts && artifacts.checkpoint && typeof artifacts.checkpoint === "object" ? artifacts.checkpoint : null;
      if (checkpoint && checkpoint.producerRuntime) return String(checkpoint.producerRuntime);
      if (tCard && tCard.checkpoint && tCard.checkpoint.producerRuntime) return String(tCard.checkpoint.producerRuntime);
      if (tCard && tCard.trainedOnServer) return "python_server";
      return "js_client";
    }

    function _getResumeArtifacts(tCard) {
      if (!tCard) return null;
      var artifacts = tCard.modelArtifactsLast || tCard.modelArtifacts || null;
      if (!artifacts) return null;
      return _normalizeCheckpointArtifacts(artifacts, _resolveArtifactProducerRuntime(tCard, artifacts));
    }

    function _getCheckpointRef(artifacts) {
      var checkpoint = artifacts && artifacts.checkpoint && typeof artifacts.checkpoint === "object" ? artifacts.checkpoint : null;
      return String((checkpoint && checkpoint.checkpointRef) || (artifacts && artifacts.checkpointRef) || "").trim();
    }

    function _loadArtifactsIntoTfModel(tf, model, artifacts) {
      if (!tf || !model || !artifacts) return { loaded: false, reason: "missing_inputs" };
      var W = typeof window !== "undefined" ? window : {};
      var converter = W.OSCWeightConverter;
      if (!converter || typeof converter.loadArtifactsIntoModel !== "function") {
        return { loaded: false, reason: "converter_unavailable" };
      }
      return converter.loadArtifactsIntoModel(tf, model, artifacts);
    }

    function _sampleArrayEvenly(arr, count) {
      var src = Array.isArray(arr) ? arr : [];
      var n = src.length;
      var need = Math.max(0, Math.floor(Number(count) || 0));
      if (!n || need <= 0) return [];
      if (need >= n) return src.slice();
      if (need === 1) return [src[0]];
      var out = [];
      for (var i = 0; i < need; i += 1) {
        var idx = Math.round(i * (n - 1) / (need - 1));
        out.push(src[idx]);
      }
      return out;
    }

    function _limitNotebookDatasetRows(ds, maxRows) {
      var limit = Math.max(0, Math.floor(Number(maxRows) || 0));
      if (!ds || typeof ds !== "object" || !limit) return { dataset: ds, truncated: false, totalRows: 0, keptRows: 0 };

      function _allocate(counts, cap) {
        var total = (counts.train || 0) + (counts.val || 0) + (counts.test || 0);
        if (!total || total <= cap) return { train: counts.train || 0, val: counts.val || 0, test: counts.test || 0, total: total };
        var raw = {
          train: total ? ((counts.train || 0) / total) * cap : 0,
          val: total ? ((counts.val || 0) / total) * cap : 0,
          test: total ? ((counts.test || 0) / total) * cap : 0,
        };
        var alloc = { train: Math.floor(raw.train), val: Math.floor(raw.val), test: Math.floor(raw.test) };
        ["train", "val", "test"].forEach(function (split) {
          if ((counts[split] || 0) > 0 && alloc[split] < 1) alloc[split] = 1;
          if (alloc[split] > (counts[split] || 0)) alloc[split] = counts[split] || 0;
        });
        var used = alloc.train + alloc.val + alloc.test;
        while (used > cap) {
          var reduced = false;
          ["train", "val", "test"].forEach(function (split) {
            if (!reduced && used > cap && alloc[split] > 1) {
              alloc[split] -= 1;
              used -= 1;
              reduced = true;
            }
          });
          if (!reduced) break;
        }
        var order = ["train", "val", "test"].map(function (split) {
          return { split: split, frac: raw[split] - Math.floor(raw[split]) };
        }).sort(function (a, b) { return b.frac - a.frac; });
        while (used < cap) {
          var added = false;
          for (var i = 0; i < order.length && used < cap; i += 1) {
            var split = order[i].split;
            if (alloc[split] < (counts[split] || 0)) {
              alloc[split] += 1;
              used += 1;
              added = true;
            }
          }
          if (!added) break;
        }
        alloc.total = total;
        return alloc;
      }

      if (ds.records && typeof ds.records === "object") {
        var recordCounts = ["train", "val", "test"].reduce(function (acc, split) {
          var rec = ds.records[split] || {};
          acc[split] = Array.isArray(rec.x) ? rec.x.length : 0;
          return acc;
        }, { train: 0, val: 0, test: 0 });
        var recordTotal = recordCounts.train + recordCounts.val + recordCounts.test;
        if (!recordTotal || recordTotal <= limit) return { dataset: ds, truncated: false, totalRows: recordTotal, keptRows: recordTotal };
        var recordAlloc = _allocate(recordCounts, limit);
        var nextRecords = {};
        ["train", "val", "test"].forEach(function (split) {
          var rec = ds.records[split] || {};
          var keep = recordAlloc[split] || 0;
          nextRecords[split] = Object.assign({}, rec, {
            x: _sampleArrayEvenly(rec.x, keep),
            y: _sampleArrayEvenly(rec.y, keep),
          });
        });
        return {
          dataset: Object.assign({}, ds, { records: nextRecords }),
          truncated: true,
          totalRows: recordTotal,
          keptRows: (recordAlloc.train || 0) + (recordAlloc.val || 0) + (recordAlloc.test || 0),
        };
      }

      if (Array.isArray(ds.xTrain) || Array.isArray(ds.xVal) || Array.isArray(ds.xTest)) {
        var arrayCounts = {
          train: Array.isArray(ds.xTrain) ? ds.xTrain.length : 0,
          val: Array.isArray(ds.xVal) ? ds.xVal.length : 0,
          test: Array.isArray(ds.xTest) ? ds.xTest.length : 0,
        };
        var total = arrayCounts.train + arrayCounts.val + arrayCounts.test;
        if (!total || total <= limit) return { dataset: ds, truncated: false, totalRows: total, keptRows: total };
        var alloc = _allocate(arrayCounts, limit);
        return {
          dataset: Object.assign({}, ds, {
            xTrain: _sampleArrayEvenly(ds.xTrain, alloc.train),
            yTrain: _sampleArrayEvenly(ds.yTrain, alloc.train),
            xVal: _sampleArrayEvenly(ds.xVal, alloc.val),
            yVal: _sampleArrayEvenly(ds.yVal, alloc.val),
            xTest: _sampleArrayEvenly(ds.xTest, alloc.test),
            yTest: _sampleArrayEvenly(ds.yTest, alloc.test),
          }),
          truncated: true,
          totalRows: total,
          keptRows: (alloc.train || 0) + (alloc.val || 0) + (alloc.test || 0),
        };
      }

      return { dataset: ds, truncated: false, totalRows: 0, keptRows: 0 };
    }

    function _prepareDatasetForNotebookExport(ds, W) {
      if (!ds || typeof ds !== "object") return { dataset: ds, usesServerReference: false };
      var win = W || (typeof window !== "undefined" ? window : {});
      var sourceDescriptorHelper = win.OSCDatasetSourceDescriptor || null;
      var normalizedSourceDescriptor = sourceDescriptorHelper && typeof sourceDescriptorHelper.normalize === "function"
        ? sourceDescriptorHelper.normalize(ds.sourceDescriptor)
        : (ds.sourceDescriptor ? ds.sourceDescriptor : null);
      var usesServerReference = !!(normalizedSourceDescriptor && sourceDescriptorHelper && typeof sourceDescriptorHelper.shouldUseServerReference === "function"
        ? sourceDescriptorHelper.shouldUseServerReference(normalizedSourceDescriptor)
        : normalizedSourceDescriptor);
      var nextDs = Object.assign({}, ds);
      if (normalizedSourceDescriptor) nextDs.sourceDescriptor = normalizedSourceDescriptor;
      if (usesServerReference) return { dataset: nextDs, usesServerReference: true };

      var srcReg = win.OSCDatasetSourceRegistry || null;
      if (nextDs.sourceId && srcReg && typeof srcReg.resolveDatasetSplit === "function") {
        var train = srcReg.resolveDatasetSplit(nextDs, "train");
        var val = srcReg.resolveDatasetSplit(nextDs, "val");
        var test = srcReg.resolveDatasetSplit(nextDs, "test");
        nextDs.records = {
          train: { x: train.x, y: train.y },
          val: { x: val.x, y: val.y },
          test: { x: test.x, y: test.y },
        };
      }
      return { dataset: nextDs, usesServerReference: false };
    }
    function _inferTrainerFamily(tCard) {
      if (!tCard || !store || !modelBuilder) return "supervised";
      var modelRec = store.getModel(tCard.modelId);
      if (!modelRec || !modelRec.graph || typeof modelBuilder.inferModelFamily !== "function") return "supervised";
      return String(modelBuilder.inferModelFamily(modelRec.graph) || "supervised");
    }
    var _activeTrainingId = ""; // which trainer is currently being trained
    var _lossChartDiv = null;
    var _epochTableBody = null;
    var _subTab = "train"; // "train" | "test"
    var _testCache = {}; // { trainerId: { preds, ySlice, testN, featureSize, nCls, isClassification, ... } }

    function _resolveBackendLabel(t) {
      if (t.backend) return String(t.backend);
      var arts = t.modelArtifacts || t.modelArtifactsLast || t.modelArtifactsBest || null;
      var runtime = arts && (arts.producerRuntime || (arts.checkpoint && arts.checkpoint.producerRuntime)) || "";
      if (/python|pytorch|server/i.test(runtime)) return "PyTorch";
      if (/js|tfjs|client/i.test(runtime)) return "TF.js";
      if (t.trainedOnServer || (t.config && t.config.useServer)) return "PyTorch (server)";
      return "";
    }

    function _isCurrentTrainingRun(trainerId, runId) {
      return _activeTrainingId === trainerId && _trainingRunId === runId;
    }

    function _isTrainerTrainViewVisible(trainerId) {
      return !!(stateApi && stateApi.getActiveTrainer() === trainerId && _subTab === "train");
    }

    function _isStopRequestedRun(trainerId, runId) {
      return _stopRequestedTrainingId === trainerId && _stopRequestedRunId === runId;
    }

    function _appendTrainerEpochForRun(trainerId, runId, logEntry) {
      if (!_isCurrentTrainingRun(trainerId, runId)) return false;
      if (_isStopRequestedRun(trainerId, runId)) return false;
      if (store) store.appendTrainerEpoch(trainerId, logEntry);
      if (_isTrainerTrainViewVisible(trainerId)) {
        var epochs = store && typeof store.getTrainerEpochs === "function" ? store.getTrainerEpochs(trainerId) : [];
        if (_lossChartDiv) _plotLossChart(epochs);
        if (_epochTableBody) _appendEpochRow(logEntry);
      }
      return true;
    }

    function _getSchemaId() {
      var aid = stateApi ? stateApi.getActiveTrainer() : "";
      if (aid && store) { var t = store.getTrainerCard(aid); if (t && t.schemaId) return t.schemaId; }
      return stateApi ? stateApi.getActiveSchema() : "";
    }
    function _listTrainers() { return store && typeof store.listTrainerCards === "function" ? store.listTrainerCards({}) : []; }
    function _listDatasets(schemaId) {
      if (!store || typeof store.listDatasets !== "function") return [];
      return store.listDatasets({}).filter(function (d) { return !schemaId || d.schemaId === schemaId; })
        .sort(function (a, b) { return (a.status === "ready" ? 0 : 1) - (b.status === "ready" ? 0 : 1); });
    }
    function _listModels(schemaId) { return store && typeof store.listModels === "function" ? store.listModels({}).filter(function (m) { return !schemaId || m.schemaId === schemaId; }) : []; }

    var getServerAdapter = function () { var W = typeof window !== "undefined" ? window : {}; return W.OSCServerRuntimeAdapter || null; };
    var _serverAvailable = null; // null = unchecked, true/false = checked
    var _serverUrl = "";
    var _serverInfo = null; // { ok, backend, python, ... }

    // detect available backends
    function _getAvailableBackends() {
      var backends = [{ value: "auto", label: "Auto (best available)" }, { value: "cpu", label: "CPU" }];
      var tf = getTf();
      if (tf) {
        try { if (typeof tf.setBackend === "function") { backends.push({ value: "webgl", label: "WebGL (GPU)" }); } } catch (e) {}
        try {
          if (typeof window !== "undefined" && window.isSecureContext && typeof navigator !== "undefined" && navigator.gpu) {
            backends.push({ value: "webgpu", label: "WebGPU (experimental)" });
          }
        } catch (e2) {}
        try { backends.push({ value: "wasm", label: "WASM" }); } catch (e) {}
      }
      return backends;
    }

    function _normalizeClientBackendOrder(rawOrder) {
      var parts = Array.isArray(rawOrder) ? rawOrder.slice() : String(rawOrder || "").split(/[,\s]+/);
      var allowed = { webgl: true, webgpu: true, wasm: true, cpu: true };
      var seen = {};
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        var key = String(parts[i] || "").trim().toLowerCase();
        if (!allowed[key] || seen[key]) continue;
        seen[key] = true;
        out.push(key);
      }
      if (!out.length) return ["webgl", "webgpu", "wasm", "cpu"];
      if (!seen.cpu) out.push("cpu");
      return out;
    }

    function _getWorkerSupport() {
      var W = typeof window !== "undefined" ? window : {};
      var bridge = W.OSCTrainingWorkerBridge;
      var hasBridge = !!(bridge && typeof bridge.runTrainingInWorker === "function");
      var hasWorkerApi = typeof Worker !== "undefined";
      return {
        hasBridge: hasBridge,
        hasWorkerApi: hasWorkerApi,
        available: hasBridge && hasWorkerApi,
      };
    }

    function _resolveRestoreBestWeights(config, headConfigs) {
      var cfg = config && typeof config === "object" ? config : {};
      if (typeof cfg.restoreBestWeights === "boolean") return cfg.restoreBestWeights;
      var weightSelection = String(cfg.weightSelection || "").trim().toLowerCase();
      if (weightSelection === "last") return false;
      if (weightSelection === "best") return true;
      if (Array.isArray(cfg.trainingSchedule) && cfg.trainingSchedule.length) return false;
      var heads = Array.isArray(headConfigs) ? headConfigs : [];
      if (heads.some(function (h) { return String((h && h.phase) || "").trim() !== ""; })) return false;
      return true;
    }

    function _resolveWeightSelection(config, headConfigs) {
      var cfg = config && typeof config === "object" ? config : {};
      var weightSelection = String(cfg.weightSelection || "").trim().toLowerCase();
      if (weightSelection === "last" || weightSelection === "best") return weightSelection;
      if (Array.isArray(cfg.trainingSchedule) && cfg.trainingSchedule.length) return "last";
      var heads = Array.isArray(headConfigs) ? headConfigs : [];
      if (heads.some(function (h) { return String((h && h.phase) || "").trim() !== ""; })) return "last";
      return "best";
    }

    function _getClientBackendAvailability(tf) {
      var out = { cpu: true, webgl: false, webgpu: false, wasm: false };
      if (!tf) return out;
      try {
        if (typeof tf.findBackend === "function") {
          out.webgl = !!tf.findBackend("webgl");
          out.webgpu = !!tf.findBackend("webgpu");
          out.wasm = !!tf.findBackend("wasm");
        }
      } catch (_) {}
      try {
        if (tf.engine && typeof tf.engine === "function") {
          var eng = tf.engine();
          var reg = eng && eng.registryFactory ? Object.keys(eng.registryFactory) : [];
          reg.forEach(function (k) {
            var key = String(k || "").toLowerCase();
            if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = true;
          });
        }
      } catch (_) {}
      if (!(typeof window !== "undefined" && window.isSecureContext && typeof navigator !== "undefined" && navigator.gpu)) {
        out.webgpu = false;
      }
      return out;
    }

    function _ensureClientBackend(tf, runtimeBackend, runtimeBackendOrder) {
      var requestedRaw = String(runtimeBackend || "auto").toLowerCase();
      var requested = requestedRaw === "gpu" ? "auto" : requestedRaw;
      var order = _normalizeClientBackendOrder(runtimeBackendOrder);
      return Promise.resolve().then(function () {
        return (tf && typeof tf.ready === "function") ? tf.ready() : null;
      }).then(function () {
        var avail = _getClientBackendAvailability(tf);
        var current = (tf && typeof tf.getBackend === "function") ? String(tf.getBackend() || "cpu").toLowerCase() : "cpu";
        if (requested !== "auto") {
          if (requested === current) return current;
          return Promise.resolve(tf.setBackend(requested)).then(function () {
            return (typeof tf.ready === "function") ? tf.ready() : null;
          }).then(function () {
            return (typeof tf.getBackend === "function") ? String(tf.getBackend() || requested).toLowerCase() : requested;
          });
        }
        var desired = "cpu";
        for (var i = 0; i < order.length; i++) {
          if (avail[order[i]]) { desired = order[i]; break; }
        }
        if (desired === current) return current;
        return Promise.resolve(tf.setBackend(desired)).then(function () {
          return (typeof tf.ready === "function") ? tf.ready() : null;
        }).then(function () {
          return (typeof tf.getBackend === "function") ? String(tf.getBackend() || desired).toLowerCase() : desired;
        }).catch(function () {
          return current || "cpu";
        });
      });
    }

    function _setRuntimeDiagnostics(tCard, patch) {
      if (!tCard) return null;
      var tf = getTf();
      var cfg = tCard.config || {};
      var prev = (tCard.runtimeDiagnostics && typeof tCard.runtimeDiagnostics === "object") ? tCard.runtimeDiagnostics : {};
      var worker = _getWorkerSupport();
      var modeChanged = !!(patch && (
        (patch.source != null && patch.source !== prev.source) ||
        (patch.executionMode != null && patch.executionMode !== prev.executionMode)
      ));
      tCard.runtimeDiagnostics = Object.assign({}, prev, patch || {}, {
        requestedBackend: (patch && patch.requestedBackend != null) ? patch.requestedBackend : (prev.requestedBackend || String(cfg.runtimeBackend || "auto")),
        resolvedBackend: (patch && patch.resolvedBackend != null) ? patch.resolvedBackend : (modeChanged ? "" : (prev.resolvedBackend || "")),
        autoOrder: (patch && patch.autoOrder) ? patch.autoOrder : (prev.autoOrder || _normalizeClientBackendOrder(cfg.runtimeBackendOrder)),
        availableBackends: (patch && patch.availableBackends) ? patch.availableBackends : (prev.availableBackends || _getClientBackendAvailability(tf)),
        currentTfBackend: (patch && patch.currentTfBackend != null) ? patch.currentTfBackend : ((tf && typeof tf.getBackend === "function") ? String(tf.getBackend() || "") : (prev.currentTfBackend || "")),
        secureContext: (patch && patch.secureContext != null) ? patch.secureContext : (typeof window !== "undefined" ? !!window.isSecureContext : false),
        navigatorGpu: (patch && patch.navigatorGpu != null) ? patch.navigatorGpu : (typeof navigator !== "undefined" && !!navigator.gpu),
        workerAvailable: (patch && patch.workerAvailable != null) ? patch.workerAvailable : worker.available,
        workerBridge: (patch && patch.workerBridge != null) ? patch.workerBridge : worker.hasBridge,
        workerApi: (patch && patch.workerApi != null) ? patch.workerApi : worker.hasWorkerApi,
        updatedAt: Date.now(),
      });
      return tCard.runtimeDiagnostics;
    }

    function _runtimeDiagForCard(tCard) {
      var cfg = (tCard && tCard.config) || {};
      var tf = getTf();
      var avail = _getClientBackendAvailability(tf);
      var worker = _getWorkerSupport();
      var diag = _setRuntimeDiagnostics(tCard || {}, {});
      var predictedMode = cfg.useServer ? "server" : (worker.available ? "worker" : "main-thread");
      var resolved = String(diag.resolvedBackend || "").trim();
      if (!resolved) {
        if ((diag.source || (cfg.useServer ? "server" : "browser")) === "browser") resolved = String(diag.currentTfBackend || "");
        else resolved = String((tCard && tCard.backend) || diag.currentTfBackend || "");
      }
      return {
        requestedBackend: diag.requestedBackend || String(cfg.runtimeBackend || "auto"),
        resolvedBackend: resolved,
        currentTfBackend: diag.currentTfBackend || ((tf && typeof tf.getBackend === "function") ? String(tf.getBackend() || "") : ""),
        autoOrder: Array.isArray(diag.autoOrder) ? diag.autoOrder : _normalizeClientBackendOrder(cfg.runtimeBackendOrder),
        availableBackends: diag.availableBackends || avail,
        secureContext: !!diag.secureContext,
        navigatorGpu: !!diag.navigatorGpu,
        workerAvailable: !!diag.workerAvailable,
        workerBridge: !!diag.workerBridge,
        workerApi: !!diag.workerApi,
        executionMode: diag.executionMode || ((_isTraining && _activeTrainingId === (tCard && tCard.id)) ? predictedMode : ""),
        status: diag.status || ((_isTraining && _activeTrainingId === (tCard && tCard.id)) ? "running" : "idle"),
        source: diag.source || (cfg.useServer ? "server" : "browser"),
        note: diag.note || "",
        updatedAt: diag.updatedAt || 0,
      };
    }

    // Check server connection
    function _checkServerConnection(url, callback) {
      var sra = getServerAdapter();
      if (!sra) { callback(false); return; }
      var serverUrl = url || _serverUrl || sra.DEFAULT_SERVER;
      sra.checkServer(serverUrl).then(function (ok) {
        _serverAvailable = ok;
        if (ok) {
          // get server info
          fetch(serverUrl.replace(/\/$/, "") + "/api/health").then(function (r) { return r.json(); }).then(function (info) {
            _serverInfo = info;
            callback(true, info);
          }).catch(function () { callback(true, null); });
        } else {
          _serverInfo = null;
          callback(false);
        }
      });
    }

    // === LEFT ===
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Trainers"));

      var trainers = _listTrainers();
      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      var items = trainers.map(function (t) {
        var icon = t.status === "done" ? "\u2713 " : (t.status === "running" ? "\u23f3 " : "");
        var backend = _resolveBackendLabel(t);
        return {
          id: t.id, title: t.name || t.id, active: t.id === activeId,
          metaLines: [t.schemaId || "", icon + (t.status || "draft"), backend].filter(Boolean),
          actions: [{ id: "rename", label: "\u270e" }, { id: "delete", label: "\u2715" }],
        };
      });

      var listMount = el("div", {});
      leftEl.appendChild(listMount);
      if (uiEngine && typeof uiEngine.renderItemList === "function") {
        uiEngine.renderItemList({
          mountEl: listMount, items: items, emptyText: "No trainers.",
          onOpen: function (id) {
            if (stateApi) stateApi.setActiveTrainer(id);
            if (!_isTraining) _subTab = "train"; // reset to train tab when switching items (unless actively training)
            _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          },
          onAction: function (id, act) {
            if (act === "rename") {
              var t = store ? store.getTrainerCard(id) : null;
              if (!t) return;
              var name = prompt("Rename:", t.name || t.id);
              if (name && name.trim()) { t.name = name.trim(); store.upsertTrainerCard(t); _renderLeftPanel(); }
            } else if (act === "delete" && confirm("Delete?")) {
              if (store) store.removeTrainerCard(id);
              if (stateApi && stateApi.getActiveTrainer() === id) stateApi.setActiveTrainer("");
              _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
            }
          },
        });
      }

      var newBtn = el("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "+ New Trainer");
      newBtn.addEventListener("click", _openNewModal);
      leftEl.appendChild(newBtn);
    }

    function _openNewModal() {
      if (!modal) return;
      var _ni, _ss;
      modal.open({
        title: "New Training Session",
        renderForm: function (m) {
          var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
          m.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Name"));
          _ni = el("input", { type: "text", placeholder: "train_1", style: "width:100%;padding:6px 8px;margin-bottom:8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          m.appendChild(_ni);
          m.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Schema"));
          _ss = el("select", { style: "width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          schemas.forEach(function (s) { var o = el("option", { value: s.id }); o.textContent = s.label || s.id; if (s.id === _getSchemaId()) o.selected = true; _ss.appendChild(o); });
          m.appendChild(_ss);
          setTimeout(function () { _ni.focus(); }, 50);
        },
        onCreate: function () {
          var name = (_ni && _ni.value.trim()) || "";
          var sid = _ss ? _ss.value : "";
          if (!name) { onStatus("Enter a name"); return; }
          var id = "t_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
          console.log("[trainer_tab] creating:", id, name, sid);
          if (store) store.upsertTrainerCard({ id: id, name: name, schemaId: sid, status: "draft", createdAt: Date.now() });
          if (stateApi) { stateApi.setActiveSchema(sid); stateApi.setActiveTrainer(id); }
          onStatus("Created: " + name);
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        },
      });
    }

    // === MIDDLE: train/test sub-tabs ===
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";
      _lossChartDiv = null;
      _epochTableBody = null;
      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      if (!activeId) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Select or create a trainer.")); return; }
      var t = store ? store.getTrainerCard(activeId) : null;
      if (!t) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Not found.")); return; }

      // header
      var header = el("div", { className: "osc-card", style: "margin-bottom:8px;" });
      header.appendChild(el("h3", { style: "color:#67e8f9;margin:0 0 4px;" }, t.name || t.id));
      header.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;" },
        "Schema: " + escapeHtml(t.schemaId || "") + " | Status: " + (t.status || "draft") +
        (t.datasetId ? " | Dataset: " + (function () {
          var d = store.getDataset(t.datasetId);
          if (!d) return t.datasetId;
          var label = d.name || t.datasetId;
          var W = typeof window !== "undefined" ? window : {};
          var sr = W.OSCDatasetSourceRegistry;
          if (sr && typeof sr.resolveDatasetSplit === "function") {
            var tr = sr.resolveDatasetSplit(d.data || d, "train");
            var va = sr.resolveDatasetSplit(d.data || d, "val");
            var te = sr.resolveDatasetSplit(d.data || d, "test");
            label += " [train:" + (tr && tr.x ? tr.x.length : 0) + " val:" + (va && va.x ? va.x.length : 0) + " test:" + (te && te.x ? te.x.length : 0) + "]";
          }
          return label;
        })() : "") +
        (t.modelId ? " | Model: " + (function () { var m = store.getModel(t.modelId); return m ? m.name : t.modelId; })() : "") +
        (function () { var bl = _resolveBackendLabel(t); return bl ? " | Backend: " + bl : ""; })() +
        (t.metrics && t.metrics.paramCount ? " | Params: " + Number(t.metrics.paramCount).toLocaleString() : "")));
      var family = _inferTrainerFamily(t);
      if (t.metrics && family !== "gan" && family !== "diffusion") {
        header.appendChild(el("div", { style: "font-size:12px;color:#4ade80;margin-top:4px;" },
          "MAE: " + (t.metrics.mae != null ? Number(t.metrics.mae).toExponential(3) : "—") +
          " | Test MAE: " + (t.metrics.testMae != null ? Number(t.metrics.testMae).toExponential(3) : "—") +
          " | Best epoch: " + (t.metrics.bestEpoch || "—")));
      } else if (t.metrics && (t.metrics.bestEpoch != null || t.metrics.paramCount != null)) {
        header.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-top:4px;" },
          (t.metrics.bestEpoch != null ? ("Best epoch: " + t.metrics.bestEpoch) : "Best epoch: —") +
          (t.metrics.paramCount != null ? (" | Params: " + Number(t.metrics.paramCount).toLocaleString()) : "")));
      }
      mainEl.appendChild(header);

      // sub-tabs
      var tabBar = el("div", { style: "display:flex;gap:4px;margin-bottom:8px;" });
      ["train", "test"].forEach(function (tabId) {
        var btn = el("button", {
          style: "padding:4px 12px;font-size:12px;border-radius:6px;cursor:pointer;border:1px solid " +
            (_subTab === tabId ? "#0ea5e9" : "#334155") + ";background:" +
            (_subTab === tabId ? "#0c2340" : "#1f2937") + ";color:" +
            (_subTab === tabId ? "#67e8f9" : "#cbd5e1") + ";",
        }, tabId.charAt(0).toUpperCase() + tabId.slice(1));
        btn.addEventListener("click", function () { _subTab = tabId; _renderMainPanel(); });
        tabBar.appendChild(btn);
      });
      mainEl.appendChild(tabBar);

      if (_subTab === "train") {
        _renderTrainSubTab(mainEl, t, activeId);
      } else {
        _renderTestSubTab(mainEl, t, activeId);
      }
    }

    function _renderTrainSubTab(mainEl, t, activeId) {
      // loss chart — always show (empty or with data)
      _lossChartDiv = el("div", { style: "height:280px;margin-bottom:8px;" });
      mainEl.appendChild(_lossChartDiv);

      var epochs = store && typeof store.getTrainerEpochs === "function" ? store.getTrainerEpochs(activeId) : [];
      if (epochs.length) {
        _plotLossChart(epochs);
      } else {
        var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
        if (Plotly) {
          Plotly.newPlot(_lossChartDiv, [], {
            paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
            title: { text: "Training Progress (waiting...)", font: { size: 12 } },
            xaxis: { title: "Epoch", gridcolor: "#1e293b" }, yaxis: { title: "Loss", gridcolor: "#1e293b" },
            margin: { t: 30, b: 50, l: 50, r: 10 },
          }, { responsive: true });
        }
      }

      // epoch table — persistent, rows appended live during training
      var tableWrap = el("div", { style: "max-height:300px;overflow-y:auto;" });
      var table = el("table", { className: "osc-metric-table", style: "width:100%;" });
      var thead = el("tr", {});
      ["Epoch", "Loss", "Val Loss", "LR", "Improved"].forEach(function (h) { thead.appendChild(el("th", {}, h)); });
      table.appendChild(thead);
      var tbody = el("tbody", {});
      table.appendChild(tbody);
      _epochTableBody = tbody;

      // fill existing epochs
      epochs.forEach(function (ep) { _appendEpochRow(ep); });

      if (!epochs.length && t.status !== "running") {
        var emptyRow = el("tr", {});
        emptyRow.appendChild(el("td", { style: "color:#64748b;text-align:center;", colspan: "5" }, "Waiting for training..."));
        tbody.appendChild(emptyRow);
      }

      tableWrap.appendChild(table);
      mainEl.appendChild(tableWrap);
    }

    function _appendEpochRow(ep) {
      if (!_epochTableBody) return;
      // remove "waiting" placeholder if present
      if (_epochTableBody.children.length === 1) {
        var first = _epochTableBody.children[0];
        if (first && first.querySelector && first.querySelector("[colspan]")) {
          _epochTableBody.removeChild(first);
        }
      }
      var tr = el("tr", {});
      tr.appendChild(el("td", {}, String(ep.epoch || "")));
      tr.appendChild(el("td", {}, ep.loss != null ? Number(ep.loss).toExponential(3) : "\u2014"));
      // show per-phase losses if available, otherwise val_loss
      if (ep.phaseLosses && typeof ep.phaseLosses === "object") {
        var phKeys = Object.keys(ep.phaseLosses);
        var phStr = phKeys.map(function (k) { return k + ":" + Number(ep.phaseLosses[k]).toExponential(3); }).join(" ");
        tr.appendChild(el("td", { style: "font-size:9px;" }, phStr));
      } else {
        tr.appendChild(el("td", {}, ep.val_loss != null ? Number(ep.val_loss).toExponential(3) : "\u2014"));
      }
      tr.appendChild(el("td", {}, ep.current_lr != null ? Number(ep.current_lr).toExponential(2) : "\u2014"));
      tr.appendChild(el("td", { style: ep.improved ? "color:#4ade80;" : "" }, ep.improved ? "\u2713" : ""));
      _epochTableBody.appendChild(tr);
      // auto-scroll to bottom
      var wrap = _epochTableBody.parentElement && _epochTableBody.parentElement.parentElement;
      if (wrap && wrap.scrollHeight > wrap.clientHeight) wrap.scrollTop = wrap.scrollHeight;
    }

    function _renderTestSubTab(mainEl, t, activeId) {
      var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
      var tf = getTf();
      var pc = predictionCore || (typeof window !== "undefined" && window.OSCPredictionCore) || null;
      var _darkLayout = { paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 }, margin: { t: 30, b: 50, l: 50, r: 10 } };

      if (!t.metrics) {
        mainEl.appendChild(el("div", { style: "font-size:12px;color:#64748b;padding:8px;" }, "Train first to see test results and predictions."));
        return;
      }

      // read task type from model graph output nodes
      var schemaId = t.schemaId;
      var allowedOutputKeys = schemaRegistry ? schemaRegistry.getOutputKeys(schemaId) : [];
      var model = t.modelId ? (store ? store.getModel(t.modelId) : null) : null;
      var _defOk = allowedOutputKeys.length ? (allowedOutputKeys[0].key || allowedOutputKeys[0]) : "";
      var heads = (model && model.graph && modelBuilder) ? modelBuilder.inferOutputHeads(model.graph, allowedOutputKeys, _defOk) : [];
      var defaultTarget = (heads.length && heads[0].target) ? heads[0].target : _defOk;
      var defaultHeadType = (heads.length && heads[0].headType) ? heads[0].headType : "regression";
      var isClassification = defaultHeadType === "classification";

      // --- check if server returned raw predictions (full charts) ---
      var m = t.metrics || {};
      if (m.testPredictions && m.testTruth && m.testPredictions.length) {
        var bl = _resolveBackendLabel(t) || "server";
        var statusEl = el("div", { style: "font-size:11px;color:#94a3b8;padding:4px 8px;" },
          "Evaluated " + m.testPredictions.length + " test samples (backend: " + bl + ").");
        mainEl.appendChild(statusEl);
        var metricsContainer = el("div", {});
        mainEl.appendChild(metricsContainer);
        if (isClassification) {
          _renderClassificationMetrics(metricsContainer, m.testPredictions, m.testTruth, m.testPredictions.length,
            (store.getDataset(t.datasetId) && store.getDataset(t.datasetId).data && store.getDataset(t.datasetId).data.classCount) || 10,
            null, [28, 28, 1], {}, Plotly, _darkLayout, pc);
        } else {
          _renderRegressionMetrics(metricsContainer, m.testPredictions, m.testTruth, m.testPredictions.length, Plotly, _darkLayout, pc);
        }
        return;
      }

      // --- show stored summary metrics if available (pretrained weights without dataset) ---
      var m2 = t.metrics || {};
      var hasStoredMetrics = m2.testMae != null || m2.testRmse != null || m2.testR2 != null || m2.bestValLoss != null;
      if (hasStoredMetrics) {
        var bl2 = _resolveBackendLabel(t);
        var summaryCard = el("div", { className: "osc-card", style: "margin-bottom:8px;" });
        summaryCard.appendChild(el("div", { style: "font-size:11px;color:#67e8f9;font-weight:600;margin-bottom:4px;" },
          "Stored Test Metrics" + (bl2 ? " (trained on " + bl2 + ")" : "")));
        var metricsLine = [];
        if (m2.testMae != null) metricsLine.push("MAE: " + Number(m2.testMae).toFixed(6));
        if (m2.testRmse != null) metricsLine.push("RMSE: " + Number(m2.testRmse).toFixed(6));
        if (m2.testR2 != null) metricsLine.push("R\u00B2: " + Number(m2.testR2).toFixed(6));
        if (m2.bestValLoss != null) metricsLine.push("Best Val Loss: " + Number(m2.bestValLoss).toFixed(6));
        if (m2.bestEpoch != null) metricsLine.push("Best Epoch: " + m2.bestEpoch);
        summaryCard.appendChild(el("div", { style: "font-size:12px;color:#e2e8f0;" }, metricsLine.join(" | ")));
        mainEl.appendChild(summaryCard);
      }

      // --- client-side evaluation (TF.js rebuild + inference — full charts) ---
      _renderTestSubTabClient(mainEl, t, activeId, Plotly, _darkLayout, pc, schemaId, allowedOutputKeys, defaultTarget, isClassification, defaultHeadType);
    }

    function _renderTestSubTabClient(mainEl, t, activeId, Plotly, _darkLayout, pc, schemaId, allowedOutputKeys, defaultTarget, isClassification, defaultHeadType) {
      var tf = getTf();
      // --- load dataset + model for TF.js inference ---
      if (!tf || !t.modelArtifacts || !t.datasetId || !modelBuilder) {
        _renderFallbackCurves(mainEl, activeId, Plotly, _darkLayout);
        return;
      }

      // skip test for models that don't have meaningful test metrics (e.g., GAN generator)
      var modelRec0 = store ? store.getModel(t.modelId) : null;
      if (modelRec0 && modelRec0.graph && modelBuilder) {
        var family0 = modelBuilder.inferModelFamily(modelRec0.graph);
        if (family0 === "gan") {
          mainEl.appendChild(el("div", { className: "osc-card", style: "margin-top:8px;text-align:center;padding:24px;" },
            el("div", { style: "font-size:13px;color:#94a3b8;" }, "GAN models generate from noise \u2014 test metrics are not applicable."),
            el("div", { style: "font-size:12px;color:#67e8f9;margin-top:8px;" }, "Use the Generation tab to see generated images.")
          ));
          return;
        }
      }

      var backendLabel = _resolveBackendLabel(t);

      // --- check cache first ---
      var cached = _testCache[activeId];
      if (cached) {
        var statusEl2 = el("div", { style: "font-size:11px;color:#94a3b8;padding:4px 8px;" },
          "Evaluated " + cached.testN + " test samples" + (backendLabel ? " (weights: " + backendLabel + ", inference: TF.js)" : "") + ".");
        mainEl.appendChild(statusEl2);
        var metricsContainer2 = el("div", {});
        mainEl.appendChild(metricsContainer2);
        if (cached.isClassification) {
          _renderClassificationMetrics(metricsContainer2, cached.preds, cached.ySlice, cached.testN, cached.nCls, cached.rawRecords, cached.imgShape, cached.activeDs, Plotly, _darkLayout, pc);
        } else {
          _renderRegressionMetrics(metricsContainer2, cached.preds, cached.ySlice, cached.testN, Plotly, _darkLayout, pc);
        }
        return;
      }

      // --- show loading spinner ---
      var loaderWrap = el("div", { style: "display:flex;align-items:center;gap:8px;padding:12px 8px;" });
      var spinner = el("div", { style: "width:18px;height:18px;border:2px solid #334155;border-top-color:#67e8f9;border-radius:50%;animation:spin 0.8s linear infinite;" });
      loaderWrap.appendChild(spinner);
      loaderWrap.appendChild(el("span", { style: "font-size:12px;color:#94a3b8;" }, "Running inference on test set (TF.js)..."));
      mainEl.appendChild(loaderWrap);

      // ensure @keyframes spin exists
      if (!document.getElementById("osc-spin-style")) {
        var style = document.createElement("style");
        style.id = "osc-spin-style";
        style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
        document.head.appendChild(style);
      }

      var capturedMountId = _mountId;

      // defer heavy work to let spinner render
      setTimeout(function () {
        if (_mountId !== capturedMountId) return; // tab switched away

        try {
          var dataset = store ? store.getDataset(t.datasetId) : null;
          var modelRec = store ? store.getModel(t.modelId) : null;
          if (!dataset || !dataset.data || !modelRec || !modelRec.graph) {
            loaderWrap.innerHTML = "";
            loaderWrap.appendChild(el("span", { style: "font-size:12px;color:#f43f5e;" }, "Dataset or model not found."));
            return;
          }

          var dsData = dataset.data;
          var isBundle = dsData.kind === "dataset_bundle" && dsData.datasets;
          var activeDs = isBundle ? dsData.datasets[dsData.activeVariantId || Object.keys(dsData.datasets)[0]] : dsData;
          var rawRecords = activeDs.records || null;
          var nCls = activeDs.classCount || 10;
          var imgShape = Array.isArray(activeDs.imageShape) ? activeDs.imageShape : [28, 28, 1];

          // resolve test data via source registry or legacy records
          if (!activeDs.xTest) {
            var W2 = typeof window !== "undefined" ? window : {};
            var srcReg2 = W2.OSCDatasetSourceRegistry || null;
            var oh = function (l, n) { var a = new Array(n).fill(0); a[l] = 1; return a; };
            var isRecon3 = defaultHeadType === "reconstruction" || defaultHeadType === "regression";
            var testSplit;
            if (srcReg2 && typeof srcReg2.resolveDatasetSplit === "function") {
              testSplit = srcReg2.resolveDatasetSplit(activeDs, "test");
            } else {
              var rec = activeDs.records && activeDs.records.test;
              testSplit = rec ? { x: rec.x || [], y: rec.y || [], length: (rec.x || []).length } : { x: [], y: [], length: 0 };
            }
            var resolvedFS = (srcReg2 && typeof srcReg2.getFeatureSize === "function") ? srcReg2.getFeatureSize(activeDs) : 0;
            if (!resolvedFS && testSplit.x.length) resolvedFS = testSplit.x[0].length;
            activeDs = {
              xTest: testSplit.x,
              yTest: isClassification ? testSplit.y.map(function (l) { return typeof l === "number" ? oh(l, nCls) : l; })
                : isRecon3 ? testSplit.x : testSplit.y,
              yTestRaw: testSplit.y,
              featureSize: resolvedFS || 1,
              numClasses: nCls,
            };
          }

          // rebuild model
          var graphMode = modelBuilder.inferGraphMode(modelRec.graph, "direct");
          var featureSize = Number(activeDs.featureSize || (activeDs.xTest && activeDs.xTest[0] && activeDs.xTest[0].length) || 1);
          var rebuiltModel = modelBuilder.buildModelFromGraph(tf, modelRec.graph, {
            mode: graphMode, featureSize: featureSize, windowSize: 1, seqFeatureSize: featureSize,
            allowedOutputKeys: allowedOutputKeys, defaultTarget: defaultTarget, numClasses: activeDs.numClasses || nCls,
          });

          // load saved weights
          var hasWeights = t.modelArtifacts && t.modelArtifacts.weightSpecs &&
            (t.modelArtifacts.weightData || t.modelArtifacts.weightValues);
          if (hasWeights) {
            try {
              var converter = (typeof window !== "undefined" && window.OSCWeightConverter) ? window.OSCWeightConverter : null;
              if (!converter || typeof converter.loadArtifactsIntoModel !== "function") {
                throw new Error("Weight converter not available");
              }
              var loadResult = converter.loadArtifactsIntoModel(tf, rebuiltModel.model, t.modelArtifacts);
              if (!loadResult || !loadResult.loaded) {
                throw new Error(loadResult && loadResult.reason ? loadResult.reason : "weight_load_failed");
              }
            } catch (e) {
              console.warn("[test] Weight load failed:", e.message);
            }
          }

          var maxAvailable = (activeDs.xTest || []).length;

          // --- run inference on ALL test data (metrics computed on full set) ---
          var allX = activeDs.xTest;
          var allY = activeDs.yTest;
          var allPreds;
          // check if model has multiple inputs (e.g., GAN with SampleZ + ImageSource)
          var modelInputCount = rebuiltModel.model.inputs ? rebuiltModel.model.inputs.length : 1;
          // batch predict to avoid OOM
          var batchSize = 256;
          var allPredsArr = [];
          for (var bi = 0; bi < maxAvailable; bi += batchSize) {
            var bEnd = Math.min(bi + batchSize, maxAvailable);
            var batchX = allX.slice(bi, bEnd);
            var bTensor = tf.tensor2d(batchX);
            var inputTensors = bTensor;
            // multi-input: provide matching tensors for each input
            if (modelInputCount > 1) {
              var inputArr = [];
              var batchN = bEnd - bi;
              for (var ii = 0; ii < modelInputCount; ii++) {
                var inputShape = rebuiltModel.model.inputs[ii].shape;
                var inputDim = inputShape[inputShape.length - 1];
                if (inputDim === featureSize) {
                  inputArr.push(bTensor); // real data input
                } else {
                  inputArr.push(tf.randomNormal([batchN, inputDim])); // SampleZ input
                }
              }
              inputTensors = inputArr;
            }
            var bRaw = rebuiltModel.model.predict(inputTensors);
            var bData = (Array.isArray(bRaw) ? bRaw[0] : bRaw).arraySync();
            allPredsArr = allPredsArr.concat(bData);
            if (Array.isArray(inputTensors)) inputTensors.forEach(function (t) { if (t !== bTensor) t.dispose(); });
            bTensor.dispose();
            if (Array.isArray(bRaw)) bRaw.forEach(function (pt) { pt.dispose(); }); else bRaw.dispose();
          }
          allPreds = allPredsArr;

          rebuiltModel.model.dispose();

          // cache results
          _testCache[activeId] = {
            preds: allPreds, ySlice: allY, testN: maxAvailable, nCls: nCls,
            isClassification: isClassification, rawRecords: rawRecords, imgShape: imgShape, activeDs: activeDs,
          };

          if (_mountId !== capturedMountId) return; // tab switched during inference

          // replace loader with results
          loaderWrap.innerHTML = "";
          loaderWrap.style.cssText = "padding:0;";
          var statusEl = el("div", { style: "font-size:11px;color:#94a3b8;padding:4px 8px;" },
            "Evaluated " + maxAvailable + " test samples" + (backendLabel ? " (weights: " + backendLabel + ", inference: TF.js)" : "") + ".");
          loaderWrap.appendChild(statusEl);

          var metricsContainer = el("div", {});
          mainEl.appendChild(metricsContainer);

          if (isClassification) {
            _renderClassificationMetrics(metricsContainer, allPreds, allY, maxAvailable, nCls, rawRecords, imgShape, activeDs, Plotly, _darkLayout, pc);
          } else {
            _renderRegressionMetrics(metricsContainer, allPreds, allY, maxAvailable, Plotly, _darkLayout, pc);
          }

        } catch (e) {
          if (_mountId !== capturedMountId) return;
          loaderWrap.innerHTML = "";
          loaderWrap.appendChild(el("span", { style: "font-size:12px;color:#f43f5e;" }, "Inference error: " + e.message));
        }
      }, 30); // small delay to let the spinner paint
    }

    // === Classification metrics ===
    function _renderClassificationMetrics(container, preds, ySlice, testN, nCls, rawRecords, imgShape, activeDs, Plotly, darkLayout, pc) {
      var predLabels = preds.map(function (p) { return p.indexOf(Math.max.apply(null, p)); });
      var trueLabels = ySlice.map(function (y) { return Array.isArray(y) ? y.indexOf(Math.max.apply(null, y)) : Number(y); });

      // overall accuracy — big number card
      var correct = 0;
      for (var ci = 0; ci < testN; ci++) { if (predLabels[ci] === trueLabels[ci]) correct++; }
      var accuracy = correct / testN;

      var accCard = el("div", { className: "osc-card", style: "margin-top:8px;text-align:center;padding:16px;" });
      accCard.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;" }, "Test Accuracy"));
      accCard.appendChild(el("div", { style: "font-size:36px;font-weight:700;color:" + (accuracy >= 0.8 ? "#4ade80" : accuracy >= 0.5 ? "#fbbf24" : "#f43f5e") + ";" }, (accuracy * 100).toFixed(1) + "%"));
      accCard.appendChild(el("div", { style: "font-size:11px;color:#64748b;" }, correct + " / " + testN + " correct"));
      container.appendChild(accCard);

      if (!pc) return;

      // confusion matrix heatmap — normalized by row (recall per class)
      var cm = pc.confusionMatrix(trueLabels, predLabels, nCls);
      var cmNorm = cm.map(function (row) {
        var rowSum = row.reduce(function (a, b) { return a + b; }, 0);
        return row.map(function (v) { return rowSum > 0 ? v / rowSum : 0; });
      });
      if (Plotly) {
        var cmCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
        cmCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Confusion Matrix (row-normalized)"));
        var cmDiv = el("div", { style: "height:380px;" });
        cmCard.appendChild(cmDiv);
        container.appendChild(cmCard);

        var classLabels = [];
        for (var li = 0; li < nCls; li++) classLabels.push(String(li));

        // text annotations: show count + percentage
        var cmText = [];
        for (var tr = 0; tr < nCls; tr++) {
          var textRow = [];
          for (var tc = 0; tc < nCls; tc++) {
            textRow.push(cm[tr][tc] + "\n" + (cmNorm[tr][tc] * 100).toFixed(0) + "%");
          }
          cmText.push(textRow);
        }

        Plotly.newPlot(cmDiv, [{
          z: cmNorm, x: classLabels, y: classLabels, type: "heatmap",
          colorscale: "Blues", showscale: true, zmin: 0, zmax: 1,
          text: cmText, texttemplate: "%{text}", textfont: { size: 9 },
          hoverongaps: false,
          colorbar: { title: "Recall", titleside: "right", tickformat: ".0%", len: 0.9 },
        }], Object.assign({}, darkLayout, {
          title: { text: "True (rows) vs Predicted (columns)", font: { size: 11, color: "#94a3b8" } },
          xaxis: { title: "Predicted Class", gridcolor: "#1e293b", tickvals: classLabels, side: "bottom" },
          yaxis: { title: "True Class", gridcolor: "#1e293b", tickvals: classLabels, autorange: "reversed" },
          margin: { t: 35, b: 60, l: 60, r: 80 },
        }), { responsive: true });
      }

      // per-class precision, recall, F1 table
      var prfData = pc.precisionRecallF1(cm);
      var prfCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
      prfCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Per-Class Metrics"));

      var prfTable = el("table", { style: "width:100%;border-collapse:collapse;font-size:11px;" });
      var thead = el("tr", {});
      ["Class", "Precision", "Recall", "F1", "Support"].forEach(function (h) {
        thead.appendChild(el("th", { style: "text-align:left;padding:4px 8px;color:#94a3b8;border-bottom:1px solid #1e293b;" }, h));
      });
      prfTable.appendChild(thead);

      var macroP = 0, macroR = 0, macroF1 = 0, totalSupport = 0;
      var weakClasses = [];
      prfData.forEach(function (row) {
        var rowTr = el("tr", {});
        rowTr.appendChild(el("td", { style: "padding:4px 8px;color:#e2e8f0;font-weight:600;" }, String(row.class)));
        rowTr.appendChild(_metricBarCell(row.precision));
        rowTr.appendChild(_metricBarCell(row.recall));
        rowTr.appendChild(_metricBarCell(row.f1));
        rowTr.appendChild(el("td", { style: "padding:4px 8px;color:#94a3b8;text-align:right;" }, String(row.support)));
        prfTable.appendChild(rowTr);
        macroP += row.precision; macroR += row.recall; macroF1 += row.f1; totalSupport += row.support;
        if (row.f1 < 0.7) weakClasses.push({ cls: row.class, f1: row.f1, precision: row.precision, recall: row.recall });
      });

      var macroTr = el("tr", { style: "border-top:2px solid #334155;" });
      macroTr.appendChild(el("td", { style: "padding:4px 8px;color:#67e8f9;font-weight:700;" }, "Macro Avg"));
      macroTr.appendChild(_metricBarCell(nCls > 0 ? macroP / nCls : 0));
      macroTr.appendChild(_metricBarCell(nCls > 0 ? macroR / nCls : 0));
      macroTr.appendChild(_metricBarCell(nCls > 0 ? macroF1 / nCls : 0));
      macroTr.appendChild(el("td", { style: "padding:4px 8px;color:#94a3b8;text-align:right;" }, String(totalSupport)));
      prfTable.appendChild(macroTr);
      prfCard.appendChild(prfTable);
      container.appendChild(prfCard);

      // ROC curves (one-vs-rest) + insights
      if (Plotly && preds[0] && Array.isArray(preds[0])) {
        var rocCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
        rocCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "ROC Curves (One-vs-Rest)"));
        var rocDiv = el("div", { style: "height:320px;" });
        rocCard.appendChild(rocDiv);

        var rocColors = ["#22d3ee", "#f59e0b", "#4ade80", "#f43f5e", "#a78bfa", "#fb923c", "#2dd4bf", "#e879f9", "#fbbf24", "#38bdf8"];
        var rocTraces = [];
        var aucPerClass = [];
        for (var rc = 0; rc < nCls; rc++) {
          var rocData = pc.rocCurveOneVsRest(trueLabels, preds, rc);
          aucPerClass.push({ cls: rc, auc: rocData.auc });
          var step = Math.max(1, Math.floor(rocData.fpr.length / 200));
          var fprSub = [], tprSub = [];
          for (var ri = 0; ri < rocData.fpr.length; ri += step) { fprSub.push(rocData.fpr[ri]); tprSub.push(rocData.tpr[ri]); }
          rocTraces.push({
            x: fprSub, y: tprSub, mode: "lines",
            name: "Class " + rc + " (AUC=" + rocData.auc.toFixed(3) + ")",
            line: { color: rocColors[rc % rocColors.length], width: 1.5 },
          });
        }
        rocTraces.push({ x: [0, 1], y: [0, 1], mode: "lines", name: "Random", line: { color: "#475569", dash: "dash", width: 1 }, showlegend: false });

        var meanAuc = aucPerClass.reduce(function (a, b) { return a + b.auc; }, 0) / nCls;
        Plotly.newPlot(rocDiv, rocTraces, Object.assign({}, darkLayout, {
          title: { text: "Mean AUC: " + meanAuc.toFixed(3), font: { size: 12 } },
          xaxis: { title: "False Positive Rate", gridcolor: "#1e293b", range: [0, 1] },
          yaxis: { title: "True Positive Rate", gridcolor: "#1e293b", range: [0, 1] },
          legend: { font: { size: 9 }, bgcolor: "rgba(0,0,0,0)" },
          margin: { t: 35, b: 55, l: 50, r: 10 },
        }), { responsive: true });

        rocCard.appendChild(rocDiv);
        container.appendChild(rocCard);

        // === Insights & Recommendations ===
        var insightCard = el("div", { className: "osc-card", style: "margin-top:8px;border-left:3px solid #a78bfa;" });
        insightCard.appendChild(el("div", { style: "font-size:13px;color:#a78bfa;margin-bottom:8px;font-weight:600;" }, "Insights & Recommendations"));

        var insights = [];
        // overall assessment
        if (meanAuc >= 0.95) {
          insights.push({ icon: "\u2705", text: "Excellent discriminability (mean AUC " + meanAuc.toFixed(3) + "). The model separates classes very well." });
        } else if (meanAuc >= 0.85) {
          insights.push({ icon: "\u2705", text: "Good discriminability (mean AUC " + meanAuc.toFixed(3) + "). Minor improvements possible." });
        } else if (meanAuc >= 0.7) {
          insights.push({ icon: "\u26a0\ufe0f", text: "Moderate discriminability (mean AUC " + meanAuc.toFixed(3) + "). Consider more epochs, larger model, or data augmentation." });
        } else {
          insights.push({ icon: "\u274c", text: "Poor discriminability (mean AUC " + meanAuc.toFixed(3) + "). Model struggles to separate classes. Review architecture or training data." });
        }

        // find weak AUC classes
        var lowAucClasses = aucPerClass.filter(function (a) { return a.auc < 0.8; });
        if (lowAucClasses.length > 0) {
          var lowList = lowAucClasses.map(function (a) { return "class " + a.cls + " (AUC=" + a.auc.toFixed(3) + ")"; }).join(", ");
          insights.push({ icon: "\ud83d\udd0d", text: "Low AUC classes: " + lowList + ". These classes are hard to distinguish from others \u2014 check if they are visually similar or underrepresented." });
        }

        // precision vs recall balance
        if (weakClasses.length > 0) {
          weakClasses.forEach(function (w) {
            var msg = "Class " + w.cls + " (F1=" + (w.f1 * 100).toFixed(1) + "%): ";
            if (w.precision < w.recall) {
              msg += "Low precision \u2014 model often predicts this class incorrectly (too many false positives). The model is over-predicting this class.";
            } else if (w.recall < w.precision) {
              msg += "Low recall \u2014 model misses many samples of this class (too many false negatives). The model is under-detecting this class.";
            } else {
              msg += "Both precision and recall are low \u2014 the model struggles with this class overall.";
            }
            insights.push({ icon: "\u26a0\ufe0f", text: msg });
          });
        }

        // suggestion based on accuracy vs AUC gap
        if (meanAuc > 0.9 && accuracy < 0.8) {
          insights.push({ icon: "\ud83d\udca1", text: "AUC is high but accuracy is relatively low. The model has good ranking ability but the decision boundary may not be optimal. Consider calibration or threshold tuning." });
        }

        if (accuracy >= 0.9 && weakClasses.length === 0) {
          insights.push({ icon: "\ud83c\udf1f", text: "Strong performance across all classes. Ready for deployment or further benchmarking." });
        }

        insights.forEach(function (ins) {
          var line = el("div", { style: "font-size:11px;color:#cbd5e1;padding:3px 0;display:flex;gap:6px;align-items:flex-start;" });
          line.appendChild(el("span", { style: "flex-shrink:0;" }, ins.icon));
          line.appendChild(el("span", {}, ins.text));
          insightCard.appendChild(line);
        });
        container.appendChild(insightCard);
      }

      // image prediction grid — one row per class
      if (rawRecords && rawRecords.test && rawRecords.test.x) {
        var imgW = imgShape[0] || 28, imgH = imgShape[1] || 28;
        var gridCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
        gridCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Predictions vs Ground Truth (by class)"));

        // group by true class
        var byClass = {};
        for (var gi = 0; gi < testN; gi++) {
          var tCls = trueLabels[gi];
          if (!byClass[tCls]) byClass[tCls] = { correct: [], wrong: [] };
          if (predLabels[gi] === tCls) byClass[tCls].correct.push(gi);
          else byClass[tCls].wrong.push(gi);
        }

        var maxPerClass = 8;
        for (var clsI = 0; clsI < nCls; clsI++) {
          var group = byClass[clsI];
          if (!group) continue;
          var classAcc = group.correct.length / (group.correct.length + group.wrong.length);

          var classRow = el("div", { style: "margin-bottom:10px;" });
          var classHeader = el("div", { style: "font-size:11px;margin-bottom:4px;display:flex;align-items:center;gap:8px;" });
          classHeader.appendChild(el("span", { style: "font-weight:700;color:#e2e8f0;" }, "Class " + clsI));
          classHeader.appendChild(el("span", { style: "color:" + (classAcc >= 0.8 ? "#4ade80" : classAcc >= 0.5 ? "#fbbf24" : "#f43f5e") + ";font-size:10px;" },
            (classAcc * 100).toFixed(0) + "% (" + group.correct.length + "/" + (group.correct.length + group.wrong.length) + ")"));
          classRow.appendChild(classHeader);

          var imgRow = el("div", { style: "display:flex;flex-wrap:wrap;gap:3px;" });

          // show some correct (green) then some wrong (red)
          var showCorrect = group.correct.slice(0, maxPerClass);
          var showWrong = group.wrong.slice(0, maxPerClass);

          function _drawImgCell(idx, pLbl, tLbl, isOk) {
            var borderColor = isOk ? "#166534" : "#991b1b";
            var bgColor = isOk ? "#052e16" : "#450a0a";
            var cell = el("div", { style: "text-align:center;border:2px solid " + borderColor + ";border-radius:3px;padding:1px;background:" + bgColor + ";" });
            var canvas = document.createElement("canvas");
            canvas.width = imgW; canvas.height = imgH;
            canvas.style.cssText = "width:32px;height:32px;image-rendering:pixelated;display:block;";
            var pixels = rawRecords.test.x[idx];
            if (pixels) {
              var ctx = canvas.getContext("2d");
              var iData = ctx.createImageData(imgW, imgH);
              var imgCh = imgShape[2] || 1;
              var planeSize = imgW * imgH;
              for (var px = 0; px < planeSize; px++) {
                if (imgCh >= 3) {
                  // RGB: 3 values per pixel (HWC layout)
                  iData.data[px * 4] = Math.round((pixels[px * 3] || 0) * 255);
                  iData.data[px * 4 + 1] = Math.round((pixels[px * 3 + 1] || 0) * 255);
                  iData.data[px * 4 + 2] = Math.round((pixels[px * 3 + 2] || 0) * 255);
                } else {
                  // Grayscale: 1 value per pixel
                  var vv = Math.round((pixels[px] || 0) * 255);
                  iData.data[px * 4] = vv; iData.data[px * 4 + 1] = vv; iData.data[px * 4 + 2] = vv;
                }
                iData.data[px * 4 + 3] = 255;
              }
              ctx.putImageData(iData, 0, 0);
            }
            cell.appendChild(canvas);
            if (!isOk) {
              cell.appendChild(el("div", { style: "font-size:7px;color:#f43f5e;line-height:1;" }, "\u2192" + pLbl));
            }
            return cell;
          }

          showCorrect.forEach(function (idx) { imgRow.appendChild(_drawImgCell(idx, predLabels[idx], trueLabels[idx], true)); });
          if (showCorrect.length && showWrong.length) {
            imgRow.appendChild(el("div", { style: "width:1px;background:#334155;align-self:stretch;margin:0 2px;" }));
          }
          showWrong.forEach(function (idx) { imgRow.appendChild(_drawImgCell(idx, predLabels[idx], trueLabels[idx], false)); });

          classRow.appendChild(imgRow);
          gridCard.appendChild(classRow);
        }
        gridCard.appendChild(el("div", { style: "font-size:9px;color:#64748b;margin-top:6px;" }, "Green border = correct | Red border = misclassified (predicted label shown below)"));
        container.appendChild(gridCard);
      }
    }

    // === Regression metrics ===
    function _renderRegressionMetrics(container, preds, ySlice, testN, Plotly, darkLayout, pc) {
      // For multi-dim regression (e.g. 40-dim reconstruction), flatten ALL values for metrics
      var isMultiDim = ySlice[0] && Array.isArray(ySlice[0]) && ySlice[0].length > 1;
      var truthFlat, predFlat;
      if (isMultiDim) {
        truthFlat = []; predFlat = [];
        for (var fi = 0; fi < testN; fi++) {
          var yt = ySlice[fi], pp = preds[fi];
          if (Array.isArray(yt)) { for (var di = 0; di < yt.length; di++) { truthFlat.push(Number(yt[di] || 0)); predFlat.push(Number((pp && pp[di]) || 0)); } }
          else { truthFlat.push(Number(yt || 0)); predFlat.push(Number((pp && pp[0]) || 0)); }
        }
      } else {
        truthFlat = ySlice.map(function (y) { return Array.isArray(y) ? y[0] : Number(y); });
        predFlat = preds.map(function (p) { return Array.isArray(p) ? p[0] : Number(p); });
      }

      var r2 = pc ? pc.r2Score(truthFlat, predFlat) : 0;
      var regMetrics = pc ? pc.computeRegressionMetrics(truthFlat, predFlat) : { mae: 0, rmse: 0, bias: 0 };
      var residuals = pc ? pc.computeResiduals(truthFlat, predFlat) : [];

      var metricsRow = el("div", { style: "display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;" });

      function bigMetricCard(label, value, color) {
        var c = el("div", { className: "osc-card", style: "flex:1;min-width:100px;text-align:center;padding:12px 8px;" });
        c.appendChild(el("div", { style: "font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;" }, label));
        c.appendChild(el("div", { style: "font-size:24px;font-weight:700;color:" + color + ";margin-top:4px;" }, value));
        return c;
      }

      var r2Color = r2 >= 0.9 ? "#4ade80" : r2 >= 0.7 ? "#fbbf24" : "#f43f5e";
      metricsRow.appendChild(bigMetricCard("R\u00B2", r2.toFixed(4), r2Color));
      metricsRow.appendChild(bigMetricCard("MAE", regMetrics.mae.toExponential(3), "#22d3ee"));
      metricsRow.appendChild(bigMetricCard("RMSE", regMetrics.rmse.toExponential(3), "#f59e0b"));
      metricsRow.appendChild(bigMetricCard("Bias", regMetrics.bias.toExponential(3), "#a78bfa"));
      container.appendChild(metricsRow);

      if (!Plotly) return;

      // pred vs truth scatter with identity line
      var scatterCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
      scatterCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Predicted vs Truth"));
      var scatterDiv = el("div", { style: "height:300px;" });
      scatterCard.appendChild(scatterDiv);
      container.appendChild(scatterCard);

      // subsample for scatter plot if too many points (>50K)
      var plotTruth = truthFlat, plotPred = predFlat;
      var maxPlotPoints = 50000;
      if (truthFlat.length > maxPlotPoints) {
        var step = Math.ceil(truthFlat.length / maxPlotPoints);
        plotTruth = []; plotPred = [];
        for (var si = 0; si < truthFlat.length; si += step) { plotTruth.push(truthFlat[si]); plotPred.push(predFlat[si]); }
      }
      var minVal = Infinity, maxVal = -Infinity;
      for (var mi = 0; mi < plotTruth.length; mi++) {
        if (plotTruth[mi] < minVal) minVal = plotTruth[mi];
        if (plotTruth[mi] > maxVal) maxVal = plotTruth[mi];
        if (plotPred[mi] < minVal) minVal = plotPred[mi];
        if (plotPred[mi] > maxVal) maxVal = plotPred[mi];
      }
      Plotly.newPlot(scatterDiv, [
        { x: plotTruth, y: plotPred, mode: "markers", name: "Predictions" + (truthFlat.length > maxPlotPoints ? " (" + plotTruth.length + "/" + truthFlat.length + ")" : ""), marker: { size: 3, color: "#22d3ee", opacity: 0.5 } },
        { x: [minVal, maxVal], y: [minVal, maxVal], mode: "lines", name: "Identity", line: { color: "#4ade80", dash: "dash", width: 1.5 } },
      ], Object.assign({}, darkLayout, {
        title: { text: "Pred vs Truth (R\u00B2=" + r2.toFixed(4) + ")", font: { size: 12 } },
        xaxis: { title: "Ground Truth", gridcolor: "#1e293b" },
        yaxis: { title: "Predicted", gridcolor: "#1e293b" },
        legend: { orientation: "h", y: -0.15 },
      }), { responsive: true });

      // residual plot
      var residCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
      residCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Residuals"));
      var residDiv = el("div", { style: "height:260px;" });
      residCard.appendChild(residDiv);
      container.appendChild(residCard);

      // subsample residuals too
      var plotResidPred = plotPred, plotResid = residuals;
      if (residuals.length > maxPlotPoints) {
        var rstep = Math.ceil(residuals.length / maxPlotPoints);
        plotResidPred = []; plotResid = [];
        for (var ri = 0; ri < residuals.length; ri += rstep) { plotResidPred.push(predFlat[ri]); plotResid.push(residuals[ri]); }
      }
      Plotly.newPlot(residDiv, [
        { x: plotResidPred, y: plotResid, mode: "markers", name: "Residuals", marker: { size: 3, color: "#f59e0b", opacity: 0.4 } },
        { x: [minVal, maxVal], y: [0, 0], mode: "lines", name: "Zero", line: { color: "#475569", dash: "dash", width: 1 }, showlegend: false },
      ], Object.assign({}, darkLayout, {
        title: { text: "Residuals vs Predicted", font: { size: 12 } },
        xaxis: { title: "Predicted", gridcolor: "#1e293b" },
        yaxis: { title: "Residual (pred - truth)", gridcolor: "#1e293b" },
        margin: { t: 35, b: 55, l: 55, r: 10 },
      }), { responsive: true });

      // time series overlay
      var tsCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
      tsCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Sample Predictions"));
      var tsDiv = el("div", { style: "height:260px;" });
      tsCard.appendChild(tsDiv);
      container.appendChild(tsCard);

      var tsIndices = [];
      for (var ti = 0; ti < testN; ti++) tsIndices.push(ti);
      Plotly.newPlot(tsDiv, [
        { x: tsIndices, y: truthFlat, mode: "lines", name: "Ground Truth", line: { color: "#22d3ee", width: 1.5 } },
        { x: tsIndices, y: predFlat, mode: "lines", name: "Prediction", line: { color: "#f59e0b", dash: "dot", width: 1.5 } },
      ], Object.assign({}, darkLayout, {
        title: { text: "Pred vs Truth (" + testN + " test samples)", font: { size: 12 } },
        xaxis: { title: "Sample", gridcolor: "#1e293b" },
        yaxis: { title: "Value", gridcolor: "#1e293b" },
        legend: { orientation: "h", y: -0.15 },
      }), { responsive: true });

      // insights
      var insightCard = el("div", { className: "osc-card", style: "margin-top:8px;border-left:3px solid #a78bfa;" });
      insightCard.appendChild(el("div", { style: "font-size:13px;color:#a78bfa;margin-bottom:8px;font-weight:600;" }, "Insights & Recommendations"));
      var regInsights = [];
      if (r2 >= 0.95) regInsights.push({ icon: "\u2705", text: "Excellent fit (R\u00B2=" + r2.toFixed(4) + "). Model explains >95% of the variance." });
      else if (r2 >= 0.8) regInsights.push({ icon: "\u2705", text: "Good fit (R\u00B2=" + r2.toFixed(4) + "). Consider more epochs or deeper model for further improvement." });
      else if (r2 >= 0.5) regInsights.push({ icon: "\u26a0\ufe0f", text: "Moderate fit (R\u00B2=" + r2.toFixed(4) + "). Significant unexplained variance. Try larger model, more features, or longer training." });
      else regInsights.push({ icon: "\u274c", text: "Poor fit (R\u00B2=" + r2.toFixed(4) + "). Model barely captures the relationship. Reconsider architecture, features, or data quality." });

      if (Math.abs(regMetrics.bias) > regMetrics.mae * 0.3) {
        regInsights.push({ icon: "\ud83d\udd0d", text: "Systematic bias detected (bias=" + regMetrics.bias.toExponential(3) + "). Model consistently " + (regMetrics.bias > 0 ? "over-predicts" : "under-predicts") + ". Check normalization or add bias correction." });
      }
      if (regMetrics.rmse > regMetrics.mae * 1.5) {
        regInsights.push({ icon: "\u26a0\ufe0f", text: "RMSE >> MAE indicates some large outlier errors. Check residual plot for patterns \u2014 may benefit from robust loss function or outlier handling." });
      }

      regInsights.forEach(function (ins) {
        var line = el("div", { style: "font-size:11px;color:#cbd5e1;padding:3px 0;display:flex;gap:6px;align-items:flex-start;" });
        line.appendChild(el("span", { style: "flex-shrink:0;" }, ins.icon));
        line.appendChild(el("span", {}, ins.text));
        insightCard.appendChild(line);
      });
      container.appendChild(insightCard);
    }

    // === Helper: metric bar cell for P/R/F1 table ===
    function _metricBarCell(val) {
      var pct = Math.round(val * 100);
      var barColor = val >= 0.8 ? "#4ade80" : val >= 0.5 ? "#fbbf24" : "#f43f5e";
      var td = el("td", { style: "padding:4px 8px;position:relative;min-width:80px;" });
      var bar = el("div", { style: "position:absolute;left:0;top:0;bottom:0;width:" + pct + "%;background:" + barColor + ";opacity:0.15;border-radius:2px;" });
      td.appendChild(bar);
      td.appendChild(el("span", { style: "position:relative;color:" + barColor + ";font-weight:600;font-size:11px;" }, (val * 100).toFixed(1) + "%"));
      return td;
    }

    // === Fallback: training curves only ===
    function _renderFallbackCurves(mainEl, activeId, Plotly, darkLayout) {
      var card = el("div", { className: "osc-card", style: "margin-top:8px;" });
      card.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;font-weight:600;" }, "Training Curves"));
      var chartDiv = el("div", { style: "height:280px;" });
      card.appendChild(chartDiv);
      mainEl.appendChild(card);

      if (Plotly) {
        var epochs = store && typeof store.getTrainerEpochs === "function" ? store.getTrainerEpochs(activeId) : [];
        if (epochs.length) {
          Plotly.newPlot(chartDiv, [
            { x: epochs.map(function (e) { return e.epoch; }), y: epochs.map(function (e) { return e.loss; }), mode: "lines+markers", name: "Train Loss", line: { color: "#22d3ee" } },
            { x: epochs.map(function (e) { return e.epoch; }), y: epochs.map(function (e) { return e.val_loss; }), mode: "lines+markers", name: "Val Loss", line: { color: "#f59e0b" } },
          ], Object.assign({}, darkLayout, {
            title: { text: "Training Curves", font: { size: 12 } },
            xaxis: { title: "Epoch", gridcolor: "#1e293b" },
            yaxis: { title: "Loss", gridcolor: "#1e293b" },
            legend: { orientation: "h", y: -0.15 },
          }), { responsive: true });
        }
      }
      mainEl.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;padding:4px 8px;" }, "Model weights not saved \u2014 showing training curves only."));
    }

    function _plotLossChart(epochs) {
      var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
      if (!Plotly || !_lossChartDiv || !epochs.length) return;
      var ep = epochs.map(function (e) { return e.epoch; });
      var loss = epochs.map(function (e) { return e.loss; });
      var valLoss = epochs.map(function (e) { return e.val_loss; });
      Plotly.newPlot(_lossChartDiv, [
        { x: ep, y: loss, mode: "lines", name: "Train Loss", line: { color: "#22d3ee" } },
        { x: ep, y: valLoss, mode: "lines", name: "Val Loss", line: { color: "#f59e0b" } },
      ], {
        paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
        title: { text: "Training Progress", font: { size: 12 } },
        xaxis: { title: "Epoch", gridcolor: "#1e293b" }, yaxis: { title: "Loss", gridcolor: "#1e293b" },
        legend: { orientation: "h", y: -0.15 },
        margin: { t: 30, b: 50, l: 50, r: 10 },
      }, { responsive: true });
    }

    // === RIGHT: training config ===
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      if (_configFormApi && typeof _configFormApi.destroy === "function") { _configFormApi.destroy(); _configFormApi = null; }

      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      if (!activeId) { rightEl.appendChild(el("h3", {}, "Config")); rightEl.appendChild(el("div", { className: "osc-empty" }, "Select a trainer.")); return; }
      var t = store ? store.getTrainerCard(activeId) : null;
      if (!t) return;
      var isStopping = t.status === "stopping";

      var hasEpochs = (store.getTrainerEpochs(activeId) || []).length > 0;
      var hasArtifacts = !!(t.modelArtifactsLast || t.modelArtifacts || t.modelArtifactsBest);
      var hasTrained = hasArtifacts || hasEpochs || t.status === "done" || t.status === "stopped";
      var isLocked = hasTrained && t.datasetId && t.modelId;

      rightEl.appendChild(el("h3", {}, hasTrained ? "Continue Training" : "Training Config"));

      if (isLocked) {
        var lockInfo = el("div", { style: "font-size:10px;color:#f59e0b;margin-bottom:6px;padding:4px 6px;border:1px solid #7c2d12;border-radius:4px;background:#431407;" });
        lockInfo.textContent = "Dataset + Model locked after training. Clear session to change.";
        rightEl.appendChild(lockInfo);
      }
      var currentArtifacts = t.modelArtifactsLast || t.modelArtifacts || t.modelArtifactsBest || null;
      var checkpointRef = _getCheckpointRef(currentArtifacts);
      if (currentArtifacts) {
        var checkpointInfo = el("div", { style: "font-size:10px;color:#94a3b8;margin-bottom:6px;padding:4px 6px;border:1px solid #334155;border-radius:4px;background:#0f172a;" });
        checkpointInfo.textContent = "Current checkpoint: " + (checkpointRef || "unversioned") + " | source=" + _resolveArtifactProducerRuntime(t, currentArtifacts);
        rightEl.appendChild(checkpointInfo);
      }

      // dataset + model selection (same schema)
      var schemaId = t.schemaId || _getSchemaId();
      var datasets = _listDatasets(schemaId);
      var models = _listModels(schemaId);
      var backends = _getAvailableBackends();
      var optTypes = trainingEngine ? trainingEngine.OPTIMIZER_TYPES : ["adam", "sgd", "rmsprop", "adagrad"];
      var lrTypes = trainingEngine ? trainingEngine.LR_SCHEDULER_TYPES : ["plateau", "step", "exponential", "cosine", "none"];

      var sra = getServerAdapter();
      var defaultServerUrl = sra ? sra.DEFAULT_SERVER : "http://localhost:3777";
      var hasServerAdapter = !!sra;
      var formSchema = [
        { key: "datasetId", label: "Dataset (" + schemaId + ")", type: "select", options: datasets.map(function (d) { return { value: d.id, label: (d.name || d.id) + (d.status === "ready" ? " \u2713" : " (draft)") }; }), disabled: isLocked || isStopping },
        { key: "modelId", label: "Model (" + schemaId + ")", type: "select", options: models.map(function (m) { return { value: m.id, label: m.name || m.id }; }), disabled: isLocked || isStopping },
        { key: "runtimeBackend", label: "Backend", type: "select", options: backends, disabled: isStopping },
      ];
      if (hasServerAdapter) {
        formSchema.push({ key: "useServer", label: "Use PyTorch Server", type: "checkbox", disabled: isStopping });
        formSchema.push({ key: "serverUrl", label: "Server URL", type: "text", placeholder: defaultServerUrl, disabled: isStopping });
      }
      formSchema = formSchema.concat([
        { key: "epochs", label: "Epochs", type: "number", min: 1, max: 1000, disabled: isStopping },
        { key: "batchSize", label: "Batch size", type: "number", min: 1, disabled: isStopping },
        { key: "learningRate", label: "Learning rate", type: "number", min: 0.0000001, step: 0.0001, disabled: isStopping },
        { key: "optimizerType", label: "Optimizer", type: "select", options: optTypes.map(function (t) { return { value: t, label: t }; }), disabled: isStopping },
        { key: "optimizerBeta1", label: "Adam beta1", type: "number", min: 0, max: 0.999999, step: 0.01, disabled: isStopping },
        { key: "optimizerBeta2", label: "Adam beta2", type: "number", min: 0, max: 0.999999, step: 0.001, disabled: isStopping },
        { key: "optimizerMomentum", label: "Momentum", type: "number", min: 0, max: 0.999999, step: 0.01, disabled: isStopping },
        { key: "optimizerRho", label: "RMSProp rho", type: "number", min: 0, max: 0.999999, step: 0.01, disabled: isStopping },
        { key: "optimizerEpsilon", label: "Opt epsilon", type: "number", min: 0.00000001, step: 0.00000001, disabled: isStopping },
        { key: "lrSchedulerType", label: "LR scheduler", type: "select", options: lrTypes.map(function (t) { return { value: t, label: t }; }), disabled: isStopping },
        { key: "earlyStoppingPatience", label: "Early stop patience", type: "number", min: 0, disabled: isStopping },
        { key: "restoreBestWeights", label: "Restore best weights", type: "checkbox", disabled: isStopping },
        { key: "lrPatience", label: "LR patience", type: "number", min: 1, disabled: isStopping },
        { key: "lrFactor", label: "LR factor", type: "number", min: 0.05, max: 0.99, step: 0.05, disabled: isStopping },
        { key: "minLr", label: "Min LR", type: "number", min: 0.0000001, step: 0.0000001, disabled: isStopping },
        { key: "gradClipNorm", label: "Grad clip norm (0=off)", type: "number", min: 0, step: 0.1, disabled: isStopping },
        { key: "gradClipValue", label: "Grad clip value (0=off)", type: "number", min: 0, step: 0.1, disabled: isStopping },
      ]);
      var config = Object.assign({}, t.trainCfg || {}, t.config || {});
      var formValue = {
        datasetId: t.datasetId || "", modelId: t.modelId || "",
        runtimeBackend: config.runtimeBackend || "auto",
        useServer: config.useServer != null ? config.useServer : true,
        serverUrl: config.serverUrl || defaultServerUrl,
        epochs: config.epochs || 20, batchSize: config.batchSize || 32, learningRate: config.learningRate || 0.001,
        optimizerType: config.optimizerType || "adam", lrSchedulerType: config.lrSchedulerType || "plateau",
        optimizerBeta1: config.optimizerBeta1 != null ? config.optimizerBeta1 : 0.9,
        optimizerBeta2: config.optimizerBeta2 != null ? config.optimizerBeta2 : 0.999,
        optimizerMomentum: config.optimizerMomentum != null ? config.optimizerMomentum : 0,
        optimizerRho: config.optimizerRho != null ? config.optimizerRho : 0.9,
        optimizerEpsilon: config.optimizerEpsilon != null ? config.optimizerEpsilon : 0.0000001,
        earlyStoppingPatience: config.earlyStoppingPatience != null ? config.earlyStoppingPatience : 5,
        restoreBestWeights: _resolveRestoreBestWeights(config), lrPatience: config.lrPatience || 3,
        lrFactor: config.lrFactor || 0.5, minLr: config.minLr || 0.000001,
        gradClipNorm: config.gradClipNorm || 0, gradClipValue: config.gradClipValue || 0,
      };

      // server status element (created before form so onChange can update it)
      var sraForPanel = getServerAdapter();
      var serverPanel = null;
      var serverStatusEl = null;
      if (sraForPanel) {
        serverPanel = el("div", { style: "margin-top:8px;padding:6px 8px;border:1px solid #1e293b;border-radius:6px;background:#0f172a;" });
        serverStatusEl = el("span", { style: "font-size:11px;" });
        if (_serverAvailable === true && _serverInfo) {
          serverStatusEl.style.color = "#4ade80";
          serverStatusEl.textContent = "\u2713 Connected: " + (_serverInfo.backend || "pytorch") + " (" + (_serverInfo.python || "python") + ")";
        } else if (_serverAvailable === false) {
          serverStatusEl.style.color = "#f43f5e";
          serverStatusEl.textContent = "\u2717 Server not reachable";
        } else {
          serverStatusEl.style.color = "#94a3b8";
          serverStatusEl.textContent = "Server: not checked";
        }
      }

      if (uiEngine && typeof uiEngine.renderConfigForm === "function") {
        var formMount = el("div", {});
        _configFormApi = uiEngine.renderConfigForm({
          mountEl: formMount, schema: formSchema, value: formValue,
          fieldNamePrefix: "train", rowClassName: "osc-form-row",
          onChange: function (cfg, ctx) {
            // save ONLY the changed field (not all defaults which would overwrite preset values)
            if (ctx && ctx.key && t) {
              if (!t.config || typeof t.config !== "object") t.config = {};
              t.config[ctx.key] = ctx.value;
              if (store) store.upsertTrainerCard(t);
            }
            // auto-check server when "Use PyTorch Server" is toggled on
            if (ctx && ctx.key === "useServer" && ctx.value && sraForPanel && serverStatusEl) {
              var urlInput = rightEl.querySelector("input[data-config-key='serverUrl']");
              var url = urlInput ? urlInput.value : "";
              _serverUrl = url;
              serverStatusEl.style.color = "#fbbf24";
              serverStatusEl.textContent = "Checking server...";
              _checkServerConnection(url, function (ok, info) {
                if (ok) {
                  serverStatusEl.style.color = "#4ade80";
                  serverStatusEl.textContent = "\u2713 Connected: " + (info && info.backend || "pytorch");
                  if (info && info.python) serverStatusEl.textContent += " (" + info.python + ")";
                } else {
                  serverStatusEl.style.color = "#f43f5e";
                  serverStatusEl.textContent = "\u2717 Cannot reach server \u2014 will fallback to client";
                }
              });
            }
          },
        });
        rightEl.appendChild(formMount);
      }

      // server connection panel
      if (serverPanel && serverStatusEl) {
        var refreshBtn = el("button", { style: "margin-left:6px;padding:1px 6px;font-size:12px;border-radius:4px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;", title: "Refresh connection" }, "\u21bb");
        refreshBtn.addEventListener("click", function () {
          var urlInput = rightEl.querySelector("input[data-config-key='serverUrl']");
          var url = urlInput ? urlInput.value : "";
          _serverUrl = url;
          serverStatusEl.style.color = "#fbbf24";
          serverStatusEl.textContent = "\u21bb Checking...";
          _checkServerConnection(url, function (ok, info) {
            if (ok) {
              serverStatusEl.style.color = "#4ade80";
              serverStatusEl.textContent = "\u2713 " + (info && info.backend || "pytorch");
            } else {
              serverStatusEl.style.color = "#f43f5e";
              serverStatusEl.textContent = "\u2717 Offline";
            }
          });
        });
        serverPanel.appendChild(serverStatusEl);
        serverPanel.appendChild(refreshBtn);
        rightEl.appendChild(serverPanel);
      }

      var runtimeDiag = _runtimeDiagForCard(t);
      var runtimeCard = el("div", { style: "margin-top:8px;padding:6px 8px;border:1px solid #1e293b;border-radius:6px;background:#0f172a;" });
      runtimeCard.appendChild(el("div", { style: "font-size:10px;color:#67e8f9;font-weight:600;margin-bottom:6px;" }, "Runtime Diagnostics"));
      [
        "requested_backend = " + String(runtimeDiag.requestedBackend || "auto"),
        "resolved_backend = " + String(runtimeDiag.resolvedBackend || "unknown"),
        "current_tf_backend = " + String(runtimeDiag.currentTfBackend || "unknown"),
        "execution_mode = " + String(runtimeDiag.executionMode || "unknown"),
        "runtime_source = " + String(runtimeDiag.source || "browser"),
        "status = " + String(runtimeDiag.status || "idle"),
        "auto_order = " + runtimeDiag.autoOrder.join(" -> "),
        "available_backends = " + ["webgl", "webgpu", "wasm", "cpu"].map(function (k) { return k + ":" + (runtimeDiag.availableBackends && runtimeDiag.availableBackends[k] ? "yes" : "no"); }).join(" | "),
        "secure_context = " + (runtimeDiag.secureContext ? "yes" : "no"),
        "navigator_gpu = " + (runtimeDiag.navigatorGpu ? "yes" : "no"),
        "worker_bridge = " + (runtimeDiag.workerBridge ? "yes" : "no"),
        "worker_api = " + (runtimeDiag.workerApi ? "yes" : "no"),
        "worker_available = " + (runtimeDiag.workerAvailable ? "yes" : "no"),
      ].forEach(function (line) {
        runtimeCard.appendChild(el("div", { style: "font-size:10px;color:#cbd5e1;line-height:1.45;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" }, line));
      });
      if (runtimeDiag.note) {
        runtimeCard.appendChild(el("div", { style: "font-size:10px;color:#fbbf24;line-height:1.45;margin-top:4px;" }, "note = " + runtimeDiag.note));
      }
      rightEl.appendChild(runtimeCard);

      // phase configuration (detected from model graph)
      if (t.modelId && modelBuilder) {
        var phModel = store ? store.getModel(t.modelId) : null;
        if (phModel && phModel.graph) {
          var phHeads = modelBuilder.inferOutputHeads(phModel.graph, [], "x");
          var phPhases = [];
          var phSeen = {};
          phHeads.forEach(function (h) {
            var p = String(h.phase || "").trim();
            if (p && !phSeen[p]) { phSeen[p] = true; phPhases.push(p); }
          });
          // detect weight tags from model graph
          var tagSet = {};
          var graphData2 = modelBuilder.extractGraphData ? modelBuilder.extractGraphData(phModel.graph) : {};
          Object.keys(graphData2).forEach(function (nid) {
            var nd = graphData2[nid];
            var wt = nd && nd.data && nd.data.weightTag;
            if (wt) tagSet[wt] = (tagSet[wt] || 0) + 1;
          });
          var tagKeys = Object.keys(tagSet);

          if (tagKeys.length > 0 || phPhases.length > 0) {
            if (!t.config) t.config = {};
            // init training schedule from phases+tags
            if (!Array.isArray(t.config.trainingSchedule) || !t.config.trainingSchedule.length) {
              if (phPhases.length > 0 && tagKeys.length > 0) {
                t.config.trainingSchedule = phPhases.map(function (p) {
                  var tr = {}; tagKeys.forEach(function (tag) { tr[tag] = (tag === p); }); return { epochs: 1, trainableTags: tr };
                });
              } else {
                var defTr = {}; tagKeys.forEach(function (tag) { defTr[tag] = true; });
                t.config.trainingSchedule = [{ epochs: 1, trainableTags: defTr }];
              }
            }
            if (t.config.rotateSchedule === undefined) t.config.rotateSchedule = true;

            var schCard = el("div", { style: "margin-top:8px;padding:6px 8px;border:1px solid #1e293b;border-radius:6px;background:#0f172a;" });
            schCard.appendChild(el("div", { style: "font-size:10px;color:#67e8f9;font-weight:600;margin-bottom:6px;" }, "Training Schedule"));
            if (tagKeys.length) {
              schCard.appendChild(el("div", { style: "font-size:9px;color:#94a3b8;margin-bottom:4px;" },
                "Tags: " + tagKeys.map(function (k) { return k + "(" + tagSet[k] + ")"; }).join(", ")));
            }

            t.config.trainingSchedule.forEach(function (step, si) {
              var sc = el("div", { style: "margin-bottom:5px;padding:4px 6px;border:1px solid #334155;border-radius:4px;background:#0b1220;" });
              var hr = el("div", { style: "display:flex;align-items:center;gap:3px;margin-bottom:2px;" });
              var upB = el("button", { style: "font-size:8px;padding:1px 3px;background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:2px;cursor:pointer;" }, "\u25B2");
              var dnB = el("button", { style: "font-size:8px;padding:1px 3px;background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:2px;cursor:pointer;" }, "\u25BC");
              var rmB = el("button", { style: "font-size:8px;padding:1px 3px;background:#1e293b;color:#f43f5e;border:1px solid #334155;border-radius:2px;cursor:pointer;" }, "\u2715");
              if (si === 0) upB.disabled = true;
              if (si >= t.config.trainingSchedule.length - 1) dnB.disabled = true;
              if (t.config.trainingSchedule.length <= 1) rmB.disabled = true;
              (function (idx) {
                upB.addEventListener("click", function () { var a = t.config.trainingSchedule; if (idx > 0) { var tmp = a[idx-1]; a[idx-1] = a[idx]; a[idx] = tmp; } if (store) store.upsertTrainerCard(t); _renderRightPanel(); });
                dnB.addEventListener("click", function () { var a = t.config.trainingSchedule; if (idx < a.length-1) { var tmp = a[idx+1]; a[idx+1] = a[idx]; a[idx] = tmp; } if (store) store.upsertTrainerCard(t); _renderRightPanel(); });
                rmB.addEventListener("click", function () { t.config.trainingSchedule.splice(idx, 1); if (store) store.upsertTrainerCard(t); _renderRightPanel(); });
              })(si);
              hr.appendChild(upB); hr.appendChild(dnB);
              hr.appendChild(el("span", { style: "font-size:10px;color:#e2e8f0;font-weight:600;flex:1;" }, "Step " + (si + 1)));
              hr.appendChild(rmB); sc.appendChild(hr);
              // epochs
              var er = el("div", { style: "display:flex;align-items:center;gap:4px;margin-bottom:2px;" });
              var ei = el("input", { type: "number", min: 1, max: 1000, step: 1, value: String(step.epochs || 1),
                style: "width:42px;padding:2px 4px;font-size:10px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:3px;text-align:center;" });
              (function (idx) { ei.addEventListener("change", function () { t.config.trainingSchedule[idx].epochs = Math.max(1, parseInt(ei.value) || 1); if (store) store.upsertTrainerCard(t); }); })(si);
              er.appendChild(ei); er.appendChild(el("span", { style: "font-size:9px;color:#64748b;" }, "epochs")); sc.appendChild(er);
              // tag checkboxes
              var tr = el("div", { style: "display:flex;flex-wrap:wrap;gap:4px;" });
              tagKeys.forEach(function (tag) {
                var lb = el("label", { style: "display:flex;align-items:center;gap:2px;font-size:10px;color:#e2e8f0;cursor:pointer;" });
                var cb = el("input", { type: "checkbox" }); cb.checked = step.trainableTags && step.trainableTags[tag];
                (function (idx, tg) { cb.addEventListener("change", function () { if (!t.config.trainingSchedule[idx].trainableTags) t.config.trainingSchedule[idx].trainableTags = {}; t.config.trainingSchedule[idx].trainableTags[tg] = cb.checked; if (store) store.upsertTrainerCard(t); }); })(si, tag);
                lb.appendChild(cb); lb.appendChild(document.createTextNode(tag)); tr.appendChild(lb);
              });
              sc.appendChild(tr);
              // clip weights input (WGAN)
              var cwRow = el("div", { style: "display:flex;align-items:center;gap:3px;margin-top:2px;" });
              cwRow.appendChild(el("span", { style: "font-size:9px;color:#64748b;" }, "clip weights:"));
              var cwInp = el("input", { type: "number", value: String(step.clipWeights || 0), min: 0, step: 0.001, style: "width:50px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:3px;padding:1px 3px;font-size:10px;" });
              (function (idx) { cwInp.addEventListener("change", function () { t.config.trainingSchedule[idx].clipWeights = Number(cwInp.value) || 0; if (store) store.upsertTrainerCard(t); }); })(si);
              cwRow.appendChild(cwInp);
              sc.appendChild(cwRow);
              schCard.appendChild(sc);
            });
            // add step
            var addBtn = el("button", { style: "font-size:9px;padding:3px 8px;background:#1e293b;color:#67e8f9;border:1px solid #334155;border-radius:3px;cursor:pointer;margin-top:3px;" }, "+ Add Step");
            addBtn.addEventListener("click", function () { var nt = {}; tagKeys.forEach(function (tag) { nt[tag] = true; }); t.config.trainingSchedule.push({ epochs: 1, trainableTags: nt }); if (store) store.upsertTrainerCard(t); _renderRightPanel(); });
            schCard.appendChild(addBtn);
            // rotate
            var rr = el("div", { style: "display:flex;align-items:center;gap:6px;margin-top:5px;padding-top:5px;border-top:1px solid #1e293b;" });
            var rc = el("input", { type: "checkbox" }); rc.checked = t.config.rotateSchedule !== false;
            rc.addEventListener("change", function () { t.config.rotateSchedule = rc.checked; if (store) store.upsertTrainerCard(t); });
            rr.appendChild(rc); rr.appendChild(el("span", { style: "font-size:10px;color:#e2e8f0;" }, "Rotate (repeat from step 1)"));
            schCard.appendChild(rr);
            rightEl.appendChild(schCard);
          }
        }
      }

      // buttons — show Stop only for the actively training trainer
      var btnRow = el("div", { style: "display:flex;gap:4px;margin-top:8px;" });
      if (_activeTrainingId === activeId && (_isTraining || t.status === "running" || t.status === "stopping")) {
        var stopBtn = el("button", { className: "osc-btn", style: "flex:1;background:linear-gradient(135deg,#dc2626,#991b1b);border-color:#ef4444;" }, t.status === "stopping" ? "Stopping..." : "Stop Training");
        if (t.status === "stopping") stopBtn.disabled = true;
        stopBtn.addEventListener("click", function () {
          if (stopBtn.disabled || _isStopRequestedRun(activeId, _trainingRunId)) return;
          stopBtn.disabled = true;
          stopBtn.textContent = "Stopping...";
          var cancelFn = _activeTrainingCancel;
          var tc = store ? store.getTrainerCard(activeId) : null;
          if (tc && tc.status === "stopping") {
            onStatus("Training stop already requested.");
            _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
            return;
          }
          var isServerRun = !!(tc && tc.config && tc.config.useServer);
          var isWorkerRun = !!(tc && tc.runtimeDiagnostics && tc.runtimeDiagnostics.executionMode === "worker");
          if ((isServerRun || isWorkerRun) && cancelFn) {
            _stopRequestedTrainingId = activeId;
            _stopRequestedRunId = _trainingRunId;
            tc.status = "stopping";
            _setRuntimeDiagnostics(tc, {
              executionMode: tc.runtimeDiagnostics && tc.runtimeDiagnostics.executionMode ? tc.runtimeDiagnostics.executionMode : (isServerRun ? "server" : "worker"),
              status: "stopping",
              note: "Training stop requested by user.",
            });
            if (store) store.upsertTrainerCard(tc);
            try { Promise.resolve(cancelFn()).catch(function () {}); } catch (_) {}
            onStatus(isServerRun ? "Stopping server training..." : "Stopping worker training...");
            _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
            return;
          }
          _trainingRunId++;
          _isTraining = false;
          _activeTrainingId = "";
          _activeTrainingCancel = null;
          try { if (_activeModel) _activeModel.stopTraining = true; } catch (_) {}
          var savedWeights = false;
          if (tc) {
            tc.status = "stopped";
            _setRuntimeDiagnostics(tc, {
              executionMode: tc.runtimeDiagnostics && tc.runtimeDiagnostics.executionMode ? tc.runtimeDiagnostics.executionMode : (tc.config && tc.config.useServer ? "server" : "browser"),
              status: "stopped",
              note: "Training stopped by user.",
            });
            // Only client main-thread training has live weights in _activeModel.
            if (_activeModel && !(tc.config && tc.config.useServer)) {
              try {
                var lastW = _extractWeightsFromModel(_activeModel);
                tc.modelArtifactsLast = lastW;
                if (!tc.modelArtifactsBest) tc.modelArtifactsBest = lastW;
                tc.modelArtifacts = lastW; // on stop, always use last
                tc.trainedOnServer = false;
                savedWeights = true;
              } catch (e) {}
            }
            store.upsertTrainerCard(tc);
          }
          if (cancelFn) {
            try { Promise.resolve(cancelFn()).catch(function () {}); } catch (_) {}
          }
          onStatus(savedWeights ? "Training stopped (weights saved)" : "Training stop requested");
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        });
        btnRow.appendChild(stopBtn);
      } else if (t.status === "stopping") {
        var stoppingBtn = el("button", { className: "osc-btn", style: "flex:1;background:linear-gradient(135deg,#475569,#334155);border-color:#64748b;" }, "Stopping...");
        stoppingBtn.disabled = true;
        btnRow.appendChild(stoppingBtn);
      } else {
        var trainLabel = hasTrained ? "Continue Training" : "Start Training";
        var trainBtn = el("button", { className: "osc-btn", style: "flex:1;" }, trainLabel);
        trainBtn.addEventListener("click", function () {
          if (trainBtn.disabled) return;
          trainBtn.disabled = true;
          trainBtn.textContent = "Starting...";
          _handleTrain();
          setTimeout(function () {
            if (!_isTraining && stateApi && stateApi.getActiveTrainer && stateApi.getActiveTrainer() === activeId) _renderRightPanel();
          }, 0);
        });
        btnRow.appendChild(trainBtn);
      }
      var exportBtn = el("button", { className: "osc-btn secondary", style: "flex:1;" }, "Export Notebook");
      exportBtn.addEventListener("click", function () { _handleExport(); });
      btnRow.appendChild(exportBtn);

      var runNbBtn = el("button", { className: "osc-btn secondary", style: "flex:1;" }, _isNotebookPreparing ? "Preparing..." : "Run Notebook");
      if (_isNotebookPreparing) {
        runNbBtn.disabled = true;
        runNbBtn.style.opacity = "0.6";
        runNbBtn.style.cursor = "not-allowed";
      }
      runNbBtn.addEventListener("click", function () {
        if (runNbBtn.disabled || _isNotebookPreparing) return;
        runNbBtn.disabled = true;
        runNbBtn.textContent = "Preparing...";
        _handleRunNotebook();
      });
      btnRow.appendChild(runNbBtn);
      rightEl.appendChild(btnRow);

      if (isStopping) {
        rightEl.style.position = "relative";
        var stoppingOverlay = el("div", {
          style: "position:absolute;inset:0;background:rgba(11,18,32,0.72);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:20;border-radius:8px;cursor:not-allowed;"
        });
        var stoppingMsg = el("div", {
          style: "padding:10px 12px;background:#0f172a;border:1px solid #475569;border-radius:8px;color:#e2e8f0;font-size:12px;text-align:center;max-width:220px;cursor:not-allowed;"
        }, [
          el("div", { style: "font-weight:600;color:#fbbf24;margin-bottom:4px;" }, "Stopping and saving weights"),
          el("div", { style: "font-size:11px;color:#cbd5e1;" }, "Wait until the trainer reaches 'stopped' before generating or continuing.")
        ]);
        stoppingOverlay.appendChild(stoppingMsg);
        rightEl.appendChild(stoppingOverlay);
      }

      // Export/Import trainer (config + weights)
      var eiRow = el("div", { style: "display:flex;gap:4px;margin-top:4px;" });
      var expTrainerBtn = el("button", { className: "osc-btn secondary", style: "flex:1;font-size:10px;" }, "Export Trainer");
      expTrainerBtn.addEventListener("click", function () {
        // Export: metadata as JSON + weights as binary, compressed with gzip
        var meta = {
          id: t.id, name: t.name, schemaId: t.schemaId, status: t.status,
          config: t.config, metrics: t.metrics, backend: t.backend, runtimeDiagnostics: t.runtimeDiagnostics,
          epochs: store ? store.getTrainerEpochs(activeId) : [],
          exportedAt: new Date().toISOString(),
        };
        // Extract weight values as Float32Array for binary storage
        var runtimeId = _resolveArtifactProducerRuntime(t, t.modelArtifactsLast || t.modelArtifacts || t.modelArtifactsBest || null);
        var artifacts = _normalizeCheckpointArtifacts(t.modelArtifactsLast || t.modelArtifacts || null, runtimeId);
        var artifactsBest = _normalizeCheckpointArtifacts(t.modelArtifactsBest || null, runtimeId);
        var weightSpecs = artifacts ? artifacts.weightSpecs : [];
        var weightFloats = artifacts && artifacts.weightValues ? new Float32Array(artifacts.weightValues) : new Float32Array(0);
        var bestFloats = artifactsBest && artifactsBest.weightValues ? new Float32Array(artifactsBest.weightValues) : null;
        meta.weightSpecs = weightSpecs;
        meta.hasBestWeights = !!bestFloats;
        meta.checkpoint = _describeCheckpointArtifacts(artifacts, runtimeId);
        meta.bestCheckpoint = artifactsBest ? _describeCheckpointArtifacts(artifactsBest, runtimeId) : null;
        meta.checkpointSchemaVersion = meta.checkpoint ? meta.checkpoint.schemaVersion : "";

        // Pack: [4 bytes meta length][meta JSON][last weights binary][best weights binary (optional)]
        var metaStr = JSON.stringify(meta);
        var metaBytes = new TextEncoder().encode(metaStr);
        var totalSize = 4 + metaBytes.length + weightFloats.byteLength + (bestFloats ? bestFloats.byteLength : 0);
        var packed = new ArrayBuffer(totalSize);
        var view = new DataView(packed);
        view.setUint32(0, metaBytes.length, true);
        new Uint8Array(packed, 4, metaBytes.length).set(metaBytes);
        new Uint8Array(packed, 4 + metaBytes.length, weightFloats.byteLength).set(new Uint8Array(weightFloats.buffer));
        if (bestFloats) {
          new Uint8Array(packed, 4 + metaBytes.length + weightFloats.byteLength, bestFloats.byteLength).set(new Uint8Array(bestFloats.buffer));
        }

        // Compress with gzip if available, else raw
        var fileName = (t.name || t.id).replace(/\s+/g, "_") + "_trainer.bin";
        if (typeof CompressionStream !== "undefined") {
          var cs = new CompressionStream("gzip");
          var writer = cs.writable.getWriter();
          writer.write(new Uint8Array(packed));
          writer.close();
          new Response(cs.readable).blob().then(function (gzBlob) {
            var url = URL.createObjectURL(gzBlob);
            var a = document.createElement("a"); a.href = url; a.download = fileName + ".gz"; a.click(); URL.revokeObjectURL(url);
            onStatus("Trainer exported: " + a.download + " (" + (gzBlob.size / 1024 / 1024).toFixed(1) + "MB)");
          });
        } else {
          var blob = new Blob([packed], { type: "application/octet-stream" });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a"); a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url);
          onStatus("Trainer exported: " + a.download + " (" + (blob.size / 1024 / 1024).toFixed(1) + "MB)");
        }
      });
      eiRow.appendChild(expTrainerBtn);

      var impTrainerBtn = el("button", { className: "osc-btn secondary", style: "flex:1;font-size:10px;" }, "Import Trainer");
      impTrainerBtn.addEventListener("click", function () {
        var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,.bin,.gz";
        inp.addEventListener("change", function () {
          var file = inp.files && inp.files[0];
          if (!file) return;
          onStatus("Importing " + file.name + "...");

          function _applyImport(data) {
            if (data.config) t.config = Object.assign(t.config || {}, data.config);
            if (data.metrics) t.metrics = data.metrics;
            if (data.modelArtifacts) t.modelArtifacts = _normalizeCheckpointArtifacts(data.modelArtifacts, (data.modelArtifacts && data.modelArtifacts.producerRuntime) || data.backend || "");
            if (data.modelArtifactsLast) t.modelArtifactsLast = _normalizeCheckpointArtifacts(data.modelArtifactsLast, (data.modelArtifactsLast && data.modelArtifactsLast.producerRuntime) || data.backend || "");
            if (data.modelArtifactsBest) t.modelArtifactsBest = _normalizeCheckpointArtifacts(data.modelArtifactsBest, (data.modelArtifactsBest && data.modelArtifactsBest.producerRuntime) || data.backend || "");
            if (data.status) t.status = data.status;
            if (data.backend) t.backend = data.backend;
            if (data.runtimeDiagnostics) t.runtimeDiagnostics = data.runtimeDiagnostics;
            if (data.epochs && store) store.replaceTrainerEpochs(activeId, data.epochs);
            if (store) store.upsertTrainerCard(t);
            onStatus("Trainer imported: " + file.name);
            _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          }

          function _parseBinary(buf) {
            var view = new DataView(buf);
            var metaLen = view.getUint32(0, true);
            var metaBytes = new Uint8Array(buf, 4, metaLen);
            var meta = JSON.parse(new TextDecoder().decode(metaBytes));
            var weightStart = 4 + metaLen;
            var specs = meta.weightSpecs || [];
            var totalWeightFloats = specs.reduce(function (s, sp) { return s + sp.shape.reduce(function (a, b) { return a * b; }, 1); }, 0);
            // Copy to aligned buffer (meta length may not be multiple of 4)
            var lastBytes = new Uint8Array(buf, weightStart, totalWeightFloats * 4);
            var lastAligned = new ArrayBuffer(totalWeightFloats * 4);
            new Uint8Array(lastAligned).set(lastBytes);
            var lastWeights = Array.from(new Float32Array(lastAligned));
            meta.modelArtifactsLast = _normalizeCheckpointArtifacts({ weightSpecs: specs, weightValues: lastWeights, checkpoint: meta.checkpoint || null }, (meta.checkpoint && meta.checkpoint.producerRuntime) || meta.backend || "");
            meta.modelArtifacts = meta.modelArtifactsLast;
            if (meta.hasBestWeights) {
              var bestStart = weightStart + totalWeightFloats * 4;
              var bestBytes = new Uint8Array(buf, bestStart, totalWeightFloats * 4);
              var bestAligned = new ArrayBuffer(totalWeightFloats * 4);
              new Uint8Array(bestAligned).set(bestBytes);
              var bestWeights = Array.from(new Float32Array(bestAligned));
              meta.modelArtifactsBest = _normalizeCheckpointArtifacts({ weightSpecs: specs, weightValues: bestWeights, checkpoint: meta.bestCheckpoint || meta.checkpoint || null }, (meta.bestCheckpoint && meta.bestCheckpoint.producerRuntime) || (meta.checkpoint && meta.checkpoint.producerRuntime) || meta.backend || "");
            }
            return meta;
          }

          if (file.name.endsWith(".json")) {
            var reader = new FileReader();
            reader.onload = function () { try { _applyImport(JSON.parse(reader.result)); } catch (e) { onStatus("Import failed: " + e.message); } };
            reader.readAsText(file);
          } else {
            // Binary format (.bin or .bin.gz)
            file.arrayBuffer().then(function (rawBuf) {
              if (file.name.endsWith(".gz") && typeof DecompressionStream !== "undefined") {
                var ds = new DecompressionStream("gzip");
                var writer = ds.writable.getWriter();
                writer.write(new Uint8Array(rawBuf));
                writer.close();
                return new Response(ds.readable).arrayBuffer();
              }
              return rawBuf;
            }).then(function (buf) {
              try { _applyImport(_parseBinary(buf)); } catch (e) { onStatus("Import failed: " + e.message); }
            }).catch(function (e) { onStatus("Import failed: " + e.message); });
          }
        });
        inp.click();
      });
      eiRow.appendChild(impTrainerBtn);
      rightEl.appendChild(eiRow);

      // clear session button
      if (hasTrained) {
        var clearBtn = el("button", { className: "osc-btn secondary", style: "width:100%;margin-top:4px;border-color:#7c2d12;color:#fdba74;" }, "Reset Training (keep dataset/model)");
        clearBtn.addEventListener("click", function () {
          if (!confirm("Reset training history? Dataset and model will be kept.")) return;
          t.status = "draft";
          t.metrics = null;
          t.modelArtifacts = null;
          t.modelArtifactsLast = null;
          t.modelArtifactsBest = null;
          t.backend = null;
          // keep t.datasetId and t.modelId — just unlock config
          if (store) { store.upsertTrainerCard(t); store.replaceTrainerEpochs(activeId, []); }
          onStatus("Training reset — config unlocked");
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        });
        rightEl.appendChild(clearBtn);
      }

      // info
      rightEl.appendChild(el("div", { style: "margin-top:12px;font-size:10px;color:#64748b;" },
        "Auto = TF.js client (WebGPU \u2192 WebGL \u2192 WASM \u2192 CPU). " +
        "Select 'PyTorch Server' to train on remote GPU."));
    }

    function _handleTrain() {
      if (_isTraining) { onStatus("Already training"); return; }
      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      var tCard = activeId && store ? store.getTrainerCard(activeId) : null;
      if (!tCard) { onStatus("Select a trainer"); return; }
      if (tCard.status === "stopping") { onStatus("Trainer is still stopping and saving weights. Please wait."); return; }

      var formConfig = _configFormApi && typeof _configFormApi.getConfig === "function" ? _configFormApi.getConfig() : {};
      // merge: tCard.config (has trainingSchedule, classFilter etc.) + form values (has epochs, lr etc.)
      var config = Object.assign({}, tCard.config || {}, formConfig);
      if (!config.datasetId) { onStatus("Select a dataset"); return; }
      if (!config.modelId) { onStatus("Select a model"); return; }

      var dataset = store ? store.getDataset(config.datasetId) : null;
      var model = store ? store.getModel(config.modelId) : null;
      if (!dataset || !dataset.data) { onStatus("Dataset not ready — generate first"); return; }
      if (!model || !model.graph) { onStatus("Model has no graph — save from Model tab first"); return; }
      if (dataset.schemaId !== model.schemaId) { onStatus("Schema mismatch: " + dataset.schemaId + " vs " + model.schemaId); return; }

      // ensure source is loaded for source-backed datasets
      var _W = typeof window !== "undefined" ? window : {};
      var _srcReg = _W.OSCDatasetSourceRegistry || null;
      if (dataset.data.sourceId && _srcReg && !_srcReg.has(dataset.data.sourceId)) {
        onStatus("Loading source data...");
        var _dm = _W.OSCDatasetModules;
        var _mods = (_dm && typeof _dm.getModuleForSchema === "function") ? _dm.getModuleForSchema(dataset.schemaId) : [];
        var _dsMod = _mods.length ? _dm.getModule(_mods[0].id) : null;
        if (_dsMod && typeof _dsMod.build === "function") {
          _dsMod.build({ seed: 42, totalCount: 1, variant: dataset.data.datasetModuleId || dataset.schemaId }).then(function () {
            onStatus("Source loaded. Click Start Training again.");
          }).catch(function (err) {
            onStatus("Source load error: " + err.message);
          });
          return;
        }
      }

      var tf = getTf();
      if (!tf) { onStatus("TF.js not loaded"); return; }
      if (!modelBuilder) { onStatus("Model builder not available"); return; }
      if (!trainingEngine) { onStatus("Training engine not available"); return; }

      var schemaId = tCard.schemaId;
      var allowedOutputKeys = schemaRegistry ? schemaRegistry.getOutputKeys(schemaId) : [];
      // read target from model graph (not schema)
      var _defOk2 = allowedOutputKeys.length ? (allowedOutputKeys[0].key || allowedOutputKeys[0]) : "";
      var _heads = modelBuilder ? modelBuilder.inferOutputHeads(model.graph, allowedOutputKeys, _defOk2) : [];
      var defaultTarget = (_heads.length && _heads[0].target) ? _heads[0].target : _defOk2;
      var defaultHeadType2 = (_heads.length && _heads[0].headType) ? _heads[0].headType : "regression";
      var dsData = dataset.data;
      var isBundle = dsData.kind === "dataset_bundle" && dsData.datasets;
      var activeDs = isBundle ? dsData.datasets[dsData.activeVariantId || Object.keys(dsData.datasets)[0]] : dsData;
      // resolve data via source registry (zero-copy) or legacy records
      var W = typeof window !== "undefined" ? window : {};
      var srcReg = W.OSCDatasetSourceRegistry || null;
      var sourceDescriptorHelper = W.OSCDatasetSourceDescriptor || null;
      var normalizedSourceDescriptor = sourceDescriptorHelper && typeof sourceDescriptorHelper.normalize === "function"
        ? sourceDescriptorHelper.normalize(activeDs && activeDs.sourceDescriptor)
        : (activeDs && activeDs.sourceDescriptor ? activeDs.sourceDescriptor : null);
      var useServerDatasetReference = !!(normalizedSourceDescriptor && sourceDescriptorHelper && typeof sourceDescriptorHelper.shouldUseServerReference === "function"
        ? sourceDescriptorHelper.shouldUseServerReference(normalizedSourceDescriptor)
        : normalizedSourceDescriptor);
      if (!activeDs.xTrain) {
        if (useServerDatasetReference) {
          activeDs = Object.assign({}, activeDs, {
            xTrain: [], yTrain: [],
            xVal: [], yVal: [],
            xTest: [], yTest: [],
            labelsTrain: activeDs.labelsTrain || [],
            labelsVal: activeDs.labelsVal || [],
            labelsTest: activeDs.labelsTest || [],
            featureSize: Number(activeDs.featureSize || 0),
            numClasses: Number(activeDs.numClasses || activeDs.classCount || 0),
            targetMode: defaultTarget,
            sourceDescriptor: normalizedSourceDescriptor,
          });
        } else {
        var nClasses = activeDs.classCount || activeDs.numClasses || 10;
        var isClassification2 = defaultHeadType2 === "classification";
        var isReconstruction2 = defaultHeadType2 === "reconstruction" || (!isClassification2 && defaultHeadType2 !== "classification");
        function oneHot(label, n) { var arr = new Array(n).fill(0); arr[label] = 1; return arr; }
        function resolveSplit(ds, split) {
          if (srcReg && typeof srcReg.resolveDatasetSplit === "function") return srcReg.resolveDatasetSplit(ds, split);
          var rec = ds.records && ds.records[split];
          return rec ? { x: rec.x || [], y: rec.y || [], length: (rec.x || []).length } : { x: [], y: [], length: 0 };
        }
        var train = resolveSplit(activeDs, "train");
        var val = resolveSplit(activeDs, "val");
        var test = resolveSplit(activeDs, "test");
        function mapY(splitData) {
          if (isClassification2) return splitData.y.map(function (l) { return typeof l === "number" ? oneHot(l, nClasses) : l; });
          if (isReconstruction2) return splitData.x; // y = x for reconstruction
          return splitData.y;
        }
        var resolvedFeatureSize = (srcReg && typeof srcReg.getFeatureSize === "function") ? srcReg.getFeatureSize(activeDs) : 0;
        if (!resolvedFeatureSize && train.x.length) resolvedFeatureSize = train.x[0].length;
        // for multi-head models (VAE+Classifier): provide labels separately
        var hasClsHead = _heads && _heads.some(function (h) { return h.headType === "classification"; });
        activeDs = {
          xTrain: train.x, yTrain: mapY(train),
          xVal: val.x, yVal: mapY(val),
          xTest: test.x, yTest: mapY(test),
          featureSize: resolvedFeatureSize || activeDs.featureSize || 1,
          numClasses: nClasses,
          targetMode: defaultTarget,
        };
        // add raw labels for classification heads (before one-hot mapping)
        if (hasClsHead && !isClassification2) {
          activeDs.labelsTrain = train.y.map(function (l) { return typeof l === "number" ? oneHot(l, nClasses) : l; });
          activeDs.labelsVal = val.y.map(function (l) { return typeof l === "number" ? oneHot(l, nClasses) : l; });
          activeDs.labelsTest = test.y.map(function (l) { return typeof l === "number" ? oneHot(l, nClasses) : l; });
        }
        activeDs.sourceDescriptor = normalizedSourceDescriptor;
        }
      }

      var graphMode = modelBuilder.inferGraphMode(model.graph, "direct");
      var featureSize = Number(activeDs.featureSize || (activeDs.xTrain && activeDs.xTrain[0] && activeDs.xTrain[0].length) || 1);

      var buildResult;
      try {
        buildResult = modelBuilder.buildModelFromGraph(tf, model.graph, {
          mode: graphMode, featureSize: featureSize,
          seqFeatureSize: Number(activeDs.seqFeatureSize || featureSize),
          windowSize: Number(activeDs.windowSize || 1),
          allowedOutputKeys: allowedOutputKeys, defaultTarget: defaultTarget,
          paramNames: activeDs.paramNames, paramSize: activeDs.paramSize, numClasses: activeDs.numClasses || activeDs.classCount || 10,
        });
      } catch (err) { onStatus("Build error: " + err.message); return; }

      var isPhasedRun = trainingEngine.needsPhasedTraining && trainingEngine.needsPhasedTraining(buildResult.headConfigs);

      var resumeArtifacts = _getResumeArtifacts(tCard);
      if (resumeArtifacts) {
        try {
          var resumeLoad = _loadArtifactsIntoTfModel(tf, buildResult.model, resumeArtifacts);
          if (!resumeLoad || !resumeLoad.loaded) {
            onStatus("Resume checkpoint ignored: " + ((resumeLoad && resumeLoad.reason) || "weight_load_failed"));
            resumeArtifacts = null;
          } else {
            onStatus("Loaded saved checkpoint into training model.");
          }
        } catch (resumeErr) {
          console.warn("[trainer] Resume checkpoint load failed:", resumeErr.message);
          onStatus("Resume checkpoint ignored: " + resumeErr.message);
          resumeArtifacts = null;
        }
      }

      // update trainer
      tCard.datasetId = config.datasetId;
      tCard.modelId = config.modelId;
      tCard.status = "running";
      tCard.error = "";
      tCard.config = config;
      var initialExecutionMode = Boolean(config.useServer) ? "server" : ((isPhasedRun || !_getWorkerSupport().available) ? "main-thread" : "worker");
      _setRuntimeDiagnostics(tCard, {
        requestedBackend: String(config.runtimeBackend || "auto"),
        executionMode: initialExecutionMode,
        source: Boolean(config.useServer) ? "server" : "browser",
        status: "preparing",
        note: "Preparing training session.",
        resolvedBackend: "",
      });
      var epochRowsBefore = store ? (store.getTrainerEpochs(activeId) || []) : [];
      var resumeEpochOffset = 0;
      if (resumeArtifacts && epochRowsBefore.length) {
        resumeEpochOffset = epochRowsBefore.reduce(function (maxEpoch, row) {
          var epochNum = Number((row && row.epoch) || 0);
          return epochNum > maxEpoch ? epochNum : maxEpoch;
        }, 0);
      }
      if (store) {
        store.upsertTrainerCard(tCard);
        if (!resumeArtifacts) store.replaceTrainerEpochs(activeId, []);
      }
      _isTraining = true;
      _trainingRunId++;
      delete _testCache[activeId]; // invalidate cached test results
      var currentRunId = _trainingRunId;
      var runtimeRunId = activeId + "--run-" + currentRunId + "-" + Date.now().toString(36);
      _activeTrainingCancel = null;
      _stopRequestedTrainingId = "";
      _stopRequestedRunId = 0;
      _activeTrainingId = activeId;
      _subTab = "train";
      onStatus("Training... (serializing model)");
      _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();

      var currentMountId = _mountId;

      var W = typeof window !== "undefined" ? window : {};
      var backend = String(config.runtimeBackend || "auto");
      var useServer = Boolean(config.useServer);
      var serverAdapter = getServerAdapter();
      var serverUrl = String(config.serverUrl || (serverAdapter && serverAdapter.DEFAULT_SERVER) || "");

      // PyTorch Server: when useServer is checked — try server first, fallback to client
      if (useServer && serverAdapter) {
        _setRuntimeDiagnostics(tCard, {
          executionMode: "server",
          source: "server",
          status: "checking_server",
          note: "Checking PyTorch server availability.",
        });
        onStatus("Checking PyTorch Server...");
        _checkServerConnection(serverUrl, function (ok) {
          _renderRightPanel(); // update server status display with full info
          if (!_isCurrentTrainingRun(activeId, currentRunId)) return;
          if (!ok) {
            // first training → fallback to client. Continue training of server model → need server.
            if (tCard.trainedOnServer) {
              _setRuntimeDiagnostics(tCard, {
                executionMode: "server",
                source: "server",
                status: "error",
                note: "Server required for this trainer but is not reachable.",
              });
              onStatus("Server not reachable. This model was trained on server \u2014 restart server to continue, or create new trainer for client.");
              _isTraining = false; _activeTrainingCancel = null; tCard.status = tCard.status === "training" ? "done" : tCard.status;
              if (store) store.upsertTrainerCard(tCard);
              _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
              return;
            }
            _setRuntimeDiagnostics(tCard, {
              executionMode: _getWorkerSupport().available ? "worker" : "main-thread",
              source: "browser",
              status: "fallback_client",
              note: "Server not reachable, falling back to browser training.",
            });
            onStatus("Server not reachable \u2014 training on client (" + backend + ")");
            _runClientTraining();
            return;
          }
          _setRuntimeDiagnostics(tCard, {
            executionMode: "server",
            source: "server",
            resolvedBackend: String((_serverInfo && _serverInfo.backend) || "pytorch"),
            status: "running",
            note: "Training on PyTorch server.",
          });
          onStatus("Server connected \u2014 training on PyTorch...");
          _activeModel = buildResult.model;
          var taskRecipeId = (schemaRegistry && typeof schemaRegistry.getTaskRecipeId === "function")
            ? String(schemaRegistry.getTaskRecipeId(schemaId) || "supervised_standard")
            : "supervised_standard";
          // server OK — proceed with server training
          var serverRun = serverAdapter.runTrainingOnServer({
          runId: runtimeRunId,
          schemaId: schemaId,
          taskRecipeId: taskRecipeId,
          graph: model.graph,
          modelArtifacts: resumeArtifacts,
          dataset: {
            mode: graphMode, featureSize: featureSize, targetMode: activeDs.targetMode || defaultTarget,
            schemaId: schemaId,
            datasetModuleId: activeDs.moduleId || activeDs.module || "",
            taskRecipeId: taskRecipeId,
            sourceDescriptor: activeDs.sourceDescriptor || null,
            xTrain: activeDs.xTrain, yTrain: activeDs.yTrain, xVal: activeDs.xVal, yVal: activeDs.yVal,
            xTest: activeDs.xTest, yTest: activeDs.yTest,
            pTrain: activeDs.pTrain, pVal: activeDs.pVal, pTest: activeDs.pTest,
            paramNames: activeDs.paramNames, paramSize: activeDs.paramSize,
            numClasses: activeDs.numClasses || activeDs.classCount || 0,
          },
          headConfigs: buildResult.headConfigs,
          epochs: Number(config.epochs || 20), batchSize: Number(config.batchSize || 32),
          learningRate: Number(config.learningRate || 0.001), optimizerType: String(config.optimizerType || "adam"),
          optimizerBeta1: config.optimizerBeta1 != null ? Number(config.optimizerBeta1) : undefined,
          optimizerBeta2: config.optimizerBeta2 != null ? Number(config.optimizerBeta2) : undefined,
          optimizerMomentum: config.optimizerMomentum != null ? Number(config.optimizerMomentum) : undefined,
          optimizerRho: config.optimizerRho != null ? Number(config.optimizerRho) : undefined,
          optimizerEpsilon: config.optimizerEpsilon != null ? Number(config.optimizerEpsilon) : undefined,
          lrSchedulerType: String(config.lrSchedulerType || "plateau"),
          earlyStoppingPatience: config.earlyStoppingPatience != null ? Number(config.earlyStoppingPatience) : 5,
          restoreBestWeights: _resolveRestoreBestWeights(config, buildResult.headConfigs),
          weightSelection: String(config.weightSelection || ""),
          gradClipNorm: Number(config.gradClipNorm || 0),
          shuffleTrain: config.shuffleTrain !== false,
          lrPatience: Number(config.lrPatience || 3),
          lrFactor: Number(config.lrFactor || 0.5),
          minLr: Number(config.minLr || 0.000001),
          trainingSchedule: config.trainingSchedule || null,
          rotateSchedule: config.rotateSchedule !== false,
          onEpochData: function (payload) {
            var logEntry = { epoch: resumeEpochOffset + Number(payload.epoch || 0), loss: payload.loss, val_loss: payload.val_loss, current_lr: payload.current_lr, improved: payload.improved, phaseLosses: payload.phaseLosses || null };
            if (!_appendTrainerEpochForRun(activeId, currentRunId, logEntry)) return;
            var phaseStr = "";
            if (payload.phaseLosses && typeof payload.phaseLosses === "object") {
              phaseStr = " | " + Object.keys(payload.phaseLosses).map(function (k) {
                return k + ":" + Number(payload.phaseLosses[k]).toExponential(3);
              }).join(" ");
            }
            var valStr = payload.val_loss != null ? Number(payload.val_loss).toExponential(3) : "\u2014";
            onStatus("Epoch " + payload.epoch + " | loss=" + Number(payload.loss).toExponential(3) + " | val=" + valStr + phaseStr + (payload.improved ? " *" : ""));
          },
          onStatus: function (msg) { onStatus(msg); },
          onReady: function (msg) {
            if (!_isCurrentTrainingRun(activeId, currentRunId)) return;
            _setRuntimeDiagnostics(tCard, {
              executionMode: "server",
              source: "server",
              resolvedBackend: String((msg && msg.backend) || "pytorch"),
              status: "running",
              note: "Server runtime initialized.",
            });
            if (store) store.upsertTrainerCard(tCard);
            if (_isTrainerTrainViewVisible(activeId)) _renderRightPanel();
            onStatus("Server ready: " + (msg.backend || "pytorch"));
          },
        }, {
          serverUrl: String(config.serverUrl || serverAdapter.DEFAULT_SERVER),
        });
        _activeTrainingCancel = (serverRun && typeof serverRun.cancel === "function")
          ? function () { return serverRun.cancel(); }
          : null;
        serverRun.then(function (result) {
          if (!_isCurrentTrainingRun(activeId, currentRunId)) {
            _activeModel = null;
            buildResult.model.dispose();
            return;
          }
          var wasStopRequested = _isStopRequestedRun(activeId, currentRunId) || !!(result && result.stoppedByUser);
          _isTraining = false;
          _activeTrainingCancel = null;
          _stopRequestedTrainingId = "";
          _stopRequestedRunId = 0;
          _activeTrainingId = "";
          tCard.status = wasStopRequested ? "stopped" : "done";
          tCard.metrics = result;
          if (!tCard.metrics.paramCount) tCard.metrics.paramCount = buildResult.model.countParams();
          tCard.backend = result.resolvedBackend || result.backend || "pytorch";
          _setRuntimeDiagnostics(tCard, {
            executionMode: "server",
            source: "server",
            resolvedBackend: String(result.resolvedBackend || result.backend || "pytorch"),
            status: wasStopRequested ? "stopped" : "done",
            note: wasStopRequested ? "Server training stopped by user." : "Server training completed.",
          });
          tCard.trainedOnServer = true;
          if (!tCard.config) tCard.config = {};
          tCard.config.useServer = true;
          tCard.config.serverUrl = serverUrl;
          if (result.modelArtifacts) {
            if (result.modelArtifacts.weightData && !result.modelArtifacts.weightValues) {
              result.modelArtifacts.weightValues = result.modelArtifacts.weightData;
              delete result.modelArtifacts.weightData;
            }
            // Save weight names from model for name-based loading
            if (!result.modelArtifacts.weightSpecs || !result.modelArtifacts.weightSpecs[0] || !result.modelArtifacts.weightSpecs[0].name) {
              try {
                var wMeta = buildResult.model.weights || [];
                if (result.modelArtifacts.weightSpecs) {
                  result.modelArtifacts.weightSpecs.forEach(function(sp, i) { if (wMeta[i]) sp.name = wMeta[i].name; });
                }
              } catch(e) {}
            }
            result.modelArtifacts = _normalizeCheckpointArtifacts(result.modelArtifacts, "python_server");
            tCard.modelArtifacts = result.modelArtifacts;
            tCard.modelArtifactsLast = result.modelArtifacts;
          }
          if (store) store.upsertTrainerCard(tCard);
          onStatus(wasStopRequested
            ? "\u2713 Stopped (PyTorch weights saved)"
            : "\u2713 Done (PyTorch): MAE=" + (result.mae != null ? Number(result.mae).toExponential(3) : "—"));
          if (_isTrainerTrainViewVisible(activeId) || (stateApi && stateApi.getActiveTrainer() === activeId)) { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
          _activeModel = null;
          buildResult.model.dispose();
        }).catch(function (err) {
          if (!_isCurrentTrainingRun(activeId, currentRunId)) {
            _activeModel = null;
            buildResult.model.dispose();
            return;
          }
          var wasStopRequested = _isStopRequestedRun(activeId, currentRunId);
          _activeModel = null;
          _activeTrainingCancel = null;
          var msg = String(err.message || "");
          // dataset too large for server → fallback to client training
          if (msg.indexOf("too large") >= 0 || msg.indexOf("transfer") >= 0) {
            _setRuntimeDiagnostics(tCard, {
              executionMode: _getWorkerSupport().available ? "worker" : "main-thread",
              source: "browser",
              status: "fallback_client",
              note: "Server transfer too large, falling back to browser training.",
            });
            onStatus("Server: " + msg + " \u2014 training on client");
            _runClientTraining();
            return;
          }
          if (wasStopRequested) {
            _isTraining = false;
            _stopRequestedTrainingId = "";
            _stopRequestedRunId = 0;
            _activeTrainingId = "";
            tCard.status = "stopped";
            _setRuntimeDiagnostics(tCard, {
              executionMode: "server",
              source: "server",
              status: "stopped",
              note: "Server training stopped by user.",
            });
            if (store) store.upsertTrainerCard(tCard);
            onStatus("Training stopped");
            if (_isTrainerTrainViewVisible(activeId) || (stateApi && stateApi.getActiveTrainer() === activeId)) { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
            buildResult.model.dispose();
            return;
          }
          _isTraining = false;
          _activeTrainingCancel = null;
          _activeTrainingId = "";
          tCard.status = "error"; tCard.error = msg;
          _setRuntimeDiagnostics(tCard, {
            executionMode: "server",
            source: "server",
            status: "error",
            note: msg || "Server training failed.",
          });
          if (store) store.upsertTrainerCard(tCard);
          onStatus("Server error: " + msg);
          if (_isTrainerTrainViewVisible(activeId) || (stateApi && stateApi.getActiveTrainer() === activeId)) { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
          buildResult.model.dispose();
        });
        }); // close checkServer.then
        return; // don't fall through to client path
      } // close if (useServer)

      _runClientTraining();
      return;

      function _runClientTraining() {
      var _isPhased = isPhasedRun;
      // === WORKER PATH (non-blocking) ===
      var W = typeof window !== "undefined" ? window : {};
      var workerBridge = W.OSCTrainingWorkerBridge;
      // Phased training must stay on the main thread until the worker implements
      // the same schedule/tag semantics as training_engine_core.
      var useWorker = !_isPhased && workerBridge && typeof workerBridge.runTrainingInWorker === "function";
      if (useWorker) {
        // resolve worker path from script tags (handles subdirectory demos)
        var _workerUrl = "./src/training_worker.js";
        try {
          var _scripts = document.querySelectorAll("script[src*='training_worker']");
          if (_scripts.length) _workerUrl = _scripts[0].src;
          else {
            var _anySrc = document.querySelector("script[src*='training_engine_core']");
            if (_anySrc) _workerUrl = _anySrc.src.replace("training_engine_core", "training_worker");
          }
        } catch (_) {}
        try { var _tw = new Worker(_workerUrl); _tw.terminate(); } catch (e) { useWorker = false; console.warn("[trainer] Worker not available:", e.message); }
      }

      if (useWorker) {
        _setRuntimeDiagnostics(tCard, {
          executionMode: "worker",
          source: "browser",
          status: "running",
          note: "Training in TF.js worker.",
        });
        // === WORKER PATH (non-blocking) ===
        buildResult.model.save(tf.io.withSaveHandler(function (artifacts) {
          onStatus("Training via TF.js Worker (" + (config.runtimeBackend || "auto") + ")...");

          var workerRun = workerBridge.runTrainingInWorker({
            runId: runtimeRunId,
            modelArtifacts: artifacts,
            isSequence: buildResult.isSequence,
            headConfigs: buildResult.headConfigs,
            dataset: {
              mode: graphMode,
              windowSize: Number(activeDs.windowSize || 1),
              seqFeatureSize: Number(activeDs.seqFeatureSize || featureSize),
              featureSize: featureSize,
              targetMode: activeDs.targetMode || defaultTarget,
              targetSize: buildResult.headConfigs.length === 1 ? (buildResult.headConfigs[0].units || 1) : 1,
              paramSize: Number(activeDs.paramSize || 0),
              paramNames: activeDs.paramNames || [],
              xTrain: activeDs.xTrain, yTrain: activeDs.yTrain, seqTrain: activeDs.seqTrain || [],
              xVal: activeDs.xVal, yVal: activeDs.yVal, seqVal: activeDs.seqVal || [],
              xTest: activeDs.xTest || [], yTest: activeDs.yTest || [], seqTest: activeDs.seqTest || [],
              pTrain: activeDs.pTrain || [], pVal: activeDs.pVal || [], pTest: activeDs.pTest || [],
            },
            runtimeConfig: {
              runtimeId: "js_client",
              backend: String(config.runtimeBackend || "auto"),
              backendOrder: _normalizeClientBackendOrder(config.runtimeBackendOrder),
            },
            epochs: Number(config.epochs || 20),
            batchSize: Number(config.batchSize || 32),
            learningRate: Number(config.learningRate || 0.001),
            optimizerType: String(config.optimizerType || "adam"),
            optimizerBeta1: config.optimizerBeta1 != null ? Number(config.optimizerBeta1) : undefined,
            optimizerBeta2: config.optimizerBeta2 != null ? Number(config.optimizerBeta2) : undefined,
            optimizerMomentum: config.optimizerMomentum != null ? Number(config.optimizerMomentum) : undefined,
            optimizerRho: config.optimizerRho != null ? Number(config.optimizerRho) : undefined,
            optimizerEpsilon: config.optimizerEpsilon != null ? Number(config.optimizerEpsilon) : undefined,
            lrSchedulerType: String(config.lrSchedulerType || "plateau"),
            useLrScheduler: String(config.lrSchedulerType || "plateau") !== "none",
            earlyStoppingPatience: config.earlyStoppingPatience != null ? Number(config.earlyStoppingPatience) : 5,
            restoreBestWeights: _resolveRestoreBestWeights(config, buildResult.headConfigs),
            lrPatience: Number(config.lrPatience || 3),
            lrFactor: Number(config.lrFactor || 0.5),
            minLr: Number(config.minLr || 0.000001),
            gradClipNorm: Number(config.gradClipNorm || 0),
            gradClipValue: Number(config.gradClipValue || 0),
            shuffleTrain: config.shuffleTrain !== false,
            onEpochData: function (payload) {
              var logEntry = { epoch: resumeEpochOffset + Number(payload.epoch || 0), loss: payload.loss, val_loss: payload.val_loss, current_lr: payload.current_lr, improved: payload.improved };
              _appendTrainerEpochForRun(activeId, currentRunId, logEntry);
            },
            onReady: function (msg) {
              if (!_isCurrentTrainingRun(activeId, currentRunId)) return;
              var resolved = String((msg && msg.backend) || config.runtimeBackend || "auto");
              _setRuntimeDiagnostics(tCard, {
                executionMode: "worker",
                source: "browser",
                resolvedBackend: resolved,
                status: "running",
                note: "Worker runtime initialized.",
              });
              if (store) store.upsertTrainerCard(tCard);
              if (_isTrainerTrainViewVisible(activeId)) _renderRightPanel();
              onStatus("Worker ready: " + resolved);
            },
            onStatus: function (msg) { onStatus(msg); },
          }, {
            workerPath: _workerUrl,
          });
          _activeTrainingCancel = (workerRun && typeof workerRun.cancel === "function")
            ? function () { return workerRun.cancel(); }
            : null;
          workerRun.then(function (result) {
            if (!_isCurrentTrainingRun(activeId, currentRunId)) {
              buildResult.model.dispose();
              return;
            }
            _isTraining = false;
            _activeTrainingCancel = null;
            _activeTrainingId = "";
            tCard.status = "done";
            tCard.metrics = result;
            tCard.backend = result.resolvedBackend || String(config.runtimeBackend || "auto");
            _setRuntimeDiagnostics(tCard, {
              executionMode: "worker",
              source: "browser",
              resolvedBackend: String(result.resolvedBackend || config.runtimeBackend || "auto"),
              status: "done",
              note: "Worker training completed.",
            });
            // convert worker's ArrayBuffer to JSON-safe array before store.upsert
            if (result.modelArtifacts) {
              var wa = _normalizeCheckpointArtifacts(result.modelArtifacts, "js_client");
              if (wa.weightData && wa.weightData.byteLength) {
                wa.weightValues = Array.from(new Float32Array(wa.weightData));
                delete wa.weightData;
              }
              tCard.modelArtifacts = wa;
              tCard.modelArtifactsLast = wa;
              tCard.modelArtifactsBest = wa;
            }
            tCard.trainedOnServer = false;
            if (store) store.upsertTrainerCard(tCard);
            onStatus("\u2713 Done (Worker): MAE=" + (result.mae != null ? Number(result.mae).toExponential(3) : "—"));
            if (_isTrainerTrainViewVisible(activeId) || (stateApi && stateApi.getActiveTrainer() === activeId)) { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
            buildResult.model.dispose();
          }).catch(function (err) {
            if (!_isCurrentTrainingRun(activeId, currentRunId)) {
              buildResult.model.dispose();
              return;
            }
            _isTraining = false;
            _activeTrainingCancel = null;
            _activeTrainingId = "";
            tCard.status = "error"; tCard.error = err.message;
            _setRuntimeDiagnostics(tCard, {
              executionMode: "worker",
              source: "browser",
              status: "error",
              note: err.message || "Worker training failed.",
            });
            if (store) store.upsertTrainerCard(tCard);
            onStatus("Worker error: " + err.message);
            if (_isTrainerTrainViewVisible(activeId) || (stateApi && stateApi.getActiveTrainer() === activeId)) { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
            buildResult.model.dispose();
          });

          return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: "JSON" } };
        }));

      } else {
        // === FALLBACK: main thread (will freeze UI) ===
        var _trainFn = _isPhased && trainingEngine.trainModelPhased ? trainingEngine.trainModelPhased : trainingEngine.trainModel;
        _activeModel = buildResult.model;
        _activeTrainingCancel = function () {
          try { if (_activeModel) _activeModel.stopTraining = true; } catch (_) {}
        };
        var _myRunId = currentRunId;
        _ensureClientBackend(tf, config.runtimeBackend, config.runtimeBackendOrder).then(function (resolvedBackend) {
        _setRuntimeDiagnostics(tCard, {
          executionMode: "main-thread",
          source: "browser",
          resolvedBackend: resolvedBackend,
          status: "running",
          note: "Training on browser main thread.",
        });
        if (currentMountId === _mountId) _renderRightPanel();
        onStatus("Training on TF.js (" + (_isPhased ? "phased" : "main thread") + ", " + resolvedBackend + ") — train:" + (activeDs.xTrain ? activeDs.xTrain.length : 0) + " val:" + (activeDs.xVal ? activeDs.xVal.length : 0) + " test:" + (activeDs.xTest ? activeDs.xTest.length : 0));
        return _trainFn(tf, {
          model: buildResult.model, isSequence: buildResult.isSequence, headConfigs: buildResult.headConfigs, inputNodes: buildResult.inputNodes || [], phaseSwitchConfigs: buildResult.phaseSwitchConfigs || [],
          shouldStop: function () { return !_isTraining || _trainingRunId !== _myRunId; },
          dataset: {
            xTrain: activeDs.xTrain, yTrain: activeDs.yTrain, seqTrain: activeDs.seqTrain,
            xVal: activeDs.xVal, yVal: activeDs.yVal, seqVal: activeDs.seqVal,
            xTest: activeDs.xTest, yTest: activeDs.yTest, seqTest: activeDs.seqTest,
            pTrain: activeDs.pTrain, pVal: activeDs.pVal, pTest: activeDs.pTest,
            targetMode: activeDs.targetMode || defaultTarget,
            paramNames: activeDs.paramNames, paramSize: activeDs.paramSize, numClasses: activeDs.numClasses || activeDs.classCount,
            labelsTrain: activeDs.labelsTrain, labelsVal: activeDs.labelsVal, labelsTest: activeDs.labelsTest,
          },
          epochs: Number(config.epochs || 20), batchSize: Number(config.batchSize || 32),
          learningRate: Number(config.learningRate || 0.001),
          optimizerType: String(config.optimizerType || "adam"),
          optimizerBeta1: config.optimizerBeta1 != null ? Number(config.optimizerBeta1) : undefined,
          optimizerBeta2: config.optimizerBeta2 != null ? Number(config.optimizerBeta2) : undefined,
          optimizerMomentum: config.optimizerMomentum != null ? Number(config.optimizerMomentum) : undefined,
          optimizerRho: config.optimizerRho != null ? Number(config.optimizerRho) : undefined,
          optimizerEpsilon: config.optimizerEpsilon != null ? Number(config.optimizerEpsilon) : undefined,
          lrSchedulerType: String(config.lrSchedulerType || "plateau"),
          earlyStoppingPatience: config.earlyStoppingPatience != null ? Number(config.earlyStoppingPatience) : 5,
          restoreBestWeights: _resolveRestoreBestWeights(config, buildResult.headConfigs),
          lrPatience: Number(config.lrPatience || 3),
          lrFactor: Number(config.lrFactor || 0.5),
          minLr: Number(config.minLr || 0.000001),
          gradClipNorm: Number(config.gradClipNorm || 0),
          gradClipValue: Number(config.gradClipValue || 0),
          shuffleTrain: config.shuffleTrain !== false,
          trainingSchedule: config.trainingSchedule || null,
          rotateSchedule: config.rotateSchedule !== false,
          onEpochEnd: function (epoch, logs) {
            var logEntry = { epoch: resumeEpochOffset + epoch + 1, loss: logs.loss, val_loss: logs.val_loss, current_lr: logs.current_lr, improved: logs.improved, phaseLosses: logs.phaseLosses || null };
            _appendTrainerEpochForRun(activeId, currentRunId, logEntry);
          },
        }).then(function (result) {
          if (!_isCurrentTrainingRun(activeId, currentRunId)) {
            _activeModel = null;
            buildResult.model.dispose();
            return;
          }
          _isTraining = false;
          _activeTrainingCancel = null;
          _activeTrainingId = "";
          tCard.status = "done";
          tCard.metrics = result;
          if (!tCard.metrics.paramCount) tCard.metrics.paramCount = buildResult.model.countParams();
          tCard.backend = resolvedBackend || (tf.getBackend && tf.getBackend()) || String(config.runtimeBackend || "auto");
          _setRuntimeDiagnostics(tCard, {
            executionMode: "main-thread",
            source: "browser",
            resolvedBackend: String(resolvedBackend || (tf.getBackend && tf.getBackend()) || "cpu"),
            status: "done",
            note: "Main-thread training completed.",
          });
          // Save both last and best weights
          try {
            var lastArtifacts = _normalizeCheckpointArtifacts(_extractWeightsFromModel(buildResult.model), "js_client");
            tCard.modelArtifactsLast = lastArtifacts;
            // Best weights: if restoreBestWeights was on, model already has best.
            // If off, model has last. Best is stored separately during training via result.
            if (result.bestWeightValues) {
              tCard.modelArtifactsBest = _normalizeCheckpointArtifacts({ weightSpecs: lastArtifacts.weightSpecs, weightValues: result.bestWeightValues }, "js_client");
            } else {
              tCard.modelArtifactsBest = lastArtifacts; // fallback: last = best
            }
            // Active artifacts based on config selection
            var sel = _resolveWeightSelection(config, buildResult.headConfigs);
            tCard.modelArtifacts = sel === "last" ? tCard.modelArtifactsLast : tCard.modelArtifactsBest;
          } catch (e) {
            console.warn("[trainer] Weight save failed:", e.message);
          }
          tCard.trainedOnServer = false;
          if (store) store.upsertTrainerCard(tCard);
          onStatus("\u2713 Done: MAE=" + (result.mae != null ? Number(result.mae).toExponential(3) : "—"));
          if (_isTrainerTrainViewVisible(activeId) || (stateApi && stateApi.getActiveTrainer() === activeId)) { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
          _activeModel = null;
          buildResult.model.dispose();
        }).catch(function (err) {
          if (!_isCurrentTrainingRun(activeId, currentRunId)) {
            _activeModel = null;
            buildResult.model.dispose();
            return;
          }
          _isTraining = false;
          _activeTrainingCancel = null;
          _activeTrainingId = "";
          _activeModel = null;
          tCard.status = "error"; tCard.error = err.message;
          _setRuntimeDiagnostics(tCard, {
            executionMode: "main-thread",
            source: "browser",
            status: "error",
            note: err.message || "Main-thread training failed.",
          });
          if (store) store.upsertTrainerCard(tCard);
          onStatus("Error: " + err.message);
          if (_isTrainerTrainViewVisible(activeId) || (stateApi && stateApi.getActiveTrainer() === activeId)) { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
          buildResult.model.dispose();
        });
        }).catch(function (err) {
          if (!_isCurrentTrainingRun(activeId, currentRunId)) {
            _activeModel = null;
            buildResult.model.dispose();
            return;
          }
          _isTraining = false;
          _activeTrainingCancel = null;
          _activeTrainingId = "";
          _activeModel = null;
          tCard.status = "error"; tCard.error = String(err && err.message ? err.message : err);
          _setRuntimeDiagnostics(tCard, {
            executionMode: "main-thread",
            source: "browser",
            status: "error",
            note: tCard.error || "Backend initialization failed.",
          });
          if (store) store.upsertTrainerCard(tCard);
          onStatus("Backend error: " + tCard.error);
          if (_isTrainerTrainViewVisible(activeId) || (stateApi && stateApi.getActiveTrainer() === activeId)) { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
          buildResult.model.dispose();
        });
      }
      } // end _runClientTraining
    }

    function _handleExport() {
      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      var tCard = activeId && store ? store.getTrainerCard(activeId) : null;
      if (!tCard) { onStatus("Select a trainer"); return; }
      if (!tCard.datasetId || !tCard.modelId) { onStatus("Set dataset + model first"); return; }

      var dataset = store ? store.getDataset(tCard.datasetId) : null;
      var model = store ? store.getModel(tCard.modelId) : null;
      if (!dataset || !dataset.data) { onStatus("Dataset not ready"); return; }
      if (!model || !model.graph) { onStatus("Model has no graph"); return; }

      var W = typeof window !== "undefined" ? window : {};
      var NBC = W.OSCNotebookCore || null;
      var DBA = W.OSCDatasetBundleAdapter || null;
      if (!NBC || typeof NBC.createSingleNotebookFileFromConfig !== "function") {
        onStatus("Notebook export module not available");
        return;
      }

      onStatus("Exporting notebook...");
      try {
        var config = _configFormApi && typeof _configFormApi.getConfig === "function" ? _configFormApi.getConfig() : {};

        var NRA = W.OSCNotebookRuntimeAssets || null;
        var runtimeFiles = NRA && NRA.files ? Object.keys(NRA.files) : [];
        var runtimeLoader = NRA && NRA.files ? function (name) { return NRA.files[name] || ""; } : null;

        var exportPrepared = _prepareDatasetForNotebookExport(dataset.data, W);
        var exportDsData = exportPrepared.dataset;

        NBC.createNotebookBundleZipFromConfig({
          seed: 42,
          zipFileName: String(tCard.name || "trainer").replace(/\s+/g, "_") + "_bundle.zip",
          datasetBundleAdapter: DBA,
          runtimeFiles: runtimeFiles,
          runtimeLoader: runtimeLoader,
          sessions: [{
            id: tCard.id,
            name: tCard.name || "session",
            schemaId: tCard.schemaId,
            graph: model.graph,
            runtime: "python_server",
            epochs: Number(config.epochs || 20),
            batchSize: Number(config.batchSize || 32),
            learningRate: Number(config.learningRate || 0.001),
            datasetData: exportDsData,
            datasetCsvPath: "dataset.csv",
            modelGraphPath: "model_graph.json",
          }],
        }).then(function (result) {
          if (!result) { onStatus("Export returned empty"); return; }
          var blob = result.blob || null;
          var fileName = result.fileName || (tCard.name || "notebook") + ".zip";

          if (!blob) {
            // try to create blob from buffer/text
            var text = result.buffer || result.text || result.notebookText || null;
            if (text) blob = new Blob([text], { type: "application/x-ipynb+json" });
          }
          if (!blob) { onStatus("Export produced no downloadable file"); return; }

          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = fileName;
          a.click();
          URL.revokeObjectURL(a.href);
          onStatus("\u2713 Exported: " + fileName);
        }).catch(function (err) { onStatus("Export error: " + err.message); });
      } catch (err) {
        onStatus("Export error: " + err.message);
      }
    }

    function _handleRunNotebook() {
      var W = typeof window !== "undefined" ? window : {};
      var runner = W.OSCNotebookRunnerUI || null;
      if (!runner || typeof runner.open !== "function") { onStatus("Notebook runner module not loaded"); return; }
      if (_isNotebookPreparing) { onStatus("Notebook is already being prepared"); return; }

      var activeId = stateApi ? stateApi.getActiveTrainer() : "";
      var tCard = activeId && store ? store.getTrainerCard(activeId) : null;
      if (!tCard) { onStatus("Select a trainer"); return; }
      if (!tCard.datasetId || !tCard.modelId) { onStatus("Set dataset + model first"); return; }

      var dataset = store ? store.getDataset(tCard.datasetId) : null;
      var model = store ? store.getModel(tCard.modelId) : null;
      if (!dataset || !dataset.data) { onStatus("Generate the dataset first"); return; }
      if (!model || !model.graph) { onStatus("Model has no graph"); return; }

      var NBC = W.OSCNotebookCore || null;
      if (!NBC || typeof NBC.createSingleNotebookFileFromConfig !== "function") {
        onStatus("Notebook export module not available"); return;
      }

      var config = _configFormApi && typeof _configFormApi.getConfig === "function" ? _configFormApi.getConfig() : {};
      var sra0 = getServerAdapter();
      var runnerServerUrl0 = String((config && config.serverUrl) || (tCard && tCard.config && tCard.config.serverUrl) || (sra0 ? (sra0.DEFAULT_SERVER || "http://localhost:3777") : "http://localhost:3777"));
      _isNotebookPreparing = true;
      onStatus("Preparing notebook...");
      if (runner && typeof runner.showBusy === "function") {
        runner.showBusy({
          serverUrl: runnerServerUrl0,
          message: "Packaging trainer, graph, runtime, and dataset for the notebook runner..."
        });
      }
      if (stateApi && stateApi.getActiveTrainer && stateApi.getActiveTrainer() === activeId) _renderRightPanel();

      var NRA = W.OSCNotebookRuntimeAssets || null;
      var runtimeFiles = NRA && NRA.files ? Object.keys(NRA.files) : [];
      var runtimeLoader = NRA && NRA.files ? function (name) { return NRA.files[name] || ""; } : null;

      setTimeout(function () {
        var exportPrepared = _prepareDatasetForNotebookExport(dataset.data, W);
        var exportDsData = exportPrepared.dataset;

        var notebookRowLimit = Math.max(1000, Math.floor(Number((config && config.notebookRowLimit) || (tCard && tCard.config && tCard.config.notebookRowLimit) || 10000) || 10000));
        var preview = exportPrepared.usesServerReference
          ? { dataset: exportDsData, truncated: false, totalRows: 0, keptRows: 0 }
          : _limitNotebookDatasetRows(exportDsData, notebookRowLimit);
        var notebookDsData = preview.dataset || exportDsData;
        if (runner && typeof runner.updateBusy === "function") {
          runner.updateBusy(
            preview.truncated
              ? ("Building interactive notebook with a preview subset (" + preview.keptRows + " of " + preview.totalRows + " rows)...")
              : "Building interactive notebook..."
          );
        }

        NBC.createSingleNotebookFileFromConfig({
          seed: 42,
          runtimeFiles: runtimeFiles,
          runtimeLoader: runtimeLoader,
          returnObject: true,
          sessions: [{
            id: tCard.id,
            name: tCard.name || "session",
            schemaId: tCard.schemaId,
            graph: model.graph,
            runtime: "python_server",
            epochs: Number(config.epochs || 20),
            batchSize: Number(config.batchSize || 32),
            learningRate: Number(config.learningRate || 0.001),
            datasetData: notebookDsData,
            modelArtifacts: tCard.modelArtifacts || null,
          }],
        }).then(function (result) {
          if (!result) throw new Error("Notebook generation returned empty");
          var notebookObj = result.notebook || null;
          if (!notebookObj && result.buffer) {
            try { notebookObj = JSON.parse(typeof result.buffer === "string" ? result.buffer : new TextDecoder().decode(result.buffer)); } catch (e) {}
          }
          if (!notebookObj && result.blob) {
            return result.blob.text().then(function (text) {
              try { notebookObj = JSON.parse(text); } catch (e) {}
              return notebookObj;
            });
          }
          return notebookObj;
        }).then(function (notebookObj) {
          _isNotebookPreparing = false;
          if (stateApi && stateApi.getActiveTrainer && stateApi.getActiveTrainer() === activeId) _renderRightPanel();
          if (!notebookObj) {
            if (runner && typeof runner.updateBusy === "function") runner.updateBusy("Failed to parse notebook", "error");
            onStatus("Failed to parse notebook");
            return;
          }
          runner.open({ notebook: notebookObj, serverUrl: runnerServerUrl0, onArtifacts: function (artifacts) {
            if (!artifacts || !artifacts.weightSpecs || !store) return;
            var card = store.getTrainerCard(activeId);
            if (!card) return;
            var fmt = W.OSCCheckpointFormatCore || null;
            var normalized = fmt && typeof fmt.normalizeArtifacts === "function"
              ? fmt.normalizeArtifacts(artifacts, { producerRuntime: "notebook" })
              : artifacts;
            card.modelArtifacts = normalized;
            card.modelArtifactsLast = normalized;
            card.status = "done";
            if (artifacts.metrics) card.metrics = artifacts.metrics;
            store.upsertTrainerCard(card);
            onStatus("Weights loaded from notebook into trainer '" + (card.name || activeId) + "'");
            _renderLeftPanel();
            _renderMainPanel();
          }});
          onStatus(preview.truncated ? ("Notebook opened (preview dataset: " + preview.keptRows + " rows)") : "Notebook opened");
        }).catch(function (err) {
          _isNotebookPreparing = false;
          if (stateApi && stateApi.getActiveTrainer && stateApi.getActiveTrainer() === activeId) _renderRightPanel();
          if (runner && typeof runner.updateBusy === "function") runner.updateBusy("Notebook error: " + err.message, "error");
          onStatus("Notebook error: " + err.message);
        });
      }, 30);
    }

    function mount() {
      _mountId++; _subTab = "train";
      _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
      // always recheck server on mount (heartbeat)
      _checkServerConnection("", function () { _renderRightPanel(); });
    }
    function unmount() { _mountId++; if (_configFormApi && typeof _configFormApi.destroy === "function") _configFormApi.destroy(); _configFormApi = null; _lossChartDiv = null; _epochTableBody = null; layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { mount(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

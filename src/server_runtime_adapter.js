(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCServerRuntimeAdapter = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Server Runtime Adapter
   *
   * Same contract as training_worker_bridge.js but sends training to a local
   * Node.js server that spawns a Python subprocess (PyTorch).
   *
   * Communication:
   *   POST /api/train       → start training (sends dataset + graph + config)
   *   GET  /api/train/:id   → SSE stream of epoch logs + completion
   *
   * Callbacks (same as Worker bridge):
   *   spec.onReady(msg)           → server accepted the job
   *   spec.onEpochData(payload)   → epoch completed
   *   spec.onStatus(msg)          → status message
   *   result → { mae, mse, bestEpoch, bestValLoss, modelArtifacts: { weightSpecs, weightValues }, resolvedBackend }
   */

  var DEFAULT_SERVER = "http://localhost:3777";
  function getCheckpointFormat() {
    var W = typeof window !== "undefined" ? window : {};
    return W.OSCCheckpointFormatCore || null;
  }

  function stopTrainingOnServer(jobId, serverUrl) {
    var url = String(serverUrl || DEFAULT_SERVER).replace(/\/$/, "");
    var id = String(jobId || "").trim();
    if (!id) return Promise.reject(new Error("Job id required"));
    return fetch(url + "/api/train/" + encodeURIComponent(id) + "/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).then(function (res) {
      if (!res.ok) throw new Error("Server stop returned " + res.status);
      return res.json();
    });
  }

  function resolveRestoreBestWeights(spec) {
    var cfg = spec && typeof spec === "object" ? spec : {};
    if (typeof cfg.restoreBestWeights === "boolean") return cfg.restoreBestWeights;
    var weightSelection = String(cfg.weightSelection || "").trim().toLowerCase();
    if (weightSelection === "last") return false;
    if (weightSelection === "best") return true;
    if (Array.isArray(cfg.trainingSchedule) && cfg.trainingSchedule.length) return false;
    var heads = Array.isArray(cfg.headConfigs) ? cfg.headConfigs : [];
    if (heads.some(function (h) { return String((h && h.phase) || "").trim() !== ""; })) return false;
    return true;
  }

  /**
   * POST JSON to server — gzip compressed if payload is large.
   * Uses CompressionStream (native browser API) to avoid V8 string limit.
   */
  function _postJson(url, payload, onProgress) {
    // try direct JSON.stringify first (fast for small payloads)
    var jsonStr;
    try { jsonStr = JSON.stringify(payload); } catch (_) { jsonStr = null; }

    if (jsonStr && jsonStr.length < 50000000) {
      // small payload — send directly
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: jsonStr,
      }).then(function (res) {
        if (!res.ok) throw new Error("Server returned " + res.status);
        return res.json();
      });
    }

    // large payload — stream JSON in chunks, gzip compress, send
    if (typeof ReadableStream !== "function") {
      return Promise.reject(new Error("Dataset too large. Use a modern browser with ReadableStream support."));
    }

    // separate large arrays from metadata
    var meta = Object.assign({}, payload, { dataset: Object.assign({}, payload.dataset) });
    var ds = meta.dataset;
    var largeKeys = [];
    ["xTrain", "yTrain", "xVal", "yVal", "xTest", "yTest"].forEach(function (k) {
      if (ds[k] && ds[k].length > 100) { largeKeys.push({ key: k, data: ds[k] }); ds[k] = "__STREAM__"; }
    });
    var metaStr = JSON.stringify(meta);

    // build emit queue: interleave text + array segments
    var emitQueue = [];
    var remaining = metaStr;
    for (var si = 0; si < largeKeys.length; si++) {
      var seg = largeKeys[si];
      var ph = '"' + seg.key + '":"__STREAM__"';
      var phIdx = remaining.indexOf(ph);
      if (phIdx < 0) continue;
      if (phIdx > 0) emitQueue.push({ t: "s", v: remaining.substring(0, phIdx) });
      emitQueue.push({ t: "a", k: seg.key, d: seg.data });
      remaining = remaining.substring(phIdx + ph.length);
    }
    if (remaining) emitQueue.push({ t: "s", v: remaining });

    // pull-based ReadableStream — yields rows one at a time, non-blocking
    var encoder = new TextEncoder();
    var qIdx = 0, rowIdx = 0, inArray = false;
    var stream = new ReadableStream({
      pull: function (ctrl) {
        var batchLimit = 200; // rows per pull to stay responsive
        var emitted = 0;
        while (qIdx < emitQueue.length) {
          var item = emitQueue[qIdx];
          if (item.t === "s") { ctrl.enqueue(encoder.encode(item.v)); qIdx++; continue; }
          if (!inArray) { ctrl.enqueue(encoder.encode('"' + item.k + '":[')); inArray = true; rowIdx = 0; }
          while (rowIdx < item.d.length && emitted < batchLimit) {
            ctrl.enqueue(encoder.encode((rowIdx > 0 ? "," : "") + JSON.stringify(item.d[rowIdx])));
            rowIdx++; emitted++;
            if (onProgress && rowIdx % 5000 === 0) onProgress("Streaming " + item.k + ": " + rowIdx + "/" + item.d.length);
          }
          if (rowIdx >= item.d.length) { ctrl.enqueue(encoder.encode("]")); inArray = false; qIdx++; }
          if (emitted >= batchLimit) return; // yield to event loop
        }
        ctrl.close();
      },
    });

    // gzip if available
    var bodyStream = stream;
    var headers = { "Content-Type": "application/json" };
    if (typeof CompressionStream === "function") {
      bodyStream = stream.pipeThrough(new CompressionStream("gzip"));
      headers["Content-Encoding"] = "gzip";
    }

    if (onProgress) onProgress("Compressing...");
    return new Response(bodyStream).blob().then(function (blob) {
      if (onProgress) onProgress("Sending " + (blob.size / 1024 / 1024).toFixed(0) + "MB to server...");
      return fetch(url, { method: "POST", headers: headers, body: blob });
    }).then(function (res) {
      if (!res.ok) throw new Error("Server returned " + res.status);
      return res.json();
    });
  }

  function runTrainingOnServer(rawSpec, rawDeps) {
    var spec = rawSpec && typeof rawSpec === "object" ? rawSpec : {};
    var deps = rawDeps && typeof rawDeps === "object" ? rawDeps : {};
    var serverUrl = String(deps.serverUrl || DEFAULT_SERVER).replace(/\/$/, "");

    var ds = spec.dataset || {};
    var payload = {
      runId: String(spec.runId || ("srv-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36))),
      schemaId: String(spec.schemaId || ""),
      graph: spec.graph || {},
      runtimeConfig: spec.runtimeConfig || { runtimeId: "python_server", backend: "cuda" },
      dataset: {
        mode: String(ds.mode || "direct"),
        featureSize: Number(ds.featureSize || 1),
        targetMode: String(ds.targetMode || "xv"),
        xTrain: ds.xTrain || [], yTrain: ds.yTrain || [],
        xVal: ds.xVal || [], yVal: ds.yVal || [],
        xTest: ds.xTest || [], yTest: ds.yTest || [],
        pTrain: ds.pTrain || [], pVal: ds.pVal || [], pTest: ds.pTest || [],
        paramNames: ds.paramNames || [], paramSize: Number(ds.paramSize || 0),
        numClasses: Number(ds.numClasses || 0),
      },
      headConfigs: spec.headConfigs || [],
      epochs: Number(spec.epochs || 20),
      batchSize: Number(spec.batchSize || 32),
      learningRate: Number(spec.learningRate || 1e-3),
      optimizerType: String(spec.optimizerType || "adam"),
      optimizerBeta1: spec.optimizerBeta1 != null ? Number(spec.optimizerBeta1) : undefined,
      optimizerBeta2: spec.optimizerBeta2 != null ? Number(spec.optimizerBeta2) : undefined,
      optimizerMomentum: spec.optimizerMomentum != null ? Number(spec.optimizerMomentum) : undefined,
      optimizerRho: spec.optimizerRho != null ? Number(spec.optimizerRho) : undefined,
      optimizerEpsilon: spec.optimizerEpsilon != null ? Number(spec.optimizerEpsilon) : undefined,
      lrSchedulerType: String(spec.lrSchedulerType || "plateau"),
      earlyStoppingPatience: spec.earlyStoppingPatience != null ? Number(spec.earlyStoppingPatience) : 5,
      restoreBestWeights: resolveRestoreBestWeights(spec),
      weightSelection: String(spec.weightSelection || ""),
      gradClipNorm: Number(spec.gradClipNorm || 0),
      shuffleTrain: spec.shuffleTrain !== false,
      lrPatience: Number(spec.lrPatience || 3),
      lrFactor: Number(spec.lrFactor || 0.5),
      minLr: Number(spec.minLr || 1e-6),
      trainingSchedule: spec.trainingSchedule || null,
      rotateSchedule: spec.rotateSchedule !== false,
    };

    var cancelFn = null;
    var evtSource = null;
    var settled = false;
    var jobId = "";
    var stopRequested = false;
    function _normalizeServerResult(fullResult) {
      var out = fullResult || {};
      if (out.modelArtifacts && out.modelArtifacts.weightData && !out.modelArtifacts.weightValues) {
        out.modelArtifacts.weightValues = out.modelArtifacts.weightData;
        delete out.modelArtifacts.weightData;
      }
      var fmt = getCheckpointFormat();
      if (fmt && out.modelArtifacts && typeof fmt.normalizeArtifacts === "function") {
        out.modelArtifacts = fmt.normalizeArtifacts(out.modelArtifacts, {
          producerRuntime: String(out.backend || out.resolvedBackend || "python_server"),
        });
      }
      out.resolvedBackend = out.backend || out.resolvedBackend || "pytorch";
      return out;
    }
    function _fetchServerResult() {
      return fetch(serverUrl + "/api/train/" + jobId + "/result").then(function (r) {
        if (!r.ok) throw new Error("Failed to fetch weights: " + r.status);
        return r.json();
      }).then(_normalizeServerResult);
    }
    function _recoverStoppedResult(reject, resolve) {
      var tries = 0;
      function poll() {
        tries += 1;
        _fetchServerResult().then(resolve).catch(function (err) {
          if (tries >= 20) {
            reject(new Error("Server stop completed but result was unavailable: " + err.message));
            return;
          }
          setTimeout(poll, 250);
        });
      }
      poll();
    }
    var promise = new Promise(function (resolve, reject) {
      // POST with gzip compression for large payloads
      var statusCb = typeof spec.onStatus === "function" ? spec.onStatus : function () {};
      statusCb("Compressing dataset for server transfer...");
      _postJson(serverUrl + "/api/train", payload, statusCb).then(function (startResult) {
        jobId = startResult.jobId || payload.runId;
        if (typeof spec.onReady === "function") {
          spec.onReady({ backend: startResult.backend || "pytorch" });
        }
        if (typeof spec.onStatus === "function") {
          spec.onStatus("Training on server (job: " + jobId + ")...");
        }

        // Connect to SSE stream for epoch updates
        evtSource = new EventSource(serverUrl + "/api/train/" + jobId);

        evtSource.addEventListener("epoch", function (evt) {
          try {
            var data = JSON.parse(evt.data);
            if (typeof spec.onEpochData === "function") {
              spec.onEpochData({
                epoch: data.epoch,
                loss: data.loss,
                val_loss: data.val_loss,
                current_lr: data.current_lr,
                improved: data.improved,
                phaseLosses: data.phaseLosses || null,
              });
            }
          } catch (e) { /* ignore parse errors */ }
        });

        evtSource.addEventListener("status", function (evt) {
          if (typeof spec.onStatus === "function") {
            spec.onStatus(evt.data);
          }
        });

        evtSource.addEventListener("complete", function (evt) {
          if (settled) return;
          settled = true;
          evtSource.close();
          try {
            var lightResult = JSON.parse(evt.data);
            // if server has artifacts, fetch full result (weights) separately
            if (lightResult.hasArtifacts) {
              if (typeof spec.onStatus === "function") spec.onStatus("Training done — downloading weights...");
              _fetchServerResult().then(resolve).catch(function (e) { reject(new Error("Weight download failed: " + e.message)); });
            } else {
              resolve(_normalizeServerResult(lightResult));
            }
          } catch (e) {
            reject(new Error("Failed to parse server result: " + e.message));
          }
        });

        evtSource.addEventListener("error", function (evt) {
          if (settled) return;
          if (stopRequested && jobId) {
            settled = true;
            try { evtSource.close(); } catch (_) {}
            _recoverStoppedResult(reject, resolve);
            return;
          }
          settled = true;
          evtSource.close();
          var msg = "Server training error";
          try { msg = JSON.parse(evt.data).message || msg; } catch (e) { /* */ }
          reject(new Error(msg));
        });

        evtSource.onerror = function () {
          if (settled) return;
          if (stopRequested && jobId) {
            settled = true;
            try { evtSource.close(); } catch (_) {}
            _recoverStoppedResult(reject, resolve);
            return;
          }
          settled = true;
          evtSource.close();
          reject(new Error("SSE connection to training server lost"));
        };

        // timeout: if no activity for 5 min, assume server died
        var sseTimeout;
        function resetSseTimeout() {
          clearTimeout(sseTimeout);
          sseTimeout = setTimeout(function () {
            if (settled) return;
            settled = true;
            evtSource.close();
            reject(new Error("Server training timed out (no response for 5 minutes)"));
          }, 300000);
        }
        resetSseTimeout();
        evtSource.addEventListener("epoch", resetSseTimeout);
        evtSource.addEventListener("status", resetSseTimeout);

      }).catch(function (err) {
        reject(new Error("Cannot reach training server at " + serverUrl + ": " + err.message));
      });
    });
    cancelFn = function () {
      if (settled) return Promise.resolve({ canceled: true, alreadySettled: true });
      stopRequested = true;
      if (!jobId) return Promise.resolve({ canceled: true, pending: true });
      return stopTrainingOnServer(jobId, serverUrl);
    };
    promise.cancel = function () { return cancelFn(); };
    return promise;
  }

  // Check if server is available
  function checkServer(serverUrl) {
    var url = String(serverUrl || DEFAULT_SERVER).replace(/\/$/, "");
    return fetch(url + "/api/health", { method: "GET" })
      .then(function (res) { return res.ok; })
      .catch(function () { return false; });
  }

  // Run test evaluation on server (same runtime as training)
  function runTestOnServer(config, serverUrl) {
    var url = String(serverUrl || DEFAULT_SERVER).replace(/\/$/, "");
    return fetch(url + "/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }).then(function (res) {
      if (!res.ok) throw new Error("Server test returned " + res.status);
      return res.json();
    });
  }

  // Run batch prediction on server
  function predictOnServer(config, serverUrl) {
    var url = String(serverUrl || DEFAULT_SERVER).replace(/\/$/, "");
    return fetch(url + "/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }).then(function (res) {
      if (!res.ok) throw new Error("Server predict returned " + res.status);
      return res.json();
    });
  }

  // Run generation on server (reconstruct/random)
  function generateOnServer(config, serverUrl) {
    var url = String(serverUrl || DEFAULT_SERVER).replace(/\/$/, "");
    return fetch(url + "/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }).then(function (res) {
      if (!res.ok) throw new Error("Server generate returned " + res.status);
      return res.json();
    });
  }

  return {
    runTrainingOnServer: runTrainingOnServer,
    stopTrainingOnServer: stopTrainingOnServer,
    runTestOnServer: runTestOnServer,
    predictOnServer: predictOnServer,
    generateOnServer: generateOnServer,
    checkServer: checkServer,
    DEFAULT_SERVER: DEFAULT_SERVER,
  };
});

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
      lrSchedulerType: String(spec.lrSchedulerType || "plateau"),
      earlyStoppingPatience: Number(spec.earlyStoppingPatience || 5),
      restoreBestWeights: spec.restoreBestWeights !== false,
      gradClipNorm: Number(spec.gradClipNorm || 0),
    };

    // estimate payload size — reject if too large for JSON transfer
    var trainLen = (payload.dataset && payload.dataset.xTrain) ? payload.dataset.xTrain.length : 0;
    var featureLen = (trainLen && payload.dataset.xTrain[0]) ? payload.dataset.xTrain[0].length : 0;
    var estimatedMB = (trainLen * featureLen * 6) / (1024 * 1024); // ~6 bytes per float in JSON
    if (estimatedMB > 100) {
      return Promise.reject(new Error("Dataset too large for server transfer (" + estimatedMB.toFixed(0) + "MB). Training on client instead."));
    }

    return new Promise(function (resolve, reject) {
      // POST training request
      fetch(serverUrl + "/api/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(function (res) {
        if (!res.ok) throw new Error("Server returned " + res.status);
        return res.json();
      }).then(function (startResult) {
        var jobId = startResult.jobId || payload.runId;
        if (typeof spec.onReady === "function") {
          spec.onReady({ backend: startResult.backend || "pytorch" });
        }
        if (typeof spec.onStatus === "function") {
          spec.onStatus("Training on server (job: " + jobId + ")...");
        }

        // Connect to SSE stream for epoch updates
        var evtSource = new EventSource(serverUrl + "/api/train/" + jobId);
        var settled = false;

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
            var result = JSON.parse(evt.data);
            // convert weightValues to match client format
            if (result.modelArtifacts && result.modelArtifacts.weightData) {
              result.modelArtifacts.weightValues = result.modelArtifacts.weightData;
              delete result.modelArtifacts.weightData;
            }
            result.resolvedBackend = result.backend || "pytorch";
            resolve(result);
          } catch (e) {
            reject(new Error("Failed to parse server result: " + e.message));
          }
        });

        evtSource.addEventListener("error", function (evt) {
          if (settled) return;
          settled = true;
          evtSource.close();
          var msg = "Server training error";
          try { msg = JSON.parse(evt.data).message || msg; } catch (e) { /* */ }
          reject(new Error(msg));
        });

        evtSource.onerror = function () {
          if (settled) return;
          settled = true;
          evtSource.close();
          reject(new Error("SSE connection to training server lost"));
        };

      }).catch(function (err) {
        reject(new Error("Cannot reach training server at " + serverUrl + ": " + err.message));
      });
    });
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
    runTestOnServer: runTestOnServer,
    predictOnServer: predictOnServer,
    generateOnServer: generateOnServer,
    checkServer: checkServer,
    DEFAULT_SERVER: DEFAULT_SERVER,
  };
});

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCGenerationTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(deps) {
    var layout = deps.layout;
    var stateApi = deps.stateApi;
    var store = deps.store;
    var schemaRegistry = deps.schemaRegistry;
    var modelBuilder = deps.modelBuilder;
    var onStatus = deps.onStatus || function () {};
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };
    var el = deps.el || function (tag, attrs, children) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "className") e.className = attrs[k];
        else if (k === "textContent") e.textContent = attrs[k];
        else if (k === "style") e.style.cssText = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
      if (children != null) (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (typeof c === "number") e.appendChild(document.createTextNode(String(c)));
        else if (c && c.nodeType) e.appendChild(c);
      });
      return e;
    };
    var getTf = function () { var W = typeof window !== "undefined" ? window : {}; return W.tf || null; };
    var getGenerationEngine = function () { var W = typeof window !== "undefined" ? window : {}; return W.OSCGenerationEngineCore || null; };

    var _selectedTrainerId = null;
    var _resultsByTrainer = {}; // keyed by trainerId → array of results
    var _isGenerating = false;
    var _mountId = 0;

    function _getSchemaId() { return stateApi ? stateApi.getActiveSchema() : ""; }
    function _getResults() { return _selectedTrainerId ? (_resultsByTrainer[_selectedTrainerId] || []) : []; }
    function _pushResult(r) {
      if (!_selectedTrainerId) return;
      if (!_resultsByTrainer[_selectedTrainerId]) _resultsByTrainer[_selectedTrainerId] = [];
      _resultsByTrainer[_selectedTrainerId].push(r);
      // persist to store for evaluation tab access
      if (store && typeof store.initTables === "function") {
        store.initTables({ tables: ["generationRuns"] });
        var runId = "gen-" + _selectedTrainerId + "-" + Date.now();
        store.save({ table: "generationRuns", values: [{
          id: runId, trainerId: _selectedTrainerId, method: r.method || "unknown",
          status: r.status || "done", numSamples: r.numSamples || 0,
          samples: r.samples || [], originals: r.originals || null,
          avgMse: r.avgMse != null ? r.avgMse : null,
          metrics: r.metrics || null, createdAt: Date.now(),
        }] });
      }
    }

    // list trained models that have generative capability (VAE/diffusion) AND saved weights
    function _listTrainedGenerativeModels() {
      if (!store || !modelBuilder) return [];
      var trainers = typeof store.listTrainerCards === "function" ? store.listTrainerCards({}) : [];
      return trainers.filter(function (t) {
        if (t.status !== "done" || !t.modelArtifacts || !t.modelId) return false;
        var model = store.getModel(t.modelId);
        if (!model || !model.graph) return false;
        var family = modelBuilder.inferModelFamily(model.graph);
        return family === "vae" || family === "diffusion";
      }).map(function (t) {
        var model = store.getModel(t.modelId);
        var family = modelBuilder.inferModelFamily(model.graph);
        return { trainerId: t.id, trainerName: t.name, modelId: t.modelId, modelName: model.name, family: family, schemaId: t.schemaId };
      });
    }

    // also list supervised models for inverse/transfer
    function _listAllTrainedModels() {
      if (!store) return [];
      var trainers = typeof store.listTrainerCards === "function" ? store.listTrainerCards({}) : [];
      return trainers.filter(function (t) {
        return t.status === "done" && t.modelArtifacts && t.modelId;
      }).map(function (t) {
        var model = store.getModel(t.modelId);
        var family = model && model.graph ? modelBuilder.inferModelFamily(model.graph) : "supervised";
        return { trainerId: t.id, trainerName: t.name, modelId: t.modelId, modelName: model ? model.name : t.modelId, family: family, schemaId: t.schemaId };
      });
    }

    // === LEFT: model list ===
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Trained Models"));

      var generative = _listTrainedGenerativeModels();
      var allModels = _listAllTrainedModels();

      if (!allModels.length) {
        leftEl.appendChild(el("div", { className: "osc-empty" }, "No trained models. Train a model first."));
        return;
      }

      // show generative models first, then supervised
      function renderItem(item) {
        var isActive = item.trainerId === _selectedTrainerId;
        var div = el("div", {
          style: "padding:6px 8px;cursor:pointer;border-radius:4px;margin-bottom:2px;border:1px solid " +
            (isActive ? "#0ea5e9" : "#1e293b") + ";background:" + (isActive ? "#0c2340" : "#111827") + ";",
        });
        div.appendChild(el("div", { style: "font-size:12px;font-weight:600;color:" + (isActive ? "#67e8f9" : "#e2e8f0") + ";" }, item.trainerName || item.modelName));
        var badgeColor = item.family === "vae" ? "#a78bfa" : item.family === "diffusion" ? "#f59e0b" : "#64748b";
        div.appendChild(el("span", { style: "font-size:9px;padding:1px 5px;border-radius:3px;background:" + badgeColor + ";color:#fff;margin-left:4px;" }, item.family));
        div.addEventListener("click", function () {
          _selectedTrainerId = item.trainerId;
          _renderLeftPanel();
          _renderMainPanel();
          _renderRightPanel();
        });
        leftEl.appendChild(div);
      }

      if (generative.length) {
        leftEl.appendChild(el("div", { style: "font-size:10px;color:#67e8f9;margin-bottom:4px;font-weight:600;" }, "Generative (VAE/Diffusion)"));
        generative.forEach(renderItem);
      }

      var supervised = allModels.filter(function (m) { return m.family === "supervised"; });
      if (supervised.length) {
        leftEl.appendChild(el("div", { style: "font-size:10px;color:#94a3b8;margin:8px 0 4px;font-weight:600;" }, "Supervised (Inverse/Transfer)"));
        supervised.forEach(renderItem);
      }
    }

    // === MAIN: generation results + preview ===
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";

      if (!_selectedTrainerId) {
        mainEl.appendChild(el("div", { className: "osc-empty" }, "Select a trained model to generate from."));
        return;
      }

      var trainer = store ? store.getTrainerCard(_selectedTrainerId) : null;
      if (!trainer) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Trainer not found.")); return; }
      var model = store ? store.getModel(trainer.modelId) : null;
      var family = model && model.graph ? modelBuilder.inferModelFamily(model.graph) : "supervised";
      var engine = getGenerationEngine();
      var caps = engine ? engine.detectCapabilities(family) : { availableMethods: [], defaultMethod: "inverse" };

      // header
      var header = el("div", { className: "osc-card" });
      header.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;font-weight:600;" }, escapeHtml(trainer.name || trainer.id)));
      header.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:2px;" },
        "Family: " + family + " | Methods: " + caps.availableMethods.map(function (m) { return m.id; }).join(", ")));

      if (model && model.graph) {
        var latentInfo = modelBuilder.extractLatentInfo ? modelBuilder.extractLatentInfo(model.graph) : null;
        if (latentInfo && latentInfo.latentDim > 0) {
          header.appendChild(el("div", { style: "font-size:11px;color:#a78bfa;margin-top:2px;" },
            "Latent dim: " + latentInfo.latentDim + " | Reparam nodes: " + latentInfo.reparamNodes.length));
        }
      }
      mainEl.appendChild(header);

      // generation results
      var _currentResults = _getResults();
      if (_currentResults.length) {
        _currentResults.forEach(function (result, idx) {
          var card = el("div", { className: "osc-card", style: "margin-top:8px;" });
          var statusColor = result.status === "done" ? "#4ade80" : result.status === "error" ? "#f43f5e" : "#fbbf24";
          card.appendChild(el("div", { style: "font-size:12px;color:" + statusColor + ";font-weight:600;" },
            "#" + (idx + 1) + " " + result.method + " | " + result.numSamples + " samples | " + result.status));

          // visualizations
          var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;

          // loss chart
          if (result.lossHistory && result.lossHistory.length > 1) {
            if (Plotly) {
              var chartDiv = el("div", { style: "height:200px;margin-top:8px;" });
              card.appendChild(chartDiv);
              var steps = result.lossHistory.map(function (h) { return h.step; });
              var losses = result.lossHistory.map(function (h) { return h.loss; });
              Plotly.newPlot(chartDiv, [
                { x: steps, y: losses, mode: "lines", name: "Loss", line: { color: "#22d3ee" } },
              ], {
                paper_bgcolor: "#0f1320", plot_bgcolor: "#0f1320", font: { color: "#cbd5e1", size: 10 },
                title: { text: "Optimization Progress", font: { size: 11 } },
                xaxis: { title: "Step", gridcolor: "#1e293b" }, yaxis: { title: "Loss", gridcolor: "#1e293b" },
                margin: { t: 30, b: 40, l: 50, r: 10 },
              }, { responsive: true });
            }
          }

          // reconstruct metrics
          if (result.avgMse != null) {
            card.appendChild(el("div", { style: "font-size:11px;color:#4ade80;margin-top:4px;" },
              "Avg MSE: " + result.avgMse.toExponential(4)));
          }

          // sample visualization — delegates to appropriate renderer
          if (result.samples && result.samples.length) {
            var sampleDim = result.samples[0] ? result.samples[0].length : 0;
            card.appendChild(el("div", { style: "font-size:10px;color:#94a3b8;margin-top:8px;" },
              result.method + ": " + result.samples.length + " samples | " + sampleDim + " dimensions"));

            var vizMount = el("div", { style: "margin-top:8px;" });
            card.appendChild(vizMount);
            _renderGeneratedSamples(vizMount, result.samples, trainer, Plotly, result.originals, result.method);
          }
          mainEl.appendChild(card);
        });
      }
    }

    // === RIGHT: config ===
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      rightEl.appendChild(el("h3", {}, "Generation Config"));

      if (!_selectedTrainerId) {
        rightEl.appendChild(el("div", { className: "osc-empty" }, "Select a model."));
        return;
      }

      var trainer = store ? store.getTrainerCard(_selectedTrainerId) : null;
      var model = trainer ? store.getModel(trainer.modelId) : null;
      var family = model && model.graph ? modelBuilder.inferModelFamily(model.graph) : "supervised";
      var engine = getGenerationEngine();
      var caps = engine ? engine.detectCapabilities(family) : { availableMethods: [{ id: "inverse", label: "Inverse" }], defaultMethod: "inverse" };

      var configCard = el("div", { className: "osc-card" });

      // method selector
      var methodRow = el("div", { className: "osc-form-row" });
      methodRow.appendChild(el("label", {}, "Method"));
      var methodSelect = el("select", { "data-key": "method", style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
      caps.availableMethods.forEach(function (m) {
        var opt = el("option", { value: m.id }, m.label);
        if (m.id === caps.defaultMethod) opt.selected = true;
        methodSelect.appendChild(opt);
      });
      methodRow.appendChild(methodSelect);
      configCard.appendChild(methodRow);

      // numeric params
      var fields = [
        { key: "numSamples", label: "Num samples", value: 16, min: 1, max: 1000, step: 1 },
        { key: "steps", label: "Optimization steps", value: 100, min: 0, max: 10000, step: 10 },
        { key: "lr", label: "Learning rate", value: 0.01, min: 0.0001, max: 1, step: 0.001 },
        { key: "temperature", label: "Temperature", value: 1.0, min: 0.01, max: 5, step: 0.1 },
        { key: "seed", label: "Seed", value: 42, min: 1, step: 1 },
      ];
      fields.forEach(function (f) {
        var row = el("div", { className: "osc-form-row" });
        row.appendChild(el("label", { style: "font-size:11px;color:#94a3b8;" }, f.label));
        var inp = el("input", { type: "number", value: String(f.value), "data-key": f.key, style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
        if (f.min != null) inp.min = f.min;
        if (f.max != null) inp.max = f.max;
        if (f.step != null) inp.step = f.step;
        row.appendChild(inp);
        configCard.appendChild(row);
      });

      rightEl.appendChild(configCard);

      // generate button
      var genBtn = el("button", { style: "margin-top:8px;width:100%;padding:8px;font-size:13px;font-weight:600;border-radius:6px;border:1px solid #0ea5e9;background:#0284c7;color:#fff;cursor:pointer;" }, "Generate");
      genBtn.addEventListener("click", function () { _handleGenerate(); });
      rightEl.appendChild(genBtn);

      var clearBtn = el("button", { style: "margin-top:4px;width:100%;padding:6px;font-size:11px;border-radius:6px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;" }, "Clear Results");
      clearBtn.addEventListener("click", function () {
        if (_selectedTrainerId) _resultsByTrainer[_selectedTrainerId] = [];
        _renderMainPanel();
      });
      rightEl.appendChild(clearBtn);
    }

    function _collectConfig() {
      var config = {};
      var selects = layout.rightEl.querySelectorAll("select[data-key]");
      selects.forEach(function (sel) { config[sel.getAttribute("data-key")] = sel.value; });
      var inputs = layout.rightEl.querySelectorAll("input[data-key]");
      inputs.forEach(function (inp) { config[inp.getAttribute("data-key")] = Number(inp.value); });
      return config;
    }

    function _handleGenerate() {
      if (_isGenerating) { onStatus("Already generating..."); return; }
      if (!_selectedTrainerId) { onStatus("Select a model first"); return; }

      var tf = getTf();
      var engine = getGenerationEngine();
      if (!tf || !engine) { onStatus("TF.js or generation engine not available"); return; }

      var trainer = store.getTrainerCard(_selectedTrainerId);
      var modelRec = store.getModel(trainer.modelId);
      if (!trainer || !modelRec || !trainer.modelArtifacts) { onStatus("Model weights not available — train first"); return; }

      var config = _collectConfig();
      var method = config.method || "random";
      var family = modelBuilder.inferModelFamily(modelRec.graph);

      _isGenerating = true;
      onStatus("Generating (" + method + ")...");
      var currentMountId = ++_mountId;

      try {
        // rebuild FULL model with correct feature size (from dataset)
        var schemaId = trainer.schemaId;
        var allowedOutputKeys = schemaRegistry ? schemaRegistry.getOutputKeys(schemaId) : ["x"];
        var defaultTarget = (allowedOutputKeys[0] && (allowedOutputKeys[0].key || allowedOutputKeys[0])) || "x";
        var graphMode = modelBuilder.inferGraphMode(modelRec.graph, "direct");

        // get feature size from trainer's dataset
        var dataset = trainer.datasetId ? store.getDataset(trainer.datasetId) : null;
        var dsData = dataset && dataset.data ? dataset.data : {};
        var featureSize = Number(dsData.featureSize || (dsData.xTrain && dsData.xTrain[0] && dsData.xTrain[0].length) || 40);
        var latentInfo = modelBuilder.extractLatentInfo ? modelBuilder.extractLatentInfo(modelRec.graph) : { latentDim: 16 };
        var latentDim = latentInfo.latentDim || 16;

        var built = modelBuilder.buildModelFromGraph(tf, modelRec.graph, {
          mode: graphMode, featureSize: featureSize, windowSize: 1, seqFeatureSize: featureSize,
          allowedOutputKeys: allowedOutputKeys, defaultTarget: defaultTarget, numClasses: dsData.numClasses || dsData.classCount || 10,
        });

        // load trained weights (handle both weightValues and weightData)
        var hasWeights = trainer.modelArtifacts && (trainer.modelArtifacts.weightValues || trainer.modelArtifacts.weightData);
        if (hasWeights) {
          try {
            var flatWeights;
            if (trainer.modelArtifacts.weightValues && Array.isArray(trainer.modelArtifacts.weightValues)) {
              flatWeights = new Float32Array(trainer.modelArtifacts.weightValues);
            } else if (trainer.modelArtifacts.weightData && trainer.modelArtifacts.weightData.byteLength) {
              flatWeights = new Float32Array(trainer.modelArtifacts.weightData);
            }
            if (flatWeights) {
              var mw = built.model.getWeights();
              var nw = []; var off = 0;
              for (var wi = 0; wi < mw.length; wi++) {
                var sz = mw[wi].shape.reduce(function (a, b) { return a * b; }, 1);
                if (off + sz <= flatWeights.length) { nw.push(tf.tensor(flatWeights.subarray(off, off + sz), mw[wi].shape)); off += sz; }
              }
              if (nw.length === mw.length) built.model.setWeights(nw);
            }
          } catch (e) { console.warn("[generation] Weight load:", e.message); }
        }

        // For VAE generation: extract decoder (z → output), use latent dim
        // For supervised/inverse: use full model with feature size
        var genModel = built.model;
        var genLatentDim = featureSize;
        if (family === "vae" && method !== "inverse") {
          try {
            var decoder = modelBuilder.extractDecoder(tf, built.model, latentDim);
            if (decoder && decoder.model) {
              genModel = decoder.model;
              genLatentDim = decoder.latentDim || latentDim;
              console.log("[generation] Using decoder: latentDim=" + genLatentDim + ", outputDim=" + decoder.outputDim);
            }
          } catch (decErr) {
            console.warn("[generation] extractDecoder failed, using full model:", decErr.message);
            // fallback: for VAE, at least use the correct latent dim
            genLatentDim = latentDim;
          }
        }

        var genConfig = {
          method: method,
          model: genModel,
          latentDim: genLatentDim,
          numSamples: config.numSamples || 16,
          steps: config.steps || 0,
          lr: config.lr || 0.01,
          temperature: config.temperature || 1.0,
          seed: config.seed || 42,
          onStep: function (step, loss) {
            if (step % 10 === 0) onStatus("Step " + step + " loss=" + (typeof loss === "number" ? loss.toExponential(3) : "?"));
          },
        };

        // for reconstruct: pass real data through full model
        if (method === "reconstruct") {
          genConfig.fullModel = built.model; // use full encoder-decoder, not just decoder
          genConfig.model = built.model;
          var rds = trainer.datasetId ? store.getDataset(trainer.datasetId) : null;
          if (rds && rds.data) {
            var rDsData = rds.data;
            var rIsBundle = rDsData.kind === "dataset_bundle" && rDsData.datasets;
            var rActiveDs = rIsBundle ? rDsData.datasets[rDsData.activeVariantId || Object.keys(rDsData.datasets)[0]] : rDsData;
            var testX = (rActiveDs.records && rActiveDs.records.test && rActiveDs.records.test.x) || (rActiveDs.xTest || []);
            if (!testX.length) testX = (rActiveDs.records && rActiveDs.records.train && rActiveDs.records.train.x) || (rActiveDs.xTrain || []);
            genConfig.originals = testX;
          }
        }

        // for inverse: need a target
        if (method === "inverse") {
          var ids = trainer.datasetId ? store.getDataset(trainer.datasetId) : null;
          if (ids && ids.data) {
            var iDsData = ids.data;
            var iIsBundle = iDsData.kind === "dataset_bundle" && iDsData.datasets;
            var iActiveDs = iIsBundle ? iDsData.datasets[iDsData.activeVariantId || Object.keys(iDsData.datasets)[0]] : iDsData;
            var testY = (iActiveDs.records && iActiveDs.records.test && iActiveDs.records.test.y) || (iActiveDs.yTest || []);
            if (testY.length) {
              var nTarget = Math.min(config.numSamples || 1, testY.length);
              var targets = [];
              for (var ti = 0; ti < nTarget; ti++) {
                targets.push(Array.isArray(testY[ti]) ? testY[ti] : [testY[ti]]);
              }
              genConfig.target = targets;
            }
          }
        }

        engine.generate(tf, genConfig).then(function (result) {
          _isGenerating = false;
          if (currentMountId !== _mountId) return;
          result.status = "done";
          _pushResult(result);
          onStatus("Generation done: " + result.numSamples + " samples (" + result.method + ")");
          _renderMainPanel();
          if (genModel !== built.model) try { genModel.dispose(); } catch (_) {}
          built.model.dispose();
        }).catch(function (err) {
          _isGenerating = false;
          if (currentMountId !== _mountId) return;
          _pushResult({ method: method, status: "error", error: err.message, samples: [], lossHistory: [], numSamples: 0 });
          onStatus("Generation error: " + err.message);
          _renderMainPanel();
          if (genModel !== built.model) try { genModel.dispose(); } catch (_) {}
          built.model.dispose();
        });

      } catch (e) {
        _isGenerating = false;
        onStatus("Generation setup error: " + e.message);
      }
    }

    // Render generated samples — delegates to dataset module or uses core renderers
    function _renderGeneratedSamples(mountEl, samples, trainer, Plotly, originals, method) {
      if (!samples || !samples.length) return;
      var schemaId = trainer ? trainer.schemaId : "";
      var dataset = trainer && trainer.datasetId ? store.getDataset(trainer.datasetId) : null;
      var dsData = dataset && dataset.data ? dataset.data : {};

      // 1. Try dataset module's renderGeneratedSamples if available
      var W = typeof window !== "undefined" ? window : {};
      var datasetModules = W.OSCDatasetModules;
      if (datasetModules && typeof datasetModules.getModuleForSchema === "function") {
        var mods = datasetModules.getModuleForSchema(schemaId) || [];
        for (var mi = 0; mi < mods.length; mi++) {
          var mod = datasetModules.getModule(mods[mi].id);
          if (mod && mod.playgroundApi && typeof mod.playgroundApi.renderGeneratedSamples === "function") {
            mod.playgroundApi.renderGeneratedSamples(mountEl, {
              samples: samples, originals: originals || null, method: method || "random",
              el: el, Plotly: Plotly, datasetData: dsData, schemaId: schemaId,
            });
            return;
          }
        }
      }

      // 2. Image datasets: use core image renderer
      var dsSchema = schemaRegistry ? schemaRegistry.getDatasetSchema(schemaId) : null;
      var sampleType = (dsSchema && dsSchema.sampleType) || "";
      var coreRenderer = W.OSCImageRenderCore || null;
      if (sampleType === "image" && coreRenderer) {
        var imgShape = dsData.imageShape || [28, 28, 1];
        var gridWrap = el("div", { style: "display:flex;flex-wrap:wrap;gap:4px;" });
        var maxShow = Math.min(samples.length, 32);
        for (var si = 0; si < maxShow; si++) {
          var canvas = document.createElement("canvas");
          canvas.width = imgShape[0]; canvas.height = imgShape[1];
          canvas.style.cssText = "width:48px;height:48px;border:1px solid #2d3748;border-radius:3px;image-rendering:pixelated;";
          coreRenderer.drawImageToCanvas(canvas.getContext("2d"), samples[si], imgShape[0], imgShape[1]);
          gridWrap.appendChild(canvas);
        }
        mountEl.appendChild(gridWrap);
        return;
      }

      // 3. Generic: Plotly line chart (features as x-axis)
      if (Plotly && samples[0] && samples[0].length >= 2) {
        var lineDiv = el("div", { style: "height:250px;" });
        mountEl.appendChild(lineDiv);
        var maxT = Math.min(samples.length, 8);
        var lc = ["#38bdf8", "#fb923c", "#4ade80", "#f43f5e", "#a78bfa", "#fbbf24", "#2dd4bf", "#e879f9"];
        var traces = [];
        for (var li = 0; li < maxT; li++) {
          var xv = []; for (var xi = 0; xi < samples[li].length; xi++) xv.push(xi);
          traces.push({ x: xv, y: samples[li], mode: "lines", name: "Sample " + (li + 1), line: { color: lc[li % lc.length], width: 1.5 } });
        }
        Plotly.newPlot(lineDiv, traces, {
          paper_bgcolor: "#0f1320", plot_bgcolor: "#0f1320", font: { color: "#cbd5e1", size: 10 },
          title: { text: "Generated Samples (" + maxT + "/" + samples.length + ")", font: { size: 11 } },
          xaxis: { title: "Feature Index", gridcolor: "#1e2740" }, yaxis: { title: "Value", gridcolor: "#1e2740" },
          legend: { font: { size: 8 } }, margin: { t: 30, b: 40, l: 50, r: 10 },
        }, { responsive: true });
        return;
      }

      // 4. Text fallback
      var text = samples.slice(0, 5).map(function (s, i) {
        return "Sample " + (i + 1) + ": [" + (Array.isArray(s) ? s.slice(0, 10).map(function (v) { return Number(v).toFixed(3); }).join(", ") + (s.length > 10 ? "..." : "") : s) + "]";
      }).join("\n");
      mountEl.appendChild(el("pre", { style: "font-size:10px;color:#94a3b8;background:#171d30;padding:8px;border-radius:4px;" }, text));
    }

    function mount() { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
    function unmount() { _mountId++; layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

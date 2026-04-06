(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCGenerationTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Generation Tab — item-based generation sessions.
   *
   * Same 3-panel pattern as all other tabs:
   *   Left:  generation session list (renderItemList) + "+ New Generation"
   *   Main:  results (header + generation run cards + visualizations)
   *   Right: config (schema, model, method, params, Generate button)
   *
   * Each session carries its own schemaId + trainerId. Multiple schemas coexist.
   * Results persist in workspace store (generationRuns table).
   */

  var GEN_TABLE = "generationRuns";

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
    var getUiEngine = function () { var W = typeof window !== "undefined" ? window : {}; return W.OSCUiSharedEngine || null; };
    var modal = deps.modal;

    var _activeGenId = null;
    var _isGenerating = false;
    var _mountId = 0;
    var _refreshTimer = null;
    var _lastTrainerSnapshot = "";

    function _getTrainerArtifacts(trainer, weightSelection) {
      if (!trainer) return null;
      var sel = String(weightSelection || "").trim().toLowerCase();
      if (sel === "best" && trainer.modelArtifactsBest) return trainer.modelArtifactsBest;
      return trainer.modelArtifactsLast || trainer.modelArtifacts || trainer.modelArtifactsBest || null;
    }

    function _getCheckpointRef(artifacts) {
      var checkpoint = artifacts && artifacts.checkpoint && typeof artifacts.checkpoint === "object" ? artifacts.checkpoint : null;
      return String((checkpoint && checkpoint.checkpointRef) || (artifacts && artifacts.checkpointRef) || "").trim();
    }

    function _snapshotSelectedTrainerState() {
      if (!_activeGenId || !store) return "";
      var g = _getGen(_activeGenId);
      if (!g || !g.trainerId) return "no-gen";
      var trainer = store.getTrainerCard(g.trainerId);
      if (!trainer) return "missing:" + g.trainerId;
      var art = _getTrainerArtifacts(trainer, g.config && g.config.weightSelection);
      var specs = art && art.weightSpecs ? art.weightSpecs.length : 0;
      var values = art && art.weightValues ? art.weightValues.length : 0;
      return [
        _activeGenId,
        trainer.id,
        String(trainer.status || ""),
        specs,
        values,
        !!trainer.modelArtifactsLast,
        !!trainer.modelArtifactsBest,
      ].join("|");
    }

    function _startRefreshWatcher() {
      _stopRefreshWatcher();
      _lastTrainerSnapshot = _snapshotSelectedTrainerState();
      _refreshTimer = setInterval(function () {
        if (!stateApi || stateApi.getActiveTab() !== "generation") return;
        var next = _snapshotSelectedTrainerState();
        if (next === _lastTrainerSnapshot) return;
        _lastTrainerSnapshot = next;
        _renderLeftPanel();
        _renderMainPanel();
        _renderRightPanel();
      }, 350);
    }

    function _stopRefreshWatcher() {
      if (_refreshTimer) clearInterval(_refreshTimer);
      _refreshTimer = null;
    }

    if (store && typeof store.initTables === "function") store.initTables({ tables: [GEN_TABLE] });

    // ─── Store helpers ───
    function _listGens() { return store && typeof store.list === "function" ? store.list({ table: GEN_TABLE }) : []; }
    function _getGen(id) { return store && typeof store.get === "function" ? store.get({ table: GEN_TABLE, id: id }) : null; }
    function _saveGen(rec) { if (store && typeof store.save === "function") store.save({ table: GEN_TABLE, values: [rec] }); }
    function _removeGen(id) { if (store && typeof store.remove === "function") store.remove({ table: GEN_TABLE, id: id }); }

    // ─── Get trainers for a schema (all statuses, for selection) ───
    function _listTrainersForSchema(schemaId) {
      if (!store) return [];
      return (typeof store.listTrainerCards === "function" ? store.listTrainerCards({}) : [])
        .filter(function (t) { return t.modelId && (!schemaId || t.schemaId === schemaId); });
    }

    function _resolveGenerationInfo(modelRec) {
      if (!modelRec || !modelRec.graph || !modelBuilder) {
        return {
          family: "",
          sampleNodes: [],
          outputNodes: [],
          hasLatentDecoder: false,
          canReconstruct: true,
          canRandomSample: false,
          canClassifierGuide: false,
          canLangevin: false,
          canOptimize: false,
          canInverse: true,
          canDDPM: false,
          defaultMethod: "reconstruct",
        };
      }
      if (typeof modelBuilder.extractGenerationCapabilities === "function") {
        return modelBuilder.extractGenerationCapabilities(modelRec.graph);
      }
      var family = typeof modelBuilder.inferModelFamily === "function" ? modelBuilder.inferModelFamily(modelRec.graph) : "";
      return { family: family, sampleNodes: [], outputNodes: [], hasLatentDecoder: family === "vae", defaultMethod: family === "gan" ? "random" : "reconstruct" };
    }

    function _resolveGenerationMeta(modelRec) {
      var engine = getGenerationEngine();
      var info = _resolveGenerationInfo(modelRec);
      var caps = engine && typeof engine.detectCapabilities === "function"
        ? engine.detectCapabilities(info)
        : { availableMethods: [{ id: "inverse", label: "Inverse / Transfer Learning" }], defaultMethod: "inverse" };
      return { info: info, caps: caps };
    }

    // ─── LEFT PANEL ───
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Generations"));

      var gens = _listGens();
      var uiEngine = getUiEngine();

      var items = gens.map(function (g) {
        var nRuns = (g.runs || []).length;
        var statusLabel = g.status === "done" ? "\u2713 " + nRuns + " run(s)" : g.status === "generating" ? "\u23f3 generating" : "draft";
        var familyLabel = g.family || "";
        return {
          id: g.id,
          title: g.name || g.id,
          active: g.id === _activeGenId,
          metaLines: [g.schemaId || "", familyLabel, statusLabel].filter(Boolean),
          actions: [
            { id: "rename", label: "\u270e" },
            { id: "delete", label: "\u2715" },
          ],
        };
      });

      var listMount = el("div", {});
      leftEl.appendChild(listMount);
      if (uiEngine && typeof uiEngine.renderItemList === "function") {
        uiEngine.renderItemList({
          mountEl: listMount,
          items: items,
          emptyText: "No generations. Click + New.",
          onOpen: function (itemId) {
            _activeGenId = itemId;
            _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          },
          onAction: function (itemId, actionId) {
            if (actionId === "rename") {
              var g = _getGen(itemId);
              if (!g) return;
              var newName = prompt("Rename:", g.name || g.id);
              if (newName && newName.trim()) { g.name = newName.trim(); _saveGen(g); _renderLeftPanel(); }
            } else if (actionId === "delete") {
              if (confirm("Delete this generation?")) { _removeGen(itemId); if (_activeGenId === itemId) _activeGenId = null; _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
            }
          },
        });
      }

      var newBtn = el("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "+ New Generation");
      newBtn.addEventListener("click", function () { _openNewModal(); });
      leftEl.appendChild(newBtn);
    }

    function _openNewModal() {
      if (!modal) return;
      var _nameInput, _schemaSelect;
      modal.open({
        title: "New Generation",
        renderForm: function (mount) {
          var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
          mount.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Name"));
          _nameInput = el("input", { type: "text", placeholder: "gen_1", style: "width:100%;padding:6px 8px;margin-bottom:8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          mount.appendChild(_nameInput);
          mount.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Schema"));
          _schemaSelect = el("select", { style: "width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          schemas.forEach(function (s) { var o = el("option", { value: s.id }); o.textContent = s.label || s.id; if (s.id === (stateApi ? stateApi.getActiveSchema() : "")) o.selected = true; _schemaSelect.appendChild(o); });
          mount.appendChild(_schemaSelect);
          setTimeout(function () { _nameInput.focus(); }, 50);
        },
        onCreate: function () {
          var name = (_nameInput && _nameInput.value.trim()) || "";
          var sid = _schemaSelect ? _schemaSelect.value : "";
          if (!name) { onStatus("Enter a name"); return; }
          var id = "gen_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
          // auto-select first trained model for this schema
          var _autoTrainerId = "";
          var _autoFamily = "";
          var _autoMethod = "reconstruct";
          if (store) {
            var _allTrainers = store.listTrainerCards ? store.listTrainerCards() : [];
            var _trained = _allTrainers.filter(function (t) { return t.schemaId === sid && !!_getTrainerArtifacts(t, "last"); });
            if (_trained.length) {
              _autoTrainerId = _trained[0].id;
              var _tm = _trained[0].modelId ? store.getModel(_trained[0].modelId) : null;
              var _meta = _resolveGenerationMeta(_tm);
              _autoFamily = _meta.info.family || "";
              _autoMethod = _meta.caps.defaultMethod || "reconstruct";
            }
          }
          var rec = {
            id: id,
            name: name,
            schemaId: sid,
            trainerId: _autoTrainerId,
            family: _autoFamily,
            config: {
              method: _autoMethod,
              generationRuntime: "client",
              numSamples: 16,
              steps: 100,
              lr: 0.01,
              temperature: 1.0,
              seed: 42,
            },
            status: "draft",
            runs: [],
            createdAt: Date.now(),
          };
          _saveGen(rec);
          _activeGenId = id;
          onStatus("Created: " + name);
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        },
      });
    }

    // ─── MAIN PANEL ───
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";

      if (!_activeGenId) {
        mainEl.appendChild(el("div", { className: "osc-card" }, [
          el("div", { style: "font-size:13px;color:#67e8f9;font-weight:600;" }, "Generation Lab"),
          el("div", { style: "font-size:12px;color:#94a3b8;margin-top:4px;" },
            "Create generation sessions to sample, reconstruct, or optimize from trained models. Each session carries its own schema and model."),
        ]));
        return;
      }

      var g = _getGen(_activeGenId);
      if (!g) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Generation not found.")); return; }

      // header
      var trainer = g.trainerId ? (store ? store.getTrainerCard(g.trainerId) : null) : null;
      var modelRec = trainer ? (store ? store.getModel(trainer.modelId) : null) : null;
      var header = el("div", { className: "osc-card" });
      header.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;font-weight:600;" }, escapeHtml(g.name)));
      var infoLine = "Schema: " + (g.schemaId || "none");
      if (trainer) infoLine += " | Model: " + escapeHtml(trainer.name || trainer.id);
      if (g.family) infoLine += " | Family: " + g.family;
      header.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-top:2px;" }, infoLine));

      if (modelRec && modelRec.graph && modelBuilder) {
        var latentInfo = modelBuilder.extractLatentInfo ? modelBuilder.extractLatentInfo(modelRec.graph) : null;
        if (latentInfo && latentInfo.latentDim > 0) {
          header.appendChild(el("div", { style: "font-size:11px;color:#a78bfa;margin-top:2px;" },
            "Latent dim: " + latentInfo.latentDim + " | Reparam: " + latentInfo.reparamNodes.length));
        }
      }
      mainEl.appendChild(header);

      // runs
      var runs = g.runs || [];
      if (!runs.length) {
        mainEl.appendChild(el("div", { className: "osc-empty", style: "margin-top:8px;" }, "No results yet. Configure and generate from the right panel."));
        return;
      }

      runs.forEach(function (result, idx) {
        var card = el("div", { className: "osc-card", style: "margin-top:8px;overflow:hidden;display:flex;flex-direction:column;" });
        var statusColor = result.status === "done" ? "#4ade80" : result.status === "error" ? "#f43f5e" : "#fbbf24";
        var runtimeLabel = result.runtime ? " | " + result.runtime : "";
        card.appendChild(el("div", { style: "font-size:12px;color:" + statusColor + ";font-weight:600;" },
          "#" + (idx + 1) + " " + (result.method || "?") + " | " + (result.numSamples || 0) + " samples | " + (result.status || "?") + runtimeLabel));
        if (result.weightSelection || result.checkpointRef) {
          card.appendChild(el("div", { style: "font-size:10px;color:#94a3b8;margin-top:4px;" },
            "Weights: " + String(result.weightSelection || "last") + " | Checkpoint: " + String(result.checkpointRef || "unversioned")));
        }

        if (result.error) {
          card.appendChild(el("div", { style: "font-size:10px;color:#f43f5e;margin-top:4px;" }, "Error: " + result.error));
        }

        var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;

        // loss chart — only show if losses have meaningful (non-zero) values
        var _hasRealLoss = result.lossHistory && result.lossHistory.length > 1 &&
          result.lossHistory.some(function (h) { return h.loss > 0; });
        if (_hasRealLoss && Plotly) {
          var chartWrap = el("div", { style: "width:100%;min-height:200px;max-height:200px;position:relative;overflow:hidden;flex:0 0 200px;margin-top:8px;" });
          var chartDiv = el("div", { style: "position:absolute;top:0;left:0;right:0;bottom:0;" });
          chartWrap.appendChild(chartDiv);
          card.appendChild(chartWrap);
          Plotly.newPlot(chartDiv, [
            { x: result.lossHistory.map(function (h) { return h.step; }), y: result.lossHistory.map(function (h) { return h.loss; }), mode: "lines", name: "Loss", line: { color: "#22d3ee" } },
          ], {
            paper_bgcolor: "#0f1320", plot_bgcolor: "#0f1320", font: { color: "#cbd5e1", size: 10 },
            title: { text: "Optimization Progress", font: { size: 11 } },
            xaxis: { title: "Step", gridcolor: "#1e293b" }, yaxis: { title: "Loss", gridcolor: "#1e293b" },
            margin: { t: 30, b: 40, l: 50, r: 10 },
          }, { responsive: true });
        }

        if (result.avgMse != null) {
          card.appendChild(el("div", { style: "font-size:11px;color:#4ade80;margin-top:4px;" }, "Avg MSE: " + result.avgMse.toExponential(4)));
        }

        // sample visualization
        if (result.samples && result.samples.length) {
          var sampleDim = result.samples[0] ? result.samples[0].length : 0;
          card.appendChild(el("div", { style: "font-size:10px;color:#94a3b8;margin-top:8px;" },
            (result.method || "?") + ": " + result.samples.length + " samples | " + sampleDim + " dimensions"));
          var vizMount = el("div", { style: "margin-top:8px;display:block;clear:both;width:100%;" });
          card.appendChild(vizMount);
          _renderGeneratedSamples(vizMount, result.samples, trainer, Plotly, result.originals, result.method);
        }
        mainEl.appendChild(card);
      });
    }

    // ─── RIGHT PANEL ───
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      rightEl.appendChild(el("h3", {}, "Gen Config"));

      if (!_activeGenId) {
        rightEl.appendChild(el("div", { className: "osc-empty" }, "Select or create a generation."));
        return;
      }

      var g = _getGen(_activeGenId);
      if (!g) return;
      if (!g.config) g.config = {};
      if (!g.config.generationRuntime) g.config.generationRuntime = "client";
      var isGeneratingUi = _isGenerating || g.status === "generating";

      var configCard = el("div", { className: "osc-card" });

      // schema — locked at creation, read-only label
      configCard.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:6px;" },
        "Schema: " + escapeHtml(g.schemaId || "none")));

      // trainer/model selector (filtered by schema, shows status)
      var trainers = _listTrainersForSchema(g.schemaId);
      var selectedTrainer = g.trainerId ? (store ? store.getTrainerCard(g.trainerId) : null) : null;
      var selectedModel = selectedTrainer && selectedTrainer.modelId ? (store ? store.getModel(selectedTrainer.modelId) : null) : null;
      var selectedMeta = _resolveGenerationMeta(selectedModel);
      var trainerRow = el("div", { className: "osc-form-row" });
      trainerRow.appendChild(el("label", {}, "Model"));
      var trainerSel = el("select", { style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
      trainerSel.appendChild(el("option", { value: "" }, "-- select model --"));
      trainers.forEach(function (t) {
        var model = store ? store.getModel(t.modelId) : null;
        var family = _resolveGenerationInfo(model).family || "supervised";
        var statusTag = t.status === "done" ? "\u2713" : t.status === "training" ? "\u23f3" : "\u25cb";
        var opt = el("option", { value: t.id }, statusTag + " " + (t.name || t.id) + " (" + family + ")");
        if (t.id === g.trainerId) opt.selected = true;
        trainerSel.appendChild(opt);
      });
      trainerSel.addEventListener("change", function () {
        g.trainerId = trainerSel.value;
        // detect family
        var t = g.trainerId ? (store ? store.getTrainerCard(g.trainerId) : null) : null;
        var m = t ? (store ? store.getModel(t.modelId) : null) : null;
        var meta = _resolveGenerationMeta(m);
        g.family = meta.info.family || "";
        g.config.method = meta.caps.defaultMethod;
        _saveGen(g); _renderRightPanel(); _renderMainPanel(); _renderLeftPanel();
      });
      trainerRow.appendChild(trainerSel);
      configCard.appendChild(trainerRow);

      // method selector (resolved from graph capabilities)
      var caps = selectedMeta.caps;
      var availableMethodIds = caps.availableMethods.map(function (m) { return m.id; });
      if (availableMethodIds.length && availableMethodIds.indexOf(g.config.method || "") < 0) {
        g.config.method = caps.defaultMethod;
      }

      var methodRow = el("div", { className: "osc-form-row" });
      methodRow.appendChild(el("label", {}, "Method"));
      var methodSel = el("select", { style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
      caps.availableMethods.forEach(function (m) {
        var opt = el("option", { value: m.id }, m.label);
        if (m.id === (g.config.method || caps.defaultMethod)) opt.selected = true;
        methodSel.appendChild(opt);
      });
      methodSel.addEventListener("change", function () { g.config.method = methodSel.value; _saveGen(g); _renderRightPanel(); });
      methodRow.appendChild(methodSel);
      configCard.appendChild(methodRow);

      var runtimeRow = el("div", { className: "osc-form-row" });
      runtimeRow.appendChild(el("label", {}, "Generation Runtime"));
      var runtimeSel = el("select", { style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
      [{ value: "client", label: "Client (TF.js)" }, { value: "server", label: "Server (PyTorch)" }].forEach(function (opt) {
        var o = el("option", { value: opt.value }, opt.label);
        if (opt.value === (g.config.generationRuntime || "client")) o.selected = true;
        runtimeSel.appendChild(o);
      });
      runtimeSel.addEventListener("change", function () {
        g.config.generationRuntime = runtimeSel.value;
        _saveGen(g);
        _renderRightPanel();
      });
      runtimeRow.appendChild(runtimeSel);
      configCard.appendChild(runtimeRow);

      var runtimeHelp = String(g.config.generationRuntime || "client") === "server"
        ? "Runs generation on the PyTorch server using the current checkpoint."
        : "Runs generation locally in TF.js using the saved checkpoint.";
      configCard.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin-top:-2px;margin-bottom:6px;" }, runtimeHelp));

      // --- Sample node / Output node selectors (from graph) ---
      var _genNodes = { sampleNodes: selectedMeta.info.sampleNodes || [], outputNodes: selectedMeta.info.outputNodes || [] };

      if (_genNodes.sampleNodes.length > 0) {
        var sampleRow = el("div", { className: "osc-form-row" });
        sampleRow.appendChild(el("label", { style: "font-size:11px;color:#94a3b8;" }, "Sample input"));
        var sampleSel = el("select", { style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
        _genNodes.sampleNodes.forEach(function (sn) {
          var label = sn.blockName || ("SampleZ z~" + sn.distribution);
          label += " (dim=" + sn.dim + ")";
          var opt = el("option", { value: sn.id }, label);
          if (sn.id === (g.config.sampleNodeId || _genNodes.sampleNodes[0].id)) opt.selected = true;
          sampleSel.appendChild(opt);
        });
        sampleSel.addEventListener("change", function () { g.config.sampleNodeId = sampleSel.value; _saveGen(g); });
        sampleRow.appendChild(sampleSel);
        configCard.appendChild(sampleRow);
        // auto-set default if not already set
        if (!g.config.sampleNodeId) g.config.sampleNodeId = _genNodes.sampleNodes[0].id;
      }

      if (_genNodes.outputNodes.length > 1) {
        // only show selector when multiple outputs exist
        var outRow = el("div", { className: "osc-form-row" });
        outRow.appendChild(el("label", { style: "font-size:11px;color:#94a3b8;" }, "Output head"));
        var outSel = el("select", { style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
        // auto-detect default: first output with loss=none (generator) or first output
        var _defaultOutId = g.config.outputNodeId || "";
        if (!_defaultOutId) {
          var _genOut = _genNodes.outputNodes.find(function (o) { return o.loss === "none"; });
          _defaultOutId = _genOut ? _genOut.id : _genNodes.outputNodes[0].id;
        }
        _genNodes.outputNodes.forEach(function (on) {
          var label = on.blockName || (on.phase ? on.phase : "Output #" + on.id);
          if (on.loss === "none") label += " [passthrough]";
          else label += " [" + on.loss + "]";
          var opt = el("option", { value: on.id }, label);
          if (on.id === _defaultOutId) opt.selected = true;
          outSel.appendChild(opt);
        });
        outSel.addEventListener("change", function () { g.config.outputNodeId = outSel.value; _saveGen(g); });
        outRow.appendChild(outSel);
        configCard.appendChild(outRow);
        if (!g.config.outputNodeId) g.config.outputNodeId = _defaultOutId;
      } else if (_genNodes.outputNodes.length === 1) {
        // single output — auto-select, no dropdown
        if (!g.config.outputNodeId) g.config.outputNodeId = _genNodes.outputNodes[0].id;
      }

      // Weight selection / checkpoint identity
      var _trainerForWeights = g.trainerId ? (store ? store.getTrainerCard(g.trainerId) : null) : null;
      if (_trainerForWeights && (_trainerForWeights.modelArtifactsLast || _trainerForWeights.modelArtifactsBest || _trainerForWeights.modelArtifacts)) {
        var wsRow = el("div", { className: "osc-form-row" });
        wsRow.appendChild(el("label", { style: "font-size:11px;color:#94a3b8;" }, "Weights"));
        var hasLast = !!(_trainerForWeights.modelArtifactsLast || _trainerForWeights.modelArtifacts);
        var hasBest = !!_trainerForWeights.modelArtifactsBest;
        var selectedWeight = String((g.config && g.config.weightSelection) || "last");
        if (selectedWeight === "best" && !hasBest) selectedWeight = hasLast ? "last" : "best";
        if (selectedWeight === "last" && !hasLast) selectedWeight = hasBest ? "best" : "last";
        g.config.weightSelection = selectedWeight;
        var wsSel = el("select", { style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
        [{ value: "last", label: "Last epoch" }, { value: "best", label: "Best loss" }].forEach(function (opt) {
          var o = el("option", { value: opt.value }, opt.label);
          if (opt.value === selectedWeight) o.selected = true;
          if (opt.value === "last" && !hasLast) o.disabled = true;
          if (opt.value === "best" && !hasBest) o.disabled = true;
          wsSel.appendChild(o);
        });
        wsSel.addEventListener("change", function () {
          g.config.weightSelection = wsSel.value;
          _saveGen(g);
          _renderRightPanel();
        });
        if (!hasLast && !hasBest) {
          wsSel.disabled = true;
        }
        wsRow.appendChild(wsSel);
        configCard.appendChild(wsRow);
        var selectedArtifacts = _getTrainerArtifacts(_trainerForWeights, g.config && g.config.weightSelection);
        if (selectedArtifacts) {
          configCard.appendChild(el("div", { style: "font-size:10px;color:#94a3b8;margin-top:-2px;margin-bottom:6px;" },
            "Checkpoint: " + (_getCheckpointRef(selectedArtifacts) || "unversioned") + " | source=" + String(((selectedArtifacts.checkpoint && selectedArtifacts.checkpoint.producerRuntime) || selectedArtifacts.producerRuntime || ((_trainerForWeights && _trainerForWeights.trainedOnServer) ? "python_server" : "js_client")))));
        }
      }

      // numeric params — show relevant fields based on method
      var currentMethod = g.config.method || "";
      var fields = [
        { key: "numSamples", label: "Samples", value: g.config.numSamples || 16, min: 1, max: 1000, step: 1 },
        { key: "steps", label: "Opt. steps", value: g.config.steps || 100, min: 0, max: 10000, step: 10 },
        { key: "lr", label: "Learning rate", value: g.config.lr || 0.01, min: 0.0001, max: 1, step: 0.001 },
        { key: "temperature", label: "Temperature", value: g.config.temperature || 1.0, min: 0.01, max: 5, step: 0.1 },
        { key: "seed", label: "Seed", value: g.config.seed || 42, min: 1, step: 1 },
      ];
      // classifier guidance fields
      if (currentMethod === "classifier_guided") {
        fields.push({ key: "targetClass", label: "Target class", value: g.config.targetClass || 0, min: 0, max: 99, step: 1 });
        fields.push({ key: "guidanceWeight", label: "Guidance weight", value: g.config.guidanceWeight || 1.0, min: 0.01, max: 10, step: 0.1 });
      }
      fields.forEach(function (f) {
        var row = el("div", { className: "osc-form-row" });
        row.appendChild(el("label", { style: "font-size:11px;color:#94a3b8;" }, f.label));
        var inp = el("input", { type: "number", value: String(f.value), style: "width:100%;padding:4px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:4px;font-size:11px;" });
        if (f.min != null) inp.min = f.min;
        if (f.max != null) inp.max = f.max;
        if (f.step != null) inp.step = f.step;
        inp.addEventListener("change", function () { g.config[f.key] = Number(inp.value); _saveGen(g); });
        row.appendChild(inp);
        configCard.appendChild(row);
      });

      rightEl.appendChild(configCard);

      // check if selected trainer is ready — check both weight sets
      var isReady = !!_getTrainerArtifacts(selectedTrainer, g.config && g.config.weightSelection);

      if (g.trainerId && !isReady) {
        var statusMsg = "Model not trained yet. Train it first in the Trainer tab.";
        if (!selectedTrainer) statusMsg = "Trainer not found";
        else if (selectedTrainer.status === "training" || selectedTrainer.status === "running") statusMsg = "Model is still training...";
        else if (selectedTrainer.status === "stopping") statusMsg = "Model is stopping. Wait for weights to be saved.";
        rightEl.appendChild(el("div", { style: "margin-top:8px;padding:8px;background:#1c1917;border:1px solid #854d0e;border-radius:6px;font-size:11px;color:#fbbf24;" }, statusMsg));
      }

      // buttons
      var genBtn = el("button", { className: "osc-btn", style: "width:100%;margin-top:8px;" }, isGeneratingUi ? "Generating..." : "Generate");
      if (isGeneratingUi || !isReady) genBtn.disabled = true;
      genBtn.addEventListener("click", function () {
        if (genBtn.disabled || _isGenerating || g.status === "generating") return;
        genBtn.disabled = true;
        genBtn.textContent = "Generating...";
        _handleGenerate();
        setTimeout(function () {
          if (!_isGenerating) _renderRightPanel();
        }, 0);
      });
      rightEl.appendChild(genBtn);

      if (g.runs && g.runs.length) {
        var clearBtn = el("button", { className: "osc-btn secondary", style: "width:100%;margin-top:4px;" }, "Clear Results");
        if (isGeneratingUi) clearBtn.disabled = true;
        clearBtn.addEventListener("click", function () {
          g.runs = []; g.status = "draft"; _saveGen(g);
          _renderMainPanel(); _renderLeftPanel();
        });
        rightEl.appendChild(clearBtn);

        rightEl.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin-top:6px;text-align:center;" },
          g.runs.length + " run(s)"));
      }

      if (isGeneratingUi) {
        rightEl.style.position = "relative";
        var generatingOverlay = el("div", {
          style: "position:absolute;inset:0;background:rgba(11,18,32,0.72);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:20;border-radius:8px;cursor:not-allowed;"
        });
        var generatingMsg = el("div", {
          style: "padding:10px 12px;background:#0f172a;border:1px solid #475569;border-radius:8px;color:#e2e8f0;font-size:12px;text-align:center;max-width:220px;cursor:not-allowed;"
        }, [
          el("div", { style: "font-weight:600;color:#38bdf8;margin-bottom:4px;" }, "Generating"),
          el("div", { style: "font-size:11px;color:#cbd5e1;" }, "Wait until this run finishes before changing settings or starting another generation.")
        ]);
        generatingOverlay.appendChild(generatingMsg);
        rightEl.appendChild(generatingOverlay);
      }
    }

    function _getServerAdapter() { var W = typeof window !== "undefined" ? window : {}; return W.OSCServerRuntimeAdapter || null; }

    // ─── GENERATE ───
    function _handleGenerate() {
      var g = _getGen(_activeGenId);
      if (_isGenerating || (g && g.status === "generating")) { onStatus("Already generating..."); return; }
      if (!g || !g.trainerId) { onStatus("Select a model first"); return; }

      var trainer = store.getTrainerCard(g.trainerId);
      // if referenced trainer not trained, auto-find first trained model for this schema
      if (!trainer || !_getTrainerArtifacts(trainer, g.config && g.config.weightSelection)) {
        var allTrainers = _listTrainersForSchema(g.schemaId);
        var trained = allTrainers.filter(function (t) { return !!_getTrainerArtifacts(t, g.config && g.config.weightSelection); });
        if (trained.length) {
          trainer = trained[0];
          g.trainerId = trainer.id;
          var m2 = store ? store.getModel(trainer.modelId) : null;
          g.family = _resolveGenerationInfo(m2).family || g.family;
          _saveGen(g);
          onStatus("Auto-selected trained model: " + trainer.name);
        }
      }
      if (!trainer || !_getTrainerArtifacts(trainer, g.config && g.config.weightSelection)) { onStatus("No trained model available. Train a model first in the Trainer tab."); return; }
      var modelRec = store.getModel(trainer.modelId);
      if (!modelRec) { onStatus("Model not found"); return; }

      var config = g.config || {};
      var method = config.method || "random";
      var trainerBackend = (trainer.config && trainer.config.runtimeBackend) || "auto";
      var trainerArtifacts = _getTrainerArtifacts(trainer, config.weightSelection);
      var generationRuntime = String(config.generationRuntime || "client").trim().toLowerCase();

      var useServerForGen = generationRuntime === "server";
      if (useServerForGen) {
        var serverAdapter = _getServerAdapter();
        if (!serverAdapter) {
          onStatus("Server generation adapter unavailable in this build.");
          return;
        }
        var serverUrl = (trainer.config && trainer.config.serverUrl) || "";
        _isGenerating = true; g.status = "generating"; _saveGen(g);
        onStatus("Checking server for generation...");
        serverAdapter.checkServer(serverUrl).then(function (ok) {
          if (!ok) {
            _isGenerating = false; g.status = "draft"; _saveGen(g);
            onStatus("Server not reachable. Start the server or switch generation runtime to client.");
            _renderLeftPanel(); _renderRightPanel();
            return;
          }
          onStatus("Generating on server (" + method + ")...");
          var dataset = trainer.datasetId ? store.getDataset(trainer.datasetId) : null;
          var dsData2 = dataset && dataset.data ? dataset.data : {};
          var activeDs2 = dsData2.kind === "dataset_bundle" && dsData2.datasets ? dsData2.datasets[dsData2.activeVariantId || Object.keys(dsData2.datasets)[0]] : dsData2;
          // resolve test data via source registry (zero-copy) or fallback
          var W2 = typeof window !== "undefined" ? window : {};
          var srcReg2 = W2.OSCDatasetSourceRegistry || null;
          var sTestSplit = null;
          if (srcReg2 && typeof srcReg2.resolveDatasetSplit === "function") sTestSplit = srcReg2.resolveDatasetSplit(activeDs2, "test");
          var sTestX = (sTestSplit && sTestSplit.x) ? sTestSplit.x : ((activeDs2.records && activeDs2.records.test && activeDs2.records.test.x) || (activeDs2.xTest || []));
          var sFeatureSize = (srcReg2 && typeof srcReg2.getFeatureSize === "function") ? srcReg2.getFeatureSize(activeDs2) : 0;
          if (!sFeatureSize && sTestX.length && sTestX[0]) sFeatureSize = sTestX[0].length;
          var serverConfig = {
            graph: modelRec.graph,
            weightValues: trainerArtifacts && trainerArtifacts.weightValues,
            weightSpecs: trainerArtifacts && trainerArtifacts.weightSpecs,
            featureSize: Number(sFeatureSize || dsData2.featureSize || 40),
            targetSize: Number(sFeatureSize || dsData2.featureSize || 40), numClasses: dsData2.numClasses || dsData2.classCount || 0,
            method: method,
            numSamples: config.numSamples || 16,
            steps: config.steps || 100,
            lr: config.lr || 0.01,
            latentDim: modelBuilder.extractLatentInfo ? (modelBuilder.extractLatentInfo(modelRec.graph).latentDim || 20) : 20,
            temperature: config.temperature || 1.0,
            seed: config.seed || 42,
            targetClass: Number(config.targetClass || 0),
            guidanceWeight: Number(config.guidanceWeight || 1.0),
            sampleNodeId: config.sampleNodeId || "",
            outputNodeId: config.outputNodeId || "",
            originals: method === "reconstruct" ? sTestX.slice(0, config.numSamples || 16) : undefined,
          };
          if (method === "inverse") {
            var sTestY = (sTestSplit && sTestSplit.y) ? sTestSplit.y : ((activeDs2.records && activeDs2.records.test && activeDs2.records.test.y) || (activeDs2.yTest || []));
            if (sTestY && sTestY.length) {
              var sTargetCount = Math.min(config.numSamples || 1, sTestY.length);
              var sTargets = [];
              for (var sti = 0; sti < sTargetCount; sti++) sTargets.push(Array.isArray(sTestY[sti]) ? sTestY[sti] : [sTestY[sti]]);
              serverConfig.target = sTargets;
            }
          }
          serverAdapter.generateOnServer(serverConfig, serverUrl).then(function (result) {
            _isGenerating = false;
            result.runtime = "server";
            result.weightSelection = String(config.weightSelection || "last");
            result.checkpointRef = _getCheckpointRef(trainerArtifacts);
            result.status = "done";
            if (!g.runs) g.runs = [];
            g.runs.push(result); g.status = "done"; _saveGen(g);
            onStatus("Generation done (server): " + (result.numSamples || 0) + " samples");
            _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          }).catch(function (err) {
            _isGenerating = false; g.status = "draft"; _saveGen(g);
            onStatus("Server error: " + err.message + " \u2014 retrain on client or restart server.");
            _renderLeftPanel(); _renderRightPanel();
          });
        });
        return;
      }

      _generateOnClient();
      return;

      function _generateOnClient() {

      var tf = getTf();
      var engine = getGenerationEngine();
      if (!tf || !engine) { onStatus("TF.js or generation engine not available"); return; }

      _isGenerating = true;
      g.status = "generating";
      _saveGen(g);
      onStatus("Generating (" + method + ")...");
      var currentMountId = ++_mountId;

      try {
        var schemaId = trainer.schemaId || g.schemaId;
        var allowedOutputKeys = schemaRegistry ? schemaRegistry.getOutputKeys(schemaId) : [];
        var defaultTarget = (allowedOutputKeys[0] && (allowedOutputKeys[0].key || allowedOutputKeys[0])) || "";
        var graphMode = modelBuilder.inferGraphMode(modelRec.graph, "direct");

        var dataset = trainer.datasetId ? store.getDataset(trainer.datasetId) : null;
        var dsData = dataset && dataset.data ? dataset.data : {};
        // Resolve featureSize: dataset → graph input node → source registry → fallback
        var _graphFeatureSize = 0;
        if (modelRec.graph) {
          var _gd = modelBuilder.extractGraphData ? modelBuilder.extractGraphData(modelRec.graph) : null;
          if (_gd) {
            Object.keys(_gd).forEach(function (nid) {
              var nd = _gd[nid];
              if ((nd.name === "input_layer" || nd.name === "image_source_layer" || nd.name === "image_source_block") && nd.data && nd.data.featureSize) {
                _graphFeatureSize = Number(nd.data.featureSize);
              }
            });
          }
        }
        var featureSize = Number(dsData.featureSize || (dsData.xTrain && dsData.xTrain[0] && dsData.xTrain[0].length) || _graphFeatureSize || 40);
        var latentInfo = modelBuilder.extractLatentInfo ? modelBuilder.extractLatentInfo(modelRec.graph) : { latentDim: 16 };
        var latentDim = latentInfo.latentDim || 16;

        var built = modelBuilder.buildModelFromGraph(tf, modelRec.graph, {
          mode: graphMode, featureSize: featureSize, windowSize: 1, seqFeatureSize: featureSize,
          allowedOutputKeys: allowedOutputKeys, defaultTarget: defaultTarget, numClasses: dsData.numClasses || dsData.classCount || 10,
        });

        // load weights — select based on config (last vs best)
        var _artifacts = trainerArtifacts;
        _loadWeights(tf, built.model, _artifacts);

        // determine latent dim and model for generation
        var genModel = built.model;
        var genMeta = _resolveGenerationMeta(modelRec);
        g.family = genMeta.info.family || g.family;

        // --- resolve sampleNodeId → latentDim + sampleInputIndex ---
        var genLatentDim = featureSize;
        var sampleInputIndex = -1; // -1 = auto-detect by dim matching
        var genNodes = { sampleNodes: genMeta.info.sampleNodes || [], outputNodes: genMeta.info.outputNodes || [] };

        if (config.sampleNodeId && genNodes.sampleNodes.length) {
          var selSample = genNodes.sampleNodes.find(function (s) { return s.id === config.sampleNodeId; });
          if (selSample) {
            genLatentDim = selSample.dim;
            // find index in built.inputNodes
            if (built.inputNodes) {
              for (var si = 0; si < built.inputNodes.length; si++) {
                if (built.inputNodes[si].id === config.sampleNodeId) { sampleInputIndex = si; break; }
              }
            }
          }
        } else if (genNodes.sampleNodes.length) {
          genLatentDim = genNodes.sampleNodes[0].dim;
        } else if (latentInfo.latentDim > 0) {
          // Only override featureSize with latentDim if the graph actually has latent nodes
          genLatentDim = latentInfo.latentDim;
        }

        // --- resolve outputNodeId → outputIndex ---
        var outputIndex = 0;
        if (config.outputNodeId && built.headConfigs && built.headConfigs.length > 1) {
          for (var oi = 0; oi < built.headConfigs.length; oi++) {
            if (built.headConfigs[oi].id && built.headConfigs[oi].id.indexOf(config.outputNodeId + ":") === 0) {
              outputIndex = oi; break;
            }
          }
        } else if (genNodes.outputNodes.length > 1) {
          // auto-detect: first output with loss=none (generator passthrough)
          var _autoOut = genNodes.outputNodes.find(function (o) { return o.loss === "none"; });
          if (_autoOut && built.headConfigs) {
            for (var ai = 0; ai < built.headConfigs.length; ai++) {
              if (built.headConfigs[ai].id && built.headConfigs[ai].id.indexOf(_autoOut.id + ":") === 0) {
                outputIndex = ai; break;
              }
            }
          }
        }

        if (genMeta.info.hasLatentDecoder && method !== "inverse" && method !== "reconstruct") {
          try {
            var decoder = modelBuilder.extractDecoder(tf, built.model, latentDim);
            if (decoder && decoder.model) { genModel = decoder.model; genLatentDim = decoder.latentDim || latentDim; outputIndex = 0; }
          } catch (_) { genLatentDim = latentDim; }
        }

        var genConfig = {
          method: method, model: genModel, latentDim: genLatentDim,
          numSamples: config.numSamples || 16, steps: config.steps || 0,
          lr: config.lr || 0.01, temperature: config.temperature || 1.0, seed: config.seed || 42,
          outputIndex: outputIndex, sampleInputIndex: sampleInputIndex,
          onStep: function (step, loss) { if (step % 10 === 0) onStatus("Step " + step + " loss=" + (typeof loss === "number" ? loss.toExponential(3) : "?")); },
        };

        // for classifier_guided: extract classifier from model's classification output
        if (method === "classifier_guided") {
          genConfig.steps = genConfig.steps || 100;
          genConfig.targetClass = Number(config.targetClass || 0);
          genConfig.guidanceWeight = Number(config.guidanceWeight || 1.0);
          // the full model itself serves as classifier if it has classification outputs
          // the generation engine will use the model to compute class probabilities
          genConfig.classifierModel = built.model;
        }

        // helper: resolve split data from source registry or legacy records
        function _resolveGenSplit(ds, split) {
          var W = typeof window !== "undefined" ? window : {};
          var srcReg = W.OSCDatasetSourceRegistry || null;
          if (srcReg && typeof srcReg.resolveDatasetSplit === "function") {
            var s = srcReg.resolveDatasetSplit(ds, split);
            if (s && s.x && s.x.length) return s;
          }
          var rec = ds.records && ds.records[split];
          if (rec) return { x: rec.x || [], y: rec.y || [], length: (rec.x || []).length };
          // fallback to flat fields
          var xKey = "x" + split.charAt(0).toUpperCase() + split.slice(1);
          var yKey = "y" + split.charAt(0).toUpperCase() + split.slice(1);
          return { x: ds[xKey] || [], y: ds[yKey] || [], length: (ds[xKey] || []).length };
        }

        // reconstruct: pass real data through full model
        if (method === "reconstruct") {
          genConfig.fullModel = built.model; genConfig.model = built.model;
          var rActiveDs = _getActiveDs(dsData);
          var rSplit = _resolveGenSplit(rActiveDs, "test");
          var testX = rSplit.x;
          if (!testX.length) { rSplit = _resolveGenSplit(rActiveDs, "train"); testX = rSplit.x; }
          // If no dataset loaded yet, generate noisy samples as input (shows denoising ability)
          if (!testX.length) {
            var nSynth = config.numSamples || 16;
            testX = [];
            for (var ri = 0; ri < nSynth; ri++) {
              var synth = new Array(featureSize);
              for (var rj = 0; rj < featureSize; rj++) synth[rj] = Math.random();
              testX.push(synth);
            }
          }
          genConfig.originals = testX.slice(0, config.numSamples || 16);
        }

        // langevin: pass scoreModel for denoiser-based generation
        if (method === "langevin") {
          genConfig.scoreModel = built.model;
        }

        // inverse: need target
        if (method === "inverse") {
          var iActiveDs = _getActiveDs(dsData);
          var iSplit = _resolveGenSplit(iActiveDs, "test");
          var testY = iSplit.y;
          if (testY.length) {
            var nTarget = Math.min(config.numSamples || 1, testY.length);
            var targets = [];
            for (var ti = 0; ti < nTarget; ti++) targets.push(Array.isArray(testY[ti]) ? testY[ti] : [testY[ti]]);
            genConfig.target = targets;
          }
        }

        engine.generate(tf, genConfig).then(function (result) {
          _isGenerating = false;
          if (currentMountId !== _mountId) return;
          result.runtime = "client";
          result.weightSelection = String(config.weightSelection || "last");
          result.checkpointRef = _getCheckpointRef(_artifacts);
          result.status = "done";
          if (!g.runs) g.runs = [];
          g.runs.push(result);
          g.status = "done";
          _saveGen(g);
          onStatus("Generation done: " + result.numSamples + " samples (" + result.method + ")");
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          if (genModel !== built.model) try { genModel.dispose(); } catch (_) {}
          built.model.dispose();
        }).catch(function (err) {
          _isGenerating = false;
          if (currentMountId !== _mountId) return;
          if (!g.runs) g.runs = [];
          g.runs.push({ method: method, status: "error", error: err.message, samples: [], lossHistory: [], numSamples: 0 });
          g.status = "done";
          _saveGen(g);
          onStatus("Generation error: " + err.message);
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          if (genModel !== built.model) try { genModel.dispose(); } catch (_) {}
          built.model.dispose();
        });

      } catch (e) {
        _isGenerating = false;
        g.status = "draft"; _saveGen(g);
        onStatus("Generation setup error: " + e.message);
        _renderLeftPanel(); _renderRightPanel();
      }
      } // end _generateOnClient
    }

    function _getActiveDs(dsData) {
      var isBundle = dsData.kind === "dataset_bundle" && dsData.datasets;
      return isBundle ? dsData.datasets[dsData.activeVariantId || Object.keys(dsData.datasets)[0]] : dsData;
    }

    function _loadWeights(tf, model, artifacts) {
      var converter = (typeof window !== "undefined" && window.OSCWeightConverter) ? window.OSCWeightConverter : null;
      if (!converter || typeof converter.loadArtifactsIntoModel !== "function") {
        console.warn("[gen] Weight converter not available");
        return;
      }
      var result = converter.loadArtifactsIntoModel(tf, model, artifacts);
      if (!result || !result.loaded) {
        console.warn("[gen] Weight load failed:", result && result.reason ? result.reason : "unknown_error");
        return;
      }
      console.log("[gen] Weights loaded (" + result.mode + ", matched=" + result.matched + ")");
    }

    // ─── Render generated samples — delegates to dataset module or core ───
    function _renderGeneratedSamples(mountEl, samples, trainer, Plotly, originals, method) {
      if (!samples || !samples.length) return;
      var schemaId = trainer ? trainer.schemaId : "";
      var dataset = trainer && trainer.datasetId ? store.getDataset(trainer.datasetId) : null;
      var dsData = dataset && dataset.data ? dataset.data : {};

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

      // image fallback
      var dsSchema = schemaRegistry ? schemaRegistry.getDatasetSchema(schemaId) : null;
      var sampleType = (dsSchema && dsSchema.sampleType) || "";
      var coreRenderer = W.OSCImageRenderCore || null;
      if (sampleType === "image" && coreRenderer) {
        var imgShape = dsData.imageShape || [28, 28, 1];
        // originals first (side-by-side comparison for reconstruct)
        if (originals && originals.length && method === "reconstruct") {
          mountEl.appendChild(el("div", { style: "font-size:10px;color:#67e8f9;margin-bottom:4px;font-weight:600;" }, "Original → Reconstructed"));
        }
        var gridWrap = el("div", { style: "display:flex;flex-wrap:wrap;gap:4px;width:100%;" });
        var maxShow = Math.min(samples.length, 32);
        for (var si = 0; si < maxShow; si++) {
          // for reconstruct: show original-reconstructed pairs
          if (originals && originals[si] && method === "reconstruct") {
            var origCanvas = document.createElement("canvas");
            origCanvas.width = imgShape[0]; origCanvas.height = imgShape[1];
            origCanvas.style.cssText = "width:48px;height:48px;border:1px solid #334155;border-radius:3px;image-rendering:pixelated;";
            coreRenderer.drawImageToCanvas(origCanvas.getContext("2d"), originals[si], imgShape[0], imgShape[1]);
            gridWrap.appendChild(origCanvas);
          }
          var canvas = document.createElement("canvas");
          canvas.width = imgShape[0]; canvas.height = imgShape[1];
          canvas.style.cssText = "width:48px;height:48px;border:1px solid #2d3748;border-radius:3px;image-rendering:pixelated;";
          // clamp generated values to [0,1] range (Langevin/DDPM can produce out-of-range)
          var pixelsClamped = samples[si].map(function (v) { return Math.max(0, Math.min(1, v)); });
          coreRenderer.drawImageToCanvas(canvas.getContext("2d"), pixelsClamped, imgShape[0], imgShape[1]);
          gridWrap.appendChild(canvas);
          // gap between pairs
          if (originals && originals[si] && method === "reconstruct") {
            gridWrap.appendChild(el("div", { style: "width:8px;" }));
          }
        }
        mountEl.appendChild(gridWrap);
        return;
      }

      // generic Plotly
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

      // text fallback
      var text = samples.slice(0, 5).map(function (s, i) {
        return "Sample " + (i + 1) + ": [" + (Array.isArray(s) ? s.slice(0, 10).map(function (v) { return Number(v).toFixed(3); }).join(", ") + (s.length > 10 ? "..." : "") : s) + "]";
      }).join("\n");
      mountEl.appendChild(el("pre", { style: "font-size:10px;color:#94a3b8;background:#171d30;padding:8px;border-radius:4px;" }, text));
    }

    function mount() { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); _startRefreshWatcher(); }
    function unmount() { _mountId++; _stopRefreshWatcher(); layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

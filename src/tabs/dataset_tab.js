(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCDatasetTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(deps) {
    var layout = deps.layout;
    var stateApi = deps.stateApi;
    var store = deps.store;
    var schemaRegistry = deps.schemaRegistry;
    var datasetModules = deps.datasetModules;
    var uiEngine = deps.uiEngine;   // OSCUiSharedEngine
    var modal = deps.modal;
    var onStatus = deps.onStatus || function () {};
    var el = deps.el || function (tag, a, c) {
      var e = document.createElement(tag);
      if (a) Object.keys(a).forEach(function (k) { if (k === "className") e.className = a[k]; else if (k === "textContent") e.textContent = a[k]; else e.setAttribute(k, a[k]); });
      if (c) (Array.isArray(c) ? c : [c]).forEach(function (ch) { if (typeof ch === "string") e.appendChild(document.createTextNode(ch)); else if (ch) e.appendChild(ch); });
      return e;
    };
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };

    var _mountId = 0;
    var _configFormApi = null;

    function _getSchemaId() { return stateApi ? stateApi.getActiveSchema() : ""; }
    function _getModule() {
      if (!datasetModules) return null;
      var mods = datasetModules.getModuleForSchema(_getSchemaId());
      var list = Array.isArray(mods) ? mods : [];
      return list.length && datasetModules.getModule ? datasetModules.getModule(list[0].id) : null;
    }
    function _listDatasets() {
      if (!store) return [];
      // show all datasets, not filtered by active schema — user manages multiple schemas
      return typeof store.listDatasets === "function" ? store.listDatasets({}) : [];
    }

    // === LEFT: use core renderItemList ===
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Datasets"));

      var datasets = _listDatasets();
      var activeId = stateApi ? stateApi.getActiveDataset() : "";

      var items = datasets.map(function (ds) {
        var timePart = ds.generatedAt ? new Date(ds.generatedAt).toLocaleTimeString() : (ds.createdAt ? new Date(ds.createdAt).toLocaleTimeString() : "");
        var statusPart = ds.status === "ready" ? "\u2713 ready" : (ds.status === "generating" ? "\u23f3" : "");
        return {
          id: ds.id,
          title: ds.name || ds.id,
          active: ds.id === activeId,
          metaLines: [ds.schemaId || "", statusPart, timePart].filter(Boolean),
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
          emptyText: "No datasets. Click + New.",
          onOpen: function (itemId) {
            if (stateApi) stateApi.setActiveDataset(itemId);
            _renderLeftPanel();
            _renderMainPanel();
            _renderRightPanel();
          },
          onAction: function (itemId, actionId) {
            if (actionId === "rename") {
              var ds = store ? store.getDataset(itemId) : null;
              if (!ds) return;
              var newName = prompt("Rename:", ds.name || ds.id);
              if (newName && newName.trim()) {
                ds.name = newName.trim();
                store.upsertDataset(ds);
                _renderLeftPanel();
              }
            } else if (actionId === "delete") {
              var ds2 = store ? store.getDataset(itemId) : null;
              if (!ds2) return;
              if (confirm("Delete '" + (ds2.name || ds2.id) + "'?")) {
                store.removeDataset(itemId);
                if (stateApi && stateApi.getActiveDataset() === itemId) stateApi.setActiveDataset("");
                _renderLeftPanel();
                _renderMainPanel();
                _renderRightPanel();
              }
            }
          },
        });
      }

      // + New button
      var newBtn = el("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "+ New Dataset");
      newBtn.addEventListener("click", function () { _openNewModal(); });
      leftEl.appendChild(newBtn);
    }

    function _openNewModal() {
      if (!modal) return;
      var _nameInput, _schemaSelect;
      modal.open({
        title: "New Dataset",
        renderForm: function (mount) {
          var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
          mount.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Name"));
          _nameInput = el("input", { type: "text", placeholder: "my_dataset", style: "width:100%;padding:6px 8px;margin-bottom:8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          mount.appendChild(_nameInput);
          mount.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Schema"));
          _schemaSelect = el("select", { style: "width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
          (schemas).forEach(function (s) {
            var opt = el("option", { value: s.id }); opt.textContent = s.label || s.id;
            if (s.id === _getSchemaId()) opt.selected = true;
            _schemaSelect.appendChild(opt);
          });
          mount.appendChild(_schemaSelect);
          setTimeout(function () { _nameInput.focus(); }, 50);
        },
        onCreate: function () {
          var name = (_nameInput && _nameInput.value.trim()) || "";
          var sid = _schemaSelect ? _schemaSelect.value : "";
          if (!name) { onStatus("Enter a name"); return; }
          var id = "ds_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
          if (store) store.upsertDataset({ id: id, name: name, schemaId: sid, status: "draft", createdAt: Date.now() });
          if (stateApi) { stateApi.setActiveSchema(sid); stateApi.setActiveDataset(id); }
          console.log("[dataset_tab] created:", id, name, "schema:", sid, "total:", _listDatasets().length);
          onStatus("Created: " + name);
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        },
      });
    }

    function _getModuleForSchema(schemaId) {
      if (!datasetModules) return null;
      var mods = datasetModules.getModuleForSchema(schemaId);
      var list = Array.isArray(mods) ? mods : [];
      return list.length && datasetModules.getModule ? datasetModules.getModule(list[0].id) : null;
    }

    // === MIDDLE: delegate to module or show info ===
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";
      var currentMountId = _mountId;
      var activeId = stateApi ? stateApi.getActiveDataset() : "";
      if (!activeId) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Select or create a dataset.")); return; }
      var ds = store ? store.getDataset(activeId) : null;
      if (!ds) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Not found.")); return; }

      // header
      var card = el("div", { className: "osc-card" });
      card.appendChild(el("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, ds.name || ds.id));
      card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;" },
        "Schema: " + escapeHtml(ds.schemaId || "") + " | Status: " + (ds.status === "ready" ? "\u2713 ready" : (ds.status || "empty"))));
      mainEl.appendChild(card);

      if (!ds.data) {
        mainEl.appendChild(el("div", { style: "font-size:12px;color:#64748b;padding:8px;" }, "Configure and generate from right panel."));
        return;
      }

      // data summary
      var d = ds.data;
      var isBundle = d.kind === "dataset_bundle" && d.datasets;
      var activeDs = isBundle ? d.datasets[d.activeVariantId || Object.keys(d.datasets)[0]] : d;

      var parts = [];
      if (activeDs) {
        if (activeDs.trainCount || (activeDs.xTrain && activeDs.xTrain.length)) parts.push("Train: " + (activeDs.trainCount || (activeDs.xTrain || []).length));
        if (activeDs.valCount || (activeDs.xVal && activeDs.xVal.length)) parts.push("Val: " + (activeDs.valCount || (activeDs.xVal || []).length));
        if (activeDs.testCount || (activeDs.xTest && activeDs.xTest.length)) parts.push("Test: " + (activeDs.testCount || (activeDs.xTest || []).length));
        if (activeDs.featureSize) parts.push("Features: " + activeDs.featureSize);
        if (activeDs.classCount) parts.push("Classes: " + activeDs.classCount);
        if (isBundle) parts.push("Variant: " + (d.activeVariantId || ""));
      } else {
        if (d.trainCount) parts.push("Train: " + d.trainCount);
        if (d.valCount) parts.push("Val: " + d.valCount);
        if (d.testCount) parts.push("Test: " + d.testCount);
        if (d.classCount) parts.push("Classes: " + d.classCount);
      }
      if (parts.length) mainEl.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;padding:4px 8px;" }, parts.join(" | ")));

      // delegate dataset preview to module or core renderer
      var mod = _getModuleForSchema(ds.schemaId);
      var previewMount = el("div", { style: "margin-top:8px;" });
      mainEl.appendChild(previewMount);

      // ensure source is loaded before rendering (source-backed datasets)
      var W = typeof window !== "undefined" ? window : {};
      var srcReg = W.OSCDatasetSourceRegistry || null;
      if (d.sourceId && srcReg && !srcReg.has(d.sourceId)) {
        // source not loaded yet — trigger load via module build (which fetches + registers)
        previewMount.appendChild(el("div", { style: "color:#fbbf24;font-size:12px;" }, "Loading source data..."));
        if (mod && typeof mod.build === "function") {
          mod.build({ seed: 42, totalCount: 1, variant: d.datasetModuleId || ds.schemaId }).then(function () {
            if (currentMountId !== _mountId) return;
            _renderMainPanel(); // re-render now that source is loaded
          }).catch(function (err) {
            previewMount.innerHTML = "";
            previewMount.appendChild(el("div", { style: "color:#f43f5e;font-size:11px;" }, "Source load error: " + err.message));
          });
        }
        return;
      }

      var previewDeps = {
        el: el, escapeHtml: escapeHtml,
        Plotly: (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null,
        isCurrent: function () { return currentMountId === _mountId; },
        datasetData: d,
      };

      if (mod && mod.playgroundApi && typeof mod.playgroundApi.renderDataset === "function") {
        mod.playgroundApi.renderDataset(previewMount, previewDeps);
      } else if (mod && mod.playgroundApi && typeof mod.playgroundApi.renderPlayground === "function") {
        // fallback to playground renderer with dataset data
        mod.playgroundApi.renderPlayground(previewMount, previewDeps);
      }
    }

    // Recompute train/val/test auto-count fields from current form values
    function _updateAutoCountFields(panelEl) {
      var allInps = panelEl.querySelectorAll("[data-config-key]");
      var cfg = {};
      allInps.forEach(function (inp) {
        var k = inp.getAttribute("data-config-key");
        cfg[k] = inp.type === "checkbox" ? inp.checked : (inp.type === "number" ? Number(inp.value) : inp.value);
      });
      var useFullSource = Boolean(cfg.useFullSource);
      var totalCount = useFullSource ? 60000 : (Number(cfg.totalCount) || 1400);
      var trainFrac = Number(cfg.trainFrac) || 0.8;
      var valFrac = Number(cfg.valFrac) || 0.1;
      var trainN = Math.round(totalCount * trainFrac);
      var valN = Math.round(totalCount * valFrac);
      var testN = Math.max(0, totalCount - trainN - valN);
      // update totalCount display if useFullSource changed
      var tcInp = panelEl.querySelector("[data-config-key='totalCount']");
      if (tcInp && useFullSource) tcInp.value = String(totalCount);
      // update auto count fields
      var trInp = panelEl.querySelector("[data-config-key='trainCount']");
      var vaInp = panelEl.querySelector("[data-config-key='valCount']");
      var teInp = panelEl.querySelector("[data-config-key='testCount']");
      if (trInp) trInp.value = String(trainN);
      if (vaInp) vaInp.value = String(valN);
      if (teInp) teInp.value = String(testN);
    }

    // === RIGHT: global config from schema + module-specific config ===
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      if (_configFormApi && typeof _configFormApi.destroy === "function") { _configFormApi.destroy(); _configFormApi = null; }

      var activeId = stateApi ? stateApi.getActiveDataset() : "";
      var ds = activeId && store ? store.getDataset(activeId) : null;
      if (!ds) { rightEl.appendChild(el("h3", {}, "Config")); rightEl.appendChild(el("div", { className: "osc-empty" }, "Select a dataset.")); return; }

      rightEl.appendChild(el("h3", {}, "Config: " + escapeHtml(ds.name || ds.id)));

      // 1. GLOBAL config from schema (shared across all dataset types)
      var dsSchema = schemaRegistry ? schemaRegistry.getDatasetSchema(ds.schemaId) : null;
      var splitDefaults = (dsSchema && dsSchema.splitDefaults) || {};
      var splitModes = (dsSchema && dsSchema.metadata && dsSchema.metadata.splitModes) || [];

      var globalSchema = [
        { key: "seed", label: "Random Seed", type: "number" },
      ];
      // split mode from schema
      if (splitModes.length) {
        globalSchema.push({
          key: "splitMode", label: "Split mode", type: "select",
          options: splitModes.map(function (m) { return { value: m.id, label: m.label || m.id }; }),
        });
      }
      globalSchema.push({ key: "trainFrac", label: "Train fraction", type: "number", min: 0.01, max: 0.99, step: 0.01 });
      globalSchema.push({ key: "valFrac", label: "Val fraction", type: "number", min: 0.01, max: 0.99, step: 0.01 });
      globalSchema.push({ key: "testFrac", label: "Test fraction", type: "number", min: 0.01, max: 0.99, step: 0.01, disabled: true });

      // merge saved config (from previous generate) with schema defaults
      var savedCfg = (ds.config && typeof ds.config === "object") ? ds.config : {};
      var globalValue = {
        seed: savedCfg.seed || 42,
        splitMode: savedCfg.splitMode || splitDefaults.mode || "random",
        trainFrac: Number(savedCfg.trainFrac || splitDefaults.train || 0.7).toFixed(2),
        valFrac: Number(savedCfg.valFrac || splitDefaults.val || 0.15).toFixed(2),
        testFrac: Number(savedCfg.testFrac || splitDefaults.test || 0.15).toFixed(2),
      };

      if (uiEngine && typeof uiEngine.renderConfigForm === "function") {
        rightEl.appendChild(el("div", { style: "font-size:11px;color:#67e8f9;margin-bottom:4px;font-weight:600;" }, "Global"));
        var globalMount = el("div", {});
        _configFormApi = uiEngine.renderConfigForm({
          mountEl: globalMount, schema: globalSchema, value: globalValue,
          fieldNamePrefix: "ds", rowClassName: "osc-form-row",
          onChange: function (cfg, ctx) {
            if (ctx && (ctx.key === "trainFrac" || ctx.key === "valFrac")) {
              _updateAutoCountFields(rightEl);
            }
          },
        });
        rightEl.appendChild(globalMount);
      }

      // 2. MODULE-SPECIFIC config (from module.getDatasetConfigSpec, excluding fields already in global)
      var globalKeys = { seed: true, splitMode: true, trainFrac: true, valFrac: true, testFrac: true };
      var mod = _getModuleForSchema(ds.schemaId);
      if (mod && mod.uiApi && typeof mod.uiApi.getDatasetConfigSpec === "function" && uiEngine) {
        var spec = mod.uiApi.getDatasetConfigSpec({});
        var sections = Array.isArray(spec.sections) ? spec.sections : [];
        sections.forEach(function (sec) {
          var fields = Array.isArray(sec.schema) ? sec.schema : [];
          var defaults = (sec.value && typeof sec.value === "object") ? sec.value : {};
          // filter out fields already rendered in global
          var modFields = fields.filter(function (f) { return !globalKeys[f.key || f.id]; });
          if (!modFields.length) return;
          rightEl.appendChild(el("div", { style: "font-size:11px;color:#67e8f9;margin-top:8px;margin-bottom:4px;font-weight:600;" }, sec.title || "Module Config"));
          var modSchema = [];
          var modValue = {};
          modFields.forEach(function (f) {
            var key = f.key || f.id;
            if (!key) return;
            modSchema.push({ key: key, label: f.label || key, type: f.type || "text", options: f.options, min: f.min, max: f.max, step: f.step, disabled: f.disabled });
            modValue[key] = savedCfg[key] !== undefined ? savedCfg[key] : (defaults[key] !== undefined ? defaults[key] : (f.value || ""));
          });
          var modMount = el("div", {});
          uiEngine.renderConfigForm({
            mountEl: modMount, schema: modSchema, value: modValue,
            fieldNamePrefix: "dsmod", rowClassName: "osc-form-row",
            onChange: function (cfg, ctx) {
              if (!ctx || !ctx.key) return;
              // recompute auto counts when relevant fields change
              if (ctx.key === "useFullSource" || ctx.key === "totalCount" || ctx.key === "forceEqualClass" || ctx.key === "trainFrac" || ctx.key === "valFrac") {
                _updateAutoCountFields(rightEl);
              }
            },
          });
          rightEl.appendChild(modMount);
        });
      }

      // initial count update
      _updateAutoCountFields(rightEl);

      // Generate button
      var genBtn = el("button", { className: "osc-btn", style: "width:100%;margin-top:8px;" }, "Generate Dataset");
      genBtn.addEventListener("click", function () { _handleGenerate(ds); });
      rightEl.appendChild(genBtn);
    }

    function _handleGenerate(dsRecord) {
      var mod = _getModuleForSchema(dsRecord.schemaId || _getSchemaId());
      if (!mod || typeof mod.build !== "function") { onStatus("No build function"); return; }

      // collect ALL config from all forms on right panel (global + module-specific)
      var formConfig = {};
      var allInputs = layout.rightEl.querySelectorAll("[data-config-key]");
      allInputs.forEach(function (inp) {
        var key = inp.getAttribute("data-config-key");
        if (inp.type === "checkbox") formConfig[key] = inp.checked;
        else if (inp.type === "number") formConfig[key] = Number(inp.value);
        else formConfig[key] = inp.value;
      });
      var schemaId = dsRecord.schemaId || _getSchemaId();

      // compute derived values
      if (!formConfig.steps && formConfig.durationSec && formConfig.dt) {
        formConfig.steps = Math.floor(Number(formConfig.durationSec) / Number(formConfig.dt));
      }
      if (!formConfig.totalCount && formConfig.mnistTotalCount) formConfig.totalCount = Number(formConfig.mnistTotalCount);
      var buildConfig = Object.assign({ schemaId: schemaId, moduleId: mod.id, variant: schemaId }, formConfig);

      // show loading state
      onStatus("Generating " + (dsRecord.name || dsRecord.id) + "...");
      dsRecord.status = "generating";
      if (store) store.upsertDataset(dsRecord);
      _renderLeftPanel();
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";
      var loadingEl = el("div", { style: "display:flex;align-items:center;gap:8px;padding:24px;" });
      loadingEl.appendChild(el("div", { style: "width:20px;height:20px;border:2px solid #334155;border-top-color:#0ea5e9;border-radius:50;animation:spin 0.8s linear infinite;" }));
      loadingEl.appendChild(el("span", { style: "color:#67e8f9;font-size:13px;" }, "Generating dataset..."));
      mainEl.appendChild(loadingEl);

      // add spinner animation
      var styleEl = document.getElementById("osc-spinner-style");
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "osc-spinner-style";
        styleEl.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
        document.head.appendChild(styleEl);
      }

      var currentMountId = _mountId;
      try {
        var result = mod.build(buildConfig);
        var handle = function (data) {
          if (currentMountId !== _mountId) return;
          if (!data) { onStatus("Empty result"); _renderMainPanel(); return; }
          var updated = Object.assign({}, dsRecord, { data: data, status: "ready", generatedAt: Date.now(), config: formConfig });
          if (store) store.upsertDataset(updated);
          onStatus("\u2713 Ready: " + (dsRecord.name || dsRecord.id));
          _renderLeftPanel(); _renderMainPanel();
        };
        if (result && typeof result.then === "function") {
          result.then(handle).catch(function (e) {
            dsRecord.status = "error";
            if (store) store.upsertDataset(dsRecord);
            onStatus("Error: " + e.message);
            _renderLeftPanel(); _renderMainPanel();
          });
        } else {
          handle(result);
        }
      } catch (e) {
        dsRecord.status = "error";
        if (store) store.upsertDataset(dsRecord);
        onStatus("Error: " + e.message);
        _renderLeftPanel(); _renderMainPanel();
      }
    }

    function mount() { _mountId++; _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
    function unmount() { _mountId++; if (_configFormApi && typeof _configFormApi.destroy === "function") _configFormApi.destroy(); _configFormApi = null; layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { mount(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

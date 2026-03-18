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
        return {
          id: ds.id,
          title: ds.name || ds.id,
          active: ds.id === activeId,
          metaLines: [(ds.schemaId || "") + (ds.status === "ready" ? " | ready" : " | draft")],
          actions: [
            { id: "rename", label: "rename" },
            { id: "delete", label: "delete" },
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

    // === MIDDLE: delegate to module or show info ===
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";
      var currentMountId = _mountId;
      var activeId = stateApi ? stateApi.getActiveDataset() : "";
      if (!activeId) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Select or create a dataset.")); return; }
      var ds = store ? store.getDataset(activeId) : null;
      if (!ds) { mainEl.appendChild(el("div", { className: "osc-empty" }, "Not found.")); return; }

      // module preview if ready
      var mod = _getModule();
      if (ds.status === "ready" && ds.data && mod && mod.playgroundApi && typeof mod.playgroundApi.renderPlayground === "function") {
        mod.playgroundApi.renderPlayground(mainEl, {
          el: el, escapeHtml: escapeHtml,
          Plotly: (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null,
          configEl: null,
          isCurrent: function () { return currentMountId === _mountId; },
        });
        return;
      }

      // info card
      var card = el("div", { className: "osc-card" });
      card.appendChild(el("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, ds.name || ds.id));
      card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;" },
        "Schema: " + escapeHtml(ds.schemaId || "") + " | Status: " + (ds.status || "draft")));
      if (ds.data) {
        var d = ds.data;
        var parts = [];
        if (d.trainCount || (d.xTrain && d.xTrain.length)) parts.push("Train: " + (d.trainCount || (d.xTrain || []).length));
        if (d.valCount || (d.xVal && d.xVal.length)) parts.push("Val: " + (d.valCount || (d.xVal || []).length));
        if (d.testCount || (d.xTest && d.xTest.length)) parts.push("Test: " + (d.testCount || (d.xTest || []).length));
        if (parts.length) card.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;margin-top:4px;" }, parts.join(" | ")));
      } else {
        card.appendChild(el("div", { style: "font-size:12px;color:#64748b;margin-top:4px;" }, "Configure and generate from right panel."));
      }
      mainEl.appendChild(card);
    }

    // === RIGHT: use core renderConfigForm from module spec ===
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      if (_configFormApi && typeof _configFormApi.destroy === "function") { _configFormApi.destroy(); _configFormApi = null; }

      var activeId = stateApi ? stateApi.getActiveDataset() : "";
      var ds = activeId && store ? store.getDataset(activeId) : null;
      if (!ds) { rightEl.appendChild(el("h3", {}, "Config")); rightEl.appendChild(el("div", { className: "osc-empty" }, "Select a dataset.")); return; }

      rightEl.appendChild(el("h3", {}, "Config: " + escapeHtml(ds.name || ds.id)));

      var mod = _getModule();
      if (mod && mod.uiApi && typeof mod.uiApi.getDatasetConfigSpec === "function" && uiEngine && typeof uiEngine.renderConfigForm === "function") {
        var spec = mod.uiApi.getDatasetConfigSpec({});
        var sections = Array.isArray(spec.sections) ? spec.sections : [];
        // flatten sections into schema array for renderConfigForm
        var formSchema = [];
        var formValue = {};
        sections.forEach(function (sec) {
          if (sec.title) formSchema.push({ key: "__section_" + (sec.id || sec.title), label: sec.title, type: "heading" });
          var fields = Array.isArray(sec.schema) ? sec.schema : [];
          var defaults = (sec.value && typeof sec.value === "object") ? sec.value : {};
          fields.forEach(function (f) {
            var key = f.key || f.id;
            if (!key) return;
            formSchema.push({
              key: key, label: f.label || key, type: f.type || "text",
              options: f.options, min: f.min, max: f.max, step: f.step, disabled: f.disabled,
            });
            formValue[key] = defaults[key] !== undefined ? defaults[key] : (f.value || "");
          });
        });

        var formMount = el("div", {});
        _configFormApi = uiEngine.renderConfigForm({
          mountEl: formMount,
          schema: formSchema,
          value: formValue,
          fieldNamePrefix: "ds",
          rowClassName: "osc-form-row",
        });
        rightEl.appendChild(formMount);
      }

      // Generate button
      var genBtn = el("button", { className: "osc-btn", style: "width:100%;margin-top:8px;" }, "Generate Dataset");
      genBtn.addEventListener("click", function () { _handleGenerate(ds); });
      rightEl.appendChild(genBtn);
    }

    function _handleGenerate(dsRecord) {
      var mod = _getModule();
      if (!mod || typeof mod.build !== "function") { onStatus("No build function"); return; }

      // collect config from core form
      var formConfig = {};
      if (_configFormApi && typeof _configFormApi.getConfig === "function") {
        formConfig = _configFormApi.getConfig();
      }
      var schemaId = dsRecord.schemaId || _getSchemaId();

      // use module's getDatasetBuildConfig if available (transforms form config to build config)
      var buildConfig;
      if (mod.uiApi && typeof mod.uiApi.getDatasetBuildConfig === "function") {
        buildConfig = mod.uiApi.getDatasetBuildConfig({ formConfig: formConfig });
        buildConfig = Object.assign({ schemaId: schemaId, moduleId: mod.id }, buildConfig);
      } else {
        if (!formConfig.steps && formConfig.durationSec && formConfig.dt) {
          formConfig.steps = Math.floor(Number(formConfig.durationSec) / Number(formConfig.dt));
        }
        buildConfig = Object.assign({ schemaId: schemaId, moduleId: mod.id }, formConfig);
      }

      onStatus("Generating...");
      var currentMountId = _mountId;
      try {
        var result = mod.build(buildConfig);
        var handle = function (data) {
          if (currentMountId !== _mountId) return;
          if (!data) { onStatus("Empty result"); return; }
          var updated = Object.assign({}, dsRecord, { data: data, status: "ready", generatedAt: Date.now(), config: formConfig });
          if (store) store.upsertDataset(updated);
          onStatus("Ready: " + (dsRecord.name || dsRecord.id));
          _renderLeftPanel(); _renderMainPanel();
        };
        if (result && typeof result.then === "function") result.then(handle).catch(function (e) { onStatus("Error: " + e.message); });
        else handle(result);
      } catch (e) { onStatus("Error: " + e.message); }
    }

    function mount() { _mountId++; _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
    function unmount() { _mountId++; if (_configFormApi && typeof _configFormApi.destroy === "function") _configFormApi.destroy(); _configFormApi = null; layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { mount(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

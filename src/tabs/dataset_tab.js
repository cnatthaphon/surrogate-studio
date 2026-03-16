(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCDatasetTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(deps) {
    var layout = deps.layout;       // { leftEl, mainEl, rightEl }
    var stateApi = deps.stateApi;   // OSCAppStateCore
    var store = deps.store;         // OSCWorkspaceStore instance
    var schemaRegistry = deps.schemaRegistry;
    var datasetRuntime = deps.datasetRuntime;   // OSCDatasetRuntime
    var datasetModules = deps.datasetModules;   // OSCDatasetModules
    var processingCore = deps.processingCore;   // OSCDatasetProcessingCore
    var imageRender = deps.imageRender;         // OSCImageRenderCore (optional)
    var uiEngine = deps.uiEngine;              // OSCUiSharedEngine
    var onStatus = deps.onStatus || function () {};
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };
    var elFactory = deps.el || function (tag, attrs, children) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "className") e.className = attrs[k];
        else if (k === "textContent") e.textContent = attrs[k];
        else if (k === "innerHTML") e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
      if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
      return e;
    };

    var _configFormApi = null;

    function _getSchemaId() {
      return stateApi ? stateApi.getActiveSchema() : "";
    }

    function _getModule() {
      var schemaId = _getSchemaId();
      if (datasetRuntime && typeof datasetRuntime.pickDefaultModuleForSchema === "function") {
        return datasetRuntime.pickDefaultModuleForSchema(schemaId);
      }
      if (datasetModules && typeof datasetModules.getModuleForSchema === "function") {
        var mods = datasetModules.getModuleForSchema(schemaId);
        return Array.isArray(mods) && mods.length ? mods[0] : null;
      }
      return null;
    }

    function _listSavedDatasets() {
      if (!store) return [];
      var schemaId = _getSchemaId();
      if (typeof store.listDatasets === "function") {
        return store.listDatasets({ schemaId: schemaId });
      }
      if (typeof store.query === "function") {
        return store.query("dataset").filter(function (d) { return d.schemaId === schemaId; });
      }
      return [];
    }

    function _buildConfigSpec() {
      var schemaId = _getSchemaId();
      var mod = _getModule();

      // use module-provided config spec (full sections with defaults)
      if (mod && mod.uiApi && typeof mod.uiApi.getDatasetConfigSpec === "function") {
        try {
          var spec = mod.uiApi.getDatasetConfigSpec({});
          if (spec) {
            // flatten sections into fields array for rendering
            var fields = [];
            var values = {};
            var sections = Array.isArray(spec.sections) ? spec.sections : (Array.isArray(spec.fields) ? [{ schema: spec.fields }] : []);
            sections.forEach(function (section) {
              var schema = Array.isArray(section.schema) ? section.schema : [];
              var sectionValues = (section.value && typeof section.value === "object") ? section.value : {};
              schema.forEach(function (field) {
                var key = field.key || field.id;
                if (!key) return;
                var val = sectionValues[key] !== undefined ? sectionValues[key] : field.value;
                fields.push({
                  kind: field.type === "select" ? "select" : (field.type || "text"),
                  key: key,
                  label: field.label || key,
                  value: val !== undefined ? val : "",
                  min: field.min,
                  max: field.max,
                  step: field.step,
                  disabled: field.disabled,
                  options: field.options,
                });
                values[key] = val;
              });
            });
            if (fields.length) return { fields: fields, values: values };
          }
        } catch (e) {}
      }

      // fallback: build from schema
      var dsSchema = schemaRegistry ? schemaRegistry.getDatasetSchema(schemaId) : null;
      var preconfig = (mod && mod.preconfig && mod.preconfig.dataset) || (dsSchema || {});
      var fields = [
        { kind: "number", key: "seed", label: "Random seed", value: Number(preconfig.seed || 42) },
        { kind: "number", key: "totalCount", label: "Total samples", value: Number(preconfig.totalCount || 200) },
      ];
      var splitDefaults = (dsSchema && dsSchema.splitDefaults) || {};
      fields.push({ kind: "number", key: "trainFrac", label: "Train fraction", value: Number(splitDefaults.train || 0.7), min: 0.1, max: 0.95, step: 0.05 });
      fields.push({ kind: "number", key: "valFrac", label: "Val fraction", value: Number(splitDefaults.val || 0.15), min: 0.05, max: 0.5, step: 0.05 });
      fields.push({ kind: "number", key: "testFrac", label: "Test fraction", value: Number(splitDefaults.test || 0.15), min: 0.05, max: 0.5, step: 0.05 });
      return { fields: fields };
    }

    // --- render ---

    function _renderLeftPanel() {
      var el = layout.leftEl;
      el.innerHTML = "";
      el.appendChild(elFactory("h3", {}, "Saved Datasets"));

      var datasets = _listSavedDatasets();
      var activeId = stateApi ? stateApi.getActiveDataset() : "";

      if (!datasets.length) {
        el.appendChild(elFactory("div", { className: "osc-empty" }, "No datasets yet. Generate one from the config panel."));
      } else {
        var list = elFactory("ul", { className: "osc-item-list" });
        datasets.forEach(function (ds) {
          var li = elFactory("li", {
            "data-id": ds.id,
            className: ds.id === activeId ? "active" : "",
          });
          li.appendChild(elFactory("strong", {}, ds.name || ds.id));
          var meta = elFactory("div", { style: "font-size:11px;color:#64748b;" });
          meta.textContent = (ds.schemaId || "") + " | " + (ds.totalCount || "?") + " samples";
          li.appendChild(meta);
          li.addEventListener("click", function () {
            if (stateApi) stateApi.setActiveDataset(ds.id);
            _renderLeftPanel();
            _renderMainPanel();
          });
          list.appendChild(li);
        });
        el.appendChild(list);
      }

      // new dataset button → opens modal popup
      var modal = deps.modal; // from layout.modal
      var newBtn = elFactory("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "+ New Dataset");
      newBtn.addEventListener("click", function () {
        console.log("[dataset_tab] + New clicked, modal=", modal, "modal.open=", modal && modal.open);
        if (!modal || typeof modal.open !== "function") { console.error("[dataset_tab] modal not available"); return; }
        var _nameInput, _schemaSelect;
        modal.open({
          title: "New Dataset",
          renderForm: function (mount) {
            var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
            var currentSchema = _getSchemaId();
            // name
            mount.appendChild(elFactory("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Dataset Name"));
            _nameInput = elFactory("input", { type: "text", placeholder: "my_dataset", style: "width:100%;padding:6px 8px;margin-bottom:8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
            mount.appendChild(_nameInput);
            // schema
            mount.appendChild(elFactory("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Schema"));
            _schemaSelect = elFactory("select", { style: "width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
            schemas.forEach(function (s) {
              var opt = elFactory("option", { value: s.id });
              opt.textContent = s.label || s.id;
              if (s.id === currentSchema) opt.selected = true;
              _schemaSelect.appendChild(opt);
            });
            mount.appendChild(_schemaSelect);
            setTimeout(function () { _nameInput.focus(); }, 50);
          },
          onCreate: function () {
            var name = _nameInput ? _nameInput.value.trim() : "";
            var sid = _schemaSelect ? _schemaSelect.value : "";
            if (!name) { onStatus("Enter a name"); return; }
            // create draft record in store immediately
            var id = "ds_" + Date.now();
            if (store && typeof store.upsertDataset === "function") {
              store.upsertDataset({ id: id, name: name, schemaId: sid, status: "draft", createdAt: Date.now() });
            }
            if (stateApi) stateApi.setActiveSchema(sid);
            if (stateApi) stateApi.setActiveDataset(id);
            onStatus("Created dataset: " + name);
            _renderLeftPanel();
            _renderMainPanel();
            _renderRightPanel();
          },
        });
      });
      el.appendChild(newBtn);
    }

    function _renderMainPanel() {
      var el = layout.mainEl;
      el.innerHTML = "";

      var activeId = stateApi ? stateApi.getActiveDataset() : "";
      if (activeId) {
        // show dataset details
        var ds = store ? store.getDataset(activeId) : null;
        if (!ds) {
          el.appendChild(elFactory("div", { className: "osc-empty" }, "Dataset not found"));
          return;
        }

        var card = elFactory("div", { className: "osc-card" });
        card.appendChild(elFactory("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, ds.name || ds.id));

        var info = elFactory("div", { style: "font-size:12px;color:#cbd5e1;margin-bottom:8px;" });
        info.innerHTML = "<strong>Schema:</strong> " + escapeHtml(ds.schemaId || "") +
          " | <strong>Samples:</strong> " + (ds.totalCount || "?") +
          " | <strong>Seed:</strong> " + (ds.seed || "?");
        card.appendChild(info);

        // split info
        if (ds.splits) {
          var splitInfo = elFactory("div", { style: "font-size:12px;color:#94a3b8;" });
          splitInfo.textContent = "Train: " + (ds.splits.train || 0) + " | Val: " + (ds.splits.val || 0) + " | Test: " + (ds.splits.test || 0);
          card.appendChild(splitInfo);
        }

        // dataset preview mount
        var previewMount = elFactory("div", { id: "dataset-preview-mount", style: "margin-top:12px;" });
        card.appendChild(previewMount);

        // delete button
        var deleteBtn = elFactory("button", { className: "osc-btn secondary", style: "margin-top:8px;" }, "Delete Dataset");
        deleteBtn.addEventListener("click", function () {
          if (store && typeof store.removeDataset === "function") store.removeDataset(activeId);
          if (stateApi) stateApi.setActiveDataset("");
          _renderLeftPanel();
          _renderMainPanel();
        });
        card.appendChild(deleteBtn);
        el.appendChild(card);
      } else {
        // show generation prompt
        var card = elFactory("div", { className: "osc-card" });
        var schemaId = _getSchemaId();
        var mod = _getModule();
        card.appendChild(elFactory("h3", { style: "color:#67e8f9;margin:0 0 8px;" },
          "Generate " + escapeHtml(schemaId) + " Dataset"));
        card.appendChild(elFactory("p", { style: "color:#94a3b8;font-size:13px;" },
          mod ? ("Using module: " + escapeHtml(mod.label || mod.id)) : "No module available for this schema"));
        el.appendChild(card);
      }
    }

    function _renderRightPanel() {
      var el = layout.rightEl;
      el.innerHTML = "";
      el.appendChild(elFactory("h3", {}, "Dataset Config"));

      var configSpec = _buildConfigSpec();

      // render config form
      if (uiEngine && typeof uiEngine.renderConfigForm === "function") {
        var formMount = elFactory("div", {});
        _configFormApi = uiEngine.renderConfigForm({
          mountEl: formMount,
          schema: configSpec.fields || [],
        });
        el.appendChild(formMount);
      } else {
        // simple fallback form
        var formCard = elFactory("div", { className: "osc-card" });
        (configSpec.fields || []).forEach(function (field) {
          var row = elFactory("div", { className: "osc-form-row" });
          row.appendChild(elFactory("label", {}, field.label || field.key));
          var input = elFactory("input", {
            type: field.kind === "number" ? "number" : "text",
            value: String(field.value != null ? field.value : ""),
            "data-key": field.key,
          });
          if (field.min != null) input.setAttribute("min", field.min);
          if (field.max != null) input.setAttribute("max", field.max);
          if (field.step != null) input.setAttribute("step", field.step);
          row.appendChild(input);
          formCard.appendChild(row);
        });
        el.appendChild(formCard);
      }

      // generate button
      var genBtn = elFactory("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "Generate Dataset");
      genBtn.addEventListener("click", function () { _handleGenerate(); });
      el.appendChild(genBtn);
    }

    function _handleGenerate() {
      var schemaId = _getSchemaId();
      var mod = _getModule();
      if (!mod || typeof mod.build !== "function") {
        onStatus("No build function for module");
        return;
      }

      // collect config from form
      var formConfig = {};
      if (_configFormApi && typeof _configFormApi.getConfig === "function") {
        formConfig = _configFormApi.getConfig();
      } else {
        // read from DOM inputs and selects
        var inputs = layout.rightEl.querySelectorAll("input[data-key], select[data-key]");
        inputs.forEach(function (inp) {
          var key = inp.getAttribute("data-key");
          var val = inp.type === "number" ? Number(inp.value) : inp.value;
          formConfig[key] = val;
        });
      }

      onStatus("Generating dataset...");
      try {
        // pass all form config directly to module build — module knows what it needs
        var buildConfig = Object.assign({ schemaId: schemaId, moduleId: mod.id }, formConfig);
        // ensure steps is computed if module needs it
        if (!buildConfig.steps && buildConfig.durationSec && buildConfig.dt) {
          buildConfig.steps = Math.floor(Number(buildConfig.durationSec) / Number(buildConfig.dt));
        }
        var result = mod.build(buildConfig);

        // handle promise or sync result
        var handleResult = function (ds) {
          if (!ds) { onStatus("Generation returned empty"); return; }
          // save to store
          var id = "ds_" + Date.now();
          var pendingName = stateApi ? stateApi.get("pendingDatasetName") : "";
          var record = {
            id: id,
            name: pendingName || (schemaId + "_" + id),
            schemaId: schemaId,
            moduleId: mod.id,
            seed: Number(formConfig.seed || 42),
            totalCount: Number(formConfig.totalCount || 200),
            splits: ds.splits || {},
            createdAt: Date.now(),
            data: ds,
          };
          if (store && typeof store.upsertDataset === "function") store.upsertDataset(record);
          if (stateApi) stateApi.setActiveDataset(id);
          onStatus("Dataset generated: " + id);
          _renderLeftPanel();
          _renderMainPanel();
        };

        if (result && typeof result.then === "function") {
          result.then(handleResult).catch(function (err) { onStatus("Error: " + String(err.message || err)); });
        } else {
          handleResult(result);
        }
      } catch (err) {
        onStatus("Error: " + String(err.message || err));
      }
    }

    function mount() {
      console.log("[dataset_tab] mount() called, leftEl=", layout.leftEl, "mainEl=", layout.mainEl);
      console.log("[dataset_tab] leftEl.parentNode=", layout.leftEl.parentNode, "visible=", layout.leftEl.offsetParent !== null);
      _renderLeftPanel();
      _renderMainPanel();
      _renderRightPanel();
      console.log("[dataset_tab] after render, leftEl.innerHTML length=", layout.leftEl.innerHTML.length, "children=", layout.leftEl.children.length);
    }

    function unmount() {
      _configFormApi = null;
      layout.leftEl.innerHTML = "";
      layout.mainEl.innerHTML = "";
      layout.rightEl.innerHTML = "";
    }

    function refresh() {
      _renderLeftPanel();
      _renderMainPanel();
      _renderRightPanel();
    }

    return {
      mount: mount,
      unmount: unmount,
      refresh: refresh,
    };
  }

  return { create: create };
});

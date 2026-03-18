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
    var modal = deps.modal;
    var onStatus = deps.onStatus || function () {};
    var el = deps.el || function (tag, attrs, children) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "className") e.className = attrs[k];
        else if (k === "textContent") e.textContent = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
      if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
      return e;
    };
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };

    var _mountId = 0;

    function _getSchemaId() { return stateApi ? stateApi.getActiveSchema() : ""; }

    function _getModule() {
      var schemaId = _getSchemaId();
      if (!datasetModules) return null;
      var mods = datasetModules.getModuleForSchema(schemaId);
      var modList = Array.isArray(mods) ? mods : [];
      if (modList.length && datasetModules.getModule) return datasetModules.getModule(modList[0].id);
      return null;
    }

    function _listDatasets() {
      if (!store) return [];
      var schemaId = _getSchemaId();
      return (typeof store.listDatasets === "function" ? store.listDatasets({ schemaId: schemaId }) : []);
    }

    // --- LEFT: item list ---
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Datasets"));

      var datasets = _listDatasets();
      var activeId = stateApi ? stateApi.getActiveDataset() : "";

      if (!datasets.length) {
        leftEl.appendChild(el("div", { className: "osc-empty" }, "No datasets. Click + New to create one."));
      } else {
        var list = el("ul", { className: "osc-item-list" });
        datasets.forEach(function (ds) {
          var li = el("li", { className: ds.id === activeId ? "active" : "" });
          var nameSpan = el("strong", {}, ds.name || ds.id);
          li.appendChild(nameSpan);
          li.appendChild(el("div", { style: "font-size:10px;color:#64748b;" },
            (ds.schemaId || "") + (ds.status === "ready" ? " | ready" : "")));

          // action buttons
          var actRow = el("div", { style: "display:flex;gap:4px;margin-top:2px;" });
          var renBtn = el("button", { style: "padding:1px 4px;font-size:9px;border-radius:3px;border:1px solid #475569;background:#1f2937;color:#94a3b8;cursor:pointer;" }, "rename");
          renBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            var newName = prompt("Rename dataset:", ds.name || ds.id);
            if (newName && newName.trim()) {
              ds.name = newName.trim();
              if (store) store.upsertDataset(ds);
              _renderLeftPanel();
            }
          });
          var delBtn = el("button", { style: "padding:1px 4px;font-size:9px;border-radius:3px;border:1px solid #7c2d12;background:#431407;color:#fdba74;cursor:pointer;" }, "delete");
          delBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            if (confirm("Delete dataset '" + (ds.name || ds.id) + "'?")) {
              if (store) store.removeDataset(ds.id);
              if (stateApi && stateApi.getActiveDataset() === ds.id) stateApi.setActiveDataset("");
              _renderLeftPanel();
              _renderMainPanel();
            }
          });
          actRow.appendChild(renBtn);
          actRow.appendChild(delBtn);
          li.appendChild(actRow);

          li.addEventListener("click", function () {
            if (stateApi) stateApi.setActiveDataset(ds.id);
            _renderLeftPanel();
            _renderMainPanel();
          });
          list.appendChild(li);
        });
        leftEl.appendChild(list);
      }

      // + New button
      var newBtn = el("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "+ New Dataset");
      newBtn.addEventListener("click", function () {
        if (!modal) return;
        var _nameInput, _schemaSelect;
        modal.open({
          title: "New Dataset",
          renderForm: function (mount) {
            var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
            var currentSchema = _getSchemaId();
            mount.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Dataset Name"));
            _nameInput = el("input", { type: "text", placeholder: "my_dataset", style: "width:100%;padding:6px 8px;margin-bottom:8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
            mount.appendChild(_nameInput);
            mount.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Schema"));
            _schemaSelect = el("select", { style: "width:100%;padding:6px 8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
            schemas.forEach(function (s) {
              var opt = el("option", { value: s.id });
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
            var id = "ds_" + Date.now();
            if (store) store.upsertDataset({ id: id, name: name, schemaId: sid, status: "draft", createdAt: Date.now() });
            if (stateApi) { stateApi.setActiveSchema(sid); stateApi.setActiveDataset(id); }
            onStatus("Created: " + name);
            _renderLeftPanel();
            _renderMainPanel();
            _renderRightPanel();
          },
        });
      });
      leftEl.appendChild(newBtn);
    }

    // --- MIDDLE: delegate to module or show dataset info ---
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";
      var currentMountId = _mountId;

      var activeId = stateApi ? stateApi.getActiveDataset() : "";
      if (!activeId) {
        mainEl.appendChild(el("div", { className: "osc-empty" }, "Select or create a dataset."));
        return;
      }

      var ds = store ? store.getDataset(activeId) : null;
      if (!ds) {
        mainEl.appendChild(el("div", { className: "osc-empty" }, "Dataset not found."));
        return;
      }

      // if dataset has data and module has renderDataset → delegate
      var mod = _getModule();
      if (mod && mod.playgroundApi && typeof mod.playgroundApi.renderPlayground === "function" && ds.status === "ready" && ds.data) {
        // reuse module renderer for dataset preview
        mod.playgroundApi.renderPlayground(mainEl, {
          el: el, escapeHtml: escapeHtml,
          Plotly: (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null,
          configEl: null, // don't render config in main panel
          isCurrent: function () { return currentMountId === _mountId; },
          datasetRecord: ds,
        });
        return;
      }

      // default: show dataset info card
      var card = el("div", { className: "osc-card" });
      card.appendChild(el("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, ds.name || ds.id));
      card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;" },
        "Schema: " + escapeHtml(ds.schemaId || "") + " | Status: " + (ds.status || "draft")));

      if (ds.data) {
        var data = ds.data;
        var info = [];
        if (data.trainCount || (data.xTrain && data.xTrain.length)) info.push("Train: " + (data.trainCount || (data.xTrain || []).length));
        if (data.valCount || (data.xVal && data.xVal.length)) info.push("Val: " + (data.valCount || (data.xVal || []).length));
        if (data.testCount || (data.xTest && data.xTest.length)) info.push("Test: " + (data.testCount || (data.xTest || []).length));
        if (data.classCount) info.push("Classes: " + data.classCount);
        if (data.featureSize) info.push("Features: " + data.featureSize);
        if (info.length) card.appendChild(el("div", { style: "font-size:12px;color:#cbd5e1;margin-top:4px;" }, info.join(" | ")));
      } else {
        card.appendChild(el("div", { style: "font-size:12px;color:#64748b;margin-top:4px;" }, "Configure and generate from the right panel."));
      }
      mainEl.appendChild(card);
    }

    // --- RIGHT: config from module + generate button ---
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";

      var activeId = stateApi ? stateApi.getActiveDataset() : "";
      var ds = activeId && store ? store.getDataset(activeId) : null;
      if (!ds) {
        rightEl.appendChild(el("h3", {}, "Dataset Config"));
        rightEl.appendChild(el("div", { className: "osc-empty" }, "Select or create a dataset."));
        return;
      }

      rightEl.appendChild(el("h3", {}, "Config: " + escapeHtml(ds.name || ds.id)));

      var mod = _getModule();

      // render config form from module's getDatasetConfigSpec
      if (mod && mod.uiApi && typeof mod.uiApi.getDatasetConfigSpec === "function") {
        var spec = mod.uiApi.getDatasetConfigSpec({});
        var sections = Array.isArray(spec.sections) ? spec.sections : [];
        sections.forEach(function (section) {
          var secDiv = el("div", { style: "margin-bottom:8px;" });
          if (section.title) secDiv.appendChild(el("div", { style: "font-size:11px;color:#67e8f9;margin-bottom:4px;font-weight:600;" }, section.title));
          var fields = Array.isArray(section.schema) ? section.schema : [];
          var defaults = (section.value && typeof section.value === "object") ? section.value : {};
          fields.forEach(function (field) {
            var key = field.key || field.id;
            if (!key) return;
            var row = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;" });
            row.appendChild(el("span", { style: "font-size:10px;color:#94a3b8;min-width:90px;" }, field.label || key));
            var val = defaults[key] !== undefined ? defaults[key] : (field.value || "");
            var inp;
            if (field.type === "select" && Array.isArray(field.options)) {
              inp = el("select", { "data-config-key": key, style: "width:90px;padding:2px 4px;font-size:10px;border-radius:4px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
              field.options.forEach(function (opt) {
                var o = el("option", { value: opt.value });
                o.textContent = opt.label || opt.value;
                if (String(opt.value) === String(val)) o.selected = true;
                inp.appendChild(o);
              });
            } else if (field.type === "checkbox") {
              inp = el("input", { type: "checkbox", "data-config-key": key });
              inp.checked = Boolean(val);
              inp.style.cssText = "width:auto;";
            } else {
              inp = el("input", { type: field.type || "text", value: String(val), "data-config-key": key,
                style: "width:90px;padding:2px 4px;font-size:10px;border-radius:4px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
              if (field.min != null) inp.setAttribute("min", field.min);
              if (field.max != null) inp.setAttribute("max", field.max);
              if (field.step != null) inp.setAttribute("step", field.step);
            }
            row.appendChild(inp);
            secDiv.appendChild(row);
          });
          rightEl.appendChild(secDiv);
        });
      }

      // Generate button
      var genBtn = el("button", { className: "osc-btn", style: "width:100%;margin-top:8px;" }, "Generate Dataset");
      genBtn.addEventListener("click", function () { _handleGenerate(ds); });
      rightEl.appendChild(genBtn);
    }

    function _collectConfig() {
      var config = {};
      var inputs = layout.rightEl.querySelectorAll("[data-config-key]");
      inputs.forEach(function (inp) {
        var key = inp.getAttribute("data-config-key");
        if (inp.type === "checkbox") config[key] = inp.checked;
        else if (inp.type === "number") config[key] = Number(inp.value);
        else config[key] = inp.value;
      });
      return config;
    }

    function _handleGenerate(dsRecord) {
      var mod = _getModule();
      if (!mod || typeof mod.build !== "function") { onStatus("No build function"); return; }

      var formConfig = _collectConfig();
      var schemaId = dsRecord.schemaId || _getSchemaId();

      // compute steps if needed
      if (!formConfig.steps && formConfig.durationSec && formConfig.dt) {
        formConfig.steps = Math.floor(Number(formConfig.durationSec) / Number(formConfig.dt));
      }

      var buildConfig = Object.assign({ schemaId: schemaId, moduleId: mod.id }, formConfig);
      onStatus("Generating...");

      try {
        var result = mod.build(buildConfig);
        var currentMountId = _mountId;
        var handleResult = function (data) {
          if (currentMountId !== _mountId) return;
          if (!data) { onStatus("Generation returned empty"); return; }
          // update store
          var updated = Object.assign({}, dsRecord, {
            data: data,
            status: "ready",
            generatedAt: Date.now(),
            config: formConfig,
          });
          if (store) store.upsertDataset(updated);
          onStatus("Dataset ready: " + (dsRecord.name || dsRecord.id));
          _renderLeftPanel();
          _renderMainPanel();
        };
        if (result && typeof result.then === "function") {
          result.then(handleResult).catch(function (err) { onStatus("Error: " + err.message); });
        } else {
          handleResult(result);
        }
      } catch (err) {
        onStatus("Error: " + err.message);
      }
    }

    // --- lifecycle ---
    function mount() {
      _mountId++;
      _renderLeftPanel();
      _renderMainPanel();
      _renderRightPanel();
    }
    function unmount() {
      _mountId++;
      layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = "";
    }
    function refresh() { mount(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

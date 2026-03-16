(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCModelTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(deps) {
    var layout = deps.layout;         // { leftEl, mainEl, rightEl }
    var stateApi = deps.stateApi;     // OSCAppStateCore
    var store = deps.store;           // OSCWorkspaceStore instance
    var schemaRegistry = deps.schemaRegistry;
    var modelGraphCore = deps.modelGraphCore;   // OSCModelGraphCore
    var drawflowAdapter = deps.drawflowAdapter; // OSCModelGraphDrawflowAdapter
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

    var _editor = null;
    var _graphRuntime = null;
    var _nodeConfigFormApi = null;
    var _selectedNodeId = null;

    function _getSchemaId() {
      return stateApi ? stateApi.getActiveSchema() : "";
    }

    function _listSavedModels() {
      if (!store) return [];
      var schemaId = _getSchemaId();
      if (typeof store.listModels === "function") {
        return store.listModels({ schemaId: schemaId });
      }
      return [];
    }

    function _getPaletteItems() {
      var schemaId = _getSchemaId();
      if (!schemaRegistry) return [];
      var schema = schemaRegistry.getModelSchema(schemaId);
      var meta = (schema && schema.metadata && schema.metadata.featureNodes) || {};
      return (meta.palette && Array.isArray(meta.palette.items)) ? meta.palette.items : [];
    }

    function _getPresets() {
      var schemaId = _getSchemaId();
      if (!schemaRegistry) return [];
      var schema = schemaRegistry.getModelSchema(schemaId);
      return Array.isArray(schema && schema.presets) ? schema.presets : [];
    }

    // --- render ---

    function _renderLeftPanel() {
      var el = layout.leftEl;
      el.innerHTML = "";
      el.appendChild(elFactory("h3", {}, "Saved Models"));

      var models = _listSavedModels();
      var activeId = stateApi ? stateApi.getActiveModel() : "";

      if (!models.length) {
        el.appendChild(elFactory("div", { className: "osc-empty" }, "No models yet. Design one or load a preset."));
      } else {
        var list = elFactory("ul", { className: "osc-item-list" });
        models.forEach(function (m) {
          var li = elFactory("li", {
            "data-id": m.id,
            className: m.id === activeId ? "active" : "",
          });
          li.appendChild(elFactory("strong", {}, m.name || m.id));
          var meta = elFactory("div", { style: "font-size:11px;color:#64748b;" });
          meta.textContent = (m.schemaId || "") + " | " + (m.presetId || "custom");
          li.appendChild(meta);
          li.addEventListener("click", function () {
            if (stateApi) stateApi.setActiveModel(m.id);
            _loadModelToEditor(m);
            _renderLeftPanel();
          });
          list.appendChild(li);
        });
        el.appendChild(list);
      }

      // new model button → opens modal popup
      var modal = deps.modal;
      var newBtn = elFactory("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "+ New Model");
      newBtn.addEventListener("click", function () {
        if (!modal) return;
        var _nameInput, _schemaSelect;
        modal.open({
          title: "New Model",
          renderForm: function (mount) {
            var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
            var currentSchema = _getSchemaId();
            mount.appendChild(elFactory("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Model Name"));
            _nameInput = elFactory("input", { type: "text", placeholder: "my_model", style: "width:100%;padding:6px 8px;margin-bottom:8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
            mount.appendChild(_nameInput);
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
            var id = "m_" + Date.now();
            if (store && typeof store.upsertModel === "function") {
              store.upsertModel({ id: id, name: name, schemaId: sid, status: "draft", createdAt: Date.now() });
            }
            if (stateApi) stateApi.setActiveSchema(sid);
            if (stateApi) stateApi.setActiveModel(id);
            onStatus("Created model: " + name);
            _clearEditor();
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

      var schemaId = _getSchemaId();

      // preset selector
      var presets = _getPresets();
      if (presets.length) {
        var presetBar = elFactory("div", { style: "margin-bottom:8px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;" });
        presetBar.appendChild(elFactory("span", { style: "font-size:12px;color:#94a3b8;" }, "Presets:"));
        presets.forEach(function (preset) {
          var pid = (preset && preset.id) || String(preset);
          var plabel = (preset && preset.label) || pid;
          var btn = elFactory("button", { className: "osc-btn sm secondary" }, plabel);
          btn.addEventListener("click", function () { _loadPreset(pid); });
          presetBar.appendChild(btn);
        });
        el.appendChild(presetBar);
      }

      // node palette from schema.model.metadata.featureNodes.palette.items
      var paletteItems = _getPaletteItems();
      if (paletteItems.length) {
        // group by section
        var sections = {};
        paletteItems.forEach(function (item) {
          var sec = item.section || "Nodes";
          if (!sections[sec]) sections[sec] = [];
          sections[sec].push(item);
        });
        Object.keys(sections).forEach(function (secName) {
          var secLabel = elFactory("div", { style: "font-size:11px;color:#64748b;margin-bottom:2px;margin-top:6px;" }, secName);
          el.appendChild(secLabel);
          var palDiv = elFactory("div", { className: "osc-palette" });
          sections[secName].forEach(function (item) {
            var btn = elFactory("button", {}, item.label || item.type);
            btn.addEventListener("click", function () { _addNode(item.type, item.config); });
            palDiv.appendChild(btn);
          });
          el.appendChild(palDiv);
        });
      }

      // Drawflow editor container
      var editorContainer = elFactory("div", { id: "drawflow" });
      el.appendChild(editorContainer);

      // action buttons
      var actionBar = elFactory("div", { style: "margin-top:8px;display:flex;gap:6px;" });
      var saveBtn = elFactory("button", { className: "osc-btn" }, "Save Model");
      saveBtn.addEventListener("click", function () { _handleSave(); });
      var clearBtn = elFactory("button", { className: "osc-btn secondary" }, "Clear");
      clearBtn.addEventListener("click", function () { _clearEditor(); });
      actionBar.appendChild(saveBtn);
      actionBar.appendChild(clearBtn);
      el.appendChild(actionBar);

      // initialize Drawflow
      _initEditor(editorContainer);
    }

    function _renderRightPanel() {
      var el = layout.rightEl;
      el.innerHTML = "";
      el.appendChild(elFactory("h3", {}, "Node Config"));

      if (!_selectedNodeId) {
        el.appendChild(elFactory("div", { className: "osc-empty" }, "Click a node in the graph to configure it."));
        return;
      }

      if (!_editor) return;
      var nodeData;
      try { nodeData = _editor.getNodeFromId(_selectedNodeId); } catch (e) { return; }
      if (!nodeData) return;

      var card = elFactory("div", { className: "osc-card" });
      card.appendChild(elFactory("div", { style: "font-size:13px;color:#67e8f9;margin-bottom:8px;" },
        "Node: " + escapeHtml(nodeData.name || "unknown") + " (#" + _selectedNodeId + ")"));

      // get config spec from model graph core
      if (_graphRuntime && typeof _graphRuntime.getNodeConfigSpec === "function") {
        var configSpec = _graphRuntime.getNodeConfigSpec(nodeData.name);
        if (configSpec && Array.isArray(configSpec.fields) && configSpec.fields.length) {
          var formMount = elFactory("div", {});
          if (uiEngine && typeof uiEngine.renderConfigForm === "function") {
            _nodeConfigFormApi = uiEngine.renderConfigForm({
              mountEl: formMount,
              schema: configSpec.fields,
              config: nodeData.data || {},
              onChange: function (key, value) {
                _applyNodeConfig(key, value);
              },
            });
          }
          card.appendChild(formMount);
        }
      }

      // fallback: show raw data
      if (!_nodeConfigFormApi) {
        var rawData = nodeData.data || {};
        Object.keys(rawData).forEach(function (k) {
          var row = elFactory("div", { className: "osc-form-row" });
          row.appendChild(elFactory("label", {}, k));
          row.appendChild(elFactory("span", { style: "font-size:12px;color:#cbd5e1;" }, String(rawData[k])));
          card.appendChild(row);
        });
      }

      el.appendChild(card);
    }

    function _initEditor(container) {
      var W = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {});
      var Drawflow = W.Drawflow || null;
      if (!Drawflow) {
        container.innerHTML = "<div class='osc-empty'>Drawflow not loaded</div>";
        return;
      }

      _editor = new Drawflow(container);
      _editor.reroute = true;
      _editor.start();

      // node click handler
      _editor.on("nodeSelected", function (id) {
        _selectedNodeId = String(id);
        _renderRightPanel();
      });
      _editor.on("nodeUnselected", function () {
        _selectedNodeId = null;
        _renderRightPanel();
      });

      // create graph runtime
      if (modelGraphCore && typeof modelGraphCore.createRuntime === "function") {
        _graphRuntime = modelGraphCore.createRuntime({
          schemaRegistry: schemaRegistry,
          schemaId: _getSchemaId(),
        });
      }
    }

    function _addNode(nodeType, defaultConfig) {
      if (!_graphRuntime || !_editor) return;
      if (typeof _graphRuntime.createNodeByType === "function") {
        _graphRuntime.createNodeByType(_editor, 250, 200, nodeType, defaultConfig || {});
      }
    }

    function _loadPreset(presetId) {
      if (!_editor) return;
      var schemaId = _getSchemaId();
      if (_graphRuntime && typeof _graphRuntime.seedPreconfigGraph === "function") {
        _graphRuntime.seedPreconfigGraph(_editor, presetId, schemaId);
      } else if (drawflowAdapter && typeof drawflowAdapter.createRuntime === "function") {
        var adapter = drawflowAdapter.createRuntime(schemaId);
        if (typeof adapter.createDrawflowGraphFromPreset === "function") {
          var spec = adapter.createDrawflowGraphFromPreset(schemaId, presetId);
          if (spec) _editor.import(spec);
        }
      }
      onStatus("Loaded preset: " + presetId);
    }

    function _loadModelToEditor(modelRecord) {
      if (!_editor || !modelRecord) return;
      if (modelRecord.graph) {
        try { _editor.import(modelRecord.graph); } catch (e) {}
      }
      _selectedNodeId = null;
      _renderRightPanel();
    }

    function _clearEditor() {
      if (_editor) {
        try { _editor.clear(); } catch (e) {}
      }
      _selectedNodeId = null;
      _renderRightPanel();
    }

    function _applyNodeConfig(key, value) {
      if (!_editor || !_selectedNodeId) return;
      if (_graphRuntime && typeof _graphRuntime.applyNodeConfigValue === "function") {
        _graphRuntime.applyNodeConfigValue(_editor, _selectedNodeId, key, value);
      }
    }

    function _handleSave() {
      if (!_editor || !store) return;
      var schemaId = _getSchemaId();
      var graphExport = _editor.export();
      var id = "m_" + Date.now();
      var pendingName = stateApi ? stateApi.get("pendingModelName") : "";
      var record = {
        id: id,
        name: pendingName || (schemaId + "_model_" + id),
        schemaId: schemaId,
        graph: graphExport,
        createdAt: Date.now(),
      };
      store.upsertModel(record);
      if (stateApi) stateApi.setActiveModel(id);
      onStatus("Model saved: " + id);
      _renderLeftPanel();
    }

    function mount() {
      _renderLeftPanel();
      _renderMainPanel();
      _renderRightPanel();
    }

    function unmount() {
      _editor = null;
      _graphRuntime = null;
      _nodeConfigFormApi = null;
      _selectedNodeId = null;
      layout.leftEl.innerHTML = "";
      layout.mainEl.innerHTML = "";
      layout.rightEl.innerHTML = "";
    }

    function refresh() {
      _renderLeftPanel();
      // don't re-render main (Drawflow state) unless schema changed
      _renderRightPanel();
    }

    return {
      mount: mount,
      unmount: unmount,
      refresh: refresh,
      getEditor: function () { return _editor; },
    };
  }

  return { create: create };
});

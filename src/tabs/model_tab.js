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

    function _getPalette() {
      var schemaId = _getSchemaId();
      if (!schemaRegistry) return {};
      var schema = schemaRegistry.getModelSchema(schemaId);
      return (schema && schema.palette) || {};
    }

    function _getPresets() {
      var schemaId = _getSchemaId();
      if (!schemaRegistry) return {};
      var schema = schemaRegistry.getModelSchema(schemaId);
      return (schema && schema.presets) || {};
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

      // new model button
      var newBtn = elFactory("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "+ New Model");
      newBtn.addEventListener("click", function () {
        if (stateApi) stateApi.setActiveModel("");
        _clearEditor();
        _renderLeftPanel();
        _renderRightPanel();
      });
      el.appendChild(newBtn);
    }

    function _renderMainPanel() {
      var el = layout.mainEl;
      el.innerHTML = "";

      var schemaId = _getSchemaId();

      // preset selector
      var presets = _getPresets();
      var presetIds = Object.keys(presets);
      if (presetIds.length) {
        var presetBar = elFactory("div", { style: "margin-bottom:8px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;" });
        presetBar.appendChild(elFactory("span", { style: "font-size:12px;color:#94a3b8;" }, "Presets:"));
        presetIds.forEach(function (pid) {
          var btn = elFactory("button", { className: "osc-btn sm secondary" }, pid);
          btn.addEventListener("click", function () { _loadPreset(pid); });
          presetBar.appendChild(btn);
        });
        el.appendChild(presetBar);
      }

      // node palette from schema
      var palette = _getPalette();
      var paletteKeys = Object.keys(palette);
      if (paletteKeys.length) {
        var palDiv = elFactory("div", { className: "osc-palette" });
        paletteKeys.forEach(function (nodeType) {
          var btn = elFactory("button", {}, nodeType);
          btn.addEventListener("click", function () { _addNode(nodeType); });
          palDiv.appendChild(btn);
        });
        el.appendChild(palDiv);
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
      if (typeof root.Drawflow === "undefined" && typeof window !== "undefined" && window.Drawflow) {
        // browser
      } else if (typeof root.Drawflow === "undefined") {
        container.innerHTML = "<div class='osc-empty'>Drawflow not loaded</div>";
        return;
      }
      var Drawflow = root.Drawflow || (typeof window !== "undefined" ? window.Drawflow : null);
      if (!Drawflow) return;

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

    function _addNode(nodeType) {
      if (!_graphRuntime || !_editor) return;
      if (typeof _graphRuntime.createNodeByType === "function") {
        _graphRuntime.createNodeByType(_editor, 250, 200, nodeType);
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
      var record = {
        id: id,
        name: schemaId + "_model_" + id,
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

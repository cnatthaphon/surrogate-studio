(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCModelTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(deps) {
    var layout = deps.layout;
    var stateApi = deps.stateApi;
    var store = deps.store;
    var schemaRegistry = deps.schemaRegistry;
    var modelGraphCore = deps.modelGraphCore;
    var uiEngine = deps.uiEngine;
    var modal = deps.modal;
    var onStatus = deps.onStatus || function () {};
    var el = deps.el || function (tag, a, c) {
      var e = document.createElement(tag);
      if (a) Object.keys(a).forEach(function (k) { if (k === "className") e.className = a[k]; else if (k === "textContent") e.textContent = a[k]; else e.setAttribute(k, a[k]); });
      if (c) (Array.isArray(c) ? c : [c]).forEach(function (ch) { if (typeof ch === "string") e.appendChild(document.createTextNode(ch)); else if (ch) e.appendChild(ch); });
      return e;
    };
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };

    var _editor = null;
    var _graphRuntime = null;

    function _getSchemaId() { return stateApi ? stateApi.getActiveSchema() : ""; }

    function _getPaletteItems() {
      if (!schemaRegistry) return [];
      var schema = schemaRegistry.getModelSchema(_getSchemaId());
      var meta = (schema && schema.metadata && schema.metadata.featureNodes) || {};
      return (meta.palette && Array.isArray(meta.palette.items)) ? meta.palette.items : [];
    }

    function _getPresets() {
      if (!schemaRegistry) return [];
      var schema = schemaRegistry.getModelSchema(_getSchemaId());
      return Array.isArray(schema && schema.presets) ? schema.presets : [];
    }

    function _listModels() {
      if (!store) return [];
      return typeof store.listModels === "function" ? store.listModels({ schemaId: _getSchemaId() }) : [];
    }

    // === LEFT: use core renderItemList ===
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Models"));

      var models = _listModels();
      var activeId = stateApi ? stateApi.getActiveModel() : "";
      var items = models.map(function (m) {
        return {
          id: m.id, title: m.name || m.id, active: m.id === activeId,
          metaLines: [(m.schemaId || "") + " | " + (m.presetId || "custom")],
          actions: [{ id: "rename", label: "rename" }, { id: "delete", label: "delete" }],
        };
      });

      var listMount = el("div", {});
      leftEl.appendChild(listMount);
      if (uiEngine && typeof uiEngine.renderItemList === "function") {
        uiEngine.renderItemList({
          mountEl: listMount, items: items, emptyText: "No models. Click + New.",
          onOpen: function (itemId) {
            if (stateApi) stateApi.setActiveModel(itemId);
            var m = store ? store.getModel(itemId) : null;
            if (m && m.graph && _editor) { try { _editor.import(m.graph); } catch (e) {} }
            _renderLeftPanel();
          },
          onAction: function (itemId, actionId) {
            if (actionId === "rename") {
              var m = store ? store.getModel(itemId) : null;
              if (!m) return;
              var name = prompt("Rename:", m.name || m.id);
              if (name && name.trim()) { m.name = name.trim(); store.upsertModel(m); _renderLeftPanel(); }
            } else if (actionId === "delete") {
              var m2 = store ? store.getModel(itemId) : null;
              if (!m2) return;
              if (confirm("Delete '" + (m2.name || m2.id) + "'?")) {
                store.removeModel(itemId);
                if (stateApi && stateApi.getActiveModel() === itemId) stateApi.setActiveModel("");
                _renderLeftPanel(); _renderMainPanel();
              }
            }
          },
        });
      }

      var newBtn = el("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "+ New Model");
      newBtn.addEventListener("click", function () { _openNewModal(); });
      leftEl.appendChild(newBtn);
    }

    function _openNewModal() {
      if (!modal) return;
      var _nameInput, _schemaSelect;
      modal.open({
        title: "New Model",
        renderForm: function (mount) {
          var schemas = schemaRegistry ? schemaRegistry.listSchemas() : [];
          mount.appendChild(el("label", { style: "font-size:12px;color:#94a3b8;display:block;margin-bottom:2px;" }, "Name"));
          _nameInput = el("input", { type: "text", placeholder: "my_model", style: "width:100%;padding:6px 8px;margin-bottom:8px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;" });
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
          var id = "m_" + Date.now();
          if (store) store.upsertModel({ id: id, name: name, schemaId: sid, status: "draft", createdAt: Date.now() });
          if (stateApi) { stateApi.setActiveSchema(sid); stateApi.setActiveModel(id); }
          if (_editor) try { _editor.clear(); } catch (e) {}
          onStatus("Created: " + name);
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
        },
      });
    }

    // === MIDDLE: Drawflow editor + palette ===
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";
      var schemaId = _getSchemaId();

      // preset bar
      var presets = _getPresets();
      if (presets.length) {
        var presetBar = el("div", { style: "margin-bottom:6px;display:flex;gap:4px;align-items:center;flex-wrap:wrap;" });
        presetBar.appendChild(el("span", { style: "font-size:11px;color:#94a3b8;" }, "Presets:"));
        presets.forEach(function (p) {
          var btn = el("button", { style: "padding:3px 8px;font-size:10px;border-radius:6px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;" }, p.label || p.id);
          btn.addEventListener("click", function () {
            if (_graphRuntime && typeof _graphRuntime.seedPreconfigGraph === "function" && _editor) {
              _graphRuntime.seedPreconfigGraph(_editor, p.id, schemaId);
              onStatus("Loaded: " + (p.label || p.id));
            }
          });
          presetBar.appendChild(btn);
        });
        mainEl.appendChild(presetBar);
      }

      // palette grouped by section
      var paletteItems = _getPaletteItems();
      if (paletteItems.length) {
        var sections = {};
        paletteItems.forEach(function (item) {
          var sec = item.section || "Nodes";
          if (!sections[sec]) sections[sec] = [];
          sections[sec].push(item);
        });
        Object.keys(sections).forEach(function (secName) {
          var row = el("div", { style: "margin-bottom:4px;display:flex;align-items:center;gap:3px;flex-wrap:wrap;" });
          row.appendChild(el("span", { style: "font-size:10px;color:#64748b;min-width:60px;" }, secName + ":"));
          sections[secName].forEach(function (item) {
            var btn = el("button", { style: "padding:2px 6px;font-size:10px;border-radius:4px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;" }, item.label || item.type);
            btn.addEventListener("click", function () {
              if (_graphRuntime && _editor && typeof _graphRuntime.createNodeByType === "function") {
                _graphRuntime.createNodeByType(_editor, 250, 200, item.type, item.config || {});
              }
            });
            row.appendChild(btn);
          });
          mainEl.appendChild(row);
        });
      }

      // Drawflow container
      var editorDiv = el("div", { id: "drawflow", style: "width:100%;height:400px;background:#f8fafc;border-radius:10px;margin-top:8px;" });
      mainEl.appendChild(editorDiv);

      // action bar
      var actBar = el("div", { style: "margin-top:8px;display:flex;gap:6px;" });
      var saveBtn = el("button", { className: "osc-btn" }, "Save Model");
      saveBtn.addEventListener("click", function () { _handleSave(); });
      var clearBtn = el("button", { className: "osc-btn secondary" }, "Clear");
      clearBtn.addEventListener("click", function () { if (_editor) try { _editor.clear(); } catch (e) {} });
      actBar.appendChild(saveBtn); actBar.appendChild(clearBtn);
      mainEl.appendChild(actBar);

      // init Drawflow
      _initEditor(editorDiv);
    }

    function _initEditor(container) {
      var W = typeof window !== "undefined" ? window : {};
      var Drawflow = W.Drawflow;
      if (!Drawflow) { container.innerHTML = "<div class='osc-empty'>Drawflow not loaded</div>"; return; }
      _editor = new Drawflow(container);
      _editor.reroute = true;
      _editor.start();
      if (modelGraphCore && typeof modelGraphCore.createRuntime === "function") {
        _graphRuntime = modelGraphCore.createRuntime({});
      }
      _editor.on("nodeSelected", function () { _renderRightPanel(); });
      _editor.on("nodeUnselected", function () { _renderRightPanel(); });
    }

    // === RIGHT: node config (from core) ===
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      rightEl.appendChild(el("h3", {}, "Node Config"));

      if (!_editor) { rightEl.appendChild(el("div", { className: "osc-empty" }, "Editor not initialized.")); return; }

      var selectedId = null;
      try { selectedId = _editor.node_selected; } catch (e) {}
      if (!selectedId) { rightEl.appendChild(el("div", { className: "osc-empty" }, "Click a node to configure.")); return; }

      var nodeData;
      try { nodeData = _editor.getNodeFromId(selectedId); } catch (e) { return; }
      if (!nodeData) return;

      rightEl.appendChild(el("div", { style: "font-size:12px;color:#67e8f9;margin-bottom:8px;" },
        (nodeData.name || "node") + " #" + selectedId));

      // get config spec from modelGraphCore
      if (_graphRuntime && typeof _graphRuntime.getNodeConfigSpec === "function" && uiEngine && typeof uiEngine.renderConfigForm === "function") {
        var spec = _graphRuntime.getNodeConfigSpec(nodeData.name);
        if (spec && Array.isArray(spec.fields) && spec.fields.length) {
          var formMount = el("div", {});
          var formApi = uiEngine.renderConfigForm({
            mountEl: formMount,
            schema: spec.fields,
            value: nodeData.data || {},
            onChange: function (nextConfig) {
              if (_graphRuntime && typeof _graphRuntime.applyNodeConfigValue === "function") {
                Object.keys(nextConfig || {}).forEach(function (k) {
                  _graphRuntime.applyNodeConfigValue(_editor, selectedId, k, nextConfig[k]);
                });
              }
            },
          });
          rightEl.appendChild(formMount);
          return;
        }
      }

      // fallback: raw data display
      var data = nodeData.data || {};
      Object.keys(data).forEach(function (k) {
        rightEl.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:2px;" }, k + ": " + String(data[k])));
      });
    }

    function _handleSave() {
      if (!_editor || !store) return;
      var activeId = stateApi ? stateApi.getActiveModel() : "";
      var graph = _editor.export();
      if (activeId) {
        var existing = store.getModel(activeId);
        if (existing) {
          existing.graph = graph; existing.updatedAt = Date.now();
          store.upsertModel(existing);
          onStatus("Saved: " + (existing.name || existing.id));
          _renderLeftPanel();
          return;
        }
      }
      // no active model — create new
      var id = "m_" + Date.now();
      var schemaId = _getSchemaId();
      store.upsertModel({ id: id, name: schemaId + "_model", schemaId: schemaId, graph: graph, createdAt: Date.now() });
      if (stateApi) stateApi.setActiveModel(id);
      onStatus("Saved: " + id);
      _renderLeftPanel();
    }

    function mount() { _editor = null; _graphRuntime = null; _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
    function unmount() { _editor = null; _graphRuntime = null; layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { _renderLeftPanel(); _renderRightPanel(); }

    return { mount: mount, unmount: unmount, refresh: refresh, getEditor: function () { return _editor; } };
  }

  return { create: create };
});

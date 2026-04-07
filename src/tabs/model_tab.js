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
    var _selectedNodeId = null;

    function _normalizePresetNodeType(rawName) {
      var type = String(rawName || "");
      if (/_layer$/.test(type)) type = type.replace(/_layer$/, "");
      if (/_block$/.test(type) && type !== "transformer_block") type = type.replace(/_block$/, "");
      return type;
    }

    function _getSchemaId() {
      // prefer active model's schema, fallback to active schema
      var activeId = stateApi ? stateApi.getActiveModel() : "";
      if (activeId && store) {
        var m = store.getModel(activeId);
        if (m && m.schemaId) return m.schemaId;
      }
      return stateApi ? stateApi.getActiveSchema() : "";
    }

    function _getPaletteItems() {
      if (!schemaRegistry) return [];
      var schema = schemaRegistry.getModelSchema(_getSchemaId());
      var meta = (schema && schema.metadata && schema.metadata.featureNodes) || {};
      return (meta.palette && Array.isArray(meta.palette.items)) ? meta.palette.items : [];
    }

    // Convert Drawflow export format to graphSpec {nodes, edges} and render via graphRuntime
    function _loadGraphIntoEditor(graph, schemaId) {
      if (!_editor || !_graphRuntime) return;

      // extract Drawflow data
      var data = (graph && graph.drawflow && graph.drawflow.Home && graph.drawflow.Home.data) ||
                 (graph && graph.Home && graph.Home.data) || graph || {};
      var ids = Object.keys(data);
      if (!ids.length) return;

      // convert to graphSpec format: {nodes: [...], edges: [...]}
      var nodes = [];
      var edges = [];
      ids.forEach(function (id) {
        var n = data[id];
        if (!n) return;
        var rawName = String(n.name || n.class || "");
        var type = _normalizePresetNodeType(rawName);
        nodes.push({
          key: String(id),
          type: type,
          x: Number(n.pos_x || 100),
          y: Number(n.pos_y || 100),
          config: n.data || {},
        });
        var outs = n.outputs || {};
        Object.keys(outs).forEach(function (outPort) {
          var conns = (outs[outPort] && outs[outPort].connections) || [];
          conns.forEach(function (c) {
            edges.push({
              from: String(id),
              to: String(c.node),
              out: outPort,
              in: c.input || "input_1",
            });
          });
        });
      });

      var graphSpec = { nodes: nodes, edges: edges };
      try {
        _graphRuntime.renderPresetGraphSpec(_editor, graphSpec, schemaId || _getSchemaId());
      } catch (e) {
        console.warn("[model_tab] renderPresetGraphSpec failed:", e.message, "— falling back to import");
        try { _editor.import(graph); } catch (e2) { console.warn("[model_tab] import also failed:", e2.message); }
      }
    }

    function _getPresets() {
      if (!schemaRegistry) return [];
      var schema = schemaRegistry.getModelSchema(_getSchemaId());
      return Array.isArray(schema && schema.presets) ? schema.presets : [];
    }

    function _listModels() {
      if (!store) return [];
      return typeof store.listModels === "function" ? store.listModels({}) : [];
    }

    // === LEFT: use core renderItemList ===
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Models"));

      var models = _listModels();
      var activeId = stateApi ? stateApi.getActiveModel() : "";
      var items = models.map(function (m) {
        var timePart = m.updatedAt ? new Date(m.updatedAt).toLocaleTimeString() : (m.createdAt ? new Date(m.createdAt).toLocaleTimeString() : "");
        return {
          id: m.id, title: m.name || m.id, active: m.id === activeId,
          metaLines: [m.schemaId || "", m.presetId || "custom", timePart].filter(Boolean),
          actions: [{ id: "rename", label: "\u270e" }, { id: "delete", label: "\u2715" }],
        };
      });

      var listMount = el("div", {});
      leftEl.appendChild(listMount);
      if (uiEngine && typeof uiEngine.renderItemList === "function") {
        uiEngine.renderItemList({
          mountEl: listMount, items: items, emptyText: "No models. Click + New.",
          onOpen: function (itemId) {
            if (stateApi) stateApi.setActiveModel(itemId);
            _selectedNodeId = null;
            _editor = null; _graphRuntime = null;
            _renderLeftPanel();
            _renderMainPanel();
            _renderRightPanel();
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

      var activeId = stateApi ? stateApi.getActiveModel() : "";
      if (!activeId) {
        mainEl.appendChild(el("div", { className: "osc-empty" }, "Select or create a model."));
        return;
      }

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
                _graphRuntime.createNodeByType(_editor, item.type, 250, 200, item.config || {});
              }
            });
            row.appendChild(btn);
          });
          mainEl.appendChild(row);
        });
      }

      // Drawflow container
      var editorDiv = el("div", { id: "drawflow", style: "width:100%;height:400px;border-radius:10px;margin-top:8px;" });
      mainEl.appendChild(editorDiv);

      // action bar
      var actBar = el("div", { style: "margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;" });
      var saveBtn = el("button", { className: "osc-btn" }, "Save Model");
      saveBtn.addEventListener("click", function () { _handleSave(); });
      var clearBtn = el("button", { className: "osc-btn secondary" }, "Clear");
      clearBtn.addEventListener("click", function () { if (_editor) try { _editor.clear(); } catch (e) {} });
      var exportBtn = el("button", { className: "osc-btn secondary" }, "Export JSON");
      exportBtn.addEventListener("click", function () {
        if (!_editor) return;
        var json = JSON.stringify(_editor.export(), null, 2);
        var blob = new Blob([json], { type: "application/json" });
        var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
        a.download = "model_graph.json"; a.click(); URL.revokeObjectURL(a.href);
        onStatus("Exported graph JSON");
      });
      var importBtn = el("button", { className: "osc-btn secondary" }, "Import JSON");
      var importFile = el("input", { type: "file", style: "display:none;" });
      importFile.setAttribute("accept", ".json,application/json");
      importFile.addEventListener("change", function () {
        if (!importFile.files || !importFile.files[0] || !_editor) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = JSON.parse(ev.target.result);
            _editor.import(data);
            onStatus("Imported graph");
          } catch (e) { onStatus("Import error: " + e.message); }
        };
        reader.readAsText(importFile.files[0]);
      });
      importBtn.addEventListener("click", function () { importFile.click(); });
      var autoArrangeBtn = el("button", { className: "osc-btn secondary" }, "Auto Arrange");
      autoArrangeBtn.addEventListener("click", function () {
        if (!_editor) return;
        try {
          var data = _editor.export().drawflow.Home.data;
          var ids = Object.keys(data);
          if (!ids.length) { onStatus("No nodes to arrange"); return; }
          // topological sort
          var indeg = {}; var adj = {};
          ids.forEach(function (id) { indeg[id] = 0; adj[id] = []; });
          ids.forEach(function (id) {
            var n = data[id]; if (!n || !n.outputs) return;
            Object.keys(n.outputs).forEach(function (ok) {
              (n.outputs[ok].connections || []).forEach(function (c) {
                var to = String(c.node);
                if (indeg[to] != null) { indeg[to]++; adj[id].push(to); }
              });
            });
          });
          var q = ids.filter(function (id) { return indeg[id] === 0; }).sort(function (a, b) { return Number(a) - Number(b); });
          var topo = []; var levels = {};
          while (q.length) {
            var cur = q.shift(); topo.push(cur);
            var lvl = 0;
            // level = max parent level + 1
            var n = data[cur];
            if (n && n.inputs) {
              Object.keys(n.inputs).forEach(function (ik) {
                (n.inputs[ik].connections || []).forEach(function (c) {
                  var from = String(c.node);
                  if (levels[from] != null) lvl = Math.max(lvl, levels[from] + 1);
                });
              });
            }
            levels[cur] = lvl;
            adj[cur].forEach(function (to) { indeg[to]--; if (indeg[to] === 0) q.push(to); });
            q.sort(function (a, b) { return Number(a) - Number(b); });
          }
          // assign positions by level
          var nodesPerLevel = {};
          topo.forEach(function (id) {
            var l = levels[id] || 0;
            if (!nodesPerLevel[l]) nodesPerLevel[l] = [];
            nodesPerLevel[l].push(id);
          });
          var xGap = 180, yGap = 120, xStart = 80, yStart = 60;
          Object.keys(nodesPerLevel).forEach(function (lvl) {
            var nodes = nodesPerLevel[lvl];
            nodes.forEach(function (id, idx) {
              var node = _editor.getNodeFromId(id);
              if (node) {
                var nx = xStart + Number(lvl) * xGap;
                var ny = yStart + idx * yGap;
                _editor.drawflow.drawflow.Home.data[id].pos_x = nx;
                _editor.drawflow.drawflow.Home.data[id].pos_y = ny;
              }
            });
          });
          // re-render
          var exported = _editor.export();
          _editor.import(exported);
          onStatus("Arranged " + topo.length + " nodes");
        } catch (e) { onStatus("Arrange error: " + e.message); }
      });
      actBar.appendChild(saveBtn); actBar.appendChild(clearBtn); actBar.appendChild(exportBtn); actBar.appendChild(importBtn); actBar.appendChild(autoArrangeBtn);
      mainEl.appendChild(actBar);

      // init Drawflow
      _initEditor(editorDiv);

      // load active model's graph if exists
      var activeId = stateApi ? stateApi.getActiveModel() : "";
      if (activeId && store && _editor) {
        var m = store.getModel(activeId);
        if (m && m.graph) {
          _loadGraphIntoEditor(m.graph, m.schemaId || _getSchemaId());
        }
      }
    }

    function _initEditor(container) {
      var W = typeof window !== "undefined" ? window : {};
      var Drawflow = W.Drawflow;
      if (!Drawflow) { container.innerHTML = "<div class='osc-empty'>Drawflow not loaded</div>"; return; }
      _editor = new Drawflow(container);
      _editor.reroute = true;
      _editor.start();
      console.log("[model_tab] Drawflow started, container:", container.offsetWidth, "x", container.offsetHeight);
      if (modelGraphCore && typeof modelGraphCore.createRuntime === "function") {
        var W = typeof window !== "undefined" ? window : {};
        var oscCore = W.OSCOscillatorDatasetCore || null;
        var mbc = W.OSCModelBuilderCore || null;
        _graphRuntime = modelGraphCore.createRuntime({
          resolveSchemaId: function (id) { return schemaRegistry && typeof schemaRegistry.resolveSchemaId === "function" ? schemaRegistry.resolveSchemaId(id) : String(id || ""); },
          getCurrentSchemaId: function () { return _getSchemaId(); },
          getSchema: function (id) { return schemaRegistry ? schemaRegistry.getSchema(id) : null; },
          getModelSchema: function (id) { return schemaRegistry ? schemaRegistry.getModelSchema(id) : null; },
          getDatasetSchema: function (id) { return schemaRegistry ? schemaRegistry.getDatasetSchema(id) : null; },
          getPresetDefs: function (id) { return schemaRegistry ? schemaRegistry.getPresetDefs(id) : {}; },
          getPresetList: function (id) { return schemaRegistry ? schemaRegistry.getPresetList(id) : []; },
          getOutputKeys: function (id) { return schemaRegistry ? schemaRegistry.getOutputKeys(id) : []; },
          getParamDefs: function (id) { return schemaRegistry ? schemaRegistry.getParamDefs(id) : []; },
          getSchemaPresetDefById: function (schemaId, presetId) {
            var presets = schemaRegistry ? schemaRegistry.getPresetDefs(schemaId) : {};
            // presets may be array or object
            if (Array.isArray(presets)) {
              for (var i = 0; i < presets.length; i++) { if (presets[i] && presets[i].id === presetId) return presets[i]; }
            } else if (presets && typeof presets === "object") {
              return presets[presetId] || null;
            }
            return null;
          },
          clamp: function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); },
          clearEditor: function (editor) { if (editor) try { editor.clear(); } catch (e) {} },
          defaultParamMask: oscCore ? oscCore.defaultParamMask : function () { return {}; },
          normalizeParamMask: oscCore ? oscCore.normalizeParamMask : function (m) { return m || {}; },
          countStaticParams: oscCore ? oscCore.countStaticParams : function () { return 0; },
          normalizeOutputTargetsList: function (raw, fb, schemaIdOrKeys) {
            // model_graph_core passes schemaId as 3rd arg — resolve to keys
            var keys = Array.isArray(schemaIdOrKeys) ? schemaIdOrKeys : (schemaRegistry ? schemaRegistry.getOutputKeys(String(schemaIdOrKeys || "")) : []);
            if (mbc) return mbc.normalizeOutputTargetsList(raw, fb, keys);
            return Array.isArray(raw) ? raw : [String(raw || "")];
          },
          outputTargetsSummaryText: function (targets, schemaId) {
            var keys = schemaRegistry ? schemaRegistry.getOutputKeys(String(schemaId || "")) : [];
            var keyStrs = keys.map(function (k) { return k.key || k; });
            var t = Array.isArray(targets) ? targets : [String(targets || "")];
            if (keyStrs.length) t = t.filter(function (x) { return keyStrs.indexOf(x) >= 0; });
            return "targets=[" + t.join(",") + "]";
          },
          normalizeOneHotKey: function (raw, schemaId) {
            var sid = schemaRegistry ? schemaRegistry.resolveSchemaId(schemaId) : "";
            var ms = schemaRegistry ? schemaRegistry.getModelSchema(sid) : null;
            var meta = (ms && ms.metadata && ms.metadata.featureNodes) || {};
            var oneHots = Array.isArray(meta.oneHot) ? meta.oneHot : [];
            var key = String(raw || "").trim().toLowerCase();
            var allowed = oneHots.map(function (o) { return o.key; });
            return allowed.indexOf(key) >= 0 ? key : (allowed[0] || "scenario");
          },
          oneHotLabel: function (key, schemaId) {
            var sid = schemaRegistry ? schemaRegistry.resolveSchemaId(schemaId) : "";
            var ms = schemaRegistry ? schemaRegistry.getModelSchema(sid) : null;
            var meta = (ms && ms.metadata && ms.metadata.featureNodes) || {};
            var oneHots = Array.isArray(meta.oneHot) ? meta.oneHot : [];
            var hit = oneHots.find(function (o) { return o.key === key; });
            return (hit && hit.label) || key || "";
          },
          normalizeHistorySeriesKey: function (raw, schemaId) {
            var sid = schemaRegistry ? schemaRegistry.resolveSchemaId(schemaId) : "";
            var ms = schemaRegistry ? schemaRegistry.getModelSchema(sid) : null;
            var meta = (ms && ms.metadata && ms.metadata.featureNodes) || {};
            var series = Array.isArray(meta.historySeries) ? meta.historySeries : [];
            var key = String(raw || "").trim().toLowerCase();
            var allowed = series.map(function (s) { return s.key; });
            return allowed.indexOf(key) >= 0 ? key : (allowed[0] || key || "");
          },
          historySeriesLabel: function (key, schemaId) {
            var sid = schemaRegistry ? schemaRegistry.resolveSchemaId(schemaId) : "";
            var ms = schemaRegistry ? schemaRegistry.getModelSchema(sid) : null;
            var meta = (ms && ms.metadata && ms.metadata.featureNodes) || {};
            var series = Array.isArray(meta.historySeries) ? meta.historySeries : [];
            var hit = series.find(function (s) { return s.key === key; });
            return (hit && hit.label) || key || "";
          },
          getImageSourceSpec: function (rawKey, schemaId) {
            var sid = schemaRegistry ? schemaRegistry.resolveSchemaId(schemaId) : schemaId;
            var ms = schemaRegistry ? schemaRegistry.getModelSchema(sid) : null;
            var meta = (ms && ms.metadata && ms.metadata.featureNodes) || {};
            var imgDefs = Array.isArray(meta.imageSource) ? meta.imageSource : [];
            var key = String(rawKey || "").trim().toLowerCase();
            var hit = imgDefs.find(function (d) { return d.key === key; }) || imgDefs[0] || null;
            if (hit) {
              var shape = Array.isArray(hit.shape) ? hit.shape : [28, 28, 1];
              var h = shape[0] || 28, w = shape[1] || 28, c = shape[2] || 1;
              return { sourceKey: hit.key, label: hit.label || hit.key, featureSize: hit.featureSize || h * w * c, shape: shape, height: h, width: w, channels: c };
            }
            var ds = schemaRegistry ? schemaRegistry.getDatasetSchema(sid) : null;
            if (ds && ds.sampleType === "image") {
              // read from schema metadata, not hardcoded
              var modelSchema = schemaRegistry ? schemaRegistry.getModelSchema(sid) : null;
              var imgSrc = (modelSchema && modelSchema.metadata && modelSchema.metadata.featureNodes && modelSchema.metadata.featureNodes.imageSource && modelSchema.metadata.featureNodes.imageSource[0]) || {};
              return { sourceKey: imgSrc.key || "pixel_values", label: imgSrc.label || "pixel values", featureSize: imgSrc.featureSize || 784, shape: imgSrc.shape || [28, 28, 1], height: (imgSrc.shape && imgSrc.shape[0]) || 28, width: (imgSrc.shape && imgSrc.shape[1]) || 28, channels: (imgSrc.shape && imgSrc.shape[2]) || 1 };
            }
            return { sourceKey: "", label: "none", featureSize: 0, shape: [], height: 0, width: 0, channels: 0 };
          },
          estimateNodeFeatureWidth: function () { return 0; },
        });
        console.log("[model_tab] graphRuntime created, methods:", Object.keys(_graphRuntime).length);
      }
      _editor.on("nodeSelected", function (id) {
        _selectedNodeId = Number(id);
        console.log("[model_tab] node selected:", _selectedNodeId);
        _renderRightPanel();
      });
      _editor.on("nodeUnselected", function () { _selectedNodeId = null; _renderRightPanel(); });
    }

    // === RIGHT: node config (from core) ===
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";

      var activeId = stateApi ? stateApi.getActiveModel() : "";
      if (!activeId) { rightEl.appendChild(el("h3", {}, "Config")); rightEl.appendChild(el("div", { className: "osc-empty" }, "Select a model.")); return; }

      rightEl.appendChild(el("h3", {}, "Node Config"));

      if (!_editor) { rightEl.appendChild(el("div", { className: "osc-empty" }, "Editor not initialized.")); return; }

      if (!_selectedNodeId) { rightEl.appendChild(el("div", { className: "osc-empty" }, "Click a node to configure.")); return; }

      var nodeData;
      try { nodeData = _editor.getNodeFromId(_selectedNodeId); } catch (e) { return; }
      if (!nodeData) return;
      console.log("[model_tab] config for:", nodeData.name, "data:", Object.keys(nodeData.data || {}));
      if (!nodeData) return;

      rightEl.appendChild(el("div", { style: "font-size:12px;color:#67e8f9;margin-bottom:8px;" },
        (nodeData.name || "node") + " #" + _selectedNodeId));

      // get config spec from modelGraphCore — pass full node object (not just name)
      if (_graphRuntime && typeof _graphRuntime.getNodeConfigSpec === "function") {
        var rawSpec = _graphRuntime.getNodeConfigSpec(nodeData);
        var allFields = Array.isArray(rawSpec) ? rawSpec : (rawSpec && Array.isArray(rawSpec.fields) ? rawSpec.fields : []);

        // render messages as text, filter out unsupported kinds, map to renderConfigForm schema
        var formFields = [];
        allFields.forEach(function (f) {
          if (f.kind === "message") {
            // render as static text
            if (f.text) rightEl.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin-bottom:4px;padding:2px 4px;border-left:2px solid #334155;" }, f.text));
            return;
          }
          if (f.kind === "checkbox_grid") {
            // render param mask as individual checkboxes from schema params
            var schemaId = _getSchemaId();
            var paramDefs = schemaRegistry ? schemaRegistry.getParamDefs(schemaId) : [];
            var mask = (nodeData.data && nodeData.data.paramMask) || {};
            if (paramDefs.length) {
              var maskDiv = el("div", { style: "margin-bottom:6px;" });
              maskDiv.appendChild(el("div", { style: "font-size:10px;color:#94a3b8;margin-bottom:2px;font-weight:600;" }, "Parameter Mask"));
              var grid = el("div", { style: "display:flex;flex-wrap:wrap;gap:4px;" });
              paramDefs.forEach(function (pd) {
                var key = pd.key || pd;
                var label = pd.label || key;
                var checked = mask[key] !== false;
                var cb = el("input", { type: "checkbox", "data-param-key": key });
                cb.checked = checked;
                cb.style.cssText = "width:auto;margin:0;";
                cb.addEventListener("change", function () {
                  var newMask = Object.assign({}, mask);
                  newMask[key] = cb.checked;
                  if (_graphRuntime && typeof _graphRuntime.applyNodeConfigValue === "function") {
                    _graphRuntime.applyNodeConfigValue(_editor, _selectedNodeId, "paramMask", newMask);
                  }
                });
                var wrap = el("label", { style: "display:flex;align-items:center;gap:2px;font-size:9px;color:#94a3b8;cursor:pointer;" });
                wrap.appendChild(cb);
                wrap.appendChild(document.createTextNode(label));
                grid.appendChild(wrap);
              });
              maskDiv.appendChild(grid);
              rightEl.appendChild(maskDiv);
            }
            return;
          }
          // map kind to type for renderConfigForm
          var field = {
            key: f.key,
            label: f.label || f.key || "",
            type: f.kind === "select" ? "select" : (f.kind === "checkbox" ? "checkbox" : (f.kind === "number" ? "number" : "text")),
            options: f.options,
            min: f.min,
            max: f.max,
            step: f.step,
          };
          formFields.push(field);
        });

        if (formFields.length && uiEngine && typeof uiEngine.renderConfigForm === "function") {
          // build value from node data
          var formValue = {};
          formFields.forEach(function (f) {
            if (f.key && nodeData.data) formValue[f.key] = nodeData.data[f.key];
          });
          var formMount = el("div", {});
          uiEngine.renderConfigForm({
            mountEl: formMount,
            schema: formFields,
            rowClassName: "osc-form-row",
            value: formValue,
            onChange: function (nextConfig) {
              if (_graphRuntime && typeof _graphRuntime.applyNodeConfigValue === "function") {
                Object.keys(nextConfig || {}).forEach(function (k) {
                  _graphRuntime.applyNodeConfigValue(_editor, _selectedNodeId, k, nextConfig[k]);
                });
              }
            },
          });
          rightEl.appendChild(formMount);
          return;
        }
      }

      // fallback: raw data display (skip objects)
      var data = nodeData.data || {};
      Object.keys(data).forEach(function (k) {
        var v = data[k];
        if (v && typeof v === "object") return; // skip objects like paramMask
        rightEl.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:2px;" }, k + ": " + String(v)));
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

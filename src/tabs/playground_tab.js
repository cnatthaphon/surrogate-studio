(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCPlaygroundTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(deps) {
    var layout = deps.layout;       // { leftEl, mainEl, rightEl }
    var stateApi = deps.stateApi;   // OSCAppStateCore instance
    var schemaRegistry = deps.schemaRegistry; // OSCSchemaRegistry
    var datasetModules = deps.datasetModules; // OSCDatasetModules
    var datasetRuntime = deps.datasetRuntime; // OSCDatasetRuntime (optional)
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };
    var elFactory = deps.el || function (tag, attrs, children) {
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

    var oscillatorCore = deps.oscillatorCore;   // OSCOscillatorDatasetCore (optional)
    var imageRender = deps.imageRender;         // OSCImageRenderCore (optional)
    var getPlotly = deps.getPlotly || function () {
      return typeof window !== "undefined" && window.Plotly ? window.Plotly : null;
    };

    var _selectedSchemaId = null;
    var _selectedModuleId = null;

    function _getSchemas() {
      if (schemaRegistry && typeof schemaRegistry.listSchemas === "function") {
        return schemaRegistry.listSchemas();
      }
      return [];
    }

    function _getModulesForSchema(schemaId) {
      if (datasetModules && typeof datasetModules.getModuleForSchema === "function") {
        var mods = datasetModules.getModuleForSchema(schemaId);
        return Array.isArray(mods) ? mods : [];
      }
      if (datasetModules && typeof datasetModules.listModules === "function") {
        return datasetModules.listModules().filter(function (m) { return m.schemaId === schemaId; });
      }
      return [];
    }

    function _renderLeftPanel() {
      var el = layout.leftEl;
      el.innerHTML = "";
      var title = elFactory("h3", {}, "Schemas & Modules");
      el.appendChild(title);

      var schemas = _getSchemas();
      if (!schemas.length) {
        el.appendChild(elFactory("div", { className: "osc-empty" }, "No schemas registered"));
        return;
      }

      var list = elFactory("ul", { className: "osc-item-list" });
      schemas.forEach(function (schema) {
        var li = elFactory("li", {
          "data-schema-id": schema.id,
          className: schema.id === _selectedSchemaId ? "active" : "",
        });
        var label = elFactory("strong", {}, schema.label || schema.id);
        var desc = elFactory("div", { className: "osc-badge" }, schema.id);
        li.appendChild(label);
        li.appendChild(document.createTextNode(" "));
        li.appendChild(desc);

        // show modules under schema
        var modules = _getModulesForSchema(schema.id);
        if (modules.length) {
          var modList = elFactory("div", { style: "margin-top:4px;font-size:11px;color:#64748b;" });
          modules.forEach(function (m) {
            modList.appendChild(document.createTextNode((m.label || m.id) + " "));
          });
          li.appendChild(modList);
        }

        li.addEventListener("click", function () {
          _selectedSchemaId = schema.id;
          _selectedModuleId = modules.length ? modules[0].id : null;
          _renderLeftPanel();
          _renderMainPanel();
          _renderRightPanel();
        });
        list.appendChild(li);
      });
      el.appendChild(list);
    }

    function _renderMainPanel() {
      var el = layout.mainEl;
      el.innerHTML = "";

      if (!_selectedSchemaId) {
        el.appendChild(elFactory("div", { className: "osc-empty" }, "Select a schema to explore"));
        return;
      }

      var schema = schemaRegistry ? schemaRegistry.getSchema(_selectedSchemaId) : null;
      if (!schema) {
        el.appendChild(elFactory("div", { className: "osc-empty" }, "Schema not found: " + escapeHtml(_selectedSchemaId)));
        return;
      }

      // schema overview card
      var card = elFactory("div", { className: "osc-card" });
      card.appendChild(elFactory("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, schema.label || schema.id));
      if (schema.description) {
        card.appendChild(elFactory("p", { style: "color:#94a3b8;font-size:13px;margin:0 0 8px;" }, schema.description));
      }

      // dataset info
      var dsSchema = schema.dataset || {};
      var sampleType = String(dsSchema.sampleType || "unknown");
      var info = elFactory("div", { style: "font-size:12px;color:#cbd5e1;margin-bottom:8px;" });
      info.innerHTML = "<strong>Sample type:</strong> " + escapeHtml(sampleType);
      if (dsSchema.splitDefaults) {
        info.innerHTML += " | <strong>Split:</strong> " +
          escapeHtml(String(dsSchema.splitDefaults.mode || "random")) +
          " (" + (dsSchema.splitDefaults.train || 0.7) + "/" + (dsSchema.splitDefaults.val || 0.15) + "/" + (dsSchema.splitDefaults.test || 0.15) + ")";
      }
      card.appendChild(info);

      // model presets
      var modelSchema = schema.model || {};
      var presets = modelSchema.presets || {};
      var presetIds = Object.keys(presets);
      if (presetIds.length) {
        var presetsTitle = elFactory("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:4px;font-weight:600;" }, "Model Presets (" + presetIds.length + "):");
        card.appendChild(presetsTitle);
        var presetList = elFactory("div", { style: "display:flex;flex-wrap:wrap;gap:4px;" });
        presetIds.forEach(function (pid) {
          var badge = elFactory("span", { className: "osc-badge" }, pid);
          presetList.appendChild(badge);
        });
        card.appendChild(presetList);
      }

      // node palette
      var palette = modelSchema.palette || {};
      var paletteKeys = Object.keys(palette);
      if (paletteKeys.length) {
        var palTitle = elFactory("div", { style: "font-size:12px;color:#94a3b8;margin-top:8px;margin-bottom:4px;font-weight:600;" }, "Node Palette (" + paletteKeys.length + " types):");
        card.appendChild(palTitle);
        var palList = elFactory("div", { style: "display:flex;flex-wrap:wrap;gap:4px;" });
        paletteKeys.forEach(function (nk) {
          var badge = elFactory("span", { className: "osc-badge" }, nk);
          palList.appendChild(badge);
        });
        card.appendChild(palList);
      }

      // output keys
      if (schemaRegistry && typeof schemaRegistry.getOutputKeys === "function") {
        var outputKeys = schemaRegistry.getOutputKeys(_selectedSchemaId);
        if (outputKeys && outputKeys.length) {
          var okTitle = elFactory("div", { style: "font-size:12px;color:#94a3b8;margin-top:8px;margin-bottom:4px;font-weight:600;" }, "Output Targets:");
          card.appendChild(okTitle);
          var okList = elFactory("div", { style: "display:flex;flex-wrap:wrap;gap:4px;" });
          outputKeys.forEach(function (ok) {
            okList.appendChild(elFactory("span", { className: "osc-badge" }, ok));
          });
          card.appendChild(okList);
        }
      }

      el.appendChild(card);

      // module playground preview area
      var modules = _getModulesForSchema(_selectedSchemaId);
      var activeModule = _selectedModuleId
        ? modules.find(function (m) { return m.id === _selectedModuleId; })
        : modules[0];

      if (activeModule) {
        var modCard = elFactory("div", { className: "osc-card" });
        modCard.appendChild(elFactory("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, "Module: " + (activeModule.label || activeModule.id)));
        if (activeModule.description) {
          modCard.appendChild(elFactory("p", { style: "color:#94a3b8;font-size:13px;margin:0 0 8px;" }, activeModule.description));
        }
        var playgroundMode = (activeModule.playground && activeModule.playground.mode) || "generic";
        modCard.appendChild(elFactory("div", { style: "font-size:12px;color:#cbd5e1;" },
          "Playground mode: " + escapeHtml(playgroundMode)));

        // playground interactive preview
        var playgroundMount = elFactory("div", { id: "playground-content-mount", style: "margin-top:12px;" });
        modCard.appendChild(playgroundMount);
        _renderPlaygroundPreview(playgroundMount, activeModule, _selectedSchemaId);
        el.appendChild(modCard);
      }
    }

    function _renderPlaygroundPreview(mountEl, activeModule, schemaId) {
      var playgroundMode = (activeModule && activeModule.playground && activeModule.playground.mode) || "generic";

      if (playgroundMode === "trajectory_simulation" && oscillatorCore) {
        // interactive oscillator preview
        var controls = elFactory("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;" });
        var paramFields = [
          { key: "m", label: "Mass", value: 1.0, min: 0.1, max: 5 },
          { key: "c", label: "Damping", value: 0.25, min: 0, max: 2 },
          { key: "k", label: "Stiffness", value: 4.0, min: 0.1, max: 20 },
          { key: "x0", label: "x(0)", value: 1.0, min: -3, max: 3 },
        ];
        var paramInputs = {};
        paramFields.forEach(function (f) {
          var row = elFactory("div", { style: "display:flex;align-items:center;gap:4px;" });
          row.appendChild(elFactory("label", { style: "font-size:11px;color:#94a3b8;min-width:50px;" }, f.label));
          var inp = elFactory("input", {
            type: "number", value: String(f.value), style: "width:60px;padding:3px;font-size:12px;border-radius:4px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;",
          });
          if (f.min != null) inp.setAttribute("min", f.min);
          if (f.max != null) inp.setAttribute("max", f.max);
          inp.setAttribute("step", "0.1");
          paramInputs[f.key] = inp;
          row.appendChild(inp);
          controls.appendChild(row);
        });
        var runBtn = elFactory("button", { className: "osc-btn sm" }, "Simulate");
        controls.appendChild(runBtn);
        mountEl.appendChild(controls);

        var chartDiv = elFactory("div", { style: "height:280px;" });
        mountEl.appendChild(chartDiv);

        var runSim = function () {
          var condition = {
            scenario: "spring",
            m: Number(paramInputs.m.value) || 1,
            c: Number(paramInputs.c.value) || 0.25,
            k: Number(paramInputs.k.value) || 4,
            x0: Number(paramInputs.x0.value) || 1,
            v0: 0, g: 9.81, dt: 0.02, steps: 400,
            restitution: 0.8, groundModel: "rigid", groundK: 2500, groundC: 90,
          };
          var sim = oscillatorCore.simulateOscillator(condition);
          var Plotly = getPlotly();
          if (Plotly && sim && sim.t && sim.x) {
            Plotly.newPlot(chartDiv, [
              { x: sim.t, y: sim.x, mode: "lines", name: "x(t)", line: { color: "#22d3ee" } },
              { x: sim.t, y: sim.v, mode: "lines", name: "v(t)", line: { color: "#f59e0b", dash: "dot" } },
            ], {
              paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220",
              font: { color: "#e2e8f0" },
              title: "Oscillator Preview (m=" + condition.m + " c=" + condition.c + " k=" + condition.k + ")",
              xaxis: { title: "time (s)", gridcolor: "#1e293b" },
              yaxis: { gridcolor: "#1e293b" },
              legend: { orientation: "h" },
              margin: { t: 40, b: 40, l: 50, r: 20 },
            }, { responsive: true });
          }
        };
        runBtn.addEventListener("click", runSim);
        // auto-run on mount
        setTimeout(runSim, 100);

      } else if (playgroundMode === "image_dataset") {
        // image dataset preview
        mountEl.appendChild(elFactory("div", { style: "color:#94a3b8;font-size:13px;" },
          "Image dataset preview: generate a small sample to see class distribution."));
        var previewBtn = elFactory("button", { className: "osc-btn sm", style: "margin-top:8px;" }, "Preview Samples");
        mountEl.appendChild(previewBtn);
        var previewMount = elFactory("div", { style: "margin-top:8px;" });
        mountEl.appendChild(previewMount);

        previewBtn.addEventListener("click", function () {
          previewMount.innerHTML = "<div style='color:#67e8f9;font-size:12px;'>Generating preview...</div>";
          if (activeModule && typeof activeModule.build === "function") {
            try {
              var previewResult = activeModule.build({ seed: 42, totalCount: 50, variant: schemaId });
              var handlePreview = function (res) {
                if (!res) { previewMount.innerHTML = "<div class='osc-empty'>No data</div>"; return; }
                var info = elFactory("div", { style: "font-size:12px;color:#cbd5e1;" });
                info.textContent = "Samples: " + (res.totalCount || res.xTrain && res.xTrain.length || "?");
                previewMount.innerHTML = "";
                previewMount.appendChild(info);
              };
              if (previewResult && typeof previewResult.then === "function") {
                previewResult.then(handlePreview);
              } else {
                handlePreview(previewResult);
              }
            } catch (e) {
              previewMount.innerHTML = "<div style='color:#f43f5e;font-size:12px;'>Error: " + escapeHtml(e.message) + "</div>";
            }
          }
        });

      } else {
        mountEl.appendChild(elFactory("div", { style: "color:#64748b;font-size:12px;" },
          "No interactive preview available for this module type."));
      }
    }

    function _renderRightPanel() {
      var el = layout.rightEl;
      el.innerHTML = "";
      el.appendChild(elFactory("h3", {}, "Playground Info"));

      if (!_selectedSchemaId) {
        el.appendChild(elFactory("div", { className: "osc-empty" }, "Select a schema"));
        return;
      }

      var infoCard = elFactory("div", { className: "osc-card" });
      infoCard.appendChild(elFactory("p", { style: "font-size:12px;color:#94a3b8;" },
        "Explore datasets and model architectures for this schema. " +
        "Go to the Dataset tab to generate data, or the Model tab to design a network."));

      // modules list
      var modules = _getModulesForSchema(_selectedSchemaId);
      if (modules.length > 1) {
        var modTitle = elFactory("div", { style: "font-size:12px;color:#94a3b8;margin-top:8px;font-weight:600;" }, "Available Modules:");
        infoCard.appendChild(modTitle);
        modules.forEach(function (m) {
          var mBtn = elFactory("button", {
            className: "osc-btn sm" + (m.id === _selectedModuleId ? "" : " secondary"),
            style: "margin:2px;",
          }, m.label || m.id);
          mBtn.addEventListener("click", function () {
            _selectedModuleId = m.id;
            _renderMainPanel();
            _renderRightPanel();
          });
          infoCard.appendChild(mBtn);
        });
      }
      el.appendChild(infoCard);
    }

    function mount() {
      _selectedSchemaId = stateApi ? stateApi.getActiveSchema() : null;
      var modules = _selectedSchemaId ? _getModulesForSchema(_selectedSchemaId) : [];
      _selectedModuleId = modules.length ? modules[0].id : null;
      _renderLeftPanel();
      _renderMainPanel();
      _renderRightPanel();
    }

    function unmount() {
      layout.leftEl.innerHTML = "";
      layout.mainEl.innerHTML = "";
      layout.rightEl.innerHTML = "";
    }

    function refresh() {
      if (stateApi) {
        var currentSchema = stateApi.getActiveSchema();
        if (currentSchema !== _selectedSchemaId) {
          _selectedSchemaId = currentSchema;
          var modules = _getModulesForSchema(_selectedSchemaId);
          _selectedModuleId = modules.length ? modules[0].id : null;
        }
      }
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

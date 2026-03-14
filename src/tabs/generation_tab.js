(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCGenerationTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var GENERATIVE_FAMILIES = ["vae", "diffusion"];

  function create(deps) {
    var layout = deps.layout;
    var stateApi = deps.stateApi;
    var store = deps.store;
    var schemaRegistry = deps.schemaRegistry;
    var modelBuilder = deps.modelBuilder; // OSCModelBuilderCore
    var onStatus = deps.onStatus || function () {};
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

    var _selectedModelId = null;
    var _generationResults = [];

    function _getSchemaId() {
      return stateApi ? stateApi.getActiveSchema() : "";
    }

    function _listGenerativeModels() {
      if (!store) return [];
      var schemaId = _getSchemaId();
      var models = typeof store.listModels === "function" ? store.listModels({ schemaId: schemaId }) : [];
      if (!modelBuilder) return models;
      return models.filter(function (m) {
        if (!m.graph) return false;
        var family = modelBuilder.inferModelFamily(m.graph);
        return GENERATIVE_FAMILIES.indexOf(family) >= 0;
      });
    }

    function _renderLeftPanel() {
      var el = layout.leftEl;
      el.innerHTML = "";
      el.appendChild(elFactory("h3", {}, "Generative Models"));

      var models = _listGenerativeModels();
      if (!models.length) {
        el.appendChild(elFactory("div", { className: "osc-empty" },
          "No generative models (VAE/Diffusion) found for this schema. Train one first."));
        return;
      }
      var list = elFactory("ul", { className: "osc-item-list" });
      models.forEach(function (m) {
        var family = modelBuilder ? modelBuilder.inferModelFamily(m.graph) : "unknown";
        var li = elFactory("li", {
          "data-id": m.id,
          className: m.id === _selectedModelId ? "active" : "",
        });
        li.appendChild(elFactory("strong", {}, m.name || m.id));
        li.appendChild(document.createTextNode(" "));
        li.appendChild(elFactory("span", { className: "osc-badge" }, family));
        li.addEventListener("click", function () {
          _selectedModelId = m.id;
          _renderLeftPanel();
          _renderMainPanel();
        });
        list.appendChild(li);
      });
      el.appendChild(list);
    }

    function _renderMainPanel() {
      var el = layout.mainEl;
      el.innerHTML = "";

      if (!_selectedModelId) {
        el.appendChild(elFactory("div", { className: "osc-empty" },
          "Select a generative model to sample from."));
        return;
      }

      var model = store ? store.getModel(_selectedModelId) : null;
      if (!model) {
        el.appendChild(elFactory("div", { className: "osc-empty" }, "Model not found"));
        return;
      }

      var family = modelBuilder ? modelBuilder.inferModelFamily(model.graph) : "unknown";

      var card = elFactory("div", { className: "osc-card" });
      card.appendChild(elFactory("h3", { style: "color:#67e8f9;margin:0 0 8px;" },
        "Generate from: " + escapeHtml(model.name || model.id)));
      card.appendChild(elFactory("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:8px;" },
        "Family: " + escapeHtml(family) + " | Schema: " + escapeHtml(model.schemaId || "")));

      // generation results
      if (_generationResults.length) {
        var table = elFactory("table", { className: "osc-metric-table" });
        var thead = elFactory("tr", {});
        ["#", "Type", "Samples", "Status"].forEach(function (h) {
          thead.appendChild(elFactory("th", {}, h));
        });
        table.appendChild(thead);
        _generationResults.forEach(function (r, i) {
          var tr = elFactory("tr", {});
          tr.appendChild(elFactory("td", {}, String(i + 1)));
          tr.appendChild(elFactory("td", {}, r.type || "sample"));
          tr.appendChild(elFactory("td", {}, String(r.count || 0)));
          tr.appendChild(elFactory("td", {}, r.status || "done"));
          table.appendChild(tr);
        });
        card.appendChild(table);
      }

      // chart/preview mount
      var previewMount = elFactory("div", { id: "gen-preview-mount", style: "margin-top:12px;" });
      card.appendChild(previewMount);

      el.appendChild(card);
    }

    function _renderRightPanel() {
      var el = layout.rightEl;
      el.innerHTML = "";
      el.appendChild(elFactory("h3", {}, "Generation Config"));

      var configCard = elFactory("div", { className: "osc-card" });
      var fields = [
        { key: "numSamples", label: "Num samples", type: "number", value: 16, min: 1, max: 1000 },
        { key: "temperature", label: "Temperature", type: "number", value: 1.0, min: 0.01, max: 5, step: 0.1 },
        { key: "seed", label: "Seed", type: "number", value: 42 },
      ];
      fields.forEach(function (f) {
        var row = elFactory("div", { className: "osc-form-row" });
        row.appendChild(elFactory("label", {}, f.label));
        var input = elFactory("input", {
          type: "number",
          value: String(f.value),
          "data-key": f.key,
        });
        if (f.min != null) input.setAttribute("min", f.min);
        if (f.max != null) input.setAttribute("max", f.max);
        if (f.step != null) input.setAttribute("step", f.step);
        row.appendChild(input);
        configCard.appendChild(row);
      });
      el.appendChild(configCard);

      var sampleBtn = elFactory("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "Sample");
      sampleBtn.addEventListener("click", function () { _handleSample(); });
      el.appendChild(sampleBtn);

      var batchBtn = elFactory("button", { className: "osc-btn secondary", style: "margin-top:4px;width:100%;" }, "Batch Generate");
      batchBtn.addEventListener("click", function () { _handleBatch(); });
      el.appendChild(batchBtn);

      var clearBtn = elFactory("button", { className: "osc-btn secondary", style: "margin-top:4px;width:100%;" }, "Clear Results");
      clearBtn.addEventListener("click", function () {
        _generationResults = [];
        _renderMainPanel();
      });
      el.appendChild(clearBtn);
    }

    function _collectConfig() {
      var config = {};
      var inputs = layout.rightEl.querySelectorAll("input[data-key]");
      inputs.forEach(function (inp) {
        config[inp.getAttribute("data-key")] = Number(inp.value);
      });
      return config;
    }

    function _handleSample() {
      if (!_selectedModelId) { onStatus("Select a model first"); return; }
      var config = _collectConfig();
      _generationResults.push({ type: "sample", count: 1, status: "pending (wiring needed)", config: config });
      onStatus("Sample generation: pending runtime wiring");
      _renderMainPanel();
    }

    function _handleBatch() {
      if (!_selectedModelId) { onStatus("Select a model first"); return; }
      var config = _collectConfig();
      _generationResults.push({ type: "batch", count: config.numSamples || 16, status: "pending (wiring needed)", config: config });
      onStatus("Batch generation: pending runtime wiring");
      _renderMainPanel();
    }

    function mount() {
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
      _renderLeftPanel();
      _renderMainPanel();
      _renderRightPanel();
    }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create, GENERATIVE_FAMILIES: GENERATIVE_FAMILIES };
});

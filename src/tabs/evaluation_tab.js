(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCEvaluationTab = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(deps) {
    var layout = deps.layout;
    var stateApi = deps.stateApi;
    var store = deps.store;
    var schemaRegistry = deps.schemaRegistry;
    var predictionCore = deps.predictionCore; // OSCPredictionCore
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

    var _selectedModelIds = [];
    var _benchmarkResults = [];

    function _getSchemaId() {
      return stateApi ? stateApi.getActiveSchema() : "";
    }

    function _listTrainedModels() {
      if (!store) return [];
      var schemaId = _getSchemaId();
      // list trainers that have completed
      var trainers = typeof store.listTrainerCards === "function" ? store.listTrainerCards({ schemaId: schemaId }) : [];
      return trainers.filter(function (t) { return t.status === "done" || t.metrics; });
    }

    function _listAllModels() {
      if (!store) return [];
      var schemaId = _getSchemaId();
      return typeof store.listModels === "function" ? store.listModels({ schemaId: schemaId }) : [];
    }

    function _renderLeftPanel() {
      var el = layout.leftEl;
      el.innerHTML = "";
      el.appendChild(elFactory("h3", {}, "Benchmark Runs"));

      if (!_benchmarkResults.length) {
        el.appendChild(elFactory("div", { className: "osc-empty" }, "No benchmark runs yet. Select models and run evaluation."));
      } else {
        var list = elFactory("ul", { className: "osc-item-list" });
        _benchmarkResults.forEach(function (run, i) {
          var li = elFactory("li", {});
          li.appendChild(elFactory("strong", {}, "Run #" + (i + 1)));
          var meta = elFactory("div", { style: "font-size:11px;color:#64748b;" });
          meta.textContent = run.models + " models | " + (run.status || "done");
          li.appendChild(meta);
          list.appendChild(li);
        });
        el.appendChild(list);
      }
    }

    function _renderMainPanel() {
      var el = layout.mainEl;
      el.innerHTML = "";

      // benchmark results table
      if (_benchmarkResults.length) {
        _benchmarkResults.forEach(function (run, ri) {
          var card = elFactory("div", { className: "osc-card" });
          card.appendChild(elFactory("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, "Benchmark Run #" + (ri + 1)));

          if (Array.isArray(run.results) && run.results.length) {
            var table = elFactory("table", { className: "osc-metric-table" });
            var thead = elFactory("tr", {});
            ["Model", "MAE", "RMSE", "Accuracy", "Status"].forEach(function (h) {
              thead.appendChild(elFactory("th", {}, h));
            });
            table.appendChild(thead);
            run.results.forEach(function (r) {
              var tr = elFactory("tr", {});
              tr.appendChild(elFactory("td", {}, escapeHtml(r.modelName || r.modelId || "?")));
              tr.appendChild(elFactory("td", {}, r.mae != null ? Number(r.mae).toExponential(3) : "—"));
              tr.appendChild(elFactory("td", {}, r.rmse != null ? Number(r.rmse).toExponential(3) : "—"));
              tr.appendChild(elFactory("td", {}, r.accuracy != null ? (Number(r.accuracy) * 100).toFixed(1) + "%" : "—"));
              tr.appendChild(elFactory("td", {}, r.status || "done"));
              table.appendChild(tr);
            });
            card.appendChild(table);
          }

          // chart mount
          var chartMount = elFactory("div", { style: "margin-top:12px;height:250px;" });
          card.appendChild(chartMount);
          el.appendChild(card);
        });
      } else {
        var card = elFactory("div", { className: "osc-card" });
        card.appendChild(elFactory("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, "Multi-Model Benchmark"));
        card.appendChild(elFactory("p", { style: "color:#94a3b8;font-size:13px;" },
          "Select multiple models from the same schema, choose a test dataset, and compare their performance side by side."));
        el.appendChild(card);
      }
    }

    function _renderRightPanel() {
      var el = layout.rightEl;
      el.innerHTML = "";
      el.appendChild(elFactory("h3", {}, "Benchmark Config"));

      // model multi-select
      var models = _listAllModels();
      var trainers = _listTrainedModels();
      var configCard = elFactory("div", { className: "osc-card" });

      configCard.appendChild(elFactory("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:4px;" },
        "Select models to benchmark:"));

      if (!models.length && !trainers.length) {
        configCard.appendChild(elFactory("div", { className: "osc-empty" }, "No models available"));
      } else {
        var allItems = models.map(function (m) { return { id: m.id, name: m.name || m.id, type: "model" }; });
        trainers.forEach(function (t) {
          allItems.push({ id: t.id, name: (t.name || t.id) + " (trained)", type: "trainer" });
        });
        allItems.forEach(function (item) {
          var row = elFactory("div", { style: "display:flex;align-items:center;gap:6px;margin-bottom:4px;" });
          var cb = elFactory("input", { type: "checkbox", "data-model-id": item.id });
          if (_selectedModelIds.indexOf(item.id) >= 0) cb.checked = true;
          cb.addEventListener("change", function () {
            if (cb.checked) {
              if (_selectedModelIds.indexOf(item.id) < 0) _selectedModelIds.push(item.id);
            } else {
              _selectedModelIds = _selectedModelIds.filter(function (id) { return id !== item.id; });
            }
          });
          row.appendChild(cb);
          row.appendChild(elFactory("span", { style: "font-size:12px;color:#cbd5e1;" }, item.name));
          if (item.type === "trainer") row.appendChild(elFactory("span", { className: "osc-badge" }, "trained"));
          configCard.appendChild(row);
        });
      }

      // dataset selector
      var datasets = typeof store.listDatasets === "function" ? store.listDatasets({ schemaId: _getSchemaId() }) : [];
      if (datasets.length) {
        configCard.appendChild(elFactory("div", { style: "font-size:12px;color:#94a3b8;margin-top:8px;margin-bottom:4px;" }, "Test dataset:"));
        var dsSelect = elFactory("select", { "data-key": "datasetId" });
        datasets.forEach(function (ds) {
          var opt = elFactory("option", { value: ds.id });
          opt.textContent = ds.name || ds.id;
          dsSelect.appendChild(opt);
        });
        configCard.appendChild(dsSelect);
      }

      el.appendChild(configCard);

      var runBtn = elFactory("button", { className: "osc-btn", style: "margin-top:8px;width:100%;" }, "Run Benchmark");
      runBtn.addEventListener("click", function () { _handleBenchmark(); });
      el.appendChild(runBtn);

      var clearBtn = elFactory("button", { className: "osc-btn secondary", style: "margin-top:4px;width:100%;" }, "Clear Results");
      clearBtn.addEventListener("click", function () {
        _benchmarkResults = [];
        _renderLeftPanel();
        _renderMainPanel();
      });
      el.appendChild(clearBtn);
    }

    function _handleBenchmark() {
      if (!_selectedModelIds.length) { onStatus("Select at least one model"); return; }
      var dsSelect = layout.rightEl.querySelector("select[data-key='datasetId']");
      var datasetId = dsSelect ? dsSelect.value : "";

      var run = {
        models: _selectedModelIds.length,
        datasetId: datasetId,
        schemaId: _getSchemaId(),
        status: "pending (wiring needed)",
        results: _selectedModelIds.map(function (id) {
          var m = store ? (store.getModel(id) || store.getTrainerCard(id)) : null;
          return { modelId: id, modelName: (m && m.name) || id, status: "pending" };
        }),
      };
      _benchmarkResults.push(run);
      onStatus("Benchmark queued: " + _selectedModelIds.length + " models");
      _renderLeftPanel();
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

  return { create: create };
});

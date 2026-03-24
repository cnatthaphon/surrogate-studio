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
    var predictionCore = deps.predictionCore;
    var modelBuilder = deps.modelBuilder;
    var onStatus = deps.onStatus || function () {};
    var escapeHtml = deps.escapeHtml || function (s) { return String(s || ""); };
    var el = deps.el || function (tag, attrs, children) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "className") e.className = attrs[k];
        else if (k === "textContent") e.textContent = attrs[k];
        else if (k === "style") e.style.cssText = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
      if (children != null) (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (typeof c === "number") e.appendChild(document.createTextNode(String(c)));
        else if (c && c.nodeType) e.appendChild(c);
      });
      return e;
    };
    var getTf = function () { var W = typeof window !== "undefined" ? window : {}; return W.tf || null; };

    var _selectedTrainerIds = [];
    var _benchmarkRuns = [];
    var _activeRunIdx = -1;
    var _isRunning = false;

    function _getSchemaId() { return stateApi ? stateApi.getActiveSchema() : ""; }

    function _listTrainedTrainers() {
      if (!store) return [];
      var trainers = typeof store.listTrainerCards === "function" ? store.listTrainerCards({}) : [];
      return trainers.filter(function (t) { return t.status === "done" && t.modelArtifacts && t.modelId && t.datasetId; });
    }

    // === LEFT: benchmark run list ===
    function _renderLeftPanel() {
      var leftEl = layout.leftEl;
      leftEl.innerHTML = "";
      leftEl.appendChild(el("h3", {}, "Benchmark Runs"));

      if (!_benchmarkRuns.length) {
        leftEl.appendChild(el("div", { className: "osc-empty" }, "No benchmarks yet. Select trainers and run."));
        return;
      }
      _benchmarkRuns.forEach(function (run, idx) {
        var isActive = idx === _activeRunIdx;
        var div = el("div", {
          style: "padding:6px 8px;cursor:pointer;border-radius:4px;margin-bottom:2px;border:1px solid " +
            (isActive ? "#0ea5e9" : "#1e293b") + ";background:" + (isActive ? "#0c2340" : "#111827") + ";",
        });
        var statusColor = run.status === "done" ? "#4ade80" : run.status === "running" ? "#fbbf24" : "#64748b";
        div.appendChild(el("div", { style: "font-size:12px;color:" + (isActive ? "#67e8f9" : "#e2e8f0") + ";font-weight:600;" },
          "Run #" + (idx + 1) + " (" + run.results.length + " models)"));
        div.appendChild(el("div", { style: "font-size:10px;color:" + statusColor + ";" }, run.status));
        div.addEventListener("click", function () {
          _activeRunIdx = idx;
          _renderLeftPanel();
          _renderMainPanel();
        });
        leftEl.appendChild(div);
      });
    }

    // === MAIN: benchmark comparison ===
    function _renderMainPanel() {
      var mainEl = layout.mainEl;
      mainEl.innerHTML = "";

      if (_activeRunIdx < 0 || !_benchmarkRuns[_activeRunIdx]) {
        mainEl.appendChild(el("div", { className: "osc-card" }, [
          el("h3", { style: "color:#67e8f9;margin:0 0 8px;" }, "Multi-Model Benchmark"),
          el("p", { style: "color:#94a3b8;font-size:12px;" },
            "Select multiple trained models, run evaluation on the same test set, and compare metrics side by side."),
        ]));
        return;
      }

      var run = _benchmarkRuns[_activeRunIdx];

      // comparison table
      var tableCard = el("div", { className: "osc-card" });
      tableCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;font-weight:600;margin-bottom:8px;" },
        "Run #" + (_activeRunIdx + 1) + " — " + run.results.length + " models compared"));

      var table = el("table", { style: "width:100%;border-collapse:collapse;font-size:11px;" });
      var thead = el("tr", {});
      var headers = ["Model", "Accuracy", "MAE", "RMSE", "R\u00B2", "Samples", "Status"];
      headers.forEach(function (h) {
        thead.appendChild(el("th", { style: "text-align:left;padding:4px 6px;color:#94a3b8;border-bottom:1px solid #1e293b;" }, h));
      });
      table.appendChild(thead);

      // find best values for highlighting
      var bestAcc = -1, bestMae = Infinity, bestR2 = -Infinity;
      run.results.forEach(function (r) {
        if (r.accuracy != null && r.accuracy > bestAcc) bestAcc = r.accuracy;
        if (r.mae != null && r.mae < bestMae) bestMae = r.mae;
        if (r.r2 != null && r.r2 > bestR2) bestR2 = r.r2;
      });

      run.results.forEach(function (r) {
        var tr = el("tr", {});
        tr.appendChild(el("td", { style: "padding:4px 6px;color:#e2e8f0;font-weight:600;" }, escapeHtml(r.trainerName || r.modelName || "?")));
        tr.appendChild(el("td", { style: "padding:4px 6px;color:" + (r.accuracy === bestAcc && r.accuracy != null ? "#4ade80" : "#cbd5e1") + ";" },
          r.accuracy != null ? (r.accuracy * 100).toFixed(1) + "%" : "\u2014"));
        tr.appendChild(el("td", { style: "padding:4px 6px;color:" + (r.mae === bestMae && r.mae != null ? "#4ade80" : "#cbd5e1") + ";" },
          r.mae != null ? Number(r.mae).toExponential(3) : "\u2014"));
        tr.appendChild(el("td", { style: "padding:4px 6px;color:#cbd5e1;" }, r.rmse != null ? Number(r.rmse).toExponential(3) : "\u2014"));
        tr.appendChild(el("td", { style: "padding:4px 6px;color:" + (r.r2 === bestR2 && r.r2 != null ? "#4ade80" : "#cbd5e1") + ";" },
          r.r2 != null ? r.r2.toFixed(4) : "\u2014"));
        tr.appendChild(el("td", { style: "padding:4px 6px;color:#64748b;" }, String(r.testN || "\u2014")));
        var statusColor = r.status === "done" ? "#4ade80" : r.status === "error" ? "#f43f5e" : "#fbbf24";
        tr.appendChild(el("td", { style: "padding:4px 6px;color:" + statusColor + ";" }, r.status || "pending"));
        table.appendChild(tr);
      });
      tableCard.appendChild(table);
      mainEl.appendChild(tableCard);

      // bar chart comparison
      var Plotly = (typeof window !== "undefined" && window.Plotly) ? window.Plotly : null;
      if (Plotly && run.results.some(function (r) { return r.status === "done"; })) {
        var chartCard = el("div", { className: "osc-card", style: "margin-top:8px;" });
        chartCard.appendChild(el("div", { style: "font-size:13px;color:#67e8f9;font-weight:600;margin-bottom:8px;" }, "Metric Comparison"));
        var chartDiv = el("div", { style: "height:280px;" });
        chartCard.appendChild(chartDiv);
        mainEl.appendChild(chartCard);

        var doneResults = run.results.filter(function (r) { return r.status === "done"; });
        var names = doneResults.map(function (r) { return r.trainerName || r.modelName || "?"; });

        var traces = [];
        // pick metrics that exist
        var hasAcc = doneResults.some(function (r) { return r.accuracy != null; });
        var hasMae = doneResults.some(function (r) { return r.mae != null; });
        var hasR2 = doneResults.some(function (r) { return r.r2 != null; });

        if (hasAcc) {
          traces.push({ x: names, y: doneResults.map(function (r) { return r.accuracy != null ? r.accuracy * 100 : 0; }), type: "bar", name: "Accuracy %", marker: { color: "#22d3ee" } });
        }
        if (hasR2) {
          traces.push({ x: names, y: doneResults.map(function (r) { return r.r2 != null ? r.r2 * 100 : 0; }), type: "bar", name: "R\u00B2 %", marker: { color: "#4ade80" } });
        }
        if (hasMae) {
          traces.push({ x: names, y: doneResults.map(function (r) { return r.mae || 0; }), type: "bar", name: "MAE", marker: { color: "#f59e0b" }, yaxis: "y2" });
        }

        Plotly.newPlot(chartDiv, traces, {
          paper_bgcolor: "#0b1220", plot_bgcolor: "#0b1220", font: { color: "#e2e8f0", size: 10 },
          barmode: "group",
          xaxis: { gridcolor: "#1e293b" },
          yaxis: { title: hasAcc ? "Accuracy / R\u00B2 (%)" : "Score", gridcolor: "#1e293b" },
          yaxis2: hasMae ? { title: "MAE", overlaying: "y", side: "right", gridcolor: "#1e293b" } : undefined,
          legend: { orientation: "h", y: -0.2 },
          margin: { t: 10, b: 60, l: 50, r: 50 },
        }, { responsive: true });
      }
    }

    // === RIGHT: config ===
    function _renderRightPanel() {
      var rightEl = layout.rightEl;
      rightEl.innerHTML = "";
      rightEl.appendChild(el("h3", {}, "Benchmark Config"));

      var trainers = _listTrainedTrainers();
      if (!trainers.length) {
        rightEl.appendChild(el("div", { className: "osc-empty" }, "No trained models available."));
        return;
      }

      var configCard = el("div", { className: "osc-card" });
      configCard.appendChild(el("div", { style: "font-size:11px;color:#94a3b8;margin-bottom:6px;" }, "Select trainers to compare:"));

      trainers.forEach(function (t) {
        var row = el("div", { style: "display:flex;align-items:center;gap:6px;margin-bottom:4px;" });
        var cb = el("input", { type: "checkbox", "data-trainer-id": t.id });
        if (_selectedTrainerIds.indexOf(t.id) >= 0) cb.checked = true;
        cb.addEventListener("change", function () {
          if (cb.checked) {
            if (_selectedTrainerIds.indexOf(t.id) < 0) _selectedTrainerIds.push(t.id);
          } else {
            _selectedTrainerIds = _selectedTrainerIds.filter(function (id) { return id !== t.id; });
          }
        });
        row.appendChild(cb);
        row.appendChild(el("span", { style: "font-size:11px;color:#e2e8f0;" }, t.name || t.id));
        var metrics = t.metrics || {};
        if (metrics.mae != null) {
          row.appendChild(el("span", { style: "font-size:9px;color:#64748b;" }, "MAE=" + Number(metrics.mae).toExponential(2)));
        }
        configCard.appendChild(row);
      });

      configCard.appendChild(el("div", { style: "font-size:10px;color:#64748b;margin-top:8px;" },
        "All selected trainers will be evaluated on their own test set."));

      rightEl.appendChild(configCard);

      var runBtn = el("button", { style: "margin-top:8px;width:100%;padding:8px;font-size:13px;font-weight:600;border-radius:6px;border:1px solid #0ea5e9;background:#0284c7;color:#fff;cursor:pointer;" },
        _isRunning ? "Running..." : "Run Benchmark");
      if (_isRunning) runBtn.disabled = true;
      runBtn.addEventListener("click", function () { _handleBenchmark(); });
      rightEl.appendChild(runBtn);

      if (_benchmarkRuns.length) {
        var clearBtn = el("button", { style: "margin-top:4px;width:100%;padding:6px;font-size:11px;border-radius:6px;border:1px solid #475569;background:#1f2937;color:#cbd5e1;cursor:pointer;" }, "Clear All Runs");
        clearBtn.addEventListener("click", function () {
          _benchmarkRuns = []; _activeRunIdx = -1;
          _renderLeftPanel(); _renderMainPanel();
        });
        rightEl.appendChild(clearBtn);
      }
    }

    // === Run benchmark ===
    function _handleBenchmark() {
      if (_isRunning || !_selectedTrainerIds.length) {
        if (!_selectedTrainerIds.length) onStatus("Select at least one trainer");
        return;
      }

      var tf = getTf();
      var pc = predictionCore || (typeof window !== "undefined" && window.OSCPredictionCore) || null;
      if (!tf || !modelBuilder) { onStatus("TF.js or model builder not available"); return; }

      _isRunning = true;
      var run = {
        status: "running",
        results: _selectedTrainerIds.map(function (tid) {
          var t = store.getTrainerCard(tid);
          return { trainerId: tid, trainerName: t ? t.name : tid, modelName: "", status: "pending" };
        }),
      };
      _benchmarkRuns.push(run);
      _activeRunIdx = _benchmarkRuns.length - 1;
      _renderLeftPanel();
      _renderMainPanel();
      _renderRightPanel();

      // evaluate each trainer sequentially
      var idx = 0;
      function evalNext() {
        if (idx >= _selectedTrainerIds.length) {
          run.status = "done";
          _isRunning = false;
          onStatus("Benchmark complete: " + run.results.length + " models");
          _renderLeftPanel(); _renderMainPanel(); _renderRightPanel();
          return;
        }

        var tid = _selectedTrainerIds[idx];
        var r = run.results[idx];
        r.status = "running";
        _renderMainPanel();

        try {
          var trainer = store.getTrainerCard(tid);
          var modelRec = store.getModel(trainer.modelId);
          var dataset = store.getDataset(trainer.datasetId);
          r.modelName = modelRec ? modelRec.name : trainer.modelId;

          if (!trainer.modelArtifacts || !modelRec || !modelRec.graph || !dataset || !dataset.data) {
            r.status = "error"; r.error = "Missing artifacts";
            idx++; evalNext(); return;
          }

          // determine task type
          var schemaId = trainer.schemaId;
          var allowedOutputKeys = schemaRegistry ? schemaRegistry.getOutputKeys(schemaId) : ["x"];
          var defaultTarget = (allowedOutputKeys[0] && (allowedOutputKeys[0].key || allowedOutputKeys[0])) || "x";
          var isClassification = defaultTarget === "label" || defaultTarget === "logits";

          // get test data
          var dsData = dataset.data;
          var isBundle = dsData.kind === "dataset_bundle" && dsData.datasets;
          var activeDs = isBundle ? dsData.datasets[dsData.activeVariantId || Object.keys(dsData.datasets)[0]] : dsData;
          var nCls = activeDs.classCount || 10;

          if (!activeDs.xTest && activeDs.records) {
            var oh = function (l, n) { var a = new Array(n).fill(0); a[l] = 1; return a; };
            activeDs = {
              xTest: (activeDs.records.test && activeDs.records.test.x) || [],
              yTest: isClassification
                ? ((activeDs.records.test && activeDs.records.test.y) || []).map(function (l) { return oh(l, nCls); })
                : ((activeDs.records.test && activeDs.records.test.y) || []),
              featureSize: (activeDs.records.test && activeDs.records.test.x && activeDs.records.test.x[0]) ? activeDs.records.test.x[0].length : 784,
              numClasses: nCls,
            };
          }

          var testN = (activeDs.xTest || []).length;
          if (!testN) { r.status = "error"; r.error = "No test data"; idx++; evalNext(); return; }

          // rebuild + load weights
          var graphMode = modelBuilder.inferGraphMode(modelRec.graph, "direct");
          var featureSize = Number(activeDs.featureSize || (activeDs.xTest[0] && activeDs.xTest[0].length) || 1);
          var built = modelBuilder.buildModelFromGraph(tf, modelRec.graph, {
            mode: graphMode, featureSize: featureSize, windowSize: 1, seqFeatureSize: featureSize,
            allowedOutputKeys: allowedOutputKeys, defaultTarget: defaultTarget, numClasses: nCls,
          });
          var hasW = trainer.modelArtifacts && (trainer.modelArtifacts.weightValues || (trainer.modelArtifacts.weightData && trainer.modelArtifacts.weightData.byteLength));
          if (hasW) {
            try {
              var fw = trainer.modelArtifacts.weightValues
                ? new Float32Array(trainer.modelArtifacts.weightValues)
                : new Float32Array(trainer.modelArtifacts.weightData);
              var savedSpecs = trainer.modelArtifacts.weightSpecs || [];
              var isPy = savedSpecs.length > 0 && savedSpecs[0].name && savedSpecs[0].name.match(/^\d+\./);
              var mw = built.model.getWeights();
              var nw = []; var ro = 0;
              for (var wj = 0; wj < mw.length; wj++) {
                var ws = mw[wj].shape.reduce(function (a, b) { return a * b; }, 1);
                if (ro + ws <= fw.length) {
                  var raw = fw.subarray(ro, ro + ws);
                  if (isPy && mw[wj].shape.length === 2 && savedSpecs[wj] && savedSpecs[wj].shape && savedSpecs[wj].shape.length === 2 &&
                      savedSpecs[wj].shape[0] === mw[wj].shape[1] && savedSpecs[wj].shape[1] === mw[wj].shape[0]) {
                    var tr = new Float32Array(ws);
                    var rr = savedSpecs[wj].shape[0], cc = savedSpecs[wj].shape[1];
                    for (var ti = 0; ti < rr; ti++) for (var tj = 0; tj < cc; tj++) tr[tj * rr + ti] = raw[ti * cc + tj];
                    nw.push(tf.tensor(tr, mw[wj].shape));
                  } else {
                    nw.push(tf.tensor(raw, mw[wj].shape));
                  }
                  ro += ws;
                }
              }
              if (nw.length === mw.length) built.model.setWeights(nw);
            } catch (e) { /* */ }
          }

          // batch inference
          var allPreds = [];
          var batchSize = 256;
          for (var bi = 0; bi < testN; bi += batchSize) {
            var bEnd = Math.min(bi + batchSize, testN);
            var bx = activeDs.xTest.slice(bi, bEnd);
            var bt = tf.tensor2d(bx);
            var br = built.model.predict(bt);
            var bd = (Array.isArray(br) ? br[0] : br).arraySync();
            allPreds = allPreds.concat(bd);
            bt.dispose();
            if (Array.isArray(br)) br.forEach(function (t) { t.dispose(); }); else br.dispose();
          }

          r.testN = testN;

          if (isClassification && pc) {
            var predLabels = allPreds.map(function (p) { return p.indexOf(Math.max.apply(null, p)); });
            var trueLabels = activeDs.yTest.map(function (y) { return Array.isArray(y) ? y.indexOf(Math.max.apply(null, y)) : Number(y); });
            var correct = 0;
            for (var ci = 0; ci < testN; ci++) { if (predLabels[ci] === trueLabels[ci]) correct++; }
            r.accuracy = correct / testN;
            var cm = pc.confusionMatrix(trueLabels, predLabels, nCls);
            var prf = pc.precisionRecallF1(cm);
            r.macroF1 = prf.reduce(function (s, p) { return s + p.f1; }, 0) / nCls;
          } else if (pc) {
            // flatten multi-dim regression (e.g. 40-dim reconstruction) for accurate metrics
            var truthFlat = [], predFlat = [];
            for (var mi = 0; mi < testN; mi++) {
              var yt = activeDs.yTest[mi], pp = allPreds[mi];
              if (Array.isArray(yt) && yt.length > 1) { for (var mdi = 0; mdi < yt.length; mdi++) { truthFlat.push(Number(yt[mdi] || 0)); predFlat.push(Number((pp && pp[mdi]) || 0)); } }
              else { truthFlat.push(Number(Array.isArray(yt) ? yt[0] : yt || 0)); predFlat.push(Number(Array.isArray(pp) ? pp[0] : pp || 0)); }
            }
            var reg = pc.computeRegressionMetrics(truthFlat, predFlat);
            r.mae = reg.mae;
            r.rmse = reg.rmse;
            r.r2 = pc.r2Score(truthFlat, predFlat);
          }

          r.status = "done";
          built.model.dispose();

        } catch (e) {
          r.status = "error";
          r.error = e.message;
        }

        onStatus("Evaluated " + (idx + 1) + "/" + _selectedTrainerIds.length);
        idx++;
        // use setTimeout to let UI update between models
        setTimeout(evalNext, 50);
      }

      evalNext();
    }

    function mount() { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }
    function unmount() { layout.leftEl.innerHTML = ""; layout.mainEl.innerHTML = ""; layout.rightEl.innerHTML = ""; }
    function refresh() { _renderLeftPanel(); _renderMainPanel(); _renderRightPanel(); }

    return { mount: mount, unmount: unmount, refresh: refresh };
  }

  return { create: create };
});

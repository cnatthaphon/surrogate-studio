/**
 * Custom CSV Dataset Module
 *
 * Reads tabular CSV with columns: split, f0, f1, ..., t0, t1, ...
 * - f* columns = features
 * - t* columns = targets
 * - split column = train/val/test
 *
 * Supports:
 * - Built-in sample data (Iris-like) for instant demo
 * - Browser file upload via FileReader
 * - Server local path via sourceDescriptor
 *
 * Task type auto-detected: if targets are integers 0..N → classification, else regression
 */
(function (root, factory) {
  var descriptor = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = descriptor;
    return;
  }
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModule === "function") {
    root.OSCDatasetModules.registerModule(descriptor);
  }
  root.OSCDatasetModuleCustomCsv = descriptor;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var MODULE_ID = "custom_csv";
  var SCHEMA_ID = "custom_csv";

  // --- Built-in sample: Iris-like dataset (4 features, 3 classes, 150 samples) ---
  function generateSampleData(seed) {
    var rng = (function (s) {
      return function () { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
    })(seed || 42);

    var classes = [
      { mean: [5.0, 3.4, 1.5, 0.2], std: [0.35, 0.38, 0.17, 0.11] },
      { mean: [5.9, 2.8, 4.3, 1.3], std: [0.52, 0.31, 0.47, 0.20] },
      { mean: [6.6, 3.0, 5.6, 2.0], std: [0.64, 0.32, 0.55, 0.27] },
    ];
    var rows = [];
    var splits = [];
    for (var ci = 0; ci < classes.length; ci++) {
      for (var i = 0; i < 50; i++) {
        var features = [];
        for (var fi = 0; fi < 4; fi++) {
          var u1 = rng(), u2 = rng();
          var z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
          features.push(+(classes[ci].mean[fi] + z * classes[ci].std[fi]).toFixed(4));
        }
        var idx = rows.length;
        var split = idx < 105 ? "train" : (idx < 128 ? "val" : "test");
        rows.push({ features: features, label: ci, split: split });
        splits.push(split);
      }
    }
    // Shuffle deterministically
    for (var si = rows.length - 1; si > 0; si--) {
      var j = Math.floor(rng() * (si + 1));
      var tmp = rows[si]; rows[si] = rows[j]; rows[j] = tmp;
    }
    return rows;
  }

  function parseCSV(text) {
    var lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    var header = lines[0].split(",").map(function (h) { return h.trim(); });
    function numSort(a, b) { return parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10); }
    var featureCols = header.filter(function (h) { return /^f\d+$/i.test(h); }).sort(numSort);
    var targetCols = header.filter(function (h) { return /^t\d+$/i.test(h); }).sort(numSort);
    var splitIdx = header.indexOf("split");

    var x = { train: [], val: [], test: [] };
    var y = { train: [], val: [], test: [] };

    for (var i = 1; i < lines.length; i++) {
      var parts = lines[i].split(",");
      if (parts.length < header.length) continue;
      var row = {};
      header.forEach(function (h, idx) { row[h] = parts[idx].trim(); });
      var split = splitIdx >= 0 ? (row.split || "train").toLowerCase() : "train";
      if (!x[split]) split = "train";
      var fvals = featureCols.map(function (c) { return parseFloat(row[c]) || 0; });
      var tvals = targetCols.map(function (c) { return parseFloat(row[c]) || 0; });
      x[split].push(fvals);
      y[split].push(tvals);
    }

    if (!featureCols.length) return null; // no f* columns — likely a format error
    if (!targetCols.length) return null; // no t* columns — likely a format error
    return { x: x, y: y, featureSize: featureCols.length, targetSize: targetCols.length, featureCols: featureCols, targetCols: targetCols };
  }

  function detectTaskType(y) {
    // Single target column with non-negative integers → classification
    // Multiple target columns or any float → regression
    var flat = [].concat(y.train, y.val, y.test);
    if (!flat.length) return "regression";
    var allInt = flat.every(function (row) {
      return row.length === 1 && row[0] >= 0 && row[0] === Math.floor(row[0]);
    });
    return allInt ? "classification" : "regression";
  }

  function oneHot(label, n) { var arr = new Array(n).fill(0); arr[Math.min(label, n - 1)] = 1; return arr; }

  function build(config) {
    var c = config || {};
    var seed = c.seed || 42;
    var csvText = c.csvText || null;
    var sourceDescriptor = c.sourceDescriptor || null;

    // If sourceDescriptor provided, pass it through for server-side loading
    if (sourceDescriptor && !csvText) {
      var meta = sourceDescriptor.metadata || sourceDescriptor || {};
      return {
        schemaId: SCHEMA_ID,
        datasetModuleId: MODULE_ID,
        sourceDescriptor: sourceDescriptor,
        mode: meta.mode || sourceDescriptor.mode || (Number(meta.numClasses || meta.classCount || sourceDescriptor.classCount) > 0 ? "classification" : "regression"),
        featureSize: Number(meta.featureSize || sourceDescriptor.featureSize) || 0,
        targetSize: Number(meta.targetSize || sourceDescriptor.targetSize) || 0,
        targetMode: meta.targetMode || sourceDescriptor.targetMode || "target",
        numClasses: Number(meta.numClasses || meta.classCount || sourceDescriptor.classCount) || 0,
        classCount: Number(meta.classCount || meta.numClasses || sourceDescriptor.classCount) || 0,
        classNames: meta.classNames || sourceDescriptor.classNames || [],
        seed: seed,
      };
    }

    var parsed;
    if (csvText) {
      parsed = parseCSV(csvText);
      if (!parsed) return null;
    } else {
      // Use built-in sample data
      var rows = generateSampleData(seed);
      var x = { train: [], val: [], test: [] };
      var y = { train: [], val: [], test: [] };
      rows.forEach(function (r) {
        x[r.split].push(r.features);
        y[r.split].push([r.label]);
      });
      parsed = { x: x, y: y, featureSize: 4, targetSize: 1, featureCols: ["f0", "f1", "f2", "f3"], targetCols: ["t0"] };
    }

    var taskType = detectTaskType(parsed.y);
    var classCount = 0;
    if (taskType === "classification") {
      var allLabels = [].concat(parsed.y.train, parsed.y.val, parsed.y.test).map(function (r) { return r[0]; });
      classCount = Math.max.apply(null, allLabels) + 1;
    }

    var result = {
      schemaId: SCHEMA_ID,
      datasetModuleId: MODULE_ID,
      mode: taskType,
      featureSize: parsed.featureSize,
      targetSize: taskType === "classification" ? classCount : parsed.targetSize,
      targetMode: taskType === "classification" ? "label" : "target",
      numClasses: classCount || 0,
      classCount: classCount || 0,
      classNames: classCount > 0 ? Array.from({ length: classCount }, function (_, i) { return "class_" + i; }) : [],
      featureColumns: parsed.featureCols,
      targetColumns: parsed.targetCols,
      seed: seed,
      splitConfig: { mode: "from_csv", train: 0.7, val: 0.15, test: 0.15 },
      trainCount: parsed.x.train.length,
      valCount: parsed.x.val.length,
      testCount: parsed.x.test.length,
      xTrain: parsed.x.train,
      yTrain: taskType === "classification"
        ? parsed.y.train.map(function (r) { return oneHot(r[0], classCount); })
        : parsed.y.train,
      xVal: parsed.x.val,
      yVal: taskType === "classification"
        ? parsed.y.val.map(function (r) { return oneHot(r[0], classCount); })
        : parsed.y.val,
      xTest: parsed.x.test,
      yTest: taskType === "classification"
        ? parsed.y.test.map(function (r) { return oneHot(r[0], classCount); })
        : parsed.y.test,
    };

    return result;
  }

  // --- Playground renderer ---
  function renderPlayground(mountEl, deps) {
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

    mountEl.innerHTML = "";
    var wrap = el("div", { style: "padding:16px;color:#e2e8f0;font-size:13px;" });

    wrap.appendChild(el("h3", { style: "margin:0 0 12px 0;color:#67e8f9;" }, "Custom CSV Dataset"));
    wrap.appendChild(el("p", {}, "Upload your own tabular CSV or use the built-in Iris sample dataset."));

    // CSV format info
    var formatInfo = el("div", { style: "background:#1e293b;padding:12px;border-radius:8px;margin:12px 0;font-family:monospace;font-size:11px;white-space:pre;" });
    formatInfo.textContent = "CSV Format:\n  split,f0,f1,f2,f3,t0\n  train,5.1,3.5,1.4,0.2,0\n  train,4.9,3.0,1.4,0.2,0\n  val,7.0,3.2,4.7,1.4,1\n  test,6.3,3.3,6.0,2.5,2\n\n  f* = features, t* = targets, split = train/val/test";
    wrap.appendChild(formatInfo);

    // File upload
    var uploadRow = el("div", { style: "margin:12px 0;display:flex;gap:8px;align-items:center;" });
    var fileInput = el("input", { type: "file", accept: ".csv", style: "font-size:12px;" });
    var statusSpan = el("span", { style: "font-size:11px;color:#94a3b8;" }, "No file selected — using Iris sample");
    uploadRow.appendChild(fileInput);
    uploadRow.appendChild(statusSpan);
    wrap.appendChild(uploadRow);

    // Store CSV text for build
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        var text = e.target.result;
        if (typeof window !== "undefined") window._customCsvText = text;
        var parsed = parseCSV(text);
        if (parsed) {
          statusSpan.style.color = "#4ade80";
          statusSpan.textContent = "Loaded: " + parsed.featureSize + " features, " + parsed.targetSize + " targets";
        } else {
          statusSpan.style.color = "#f43f5e";
          statusSpan.textContent = "Parse error — check CSV format";
        }
      };
      reader.readAsText(file);
    });

    // Sample data preview
    var sampleRows = generateSampleData(42).slice(0, 8);
    var previewTable = el("table", { style: "margin-top:12px;border-collapse:collapse;font-size:11px;width:100%;" });
    var thead = el("tr", {});
    ["split", "f0 (sepal L)", "f1 (sepal W)", "f2 (petal L)", "f3 (petal W)", "t0 (class)"].forEach(function (h) {
      thead.appendChild(el("th", { style: "padding:4px 8px;border-bottom:1px solid #334155;text-align:left;color:#67e8f9;" }, h));
    });
    previewTable.appendChild(thead);
    sampleRows.forEach(function (r) {
      var tr = el("tr", {});
      [r.split].concat(r.features).concat([r.label]).forEach(function (v) {
        tr.appendChild(el("td", { style: "padding:3px 8px;border-bottom:1px solid #1e293b;" }, String(v)));
      });
      previewTable.appendChild(tr);
    });
    wrap.appendChild(el("div", { style: "margin-top:8px;color:#94a3b8;font-size:11px;" }, "Sample data (Iris-like, 150 samples, 3 classes):"));
    wrap.appendChild(previewTable);

    mountEl.appendChild(wrap);
  }

  return {
    id: MODULE_ID,
    schemaId: SCHEMA_ID,
    label: "Custom CSV",
    description: "Upload tabular CSV with f*/t* columns or use built-in Iris sample",
    kind: "panel_builder",
    build: function (config) {
      var c = config || {};
      // Only use browser-uploaded CSV if no sourceDescriptor is configured
      if (!c.sourceDescriptor && !c.csvText && typeof window !== "undefined" && window._customCsvText) {
        c.csvText = window._customCsvText;
      }
      return build(c);
    },
    uiApi: {
      getSourceDescriptorSpec: function () {
        return {
          title: "Local Source (Server Training)",
          helpText: "Point to a local CSV + manifest JSON for PyTorch server or notebook training.",
          schema: [
            { key: "useSourceDescriptor", label: "Use local source", type: "checkbox" },
            {
              key: "sourceKind", label: "Source type", type: "select",
              options: [
                { value: "local_csv_manifest", label: "Local CSV + manifest" },
                { value: "local_json_dataset", label: "Local JSON dataset" },
              ],
            },
            { key: "sourceDatasetPath", label: "Dataset path", type: "text", placeholder: "/path/to/data.csv" },
            { key: "sourceManifestPath", label: "Manifest path", type: "text", placeholder: "/path/to/manifest.json" },
            { key: "sourceRootDir", label: "Root dir (optional)", type: "text" },
            { key: "sourceFeatureSize", label: "Feature columns", type: "number", min: 1, step: 1 },
            { key: "sourceTargetSize", label: "Target columns", type: "number", min: 1, step: 1 },
            { key: "sourceNumClasses", label: "Classes (0 for regression)", type: "number", min: 0, step: 1 },
          ],
          value: {
            useSourceDescriptor: false,
            sourceKind: "local_csv_manifest",
            sourceDatasetPath: "",
            sourceManifestPath: "",
            sourceRootDir: "",
            sourceFeatureSize: "4",
            sourceTargetSize: "1",
            sourceNumClasses: "3",
          },
        };
      },
    },
    playgroundApi: {
      renderPlayground: renderPlayground,
    },
  };
});

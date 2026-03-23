(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCDatasetBundleAdapter = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var GLOBAL = typeof globalThis !== "undefined" ? globalThis : {};

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function createRng(seed) {
    var x = (seed >>> 0) || 42;
    return function () {
      x = (1664525 * x + 1013904223) >>> 0;
      return x / 4294967296;
    };
  }

  function sanitizeFileStem(raw) {
    return String(raw || "item")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "item";
  }

  function getSchemaRegistry() {
    return (GLOBAL && GLOBAL.OSCSchemaRegistry) || null;
  }

  function isImageSchema(schemaId, dataset) {
    var sid = normalizeSchemaId(schemaId, dataset);
    var registry = getSchemaRegistry();
    if (!registry || typeof registry.getDatasetSchema !== "function") {
      return sid === "mnist" || sid === "fashion_mnist";
    }
    var schema = registry.getDatasetSchema(sid);
    return String(schema && schema.sampleType || "").trim().toLowerCase() === "image";
  }

  function normalizeSchemaId(rawSchemaId, dataset) {
    var sid = String(rawSchemaId || (dataset && dataset.schemaId) || "").trim().toLowerCase();
    if (!sid) sid = "oscillator";
    return sid;
  }

  function normalizeSplitConfig(cfg) {
    var mode = String((cfg && cfg.mode) || "stratified_scenario");
    var train = Number(cfg && cfg.train);
    var val = Number(cfg && cfg.val);
    var test = Number(cfg && cfg.test);
    if (!Number.isFinite(train)) train = 0.70;
    if (!Number.isFinite(val)) val = 0.15;
    if (!Number.isFinite(test)) test = 0.15;
    train = clamp(train, 0.01, 0.98);
    val = clamp(val, 0.01, 0.98);
    test = clamp(test, 0.01, 0.98);
    var s = train + val + test;
    if (s <= 1e-9) return { mode: mode, train: 0.70, val: 0.15, test: 0.15 };
    return { mode: mode, train: train / s, val: val / s, test: test / s };
  }

  function buildTrajectorySplitMap(trajectories, splitCfg, seed) {
    var cfg = normalizeSplitConfig(splitCfg);
    var n = Array.isArray(trajectories) ? trajectories.length : 0;
    var out = new Array(n);
    if (!n) return out;

    var groups = {};
    for (var i = 0; i < n; i += 1) {
      var tr = trajectories[i] || {};
      var sc = String((tr.params && tr.params.scenario) || "spring");
      var gk = cfg.mode === "stratified_scenario" ? sc : "all";
      if (!groups[gk]) groups[gk] = [];
      groups[gk].push(i);
    }

    Object.keys(groups).forEach(function (gk, gIdx) {
      var idxs = groups[gk].slice();
      var rng = createRng((Number(seed) || 42) + (gIdx + 1) * 1009);
      for (var j = idxs.length - 1; j > 0; j -= 1) {
        var k = Math.floor(rng() * (j + 1));
        var t = idxs[j];
        idxs[j] = idxs[k];
        idxs[k] = t;
      }
      var m = idxs.length;
      var nTrain = Math.floor(m * cfg.train);
      var nVal = Math.floor(m * cfg.val);
      var nTest = m - nTrain - nVal;
      if (m >= 3) {
        if (nTrain < 1) { nTrain = 1; nTest = Math.max(0, m - nTrain - nVal); }
        if (nVal < 1) { nVal = 1; nTest = Math.max(0, m - nTrain - nVal); }
        if (nTest < 1) {
          nTest = 1;
          if (nTrain > nVal && nTrain > 1) nTrain -= 1;
          else if (nVal > 1) nVal -= 1;
          else if (nTrain > 1) nTrain -= 1;
        }
      }
      for (var p = 0; p < idxs.length; p += 1) {
        out[idxs[p]] = p < nTrain ? "train" : (p < nTrain + nVal ? "val" : "test");
      }
    });

    return out;
  }

  function buildDatasetCsvAndManifest(ds) {
    if (!ds || !Array.isArray(ds.trajectories) || !ds.trajectories.length) return null;
    var splitCfg = normalizeSplitConfig(
      ds.splitConfig || { mode: "stratified_scenario", train: 0.70, val: 0.15, test: 0.15 }
    );
    var splitMap = buildTrajectorySplitMap(ds.trajectories, splitCfg, Number(ds.seed == null ? 42 : ds.seed));
    var head = [
      "trajectory", "split", "step", "t", "x", "v", "scenario",
      "m", "c", "k_slg", "k_slg_role", "g_global", "restitution",
      "x0", "v0", "groundModel", "groundK", "groundC", "mode", "seed",
    ];
    var rows = [head.join(",")];

    for (var i = 0; i < ds.trajectories.length; i += 1) {
      var tr = ds.trajectories[i] || {};
      var t = Array.isArray(tr.t) ? tr.t : [];
      var x = Array.isArray(tr.x) ? tr.x : [];
      var v = Array.isArray(tr.v) ? tr.v : [];
      var n = Math.min(t.length, x.length, v.length);
      var p = tr.params || {};
      var scen = p.scenario == null ? "" : String(p.scenario);
      var p3Role = scen === "spring" ? "k" : (scen === "pendulum" ? "L" : (scen === "bouncing" ? "g" : "p3"));
      for (var j = 0; j < n; j += 1) {
        rows.push([
          i,
          splitMap[i] || "train",
          j,
          t[j],
          x[j],
          v[j],
          scen,
          p.m == null ? "" : p.m,
          p.c == null ? "" : p.c,
          p.k == null ? "" : p.k,
          p3Role,
          p.g == null ? "" : p.g,
          p.restitution == null ? "" : p.restitution,
          p.x0 == null ? "" : p.x0,
          p.v0 == null ? "" : p.v0,
          p.groundModel == null ? "" : p.groundModel,
          p.groundK == null ? "" : p.groundK,
          p.groundC == null ? "" : p.groundC,
          ds.mode == null ? "" : ds.mode,
          ds.seed == null ? "" : ds.seed,
        ].join(","));
      }
    }

    var splitByTrajectory = {};
    var splitCounts = { train: 0, val: 0, test: 0 };
    for (var k = 0; k < ds.trajectories.length; k += 1) {
      var b = String(splitMap[k] || "train");
      splitByTrajectory[String(k)] = b;
      if (splitCounts[b] == null) splitCounts[b] = 0;
      splitCounts[b] += 1;
    }
    var baseName = "oscillator_dataset_" + String(ds.mode || "unknown") + "_seed" + String(ds.seed == null ? "" : ds.seed);
    var manifest = {
      version: 1,
      source: "oscillator-surrogate-dataset-bundle-adapter",
      datasetFile: baseName + ".csv",
      mode: String(ds.mode || "unknown"),
      seed: Number(ds.seed == null ? 42 : ds.seed),
      splitConfig: splitCfg,
      splitCounts: splitCounts,
      splitByTrajectory: splitByTrajectory,
    };
    return { baseName: baseName, csv: rows.join("\n"), manifest: manifest };
  }

  function _toSafePixelList(values) {
    if (!values || !Array.isArray(values)) return "";
    var parts = [];
    for (var i = 0; i < values.length; i += 1) {
      var v = Number(values[i]);
      if (!Number.isFinite(v)) {
        v = 0;
      }
      parts.push(String(Math.max(0, Math.min(1, v))));
    }
    return parts.join("|");
  }

  function buildMnistCsvAndManifest(ds) {
    if (!ds || typeof ds !== "object") return null;
    var records = ds.records || {};
    var trainRecs = records.train || {};
    var valRecs = records.val || {};
    var testRecs = records.test || {};
    var trainX = Array.isArray(trainRecs.x) ? trainRecs.x : [];
    var trainY = Array.isArray(trainRecs.y) ? trainRecs.y : [];
    var valX = Array.isArray(valRecs.x) ? valRecs.x : [];
    var valY = Array.isArray(valRecs.y) ? valRecs.y : [];
    var testX = Array.isArray(testRecs.x) ? testRecs.x : [];
    var testY = Array.isArray(testRecs.y) ? testRecs.y : [];

    var classNames = Array.isArray(ds.classNames) ? ds.classNames.slice() : [];
    if (classNames.length !== 10) {
      classNames = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
    }

    var rows = ["trajectory,split,step,t,x,v,scenario,m,c,k_slg,k_slg_role,g_global,restitution,x0,v0,ground,c_g,k_g,seed,mode,label,class_name,pixel_values"];
    var splitCounts = { train: 0, val: 0, test: 0 };
    var trajectoryIndex = 0;
    var seedValue = Number(ds.seed == null ? 42 : ds.seed);
    if (!Number.isFinite(seedValue)) seedValue = 42;

    function appendRows(splitName, xs, ys) {
      var n = Math.min(Array.isArray(xs) ? xs.length : 0, Array.isArray(ys) ? ys.length : 0);
      for (var i = 0; i < n; i += 1) {
        var label = clamp(Math.round(Number(ys[i])), 0, 9);
        var clsName = classNames[label] != null ? classNames[label] : String(label);
        var raw = Array.isArray(xs[i]) ? xs[i] : [];
        var px = [];
        var sum = 0;
        for (var k = 0; k < raw.length; k += 1) {
          var vv = Number(raw[k]);
          if (!Number.isFinite(vv)) vv = 0;
          if (vv > 1) vv = vv / 255;
          vv = clamp(vv, 0, 1);
          px.push(vv);
          sum += vv;
        }
        var mean = px.length ? (sum / px.length) : 0;
        var varAccum = 0;
        for (var j = 0; j < px.length; j += 1) {
          var d = px[j] - mean;
          varAccum += d * d;
        }
        var std = px.length ? Math.sqrt(varAccum / px.length) : 0;
        rows.push([
          trajectoryIndex,
          splitName,
          0,
          0,
          mean,
          std,
          "spring",
          1,
          0,
          1,
          "k",
          9.81,
          0.8,
          0,
          0,
          "rigid",
          90,
          2500,
          seedValue,
          "mnist_like",
          label,
          clsName,
          "\"" + _toSafePixelList(px) + "\"",
        ].join(","));
        trajectoryIndex += 1;
      }
      splitCounts[splitName] = n;
    }

    appendRows("train", trainX, trainY);
    appendRows("val", valX, valY);
    appendRows("test", testX, testY);

    var total = splitCounts.train + splitCounts.val + splitCounts.test;
    var manifest = {
      version: 1,
      source: "oscillator-surrogate-dataset-bundle-adapter",
      datasetFile: "dataset.csv",
      splitConfig: normalizeSplitConfig(ds.splitConfig || { mode: "random", train: 0.7, val: 0.15, test: 0.15 }),
      splitCounts: {
        train: splitCounts.train,
        val: splitCounts.val,
        test: splitCounts.test,
        total: total,
      },
      labelsHistogram: ds.labelsHistogram || {},
      classCount: 10,
      schemaId: normalizeSchemaId(ds && ds.schemaId, ds),
      seed: Number(ds.seed == null ? 42 : ds.seed),
    };
    return {
      csv: rows.join("\n"),
      manifest: manifest,
      splitCounts: splitCounts,
      splitBySplit: { train: splitCounts.train, val: splitCounts.val, test: splitCounts.test },
      rows: rows.length - 1,
    };
  }

  // Generic CSV builder for any dataset with xTrain/yTrain or records
  function buildGenericCsvFromDataset(ds) {
    if (!ds) return null;
    var splits = [];

    if (ds.xTrain && ds.xTrain.length) {
      for (var i = 0; i < ds.xTrain.length; i++) splits.push({ split: "train", x: ds.xTrain[i], y: ds.yTrain ? ds.yTrain[i] : ds.xTrain[i] });
    }
    if (ds.xVal && ds.xVal.length) {
      for (var j = 0; j < ds.xVal.length; j++) splits.push({ split: "val", x: ds.xVal[j], y: ds.yVal ? ds.yVal[j] : ds.xVal[j] });
    }
    if (ds.xTest && ds.xTest.length) {
      for (var k = 0; k < ds.xTest.length; k++) splits.push({ split: "test", x: ds.xTest[k], y: ds.yTest ? ds.yTest[k] : ds.xTest[k] });
    }

    // try records format
    if (!splits.length && ds.records) {
      ["train", "val", "test"].forEach(function (s) {
        var rec = ds.records[s];
        if (rec && rec.x) {
          for (var ri = 0; ri < rec.x.length; ri++) splits.push({ split: s, x: rec.x[ri], y: rec.y ? rec.y[ri] : rec.x[ri] });
        }
      });
    }

    if (!splits.length) return null;

    var featureLen = Array.isArray(splits[0].x) ? splits[0].x.length : 1;
    var targetLen = Array.isArray(splits[0].y) ? splits[0].y.length : 1;

    // header
    var header = ["split"];
    for (var fi = 0; fi < featureLen; fi++) header.push("f" + fi);
    for (var ti = 0; ti < targetLen; ti++) header.push("t" + ti);
    var lines = [header.join(",")];

    splits.forEach(function (row) {
      var vals = [row.split];
      var xArr = Array.isArray(row.x) ? row.x : [row.x];
      var yArr = Array.isArray(row.y) ? row.y : [row.y];
      for (var xi = 0; xi < featureLen; xi++) vals.push(String(xArr[xi] != null ? xArr[xi] : 0));
      for (var yi = 0; yi < targetLen; yi++) vals.push(String(yArr[yi] != null ? yArr[yi] : 0));
      lines.push(vals.join(","));
    });

    return lines.join("\n");
  }

  function buildNotebookDatasetFiles(input) {
    var cfg = input || {};
    var ds = cfg.dataset;
    if (!ds || typeof ds !== "object") return null;
    var schemaId = normalizeSchemaId(cfg.schemaId, ds);
    var datasetName = String(cfg.datasetName || ds.name || ("dataset_" + schemaId)).trim();
    var stem = sanitizeFileStem(datasetName || ("dataset_" + schemaId));
    var sourceTag = String(cfg.sourceTag || "dataset_bundle_adapter");
    var splitCfg = normalizeSplitConfig(
      (ds && ds.splitConfig) || { mode: "random", train: 0.80, val: 0.10, test: 0.10 }
    );

    if (schemaId === "oscillator" && Array.isArray(ds.trajectories) && ds.trajectories.length) {
      var built = buildDatasetCsvAndManifest(ds);
      if (!built || !built.csv) return null;
      var csvName = stem + ".csv";
      var splitName = stem + ".split_manifest.json";
      var manifest = Object.assign({}, built.manifest || {}, {
        datasetFile: csvName,
        schemaId: schemaId,
        source: sourceTag,
      });
      return {
        schemaId: schemaId,
        datasetName: datasetName,
        format: "csv_manifest",
        datasetRef: "dataset/" + csvName,
        splitRef: "dataset/" + splitName,
        files: [
          { path: "dataset/" + csvName, content: built.csv, contentType: "text/csv;charset=utf-8;" },
          { path: "dataset/" + splitName, content: JSON.stringify(manifest, null, 2), contentType: "application/json;charset=utf-8;" },
        ],
        manifest: manifest,
      };
    }

    if (isImageSchema(schemaId, ds) && ds && typeof ds === "object" && ds.records) {
      var builtMnist = buildMnistCsvAndManifest(ds);
      if (!builtMnist || !builtMnist.csv) return null;
      var csvNameMnist = stem + ".csv";
      var splitNameMnist = stem + ".split_manifest.json";
      var manifestMnist = Object.assign({}, builtMnist.manifest || {}, {
        datasetFile: csvNameMnist,
        splitConfig: splitCfg,
        schemaId: schemaId,
      });
      return {
        schemaId: schemaId,
        datasetName: datasetName,
        format: "csv_manifest",
        datasetRef: "dataset/" + csvNameMnist,
        splitRef: "dataset/" + splitNameMnist,
        files: [
          { path: "dataset/" + csvNameMnist, content: builtMnist.csv, contentType: "text/csv;charset=utf-8;" },
          { path: "dataset/" + splitNameMnist, content: JSON.stringify(manifestMnist, null, 2), contentType: "application/json;charset=utf-8;" },
        ],
        manifest: manifestMnist,
      };
    }

    // Generic tabular fallback: convert xTrain/yTrain (or records) to CSV
    var genericCsv = buildGenericCsvFromDataset(ds);
    if (genericCsv) {
      var csvNameGeneric = stem + ".csv";
      var splitNameGeneric = stem + ".split_manifest.json";
      var manifestGen = {
        version: 1, source: sourceTag, schemaId: schemaId,
        format: "csv_manifest", datasetFile: csvNameGeneric, splitConfig: splitCfg,
        mode: String((ds && ds.mode) || "regression"),
        featureSize: Number(ds.featureSize || (ds.xTrain && ds.xTrain[0] && ds.xTrain[0].length) || 0),
        seed: Number(ds.seed == null ? 42 : ds.seed),
      };
      return {
        schemaId: schemaId, datasetName: datasetName, format: "csv_manifest",
        datasetRef: "dataset/" + csvNameGeneric, splitRef: "dataset/" + splitNameGeneric,
        files: [
          { path: "dataset/" + csvNameGeneric, content: genericCsv, contentType: "text/csv;charset=utf-8;" },
          { path: "dataset/" + splitNameGeneric, content: JSON.stringify(manifestGen, null, 2), contentType: "application/json;charset=utf-8;" },
        ],
        manifest: manifestGen,
      };
    }

    var payloadName = stem + ".dataset.json";
    var manifestName = stem + ".dataset_manifest.json";
    var payload = JSON.stringify({
      schemaId: schemaId,
      datasetName: datasetName,
      dataset: ds,
    }, null, 2);
    var manifestGeneric = {
      version: 1,
      source: sourceTag,
      schemaId: schemaId,
      format: "json",
      datasetFile: payloadName,
      splitConfig: splitCfg,
      mode: String((ds && ds.mode) || ""),
      seed: Number(ds && ds.seed == null ? 42 : ds.seed),
    };
    return {
      schemaId: schemaId,
      datasetName: datasetName,
      format: "json_payload",
      datasetRef: "dataset/" + payloadName,
      splitRef: "dataset/" + manifestName,
      files: [
        { path: "dataset/" + payloadName, content: payload, contentType: "application/json;charset=utf-8;" },
        { path: "dataset/" + manifestName, content: JSON.stringify(manifestGeneric, null, 2), contentType: "application/json;charset=utf-8;" },
      ],
      manifest: manifestGeneric,
    };
  }

  return {
    sanitizeFileStem: sanitizeFileStem,
    normalizeSchemaId: normalizeSchemaId,
    normalizeSplitConfig: normalizeSplitConfig,
    buildTrajectorySplitMap: buildTrajectorySplitMap,
    buildDatasetCsvAndManifest: buildDatasetCsvAndManifest,
    buildNotebookDatasetFiles: buildNotebookDatasetFiles,
  };
});

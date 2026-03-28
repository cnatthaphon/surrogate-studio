(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root, true);
    return;
  }
  root.OSCNotebookCore = factory(root, false);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, isNode) {
  "use strict";

  var GLOBAL = root || {};
  var FS = null;
  var PATH = null;
  if (isNode) {
    FS = require("fs");
    PATH = require("path");
  }

  var TEXT_ENCODER = (typeof TextEncoder !== "undefined") ? new TextEncoder() : null;
  var CRC_TABLE = null;
  var CELL_SEQ = 0;

  function ensureCrcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    CRC_TABLE = new Uint32Array(256);
    for (var n = 0; n < 256; n += 1) {
      var c = n;
      for (var k = 0; k < 8; k += 1) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      }
      CRC_TABLE[n] = c >>> 0;
    }
    return CRC_TABLE;
  }

  function crc32(bytes) {
    var table = ensureCrcTable();
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i += 1) {
      c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function encodeUtf8(text) {
    var s = String(text == null ? "" : text);
    if (TEXT_ENCODER) return TEXT_ENCODER.encode(s);
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "utf8"));
    var out = unescape(encodeURIComponent(s));
    var arr = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i += 1) arr[i] = out.charCodeAt(i) & 0xFF;
    return arr;
  }

  function toBase64Utf8(text) {
    var s = String(text == null ? "" : text);
    if (typeof Buffer !== "undefined") return Buffer.from(s, "utf8").toString("base64");
    var u8 = encodeUtf8(s);
    var bin = "";
    for (var i = 0; i < u8.length; i += 1) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }

  function toSourceLines(text) {
    var s = String(text == null ? "" : text);
    if (!s) return [];
    var parts = s.split("\n");
    var out = new Array(parts.length);
    for (var i = 0; i < parts.length; i += 1) {
      out[i] = (i < parts.length - 1) ? (parts[i] + "\n") : parts[i];
    }
    return out;
  }

  function toUint8(content) {
    if (content instanceof Uint8Array) return content;
    if (content instanceof ArrayBuffer) return new Uint8Array(content);
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(content)) return new Uint8Array(content);
    return encodeUtf8(String(content == null ? "" : content));
  }

  function concatBytes(chunks, totalBytes) {
    var out = new Uint8Array(totalBytes);
    var offset = 0;
    for (var i = 0; i < chunks.length; i += 1) {
      out.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return out;
  }

  function writeU16LE(arr, offset, v) {
    arr[offset] = v & 0xFF;
    arr[offset + 1] = (v >>> 8) & 0xFF;
  }

  function writeU32LE(arr, offset, v) {
    arr[offset] = v & 0xFF;
    arr[offset + 1] = (v >>> 8) & 0xFF;
    arr[offset + 2] = (v >>> 16) & 0xFF;
    arr[offset + 3] = (v >>> 24) & 0xFF;
  }

  function dosDateTimeParts(date) {
    var d = date instanceof Date ? date : new Date();
    var year = d.getFullYear();
    if (year < 1980) year = 1980;
    var dosTime = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
    var dosDate = (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time: dosTime >>> 0, date: dosDate >>> 0 };
  }

  function makeZipBytes(rawEntries) {
    var entries = Array.isArray(rawEntries) ? rawEntries.slice() : [];
    var locals = [];
    var centrals = [];
    var offset = 0;
    var now = dosDateTimeParts(new Date());

    for (var i = 0; i < entries.length; i += 1) {
      var e = entries[i] || {};
      var name = String(e.path || e.name || "").replace(/\\/g, "/");
      if (!name) continue;
      var isDir = /\/$/.test(name);
      var nameBytes = encodeUtf8(name);
      var dataBytes = isDir ? new Uint8Array(0) : toUint8(e.content);
      var csum = crc32(dataBytes);
      var size = dataBytes.length >>> 0;

      var local = new Uint8Array(30 + nameBytes.length + size);
      writeU32LE(local, 0, 0x04034b50);
      writeU16LE(local, 4, 20);
      writeU16LE(local, 6, 0);
      writeU16LE(local, 8, 0);
      writeU16LE(local, 10, now.time);
      writeU16LE(local, 12, now.date);
      writeU32LE(local, 14, csum);
      writeU32LE(local, 18, size);
      writeU32LE(local, 22, size);
      writeU16LE(local, 26, nameBytes.length);
      writeU16LE(local, 28, 0);
      local.set(nameBytes, 30);
      if (size > 0) local.set(dataBytes, 30 + nameBytes.length);
      locals.push(local);

      var central = new Uint8Array(46 + nameBytes.length);
      writeU32LE(central, 0, 0x02014b50);
      writeU16LE(central, 4, 20);
      writeU16LE(central, 6, 20);
      writeU16LE(central, 8, 0);
      writeU16LE(central, 10, 0);
      writeU16LE(central, 12, now.time);
      writeU16LE(central, 14, now.date);
      writeU32LE(central, 16, csum);
      writeU32LE(central, 20, size);
      writeU32LE(central, 24, size);
      writeU16LE(central, 28, nameBytes.length);
      writeU16LE(central, 30, 0);
      writeU16LE(central, 32, 0);
      writeU16LE(central, 34, 0);
      writeU16LE(central, 36, 0);
      writeU32LE(central, 38, isDir ? 0x10 : 0x20);
      writeU32LE(central, 42, offset);
      central.set(nameBytes, 46);
      centrals.push(central);

      offset += local.length;
    }

    var centralSize = 0;
    for (var j = 0; j < centrals.length; j += 1) centralSize += centrals[j].length;
    var end = new Uint8Array(22);
    writeU32LE(end, 0, 0x06054b50);
    writeU16LE(end, 4, 0);
    writeU16LE(end, 6, 0);
    writeU16LE(end, 8, centrals.length);
    writeU16LE(end, 10, centrals.length);
    writeU32LE(end, 12, centralSize);
    writeU32LE(end, 16, offset);
    writeU16LE(end, 20, 0);

    var total = end.length;
    for (var k = 0; k < locals.length; k += 1) total += locals[k].length;
    for (var m = 0; m < centrals.length; m += 1) total += centrals[m].length;
    return concatBytes(locals.concat(centrals).concat([end]), total);
  }

  function sanitizeFileStem(raw) {
    return String(raw || "item")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "item";
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function createRng(seed) {
    var x = (seed >>> 0) || 42;
    return function next() {
      x = (1664525 * x + 1013904223) >>> 0;
      return x / 4294967296;
    };
  }

  function getAdapter() {
    if (GLOBAL && GLOBAL.OSCDatasetBundleAdapter) return GLOBAL.OSCDatasetBundleAdapter;
    if (isNode) {
      try { return require("./dataset_bundle_adapter.js"); } catch (_err) {}
    }
    return null;
  }

  function normalizeSplitConfig(cfg) {
    var adapter = getAdapter();
    if (adapter && typeof adapter.normalizeSplitConfig === "function") {
      return adapter.normalizeSplitConfig(cfg || {});
    }
    var mode = String((cfg && cfg.mode) || "random");
    var train = Number(cfg && cfg.train);
    var val = Number(cfg && cfg.val);
    var test = Number(cfg && cfg.test);
    if (!Number.isFinite(train)) train = 0.7;
    if (!Number.isFinite(val)) val = 0.15;
    if (!Number.isFinite(test)) test = 0.15;
    train = clamp(train, 0.01, 0.98);
    val = clamp(val, 0.01, 0.98);
    test = clamp(test, 0.01, 0.98);
    var s = train + val + test;
    if (s <= 1e-9) return { mode: mode, train: 0.7, val: 0.15, test: 0.15 };
    return { mode: mode, train: train / s, val: val / s, test: test / s };
  }

  function buildTrajectorySplitMap(trajectories, splitCfg, seed) {
    var adapter = getAdapter();
    if (adapter && typeof adapter.buildTrajectorySplitMap === "function") {
      return adapter.buildTrajectorySplitMap(trajectories, splitCfg, seed);
    }
    var cfg = normalizeSplitConfig(splitCfg);
    var n = Array.isArray(trajectories) ? trajectories.length : 0;
    var out = new Array(n);
    if (!n) return out;
    var rng = createRng((Number(seed) || 42) >>> 0);
    var idxs = [];
    for (var i = 0; i < n; i += 1) idxs.push(i);
    for (var j = idxs.length - 1; j > 0; j -= 1) {
      var k = Math.floor(rng() * (j + 1));
      var t = idxs[j];
      idxs[j] = idxs[k];
      idxs[k] = t;
    }
    var nTrain = Math.floor(n * cfg.train);
    var nVal = Math.floor(n * cfg.val);
    for (var p = 0; p < idxs.length; p += 1) {
      out[idxs[p]] = p < nTrain ? "train" : (p < nTrain + nVal ? "val" : "test");
    }
    return out;
  }

  function buildDatasetCsvAndManifest(ds) {
    var adapter = getAdapter();
    if (adapter && typeof adapter.buildDatasetCsvAndManifest === "function") {
      return adapter.buildDatasetCsvAndManifest(ds);
    }
    return null;
  }

  function defaultParamRanges() {
    return {
      spring: { m: [0.5, 2.0], c: [0.05, 0.8], k: [1.0, 8.0], x0: [-1.5, 1.5], v0: [-1.0, 1.0] },
      pendulum: { m: [0.5, 2.0], c: [0.01, 0.5], k: [0.5, 2.0], x0: [-1.2, 1.2], v0: [-1.0, 1.0] },
      bouncing: { m: [0.3, 3.0], c: [0.0, 0.25], k: [9.81, 9.81], x0: [0.0, 0.0], v0: [0.8, 6.0], e: [0.55, 0.9] },
    };
  }

  function randomInRange(rng, lo, hi) {
    return lo + (hi - lo) * rng();
  }

  function rk4Step(state, dt, deriv) {
    var x = state[0];
    var v = state[1];
    var k1 = deriv(x, v);
    var k2 = deriv(x + 0.5 * dt * k1[0], v + 0.5 * dt * k1[1]);
    var k3 = deriv(x + 0.5 * dt * k2[0], v + 0.5 * dt * k2[1]);
    var k4 = deriv(x + dt * k3[0], v + dt * k3[1]);
    var nx = x + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    var nv = v + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    return [nx, nv];
  }

  function simulateTrajectory(scenario, params, durationSec, dt) {
    var nSteps = Math.max(2, Math.floor(Number(durationSec) / Number(dt)));
    var t = new Array(nSteps + 1);
    var x = new Array(nSteps + 1);
    var v = new Array(nSteps + 1);
    var curX = Number(params.x0 || 0);
    var curV = Number(params.v0 || 0);
    var m = Math.max(1e-9, Number(params.m || 1));
    var c = Number(params.c || 0);
    var k = Number(params.k || 1);
    var g = Number(params.g || 9.81);
    var e = Number(params.restitution == null ? 0.8 : params.restitution);

    for (var i = 0; i <= nSteps; i += 1) {
      t[i] = i * dt;
      x[i] = curX;
      v[i] = curV;
      if (i === nSteps) break;

      if (scenario === "bouncing") {
        var a = -g - (c / m) * curV;
        curV = curV + a * dt;
        curX = curX + curV * dt;
        if (curX < 0 && curV < 0) {
          curX = 0;
          curV = -e * curV;
        }
      } else if (scenario === "pendulum") {
        var pStep = rk4Step([curX, curV], dt, function (xx, vv) {
          return [vv, -(c / m) * vv - (g / Math.max(1e-9, k)) * Math.sin(xx)];
        });
        curX = pStep[0];
        curV = pStep[1];
      } else {
        var sStep = rk4Step([curX, curV], dt, function (xx, vv) {
          return [vv, -(c / m) * vv - (k / m) * xx];
        });
        curX = sStep[0];
        curV = sStep[1];
      }
    }

    return { t: t, x: x, v: v };
  }

  function generateDefaultDataset(rawCfg) {
    var cfg = rawCfg || {};
    var seed = Number(cfg.seed);
    if (!Number.isFinite(seed)) seed = 42;
    seed = Math.floor(seed);
    var rng = createRng(seed >>> 0);
    var numTraj = Math.max(3, Math.floor(Number(cfg.numTraj) || 150));
    var durationSec = Math.max(0.5, Number(cfg.durationSec) || 16.0);
    var dt = Math.max(1e-4, Number(cfg.dt) || 0.02);
    var splitConfig = normalizeSplitConfig(cfg.splitConfig || { mode: "stratified_scenario", train: 0.7, val: 0.15, test: 0.15 });
    var scenarios = Array.isArray(cfg.scenarios) && cfg.scenarios.length
      ? cfg.scenarios.map(function (x) { return String(x || "").trim().toLowerCase(); }).filter(Boolean)
      : ["spring", "pendulum", "bouncing"];
    if (!scenarios.length) scenarios = ["spring", "pendulum", "bouncing"];
    var ranges = defaultParamRanges();

    var trajectories = [];
    for (var i = 0; i < numTraj; i += 1) {
      var scenario = scenarios[i % scenarios.length];
      if (!ranges[scenario]) scenario = "spring";
      var r = ranges[scenario];
      var p = {
        scenario: scenario,
        m: randomInRange(rng, r.m[0], r.m[1]),
        c: randomInRange(rng, r.c[0], r.c[1]),
        k: randomInRange(rng, r.k[0], r.k[1]),
        x0: randomInRange(rng, r.x0[0], r.x0[1]),
        v0: randomInRange(rng, r.v0[0], r.v0[1]),
        g: 9.81,
        restitution: scenario === "bouncing" ? randomInRange(rng, r.e[0], r.e[1]) : 0.8,
        groundModel: "rigid",
        groundK: 2500,
        groundC: 90,
      };
      var sim = simulateTrajectory(scenario, p, durationSec, dt);
      trajectories.push({
        params: p,
        t: sim.t,
        x: sim.x,
        v: sim.v,
      });
    }

    var splitMap = buildTrajectorySplitMap(trajectories, splitConfig, seed);
    var splitCounts = { train: 0, val: 0, test: 0 };
    for (var j = 0; j < splitMap.length; j += 1) {
      var b = String(splitMap[j] || "train");
      if (splitCounts[b] == null) splitCounts[b] = 0;
      splitCounts[b] += 1;
    }
    return {
      id: String(cfg.id || ("ds_" + Date.now() + "_" + Math.floor(rng() * 1e9))),
      name: String(cfg.name || ("dataset_oscillator_" + Date.now())),
      schemaId: "oscillator",
      datasetModuleId: "oscillator",
      mode: String(cfg.mode || "mixed"),
      seed: seed,
      dt: dt,
      durationSec: durationSec,
      splitConfig: splitConfig,
      splitCounts: splitCounts,
      trainCount: splitCounts.train || 0,
      valCount: splitCounts.val || 0,
      testCount: splitCounts.test || 0,
      trajectories: trajectories,
      createdAt: Date.now(),
    };
  }

  function normalizeRuntimeId(runtime) {
    var r = String(runtime || "js_client").trim();
    if (!r) r = "js_client";
    return r;
  }

  function normalizeTrainCfg(trainCfg) {
    var c = trainCfg || {};
    return {
      epochs: Math.max(1, Math.floor(Number(c.epochs) || 40)),
      batchSize: Math.max(1, Math.floor(Number(c.batchSize) || 256)),
      learningRate: Number.isFinite(Number(c.learningRate)) ? Number(c.learningRate) : 1e-3,
      useLrScheduler: c.useLrScheduler !== false,
      lrPatience: Math.max(1, Math.floor(Number(c.lrPatience) || 3)),
      lrFactor: Number.isFinite(Number(c.lrFactor)) ? Number(c.lrFactor) : 0.5,
      minLr: Number.isFinite(Number(c.minLr)) ? Number(c.minLr) : 1e-6,
      restoreBestWeights: c.restoreBestWeights !== false,
      earlyStoppingPatience: Math.max(0, Math.floor(Number(c.earlyStoppingPatience) || 0)),
    };
  }

  function jsonClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSession(session, idx, commonSeed, includeModelGraph) {
    var s = session || {};
    var schemaId = String(s.schemaId || s.datasetSchemaId || s.modelSchemaId || "oscillator").trim().toLowerCase() || "oscillator";
    var graph = s.drawflowGraph || s.graph || s.drawflow || null;
    if (!graph || typeof graph !== "object") {
      throw new Error("Session '" + String(s.id || s.name || idx + 1) + "' is missing drawflowGraph.");
    }
    return {
      sessionId: String(s.id || ("session_" + (idx + 1))),
      name: String(s.name || ("session_" + (idx + 1))),
      schemaId: schemaId,
      datasetSchemaId: String(s.datasetSchemaId || schemaId).trim().toLowerCase() || schemaId,
      modelSchemaId: String(s.modelSchemaId || schemaId).trim().toLowerCase() || schemaId,
      modelName: String(s.modelName || s.name || ("model_" + (idx + 1))),
      datasetName: String(s.datasetName || ("dataset_" + schemaId)),
      runtime: normalizeRuntimeId(s.runtime || "js_client"),
      runtimeBackend: String(s.runtimeBackend || "auto"),
      seed: Number.isFinite(Number(s.seed)) ? Math.floor(Number(s.seed)) : commonSeed,
      samplePerSplit: Math.max(1, Math.min(9, Math.floor(Number(s.samplePerSplit || s.sample_per_split || 3) || 3))),
      includeModelGraph: includeModelGraph,
      trainCfg: normalizeTrainCfg(s.trainCfg || {}),
      drawflowGraph: jsonClone(graph),
      datasetData: s.datasetData || null,
    };
  }

  function countCsvRows(csvText) {
    var s = String(csvText || "").trim();
    if (!s) return 0;
    var lines = s.split(/\r?\n/);
    return Math.max(0, lines.length - 1);
  }

  function pickCsvFromBundle(bundle) {
    if (!bundle || !Array.isArray(bundle.files)) return null;
    for (var i = 0; i < bundle.files.length; i += 1) {
      var f = bundle.files[i] || {};
      if (/\.csv$/i.test(String(f.path || ""))) return String(f.content || "");
    }
    return null;
  }

  function resolveDatasetCsvFromSessions(sessions, adapter) {
    var first = sessions[0] || null;
    if (!first || !first.datasetData) {
      throw new Error("No session datasetData available for notebook export.");
    }
    var schemaId = String(first.datasetSchemaId || first.schemaId || "oscillator").trim().toLowerCase() || "oscillator";
    var dsName = String(first.datasetName || ("dataset_" + schemaId));
    var built = null;
    if (adapter && typeof adapter.buildNotebookDatasetFiles === "function") {
      built = adapter.buildNotebookDatasetFiles({
        schemaId: schemaId,
        datasetName: dsName,
        dataset: first.datasetData,
        sourceTag: "notebook_bundle_core",
      });
    }
    if (!built) {
      throw new Error("Dataset adapter failed to build notebook dataset files for schema='" + schemaId + "'.");
    }
    var csv = pickCsvFromBundle(built);
    if (!csv) throw new Error("Dataset adapter did not provide a CSV file for schema='" + schemaId + "'.");
    return {
      schemaId: schemaId,
      datasetName: dsName,
      csvText: csv,
      rowCount: countCsvRows(csv),
      manifest: built.manifest || null,
      bundle: built,
    };
  }

  function makeMarkdownCell(markdownText) {
    CELL_SEQ += 1;
    return {
      cell_type: "markdown",
      id: "md_" + String(CELL_SEQ),
      metadata: {},
      source: toSourceLines(markdownText),
    };
  }

  function makeCodeCell(codeText) {
    CELL_SEQ += 1;
    return {
      cell_type: "code",
      id: "code_" + String(CELL_SEQ),
      execution_count: null,
      metadata: {},
      outputs: [],
      source: toSourceLines(codeText),
    };
  }

  function buildNotebookObject(opts) {
    CELL_SEQ = 0;
    var packageLabel = String(opts.packageLabel || "2-file package");
    var sessionsB64 = toBase64Utf8(JSON.stringify(opts.sessions || []));
    var pipelineB64 = toBase64Utf8(String(opts.pipelineSource || ""));
    var modelList = (opts.sessions || []).map(function (s) { return String(s.modelName || "model"); }).join(", ");

    var cells = [];
    cells.push(makeMarkdownCell(
      "# Runtime Notebook (" + packageLabel + ")\n" +
      "This notebook embeds runtime pipeline code and loads dataset/model graph from package files.\n\n" +
      "Models: `" + modelList + "`\n"
    ));

    cells.push(makeCodeCell(
      "import sys, importlib.util\n\n" +
      "required = [\n" +
      "    ('numpy', 'numpy'),\n" +
      "    ('pandas', 'pandas'),\n" +
      "    ('matplotlib', 'matplotlib'),\n" +
      "    ('torch', 'torch'),\n" +
      "]\n" +
      "missing = [name for name, mod in required if importlib.util.find_spec(mod) is None]\n" +
      "print(f'Python: {sys.version.split()[0]}')\n" +
      "if missing:\n" +
      "    print('[warn] Missing dependencies:', ', '.join(missing))\n" +
      "    print('[hint] pip install ' + ' '.join(missing))\n" +
      "else:\n" +
      "    import torch\n" +
      "    print('[ok] Dependencies ready. torch=' + str(torch.__version__) + ', cuda=' + str(torch.cuda.is_available()))\n"
    ));

    cells.push(makeMarkdownCell("## 1) Setup Runtime"));
    cells.push(makeCodeCell(
      "from pathlib import Path\n" +
      "import base64, json, sys, types\n\n" +
      "# Edit these paths before running if needed.\n" +
      "RUN_ROOT = '.'\n" +
      "NOTEBOOKS_DIR_OVERRIDE = None\n" +
      "DATASET_PATH_OVERRIDE = None\n" +
      "\n" +
      "def _resolve_optional_path(base, p):\n" +
      "    if p is None:\n" +
      "        return None\n" +
      "    q = Path(str(p)).expanduser()\n" +
      "    return q.resolve() if q.is_absolute() else (base / q).resolve()\n\n" +
      "def _extract_drawflow_graph(payload):\n" +
      "    if not isinstance(payload, dict):\n" +
      "        return None\n" +
      "    if isinstance(payload.get('drawflow'), dict):\n" +
      "        return payload\n" +
      "    if isinstance(payload.get('graph'), dict):\n" +
      "        g = payload.get('graph')\n" +
      "        if isinstance(g.get('drawflow'), dict):\n" +
      "            return g\n" +
      "    model_obj = payload.get('model') if isinstance(payload.get('model'), dict) else None\n" +
      "    if model_obj and isinstance(model_obj.get('graph'), dict):\n" +
      "        g = model_obj.get('graph')\n" +
      "        if isinstance(g.get('drawflow'), dict):\n" +
      "            return g\n" +
      "    return None\n\n" +
      "RUN_ROOT = Path(RUN_ROOT).expanduser().resolve()\n" +
      "NB = _resolve_optional_path(RUN_ROOT, NOTEBOOKS_DIR_OVERRIDE) if NOTEBOOKS_DIR_OVERRIDE is not None else RUN_ROOT\n" +
      "resolved_dataset = _resolve_optional_path(NB, DATASET_PATH_OVERRIDE)\n" +
      "if resolved_dataset is not None:\n" +
      "    DATASET_PATH = resolved_dataset\n" +
      "else:\n" +
      "    DATASET_PATH = NB / 'dataset.csv'\n" +
      "if not DATASET_PATH.exists():\n" +
      "    raise FileNotFoundError(f'dataset.csv not found: {DATASET_PATH}')\n\n" +
      "print('notebook runtime root:', RUN_ROOT)\n" +
      "print('notebook dir:', NB)\n" +
      "print('dataset path:', DATASET_PATH)\n\n" +
      "PIPELINE_SRC = base64.b64decode('" + pipelineB64 + "').decode('utf-8')\n" +
      "osp = types.ModuleType('oscillator_surrogate_pipeline')\n" +
      "osp.__file__ = 'oscillator_surrogate_pipeline.py'\n" +
      "sys.modules['oscillator_surrogate_pipeline'] = osp\n" +
      "exec(compile(PIPELINE_SRC, osp.__file__, 'exec'), osp.__dict__)\n" +
      "SESSIONS = json.loads(base64.b64decode('" + sessionsB64 + "').decode('utf-8'))\n" +
      "if not isinstance(SESSIONS, list) or not SESSIONS:\n" +
      "    raise ValueError('SESSIONS payload is empty.')\n" +
      "for s in SESSIONS:\n" +
      "    sid = str(s.get('sessionId', s.get('name', 'session'))).strip()\n" +
      "    rel = str(s.get('modelGraphPath', '')).strip()\n" +
      "    if not rel:\n" +
      "        raise ValueError(f'[{sid}] missing modelGraphPath in session payload.')\n" +
      "    gpath = _resolve_optional_path(NB, rel)\n" +
      "    if gpath is None or not gpath.exists():\n" +
      "        raise FileNotFoundError(f'[{sid}] model graph file not found: {rel}')\n" +
      "    payload = json.loads(gpath.read_text(encoding='utf-8'))\n" +
      "    graph = _extract_drawflow_graph(payload)\n" +
      "    if graph is None:\n" +
      "        raise ValueError(f'[{sid}] invalid drawflow graph payload: {gpath}')\n" +
      "    s['drawflowGraph'] = graph\n" +
      "    s['modelGraphAbsPath'] = str(gpath)\n" +
      "print('sessions:', len(SESSIONS))\n" +
      "def _is_image_schema(schema_id):\n" +
      "    sid = str(schema_id or '').strip().lower()\n" +
      "    return sid in ('mnist', 'fashion_mnist')\n"
    ));

    cells.push(makeMarkdownCell("## 2) Session Overview"));
    cells.push(makeCodeCell(
      "import pandas as pd\n\n" +
      "rows = []\n" +
      "for s in SESSIONS:\n" +
      "    cfg = dict(s.get('trainCfg', {}))\n" +
      "    rows.append({\n" +
      "        'session_id': s.get('sessionId', ''),\n" +
      "        'model_name': s.get('modelName', ''),\n" +
      "        'runtime': s.get('runtime', ''),\n" +
      "        'dataset_schema': s.get('datasetSchemaId', s.get('schemaId', '')),\n" +
      "        'dataset_name': s.get('datasetName', ''),\n" +
      "        'epochs': int(cfg.get('epochs', 40)),\n" +
      "        'batch_size': int(cfg.get('batchSize', 256)),\n" +
      "        'learning_rate': float(cfg.get('learningRate', 1e-3)),\n" +
      "    })\n" +
      "display(pd.DataFrame(rows))\n"
    ));

    cells.push(makeMarkdownCell("## 3) Model Graphs"));
    cells.push(makeCodeCell(
      "import pandas as pd\n" +
      "import matplotlib.pyplot as plt\n" +
      "from matplotlib.patches import FancyBboxPatch, FancyArrowPatch\n" +
      "import numpy as np\n\n" +
      "def _safe_int(v, default=0):\n" +
      "    try:\n" +
      "        return int(float(v))\n" +
      "    except Exception:\n" +
      "        return int(default)\n\n" +
      "def _extract_graph(graph):\n" +
      "    g = graph if isinstance(graph, dict) else {}\n" +
      "    data = ((g.get('drawflow', {}) or {}).get('Home', {}) or {}).get('data', {})\n" +
      "    if not isinstance(data, dict):\n" +
      "        data = {}\n" +
      "    ids = sorted([str(k) for k in data.keys()], key=lambda x: int(x) if str(x).isdigit() else x)\n" +
      "    nodes = {}\n" +
      "    children = {k: [] for k in ids}\n" +
      "    parents = {k: [] for k in ids}\n" +
      "    edges = []\n" +
      "    for nid in ids:\n" +
      "        n = data.get(nid, {}) if isinstance(data.get(nid, {}), dict) else {}\n" +
      "        x = float(n.get('pos_x', 0.0) or 0.0)\n" +
      "        y = float(n.get('pos_y', 0.0) or 0.0)\n" +
      "        name = str(n.get('name', 'node'))\n" +
      "        nodes[nid] = {'x': x, 'y': y, 'name': name, 'data': n.get('data', {}) if isinstance(n.get('data', {}), dict) else {}}\n" +
      "        outs = n.get('outputs', {}) or {}\n" +
      "        for ok, ov in outs.items():\n" +
      "            for c in ((ov or {}).get('connections', []) or []):\n" +
      "                to_id = str((c or {}).get('node', '')).strip()\n" +
      "                if not to_id or to_id not in children:\n" +
      "                    continue\n" +
      "                children[nid].append(to_id)\n" +
      "                parents[to_id].append(nid)\n" +
      "                edges.append((nid, to_id, str(ok), str((c or {}).get('input', ''))))\n" +
      "    return ids, nodes, edges, children, parents\n\n" +
      "def _topo_order(ids, children, parents):\n" +
      "    indeg = {k: len(parents.get(k, [])) for k in ids}\n" +
      "    q = [k for k in ids if indeg.get(k, 0) <= 0]\n" +
      "    q = sorted(q, key=lambda x: int(x) if str(x).isdigit() else x)\n" +
      "    out = []\n" +
      "    while q:\n" +
      "        cur = q.pop(0)\n" +
      "        out.append(cur)\n" +
      "        for nx in children.get(cur, []):\n" +
      "            indeg[nx] = int(indeg.get(nx, 0)) - 1\n" +
      "            if indeg[nx] == 0:\n" +
      "                q.append(nx)\n" +
      "                q.sort(key=lambda x: int(x) if str(x).isdigit() else x)\n" +
      "    if len(out) != len(ids):\n" +
      "        return ids\n" +
      "    return out\n\n" +
      "def _feature_dim(name, data):\n" +
      "    if name in ('time_sec_block', 'time_norm_block', 'sin_norm_block', 'cos_norm_block', 'ratio_km_block', 'ratio_cm_block', 'ratio_gl_block'):\n" +
      "        return 1\n" +
      "    if name == 'scenario_block':\n" +
      "        return 3\n" +
      "    if name == 'noise_schedule_block':\n" +
      "        return 3\n" +
      "    if name == 'params_block':\n" +
      "        pm = data.get('paramMask', {}) if isinstance(data.get('paramMask', {}), dict) else {}\n" +
      "        keys = ['m','c','k','e','x0','v0','gm','gk','gc','rkm','rcm','rgl']\n" +
      "        n = sum(1 for k in keys if bool(pm.get(k, False)))\n" +
      "        return int(max(1, n))\n" +
      "    if name in ('hist_block', 'window_hist_block'):\n" +
      "        fk = str(data.get('featureKey', 'x')).strip().lower()\n" +
      "        if fk == 'pixel':\n" +
      "            return 784\n" +
      "        return 1\n" +
      "    if name in ('hist_x_block', 'hist_v_block', 'x_block', 'v_block'):\n" +
      "        return 1\n" +
      "    if name in ('window_hist_x_block', 'window_hist_v_block', 'sliding_window_block'):\n" +
      "        w = max(1, _safe_int(data.get('windowSize', 20), 20))\n" +
      "        return int(w)\n" +
      "    return None\n\n" +
      "def _output_units_from_target(data):\n" +
      "    target = str(data.get('targetType', data.get('target', 'x'))).strip().lower()\n" +
      "    u = _safe_int(data.get('units', data.get('unitsHint', 0)), 0)\n" +
      "    if u > 0:\n" +
      "        return u\n" +
      "    if target == 'label':\n" +
      "        return 10\n" +
      "    if target == 'xv':\n" +
      "        return 2\n" +
      "    return 1\n\n" +
      "def _infer_node_dims(ids, nodes, children, parents):\n" +
      "    topo = _topo_order(ids, children, parents)\n" +
      "    dims = {}\n" +
      "    for nid in topo:\n" +
      "        n = nodes.get(nid, {})\n" +
      "        name = str(n.get('name', ''))\n" +
      "        data = n.get('data', {}) if isinstance(n.get('data', {}), dict) else {}\n" +
      "        pids = parents.get(nid, [])\n" +
      "        pin = [int(dims[p]) for p in pids if p in dims and dims[p] is not None]\n" +
      "        in_dim = sum(pin) if pin else None\n" +
      "        fd = _feature_dim(name, data)\n" +
      "        if fd is not None:\n" +
      "            dims[nid] = int(fd)\n" +
      "        elif name == 'concat_block':\n" +
      "            dims[nid] = int(in_dim) if in_dim is not None else None\n" +
      "        elif name == 'input_layer':\n" +
      "            dims[nid] = int(in_dim) if in_dim is not None else None\n" +
      "        elif name == 'dense_layer':\n" +
      "            dims[nid] = max(1, _safe_int(data.get('units', 32), 32))\n" +
      "        elif name in ('rnn_layer', 'gru_layer', 'lstm_layer'):\n" +
      "            dims[nid] = max(1, _safe_int(data.get('units', 64), 64))\n" +
      "        elif name == 'conv1d_layer':\n" +
      "            dims[nid] = max(1, _safe_int(data.get('filters', 64), 64))\n" +
      "        elif name == 'temporal_dense_layer':\n" +
      "            dims[nid] = max(1, _safe_int(data.get('units', 32), 32))\n" +
      "        elif name in ('dropout_layer', 'seq_pool_layer', 'resample_layer', 'repeat_layer'):\n" +
      "            dims[nid] = int(in_dim) if in_dim is not None else None\n" +
      "        elif name == 'output_layer':\n" +
      "            dims[nid] = int(_output_units_from_target(data))\n" +
      "        else:\n" +
      "            dims[nid] = int(in_dim) if in_dim is not None else None\n" +
      "    return dims, topo\n\n" +
      "def _node_detail(name, data, dim):\n" +
      "    if name == 'hist_block':\n" +
      "        fk = str(data.get('featureKey', 'x')).strip().lower()\n" +
      "        if fk == 'pixel':\n" +
      "            return 'hist_block=pixel -> 784 (flatten image)'\n" +
      "        return f'hist_block={fk} (series feature)'\n" +
      "    if name == 'window_hist_block':\n" +
      "        return f\"window_hist {data.get('featureKey','x')} w={_safe_int(data.get('windowSize',20),20)}\"\n" +
      "    if name == 'params_block':\n" +
      "        return f'params ({dim}d)'\n" +
      "    if name == 'input_layer':\n" +
      "        return f\"input dim={dim if dim is not None else '?'}\"\n" +
      "    if name == 'dense_layer':\n" +
      "        return f\"Dense({_safe_int(data.get('units',32),32)})\"\n" +
      "    if name == 'dropout_layer':\n" +
      "        return f\"Dropout({float(data.get('rate',0.1) or 0.1):.2f})\"\n" +
      "    if name in ('rnn_layer','gru_layer','lstm_layer'):\n" +
      "        return f\"{name}({_safe_int(data.get('units',64),64)})\"\n" +
      "    if name == 'conv1d_layer':\n" +
      "        return f\"Conv1D f={_safe_int(data.get('filters',64),64)} k={_safe_int(data.get('kernelSize',3),3)}\"\n" +
      "    if name == 'output_layer':\n" +
      "        target = str(data.get('targetType', data.get('target', 'x')))\n" +
      "        return f\"Output {target}({dim if dim is not None else '?'})\"\n" +
      "    return f\"{name} ({dim if dim is not None else '?'})\"\n\n" +
      "def _node_brief(name, data, dim):\n" +
      "    if name == 'dense_layer':\n" +
      "        return f\"Dense({dim if dim is not None else _safe_int(data.get('units',32),32)})\"\n" +
      "    if name == 'dropout_layer':\n" +
      "        return f\"Drop({float(data.get('rate',0.1) or 0.1):.2f})\"\n" +
      "    if name == 'input_layer':\n" +
      "        return f\"Input({dim if dim is not None else '?'})\"\n" +
      "    if name == 'output_layer':\n" +
      "        tgt = str(data.get('targetType', data.get('target', 'x')))\n" +
      "        return f\"Out {tgt}({dim if dim is not None else '?'})\"\n" +
      "    if name == 'hist_block':\n" +
      "        fk = str(data.get('featureKey', 'x')).strip().lower()\n" +
      "        if fk == 'pixel':\n" +
      "            return 'Hist(pixel=784)'\n" +
      "        return f'Hist({fk})'\n" +
      "    return name\n\n" +
      "def _session_model_summary(session):\n" +
      "    sid = str(session.get('sessionId', 'session'))\n" +
      "    mname = str(session.get('modelName', 'model'))\n" +
      "    ids, nodes, edges, children, parents = _extract_graph(session.get('drawflowGraph', {}))\n" +
      "    if not ids:\n" +
      "        return None, ids, nodes, edges, {}\n" +
      "    dims, topo = _infer_node_dims(ids, nodes, children, parents)\n" +
      "    hidden_units = []\n" +
      "    input_dim_total = 0\n" +
      "    output_units = []\n" +
      "    hist_note = ''\n" +
      "    for nid in topo:\n" +
      "        n = nodes[nid]\n" +
      "        name = str(n.get('name', ''))\n" +
      "        d = n.get('data', {}) if isinstance(n.get('data', {}), dict) else {}\n" +
      "        out_dim = dims.get(nid, None)\n" +
      "        if name == 'input_layer':\n" +
      "            if out_dim is not None:\n" +
      "                input_dim_total = int(max(input_dim_total, int(out_dim)))\n" +
      "        elif name == 'output_layer':\n" +
      "            if out_dim is not None:\n" +
      "                output_units.append(int(out_dim))\n" +
      "        elif name == 'hist_block':\n" +
      "            fk = str(d.get('featureKey', 'x')).strip().lower()\n" +
      "            if fk == 'pixel':\n" +
      "                hist_note = 'hist_block=pixel means flatten image to 784 input features'\n" +
      "            else:\n" +
      "                hist_note = f'hist_block={fk} means use {fk}(t) feature history'\n" +
      "        elif name in ('dense_layer','rnn_layer','gru_layer','lstm_layer','conv1d_layer','temporal_dense_layer'):\n" +
      "            if out_dim is not None:\n" +
      "                hidden_units.append(int(out_dim))\n" +
      "    arch = f\"{input_dim_total if input_dim_total > 0 else '?'} -> {hidden_units if hidden_units else '[]'} -> {output_units if output_units else '[]'}\"\n" +
      "    summary = {\n" +
      "        'session_id': sid,\n" +
      "        'model_name': mname,\n" +
      "        'input_dim': int(input_dim_total) if input_dim_total > 0 else None,\n" +
      "        'hidden_units': hidden_units,\n" +
      "        'output_units': output_units,\n" +
      "        'architecture': arch,\n" +
      "        'hist_block_note': hist_note,\n" +
      "    }\n" +
      "    return summary, ids, nodes, edges, dims\n\n" +
      "def _draw_graph(session, ids, nodes, edges, dims):\n" +
      "    sid = str(session.get('sessionId', 'session'))\n" +
      "    mname = str(session.get('modelName', 'model'))\n" +
      "    if not ids:\n" +
      "        print(f'[{sid}] no drawflowGraph found')\n" +
      "        return\n" +
      "    xs = np.asarray([nodes[k]['x'] for k in ids], dtype=np.float64)\n" +
      "    ys = np.asarray([nodes[k]['y'] for k in ids], dtype=np.float64)\n" +
      "    x0, x1 = float(xs.min()), float(xs.max())\n" +
      "    y0, y1 = float(ys.min()), float(ys.max())\n" +
      "    sx = (x1 - x0) if (x1 - x0) > 1e-9 else 1.0\n" +
      "    sy = (y1 - y0) if (y1 - y0) > 1e-9 else 1.0\n" +
      "    pos = {}\n" +
      "    for k in ids:\n" +
      "        nx = 0.06 + 0.88 * ((nodes[k]['x'] - x0) / sx)\n" +
      "        ny = 0.08 + 0.84 * ((nodes[k]['y'] - y0) / sy)\n" +
      "        pos[k] = (nx, 1.0 - ny)\n" +
      "    fig_w = max(10.0, min(18.0, 8.0 + 0.35 * len(ids)))\n" +
      "    fig_h = max(5.0, min(12.0, 4.5 + 0.22 * len(ids)))\n" +
      "    fig, ax = plt.subplots(figsize=(fig_w, fig_h))\n" +
      "    ax.set_title(f'Model Graph: {mname} | session={sid}')\n" +
      "    for fr, to, _outk, _ink in edges:\n" +
      "        if fr not in pos or to not in pos:\n" +
      "            continue\n" +
      "        xA, yA = pos[fr]\n" +
      "        xB, yB = pos[to]\n" +
      "        arr = FancyArrowPatch((xA + 0.03, yA), (xB - 0.03, yB), arrowstyle='-|>', mutation_scale=12, lw=1.0, color='#64748b', alpha=0.9)\n" +
      "        ax.add_patch(arr)\n" +
      "    bw, bh = 0.13, 0.082\n" +
      "    for k in ids:\n" +
      "        x, y = pos[k]\n" +
      "        name = str(nodes[k]['name'])\n" +
      "        data = nodes[k].get('data', {}) if isinstance(nodes[k].get('data', {}), dict) else {}\n" +
      "        brief = _node_brief(name, data, dims.get(k, None))\n" +
      "        fill = '#e2e8f0'\n" +
      "        if name == 'input_layer':\n" +
      "            fill = '#bfdbfe'\n" +
      "        elif name == 'output_layer':\n" +
      "            fill = '#fecaca'\n" +
      "        elif 'dense' in name:\n" +
      "            fill = '#bbf7d0'\n" +
      "        box = FancyBboxPatch((x - bw / 2, y - bh / 2), bw, bh, boxstyle='round,pad=0.01,rounding_size=0.01', linewidth=1.0, edgecolor='#334155', facecolor=fill, alpha=0.96)\n" +
      "        ax.add_patch(box)\n" +
      "        txt = f\"{brief}\\n#{k}\"\n" +
      "        ax.text(x, y, txt, ha='center', va='center', fontsize=7.2, color='#0f172a')\n" +
      "    ax.set_xlim(0.0, 1.0)\n" +
      "    ax.set_ylim(0.0, 1.0)\n" +
      "    ax.axis('off')\n" +
      "    plt.tight_layout()\n" +
      "    plt.show()\n\n" +
      "all_rows = []\n" +
      "for sess in SESSIONS:\n" +
      "    summary, ids, nodes, edges, dims = _session_model_summary(sess)\n" +
      "    if summary is not None:\n" +
      "        all_rows.append(summary)\n" +
      "    _draw_graph(sess, ids, nodes, edges, dims)\n" +
      "if all_rows:\n" +
      "    print('Model summary (input/hidden/output):')\n" +
      "    display(pd.DataFrame(all_rows)[['session_id','model_name','architecture','input_dim','hidden_units','output_units','hist_block_note']])\n"
    ));

    cells.push(makeMarkdownCell("## 4) Dataset Samples"));
    cells.push(makeCodeCell(
      "import ast\n" +
      "import numpy as np\n" +
      "import pandas as pd\n" +
      "import matplotlib.pyplot as plt\n\n" +
      "def _parse_pixels(raw):\n" +
      "    if raw is None:\n" +
      "        return np.zeros((28, 28), dtype=np.float32)\n" +
      "    s = str(raw)\n" +
      "    vals = []\n" +
      "    try:\n" +
      "        if '[' in s and ']' in s:\n" +
      "            parsed = ast.literal_eval(s)\n" +
      "            vals = [float(x) for x in parsed]\n" +
      "        else:\n" +
      "            vals = [float(x) for x in s.split('|') if str(x).strip()]\n" +
      "    except Exception:\n" +
      "        vals = []\n" +
      "    if len(vals) < 784:\n" +
      "        vals = vals + [0.0] * (784 - len(vals))\n" +
      "    arr = np.asarray(vals[:784], dtype=np.float32).reshape(28, 28)\n" +
      "    return np.clip(arr, 0.0, 1.0)\n\n" +
      "df = pd.read_csv(DATASET_PATH)\n" +
      "active_schema = ''\n" +
      "if SESSIONS:\n" +
      "    active_schema = str(SESSIONS[0].get('datasetSchemaId', SESSIONS[0].get('schemaId', ''))).strip().lower()\n" +
      "split_counts = df['split'].value_counts().to_dict() if 'split' in df.columns else {}\n" +
      "display(pd.DataFrame([{'split_counts': split_counts, 'rows': int(len(df))}]))\n\n" +
      "if _is_image_schema(active_schema) and 'pixel_values' in df.columns and 'label' in df.columns:\n" +
      "    labels = sorted([int(x) for x in pd.Series(df['label']).dropna().unique().tolist() if str(x).strip() != ''])\n" +
      "    labels = labels[:10]\n" +
      "    for split in ['train', 'val', 'test']:\n" +
      "        sub = df[df['split'] == split]\n" +
      "        if len(sub) <= 0:\n" +
      "            continue\n" +
      "        fig, axes = plt.subplots(2, 5, figsize=(12, 5))\n" +
      "        axes = np.asarray(axes).reshape(-1)\n" +
      "        for i, lab in enumerate(labels):\n" +
      "            ax = axes[i]\n" +
      "            rows = sub[sub['label'] == lab]\n" +
      "            if len(rows) <= 0:\n" +
      "                ax.axis('off')\n" +
      "                ax.set_title(f'class {lab} (none)')\n" +
      "                continue\n" +
      "            row = rows.sample(1, random_state=42 + int(lab)).iloc[0]\n" +
      "            img = _parse_pixels(row.get('pixel_values'))\n" +
      "            ax.imshow(img, cmap='gray')\n" +
      "            ax.set_title(f\"{split} | y={int(row.get('label', lab))}\")\n" +
      "            ax.axis('off')\n" +
      "        for j in range(len(labels), 10):\n" +
      "            axes[j].axis('off')\n" +
      "        plt.tight_layout()\n" +
      "        plt.show()\n" +
      "else:\n" +
      "    fig, axes = plt.subplots(1, 3, figsize=(12, 3))\n" +
      "    for ax, split in zip(axes, ['train', 'val', 'test']):\n" +
      "        sub = df[df['split'] == split]\n" +
      "        ax.set_title(split)\n" +
      "        if len(sub) <= 0:\n" +
      "            continue\n" +
      "        ids = list(sub['trajectory'].dropna().astype(int).unique())[:3]\n" +
      "        for tid in ids:\n" +
      "            g = sub[sub['trajectory'] == tid].sort_values('step' if 'step' in sub.columns else 't')\n" +
      "            ax.plot(g.get('t', np.arange(len(g))), g.get('x', np.zeros(len(g))), lw=1.2, alpha=0.9)\n" +
      "        ax.set_xlabel('t')\n" +
      "        ax.set_ylabel('x')\n" +
      "    plt.tight_layout()\n" +
      "    plt.show()\n"
    ));

    cells.push(makeMarkdownCell("## 5) Key Training Params and Paths"));
    cells.push(makeCodeCell(
      "import pandas as pd\n\n" +
      "# Set override values or keep None to use each session default.\n" +
      "EPOCHS = None\n" +
      "BATCH_SIZE = None\n" +
      "LEARNING_RATE = None\n\n" +
      "TUNE = {\n" +
      "    'epochs': EPOCHS,\n" +
      "    'batch_size': BATCH_SIZE,\n" +
      "    'learning_rate': LEARNING_RATE,\n" +
      "}\n\n" +
      "for s in SESSIONS:\n" +
      "    cfg = dict(s.get('trainCfg', {}))\n" +
      "    if TUNE['epochs'] is not None:\n" +
      "        cfg['epochs'] = int(TUNE['epochs'])\n" +
      "    if TUNE['batch_size'] is not None:\n" +
      "        cfg['batchSize'] = int(TUNE['batch_size'])\n" +
      "    if TUNE['learning_rate'] is not None:\n" +
      "        cfg['learningRate'] = float(TUNE['learning_rate'])\n" +
      "    s['trainCfg'] = cfg\n\n" +
      "model_graph_paths = '; '.join([str(s.get('modelGraphPath', '')) for s in SESSIONS])\n" +
      "display(pd.DataFrame([\n" +
      "    {'key': 'RUN_ROOT', 'value': str(RUN_ROOT)},\n" +
      "    {'key': 'NB', 'value': str(NB)},\n" +
      "    {'key': 'DATASET_PATH', 'value': str(DATASET_PATH)},\n" +
      "    {'key': 'MODEL_GRAPH_PATHS', 'value': model_graph_paths},\n" +
      "]))\n"
    ));

    cells.push(makeMarkdownCell("## 6) Train"));
    cells.push(makeCodeCell(
      "SESSION_RUNS = {}\n" +
      "rows = []\n" +
      "for s in SESSIONS:\n" +
      "    sid = str(s.get('sessionId', 'session'))\n" +
      "    cfg = dict(s.get('trainCfg', {}))\n" +
      "    seed = int(s.get('seed', 42))\n" +
      "    device_raw = str(s.get('device', 'auto')).strip().lower()\n" +
      "    device = None if device_raw in ('', 'auto') else device_raw\n" +
      "    print(f'=== train: {sid} | model={s.get(\"modelName\", \"\")} ===')\n\n" +
      "    bundle = osp.build_model_and_data(\n" +
      "        graph_json_path=s.get('drawflowGraph', {}),\n" +
      "        dataset_csv_path=DATASET_PATH,\n" +
      "        seed=seed,\n" +
      "        split_mode='from_csv',\n" +
      "        train_frac=0.70,\n" +
      "        val_frac=0.15,\n" +
      "        test_frac=0.15,\n" +
      "    )\n" +
      "    result = osp.train_model(\n" +
      "        bundle,\n" +
      "        epochs=int(cfg.get('epochs', 40)),\n" +
      "        batch_size=int(cfg.get('batchSize', 256)),\n" +
      "        lr=float(cfg.get('learningRate', 1e-3)),\n" +
      "        seed=seed,\n" +
      "        device=device,\n" +
      "        use_lr_scheduler=bool(cfg.get('useLrScheduler', True)),\n" +
      "        scheduler_patience=int(cfg.get('lrPatience', 3)),\n" +
      "        scheduler_factor=float(cfg.get('lrFactor', 0.5)),\n" +
      "        scheduler_min_lr=float(cfg.get('minLr', 1e-6)),\n" +
      "        select_best_on_val=bool(cfg.get('restoreBestWeights', True)),\n" +
      "        early_stopping_patience=int(cfg.get('earlyStoppingPatience', 0)) if int(cfg.get('earlyStoppingPatience', 0)) > 0 else None,\n" +
      "        log_every=1,\n" +
      "    )\n\n" +
      "    SESSION_RUNS[sid] = {'session': s, 'bundle': bundle, 'result': result}\n" +
      "    tm = dict(result.get('test', {}))\n" +
      "    rows.append({\n" +
      "        'session_id': sid,\n" +
      "        'model_name': s.get('modelName', ''),\n" +
      "        'runtime': s.get('runtime', ''),\n" +
      "        'dataset_schema': s.get('datasetSchemaId', s.get('schemaId', '')),\n" +
      "        'test_mae': float(tm.get('mae', float('nan'))),\n" +
      "        'test_rmse': float(tm.get('rmse', float('nan'))),\n" +
      "        'test_bias': float(tm.get('bias', float('nan'))),\n" +
      "        'test_accuracy': float(tm.get('accuracy', float('nan'))),\n" +
      "        'best_epoch': result.get('best_epoch', None),\n" +
      "        'best_val_loss': result.get('best_val_loss', None),\n" +
      "    })\n\n" +
      "import pandas as pd\n" +
      "TRAIN_SUMMARY_DF = pd.DataFrame(rows)\n" +
      "display(TRAIN_SUMMARY_DF)\n"
    ));

    cells.push(makeMarkdownCell("## 7) Epoch Report and Loss Curves"));
    cells.push(makeCodeCell(
      "import numpy as np\n" +
      "import pandas as pd\n" +
      "import matplotlib.pyplot as plt\n\n" +
      "LOSS_PLOTS = {}\n" +
      "HISTORY_DF = {}\n" +
      "for sid, pack in SESSION_RUNS.items():\n" +
      "    result = pack['result']\n" +
      "    h = dict(result.get('history', {}))\n" +
      "    tr = np.asarray(h.get('train_loss', []), dtype=np.float64)\n" +
      "    va = np.asarray(h.get('val_loss', []), dtype=np.float64)\n" +
      "    lr = np.asarray(h.get('lr', []), dtype=np.float64)\n" +
      "    m = int(max(tr.size, va.size, lr.size))\n" +
      "    if m <= 0:\n" +
      "        continue\n" +
      "    hist_df = pd.DataFrame({'epoch': np.arange(1, m + 1, dtype=np.int64)})\n" +
      "    hist_df['train_loss'] = np.pad(tr, (0, max(0, m - tr.size)), constant_values=np.nan)[:m]\n" +
      "    hist_df['val_loss'] = np.pad(va, (0, max(0, m - va.size)), constant_values=np.nan)[:m]\n" +
      "    hist_df['lr'] = np.pad(lr, (0, max(0, m - lr.size)), constant_values=np.nan)[:m]\n" +
      "    HISTORY_DF[sid] = hist_df\n" +
      "    print(f'=== epoch report: {sid} ===')\n" +
      "    display(hist_df)\n" +
      "    fig, ax1 = plt.subplots(figsize=(6, 3.2))\n" +
      "    ax1.plot(hist_df['epoch'], hist_df['train_loss'], label='train_loss', color='#2563eb')\n" +
      "    ax1.plot(hist_df['epoch'], hist_df['val_loss'], label='val_loss', color='#ef4444')\n" +
      "    ax1.set_xlabel('epoch')\n" +
      "    ax1.set_ylabel('loss')\n" +
      "    ax1.grid(alpha=0.25)\n" +
      "    ax2 = ax1.twinx()\n" +
      "    ax2.plot(hist_df['epoch'], hist_df['lr'], label='lr', color='#16a34a', alpha=0.8)\n" +
      "    ax2.set_ylabel('lr')\n" +
      "    lines1, labels1 = ax1.get_legend_handles_labels()\n" +
      "    lines2, labels2 = ax2.get_legend_handles_labels()\n" +
      "    ax1.legend(lines1 + lines2, labels1 + labels2, loc='best')\n" +
      "    plt.tight_layout()\n" +
      "    plt.show()\n\n" +
      "display(pd.DataFrame([{'session_id': sid, 'history_rows': len(HISTORY_DF.get(sid, []))} for sid in SESSION_RUNS.keys()]))\n"
    ));

    cells.push(makeMarkdownCell("## 8) Validation Plots"));
    cells.push(makeCodeCell(
      "import numpy as np\n" +
      "import pandas as pd\n" +
      "import matplotlib.pyplot as plt\n\n" +
      "def _pred_labels_from_output(pred):\n" +
      "    yp = np.asarray(pred)\n" +
      "    if yp.ndim == 1:\n" +
      "        yp = yp.reshape(-1, 1)\n" +
      "    if yp.size == 0:\n" +
      "        return np.asarray([], dtype=np.int64)\n" +
      "    if yp.shape[1] >= 10:\n" +
      "        return np.argmax(yp[:, :10], axis=1).astype(np.int64)\n" +
      "    return np.clip(np.rint(yp[:, 0]), 0, 9).astype(np.int64)\n\n" +
      "df = pd.read_csv(DATASET_PATH)\n" +
      "for sid, pack in SESSION_RUNS.items():\n" +
      "    s = pack['session']\n" +
      "    result = pack['result']\n" +
      "    schema = str(s.get('datasetSchemaId', s.get('schemaId', ''))).strip().lower()\n" +
      "    print(f'=== validation plot: {sid} | schema={schema} ===')\n" +
      "    if _is_image_schema(schema) and 'pixel_values' in df.columns and 'label' in df.columns:\n" +
      "        val_df = df[df['split'] == 'val'].reset_index(drop=True)\n" +
      "        if len(val_df) <= 0:\n" +
      "            print('no val rows')\n" +
      "            continue\n" +
      "        pred_labels = _pred_labels_from_output(result.get('y_pred_val', []))\n" +
      "        n = min(8, len(val_df))\n" +
      "        fig, axes = plt.subplots(2, 4, figsize=(12, 6))\n" +
      "        axes = np.asarray(axes).reshape(-1)\n" +
      "        for i in range(n):\n" +
      "            row = val_df.iloc[i]\n" +
      "            img = _parse_pixels(row.get('pixel_values'))\n" +
      "            gt = int(row.get('label', -1)) if str(row.get('label', '')).strip() != '' else -1\n" +
      "            pred = int(pred_labels[i]) if i < len(pred_labels) else -1\n" +
      "            axes[i].imshow(img, cmap='gray')\n" +
      "            axes[i].set_title(f'GT={gt} | Pred={pred}')\n" +
      "            axes[i].axis('off')\n" +
      "        for j in range(n, len(axes)):\n" +
      "            axes[j].axis('off')\n" +
      "        plt.tight_layout()\n" +
      "        plt.show()\n" +
      "        gt_all = np.asarray(pd.to_numeric(val_df.get('label', pd.Series([], dtype=float)), errors='coerce').fillna(-1), dtype=np.int64)\n" +
      "        n_cm = int(min(len(gt_all), len(pred_labels)))\n" +
      "        if n_cm > 0:\n" +
      "            gt = np.clip(gt_all[:n_cm], 0, 9).astype(np.int64)\n" +
      "            pr = np.clip(np.asarray(pred_labels[:n_cm], dtype=np.int64), 0, 9)\n" +
      "            label_set = sorted(list(set(gt.tolist() + pr.tolist())))\n" +
      "            if not label_set:\n" +
      "                label_set = list(range(10))\n" +
      "            lut = {int(v): i for i, v in enumerate(label_set)}\n" +
      "            cm = np.zeros((len(label_set), len(label_set)), dtype=np.int64)\n" +
      "            for a, b in zip(gt, pr):\n" +
      "                cm[lut[int(a)], lut[int(b)]] += 1\n" +
      "            fig, ax = plt.subplots(figsize=(6.6, 5.8))\n" +
      "            im = ax.imshow(cm, cmap='Blues')\n" +
      "            ax.set_title(f'{sid} val confusion matrix')\n" +
      "            ax.set_xlabel('Predicted label')\n" +
      "            ax.set_ylabel('True label')\n" +
      "            ax.set_xticks(np.arange(len(label_set)))\n" +
      "            ax.set_yticks(np.arange(len(label_set)))\n" +
      "            ax.set_xticklabels([str(v) for v in label_set])\n" +
      "            ax.set_yticklabels([str(v) for v in label_set])\n" +
      "            vmax = int(cm.max()) if cm.size else 1\n" +
      "            for rr in range(cm.shape[0]):\n" +
      "                for cc in range(cm.shape[1]):\n" +
      "                    vv = int(cm[rr, cc])\n" +
      "                    if vv <= 0:\n" +
      "                        continue\n" +
      "                    color = 'white' if vv >= max(1, int(vmax * 0.6)) else 'black'\n" +
      "                    ax.text(cc, rr, str(vv), ha='center', va='center', color=color, fontsize=8)\n" +
      "            plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)\n" +
      "            acc = float(np.mean(gt == pr))\n" +
      "            print(f'val accuracy={acc:.4f} | samples={n_cm}')\n" +
      "            plt.tight_layout()\n" +
      "            plt.show()\n" +
      "    else:\n" +
      "        y_true = np.asarray(result.get('y_true_val', []), dtype=np.float64).reshape(-1)\n" +
      "        y_pred = np.asarray(result.get('y_pred_val', []), dtype=np.float64).reshape(-1)\n" +
      "        n = int(min(len(y_true), len(y_pred), 600))\n" +
      "        if n <= 0:\n" +
      "            print('no val predictions')\n" +
      "            continue\n" +
      "        plt.figure(figsize=(9, 3.2))\n" +
      "        xs = np.arange(n)\n" +
      "        plt.plot(xs, y_true[:n], label='groundtruth', lw=1.6, alpha=0.9)\n" +
      "        plt.plot(xs, y_pred[:n], label='predict', lw=1.4, alpha=0.9)\n" +
      "        plt.title(f'{sid} val: groundtruth vs predict')\n" +
      "        plt.xlabel('sample index')\n" +
      "        plt.ylabel('value')\n" +
      "        plt.grid(alpha=0.25)\n" +
      "        plt.legend()\n" +
      "        plt.tight_layout()\n" +
      "        plt.show()\n"
    ));

    cells.push(makeMarkdownCell("## 9) Final Report"));
    cells.push(makeCodeCell(
      "rows = []\n" +
      "for sid, pack in SESSION_RUNS.items():\n" +
      "    s = pack['session']\n" +
      "    result = pack['result']\n" +
      "    tm = dict(result.get('test', {}))\n" +
      "    rows.append({\n" +
      "        'session_id': sid,\n" +
      "        'model_name': s.get('modelName', ''),\n" +
      "        'runtime': s.get('runtime', ''),\n" +
      "        'dataset_schema': s.get('datasetSchemaId', s.get('schemaId', '')),\n" +
      "        'test_mae': float(tm.get('mae', float('nan'))),\n" +
      "        'test_rmse': float(tm.get('rmse', float('nan'))),\n" +
      "        'test_bias': float(tm.get('bias', float('nan'))),\n" +
      "        'test_accuracy': float(tm.get('accuracy', float('nan'))),\n" +
      "        'best_epoch': result.get('best_epoch', None),\n" +
      "        'best_val_loss': result.get('best_val_loss', None),\n" +
      "    })\n" +
      "import pandas as pd\n" +
      "REPORT_DF = pd.DataFrame(rows)\n" +
      "display(REPORT_DF)\n"
    ));

    cells.push(makeMarkdownCell("## 10) Generation\n\nReconstruct test samples and sample from latent space."));
    cells.push(makeCodeCell(
      "# Reconstruction from the best session\n" +
      "best_sid = max(SESSION_RUNS, key=lambda s: -SESSION_RUNS[s]['result'].get('best_val_loss', float('inf')))\n" +
      "best_pack = SESSION_RUNS[best_sid]\n" +
      "best_model = best_pack['model']\n" +
      "best_model.eval()\n\n" +
      "test_split = ctx.dataset_splits.get('test') or ctx.dataset_splits.get('val')\n" +
      "x_t = test_split['x'][:16].to(ctx.device)\n" +
      "with torch.no_grad():\n" +
      "    recon = best_model(x_t).cpu().numpy()\n" +
      "    orig = x_t.cpu().numpy()\n\n" +
      "recon_mse = np.mean((orig - recon) ** 2)\n" +
      "print(f'Reconstruction MSE (16 samples): {recon_mse:.6f}')\n\n" +
      "# Feature profile comparison\n" +
      "fig, axes = plt.subplots(4, 1, figsize=(10, 8))\n" +
      "for i in range(4):\n" +
      "    axes[i].plot(orig[i], label='Original', alpha=0.8)\n" +
      "    axes[i].plot(recon[i], '--', label='Reconstructed', alpha=0.8)\n" +
      "    axes[i].legend(fontsize=8)\n" +
      "plt.suptitle(f'Reconstruction (MSE={recon_mse:.4f})')\n" +
      "plt.tight_layout(); plt.show()\n"
    ));

    return {
      cells: cells,
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3",
        },
        language_info: {
          name: "python",
          version: "3",
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };
  }

  function resolveRuntimeSourceMapFromCfg(cfg) {
    var map = {};
    if (cfg && cfg.runtimeSourceMap && typeof cfg.runtimeSourceMap === "object") {
      var keys = Object.keys(cfg.runtimeSourceMap);
      for (var i = 0; i < keys.length; i += 1) {
        var k = String(keys[i] || "").trim();
        if (!k) continue;
        var v = cfg.runtimeSourceMap[k];
        if (typeof v === "string") map[k] = v;
      }
    }
    if (GLOBAL && GLOBAL.OSCNotebookRuntimeAssets && typeof GLOBAL.OSCNotebookRuntimeAssets === "object") {
      var assets = GLOBAL.OSCNotebookRuntimeAssets;
      var files = assets.files && typeof assets.files === "object" ? assets.files : null;
      if (files) {
        var fkeys = Object.keys(files);
        for (var j = 0; j < fkeys.length; j += 1) {
          var fk = String(fkeys[j] || "").trim();
          if (!fk || Object.prototype.hasOwnProperty.call(map, fk)) continue;
          if (typeof files[fk] === "string") map[fk] = String(files[fk]);
        }
      }
    }
    return map;
  }

  async function loadRuntimeSources(rawCfg) {
    var cfg = rawCfg || {};
    var names = Array.isArray(cfg.runtimeFiles) && cfg.runtimeFiles.length
      ? cfg.runtimeFiles.slice()
      : ["oscillator_surrogate_pipeline.py"];
    var includeRuntimeFiles = cfg.includeRuntimeFiles !== false;
    var loader = (typeof cfg.runtimeLoader === "function") ? cfg.runtimeLoader : null;
    var sourceMap = resolveRuntimeSourceMapFromCfg(cfg);
    var out = {};
    var loaded = 0;
    if (!includeRuntimeFiles) {
      return { files: out, loaded: 0, total: names.length };
    }
    for (var i = 0; i < names.length; i += 1) {
      var name = String(names[i] || "").trim();
      if (!name) continue;
      var text = null;
      if (Object.prototype.hasOwnProperty.call(sourceMap, name) && typeof sourceMap[name] === "string") {
        text = String(sourceMap[name]);
      } else if (loader) {
        text = await loader(name);
      } else if (isNode && FS && PATH) {
        var p = PATH.join(__dirname, "..", "notebooks", name);
        if (FS.existsSync(p)) text = FS.readFileSync(p, "utf8");
      } else if (typeof fetch === "function") {
        try {
          var res = await fetch("./notebooks/" + name, { cache: "no-store" });
          if (res.ok) text = await res.text();
        } catch (_err) {}
      }
      if (text != null) {
        out[name] = String(text);
        loaded += 1;
      }
    }
    if (cfg.requireRuntimeFiles && loaded < names.length) {
      throw new Error("Missing required runtime file(s): loaded " + loaded + "/" + names.length);
    }
    return { files: out, loaded: loaded, total: names.length };
  }

  function pickPipelineSource(runtimeMap) {
    var files = (runtimeMap && runtimeMap.files) || {};
    if (files["oscillator_surrogate_pipeline.py"]) return files["oscillator_surrogate_pipeline.py"];
    var keys = Object.keys(files);
    return keys.length ? files[keys[0]] : "";
  }

  function buildGenericNotebook(opts) {
    CELL_SEQ = 0;
    var sessions = opts.sessions || [];
    var schemaId = opts.schemaId || "generic";
    var datasetCsvPath = opts.datasetCsvPath || "dataset.csv";
    var firstSession = sessions[0] || {};
    var trainCfg = firstSession.trainCfg || {};
    var graphPath = firstSession.modelGraphPath || "model.graph.json";

    var cells = [];

    cells.push(makeMarkdownCell(
      "# Training Notebook (" + schemaId + ")\n\n" +
      "Auto-generated by Surrogate Studio. Reads generic CSV (f0..fN, t0..tN, split) and trains a PyTorch model from the Drawflow graph.\n\n" +
      "## Configuration\n" +
      "- Schema: `" + schemaId + "`\n" +
      "- Epochs: " + (trainCfg.epochs || 20) + "\n" +
      "- Batch size: " + (trainCfg.batchSize || 32) + "\n" +
      "- Learning rate: " + (trainCfg.learningRate || 0.001) + "\n"
    ));

    // Cell 1: Setup
    cells.push(makeCodeCell(
      "# Configuration — edit paths here\n" +
      "DATASET_CSV = '" + datasetCsvPath + "'\n" +
      "MODEL_GRAPH = '" + graphPath + "'\n" +
      "EPOCHS = " + (trainCfg.epochs || 20) + "\n" +
      "BATCH_SIZE = " + (trainCfg.batchSize || 32) + "\n" +
      "LR = " + (trainCfg.learningRate || 0.001) + "\n" +
      "SEED = 42\n"
    ));

    // Cell 2: Imports + data loading
    cells.push(makeCodeCell(
      "import json, torch, torch.nn as nn, numpy as np, pandas as pd\n" +
      "from torch.utils.data import DataLoader, TensorDataset\n" +
      "import matplotlib.pyplot as plt\n\n" +
      "torch.manual_seed(SEED)\n" +
      "np.random.seed(SEED)\n" +
      "device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')\n" +
      "print(f'PyTorch {torch.__version__} on {device}')\n"
    ));

    // Cell 3: Load CSV
    cells.push(makeCodeCell(
      "df = pd.read_csv(DATASET_CSV)\n" +
      "print(f'Dataset: {len(df)} rows, columns: {list(df.columns[:5])}...')\n\n" +
      "# Split by 'split' column\n" +
      "feature_cols = [c for c in df.columns if c.startswith('f')]\n" +
      "target_cols = [c for c in df.columns if c.startswith('t')]\n" +
      "print(f'Features: {len(feature_cols)}, Targets: {len(target_cols)}')\n\n" +
      "train_df = df[df['split'] == 'train']\n" +
      "val_df = df[df['split'] == 'val']\n" +
      "test_df = df[df['split'] == 'test'] if 'test' in df['split'].values else val_df\n\n" +
      "x_train = torch.tensor(train_df[feature_cols].values, dtype=torch.float32)\n" +
      "y_train = torch.tensor(train_df[target_cols].values, dtype=torch.float32)\n" +
      "x_val = torch.tensor(val_df[feature_cols].values, dtype=torch.float32)\n" +
      "y_val = torch.tensor(val_df[target_cols].values, dtype=torch.float32)\n" +
      "x_test = torch.tensor(test_df[feature_cols].values, dtype=torch.float32)\n" +
      "y_test = torch.tensor(test_df[target_cols].values, dtype=torch.float32)\n\n" +
      "print(f'Train: {len(x_train)}, Val: {len(x_val)}, Test: {len(x_test)}')\n" +
      "print(f'Feature dim: {x_train.shape[1]}, Target dim: {y_train.shape[1]}')\n"
    ));

    // Cell 4: Load graph + build model (same builder as server runtime)
    var hasSubprocess = opts.trainSubprocessSource && opts.trainSubprocessSource.length > 100;
    if (hasSubprocess) {
      // embed the build_model_from_graph function from train_subprocess.py
      var b64src = toBase64Utf8(opts.trainSubprocessSource);
      cells.push(makeCodeCell(
        "import base64, types, sys\n\n" +
        "# Load model builder from train_subprocess.py (same code as server runtime)\n" +
        "_subprocess_src = base64.b64decode('" + b64src + "').decode('utf-8')\n" +
        "_mod = types.ModuleType('train_subprocess')\n" +
        "exec(compile(_subprocess_src, 'train_subprocess.py', 'exec'), _mod.__dict__)\n\n" +
        "with open(MODEL_GRAPH) as f:\n" +
        "    graph = json.load(f)\n\n" +
        "model = _mod.build_model_from_graph(graph, x_train.shape[1], y_train.shape[1])\n" +
        "model = model.to(device)\n" +
        "print(f'Model: {sum(p.numel() for p in model.parameters())} params (graph-based builder)')\n"
      ));
    } else {
      // fallback: simple Sequential builder (no branching support)
      cells.push(makeCodeCell(
        "with open(MODEL_GRAPH) as f:\n" +
        "    graph = json.load(f)\n\n" +
        "data = graph.get('drawflow', {}).get('Home', {}).get('data', graph)\n" +
        "nodes = sorted(data.keys(), key=lambda k: int(k) if k.isdigit() else 0)\n" +
        "layers = []\n" +
        "in_dim = x_train.shape[1]\n" +
        "out_dim = y_train.shape[1]\n" +
        "for nid in nodes:\n" +
        "    n = data[nid]; t = str(n.get('name','')).replace('_layer','').replace('_block',''); c = n.get('data',{})\n" +
        "    if t == 'input': continue\n" +
        "    elif t == 'dense':\n" +
        "        u = int(c.get('units',32)); layers.append(nn.Linear(in_dim, u))\n" +
        "        act = str(c.get('activation','relu'))\n" +
        "        if act=='relu': layers.append(nn.ReLU())\n" +
        "        elif act=='tanh': layers.append(nn.Tanh())\n" +
        "        elif act=='sigmoid': layers.append(nn.Sigmoid())\n" +
        "        in_dim = u\n" +
        "    elif t=='dropout': layers.append(nn.Dropout(float(c.get('rate',0.1)))); pass\n" +
        "    elif t in ('latent_mu','latent_logvar','latent'): u=int(c.get('units',8)); layers.append(nn.Linear(in_dim,u)); in_dim=u\n" +
        "    elif t=='reparam': layers.append(nn.Linear(in_dim,in_dim))\n" +
        "    elif t=='output': layers.append(nn.Linear(in_dim, out_dim))\n" +
        "model = nn.Sequential(*layers).to(device)\n" +
        "print(f'Model: {sum(p.numel() for p in model.parameters())} params')\n"
      ));
    }

    // Cell 5: Train (with phase detection for GAN)
    cells.push(makeCodeCell(
      "optimizer = torch.optim.Adam(model.parameters(), lr=LR)\n" +
      "scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=3, factor=0.5)\n\n" +
      "# determine loss + phases from graph output nodes\n" +
      "data = graph.get('drawflow', {}).get('Home', {}).get('data', graph)\n" +
      "out_nodes = [data[k] for k in data if data[k].get('name','').endswith('output_layer')]\n" +
      "loss_name = out_nodes[0].get('data',{}).get('loss','mse') if out_nodes else 'mse'\n" +
      "is_cls = any(n.get('data',{}).get('target','') in ('label','logits') for n in out_nodes)\n" +
      "phases = sorted(set(str(n.get('data',{}).get('phase', '')).strip() for n in out_nodes))\n" +
      "is_phased = any(p != '' for p in phases)\n" +
      "print(f'Phases: {phases} (phased={is_phased})')\n\n" +
      "# per-head loss\n" +
      "head_losses = []\n" +
      "for n in out_nodes:\n" +
      "    nd = n.get('data', {})\n" +
      "    ht = nd.get('target', 'xv')\n" +
      "    hl = nd.get('loss', 'mse').lower()\n" +
      "    hw = float(nd.get('matchWeight', 1))\n" +
      "    hp = str(nd.get('phase', '')).strip()\n" +
      "    if ht in ('label', 'logits'): fn = nn.CrossEntropyLoss()\n" +
      "    elif hl == 'bce': fn = nn.BCELoss()\n" +
      "    elif hl == 'mae': fn = nn.L1Loss()\n" +
      "    else: fn = nn.MSELoss()\n" +
      "    head_losses.append({'fn': fn, 'weight': hw, 'phase': hp, 'cls': ht in ('label','logits')})\n" +
      "    print(f'  Head: target={ht}, loss={hl}, phase={hp}, weight={hw}')\n\n" +
      "if not head_losses:\n" +
      "    loss_fn = nn.CrossEntropyLoss() if is_cls else nn.MSELoss()\n" +
      "    head_losses = [{'fn': loss_fn, 'weight': 1.0, 'phase': '', 'cls': is_cls}]\n\n" +
      "train_dl = DataLoader(TensorDataset(x_train, y_train), batch_size=BATCH_SIZE, shuffle=True)\n" +
      "val_dl = DataLoader(TensorDataset(x_val, y_val), batch_size=BATCH_SIZE)\n\n" +
      "def compute_loss(pred, xb, yb, phase):\n" +
      "    total = torch.tensor(0.0, device=device)\n" +
      "    for hl in head_losses:\n" +
      "        if hl['phase'] != phase and hl['phase'] != '' and phase != '': continue\n" +
      "        t = yb\n" +
      "        if hl['cls']: total = total + hl['weight'] * hl['fn'](pred, t.long().squeeze(-1))\n" +
      "        else: total = total + hl['weight'] * hl['fn'](pred, t)\n" +
      "    return total\n\n" +
      "history = {'train_loss': [], 'val_loss': []}\n" +
      "best_val = float('inf')\n" +
      "best_state = None\n\n" +
      "for ep in range(1, EPOCHS + 1):\n" +
      "    phase_losses = {}\n" +
      "    for phase in phases:\n" +
      "        model.train()\n" +
      "        tl = 0; nb = 0\n" +
      "        for xb, yb in train_dl:\n" +
      "            xb, yb = xb.to(device), yb.to(device)\n" +
      "            optimizer.zero_grad()\n" +
      "            loss = compute_loss(model(xb), xb, yb, phase)\n" +
      "            loss.backward()\n" +
      "            optimizer.step()\n" +
      "            tl += loss.item(); nb += 1\n" +
      "        phase_losses[phase] = tl / max(nb, 1)\n\n" +
      "    tl = sum(phase_losses.values()) / max(len(phase_losses), 1)\n" +
      "    model.eval()\n" +
      "    vl = 0; nv = 0\n" +
      "    with torch.no_grad():\n" +
      "        for xb, yb in val_dl:\n" +
      "            xb, yb = xb.to(device), yb.to(device)\n" +
      "            vl += compute_loss(model(xb), xb, yb, 0).item(); nv += 1\n" +
      "    vl /= max(nv, 1)\n" +
      "    scheduler.step(vl)\n\n" +
      "    improved = vl < best_val\n" +
      "    if improved:\n" +
      "        best_val = vl\n" +
      "        best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}\n\n" +
      "    history['train_loss'].append(tl)\n" +
      "    history['val_loss'].append(vl)\n" +
      "    mark = ' *' if improved else ''\n" +
      "    phases_str = ' '.join(f'p{p}={phase_losses[p]:.4f}' for p in phase_losses) if is_phased else ''\n" +
      "    print(f'Epoch {ep:3d} | train={tl:.6f} | val={vl:.6f} | lr={optimizer.param_groups[0][\"lr\"]:.6f} {phases_str}{mark}')\n\n" +
      "if best_state:\n" +
      "    model.load_state_dict(best_state)\n" +
      "print(f'Best val loss: {best_val:.6f}')\n"
    ));

    // Cell 6: Loss plot
    cells.push(makeCodeCell(
      "plt.figure(figsize=(10, 4))\n" +
      "plt.plot(history['train_loss'], label='Train')\n" +
      "plt.plot(history['val_loss'], label='Val')\n" +
      "plt.xlabel('Epoch'); plt.ylabel('Loss')\n" +
      "plt.title('Training Progress'); plt.legend(); plt.grid(True)\n" +
      "plt.tight_layout(); plt.show()\n"
    ));

    // Cell 7: Evaluate on test set
    cells.push(makeCodeCell(
      "model.eval()\n" +
      "with torch.no_grad():\n" +
      "    pred = model(x_test.to(device)).cpu().numpy()\n" +
      "    truth = y_test.numpy()\n\n" +
      "mae = np.mean(np.abs(pred - truth))\n" +
      "mse = np.mean((pred - truth) ** 2)\n" +
      "ss_res = np.sum((truth - pred) ** 2)\n" +
      "ss_tot = np.sum((truth - truth.mean(axis=0)) ** 2)\n" +
      "r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0\n\n" +
      "print(f'Test MAE:  {mae:.6f}')\n" +
      "print(f'Test MSE:  {mse:.6f}')\n" +
      "print(f'Test R²:   {r2:.6f}')\n\n" +
      "# Classification metrics (if applicable)\n" +
      "if is_cls:\n" +
      "    from sklearn.metrics import confusion_matrix, classification_report\n" +
      "    pred_labels = pred.argmax(axis=1)\n" +
      "    true_labels = truth.argmax(axis=1) if truth.ndim > 1 and truth.shape[1] > 1 else truth.flatten().astype(int)\n" +
      "    accuracy = (pred_labels == true_labels).mean()\n" +
      "    print(f'\\nAccuracy: {accuracy:.4f}')\n" +
      "    print('\\nClassification Report:')\n" +
      "    print(classification_report(true_labels, pred_labels))\n" +
      "    cm = confusion_matrix(true_labels, pred_labels)\n" +
      "    plt.figure(figsize=(6, 5))\n" +
      "    plt.imshow(cm, cmap='Blues')\n" +
      "    plt.colorbar(); plt.xlabel('Predicted'); plt.ylabel('True')\n" +
      "    plt.title(f'Confusion Matrix (Accuracy={accuracy:.2%})')\n" +
      "    plt.tight_layout(); plt.show()\\n\n" +
      "# Pred vs Truth scatter (first target dimension)\n" +
      "plt.figure(figsize=(6, 6))\n" +
      "plt.scatter(truth[:, 0], pred[:, 0], alpha=0.5, s=10)\n" +
      "lims = [min(truth[:, 0].min(), pred[:, 0].min()), max(truth[:, 0].max(), pred[:, 0].max())]\n" +
      "plt.plot(lims, lims, 'r--', alpha=0.5)\n" +
      "plt.xlabel('Truth'); plt.ylabel('Predicted')\n" +
      "plt.title(f'Pred vs Truth (dim 0) R²={r2:.4f}')\n" +
      "plt.grid(True); plt.tight_layout(); plt.show()\n"
    ));

    // Cell 8: Generation — reconstruction + random sampling (for VAE/AE)
    cells.push(makeMarkdownCell(
      "## 8) Generation\n\n" +
      "Reconstruct test samples through the trained model, and sample from latent space if VAE."
    ));
    cells.push(makeCodeCell(
      "# --- Reconstruction ---\n" +
      "model.eval()\n" +
      "n_show = min(16, len(x_test))\n" +
      "with torch.no_grad():\n" +
      "    x_in = x_test[:n_show].to(device)\n" +
      "    x_recon = model(x_in).cpu().numpy()\n" +
      "    x_orig = x_test[:n_show].numpy()\n\n" +
      "# reconstruction MSE\n" +
      "recon_mse = np.mean((x_orig - x_recon) ** 2)\n" +
      "print(f'Reconstruction MSE ({n_show} samples): {recon_mse:.6f}')\n\n" +
      "# --- Visualize ---\n" +
      "dim = x_orig.shape[1]\n" +
      "is_image = dim in (784, 1024, 3072)  # 28x28, 32x32, 32x32x3\n" +
      "img_h = {784: 28, 1024: 32, 3072: 32}.get(dim, int(dim**0.5))\n" +
      "img_w = dim // img_h if img_h > 0 else dim\n\n" +
      "if is_image:\n" +
      "    fig, axes = plt.subplots(2, n_show, figsize=(n_show * 1.5, 3))\n" +
      "    for i in range(n_show):\n" +
      "        axes[0, i].imshow(x_orig[i].reshape(img_h, img_w), cmap='gray', vmin=0, vmax=1)\n" +
      "        axes[0, i].axis('off')\n" +
      "        axes[1, i].imshow(x_recon[i].reshape(img_h, img_w), cmap='gray', vmin=0, vmax=1)\n" +
      "        axes[1, i].axis('off')\n" +
      "    axes[0, 0].set_ylabel('Original', fontsize=10)\n" +
      "    axes[1, 0].set_ylabel('Reconstructed', fontsize=10)\n" +
      "    plt.suptitle(f'Reconstruction (MSE={recon_mse:.4f})', fontsize=12)\n" +
      "    plt.tight_layout(); plt.show()\n" +
      "else:\n" +
      "    # trajectory/feature plot\n" +
      "    fig, axes = plt.subplots(min(4, n_show), 1, figsize=(10, min(4, n_show) * 2))\n" +
      "    if min(4, n_show) == 1: axes = [axes]\n" +
      "    for i in range(min(4, n_show)):\n" +
      "        axes[i].plot(x_orig[i], label='Original', alpha=0.8)\n" +
      "        axes[i].plot(x_recon[i], label='Reconstructed', alpha=0.8, linestyle='--')\n" +
      "        axes[i].legend(fontsize=8); axes[i].set_ylabel(f'Sample {i}')\n" +
      "    plt.suptitle(f'Reconstruction (MSE={recon_mse:.4f})', fontsize=12)\n" +
      "    plt.tight_layout(); plt.show()\n"
    ));

    // Cell 9: Random sampling from latent (VAE)
    cells.push(makeCodeCell(
      "# --- Random Sampling from Latent Space (VAE) ---\n" +
      "# This works if the model has a bottleneck / latent layer.\n" +
      "# For VAE: sample z ~ N(0,1) and pass through decoder.\n" +
      "# For AE/supervised: skip this cell.\n\n" +
      "# Try to find the bottleneck dimension from the model\n" +
      "min_dim = min(p.shape[0] for p in model.parameters() if p.dim() == 2)\n" +
      "latent_dim = min(min_dim, 128)  # heuristic: smallest linear layer = bottleneck\n" +
      "print(f'Estimated latent dim: {latent_dim}')\n\n" +
      "try:\n" +
      "    # extract decoder: layers after the bottleneck\n" +
      "    named = list(model.named_modules())\n" +
      "    decoder_layers = []\n" +
      "    found_bottleneck = False\n" +
      "    for name, mod in named:\n" +
      "        if hasattr(mod, 'out_features') and mod.out_features == latent_dim:\n" +
      "            found_bottleneck = True; continue\n" +
      "        if found_bottleneck and isinstance(mod, (nn.Linear, nn.ReLU, nn.Tanh, nn.Sigmoid)):\n" +
      "            decoder_layers.append(mod)\n\n" +
      "    if decoder_layers:\n" +
      "        decoder = nn.Sequential(*decoder_layers).to(device)\n" +
      "        z = torch.randn(16, latent_dim, device=device)\n" +
      "        with torch.no_grad():\n" +
      "            generated = decoder(z).cpu().numpy()\n\n" +
      "        if is_image:\n" +
      "            fig, axes = plt.subplots(2, 8, figsize=(12, 3))\n" +
      "            for i in range(16):\n" +
      "                axes[i // 8, i % 8].imshow(generated[i].reshape(img_h, img_w), cmap='gray', vmin=0, vmax=1)\n" +
      "                axes[i // 8, i % 8].axis('off')\n" +
      "            plt.suptitle('Random Samples from Latent Space', fontsize=12)\n" +
      "            plt.tight_layout(); plt.show()\n" +
      "        else:\n" +
      "            plt.figure(figsize=(10, 4))\n" +
      "            for i in range(min(8, len(generated))):\n" +
      "                plt.plot(generated[i], alpha=0.7, label=f'Sample {i}')\n" +
      "            plt.title('Random Samples from Latent Space')\n" +
      "            plt.legend(fontsize=8); plt.tight_layout(); plt.show()\n" +
      "    else:\n" +
      "        print('Could not extract decoder — model may not be VAE/AE.')\n" +
      "except Exception as e:\n" +
      "    print(f'Random sampling failed (model may not be VAE): {e}')\n"
    ));

    // Cell 10: Langevin generation (denoising models)
    cells.push(makeMarkdownCell("## 10) Langevin Generation\n\nIterative denoising from random noise using the trained model as a score function."));
    cells.push(makeCodeCell(
      "# --- Langevin Dynamics Generation ---\n" +
      "# Start from random noise, iteratively denoise using model gradient\n" +
      "import torch.autograd as autograd\n\n" +
      "model.eval()\n" +
      "n_samples = 16\n" +
      "n_steps = 50\n" +
      "step_size = 0.01\n" +
      "temperature = 0.5\n\n" +
      "x = torch.randn(n_samples, x_train.shape[1], device=device, requires_grad=True)\n\n" +
      "for step in range(n_steps):\n" +
      "    pred = model(x)\n" +
      "    score = (pred - x).mean()  # score estimate: direction toward data\n" +
      "    grad = autograd.grad(score, x, create_graph=False)[0]\n" +
      "    noise = torch.randn_like(x) * (step_size ** 0.5) * temperature\n" +
      "    x = (x + step_size * grad + noise).detach().requires_grad_(True)\n\n" +
      "samples = x.detach().cpu().numpy()\n" +
      "print(f'Generated {n_samples} samples via Langevin dynamics ({n_steps} steps)')\n\n" +
      "if is_image:\n" +
      "    fig, axes = plt.subplots(2, 8, figsize=(12, 3))\n" +
      "    for i in range(min(16, n_samples)):\n" +
      "        axes[i//8, i%8].imshow(np.clip(samples[i].reshape(img_h, img_w), 0, 1), cmap='gray')\n" +
      "        axes[i//8, i%8].axis('off')\n" +
      "    plt.suptitle('Langevin Samples'); plt.tight_layout(); plt.show()\n" +
      "else:\n" +
      "    plt.figure(figsize=(10, 4))\n" +
      "    for i in range(min(8, n_samples)):\n" +
      "        plt.plot(samples[i], alpha=0.7, label=f'Sample {i}')\n" +
      "    plt.title('Langevin Samples'); plt.legend(fontsize=8); plt.tight_layout(); plt.show()\n"
    ));

    // Cell 11: Latent optimization (optimize z for specific objective)
    cells.push(makeMarkdownCell("## 11) Latent Optimization\n\nOptimize z in latent space to minimize a target objective."));
    cells.push(makeCodeCell(
      "# --- Latent Optimization ---\n" +
      "# Find z that produces output closest to a target\n" +
      "model.eval()\n\n" +
      "try:\n" +
      "    # target: first test sample\n" +
      "    target = x_test[:1].to(device)\n" +
      "    z = torch.randn(1, latent_dim, device=device, requires_grad=True)\n" +
      "    opt_z = torch.optim.Adam([z], lr=0.01)\n\n" +
      "    for step in range(100):\n" +
      "        opt_z.zero_grad()\n" +
      "        recon = decoder(z) if 'decoder' in dir() else model(z)\n" +
      "        loss = nn.MSELoss()(recon, target)\n" +
      "        loss.backward()\n" +
      "        opt_z.step()\n" +
      "        if step % 20 == 0:\n" +
      "            print(f'Step {step}: loss={loss.item():.6f}')\n\n" +
      "    optimized = recon.detach().cpu().numpy()[0]\n" +
      "    original = target.cpu().numpy()[0]\n\n" +
      "    if is_image:\n" +
      "        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(4, 2))\n" +
      "        ax1.imshow(original.reshape(img_h, img_w), cmap='gray'); ax1.set_title('Target'); ax1.axis('off')\n" +
      "        ax2.imshow(optimized.reshape(img_h, img_w), cmap='gray'); ax2.set_title('Optimized'); ax2.axis('off')\n" +
      "        plt.tight_layout(); plt.show()\n" +
      "    else:\n" +
      "        plt.plot(original, label='Target', alpha=0.8)\n" +
      "        plt.plot(optimized, '--', label='Optimized', alpha=0.8)\n" +
      "        plt.legend(); plt.title('Latent Optimization'); plt.show()\n" +
      "except Exception as e:\n" +
      "    print(f'Latent optimization skipped: {e}')\n"
    ));

    // Cell 12: Generation evaluation summary
    // Cell 12: Classifier-guided generation
    cells.push(makeMarkdownCell("## 12) Classifier-Guided Generation\n\nOptimize z so the decoded output is classified as a target class."));
    cells.push(makeCodeCell(
      "# --- Classifier-Guided Generation ---\n" +
      "# Requires a model with both reconstruction and classification outputs.\n" +
      "# If model has only reconstruction, this cell is skipped.\n" +
      "try:\n" +
      "    # check if model has classification output (>1 output or softmax layer)\n" +
      "    model.eval()\n" +
      "    test_out = model(x_test[:1].to(device))\n" +
      "    has_classifier = isinstance(test_out, (tuple, list)) and len(test_out) > 1\n" +
      "    if not has_classifier and test_out.shape[-1] < 20:  # small output = likely classifier\n" +
      "        has_classifier = True\n\n" +
      "    if has_classifier:\n" +
      "        target_class = 0  # change this to target different classes\n" +
      "        n_guided = 8\n" +
      "        z = torch.randn(n_guided, latent_dim, device=device, requires_grad=True)\n" +
      "        opt = torch.optim.Adam([z], lr=0.01)\n\n" +
      "        for step in range(100):\n" +
      "            opt.zero_grad()\n" +
      "            dec = decoder(z) if 'decoder' in dir() else model(z)\n" +
      "            cls_out = model(dec)\n" +
      "            if isinstance(cls_out, (tuple, list)): cls_out = cls_out[-1]  # last output = classifier\n" +
      "            guidance_loss = -torch.log(cls_out[:, target_class] + 1e-8).mean()\n" +
      "            guidance_loss.backward()\n" +
      "            opt.step()\n" +
      "            if step % 25 == 0: print(f'Step {step}: guidance_loss={guidance_loss.item():.4f}')\n\n" +
      "        guided_samples = (decoder(z) if 'decoder' in dir() else model(z)).detach().cpu().numpy()\n" +
      "        if is_image:\n" +
      "            fig, axes = plt.subplots(1, n_guided, figsize=(n_guided*1.5, 2))\n" +
      "            for i in range(n_guided):\n" +
      "                axes[i].imshow(np.clip(guided_samples[i].reshape(img_h, img_w), 0, 1), cmap='gray')\n" +
      "                axes[i].axis('off')\n" +
      "            plt.suptitle(f'Classifier-Guided (class={target_class})'); plt.tight_layout(); plt.show()\n" +
      "        else:\n" +
      "            plt.figure(figsize=(10, 3))\n" +
      "            for i in range(n_guided): plt.plot(guided_samples[i], alpha=0.7)\n" +
      "            plt.title(f'Classifier-Guided (class={target_class})'); plt.tight_layout(); plt.show()\n" +
      "    else:\n" +
      "        print('Model has no classifier head — skipping guided generation.')\n" +
      "except Exception as e:\n" +
      "    print(f'Classifier-guided generation skipped: {e}')\n"
    ));

    // Cell 13: Inverse optimization
    cells.push(makeMarkdownCell("## 13) Inverse Optimization\n\nOptimize input x to match a target output."));
    cells.push(makeCodeCell(
      "# --- Inverse: find input that produces target output ---\n" +
      "model.eval()\n" +
      "try:\n" +
      "    target_output = x_test[:1].to(device)\n" +
      "    x_opt = torch.randn(1, x_train.shape[1], device=device, requires_grad=True)\n" +
      "    opt = torch.optim.Adam([x_opt], lr=0.01)\n\n" +
      "    losses = []\n" +
      "    for step in range(200):\n" +
      "        opt.zero_grad()\n" +
      "        pred = model(x_opt)\n" +
      "        if isinstance(pred, (tuple, list)): pred = pred[0]\n" +
      "        loss = nn.MSELoss()(pred, target_output)\n" +
      "        loss.backward()\n" +
      "        opt.step()\n" +
      "        losses.append(loss.item())\n" +
      "        if step % 50 == 0: print(f'Step {step}: loss={loss.item():.6f}')\n\n" +
      "    plt.figure(figsize=(8, 3))\n" +
      "    plt.subplot(1, 2, 1)\n" +
      "    plt.plot(losses); plt.title('Inverse Optimization Loss'); plt.xlabel('Step')\n" +
      "    plt.subplot(1, 2, 2)\n" +
      "    inv_result = x_opt.detach().cpu().numpy()[0]\n" +
      "    target_np = target_output.cpu().numpy()[0]\n" +
      "    if is_image:\n" +
      "        plt.imshow(inv_result.reshape(img_h, img_w), cmap='gray'); plt.title('Inverse Result')\n" +
      "    else:\n" +
      "        plt.plot(target_np, label='Target'); plt.plot(inv_result, '--', label='Inverse')\n" +
      "        plt.legend(); plt.title('Inverse Optimization')\n" +
      "    plt.tight_layout(); plt.show()\n" +
      "except Exception as e:\n" +
      "    print(f'Inverse optimization skipped: {e}')\n"
    ));

    // Cell 14: DDPM iterative denoising
    cells.push(makeMarkdownCell("## 14) DDPM Iterative Denoising\n\nGenerate samples by iterative denoising from pure noise."));
    cells.push(makeCodeCell(
      "# --- DDPM-style iterative denoising ---\n" +
      "model.eval()\n" +
      "T = 50  # denoising steps\n" +
      "n_ddpm = 16\n\n" +
      "# linear beta schedule\n" +
      "betas = np.linspace(0.0001, 0.02, T)\n" +
      "alphas = 1 - betas\n" +
      "alpha_bar = np.cumprod(alphas)\n\n" +
      "# start from pure noise\n" +
      "x_t = torch.randn(n_ddpm, x_train.shape[1], device=device)\n\n" +
      "with torch.no_grad():\n" +
      "    for t in reversed(range(T)):\n" +
      "        # predict denoised image\n" +
      "        pred = model(x_t)\n" +
      "        if isinstance(pred, (tuple, list)): pred = pred[0]\n" +
      "        # DDPM update: x_{t-1} = (x_t - noise_pred * (1-alpha)/sqrt(1-alpha_bar)) / sqrt(alpha) + sigma*z\n" +
      "        noise_pred = (x_t - pred * alpha_bar[t]**0.5) / max((1 - alpha_bar[t])**0.5, 1e-8)\n" +
      "        x_prev = (x_t - betas[t] / max((1 - alpha_bar[t])**0.5, 1e-8) * noise_pred) / alphas[t]**0.5\n" +
      "        if t > 0:\n" +
      "            sigma = betas[t]**0.5\n" +
      "            x_prev = x_prev + sigma * torch.randn_like(x_prev)\n" +
      "        x_t = x_prev\n\n" +
      "ddpm_samples = x_t.cpu().numpy()\n" +
      "print(f'Generated {n_ddpm} samples via DDPM ({T} steps)')\n\n" +
      "if is_image:\n" +
      "    fig, axes = plt.subplots(2, 8, figsize=(12, 3))\n" +
      "    for i in range(min(16, n_ddpm)):\n" +
      "        axes[i//8, i%8].imshow(np.clip(ddpm_samples[i].reshape(img_h, img_w), 0, 1), cmap='gray')\n" +
      "        axes[i//8, i%8].axis('off')\n" +
      "    plt.suptitle('DDPM Samples'); plt.tight_layout(); plt.show()\n" +
      "else:\n" +
      "    plt.figure(figsize=(10, 4))\n" +
      "    for i in range(min(8, n_ddpm)): plt.plot(ddpm_samples[i], alpha=0.7)\n" +
      "    plt.title('DDPM Samples'); plt.tight_layout(); plt.show()\n"
    ));

    // Cell 15: Final evaluation summary
    cells.push(makeMarkdownCell("## 15) Final Summary"));
    cells.push(makeCodeCell(
      "print('=' * 60)\n" +
      "print('NOTEBOOK RESULTS SUMMARY')\n" +
      "print('=' * 60)\n" +
      "print(f'Model: {sum(p.numel() for p in model.parameters())} parameters')\n" +
      "print(f'Test MAE:  {mae:.6f}')\n" +
      "print(f'Test R²:   {r2:.6f}')\n" +
      "print(f'Reconstruction MSE: {recon_mse:.6f}')\n" +
      "if is_cls:\n" +
      "    print(f'Test Accuracy: {accuracy:.4f}')\n" +
      "print(f'\\nGeneration methods tested:')\n" +
      "print(f'  Reconstruction: ✓')\n" +
      "if 'samples' in dir(): print(f'  Random Sampling: ✓ ({len(samples)} samples)')\n" +
      "if 'ddpm_samples' in dir(): print(f'  DDPM: ✓ ({len(ddpm_samples)} samples)')\n" +
      "if 'guided_samples' in dir(): print(f'  Classifier-Guided: ✓')\n" +
      "print(f'  Langevin: ✓' if 'samples' in dir() else '  Langevin: skipped')\n" +
      "print(f'  Latent Optimization: ✓' if 'optimized' in dir() else '  Latent Optimization: skipped')\n" +
      "print(f'  Inverse: ✓' if 'inv_result' in dir() else '  Inverse: skipped')\n" +
      "print('\\nNotebook complete.')\n"
    ));

    return {
      nbformat: 4,
      nbformat_minor: 2,
      metadata: {
        kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
        language_info: { name: "python", version: "3.10.0" },
      },
      cells: cells,
    };
  }

  async function createNotebookBundleZipFromConfig(rawCfg) {
    var cfg = rawCfg || {};
    var sessionsIn = Array.isArray(cfg.sessions) ? cfg.sessions : [];
    if (!sessionsIn.length) throw new Error("createNotebookBundleZipFromConfig requires at least one session.");
    var seed = Number.isFinite(Number(cfg.seed)) ? Math.floor(Number(cfg.seed)) : 42;
    var includeModelGraph = cfg.includeModelGraph !== false;
    var adapter = cfg.datasetBundleAdapter || getAdapter();
    if (!adapter || typeof adapter.buildNotebookDatasetFiles !== "function") {
      throw new Error("Dataset bundle adapter is required and must expose buildNotebookDatasetFiles().");
    }

    var sessions = sessionsIn.map(function (s, idx) {
      return normalizeSession(s, idx, seed, includeModelGraph);
    });
    var runtime = await loadRuntimeSources(cfg);
    var pipelineSource = pickPipelineSource(runtime);
    if (!pipelineSource) {
      throw new Error("Runtime pipeline source is empty. Provide runtimeLoader or runtimeFiles.");
    }
    var datasetPack = resolveDatasetCsvFromSessions(sessions, adapter);
    var modelGraphEntries = [];
    var sessionPayloads = sessions.map(function (s, idx) {
      var relGraphPath = sessions.length === 1
        ? "model.graph.json"
        : ("models/" + sanitizeFileStem(String(s.sessionId || s.name || ("session_" + (idx + 1)))) + ".graph.json");
      modelGraphEntries.push({
        path: "notebooks/" + relGraphPath,
        content: JSON.stringify(s.drawflowGraph || {}, null, 2),
      });
      var out = jsonClone(s);
      delete out.datasetData;
      delete out.drawflowGraph;
      out.modelGraphPath = relGraphPath;
      return out;
    });
    // Load train_subprocess.py for model builder (shared between server + notebook)
    var trainSubprocessSource = "";
    try {
      var runtimeLoader = typeof cfg.runtimeLoader === "function" ? cfg.runtimeLoader : null;
      if (runtimeLoader) trainSubprocessSource = runtimeLoader("train_subprocess.py") || "";
    } catch (e) { /* not available */ }
    if (!trainSubprocessSource && isNode && FS) {
      try { trainSubprocessSource = FS.readFileSync(PATH.resolve(PATH.dirname(__filename || "."), "..", "server", "train_subprocess.py"), "utf8"); } catch (e) { /* */ }
    }

    // Decide notebook type based on schema
    var schemaId = datasetPack.schemaId || "";
    var isOscillator = schemaId === "oscillator";
    var notebook;

    if (isOscillator) {
      // oscillator: use full pipeline notebook
      notebook = buildNotebookObject({
        packageLabel: "zip package",
        sessions: sessionPayloads,
        pipelineSource: pipelineSource,
        embedDataset: false,
        datasetCsvText: datasetPack.csvText,
      });
    } else {
      notebook = buildGenericNotebook({
        sessions: sessionPayloads,
        schemaId: schemaId,
        datasetCsvPath: "dataset.csv",
        trainSubprocessSource: trainSubprocessSource,
      });
    }

    var notebookText = JSON.stringify(notebook, null, 2);
    var entries = [
      { path: "notebooks/", content: "" },
      { path: "notebooks/dataset.csv", content: datasetPack.csvText },
      { path: "notebooks/run.ipynb", content: notebookText },
    ].concat(modelGraphEntries);
    // include train_subprocess.py for standalone use
    if (trainSubprocessSource) {
      entries.push({ path: "notebooks/train_subprocess.py", content: trainSubprocessSource, contentType: "text/x-python" });
    }
    var zipBytes = makeZipBytes(entries);
    var fileName = String(cfg.zipFileName || ("trainner_" + Date.now() + ".zip"));
    var outPath = cfg.outputZipPath ? String(cfg.outputZipPath) : "";
    var blob = null;
    var buffer = null;

    if (isNode && FS) {
      buffer = Buffer.from(zipBytes);
      if (outPath) {
        FS.mkdirSync(PATH.dirname(outPath), { recursive: true });
        FS.writeFileSync(outPath, buffer);
      }
    } else if (typeof Blob !== "undefined") {
      blob = new Blob([zipBytes], { type: "application/zip" });
    }

    var summary = {
      layout: String(cfg.layout || "per_session"),
      packageMode: String(cfg.packageMode || "zip_two_file_runtime"),
      sessionCount: sessions.length,
      fileCount: 2 + modelGraphEntries.length,
      runtimeCount: runtime.loaded,
      runtimeTotal: runtime.total,
      datasetRows: datasetPack.rowCount,
      datasetSchemaId: datasetPack.schemaId,
      datasetName: datasetPack.datasetName,
    };
    var result = {
      fileName: fileName,
      zipPath: outPath || null,
      summary: summary,
    };
    if (blob) result.blob = blob;
    if (buffer) result.buffer = buffer;
    return result;
  }

  async function createSingleNotebookFileFromConfig(rawCfg) {
    var cfg = rawCfg || {};
    var sessionsIn = Array.isArray(cfg.sessions) ? cfg.sessions : [];
    if (!sessionsIn.length) throw new Error("createSingleNotebookFileFromConfig requires at least one session.");
    var seed = Number.isFinite(Number(cfg.seed)) ? Math.floor(Number(cfg.seed)) : 42;
    var includeModelGraph = cfg.includeModelGraph !== false;
    var adapter = cfg.datasetBundleAdapter || getAdapter();
    if (!adapter || typeof adapter.buildNotebookDatasetFiles !== "function") {
      throw new Error("Dataset bundle adapter is required and must expose buildNotebookDatasetFiles().");
    }

    var sessions = sessionsIn.map(function (s, idx) {
      return normalizeSession(s, idx, seed, includeModelGraph);
    });
    var runtime = await loadRuntimeSources(cfg);
    var pipelineSource = pickPipelineSource(runtime);
    if (!pipelineSource) {
      throw new Error("Runtime pipeline source is empty. Provide runtimeLoader or runtimeFiles.");
    }
    var datasetPack = resolveDatasetCsvFromSessions(sessions, adapter);

    var notebook = buildNotebookObject({
      packageLabel: "single file",
      sessions: sessions.map(function (s) {
        var out = jsonClone(s);
        delete out.datasetData;
        return out;
      }),
      pipelineSource: pipelineSource,
      embedDataset: true,
      datasetCsvText: datasetPack.csvText,
    });
    var notebookText = JSON.stringify(notebook, null, 2);
    var fileName = String(cfg.notebookFileName || ("notebook_" + Date.now() + ".ipynb"));
    var outPath = cfg.outputNotebookPath ? String(cfg.outputNotebookPath) : "";
    var blob = null;
    var buffer = null;

    if (isNode && FS) {
      buffer = Buffer.from(notebookText, "utf8");
      if (outPath) {
        FS.mkdirSync(PATH.dirname(outPath), { recursive: true });
        FS.writeFileSync(outPath, buffer);
      }
    } else if (typeof Blob !== "undefined") {
      blob = new Blob([notebookText], { type: "application/x-ipynb+json" });
    }

    var summary = {
      layout: "single",
      sessionCount: sessions.length,
      fileCount: 1,
      runtimeCount: runtime.loaded,
      runtimeTotal: runtime.total,
      datasetRows: datasetPack.rowCount,
      datasetSchemaId: datasetPack.schemaId,
      datasetName: datasetPack.datasetName,
    };

    var result = {
      fileName: fileName,
      notebookPath: outPath || null,
      summary: summary,
    };
    if (blob) result.blob = blob;
    if (buffer) result.buffer = buffer;
    return result;
  }

  return {
    sanitizeFileStem: sanitizeFileStem,
    normalizeSplitConfig: normalizeSplitConfig,
    buildTrajectorySplitMap: buildTrajectorySplitMap,
    buildDatasetCsvAndManifest: buildDatasetCsvAndManifest,
    generateDefaultDataset: generateDefaultDataset,
    createSingleNotebookFileFromConfig: createSingleNotebookFileFromConfig,
    createNotebookBundleZipFromConfig: createNotebookBundleZipFromConfig,
  };
});

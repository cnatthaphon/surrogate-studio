(( ) => {
  "use strict";

  const CONTRACT_VERSION = "1.0";

  function clone(x) {
    if (typeof structuredClone === "function") {
      return structuredClone(x);
    }
    return JSON.parse(JSON.stringify(x));
  }

  function normalizeMeta(rawMeta) {
    const m = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
    return {
      activeDatasetId: String(m.activeDatasetId || ""),
      activeDatasetModuleId: String(m.activeDatasetModuleId || "oscillator"),
      activeModelId: String(m.activeModelId || ""),
      activeTrainSessionId: String(m.activeTrainSessionId || ""),
      modelSchemaId: String(m.modelSchemaId || "oscillator"),
      serverEndpoint: String(m.serverEndpoint || ""),
    };
  }

  function normalizeDoc(rawDoc) {
    const src = rawDoc && typeof rawDoc === "object" ? rawDoc : {};
    let datasetsById = (src.datasetsById && typeof src.datasetsById === "object") ? src.datasetsById : {};
    let modelsById = (src.modelsById && typeof src.modelsById === "object") ? src.modelsById : {};
    let trainerCardsById = (src.trainerCardsById && typeof src.trainerCardsById === "object") ? src.trainerCardsById : {};
    const tablesByName = (src.tablesByName && typeof src.tablesByName === "object") ? src.tablesByName : {};
    const trainEpochsBySessionId = (src.trainEpochsBySessionId && typeof src.trainEpochsBySessionId === "object")
      ? src.trainEpochsBySessionId
      : {};

    Object.keys(datasetsById).forEach(function (id) {
      const entry = datasetsById[id];
      if (!entry || typeof entry !== "object") {
        delete datasetsById[id];
      }
    });
    Object.keys(modelsById).forEach(function (id) {
      const entry = modelsById[id];
      if (!entry || typeof entry !== "object") {
        delete modelsById[id];
      }
    });
    Object.keys(trainerCardsById).forEach(function (id) {
      const entry = trainerCardsById[id];
      if (!entry || typeof entry !== "object") {
        delete trainerCardsById[id];
      }
    });
    Object.keys(trainEpochsBySessionId).forEach(function (id) {
      if (!Array.isArray(trainEpochsBySessionId[id])) {
        delete trainEpochsBySessionId[id];
      }
    });
    Object.keys(tablesByName).forEach(function (name) {
      const table = tablesByName[name];
      if (!table || typeof table !== "object") {
        delete tablesByName[name];
      }
    });
    if (!tablesByName.datasets || typeof tablesByName.datasets !== "object") {
      tablesByName.datasets = datasetsById;
    } else {
      datasetsById = tablesByName.datasets;
    }
    if (!tablesByName.models || typeof tablesByName.models !== "object") {
      tablesByName.models = modelsById;
    } else {
      modelsById = tablesByName.models;
    }
    if (!tablesByName.trainers || typeof tablesByName.trainers !== "object") {
      tablesByName.trainers = trainerCardsById;
    } else {
      trainerCardsById = tablesByName.trainers;
    }

    return {
      irVersion: String(src.irVersion || CONTRACT_VERSION),
      updatedAt: Number(src.updatedAt) || Date.now(),
      datasetsById: datasetsById,
      modelsById: modelsById,
      trainerCardsById: trainerCardsById,
      tablesByName: tablesByName,
      trainEpochsBySessionId: trainEpochsBySessionId,
      meta: normalizeMeta(src.meta || {}),
    };
  }

  function createCoreStore() {
    let doc = normalizeDoc({});
    let rowSeq = 0;
    const nextRowId = function (tableName) {
      rowSeq += 1;
      return String(tableName || "row") + "_" + Date.now().toString(36) + "_" + rowSeq.toString(36);
    };
    const normalizeTableName = function (tableName) {
      const raw = String(tableName || "").trim().toLowerCase();
      if (!raw) return "";
      if (raw === "dataset" || raw === "datasets") return "datasets";
      if (raw === "model" || raw === "models") return "models";
      if (
        raw === "trainer" ||
        raw === "trainers" ||
        raw === "trainercard" ||
        raw === "trainercards" ||
        raw === "session" ||
        raw === "sessions"
      ) return "trainers";
      return raw;
    };
    const normalizeEntityType = function (entityType) {
      return normalizeTableName(entityType);
    };
    const ensureTableMap = function (tableName) {
      const t = normalizeTableName(tableName);
      if (!t) return null;
      if (!doc.tablesByName || typeof doc.tablesByName !== "object") doc.tablesByName = {};
      if (t === "datasets") {
        if (!doc.datasetsById || typeof doc.datasetsById !== "object") doc.datasetsById = {};
        doc.tablesByName.datasets = doc.datasetsById;
        return doc.datasetsById;
      }
      if (t === "models") {
        if (!doc.modelsById || typeof doc.modelsById !== "object") doc.modelsById = {};
        doc.tablesByName.models = doc.modelsById;
        return doc.modelsById;
      }
      if (t === "trainers") {
        if (!doc.trainerCardsById || typeof doc.trainerCardsById !== "object") doc.trainerCardsById = {};
        doc.tablesByName.trainers = doc.trainerCardsById;
        return doc.trainerCardsById;
      }
      if (!doc.tablesByName[t] || typeof doc.tablesByName[t] !== "object") {
        doc.tablesByName[t] = {};
      }
      return doc.tablesByName[t];
    };
    const getTableMap = function (tableName) {
      return ensureTableMap(tableName);
    };
    const sortByUpdatedThenCreated = function (arr) {
      return arr.sort(function (a, b) {
        const au = Number((a && a.updatedAt) || 0);
        const bu = Number((b && b.updatedAt) || 0);
        if (bu !== au) return bu - au;
        const ac = Number((a && a.createdAt) || 0);
        const bc = Number((b && b.createdAt) || 0);
        return bc - ac;
      });
    };
    const matchWhere = function (row, where) {
      const w = where && typeof where === "object" ? where : null;
      if (!w) return true;
      const keys = Object.keys(w);
      for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        if (!Object.prototype.hasOwnProperty.call(row || {}, k)) return false;
        if (String((row || {})[k]) !== String(w[k])) return false;
      }
      return true;
    };
    const listFromMap = function (map, options) {
      const opts = options && typeof options === "object" ? options : {};
      const schemaFilter = String(opts.schemaId || "").trim().toLowerCase();
      const where = opts.where && typeof opts.where === "object" ? opts.where : null;
      const rows = Object.keys(map || {}).map(function (id) {
        return clone(map[id]);
      }).filter(Boolean).filter(function (entry) {
        if (!schemaFilter) return true;
        return String((entry && entry.schemaId) || "").trim().toLowerCase() === schemaFilter;
      }).filter(function (entry) {
        return matchWhere(entry, where);
      });
      if (String(opts.orderBy || "").trim()) {
        const key = String(opts.orderBy || "").trim();
        const direction = String(opts.direction || "desc").toLowerCase() === "asc" ? 1 : -1;
        rows.sort(function (a, b) {
          const av = a && a[key];
          const bv = b && b[key];
          if (av === bv) return 0;
          if (av == null) return 1;
          if (bv == null) return -1;
          if (av > bv) return direction;
          if (av < bv) return -direction;
          return 0;
        });
      } else {
        sortByUpdatedThenCreated(rows);
      }
      const offset = Math.max(0, Number(opts.offset) || 0);
      const limit = Number(opts.limit);
      if (Number.isFinite(limit) && limit >= 0) {
        return rows.slice(offset, offset + limit);
      }
      if (offset > 0) return rows.slice(offset);
      return rows;
    };
    const saveRows = function (payload) {
      const p = payload && typeof payload === "object" ? payload : {};
      const tableName = normalizeTableName(p.table);
      const table = ensureTableMap(tableName);
      if (!table) return Array.isArray(p.values) ? [] : null;
      const keyField = String(p.keyField || "id").trim() || "id";
      const merge = p.merge !== false;
      const now = Date.now();
      const inputRows = Array.isArray(p.values) ? p.values : [p.values];
      const out = [];
      inputRows.forEach(function (item) {
        if (!item || typeof item !== "object") return;
        const row = clone(item);
        let id = String(row[keyField] || p.id || "").trim();
        if (!id) id = nextRowId(tableName);
        row[keyField] = id;
        const prev = table[id] && typeof table[id] === "object" ? table[id] : null;
        const createdAt = Number((prev && prev.createdAt) || row.createdAt || now) || now;
        const updatedAt = Number(row.updatedAt) || now;
        const next = merge && prev
          ? Object.assign({}, prev, row, { createdAt: createdAt, updatedAt: updatedAt })
          : Object.assign({}, row, { createdAt: createdAt, updatedAt: updatedAt });
        table[id] = next;
        out.push(clone(next));
      });
      doc.updatedAt = Date.now();
      if (tableName === "trainers") {
        out.forEach(function (row) {
          const sid = String((row && row.id) || "").trim();
          if (sid && !Array.isArray(doc.trainEpochsBySessionId[sid])) {
            doc.trainEpochsBySessionId[sid] = [];
          }
        });
      }
      return Array.isArray(p.values) ? out : (out[0] || null);
    };
    const getRow = function (payload) {
      const p = payload && typeof payload === "object" ? payload : {};
      const tableName = normalizeTableName(p.table);
      const table = getTableMap(tableName);
      if (!table) return null;
      const keyField = String(p.keyField || "id").trim() || "id";
      const id = String(p.id || "").trim();
      if (!id) return null;
      if (Object.prototype.hasOwnProperty.call(table, id)) {
        return clone(table[id]);
      }
      const keys = Object.keys(table);
      for (let i = 0; i < keys.length; i += 1) {
        const row = table[keys[i]];
        if (row && typeof row === "object" && String(row[keyField] || "") === id) {
          return clone(row);
        }
      }
      return null;
    };
    const removeRows = function (payload) {
      const p = payload && typeof payload === "object" ? payload : {};
      const tableName = normalizeTableName(p.table);
      const table = getTableMap(tableName);
      if (!table) return 0;
      const ids = Array.isArray(p.ids)
        ? p.ids.map(function (x) { return String(x || "").trim(); }).filter(Boolean)
        : [String(p.id || "").trim()].filter(Boolean);
      let removed = 0;
      if (ids.length) {
        ids.forEach(function (id) {
          if (Object.prototype.hasOwnProperty.call(table, id)) {
            delete table[id];
            removed += 1;
          }
        });
      } else if (p.where && typeof p.where === "object") {
        Object.keys(table).forEach(function (id) {
          const row = table[id];
          if (matchWhere(row, p.where)) {
            delete table[id];
            removed += 1;
          }
        });
      }
      if (removed > 0) {
        doc.updatedAt = Date.now();
      }
      if (tableName === "trainers" && removed > 0) {
        ids.forEach(function (sid) {
          if (!sid) return;
          delete doc.trainEpochsBySessionId[sid];
        });
      }
      return removed;
    };
    const ensureSessionEpochs = function (sessionId) {
      const sid = String(sessionId || "").trim();
      if (!sid) return null;
      if (!Array.isArray(doc.trainEpochsBySessionId[sid])) {
        doc.trainEpochsBySessionId[sid] = [];
      }
      return doc.trainEpochsBySessionId[sid];
    };

    return {
      storageMode: "memory",
      contractVersion: CONTRACT_VERSION,
      snapshot: function () {
        return clone(doc);
      },
      peekRaw: function () {
        return doc;
      },
      replace: function (nextDoc) {
        if (!nextDoc || typeof nextDoc !== "object") return doc;
        doc = normalizeDoc(nextDoc);
        return doc;
      },
      clear: function () {
        doc = normalizeDoc({});
        return doc;
      },
      patchMeta: function (patch) {
        if (!patch || typeof patch !== "object") return doc;
        const p = patch || {};
        if (Object.prototype.hasOwnProperty.call(p, "activeDatasetId")) {
          doc.meta.activeDatasetId = String(p.activeDatasetId || "");
        }
        if (Object.prototype.hasOwnProperty.call(p, "activeDatasetModuleId")) {
          doc.meta.activeDatasetModuleId = String(p.activeDatasetModuleId || "oscillator");
        }
        if (Object.prototype.hasOwnProperty.call(p, "activeModelId")) {
          doc.meta.activeModelId = String(p.activeModelId || "");
        }
        if (Object.prototype.hasOwnProperty.call(p, "activeTrainSessionId")) {
          doc.meta.activeTrainSessionId = String(p.activeTrainSessionId || "");
        }
        if (Object.prototype.hasOwnProperty.call(p, "modelSchemaId")) {
          doc.meta.modelSchemaId = String(p.modelSchemaId || "oscillator");
        }
        if (Object.prototype.hasOwnProperty.call(p, "serverEndpoint")) {
          doc.meta.serverEndpoint = String(p.serverEndpoint || "");
        }
        doc.updatedAt = Date.now();
        return doc;
      },
      getMeta: function () {
        return clone(doc.meta);
      },
      initTables: function (payload) {
        const p = payload && typeof payload === "object" ? payload : {};
        const names = Array.isArray(p.tables)
          ? p.tables
          : (Array.isArray(p.names) ? p.names : []);
        const out = [];
        names.forEach(function (entry) {
          const name = typeof entry === "string"
            ? entry
            : String((entry && (entry.name || entry.table)) || "");
          const normalized = normalizeTableName(name);
          if (!normalized) return;
          const map = ensureTableMap(normalized);
          if (!map) return;
          out.push({
            table: normalized,
            count: Object.keys(map).length,
          });
        });
        doc.updatedAt = Date.now();
        return out;
      },
      save: function (payload) {
        return saveRows(payload);
      },
      get: function (payload) {
        return getRow(payload);
      },
      list: function (payload) {
        const p = payload && typeof payload === "object" ? payload : {};
        const table = getTableMap(normalizeTableName(p.table));
        if (!table) return [];
        return listFromMap(table, p);
      },
      remove: function (payload) {
        return removeRows(payload);
      },
      replaceTable: function (payload) {
        const p = payload && typeof payload === "object" ? payload : {};
        const tableName = normalizeTableName(p.table);
        const table = ensureTableMap(tableName);
        if (!table) return [];
        Object.keys(table).forEach(function (id) { delete table[id]; });
        const rows = Array.isArray(p.values) ? p.values : [];
        const out = saveRows({
          table: tableName,
          values: rows,
          merge: false,
          keyField: p.keyField || "id",
        });
        doc.updatedAt = Date.now();
        return Array.isArray(out) ? out : (out ? [out] : []);
      },
      clearTable: function (tableName) {
        const map = getTableMap(normalizeTableName(tableName));
        if (!map) return 0;
        const n = Object.keys(map).length;
        Object.keys(map).forEach(function (id) { delete map[id]; });
        doc.updatedAt = Date.now();
        return n;
      },
      upsertDataset: function (entry) {
        if (!entry || typeof entry !== "object") return null;
        const id = String(entry.id || "").trim() || nextRowId("datasets");
        return saveRows({
          table: "datasets",
          values: {
            id: id,
            name: String(entry.name || id),
            schemaId: String(entry.schemaId || "oscillator"),
            createdAt: Number(entry.createdAt) || Date.now(),
            updatedAt: Number(entry.updatedAt) || Date.now(),
            payload: entry.payload || entry.data || null,
          },
        });
      },
      getDataset: function (id) {
        return getRow({ table: "datasets", id: id });
      },
      listDatasets: function (options) {
        return listFromMap(getTableMap("datasets"), options);
      },
      removeDataset: function (id) {
        return removeRows({ table: "datasets", id: id }) > 0;
      },
      upsertModel: function (entry) {
        if (!entry || typeof entry !== "object") return null;
        const id = String(entry.id || "").trim() || nextRowId("models");
        return saveRows({
          table: "models",
          values: {
            id: id,
            name: String(entry.name || id),
            schemaId: String(entry.schemaId || "oscillator"),
            createdAt: Number(entry.createdAt) || Date.now(),
            updatedAt: Number(entry.updatedAt) || Date.now(),
            payload: entry.payload || entry.graph || null,
          },
        });
      },
      getModel: function (id) {
        return getRow({ table: "models", id: id });
      },
      listModels: function (options) {
        return listFromMap(getTableMap("models"), options);
      },
      removeModel: function (id) {
        return removeRows({ table: "models", id: id }) > 0;
      },
      upsertTrainerCard: function (entry) {
        if (!entry || typeof entry !== "object") return null;
        const sid = String(entry.id || "").trim() || nextRowId("trainers");
        return saveRows({
          table: "trainers",
          values: {
            id: sid,
            name: String(entry.name || sid),
            schemaId: String(entry.schemaId || "oscillator"),
            datasetId: String(entry.datasetId || ""),
            modelId: String(entry.modelId || ""),
            runtime: String(entry.runtime || "js_client"),
            runtimeBackend: String(entry.runtimeBackend || "auto"),
            trainCfg: clone(entry.trainCfg || {}),
            selected: Boolean(entry.selected),
            collapsed: Boolean(entry.collapsed),
            createdAt: Number(entry.createdAt) || Date.now(),
            updatedAt: Number(entry.updatedAt) || Date.now(),
            lastResult: entry.lastResult ? clone(entry.lastResult) : null,
          },
        });
      },
      getTrainerCard: function (sessionId) {
        return getRow({ table: "trainers", id: sessionId });
      },
      listTrainerCards: function (options) {
        return listFromMap(getTableMap("trainers"), options);
      },
      appendTrainerEpoch: function (sessionId, row) {
        const rows = ensureSessionEpochs(sessionId);
        if (!rows) return false;
        rows.push(clone(row || {}));
        doc.updatedAt = Date.now();
        return true;
      },
      getTrainerEpochs: function (sessionId) {
        const sid = String(sessionId || "").trim();
        if (!sid) return [];
        const rows = Array.isArray(doc.trainEpochsBySessionId[sid]) ? doc.trainEpochsBySessionId[sid] : [];
        return clone(rows);
      },
      replaceTrainerEpochs: function (sessionId, rows) {
        const sid = String(sessionId || "").trim();
        if (!sid) return false;
        doc.trainEpochsBySessionId[sid] = Array.isArray(rows) ? clone(rows) : [];
        doc.updatedAt = Date.now();
        return true;
      },
      clearTrainerEpochs: function (sessionId) {
        const sid = String(sessionId || "").trim();
        if (!sid) return false;
        const existed = Array.isArray(doc.trainEpochsBySessionId[sid]) && doc.trainEpochsBySessionId[sid].length > 0;
        doc.trainEpochsBySessionId[sid] = [];
        doc.updatedAt = Date.now();
        return existed;
      },
      removeTrainerCard: function (sessionId) {
        return removeRows({ table: "trainers", id: sessionId }) > 0;
      },
      deleteTrainerCard: function (sessionId) {
        return removeRows({ table: "trainers", id: sessionId }) > 0;
      },
      query: function (entityType, options) {
        if (entityType && typeof entityType === "object") {
          const p = entityType;
          return this.list(Object.assign({}, p, options || {}));
        }
        return this.list(Object.assign({ table: normalizeEntityType(entityType) }, options || {}));
      },
    };
  }

  const PERSIST_WRITE_METHODS = [
    "replace",
    "clear",
    "patchMeta",
    "initTables",
    "save",
    "remove",
    "replaceTable",
    "clearTable",
    "upsertDataset",
    "upsertModel",
    "upsertTrainerCard",
    "appendTrainerEpoch",
    "replaceTrainerEpochs",
    "clearTrainerEpochs",
    "removeDataset",
    "removeModel",
    "removeTrainerCard",
    "deleteTrainerCard",
  ];

  function createLocalStorageStore(rawOptions) {
    const options = rawOptions && typeof rawOptions === "object" ? rawOptions : {};
    if (typeof window === "undefined" || typeof localStorage === "undefined" || !localStorage) {
      const fallback = createCoreStore();
      fallback.storageMode = "memory_fallback_no_localstorage";
      return fallback;
    }

    const storageKey = String(options.storageKey || "osc_workspace_doc").trim() || "osc_workspace_doc";
    const core = createCoreStore();
    core.storageMode = "localstorage";
    let lastPersistAt = 0;
    let lastPersistError = "";
    let enabled = true;

    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          core.replace(parsed);
        }
      }
    } catch (err) {
      lastPersistError = String(err && err.message ? err.message : err);
    }

    function persistSnapshotNow() {
      if (!enabled) return false;
      try {
        const snap = typeof core.peekRaw === "function" ? core.peekRaw() : core.snapshot();
        localStorage.setItem(storageKey, JSON.stringify(snap));
        lastPersistAt = Date.now();
        lastPersistError = "";
        return true;
      } catch (err) {
        lastPersistError = String(err && err.message ? err.message : err);
        return false;
      }
    }

    const out = {};
    Object.keys(core).forEach(function (key) {
      out[key] = core[key];
    });
    PERSIST_WRITE_METHODS.forEach(function (methodName) {
      const fn = core[methodName];
      if (typeof fn !== "function") return;
      out[methodName] = function () {
        const args = Array.prototype.slice.call(arguments);
        const result = fn.apply(core, args);
        persistSnapshotNow();
        return result;
      };
    });
    out.storageMode = "localstorage";
    out.contractVersion = CONTRACT_VERSION;
    out.flushNow = function () {
      return Promise.resolve(persistSnapshotNow());
    };
    out.getPersistenceState = function () {
      return {
        storageMode: "localstorage",
        ready: true,
        enabled: Boolean(enabled),
        lastPersistAt: Number(lastPersistAt || 0),
        lastPersistError: String(lastPersistError || ""),
      };
    };
    out.disablePersistence = function () {
      enabled = false;
    };
    return out;
  }

  function createIndexedDbStore(rawOptions) {
    const options = rawOptions && typeof rawOptions === "object" ? rawOptions : {};
    const dbName = String(options.dbName || "osc_workspace").trim() || "osc_workspace";
    const storeName = String(options.storeName || "osc_workspace_kv").trim() || "osc_workspace_kv";
    const docKey = String(options.docKey || "workspace_doc").trim() || "workspace_doc";
    const localStorageKey =
      String(options.localStorageKey || ("osc_workspace_ls::" + dbName + "::" + docKey)).trim() ||
      ("osc_workspace_ls::" + dbName + "::" + docKey);
    if (typeof window === "undefined" || typeof indexedDB === "undefined" || !indexedDB || typeof indexedDB.open !== "function") {
      return Promise.resolve(createLocalStorageStore({ storageKey: localStorageKey }));
    }
    const version = Number(options.version) || 1;

    const core = createCoreStore();
    core.storageMode = "indexeddb";

    let db = null;
    let initialized = false;
    let persistenceEnabled = false;
    let lastPersistAt = 0;
    let lastPersistError = "";
    let persistRequested = false;
    let persistInFlight = null;

    function openDatabase() {
      return new Promise(function (resolve, reject) {
        let req;
        try {
          req = indexedDB.open(dbName, version);
        } catch (err) {
          reject(err);
          return;
        }
        req.onupgradeneeded = function (evt) {
          const targetDb = evt.target && evt.target.result;
          if (!targetDb) return;
          if (!targetDb.objectStoreNames.contains(storeName)) {
            targetDb.createObjectStore(storeName, { keyPath: "id" });
          }
        };
        req.onsuccess = function (evt) {
          resolve(evt.target.result);
        };
        req.onerror = function (evt) {
          reject(evt && evt.target && evt.target.error ? evt.target.error : new Error("IndexedDB open error"));
        };
      });
    }

    function readDocument(currentDb) {
      return new Promise(function (resolve, reject) {
        try {
          const tx = currentDb.transaction([storeName], "readonly");
          const os = tx.objectStore(storeName);
          const req = os.get(docKey);
          req.onsuccess = function (evt) {
            const item = evt.target && evt.target.result;
            if (!item || typeof item !== "object") {
              resolve(null);
              return;
            }
            if (item.doc && typeof item.doc === "object") {
              resolve(item.doc);
              return;
            }
            if (item.payload && typeof item.payload === "object") {
              resolve(item.payload);
              return;
            }
            if (
              item.irVersion ||
              item.datasetsById ||
              item.modelsById ||
              item.trainerCardsById ||
              item.trainEpochsBySessionId
            ) {
              resolve(item);
              return;
            }
            resolve(null);
          };
          req.onerror = function (evt) {
            reject(evt && evt.target && evt.target.error ? evt.target.error : new Error("IndexedDB read error"));
          };
        } catch (err) {
          reject(err);
        }
      });
    }

    function writeDocument(currentDb, docToStore) {
      if (!currentDb) return Promise.resolve();
      return new Promise(function (resolve, reject) {
        try {
          const tx = currentDb.transaction([storeName], "readwrite");
          const os = tx.objectStore(storeName);
          const payload = {
            doc: docToStore,
            updatedAt: Date.now(),
          };
          const keyPath = os.keyPath;
          let req;
          if (typeof keyPath === "string" && keyPath) {
            payload[keyPath] = docKey;
            req = os.put(payload);
          } else {
            payload.id = docKey;
            req = os.put(payload, docKey);
          }
          req.onsuccess = function () { resolve(); };
          req.onerror = function (evt) {
            reject(evt && evt.target && evt.target.error ? evt.target.error : new Error("IndexedDB write error"));
          };
        } catch (err) {
          reject(err);
        }
      });
    }

    function persistSnapshotNow() {
      if (!persistenceEnabled || !initialized || !db) return Promise.resolve(false);
      const snapshot = typeof core.peekRaw === "function" ? core.peekRaw() : core.snapshot();
      return writeDocument(db, snapshot).then(function () {
        lastPersistAt = Date.now();
        lastPersistError = "";
        return true;
      }).catch(function (err) {
        lastPersistError = String(err && err.message ? err.message : err);
        return false;
      });
    }

    function schedulePersist() {
      if (!persistenceEnabled || !initialized || !db) return;
      persistRequested = true;
      if (persistInFlight) return;
      persistInFlight = Promise.resolve().then(function pump() {
        if (!persistRequested) return true;
        persistRequested = false;
        return persistSnapshotNow().then(function () {
          if (persistRequested) return pump();
          return true;
        });
      }).finally(function () {
        persistInFlight = null;
        if (persistRequested) {
          schedulePersist();
        }
      });
    }

    function createPersistAwareApi() {
      const out = {};
      Object.keys(core).forEach(function (key) {
        out[key] = core[key];
      });

      PERSIST_WRITE_METHODS.forEach(function (methodName) {
        const fn = core[methodName];
        if (typeof fn !== "function") return;
        out[methodName] = function () {
          const args = Array.prototype.slice.call(arguments);
          const outv = fn.apply(core, args);
          schedulePersist();
          return outv;
        };
      });

      out.storageMode = "indexeddb";
      out.contractVersion = CONTRACT_VERSION;
      out.setReadyState = function () {
        return initialized;
      };
      out.flushNow = function () {
        if (!persistenceEnabled || !initialized || !db) return Promise.resolve(false);
        persistRequested = false;
        const flushTask = function () {
          return persistSnapshotNow();
        };
        if (persistInFlight) {
          return persistInFlight.then(function () {
            return flushTask();
          });
        }
        return flushTask();
      };
      out.getPersistenceState = function () {
        return {
          storageMode: "indexeddb",
          ready: Boolean(initialized),
          enabled: Boolean(persistenceEnabled),
          lastPersistAt: Number(lastPersistAt || 0),
          lastPersistError: String(lastPersistError || ""),
          queuePending: Boolean(persistRequested),
          inFlight: Boolean(persistInFlight),
        };
      };
      return out;
    }

    return (async function bootstrap() {
      try {
        db = await openDatabase();
        initialized = true;
        persistenceEnabled = true;
        const stored = await readDocument(db);
        if (stored && typeof stored === "object") {
          core.replace(stored);
        }
        const api = createPersistAwareApi();
        persistenceEnabled = true;
        return api;
      } catch (_err) {
        return createLocalStorageStore({ storageKey: localStorageKey });
      }
    })();
  }

  const workspaceStore = {
    CONTRACT_VERSION: CONTRACT_VERSION,
    normalizeDoc: normalizeDoc,
    createMemoryStore: createCoreStore,
    createLocalStorageStore: createLocalStorageStore,
    createIndexedDbStore: createIndexedDbStore,
  };

  if (typeof window !== "undefined") {
    window.OSCWorkspaceStore = workspaceStore;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = workspaceStore;
  }
})();

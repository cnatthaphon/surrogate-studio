(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCWorkspaceStore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CONTRACT_IR_VERSION = "1.0";

  function nowMs() {
    return Date.now();
  }

  function safeString(v) {
    return String(v == null ? "" : v).trim();
  }

  function cloneJson(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function emptyDoc() {
    return {
      irVersion: CONTRACT_IR_VERSION,
      updatedAt: nowMs(),
      datasetsById: {},
      modelsById: {},
      trainerCardsById: {},
      trainEpochsBySessionId: {},
      meta: {
        activeDatasetId: "",
        activeModelId: "",
        modelSchemaId: "oscillator",
      },
    };
  }

  function normalizeDoc(raw) {
    var next = raw && typeof raw === "object" ? raw : {};
    var out = emptyDoc();
    out.irVersion = safeString(next.irVersion || CONTRACT_IR_VERSION) || CONTRACT_IR_VERSION;
    out.updatedAt = Number(next.updatedAt) || nowMs();
    out.datasetsById = next.datasetsById && typeof next.datasetsById === "object" ? next.datasetsById : {};
    out.modelsById = next.modelsById && typeof next.modelsById === "object" ? next.modelsById : {};
    out.trainerCardsById = next.trainerCardsById && typeof next.trainerCardsById === "object" ? next.trainerCardsById : {};
    out.trainEpochsBySessionId = next.trainEpochsBySessionId && typeof next.trainEpochsBySessionId === "object" ? next.trainEpochsBySessionId : {};
    if (next.meta && typeof next.meta === "object") {
      out.meta = Object.assign({}, out.meta, next.meta);
    }
    return out;
  }

  function createStoreCore(initialDoc, onWrite, storageMode) {
    var doc = normalizeDoc(initialDoc);

    function flush() {
      doc.updatedAt = nowMs();
      if (typeof onWrite === "function") {
        onWrite(cloneJson(doc));
      }
    }

    return {
      contractVersion: CONTRACT_IR_VERSION,
      storageMode: safeString(storageMode || "memory") || "memory",
      snapshot: function () {
        return cloneJson(doc);
      },
      replace: function (nextDoc) {
        doc = normalizeDoc(nextDoc);
        flush();
        return doc;
      },
      clear: function () {
        doc = emptyDoc();
        flush();
        return doc;
      },
      upsertDataset: function (record) {
        var id = safeString(record && record.id);
        if (!id) return null;
        doc.datasetsById[id] = Object.assign({}, doc.datasetsById[id] || {}, record || {}, { id: id });
        flush();
        return doc.datasetsById[id];
      },
      removeDataset: function (id) {
        var did = safeString(id);
        if (!did) return false;
        if (!doc.datasetsById[did]) return false;
        delete doc.datasetsById[did];
        flush();
        return true;
      },
      upsertModel: function (record) {
        var id = safeString(record && record.id);
        if (!id) return null;
        doc.modelsById[id] = Object.assign({}, doc.modelsById[id] || {}, record || {}, { id: id });
        flush();
        return doc.modelsById[id];
      },
      removeModel: function (id) {
        var mid = safeString(id);
        if (!mid) return false;
        if (!doc.modelsById[mid]) return false;
        delete doc.modelsById[mid];
        flush();
        return true;
      },
      upsertTrainerCard: function (record) {
        var id = safeString(record && record.id);
        if (!id) return null;
        doc.trainerCardsById[id] = Object.assign({}, doc.trainerCardsById[id] || {}, record || {}, { id: id });
        flush();
        return doc.trainerCardsById[id];
      },
      removeTrainerCard: function (id) {
        var sid = safeString(id);
        if (!sid) return;
        delete doc.trainerCardsById[sid];
        delete doc.trainEpochsBySessionId[sid];
        flush();
      },
      replaceTrainerEpochs: function (sessionId, rows) {
        var sid = safeString(sessionId);
        if (!sid) return;
        doc.trainEpochsBySessionId[sid] = Array.isArray(rows) ? rows.slice() : [];
        flush();
      },
      appendTrainerEpoch: function (sessionId, row) {
        var sid = safeString(sessionId);
        if (!sid) return;
        if (!Array.isArray(doc.trainEpochsBySessionId[sid])) doc.trainEpochsBySessionId[sid] = [];
        doc.trainEpochsBySessionId[sid].push(row || {});
        flush();
      },
      patchMeta: function (patch) {
        if (!patch || typeof patch !== "object") return;
        doc.meta = Object.assign({}, doc.meta, patch);
        flush();
      },
      getDataset: function (id) {
        var did = safeString(id);
        return did && doc.datasetsById[did] ? cloneJson(doc.datasetsById[did]) : null;
      },
      getModel: function (id) {
        var mid = safeString(id);
        return mid && doc.modelsById[mid] ? cloneJson(doc.modelsById[mid]) : null;
      },
      getTrainerCard: function (id) {
        var tid = safeString(id);
        return tid && doc.trainerCardsById[tid] ? cloneJson(doc.trainerCardsById[tid]) : null;
      },
      getTrainerEpochs: function (sessionId) {
        var sid = safeString(sessionId);
        return sid && Array.isArray(doc.trainEpochsBySessionId[sid]) ? doc.trainEpochsBySessionId[sid].slice() : [];
      },
      clearTrainerEpochs: function (sessionId) {
        var sid = safeString(sessionId);
        if (sid) { doc.trainEpochsBySessionId[sid] = []; flush(); }
      },
      listDatasets: function (filter) {
        var rows = Object.keys(doc.datasetsById).map(function (k) { return doc.datasetsById[k]; });
        if (filter && filter.schemaId) rows = rows.filter(function (r) { return r.schemaId === filter.schemaId; });
        return rows.map(cloneJson);
      },
      listModels: function (filter) {
        var rows = Object.keys(doc.modelsById).map(function (k) { return doc.modelsById[k]; });
        if (filter && filter.schemaId) rows = rows.filter(function (r) { return r.schemaId === filter.schemaId; });
        return rows.map(cloneJson);
      },
      listTrainerCards: function (filter) {
        var rows = Object.keys(doc.trainerCardsById).map(function (k) { return doc.trainerCardsById[k]; });
        if (filter && filter.schemaId) rows = rows.filter(function (r) { return r.schemaId === filter.schemaId; });
        return rows.map(cloneJson);
      },
      query: function (type) {
        if (type === "dataset") return Object.keys(doc.datasetsById).map(function (k) { return cloneJson(doc.datasetsById[k]); });
        if (type === "model") return Object.keys(doc.modelsById).map(function (k) { return cloneJson(doc.modelsById[k]); });
        if (type === "trainer") return Object.keys(doc.trainerCardsById).map(function (k) { return cloneJson(doc.trainerCardsById[k]); });
        return [];
      },
      initTables: function (cfg) {
        var tables = cfg && Array.isArray(cfg.tables) ? cfg.tables : [];
        tables.forEach(function (t) { if (!doc["_custom_" + t]) { doc["_custom_" + t] = {}; } });
      },
      save: function (cfg) {
        var t = cfg && cfg.table ? "_custom_" + cfg.table : null;
        if (!t || !doc[t]) return;
        var vals = Array.isArray(cfg.values) ? cfg.values : [];
        vals.forEach(function (v) { if (v && v.id) doc[t][v.id] = cloneJson(v); });
        flush();
      },
      list: function (cfg) {
        var t = cfg && cfg.table ? "_custom_" + cfg.table : null;
        if (!t || !doc[t]) return [];
        return Object.keys(doc[t]).map(function (k) { return cloneJson(doc[t][k]); });
      },
      get: function (cfg) {
        var t = cfg && cfg.table ? "_custom_" + cfg.table : null;
        if (!t || !doc[t]) return null;
        var id = safeString(cfg.id);
        return id && doc[t][id] ? cloneJson(doc[t][id]) : null;
      },
      remove: function (cfg) {
        var t = cfg && cfg.table ? "_custom_" + cfg.table : null;
        if (!t || !doc[t]) return 0;
        var id = safeString(cfg.id);
        if (id && doc[t][id]) { delete doc[t][id]; flush(); return 1; }
        return 0;
      },
    };
  }

  function createMemoryStore(initialDoc) {
    return createStoreCore(initialDoc, null, "memory");
  }

  function supportsIndexedDb() {
    return typeof indexedDB !== "undefined" && indexedDB && typeof indexedDB.open === "function";
  }

  function idbOpen(dbName, storeName) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(String(dbName || "osc_workspace"), 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("indexedDB open failed")); };
    });
  }

  function idbGet(db, storeName, key) {
    return new Promise(function (resolve, reject) {
      try {
        var tx = db.transaction([storeName], "readonly");
        var st = tx.objectStore(storeName);
        var req = st.get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error("indexedDB get failed")); };
      } catch (err) {
        reject(err);
      }
    });
  }

  function idbPut(db, storeName, key, value) {
    return new Promise(function (resolve, reject) {
      try {
        var tx = db.transaction([storeName], "readwrite");
        var st = tx.objectStore(storeName);
        st.put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error || new Error("indexedDB put failed")); };
        tx.onabort = function () { reject(tx.error || new Error("indexedDB tx aborted")); };
      } catch (err) {
        reject(err);
      }
    });
  }

  function createIndexedDbStore(opts) {
    var cfg = opts && typeof opts === "object" ? opts : {};
    var dbName = safeString(cfg.dbName || "osc_workspace");
    var storeName = safeString(cfg.storeName || "kv");
    var docKey = safeString(cfg.docKey || "workspace_doc");

    if (!supportsIndexedDb()) {
      return Promise.resolve(createStoreCore(null, null, "memory_fallback"));
    }

    return idbOpen(dbName, storeName)
      .then(function (db) {
        return idbGet(db, storeName, docKey)
          .catch(function () { return null; })
          .then(function (loaded) {
            var closed = false;
            var writeQueue = Promise.resolve();
            var pushWrite = function (docSnap) {
              if (closed) return;
              writeQueue = writeQueue
                .catch(function () {})
                .then(function () { return idbPut(db, storeName, docKey, docSnap); })
                .catch(function () {});
            };
            var store = createStoreCore(loaded, pushWrite, "indexeddb");
            store.close = function () {
              closed = true;
              try { db.close(); } catch (_) {}
            };
            store.flush = function () {
              return writeQueue;
            };
            return store;
          });
      })
      .catch(function () {
        return createStoreCore(null, null, "memory_fallback");
      });
  }

  return {
    CONTRACT_IR_VERSION: CONTRACT_IR_VERSION,
    createEmptyDoc: emptyDoc,
    normalizeDoc: normalizeDoc,
    createMemoryStore: createMemoryStore,
    supportsIndexedDb: supportsIndexedDb,
    createIndexedDbStore: createIndexedDbStore,
  };
});
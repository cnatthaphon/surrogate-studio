(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCAppStateCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var _nextSubId = 1;

  function create(config) {
    var cfg = config || {};
    var _state = {
      activeSchemaId: String(cfg.defaultSchemaId || "oscillator"),
      activeTab: String(cfg.defaultTab || "playground"),
      activeDatasetId: "",
      activeModelId: "",
      activeTrainerId: "",
      activeDatasetModuleId: "",
      modelSchemaId: String(cfg.defaultSchemaId || "oscillator"),
    };
    var _subs = {};

    function _notify(path) {
      Object.keys(_subs).forEach(function (id) {
        var sub = _subs[id];
        if (!sub) return;
        if (sub.path === "*" || sub.path === path || path.indexOf(sub.path + ".") === 0) {
          try { sub.cb(_state, path); } catch (e) {}
        }
      });
    }

    function get(path) {
      if (!path || path === "*") return JSON.parse(JSON.stringify(_state));
      return _state[path] !== undefined ? _state[path] : undefined;
    }

    function set(path, value) {
      if (!path || path === "*") return;
      var prev = _state[path];
      _state[path] = value;
      if (prev !== value) _notify(path);
    }

    function subscribe(path, cb) {
      var id = "sub_" + (_nextSubId++);
      _subs[id] = { path: String(path || "*"), cb: cb };
      return id;
    }

    function unsubscribe(id) {
      delete _subs[id];
    }

    function getSnapshot() {
      return JSON.parse(JSON.stringify(_state));
    }

    // convenience methods
    function setActiveSchema(id) {
      var sid = String(id || "oscillator");
      set("activeSchemaId", sid);
      set("modelSchemaId", sid);
    }
    function getActiveSchema() { return get("activeSchemaId"); }

    function setActiveTab(id) { set("activeTab", String(id || "playground")); }
    function getActiveTab() { return get("activeTab"); }

    function setActiveDataset(id) { set("activeDatasetId", String(id || "")); }
    function getActiveDataset() { return get("activeDatasetId"); }

    function setActiveModel(id) { set("activeModelId", String(id || "")); }
    function getActiveModel() { return get("activeModelId"); }

    function setActiveTrainer(id) { set("activeTrainerId", String(id || "")); }
    function getActiveTrainer() { return get("activeTrainerId"); }

    function setActiveDatasetModule(id) { set("activeDatasetModuleId", String(id || "")); }
    function getActiveDatasetModule() { return get("activeDatasetModuleId"); }

    return {
      get: get,
      set: set,
      subscribe: subscribe,
      unsubscribe: unsubscribe,
      getSnapshot: getSnapshot,
      setActiveSchema: setActiveSchema,
      getActiveSchema: getActiveSchema,
      setActiveTab: setActiveTab,
      getActiveTab: getActiveTab,
      setActiveDataset: setActiveDataset,
      getActiveDataset: getActiveDataset,
      setActiveModel: setActiveModel,
      getActiveModel: getActiveModel,
      setActiveTrainer: setActiveTrainer,
      getActiveTrainer: getActiveTrainer,
      setActiveDatasetModule: setActiveDatasetModule,
      getActiveDatasetModule: getActiveDatasetModule,
    };
  }

  return { create: create };
});

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCDatasetServiceCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createService(rawOptions) {
    var options = rawOptions && typeof rawOptions === "object" ? rawOptions : {};
    var rawHandlers = options.handlers && typeof options.handlers === "object" ? options.handlers : {};
    var handlers = Object.create(null);

    Object.keys(rawHandlers).forEach(function (key) {
      var id = String(key || "").trim();
      if (!id) return;
      if (typeof rawHandlers[key] !== "function") return;
      handlers[id] = rawHandlers[key];
    });

    function execute(rawRequest) {
      var request = rawRequest && typeof rawRequest === "object" ? rawRequest : {};
      var action = String(request.action || "").trim();
      var payload = request.payload && typeof request.payload === "object" ? request.payload : {};
      var context = request.context && typeof request.context === "object" ? request.context : {};
      if (!action) {
        throw new Error("Dataset service action is required.");
      }
      if (typeof handlers[action] !== "function") {
        throw new Error("Dataset service action '" + action + "' is not registered.");
      }
      return Promise.resolve(handlers[action](payload, context, request));
    }

    return {
      execute: execute,
    };
  }

  return {
    createService: createService,
  };
});

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCNotebookExportSupportCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createRuntime(rawDeps) {
    var deps = rawDeps && typeof rawDeps === "object" ? rawDeps : {};
    var defaultRuntimeId = String(deps.defaultRuntimeId || "server_pytorch_gpu").trim() || "server_pytorch_gpu";
    var defaultRuntimeFamily = String(deps.defaultRuntimeFamily || "pytorch").trim().toLowerCase() || "pytorch";
    var defaultBackend = String(deps.defaultBackend || "auto").trim() || "auto";

    function getNotebookExportSupport(session) {
      var s = session && typeof session === "object" ? session : {};
      return {
        ok: true,
        family: defaultRuntimeFamily,
        reason: "",
        exportRuntimeId: defaultRuntimeId,
        exportRuntimeFamily: defaultRuntimeFamily,
        exportRuntimeBackend: defaultBackend,
        note: "Notebook export uses PyTorch baseline regardless of current trainer runtime.",
        sessionId: String(s.id || ""),
      };
    }

    return {
      getNotebookExportSupport: getNotebookExportSupport,
    };
  }

  return {
    createRuntime: createRuntime,
  };
});
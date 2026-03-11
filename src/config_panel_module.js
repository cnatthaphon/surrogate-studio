(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCConfigPanelModule = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function getUiSharedEngine() {
    if (typeof window !== "undefined" && window.OSCUiSharedEngine) return window.OSCUiSharedEngine;
    if (typeof globalThis !== "undefined" && globalThis.OSCUiSharedEngine) return globalThis.OSCUiSharedEngine;
    try {
      return require("./ui_shared_engine.js");
    } catch (_err) {
      return null;
    }
  }

  function create(config) {
    var engine = getUiSharedEngine();
    if (!engine || typeof engine.renderConfigForm !== "function") {
      throw new Error("OSCConfigPanelModule requires OSCUiSharedEngine.renderConfigForm.");
    }
    var state = {
      mountEl: config && config.mountEl ? config.mountEl : null,
      formApi: null,
      sectionApis: Object.create(null),
      panelApi: null,
    };

    function destroyAll() {
      if (state.formApi && typeof state.formApi.destroy === "function") {
        state.formApi.destroy();
      }
      state.formApi = null;
      Object.keys(state.sectionApis).forEach(function (key) {
        var api = state.sectionApis[key];
        if (api && typeof api.destroy === "function") api.destroy();
      });
      state.sectionApis = Object.create(null);
      state.panelApi = null;
    }

    function renderSectionPanel(nextConfig) {
      var cfg = nextConfig || {};
      var mountEl = state.mountEl;
      var sections = Array.isArray(cfg.sections) ? cfg.sections : [];
      var globalActions = Array.isArray(cfg.actions) ? cfg.actions : [];
      mountEl.innerHTML =
        sections.map(function (section, idx) {
          var sid = String((section && section.id) || ("section_" + idx)).trim();
          var title = String((section && section.title) || sid);
          var hint = String((section && section.hint) || "");
          var actions = Array.isArray(section && section.actions) ? section.actions : [];
          return (
            "<div class='panel' style='margin-bottom:8px;' data-panel-section='" + sid + "'>" +
              "<div class='compare-title'>" + title + "</div>" +
              (hint ? ("<div class='hint' style='margin-bottom:6px;'>" + hint + "</div>") : "") +
              "<div data-panel-section-mount='" + sid + "'></div>" +
              (actions.length
                ? (
                  "<div class='quick-actions' style='margin-top:6px;'>" +
                    actions.map(function (action) {
                      var aid = String((action && action.id) || "").trim();
                      if (!aid) return "";
                      var label = String((action && action.label) || aid);
                      var cls = action && action.secondary ? "secondary" : "";
                      return "<button type='button' class='" + cls + "' data-panel-section-action='" + sid + ":" + aid + "'>" + label + "</button>";
                    }).join("") +
                  "</div>"
                )
                : "") +
            "</div>"
          );
        }).join("") +
        (globalActions.length
          ? (
            "<div class='quick-actions'>" +
              globalActions.map(function (action) {
                var aid = String((action && action.id) || "").trim();
                if (!aid) return "";
                var label = String((action && action.label) || aid);
                var cls = action && action.secondary ? "secondary" : "";
                return "<button type='button' class='" + cls + "' data-panel-action='" + aid + "'>" + label + "</button>";
              }).join("") +
            "</div>"
          )
          : "");

      state.sectionApis = Object.create(null);

      function collectConfig() {
        var out = {};
        sections.forEach(function (section, idx) {
          var sid = String((section && section.id) || ("section_" + idx)).trim();
          var api = state.sectionApis[sid];
          if (!api || typeof api.getConfig !== "function") return;
          var value = api.getConfig();
          Object.keys(value || {}).forEach(function (key) {
            out[key] = value[key];
          });
        });
        return out;
      }

      sections.forEach(function (section, idx) {
        var sid = String((section && section.id) || ("section_" + idx)).trim();
        var sectionMount = mountEl.querySelector("[data-panel-section-mount='" + sid + "']");
        if (!sectionMount) return;
        state.sectionApis[sid] = engine.renderConfigForm({
          mountEl: sectionMount,
          schema: section.schema || [],
          value: section.value || {},
          fieldNamePrefix: String(cfg.fieldNamePrefix || "cfg") + "." + sid,
          emptyText: String(section.emptyText || ""),
          onChange: function (nextSectionConfig, ctx) {
            var payload = {
              sectionId: sid,
              key: ctx && ctx.key ? String(ctx.key) : "",
              value: ctx ? ctx.value : undefined,
              field: ctx ? ctx.field : null,
              api: api,
            };
            if (typeof section.onChange === "function") {
              section.onChange(nextSectionConfig, payload);
            }
            if (typeof cfg.onChange === "function") {
              cfg.onChange(collectConfig(), payload);
            }
          },
        });
      });

      function handleAction(actionId, sectionId, actionDef, ev) {
        if (typeof cfg.onAction === "function") {
          cfg.onAction({
            actionId: String(actionId || ""),
            sectionId: sectionId ? String(sectionId) : "",
            action: actionDef || null,
            event: ev || null,
            api: api,
          });
        }
      }

      var sectionActionButtons = mountEl.querySelectorAll("[data-panel-section-action]");
      sectionActionButtons.forEach(function (btn) {
        btn.addEventListener("click", function (ev) {
          var raw = String(btn.getAttribute("data-panel-section-action") || "").trim();
          var splitAt = raw.indexOf(":");
          if (splitAt <= 0) return;
          var sid = raw.slice(0, splitAt);
          var aid = raw.slice(splitAt + 1);
          var section = sections.find(function (entry, idx) {
            return String((entry && entry.id) || ("section_" + idx)).trim() === sid;
          }) || null;
          var actionDef = section && Array.isArray(section.actions)
            ? section.actions.find(function (entry) { return String((entry && entry.id) || "").trim() === aid; }) || null
            : null;
          handleAction(aid, sid, actionDef, ev);
        });
      });

      var panelActionButtons = mountEl.querySelectorAll("[data-panel-action]");
      panelActionButtons.forEach(function (btn) {
        btn.addEventListener("click", function (ev) {
          var aid = String(btn.getAttribute("data-panel-action") || "").trim();
          if (!aid) return;
          var actionDef = globalActions.find(function (entry) {
            return String((entry && entry.id) || "").trim() === aid;
          }) || null;
          handleAction(aid, "", actionDef, ev);
        });
      });

      var api = {
        getConfig: collectConfig,
        setConfig: function (nextConfig) {
          var value = nextConfig && typeof nextConfig === "object" ? nextConfig : {};
          Object.keys(state.sectionApis).forEach(function (sid) {
            var sectionApi = state.sectionApis[sid];
            if (sectionApi && typeof sectionApi.setConfig === "function") {
              sectionApi.setConfig(value);
            }
          });
          return collectConfig();
        },
        getSectionApi: function (sectionId) {
          return state.sectionApis[String(sectionId || "").trim()] || null;
        },
        destroy: destroyAll,
      };
      state.panelApi = api;
      return api;
    }

    function render(nextConfig) {
      destroyAll();
      if (nextConfig && Array.isArray(nextConfig.sections)) {
        return renderSectionPanel(nextConfig);
      }
      state.formApi = engine.renderConfigForm(Object.assign({}, nextConfig || {}, {
        mountEl: state.mountEl,
      }));
      return state.formApi;
    }

    function clear(emptyHtml) {
      destroyAll();
      if (state.mountEl) state.mountEl.innerHTML = String(emptyHtml || "");
    }

    function getFormApi() {
      return state.panelApi || state.formApi || null;
    }

    function destroy() {
      destroyAll();
    }

    return {
      render: render,
      clear: clear,
      getFormApi: getFormApi,
      destroy: destroy,
    };
  }

  return {
    create: create,
  };
});

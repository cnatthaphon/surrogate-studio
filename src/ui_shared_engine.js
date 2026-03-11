(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCUiSharedEngine = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function escapeHtml(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function applySelectionState(config) {
    var cfg = config || {};
    var selected = Boolean(cfg.selected);
    if (cfg.emptyEl) cfg.emptyEl.style.display = selected ? "none" : "";
    if (cfg.contentEl) cfg.contentEl.style.display = selected ? "" : "none";
    var disableWhenEmpty = Array.isArray(cfg.disableWhenEmpty) ? cfg.disableWhenEmpty : [];
    disableWhenEmpty.forEach(function (el) {
      if (!el) return;
      el.disabled = !selected;
    });
    if (!selected) {
      if (typeof cfg.onEmpty === "function") cfg.onEmpty();
      return;
    }
    if (typeof cfg.onSelected === "function") cfg.onSelected();
  }

  function setActionButtonsVisibility(config) {
    var cfg = config || {};
    var containerEl = cfg.containerEl || null;
    var buttons = Array.isArray(cfg.buttons) ? cfg.buttons : [];
    var hasVisible = false;
    buttons.forEach(function (b) {
      if (!b || !b.el) return;
      var visible = Boolean(b.visible);
      b.el.style.display = visible ? "" : "none";
      if (visible) hasVisible = true;
    });
    if (containerEl) containerEl.style.display = hasVisible ? "" : "none";
  }

  function setActiveItemClassById(config, container, activeItemId) {
    var rawId = String(activeItemId || "").trim();
    if (!container) return;
    if (!rawId) return;
    var selector = String(config && config.itemClassName ? config.itemClassName : "left-dataset-item").trim();
    if (!selector) selector = "left-dataset-item";
    var rows = container.querySelectorAll("." + selector + "[data-item-id], ." + selector + "[data-dataset-id]");
    if (!rows || !rows.length) {
      rows = container.querySelectorAll("[data-item-id], [data-dataset-id]");
    }
    rows.forEach(function (row) {
      var rowId = String(
        row.getAttribute("data-item-id") ||
        row.getAttribute("data-dataset-id") ||
        ""
      ).trim();
      if (!rowId) return;
      row.classList.toggle("active", rowId === rawId);
    });
  }

  function renderItemList(config) {
    var cfg = config || {};
    var mountEl = cfg.mountEl || null;
    if (!mountEl) return { itemById: {} };
    var items = Array.isArray(cfg.items) ? cfg.items : [];
    var emptyText = String(cfg.emptyText || "No items.");
    var listClassName = String(cfg.listClassName || "left-dataset-list");
    var itemClassName = String(cfg.itemClassName || "left-dataset-item");
    var itemMainClassName = String(cfg.itemMainClassName || "left-dataset-main");
    var titleClassName = String(cfg.titleClassName || "left-dataset-open");
    var metaClassName = String(cfg.metaClassName || "left-dataset-meta");
    var actionsClassName = String(cfg.actionsClassName || "left-dataset-actions");

    var itemById = Object.create(null);
    items.forEach(function (it) {
      var id = String((it && it.id) || "").trim();
      if (!id) return;
      itemById[id] = it;
    });

    if (!items.length) {
      mountEl.innerHTML = "<div class='hint'>" + escapeHtml(emptyText) + "</div>";
      return { itemById: itemById };
    }

    mountEl.innerHTML =
      "<div class='" + escapeHtml(listClassName) + "'>" +
        items.map(function (it) {
          var id = String((it && it.id) || "").trim();
          if (!id) return "";
          var title = String((it && it.title) || id);
          var titleTip = String((it && it.titleTip) || "");
          var metaLines = Array.isArray(it && it.metaLines) ? it.metaLines : [];
          var actions = Array.isArray(it && it.actions) ? it.actions : [];
          var activeCls = it && it.active ? " active" : "";
          return (
            "<div class='" + escapeHtml(itemClassName + activeCls) + "' data-item-id='" + escapeHtml(id) + "' tabindex='0'>" +
              "<div class='" + escapeHtml(itemMainClassName) + "'>" +
                "<div class='" + escapeHtml(titleClassName) + "'" + (titleTip ? (" title='" + escapeHtml(titleTip) + "'") : "") + ">" + escapeHtml(title) + "</div>" +
                "<div class='" + escapeHtml(metaClassName) + "'>" +
                  metaLines.map(function (line) {
                    return "<span>" + escapeHtml(String(line || "")) + "</span>";
                  }).join("") +
                "</div>" +
              "</div>" +
              (actions.length
                ? (
                  "<div class='" + escapeHtml(actionsClassName) + "'>" +
                    actions.map(function (a) {
                      var aid = String((a && a.id) || "").trim();
                      if (!aid) return "";
                      var icon = String((a && a.iconSvg) || "");
                      var label = String((a && a.label) || aid);
                      var titleText = String((a && a.title) || label);
                      var btnCls = icon ? "secondary icon-btn" : "secondary";
                      return (
                        "<button class='" + escapeHtml(btnCls) + "' type='button' data-item-id='" + escapeHtml(id) + "' data-item-action='" + escapeHtml(aid) + "' title='" + escapeHtml(titleText) + "' aria-label='" + escapeHtml(titleText) + "'>" +
                          (icon || escapeHtml(label)) +
                        "</button>"
                      );
                    }).join("") +
                  "</div>"
                )
                : ""
              ) +
            "</div>"
          );
        }).join("") +
      "</div>";

    var rowEls = mountEl.querySelectorAll("." + itemClassName + "[data-item-id]");
    rowEls.forEach(function (row) {
      var id = String(row.getAttribute("data-item-id") || "").trim();
      if (!id) return;
      row.addEventListener("click", function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest("button[data-item-action]")) return;
        setActiveItemClassById(cfg, mountEl, id);
        if (typeof cfg.onOpen === "function") cfg.onOpen(id, itemById[id] || null, ev);
      });
      row.addEventListener("keydown", function (ev) {
        var key = String(ev.key || "");
        if (key !== "Enter" && key !== " ") return;
        setActiveItemClassById(cfg, mountEl, id);
        if (typeof cfg.onOpen === "function") cfg.onOpen(id, itemById[id] || null, ev);
        ev.preventDefault();
      });
    });

    var actionBtns = mountEl.querySelectorAll("button[data-item-action][data-item-id]");
    actionBtns.forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        var id = String(btn.getAttribute("data-item-id") || "").trim();
        var action = String(btn.getAttribute("data-item-action") || "").trim();
        if (!id || !action) return;
        if (typeof cfg.onAction === "function") cfg.onAction(id, action, itemById[id] || null, ev);
      });
    });

    return { itemById: itemById };
  }

  function clonePlainObject(v) {
    var src = v && typeof v === "object" ? v : {};
    var out = {};
    Object.keys(src).forEach(function (k) {
      out[k] = src[k];
    });
    return out;
  }

  function normalizeFieldType(rawType) {
    var t = String(rawType || "text").trim().toLowerCase();
    if (t === "bool") t = "checkbox";
    if (t === "dropdown") t = "select";
    if (t !== "text" && t !== "number" && t !== "select" && t !== "checkbox") t = "text";
    return t;
  }

  function normalizeFormSchema(rawSchema) {
    var src = Array.isArray(rawSchema) ? rawSchema : [];
    return src
      .map(function (f) {
        if (!f || typeof f !== "object") return null;
        var key = String(f.key || "").trim();
        if (!key) return null;
        return {
          key: key,
          label: String(f.label || key),
          type: normalizeFieldType(f.type),
          options: Array.isArray(f.options) || typeof f.options === "function" ? f.options : [],
          min: f.min,
          max: f.max,
          step: f.step,
          disabled: Boolean(f.disabled),
          placeholder: f.placeholder == null ? "" : String(f.placeholder),
          title: f.title == null ? "" : String(f.title),
          rowClassName: f.rowClassName == null ? "" : String(f.rowClassName),
          labelClassName: f.labelClassName == null ? "" : String(f.labelClassName),
          inputClassName: f.inputClassName == null ? "" : String(f.inputClassName),
          attrs: f.attrs && typeof f.attrs === "object" ? f.attrs : {},
          parse: typeof f.parse === "function" ? f.parse : null,
          format: typeof f.format === "function" ? f.format : null,
        };
      })
      .filter(Boolean);
  }

  function resolveFieldOptions(field, currentConfig) {
    var fd = field || {};
    var raw = fd.options;
    var list = [];
    if (typeof raw === "function") {
      try {
        raw = raw(clonePlainObject(currentConfig || {}), fd);
      } catch (err) {
        raw = [];
      }
    }
    if (!Array.isArray(raw)) return list;
    raw.forEach(function (op) {
      if (op && typeof op === "object") {
        var v = op.value == null ? "" : String(op.value);
        list.push({
          value: v,
          label: String(op.label == null ? v : op.label),
          disabled: Boolean(op.disabled),
          title: op.title == null ? "" : String(op.title),
        });
        return;
      }
      var vv = String(op == null ? "" : op);
      list.push({ value: vv, label: vv, disabled: false, title: "" });
    });
    return list;
  }

  function coerceFieldValue(field, rawValue, prevValue, currentConfig) {
    var fd = field || {};
    var type = normalizeFieldType(fd.type);
    var value;
    if (type === "checkbox") {
      value = Boolean(rawValue);
    } else if (type === "number") {
      if (rawValue === "" || rawValue == null) {
        value = prevValue;
      } else {
        var n = Number(rawValue);
        value = Number.isFinite(n) ? n : prevValue;
      }
    } else {
      value = rawValue == null ? "" : String(rawValue);
    }
    if (fd.parse) {
      try {
        value = fd.parse(value, prevValue, clonePlainObject(currentConfig || {}), fd);
      } catch (err) {}
    }
    return value;
  }

  function attrsToHtml(attrs) {
    var a = attrs && typeof attrs === "object" ? attrs : {};
    return Object.keys(a).map(function (k) {
      var key = String(k || "").trim();
      if (!key) return "";
      var v = a[k];
      if (typeof v === "boolean") return v ? (" " + escapeHtml(key)) : "";
      return " " + escapeHtml(key) + "='" + escapeHtml(String(v == null ? "" : v)) + "'";
    }).join("");
  }

  function renderConfigForm(config) {
    var cfg = config || {};
    var mountEl = cfg.mountEl || null;
    var rowClassName = String(cfg.rowClassName || "row");
    var fieldNamePrefix = String(cfg.fieldNamePrefix || "cfg");
    var emptyText = String(cfg.emptyText || "");
    var schema = normalizeFormSchema(cfg.schema);
    var current = clonePlainObject(cfg.value);
    var fieldEls = Object.create(null);
    var disposed = false;

    function hasOwn(obj, key) {
      return Object.prototype.hasOwnProperty.call(obj || {}, key);
    }

    function getFieldByKey(key) {
      var kk = String(key || "");
      for (var i = 0; i < schema.length; i += 1) {
        if (schema[i].key === kk) return schema[i];
      }
      return null;
    }

    function applyCurrentDefaults() {
      schema.forEach(function (fd) {
        if (!hasOwn(current, fd.key)) {
          current[fd.key] = normalizeFieldType(fd.type) === "checkbox" ? false : "";
        }
      });
    }

    function buildFieldHtml(fd) {
      var key = fd.key;
      var type = normalizeFieldType(fd.type);
      var rowCls = rowClassName + (fd.rowClassName ? (" " + fd.rowClassName) : "");
      var labelCls = fd.labelClassName ? (" class='" + escapeHtml(fd.labelClassName) + "'") : "";
      var inputCls = fd.inputClassName ? (" class='" + escapeHtml(fd.inputClassName) + "'") : "";
      var titleAttr = fd.title ? (" title='" + escapeHtml(fd.title) + "'") : "";
      var disabledAttr = fd.disabled ? " disabled" : "";
      var attrsHtml = attrsToHtml(fd.attrs);
      var commonAttrs =
        " data-config-key='" + escapeHtml(key) + "'" +
        " name='" + escapeHtml(fieldNamePrefix + "." + key) + "'" +
        disabledAttr + attrsHtml;
      var inputHtml = "";

      if (type === "select") {
        var options = resolveFieldOptions(fd, current);
        inputHtml =
          "<select" + inputCls + commonAttrs + ">" +
            options.map(function (op) {
              return "<option value='" + escapeHtml(op.value) + "'" + (op.disabled ? " disabled" : "") + (op.title ? (" title='" + escapeHtml(op.title) + "'") : "") + ">" + escapeHtml(op.label) + "</option>";
            }).join("") +
          "</select>";
      } else if (type === "checkbox") {
        inputHtml = "<input" + inputCls + commonAttrs + " type='checkbox' style='width:auto;'>";
      } else {
        var minAttr = fd.min == null ? "" : (" min='" + escapeHtml(String(fd.min)) + "'");
        var maxAttr = fd.max == null ? "" : (" max='" + escapeHtml(String(fd.max)) + "'");
        var stepAttr = fd.step == null ? "" : (" step='" + escapeHtml(String(fd.step)) + "'");
        var phAttr = fd.placeholder ? (" placeholder='" + escapeHtml(fd.placeholder) + "'") : "";
        inputHtml =
          "<input" + inputCls + commonAttrs + " type='" + escapeHtml(type === "number" ? "number" : "text") + "'" + minAttr + maxAttr + stepAttr + phAttr + ">";
      }

      return (
        "<div class='" + escapeHtml(rowCls) + "'>" +
          "<label" + labelCls + titleAttr + ">" + escapeHtml(fd.label) + "</label>" +
          inputHtml +
        "</div>"
      );
    }

    function setInputForField(fd, el, value) {
      if (!fd || !el) return;
      var type = normalizeFieldType(fd.type);
      var next = fd.format ? fd.format(value, clonePlainObject(current), fd) : value;
      if (type === "checkbox") {
        el.checked = Boolean(next);
        return;
      }
      if (type === "select") {
        var opts = resolveFieldOptions(fd, current);
        el.innerHTML = opts.map(function (op) {
          return "<option value='" + escapeHtml(op.value) + "'" + (op.disabled ? " disabled" : "") + (op.title ? (" title='" + escapeHtml(op.title) + "'") : "") + ">" + escapeHtml(op.label) + "</option>";
        }).join("");
      }
      if (next == null) {
        el.value = "";
      } else if (type === "number" && Number.isFinite(Number(next))) {
        el.value = String(Number(next));
      } else {
        el.value = String(next);
      }
    }

    function syncInputsFromCurrent() {
      schema.forEach(function (fd) {
        var el = fieldEls[fd.key];
        if (!el) return;
        setInputForField(fd, el, current[fd.key]);
      });
    }

    function emitChange(fd, value, ev) {
      if (typeof cfg.onChange !== "function") return;
      cfg.onChange(clonePlainObject(current), {
        key: fd.key,
        value: value,
        field: fd,
        event: ev || null,
        api: api,
      });
    }

    function bindField(fd, el) {
      if (!fd || !el) return;
      var eventName = normalizeFieldType(fd.type) === "checkbox" || normalizeFieldType(fd.type) === "select"
        ? "change"
        : "input";
      var handler = function (ev) {
        var raw = normalizeFieldType(fd.type) === "checkbox" ? Boolean(el.checked) : el.value;
        var prev = hasOwn(current, fd.key) ? current[fd.key] : "";
        var next = coerceFieldValue(fd, raw, prev, current);
        current[fd.key] = next;
        emitChange(fd, next, ev || null);
      };
      el.addEventListener(eventName, handler);
      if (eventName !== "change") el.addEventListener("change", handler);
    }

    function render() {
      if (disposed || !mountEl) return;
      applyCurrentDefaults();
      if (!schema.length) {
        mountEl.innerHTML = emptyText ? ("<div class='hint'>" + escapeHtml(emptyText) + "</div>") : "";
        fieldEls = Object.create(null);
        return;
      }
      mountEl.innerHTML = schema.map(buildFieldHtml).join("");
      fieldEls = Object.create(null);
      var els = mountEl.querySelectorAll("[data-config-key]");
      els.forEach(function (el) {
        var key = String(el.getAttribute("data-config-key") || "").trim();
        if (!key) return;
        var fd = getFieldByKey(key);
        if (!fd) return;
        fieldEls[key] = el;
        setInputForField(fd, el, current[key]);
        bindField(fd, el);
      });
    }

    function setSchema(nextSchema, nextConfig) {
      schema = normalizeFormSchema(nextSchema);
      if (nextConfig && typeof nextConfig === "object") {
        current = clonePlainObject(nextConfig);
      } else {
        applyCurrentDefaults();
      }
      render();
      return clonePlainObject(current);
    }

    function setConfig(nextConfig) {
      var next = nextConfig && typeof nextConfig === "object" ? nextConfig : {};
      Object.keys(next).forEach(function (k) {
        var fd = getFieldByKey(k);
        if (!fd) return;
        var prev = hasOwn(current, k) ? current[k] : "";
        current[k] = coerceFieldValue(fd, next[k], prev, current);
      });
      syncInputsFromCurrent();
      return clonePlainObject(current);
    }

    function getConfig() {
      return clonePlainObject(current);
    }

    function getFieldElement(key) {
      return fieldEls[String(key || "").trim()] || null;
    }

    function destroy() {
      disposed = true;
      fieldEls = Object.create(null);
    }

    var api = {
      getConfig: getConfig,
      setConfig: setConfig,
      setSchema: setSchema,
      getFieldElement: getFieldElement,
      destroy: destroy,
    };

    render();
    if (typeof cfg.onReady === "function") {
      try { cfg.onReady(api); } catch (err) {}
    }
    return api;
  }

  return {
    escapeHtml: escapeHtml,
    applySelectionState: applySelectionState,
    setActionButtonsVisibility: setActionButtonsVisibility,
    renderItemList: renderItemList,
    normalizeFormSchema: normalizeFormSchema,
    resolveFieldOptions: resolveFieldOptions,
    coerceFieldValue: coerceFieldValue,
    renderConfigForm: renderConfigForm,
  };
});

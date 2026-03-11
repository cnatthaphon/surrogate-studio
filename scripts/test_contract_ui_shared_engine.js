#!/usr/bin/env node
"use strict";

const assert = require("assert");
const uiEngine = require("../src/ui_shared_engine.js");

function parseTagAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z0-9_-]+)\s*=\s*(['"])([\s\S]*?)\2/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = m[3];
  }
  return attrs;
}

function makeClassList(rawClass) {
  const set = new Set();
  String(rawClass || "")
    .split(/\s+/)
    .map(function (x) { return String(x || "").trim(); })
    .filter(Boolean)
    .forEach(function (x) { set.add(x); });

  return {
    set: set,
    add: function (name) {
      this.set.add(String(name || "").trim());
    },
    remove: function (name) {
      this.set.delete(String(name || "").trim());
    },
    toggle: function (name, force) {
      const key = String(name || "").trim();
      const exists = this.set.has(key);
      if (typeof force === "boolean") {
        if (force) {
          this.set.add(key);
        } else {
          this.set.delete(key);
        }
        return force;
      }
      if (exists) {
        this.set.delete(key);
        return false;
      }
      this.set.add(key);
      return true;
    },
    contains: function (name) {
      return this.set.has(String(name || "").trim());
    },
    toString: function () {
      return Array.from(this.set).join(" ");
    },
  };
}

function createElement(tagName, attrs, rawClass) {
  const el = {
    tagName: String(tagName || "").toLowerCase(),
    attrs: Object.assign({}, attrs || {}),
    classList: makeClassList(rawClass || attrs.class || ""),
    listeners: Object.create(null),
    getAttribute: function (name) {
      return this.attrs[String(name || "")] || null;
    },
    setAttribute: function (name, value) {
      this.attrs[String(name || "")] = String(value == null ? "" : value);
      if (String(name || "") === "class") {
        this.classList = makeClassList(this.attrs.class || "");
      }
    },
    closest: function () {
      return null;
    },
    addEventListener: function (type, cb) {
      const t = String(type || "").trim();
      if (!t || typeof cb !== "function") return;
      if (!this.listeners[t]) this.listeners[t] = [];
      this.listeners[t].push(cb);
    },
    dispatchEvent: function (event) {
      const ev = Object.assign({}, event || {});
      const t = String(ev.type || "").trim();
      if (!t) return;
      const handlers = this.listeners[t] || [];
      handlers.forEach(function (h) {
        h(ev);
      });
    },
    click: function () {
      this.dispatchEvent({ type: "click", target: this });
    },
    keydown: function (ev) {
      this.dispatchEvent(Object.assign({ type: "keydown" }, ev || {}));
    },
  };
  return el;
}

function createFakeMount() {
  const mount = {
    _html: "",
    _rows: [],
    _buttons: [],
    _snapshot: "",
    get innerHTML() {
      return this._html;
    },
    set innerHTML(v) {
      this._html = String(v == null ? "" : v);
      this._snapshot = "";
    },
    _parseDom: function () {
      if (!this._html) {
        this._rows = [];
        this._buttons = [];
        this._snapshot = this._html;
        return;
      }
      const rows = [];
      const buttons = [];
      const tagRe = /<([a-zA-Z0-9-]+)\b([^>]*)>/g;
      let m = null;
      while ((m = tagRe.exec(this._html)) !== null) {
        const tag = String(m[1] || "").toLowerCase();
        const attrs = parseTagAttrs(m[2] || "");
        const cls = String(attrs.class || "").trim();
        if (tag === "div" && /\bleft-dataset-item\b/.test(cls)) {
          const hasItemId = Boolean(attrs["data-item-id"] || attrs["data-dataset-id"]);
          if (hasItemId) rows.push(createElement(tag, attrs, cls));
        }
        if (tag === "button" && attrs["data-item-action"] && attrs["data-item-id"]) {
          buttons.push(createElement(tag, attrs, cls));
        }
      }
      this._rows = rows;
      this._buttons = buttons;
      this._snapshot = this._html;
    },
    _ensureParsed: function () {
      if (this._snapshot !== this._html) this._parseDom();
    },
    querySelectorAll: function (selector) {
      this._ensureParsed();
      if (typeof selector !== "string") return [];
      const s = selector.trim();
      if (s.indexOf("button[data-item-action]") >= 0) return this._buttons;
      if (s.indexOf("button") >= 0) return this._buttons;
      return this._rows;
    },
  };
  return mount;
}

function main() {
  assert(uiEngine, "ui_shared_engine required");
  assert.strictEqual(typeof uiEngine.applySelectionState, "function", "applySelectionState missing");
  assert.strictEqual(typeof uiEngine.setActionButtonsVisibility, "function", "setActionButtonsVisibility missing");
  assert.strictEqual(typeof uiEngine.renderItemList, "function", "renderItemList missing");
  assert.strictEqual(typeof uiEngine.normalizeFormSchema, "function", "normalizeFormSchema missing");
  assert.strictEqual(typeof uiEngine.coerceFieldValue, "function", "coerceFieldValue missing");
  assert.strictEqual(typeof uiEngine.renderConfigForm, "function", "renderConfigForm missing");

  const emptyEl = { style: { display: "", }, disabled: false };
  const contentEl = { style: { display: "", }, disabled: false };
  const btnA = { style: { display: "", }, disabled: false };
  const btnB = { style: { display: "", }, disabled: false };

  uiEngine.applySelectionState({
    selected: false,
    emptyEl: emptyEl,
    contentEl: contentEl,
    disableWhenEmpty: [btnA, btnB],
  });
  assert.strictEqual(emptyEl.style.display, "", "empty should show when no selection");
  assert.strictEqual(contentEl.style.display, "none", "content should hide when no selection");
  assert.strictEqual(btnA.disabled, true, "button A should be disabled");
  assert.strictEqual(btnB.disabled, true, "button B should be disabled");

  uiEngine.applySelectionState({
    selected: true,
    emptyEl: emptyEl,
    contentEl: contentEl,
    disableWhenEmpty: [btnA, btnB],
  });
  assert.strictEqual(emptyEl.style.display, "none", "empty should hide on selection");
  assert.strictEqual(contentEl.style.display, "", "content should show on selection");
  assert.strictEqual(btnA.disabled, false, "button A should be enabled");

  const actionContainer = { style: { display: "" } };
  uiEngine.setActionButtonsVisibility({
    containerEl: actionContainer,
    buttons: [
      { el: btnA, visible: false },
      { el: btnB, visible: true },
    ],
  });
  assert.strictEqual(btnA.style.display, "none", "button A display mismatch");
  assert.strictEqual(btnB.style.display, "", "button B display mismatch");
  assert.strictEqual(actionContainer.style.display, "", "container should be visible");

  const mount = createFakeMount();
  uiEngine.renderItemList({
    mountEl: mount,
    emptyText: "No rows",
    items: [],
  });
  assert(mount.innerHTML.includes("No rows"), "empty render text missing");

  const mount2 = createFakeMount();
  const opened = [];
  const normalizedRows = uiEngine.renderItemList({
    mountEl: mount2,
    items: [
      { id: "a1", title: "Item A", metaLines: ["m1"], actions: [{ id: "rename", label: "Rename" }] },
      { id: "b2", title: "Item B", metaLines: ["m2"], actions: [] },
    ],
    onOpen: function (id) {
      opened.push(String(id || ""));
    },
    onAction: function () {},
  });
  assert(normalizedRows.itemById && normalizedRows.itemById.a1, "itemById missing for a1");
  assert(normalizedRows.itemById && normalizedRows.itemById.b2, "itemById missing for b2");
  const items = mount2.querySelectorAll(".left-dataset-item[data-item-id]");
  assert.strictEqual(items.length, 2, "should render two item rows");
  assert.strictEqual(items[0].classList.contains("active"), false, "initial active state should start false unless configured");

  items[1].click();
  assert.strictEqual(items[1].classList.contains("active"), true, "clicked row should become active");
  assert.strictEqual(items[0].classList.contains("active"), false, "other row should not stay active");
  assert.deepStrictEqual(opened, ["b2"], "onOpen should receive clicked row id");

  items[0].click();
  assert.strictEqual(items[0].classList.contains("active"), true, "second click should switch active row");
  assert.strictEqual(items[1].classList.contains("active"), false, "previous row should remove active");
  assert.deepStrictEqual(opened, ["b2", "a1"], "onOpen should be called on each row click");

  const mount3 = createFakeMount();
  const mounted3Items = uiEngine.renderItemList({
    mountEl: mount3,
    items: [
      { id: "x1", title: "Active One", active: true, actions: [] },
      { id: "x2", title: "Inactive Two", actions: [] },
    ],
    onOpen: function () {},
    onAction: function () {},
  });
  const items3 = mount3.querySelectorAll(".left-dataset-item[data-item-id]");
  const hitX1 = items3.find(function (el) {
    return String(el.getAttribute("data-item-id") || "") === "x1";
  });
  const hitX2 = items3.find(function (el) {
    return String(el.getAttribute("data-item-id") || "") === "x2";
  });
  assert(hitX1 && hitX1.classList.contains("active"), "active row from schema should render as active");
  assert(hitX2 && !hitX2.classList.contains("active"), "non-active row should not render active");
  assert.strictEqual(Object.keys(mounted3Items.itemById || {}).length, 2, "itemById should map all rows");

  const normalized = uiEngine.normalizeFormSchema([
    { key: "epochs", label: "Epochs", type: "number" },
    { key: "runtime", type: "dropdown", options: [{ value: "js", label: "JS" }] },
    { key: "enabled", type: "bool" },
  ]);
  assert.strictEqual(normalized.length, 3, "normalized field count mismatch");
  assert.strictEqual(normalized[1].type, "select", "dropdown should normalize to select");
  assert.strictEqual(normalized[2].type, "checkbox", "bool should normalize to checkbox");

  const nval = uiEngine.coerceFieldValue({ type: "number" }, "12.5", 0, {});
  assert.strictEqual(nval, 12.5, "number coercion failed");
  const bval = uiEngine.coerceFieldValue({ type: "checkbox" }, 0, true, {});
  assert.strictEqual(bval, false, "checkbox coercion failed");

  console.log("PASS test_contract_ui_shared_engine");
}

try {
  main();
} catch (err) {
  console.error("FAIL test_contract_ui_shared_engine:", err && err.stack ? err.stack : err);
  process.exit(1);
}

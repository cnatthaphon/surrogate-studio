"use strict";
var assert = require("assert");
var LRC = require("../src/layout_renderer_core.js");

function main() {
  assert(LRC, "module loaded");

  // --- TAB_DEFS ---
  assert(Array.isArray(LRC.TAB_DEFS));
  assert.strictEqual(LRC.TAB_DEFS.length, 6);
  var tabIds = LRC.TAB_DEFS.map(function (t) { return t.id; });
  assert.deepStrictEqual(tabIds, ["playground", "dataset", "model", "trainer", "generation", "evaluation"]);

  // --- CSS ---
  assert(typeof LRC.CSS === "string");
  assert(LRC.CSS.length > 100, "CSS content present");
  assert(LRC.CSS.indexOf("osc-root") >= 0, "CSS contains root class");
  assert(LRC.CSS.indexOf("osc-tab-btn") >= 0, "CSS contains tab button class");
  assert(LRC.CSS.indexOf("osc-workspace") >= 0, "CSS contains workspace class");
  assert(LRC.CSS.indexOf("osc-panel-left") >= 0, "CSS contains panel class");

  // --- render requires DOM (skip in headless) ---
  // verify render is a function
  assert.strictEqual(typeof LRC.render, "function");

  console.log("PASS test_contract_layout_renderer_core");
}

main();

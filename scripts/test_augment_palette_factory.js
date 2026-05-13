"use strict";
// #183 P1 regression: palette → factory → node data must use the new
// hflipProb/vflipProb shape, not the legacy transform/probability fields.
//
// Reviewer reproduced: schema_definitions_builtin.js passed hflipProb/vflipProb
// to the factory, but addAugmentImageNode (and bbox/mask) read transform/
// probability and wrote the OLD shape into node data. The builder then read
// hflipProb (missing, default 0) → silent no-op augment. User clicked
// AugmentImage from the palette, got a no-op layer.
//
// This test wires the palette config through createNodeByType() with a
// minimal stub editor and asserts the resulting node data carries the new
// fields. Also covers the back-compat path (legacy { transform, probability }
// translates correctly).
var path = require("path");
global.window = global;
global.OSCDatasetModules = { registerModule: function () {}, registerModules: function () {} };
var sr = require(path.join(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
// Minimal stub API — the augment factories only need the editor-side
// shims. Other handlers in the runtime aren't exercised by this test.
function _noop() {}
var MGC = require(path.join(__dirname, "..", "src/model_graph_core.js")).createRuntime({
  clamp: function (v, lo, hi) { v = Number(v); if (v < lo) return lo; if (v > hi) return hi; return v; },
  resolveSchemaId: function (s) { return s || "test"; },
  getCurrentSchemaId: function () { return "test"; },
  getSchemaPresetDefById: function () { return null; },
  normalizeOutputTargetsList: function () { return []; },
  outputTargetsSummaryText: function () { return ""; },
  clearEditor: _noop,
  normalizeHistorySeriesKey: function (k) { return k; },
  historySeriesLabel: function (k) { return k; },
  getFeatureNodesMeta: function () { return []; },
  getImageSourceSpec: function () { return null; },
  normalizeParamMask: function () { return {}; },
  defaultParamMask: function () { return {}; },
  oneHotLabel: function () { return null; },
  normalizeOneHotKey: function (k) { return k; },
  countStaticParams: function () { return 0; },
  estimateNodeFeatureWidth: function () { return 0; },
});

// Stub editor that just records what addNode was called with — no DOM.
function makeStubEditor() {
  var nodes = [];
  return {
    addNode: function (name, ins, outs, x, y, cls, data, html) {
      nodes.push({ name: name, data: data, html: html, x: x, y: y });
      return nodes.length;  // return a fake node id
    },
    _nodes: nodes,
  };
}

var ok = true;
function fail(m) { console.error("  FAIL: " + m); ok = false; }
function assertEq(label, got, want) {
  if (got !== want) fail(label + ": expected " + JSON.stringify(want) + ", got " + JSON.stringify(got));
}

// Test 1: palette default for augment_image → node data has hflipProb=0.5, vflipProb=0
console.log("Test 1: createNodeByType('augment_image', palette-default) writes hflipProb/vflipProb");
var ed1 = makeStubEditor();
MGC.createNodeByType(ed1, "augment_image", 0, 0, { hflipProb: 0.5, vflipProb: 0, seedLink: "", layout: "auto" }, "test");
var n1 = ed1._nodes[0];
assertEq("name", n1.name, "augment_image_layer");
assertEq("hflipProb", n1.data.hflipProb, 0.5);
assertEq("vflipProb", n1.data.vflipProb, 0);
assertEq("layout",    n1.data.layout, "auto");
if (n1.data.transform !== undefined) fail("legacy 'transform' field must not appear in node data");
if (n1.data.probability !== undefined) fail("legacy 'probability' field must not appear in node data");
if (ok) console.log("  ✓ palette-default augment_image produces hflipProb=0.5, vflipProb=0, no legacy fields");

// Test 2: augment_bbox palette default
console.log("Test 2: createNodeByType('augment_bbox', palette-default) writes hflipProb/vflipProb");
var ed2 = makeStubEditor();
MGC.createNodeByType(ed2, "augment_bbox", 0, 0, { hflipProb: 0.5, vflipProb: 0, seedLink: "", imageWidth: 32, imageHeight: 32, format: "x0y0x1y1" }, "test");
var n2 = ed2._nodes[0];
assertEq("bbox hflipProb", n2.data.hflipProb, 0.5);
assertEq("bbox vflipProb", n2.data.vflipProb, 0);
assertEq("bbox format",    n2.data.format, "x0y0x1y1");
assertEq("bbox imageWidth", n2.data.imageWidth, 32);
if (n2.data.transform !== undefined) fail("bbox: legacy 'transform' must not appear");

// Test 3: augment_mask palette default
console.log("Test 3: createNodeByType('augment_mask', palette-default) writes hflipProb/vflipProb");
var ed3 = makeStubEditor();
MGC.createNodeByType(ed3, "augment_mask", 0, 0, { hflipProb: 0.5, vflipProb: 0, seedLink: "", layout: "auto" }, "test");
var n3 = ed3._nodes[0];
assertEq("mask hflipProb", n3.data.hflipProb, 0.5);
assertEq("mask vflipProb", n3.data.vflipProb, 0);
assertEq("mask layout",    n3.data.layout, "auto");
if (n3.data.transform !== undefined) fail("mask: legacy 'transform' must not appear");

// Test 4: back-compat — legacy { transform: "horizontal_flip", probability: 0.5 } translates
console.log("Test 4: legacy { transform, probability } translates to new shape (back-compat)");
var ed4 = makeStubEditor();
MGC.createNodeByType(ed4, "augment_image", 0, 0, { transform: "horizontal_flip", probability: 0.5 }, "test");
var n4 = ed4._nodes[0];
assertEq("legacy hflip → hflipProb", n4.data.hflipProb, 0.5);
assertEq("legacy hflip → vflipProb", n4.data.vflipProb, 0);

var ed5 = makeStubEditor();
MGC.createNodeByType(ed5, "augment_image", 0, 0, { transform: "vertical_flip", probability: 0.7 }, "test");
var n5 = ed5._nodes[0];
assertEq("legacy vflip → hflipProb", n5.data.hflipProb, 0);
assertEq("legacy vflip → vflipProb", n5.data.vflipProb, 0.7);

// Test 5: both transforms enabled — node data carries both
console.log("Test 5: hflipProb=0.5, vflipProb=0.5 both stored");
var ed6 = makeStubEditor();
MGC.createNodeByType(ed6, "augment_image", 0, 0, { hflipProb: 0.5, vflipProb: 0.5 }, "test");
var n6 = ed6._nodes[0];
assertEq("both hflipProb", n6.data.hflipProb, 0.5);
assertEq("both vflipProb", n6.data.vflipProb, 0.5);

// Test 6: HTML summary shows BOTH probabilities (reviewer asked for this)
console.log("Test 6: HTML summary displays both probabilities");
if (n6.html.indexOf("hflip=0.5") < 0) fail("HTML summary should contain hflip=0.5");
if (n6.html.indexOf("vflip=0.5") < 0) fail("HTML summary should contain vflip=0.5");
if (ok) console.log("  ✓ HTML summary shows hflip=0.5, vflip=0.5");

// Test 7: clamping — invalid probs go to 0 (or 1 for >1)
console.log("Test 7: probability clamps (negative → 0, >1 → 1, NaN → 0)");
var ed7 = makeStubEditor();
MGC.createNodeByType(ed7, "augment_image", 0, 0, { hflipProb: -0.5, vflipProb: 5 }, "test");
var n7 = ed7._nodes[0];
assertEq("negative clamps to 0", n7.data.hflipProb, 0);
assertEq(">1 clamps to 1",       n7.data.vflipProb, 1);

if (ok) console.log("\nPASS: palette → factory writes the new hflipProb/vflipProb shape; back-compat works.");
else { console.error("\nFAIL: at least one assertion failed."); process.exit(1); }

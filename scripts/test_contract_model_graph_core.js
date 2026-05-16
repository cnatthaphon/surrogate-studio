#!/usr/bin/env node
"use strict";

const assert = require("assert");
const schemaRegistry = require("../src/schema_registry.js");
require("../src/schema_definitions_builtin.js");
const modelGraphCore = require("../src/model_graph_core.js");

function defaultParamMask() {
  return {
    m: true,
    c: true,
    k: true,
    e: true,
    x0: true,
    v0: true,
    gm: true,
    gk: true,
    gc: true,
    rkm: false,
    rcm: false,
    rgl: false,
  };
}

function normalizeParamMask(mask) {
  const base = defaultParamMask();
  const out = Object.assign({}, base);
  if (!mask || typeof mask !== "object") return out;
  Object.keys(base).forEach((key) => {
    out[key] = Boolean(mask[key]);
  });
  return out;
}

function countStaticParams(mask) {
  return Object.values(normalizeParamMask(mask)).filter(Boolean).length;
}

function normalizeOutputTargetsList(rawTargets, fallbackTargets, schemaId) {
  const allowed = schemaRegistry.getOutputKeys(schemaId);
  const fallback = Array.isArray(fallbackTargets) ? fallbackTargets : [fallbackTargets];
  const values = Array.isArray(rawTargets) ? rawTargets : String(rawTargets == null ? "" : rawTargets).split(",");
  const normalized = values
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => item && allowed.map(function(o){return typeof o === "object" ? o.key : o;}).includes(item));
  if (normalized.length) return normalized;
  return fallback
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => item && allowed.map(function(o){return typeof o === "object" ? o.key : o;}).includes(item));
}

function outputTargetsSummaryText(targets, schemaId) {
  return normalizeOutputTargetsList(targets, ["x"], schemaId).join("+") || "x";
}

function resolveSchemaId(schemaId) {
  const sid = String(schemaId || "").trim();
  return schemaRegistry.getSchema(sid) ? sid : schemaRegistry.getDefaultSchemaId();
}

function getImageSourceSpec(sourceKey, schemaId) {
  const entry = schemaRegistry.getSchema(resolveSchemaId(schemaId));
  const features = Array.isArray(entry && entry.model && entry.model.inputs) ? entry.model.inputs : [];
  const requested = String(sourceKey || "").trim();
  const imageFeatures = features.filter((item) => String(item && item.type || "").trim() === "image");
  const hit = imageFeatures.find((item) => String((item && item.key) || "").trim() === requested) || imageFeatures[0] || {};
  const shape = Array.isArray(hit.shape) ? hit.shape.slice() : [28, 28, 1];
  return {
    sourceKey: String(hit.key || requested || "pixel_values"),
    label: String(hit.label || hit.key || requested || "pixel_values"),
    width: Math.max(1, Number(shape[1] || shape[0] || 28)),
    height: Math.max(1, Number(shape[0] || 28)),
    channels: Math.max(1, Number(shape[2] || 1)),
    shape: [Math.max(1, Number(shape[0] || 28)), Math.max(1, Number(shape[1] || shape[0] || 28)), Math.max(1, Number(shape[2] || 1))],
    featureSize: Math.max(1, Number((shape[0] || 28) * (shape[1] || shape[0] || 28) * (shape[2] || 1))),
  };
}

function createRuntime() {
  return modelGraphCore.createRuntime({
    clamp: (v, a, b) => Math.max(a, Math.min(b, Number(v))),
    clearEditor: () => {},
    countStaticParams,
    defaultParamMask,
    estimateNodeFeatureWidth: () => 9,
    getCurrentSchemaId: () => "oscillator",
    getImageSourceSpec,
    getSchemaPresetDefById: (schemaId, presetId) => {
      const modelSchema = schemaRegistry.getModelSchema(schemaId);
      const defs = Array.isArray(modelSchema && modelSchema.presets) ? modelSchema.presets : [];
      return defs.find((item) => String((item && item.id) || "") === String(presetId || "")) || null;
    },
    historySeriesLabel: (key) => String(key || ""),
    normalizeHistorySeriesKey: (key) => String(key || "x"),
    normalizeOneHotKey: (key) => String(key || "scenario"),
    normalizeOutputTargetsList,
    normalizeParamMask,
    oneHotLabel: (key) => String(key || ""),
    outputTargetsSummaryText,
    resolveSchemaId,
  });
}

function main() {
  const runtime = createRuntime();

  const outputSpec = runtime.getNodeConfigSpec({
    name: "output_layer",
    data: { target: "label", targetType: "label", loss: "cross_entropy" },
  }, "mnist");
  assert(Array.isArray(outputSpec) && outputSpec.length >= 2, "output config spec should exist");
  assert(outputSpec.some((item) => item && item.key === "targetType"), "output spec should expose targetType");
  assert(outputSpec.some((item) => item && item.key === "loss"), "output spec should expose loss");

  const paramsSpec = runtime.getNodeConfigSpec({
    name: "params_block",
    data: { paramMask: normalizeParamMask({ m: true, c: false }) },
  }, "oscillator");
  const grid = paramsSpec.find((item) => item && item.kind === "checkbox_grid");
  assert(grid && Array.isArray(grid.items) && grid.items.length >= 12, "params config should expose checkbox grid");

  const outputUpdate = runtime.applyNodeConfigValue(
    { name: "output_layer", data: { target: "x", targetType: "x", loss: "mse" } },
    "targetType",
    "label",
    "mnist"
  );
  assert.strictEqual(outputUpdate.handled, true, "targetType update should be handled");
  assert.strictEqual(outputUpdate.data.target, "label");
  assert.strictEqual(outputUpdate.data.targetType, "label");

  const imageUpdate = runtime.applyNodeConfigValue(
    { name: "image_source_block", data: { imageHeight: 28, imageWidth: 28, imageChannels: 1 } },
    "imageChannels",
    3,
    "mnist"
  );
  assert.strictEqual(imageUpdate.handled, true, "image channel update should be handled");
  assert.deepStrictEqual(imageUpdate.data.imageShape, [28, 28, 3], "image shape should update with channels");

  const concatUpdate = runtime.applyNodeConfigValue(
    { name: "concat_block", data: { numInputs: 5 } },
    "numInputs",
    8,
    "oscillator"
  );
  assert.strictEqual(concatUpdate.handled, true, "concat update should be handled");
  assert(concatUpdate.operation && concatUpdate.operation.type === "set_concat_inputs", "concat update should emit special operation");

  // Stash the data object so mutations from addNodeInput / removeNodeInput
  // / updateNodeDataFromId persist across export() calls. The previous
  // version of this mock returned a fresh object literal per export, so
  // mutations evaporated between calls — that hid a real assertion about
  // port-count syncing across consecutive target switches.
  const fakeGraphData = {
    "1": {
      name: "window_hist_block",
      data: { windowSize: 12, stride: 2, lagMode: "exact", lagCsv: "1,3,5", padMode: "edge" },
      inputs: {},
      outputs: { output_1: { connections: [{ node: "2", output: "output_1" }] } },
    },
    "2": {
      name: "input_layer",
      data: { mode: "auto" },
      inputs: { input_1: { connections: [{ node: "1", output: "output_1" }] } },
      outputs: { output_1: { connections: [{ node: "3", output: "output_1" }] } },
    },
    "3": {
      name: "dense_layer",
      data: { units: 32, activation: "relu" },
      inputs: { input_1: { connections: [{ node: "2", output: "output_1" }] } },
      outputs: { output_1: { connections: [{ node: "4", output: "output_1" }] } },
    },
    "4": {
      name: "output_layer",
      data: { target: "label", targetType: "label", loss: "cross_entropy", wx: 1, wv: 1 },
      inputs: { input_1: { connections: [{ node: "3", output: "output_1" }] } },
      outputs: {},
    },
  };
  const fakeEditor = {
    export() { return { drawflow: { Home: { data: fakeGraphData } } }; },
  };

  assert.strictEqual(runtime.inferGraphMode(fakeEditor, "direct"), "autoregressive", "window history should infer autoregressive mode");
  assert.strictEqual(runtime.inferWindow(fakeEditor, 20), 12, "window inference should read window history node");
  const arCfg = runtime.inferArHistoryConfig(fakeEditor, 20);
  assert.deepStrictEqual(arCfg, { windowSize: 3, stride: 2, lagMode: "exact", lags: [1, 3, 5], padMode: "edge" }, "AR history config should parse exact lags");
  const heads = runtime.inferOutputHeads(fakeEditor, "x", "mnist");
  assert(Array.isArray(heads) && heads.length === 1, "output head inference should detect one head");
  assert.strictEqual(heads[0].target, "label", "output head inference should keep schema-valid classification target");
  assert.strictEqual(runtime.inferTargetMode(fakeEditor, "x"), "x", "target mode remains x-compatible for non-trajectory heads");

  // Editor-shape dispatch (the call shape used by the right-panel form in
  // src/tabs/model_tab.js). Before the dispatch fix, this call coerced the
  // editor object onto `node`, the nodeId onto `key`, and every onChange
  // silently did nothing. Now applyNodeConfigValue sniffs arg0 for the
  // Drawflow API surface and (a) resolves the node from editor.export(),
  // (b) commits via editor.updateNodeDataFromId, (c) flips the output_layer
  // input port count when target == "custom" via addNodeInput/removeNodeInput.
  let editorWriteCalls = 0;
  let lastWrite = null;
  let portOps = [];
  const editorWithApi = {
    export: fakeEditor.export,
    updateNodeDataFromId(id, data) {
      editorWriteCalls += 1;
      lastWrite = { id: String(id), data: data };
      const bag = fakeEditor.export().drawflow.Home.data;
      if (bag[String(id)]) bag[String(id)].data = data;
    },
    addNodeInput(id) {
      portOps.push({ op: "add", id: String(id) });
      const bag = fakeEditor.export().drawflow.Home.data;
      const node = bag[String(id)];
      if (!node) return;
      const inputs = node.inputs || (node.inputs = {});
      const idx = Object.keys(inputs).length + 1;
      inputs["input_" + idx] = { connections: [] };
    },
    removeNodeInput(id, key) {
      portOps.push({ op: "remove", id: String(id), key: key });
      const bag = fakeEditor.export().drawflow.Home.data;
      const node = bag[String(id)];
      if (node && node.inputs) delete node.inputs[key];
    },
  };

  // Plain field edit (units on dense) — verify the dispatch picks the right
  // branch and commits.
  const denseRes = runtime.applyNodeConfigValue(editorWithApi, "3", "units", 77, "mnist");
  assert.strictEqual(denseRes.handled, true, "editor-shape dense units should be handled");
  assert.strictEqual(editorWriteCalls, 1, "editor.updateNodeDataFromId should be called once after dense update");
  assert.strictEqual(lastWrite && lastWrite.data && lastWrite.data.units, 77, "dense units should be written");

  // Custom target switch — verify (a) data.targetType == 'custom', (b) the
  // input port grows from 1 to 2.
  portOps = [];
  const customRes = runtime.applyNodeConfigValue(editorWithApi, "4", "targetType", "custom", "mnist");
  assert.strictEqual(customRes.handled, true, "editor-shape custom target should be handled");
  assert.strictEqual(customRes.data && customRes.data.targetType, "custom", "custom should not be filtered out by normalize step");
  const addOps = portOps.filter((o) => o.op === "add");
  assert(addOps.length === 1, "switching to custom should add exactly 1 input port (added " + addOps.length + ")");

  // Switch back to a normal schema target — second input port should be
  // removed (port has no connections in our fake editor).
  portOps = [];
  const revertRes = runtime.applyNodeConfigValue(editorWithApi, "4", "targetType", "label", "mnist");
  assert.strictEqual(revertRes.handled, true, "revert target should be handled");
  assert.strictEqual(revertRes.data && revertRes.data.targetType, "label", "schema target should round-trip");
  const removeOps = portOps.filter((o) => o.op === "remove");
  assert(removeOps.length === 1, "switching back from custom should remove the extra input port (removed " + removeOps.length + ")");

  console.log("PASS test_contract_model_graph_core");
}

try {
  main();
} catch (err) {
  console.error("FAIL test_contract_model_graph_core:", err && err.stack ? err.stack : err);
  process.exit(1);
}

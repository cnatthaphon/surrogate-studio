#!/usr/bin/env node
"use strict";

const assert = require("assert");
const graphUiCore = require("../src/graph_ui_core.js");

function makeEditor(moduleData) {
  const updates = [];
  return {
    updates,
    zoom: 1,
    canvas_x: 0,
    canvas_y: 0,
    precanvas: { style: {} },
    export() {
      return { drawflow: { Home: { data: moduleData } } };
    },
    updateConnectionNodes(id) {
      updates.push(id);
    },
  };
}

function makeDocument(ids) {
  const nodeEls = {};
  ids.forEach((id, idx) => {
    nodeEls["node-" + id] = {
      id: "node-" + id,
      style: {},
      offsetWidth: 180,
      offsetHeight: 90,
      getBoundingClientRect() {
        const left = 40 + idx * 220;
        const top = 30 + idx * 40;
        return { left, top, right: left + 180, bottom: top + 90, width: 180, height: 90 };
      },
    };
  });
  return {
    getElementById(id) {
      return nodeEls[id] || null;
    },
    querySelector(selector) {
      const m = String(selector || "").match(/^#node-(.+?) \.node-summary$/);
      if (!m) return null;
      return { textContent: "" };
    },
  };
}

function makeContainer() {
  return {
    clientWidth: 1280,
    clientHeight: 720,
    querySelector(sel) {
      if (sel === ".precanvas") return { style: {} };
      return null;
    },
    querySelectorAll(sel) {
      if (sel !== ".drawflow-node") return [];
      return [
        {
          getBoundingClientRect() {
            return { left: 50, top: 50, right: 230, bottom: 140, width: 180, height: 90 };
          },
        },
        {
          getBoundingClientRect() {
            return { left: 320, top: 140, right: 500, bottom: 230, width: 180, height: 90 };
          },
        },
      ];
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1280, height: 720 };
    },
  };
}

function main() {
  const moduleData = {
    "1": {
      name: "window_hist_block",
      data: { windowSize: 12 },
      pos_x: 0,
      pos_y: 0,
      inputs: {},
      outputs: { output_1: { connections: [{ node: "2" }] } },
    },
    "2": {
      name: "concat_block",
      data: { numInputs: 2 },
      pos_x: 0,
      pos_y: 0,
      inputs: {
        input_1: { connections: [{ node: "1" }] },
      },
      outputs: { output_1: { connections: [{ node: "3" }] } },
    },
    "3": {
      name: "output_layer",
      data: { target: "x", loss: "mse" },
      pos_x: 0,
      pos_y: 0,
      inputs: {
        input_1: { connections: [{ node: "2" }] },
      },
      outputs: {},
    },
  };

  const editor = makeEditor(moduleData);
  const runtime = graphUiCore.createRuntime({
    clamp: (v, a, b) => Math.max(a, Math.min(b, Number(v))),
    countStaticParams: (mask) => Object.values(mask || {}).filter(Boolean).length,
    documentRef: makeDocument(Object.keys(moduleData)),
    getNodeSummary: (node) => "summary:" + String(node && node.name || ""),
    normalizeParamMask: (mask) => Object.assign({ m: false, c: false, k: false, e: false, x0: false, v0: false, gm: false, gk: false, gc: false, rkm: false, rcm: false, rgl: false }, mask || {}),
    requestAnimationFrameRef: (fn) => fn(),
    setTimeoutRef: (fn) => fn(),
  });

  assert.strictEqual(runtime.estimateNodeFeatureWidth(moduleData, "1", {}, {}), 12, "window history width should match window size");
  assert.strictEqual(runtime.estimateNodeFeatureWidth(moduleData, "2", {}, {}), 12, "concat width should accumulate upstream width");

  const moved = runtime.autoArrangeGraph(editor);
  assert(moved >= 3, "autoArrangeGraph should move nodes");
  assert(Number(moduleData["1"].pos_x) < Number(moduleData["2"].pos_x), "upstream node should be left of concat");
  assert(Number(moduleData["2"].pos_x) < Number(moduleData["3"].pos_x), "concat should be left of output");

  runtime.refreshNodeSummaries(editor);
  assert(editor.updates.length >= 3, "layout should update connection nodes");

  const container = makeContainer();
  const fitOk = runtime.fitGraphToViewport(editor, container);
  assert.strictEqual(fitOk, true, "fitGraphToViewport should succeed");
  const nudgeOk = runtime.nudgeGraphToViewportCenter(editor, container);
  assert.strictEqual(nudgeOk, true, "nudgeGraphToViewportCenter should succeed");
  runtime.scheduleFitGraphToViewport(editor, container);

  console.log("PASS test_contract_graph_ui_core");
}

try {
  main();
} catch (err) {
  console.error("FAIL test_contract_graph_ui_core:", err && err.stack ? err.stack : err);
  process.exit(1);
}

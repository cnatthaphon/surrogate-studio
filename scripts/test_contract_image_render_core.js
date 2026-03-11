#!/usr/bin/env node
"use strict";

const assert = require("assert");
const imageRenderCore = require("../src/image_render_core.js");

function makeCanvas() {
  const state = { imageData: null };
  return {
    width: 0,
    height: 0,
    state,
    getContext(kind) {
      if (kind !== "2d") return null;
      return {
        createImageData(w, h) {
          return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
        },
        putImageData(img) {
          state.imageData = img;
        },
      };
    },
  };
}

function main() {
  const canvases = {
    dataset_image_class_canvas_0: makeCanvas(),
    dataset_image_class_canvas_1: makeCanvas(),
  };
  const runtime = imageRenderCore.createRuntime({
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v))),
    createRng: () => () => 0,
    escapeHtml: (v) => String(v),
    documentRef: {
      getElementById(id) {
        return canvases[id] || null;
      },
    },
  });

  const sampleCanvas = makeCanvas();
  const pixels01 = new Float32Array(28 * 28);
  pixels01[0] = 0;
  pixels01[1] = 1;
  runtime.drawGrayscaleCanvas(sampleCanvas, pixels01, { shape: [28, 28, 1] });
  assert(sampleCanvas.state.imageData, "drawGrayscaleCanvas should write image data");
  assert.strictEqual(sampleCanvas.state.imageData.data[0], 0, "0 should map to black");
  assert.strictEqual(sampleCanvas.state.imageData.data[4], 255, "1 should map to white");

  const mountEl = { innerHTML: "" };
  const xs = [
    new Uint8Array(28 * 28).fill(0),
    new Uint8Array(28 * 28).fill(255),
  ];
  const ys = [0, 1];
  const out = runtime.renderImageClassGrid({
    mountEl,
    split: "train",
    xs,
    ys,
    classNames: ["zero", "one"],
    randomize: false,
    seed: 42,
    idPrefix: "dataset_image_class_canvas",
    shape: [28, 28, 1],
  });
  assert.strictEqual(out.rendered, true, "renderImageClassGrid should render when samples exist");
  assert(mountEl.innerHTML.includes("class 0 (zero)"), "grid should render first class label");
  assert(mountEl.innerHTML.includes("class 1 (one)"), "grid should render second class label");
  assert(canvases.dataset_image_class_canvas_0.state.imageData, "grid should draw first class sample");
  assert(canvases.dataset_image_class_canvas_1.state.imageData, "grid should draw second class sample");

  console.log("PASS test_contract_image_render_core");
}

try {
  main();
} catch (err) {
  console.error("FAIL test_contract_image_render_core:", err && err.stack ? err.stack : err);
  process.exit(1);
}

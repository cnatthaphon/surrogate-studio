#!/usr/bin/env node
"use strict";

const assert = require("assert");
const imageRenderCore = require("../src/image_render_core.js");

(function main() {
  // Verify exports exist
  assert.ok(typeof imageRenderCore.drawImageToCanvas === "function", "drawImageToCanvas must be a function");
  assert.ok(typeof imageRenderCore.renderDatasetResult === "function", "renderDatasetResult must be a function");

  // Test drawImageToCanvas with a mock canvas 2D context
  var putCalls = [];
  var mockCtx = {
    fillStyle: "",
    fillRect: function () {},
    createImageData: function (w, h) {
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    putImageData: function (imgData, x, y) {
      putCalls.push({ width: imgData.width, height: imgData.height, x: x, y: y });
    },
  };
  var pixels = [0.0, 0.5, 1.0, 0.25]; // 4 pixels for 2x2 grayscale
  imageRenderCore.drawImageToCanvas(mockCtx, pixels, 2, 2, { scale: 1 });
  assert.ok(putCalls.length >= 1, "should call putImageData at least once, got " + putCalls.length);

  console.log("PASS test_contract_image_render_core");
})();

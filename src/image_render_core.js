(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCImageRenderCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function fallbackEscapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fallbackCreateRng(seed) {
    var s = Number(seed);
    if (!Number.isFinite(s)) s = 42;
    s = (Math.floor(s) >>> 0) || 42;
    return function () {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function createRuntime(api) {
    if (!api || typeof api !== "object") {
      throw new Error("OSCImageRenderCore.createRuntime requires api.");
    }
    var clamp = typeof api.clamp === "function"
      ? api.clamp
      : function (v, lo, hi) { return Math.max(lo, Math.min(hi, Number(v))); };
    var escapeHtml = typeof api.escapeHtml === "function" ? api.escapeHtml : fallbackEscapeHtml;
    var createRng = typeof api.createRng === "function" ? api.createRng : fallbackCreateRng;
    var documentRef = api.documentRef || (typeof document !== "undefined" ? document : null);

    function normalizeShape(shape, pixels) {
      var width = 28;
      var height = 28;
      if (Array.isArray(shape) && shape.length >= 2) {
        width = Math.max(1, Math.floor(Number(shape[0]) || 28));
        height = Math.max(1, Math.floor(Number(shape[1]) || 28));
      } else if (shape && typeof shape === "object") {
        width = Math.max(1, Math.floor(Number(shape.width || shape.w) || 28));
        height = Math.max(1, Math.floor(Number(shape.height || shape.h) || 28));
      } else if (pixels && pixels.length === 28 * 28) {
        width = 28;
        height = 28;
      }
      return { width: width, height: height };
    }

    function drawGrayscaleCanvas(canvasEl, pixels, options) {
      if (!canvasEl || typeof canvasEl.getContext !== "function") return false;
      var px = pixels && (Array.isArray(pixels) || ArrayBuffer.isView(pixels)) ? pixels : [];
      var shape = normalizeShape(options && options.shape, px);
      var width = shape.width;
      var height = shape.height;
      if (canvasEl.width !== width) canvasEl.width = width;
      if (canvasEl.height !== height) canvasEl.height = height;
      var ctx = canvasEl.getContext("2d");
      if (!ctx || typeof ctx.createImageData !== "function") return false;
      var img = ctx.createImageData(width, height);
      var count = width * height;
      for (var i = 0; i < count; i += 1) {
        var raw = Number(px[i]) || 0;
        var c = raw <= 1
          ? Math.round(clamp(raw, 0, 1) * 255)
          : Math.round(clamp(raw, 0, 255));
        var j = i * 4;
        img.data[j] = c;
        img.data[j + 1] = c;
        img.data[j + 2] = c;
        img.data[j + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return true;
    }

    function renderImageClassGrid(cfg) {
      var config = cfg || {};
      var mountEl = config.mountEl || null;
      if (!mountEl) return { rendered: false, reason: "missing_mount" };
      var split = String(config.split || "train");
      var xs = Array.isArray(config.xs) ? config.xs : [];
      var ys = Array.isArray(config.ys) ? config.ys : [];
      var classNames = Array.isArray(config.classNames) && config.classNames.length
        ? config.classNames
        : ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
      var randomize = Boolean(config.randomize);
      var emptyText = String(config.emptyText || ("No samples in split '" + split + "' for class overview."));
      var idPrefix = String(config.idPrefix || "image_class_canvas");
      var shape = config.shape || [28, 28, 1];
      if (!xs.length || !ys.length) {
        mountEl.innerHTML = "<div class='hint'>" + escapeHtml(emptyText) + "</div>";
        return { rendered: false, reason: "empty_split" };
      }
      var byClass = {};
      for (var i = 0; i < ys.length; i += 1) {
        var lbl = Math.max(0, Math.min(classNames.length - 1, Math.floor(Number(ys[i]) || 0)));
        if (!byClass[lbl]) byClass[lbl] = [];
        byClass[lbl].push(i);
      }
      var rng = createRng(Number(config.seed || 42));
      var cards = [];
      var pickedByClass = {};
      for (var c = 0; c < classNames.length; c += 1) {
        var arr = byClass[c] || [];
        if (!arr.length) {
          cards.push(
            "<div class='panel' style='padding:8px;'>" +
              "<div class='hint'>class " + c + " (" + escapeHtml(String(classNames[c])) + ")</div>" +
              "<div class='hint'>no sample</div>" +
            "</div>"
          );
          continue;
        }
        var pickPos = randomize ? Math.floor(rng() * arr.length) : 0;
        var idx = arr[pickPos];
        pickedByClass[c] = idx;
        var canvasId = idPrefix + "_" + c;
        cards.push(
          "<div class='panel' style='padding:8px;'>" +
            "<div class='hint'>class " + c + " (" + escapeHtml(String(classNames[c])) + ")</div>" +
            "<canvas id='" + escapeHtml(canvasId) + "' width='" + Number(shape[0] || 28) + "' height='" + Number(shape[1] || 28) + "' style='width:84px; height:84px; image-rendering:pixelated; border:1px solid #334155; border-radius:6px; background:#020617;'></canvas>" +
            "<div class='hint'>idx=" + idx + " | n=" + arr.length + "</div>" +
          "</div>"
        );
      }
      mountEl.innerHTML =
        "<div style='display:grid; grid-template-columns: repeat(auto-fill,minmax(120px,1fr)); gap:8px;'>" +
        cards.join("") +
        "</div>";
      for (var k = 0; k < classNames.length; k += 1) {
        if (!Object.prototype.hasOwnProperty.call(pickedByClass, k)) continue;
        var canvas = documentRef && typeof documentRef.getElementById === "function"
          ? documentRef.getElementById(idPrefix + "_" + k)
          : null;
        drawGrayscaleCanvas(canvas, xs[pickedByClass[k]], { shape: shape });
      }
      return { rendered: true, pickedByClass: pickedByClass };
    }

    return {
      drawGrayscaleCanvas: drawGrayscaleCanvas,
      renderImageClassGrid: renderImageClassGrid,
    };
  }

  return {
    createRuntime: createRuntime,
  };
});

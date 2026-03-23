(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(typeof globalThis !== "undefined" ? globalThis : {});
    return;
  }
  root.OSCCifar10SourceLoader = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var IMAGE_W = 32;
  var IMAGE_H = 32;
  var IMAGE_CH = 3;
  var IMAGE_PIXELS = IMAGE_W * IMAGE_H; // 1024 pixels per image
  var IMAGE_SIZE = IMAGE_PIXELS * IMAGE_CH; // 3072 floats per image
  var NUM_CLASSES = 10;
  var CLASS_NAMES = [
    "airplane", "automobile", "bird", "cat", "deer",
    "dog", "frog", "horse", "ship", "truck",
  ];

  // Sprite-sheet format: PNG image 1024px wide, N rows (1 row = 1 image, 32x32 flattened).
  // Each pixel in PNG encodes RGB channels of one spatial pixel.
  // Labels: uint8 binary (one-hot, 10 bytes per image) or JSON array of integers.
  // GCS sprite (same pattern as MNIST — reliable CORS, all 60k images in one file)
  var GCS_URLS = {
    image: "https://storage.googleapis.com/learnjs-data/model-builder/cifar10_images.png",
    labels: "https://storage.googleapis.com/learnjs-data/model-builder/cifar10_labels_uint8",
  };

  // GitHub batch sprites (smaller, 10k per file — fallback)
  var BATCH_URLS = {
    train1: {
      image: "https://raw.githubusercontent.com/zqingr/tfjs-cifar10/master/src/datasets/data_batch_1.png",
      labels: "https://raw.githubusercontent.com/zqingr/tfjs-cifar10/master/src/datasets/train_lables.json",
      labelOffset: 0,
      count: 10000,
    },
  };

  var CACHE = null;

  var NODE_MODE = typeof root !== "object" || root === null
    ? false
    : (typeof process !== "undefined" && !!process.versions && !!process.versions.node);

  function clampInt(value, min, max) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = min;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }

  function createRng(seed) {
    var s = (Math.floor(seed) >>> 0) || 42;
    return function () { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  }

  // --- Browser: load sprite-sheet PNG and decode RGB pixels ---
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new root.Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Failed to load CIFAR-10 sprite: " + url)); };
      img.src = url;
    });
  }

  function fetchJSON(url) {
    return root.fetch(url).then(function (r) {
      if (!r.ok) throw new Error("Fetch failed: " + r.status + " " + url);
      return r.json();
    });
  }

  // Decode sprite: each row = 1 image (1024 pixels wide = 32*32), PNG stores RGB.
  // Canvas getImageData gives RGBA, we extract R, G, B into HWC format.
  function decodeSpriteRGB(img) {
    var width = img.naturalWidth || img.width;
    var height = img.naturalHeight || img.height;
    if (width !== IMAGE_PIXELS) {
      throw new Error("CIFAR-10 sprite width expected " + IMAGE_PIXELS + ", got " + width);
    }
    var numImages = height;
    // Pixels stored as HWC (R,G,B per pixel) — 3072 bytes per image
    var pixels = new Uint8Array(numImages * IMAGE_SIZE);

    var canvas = root.document.createElement("canvas");
    var chunkRows = 1000;
    canvas.width = width;
    canvas.height = chunkRows;
    var ctx = canvas.getContext("2d");

    for (var offset = 0; offset < numImages; offset += chunkRows) {
      var rows = Math.min(chunkRows, numImages - offset);
      if (canvas.height !== rows) canvas.height = rows;
      ctx.clearRect(0, 0, width, rows);
      ctx.drawImage(img, 0, offset, width, rows, 0, 0, width, rows);
      var imageData = ctx.getImageData(0, 0, width, rows);
      var src = imageData.data; // RGBA flat

      for (var r = 0; r < rows; r++) {
        var imgBase = (offset + r) * IMAGE_SIZE;
        var rowBase = r * width * 4;
        for (var p = 0; p < IMAGE_PIXELS; p++) {
          var srcIdx = rowBase + p * 4;
          pixels[imgBase + p * 3] = src[srcIdx];       // R
          pixels[imgBase + p * 3 + 1] = src[srcIdx + 1]; // G
          pixels[imgBase + p * 3 + 2] = src[srcIdx + 2]; // B
        }
      }
    }
    return { pixels: pixels, numImages: numImages };
  }

  // --- Load a single batch (sprite + labels) ---
  function loadBatch(batchKey) {
    var batch = BATCH_URLS[batchKey];
    if (!batch) return Promise.reject(new Error("Unknown batch: " + batchKey));

    if (NODE_MODE) {
      // Node.js: no canvas/Image available — fall back to synthetic
      return Promise.resolve(null);
    }

    return Promise.all([
      loadImage(batch.image),
      fetchJSON(batch.labels),
    ]).then(function (parts) {
      var decoded = decodeSpriteRGB(parts[0]);
      var labelArray = parts[1]; // JSON array of integers

      // Extract only the labels for this batch
      var batchLabels = new Uint8Array(decoded.numImages);
      for (var i = 0; i < decoded.numImages; i++) {
        batchLabels[i] = clampInt(labelArray[batch.labelOffset + i] || 0, 0, 9);
      }

      return {
        pixels: decoded.pixels,
        labels: batchLabels,
        count: decoded.numImages,
      };
    });
  }

  // --- Load from GCS (full 60k, same pattern as MNIST) ---
  function loadFromGCS() {
    if (NODE_MODE) return Promise.reject(new Error("No canvas in Node.js"));
    return Promise.all([
      loadImage(GCS_URLS.image),
      fetchJSON(GCS_URLS.labels).catch(function () {
        // labels might be binary one-hot, try as ArrayBuffer
        return root.fetch(GCS_URLS.labels).then(function (r) { return r.arrayBuffer(); });
      }),
    ]).then(function (parts) {
      var decoded = decodeSpriteRGB(parts[0]);
      var rawLabels = parts[1];
      var labels;
      if (Array.isArray(rawLabels)) {
        // JSON array of integers
        labels = new Uint8Array(decoded.numImages);
        for (var i = 0; i < decoded.numImages; i++) labels[i] = clampInt(rawLabels[i] || 0, 0, 9);
      } else if (rawLabels instanceof ArrayBuffer) {
        // one-hot uint8: 10 bytes per image
        var raw = new Uint8Array(rawLabels);
        labels = new Uint8Array(decoded.numImages);
        for (var j = 0; j < decoded.numImages; j++) {
          var best = 0, bestV = 0;
          for (var c = 0; c < NUM_CLASSES; c++) {
            var v = raw[j * NUM_CLASSES + c] || 0;
            if (v > bestV) { bestV = v; best = c; }
          }
          labels[j] = best;
        }
      } else {
        throw new Error("Unknown label format");
      }
      return {
        pixels: decoded.pixels, labels: labels, count: decoded.numImages,
        source: "gcs_sprite", urls: GCS_URLS, originalTrainCount: 50000,
      };
    });
  }

  // --- Build source record ---
  function loadSource(options) {
    if (CACHE) return Promise.resolve(CACHE);
    var opts = options || {};

    function makeSource(batch) {
      return {
        variant: "cifar10", schemaId: "cifar10",
        imageShape: [IMAGE_W, IMAGE_H, IMAGE_CH], imageSize: IMAGE_SIZE,
        classCount: NUM_CLASSES, classNames: CLASS_NAMES.slice(),
        numExamples: batch.count, pixelsUint8: batch.pixels, labelsUint8: batch.labels,
        source: batch.source || "github_sprite",
        urls: batch.urls || { image: BATCH_URLS.train1.image, labels: BATCH_URLS.train1.labels },
        loadedAt: Date.now(), pixelLayout: "hwc",
        originalTrainCount: batch.originalTrainCount || Math.round(batch.count * 0.8333),
      };
    }

    // Try GCS (full 60k, reliable CORS) → GitHub batch (10k) → synthetic
    return loadFromGCS().then(function (batch) {
      console.log("[CIFAR-10] Loaded " + batch.count + " images from GCS");
      var source = makeSource(batch);
      CACHE = source;
      return source;
    }).catch(function (gcsErr) {
      console.warn("[CIFAR-10] GCS failed (" + (gcsErr && gcsErr.message || "") + "), trying GitHub...");
      return loadBatch("train1").then(function (batch) {
        if (!batch) throw new Error("Node fallback");
        console.log("[CIFAR-10] Loaded " + batch.count + " images from GitHub");
        var source = makeSource(batch);
        CACHE = source;
        return source;
      });
    }).catch(function (err) {
      console.warn("[CIFAR-10] All sources failed (" + (err && err.message || "") + "). Using synthetic patterns.");
      var source = buildSyntheticSource(opts);
      CACHE = source;
      return source;
    });
  }

  // --- Synthetic fallback (for Node.js headless tests & file:// ) ---
  // Generates class-distinctive geometric patterns so models CAN learn from them
  function buildSyntheticSource(options) {
    var opts = options || {};
    var total = clampInt(opts.totalExamples || opts.numExamples || 1000, 100, 60000);
    var seed = clampInt(opts.seed, 1, 2147483647);
    var rng = createRng(seed);

    // Each class gets a distinctive pattern: different shapes, positions, colors
    // This ensures a model can actually learn to classify them
    var classColors = [
      [200, 80, 80],   // 0: red — horizontal bar
      [80, 200, 80],   // 1: green — vertical bar
      [80, 80, 200],   // 2: blue — diagonal \
      [200, 200, 80],  // 3: yellow — diagonal /
      [200, 80, 200],  // 4: magenta — center dot
      [80, 200, 200],  // 5: cyan — border frame
      [200, 140, 80],  // 6: orange — top half
      [140, 80, 200],  // 7: purple — bottom half
      [80, 140, 80],   // 8: dark green — left half
      [200, 200, 200], // 9: white — checkerboard
    ];

    var pixels = new Uint8Array(total * IMAGE_SIZE);
    var labels = new Uint8Array(total);

    for (var i = 0; i < total; i++) {
      var cls = Math.floor(rng() * NUM_CLASSES);
      labels[i] = cls;
      var fg = classColors[cls];
      var off = i * IMAGE_SIZE;
      var noiseAmt = 30;

      for (var y = 0; y < IMAGE_H; y++) {
        for (var x = 0; x < IMAGE_W; x++) {
          var p = y * IMAGE_W + x;
          var isFg = false;

          // class-distinctive patterns
          switch (cls) {
            case 0: isFg = (y >= 12 && y <= 19); break; // horizontal bar
            case 1: isFg = (x >= 12 && x <= 19); break; // vertical bar
            case 2: isFg = (Math.abs(x - y) <= 3); break; // diagonal
            case 3: isFg = (Math.abs(x - (31 - y)) <= 3); break; // anti-diagonal
            case 4: isFg = ((x - 16) * (x - 16) + (y - 16) * (y - 16) <= 64); break; // circle
            case 5: isFg = (x <= 3 || x >= 28 || y <= 3 || y >= 28); break; // border
            case 6: isFg = (y <= 15); break; // top half
            case 7: isFg = (y >= 16); break; // bottom half
            case 8: isFg = (x <= 15); break; // left half
            case 9: isFg = ((x + y) % 4 < 2); break; // checkerboard
          }

          var r, g, b;
          if (isFg) {
            r = clampInt(fg[0] + (rng() - 0.5) * noiseAmt, 0, 255);
            g = clampInt(fg[1] + (rng() - 0.5) * noiseAmt, 0, 255);
            b = clampInt(fg[2] + (rng() - 0.5) * noiseAmt, 0, 255);
          } else {
            // dark background with slight class tint
            r = clampInt(20 + fg[0] * 0.1 + (rng() - 0.5) * 15, 0, 255);
            g = clampInt(20 + fg[1] * 0.1 + (rng() - 0.5) * 15, 0, 255);
            b = clampInt(20 + fg[2] * 0.1 + (rng() - 0.5) * 15, 0, 255);
          }
          pixels[off + p * 3] = r;
          pixels[off + p * 3 + 1] = g;
          pixels[off + p * 3 + 2] = b;
        }
      }
    }

    return {
      variant: "cifar10", schemaId: "cifar10",
      imageShape: [IMAGE_W, IMAGE_H, IMAGE_CH], imageSize: IMAGE_SIZE,
      classCount: NUM_CLASSES, classNames: CLASS_NAMES.slice(),
      numExamples: total, pixelsUint8: pixels, labelsUint8: labels,
      source: "synthetic", urls: null, loadedAt: Date.now(), originalTrainCount: Math.round(total * 0.8333),
      synthetic: true, pixelLayout: "hwc",
    };
  }

  // Render one CIFAR-10 image (HWC uint8) to canvas
  function renderImageToCanvas(ctx, pixelData, imgW, imgH, isChw) {
    var imgData = ctx.createImageData(imgW, imgH);
    var planeSize = imgW * imgH;
    for (var p = 0; p < planeSize; p++) {
      if (isChw) {
        imgData.data[p * 4] = pixelData[p];
        imgData.data[p * 4 + 1] = pixelData[planeSize + p];
        imgData.data[p * 4 + 2] = pixelData[2 * planeSize + p];
      } else {
        imgData.data[p * 4] = pixelData[p * 3];
        imgData.data[p * 4 + 1] = pixelData[p * 3 + 1];
        imgData.data[p * 4 + 2] = pixelData[p * 3 + 2];
      }
      imgData.data[p * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function clearCache() { CACHE = null; }

  return {
    IMAGE_W: IMAGE_W, IMAGE_H: IMAGE_H, IMAGE_CH: IMAGE_CH,
    IMAGE_SIZE: IMAGE_SIZE, NUM_CLASSES: NUM_CLASSES, CLASS_NAMES: CLASS_NAMES,
    buildSyntheticSource: buildSyntheticSource,
    loadSource: loadSource,
    clearCache: clearCache,
    renderImageToCanvas: renderImageToCanvas,
    createRng: createRng, clampInt: clampInt,
  };
});

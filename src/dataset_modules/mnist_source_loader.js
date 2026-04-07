(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
    return;
  }
  root.OSCMnistSourceLoader = factory(root);
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var IMAGE_W = 28;
  var IMAGE_H = 28;
  var IMAGE_SIZE = IMAGE_W * IMAGE_H;
  var NUM_CLASSES = 10;
  var NODE_MODE = typeof root !== "object" || root === null
    ? false
    : (typeof process !== "undefined" && !!process.versions && !!process.versions.node);
  var VARIANT_META = {
    mnist: {
      id: "mnist",
      imageUrl: "https://storage.googleapis.com/learnjs-data/model-builder/mnist_images.png",
      labelUrl: "https://storage.googleapis.com/learnjs-data/model-builder/mnist_labels_uint8",
      imageIdxUrl: "https://ossci-datasets.s3.amazonaws.com/mnist/train-images-idx3-ubyte.gz",
      labelIdxUrl: "https://ossci-datasets.s3.amazonaws.com/mnist/train-labels-idx1-ubyte.gz",
      imageIdxLocal: "../../data/mnist/train-images-idx3-ubyte.gz",
      labelIdxLocal: "../../data/mnist/train-labels-idx1-ubyte.gz",
      classNames: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
      // Original split: first 55000 in sprite are train (IDX has 60000), last 10000 are test
      originalTrainCount: 55000,
    },
    fashion_mnist: {
      id: "fashion_mnist",
      imageUrl: "https://storage.googleapis.com/learnjs-data/model-builder/fashion_mnist_images.png",
      labelUrl: "https://storage.googleapis.com/learnjs-data/model-builder/fashion_mnist_labels_uint8",
      imageIdxUrl: "https://raw.githubusercontent.com/zalandoresearch/fashion-mnist/master/data/fashion/train-images-idx3-ubyte.gz",
      labelIdxUrl: "https://raw.githubusercontent.com/zalandoresearch/fashion-mnist/master/data/fashion/train-labels-idx1-ubyte.gz",
      // Local fallback paths (relative to repo root — avoids GitHub CDN rate limits)
      imageIdxLocal: "../../data/fashion-mnist/train-images-idx3-ubyte.gz",
      labelIdxLocal: "../../data/fashion-mnist/train-labels-idx1-ubyte.gz",
      classNames: [
        "T-shirt/top", "Trouser", "Pullover", "Dress", "Coat",
        "Sandal", "Shirt", "Sneaker", "Bag", "Ankle boot",
      ],
      originalTrainCount: 50000,
    },
  };
  var CACHE = Object.create(null);
  var SYNTH_GLYPHS = [
    ["01110","10001","10011","10101","11001","10001","01110"],
    ["00100","01100","00100","00100","00100","00100","01110"],
    ["01110","10001","00001","00010","00100","01000","11111"],
    ["11110","00001","00001","01110","00001","00001","11110"],
    ["00010","00110","01010","10010","11111","00010","00010"],
    ["11111","10000","11110","00001","00001","10001","01110"],
    ["00110","01000","10000","11110","10001","10001","01110"],
    ["11111","00001","00010","00100","01000","01000","01000"],
    ["01110","10001","10001","01110","10001","10001","01110"],
    ["01110","10001","10001","01111","00001","00010","11100"],
  ];

  function clampInt(value, min, max) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = min;
    n = Math.floor(n);
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  function createRng(seed) {
    var s = clampInt(seed, 1, 2147483647) >>> 0;
    return function () {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function fillRect(pixels, base, x0, y0, w, h, value) {
    var xStart = clampInt(x0, 0, IMAGE_W);
    var yStart = clampInt(y0, 0, IMAGE_H);
    var xEnd = clampInt(x0 + w, 0, IMAGE_W);
    var yEnd = clampInt(y0 + h, 0, IMAGE_H);
    for (var y = yStart; y < yEnd; y += 1) {
      var row = base + y * IMAGE_W;
      for (var x = xStart; x < xEnd; x += 1) {
        var idx = row + x;
        var v = Number(value);
        if (!Number.isFinite(v)) v = 0;
        if (v < 0) v = 0;
        if (v > 255) v = 255;
        pixels[idx] = Math.round(v);
      }
    }
  }

  function drawSyntheticGlyph(pixels, base, label, variant, rng) {
    var cls = clampInt(label, 0, NUM_CLASSES - 1);
    var glyph = SYNTH_GLYPHS[cls];
    var scale = 4;
    var xPad = 4;
    var yPad = 0;
    for (var gy = 0; gy < glyph.length; gy += 1) {
      var row = glyph[gy] || "";
      for (var gx = 0; gx < row.length; gx += 1) {
        if (row.charAt(gx) !== "1") continue;
        var baseIntensity = 180 + Math.floor(rng() * 70);
        fillRect(
          pixels,
          base,
          xPad + gx * scale,
          yPad + gy * scale,
          scale,
          scale,
          baseIntensity
        );
      }
    }
    if (variant === "fashion_mnist") {
      // Add a class-dependent accent stripe so Fashion-MNIST synthetic data differs from MNIST synthetic.
      var stripeY = 20 + (cls % 4);
      var stripeW = 8 + (cls % 3) * 4;
      var stripeX = 2 + ((cls * 3) % (IMAGE_W - stripeW - 2));
      fillRect(pixels, base, stripeX, stripeY, stripeW, 2, 120 + cls * 10);
    }
  }

  function buildSyntheticVariantSource(rawVariant, options) {
    var variant = resolveVariant(rawVariant);
    var meta = getVariantMeta(variant);
    var opts = options || {};
    var total = clampInt(opts.totalExamples || opts.numExamples || opts.sampleCount, 100, 60000);
    var seedBase = clampInt(opts.seed, 1, 2147483647);
    var seed = (seedBase ^ (variant === "fashion_mnist" ? 0x9e3779b9 : 0x7f4a7c15)) >>> 0;
    if (!seed) seed = 42;
    var rng = createRng(seed);
    var pixels = new Uint8Array(total * IMAGE_SIZE);
    var labels = new Uint8Array(total);
    for (var i = 0; i < total; i += 1) {
      var label = i % NUM_CLASSES;
      labels[i] = label;
      var base = i * IMAGE_SIZE;
      for (var p = 0; p < IMAGE_SIZE; p += 1) {
        pixels[base + p] = clampInt(Math.floor(rng() * 24), 0, 255);
      }
      drawSyntheticGlyph(pixels, base, label, variant, rng);
    }
    return {
      variant: meta.id,
      schemaId: meta.id,
      imageShape: [IMAGE_W, IMAGE_H, 1],
      imageSize: IMAGE_SIZE,
      classCount: NUM_CLASSES,
      classNames: meta.classNames.slice(),
      numExamples: total,
      pixelsUint8: pixels,
      labelsUint8: labels,
      source: "synthetic",
      urls: null,
      loadedAt: Date.now(),
      synthetic: true,
      originalTrainCount: Math.round(total * 0.8333),
    };
  }

  function resolveVariant(rawVariant) {
    var v = String(rawVariant || "mnist").trim().toLowerCase();
    if (v !== "fashion_mnist") v = "mnist";
    return v;
  }

  function getVariantMeta(rawVariant) {
    var v = resolveVariant(rawVariant);
    return VARIANT_META[v];
  }

  function assertBrowserDecodeSupport() {
    if (!root || typeof root !== "object") {
      throw new Error("MNIST source loader requires browser global context.");
    }
    if (typeof root.fetch !== "function") {
      throw new Error("MNIST source loader requires fetch().");
    }
    if (typeof root.Image !== "function" && typeof root.createImageBitmap !== "function") {
      throw new Error("MNIST source loader requires Image() or createImageBitmap().");
    }
    if (typeof root.document === "undefined" || !root.document.createElement) {
      throw new Error("MNIST source loader requires document.createElement('canvas').");
    }
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new root.Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = function () {
        reject(new Error("Failed to decode image: " + String(url || "")));
      };
      img.src = String(url || "");
    });
  }

  function fetchArrayBuffer(url) {
    var u = String(url || "");
    // Use XHR for file:// protocol (fetch blocked by CORS), fetch for http/https
    if (u.indexOf("file:") === 0 || (typeof location !== "undefined" && location.protocol === "file:" && u.indexOf("http") !== 0)) {
      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", u, true);
        xhr.responseType = "arraybuffer";
        xhr.onload = function () { if (xhr.response) resolve(xhr.response); else reject(new Error("XHR empty: " + u)); };
        xhr.onerror = function () { reject(new Error("XHR failed: " + u)); };
        xhr.send();
      });
    }
    return root.fetch(u)
      .then(function (res) {
        if (!res || !res.ok) {
          throw new Error("Fetch failed: " + u + " (status " + String(res && res.status) + ")");
        }
        return res.arrayBuffer();
      });
  }

  function beReadU32(buf, off) {
    return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
  }

  function parseIdxImages(raw, imageShape) {
    var buf = raw || new Uint8Array(0);
    if (buf.length < 16) {
      throw new Error("IDX image buffer too small.");
    }
    var magic = beReadU32(buf, 0);
    if (magic !== 2051) {
      throw new Error("Invalid IDX image magic: " + magic);
    }
    var numItems = beReadU32(buf, 4);
    var rows = beReadU32(buf, 8);
    var cols = beReadU32(buf, 12);
    var expected = rows * cols;
    if (rows <= 0 || cols <= 0 || expected !== imageShape[0] * imageShape[1]) {
      throw new Error("Unexpected image shape in IDX payload: " + rows + "x" + cols);
    }
    var dataOffset = 16;
    var dataBytes = numItems * expected;
    if (buf.length < dataOffset + dataBytes) {
      throw new Error("IDX image payload shorter than expected.");
    }
    return {
      numExamples: numItems,
      pixelsUint8: new Uint8Array(buf.buffer, buf.byteOffset + dataOffset, dataBytes),
    };
  }

  function parseIdxLabels(raw) {
    var buf = raw || new Uint8Array(0);
    if (buf.length < 8) {
      throw new Error("IDX label buffer too small.");
    }
    var magic = beReadU32(buf, 0);
    if (magic !== 2049) {
      throw new Error("Invalid IDX label magic: " + magic);
    }
    var numItems = beReadU32(buf, 4);
    var dataOffset = 8;
    if (buf.length < dataOffset + numItems) {
      throw new Error("IDX label payload shorter than expected.");
    }
    return {
      numExamples: numItems,
      labelsUint8: new Uint8Array(buf.buffer, buf.byteOffset + dataOffset, numItems),
    };
  }

  function decompressGzipToUint8(buffer) {
    if (!buffer || typeof buffer.byteLength !== "number") {
      throw new Error("Invalid gzip payload.");
    }
    var req = false;
    if (typeof req === "undefined") {
      // noop
    }
    var zlib = null;
    try {
      zlib = (typeof require === "function") ? require("zlib") : null;
    } catch (_err) {
      zlib = null;
    }
    if (!zlib || !zlib.gunzipSync) {
      throw new Error("Node gzip decode requires zlib module.");
    }
    var raw = new Uint8Array(buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer).buffer ? new Uint8Array(buffer) : []);
    var inflated = zlib.gunzipSync(Buffer.from(raw));
    return new Uint8Array(inflated);
  }

  function readAllReaderChunks(reader) {
    return new Promise(function (resolve, reject) {
      var chunks = [];
      var total = 0;
      function pump() {
        reader.read().then(function (part) {
          if (!part || part.done) {
            var out = new Uint8Array(total);
            var offset = 0;
            for (var i = 0; i < chunks.length; i += 1) {
              out.set(chunks[i], offset);
              offset += chunks[i].length;
            }
            resolve(out);
            return;
          }
          var chunk = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value || 0);
          chunks.push(chunk);
          total += chunk.length;
          pump();
        }).catch(reject);
      }
      pump();
    });
  }

  function decompressGzipBrowser(buffer) {
    var stream = new Response(buffer).body;
    if (!stream) {
      throw new Error("Gzip decode stream unavailable.");
    }
    var reader = stream
      .pipeThrough(new DecompressionStream("gzip"))
      .getReader();
    return readAllReaderChunks(reader);
  }

  function decompressMaybeAsync(buffer) {
    if (typeof DecompressionStream === "function") {
      return decompressGzipBrowser(buffer);
    }
    return Promise.resolve(decompressGzipToUint8(buffer));
  }

  function resolveNodeLocalUrl(url) {
    var raw = String(url || "");
    if (!NODE_MODE || !raw || raw.indexOf("file:") === 0 || /^https?:/i.test(raw)) {
      return raw;
    }
    try {
      var path = require("path");
      var fileUrl = require("url");
      var absPath = path.resolve(typeof __dirname !== "undefined" ? __dirname : process.cwd(), raw);
      return String(fileUrl.pathToFileURL(absPath));
    } catch (_err) {
      return raw;
    }
  }

  // Try local path first, fall back to CDN (avoids rate limits on GitHub raw)
  function fetchWithFallback(localUrl, cdnUrl) {
    var resolvedLocal = resolveNodeLocalUrl(localUrl);
    if (!resolvedLocal) return fetchArrayBuffer(cdnUrl);
    return fetchArrayBuffer(resolvedLocal).catch(function () { return fetchArrayBuffer(cdnUrl); });
  }

  function fetchAndDecodeNodeVariant(variant) {
    var meta = getVariantMeta(variant);
    return Promise.all([
      fetchWithFallback(meta.imageIdxLocal, meta.imageIdxUrl),
      fetchWithFallback(meta.labelIdxLocal, meta.labelIdxUrl),
    ]).then(function (parts) {
      var img = parseIdxImages(decompressGzipToUint8(parts[0]), [IMAGE_W, IMAGE_H]);
      var lbl = parseIdxLabels(decompressGzipToUint8(parts[1]));
      var n = Math.min(img.numExamples || 0, lbl.numExamples || 0);
      if (!n) {
        throw new Error("IDX source is empty.");
      }
      var pixels = new Uint8Array(n * IMAGE_SIZE);
      // Copy from view values (not underlying buffer start) to avoid mixing IDX headers.
      pixels.set(img.pixelsUint8.subarray(0, n * IMAGE_SIZE));
      var labels = new Uint8Array(n);
      labels.set(lbl.labelsUint8.subarray(0, n));
      return {
        variant: meta.id,
        schemaId: meta.id,
        imageShape: [IMAGE_W, IMAGE_H, 1],
        imageSize: IMAGE_SIZE,
        classCount: NUM_CLASSES,
        classNames: meta.classNames.slice(),
        numExamples: n,
        pixelsUint8: pixels,
        labelsUint8: labels,
        source: "mnist_idx_gzip",
        urls: {
          images: meta.imageIdxUrl,
          labels: meta.labelIdxUrl,
        },
        loadedAt: Date.now(),
        originalTrainCount: meta.originalTrainCount || 0,
      };
    });
  }

  function fetchAndDecodeBrowserWorkerVariant(variant) {
    var meta = getVariantMeta(variant);
    return Promise.all([
      fetchWithFallback(meta.imageIdxLocal, meta.imageIdxUrl),
      fetchWithFallback(meta.labelIdxLocal, meta.labelIdxUrl),
    ]).then(function (parts) {
      return Promise.all([
        decompressMaybeAsync(parts[0]),
        decompressMaybeAsync(parts[1]),
      ]);
    }).then(function (inflated) {
      var img = parseIdxImages(inflated[0], [IMAGE_W, IMAGE_H]);
      var lbl = parseIdxLabels(inflated[1]);
      var n = Math.min(img.numExamples || 0, lbl.numExamples || 0);
      if (!n) {
        throw new Error("IDX source is empty.");
      }
      var pixels = new Uint8Array(n * IMAGE_SIZE);
      pixels.set(img.pixelsUint8.subarray(0, n * IMAGE_SIZE));
      var labels = new Uint8Array(n);
      labels.set(lbl.labelsUint8.subarray(0, n));
      return {
        variant: meta.id,
        schemaId: meta.id,
        imageShape: [IMAGE_W, IMAGE_H, 1],
        imageSize: IMAGE_SIZE,
        classCount: NUM_CLASSES,
        classNames: meta.classNames.slice(),
        numExamples: n,
        pixelsUint8: pixels,
        labelsUint8: labels,
        source: "mnist_idx_gzip_worker",
        urls: {
          images: meta.imageIdxUrl,
          labels: meta.labelIdxUrl,
        },
        loadedAt: Date.now(),
        originalTrainCount: meta.originalTrainCount || 0,
      };
    });
  }

  function decodeSpriteToUint8Rows(img, expectedImageSize) {
    var width = Number((img && (img.naturalWidth || img.width)) || 0);
    var height = Number((img && (img.naturalHeight || img.height)) || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error("Invalid MNIST sprite dimensions.");
    }
    if (width !== expectedImageSize) {
      throw new Error("Unexpected MNIST sprite width: " + width + " (expected " + expectedImageSize + ")");
    }
    var numRows = height;
    var out = new Uint8Array(numRows * width);
    var chunkRows = 2048;
    var canvas = root.document.createElement("canvas");
    canvas.width = width;
    canvas.height = chunkRows;
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is unavailable.");
    for (var offset = 0; offset < numRows; offset += chunkRows) {
      var rows = Math.min(chunkRows, numRows - offset);
      if (canvas.height !== rows) canvas.height = rows;
      ctx.clearRect(0, 0, width, rows);
      ctx.drawImage(img, 0, offset, width, rows, 0, 0, width, rows);
      var imageData = ctx.getImageData(0, 0, width, rows);
      var src = imageData.data;
      var rowBase = offset * width;
      for (var i = 0; i < rows * width; i += 1) {
        out[rowBase + i] = src[i * 4];
      }
    }
    return { pixels: out, numRows: numRows, imageSize: width };
  }

  function decodeLabelsToClassIds(rawLabels, expectedRows, classCount) {
    var lbl = rawLabels instanceof Uint8Array ? rawLabels : new Uint8Array(rawLabels || 0);
    if (!lbl.length) {
      throw new Error("MNIST labels are empty.");
    }
    if (lbl.length === expectedRows) {
      return lbl;
    }
    if (lbl.length >= expectedRows * classCount && lbl.length % classCount === 0) {
      var out = new Uint8Array(expectedRows);
      for (var i = 0; i < expectedRows; i += 1) {
        var base = i * classCount;
        var best = 0;
        var bestV = -1;
        for (var c = 0; c < classCount; c += 1) {
          var v = Number(lbl[base + c] || 0);
          if (v > bestV) {
            bestV = v;
            best = c;
          }
        }
        out[i] = best;
      }
      return out;
    }
    throw new Error(
      "MNIST labels length mismatch: got " + lbl.length + ", expected " +
      expectedRows + " or " + (expectedRows * classCount)
    );
  }

  function fetchAndDecodeVariant(variant) {
    if (NODE_MODE) {
      return fetchAndDecodeNodeVariant(variant);
    }
    // prefer binary IDX format when DecompressionStream is available (all modern browsers)
    // avoids sprite image decoding which fails for large datasets (>64K pixels tall)
    if (typeof root.fetch === "function" && typeof DecompressionStream === "function") {
      return fetchAndDecodeBrowserWorkerVariant(variant);
    }
    assertBrowserDecodeSupport();
    var meta = getVariantMeta(variant);
    return Promise.all([
      loadImage(meta.imageUrl),
      fetchArrayBuffer(meta.labelUrl),
    ]).then(function (parts) {
      var img = parts[0];
      var labelsBuf = parts[1];
      var decoded = decodeSpriteToUint8Rows(img, IMAGE_SIZE);
      var labels = decodeLabelsToClassIds(new Uint8Array(labelsBuf), decoded.numRows, NUM_CLASSES);
      return {
        variant: meta.id,
        schemaId: meta.id,
        imageShape: [IMAGE_W, IMAGE_H, 1],
        imageSize: decoded.imageSize,
        classCount: NUM_CLASSES,
        classNames: meta.classNames.slice(),
        numExamples: decoded.numRows,
        pixelsUint8: decoded.pixels,
        labelsUint8: labels,
        source: "tfjs_mnist_sprite",
        urls: {
          image: meta.imageUrl,
          label: meta.labelUrl,
        },
        loadedAt: Date.now(),
        originalTrainCount: meta.originalTrainCount || 0,
      };
    });
  }

  function loadVariantSource(rawVariant, options) {
    var variant = resolveVariant(rawVariant);
    var opts = options || {};
    if (!opts.forceReload && CACHE[variant]) return CACHE[variant];
    var p = fetchAndDecodeVariant(variant).then(function (source) {
      // register in source registry (zero-copy architecture)
      var reg = (typeof root !== "undefined" && root.OSCDatasetSourceRegistry) || null;
      if (reg && typeof reg.createFromUint8 === "function" && source.pixelsUint8) {
        reg.createFromUint8({
          id: variant + "_source",
          pixelsUint8: source.pixelsUint8,
          labelsUint8: source.labelsUint8,
          numExamples: source.numExamples,
          imageSize: source.imageSize || IMAGE_SIZE,
          classCount: source.classCount || NUM_CLASSES,
          imageShape: source.imageShape || [IMAGE_H, IMAGE_W, 1],
        });
      }
      return source;
    }).catch(function (err) {
      delete CACHE[variant];
      throw err;
    });
    CACHE[variant] = p;
    return p;
  }

  function clearCache(rawVariant) {
    if (rawVariant == null) {
      CACHE = Object.create(null);
      return;
    }
    var variant = resolveVariant(rawVariant);
    delete CACHE[variant];
  }

  return {
    IMAGE_W: IMAGE_W,
    IMAGE_H: IMAGE_H,
    IMAGE_SIZE: IMAGE_SIZE,
    NUM_CLASSES: NUM_CLASSES,
    resolveVariant: resolveVariant,
    getVariantMeta: getVariantMeta,
    buildSyntheticVariantSource: buildSyntheticVariantSource,
    loadVariantSource: loadVariantSource,
    clearCache: clearCache,
  };
});

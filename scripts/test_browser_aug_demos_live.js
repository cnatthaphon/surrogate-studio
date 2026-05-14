"use strict";
// Live browser smoke across all 5 aug-variant demos against the local server
// at http://localhost:3777. Verifies for each demo:
//   - page loads under puppeteer with no JS console errors
//   - the expected +Aug model is registered in the preset
//   - the +Aug pretrained global is defined and non-trivial in size
//   - the +Aug model graph builds in-browser via OSCModelBuilderCore
//   - the build returns the expected input / output counts
//   - if the graph has graphLabelOutputIdx, it's set correctly
//
// Run with the local server up:
//   node server/training_server.js    # in another terminal
//   node scripts/test_browser_aug_demos_live.js
var puppeteer = require("puppeteer");

var BASE = "http://localhost:3777";

var DEMOS = [
  {
    name: "SAR-Ship-Detection",
    presetVar: "SAR_SHIP_DETECTION_PRESET",
    augModelId: "sar_cnn_aug",
    pretrainedVar: "CNN_AUG_SHIP_DETECTOR_PRE_TRAINED_PRETRAINED_BIN_B64",
    expectedInputs: 2, expectedOutputs: 2, expectedGraphLabelOutputIdxs: [1],
    buildCfg: { featureSize: 64*64, imageShape: [64,64,1], allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }], defaultTarget: "bbox", numClasses: 1, targetSize: 4 },
  },
  {
    name: "Cell-Nuclei-Segmentation",
    presetVar: "CELL_NUCLEI_SEGMENTATION_PRESET",
    augModelId: "nuc_unet_aug",
    pretrainedVar: "NUCLEUS_UNET_AUGMENTATION_PRE_TRAINED_PRETRAINED_BIN_B64",
    expectedInputs: 2, expectedOutputs: 2, expectedGraphLabelOutputIdxs: [1],
    buildCfg: { featureSize: 1024, imageShape: [32,32,1], allowedOutputKeys: [{ key: "mask", featureSize: 1024, headType: "segmentation" }], defaultTarget: "mask", numClasses: 2, targetSize: 1024 },
  },
  {
    name: "Synthetic-Detection",
    presetVar: "SYNTHETIC_DETECTION_PRESET",
    augModelId: "synthetic_detection_model_aug",
    pretrainedVar: "SINGLE_BOX_DETECTOR_AUGMENTATION_PRE_TRAINED_PRETRAINED_BIN_B64",
    expectedInputs: 2, expectedOutputs: 3, expectedGraphLabelOutputIdxs: [-1, 2],
    buildCfg: { featureSize: 1024, imageShape: [32,32,1], allowedOutputKeys: [{ key: "bbox", featureSize: 4, headType: "regression" }, { key: "label", featureSize: 3, headType: "classification" }], defaultTarget: "bbox", numClasses: 3, targetSize: 4 },
  },
  {
    name: "Synthetic-Segmentation",
    presetVar: "SYNTHETIC_SEGMENTATION_PRESET",
    augModelId: "seg_unet_aug",
    pretrainedVar: "SEG_UNET_AUGMENTATION_PRE_TRAINED_PRETRAINED_BIN_B64",
    expectedInputs: 2, expectedOutputs: 2, expectedGraphLabelOutputIdxs: [1],
    buildCfg: { featureSize: 1024, imageShape: [32,32,1], allowedOutputKeys: [{ key: "mask", featureSize: 1024, headType: "segmentation" }], defaultTarget: "mask", numClasses: 2, targetSize: 1024 },
  },
  {
    name: "Fashion-MNIST-Benchmark",
    presetVar: "FASHION_MNIST_BENCHMARK_PRESET",
    augModelId: "m-cnn-aug",
    pretrainedVar: "M2B_CNN_AUGMENTATION_PRE_TRAINED_PRETRAINED_BIN_B64",
    expectedInputs: 1, expectedOutputs: 1, expectedGraphLabelOutputIdxs: [-1],
    buildCfg: { featureSize: 784, imageShape: [28,28,1], allowedOutputKeys: [{ key: "label", featureSize: 10, headType: "classification" }], defaultTarget: "label", numClasses: 10, targetSize: 10 },
  },
];

(async function () {
  // Server preflight.
  try {
    var http = require("http");
    await new Promise(function (resolve, reject) {
      http.get(BASE + "/api/health", function (res) {
        if (res.statusCode === 200) resolve();
        else reject(new Error("server returned " + res.statusCode));
      }).on("error", reject);
    });
  } catch (e) {
    console.error("Server not reachable at " + BASE + " — start it with `node server/training_server.js` first.");
    process.exit(1);
  }

  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  var totalPassed = 0, totalFailed = 0;
  var summary = [];

  try {
    for (var di = 0; di < DEMOS.length; di++) {
      var demo = DEMOS[di];
      console.log("\n=== " + demo.name + " ===");
      var page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });

      var consoleErrors = [];
      var bad404s = [];
      var failedRequests = [];
      page.on("console", function (msg) { if (msg.type() === "error") consoleErrors.push(msg.text()); });
      page.on("pageerror", function (err) { consoleErrors.push(String(err)); });
      page.on("response", function (r) {
        if (r.status() >= 400) {
          var u = r.url();
          // favicon.ico is a browser auto-request the training server doesn't
          // ship — harmless 404, not a demo failure.
          if (/favicon\.ico/i.test(u)) return;
          bad404s.push(r.status() + " " + u);
        }
      });
      page.on("requestfailed", function (req) {
        var u = req.url();
        if (/favicon\.ico/i.test(u)) return;
        var failure = req.failure && req.failure();
        failedRequests.push((failure && failure.errorText ? failure.errorText + " " : "") + u);
      });

      var url = BASE + "/demo/" + demo.name + "/index.html";
      try {
        await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
      } catch (e) {
        console.error("  ✗ failed to load: " + (e && e.message || e));
        summary.push({ demo: demo.name, ok: false, reason: "page load" });
        totalFailed++;
        await page.close();
        continue;
      }

      var checks = await page.evaluate(function (cfg) {
        var preset = window[cfg.presetVar];
        if (!preset) return { ok: false, reason: "preset " + cfg.presetVar + " not found on window" };
        var models = preset.models || [];
        var augModel = models.filter(function (m) { return m.id === cfg.augModelId; })[0];
        if (!augModel) return { ok: false, reason: "aug model " + cfg.augModelId + " missing" };

        var trainers = preset.trainers || [];
        var pretrainedTrainer = trainers.filter(function (t) {
          return t && t.modelId === cfg.augModelId && t.status === "done" && t._pretrainedVar;
        })[0];
        if (!pretrainedTrainer) return { ok: false, reason: "pretrained trainer for " + cfg.augModelId + " missing" };
        if (pretrainedTrainer._pretrainedVar !== cfg.pretrainedVar) {
          return { ok: false, reason: "trainer _pretrainedVar=" + pretrainedTrainer._pretrainedVar + " expected=" + cfg.pretrainedVar };
        }

        var pretrainedB64 = window[pretrainedTrainer._pretrainedVar];
        if (typeof pretrainedB64 !== "string" || pretrainedB64.length < 1000) {
          return { ok: false, reason: "pretrained " + pretrainedTrainer._pretrainedVar + " missing or too small (" + (pretrainedB64 ? pretrainedB64.length : 0) + ")" };
        }

        // Build the aug graph in-browser via the model builder.
        try {
          var built = window.OSCModelBuilderCore.buildModelFromGraph(window.tf, augModel.graph, Object.assign({ mode: "direct" }, cfg.buildCfg));
          var result = {
            ok: true,
            inputs: built.model.inputs.length,
            outputs: built.model.outputs.length,
            graphLabelOutputIdxs: (built.headConfigs || []).map(function (h) { return h && h.graphLabelOutputIdx; }),
          };
          try { built.model.dispose(); } catch (_) {}
          return result;
        } catch (e) {
          return { ok: false, reason: "build threw: " + (e && e.message || e) };
        }
      }, demo);

      var passed = true;
      var detail = [];
      if (!checks.ok) {
        console.error("  ✗ " + checks.reason);
        passed = false;
      } else {
        if (checks.inputs !== demo.expectedInputs) { console.error("  ✗ inputs=" + checks.inputs + " expected=" + demo.expectedInputs); passed = false; }
        else detail.push("inputs=" + checks.inputs);
        if (checks.outputs !== demo.expectedOutputs) { console.error("  ✗ outputs=" + checks.outputs + " expected=" + demo.expectedOutputs); passed = false; }
        else detail.push("outputs=" + checks.outputs);
        var expectedGL = demo.expectedGraphLabelOutputIdxs || [];
        var actualGL = checks.graphLabelOutputIdxs || [];
        if (JSON.stringify(actualGL) !== JSON.stringify(expectedGL)) {
          console.error("  ✗ graphLabelOutputIdxs=" + JSON.stringify(actualGL) + " expected=" + JSON.stringify(expectedGL));
          passed = false;
        } else {
          detail.push("graphLabelOutputIdxs=" + JSON.stringify(actualGL));
        }
      }

      // Filter benign WebGL warnings — headless Chrome doesn't have GPU access so
      // tf.js falls back to CPU; the WebGL init errors are not actual breakage.
      // Real JS errors (not network noise). Network 4xx/5xx is logged via
      // response handler into bad404s with full URL; the console message
      // text alone says "Failed to load resource" without the URL, so we
      // ignore that pattern and trust response-event tracking instead.
      var realErrors = consoleErrors.filter(function (e) {
        return !/WebGL|webgl|getWebGLContext|Failed to initialize backend|tfjs.*backend|canvas\.addEventListener is not a function|Failed to load resource/i.test(e);
      });
      if (realErrors.length > 0) {
        console.error("  ✗ JS console errors: " + realErrors.length);
        realErrors.slice(0, 3).forEach(function (e) { console.error("    " + e.slice(0, 200)); });
        passed = false;
      }
      if (bad404s.length > 0) {
        console.error("  ✗ non-favicon HTTP failures: " + bad404s.length);
        bad404s.slice(0, 5).forEach(function (u) { console.error("    " + u); });
        passed = false;
      }
      if (failedRequests.length > 0) {
        console.error("  ✗ non-favicon request failures: " + failedRequests.length);
        failedRequests.slice(0, 5).forEach(function (u) { console.error("    " + u); });
        passed = false;
      }
      if (passed && realErrors.length === 0 && bad404s.length === 0 && failedRequests.length === 0) {
        detail.push("0 JS errors, 0 bad HTTP, 0 failed requests");
      }

      if (passed) {
        console.log("  ✓ " + detail.join(", "));
        totalPassed++;
        summary.push({ demo: demo.name, ok: true });
      } else {
        totalFailed++;
        summary.push({ demo: demo.name, ok: false });
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== Summary ===");
  summary.forEach(function (s) { console.log("  " + (s.ok ? "✓" : "✗") + "  " + s.demo); });
  console.log("\n  " + totalPassed + " passed, " + totalFailed + " failed of " + DEMOS.length);
  if (totalFailed > 0) process.exit(1);
})().catch(function (e) { console.error("Fatal:", e && e.stack ? e.stack : e); process.exit(1); });

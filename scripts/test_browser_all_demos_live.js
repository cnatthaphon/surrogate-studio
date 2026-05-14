"use strict";
// Live browser smoke across ALL 16 demos against the local server at
// http://localhost:3777. Less strict than the aug-specific smoke — just
// verifies each demo's page loads, the preset global is registered, the
// expected pretrained globals are defined (per the preset's _pretrainedVar
// fields), and there are no JS errors / unexpected 4xx-5xx responses.
//
// Catches: stale script tags, renamed pretrained files, broken bundle
// references, schema registration failures, missing dataset modules.
var puppeteer = require("puppeteer");

var BASE = "http://localhost:3777";

// Per-demo: name, presetVar (global key on window). The script discovers
// pretrained vars by reading the preset's trainers[]._pretrainedVar.
var DEMOS = [
  { name: "Cell-Nuclei-Segmentation",                    presetVar: "CELL_NUCLEI_SEGMENTATION_PRESET" },
  { name: "Custom-CSV-Tutorial",                          presetVar: null /* tutorial; no preset global expected */ },
  { name: "Fashion-MNIST-Benchmark",                      presetVar: "FASHION_MNIST_BENCHMARK_PRESET" },
  { name: "Fashion-MNIST-Conditional-Diffusion",          presetVar: "FASHION_MNIST_COND_DIFFUSION_PRESET" },
  { name: "Fashion-MNIST-Diffusion",                      presetVar: "FASHION_MNIST_DIFFUSION_PRESET" },
  { name: "Fashion-MNIST-GAN",                            presetVar: "FASHION_MNIST_GAN_PRESET" },
  { name: "Fashion-MNIST-Transformer",                    presetVar: "FASHION_MNIST_TRANSFORMER_PRESET" },
  { name: "Fashion-MNIST-UNet",                           presetVar: "FASHION_MNIST_UNET_PRESET" },
  { name: "LSTM-VAE-for-dominant-motion-extraction",      presetVar: "LSTM_VAE_DEMO_PRESET" },
  { name: "Oscillator-Surrogate",                         presetVar: "OSCILLATOR_DEMO_PRESET" },
  { name: "SAR-Ship-Detection",                           presetVar: "SAR_SHIP_DETECTION_PRESET" },
  { name: "Siamese-Shape-Verification",                   presetVar: "SIAMESE_SHAPE_VERIFICATION_PRESET" },
  { name: "Synthetic-Detection",                          presetVar: "SYNTHETIC_DETECTION_PRESET" },
  { name: "Synthetic-Segmentation",                       presetVar: "SYNTHETIC_SEGMENTATION_PRESET" },
  { name: "Text-Sentiment-Transformer",                   presetVar: "TEXT_SENTIMENT_TRANSFORMER_PRESET" },
  { name: "TrAISformer",                                  presetVar: "TRAISFORMER_PRESET" },
];

(async function () {
  try {
    var http = require("http");
    await new Promise(function (resolve, reject) {
      http.get(BASE + "/api/health", function (res) {
        if (res.statusCode === 200) resolve();
        else reject(new Error("server returned " + res.statusCode));
      }).on("error", reject);
    });
  } catch (e) {
    console.error("Server not reachable at " + BASE);
    process.exit(1);
  }

  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  var summary = [];

  try {
    for (var di = 0; di < DEMOS.length; di++) {
      var demo = DEMOS[di];
      console.log("\n=== " + demo.name + " ===");
      var page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });

      var consoleErrors = [];
      var bad404s = [];
      page.on("console", function (msg) { if (msg.type() === "error") consoleErrors.push(msg.text()); });
      page.on("pageerror", function (err) { consoleErrors.push(String(err)); });
      page.on("response", function (r) {
        if (r.status() >= 400 && !/favicon\.ico/i.test(r.url())) {
          bad404s.push(r.status() + " " + r.url());
        }
      });

      var url = BASE + "/demo/" + demo.name + "/index.html";
      var loaded = true;
      try {
        await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
      } catch (e) {
        loaded = false;
        console.error("  ✗ failed to load: " + (e && e.message || e).slice(0, 200));
        summary.push({ demo: demo.name, ok: false, reason: "page load" });
        await page.close();
        continue;
      }

      var checks = await page.evaluate(function (cfg) {
        var result = { ok: true, presetFound: false, modelCount: 0, missingPretrained: [] };
        if (cfg.presetVar) {
          var preset = window[cfg.presetVar];
          if (!preset) {
            return { ok: false, reason: "preset " + cfg.presetVar + " not on window" };
          }
          result.presetFound = true;
          result.modelCount = (preset.models || []).length;
          // Discover each pretrained _pretrainedVar from trainers and verify it's defined.
          (preset.trainers || []).forEach(function (t) {
            if (t && t._pretrainedVar) {
              var g = window[t._pretrainedVar];
              if (typeof g !== "string" || g.length < 100) {
                result.missingPretrained.push(t._pretrainedVar + " (" + (g ? "size=" + g.length : "undefined") + ")");
              }
            }
          });
        }
        return result;
      }, demo);

      var realErrors = consoleErrors.filter(function (e) {
        return !/WebGL|webgl|getWebGLContext|Failed to initialize backend|tfjs.*backend|canvas\.addEventListener is not a function|Failed to load resource/i.test(e);
      });

      var passed = checks.ok && realErrors.length === 0 && bad404s.length === 0 && (checks.missingPretrained || []).length === 0;
      var detail = [];
      if (!checks.ok) detail.push("FAIL: " + checks.reason);
      else {
        if (demo.presetVar) detail.push("preset=" + (checks.presetFound ? "yes" : "no") + " models=" + checks.modelCount);
        if (checks.missingPretrained && checks.missingPretrained.length) {
          detail.push("missing pretrained: " + checks.missingPretrained.join(", "));
        }
        if (realErrors.length) detail.push("JS errors=" + realErrors.length);
        if (bad404s.length) detail.push("bad HTTP=" + bad404s.length);
      }

      if (passed) {
        console.log("  ✓ " + detail.join(", "));
      } else {
        console.error("  ✗ " + detail.join(", "));
        if (realErrors.length) realErrors.slice(0, 2).forEach(function (e) { console.error("    JS: " + e.slice(0, 200)); });
        if (bad404s.length) bad404s.slice(0, 3).forEach(function (u) { console.error("    HTTP: " + u); });
        if ((checks.missingPretrained || []).length) checks.missingPretrained.forEach(function (p) { console.error("    pretrained: " + p); });
      }
      summary.push({ demo: demo.name, ok: passed });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log("\n=== Summary ===");
  var passed = summary.filter(function (s) { return s.ok; }).length;
  summary.forEach(function (s) { console.log("  " + (s.ok ? "✓" : "✗") + "  " + s.demo); });
  console.log("\n  " + passed + " passed, " + (summary.length - passed) + " failed of " + summary.length);
  if (passed < summary.length) process.exit(1);
})().catch(function (e) { console.error("Fatal:", e && e.stack ? e.stack : e); process.exit(1); });

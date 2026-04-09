#!/usr/bin/env node
"use strict";
/**
 * End-to-end smoke test against the live GitHub Pages deployment.
 *
 * Tests all 8 demos + main app:
 *  - Page loads without fatal JS errors
 *  - Preset data hydrated (models, trainers, generations, evaluations)
 *  - All tabs render with content
 *  - Pretrained weights load (trainer status = "done")
 *  - Leaflet map renders for AIS trajectory demos
 *  - Client-side TF.js training works (short 1-epoch test)
 *
 * Usage:
 *   node scripts/test_github_pages_e2e.js [--local]
 *   --local   Test against localhost:9910 instead of GitHub Pages
 */

var puppeteer = require("puppeteer");

var USE_LOCAL = process.argv.includes("--local");
var BASE = USE_LOCAL
  ? "http://localhost:9910"
  : "https://cnatthaphon.github.io/surrogate-studio";

var TIMEOUT = 90000;
var passed = 0, failed = 0, warnings = 0, errors = [];

function ok(cond, label) {
  if (cond) { passed++; console.log("  \x1b[32m✓\x1b[0m " + label); }
  else { failed++; errors.push(label); console.log("  \x1b[31m✗\x1b[0m " + label); }
}
function warn(label) { warnings++; console.log("  \x1b[33m⚠\x1b[0m " + label); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function filterFatalErrors(list) {
  return list.filter(function (e) {
    return e.indexOf("favicon") < 0 && e.indexOf("net::ERR") < 0 &&
      e.indexOf("DevTools") < 0 && e.indexOf("Cross origin") < 0 &&
      e.indexOf("CORS") < 0 && e.indexOf("403") < 0 &&
      e.indexOf("tile") < 0 && e.indexOf("arcgisonline") < 0 &&
      e.indexOf("404") < 0 && e.indexOf("status of 4") < 0;
  });
}

async function clickTab(page, tabName) {
  return page.evaluate(function (name) {
    var btns = Array.prototype.slice.call(document.querySelectorAll(".osc-tab-btn, button"));
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.trim().toLowerCase() === name.toLowerCase()) {
        btns[i].click(); return true;
      }
    }
    return false;
  }, tabName);
}

async function tabHasContent(page) {
  return page.evaluate(function () {
    var active = document.querySelector(".osc-workspace.active");
    if (!active) return { ok: false, detail: "no active workspace" };
    var left = active.querySelector(".osc-panel-left");
    var main = active.querySelector(".osc-panel-main");
    var hasVisual = !!(active.querySelector(".drawflow") || active.querySelector("canvas") ||
      active.querySelector("svg") || active.querySelector(".leaflet-container"));
    var hasButtons = active.querySelectorAll("button").length > 0;
    var leftLen = left ? left.textContent.trim().length : 0;
    var mainLen = main ? main.textContent.trim().length : 0;
    return {
      ok: hasVisual || hasButtons || leftLen > 20 || mainLen > 20,
      detail: "left=" + leftLen + " main=" + mainLen + " visual=" + hasVisual + " btns=" + hasButtons,
    };
  });
}

async function hasLeafletMap(page) {
  return page.evaluate(function () {
    var lc = document.querySelector(".leaflet-container");
    if (!lc) return { found: false, tiles: 0 };
    return { found: true, tiles: lc.querySelectorAll(".leaflet-tile-loaded").length };
  });
}

var DEMOS = [
  { name: "Main App", path: "/", presetKey: null,
    tabs: ["playground", "dataset", "model", "trainer", "generation", "evaluation"] },
  { name: "Fashion-MNIST Benchmark", path: "/demo/Fashion-MNIST-Benchmark/",
    presetKey: "FASHION_MNIST_BENCHMARK_PRESET",
    minModels: 7, minTrainers: 7, minGenerations: 6, minEvaluations: 2,
    tabs: ["dataset", "model", "trainer", "generation", "evaluation"] },
  { name: "Fashion-MNIST GAN", path: "/demo/Fashion-MNIST-GAN/",
    presetKey: "FASHION_MNIST_GAN_PRESET",
    minModels: 3, minTrainers: 6, minGenerations: 6, minEvaluations: 1,
    tabs: ["dataset", "model", "trainer", "generation", "evaluation"], expectPretrained: true },
  { name: "Fashion-MNIST Diffusion", path: "/demo/Fashion-MNIST-Diffusion/",
    presetKey: "FASHION_MNIST_DIFFUSION_PRESET",
    minModels: 4, minTrainers: 8, minGenerations: 8, minEvaluations: 2,
    tabs: ["dataset", "model", "trainer", "generation", "evaluation"], expectPretrained: true },
  { name: "Fashion-MNIST Conditional Diffusion", path: "/demo/Fashion-MNIST-Conditional-Diffusion/",
    presetKey: "FASHION_MNIST_COND_DIFFUSION_PRESET",
    minModels: 2, minTrainers: 4, minGenerations: 7, minEvaluations: 2,
    tabs: ["dataset", "model", "trainer", "generation", "evaluation"], expectPretrained: true },
  { name: "Fashion-MNIST Transformer", path: "/demo/Fashion-MNIST-Transformer/",
    presetKey: "FASHION_MNIST_TRANSFORMER_PRESET",
    minModels: 3, minTrainers: 3, minGenerations: 0, minEvaluations: 1,
    tabs: ["dataset", "model", "trainer", "evaluation"], expectPretrained: true },
  { name: "TrAISformer", path: "/demo/TrAISformer/",
    presetKey: "TRAISFORMER_PRESET",
    minModels: 3, minTrainers: 3, minGenerations: 0, minEvaluations: 1,
    tabs: ["dataset", "model", "trainer", "evaluation"], expectPretrained: true, expectLeaflet: true },
  { name: "LSTM-VAE", path: "/demo/LSTM-VAE-for-dominant-motion-extraction/",
    presetKey: "LSTM_VAE_DEMO_PRESET",
    minModels: 2, minTrainers: 2, minGenerations: 2, minEvaluations: 1,
    tabs: ["dataset", "model", "trainer", "generation", "evaluation"] },
  { name: "Oscillator Surrogate", path: "/demo/Oscillator-Surrogate/",
    presetKey: "OSCILLATOR_DEMO_PRESET",
    minModels: 5, minTrainers: 5, minGenerations: 3, minEvaluations: 1,
    tabs: ["dataset", "model", "trainer", "generation", "evaluation"], expectPretrained: true },
];

async function testDemo(browser, demo) {
  var page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  var consoleErrors = [];
  page.on("console", function (msg) { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", function (err) { consoleErrors.push(String(err)); });

  var url = BASE + demo.path;
  console.log("\n=== " + demo.name + " ===");
  console.log("  URL: " + url);

  try { await page.goto(url, { waitUntil: "networkidle2", timeout: TIMEOUT }); }
  catch (e) { ok(false, "Page load failed: " + e.message.slice(0, 100)); await page.close(); return; }
  ok(true, "Page loaded");
  await sleep(2000);

  var appReady = await page.evaluate(function () {
    return !!(document.querySelector(".osc-workspace") || document.querySelector(".osc-tab-btn"));
  });
  ok(appReady, "App shell rendered");

  // Preset validation
  if (demo.presetKey) {
    var preset = await page.evaluate(function (key) {
      var p = window[key]; if (!p) return null;
      return { datasetId: p.dataset ? p.dataset.id : null, models: p.models ? p.models.length : 0,
        trainers: p.trainers ? p.trainers.length : 0, generations: p.generations ? p.generations.length : 0,
        evaluations: p.evaluations ? p.evaluations.length : 0 };
    }, demo.presetKey);
    ok(!!preset, "Preset loaded: " + demo.presetKey);
    if (preset) {
      ok(!!preset.datasetId, "Dataset in preset");
      if (demo.minModels) ok(preset.models >= demo.minModels, "Models >= " + demo.minModels + " (got " + preset.models + ")");
      if (demo.minTrainers) ok(preset.trainers >= demo.minTrainers, "Trainers >= " + demo.minTrainers + " (got " + preset.trainers + ")");
      if (demo.minGenerations != null) ok(preset.generations >= demo.minGenerations, "Generations >= " + demo.minGenerations + " (got " + preset.generations + ")");
      if (demo.minEvaluations) ok(preset.evaluations >= demo.minEvaluations, "Evaluations >= " + demo.minEvaluations + " (got " + preset.evaluations + ")");
    }
    if (demo.expectPretrained) {
      var ptOk = await page.evaluate(function (key) {
        var p = window[key]; if (!p || !p.trainers) return false;
        return p.trainers.some(function (t) { return t.status === "done" && t._pretrainedVar; });
      }, demo.presetKey);
      ok(ptOk, "Pretrained trainer cards present");
    }
  }

  // Tab navigation
  for (var i = 0; i < demo.tabs.length; i++) {
    var tab = demo.tabs[i];
    var clicked = await clickTab(page, tab);
    ok(clicked, "Tab exists: " + tab);
    await sleep(1500);
    var state = await tabHasContent(page);
    ok(state.ok, "Tab renders: " + tab + " (" + state.detail + ")");

    // Leaflet map check
    if (tab === "dataset" && demo.expectLeaflet) {
      await page.evaluate(function () {
        var items = document.querySelectorAll(".left-dataset-item");
        if (items.length) items[0].click();
      });
      await sleep(2000);
      await page.evaluate(function () {
        var btns = Array.from(document.querySelectorAll("button"));
        var gb = btns.find(function (b) { return b.textContent.trim().includes("Generate"); });
        if (gb && !gb.disabled) gb.click();
      });
      await sleep(10000);
      var leaflet = await hasLeafletMap(page);
      ok(leaflet.found, "Leaflet map rendered");
      if (leaflet.found) ok(leaflet.tiles >= 1, "Leaflet tiles loaded (" + leaflet.tiles + ")");
    }
  }

  var fatal = filterFatalErrors(consoleErrors);
  ok(fatal.length === 0, "No fatal JS errors (" + fatal.length + ")");
  if (fatal.length) fatal.slice(0, 3).forEach(function (e) { console.log("    ERROR: " + e.slice(0, 200)); });
  await page.close();
}

async function testMainAppFlow(browser) {
  console.log("\n=== Main App: Dataset + Train Flow ===");
  var page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  var consoleErrors = [];
  page.on("console", function (msg) { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", function (err) { consoleErrors.push(String(err)); });

  try { await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: TIMEOUT }); }
  catch (e) { ok(false, "Main app load failed"); await page.close(); return; }
  ok(true, "Main app loaded");
  await sleep(2000);

  // Dataset tab — create + generate
  await clickTab(page, "dataset");
  await sleep(1000);
  await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll("button"));
    var nb = btns.find(function (b) { return b.textContent.trim().includes("New Dataset"); });
    if (nb) nb.click();
  });
  await sleep(500);
  await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll("button"));
    var gb = btns.find(function (b) { return b.textContent.trim().includes("Generate"); });
    if (gb && !gb.disabled) gb.click();
  });
  await sleep(25000); // CDN fetch can be slow
  var dsReady = await page.evaluate(function () {
    var active = document.querySelector(".osc-workspace.active");
    var main = active ? active.querySelector(".osc-panel-main") : null;
    return main && main.textContent.length > 200;
  });
  if (dsReady) ok(true, "Dataset generated with content");
  else warn("Dataset generation slow or not triggered (CDN-dependent)");

  // Model tab — just verify renders
  await clickTab(page, "model");
  await sleep(1000);
  var modelState = await tabHasContent(page);
  ok(modelState.ok, "Model tab renders");

  // Trainer tab — create trainer
  await clickTab(page, "trainer");
  await sleep(1000);
  var trainerState = await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll("button"));
    var nt = btns.find(function (b) { return b.textContent.trim().includes("New Trainer"); });
    if (nt) { nt.click(); return "created"; }
    var items = document.querySelectorAll(".left-dataset-item");
    if (items.length > 0) { items[0].click(); return "selected"; }
    return "none";
  });
  ok(trainerState !== "none", "Trainer available (" + trainerState + ")");
  await sleep(500);

  // Set 1 epoch, try training
  await page.evaluate(function () {
    var ws = document.querySelector(".osc-workspace.active"); if (!ws) return;
    ws.querySelectorAll(".osc-form-row,.row").forEach(function (row) {
      var l = row.querySelector("label"), inp = row.querySelector("input");
      if (!l || !inp) return;
      if (l.textContent.toLowerCase().includes("epoch") && inp.type === "number") {
        inp.value = "1"; inp.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  });

  var trainStarted = await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll("button"));
    var tb = btns.find(function (b) {
      var t = b.textContent.trim();
      return (t === "Start Training" || t === "Continue Training") && !b.disabled;
    });
    if (tb) { tb.click(); return true; }
    return false;
  });

  if (trainStarted) {
    ok(true, "Training started (1 epoch, client TF.js)");
    var t0 = Date.now(), trainDone = false;
    while (Date.now() - t0 < 120000) {
      trainDone = await page.evaluate(function () {
        return Array.from(document.querySelectorAll("button")).some(function (b) { return b.textContent.trim() === "Continue Training"; });
      });
      if (trainDone) break;
      await sleep(2000);
    }
    ok(trainDone, "Training completed");
  } else {
    warn("Could not start training (dataset may not be ready)");
  }

  var fatal = filterFatalErrors(consoleErrors);
  ok(fatal.length === 0, "No fatal JS errors in flow");
  await page.close();
}

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Surrogate Studio — GitHub Pages E2E Test    ║");
  console.log("║  Base: " + BASE.padEnd(38) + "║");
  console.log("╚══════════════════════════════════════════════╝");

  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-web-security"],
  });

  try {
    for (var i = 0; i < DEMOS.length; i++) await testDemo(browser, DEMOS[i]);
    await testMainAppFlow(browser);
  } finally { await browser.close(); }

  console.log("\n════════════════════════════════════════════════");
  if (failed === 0) {
    console.log("\x1b[32m  PASS: All " + passed + " checks passed" + (warnings ? " (" + warnings + " warnings)" : "") + "\x1b[0m");
  } else {
    console.log("\x1b[31m  FAIL: " + passed + " passed, " + failed + " failed" + (warnings ? ", " + warnings + " warnings" : "") + "\x1b[0m");
    errors.forEach(function (e) { console.log("  - " + e); });
  }
  console.log("════════════════════════════════════════════════\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (err) { console.error("FATAL:", err); process.exit(1); });

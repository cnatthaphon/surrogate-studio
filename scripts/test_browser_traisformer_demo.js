"use strict";
/**
 * Browser smoke test for TrAISformer demo.
 *
 * Verifies:
 * - page loads with no fatal JS errors
 * - AIS dataset module is registered
 * - Dataset tab renders a preview canvas
 * - Playground tab renders AIS content instead of blank fallback
 * - Model tab renders Drawflow nodes
 */

var path = require("path");
var puppeteer = require("puppeteer");

var ROOT = path.resolve(__dirname, "..");
var DEMO_FILE = path.join(ROOT, "demo", "TrAISformer", "index.html");

var passed = 0, failed = 0, errors = [];
function ok(cond, label) {
  if (cond) { passed++; console.log("  \x1b[32m\u2713\x1b[0m " + label); }
  else { failed++; errors.push(label); console.log("  \x1b[31m\u2717\x1b[0m " + label); }
}

async function clickTab(page, label) {
  await page.evaluate(function (targetLabel) {
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.trim().toLowerCase() === String(targetLabel || "").toLowerCase()) {
        btns[i].click();
        return true;
      }
    }
    return false;
  }, label);
  await new Promise(function (r) { setTimeout(r, 1200); });
}

async function main() {
  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    var page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 960 });

    var consoleErrors = [];
    page.on("console", function (msg) {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", function (err) {
      consoleErrors.push(String(err));
    });

    await page.goto("file://" + DEMO_FILE, { waitUntil: "networkidle0", timeout: 60000 });
    ok(true, "Page loaded");

    var bootInfo = await page.evaluate(function () {
      return {
        hasPreset: !!window.TRAISFORMER_PRESET,
        hasAisModule: !!(window.OSCDatasetModules && window.OSCDatasetModules.getModule && window.OSCDatasetModules.getModule("ais_dma")),
        modelCount: window.TRAISFORMER_PRESET && window.TRAISFORMER_PRESET.models ? window.TRAISFORMER_PRESET.models.length : 0,
      };
    });
    ok(bootInfo.hasPreset, "TrAISformer preset exists");
    ok(bootInfo.hasAisModule, "AIS dataset module is registered");
    ok(bootInfo.modelCount === 3, "Preset model count = 3");

    await clickTab(page, "dataset");
    await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().toLowerCase() === "generate dataset") {
          btns[i].click();
          return true;
        }
      }
      return false;
    });
    await page.waitForFunction(function () {
      var active = document.querySelector(".osc-workspace.active");
      return !!(active && active.textContent.indexOf("Status: ✓ ready") >= 0);
    }, { timeout: 60000 });
    var datasetState = await page.evaluate(function () {
      var active = document.querySelector(".osc-workspace.active");
      return {
        hasCanvas: active ? !!active.querySelector("canvas") : false,
        text: active ? active.textContent.slice(0, 600) : "",
      };
    });
    ok(datasetState.hasCanvas, "Dataset tab renders AIS preview canvas");

    await clickTab(page, "playground");
    var playgroundState = await page.evaluate(function () {
      var active = document.querySelector(".osc-workspace.active");
      return {
        hasCanvas: active ? !!active.querySelector("canvas") : false,
        text: active ? active.textContent.slice(0, 600) : "",
      };
    });
    ok(playgroundState.hasCanvas, "Playground tab renders AIS canvas");
    ok(playgroundState.text.indexOf("AIS") >= 0, "Playground shows AIS content");

    await clickTab(page, "model");
    var modelState = await page.evaluate(function () {
      var active = document.querySelector(".osc-workspace.active");
      return {
        hasDrawflow: active ? !!active.querySelector(".drawflow") : false,
        nodeCount: active ? active.querySelectorAll(".drawflow-node").length : 0,
      };
    });
    ok(modelState.hasDrawflow, "Model tab renders Drawflow");
    ok(modelState.nodeCount >= 5, "Model graph nodes visible (" + modelState.nodeCount + ")");

    var fatalErrors = consoleErrors.filter(function (msg) {
      if (!msg) return false;
      return msg.indexOf("favicon") < 0 &&
        msg.indexOf("net::ERR") < 0 &&
        msg.indexOf("DevTools") < 0;
    });
    ok(fatalErrors.length === 0, "No fatal JS errors (" + fatalErrors.length + ")");
    if (fatalErrors.length) {
      fatalErrors.slice(0, 5).forEach(function (msg) { console.log("    ERROR: " + msg.slice(0, 200)); });
    }

    console.log("\n========================================");
    if (failed === 0) console.log("\x1b[32m  PASS: All " + passed + " TrAISformer demo tests passed\x1b[0m");
    else {
      console.log("\x1b[31m  FAIL: " + passed + " passed, " + failed + " failed\x1b[0m");
      errors.forEach(function (e) { console.log("  - " + e); });
    }
    console.log("========================================\n");
  } finally {
    await browser.close();
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (err) { console.error("FATAL:", err); process.exit(1); });

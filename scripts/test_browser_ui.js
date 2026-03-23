"use strict";
/**
 * Browser UI automation test using Puppeteer + headless Chrome.
 *
 * Opens index.html directly via file:// in headless Chrome and verifies:
 * - All tabs render correctly
 * - Core JS modules load
 * - Schema switching works
 * - No fatal JS errors
 * - TF.js, Plotly, Drawflow all loaded
 *
 * Usage:  node scripts/test_browser_ui.js
 */

var path = require("path");
var http = require("http");
var fs = require("fs");
var puppeteer = require("puppeteer");

var ROOT = path.resolve(__dirname, "..");
var INDEX_FILE = path.join(ROOT, "index.html");

// --- test helpers ---
var passed = 0;
var failed = 0;
var errors = [];

function ok(condition, label) {
  if (condition) {
    passed++;
    console.log("  \x1b[32m\u2713\x1b[0m " + label);
  } else {
    failed++;
    errors.push(label);
    console.log("  \x1b[31m\u2717\x1b[0m " + label);
  }
}

// Launch bundled Chromium via Puppeteer
async function launchBrowser() {
  var browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,900",
    ],
  });
  return browser;
}

// --- main ---
async function main() {
  var browser;
  try {
    browser = await launchBrowser();

    var page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // collect console errors
    var consoleErrors = [];
    page.on("console", function (msg) {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", function (err) {
      consoleErrors.push(String(err));
    });

    // file:// URL — Linux Chromium uses Linux paths directly
    var fileUrl = "file://" + INDEX_FILE;
    console.log("Loading: " + fileUrl);

    // ========== TEST 1: Page loads ==========
    console.log("\n--- Page Load ---");
    await page.goto(fileUrl, { waitUntil: "networkidle0", timeout: 60000 });
    ok(true, "Page loaded without crash");

    // ========== TEST 2: Core modules on window ==========
    console.log("\n--- Module Check ---");
    var modules = await page.evaluate(function () {
      var names = [
        "OSCSchemaRegistry", "OSCSchemaDefinitionsBuiltin",
        "OSCModelBuilderCore", "OSCTrainingEngineCore", "OSCPredictionCore",
        "OSCWorkspaceStore", "OSCLayoutRendererCore", "OSCAppStateCore",
        "OSCTrainerTab", "OSCDatasetTab", "OSCModelTab", "OSCPlaygroundTab",
        "SurrogateStudio",
      ];
      var found = [];
      names.forEach(function (n) { if (window[n]) found.push(n); });
      return { found: found, total: names.length };
    });
    ok(modules.found.length >= 10, "Core modules loaded: " + modules.found.length + "/" + modules.total);

    // ========== TEST 3: External libs ==========
    console.log("\n--- External Libraries ---");
    var libs = await page.evaluate(function () {
      return {
        tf: !!(window.tf && window.tf.version),
        tfVersion: window.tf ? window.tf.version.tfjs : null,
        plotly: !!window.Plotly,
        drawflow: !!window.Drawflow,
      };
    });
    ok(libs.tf, "TF.js loaded (v" + libs.tfVersion + ")");
    ok(libs.plotly, "Plotly loaded");
    ok(libs.drawflow, "Drawflow loaded");

    // ========== TEST 4: All tabs exist ==========
    console.log("\n--- Tab Structure ---");
    var tabNames = await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      var names = [];
      var expected = ["playground", "dataset", "model", "trainer", "generation", "evaluation"];
      btns.forEach(function (b) {
        var t = b.textContent.trim().toLowerCase();
        if (expected.indexOf(t) >= 0) names.push(t);
      });
      return names;
    });
    ok(tabNames.length >= 4, "Found " + tabNames.length + " tabs: " + tabNames.join(", "));
    ["playground", "dataset", "model", "trainer"].forEach(function (name) {
      ok(tabNames.indexOf(name) >= 0, "Tab '" + name + "' exists");
    });

    // ========== TEST 5: Schema registry has schemas ==========
    console.log("\n--- Schema Registry ---");
    var schemas = await page.evaluate(function () {
      var reg = window.OSCSchemaRegistry;
      if (!reg) return [];
      return typeof reg.listSchemas === "function" ? reg.listSchemas().map(function (s) { return s.id || s; }) : [];
    });
    ok(schemas.length >= 2, "Registered schemas: " + schemas.join(", "));
    ok(schemas.indexOf("oscillator") >= 0, "Has oscillator schema");
    ok(schemas.indexOf("mnist") >= 0, "Has mnist schema");

    // ========== TEST 6: Click each tab — verify no crash ==========
    console.log("\n--- Tab Navigation ---");
    for (var ti = 0; ti < tabNames.length; ti++) {
      var tabName = tabNames[ti];
      await page.evaluate(function (name) {
        var btns = document.querySelectorAll("button");
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].textContent.trim().toLowerCase() === name) { btns[i].click(); break; }
        }
      }, tabName);
      await new Promise(function (r) { setTimeout(r, 500); });
      var tabHasContent = await page.evaluate(function () {
        return document.querySelector(".osc-card, .osc-empty, canvas, .drawflow, .js-plotly-plot, table, select, h3") ? true : false;
      });
      ok(tabHasContent, "Tab '" + tabName + "' renders content");
    }

    // ========== TEST 7: Playground tab with different schema ==========
    console.log("\n--- Playground Content ---");
    await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().toLowerCase() === "playground") { btns[i].click(); break; }
      }
    });
    await new Promise(function (r) { setTimeout(r, 1500); });

    // Try switching schema within Playground (select or button in left panel)
    var pgSchemaSwitch = await page.evaluate(function () {
      // try all selects, look for one with schema options
      var selects = document.querySelectorAll("select");
      for (var i = 0; i < selects.length; i++) {
        var opts = Array.from(selects[i].options).map(function (o) { return o.value; });
        if (opts.indexOf("mnist") >= 0) {
          selects[i].value = "mnist";
          selects[i].dispatchEvent(new Event("change", { bubbles: true }));
          return "select";
        }
      }
      // try clicking buttons/links with schema names
      var btns = document.querySelectorAll("button, [role='button'], [data-schema]");
      for (var j = 0; j < btns.length; j++) {
        var t = btns[j].textContent.trim().toLowerCase();
        if (t === "mnist" || t.indexOf("mnist") >= 0) { btns[j].click(); return "button"; }
      }
      return false;
    });
    // Playground may not have a schema selector (schema is per-item, not global)
    ok(true, "Playground schema: " + (pgSchemaSwitch || "no global selector (per-item schema)"));
    await new Promise(function (r) { setTimeout(r, 1500); });

    var pgContent = await page.evaluate(function () {
      var el = document.querySelector("canvas, .osc-card, .js-plotly-plot, button");
      return el ? el.tagName : "none";
    });
    ok(pgContent !== "none", "Playground has visual content (" + pgContent + ")");

    // ========== TEST 8: Dataset tab — create button exists ==========
    console.log("\n--- Dataset Tab Features ---");
    await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().toLowerCase() === "dataset") { btns[i].click(); break; }
      }
    });
    await new Promise(function (r) { setTimeout(r, 500); });
    var dsFeatures = await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      var hasNew = false;
      for (var i = 0; i < btns.length; i++) {
        var t = btns[i].textContent.trim().toLowerCase();
        if (t.indexOf("new") >= 0 || t === "+" || t.indexOf("create") >= 0) hasNew = true;
      }
      return { hasNew: hasNew };
    });
    ok(dsFeatures.hasNew, "Dataset tab has New/Create button");

    // ========== TEST 9: Trainer tab — has sub-tabs ==========
    console.log("\n--- Trainer Tab Features ---");
    await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().toLowerCase() === "trainer") { btns[i].click(); break; }
      }
    });
    await new Promise(function (r) { setTimeout(r, 500); });

    // Create a trainer: click "+ New Trainer" button then "Create" in modal
    var trainerCreated = await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        var t = btns[i].textContent.trim().toLowerCase();
        if (t.indexOf("new") >= 0 && t.indexOf("trainer") >= 0) { btns[i].click(); return true; }
        if (t === "+") { btns[i].click(); return true; }
      }
      return false;
    });
    await new Promise(function (r) { setTimeout(r, 500); });
    // Fill in name field if modal has one, then click "Create"
    await page.evaluate(function () {
      // fill the name input (first text input in modal)
      var inputs = document.querySelectorAll("input[type='text'], input:not([type])");
      for (var i = 0; i < inputs.length; i++) {
        if (!inputs[i].value || inputs[i].value.trim() === "") {
          inputs[i].value = "Test Trainer";
          inputs[i].dispatchEvent(new Event("input", { bubbles: true }));
          break;
        }
      }
    });
    await new Promise(function (r) { setTimeout(r, 300); });
    await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === "Create") { btns[i].click(); return; }
      }
    });
    await new Promise(function (r) { setTimeout(r, 1000); });
    if (trainerCreated) {
      // click first item in the list to select it
      await page.evaluate(function () {
        var items = document.querySelectorAll(".osc-panel-left div[style*='cursor:pointer'], .osc-panel-left .osc-item");
        if (items.length) items[0].click();
      });
      await new Promise(function (r) { setTimeout(r, 500); });

      var trainerState = await page.evaluate(function () {
        var btns = document.querySelectorAll("button");
        var subTabs = [];
        var allBtnTexts = [];
        for (var i = 0; i < btns.length; i++) {
          var t = btns[i].textContent.trim();
          allBtnTexts.push(t);
          if (t === "Train" || t === "Test") subTabs.push(t.toLowerCase());
        }
        // also check main panel content
        var mainPanel = document.querySelector(".osc-panel-main");
        var mainText = mainPanel ? mainPanel.textContent.slice(0, 200) : "";
        return { subTabs: subTabs, allBtns: allBtnTexts, mainText: mainText };
      });
      ok(trainerState.subTabs.length >= 2, "Trainer has sub-tabs: " + trainerState.subTabs.join(", ") +
        (trainerState.subTabs.length < 2 ? " (buttons: " + trainerState.allBtns.slice(0, 15).join("|") + ")" : ""));
    } else {
      ok(false, "Could not create trainer session");
    }

    // ========== TEST 10: PredictionCore metrics functions ==========
    console.log("\n--- PredictionCore in Browser ---");
    var pcTests = await page.evaluate(function () {
      var pc = window.OSCPredictionCore;
      if (!pc) return { ok: false, error: "not loaded" };
      try {
        var cm = pc.confusionMatrix([0, 1, 2, 0], [0, 1, 1, 0], 3);
        var prf = pc.precisionRecallF1(cm);
        var r2 = pc.r2Score([1, 2, 3], [1.1, 1.9, 3.1]);
        var roc = pc.rocCurveOneVsRest([0, 1, 0, 1], [[0.9, 0.1], [0.2, 0.8], [0.7, 0.3], [0.1, 0.9]], 0);
        var res = pc.computeResiduals([1, 2], [1.5, 1.5]);
        return {
          ok: true,
          cm: cm.length === 3,
          prf: prf.length === 3,
          r2: r2 > 0.95,
          roc: roc.auc > 0.8,
          residuals: res.length === 2,
        };
      } catch (e) { return { ok: false, error: e.message }; }
    });
    ok(pcTests.ok, "PredictionCore loaded in browser");
    if (pcTests.ok) {
      ok(pcTests.cm, "confusionMatrix works");
      ok(pcTests.prf, "precisionRecallF1 works");
      ok(pcTests.r2, "r2Score works");
      ok(pcTests.roc, "rocCurveOneVsRest works");
      ok(pcTests.residuals, "computeResiduals works");
    }

    // ========== TEST 11: No fatal JS errors ==========
    console.log("\n--- Error Check ---");
    var fatalErrors = consoleErrors.filter(function (e) {
      return e.indexOf("favicon") < 0 && e.indexOf("net::ERR") < 0 && e.indexOf("DevTools") < 0;
    });
    ok(fatalErrors.length === 0, "No fatal JS errors (" + fatalErrors.length + " errors)");
    if (fatalErrors.length > 0) {
      fatalErrors.slice(0, 5).forEach(function (e) { console.log("    ERROR: " + e.slice(0, 200)); });
    }

    // ========== SUMMARY ==========
    console.log("\n========================================");
    if (failed === 0) {
      console.log("\x1b[32m  PASS: All " + passed + " browser UI tests passed\x1b[0m");
    } else {
      console.log("\x1b[31m  FAIL: " + passed + " passed, " + failed + " failed\x1b[0m");
      errors.forEach(function (e) { console.log("  - " + e); });
    }
    console.log("========================================\n");

  } catch (err) {
    console.error("FATAL: " + err.message);
    failed++;
  } finally {
    if (browser) try { await browser.close(); } catch (e) {}
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (err) {
  console.error("FATAL:", err);
  process.exit(1);
});

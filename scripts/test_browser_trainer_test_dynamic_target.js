"use strict";
// Regression test for the activeDs rebuild path in src/tabs/trainer_tab.js.
// PR #91 added a strict throw in model_builder_core.targetUnitsFromMode
// when no width hint is available. The trainer's Test-tab inference path
// (~line 893) and the Train path (~line 2153) BOTH rebuild activeDs as
// a fresh object before calling buildModelFromGraph — if the rebuild
// drops `targetSize` (which existed in the original activeDs), the
// strict throw fires for dynamic-width regression targets like
// ais_trajectory.position. This test drives the TrAISformer Trainer
// tab through Test + Train clicks and verifies the build doesn't throw
// "Cannot resolve output width".

var puppeteer = require("puppeteer");

var BASE = "http://localhost:3777";
var DEMO = "TrAISformer";

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  var passed = 0, failed = 0;
  function ok(cond, label) {
    if (cond) { passed++; console.log("  ✓ " + label); }
    else { failed++; console.log("  ✗ " + label); }
  }

  var pageErrors = [];
  try {
    var page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on("pageerror", function (e) { pageErrors.push(String(e && e.message || e)); });
    page.on("console", function (msg) {
      var t = msg.text();
      if (/Cannot resolve output width/.test(t)) pageErrors.push("[console] " + t);
    });

    await page.goto(BASE + "/demo/" + DEMO + "/index.html", { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(3000);

    // Trainer tab + select a pre-trained card so the Test path's
    // activeDs rebuild runs against ais_trajectory (dynamic-width
    // target — needs targetSize preserved through the rebuild).
    await page.evaluate(function () {
      var btns = Array.from(document.querySelectorAll("button"));
      var t = btns.find(function (b) { return b.textContent.trim() === "Trainer"; });
      if (t) t.click();
    });
    await sleep(1500);

    // Find and click a pre-trained trainer card. The DOM class isn't
    // stable across tabs, so use a text-content fallback that scans
    // every clickable left-panel item.
    var pickedTrainer = await page.evaluate(function () {
      var clickables = Array.from(document.querySelectorAll(
        ".osc-workspace.active [class*='item'], .osc-workspace.active [class*='card'], .osc-workspace.active li, .osc-workspace.active button"
      ));
      var match = clickables.find(function (el) {
        var txt = (el.textContent || "").trim();
        return /MLP Baseline.*pre-trained/i.test(txt) && txt.length < 200;
      }) || clickables.find(function (el) {
        var txt = (el.textContent || "").trim();
        return /pre-trained/i.test(txt) && txt.length < 200;
      });
      if (match) { match.click(); return match.textContent.trim().slice(0, 80); }
      return null;
    });
    ok(pickedTrainer != null, "picked a pre-trained trainer card (" + pickedTrainer + ")");
    await sleep(2000);

    // Click the Test sub-tab (the Test button inside the right panel).
    // Trainer tab UI has a Train/Test toggle near the top of the main panel.
    var clickedTest = await page.evaluate(function () {
      var btns = Array.from(document.querySelectorAll("button"));
      var t = btns.find(function (b) { return b.textContent.trim() === "Test"; });
      if (t) { t.click(); return true; }
      return false;
    });
    ok(clickedTest, "clicked Test sub-tab");
    await sleep(3500);

    // No "Cannot resolve output width" anywhere — the activeDs rebuild
    // in the Test path must preserve (or infer) targetSize so the build
    // doesn't fire the strict throw.
    var widthErrors = pageErrors.filter(function (e) { return /Cannot resolve output width/.test(e); });
    ok(widthErrors.length === 0,
      "no 'Cannot resolve output width' error after Test click (got " + widthErrors.length + " match(es))");

    // Also drive the Train path: click Train then "Start Training" if it
    // exists. We don't want to actually run a full train, just hit the
    // build step.
    await page.evaluate(function () {
      var btns = Array.from(document.querySelectorAll("button"));
      var t = btns.find(function (b) { return b.textContent.trim() === "Train"; });
      if (t) t.click();
    });
    await sleep(1500);

    // Pick a draft (non-pretrained) trainer card so Start Training is enabled.
    await page.evaluate(function () {
      var ws = document.querySelector(".osc-workspace.active") || document;
      var items = Array.from(ws.querySelectorAll(".left-trainer-item, .left-item"));
      var match = items.find(function (it) {
        var txt = it.textContent || "";
        return /MLP Baseline Trainer/i.test(txt) && !/pre-trained/i.test(txt);
      });
      if (match) match.click();
    });
    await sleep(1500);

    var clickedStart = await page.evaluate(function () {
      var btns = Array.from(document.querySelectorAll("button"));
      var t = btns.find(function (b) { return /^(Start Training|Train)$/i.test(b.textContent.trim()); });
      if (t) { t.click(); return true; }
      return false;
    });
    // Give the build step a moment — the throw (if any) happens before
    // any epoch fires. We don't wait for a full epoch.
    await sleep(4000);

    var widthErrors2 = pageErrors.filter(function (e) { return /Cannot resolve output width/.test(e); });
    ok(widthErrors2.length === 0,
      "no 'Cannot resolve output width' error during Train build (start clicked: " + clickedStart + ", got " + widthErrors2.length + " match(es))");
  } catch (e) {
    console.error("Fatal:", e && e.message);
    failed++;
  } finally {
    await browser.close();
  }

  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

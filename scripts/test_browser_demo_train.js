"use strict";
/**
 * Browser test: generate dataset + train MLP-AE in the demo.
 * Verifies the full pipeline works end-to-end in headless Chrome.
 */
var path = require("path");
var puppeteer = require("puppeteer");

var ROOT = path.resolve(__dirname, "..");
var DEMO_FILE = path.join(ROOT, "demo", "LSTM-VAE-for-dominant-motion-extraction", "index.html");

var passed = 0, failed = 0, errors = [];
function ok(cond, label) {
  if (cond) { passed++; console.log("  \x1b[32m\u2713\x1b[0m " + label); }
  else { failed++; errors.push(label); console.log("  \x1b[31m\u2717\x1b[0m " + label); }
}

async function main() {
  var browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"] });
  try {
    var page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    var jsErrors = [];
    page.on("pageerror", function (e) { jsErrors.push(String(e)); });
    page.on("console", function (msg) { if (msg.type() === "error" && msg.text().indexOf("favicon") < 0 && msg.text().indexOf("net::ERR") < 0) jsErrors.push(msg.text()); });

    await page.goto("file://" + DEMO_FILE, { waitUntil: "networkidle0", timeout: 60000 });
    console.log("Page loaded\n");

    // Step 1: Generate dataset
    console.log("--- Generate Dataset ---");
    // click Generate Dataset button
    var genClicked = await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().indexOf("Generate") >= 0) { btns[i].click(); return true; }
      }
      return false;
    });
    ok(genClicked, "Clicked Generate Dataset");
    await new Promise(function (r) { setTimeout(r, 3000); }); // wait for build

    var dsReady = await page.evaluate(function () {
      var main = document.querySelector(".osc-workspace.active .osc-panel-main");
      return main ? main.textContent.slice(0, 300) : "";
    });
    ok(dsReady.indexOf("Ant Trajectories") >= 0 || dsReady.indexOf("Train") >= 0 || dsReady.indexOf("timestep") >= 0,
      "Dataset generated: " + dsReady.slice(0, 80));

    // Step 2: Switch to trainer tab and train MLP-AE
    console.log("\n--- Train MLP-AE ---");
    await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().toLowerCase() === "trainer") { btns[i].click(); break; }
      }
    });
    await new Promise(function (r) { setTimeout(r, 1000); });

    // click MLP-AE trainer (second item)
    await page.evaluate(function () {
      var items = document.querySelectorAll(".osc-workspace.active .osc-panel-left div[style*='cursor']");
      if (items.length > 1) items[1].click(); // second trainer = MLP-AE
      else if (items.length) items[0].click();
    });
    await new Promise(function (r) { setTimeout(r, 500); });

    // set epochs to 3 for fast test
    await page.evaluate(function () {
      var inputs = document.querySelectorAll(".osc-workspace.active .osc-panel-right input[data-config-key]");
      inputs.forEach(function (inp) {
        if (inp.getAttribute("data-config-key") === "epochs") {
          inp.value = "3";
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });

    // click Start Training
    var trainClicked = await page.evaluate(function () {
      var btns = document.querySelectorAll(".osc-workspace.active button");
      for (var i = 0; i < btns.length; i++) {
        var t = btns[i].textContent.trim();
        if (t === "Start Training" || t.indexOf("Train") >= 0) { btns[i].click(); return t; }
      }
      return false;
    });
    ok(!!trainClicked, "Clicked: " + trainClicked);

    // wait for training (max 30s)
    console.log("  Waiting for training...");
    var trainResult = "unknown";
    for (var wait = 0; wait < 60; wait++) {
      await new Promise(function (r) { setTimeout(r, 500); });
      trainResult = await page.evaluate(function () {
        var status = document.querySelector(".osc-header .osc-status");
        return status ? status.textContent : "";
      });
      if (trainResult.indexOf("Done") >= 0 || trainResult.indexOf("error") >= 0 || trainResult.indexOf("Error") >= 0) break;
    }
    ok(trainResult.indexOf("Done") >= 0, "Training result: " + trainResult.slice(0, 100));

    // check epoch table has rows
    var epochRows = await page.evaluate(function () {
      var tbody = document.querySelector(".osc-workspace.active .osc-panel-main tbody");
      return tbody ? tbody.children.length : 0;
    });
    ok(epochRows >= 2, "Epoch table has " + epochRows + " rows");

    // Step 3: Check for JS errors
    console.log("\n--- Errors ---");
    var fatalErrors = jsErrors.filter(function (e) { return e.indexOf("Worker") < 0 && e.indexOf("favicon") < 0; });
    ok(fatalErrors.length === 0, "No fatal JS errors (" + fatalErrors.length + ")");
    if (fatalErrors.length) {
      fatalErrors.slice(0, 3).forEach(function (e) { console.log("    " + e.slice(0, 200)); });
    }

    console.log("\n========================================");
    if (failed === 0) console.log("\x1b[32m  PASS: All " + passed + " demo train tests passed\x1b[0m");
    else { console.log("\x1b[31m  FAIL: " + passed + " passed, " + failed + " failed\x1b[0m"); errors.forEach(function (e) { console.log("  - " + e); }); }
    console.log("========================================\n");
  } finally { await browser.close(); }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (e) { console.error("FATAL:", e); process.exit(1); });

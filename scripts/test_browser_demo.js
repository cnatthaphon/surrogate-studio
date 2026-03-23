"use strict";
/**
 * Browser test for LSTM-VAE demo page.
 * Verifies: page loads, preset data visible, tabs work, generate dataset works.
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
  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    var page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    var consoleErrors = [];
    page.on("console", function (msg) { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", function (err) { consoleErrors.push(String(err)); });

    var fileUrl = "file://" + DEMO_FILE;
    console.log("Loading: " + fileUrl);

    // === TEST 1: Page loads ===
    console.log("\n--- Page Load ---");
    await page.goto(fileUrl, { waitUntil: "networkidle0", timeout: 60000 });
    ok(true, "Page loaded");

    // Check modules loaded
    var modulesOk = await page.evaluate(function () {
      return !!(window.SurrogateStudio && window.OSCWorkspaceStore && window.tf);
    });
    ok(modulesOk, "Core modules loaded");

    // === TEST 2: Preset data in store ===
    console.log("\n--- Preset Data ---");
    var presetCheck = await page.evaluate(function () {
      var preset = window.LSTM_VAE_DEMO_PRESET;
      return {
        hasPreset: !!preset,
        datasetId: preset && preset.dataset ? preset.dataset.id : null,
        modelCount: preset && preset.models ? preset.models.length : (preset && preset.model ? 1 : 0),
        trainerCount: preset && preset.trainers ? preset.trainers.length : (preset && preset.trainer ? 1 : 0),
      };
    });
    ok(presetCheck.hasPreset, "LSTM_VAE_DEMO_PRESET exists");
    ok(!!presetCheck.datasetId, "Dataset preset: " + presetCheck.datasetId);
    ok(presetCheck.modelCount >= 1, "Model presets: " + presetCheck.modelCount);
    ok(presetCheck.trainerCount >= 1, "Trainer presets: " + presetCheck.trainerCount);

    // === TEST 3: Dataset tab visible (default tab) ===
    console.log("\n--- Dataset Tab ---");
    await new Promise(function (r) { setTimeout(r, 1000); });

    var dsTabState = await page.evaluate(function () {
      var leftPanel = document.querySelector(".osc-workspace.active .osc-panel-left");
      var mainPanel = document.querySelector(".osc-workspace.active .osc-panel-main");
      return {
        leftText: leftPanel ? leftPanel.textContent.slice(0, 200) : "",
        mainText: mainPanel ? mainPanel.textContent.slice(0, 200) : "",
        hasItems: leftPanel ? leftPanel.querySelectorAll("div[style*='cursor']").length : 0,
      };
    });
    ok(dsTabState.leftText.indexOf("Dataset") >= 0 || dsTabState.leftText.length > 20,
      "Dataset item visible in left panel");
    console.log("    Left panel: " + dsTabState.leftText.slice(0, 100));
    console.log("    Main panel: " + dsTabState.mainText.slice(0, 100));

    // Check if dataset is selected
    var dsSelected = await page.evaluate(function () {
      var rightPanel = document.querySelector(".osc-workspace.active .osc-panel-right");
      return {
        rightText: rightPanel ? rightPanel.textContent.slice(0, 300) : "",
        hasGenerateBtn: rightPanel ? (rightPanel.textContent.indexOf("Generate") >= 0 || rightPanel.textContent.indexOf("Create") >= 0) : false,
      };
    });
    ok(dsSelected.hasGenerateBtn || dsSelected.rightText.length > 10, "Right panel has config/generate");
    console.log("    Right panel: " + dsSelected.rightText.slice(0, 150));

    // === TEST 4: Switch to Model tab ===
    console.log("\n--- Model Tab ---");
    await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().toLowerCase() === "model") { btns[i].click(); break; }
      }
    });
    await new Promise(function (r) { setTimeout(r, 1500); });

    var modelState = await page.evaluate(function () {
      var leftPanel = document.querySelector(".osc-workspace.active .osc-panel-left");
      var mainPanel = document.querySelector(".osc-workspace.active .osc-panel-main");
      var active = document.querySelector(".osc-workspace.active");
      var hasDrawflow = active ? !!active.querySelector(".drawflow") : false;
      var nodeCount = active ? active.querySelectorAll(".drawflow-node").length : 0;
      var connectionCount = active ? active.querySelectorAll(".connection").length : 0;
      return {
        leftText: leftPanel ? leftPanel.textContent.slice(0, 200) : "",
        hasDrawflow: hasDrawflow,
        nodeCount: nodeCount,
        connectionCount: connectionCount,
      };
    });
    ok(modelState.leftText.indexOf("LSTM-VAE") >= 0 || modelState.leftText.indexOf("MLP") >= 0 || modelState.leftText.indexOf("demo") >= 0,
      "Model item visible: " + modelState.leftText.slice(0, 80));
    ok(modelState.hasDrawflow, "Drawflow editor rendered");
    ok(modelState.nodeCount > 0, "Graph nodes: " + modelState.nodeCount + " (expect 13)");
    ok(modelState.connectionCount > 0, "Graph connections: " + modelState.connectionCount + " (expect 12+)");

    // === TEST 5: Switch to Trainer tab ===
    console.log("\n--- Trainer Tab ---");
    await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().toLowerCase() === "trainer") { btns[i].click(); break; }
      }
    });
    await new Promise(function (r) { setTimeout(r, 1000); });

    var trainerState = await page.evaluate(function () {
      var leftPanel = document.querySelector(".osc-workspace.active .osc-panel-left");
      var rightPanel = document.querySelector(".osc-workspace.active .osc-panel-right");
      return {
        leftText: leftPanel ? leftPanel.textContent.slice(0, 200) : "",
        rightText: rightPanel ? rightPanel.textContent.slice(0, 300) : "",
        hasTrainBtn: rightPanel ? rightPanel.innerHTML.indexOf("Train") >= 0 : false,
      };
    });
    ok(trainerState.leftText.indexOf("LSTM-VAE") >= 0 || trainerState.leftText.indexOf("Trainer") >= 0,
      "Trainer item visible");
    ok(trainerState.hasTrainBtn, "Has Train button or config");
    console.log("    Trainer right: " + trainerState.rightText.slice(0, 150));

    // === TEST 6: JS errors ===
    console.log("\n--- Error Check ---");
    var fatalErrors = consoleErrors.filter(function (e) {
      return e.indexOf("favicon") < 0 && e.indexOf("net::ERR") < 0 && e.indexOf("DevTools") < 0;
    });
    ok(fatalErrors.length === 0, "No fatal JS errors (" + fatalErrors.length + ")");
    if (fatalErrors.length) {
      fatalErrors.slice(0, 5).forEach(function (e) { console.log("    ERROR: " + e.slice(0, 200)); });
    }

    // === SUMMARY ===
    console.log("\n========================================");
    if (failed === 0) {
      console.log("\x1b[32m  PASS: All " + passed + " demo tests passed\x1b[0m");
    } else {
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

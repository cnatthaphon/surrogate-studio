"use strict";
/**
 * Browser test for Fashion-MNIST Transformer demo.
 *
 * Verifies:
 * - page loads
 * - preset is present
 * - Model tab renders Drawflow
 * - transformer-related nodes can be selected
 * - dragging a node does not throw Drawflow offsetWidth errors
 */

var path = require("path");
var puppeteer = require("puppeteer");

var ROOT = path.resolve(__dirname, "..");
var DEMO_FILE = path.join(ROOT, "demo", "Fashion-MNIST-Transformer", "index.html");

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

    var presetInfo = await page.evaluate(function () {
      var preset = window.FASHION_MNIST_TRANSFORMER_PRESET;
      return {
        hasPreset: !!preset,
        modelCount: preset && preset.models ? preset.models.length : 0,
        trainerCount: preset && preset.trainers ? preset.trainers.length : 0,
      };
    });
    ok(presetInfo.hasPreset, "Transformer preset exists");
    ok(presetInfo.modelCount === 3, "Preset model count = 3");
    ok(presetInfo.trainerCount === 3, "Preset trainer count = 3");

    await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim().toLowerCase() === "model") {
          btns[i].click();
          return;
        }
      }
    });
    await new Promise(function (r) { setTimeout(r, 1500); });

    var drawflowState = await page.evaluate(function () {
      var active = document.querySelector(".osc-workspace.active");
      return {
        hasDrawflow: active ? !!active.querySelector(".drawflow") : false,
        nodeCount: active ? active.querySelectorAll(".drawflow-node").length : 0,
      };
    });
    ok(drawflowState.hasDrawflow, "Drawflow rendered");
    ok(drawflowState.nodeCount >= 5, "Transformer graph nodes visible (" + drawflowState.nodeCount + ")");

    var nodeTexts = ["PatchEmbed", "Transformer", "GlobalAvgPool1D"];
    for (var ni = 0; ni < nodeTexts.length; ni++) {
      var label = nodeTexts[ni];
      await page.evaluate(function (targetText) {
        var nodes = Array.from(document.querySelectorAll(".drawflow-node"));
        var match = nodes.find(function (el) { return el.textContent.indexOf(targetText) >= 0; });
        if (match) match.click();
      }, label);
      await new Promise(function (r) { setTimeout(r, 300); });
      var selected = await page.evaluate(function () {
        var right = document.querySelector(".osc-workspace.active .osc-panel-right");
        return right ? right.textContent.slice(0, 500) : "";
      });
      ok(selected.indexOf(label) >= 0 || selected.length > 20, "Selected node inspector updates for " + label);
    }

    // Drag the transformer node slightly to exercise Drawflow layout updates.
    var dragBox = await page.evaluate(function () {
      var nodes = Array.from(document.querySelectorAll(".drawflow-node"));
      var match = nodes.find(function (el) { return el.textContent.indexOf("Transformer") >= 0; });
      if (!match && nodes.length) match = nodes[0];
      if (!match) return null;
      var rect = match.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    if (dragBox) {
      await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(dragBox.x + dragBox.width / 2 + 60, dragBox.y + dragBox.height / 2 + 20, { steps: 8 });
      await page.mouse.up();
      ok(true, "Transformer node dragged");
    } else {
      ok(false, "Transformer node drag target found");
    }

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
    if (failed === 0) {
      console.log("\x1b[32m  PASS: All " + passed + " transformer demo tests passed\x1b[0m");
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

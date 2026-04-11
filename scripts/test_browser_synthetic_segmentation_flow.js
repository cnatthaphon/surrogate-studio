#!/usr/bin/env node
"use strict";
/**
 * Focused browser smoke for Synthetic Segmentation demo.
 * Verifies dataset generation, image/mask preview, all tabs,
 * evaluation card with mask metrics, and no fatal JS errors.
 */
var path = require("path");
var http = require("http");
var fs = require("fs");
var puppeteer = require("puppeteer");

var ROOT = path.resolve(__dirname, "..");
var PORT = 9940;
var passed = 0, failed = 0;

function ok(cond, label) {
  if (cond) { passed++; console.log("  \x1b[32m✓\x1b[0m " + label); }
  else { failed++; console.log("  \x1b[31m✗\x1b[0m " + label); }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
function startServer() {
  var server = http.createServer(function (req, res) {
    var fp = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (fp.endsWith("/")) fp += "index.html";
    fs.readFile(fp, function (err, data) {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise(function (r) { server.listen(PORT, function () { r(server); }); });
}

function clickTab(page, name) {
  return page.evaluate(function (n) {
    var btns = Array.from(document.querySelectorAll(".osc-tab-btn, button"));
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.trim().toLowerCase() === n.toLowerCase()) { btns[i].click(); return true; }
    }
    return false;
  }, name);
}

async function main() {
  var server = await startServer();
  var browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  var page = await browser.newPage();
  var jsErrors = [];
  page.on("pageerror", function (e) { jsErrors.push(String(e)); });
  page.on("console", function (m) { if (m.type() === "error") jsErrors.push(m.text()); });

  console.log("=== Synthetic Segmentation Flow ===");
  await page.goto("http://localhost:" + PORT + "/demo/Synthetic-Segmentation/index.html", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(2000);

  // 1. Preset loaded
  ok(await page.evaluate(function () { return !!window.SYNTHETIC_SEGMENTATION_PRESET; }), "Preset loaded");

  // 2. App rendered
  ok(await page.evaluate(function () { return !!document.querySelector(".osc-workspace"); }), "App shell rendered");

  // 3. Generate dataset
  await clickTab(page, "dataset");
  await sleep(500);
  await page.evaluate(function () { var i = document.querySelectorAll(".left-dataset-item"); if (i.length) i[0].click(); });
  await sleep(500);
  await page.evaluate(function () { var b = Array.from(document.querySelectorAll("button")).find(function(b){return b.textContent.trim().includes("Generate");}); if (b && !b.disabled) b.click(); });
  await sleep(3000);
  var dsContent = await page.evaluate(function () { var m = document.querySelector(".osc-workspace.active .osc-panel-main"); return m ? m.textContent.length : 0; });
  ok(dsContent > 50, "Dataset generated (" + dsContent + " chars)");

  // 4. Image/mask preview canvases
  var canvasCount = await page.evaluate(function () { return document.querySelectorAll("canvas").length; });
  ok(canvasCount >= 2, "Image/mask canvases rendered (" + canvasCount + ")");

  // 5. Model tab
  await clickTab(page, "model");
  await sleep(1000);
  await page.evaluate(function () { var i = document.querySelectorAll(".left-dataset-item"); if (i.length) i[0].click(); });
  await sleep(1000);
  ok(await page.evaluate(function () { return !!document.querySelector(".drawflow"); }), "Model graph rendered");

  // 6. Trainer tab
  await clickTab(page, "trainer");
  await sleep(500);
  ok(await page.evaluate(function () { var m = document.querySelector(".osc-workspace.active .osc-panel-main"); return m && m.textContent.length > 20; }), "Trainer tab renders");

  // 7. Evaluation tab
  await clickTab(page, "evaluation");
  await sleep(500);
  ok(await page.evaluate(function () { var m = document.querySelector(".osc-workspace.active .osc-panel-main"); return m && m.textContent.length > 20; }), "Evaluation tab renders");

  // 8. Select evaluation card
  await page.evaluate(function () { var i = document.querySelectorAll(".left-dataset-item"); if (i.length) i[0].click(); });
  await sleep(500);

  // 9. Mask metrics appear in evaluation UI
  var evalText = await page.evaluate(function () { var a = document.querySelector(".osc-workspace.active"); return a ? a.textContent : ""; });
  ok(evalText.indexOf("Mask IoU") >= 0 || evalText.indexOf("mask_iou") >= 0, "Evaluation shows Mask IoU");
  ok(evalText.indexOf("Dice") >= 0 || evalText.indexOf("dice") >= 0, "Evaluation shows Dice");
  ok(evalText.indexOf("Pixel") >= 0 || evalText.indexOf("pixel_accuracy") >= 0, "Evaluation shows Pixel Accuracy");

  // 10. No fatal JS errors
  var fatal = jsErrors.filter(function (e) { return e.indexOf("favicon") < 0 && e.indexOf("net::ERR") < 0 && e.indexOf("404") < 0; });
  ok(fatal.length === 0, "No fatal JS errors (" + fatal.length + ")");
  if (fatal.length) fatal.slice(0, 3).forEach(function (e) { console.log("    " + e.slice(0, 150)); });

  console.log("\n" + (failed === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m") + ": " + passed + "/" + (passed + failed));
  await browser.close();
  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (e) { console.error("FATAL:", e); process.exit(1); });

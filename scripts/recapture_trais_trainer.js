"use strict";
// Recapture demo/TrAISformer/images/trainer_pretrained.png against
// a pretrained trainer card so the screenshot shows the 20-epoch /
// batch-256 config + the loaded loss curve, matching the README.
// The old capture pointed at a draft (untrained) live trainer
// where the config + chart didn't reflect the shipped pretrained.

var puppeteer = require("puppeteer");
var path = require("path");

var ROOT = path.resolve(__dirname, "..");
var URL = "http://localhost:3777/demo/TrAISformer/";
var OUT = path.join(ROOT, "demo/TrAISformer/images/trainer_pretrained.png");

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  var page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(3000);

  // Click Trainer tab
  await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll("button"));
    var t = btns.find(function (b) { return b.textContent.trim() === "Trainer"; });
    if (t) t.click();
  });
  await sleep(1500);

  // Select the MLP Baseline (pre-trained) card so the right panel shows the
  // shipped pretrained's config + metrics + loss curve.
  var picked = await page.evaluate(function () {
    var ws = document.querySelector(".osc-workspace.active") || document;
    var items = Array.from(ws.querySelectorAll(".left-trainer-item, .left-item"));
    var match = items.find(function (it) { return /MLP Baseline.*pre-trained/i.test(it.textContent || ""); }) ||
      items.find(function (it) { return /pre-trained/i.test(it.textContent || ""); }) ||
      items[0];
    if (match) { match.click(); return match.textContent.trim().slice(0, 60); }
    return null;
  });
  console.log("Selected:", picked);
  await sleep(3000);

  await page.screenshot({ path: OUT, fullPage: false });
  console.log("Saved:", OUT, "(" + require("fs").statSync(OUT).size + " bytes)");

  await browser.close();
})().catch(function (e) {
  console.error("FAIL:", e && e.message);
  process.exit(1);
});

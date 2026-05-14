"use strict";
// Open a demo, run its first eval recipe, then dump the eval run results
// (a regular JS object kept on window via the workspace store) as JSON.
//
//   node scripts/extract_eval_numbers.js <Demo-Name>
//
// Requires the local server on :3777.
var puppeteer = require("puppeteer");
var path = require("path");
var fs = require("fs");

var BASE = "http://localhost:3777";
var DEMO = process.argv[2];
if (!DEMO) { console.error("usage: node extract_eval_numbers.js <Demo-Name>"); process.exit(2); }
var SAVE_SCREENSHOT = process.argv.indexOf("--save-screenshot") >= 0;

var WAITS = {
  "Fashion-MNIST-GAN":                            { dataset: 60000, eval: 120000 },
  "Fashion-MNIST-Conditional-Diffusion":          { dataset: 60000, eval: 90000 },
  "Fashion-MNIST-Diffusion":                      { dataset: 60000, eval: 90000 },
  "LSTM-VAE-for-dominant-motion-extraction":      { dataset: 8000,  eval: 30000 },
  "Oscillator-Surrogate":                          { dataset: 5000,  eval: 30000 },
  "Text-Sentiment-Transformer":                    { dataset: 5000,  eval: 30000 },
};

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  var w = WAITS[DEMO] || { dataset: 8000, eval: 30000 };
  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    var page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(BASE + "/demo/" + DEMO + "/index.html", { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);

    async function clickTab(label) {
      await page.evaluate(function (l) {
        var btns = Array.from(document.querySelectorAll("button"));
        var m = btns.find(function (b) { return b.textContent.trim() === l; });
        if (m) m.click();
      }, label);
      await sleep(1200);
    }
    async function clickFirstItem() {
      return await page.evaluate(function () {
        var ws = document.querySelector(".osc-workspace.active") || document;
        var items = ws.querySelectorAll(".left-evaluation-item, .left-dataset-item");
        if (items.length) { items[0].click(); return items[0].textContent.trim().substring(0, 60); }
        return null;
      });
    }
    async function clickByText(t) {
      return await page.evaluate(function (txt) {
        var btns = Array.from(document.querySelectorAll("button"));
        var m = btns.find(function (b) { return b.textContent.trim() === txt || b.textContent.trim().indexOf(txt) === 0; });
        if (m) { m.click(); return true; }
        return false;
      }, t);
    }

    await clickTab("Dataset");
    await clickFirstItem();
    await sleep(400);
    await clickByText("Generate Dataset");
    await sleep(w.dataset);

    await clickTab("Evaluation");
    await clickFirstItem();
    await sleep(800);
    await clickByText("Run Evaluation");
    await sleep(w.eval);

    var dump = await page.evaluate(function () {
      var table = document.querySelector("table.osc-metric-table");
      if (!table) return { source: "no_table" };
      var headers = Array.from(table.querySelector("tr").children).map(function (c) { return c.textContent.trim(); });
      var trs = Array.from(table.querySelectorAll("tr")).slice(1);
      var rows = trs.map(function (tr) {
        var cells = Array.from(tr.children).map(function (c) { return c.textContent.trim(); });
        var row = {};
        headers.forEach(function (h, i) { row[h] = cells[i]; });
        return row;
      });
      return { source: "table", headers: headers, rows: rows };
    });
    console.log(JSON.stringify(dump, null, 2));
    if (dump.source !== "table" || !Array.isArray(dump.rows) || dump.rows.length === 0) {
      throw new Error("Evaluation table missing or empty for " + DEMO + " (source=" + dump.source + ")");
    }

    if (SAVE_SCREENSHOT) {
      var imgDir = path.resolve(__dirname, "..", "demo", DEMO, "images");
      if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
      await page.screenshot({ path: path.join(imgDir, "04_test.png"), fullPage: false });
      console.error("[saved] " + path.join(imgDir, "04_test.png"));
    }
  } finally {
    await browser.close();
  }
})().catch(function (e) { console.error("Fatal:", e); process.exit(1); });

/**
 * Capture missing screenshots (01_dataset, 04_test, 05_generation) for 4 demos:
 *   - Fashion-MNIST-Conditional-Diffusion
 *   - SAR-Ship-Detection
 *   - Synthetic-Detection
 *   - Synthetic-Segmentation
 *
 * For each demo:
 *   1. Click Dataset tab -> Generate Dataset (instant for synthetic, ~30MB for FM)
 *   2. Click Model tab (re-capture for completeness)
 *   3. Click Trainer tab (re-capture)
 *   4. Click Evaluation tab -> Run Evaluation -> wait -> screenshot
 *   5. Click Generation tab -> Generate -> wait -> screenshot
 *
 * Run with the static training server already running on :3777.
 *   node scripts/capture_missing_demo_screenshots.js
 */
"use strict";

var puppeteer = require("puppeteer");
var path = require("path");
var fs = require("fs");

var BASE_URL = "http://localhost:3777";
var VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var DEMOS_ALL = [
  {
    name: "Fashion-MNIST-Diffusion",
    images: "demo/Fashion-MNIST-Diffusion/images",
    datasetWaitMs: 60000,
    evalWaitMs: 60000,
    genWaitMs: 30000,
  },
  {
    name: "Fashion-MNIST-GAN",
    images: "demo/Fashion-MNIST-GAN/images",
    datasetWaitMs: 60000,
    evalWaitMs: 60000,
    genWaitMs: 30000,
  },
  {
    name: "Fashion-MNIST-UNet",
    images: "demo/Fashion-MNIST-UNet/images",
    datasetWaitMs: 60000,
    evalWaitMs: 120000,
    genWaitMs: 30000,
  },
  {
    name: "LSTM-VAE-for-dominant-motion-extraction",
    images: "demo/LSTM-VAE-for-dominant-motion-extraction/images",
    datasetWaitMs: 8000,
    evalWaitMs: 30000,
    genWaitMs: 20000,
  },
  {
    name: "Oscillator-Surrogate",
    images: "demo/Oscillator-Surrogate/images",
    datasetWaitMs: 5000,
    evalWaitMs: 25000,
    genWaitMs: 15000,
  },
  {
    name: "TrAISformer",
    images: "demo/TrAISformer/images",
    datasetWaitMs: 8000,
    evalWaitMs: 90000,
    genWaitMs: 20000,
  },
  {
    name: "Cell-Nuclei-Segmentation",
    images: "demo/Cell-Nuclei-Segmentation/images",
    datasetWaitMs: 4000,
    evalWaitMs: 25000,
    genWaitMs: 15000,
  },
  {
    name: "Siamese-Shape-Verification",
    images: "demo/Siamese-Shape-Verification/images",
    datasetWaitMs: 4000,
    evalWaitMs: 25000,
    genWaitMs: 15000,
  },
  {
    name: "Text-Sentiment-Transformer",
    images: "demo/Text-Sentiment-Transformer/images",
    datasetWaitMs: 4000,
    evalWaitMs: 25000,
    genWaitMs: 15000,
  },
  {
    name: "Synthetic-Segmentation",
    images: "demo/Synthetic-Segmentation/images",
    datasetWaitMs: 4000,
    evalWaitMs: 25000,
    genWaitMs: 15000,
  },
  {
    name: "Synthetic-Detection",
    images: "demo/Synthetic-Detection/images",
    datasetWaitMs: 4000,
    evalWaitMs: 25000,
    genWaitMs: 15000,
  },
  {
    name: "SAR-Ship-Detection",
    images: "demo/SAR-Ship-Detection/images",
    datasetWaitMs: 8000,
    evalWaitMs: 25000,
    genWaitMs: 15000,
  },
  {
    name: "Fashion-MNIST-Conditional-Diffusion",
    images: "demo/Fashion-MNIST-Conditional-Diffusion/images",
    datasetWaitMs: 60000,
    evalWaitMs: 60000,
    genWaitMs: 30000,
  },
];

var only = process.argv[2];
var DEMOS = only ? DEMOS_ALL.filter(function (d) { return d.name === only; }) : DEMOS_ALL;
if (only && DEMOS.length === 0) {
  console.error("No demo named: " + only);
  console.error("Available: " + DEMOS_ALL.map(function (d) { return d.name; }).join(", "));
  process.exit(1);
}

async function clickTabByLabel(page, label) {
  var clicked = await page.evaluate(function (lbl) {
    var btns = Array.from(document.querySelectorAll("button"));
    var match = btns.find(function (b) { return b.textContent.trim() === lbl; });
    if (match) { match.click(); return true; }
    return false;
  }, label);
  await sleep(800);
  return clicked;
}

async function clickGenerateDataset(page) {
  return await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll("button"));
    var match = btns.find(function (b) {
      var t = b.textContent.trim().toLowerCase();
      return t === "generate dataset" || t === "load dataset" || t.indexOf("generate dataset") === 0;
    });
    if (match) { match.click(); return true; }
    return false;
  });
}

async function clickRunEvaluation(page) {
  return await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll("button"));
    var match = btns.find(function (b) {
      var t = b.textContent.trim();
      return t === "Run Evaluation" || t === "Run";
    });
    if (match) { match.click(); return true; }
    return false;
  });
}

async function clickGenerate(page) {
  return await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll("button"));
    var match = btns.find(function (b) { return b.textContent.trim() === "Generate"; });
    if (match) { match.click(); return true; }
    return false;
  });
}

async function selectFirstItemInLeftPanel(page) {
  return await page.evaluate(function () {
    var ws = document.querySelector(".osc-workspace.active") || document;
    var items = ws.querySelectorAll(".left-trainer-item, .left-evaluation-item, .left-generation-item, .left-dataset-item");
    if (items.length) { items[0].click(); return items[0].textContent.trim().substring(0, 60); }
    return null;
  });
}

async function captureDemo(browser, demo) {
  console.log("\n=== " + demo.name + " ===");
  var imgDir = path.resolve(__dirname, "..", demo.images);
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  var page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.setCacheEnabled(false);
  page.on("console", function (msg) {
    var t = msg.text();
    if (t.indexOf("Error") >= 0 || t.indexOf("error") >= 0 || t.indexOf("[eval-debug]") >= 0 || t.indexOf("[weight-load]") >= 0) {
      console.log("  [page] " + t.substring(0, 400));
    }
  });

  try {
    var url = BASE_URL + "/demo/" + demo.name + "/index.html";
    console.log("  Loading " + url);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);

    // 1. Dataset tab
    console.log("  -> Dataset tab");
    await clickTabByLabel(page, "Dataset");
    await sleep(1500);
    var pickedDs = await selectFirstItemInLeftPanel(page);
    console.log("     selected: " + pickedDs);
    await sleep(500);
    var clickedGen = await clickGenerateDataset(page);
    console.log("     Generate Dataset clicked: " + clickedGen + ", waiting " + demo.datasetWaitMs + "ms");
    await sleep(demo.datasetWaitMs);
    await page.screenshot({ path: path.join(imgDir, "01_dataset.png"), fullPage: false });
    console.log("     saved 01_dataset.png");

    // 4. Evaluation tab
    console.log("  -> Evaluation tab");
    await clickTabByLabel(page, "Evaluation");
    await sleep(1500);
    var pickedEval = await selectFirstItemInLeftPanel(page);
    console.log("     selected eval: " + pickedEval);
    await sleep(800);
    var ranEval = await clickRunEvaluation(page);
    console.log("     Run Evaluation clicked: " + ranEval + ", waiting " + demo.evalWaitMs + "ms");
    await sleep(demo.evalWaitMs);
    await page.screenshot({ path: path.join(imgDir, "04_test.png"), fullPage: false });
    console.log("     saved 04_test.png");

    // 5. Generation tab
    console.log("  -> Generation tab");
    await clickTabByLabel(page, "Generation");
    await sleep(1500);
    var pickedGen = await selectFirstItemInLeftPanel(page);
    console.log("     selected gen: " + pickedGen);
    await sleep(800);
    var ranGen = await clickGenerate(page);
    console.log("     Generate clicked: " + ranGen + ", waiting " + demo.genWaitMs + "ms");
    await sleep(demo.genWaitMs);
    await page.screenshot({ path: path.join(imgDir, "05_generation.png"), fullPage: false });
    console.log("     saved 05_generation.png");

  } catch (e) {
    console.log("  ERROR: " + e.message);
  }

  await page.close();
}

async function main() {
  try {
    var resp = await fetch(BASE_URL + "/api/health");
    var health = await resp.json();
    if (!health.ok) throw new Error("server not healthy");
    console.log("Server OK at " + BASE_URL + " (backend=" + health.backend + ")");
  } catch (e) {
    console.error("Start server first: node server/training_server.js");
    process.exit(1);
  }

  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  for (var i = 0; i < DEMOS.length; i++) {
    await captureDemo(browser, DEMOS[i]);
  }

  await browser.close();
  console.log("\nDone.");
}

main().catch(function (e) { console.error("Fatal:", e); process.exit(1); });

/**
 * Capture demo screenshots using Puppeteer.
 *
 * Run: node scripts/capture_screenshots.js
 *
 * Requires: Training server running on localhost:3777 (serves static files)
 */
"use strict";

var puppeteer = require("puppeteer");
var path = require("path");
var fs = require("fs");

var BASE_URL = "http://localhost:3777";
var VIEWPORT = { width: 1280, height: 800 };

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var DEMOS = [
  {
    name: "Fashion-MNIST-Benchmark",
    path: "/demo/Fashion-MNIST-Benchmark/index.html",
    images: "demo/Fashion-MNIST-Benchmark/images",
    shots: [
      { name: "01_dataset.png", tab: "dataset", wait: 3000 },
      { name: "02_model.png", tab: "model", wait: 2000 },
      { name: "03_trainer.png", tab: "trainer", wait: 2000 },
    ],
  },
  {
    name: "Fashion-MNIST-Transformer",
    path: "/demo/Fashion-MNIST-Transformer/index.html",
    images: "demo/Fashion-MNIST-Transformer/images",
    shots: [
      { name: "model_graph.png", tab: "model", wait: 2000 },
      { name: "trainer_pretrained.png", tab: "trainer", wait: 2000 },
    ],
  },
  {
    name: "TrAISformer",
    path: "/demo/TrAISformer/index.html",
    images: "demo/TrAISformer/images",
    shots: [
      { name: "model_graph.png", tab: "model", wait: 2000 },
      { name: "trainer_pretrained.png", tab: "trainer", wait: 2000 },
    ],
  },
  {
    name: "Oscillator-Surrogate",
    path: "/demo/Oscillator-Surrogate/index.html",
    images: "demo/Oscillator-Surrogate/images",
    shots: [
      { name: "01_playground.png", tab: "playground", wait: 3000 },
      { name: "02_model.png", tab: "model", wait: 2000 },
      { name: "03_trainer.png", tab: "trainer", wait: 2000 },
    ],
  },
  {
    name: "Fashion-MNIST-Diffusion",
    path: "/demo/Fashion-MNIST-Diffusion/index.html",
    images: "demo/Fashion-MNIST-Diffusion/images",
    shots: [
      { name: "model_denoiser.png", tab: "model", wait: 2000 },
      { name: "trainer.png", tab: "trainer", wait: 2000 },
    ],
  },
  {
    name: "Fashion-MNIST-GAN",
    path: "/demo/Fashion-MNIST-GAN/index.html",
    images: "demo/Fashion-MNIST-GAN/images",
    shots: [
      { name: "model_gan.png", tab: "model", wait: 2000 },
      { name: "trainer.png", tab: "trainer", wait: 2000 },
    ],
  },
  {
    name: "Fashion-MNIST-Conditional-Diffusion",
    path: "/demo/Fashion-MNIST-Conditional-Diffusion/index.html",
    images: "demo/Fashion-MNIST-Conditional-Diffusion/images",
    shots: [
      { name: "model_conditional.png", tab: "model", wait: 2000 },
      { name: "trainer.png", tab: "trainer", wait: 2000 },
    ],
  },
  {
    name: "LSTM-VAE",
    path: "/demo/LSTM-VAE-for-dominant-motion-extraction/index.html",
    images: "demo/LSTM-VAE-for-dominant-motion-extraction/images",
    shots: [
      { name: "model_graph.png", tab: "model", wait: 2000 },
      { name: "trainer.png", tab: "trainer", wait: 2000 },
    ],
  },
];

async function captureDemo(browser, demo) {
  console.log("\n=== " + demo.name + " ===");
  var imgDir = path.resolve(__dirname, "..", demo.images);
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  var page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  try {
    console.log("  Loading...");
    await page.goto(BASE_URL + demo.path, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(2000);

    for (var i = 0; i < demo.shots.length; i++) {
      var shot = demo.shots[i];
      console.log("  [" + shot.name + "] clicking tab: " + shot.tab);

      if (shot.tab) {
        await page.evaluate(function (tabName) {
          // Try data-tab-id attribute
          var tabs = document.querySelectorAll("[data-tab-id]");
          for (var j = 0; j < tabs.length; j++) {
            if (tabs[j].getAttribute("data-tab-id") === tabName) { tabs[j].click(); return; }
          }
          // Fallback: text content match
          var all = document.querySelectorAll("button, div[role=tab], span");
          for (var k = 0; k < all.length; k++) {
            var t = all[k].textContent.trim().toLowerCase();
            if (t === tabName.toLowerCase() || t === tabName.charAt(0).toUpperCase() + tabName.slice(1).toLowerCase()) {
              all[k].click(); return;
            }
          }
        }, shot.tab);
      }

      await sleep(shot.wait || 2000);

      var filePath = path.join(imgDir, shot.name);
      await page.screenshot({ path: filePath, fullPage: false });
      var size = fs.statSync(filePath).size;
      console.log("    Saved: " + shot.name + " (" + (size / 1024).toFixed(0) + " KB)");
    }
  } catch (e) {
    console.log("  Error: " + e.message);
  }

  await page.close();
}

async function main() {
  try {
    var resp = await fetch(BASE_URL + "/api/health");
    var health = await resp.json();
    if (!health.ok) throw new Error("not healthy");
    console.log("Server OK at " + BASE_URL);
  } catch (e) {
    console.error("Start server first: node server/training_server.js");
    process.exit(1);
  }

  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  for (var i = 0; i < DEMOS.length; i++) {
    await captureDemo(browser, DEMOS[i]);
  }

  await browser.close();
  console.log("\nAll screenshots captured.");
}

main().catch(function (e) { console.error("Fatal:", e); process.exit(1); });

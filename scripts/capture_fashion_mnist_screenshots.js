#!/usr/bin/env node
/**
 * Capture screenshots of Fashion-MNIST VAE demo.
 * Uses a small subset (1400 samples) for fast training in headless mode.
 */
"use strict";
const puppeteer = require("puppeteer");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const IMG_DIR = path.join(ROOT, "demo", "Fashion-MNIST-VAE", "images");
const PORT = 9882;
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

function startServer() {
  const server = http.createServer((req, res) => {
    let fp = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (fp.endsWith("/")) fp += "index.html";
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function clickTab(page, label) {
  await page.evaluate(lbl => {
    const b = Array.from(document.querySelectorAll(".osc-tab-btn")).find(b => b.textContent.trim() === lbl);
    if (b) b.click();
  }, label);
  await sleep(500);
}

async function main() {
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });
  const server = await startServer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
  });

  try {
    const page = await browser.newPage();
    page.on("console", msg => {
      const t = msg.text();
      if (t.includes("[capture]") || t.includes("Error") || t.includes("Done")) console.log("  [page]", t.substring(0, 120));
    });

    console.log("[navigate] Fashion-MNIST demo");
    await page.goto(`http://localhost:${PORT}/demo/Fashion-MNIST-VAE/index.html`, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(2000);
    await page.evaluate(() => { if (window.OSCTrainingWorkerBridge) window.OSCTrainingWorkerBridge = null; });

    // Dataset tab — need to generate first (fetches from CDN)
    console.log("[screenshot] dataset — generating (1400 samples for speed)...");
    await clickTab(page, "Dataset");
    await sleep(1000);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const items = ws ? ws.querySelectorAll(".left-dataset-item") : [];
      if (items.length) items[0].click();
    });
    await sleep(500);

    // Set totalCount to 1400 for fast demo
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      if (!ws) return;
      ws.querySelectorAll(".osc-form-row, .row").forEach(row => {
        const label = row.querySelector("label");
        const inp = row.querySelector("input");
        if (label && inp && (label.textContent.toLowerCase().includes("total") || label.textContent.toLowerCase().includes("count"))) {
          inp.value = "1400"; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true }));
          console.log("[capture] set totalCount to 1400");
        }
      });
    });
    await sleep(300);

    // Click Generate Dataset
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const gen = btns.find(b => b.textContent.trim().includes("Generate"));
      if (gen) { gen.click(); console.log("[capture] clicked Generate Dataset"); }
      else console.log("[capture] Generate button not found, buttons: " + btns.map(b => b.textContent.trim()).join(", "));
    });

    // Wait for dataset generation (fetches from CDN)
    console.log("  waiting for CDN fetch + dataset build...");
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      await sleep(2000);
      const status = await page.evaluate(() => {
        const el = document.querySelector(".osc-status");
        return el ? el.textContent : "";
      });
      console.log("  [" + ((Date.now() - t0) / 1000).toFixed(0) + "s] " + status.substring(0, 80));
      if (status.includes("ready") || status.includes("Ready") || status.includes("Generated") || status.includes("done")) break;
    }
    await sleep(2000);
    await page.screenshot({ path: path.join(IMG_DIR, "01_dataset.png") });
    console.log("[screenshot] dataset captured");

    // Model tab
    console.log("[screenshot] model");
    await clickTab(page, "Model");
    await sleep(1500);
    await page.screenshot({ path: path.join(IMG_DIR, "02_model_vae.png") });

    // Train VAE (5 epochs)
    console.log("[screenshot] training VAE...");
    await clickTab(page, "Trainer");
    await sleep(1000);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const items = ws ? ws.querySelectorAll(".left-dataset-item") : [];
      if (items.length) items[0].click();
    });
    await sleep(500);

    // Set 5 epochs, uncheck server
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      if (!ws) return;
      ws.querySelectorAll(".osc-form-row, .row").forEach(row => {
        const label = row.querySelector("label");
        const inp = row.querySelector("input");
        if (!label || !inp) return;
        if (label.textContent.toLowerCase().includes("epoch") && inp.type === "number") {
          inp.value = "5"; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (label.textContent.includes("PyTorch Server") && inp.type === "checkbox" && inp.checked) {
          inp.checked = false; inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });
    await sleep(300);

    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const start = btns.find(b => b.textContent.trim() === "Start Training" || b.textContent.trim() === "Continue Training");
      if (start) start.click();
    });

    // Wait for training
    const t1 = Date.now();
    while (Date.now() - t1 < 120000) {
      await sleep(3000);
      const status = await page.evaluate(() => {
        const el = document.querySelector(".osc-status");
        const ws = document.querySelector(".osc-workspace.active");
        const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
        const hasContinue = btns.some(b => b.textContent.trim() === "Continue Training");
        return { text: el ? el.textContent : "", hasContinue };
      });
      console.log("  [" + ((Date.now() - t1) / 1000).toFixed(0) + "s] " + status.text.substring(0, 80));
      if (status.hasContinue || status.text.includes("Done")) break;
    }
    await sleep(1000);
    await page.screenshot({ path: path.join(IMG_DIR, "03_trainer_vae.png") });
    console.log("[screenshot] training captured");

    // Test tab
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, [role='tab']"));
      const t = btns.find(b => b.textContent.trim().toLowerCase() === "test");
      if (t) t.click();
    });
    await sleep(3000);
    await page.screenshot({ path: path.join(IMG_DIR, "04_test_vae.png") });

    // Generation — reconstruct
    console.log("[screenshot] generation");
    await clickTab(page, "Generation");
    await sleep(1500);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const items = ws ? ws.querySelectorAll(".left-dataset-item") : [];
      if (items.length) items[0].click();
    });
    await sleep(1000);

    // Select trainer if needed
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      if (!ws) return;
      const selects = ws.querySelectorAll("select");
      selects.forEach(sel => {
        if (sel.options.length > 1 && !sel.value) {
          sel.selectedIndex = 1; sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });
    await sleep(500);

    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const gen = btns.find(b => b.textContent.trim() === "Generate");
      if (gen && !gen.disabled) gen.click();
    });
    await sleep(5000);
    await page.screenshot({ path: path.join(IMG_DIR, "05_generation.png") });

    console.log("\n[done] Screenshots:");
    fs.readdirSync(IMG_DIR).filter(f => f.endsWith(".png")).sort().forEach(f => {
      console.log("  " + f + " (" + (fs.statSync(path.join(IMG_DIR, f)).size / 1024).toFixed(0) + "KB)");
    });

  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

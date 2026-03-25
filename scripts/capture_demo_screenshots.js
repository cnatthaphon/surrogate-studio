#!/usr/bin/env node
/**
 * Capture screenshots of the LSTM-VAE demo for README documentation.
 *
 * Starts a local HTTP server, opens the demo in headless Chrome via Puppeteer,
 * trains the LSTM-VAE model, then captures screenshots of each tab and
 * generation results.
 *
 * Usage: node scripts/capture_demo_screenshots.js
 * Output: demo/LSTM-VAE-for-dominant-motion-extraction/images/*.png
 */
"use strict";

const puppeteer = require("puppeteer");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEMO_DIR = path.join(ROOT, "demo", "LSTM-VAE-for-dominant-motion-extraction");
const IMG_DIR = path.join(DEMO_DIR, "images");
const PORT = 9877;

// Simple static file server
function startServer() {
  const MIME = {
    ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
    ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
    ".svg": "image/svg+xml", ".woff2": "font/woff2",
  };
  const server = http.createServer((req, res) => {
    let filePath = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (filePath.endsWith("/")) filePath += "index.html";
    const ext = path.extname(filePath);
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(PORT, () => {
    console.log(`[server] http://localhost:${PORT}`);
    resolve(server);
  }));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
      const text = msg.text();
      if (text.includes("[capture]") || text.includes("[trainer]") || text.includes("[generation]") || text.includes("Epoch") || text.includes("error") || text.includes("Error")) {
        console.log(`  [page] ${text.substring(0, 200)}`);
      }
    });

    const demoUrl = `http://localhost:${PORT}/demo/LSTM-VAE-for-dominant-motion-extraction/index.html`;
    console.log(`[navigate] ${demoUrl}`);
    await page.goto(demoUrl, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(2000);

    // Force main-thread training (Worker can't resolve paths in subdirectory demos)
    await page.evaluate(() => {
      if (window.OSCTrainingWorkerBridge) {
        window._origWorkerBridge = window.OSCTrainingWorkerBridge;
        window.OSCTrainingWorkerBridge = null;
        console.log("[capture] disabled Worker bridge — will use main-thread training");
      }
    });

    // --- 1. Playground tab ---
    console.log("[screenshot] playground");
    await clickTab(page, "Playground");
    await sleep(3000); // let Plotly render
    await page.screenshot({ path: path.join(IMG_DIR, "01_playground.png") });

    // --- 2. Dataset tab ---
    console.log("[screenshot] dataset");
    await clickTab(page, "Dataset");
    await sleep(2000);
    // click the first dataset item if present
    await page.evaluate(() => {
      const items = document.querySelectorAll(".left-dataset-item, .osc-item-list li");
      if (items.length) items[0].click();
    });
    await sleep(2000);
    await page.screenshot({ path: path.join(IMG_DIR, "02_dataset.png") });

    // --- 3. Model tab (LSTM-VAE graph) ---
    console.log("[screenshot] model");
    await clickTab(page, "Model");
    await sleep(2000);
    // click first model item
    await page.evaluate(() => {
      const items = document.querySelectorAll(".left-dataset-item, .osc-item-list li");
      if (items.length) items[0].click();
    });
    await sleep(2000);
    await page.screenshot({ path: path.join(IMG_DIR, "03_model_lstm_vae.png") });

    // click second model (MLP-AE)
    await page.evaluate(() => {
      const items = document.querySelectorAll(".left-dataset-item, .osc-item-list li");
      if (items.length > 1) items[1].click();
    });
    await sleep(2000);
    await page.screenshot({ path: path.join(IMG_DIR, "04_model_mlp_ae.png") });

    // --- 4. Trainer tab — train LSTM-VAE ---
    console.log("[screenshot] trainer - starting LSTM-VAE training...");
    await clickTab(page, "Trainer");
    await sleep(2000);

    // Use ACTIVE workspace to find the correct panels
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      if (!ws) { console.log("[capture] no active workspace"); return; }
      const left = ws.querySelector(".osc-panel-left");
      const right = ws.querySelector(".osc-panel-right");
      console.log("[capture] active workspace found, left=" + !!left + ", right=" + !!right);
      if (left) {
        const items = left.querySelectorAll("*");
        const texts = [];
        items.forEach(el => { if (el.children.length === 0 && el.textContent.trim()) texts.push(el.tagName + ":" + el.textContent.trim().substring(0, 30)); });
        console.log("[capture] left items: " + texts.slice(0, 15).join(" | "));
      }
      if (right) {
        const btns = Array.from(right.querySelectorAll("button"));
        console.log("[capture] right buttons: " + JSON.stringify(btns.map(b => b.textContent.trim())));
      }
    });
    await sleep(500);

    // reduce epochs for fast capture + set batch size smaller
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      if (!ws) return;
      const rows = ws.querySelectorAll(".osc-form-row, .row");
      rows.forEach(row => {
        const label = row.querySelector("label");
        const inp = row.querySelector("input, select");
        if (!label || !inp) return;
        const lt = label.textContent.toLowerCase();
        if (lt.includes("epoch")) { inp.value = "20"; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); console.log("[capture] set epochs to 20"); }
        if (lt.includes("batch")) { inp.value = "64"; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); console.log("[capture] set batch to 64"); }
      });
    });
    await sleep(500);

    // capture before training
    await page.screenshot({ path: path.join(IMG_DIR, "05_trainer_before.png") });

    // click Start Training button
    const trained = await trainModel(page);
    if (trained) {
      await sleep(2000);
      await page.screenshot({ path: path.join(IMG_DIR, "06_trainer_after.png") });

      // click Test sub-tab if available
      const hasTestTab = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, [role='tab']"));
        const testBtn = btns.find(b => b.textContent.trim().toLowerCase() === "test");
        if (testBtn) { testBtn.click(); return true; }
        return false;
      });
      if (hasTestTab) {
        await sleep(3000);
        await page.screenshot({ path: path.join(IMG_DIR, "07_trainer_test.png") });
      }
    }

    // --- 5. Generation tab — reconstruct ---
    console.log("[screenshot] generation - reconstruct mode");
    await clickTab(page, "Generation");
    await sleep(2000);

    // click the first trained model in left panel (any clickable div)
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const left = ws ? ws.querySelector(".osc-panel-left") : document.querySelector(".osc-panel-left");
      if (!left) { console.log("[capture] no left panel in generation"); return; }
      const clickables = Array.from(left.querySelectorAll("div[style*='cursor']"));
      console.log("[capture] generation left items: " + clickables.length);
      if (clickables.length) { clickables[0].click(); console.log("[capture] clicked first gen model"); }
    });
    await sleep(1500);

    // method should already be "reconstruct" (default for VAE)
    // verify and set if needed
    await page.evaluate(() => {
      const sel = document.querySelector("select[data-key='method']");
      if (sel) {
        console.log("[capture] current method: " + sel.value);
        if (sel.value !== "reconstruct") { sel.value = "reconstruct"; sel.dispatchEvent(new Event("change")); }
      }
    });
    await sleep(500);

    // click Generate button
    const genBtn = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const scope = ws || document;
      const btns = Array.from(scope.querySelectorAll("button"));
      const gen = btns.find(b => b.textContent.trim() === "Generate");
      if (gen) { console.log("[capture] clicking Generate"); gen.click(); return true; }
      console.log("[capture] Generate button not found, btns: " + btns.map(b=>b.textContent.trim()).join(", "));
      return false;
    });

    if (genBtn) {
      console.log("  waiting for generation...");
      await waitForGeneration(page);
      await sleep(3000); // let Plotly render
      await page.screenshot({ path: path.join(IMG_DIR, "08_generation_reconstruct.png") });

      // scroll down to see all charts
      await page.evaluate(() => {
        const main = document.querySelector(".osc-panel-main");
        if (main) main.scrollTop = main.scrollHeight / 2;
      });
      await sleep(1000);
      await page.screenshot({ path: path.join(IMG_DIR, "09_generation_reconstruct_charts.png") });

      await page.evaluate(() => {
        const main = document.querySelector(".osc-panel-main");
        if (main) main.scrollTop = main.scrollHeight;
      });
      await sleep(1000);
      await page.screenshot({ path: path.join(IMG_DIR, "10_generation_reconstruct_heatmap.png") });
    }

    // --- 6. Generation tab — random sampling ---
    console.log("[screenshot] generation - random sampling");
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const scope = ws || document;
      const btns = Array.from(scope.querySelectorAll("button"));
      const clr = btns.find(b => b.textContent.trim() === "Clear Results");
      if (clr) clr.click();
    });
    await sleep(500);

    await page.evaluate(() => {
      const sel = document.querySelector("select[data-key='method']");
      if (sel) { sel.value = "random"; sel.dispatchEvent(new Event("change")); }
    });
    await sleep(300);

    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const scope = ws || document;
      const btns = Array.from(scope.querySelectorAll("button"));
      const gen = btns.find(b => b.textContent.trim() === "Generate");
      if (gen) gen.click();
    });
    await waitForGeneration(page);
    await sleep(3000);
    await page.screenshot({ path: path.join(IMG_DIR, "11_generation_random.png") });

    console.log("\n[done] Screenshots saved to: demo/LSTM-VAE-for-dominant-motion-extraction/images/");
    console.log("Files:");
    fs.readdirSync(IMG_DIR).filter(f => f.endsWith(".png")).sort().forEach(f => {
      const size = (fs.statSync(path.join(IMG_DIR, f)).size / 1024).toFixed(0);
      console.log(`  ${f} (${size}KB)`);
    });

  } finally {
    await browser.close();
    server.close();
  }
}

async function clickTab(page, label) {
  await page.evaluate((lbl) => {
    const btns = Array.from(document.querySelectorAll(".osc-tab-btn"));
    const btn = btns.find(b => b.textContent.trim() === lbl);
    if (btn) btn.click();
  }, label);
  await sleep(500);
}

async function trainModel(page) {
  // find and click Start Training in the ACTIVE workspace's right panel
  const clicked = await page.evaluate(() => {
    const ws = document.querySelector(".osc-workspace.active");
    const scope = ws || document;
    const btns = Array.from(scope.querySelectorAll("button"));
    const names = btns.map(b => b.textContent.trim());
    console.log("[capture] all buttons in active workspace: " + JSON.stringify(names));
    const start = btns.find(b => {
      const t = b.textContent.trim();
      return t === "Start Training" || t === "Continue Training";
    });
    if (start) { console.log("[capture] clicking: " + start.textContent.trim()); start.click(); return true; }
    return false;
  });
  if (!clicked) { console.log("  [warn] Could not find Start Training button"); return false; }

  console.log("  training started, waiting for completion...");
  const maxWait = 180000; // 3 min max
  const t0 = Date.now();
  await sleep(3000); // give it a moment to start

  while (Date.now() - t0 < maxWait) {
    await sleep(2000);
    const status = await page.evaluate(() => {
      const statusEl = document.querySelector(".osc-status");
      const statusText = statusEl ? statusEl.textContent : "";
      const ws = document.querySelector(".osc-workspace.active");
      const scope = ws || document;
      const btns = Array.from(scope.querySelectorAll("button"));
      const hasContinue = btns.some(b => b.textContent.trim() === "Continue Training");
      const epochRows = scope.querySelectorAll("tr");
      return {
        statusText,
        hasContinue,
        epochRows: epochRows.length,
        done: hasContinue || statusText.toLowerCase().includes("done") || statusText.toLowerCase().includes("complete") || statusText.toLowerCase().includes("finished"),
      };
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`  [${elapsed}s] ${status.statusText.substring(0, 100)} (epochs: ${status.epochRows}, continue: ${status.hasContinue})`);
    if (status.done) {
      console.log("  training complete!");
      return true;
    }
  }
  console.log("  [warn] Training timeout — capturing current state");
  return true;
}

async function waitForGeneration(page) {
  const maxWait = 30000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await sleep(1000);
    const done = await page.evaluate(() => {
      const statusEl = document.querySelector(".osc-status");
      const text = statusEl ? statusEl.textContent : "";
      return text.includes("done") || text.includes("error");
    });
    if (done) return;
  }
}

main().catch(err => { console.error(err); process.exit(1); });

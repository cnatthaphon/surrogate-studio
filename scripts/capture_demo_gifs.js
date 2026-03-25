#!/usr/bin/env node
/**
 * Capture individual GIFs for each demo section:
 * 1. dataset.gif — data visualization + split stats
 * 2. model.gif — Drawflow graph editor
 * 3. training.gif — training progress (loss curve filling in)
 * 4. generation.gif — reconstruct + random sampling
 *
 * Usage: node scripts/capture_demo_gifs.js
 * Output: demo/LSTM-VAE-for-dominant-motion-extraction/images/*.gif
 */
"use strict";

const puppeteer = require("puppeteer");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const IMG_DIR = path.join(ROOT, "demo", "LSTM-VAE-for-dominant-motion-extraction", "images");
const PORT = 9879;

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
  await page.evaluate((lbl) => {
    const btns = Array.from(document.querySelectorAll(".osc-tab-btn"));
    const btn = btns.find(b => b.textContent.trim() === lbl);
    if (btn) btn.click();
  }, label);
  await sleep(400);
}

function framePath(dir, idx) { return path.join(dir, `f_${String(idx).padStart(5, "0")}.png`); }

async function captureN(page, dir, n, intervalMs) {
  let idx = 0;
  for (let i = 0; i < n; i++) {
    await page.screenshot({ path: framePath(dir, idx++) });
    if (i < n - 1) await sleep(intervalMs);
  }
  return idx;
}

function framesToGif(framesDir, outputPath, fps, scale) {
  const palettePath = path.join(framesDir, "pal.png");
  const sc = scale || 800;
  execSync(`ffmpeg -y -framerate ${fps} -i "${framesDir}/f_%05d.png" -vf "fps=${fps},scale=${sc}:-1:flags=lanczos,palettegen=max_colors=64" "${palettePath}"`, { stdio: "pipe" });
  execSync(`ffmpeg -y -framerate ${fps} -i "${framesDir}/f_%05d.png" -i "${palettePath}" -lavfi "fps=${fps},scale=${sc}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" "${outputPath}"`, { stdio: "pipe" });
  const size = (fs.statSync(outputPath).size / 1024).toFixed(0);
  console.log(`  → ${path.basename(outputPath)} (${size}KB)`);
}

function cleanFrames(dir) { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true }); }

async function main() {
  try { execSync("which ffmpeg", { stdio: "pipe" }); }
  catch { console.error("ffmpeg required"); process.exit(1); }

  const server = await startServer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1.5 },
  });
  const FPS = 4;
  const INTERVAL = 250;

  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/demo/LSTM-VAE-for-dominant-motion-extraction/index.html`, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(2000);
    await page.evaluate(() => { if (window.OSCTrainingWorkerBridge) window.OSCTrainingWorkerBridge = null; });

    // === 1. Dataset GIF ===
    console.log("[gif] dataset");
    const dDir = path.join(IMG_DIR, "_fd");
    cleanFrames(dDir); fs.mkdirSync(dDir, { recursive: true });
    await clickTab(page, "Playground");
    await sleep(1500);
    await captureN(page, dDir, 6, INTERVAL);
    await clickTab(page, "Dataset");
    await sleep(1000);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const items = ws ? ws.querySelectorAll(".left-dataset-item") : [];
      if (items.length) items[0].click();
    });
    await sleep(1500);
    await captureN(page, dDir, 10, INTERVAL);
    framesToGif(dDir, path.join(IMG_DIR, "dataset.gif"), FPS);
    cleanFrames(dDir);

    // === 2. Model GIF ===
    console.log("[gif] model");
    const mDir = path.join(IMG_DIR, "_fm");
    cleanFrames(mDir); fs.mkdirSync(mDir, { recursive: true });
    await clickTab(page, "Model");
    await sleep(1500);
    // show LSTM-VAE
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const items = ws ? ws.querySelectorAll(".left-dataset-item") : [];
      if (items.length) items[0].click();
    });
    await sleep(1500);
    await captureN(page, mDir, 8, INTERVAL);
    // show MLP-AE
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const items = ws ? ws.querySelectorAll(".left-dataset-item") : [];
      if (items.length > 1) items[1].click();
    });
    await sleep(1500);
    await captureN(page, mDir, 8, INTERVAL);
    framesToGif(mDir, path.join(IMG_DIR, "model.gif"), FPS);
    cleanFrames(mDir);

    // === 3. Training GIF (the whole training sequence) ===
    console.log("[gif] training");
    const tDir = path.join(IMG_DIR, "_ft");
    cleanFrames(tDir); fs.mkdirSync(tDir, { recursive: true });
    await clickTab(page, "Trainer");
    await sleep(1000);
    // set 10 epochs
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      if (!ws) return;
      ws.querySelectorAll(".osc-form-row, .row").forEach(row => {
        const label = row.querySelector("label");
        const inp = row.querySelector("input");
        if (label && inp && label.textContent.toLowerCase().includes("epoch")) {
          inp.value = "10"; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });
    await sleep(300);

    let tIdx = 0;
    await page.screenshot({ path: framePath(tDir, tIdx++) }); // before
    // start training
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const start = btns.find(b => b.textContent.trim() === "Start Training" || b.textContent.trim() === "Continue Training");
      if (start) start.click();
    });

    // capture during training
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      await page.screenshot({ path: framePath(tDir, tIdx++) });
      await sleep(INTERVAL);
      const done = await page.evaluate(() => {
        const ws = document.querySelector(".osc-workspace.active");
        const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
        return btns.some(b => b.textContent.trim() === "Continue Training");
      });
      if (done) break;
    }
    // hold on final results
    for (let i = 0; i < 6; i++) { await page.screenshot({ path: framePath(tDir, tIdx++) }); await sleep(INTERVAL); }

    // switch to Test tab
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, [role='tab']"));
      const t = btns.find(b => b.textContent.trim().toLowerCase() === "test");
      if (t) t.click();
    });
    await sleep(2000);
    for (let i = 0; i < 8; i++) { await page.screenshot({ path: framePath(tDir, tIdx++) }); await sleep(INTERVAL); }

    framesToGif(tDir, path.join(IMG_DIR, "training.gif"), FPS);
    cleanFrames(tDir);

    // === 4. Generation GIF ===
    console.log("[gif] generation");
    const gDir = path.join(IMG_DIR, "_fg");
    cleanFrames(gDir); fs.mkdirSync(gDir, { recursive: true });
    let gIdx = 0;

    await clickTab(page, "Generation");
    await sleep(1500);
    // select model
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const left = ws ? ws.querySelector(".osc-panel-left") : null;
      const items = left ? Array.from(left.querySelectorAll("div[style*='cursor']")) : [];
      if (items.length) items[0].click();
    });
    await sleep(1000);
    await page.screenshot({ path: framePath(gDir, gIdx++) });

    // reconstruct
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const gen = btns.find(b => b.textContent.trim() === "Generate");
      if (gen) gen.click();
    });
    await sleep(4000);
    for (let i = 0; i < 10; i++) { await page.screenshot({ path: framePath(gDir, gIdx++) }); await sleep(INTERVAL); }

    // switch to random
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const clr = btns.find(b => b.textContent.trim() === "Clear Results");
      if (clr) clr.click();
    });
    await sleep(300);
    await page.evaluate(() => {
      const sel = document.querySelector("select[data-key='method']");
      if (sel) { sel.value = "random"; sel.dispatchEvent(new Event("change")); }
    });
    await sleep(300);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const gen = btns.find(b => b.textContent.trim() === "Generate");
      if (gen) gen.click();
    });
    await sleep(4000);
    for (let i = 0; i < 10; i++) { await page.screenshot({ path: framePath(gDir, gIdx++) }); await sleep(INTERVAL); }

    framesToGif(gDir, path.join(IMG_DIR, "generation.gif"), FPS);
    cleanFrames(gDir);

    console.log("\n[done] All GIFs created in images/");

  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

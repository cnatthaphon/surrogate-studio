#!/usr/bin/env node
/**
 * Capture animated GIF of the LSTM-VAE demo workflow.
 *
 * Records: Playground → Dataset → Model → Train → Test → Generation
 * Uses Puppeteer screencast to capture frames, then ffmpeg to create GIF.
 *
 * Usage: node scripts/capture_demo_gif.js
 * Requires: ffmpeg installed
 * Output: demo/LSTM-VAE-for-dominant-motion-extraction/images/demo_workflow.gif
 */
"use strict";

const puppeteer = require("puppeteer");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEMO_DIR = path.join(ROOT, "demo", "LSTM-VAE-for-dominant-motion-extraction");
const IMG_DIR = path.join(DEMO_DIR, "images");
const FRAMES_DIR = path.join(IMG_DIR, "_frames");
const PORT = 9878;

const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png",
};

function startServer() {
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
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let frameCount = 0;
async function captureFrame(page) {
  const name = String(frameCount++).padStart(5, "0");
  await page.screenshot({ path: path.join(FRAMES_DIR, `frame_${name}.png`) });
}

// capture N frames over durationMs (roughly fps frames per second)
async function captureFrames(page, durationMs, fps) {
  const interval = 1000 / fps;
  const n = Math.ceil(durationMs / interval);
  for (let i = 0; i < n; i++) {
    await captureFrame(page);
    await sleep(interval);
  }
}

async function clickTab(page, label) {
  await page.evaluate((lbl) => {
    const btns = Array.from(document.querySelectorAll(".osc-tab-btn"));
    const btn = btns.find(b => b.textContent.trim() === lbl);
    if (btn) btn.click();
  }, label);
  await sleep(300);
}

async function main() {
  // check ffmpeg
  try { execSync("which ffmpeg", { stdio: "pipe" }); }
  catch { console.error("ffmpeg not found. Install it: apt install ffmpeg"); process.exit(1); }

  if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const server = await startServer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1.5 },
  });

  const FPS = 4; // 4 frames/sec for smooth-enough GIF at small file size

  try {
    const page = await browser.newPage();
    const demoUrl = `http://localhost:${PORT}/demo/LSTM-VAE-for-dominant-motion-extraction/index.html`;
    console.log("[navigate]", demoUrl);
    await page.goto(demoUrl, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(2000);

    // Disable Worker (same as screenshot script)
    await page.evaluate(() => { if (window.OSCTrainingWorkerBridge) window.OSCTrainingWorkerBridge = null; });

    // === Scene 1: Playground (2s) ===
    console.log("[scene] Playground");
    await clickTab(page, "Playground");
    await sleep(1500);
    await captureFrames(page, 2500, FPS);

    // === Scene 2: Dataset (2s) ===
    console.log("[scene] Dataset");
    await clickTab(page, "Dataset");
    await sleep(1000);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const items = ws ? ws.querySelectorAll(".left-dataset-item, .osc-item-list li") : [];
      if (items.length) items[0].click();
    });
    await sleep(1500);
    await captureFrames(page, 2500, FPS);

    // === Scene 3: Model (2s) ===
    console.log("[scene] Model");
    await clickTab(page, "Model");
    await sleep(1500);
    await captureFrames(page, 2500, FPS);

    // === Scene 4: Training (capture the whole training) ===
    console.log("[scene] Trainer - training");
    await clickTab(page, "Trainer");
    await sleep(1000);

    // set epochs to 10
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
    await captureFrames(page, 1000, FPS); // before training

    // click Start Training
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const start = btns.find(b => b.textContent.trim() === "Start Training" || b.textContent.trim() === "Continue Training");
      if (start) start.click();
    });

    // capture during training
    console.log("  training...");
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      await captureFrame(page);
      await sleep(250);
      const done = await page.evaluate(() => {
        const ws = document.querySelector(".osc-workspace.active");
        const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
        return btns.some(b => b.textContent.trim() === "Continue Training");
      });
      if (done) break;
    }
    console.log("  training done");
    await captureFrames(page, 2000, FPS); // pause on results

    // === Scene 5: Test tab (2s) ===
    console.log("[scene] Test results");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, [role='tab']"));
      const testBtn = btns.find(b => b.textContent.trim().toLowerCase() === "test");
      if (testBtn) testBtn.click();
    });
    await sleep(2000);
    await captureFrames(page, 3000, FPS);

    // === Scene 6: Generation - reconstruct (3s) ===
    console.log("[scene] Generation - reconstruct");
    await clickTab(page, "Generation");
    await sleep(1500);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const left = ws ? ws.querySelector(".osc-panel-left") : null;
      const items = left ? Array.from(left.querySelectorAll("div[style*='cursor']")) : [];
      if (items.length) items[0].click();
    });
    await sleep(1000);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const gen = btns.find(b => b.textContent.trim() === "Generate");
      if (gen) gen.click();
    });
    await sleep(4000); // wait for generation + Plotly
    await captureFrames(page, 3000, FPS);

    // === Assemble GIF ===
    console.log(`\n[assemble] ${frameCount} frames → GIF`);
    const gifPath = path.join(IMG_DIR, "demo_workflow.gif");
    // ffmpeg: input frames → palette → gif (good quality, small size)
    const palettePath = path.join(FRAMES_DIR, "palette.png");
    execSync(`ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/frame_%05d.png" -vf "fps=${FPS},scale=960:-1:flags=lanczos,palettegen=max_colors=64" "${palettePath}"`, { stdio: "pipe" });
    execSync(`ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/frame_%05d.png" -i "${palettePath}" -lavfi "fps=${FPS},scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" "${gifPath}"`, { stdio: "pipe" });

    const gifSize = (fs.statSync(gifPath).size / 1024 / 1024).toFixed(1);
    console.log(`[done] ${gifPath} (${gifSize}MB, ${frameCount} frames @ ${FPS}fps)`);

    // cleanup frames
    fs.rmSync(FRAMES_DIR, { recursive: true });

  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/**
 * Capture screenshots + workflow GIF for any demo.
 * Usage: node scripts/capture_demo_assets.js <demo-path> [epochs]
 * Example: node scripts/capture_demo_assets.js demo/Fashion-MNIST-VAE 5
 */
"use strict";
const puppeteer = require("puppeteer");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEMO_PATH = process.argv[2] || "demo/Fashion-MNIST-VAE";
const EPOCHS = Number(process.argv[3] || 5);
const DEMO_DIR = path.join(ROOT, DEMO_PATH);
const IMG_DIR = path.join(DEMO_DIR, "images");
const PORT = 9910;
const FPS = 4;

if (!fs.existsSync(DEMO_DIR)) { console.error("Demo not found:", DEMO_DIR); process.exit(1); }
if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
function startServer() {
  const server = http.createServer((req, res) => {
    let fp = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (fp.endsWith("/")) fp += "index.html";
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise(r => server.listen(PORT, () => r(server)));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function clickTab(page, label) {
  await page.evaluate(l => { Array.from(document.querySelectorAll(".osc-tab-btn")).forEach(b => { if (b.textContent.trim() === l) b.click(); }); }, label);
  await sleep(500);
}

let frameCount = 0;
const FRAMES_DIR = path.join(IMG_DIR, "_frames");
async function captureFrame(page) {
  await page.screenshot({ path: path.join(FRAMES_DIR, `f_${String(frameCount++).padStart(5, "0")}.png`) });
}
async function captureN(page, n, interval) {
  for (let i = 0; i < n; i++) { await captureFrame(page); if (i < n - 1) await sleep(interval || 250); }
}

async function main() {
  if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  const server = await startServer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1.5 },
  });

  try {
    const page = await browser.newPage();
    const demoUrl = `http://localhost:${PORT}/${DEMO_PATH}/index.html`;
    console.log(`[capture] ${demoUrl}`);
    await page.goto(demoUrl, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(2000);
    await page.evaluate(() => { if (window.OSCTrainingWorkerBridge) window.OSCTrainingWorkerBridge = null; });

    // Dataset tab
    console.log("[scene] Dataset");
    await clickTab(page, "Dataset");
    await sleep(1000);
    await page.evaluate(() => { const i = document.querySelectorAll(".left-dataset-item"); if (i.length) i[0].click(); });
    await sleep(500);
    // try generate if needed
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const g = btns.find(b => b.textContent.trim().includes("Generate"));
      if (g) g.click();
    });
    await sleep(8000); // wait for CDN fetch
    await page.screenshot({ path: path.join(IMG_DIR, "01_dataset.png") });
    await captureN(page, 6, 250);

    // Model tab
    console.log("[scene] Model");
    await clickTab(page, "Model");
    await sleep(1500);
    await page.screenshot({ path: path.join(IMG_DIR, "02_model.png") });
    await captureN(page, 6, 250);

    // Trainer tab — train
    console.log("[scene] Trainer (" + EPOCHS + " epochs)");
    await clickTab(page, "Trainer");
    await sleep(1000);
    await page.evaluate(() => { const i = document.querySelectorAll(".left-dataset-item"); if (i.length) i[0].click(); });
    await sleep(500);
    await page.evaluate((ep) => {
      const ws = document.querySelector(".osc-workspace.active"); if (!ws) return;
      ws.querySelectorAll(".osc-form-row,.row").forEach(row => {
        const l = row.querySelector("label"), i = row.querySelector("input"); if (!l || !i) return;
        if (l.textContent.toLowerCase().includes("epoch") && i.type === "number") { i.value = String(ep); i.dispatchEvent(new Event("input", { bubbles: true })); }
        if (l.textContent.includes("PyTorch") && i.type === "checkbox" && i.checked) { i.checked = false; i.dispatchEvent(new Event("change", { bubbles: true })); }
      });
    }, EPOCHS);
    await sleep(300);
    await captureFrame(page);

    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const b = ws ? Array.from(ws.querySelectorAll("button")).find(b => b.textContent.trim() === "Start Training" || b.textContent.trim() === "Continue Training") : null;
      if (b) b.click();
    });

    // capture during training
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      await captureFrame(page);
      await sleep(500);
      const done = await page.evaluate(() => {
        const ws = document.querySelector(".osc-workspace.active");
        return ws ? Array.from(ws.querySelectorAll("button")).some(b => b.textContent.trim() === "Continue Training") : false;
      });
      if (done) break;
    }
    await captureN(page, 4, 250);
    await page.screenshot({ path: path.join(IMG_DIR, "03_trainer.png") });

    // Test sub-tab
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button,[role='tab']")).find(b => b.textContent.trim().toLowerCase() === "test");
      if (b) b.click();
    });
    await sleep(3000);
    await page.screenshot({ path: path.join(IMG_DIR, "04_test.png") });
    await captureN(page, 4, 250);

    // Generation tab
    console.log("[scene] Generation");
    await clickTab(page, "Generation");
    await sleep(1500);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const left = ws ? ws.querySelector(".osc-panel-left") : null;
      const items = left ? Array.from(left.querySelectorAll("div[style*='cursor'],.left-dataset-item")) : [];
      if (items.length) items[0].click();
    });
    await sleep(1000);
    // select trainer if needed
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active"); if (!ws) return;
      ws.querySelectorAll("select").forEach(sel => { if (sel.options.length > 1 && !sel.value) { sel.selectedIndex = 1; sel.dispatchEvent(new Event("change", { bubbles: true })); } });
    });
    await sleep(500);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const b = ws ? Array.from(ws.querySelectorAll("button")).find(b => b.textContent.trim() === "Generate") : null;
      if (b && !b.disabled) b.click();
    });
    await sleep(5000);
    await page.screenshot({ path: path.join(IMG_DIR, "05_generation.png") });
    await captureN(page, 6, 250);

    // Assemble GIF
    console.log(`[gif] ${frameCount} frames → GIF`);
    const gifPath = path.join(IMG_DIR, "demo_workflow.gif");
    const palPath = path.join(FRAMES_DIR, "pal.png");
    try {
      execSync(`ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/f_%05d.png" -vf "fps=${FPS},scale=960:-1:flags=lanczos,palettegen=max_colors=64" "${palPath}"`, { stdio: "pipe" });
      execSync(`ffmpeg -y -framerate ${FPS} -i "${FRAMES_DIR}/f_%05d.png" -i "${palPath}" -lavfi "fps=${FPS},scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" "${gifPath}"`, { stdio: "pipe" });
      const sz = (fs.statSync(gifPath).size / 1024).toFixed(0);
      console.log(`[done] ${gifPath} (${sz}KB)`);
    } catch (e) { console.log("[warn] GIF creation failed:", e.message.substring(0, 80)); }

    // Cleanup frames
    fs.rmSync(FRAMES_DIR, { recursive: true });

    console.log("\nScreenshots:");
    fs.readdirSync(IMG_DIR).filter(f => f.endsWith(".png") || f.endsWith(".gif")).sort().forEach(f => {
      console.log("  " + f + " (" + (fs.statSync(path.join(IMG_DIR, f)).size / 1024).toFixed(0) + "KB)");
    });

  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

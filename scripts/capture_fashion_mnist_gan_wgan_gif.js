#!/usr/bin/env node
"use strict";

const puppeteer = require("puppeteer");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEMO_DIR = path.join(ROOT, "demo", "Fashion-MNIST-GAN");
const IMG_DIR = path.join(DEMO_DIR, "images");
const FRAMES_DIR = path.join(IMG_DIR, "_wgan_gif_frames");
const GIF_PATH = path.join(IMG_DIR, "mlp_wgan_generation.gif");
const PNG_PATH = path.join(IMG_DIR, "mlp_wgan_generation.png");
const PORT = 9884;
const TARGET_GEN_ID = "g-mlp-wgan-gen-trained";
const TARGET_TRAINER_ID = "t-mlp-wgan-trained";
const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".gif": "image/gif",
};

function startServer() {
  const server = http.createServer((req, res) => {
    let filePath = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (filePath.endsWith("/")) filePath += "index.html";
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function clickTab(page, label) {
  await page.evaluate((lbl) => {
    const btn = Array.from(document.querySelectorAll(".osc-tab-btn"))
      .find(b => b.textContent.trim() === lbl);
    if (btn) btn.click();
  }, label);
  await sleep(500);
}

function framePath(idx) {
  return path.join(FRAMES_DIR, `f_${String(idx).padStart(5, "0")}.png`);
}

async function captureApp(page, outPath) {
  const clip = await page.evaluate(() => {
    const app = document.querySelector("#app");
    if (!app) return null;
    const r = app.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });
  if (clip && clip.width > 0 && clip.height > 0) {
    await page.screenshot({ path: outPath, clip: clip });
    return;
  }
  await page.screenshot({ path: outPath, fullPage: true });
}

function framesToGif(framesDir, outputPath, fps, scaleWidth) {
  const palettePath = path.join(framesDir, "palette.png");
  execSync(`ffmpeg -y -framerate ${fps} -i "${framesDir}/f_%05d.png" -vf "fps=${fps},scale=${scaleWidth}:-1:flags=lanczos,palettegen=max_colors=64" "${palettePath}"`, { stdio: "pipe" });
  execSync(`ffmpeg -y -framerate ${fps} -i "${framesDir}/f_%05d.png" -i "${palettePath}" -lavfi "fps=${fps},scale=${scaleWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" "${outputPath}"`, { stdio: "pipe" });
}

async function waitForPretrained(page) {
  await page.waitForFunction((trainerId) => {
    if (!window.store || typeof window.store.getTrainerCard !== "function") return false;
    const trainer = window.store.getTrainerCard(trainerId);
    if (!trainer || !trainer.modelArtifacts || !trainer.modelArtifacts.weightSpecs) return false;
    return trainer.modelArtifacts.weightSpecs.length > 0;
  }, { timeout: 120000 }, TARGET_TRAINER_ID);
}

async function openGeneration(page) {
  await clickTab(page, "Generation");
  await page.waitForFunction((genId) => {
    const row = document.querySelector(`[data-item-id="${genId}"]`);
    if (!row) return false;
    row.click();
    return true;
  }, { timeout: 10000 }, TARGET_GEN_ID);
  await sleep(800);
}

async function setSeed(page, seed) {
  await page.evaluate((genId, nextSeed) => {
    if (!window.store || typeof window.store.get !== "function" || typeof window.store.save !== "function") return false;
    const rec = window.store.get({ table: "generationRuns", id: genId });
    if (!rec) return false;
    rec.config = Object.assign({}, rec.config || {}, { seed: nextSeed });
    window.store.save({ table: "generationRuns", values: [rec] });
    return true;
  }, TARGET_GEN_ID, seed);
  await sleep(200);
}

async function clickGenerate(page) {
  await page.evaluate(() => {
    const ws = document.querySelector(".osc-workspace.active");
    const btn = ws ? Array.from(ws.querySelectorAll("button")).find(b => b.textContent.trim() === "Generate") : null;
    if (btn) btn.click();
  });
}

async function waitForRuns(page, count) {
  await page.waitForFunction((genId, targetCount) => {
    if (!window.store || typeof window.store.get !== "function") return false;
    const rec = window.store.get({ table: "generationRuns", id: genId });
    return !!rec && Array.isArray(rec.runs) && rec.runs.length >= targetCount;
  }, { timeout: 120000 }, TARGET_GEN_ID, count);
}

async function main() {
  try { execSync("which ffmpeg", { stdio: "pipe" }); }
  catch { throw new Error("ffmpeg not found"); }

  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });

  const server = await startServer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1440, height: 920, deviceScaleFactor: 1.5 },
  });

  try {
    const page = await browser.newPage();
    page.on("console", msg => {
      const text = msg.text();
      if (text.includes("[preset]") || text.includes("Pre-trained")) console.log("[page]", text);
    });

    const url = `http://localhost:${PORT}/demo/Fashion-MNIST-GAN/index.html`;
    console.log("[navigate]", url);
    await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
    await waitForPretrained(page);
    await openGeneration(page);

    let frameIdx = 0;
    await captureApp(page, framePath(frameIdx++));

    const seeds = [41, 42, 43, 44];
    for (let i = 0; i < seeds.length; i++) {
      console.log(`[generate] run ${i + 1} seed=${seeds[i]}`);
      await setSeed(page, seeds[i]);
      await clickGenerate(page);
      await waitForRuns(page, i + 1);
      await sleep(1000);
      await captureApp(page, framePath(frameIdx++));
    }

    await captureApp(page, PNG_PATH);
    framesToGif(FRAMES_DIR, GIF_PATH, 1, 960);
    console.log("[done]", GIF_PATH);
    console.log("[done]", PNG_PATH);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * FULL E2E test for Fashion-MNIST Benchmark.
 * Trains multiple models → tests each → generates from each → evaluates benchmarks.
 * Uses PyTorch server (CUDA) for fast training.
 */
"use strict";
const puppeteer = require("puppeteer");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEMO = "demo/Fashion-MNIST-Benchmark";
const IMG_DIR = path.join(ROOT, DEMO, "images");
const PORT = 9920;
const EPOCHS = 5;

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
  await page.evaluate(l => {
    Array.from(document.querySelectorAll(".osc-tab-btn")).forEach(b => { if (b.textContent.trim() === l) b.click(); });
  }, label);
  await sleep(800);
}

async function clickLeftItem(page, index) {
  await page.evaluate(idx => {
    const ws = document.querySelector(".osc-workspace.active");
    const items = ws ? Array.from(ws.querySelectorAll(".osc-panel-left div[style*='cursor'],.osc-panel-left .left-dataset-item")) : [];
    if (items[idx]) items[idx].click();
  }, index);
  await sleep(500);
}

async function getStatus(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".osc-status");
    return el ? el.textContent.trim() : "";
  });
}

async function waitForTraining(page, maxWait) {
  const t0 = Date.now();
  while (Date.now() - t0 < (maxWait || 180000)) {
    await sleep(3000);
    const status = await getStatus(page);
    const done = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      return ws ? Array.from(ws.querySelectorAll("button")).some(b => b.textContent.trim() === "Continue Training") : false;
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`\r    [${elapsed}s] ${status.substring(0, 80).padEnd(80)}`);
    if (done || status.includes("Done") || status.includes("done")) { console.log(); return true; }
  }
  console.log();
  return false;
}

async function trainModel(page, trainerIndex, name) {
  await clickTab(page, "Trainer");
  await sleep(500);
  await clickLeftItem(page, trainerIndex);
  await sleep(500);

  // Set epochs, keep PyTorch server
  await page.evaluate(ep => {
    const ws = document.querySelector(".osc-workspace.active"); if (!ws) return;
    ws.querySelectorAll(".osc-form-row,.row").forEach(row => {
      const l = row.querySelector("label"), i = row.querySelector("input"); if (!l || !i) return;
      if (l.textContent.toLowerCase().includes("epoch") && i.type === "number") { i.value = String(ep); i.dispatchEvent(new Event("input", { bubbles: true })); }
      if (l.textContent.includes("PyTorch") && i.type === "checkbox" && !i.checked) { i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true })); }
    });
  }, EPOCHS);
  await sleep(300);

  // Start training
  await page.evaluate(() => {
    const ws = document.querySelector(".osc-workspace.active");
    const b = ws ? Array.from(ws.querySelectorAll("button")).find(b => b.textContent.trim() === "Start Training") : null;
    if (b) b.click();
  });

  console.log(`  Training ${name}...`);
  const done = await waitForTraining(page, 180000);
  return done;
}

let screenshotCount = 0;
async function screenshot(page, name) {
  screenshotCount++;
  const fname = `${String(screenshotCount).padStart(2, "0")}_${name}.png`;
  await page.screenshot({ path: path.join(IMG_DIR, fname) });
  console.log(`  📸 ${fname}`);
}

async function main() {
  const server = await startServer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1.5 },
  });

  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", err => errors.push(String(err)));

    console.log("\n════════════════════════════════════════════════════");
    console.log("  Fashion-MNIST Benchmark — Full E2E Test");
    console.log("  PyTorch CUDA server · " + EPOCHS + " epochs per model");
    console.log("════════════════════════════════════════════════════\n");

    await page.goto(`http://localhost:${PORT}/${DEMO}/index.html`, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(2000);

    // ─── 1. DATASET ───
    console.log("[1] Generate Dataset");
    await clickTab(page, "Dataset");
    await sleep(500);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const g = btns.find(b => b.textContent.trim().includes("Generate"));
      if (g) g.click();
    });
    await sleep(15000);
    await screenshot(page, "dataset");

    // ─── 2. TRAIN MODELS ───
    // Train: MLP(0), AE(2), VAE(4), Denoiser(6) — covers classification + reconstruction + VAE + diffusion
    const modelsToTrain = [
      { idx: 0, name: "MLP Baseline" },
      { idx: 2, name: "Dense Autoencoder" },
      { idx: 4, name: "VAE" },
      { idx: 6, name: "Denoising AE" },
    ];

    console.log("\n[2] Train Models (" + modelsToTrain.length + " models)");
    for (const m of modelsToTrain) {
      const ok = await trainModel(page, m.idx, m.name);
      console.log(`  ${ok ? "✓" : "✗"} ${m.name}`);
    }

    // Screenshot trainer with last model
    await screenshot(page, "trainer");

    // Click Test sub-tab
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button,[role='tab']")).find(b => b.textContent.trim().toLowerCase() === "test");
      if (b) b.click();
    });
    await sleep(5000);
    await screenshot(page, "test_denoiser");

    // Show MLP test (classification with confusion matrix)
    await clickLeftItem(page, 0); // MLP
    await sleep(1000);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button,[role='tab']")).find(b => b.textContent.trim().toLowerCase() === "test");
      if (b) b.click();
    });
    await sleep(5000);
    await screenshot(page, "test_mlp_classification");

    // Show VAE test
    await clickLeftItem(page, 4); // VAE
    await sleep(1000);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button,[role='tab']")).find(b => b.textContent.trim().toLowerCase() === "test");
      if (b) b.click();
    });
    await sleep(5000);
    await screenshot(page, "test_vae");

    // ─── 3. GENERATION ───
    console.log("\n[3] Generation");
    await clickTab(page, "Generation");
    await sleep(1000);

    // Generation items: 0=AE Recon, 1=Conv-AE Recon, 2=VAE Random, 3=VAE Recon, 4=Cls-Guided, 5=Langevin
    const gensToRun = [
      { idx: 0, name: "AE Reconstruct" },
      { idx: 2, name: "VAE Random Sampling" },
      { idx: 3, name: "VAE Reconstruct" },
      { idx: 5, name: "Langevin Denoising" },
    ];

    for (const gen of gensToRun) {
      console.log(`  Generating: ${gen.name}...`);
      await clickLeftItem(page, gen.idx);
      await sleep(500);

      // ensure model is selected
      await page.evaluate(() => {
        const ws = document.querySelector(".osc-workspace.active"); if (!ws) return;
        const right = ws.querySelector(".osc-panel-right"); if (!right) return;
        right.querySelectorAll("select").forEach(sel => {
          if (sel.options.length > 1 && !sel.value) {
            // find first trained model option
            for (let i = 1; i < sel.options.length; i++) {
              if (sel.options[i].textContent.includes("✓")) { sel.value = sel.options[i].value; sel.dispatchEvent(new Event("change", { bubbles: true })); break; }
            }
          }
        });
      });
      await sleep(300);

      // click Generate
      const clicked = await page.evaluate(() => {
        const ws = document.querySelector(".osc-workspace.active");
        const b = ws ? Array.from(ws.querySelectorAll("button")).find(b => b.textContent.trim() === "Generate") : null;
        if (b && !b.disabled) { b.click(); return true; }
        return false;
      });
      if (clicked) await sleep(12000); // wait for generation

      const status = await getStatus(page);
      console.log(`    ${status.substring(0, 80)}`);
      await screenshot(page, "gen_" + gen.name.toLowerCase().replace(/\s+/g, "_"));
    }

    // ─── 4. EVALUATION ───
    console.log("\n[4] Evaluation Benchmarks");
    await clickTab(page, "Evaluation");
    await sleep(1000);

    // Run both evaluations
    for (let ei = 0; ei < 2; ei++) {
      await clickLeftItem(page, ei);
      await sleep(500);

      const evalName = await page.evaluate(() => {
        const ws = document.querySelector(".osc-workspace.active");
        const main = ws ? ws.querySelector(".osc-panel-main") : null;
        return main ? main.textContent.substring(0, 60).trim() : "eval";
      });
      console.log(`  Running: ${evalName.substring(0, 50)}...`);

      // Click Run/Evaluate
      await page.evaluate(() => {
        const ws = document.querySelector(".osc-workspace.active");
        const b = ws ? Array.from(ws.querySelectorAll("button")).find(b =>
          b.textContent.trim() === "Run" || b.textContent.trim() === "Evaluate" || b.textContent.trim() === "Run Benchmark"
        ) : null;
        if (b && !b.disabled) b.click();
      });
      await sleep(15000); // evaluation takes time

      const evalStatus = await getStatus(page);
      console.log(`    ${evalStatus.substring(0, 80)}`);
      await screenshot(page, ei === 0 ? "eval_classification" : "eval_reconstruction");
    }

    // ─── 5. MODEL TAB ───
    console.log("\n[5] Model Graphs");
    await clickTab(page, "Model");
    await sleep(1000);
    // Show a few models
    for (let mi of [0, 1, 4]) { // MLP, CNN, VAE
      await clickLeftItem(page, mi);
      await sleep(1500);
      await screenshot(page, "model_" + mi);
    }

    // ─── SUMMARY ───
    console.log("\n════════════════════════════════════════════════════");
    console.log("  DONE — " + screenshotCount + " screenshots captured");
    if (errors.length) console.log("  Page errors: " + errors.length);
    console.log("  Output: " + IMG_DIR);
    console.log("════════════════════════════════════════════════════\n");

    fs.readdirSync(IMG_DIR).filter(f => f.endsWith(".png")).sort().forEach(f => {
      console.log("  " + f + " (" + (fs.statSync(path.join(IMG_DIR, f)).size / 1024).toFixed(0) + "KB)");
    });

  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

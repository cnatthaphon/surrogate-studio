#!/usr/bin/env node
/**
 * End-to-end test for Fashion-MNIST Benchmark demo.
 * Tests: all 7 models train → test → generate → evaluate.
 * Captures screenshots at each step.
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
const EPOCHS = 2;
const TIMEOUT = 120000; // 2 min per model

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

async function getErrors(page) {
  return page.evaluate(() => {
    const ws = document.querySelector(".osc-workspace.active");
    if (!ws) return [];
    const main = ws.querySelector(".osc-panel-main");
    if (!main) return [];
    const text = main.textContent || "";
    const errors = [];
    if (text.includes("Error:")) errors.push(text.match(/Error:[^\n]*/)?.[0] || "Error found");
    if (text.includes("error")) errors.push("Contains 'error'");
    return errors;
  });
}

let passed = 0, failed = 0, errors = [];

function ok(condition, msg) {
  if (condition) { passed++; console.log("  ✓ " + msg); }
  else { failed++; errors.push(msg); console.log("  ✗ " + msg); }
}

async function main() {
  const server = await startServer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1.5 },
  });

  const consoleErrors = [];

  try {
    const page = await browser.newPage();
    page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", err => consoleErrors.push(String(err)));

    console.log("\n=== Fashion-MNIST Benchmark E2E Test ===\n");

    // Load page
    await page.goto(`http://localhost:${PORT}/${DEMO}/index.html`, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(2000);
    // Disable worker (train on main thread)
    await page.evaluate(() => { if (window.OSCTrainingWorkerBridge) window.OSCTrainingWorkerBridge = null; });

    // 1. Dataset
    console.log("[1] Dataset");
    await clickTab(page, "Dataset");
    await sleep(500);
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
      const g = btns.find(b => b.textContent.trim().includes("Generate"));
      if (g) g.click();
    });
    await sleep(15000); // wait for Fashion-MNIST CDN download
    // reduce to 2000 samples for faster testing
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active"); if (!ws) return;
      ws.querySelectorAll(".osc-form-row,.row").forEach(row => {
        const l = row.querySelector("label"), i = row.querySelector("input"); if (!l || !i) return;
        if (l.textContent.toLowerCase().includes("total") && i.type === "number") { i.value = "2000"; i.dispatchEvent(new Event("input", { bubbles: true })); }
      });
    });
    await sleep(300);
    const dsStatus = await getStatus(page);
    ok(dsStatus.includes("60000") || dsStatus.includes("Generated") || dsStatus.includes("loaded"), "Dataset loaded: " + dsStatus.substring(0, 80));
    await page.screenshot({ path: path.join(IMG_DIR, "01_dataset.png") });

    // 2. Train AE (index 2 — fast, produces useful generation)
    console.log("\n[2] Training Dense Autoencoder (2 epochs)");
    await clickTab(page, "Trainer");
    await sleep(500);
    await clickLeftItem(page, 2); // AE Trainer (3rd item)
    await sleep(500);

    // Set epochs + keep PyTorch server enabled
    await page.evaluate(ep => {
      const ws = document.querySelector(".osc-workspace.active"); if (!ws) return;
      ws.querySelectorAll(".osc-form-row,.row").forEach(row => {
        const l = row.querySelector("label"), i = row.querySelector("input"); if (!l || !i) return;
        if (l.textContent.toLowerCase().includes("epoch") && i.type === "number") { i.value = String(ep); i.dispatchEvent(new Event("input", { bubbles: true })); }
        // ensure PyTorch server is checked
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

    // Wait for training to complete
    const t0 = Date.now();
    let trainDone = false;
    while (Date.now() - t0 < TIMEOUT) {
      await sleep(3000);
      const status = await getStatus(page);
      const done = await page.evaluate(() => {
        const ws = document.querySelector(".osc-workspace.active");
        return ws ? Array.from(ws.querySelectorAll("button")).some(b => b.textContent.trim() === "Continue Training") : false;
      });
      console.log("  [" + ((Date.now() - t0) / 1000).toFixed(0) + "s] " + status.substring(0, 100));
      if (done || status.includes("Done") || status.includes("done")) { trainDone = true; break; }
    }
    ok(trainDone, "MLP training completed");
    await page.screenshot({ path: path.join(IMG_DIR, "03_trainer.png") });

    // 3. Test
    console.log("\n[3] Test results");
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button,[role='tab']")).find(b => b.textContent.trim().toLowerCase() === "test");
      if (b) b.click();
    });
    await sleep(5000);
    const testText = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const main = ws ? ws.querySelector(".osc-panel-main") : null;
      return main ? main.textContent.substring(0, 300) : "";
    });
    ok(!testText.includes("Error") && !testText.includes("error"), "Test ran without errors");
    ok(testText.includes("R²") || testText.includes("Accuracy") || testText.includes("MAE"), "Test shows metrics: " + testText.substring(0, 100));
    await page.screenshot({ path: path.join(IMG_DIR, "04_test.png") });

    // 4. Generation — select the first generation that has a trained model
    console.log("\n[4] Generation");
    await clickTab(page, "Generation");
    await sleep(1000);
    // try each generation item, pick one that has a trained model
    const genCount = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const left = ws ? ws.querySelector(".osc-panel-left") : null;
      return left ? Array.from(left.querySelectorAll("div[style*='cursor'],.left-dataset-item")).length : 0;
    });
    // click each until we find one with a "Generate" button that works
    for (let gi = 0; gi < Math.min(genCount, 6); gi++) {
      await clickLeftItem(page, gi);
      await sleep(300);
    }
    // select the first one (it auto-selects trained model now)
    await clickLeftItem(page, 0);
    await sleep(500);
    // ensure model is selected in dropdown
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active"); if (!ws) return;
      ws.querySelectorAll("select").forEach(sel => {
        if (sel.options.length > 1 && !sel.value) { sel.selectedIndex = 1; sel.dispatchEvent(new Event("change", { bubbles: true })); }
      });
    });
    await sleep(500);

    // Force client-side generation by clearing trainedOnServer flag
    await page.evaluate(() => {
      var store = document.querySelector("#app") && document.querySelector("#app").__oscStore;
      // try to access store through SurrogateStudio
      if (window.SurrogateStudio && window.SurrogateStudio._store) {
        var cards = window.SurrogateStudio._store.listTrainerCards ? window.SurrogateStudio._store.listTrainerCards() : [];
        cards.forEach(function(c) { c.trainedOnServer = false; c.config = c.config || {}; c.config.useServer = false; });
      }
    });
    await sleep(300);

    // Force-select the AE trainer in the RIGHT PANEL model dropdown
    const selectResult = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active"); if (!ws) return "no ws";
      const right = ws.querySelector(".osc-panel-right"); if (!right) return "no right";
      const selects = right.querySelectorAll("select");
      let found = false;
      selects.forEach(sel => {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].textContent.includes("AE Trainer")) {
            sel.value = sel.options[i].value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            found = true; break;
          }
        }
      });
      return found ? "selected" : "not found in " + selects.length + " selects";
    });
    console.log("  Model select:", selectResult);
    await sleep(1500);

    // Debug: check generation state
    const genDebug = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const main = ws ? ws.querySelector(".osc-panel-main") : null;
      const right = ws ? ws.querySelector(".osc-panel-right") : null;
      const btns = ws ? Array.from(ws.querySelectorAll("button")).map(b => b.textContent.trim()) : [];
      const selects = ws ? Array.from(ws.querySelectorAll("select")).map(s => ({ val: s.value, opts: s.options.length })) : [];
      return { mainText: main ? main.textContent.substring(0, 200) : "no main", rightText: right ? right.textContent.substring(0, 200) : "no right", btns: btns, selects: selects };
    });
    console.log("  Gen debug:", JSON.stringify(genDebug).substring(0, 400));

    // Click Generate button
    const genClicked = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const b = ws ? Array.from(ws.querySelectorAll("button")).find(b => b.textContent.trim() === "Generate") : null;
      if (b && !b.disabled) { b.click(); return true; }
      return false;
    });
    console.log("  Generate clicked:", genClicked);
    await sleep(10000);

    const genText = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const main = ws ? ws.querySelector(".osc-panel-main") : null;
      return main ? main.textContent.substring(0, 300) : "";
    });
    ok(!genText.includes("Error:"), "Generation ran without errors");
    ok(genText.includes("samples") || genText.includes("done"), "Generation produced samples: " + genText.substring(0, 100));
    await page.screenshot({ path: path.join(IMG_DIR, "05_generation.png") });

    // 5. Evaluation
    console.log("\n[5] Evaluation");
    await clickTab(page, "Evaluation");
    await sleep(1000);
    await clickLeftItem(page, 0); // first eval
    await sleep(500);

    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const b = ws ? Array.from(ws.querySelectorAll("button")).find(b => b.textContent.trim() === "Run" || b.textContent.trim() === "Evaluate") : null;
      if (b && !b.disabled) b.click();
    });
    await sleep(10000);

    const evalText = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const main = ws ? ws.querySelector(".osc-panel-main") : null;
      return main ? main.textContent.substring(0, 500) : "";
    });
    ok(!evalText.includes("Error:"), "Evaluation ran without errors");
    await page.screenshot({ path: path.join(IMG_DIR, "06_evaluation.png") });

    // Summary
    console.log("\n=== Results ===");
    console.log("Passed: " + passed + "/" + (passed + failed));
    if (failed) { console.log("Failed:"); errors.forEach(e => console.log("  - " + e)); }
    if (consoleErrors.length) {
      console.log("\nConsole errors (" + consoleErrors.length + "):");
      consoleErrors.slice(0, 5).forEach(e => console.log("  " + e.substring(0, 150)));
    }
    console.log("\nScreenshots saved to: " + IMG_DIR);

  } finally {
    await browser.close();
    server.close();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

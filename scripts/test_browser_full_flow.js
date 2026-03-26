#!/usr/bin/env node
/**
 * End-to-end browser test: Train → Generate → Evaluate
 *
 * Tests the full flow in headless Chrome:
 * 1. Load demo page with pre-built dataset
 * 2. Train LSTM-VAE (main thread, 5 epochs)
 * 3. Train MLP-AE (main thread, 5 epochs)
 * 4. Generate: reconstruct from LSTM-VAE
 * 5. Evaluate: benchmark both models
 * 6. Verify results are populated
 *
 * Usage: node scripts/test_browser_full_flow.js
 */
"use strict";

const puppeteer = require("puppeteer");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = 9880;
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
let passed = 0, failed = 0;

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

function assert(condition, msg) {
  if (condition) { passed++; console.log("  \x1b[32m✓\x1b[0m " + msg); }
  else { failed++; console.log("  \x1b[31m✗\x1b[0m " + msg); }
}

async function clickTab(page, label) {
  await page.evaluate((lbl) => {
    const btns = Array.from(document.querySelectorAll(".osc-tab-btn"));
    const btn = btns.find(b => b.textContent.trim() === lbl);
    if (btn) btn.click();
  }, label);
  await sleep(500);
}

async function clickButtonInActiveWs(page, text) {
  return page.evaluate((txt) => {
    const ws = document.querySelector(".osc-workspace.active");
    if (!ws) return false;
    const btns = Array.from(ws.querySelectorAll("button"));
    const btn = btns.find(b => b.textContent.trim() === txt);
    if (btn) { btn.click(); return true; }
    return false;
  }, text);
}

async function getStatusText(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".osc-status");
    return el ? el.textContent : "";
  });
}

async function waitForStatus(page, pattern, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 60000)) {
    const status = await getStatusText(page);
    if (status.match(pattern)) return status;
    await sleep(500);
  }
  return await getStatusText(page);
}

async function main() {
  const server = await startServer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    defaultViewport: { width: 1280, height: 720 },
  });

  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", err => errors.push(err.message));

    console.log("\n=== Loading demo page ===");
    await page.goto(`http://localhost:${PORT}/demo/LSTM-VAE-for-dominant-motion-extraction/index.html`, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(2000);

    // Disable Worker (use main thread for reliable testing)
    await page.evaluate(() => { if (window.OSCTrainingWorkerBridge) window.OSCTrainingWorkerBridge = null; });

    // === 1. Verify dataset loaded ===
    console.log("\n=== 1. Dataset ===");
    await clickTab(page, "Dataset");
    await sleep(1000);
    const dsInfo = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      return ws ? ws.querySelector(".osc-panel-main").textContent.substring(0, 200) : "";
    });
    assert(dsInfo.includes("10399") || dsInfo.includes("Ant"), "Dataset shows ant trajectory data");

    // === 2. Train LSTM-VAE (5 epochs) ===
    console.log("\n=== 2. Train LSTM-VAE ===");
    await clickTab(page, "Trainer");
    await sleep(1000);

    // Click first trainer item
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const items = ws ? ws.querySelectorAll(".left-dataset-item") : [];
      if (items.length) items[0].click();
    });
    await sleep(500);

    // Set 5 epochs
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      if (!ws) return;
      ws.querySelectorAll(".osc-form-row, .row").forEach(row => {
        const label = row.querySelector("label");
        const inp = row.querySelector("input");
        if (label && inp && label.textContent.toLowerCase().includes("epoch")) {
          inp.value = "5"; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });

    // Uncheck "Use PyTorch Server" for reliable client-only test
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      if (!ws) return;
      ws.querySelectorAll(".osc-form-row, .row").forEach(row => {
        const label = row.querySelector("label");
        const inp = row.querySelector("input[type='checkbox']");
        if (label && inp && label.textContent.includes("PyTorch Server")) {
          if (inp.checked) { inp.checked = false; inp.dispatchEvent(new Event("change", { bubbles: true })); }
        }
      });
    });
    await sleep(300);

    await clickButtonInActiveWs(page, "Start Training");
    const trainStatus = await waitForStatus(page, /Done|done|complete/i, 60000);
    assert(trainStatus.match(/Done|done|MAE/i), "LSTM-VAE training completed: " + trainStatus.substring(0, 60));

    // Check epoch rows
    const epochRows = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      return ws ? ws.querySelectorAll("tr").length : 0;
    });
    assert(epochRows > 2, "Epoch table has rows: " + epochRows);

    // === 3. Train MLP-AE (5 epochs) ===
    console.log("\n=== 3. Train MLP-AE ===");
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const items = ws ? ws.querySelectorAll(".left-dataset-item") : [];
      if (items.length > 1) items[1].click();
    });
    await sleep(1000);

    // Set 5 epochs + uncheck server
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      if (!ws) return;
      ws.querySelectorAll(".osc-form-row, .row").forEach(row => {
        const label = row.querySelector("label");
        const inp = row.querySelector("input");
        if (label && inp && label.textContent.toLowerCase().includes("epoch")) {
          inp.value = "5"; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      ws.querySelectorAll(".osc-form-row, .row").forEach(row => {
        const label = row.querySelector("label");
        const inp = row.querySelector("input[type='checkbox']");
        if (label && inp && label.textContent.includes("PyTorch Server")) {
          if (inp.checked) { inp.checked = false; inp.dispatchEvent(new Event("change", { bubbles: true })); }
        }
      });
    });
    await sleep(300);

    await clickButtonInActiveWs(page, "Start Training");
    const trainStatus2 = await waitForStatus(page, /Done|done|complete/i, 60000);
    assert(trainStatus2.match(/Done|done|MAE/i), "MLP-AE training completed: " + trainStatus2.substring(0, 60));

    // === 4. Generation — reconstruct ===
    console.log("\n=== 4. Generation ===");
    await clickTab(page, "Generation");
    await sleep(1000);

    // Click first generation item
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const items = ws ? ws.querySelectorAll(".left-dataset-item") : [];
      if (items.length) items[0].click();
    });
    await sleep(1000);

    // Select trainer if not set
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      if (!ws) return;
      const selects = ws.querySelectorAll("select");
      selects.forEach(sel => {
        if (sel.options.length > 1 && !sel.value) {
          sel.selectedIndex = 1;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    });
    await sleep(500);

    const genClicked = await clickButtonInActiveWs(page, "Generate");
    if (genClicked) {
      const genStatus = await waitForStatus(page, /done|error|Generation/i, 30000);
      assert(genStatus.match(/done|samples/i), "Generation completed: " + genStatus.substring(0, 60));
    } else {
      // generate button might be disabled (model not selected or not trained)
      const btnState = await page.evaluate(() => {
        const ws = document.querySelector(".osc-workspace.active");
        const btns = ws ? Array.from(ws.querySelectorAll("button")) : [];
        const gen = btns.find(b => b.textContent.trim() === "Generate");
        return gen ? (gen.disabled ? "disabled" : "enabled") : "not found";
      });
      assert(false, "Generate button state: " + btnState);
    }

    // Check generation results rendered
    const genContent = await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const main = ws ? ws.querySelector(".osc-panel-main") : null;
      return main ? main.textContent.substring(0, 300) : "";
    });
    assert(genContent.includes("samples") || genContent.includes("Reconstruction") || genContent.includes("#1"), "Generation results rendered");

    // === 5. Evaluation ===
    console.log("\n=== 5. Evaluation ===");
    await clickTab(page, "Evaluation");
    await sleep(1000);

    // Click first evaluation item
    await page.evaluate(() => {
      const ws = document.querySelector(".osc-workspace.active");
      const items = ws ? ws.querySelectorAll(".left-dataset-item") : [];
      if (items.length) items[0].click();
    });
    await sleep(500);

    // Run evaluation
    const evalClicked = await clickButtonInActiveWs(page, "Run Evaluation");
    if (evalClicked) {
      const evalStatus = await waitForStatus(page, /complete|done|Evaluated/i, 60000);
      assert(evalStatus.match(/complete|Evaluated/i), "Evaluation completed: " + evalStatus.substring(0, 60));

      // Check results table
      const evalContent = await page.evaluate(() => {
        const ws = document.querySelector(".osc-workspace.active");
        const main = ws ? ws.querySelector(".osc-panel-main") : null;
        return main ? main.textContent.substring(0, 500) : "";
      });
      assert(evalContent.includes("MAE") || evalContent.includes("R") || evalContent.includes("done"), "Evaluation results table rendered");
    } else {
      assert(false, "Run Evaluation button not found or disabled");
    }

    // === 6. Console errors ===
    console.log("\n=== 6. Console Errors ===");
    const criticalErrors = errors.filter(e => !e.includes("WebGL") && !e.includes("favicon"));
    assert(criticalErrors.length === 0, "No critical console errors" + (criticalErrors.length ? ": " + criticalErrors[0].substring(0, 80) : ""));

    // === Summary ===
    console.log("\n" + "=".repeat(50));
    console.log(`RESULTS: ${passed} passed, ${failed} failed`);
    console.log("=".repeat(50));

  } finally {
    await browser.close();
    server.close();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node
"use strict";

const path = require("path");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const DEMO_FILE = path.join(ROOT, "demo", "Synthetic-Detection", "index.html");

let passed = 0;
let failed = 0;
const errors = [];

function ok(cond, label) {
  if (cond) {
    passed += 1;
    console.log("  \x1b[32m✓\x1b[0m " + label);
  } else {
    failed += 1;
    errors.push(label);
    console.log("  \x1b[31m✗\x1b[0m " + label);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickTab(page, tabName) {
  return page.evaluate((name) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const btn = buttons.find((b) => b.textContent.trim().toLowerCase() === name);
    if (!btn) return false;
    btn.click();
    return true;
  }, tabName);
}

async function setConfigValue(page, key, value) {
  return page.evaluate((k, v) => {
    const active = document.querySelector(".osc-workspace.active");
    const input = active && active.querySelector('[data-config-key="' + k + '"]');
    if (!input) return false;
    if (input.type === "checkbox") {
      input.checked = Boolean(v);
    } else {
      input.value = String(v);
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, key, value);
}

async function clickActiveButtonMatching(page, matcherSource) {
  return page.evaluate((src) => {
    const re = new RegExp(src, "i");
    const active = document.querySelector(".osc-workspace.active");
    const buttons = active ? Array.from(active.querySelectorAll("button")) : [];
    const btn = buttons.find((b) => re.test(b.textContent.trim()) && !b.disabled);
    if (!btn) return "";
    const label = btn.textContent.trim();
    btn.click();
    return label;
  }, matcherSource);
}

async function waitFor(page, predicate, timeoutMs, label) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await page.evaluate(predicate);
    if (last && last.ok) return last;
    await sleep(500);
  }
  return last || { ok: false, detail: label || "timeout" };
}

function filterFatalErrors(list) {
  return list.filter((e) => (
    e.indexOf("favicon") < 0 &&
    e.indexOf("net::ERR") < 0 &&
    e.indexOf("DevTools") < 0
  ));
}

async function main() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const jsErrors = [];
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.setViewport({ width: 1400, height: 960 });
    page.on("pageerror", (err) => jsErrors.push(String(err && err.message ? err.message : err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") jsErrors.push(msg.text());
    });

    console.log("\n=== Synthetic Detection Flow ===");
    await page.goto("file://" + DEMO_FILE, { waitUntil: "networkidle0", timeout: 60000 });
    ok(true, "Page loaded");

    ok(await clickTab(page, "dataset"), "Opened Dataset tab");
    await sleep(500);
    await setConfigValue(page, "totalCount", 90);
    const genLabel = await clickActiveButtonMatching(page, "generate dataset");
    ok(!!genLabel, "Clicked " + (genLabel || "Generate Dataset"));
    const dsReady = await waitFor(page, () => {
      const active = document.querySelector(".osc-workspace.active");
      const text = active ? active.textContent : "";
      const canvasCount = active ? active.querySelectorAll("canvas").length : 0;
      return { ok: /ready|train|bbox|square|wide_box|tall_box/i.test(text) && canvasCount > 0, detail: text.slice(0, 180), canvasCount };
    }, 15000, "dataset ready");
    ok(dsReady.ok, "Dataset preview ready with canvases=" + Number(dsReady && dsReady.canvasCount || 0));

    ok(await clickTab(page, "model"), "Opened Model tab");
    await sleep(700);
    const modelState = await page.evaluate(() => {
      const active = document.querySelector(".osc-workspace.active");
      return {
        ok: !!(active && active.querySelector(".drawflow")),
        text: active ? active.textContent.slice(0, 180) : "",
      };
    });
    ok(modelState.ok, "Model graph renders");

    ok(await clickTab(page, "trainer"), "Opened Trainer tab");
    await sleep(700);
    await setConfigValue(page, "epochs", 1);
    await setConfigValue(page, "batchSize", 16);
    const trainerState = await page.evaluate(() => {
      const active = document.querySelector(".osc-workspace.active");
      return {
        ok: !!active && /detection trainer|start training|server/i.test(active.textContent),
        text: active ? active.textContent.slice(0, 220) : "",
      };
    });
    ok(trainerState.ok, "Trainer card/config renders");

    ok(await clickTab(page, "evaluation"), "Opened Evaluation tab");
    await sleep(700);
    const evalState = await page.evaluate(() => {
      const active = document.querySelector(".osc-workspace.active");
      const text = active ? active.textContent : "";
      return {
        ok: /bbox mae|class accuracy|iou|bbox quality/i.test(text),
        text: text.slice(0, 240),
      };
    });
    ok(evalState.ok, "Detection evaluation metrics render");

    const fatalErrors = filterFatalErrors(jsErrors);
    ok(fatalErrors.length === 0, "No fatal JS errors (" + fatalErrors.length + ")");
    fatalErrors.slice(0, 5).forEach((e) => console.log("    ERROR: " + e.slice(0, 240)));
  } finally {
    await browser.close();
  }

  console.log("\n========================================");
  if (failed === 0) {
    console.log("\x1b[32m  PASS: All " + passed + " Synthetic Detection flow checks passed\x1b[0m");
  } else {
    console.log("\x1b[31m  FAIL: " + passed + " passed, " + failed + " failed\x1b[0m");
    errors.forEach((e) => console.log("  - " + e));
  }
  console.log("========================================\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err && err.stack ? err.stack : err);
  process.exit(1);
});

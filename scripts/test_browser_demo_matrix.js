"use strict";
/**
 * Browser smoke matrix for demo pages that share the standard Surrogate Studio shell
 * but do not yet have dedicated demo-specific browser scripts.
 */
var path = require("path");
var puppeteer = require("puppeteer");

var ROOT = path.resolve(__dirname, "..");
var DEMOS = [
  {
    name: "Fashion-MNIST GAN",
    file: path.join(ROOT, "demo", "Fashion-MNIST-GAN", "index.html"),
    presetKey: "FASHION_MNIST_GAN_PRESET",
    minModels: 3,
    minTrainers: 6,
    minGenerations: 6,
    minEvaluations: 1,
  },
  {
    name: "Fashion-MNIST Diffusion",
    file: path.join(ROOT, "demo", "Fashion-MNIST-Diffusion", "index.html"),
    presetKey: "FASHION_MNIST_DIFFUSION_PRESET",
    minModels: 4,
    minTrainers: 8,
    minGenerations: 8,
    minEvaluations: 2,
  },
  {
    name: "Fashion-MNIST Conditional Diffusion",
    file: path.join(ROOT, "demo", "Fashion-MNIST-Conditional-Diffusion", "index.html"),
    presetKey: "FASHION_MNIST_COND_DIFFUSION_PRESET",
    minModels: 2,
    minTrainers: 4,
    minGenerations: 7,
    minEvaluations: 2,
  },
  {
    name: "Fashion-MNIST UNet",
    file: path.join(ROOT, "demo", "Fashion-MNIST-UNet", "index.html"),
    presetKey: "FASHION_MNIST_UNET_PRESET",
    minModels: 2,
    minTrainers: 2,
    minGenerations: 2,
    minEvaluations: 1,
  },
  {
    name: "Synthetic Segmentation",
    file: path.join(ROOT, "demo", "Synthetic-Segmentation", "index.html"),
    presetKey: "SYNTHETIC_SEGMENTATION_PRESET",
    minModels: 2,
    minTrainers: 2,
    minGenerations: 0,
    minEvaluations: 1,
  },
  {
    name: "Synthetic Detection",
    file: path.join(ROOT, "demo", "Synthetic-Detection", "index.html"),
    presetKey: "SYNTHETIC_DETECTION_PRESET",
    minModels: 1,
    minTrainers: 1,
    minGenerations: 0,
    minEvaluations: 1,
  },
  {
    name: "Oscillator Surrogate",
    file: path.join(ROOT, "demo", "Oscillator-Surrogate", "index.html"),
    presetKey: "OSCILLATOR_DEMO_PRESET",
    minModels: 5,
    minTrainers: 5,
    minGenerations: 3,
    minEvaluations: 1,
  },
  {
    name: "Fashion-MNIST Benchmark",
    file: path.join(ROOT, "demo", "Fashion-MNIST-Benchmark", "index.html"),
    presetKey: "FASHION_MNIST_BENCHMARK_PRESET",
    minModels: 7,
    minTrainers: 7,
    minGenerations: 6,
    minEvaluations: 2,
  },
];

var passed = 0;
var failed = 0;
var errors = [];

function ok(cond, label) {
  if (cond) {
    passed++;
    console.log("  \x1b[32m✓\x1b[0m " + label);
  } else {
    failed++;
    errors.push(label);
    console.log("  \x1b[31m✗\x1b[0m " + label);
  }
}

async function clickTopTab(page, tabName) {
  return page.evaluate(function (name) {
    var btns = Array.prototype.slice.call(document.querySelectorAll("button"));
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.trim().toLowerCase() === name) {
        btns[i].click();
        return true;
      }
    }
    return false;
  }, tabName);
}

async function activeTabHasContent(page) {
  return page.evaluate(function () {
    var active = document.querySelector(".osc-workspace.active");
    if (!active) return { ok: false, detail: "no active workspace" };
    var left = active.querySelector(".osc-panel-left");
    var main = active.querySelector(".osc-panel-main");
    var hasVisual = !!(active.querySelector(".drawflow") || active.querySelector("canvas") || active.querySelector("svg"));
    var hasButtons = active.querySelectorAll("button").length > 0;
    var leftLen = left ? left.textContent.trim().length : 0;
    var mainLen = main ? main.textContent.trim().length : 0;
    var okState = hasVisual || hasButtons || leftLen > 0 || mainLen > 0;
    return {
      ok: okState,
      detail: "left=" + leftLen + ", main=" + mainLen + ", visual=" + hasVisual + ", buttons=" + hasButtons
    };
  });
}

function filterFatalErrors(list) {
  return list.filter(function (e) {
    return e.indexOf("favicon") < 0 &&
      e.indexOf("net::ERR") < 0 &&
      e.indexOf("DevTools") < 0 &&
      e.indexOf("Cross origin") < 0 &&
      e.indexOf("CORS") < 0;
  });
}

async function runDemo(browser, demo) {
  var page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 960 });

  var consoleErrors = [];
  page.on("console", function (msg) {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", function (err) {
    consoleErrors.push(String(err));
  });

  console.log("\n=== " + demo.name + " ===");
  await page.goto("file://" + demo.file, { waitUntil: "networkidle0", timeout: 60000 });
  ok(true, "Page loaded");

  var presetState = await page.evaluate(function (presetKey) {
    var preset = window[presetKey];
    return {
      hasPreset: !!preset,
      datasetId: preset && preset.dataset ? preset.dataset.id : null,
      modelCount: preset && preset.models ? preset.models.length : 0,
      trainerCount: preset && preset.trainers ? preset.trainers.length : 0,
      generationCount: preset && preset.generations ? preset.generations.length : 0,
      evaluationCount: preset && preset.evaluations ? preset.evaluations.length : 0,
    };
  }, demo.presetKey);

  ok(presetState.hasPreset, "Preset exists: " + demo.presetKey);
  ok(!!presetState.datasetId, "Preset dataset exists");
  ok(presetState.modelCount >= demo.minModels, "Model count >= " + demo.minModels + " (got " + presetState.modelCount + ")");
  ok(presetState.trainerCount >= demo.minTrainers, "Trainer count >= " + demo.minTrainers + " (got " + presetState.trainerCount + ")");
  ok(presetState.generationCount >= demo.minGenerations, "Generation count >= " + demo.minGenerations + " (got " + presetState.generationCount + ")");
  ok(presetState.evaluationCount >= demo.minEvaluations, "Evaluation count >= " + demo.minEvaluations + " (got " + presetState.evaluationCount + ")");

  var tabs = ["playground", "dataset", "model", "trainer", "generation", "evaluation"];
  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];
    var clicked = await clickTopTab(page, tab);
    ok(clicked, "Tab button exists: " + tab);
    await new Promise(function (r) { setTimeout(r, 500); });
    var state = await activeTabHasContent(page);
    ok(state.ok, "Tab renders: " + tab + " (" + state.detail + ")");
  }

  var fatalErrors = filterFatalErrors(consoleErrors);
  ok(fatalErrors.length === 0, "No fatal JS errors (" + fatalErrors.length + ")");
  if (fatalErrors.length) {
    fatalErrors.slice(0, 3).forEach(function (e) {
      console.log("    ERROR: " + e.slice(0, 200));
    });
  }

  await page.close();
}

async function main() {
  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    for (var i = 0; i < DEMOS.length; i++) {
      await runDemo(browser, DEMOS[i]);
    }
  } finally {
    await browser.close();
  }

  console.log("\n========================================");
  if (failed === 0) {
    console.log("\x1b[32m  PASS: All " + passed + " demo matrix tests passed\x1b[0m");
  } else {
    console.log("\x1b[31m  FAIL: " + passed + " passed, " + failed + " failed\x1b[0m");
    errors.forEach(function (e) { console.log("  - " + e); });
  }
  console.log("========================================\n");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (err) {
  console.error("FATAL:", err);
  process.exit(1);
});

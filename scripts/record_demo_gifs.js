/**
 * Record demo workflow GIFs using Puppeteer screenshots → ffmpeg.
 *
 * Run: node scripts/record_demo_gifs.js
 *
 * Captures a sequence of screenshots as the page navigates between tabs,
 * then stitches them into an animated GIF via ffmpeg.
 */
"use strict";

var puppeteer = require("puppeteer");
var path = require("path");
var fs = require("fs");
var { execSync } = require("child_process");

var BASE_URL = "http://localhost:3777";
var VIEWPORT = { width: 1280, height: 800 };
var FRAME_DIR = path.join(__dirname, "..", ".tmp", "gif_frames");

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach(function (f) { fs.unlinkSync(path.join(dir, f)); });
  }
}

async function captureFrames(page, frameDir, steps) {
  var frameIdx = 0;
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];

    if (step.tab) {
      await page.evaluate(function (tabName) {
        var all = document.querySelectorAll("button, div[role=tab], span");
        for (var k = 0; k < all.length; k++) {
          var t = all[k].textContent.trim().toLowerCase();
          if (t === tabName.toLowerCase()) { all[k].click(); return; }
        }
      }, step.tab);
    }

    if (step.click) {
      try {
        await page.click(step.click);
      } catch (e) {}
    }

    if (step.eval) {
      try { await page.evaluate(step.eval); } catch (e) {}
    }

    await sleep(step.wait || 800);

    // Capture multiple frames at this position for the "pause" effect
    var holdFrames = step.hold || 3;
    for (var f = 0; f < holdFrames; f++) {
      var framePath = path.join(frameDir, "frame_" + String(frameIdx).padStart(4, "0") + ".png");
      await page.screenshot({ path: framePath, fullPage: false });
      frameIdx++;
    }
  }
  return frameIdx;
}

function framesToGif(frameDir, outputPath, fps) {
  fps = fps || 2;
  // Use ffmpeg to create GIF from PNG frames
  var palettePath = path.join(frameDir, "palette.png");
  var inputPattern = path.join(frameDir, "frame_%04d.png");

  // Generate palette for better colors
  execSync(
    "ffmpeg -y -framerate " + fps + " -i " + inputPattern +
    " -vf \"fps=" + fps + ",scale=960:-1:flags=lanczos,palettegen=max_colors=128\" " + palettePath,
    { stdio: "pipe" }
  );

  // Generate GIF using palette
  execSync(
    "ffmpeg -y -framerate " + fps + " -i " + inputPattern +
    " -i " + palettePath +
    " -lavfi \"fps=" + fps + ",scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3\" " + outputPath,
    { stdio: "pipe" }
  );

  var size = fs.statSync(outputPath).size;
  console.log("    GIF: " + outputPath + " (" + (size / 1024).toFixed(0) + " KB)");
}

var DEMOS = [
  {
    name: "Oscillator-Surrogate",
    path: "/demo/Oscillator-Surrogate/index.html",
    output: "demo/Oscillator-Surrogate/images/demo_workflow.gif",
    fps: 2,
    steps: [
      { tab: "Dataset", wait: 1500, hold: 4 },
      { tab: "Model", wait: 1500, hold: 4 },
      { tab: "Trainer", wait: 1500, hold: 4 },
      { tab: "Evaluation", wait: 1000, hold: 3 },
      { tab: "Generation", wait: 1000, hold: 3 },
    ],
  },
  {
    name: "Fashion-MNIST-Transformer",
    path: "/demo/Fashion-MNIST-Transformer/index.html",
    output: "demo/Fashion-MNIST-Transformer/images/demo_workflow.gif",
    fps: 2,
    steps: [
      { tab: "Dataset", wait: 1500, hold: 4 },
      { tab: "Model", wait: 1500, hold: 4 },
      { tab: "Trainer", wait: 1500, hold: 4 },
      { tab: "Evaluation", wait: 1000, hold: 3 },
    ],
  },
  {
    name: "TrAISformer",
    path: "/demo/TrAISformer/index.html",
    output: "demo/TrAISformer/images/demo_workflow.gif",
    fps: 2,
    steps: [
      { tab: "Dataset", wait: 2000, hold: 5 },
      { tab: "Model", wait: 1500, hold: 4 },
      { tab: "Trainer", wait: 1500, hold: 4 },
      { tab: "Evaluation", wait: 1000, hold: 3 },
    ],
  },
  {
    name: "Fashion-MNIST-Diffusion",
    path: "/demo/Fashion-MNIST-Diffusion/index.html",
    output: "demo/Fashion-MNIST-Diffusion/images/demo_workflow.gif",
    fps: 2,
    steps: [
      { tab: "Dataset", wait: 1500, hold: 4 },
      { tab: "Model", wait: 1500, hold: 4 },
      { tab: "Trainer", wait: 1500, hold: 4 },
      { tab: "Generation", wait: 1000, hold: 3 },
    ],
  },
  {
    name: "Fashion-MNIST-Conditional-Diffusion",
    path: "/demo/Fashion-MNIST-Conditional-Diffusion/index.html",
    output: "demo/Fashion-MNIST-Conditional-Diffusion/images/demo_workflow.gif",
    fps: 2,
    steps: [
      { tab: "Dataset", wait: 1500, hold: 4 },
      { tab: "Model", wait: 1500, hold: 4 },
      { tab: "Trainer", wait: 1500, hold: 4 },
      { tab: "Generation", wait: 1000, hold: 3 },
    ],
  },
  {
    name: "Fashion-MNIST-GAN",
    path: "/demo/Fashion-MNIST-GAN/index.html",
    output: "demo/Fashion-MNIST-GAN/images/demo_workflow.gif",
    fps: 2,
    steps: [
      { tab: "Dataset", wait: 1500, hold: 4 },
      { tab: "Model", wait: 1500, hold: 4 },
      { tab: "Trainer", wait: 1500, hold: 4 },
      { tab: "Generation", wait: 1000, hold: 3 },
    ],
  },
  {
    name: "LSTM-VAE",
    path: "/demo/LSTM-VAE-for-dominant-motion-extraction/index.html",
    output: "demo/LSTM-VAE-for-dominant-motion-extraction/images/demo_workflow.gif",
    fps: 2,
    steps: [
      { tab: "Dataset", wait: 1500, hold: 4 },
      { tab: "Model", wait: 1500, hold: 4 },
      { tab: "Trainer", wait: 1500, hold: 4 },
      { tab: "Generation", wait: 1000, hold: 3 },
    ],
  },
  {
    name: "Fashion-MNIST-Benchmark",
    path: "/demo/Fashion-MNIST-Benchmark/index.html",
    output: "demo/Fashion-MNIST-Benchmark/images/demo_workflow.gif",
    fps: 2,
    steps: [
      { tab: "Dataset", wait: 1500, hold: 4 },
      { tab: "Model", wait: 1500, hold: 4 },
      { tab: "Trainer", wait: 1500, hold: 4 },
      { tab: "Evaluation", wait: 1000, hold: 3 },
    ],
  },
];

async function recordDemo(browser, demo) {
  console.log("\n=== " + demo.name + " ===");
  var demoFrameDir = path.join(FRAME_DIR, demo.name);
  ensureDir(demoFrameDir);
  cleanDir(demoFrameDir);

  var page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  try {
    console.log("  Loading...");
    await page.goto(BASE_URL + demo.path, { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(2000);

    console.log("  Capturing frames...");
    var frameCount = await captureFrames(page, demoFrameDir, demo.steps);
    console.log("  " + frameCount + " frames captured");

    console.log("  Encoding GIF...");
    var outputPath = path.resolve(__dirname, "..", demo.output);
    ensureDir(path.dirname(outputPath));
    framesToGif(demoFrameDir, outputPath, demo.fps);
  } catch (e) {
    console.log("  Error: " + e.message);
  }

  await page.close();
}

async function main() {
  try {
    var resp = await fetch(BASE_URL + "/api/health");
    var health = await resp.json();
    if (!health.ok) throw new Error("not healthy");
  } catch (e) {
    console.error("Start server first: node server/training_server.js");
    process.exit(1);
  }

  ensureDir(FRAME_DIR);

  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  for (var i = 0; i < DEMOS.length; i++) {
    await recordDemo(browser, DEMOS[i]);
  }

  await browser.close();

  // Cleanup frames
  try { execSync("rm -rf " + FRAME_DIR); } catch (e) {}

  console.log("\nAll GIFs recorded!");
}

main().catch(function (e) { console.error("Fatal:", e); process.exit(1); });

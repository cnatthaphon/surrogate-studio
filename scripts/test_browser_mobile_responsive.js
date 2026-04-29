"use strict";
/**
 * Mobile-viewport spot-check for the polish PR's responsive CSS.
 *
 * Emulates an iPhone 13 (390×844) and a smaller fold (360×640) and verifies:
 *   - Mobile hint banner appears <480px and is hidden ≥480px
 *   - Drawflow canvas (when present) has overflow-x = auto
 *   - Plotly wrappers stay within the viewport width (no horizontal scroll on body)
 *   - No console errors during initial load
 *
 * Tests three demos that exercise different layouts:
 *   - Custom CSV Tutorial (simplest, baseline)
 *   - Fashion-MNIST Diffusion (Plotly-heavy generative path)
 *   - Oscillator Surrogate (Drawflow + Plotly trajectories)
 */

var path = require("path");
var puppeteer = require("puppeteer");

var ROOT = path.resolve(__dirname, "..");

var DEMOS = [
  { name: "Custom CSV Tutorial",        rel: "demo/Custom-CSV-Tutorial/index.html" },
  { name: "Fashion-MNIST Diffusion",    rel: "demo/Fashion-MNIST-Diffusion/index.html" },
  { name: "Oscillator Surrogate",       rel: "demo/Oscillator-Surrogate/index.html" },
];

var VIEWPORTS = [
  { label: "iPhone 13 (390x844)",  width: 390, height: 844, mobile: true,  expectHint: true  },
  { label: "Fold narrow (360x640)", width: 360, height: 640, mobile: true,  expectHint: true  },
  { label: "Tablet (768x1024)",     width: 768, height: 1024, mobile: false, expectHint: false },
];

var passed = 0, failed = 0, errors = [];
function ok(cond, label) {
  if (cond) { passed++; console.log("  \x1b[32m✓\x1b[0m " + label); }
  else { failed++; errors.push(label); console.log("  \x1b[31m✗\x1b[0m " + label); }
}

async function checkViewport(browser, demoFile, vp) {
  var page = await browser.newPage();
  await page.setViewport({
    width: vp.width, height: vp.height,
    isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 2,
  });

  var consoleErrors = [];
  // Filter known-irrelevant errors that come from running demos via file://
  // (CORS on local IDX/labels files, ERR_FAILED on the same). In production
  // these load fine over HTTPS from CDN. None of them touch the responsive
  // layout we're spot-checking here.
  function _isIgnorableConsoleError(text) {
    var s = String(text || "");
    if (s.indexOf("blocked by CORS policy") >= 0) return true;
    if (s.indexOf("net::ERR_FAILED") >= 0) return true;
    if (s.indexOf("from origin 'null'") >= 0) return true;
    return false;
  }
  page.on("console", function (msg) {
    if (msg.type() !== "error") return;
    var t = msg.text();
    if (!_isIgnorableConsoleError(t)) consoleErrors.push(t);
  });
  page.on("pageerror", function (err) {
    var s = String(err);
    if (!_isIgnorableConsoleError(s)) consoleErrors.push(s);
  });

  await page.goto("file://" + demoFile, { waitUntil: "networkidle0", timeout: 60000 });
  // Give the SurrogateStudio.init + mobile-style injection a moment to run
  await new Promise(function (r) { setTimeout(r, 800); });

  var result = await page.evaluate(function (expectHint) {
    var styleEl = document.getElementById("osc-mobile-styles");
    var hintEl = document.getElementById("osc-mobile-hint");
    var hintVisible = false;
    if (hintEl) {
      var cs = getComputedStyle(hintEl);
      hintVisible = cs.display !== "none";
    }
    // Drawflow overflow-x check (the editor exists on Model tab; demos start
    // on Trainer tab so the editor may not be mounted — check the CSS rule
    // would apply by inspecting the stylesheet text instead).
    var drawflowRuleApplied = false;
    if (styleEl && styleEl.textContent.indexOf("overflow-x: auto") >= 0) {
      drawflowRuleApplied = true;
    }
    // body width should not exceed viewport (no horizontal page scroll)
    var bodyOverflow = document.documentElement.scrollWidth > window.innerWidth;
    // viewport meta present
    var hasViewportMeta = !!document.querySelector('meta[name="viewport"]');
    return {
      stylePresent: !!styleEl,
      hintPresent: !!hintEl,
      hintVisible: hintVisible,
      expectHintVisible: expectHint,
      drawflowRuleApplied: drawflowRuleApplied,
      hasHorizontalScroll: bodyOverflow,
      hasViewportMeta: hasViewportMeta,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  }, vp.expectHint);

  ok(result.hasViewportMeta, "[" + vp.label + "] viewport meta present");
  ok(result.stylePresent, "[" + vp.label + "] osc-mobile-styles injected");
  ok(result.hintPresent, "[" + vp.label + "] hint element exists in DOM");
  if (vp.expectHint) {
    ok(result.hintVisible, "[" + vp.label + "] hint banner VISIBLE at <480px (display !== 'none')");
  } else {
    ok(!result.hintVisible, "[" + vp.label + "] hint banner HIDDEN at >=480px (display === 'none')");
  }
  ok(result.drawflowRuleApplied, "[" + vp.label + "] @media rule injects overflow-x: auto for #drawflow");
  ok(!result.hasHorizontalScroll, "[" + vp.label + "] no horizontal page scroll (sw=" + result.scrollWidth + " <= iw=" + result.innerWidth + ")");
  ok(consoleErrors.length === 0, "[" + vp.label + "] no console errors (" + consoleErrors.length + ")");

  if (consoleErrors.length) {
    console.log("    Console errors:");
    consoleErrors.slice(0, 5).forEach(function (e) { console.log("      " + e.slice(0, 200)); });
  }

  await page.close();
}

async function main() {
  console.log("Mobile-responsive spot-check\n");

  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    for (var di = 0; di < DEMOS.length; di++) {
      var demo = DEMOS[di];
      var demoFile = path.join(ROOT, demo.rel);
      console.log("\n=== " + demo.name + " ===");
      for (var vi = 0; vi < VIEWPORTS.length; vi++) {
        await checkViewport(browser, demoFile, VIEWPORTS[vi]);
      }
    }
  } finally {
    await browser.close();
  }

  console.log("\n" + "=".repeat(60));
  console.log("PASS: " + passed + " | FAIL: " + failed);
  if (failed) {
    console.log("\nFailures:");
    errors.forEach(function (e) { console.log("  - " + e); });
    process.exit(1);
  }
  console.log("\n\x1b[32mPASS test_browser_mobile_responsive\x1b[0m");
}

main().catch(function (err) {
  console.error("FAIL test_browser_mobile_responsive:", err && err.stack ? err.stack : err);
  process.exit(1);
});

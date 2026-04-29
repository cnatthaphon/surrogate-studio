"use strict";
/**
 * Static-deploy preflight check for the Run Notebook flow.
 *
 * Simulates the failure mode the polish PR addressed: a visitor opens a demo
 * over HTTPS-equivalent (file://) with no local notebook server running.
 * Before the polish PR, _startKernel issued the kernel-spawn POST directly
 * and the user sat at "Preparing..." for ~30s waiting for the fetch to
 * eventually fail. After the polish PR, _preflightHealth probes /api/health
 * with a 3s AbortController-backed timeout first and surfaces an actionable
 * error.
 *
 * What this test verifies:
 *   - OSCNotebookRunnerUI.open() drives the internal _preflightHealth path.
 *   - _preflightHealth calls /api/health with an AbortController signal,
 *     returns within budget, and skips /api/notebook/start when health fails.
 *   - When called against a known-bad URL, the callback fires within the
 *     budget with an Error whose message is actionable.
 */

var path = require("path");
var puppeteer = require("puppeteer");

var ROOT = path.resolve(__dirname, "..");
var DEMO_FILE = path.join(ROOT, "demo", "Custom-CSV-Tutorial", "index.html");

var passed = 0, failed = 0, errors = [];
function ok(cond, label) {
  if (cond) { passed++; console.log("  \x1b[32m✓\x1b[0m " + label); }
  else { failed++; errors.push(label); console.log("  \x1b[31m✗\x1b[0m " + label); }
}

async function main() {
  console.log("Run Notebook preflight test\n");
  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    var page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Filter file:// CORS noise — same as the mobile test
    page.on("console", function () {});
    page.on("pageerror", function () {});

    await page.goto("file://" + DEMO_FILE, { waitUntil: "networkidle0", timeout: 60000 });
    await new Promise(function (r) { setTimeout(r, 500); });

    // Confirm the runner UI module loaded
    var moduleLoaded = await page.evaluate(function () {
      return !!(window.OSCNotebookRunnerUI && typeof window.OSCNotebookRunnerUI.showBusy === "function");
    });
    ok(moduleLoaded, "OSCNotebookRunnerUI loaded");

    // === Test 1: drive the real runner.open() path, but intercept fetch so
    // /api/health hangs until the runner's AbortController aborts it.
    console.log("\n--- runner.open invokes internal health preflight ---");
    var t0 = Date.now();
    var preflightResult = await page.evaluate(function () {
      return new Promise(function (resolve) {
        var W = window;
        var NRA = W.OSCNotebookRunnerUI;
        if (!NRA) { resolve({ ok: false, where: "no-module" }); return; }
        var originalFetch = W.fetch;
        var calls = [];
        var startedAt = performance.now();

        function abortError() {
          try { return new DOMException("The operation was aborted.", "AbortError"); }
          catch (e) {
            var err = new Error("The operation was aborted.");
            err.name = "AbortError";
            return err;
          }
        }

        function restoreAndResolve(value) {
          W.fetch = originalFetch;
          if (NRA && typeof NRA.close === "function") NRA.close();
          resolve(value);
        }

        W.fetch = function (url, opts) {
          var fullUrl = String(url || "");
          var hasSignal = !!(opts && opts.signal);
          calls.push({
            url: fullUrl,
            method: String((opts && opts.method) || "GET"),
            hasSignal: hasSignal,
          });
          if (fullUrl.indexOf("/api/health") >= 0) {
            return new Promise(function (_resolve, reject) {
              var signal = opts && opts.signal;
              if (signal && signal.aborted) {
                reject(abortError());
                return;
              }
              if (signal && typeof signal.addEventListener === "function") {
                signal.addEventListener("abort", function () {
                  reject(abortError());
                }, { once: true });
              }
            });
          }
          if (fullUrl.indexOf("/api/notebook/start") >= 0) {
            return Promise.resolve({
              ok: true,
              json: function () { return Promise.resolve({ kernelId: "should-not-start" }); },
            });
          }
          return originalFetch.apply(this, arguments);
        };

        var fakeNotebook = {
          cells: [
            { cell_type: "markdown", source: ["test"], metadata: {} },
          ],
          metadata: {},
          nbformat: 4, nbformat_minor: 5,
        };
        try {
          NRA.open({
            notebook: fakeNotebook,
            serverUrl: "http://127.0.0.1:3777",
            onArtifacts: function () {},
          });
        } catch (e) {
          restoreAndResolve({ ok: false, threw: String((e && e.message) || e), calls: calls });
          return;
        }

        var deadline = performance.now() + 7000;
        function poll() {
          var bodyText = document.body.innerText || document.body.textContent || "";
          var healthCalls = calls.filter(function (c) { return c.url.indexOf("/api/health") >= 0; });
          var startCalls = calls.filter(function (c) { return c.url.indexOf("/api/notebook/start") >= 0; });
          var hasActionable =
            bodyText.indexOf("Local notebook server did not respond") >= 0 ||
            bodyText.indexOf("Run All requires a local server") >= 0;
          if (hasActionable) {
            restoreAndResolve({
              ok: true,
              elapsedMs: performance.now() - startedAt,
              healthCalls: healthCalls.length,
              healthHasSignal: healthCalls.some(function (c) { return c.hasSignal; }),
              startCalls: startCalls.length,
            });
            return;
          }
          if (performance.now() > deadline) {
            restoreAndResolve({
              ok: false,
              elapsedMs: performance.now() - startedAt,
              healthCalls: healthCalls.length,
              healthHasSignal: healthCalls.some(function (c) { return c.hasSignal; }),
              startCalls: startCalls.length,
              snippet: bodyText.slice(0, 400),
              calls: calls,
            });
            return;
          }
          setTimeout(poll, 100);
        }
        poll();
      });
    });
    var elapsed = Date.now() - t0;
    console.log("  evaluate result:", JSON.stringify(preflightResult));
    ok(preflightResult.ok, "runner.open() surfaces preflight timeout failure");
    ok(preflightResult.healthCalls === 1, "runner preflight calls /api/health once");
    ok(preflightResult.healthHasSignal, "runner preflight supplies AbortController signal");
    ok(preflightResult.startCalls === 0, "kernel start is skipped when preflight fails");
    ok(preflightResult.elapsedMs < 5000, "preflight returns within 5s budget (got " + Math.round(preflightResult.elapsedMs) + "ms)");
    ok(elapsed < 8000, "round-trip including evaluate < 8s (got " + elapsed + "ms)");

    // === Test 2: confirm the real browser failure path with a known-bad URL.
    console.log("\n--- runner.open with unreachable server surfaces actionable error ---");
    var openResult = await page.evaluate(function () {
      return new Promise(function (resolve) {
        var W = window;
        var NRA = W.OSCNotebookRunnerUI;
        // Build a minimal valid notebook (1 markdown cell) so .open() is happy
        var fakeNotebook = {
          cells: [
            { cell_type: "markdown", source: ["test"], metadata: {} },
          ],
          metadata: {},
          nbformat: 4, nbformat_minor: 5,
        };
        // .open() will start kernel asynchronously. The busy overlay should
        // get an updateBusy("error") within ~3-5s due to preflight failure.
        var startedAt = performance.now();
        NRA.open({
          notebook: fakeNotebook,
          serverUrl: "http://127.0.0.1:1",
          onArtifacts: function () {},
        });
        // poll for an error indicator in the DOM (the runner overlay shows
        // the kernel-start error in the toolbar status area)
        var pollIntervalMs = 100;
        var maxWaitMs = 8000;
        var deadline = performance.now() + maxWaitMs;
        function poll() {
          var statusEls = document.querySelectorAll('div[id*="overlay"], div[style*="z-index:10000"]');
          // Search across the full overlay DOM for the actionable error text
          var bodyText = document.body.innerText || document.body.textContent || "";
          var hasActionable =
            bodyText.indexOf("Run All requires a local server") >= 0 ||
            bodyText.indexOf("Local notebook server did not respond") >= 0 ||
            bodyText.indexOf("Failed to reach") >= 0 ||
            bodyText.indexOf("Cannot reach local notebook server") >= 0;
          if (hasActionable) {
            resolve({ ok: true, elapsedMs: performance.now() - startedAt });
            return;
          }
          if (performance.now() > deadline) {
            resolve({
              ok: false,
              elapsedMs: performance.now() - startedAt,
              snippet: bodyText.slice(0, 400),
            });
            return;
          }
          setTimeout(poll, pollIntervalMs);
        }
        poll();
      });
    });
    console.log("  evaluate result:", JSON.stringify({ ok: openResult.ok, elapsedMs: Math.round(openResult.elapsedMs) }));
    ok(openResult.ok, "runner.open() surfaces actionable error message");
    if (openResult.ok) {
      ok(openResult.elapsedMs < 6000, "actionable error appears within 6s (got " + Math.round(openResult.elapsedMs) + "ms — well under the 30s 'Preparing...' hang)");
    } else {
      console.log("    DOM snippet:", (openResult.snippet || "").slice(0, 300));
    }

    await page.close();
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
  console.log("\n\x1b[32mPASS test_browser_runner_preflight\x1b[0m");
}

main().catch(function (err) {
  console.error("FAIL test_browser_runner_preflight:", err && err.stack ? err.stack : err);
  process.exit(1);
});

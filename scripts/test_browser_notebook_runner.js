"use strict";

var path = require("path");
var childProcess = require("child_process");
var puppeteer = require("puppeteer");

var ROOT = path.resolve(__dirname, "..");
var DEMO_FILE = path.join(ROOT, "demo", "TrAISformer", "index.html");
var SERVER_FILE = path.join(ROOT, "server", "training_server.js");
var PORT = 38778;
var SERVER_URL = "http://127.0.0.1:" + PORT;

var passed = 0, failed = 0, errors = [];
function ok(cond, label) {
  if (cond) { passed++; console.log("  \x1b[32m\u2713\x1b[0m " + label); }
  else { failed++; errors.push(label); console.log("  \x1b[31m\u2717\x1b[0m " + label); }
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function requestHealth() {
  return new Promise(function (resolve, reject) {
    var req = require("http").request(SERVER_URL + "/api/health", { method: "GET" }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function waitForServer(proc, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var stdout = "";
    var stderr = "";
    var done = false;

    function finish(err) {
      if (done) return;
      done = true;
      if (err) reject(err);
      else resolve({ stdout: stdout, stderr: stderr });
    }

    proc.stdout.on("data", function (chunk) { stdout += chunk.toString(); });
    proc.stderr.on("data", function (chunk) { stderr += chunk.toString(); });
    proc.on("exit", function (code) {
      if (!done) finish(new Error("Notebook test server exited early: " + code + "\n" + stderr.slice(0, 400)));
    });
    var started = Date.now();
    (function poll() {
      if (done) return;
      if (Date.now() - started > timeoutMs) {
        finish(new Error("Notebook test server did not become ready in time.\n" + stderr.slice(0, 400) + "\n" + stdout.slice(0, 400)));
        return;
      }
      requestHealth().then(function (health) {
        if (health && health.ok) finish(null);
        else setTimeout(poll, 250);
      }).catch(function () {
        setTimeout(poll, 250);
      });
    })();
  });
}

async function clickTab(page, label) {
  await page.evaluate(function (targetLabel) {
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].textContent.trim().toLowerCase() === String(targetLabel || "").toLowerCase()) {
        btns[i].click();
        return true;
      }
    }
    return false;
  }, label);
  await sleep(500);
}

async function main() {
  var serverProc = childProcess.spawn("node", [SERVER_FILE, "--port", String(PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  var browser = null;

  try {
    await waitForServer(serverProc, 15000);

    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    var page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 960 });

    var consoleErrors = [];
    page.on("console", function (msg) { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", function (err) { consoleErrors.push(String(err)); });

    await page.goto("file://" + DEMO_FILE, { waitUntil: "networkidle0", timeout: 60000 });
    ok(true, "TrAISformer demo loaded");

    await page.evaluate(function (serverUrl) {
      if (window.OSCServerRuntimeAdapter) {
        window.OSCServerRuntimeAdapter.DEFAULT_SERVER = serverUrl;
      }
    }, SERVER_URL);
    ok(true, "Notebook server URL overridden for smoke test");

    var datasetReady = await page.evaluate(async function () {
      var store = window._surrogateStore;
      var modules = window.OSCDatasetModules;
      if (!store || !modules || typeof modules.getModule !== "function") return false;
      var ds = store.listDatasets ? store.listDatasets({})[0] : null;
      if (!ds) return false;
      var mod = modules.getModule("ais_dma");
      if (!mod || typeof mod.build !== "function") return false;
      var cfg = Object.assign({}, ds.config || {}, { maxTrajectories: 24, windowSize: 16 });
      var built = await mod.build(cfg);
      store.upsertDataset(Object.assign({}, ds, { status: "ready", data: built }));
      return true;
    });
    ok(datasetReady, "Dataset seeded for notebook smoke");

    await clickTab(page, "trainer");
    await page.waitForFunction(function () {
      var btns = Array.from(document.querySelectorAll("button"));
      return btns.some(function (b) { return b.textContent.trim() === "Run Notebook"; });
    }, { timeout: 10000 });
    ok(true, "Run Notebook button visible");

    await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === "Run Notebook") {
          btns[i].click();
          return true;
        }
      }
      return false;
    });

    await page.waitForFunction(function () {
      return document.body.textContent.indexOf("Notebook Runner") >= 0;
    }, { timeout: 20000 });
    ok(true, "Notebook overlay opened");

    await page.waitForFunction(function () {
      var text = document.body.textContent || "";
      return text.indexOf("Preparing notebook") >= 0 ||
        text.indexOf("Checking server") >= 0 ||
        text.indexOf("Starting kernel") >= 0 ||
        text.indexOf("Notebook opened") >= 0 ||
        text.indexOf("Kernel ready") >= 0;
    }, { timeout: 20000 });
    ok(true, "Notebook provides immediate feedback");

    await page.waitForFunction(function () {
      return document.body.textContent.indexOf("Kernel ready") >= 0;
    }, { timeout: 20000 });
    ok(true, "Notebook kernel became ready");

    var notebookState = await page.evaluate(function () {
      var overlay = document.body.textContent.indexOf("Notebook Runner") >= 0;
      var codeCells = document.querySelectorAll("textarea").length;
      return { overlay: overlay, codeCells: codeCells };
    });
    ok(notebookState.overlay, "Notebook runner still visible");
    ok(notebookState.codeCells > 0, "Notebook includes editable code cells (" + notebookState.codeCells + ")");

    await page.evaluate(function () {
      var btns = document.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === "Close") {
          btns[i].click();
          return true;
        }
      }
      return false;
    });
    await sleep(500);
    var closed = await page.evaluate(function () {
      return document.body.textContent.indexOf("Notebook Runner") < 0;
    });
    ok(closed, "Notebook overlay closed");

    var fatalErrors = consoleErrors.filter(function (msg) {
      if (!msg) return false;
      return msg.indexOf("favicon") < 0 &&
        msg.indexOf("net::ERR") < 0 &&
        msg.indexOf("CORS") < 0 &&
        msg.indexOf("Cross origin") < 0 &&
        msg.indexOf("DevTools") < 0;
    });
    ok(fatalErrors.length === 0, "No fatal JS errors (" + fatalErrors.length + ")");
    if (fatalErrors.length) {
      fatalErrors.slice(0, 5).forEach(function (msg) {
        console.log("    ERROR: " + String(msg).slice(0, 300));
      });
    }

    console.log("\n========================================");
    if (failed === 0) console.log("\x1b[32m  PASS: All " + passed + " notebook runner browser tests passed\x1b[0m");
    else {
      console.log("\x1b[31m  FAIL: " + passed + " passed, " + failed + " failed\x1b[0m");
      errors.forEach(function (e) { console.log("  - " + e); });
    }
    console.log("========================================\n");
  } finally {
    if (browser) await browser.close();
    try { serverProc.kill("SIGTERM"); } catch (e) {}
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (err) {
  console.error("FATAL:", err);
  process.exit(1);
});

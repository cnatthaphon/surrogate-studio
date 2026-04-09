#!/usr/bin/env node
"use strict";

var path = require("path");
var http = require("http");
var assert = require("assert");
var childProcess = require("child_process");

var ROOT = path.resolve(__dirname, "..");
var SERVER_FILE = path.join(ROOT, "server", "training_server.js");
var PORT = 38777;
var BASE = "http://127.0.0.1:" + PORT;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function requestJson(method, urlPath, body) {
  return new Promise(function (resolve, reject) {
    var payload = body != null ? Buffer.from(JSON.stringify(body), "utf8") : null;
    var req = http.request(BASE + urlPath, {
      method: method,
      headers: payload ? {
        "Content-Type": "application/json",
        "Content-Length": String(payload.length),
      } : {},
    }, function (res) {
      var chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () {
        var text = Buffer.concat(chunks).toString("utf8");
        var json = {};
        try { json = text ? JSON.parse(text) : {}; } catch (e) {
          return reject(new Error("Invalid JSON from " + urlPath + ": " + text.slice(0, 200)));
        }
        if (res.statusCode >= 400) {
          var msg = (json && (json.error || json.message)) || ("HTTP " + res.statusCode);
          return reject(new Error(msg));
        }
        resolve(json);
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealth(timeoutMs) {
  var started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      var health = await requestJson("GET", "/api/health");
      if (health && health.ok) return health;
    } catch (e) {}
    await sleep(250);
  }
  throw new Error("Notebook server did not become healthy on port " + PORT);
}

async function main() {
  var proc = childProcess.spawn("node", [SERVER_FILE, "--port", String(PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  var stdout = "";
  var stderr = "";
  proc.stdout.on("data", function (c) { stdout += c.toString(); });
  proc.stderr.on("data", function (c) { stderr += c.toString(); });

  try {
    var health = await waitForHealth(15000);
    assert.strictEqual(health.ok, true, "health endpoint must return ok");

    var started = await requestJson("POST", "/api/notebook/start", {});
    assert.ok(started.kernelId, "kernelId must exist");

    var first = await requestJson("POST", "/api/notebook/execute", {
      kernelId: started.kernelId,
      code: "x = 2\nprint('hello')",
    });
    assert.strictEqual(String(first.stdout || "").trim(), "hello", "first cell stdout mismatch");
    assert.ok(!first.error, "first cell should not error");

    var second = await requestJson("POST", "/api/notebook/execute", {
      kernelId: started.kernelId,
      code: "print(x + 3)",
    });
    assert.strictEqual(String(second.stdout || "").trim(), "5", "kernel state should persist across cells");
    assert.ok(!second.error, "second cell should not error");

    var third = await requestJson("POST", "/api/notebook/execute", {
      kernelId: started.kernelId,
      code: "display({'status': 'ok', 'value': x})",
    });
    assert.ok(!third.error, "display() shim should not error");
    assert.ok(String(third.stdout || "").indexOf("status") >= 0, "display() output should be captured");

    var stopped = await requestJson("POST", "/api/notebook/stop", { kernelId: started.kernelId });
    assert.strictEqual(stopped.ok, true, "stop endpoint must return ok");

    var listed = await requestJson("GET", "/api/notebook/kernels");
    assert.ok(Array.isArray(listed.kernels), "kernels list must exist");
    assert.strictEqual(listed.kernels.length, 0, "no notebook kernels should remain after stop");

    console.log("PASS test_notebook_kernel_api");
  } finally {
    try { proc.kill("SIGTERM"); } catch (e) {}
    await sleep(500);
    if (!proc.killed) {
      try { proc.kill("SIGKILL"); } catch (e) {}
    }
    if (stderr.trim()) {
      console.log("[server stderr]");
      console.log(stderr.trim().slice(0, 1000));
    }
    if (proc.exitCode && proc.exitCode !== 0 && stdout.trim()) {
      console.log("[server stdout]");
      console.log(stdout.trim().slice(0, 1000));
    }
  }
}

main().catch(function (err) {
  console.error("FAIL test_notebook_kernel_api:", err && err.stack ? err.stack : err);
  process.exit(1);
});

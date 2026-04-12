#!/usr/bin/env node
"use strict";
/**
 * Server static file serving smoke test.
 * Starts server, verifies static routes, API, traversal protection,
 * and malformed URL handling without crashes.
 */
var http = require("http");
var { spawn } = require("child_process");
var path = require("path");

var PORT = 9950;
var ROOT = path.resolve(__dirname, "..");
var passed = 0, failed = 0;

function ok(cond, label) {
  if (cond) { passed++; console.log("  \x1b[32m✓\x1b[0m " + label); }
  else { failed++; console.log("  \x1b[31m✗\x1b[0m " + label); }
}

function fetch(urlPath) {
  return new Promise(function (resolve) {
    http.get("http://127.0.0.1:" + PORT + urlPath, function (res) {
      var body = "";
      res.on("data", function (c) { body += c; });
      res.on("end", function () { resolve({ status: res.statusCode, body: body, type: res.headers["content-type"] || "" }); });
    }).on("error", function (e) { resolve({ status: 0, body: e.message, type: "" }); });
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  // Start server
  var server = spawn(process.execPath, [path.join(ROOT, "server", "training_server.js"), "--port", String(PORT)], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  var serverOutput = "";
  server.stdout.on("data", function (d) { serverOutput += d.toString(); });
  server.stderr.on("data", function (d) { serverOutput += d.toString(); });

  await sleep(3000);

  // Check server started
  var alive = serverOutput.indexOf("Port") >= 0 || serverOutput.indexOf(String(PORT)) >= 0;
  ok(alive, "Server started on port " + PORT);

  console.log("\n=== Static Serving ===");

  // 1. Root serves index.html
  var root = await fetch("/");
  ok(root.status === 200 && root.type.indexOf("text/html") >= 0, "GET / → 200 HTML (" + root.status + ")");

  // 2. Demo directory
  var demo = await fetch("/demo/Oscillator-Surrogate/");
  ok(demo.status === 200 && demo.type.indexOf("text/html") >= 0, "GET /demo/Oscillator-Surrogate/ → 200 HTML");

  // 3. Bundle JS
  var bundle = await fetch("/dist/surrogate-studio.js");
  ok(bundle.status === 200 && bundle.type.indexOf("javascript") >= 0, "GET /dist/surrogate-studio.js → 200 JS");

  // 4. API health
  var health = await fetch("/api/health");
  ok(health.status === 200 && health.body.indexOf('"ok":true') >= 0, "GET /api/health → 200 OK");

  console.log("\n=== Security ===");

  // 5. Path traversal blocked
  var traversal = await fetch("/../../../etc/passwd");
  ok(traversal.status === 403 || traversal.status === 404, "Path traversal → " + traversal.status + " (not 200)");

  // 6. Encoded traversal
  var encodedTraversal = await fetch("/%2e%2e/%2e%2e/etc/passwd");
  ok(encodedTraversal.status === 403 || encodedTraversal.status === 404, "Encoded traversal → " + encodedTraversal.status);

  // 7. Malformed URL encoding — must not crash server
  var malformed = await fetch("/%E0%A4%A");
  ok(malformed.status === 400, "Malformed URL → 400 (not crash)");

  // 8. Server still alive after malformed request
  var stillAlive = await fetch("/api/health");
  ok(stillAlive.status === 200, "Server still alive after malformed URL");

  // 9. 404 for missing file
  var notFound = await fetch("/nonexistent/file.txt");
  ok(notFound.status === 404, "Missing file → 404");

  console.log("\n" + (failed === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m") + ": " + passed + "/" + (passed + failed));

  server.kill("SIGTERM");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (e) { console.error("FATAL:", e); process.exit(1); });

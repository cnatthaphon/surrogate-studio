#!/usr/bin/env node
"use strict";
/**
 * Surrogate Studio Training Server
 *
 * HTTP server that accepts training requests from the browser client,
 * spawns Python subprocess for PyTorch training, streams epoch logs
 * via SSE, and returns trained weights.
 *
 * Usage:
 *   node server/training_server.js [--port 3777] [--python /path/to/python]
 *
 * Endpoints:
 *   GET  /api/health          → { ok: true, backend: "pytorch", ... }
 *   POST /api/train           → start training job, returns { jobId }
 *   GET  /api/train/:id       → SSE stream of epoch logs + completion
 */

var http = require("http");
var fs = require("fs");
var path = require("path");
var { spawn } = require("child_process");
var url = require("url");

// --- config ---
var PORT = 3777;
var PYTHON = null; // auto-detect
var VENV_PATH = "/home/cue/venv/main/bin/python3"; // default venv
var SUBPROCESS_SCRIPT = path.join(__dirname, "train_subprocess.py");

// parse CLI args
process.argv.slice(2).forEach(function (arg, i, arr) {
  if (arg === "--port" && arr[i + 1]) PORT = Number(arr[i + 1]);
  if (arg === "--python" && arr[i + 1]) PYTHON = arr[i + 1];
});

if (!PYTHON) {
  // auto-detect python
  if (fs.existsSync(VENV_PATH)) PYTHON = VENV_PATH;
  else PYTHON = "python3";
}

// --- job storage ---
var jobs = {}; // jobId → { status, process, clients[], result }

function createJob(jobId, config) {
  jobs[jobId] = {
    id: jobId,
    status: "queued",
    config: config,
    process: null,
    clients: [], // SSE response objects
    epochs: [],
    result: null,
    error: null,
    startedAt: Date.now(),
  };
  return jobs[jobId];
}

function broadcast(jobId, event, data) {
  var job = jobs[jobId];
  if (!job) return;
  var msg = "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
  job.clients.forEach(function (res) {
    try { res.write(msg); } catch (e) { /* client disconnected */ }
  });
}

// --- training subprocess ---
function startTraining(jobId) {
  var job = jobs[jobId];
  if (!job) return;

  job.status = "running";
  broadcast(jobId, "status", "Starting PyTorch training...");

  // write config to temp file
  var tmpDir = path.join(__dirname, ".tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  var configPath = path.join(tmpDir, jobId + ".json");
  fs.writeFileSync(configPath, JSON.stringify(job.config, null, 2));

  // spawn python
  var proc = spawn(PYTHON, [SUBPROCESS_SCRIPT, configPath], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: path.resolve(__dirname, ".."),
  });
  job.process = proc;

  broadcast(jobId, "status", "Python subprocess started (PID " + proc.pid + ")");

  // read stdout line by line (JSON-lines protocol)
  var buffer = "";
  proc.stdout.on("data", function (chunk) {
    buffer += chunk.toString();
    var lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line
    lines.forEach(function (line) {
      line = line.trim();
      if (!line) return;
      try {
        var msg = JSON.parse(line);
        if (msg.kind === "epoch") {
          job.epochs.push(msg);
          broadcast(jobId, "epoch", msg);
        } else if (msg.kind === "complete") {
          job.result = msg.result;
          job.status = "done";
          broadcast(jobId, "complete", msg.result);
          // close all SSE connections
          job.clients.forEach(function (res) { try { res.end(); } catch (e) {} });
          job.clients = [];
        } else if (msg.kind === "status") {
          broadcast(jobId, "status", msg.message || "");
        } else if (msg.kind === "error") {
          job.error = msg.message || "Unknown error";
          job.status = "error";
          broadcast(jobId, "error", { message: job.error });
          job.clients.forEach(function (res) { try { res.end(); } catch (e) {} });
          job.clients = [];
        }
      } catch (e) {
        // non-JSON output — treat as log
        broadcast(jobId, "status", line);
      }
    });
  });

  proc.stderr.on("data", function (chunk) {
    var text = chunk.toString().trim();
    if (text) broadcast(jobId, "status", "[stderr] " + text.slice(0, 500));
  });

  proc.on("exit", function (code) {
    if (job.status === "running") {
      if (code === 0 && job.result) {
        job.status = "done";
      } else {
        job.status = "error";
        job.error = "Process exited with code " + code;
        broadcast(jobId, "error", { message: job.error });
      }
    }
    // cleanup
    try { fs.unlinkSync(configPath); } catch (e) {}
    job.clients.forEach(function (res) { try { res.end(); } catch (e) {} });
    job.clients = [];
  });

  proc.on("error", function (err) {
    job.status = "error";
    job.error = "Failed to start Python: " + err.message;
    broadcast(jobId, "error", { message: job.error });
    job.clients.forEach(function (res) { try { res.end(); } catch (e) {} });
    job.clients = [];
  });
}

// --- HTTP server ---
var server = http.createServer(function (req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  var parsed = url.parse(req.url, true);
  var pathname = parsed.pathname;

  // GET /api/health
  if (req.method === "GET" && pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      backend: "pytorch",
      python: PYTHON,
      activeJobs: Object.keys(jobs).filter(function (k) { return jobs[k].status === "running"; }).length,
    }));
    return;
  }

  // POST /api/train
  if (req.method === "POST" && pathname === "/api/train") {
    var body = "";
    req.on("data", function (chunk) { body += chunk; });
    req.on("end", function () {
      try {
        var config = JSON.parse(body);
        var jobId = config.runId || ("job-" + Date.now().toString(36));
        createJob(jobId, config);
        startTraining(jobId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId: jobId, status: "queued" }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/test — run test evaluation on server (same runtime as training)
  if (req.method === "POST" && pathname === "/api/test") {
    var body = "";
    req.on("data", function (chunk) { body += chunk; });
    req.on("end", function () {
      try {
        var config = JSON.parse(body);
        var configPath = path.join(__dirname, ".tmp", "test-" + Date.now() + ".json");
        if (!fs.existsSync(path.join(__dirname, ".tmp"))) fs.mkdirSync(path.join(__dirname, ".tmp"), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(config));

        var proc = spawn(PYTHON, [path.join(__dirname, "test_subprocess.py"), configPath], {
          stdio: ["ignore", "pipe", "pipe"],
          cwd: path.resolve(__dirname, ".."),
        });

        var output = "";
        proc.stdout.on("data", function (c) { output += c.toString(); });
        proc.stderr.on("data", function (c) { /* ignore stderr */ });
        proc.on("exit", function () {
          try { fs.unlinkSync(configPath); } catch (e) {}
          var result = null;
          output.trim().split("\n").forEach(function (line) {
            try { var m = JSON.parse(line); if (m.kind === "result") result = m.result; } catch (e) {}
          });
          if (result) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Test evaluation failed", output: output.slice(0, 500) }));
          }
        });
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/train/:id — SSE stream
  var sseMatch = pathname.match(/^\/api\/train\/([a-zA-Z0-9_-]+)$/);
  if (req.method === "GET" && sseMatch) {
    var jobId = sseMatch[1];
    var job = jobs[jobId];
    if (!job) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Job not found" }));
      return;
    }

    // SSE response
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    // send past epochs
    job.epochs.forEach(function (ep) {
      res.write("event: epoch\ndata: " + JSON.stringify(ep) + "\n\n");
    });

    // if already done, send result and close
    if (job.status === "done" && job.result) {
      res.write("event: complete\ndata: " + JSON.stringify(job.result) + "\n\n");
      res.end();
      return;
    }
    if (job.status === "error") {
      res.write("event: error\ndata: " + JSON.stringify({ message: job.error }) + "\n\n");
      res.end();
      return;
    }

    // register for future updates
    job.clients.push(res);
    req.on("close", function () {
      job.clients = job.clients.filter(function (c) { return c !== res; });
    });
    return;
  }

  // Static file serving for development (optional)
  if (req.method === "GET" && (pathname === "/" || pathname.indexOf("..") < 0)) {
    var filePath = path.join(__dirname, "..", pathname === "/" ? "index.html" : pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      var ext = path.extname(filePath);
      var mimes = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
      res.writeHead(200, { "Content-Type": mimes[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, function () {
  console.log("Surrogate Studio Training Server");
  console.log("  Port:   " + PORT);
  console.log("  Python: " + PYTHON);
  console.log("  URL:    http://localhost:" + PORT);
  console.log("  Health: http://localhost:" + PORT + "/api/health");
  console.log("");
  console.log("Open http://localhost:" + PORT + " in browser to use Surrogate Studio");
  console.log("Select 'PyTorch Server' as backend in Trainer config");
});

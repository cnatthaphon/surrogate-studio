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
var _kernels = {}; // kernelId → { process, execute(), shutdown(), alive() }

function _readBody(req, callback) {
  var stream = _getBodyStream(req);
  var chunks = [];
  stream.on("data", function (c) { chunks.push(c); });
  stream.on("end", function () { callback(Buffer.concat(chunks).toString()); });
  stream.on("error", function () { callback(""); });
}

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

function requestStop(jobId, reason) {
  var job = jobs[jobId];
  if (!job) return false;
  if (job.process && (job.status === "running" || job.status === "queued" || job.status === "stopping")) {
    job.status = "stopping";
    broadcast(jobId, "status", reason || "Stopping training...");
    try { job.process.kill("SIGTERM"); } catch (e) {}
    return true;
  }
  return false;
}

// --- training subprocess ---
function startTraining(jobId) {
  var job = jobs[jobId];
  if (!job) return;

  job.status = "running";
  broadcast(jobId, "status", "Starting PyTorch training...");

  // use existing config file if streamed, otherwise write new one
  var configPath;
  if (job.config && job.config._configPath && fs.existsSync(job.config._configPath)) {
    configPath = job.config._configPath;
  } else {
    var tmpDir = path.join(__dirname, ".tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    configPath = path.join(tmpDir, jobId + ".json");
    fs.writeFileSync(configPath, JSON.stringify(job.config, null, 2));
  }

  // spawn python
  var proc = spawn(PYTHON, [SUBPROCESS_SCRIPT, configPath], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: path.resolve(__dirname, ".."),
  });
  job.process = proc;

  // Kill orphaned training if no clients connect within 30s
  setTimeout(function () {
    if (job.clients.length === 0 && !job.result && job.process) {
      console.log("[server] No clients for job " + jobId + " after 30s — killing");
      try { job.process.kill("SIGTERM"); } catch (e) {}
      job.status = "killed";
    }
  }, 30000);

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
          // send only scalar metrics via SSE (not weights or raw predictions — too large)
          var lightResult = Object.assign({}, msg.result);
          delete lightResult.modelArtifacts;
          delete lightResult.testPredictions;
          delete lightResult.testTruth;
          lightResult.hasArtifacts = !!(msg.result.modelArtifacts);
          broadcast(jobId, "complete", lightResult);
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
    if (job.status === "stopping" || job.status === "killed") {
      job.status = "stopped";
    } else if (job.status === "running") {
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
var zlib = require("zlib");

// get the request body stream — decompress if gzip-encoded
function _getBodyStream(req) {
  var encoding = String(req.headers["content-encoding"] || "").toLowerCase();
  if (encoding === "gzip") return req.pipe(zlib.createGunzip());
  if (encoding === "deflate") return req.pipe(zlib.createInflate());
  return req;
}

// shared sync subprocess runner (used by /api/test, /api/predict, /api/generate)
// streams request body to temp file, decompresses gzip if needed
function _runSyncSubprocess(req, res, scriptName, label) {
  var tmpDir = path.join(__dirname, ".tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  var configPath = path.join(tmpDir, label + "-" + Date.now() + ".json");
  var writeStream = fs.createWriteStream(configPath);
  _getBodyStream(req).pipe(writeStream);
  writeStream.on("finish", function () {
    try {

      var proc = spawn(PYTHON, [path.join(__dirname, scriptName), configPath], {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: path.resolve(__dirname, ".."),
      });

      var output = "";
      proc.stdout.on("data", function (c) { output += c.toString(); });
      proc.stderr.on("data", function () {});
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
          res.end(JSON.stringify({ error: label + " failed", output: output.slice(0, 500) }));
        }
      });
    } catch (e) {
      try { fs.unlinkSync(configPath); } catch (_) {}
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  writeStream.on("error", function (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Failed to write config: " + err.message }));
  });
}

var server = http.createServer(function (req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Content-Encoding");

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
    var tmpDir = path.join(__dirname, ".tmp");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    var trainTmpPath = path.join(tmpDir, "train-body-" + Date.now() + ".json");
    var trainWs = fs.createWriteStream(trainTmpPath);
    _getBodyStream(req).pipe(trainWs);
    trainWs.on("finish", function () {
      try {
        // extract runId from first 200 bytes without loading entire file
        var head = "";
        try { var fd = fs.openSync(trainTmpPath, "r"); var buf = Buffer.alloc(200); fs.readSync(fd, buf, 0, 200, 0); fs.closeSync(fd); head = buf.toString("utf8"); } catch (_) {}
        var runIdMatch = head.match(/"runId"\s*:\s*"([^"]+)"/);
        var jobId = (runIdMatch && runIdMatch[1]) || ("job-" + Date.now().toString(36));
        // pass file directly to Python — no JSON.parse in Node
        createJob(jobId, { _configPath: trainTmpPath });
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

  // POST /api/train/:id/stop
  var stopMatch = pathname.match(/^\/api\/train\/([a-zA-Z0-9_-]+)\/stop$/);
  if (req.method === "POST" && stopMatch) {
    var stopJobId = stopMatch[1];
    var stopJob = jobs[stopJobId];
    if (!stopJob) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Job not found" }));
      return;
    }
    requestStop(stopJobId, "Training stop requested by client.");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, jobId: stopJobId, status: stopJob.status }));
    return;
  }

  // POST /api/test — run test evaluation on server (same runtime as training)
  if (req.method === "POST" && pathname === "/api/test") {
    _runSyncSubprocess(req, res, "test_subprocess.py", "test");
    return;
  }

  // GET /api/train/:id/result — fetch full result with weights
  var resultMatch = pathname.match(/^\/api\/train\/([a-zA-Z0-9_-]+)\/result$/);
  if (req.method === "GET" && resultMatch) {
    var rJobId = resultMatch[1];
    var rJob = jobs[rJobId];
    if (!rJob || !rJob.result) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Job not found or no result" }));
      return;
    }
    // stream result as gzip to handle large weight arrays
    var resultJson = JSON.stringify(rJob.result);
    var zlib = require("zlib");
    zlib.gzip(Buffer.from(resultJson), function (err, compressed) {
      if (err) { res.writeHead(500); res.end(JSON.stringify({ error: err.message })); return; }
      res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
      res.end(compressed);
    });
    return;
  }

  // POST /api/predict — batch prediction on server
  if (req.method === "POST" && pathname === "/api/predict") {
    _runSyncSubprocess(req, res, "predict_subprocess.py", "predict");
    return;
  }

  // POST /api/generate — generation on server (reconstruct/random)
  if (req.method === "POST" && pathname === "/api/generate") {
    _runSyncSubprocess(req, res, "generate_subprocess.py", "generate");
    return;
  }

  // ─── Notebook Kernel Endpoints ───

  // POST /api/notebook/start — start a persistent Python kernel
  if (req.method === "POST" && pathname === "/api/notebook/start") {
    var kernelId = "kernel-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var kernelProc = spawn(PYTHON, [path.join(__dirname, "notebook_kernel.py")], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.resolve(__dirname, ".."),
    });
    var kernelBuf = "";
    var kernelCallbacks = [];
    var kernelAlive = true;

    kernelProc.stdout.on("data", function (chunk) {
      kernelBuf += chunk.toString();
      var lines = kernelBuf.split("\n");
      kernelBuf = lines.pop();
      lines.forEach(function (line) {
        if (!line.trim()) return;
        try {
          var msg = JSON.parse(line);
          if (kernelCallbacks.length) kernelCallbacks.shift()(msg);
        } catch (e) {}
      });
    });
    kernelProc.stderr.on("data", function () {});
    kernelProc.on("exit", function () {
      kernelAlive = false;
      delete _kernels[kernelId];
      // flush pending callbacks with error
      kernelCallbacks.forEach(function (cb) { cb({ kind: "error", message: "Kernel exited" }); });
      kernelCallbacks = [];
    });

    _kernels[kernelId] = {
      id: kernelId,
      process: kernelProc,
      alive: function () { return kernelAlive; },
      execute: function (code, callback) {
        if (!kernelAlive) { callback({ kind: "error", message: "Kernel not running" }); return; }
        kernelCallbacks.push(callback);
        kernelProc.stdin.write(JSON.stringify({ kind: "execute", code: code }) + "\n");
      },
      shutdown: function () {
        if (!kernelAlive) return;
        try { kernelProc.stdin.write(JSON.stringify({ kind: "shutdown" }) + "\n"); } catch (e) {}
        setTimeout(function () { try { kernelProc.kill(); } catch (e) {} }, 2000);
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ kernelId: kernelId, status: "running" }));
    return;
  }

  // POST /api/notebook/execute — execute a code cell in an existing kernel
  if (req.method === "POST" && pathname === "/api/notebook/execute") {
    _readBody(req, function (body) {
      try {
        var payload = JSON.parse(body);
        var kId = payload.kernelId;
        var code = payload.code || "";
        var kernel = _kernels[kId];
        if (!kernel || !kernel.alive()) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Kernel not found or not running" }));
          return;
        }
        kernel.execute(code, function (result) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        });
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/notebook/stop — stop a kernel
  if (req.method === "POST" && pathname === "/api/notebook/stop") {
    _readBody(req, function (body) {
      try {
        var payload = JSON.parse(body);
        var kernel = _kernels[payload.kernelId];
        if (kernel) { kernel.shutdown(); delete _kernels[payload.kernelId]; }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/notebook/kernels — list active kernels
  if (req.method === "GET" && pathname === "/api/notebook/kernels") {
    var list = Object.keys(_kernels).map(function (id) { return { id: id, alive: _kernels[id].alive() }; });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ kernels: list }));
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
      // Kill training if no clients listening (all disconnected)
      if (job.clients.length === 0 && job.process && !job.result) {
        console.log("[server] All clients disconnected for job " + jobId + " — killing training");
        try { job.process.kill("SIGTERM"); } catch (e) {}
        job.status = "killed";
      }
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

#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[k] = v;
  }
  return out;
}

function ensureDirFor(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = resolve(args["project-dir"] || ".");
  const runtime = String(args.runtime || "python_server");
  const pythonBin = args.python || process.env.OSC_PYTHON || "python3";
  const workerPath = resolve(projectDir, "server", "python_train_worker.py");

  const cfgPath = args.config ? resolve(args.config) : "";
  let cfg = {};
  if (cfgPath && existsSync(cfgPath)) {
    cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
  }

  const runId = args["run-id"] || `run_${Date.now()}`;
  const outDir = resolve(
    args["out-dir"] ||
      cfg.out_dir ||
      resolve(projectDir, "server", "runs", runId),
  );
  mkdirSync(outDir, { recursive: true });

  const progressJsonl = resolve(outDir, "progress.jsonl");
  const latestJson = resolve(outDir, "latest.json");
  const metricsJson = resolve(outDir, "metrics.json");
  const metricsCsv = resolve(outDir, "metrics.csv");
  ensureDirFor(progressJsonl);

  const pyArgs = [
    workerPath,
    "--runtime", runtime,
    "--session-id", String(args["session-id"] || cfg.session_id || runId),
    "--family", String(args.family || cfg.family || "direct"),
    "--progress-jsonl", progressJsonl,
    "--latest-json", latestJson,
    "--out-json", metricsJson,
    "--out-csv", metricsCsv,
  ];

  const appendArg = (k, v) => {
    if (v === undefined || v === null || String(v) === "") return;
    pyArgs.push(`--${k}`, String(v));
  };

  appendArg("config", cfgPath || "");
  appendArg("train-spec", args["train-spec"] || cfg.train_spec || "");
  appendArg("eval-spec", args["eval-spec"] || cfg.eval_spec || "");
  appendArg("notebooks-dir", args["notebooks-dir"] || cfg.notebooks_dir || process.env.OSC_SURROGATE_NOTEBOOKS_DIR || "");
  appendArg("dataset-csv", args["dataset-csv"] || cfg.dataset_csv || "");
  appendArg("models-dir", args["models-dir"] || cfg.models_dir || "");
  appendArg("include", args.include || cfg.include || "");
  appendArg("exclude", args.exclude || cfg.exclude || "");
  appendArg("split-mode", args["split-mode"] || cfg.split_mode || "");
  appendArg("train-frac", args["train-frac"] || cfg.train_frac || "");
  appendArg("val-frac", args["val-frac"] || cfg.val_frac || "");
  appendArg("test-frac", args["test-frac"] || cfg.test_frac || "");
  appendArg("epochs", args.epochs || cfg.epochs || "");
  appendArg("batch-size", args["batch-size"] || cfg.batch_size || "");
  appendArg("lr", args.lr || cfg.lr || "");
  appendArg("seed", args.seed || cfg.seed || "");

  if ((args["require-gpu"] || cfg.require_gpu) === "true" || cfg.require_gpu === true) {
    pyArgs.push("--require-gpu");
  }

  if (runtime !== "python_server") {
    const msg = {
      run_id: runId,
      code: 3,
      runtime,
      error: `runtime=${runtime} is not implemented in this orchestrator yet. Use runtime=python_server.`,
      out_dir: outDir,
      progress_jsonl: progressJsonl,
      latest_json: latestJson,
      metrics_json: metricsJson,
      metrics_csv: metricsCsv,
    };
    writeFileSync(resolve(outDir, "run_status.json"), JSON.stringify(msg, null, 2), "utf-8");
    console.error(msg.error);
    process.exit(3);
    return;
  }

  const proc = spawn(pythonBin, pyArgs, {
    cwd: projectDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stdout.on("data", (buf) => {
    const s = String(buf);
    process.stdout.write(s);
  });
  proc.stderr.on("data", (buf) => {
    const s = String(buf);
    process.stderr.write(s);
  });

  proc.on("close", (code) => {
    const status = {
      run_id: runId,
      code: Number(code ?? 1),
      runtime,
      out_dir: outDir,
      progress_jsonl: progressJsonl,
      latest_json: latestJson,
      metrics_json: metricsJson,
      metrics_csv: metricsCsv,
    };
    writeFileSync(resolve(outDir, "run_status.json"), JSON.stringify(status, null, 2), "utf-8");
    process.exit(Number(code ?? 1));
  });
}

main();

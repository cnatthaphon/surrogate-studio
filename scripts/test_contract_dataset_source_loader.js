#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PY = process.env.PYTHON || "/home/cue/venv/main/bin/python3";

function runLoader(desc) {
  const code = [
    "import json, sys",
    "sys.path.insert(0, " + JSON.stringify(path.join(ROOT, "server")) + ")",
    "from dataset_source_loader import load_dataset_from_source_descriptor, resolve_dataset_payload",
    "desc = json.loads(sys.argv[1])",
    "loaded = load_dataset_from_source_descriptor(desc)",
    "resolved = resolve_dataset_payload({'schemaId': loaded.get('schemaId', ''), 'sourceDescriptor': desc, 'featureSize': 999})",
    "print(json.dumps({'loaded': loaded, 'resolved': resolved}, sort_keys=True))",
  ].join("\n");
  const res = cp.spawnSync(PY, ["-c", code, JSON.stringify(desc)], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error((res.stderr || res.stdout || "python loader failed").trim());
  }
  return JSON.parse(String(res.stdout || "{}"));
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "osc-dataset-source-"));
  const csvPath = path.join(tmp, "samples.csv");
  const manifestPath = path.join(tmp, "manifest.json");
  fs.writeFileSync(csvPath, [
    "split,f0,f1,t0,t1,t2",
    "train,0.1,0.2,1,0,0",
    "train,0.3,0.4,0,1,0",
    "val,0.5,0.6,0,0,1",
    "test,0.7,0.8,1,0,0",
  ].join("\n"));
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaId: "synthetic_detection",
    mode: "classification",
    classCount: 3,
  }, null, 2));

  const csvResult = runLoader({
    kind: "local_csv_manifest",
    datasetPath: csvPath,
    manifestPath: manifestPath,
  });
  assert.strictEqual(csvResult.loaded.schemaId, "synthetic_detection", "csv schema mismatch");
  assert.strictEqual(csvResult.loaded.featureSize, 2, "csv feature size mismatch");
  assert.strictEqual(csvResult.loaded.targetSize, 3, "csv target size mismatch");
  assert.strictEqual(csvResult.loaded.xTrain.length, 2, "csv train count mismatch");
  assert.deepStrictEqual(csvResult.loaded.labelsVal[0], [0, 0, 1], "csv labels mismatch");
  assert.strictEqual(csvResult.resolved.featureSize, 2, "resolve should prefer loaded featureSize");

  const jsonPath = path.join(tmp, "dataset.json");
  fs.writeFileSync(jsonPath, JSON.stringify({
    dataset: {
      schemaId: "synthetic_detection",
      featureSize: 4,
      targetMode: "bbox",
      xTrain: [[0, 1, 0, 1]],
      yTrain: [[0.1, 0.2, 0.5, 0.6]],
      labelsTrain: [[1, 0, 0]],
      xVal: [],
      yVal: [],
      xTest: [],
      yTest: [],
    },
  }, null, 2));
  const jsonResult = runLoader({
    kind: "local_json_dataset",
    datasetPath: jsonPath,
  });
  assert.strictEqual(jsonResult.loaded.targetMode, "bbox", "json targetMode mismatch");
  assert.strictEqual(jsonResult.loaded.featureSize, 4, "json featureSize mismatch");
  assert.deepStrictEqual(jsonResult.loaded.yTrain[0], [0.1, 0.2, 0.5, 0.6], "json bbox mismatch");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("PASS test_contract_dataset_source_loader");
}

main();

"use strict";

const assert = require("assert");
const checkpointFormat = require("../src/checkpoint_format_core.js");

function run() {
  const raw = {
    weightSpecs: [
      { name: "n12/kernel", shape: [4, 8], dtype: "float32", offset: 0 },
      { name: "n12/bias", shape: [8], dtype: "float32", offset: 128 },
    ],
    weightValues: Array.from({ length: 40 }, (_, i) => i + 0.5),
  };

  const normalized = checkpointFormat.normalizeArtifacts(raw, { producerRuntime: "js_client" });
  assert.strictEqual(normalized.checkpointSchemaVersion, "osc-checkpoint-v1");
  assert.strictEqual(normalized.producerRuntime, "js_client");
  assert.strictEqual(normalized.tensors.length, 2);
  assert.strictEqual(normalized.tensors[0].role, "kernel");
  assert.strictEqual(normalized.tensors[1].role, "bias");
  assert.deepStrictEqual(normalized.weightSpecs[0].shape, [4, 8]);
  assert.strictEqual(normalized.weightValues.length, 40);

  const nested = checkpointFormat.normalizeArtifacts({ modelArtifacts: normalized }, { producerRuntime: "python_server" });
  assert.strictEqual(nested.weightValues.length, 40);
  assert.strictEqual(nested.checkpoint.schemaVersion, "osc-checkpoint-v1");
  assert.strictEqual(nested.checkpoint.producerRuntime, "python_server");

  console.log("PASS test_checkpoint_format_core");
}

run();

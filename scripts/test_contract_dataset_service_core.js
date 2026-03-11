#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");

const svc = require(path.join(__dirname, "..", "src", "dataset_service_core.js"));

async function main() {
  assert.ok(svc && typeof svc.createService === "function", "createService missing");

  const service = svc.createService({
    handlers: {
      echo: function (payload) {
        return { ok: true, payload: payload };
      },
      sum: function (payload) {
        const values = Array.isArray(payload && payload.values) ? payload.values : [];
        return values.reduce(function (acc, v) {
          return acc + Number(v || 0);
        }, 0);
      },
    },
  });

  const echo = await service.execute({
    action: "echo",
    payload: { a: 1, b: "x" },
  });
  assert.deepStrictEqual(echo, { ok: true, payload: { a: 1, b: "x" } });

  const sum = await service.execute({
    action: "sum",
    payload: { values: [1, 2, 3, 4] },
  });
  assert.strictEqual(sum, 10);

  let threw = false;
  try {
    await service.execute({ action: "missing" });
  } catch (err) {
    threw = /not registered/i.test(String(err && err.message || ""));
  }
  assert.ok(threw, "missing action should fail");

  console.log("PASS test_contract_dataset_service_core");
}

main().catch((err) => {
  console.error("FAIL test_contract_dataset_service_core");
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

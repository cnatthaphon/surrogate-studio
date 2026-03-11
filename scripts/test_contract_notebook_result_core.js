#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");

const core = require(path.join(__dirname, "..", "src", "notebook_result_core.js"));

function main() {
  const html = [
    "<div><table class='dataframe'>",
    "<thead><tr><th></th><th>session_id</th><th>test_accuracy</th></tr></thead>",
    "<tbody><tr><th>0</th><td>session_1</td><td>0.75</td></tr></tbody>",
    "</table></div>",
  ].join("");
  const rows = core.parseHtmlTable(html);
  assert.ok(Array.isArray(rows) && rows.length === 1, "Expected one parsed row.");
  assert.strictEqual(rows[0].session_id, "session_1");
  assert.strictEqual(rows[0].test_accuracy, "0.75");
  console.log("PASS test_contract_notebook_result_core");
}

main();

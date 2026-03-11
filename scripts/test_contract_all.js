#!/usr/bin/env node
"use strict";

const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname);
const baseSuite = [
  "test_contract_schema_registry.js",
  "test_contract_schema_declarative_defs.js",
  "test_contract_model_graph_core.js",
  "test_contract_model_graph_drawflow_adapter.js",
  "test_contract_graph_ui_core.js",
  "test_contract_dataset_processing_core.js",
  "test_contract_entity_create_core.js",
  "test_contract_ui_shared_engine.js",
  "test_contract_item_panel_module.js",
  "test_contract_config_panel_module.js",
  "test_contract_image_render_core.js",
  "test_contract_notebook_result_core.js",
  "test_contract_tab_manager_core.js",
  "test_contract_workspace_tab_effects_core.js",
  "test_contract_workspace_controllers_core.js",
  "test_contract_workspace_lab_handlers_core.js",
  "test_contract_dataset_modules.js",
  "test_contract_dataset_runtime.js",
  "test_contract_dataset_service_core.js",
  "test_contract_workspace_store.js",
  "test_contract_dataset_bundle_adapter.js",
  "test_contract_training_worker_bridge.js",
  "test_contract_training_session_core.js",
  "test_contract_trainer_session_state_core.js",
  "test_contract_headless_api_flow.js",
  "test_contract_headless_memory_store_flow.js",
];

function runOne(scriptName) {
  const scriptPath = path.join(ROOT, scriptName);
  const result = cp.spawnSync(process.execPath, [scriptPath], {
    stdio: "inherit",
    env: process.env,
  });
  return Number(result.status || 0) === 0;
}

function main() {
  const suite = baseSuite.slice();
  let failed = 0;
  suite.forEach((script) => {
    process.stdout.write("\n[RUN] " + script + "\n");
    if (!runOne(script)) failed += 1;
  });
  if (failed > 0) {
    console.error("\nFAIL test_contract_all: " + failed + " script(s) failed.");
    process.exit(1);
  }
  console.log("\nPASS test_contract_all (" + suite.length + " scripts)");
}

main();

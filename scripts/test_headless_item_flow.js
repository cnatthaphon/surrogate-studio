"use strict";
/**
 * Headless test: create items, generate dataset, save model, create trainer
 * Uses the SAME modules as browser — no DOM, no UI, just store + modules.
 */
var assert = require("assert");

var sr = require("../src/schema_registry.js");
require("../src/schema_definitions_builtin.js");
var dm = require("../src/dataset_modules.js");
require("../src/dataset_modules/oscillator_module.js");
require("../src/dataset_modules/mnist_source_loader.js");
require("../src/dataset_modules/mnist_module.js");
require("../src/dataset_modules/fashion_mnist_module.js");
var WS = require("../src/workspace_store.js");

function main() {
  var store = WS.createMemoryStore();

  // === 1. List schemas ===
  var schemas = sr.listSchemas();
  assert(schemas.length >= 3, "at least 3 schemas registered");
  console.log("Schemas:", schemas.map(function (s) { return s.id; }));

  // === 2. Create datasets for each schema ===
  ["oscillator", "mnist", "fashion_mnist"].forEach(function (schemaId) {
    var id = "ds_" + schemaId + "_" + Date.now();
    store.upsertDataset({ id: id, name: "test_" + schemaId, schemaId: schemaId, status: "draft", createdAt: Date.now() });
    var saved = store.getDataset(id);
    assert(saved, "dataset saved: " + id);
    assert.strictEqual(saved.name, "test_" + schemaId);
    assert.strictEqual(saved.schemaId, schemaId);
    console.log("Created dataset:", saved.name, "id:", saved.id);
  });

  // === 3. List datasets filtered by schema ===
  var oscDatasets = store.listDatasets({ schemaId: "oscillator" });
  assert.strictEqual(oscDatasets.length, 1, "1 oscillator dataset");
  var mnistDatasets = store.listDatasets({ schemaId: "mnist" });
  assert.strictEqual(mnistDatasets.length, 1, "1 mnist dataset");

  // === 4. Generate oscillator dataset via module ===
  var oscMod = dm.getModule("oscillator");
  assert(oscMod, "oscillator module found");
  assert(typeof oscMod.build === "function", "oscillator has build");

  // use getDatasetBuildConfig if available
  var formConfig = {
    seed: "42", numTraj: "30", durationSec: "4", dt: "0.02", globalG: "9.81",
    splitMode: "stratified_scenario", trainFrac: "0.7", valFrac: "0.15", testFrac: "0.15",
    cardDsSpring: true, spMRng: "0.5,2.0", spCRng: "0.05,0.8", spKRng: "1.0,8.0", spX0Rng: "-1.5,1.5", spV0Rng: "-1.0,1.0",
    cardDsPendulum: true, pdMRng: "0.5,2.0", pdCRng: "0.01,0.5", pdKRng: "0.5,2.0", pdX0Rng: "-1.2,1.2", pdV0Rng: "-1.0,1.0",
    cardDsBouncing: true, bbGroundModel: "rigid", bbGroundK: "2500", bbGroundC: "90", bbMRng: "0.3,3.0", bbCRng: "0.0,0.25", bbERng: "0.55,0.9", bbX0Rng: "0.0,0.0", bbV0Rng: "0.8,6.0",
  };
  var buildConfig;
  if (oscMod.uiApi && typeof oscMod.uiApi.getDatasetBuildConfig === "function") {
    buildConfig = oscMod.uiApi.getDatasetBuildConfig({ formConfig: formConfig });
    buildConfig.schemaId = "oscillator";
    buildConfig.moduleId = "oscillator";
  } else {
    buildConfig = Object.assign({ schemaId: "oscillator", moduleId: "oscillator" }, formConfig);
  }
  var oscResult = oscMod.build(buildConfig);
  assert(oscResult, "oscillator build returned result");
  // oscillator returns bundle: { kind: "dataset_bundle", datasets: { autoregressive: {...}, direct: {...} } }
  var isBundle = oscResult.kind === "dataset_bundle" && oscResult.datasets;
  var activeDs = isBundle ? oscResult.datasets[oscResult.activeVariantId || "autoregressive"] : oscResult;
  assert(activeDs && (activeDs.xTrain || activeDs.records), "has training data");
  console.log("Oscillator dataset generated:",
    "bundle:", isBundle,
    "xTrain:", (activeDs.xTrain || []).length,
    "featureSize:", activeDs.featureSize || "?");

  // save to store
  var oscDsId = oscDatasets[0].id;
  store.upsertDataset(Object.assign({}, store.getDataset(oscDsId), { data: oscResult, status: "ready" }));
  assert.strictEqual(store.getDataset(oscDsId).status, "ready");

  // === 5. Create models ===
  var modelId = "m_test_" + Date.now();
  store.upsertModel({ id: modelId, name: "test_model", schemaId: "oscillator", status: "draft", createdAt: Date.now() });
  var savedModel = store.getModel(modelId);
  assert(savedModel, "model saved");
  assert.strictEqual(savedModel.schemaId, "oscillator");
  console.log("Created model:", savedModel.name);

  // === 6. Create trainer ===
  var trainerId = "t_test_" + Date.now();
  store.upsertTrainerCard({
    id: trainerId, name: "test_trainer", schemaId: "oscillator",
    datasetId: oscDsId, modelId: modelId, status: "draft", createdAt: Date.now(),
  });
  var savedTrainer = store.getTrainerCard(trainerId);
  assert(savedTrainer, "trainer saved");
  assert.strictEqual(savedTrainer.datasetId, oscDsId);
  assert.strictEqual(savedTrainer.modelId, modelId);
  assert.strictEqual(savedTrainer.schemaId, "oscillator");
  console.log("Created trainer:", savedTrainer.name, "dataset:", savedTrainer.datasetId, "model:", savedTrainer.modelId);

  // === 7. Verify schema binding ===
  var ds = store.getDataset(oscDsId);
  var mdl = store.getModel(modelId);
  var trn = store.getTrainerCard(trainerId);
  assert.strictEqual(ds.schemaId, mdl.schemaId, "dataset and model same schema");
  assert.strictEqual(mdl.schemaId, trn.schemaId, "model and trainer same schema");

  // === 8. Rename + Delete ===
  ds.name = "renamed_dataset";
  store.upsertDataset(ds);
  assert.strictEqual(store.getDataset(oscDsId).name, "renamed_dataset", "rename works");

  store.removeTrainerCard(trainerId);
  assert.strictEqual(store.getTrainerCard(trainerId), null, "trainer deleted");

  store.removeModel(modelId);
  assert.strictEqual(store.getModel(modelId), null, "model deleted");

  store.removeDataset(oscDsId);
  assert.strictEqual(store.getDataset(oscDsId), null, "dataset deleted");

  // === 9. MNIST async build ===
  var mnistMod = dm.getModule("mnist");
  assert(mnistMod && typeof mnistMod.build === "function", "mnist has build");
  console.log("\nMNIST async build (synthetic)...");
  return mnistMod.build({ seed: 42, totalCount: 30, sourceMode: "synthetic", variant: "mnist" }).then(function (res) {
    assert(res, "mnist build result");
    assert(res.classCount === 10 || res.classNames, "has class info");
    console.log("MNIST result: classes:", res.classCount, "train:", res.trainCount || "?");

    console.log("\nPASS test_headless_item_flow");
  });
}

main().catch(function (err) {
  console.error("FAIL:", err.message || err);
  process.exit(1);
});

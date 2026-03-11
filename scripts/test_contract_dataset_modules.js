#!/usr/bin/env node
"use strict";

const assert = require("assert");
const datasetModules = require("../src/dataset_modules.js");

function makeMockSourceRecords(count) {
  const n = Math.max(40, Number(count) || 200);
  const x = new Array(n);
  const y = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const row = new Array(28 * 28);
    const label = i % 10;
    for (let j = 0; j < row.length; j += 1) {
      row[j] = ((j + label * 7) % 255) / 255;
    }
    x[i] = row;
    y[i] = label;
  }
  return { x, y };
}

async function main() {
  assert(datasetModules, "dataset modules registry is required");
  assert.strictEqual(typeof datasetModules.listModules, "function", "listModules missing");
  assert.strictEqual(typeof datasetModules.getModule, "function", "getModule missing");

  const list = datasetModules.listModules();
  const ids = list.map((x) => String((x && x.id) || ""));
  assert(ids.includes("oscillator"), "oscillator module must exist");
  assert(ids.includes("mnist"), "mnist module must exist");
  assert(ids.includes("fashion_mnist"), "fashion_mnist module must exist");

  const mnist = datasetModules.getModule("mnist");
  assert(mnist && typeof mnist.build === "function", "mnist build() missing");
  assert(mnist.uiApi && typeof mnist.uiApi.getDatasetConfigSpec === "function", "mnist uiApi.getDatasetConfigSpec missing");
  assert(mnist.uiApi && typeof mnist.uiApi.handleDatasetConfigChange === "function", "mnist uiApi.handleDatasetConfigChange missing");
  assert(mnist.uiApi && typeof mnist.uiApi.handleDatasetAction === "function", "mnist uiApi.handleDatasetAction missing");
  assert(mnist.uiApi && typeof mnist.uiApi.getDatasetBuildConfig === "function", "mnist uiApi.getDatasetBuildConfig missing");
  assert(mnist.uiApi && typeof mnist.uiApi.getPlaygroundConfigSpec === "function", "mnist uiApi.getPlaygroundConfigSpec missing");
  assert(mnist.uiApi && typeof mnist.uiApi.handlePlaygroundConfigChange === "function", "mnist uiApi.handlePlaygroundConfigChange missing");
  assert(mnist.uiApi && typeof mnist.uiApi.handlePlaygroundAction === "function", "mnist uiApi.handlePlaygroundAction missing");
  assert(mnist.uiApi && typeof mnist.uiApi.getPlaygroundPreviewModel === "function", "mnist uiApi.getPlaygroundPreviewModel missing");
  assert(mnist.preconfig && mnist.preconfig.dataset, "mnist preconfig.dataset missing");
  assert(Number(mnist.preconfig.dataset.totalCount) > 0, "mnist preconfig totalCount invalid");
  const mnistDs = await mnist.build({
    seed: 7,
    totalCount: 120,
    splitMode: "random",
    sourceRecords: makeMockSourceRecords(300),
  });
  assert.strictEqual(String(mnistDs.schemaId), "mnist", "mnist dataset schema mismatch");
  assert(mnistDs.records && mnistDs.records.train, "mnist records.train missing");
  assert(Array.isArray(mnistDs.records.train.x), "mnist records.train.x must be array");
  assert(Array.isArray(mnistDs.records.train.y), "mnist records.train.y must be array");
  assert(Number.isFinite(Number(mnistDs.trainCount)) && Number(mnistDs.trainCount) > 0, "mnist trainCount missing");
  assert(Number.isFinite(Number(mnistDs.valCount)) && Number(mnistDs.valCount) > 0, "mnist valCount missing");
  assert(Number.isFinite(Number(mnistDs.testCount)) && Number(mnistDs.testCount) > 0, "mnist testCount missing");
  assert(mnistDs.splitCounts && Number(mnistDs.splitCounts.train) === Number(mnistDs.trainCount), "mnist splitCounts.train mismatch");

  const fashion = datasetModules.getModule("fashion_mnist");
  assert(fashion && typeof fashion.build === "function", "fashion_mnist build() missing");
  assert(fashion.uiApi && typeof fashion.uiApi.getDatasetConfigSpec === "function", "fashion_mnist uiApi.getDatasetConfigSpec missing");
  assert(fashion.uiApi && typeof fashion.uiApi.handleDatasetConfigChange === "function", "fashion_mnist uiApi.handleDatasetConfigChange missing");
  assert(fashion.uiApi && typeof fashion.uiApi.handleDatasetAction === "function", "fashion_mnist uiApi.handleDatasetAction missing");
  assert(fashion.uiApi && typeof fashion.uiApi.getDatasetBuildConfig === "function", "fashion_mnist uiApi.getDatasetBuildConfig missing");
  assert(fashion.uiApi && typeof fashion.uiApi.getPlaygroundConfigSpec === "function", "fashion_mnist uiApi.getPlaygroundConfigSpec missing");
  assert(fashion.uiApi && typeof fashion.uiApi.handlePlaygroundConfigChange === "function", "fashion_mnist uiApi.handlePlaygroundConfigChange missing");
  assert(fashion.uiApi && typeof fashion.uiApi.handlePlaygroundAction === "function", "fashion_mnist uiApi.handlePlaygroundAction missing");
  assert(fashion.uiApi && typeof fashion.uiApi.getPlaygroundPreviewModel === "function", "fashion_mnist uiApi.getPlaygroundPreviewModel missing");
  assert(fashion.preconfig && fashion.preconfig.dataset, "fashion_mnist preconfig.dataset missing");
  assert(Number(fashion.preconfig.dataset.totalCount) > 0, "fashion_mnist preconfig totalCount invalid");
  assert(String((fashion.preconfig.dataset.splitDefaults && fashion.preconfig.dataset.splitDefaults.mode) || "") === "stratified_label", "fashion_mnist default split mode mismatch");
  const fashionDs = await fashion.build({
    seed: 11,
    totalCount: 90,
    sourceRecords: makeMockSourceRecords(240),
  });
  assert.strictEqual(String(fashionDs.schemaId), "fashion_mnist", "fashion dataset schema mismatch");
  assert(Array.isArray(fashionDs.classNames) && fashionDs.classNames.length === 10, "fashion class names invalid");

  const moduleConfigState = { dataset: Object.create(null), playground: Object.create(null) };
  const previewCtx = {
    getModuleConfigState(scope, defaults, moduleId) {
      const bucket = moduleConfigState[String(scope || "").trim().toLowerCase()];
      const id = String(moduleId || "").trim().toLowerCase();
      if (!bucket[id]) bucket[id] = JSON.parse(JSON.stringify(defaults || {}));
      return JSON.parse(JSON.stringify(bucket[id]));
    },
    setModuleConfigState(scope, nextValue, moduleId) {
      const bucket = moduleConfigState[String(scope || "").trim().toLowerCase()];
      const id = String(moduleId || "").trim().toLowerCase();
      bucket[id] = JSON.parse(JSON.stringify(nextValue || {}));
      return JSON.parse(JSON.stringify(bucket[id]));
    },
    patchModuleConfigState(scope, patch, moduleId) {
      const bucket = moduleConfigState[String(scope || "").trim().toLowerCase()];
      const id = String(moduleId || "").trim().toLowerCase();
      bucket[id] = Object.assign({}, bucket[id] || {}, JSON.parse(JSON.stringify(patch || {})));
      return JSON.parse(JSON.stringify(bucket[id]));
    },
    getPlaygroundSource(schemaId) {
      const classNames = String(schemaId) === "fashion_mnist" ? fashionDs.classNames : mnistDs.classNames;
      const train = String(schemaId) === "fashion_mnist" ? fashionDs.records.train : mnistDs.records.train;
      const x = train.x;
      const y = train.y;
      const pixels = new Uint8Array(x.length * 28 * 28);
      for (let i = 0; i < x.length; i += 1) {
        const row = x[i];
        const base = i * 28 * 28;
        for (let j = 0; j < row.length; j += 1) {
          pixels[base + j] = Math.max(0, Math.min(255, Math.round(Number(row[j]) * 255)));
        }
      }
      return {
        schemaId: String(schemaId),
        source: "test_source",
        numExamples: x.length,
        classNames: classNames,
        pixelsUint8: pixels,
        labelsUint8: Uint8Array.from(y),
        loadedAt: 12345,
      };
    },
    getSchemaSplitModeDefs() {
      return [{ id: "random", label: "Random" }, { id: "stratified_label", label: "Stratified by label" }];
    },
    refreshDatasetConfigPanel() { return true; },
    refreshPlaygroundWorkspace() { return true; },
    triggerDatasetBuild() { return true; },
  };
  const mnistPreviewSpec = mnist.uiApi.getPlaygroundConfigSpec(previewCtx);
  assert(Array.isArray(mnistPreviewSpec.sections) && mnistPreviewSpec.sections.length > 0, "mnist playground config spec invalid");
  const mnistPreviewModel = await mnist.uiApi.getPlaygroundPreviewModel(previewCtx);
  assert.strictEqual(String(mnistPreviewModel.kind), "image_class_grid", "mnist playground preview kind mismatch");
  assert(Array.isArray(mnistPreviewModel.samples) && mnistPreviewModel.samples.length > 0, "mnist playground samples missing");
  mnist.uiApi.handlePlaygroundAction({ actionId: "sample_random" }, previewCtx);
  const fashionPreviewModel = await fashion.uiApi.getPlaygroundPreviewModel(previewCtx);
  assert.strictEqual(String(fashionPreviewModel.kind), "image_class_grid", "fashion playground preview kind mismatch");
  assert(Array.isArray(fashionPreviewModel.samples) && fashionPreviewModel.samples.length > 0, "fashion playground samples missing");

  const oscillator = datasetModules.getModule("oscillator");
  assert(oscillator, "oscillator module lookup failed");
  assert(oscillator.preconfig && oscillator.preconfig.dataset, "oscillator preconfig.dataset missing");
  assert(Number(oscillator.preconfig.dataset.seed) === 42, "oscillator preconfig seed mismatch");
  assert(String((oscillator.preconfig.dataset.splitDefaults && oscillator.preconfig.dataset.splitDefaults.mode) || "") === "stratified_scenario", "oscillator default split mode mismatch");
  assert(oscillator.playgroundApi && typeof oscillator.playgroundApi.runAction === "function", "oscillator playgroundApi.runAction missing");
  assert(oscillator.playgroundApi && typeof oscillator.playgroundApi.buildQuickCompareInfoText === "function", "oscillator playgroundApi.buildQuickCompareInfoText missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.applyWorkspaceState === "function", "oscillator uiApi.applyWorkspaceState missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.bindUi === "function", "oscillator uiApi.bindUi missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.syncPreviewTimeControls === "function", "oscillator uiApi.syncPreviewTimeControls missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.getDatasetScenarioSelection === "function", "oscillator uiApi.getDatasetScenarioSelection missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.getPreviewParamsForScenario === "function", "oscillator uiApi.getPreviewParamsForScenario missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.getEvalCondition === "function", "oscillator uiApi.getEvalCondition missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.buildPlaygroundActionContext === "function", "oscillator uiApi.buildPlaygroundActionContext missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.resetScenarioCardDefaults === "function", "oscillator uiApi.resetScenarioCardDefaults missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.randomizePreviewCards === "function", "oscillator uiApi.randomizePreviewCards missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.getPlaygroundConfigSpec === "function", "oscillator uiApi.getPlaygroundConfigSpec missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.handlePlaygroundConfigChange === "function", "oscillator uiApi.handlePlaygroundConfigChange missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.handlePlaygroundAction === "function", "oscillator uiApi.handlePlaygroundAction missing");
  assert(oscillator.uiApi && typeof oscillator.uiApi.getDatasetBuildConfig === "function", "oscillator uiApi.getDatasetBuildConfig missing");
  const oscillatorConfigState = { dataset: Object.create(null), playground: Object.create(null) };
  const mockCtx = {
    presetLimits: {
      spring: { safe: { m: [0.5, 2.0], c: [0.05, 0.8], k: [1.0, 8.0], x0: [-1.5, 1.5], v0: [-1.0, 1.0] } },
      pendulum: { safe: { m: [0.5, 2.0], c: [0.01, 0.5], k: [0.5, 2.0], x0: [-1.2, 1.2], v0: [-1.0, 1.0] } },
      bouncing: { safe: { m: [0.3, 3.0], c: [0.0, 0.25], k: [9.81, 9.81], e: [0.55, 0.9], x0: [0.0, 0.0], v0: [0.8, 6.0] } },
    },
    getModuleConfigState(scope, defaults, moduleId) {
      const bucket = oscillatorConfigState[String(scope || "").trim().toLowerCase()];
      const id = String(moduleId || "oscillator").trim().toLowerCase();
      if (!bucket[id]) bucket[id] = JSON.parse(JSON.stringify(defaults || {}));
      return JSON.parse(JSON.stringify(bucket[id]));
    },
    setModuleConfigState(scope, nextValue, moduleId) {
      const bucket = oscillatorConfigState[String(scope || "").trim().toLowerCase()];
      const id = String(moduleId || "oscillator").trim().toLowerCase();
      bucket[id] = JSON.parse(JSON.stringify(nextValue || {}));
      return JSON.parse(JSON.stringify(bucket[id]));
    },
    patchModuleConfigState(scope, patch, moduleId) {
      const bucket = oscillatorConfigState[String(scope || "").trim().toLowerCase()];
      const id = String(moduleId || "oscillator").trim().toLowerCase();
      bucket[id] = Object.assign({}, bucket[id] || {}, JSON.parse(JSON.stringify(patch || {})));
      return JSON.parse(JSON.stringify(bucket[id]));
    },
    clamp: (v, lo, hi) => Math.min(Math.max(Number(v), Number(lo)), Number(hi)),
    randInRange: (range) => (Number(range[0]) + Number(range[1])) / 2,
    getStepsFromDuration: (durationSec, dt) => Math.max(2, Math.round(Number(durationSec) / Number(dt)) + 1),
    getRequestedDatasetMode() { return "autoregressive"; },
    getActiveWindowSize() { return 20; },
    inferFeatureSpecForMode(mode, fallback) { return Object.assign({}, fallback || {}); },
    inferTargetModeForGraph() { return "x"; },
    getSchemaSplitModeDefs() {
      return [{ id: "stratified_scenario", label: "Stratified by scenario" }, { id: "random", label: "Random" }];
    },
    state: { lastSweepSig: "" },
    setLastSweepSig(nextSig) { this.state.lastSweepSig = String(nextSig || ""); },
    simulateOscillator() { return { t: [0, 1], x: [0, 1] }; },
    plotTrajectories() { return true; },
    plotPreviewSplitByScenario() { return true; },
    setStatus() { return true; },
    schedulePreviewRefresh() { return true; },
    refreshPlaygroundConfigPanel() { return true; },
    refreshDatasetConfigPanel() { return true; },
    syncPreviewTimeControls() { return true; },
    setPreviewCompareLock() { return true; },
    runPreview() { return true; },
    runQuickCompare() { return true; },
    runParameterSweep() { return true; },
  };
  oscillator.uiApi.handleDatasetConfigChange(null, { key: "cardDsPendulum", value: false }, mockCtx);
  oscillator.uiApi.handleDatasetConfigChange(null, { key: "cardDsBouncing", value: true }, mockCtx);
  const selectedScenarios = oscillator.uiApi.getDatasetScenarioSelection(mockCtx);
  assert.deepStrictEqual(selectedScenarios, ["spring", "bouncing"], "oscillator dataset scenario selection mismatch");
  oscillator.uiApi.handlePlaygroundConfigChange(null, { key: "pgBouncing", value: true }, mockCtx);
  const evalCond = oscillator.uiApi.getEvalCondition(mockCtx, "spring");
  assert.strictEqual(String(evalCond.scenario), "spring", "oscillator eval condition scenario mismatch");
  assert(Number.isFinite(Number(evalCond.steps)) && Number(evalCond.steps) > 0, "oscillator eval condition steps invalid");
  const actionCtx = oscillator.uiApi.buildPlaygroundActionContext(mockCtx, "quick_compare");
  assert.deepStrictEqual(actionCtx.selectedScenarios, ["spring", "bouncing"], "oscillator playground action context scenarios mismatch");
  assert.strictEqual(String(actionCtx.quickCompareMode), "vary_m", "oscillator playground action mode mismatch");
  oscillator.uiApi.resetScenarioCardDefaults(mockCtx, "spring");
  const afterResetSpec = oscillator.uiApi.getPlaygroundConfigSpec(mockCtx);
  const springSection = afterResetSpec.sections.find((section) => String((section && section.id) || "") === "spring");
  assert(springSection, "oscillator spring section missing");
  assert.strictEqual(String(springSection.value.spM), "1.2", "oscillator spring reset failed");
  oscillator.uiApi.randomizePreviewCards(mockCtx);
  const afterRandomSpec = oscillator.uiApi.getPlaygroundConfigSpec(mockCtx);
  const springSectionAfterRandom = afterRandomSpec.sections.find((section) => String((section && section.id) || "") === "spring");
  assert(springSectionAfterRandom, "oscillator spring section missing after randomize");
  assert.strictEqual(String(springSectionAfterRandom.value.spM), "1.25", "oscillator randomize preview cards mismatch");
  const oscillatorBuildCfg = oscillator.uiApi.getDatasetBuildConfig(mockCtx);
  assert(oscillatorBuildCfg && oscillatorBuildCfg.variants, "oscillator dataset build config must declare variants");
  const oscillatorBundle = oscillator.build(oscillatorBuildCfg);
  assert.strictEqual(String(oscillatorBundle.kind), "dataset_bundle", "oscillator build must return dataset bundle");
  assert(oscillatorBundle.datasets && oscillatorBundle.datasets.autoregressive, "oscillator bundle autoregressive dataset missing");
  assert(oscillatorBundle.datasets && oscillatorBundle.datasets.direct, "oscillator bundle direct dataset missing");

  const custom = datasetModules.registerModule({
    id: "unit_test_custom",
    schemaId: "mnist",
    label: "unit test",
    kind: "panel_builder",
    playgroundApi: {
      runAction: function () { return true; },
    },
    uiApi: {
      applyWorkspaceState: function () { return true; },
      bindUi: function () { return true; },
    },
    build: function () { return { schemaId: "mnist", ok: true }; },
  }, { overwrite: true });
  assert(custom && custom.id === "unit_test_custom", "custom module register failed");
  const customLoaded = datasetModules.getModule("unit_test_custom");
  assert(customLoaded && typeof customLoaded.build === "function", "custom module lookup failed");
  assert(customLoaded && customLoaded.playgroundApi && typeof customLoaded.playgroundApi.runAction === "function", "custom playgroundApi lookup failed");
  assert(customLoaded && customLoaded.uiApi && typeof customLoaded.uiApi.applyWorkspaceState === "function", "custom uiApi lookup failed");
  assert(customLoaded && customLoaded.uiApi && typeof customLoaded.uiApi.bindUi === "function", "custom bindUi lookup failed");

  console.log("PASS test_contract_dataset_modules");
}

main().catch((err) => {
  console.error("FAIL test_contract_dataset_modules:", err && err.stack ? err.stack : err);
  process.exit(1);
});

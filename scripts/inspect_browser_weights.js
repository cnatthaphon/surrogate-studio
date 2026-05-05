// Inspect actual model weight names by loading the demo in headless Chrome.
"use strict";
var puppeteer = require("puppeteer");
async function main() {
  var browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox","--disable-dev-shm-usage"] });
  var page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on("console", function (m) {
    var t = m.text();
    if (t.indexOf("[INSPECT]") >= 0) console.log(t);
  });
  var demo = process.argv[2] || "Oscillator-Surrogate";
  var modelId = process.argv[3] || "demo-osc-vae";
  await page.goto("http://localhost:3777/demo/" + demo + "/index.html", { waitUntil: "networkidle2" });
  await new Promise(function (r) { setTimeout(r, 3000); });
  // Generate dataset first
  await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll("button"));
    var ds = btns.find(function (b) { return b.textContent.trim().toLowerCase().indexOf("dataset") >= 0; });
    if (ds) ds.click();
  });
  await new Promise(function (r) { setTimeout(r, 1500); });
  await page.evaluate(function () {
    var ws = document.querySelector(".osc-workspace.active") || document;
    var items = ws.querySelectorAll(".left-dataset-item");
    if (items.length) items[0].click();
  });
  await new Promise(function (r) { setTimeout(r, 800); });
  await page.evaluate(function () {
    var btns = Array.from(document.querySelectorAll("button"));
    var gen = btns.find(function (b) { return b.textContent.trim().toLowerCase() === "generate dataset"; });
    if (gen) gen.click();
  });
  await new Promise(function (r) { setTimeout(r, 5000); });
  await page.evaluate(function (mid) { window.__MODEL_ID = mid; }, modelId);
  var report = await page.evaluate(function () {
    var W = window;
    var keys = Object.keys(W).filter(function (k) { return /STORE|OSC|tf|model|preset|builder/i.test(k); });
    var modelBuilder = W.OSCModelBuilderCore || W.OSCModelBuilder || null;
    var tf = W.tf;
    var preset = W.OSCILLATOR_DEMO_PRESET || W.OSCILLATOR_PRESET || W.LSTM_VAE_DEMO_PRESET || W.TRAISFORMER_PRESET || null;
    // fallback: scan globals
    if (!preset) {
      Object.keys(W).forEach(function (k) {
        if (k.endsWith("_PRESET") && W[k] && W[k].models) preset = W[k];
      });
    }
    if (!modelBuilder) return { error: "no model builder", keys: keys, hasTf: !!tf, hasPreset: !!preset };
    if (!preset || !preset.models) return { error: "no preset", keys: keys };
    var modelId = window.__MODEL_ID || "demo-osc-vae";
    var vae = preset.models.find(function (m) { return m.id === modelId; });
    if (!vae) return { error: "no model with id " + modelId, available: preset.models.map(function (m) { return m.id; }), keys: keys };
    var schemaRegistry = W.OSCSchemaRegistry;
    var schemaId = vae.schemaId || "oscillator";
    var realOutputKeys = schemaRegistry ? schemaRegistry.getOutputKeys(schemaId) : null;
    // Inspect the generated dataset
    var s = W._store || null;
    var datasetReport = { hasStore: !!s, hasList: !!(s && s.list) };
    try {
      if (s && s.list) {
        var datasets = s.list({ table: "datasets" });
        datasetReport.numDatasets = datasets ? datasets.length : 0;
        if (datasets && datasets[0]) {
          var ds = datasets[0];
          datasetReport.dsId = ds.id;
          datasetReport.hasData = !!ds.data;
          if (ds.data) {
            var d = ds.data;
            datasetReport.featureSize = d.featureSize;
            datasetReport.metaFeatureSize = d.meta && d.meta.featureSize;
            datasetReport.xTrainShape = d.xTrain && d.xTrain[0] ? (Array.isArray(d.xTrain[0]) ? d.xTrain[0].length : "scalar") : null;
            datasetReport.dataKeys = Object.keys(d).slice(0, 20);
            if (d.meta) datasetReport.metaKeys = Object.keys(d.meta).slice(0, 20);
          }
        }
      }
    } catch (e) { datasetReport.error = e.message; }
    try {
      var built = modelBuilder.buildModelFromGraph(tf, vae.graph, {
        mode: "direct", featureSize: 43, windowSize: 1, seqFeatureSize: 43,
        allowedOutputKeys: realOutputKeys || [{ key: "xv", featureSize: 2, headType: "regression" }],
        defaultTarget: "xv", numClasses: 3,
      });
      return {
        ok: true,
        outputKeys: realOutputKeys,
        datasetReport: datasetReport,
        modelWeights: built.model.weights.map(function (w) { return { name: w.name, shape: w.shape }; }),
        headConfigs: built.headConfigs,
      };
    } catch (e) {
      return { error: "build failed: " + e.message, keys: keys };
    }
  });
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
main().catch(function (e) { console.error(e); process.exit(1); });

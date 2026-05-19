#!/usr/bin/env node
"use strict";
/**
 * Train models and export pretrained weight files for demos.
 *
 * Usage:
 *   node scripts/train_pretrained.js <demo-folder> [model-index]
 *
 * Example:
 *   node scripts/train_pretrained.js demo/Siamese-Shape-Verification
 *   node scripts/train_pretrained.js demo/Text-Sentiment-Transformer 0
 */

var fs = require("fs");
var path = require("path");

// Setup browser-like globals for preset loading
global.window = global;
global.document = {
  createElement: function () { return { onload: null, onerror: null, style: {} }; },
  // ais_module._resolveDataBase walks document.getElementsByTagName("script")
  // at module-load time; without this stub, safeRequire silently drops the
  // AIS dataset module and `getModuleForSchema("ais_trajectory")` returns 0
  // matches, making any TrAISformer retrain via this script silently
  // unbuildable. Empty NodeList-ish keeps _resolveDataBase on its default.
  getElementsByTagName: function () { return []; },
  head: { appendChild: function () {} },
};
global.OSCDatasetModules = { registerModule: function () {} };

var tf;
try {
  var loader = require("../src/tfjs_node_loader.js");
  tf = loader.loadTfjs();
} catch (e) {
  console.error("TF.js not available:", e.message);
  process.exit(1);
}

var sr = require("../src/schema_registry.js");
global.OSCSchemaRegistry = sr;
require("../src/schema_definitions_builtin.js");
var dm = require("../src/dataset_modules.js");
global.OSCDatasetModules = dm;
try {
  var _srcReg = require("../src/dataset_source_registry.js");
  global.OSCDatasetSourceRegistry = _srcReg;
} catch (_) {}
var MBC = require("../src/model_builder_core.js");
var TEC = require("../src/training_engine_core.js");
var WS = require("../src/workspace_store.js");

var demoDir = process.argv[2];
var modelIdx = process.argv[3] !== undefined ? Number(process.argv[3]) : -1;

if (!demoDir || !fs.existsSync(path.join(demoDir, "preset.js"))) {
  console.error("Usage: node scripts/train_pretrained.js <demo-folder> [model-index]");
  process.exit(1);
}

// Load demo-local schema + data + module files if present (e.g. LSTM-VAE, TrAISformer)
var demoJsFiles = fs.readdirSync(demoDir).filter(function (f) {
  return f.endsWith(".js") && f !== "preset.js" && !f.includes("pretrained");
}).sort(function (a, b) {
  // data files first, then schema, then module, then preset
  var order = function (n) { return n.includes("data") ? 0 : n.includes("schema") ? 1 : 2; };
  return order(a) - order(b);
});
demoJsFiles.forEach(function (f) {
  try {
    // Data files (var X = ...) need to run in global scope so modules can find them
    if (f.includes("data") && !f.includes("module") && !f.includes("schema")) {
      var vm = require("vm");
      var src = fs.readFileSync(path.resolve(demoDir, f), "utf8");
      vm.runInThisContext(src, { filename: f });
      return;
    }
    var exported = require(path.resolve(demoDir, f));
    // Register demo-local modules with the global dataset module registry
    if (exported && exported.id && exported.build && typeof dm.registerModule === "function") {
      dm.registerModule(exported);
    }
  } catch (e) { console.warn("  [load] " + f + ": " + e.message); }
});

// Load preset
require(path.resolve(demoDir, "preset.js"));
var presetKey = Object.keys(global).find(function (k) { return k.endsWith("_PRESET"); });
if (!presetKey) { console.error("No preset found"); process.exit(1); }
var preset = global[presetKey];
console.log("Preset:", presetKey, "models:", preset.models.length, "trainers:", preset.trainers.length);

var schemaId = (preset.dataset && preset.dataset.schemaId) ||
  (preset.datasets && preset.datasets[0] && preset.datasets[0].schemaId) ||
  (preset.models && preset.models[0] && preset.models[0].schemaId) || "";
console.log("Schema:", schemaId);

// Build dataset
var modList = dm.getModuleForSchema(schemaId);
if (!modList || !modList.length) { console.error("No module for schema:", schemaId); process.exit(1); }
var mod = dm.getModule(modList[0].id);

function oneHot(label, n) { var arr = new Array(n).fill(0); arr[label] = 1; return arr; }

async function buildDataset() {
  // Derive build config from preset.dataset — let module use its own defaults
  var pds = preset.dataset || preset.datasets && preset.datasets[0] || {};
  var cfg = {
    seed: pds.seed || 42,
    schemaId: schemaId,
    moduleId: pds.datasetModuleId || mod.id,
    sourceMode: "synthetic",
  };
  // Pass totalCount only if preset specifies it; otherwise let module default
  if (pds.totalCount || pds.sourceTotalExamples) {
    cfg.totalCount = pds.totalCount || pds.sourceTotalExamples;
  }
  // Pass split config if preset has it
  if (pds.splitConfig) {
    cfg.trainFrac = pds.splitConfig.train;
    cfg.valFrac = pds.splitConfig.val;
    cfg.testFrac = pds.splitConfig.test;
  }
  console.log("Build config:", JSON.stringify(cfg));
  var result = await mod.build(cfg);
  if (!result) throw new Error("build returned null");

  // flat array format (oscillator, synthetic, custom_csv)
  if (result.xTrain && result.xTrain.length) {
    // one-hot encode scalar labels for classification
    if (result.targetMode === "label" && typeof result.yTrain[0] === "number") {
      var nc = result.classCount || result.numClasses || 2;
      result.yTrain = result.yTrain.map(function (l) { return oneHot(l, nc); });
      result.yVal = result.yVal.map(function (l) { return oneHot(l, nc); });
      result.yTest = result.yTest.map(function (l) { return oneHot(l, nc); });
      result.targetMode = "logits";
    }
    return result;
  }

  // records format (image classification: MNIST, Fashion-MNIST, CIFAR)
  if (result.records) {
    var train = result.records.train || {};
    var val = result.records.val || {};
    var test = result.records.test || {};
    var nc2 = result.classCount || result.numClasses || 10;
    result.xTrain = train.x || []; result.yTrain = (train.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc2) : l; });
    result.xVal = val.x || []; result.yVal = (val.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc2) : l; });
    result.xTest = test.x || []; result.yTest = (test.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc2) : l; });
    result.featureSize = result.featureSize || (result.xTrain[0] && result.xTrain[0].length) || 784;
    result.targetMode = "logits";
    result.labelsTrain = result.yTrain;
    result.labelsVal = result.yVal;
    result.labelsTest = result.yTest;
    if (result.xTrain.length) return result;
  }

  // zero-copy format with splitIndices (MNIST-like, ant trajectory)
  if (result.splitIndices) {
    // Resolve through source registry if available
    var _srcReg = global.OSCDatasetSourceRegistry || null;
    if (_srcReg && typeof _srcReg.resolveDatasetSplit === "function") {
      var tr = _srcReg.resolveDatasetSplit(result, "train");
      var va = _srcReg.resolveDatasetSplit(result, "val");
      var te = _srcReg.resolveDatasetSplit(result, "test");
      if (tr.x && tr.x.length) {
        var nc3 = result.classCount || 10;
        result.xTrain = tr.x; result.yTrain = (tr.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc3) : l; });
        result.xVal = va.x || []; result.yVal = (va.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc3) : l; });
        result.xTest = te.x || []; result.yTest = (te.y || []).map(function (l) { return typeof l === "number" ? oneHot(l, nc3) : l; });
        result.featureSize = result.featureSize || (result.xTrain[0] && result.xTrain[0].length) || 1;
        result.targetMode = "logits";
        result.labelsTrain = result.yTrain;
        result.labelsVal = result.yVal;
        result.labelsTest = result.yTest;
        if (result.xTrain.length) return result;
      }
    }
    // For modules that provide raw data arrays (ant trajectory etc.)
    // The module should populate xTrain/yTrain via its own resolution
    console.log("  splitIndices format without source registry — trying direct resolution...");
  }

  // bundle format (oscillator buildDatasetBundle)
  if (result.kind === "dataset_bundle" && result.datasets) {
    var activeKey = result.activeVariantId || Object.keys(result.datasets)[0];
    var active = result.datasets[activeKey];
    if (active && active.xTrain && active.xTrain.length) {
      active.featureSize = active.featureSize || (active.xTrain[0] && active.xTrain[0].length) || 1;
      return active;
    }
  }

  console.log("  Dataset keys:", Object.keys(result).join(", "));
  throw new Error("Unsupported build result format — no xTrain, records, or splitIndices found");
}

function slugify(name) {
  var s = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  // Ensure valid JS identifier (no leading digit)
  if (/^[0-9]/.test(s)) s = "m" + s;
  return s;
}

function exportPretrained(trainerName, config, metrics, epochs, model, outputPath) {
  // Extract weight specs and values
  var specs = [];
  var allValues = [];
  model.weights.forEach(function (w) {
    var data = w.read().dataSync();
    specs.push({ name: w.name, shape: w.shape.slice(), dtype: "float32" });
    for (var i = 0; i < data.length; i++) allValues.push(data[i]);
  });

  var meta = {
    name: trainerName,
    status: "done",
    config: config,
    metrics: metrics,
    backend: "tfjs",
    weightSpecs: specs,
    epochs: epochs,
  };

  var metaJson = JSON.stringify(meta);
  var metaBytes = Buffer.from(metaJson, "utf8");
  var weightBuf = Buffer.from(new Float32Array(allValues).buffer);
  var lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(metaBytes.length, 0);

  var fullBuf = Buffer.concat([lenBuf, metaBytes, weightBuf]);
  var b64 = fullBuf.toString("base64");

  var varName = slugify(trainerName).toUpperCase() + "_PRETRAINED_BIN_B64";
  var js = "// Pre-trained " + trainerName + " (TF.js CPU)\nwindow." + varName + " = \"" + b64 + "\";\n";
  fs.writeFileSync(outputPath, js);
  console.log("  Exported:", outputPath, "(" + (fullBuf.length / 1024).toFixed(0) + " KB,", specs.length, "weight arrays)");
  return varName;
}

async function trainModel(modelDef, dataset, trainerDef) {
  var graph = modelDef.graph;
  if (!graph) { console.log("  SKIP (no graph)"); return null; }

  var outputKeys = sr.getOutputKeys(schemaId).map(function (k) {
    return (k && typeof k === "object") ? k.key : k;
  });
  var defaultTarget = outputKeys[0] || "x";
  var featureSize = dataset.featureSize || (dataset.xTrain[0] && dataset.xTrain[0].length) || 1;
  var targetSize = dataset.targetSize ||
    (dataset.yTrain[0] ? (Array.isArray(dataset.yTrain[0]) ? dataset.yTrain[0].length : 1) : 1);

  var buildResult = MBC.buildModelFromGraph(tf, graph, {
    mode: "direct",
    featureSize: featureSize,
    windowSize: 1,
    seqFeatureSize: featureSize,
    allowedOutputKeys: outputKeys,
    defaultTarget: defaultTarget,
    numClasses: dataset.numClasses || dataset.classCount || 10,
    targetSize: targetSize,
  });

  if (!buildResult.model) { console.log("  SKIP (model build failed)"); return null; }
  console.log("  Model:", buildResult.model.countParams(), "params");

  // yTrain = xTrain (pixels) for reconstruction heads, real labels for others.
  // The training engine reads headType from the graph and routes accordingly:
  // reconstruction → uses yTrain (pixels), classification → uses labelsTrain.

  var tc = trainerDef.trainCfg || trainerDef.config || {};
  var epochs = [];
  var trainResult = await TEC.trainModel(tf, {
    model: buildResult.model,
    isSequence: false,
    headConfigs: buildResult.headConfigs,
    dataset: {
      xTrain: dataset.xTrain, yTrain: dataset.yTrain,
      xVal: dataset.xVal, yVal: dataset.yVal,
      xTest: dataset.xTest, yTest: dataset.yTest,
      labelsTrain: dataset.labelsTrain || dataset.yTrain,
      labelsVal: dataset.labelsVal || dataset.yVal,
      labelsTest: dataset.labelsTest || dataset.yTest,
      targetMode: dataset.targetMode || defaultTarget,
      numClasses: dataset.numClasses || dataset.classCount,
      paramNames: dataset.paramNames, paramSize: dataset.paramSize,
    },
    epochs: tc.epochs || 30,
    batchSize: tc.batchSize || 32,
    learningRate: tc.learningRate || 0.001,
    optimizerType: tc.optimizerType || tc.optimizer || "adam",
    lrSchedulerType: tc.lrSchedulerType || "none",
    earlyStoppingPatience: tc.earlyStoppingPatience || 10,
    restoreBestWeights: tc.restoreBestWeights !== false,
    onEpochEnd: function (epoch, logs) {
      epochs.push({ epoch: epoch + 1, loss: logs.loss, val_loss: logs.val_loss });
      if ((epoch + 1) % 5 === 0 || epoch === 0) {
        console.log("    epoch " + (epoch + 1) + " loss=" + logs.loss.toFixed(4) + " val=" + logs.val_loss.toFixed(4));
      }
    },
  });

  return { model: buildResult.model, trainResult: trainResult, epochs: epochs };
}

async function main() {
  console.log("\nBuilding dataset...");
  var dataset = await buildDataset();
  console.log("Dataset: train=" + dataset.xTrain.length + " val=" + dataset.xVal.length + " test=" + dataset.yTest.length);
  console.log("Features:", dataset.featureSize || dataset.xTrain[0].length, "targetMode:", dataset.targetMode);

  var models = preset.models || [];
  var trainers = preset.trainers || [];

  // Match trainers to models
  for (var mi = 0; mi < models.length; mi++) {
    if (modelIdx >= 0 && mi !== modelIdx) continue;

    var modelDef = models[mi];
    console.log("\n=== Model " + mi + ": " + modelDef.name + " ===");

    // Find matching trainer (non-pretrained)
    var trainer = trainers.find(function (t) {
      return t.modelId === modelDef.id && !t._pretrainedVar;
    }) || trainers.find(function (t) {
      return t.modelId === modelDef.id;
    });

    if (!trainer) {
      console.log("  No trainer found for model:", modelDef.id);
      continue;
    }

    var result = await trainModel(modelDef, dataset, trainer);
    if (!result) continue;

    var trainerName = modelDef.name + " (pre-trained)";
    var slug = slugify(modelDef.name);
    var outPath = path.join(demoDir, slug + "_pretrained.js");

    var metrics = {
      bestEpoch: result.trainResult.bestEpoch,
      bestValLoss: result.trainResult.bestValLoss,
    };
    if (result.trainResult.accuracy !== undefined) metrics.testAccuracy = result.trainResult.accuracy;
    if (result.trainResult.mae !== undefined) metrics.mae = result.trainResult.mae;
    if (result.trainResult.testMae !== undefined) metrics.testMae = result.trainResult.testMae;
    if (result.trainResult.testAccuracy !== undefined) metrics.testAccuracy = result.trainResult.testAccuracy;

    var rc = trainer.trainCfg || trainer.config || {};
    var resolvedConfig = {
      epochs: rc.epochs || 30,
      batchSize: rc.batchSize || 32,
      learningRate: rc.learningRate || 0.001,
      optimizerType: rc.optimizerType || rc.optimizer || "adam",
    };
    var varName = exportPretrained(trainerName, resolvedConfig, metrics, result.epochs, result.model, outPath);

    console.log("  Variable:", varName);
    console.log("  Use in preset: { ..., _pretrainedVar: '" + varName + "', status: 'done' }");

    result.model.dispose();
  }

  console.log("\nDone.");
}

main().catch(function (e) {
  console.error("FAIL:", e.message);
  console.error(e.stack);
  process.exit(1);
});

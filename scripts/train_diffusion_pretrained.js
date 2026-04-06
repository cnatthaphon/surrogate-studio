/**
 * Train all 4 diffusion models and export pretrained weight files.
 * Uses TF.js client training (no server needed).
 *
 * Run: node scripts/train_diffusion_pretrained.js
 */
"use strict";
global.window = global;

var tf = require("@tensorflow/tfjs");
var mb = require("../src/model_builder_core.js");
var te = require("../src/training_engine_core.js");
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

eval(fs.readFileSync("demo/Fashion-MNIST-Diffusion/preset.js", "utf8"));
var preset = window.FASHION_MNIST_DIFFUSION_PRESET;

var DEMO_DIR = path.resolve(__dirname, "../demo/Fashion-MNIST-Diffusion");
var DATA_DIR = path.resolve(__dirname, "../data/fashion-mnist");
var EPOCHS = 30;
var BATCH = 64;
var LR = 0.001;
var CLASS_FILTER = 0; // T-shirt/top only (matching preset classFilter)

// Parse IDX format (Fashion-MNIST binary)
function parseIdxImages(buf) {
  var magic = buf.readUInt32BE(0);
  var count = buf.readUInt32BE(4);
  var rows = buf.readUInt32BE(8);
  var cols = buf.readUInt32BE(12);
  var pixelsPerImage = rows * cols;
  var images = [];
  for (var i = 0; i < count; i++) {
    var offset = 16 + i * pixelsPerImage;
    var row = new Array(pixelsPerImage);
    for (var j = 0; j < pixelsPerImage; j++) row[j] = buf[offset + j] / 255.0;
    images.push(row);
  }
  return images;
}
function parseIdxLabels(buf) {
  var count = buf.readUInt32BE(4);
  var labels = new Array(count);
  for (var i = 0; i < count; i++) labels[i] = buf[8 + i];
  return labels;
}

// Load real Fashion-MNIST data
console.log("Loading Fashion-MNIST from " + DATA_DIR + "...");
var trainImages = parseIdxImages(zlib.gunzipSync(fs.readFileSync(path.join(DATA_DIR, "train-images-idx3-ubyte.gz"))));
var trainLabels = parseIdxLabels(zlib.gunzipSync(fs.readFileSync(path.join(DATA_DIR, "train-labels-idx1-ubyte.gz"))));
var testImages = parseIdxImages(zlib.gunzipSync(fs.readFileSync(path.join(DATA_DIR, "t10k-images-idx3-ubyte.gz"))));
var testLabels = parseIdxLabels(zlib.gunzipSync(fs.readFileSync(path.join(DATA_DIR, "t10k-labels-idx1-ubyte.gz"))));

// Filter to class 0 (T-shirt) only
var xTrain = [], yTrain = [], xVal = [], yVal = [];
for (var i = 0; i < trainImages.length; i++) {
  if (trainLabels[i] === CLASS_FILTER) {
    xTrain.push(trainImages[i]);
    yTrain.push(trainImages[i]); // reconstruction target = input
  }
}
for (var k = 0; k < testImages.length; k++) {
  if (testLabels[k] === CLASS_FILTER) {
    xVal.push(testImages[k]);
    yVal.push(testImages[k]);
  }
}
console.log("T-shirt data: " + xTrain.length + " train, " + xVal.length + " val");

var modelConfigs = [
  { model: preset.models[0], varName: "MLP_DENOISER_PRETRAINED_BIN_B64", file: "mlp_denoiser_pretrained.js" },
  { model: preset.models[1], varName: "MLP_DDPM_PRETRAINED_BIN_B64", file: "mlp_ddpm_pretrained.js" },
  { model: preset.models[2], varName: "NCSN_PRETRAINED_BIN_B64", file: "ncsn_pretrained.js" },
  { model: preset.models[3], varName: "SCORE_SDE_PRETRAINED_BIN_B64", file: "score_sde_pretrained.js" },
];

function extractWeightsNamed(model) {
  var specs = [];
  var buffers = [];
  model.weights.forEach(function (w) {
    var data = w.read().dataSync();
    specs.push({ name: w.name, shape: w.shape.slice(), dtype: "float32" });
    buffers.push(new Float32Array(data));
  });
  return { specs: specs, buffers: buffers };
}

function packBinary(meta, weightSpecs, weightBuffers) {
  meta.weightSpecs = weightSpecs;
  var metaJson = JSON.stringify(meta);
  var metaBytes = Buffer.from(metaJson, "utf8");
  var metaLen = metaBytes.length;

  var totalWeightBytes = 0;
  weightBuffers.forEach(function (buf) { totalWeightBytes += buf.byteLength; });

  var out = Buffer.alloc(4 + metaLen + totalWeightBytes);
  out.writeUInt32LE(metaLen, 0);
  metaBytes.copy(out, 4);

  var offset = 4 + metaLen;
  weightBuffers.forEach(function (buf) {
    Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).copy(out, offset);
    offset += buf.byteLength;
  });
  return out;
}

var midx = 0;
function nextModel() {
  if (midx >= modelConfigs.length) {
    console.log("\nAll pretrained weights exported!");
    process.exit(0);
  }

  var cfg = modelConfigs[midx++];
  var m = cfg.model;
  console.log("\n=== Training: " + m.name + " (" + EPOCHS + " epochs) ===");

  var built;
  try {
    built = mb.buildModelFromGraph(tf, m.graph, {
      mode: "direct", featureSize: 784, windowSize: 1, seqFeatureSize: 784,
      allowedOutputKeys: [{ key: "pixel_values", headType: "reconstruction" }],
      defaultTarget: "pixel_values", numClasses: 10,
    });
  } catch (e) {
    console.log("  BUILD FAILED: " + e.message);
    nextModel(); return;
  }

  console.log("  inputs:" + built.model.inputs.length + " params:" + built.model.countParams());

  var epochHistory = [];
  te.trainModel(tf, {
    model: built.model,
    headConfigs: built.headConfigs,
    inputNodes: built.inputNodes || [],
    phaseSwitchConfigs: built.phaseSwitchConfigs || [],
    shouldStop: function () { return false; },
    dataset: {
      xTrain: xTrain, yTrain: yTrain, xVal: xVal, yVal: yVal,
      targetMode: "pixel_values", paramNames: [], paramSize: 0, numClasses: 10,
    },
    epochs: EPOCHS, batchSize: BATCH, learningRate: LR, optimizerType: "adam",
    lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5, minLr: 0.00001,
    earlyStoppingPatience: 0, restoreBestWeights: true,
    onEpochEnd: function (epoch, log) {
      epochHistory.push({ epoch: epoch + 1, loss: log.loss, val_loss: log.val_loss, current_lr: log.current_lr });
      if ((epoch + 1) % 5 === 0 || epoch === 0) {
        console.log("  epoch " + (epoch + 1) + "/" + EPOCHS +
          " loss=" + (log.loss != null ? log.loss.toFixed(6) : "?") +
          " val=" + (log.val_loss != null ? log.val_loss.toFixed(6) : "?") +
          " lr=" + (log.current_lr != null ? log.current_lr.toFixed(6) : "?"));
      }
    },
  }).then(function (result) {
    console.log("  Training done. bestEpoch=" + result.bestEpoch + " bestVal=" +
      (result.bestValLoss != null ? result.bestValLoss.toFixed(6) : "?"));

    // Extract and pack weights
    var extracted = extractWeightsNamed(built.model);
    var trainerConfig = preset.trainers.find(function (t) { return t.modelId === m.id; });
    var meta = {
      name: m.name + " (pre-trained)",
      status: "done",
      config: trainerConfig ? trainerConfig.config : {},
      metrics: { bestEpoch: result.bestEpoch, bestValLoss: result.bestValLoss },
      backend: "cpu",
      epochs: epochHistory,
    };
    meta.config.epochs = EPOCHS;

    var packed = packBinary(meta, extracted.specs, extracted.buffers);
    var b64 = packed.toString("base64");

    var jsContent = "// Pre-trained " + m.name + " weights\nwindow." + cfg.varName + " = \"" + b64 + "\";\n";
    var outPath = path.join(DEMO_DIR, cfg.file);
    fs.writeFileSync(outPath, jsContent);
    console.log("  Saved: " + cfg.file + " (" + (packed.length / 1024).toFixed(0) + " KB, " +
      extracted.specs.length + " weight tensors)");

    built.model.dispose();
    nextModel();
  }).catch(function (e) {
    console.log("  TRAIN FAILED: " + e.message);
    built.model.dispose();
    nextModel();
  });
}

nextModel();

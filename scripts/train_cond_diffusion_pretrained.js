/**
 * Train conditional diffusion models on real Fashion-MNIST (3 classes).
 * Classes: T-shirt/top (0), Trouser (1), Sneaker (7)
 *
 * Run: node scripts/train_cond_diffusion_pretrained.js
 */
"use strict";
global.window = global;

var tf = require("@tensorflow/tfjs");
var mb = require("../src/model_builder_core.js");
var te = require("../src/training_engine_core.js");
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

eval(fs.readFileSync("demo/Fashion-MNIST-Conditional-Diffusion/preset.js", "utf8"));
var preset = window.FASHION_MNIST_COND_DIFFUSION_PRESET;

var DEMO_DIR = path.resolve(__dirname, "../demo/Fashion-MNIST-Conditional-Diffusion");
var DATA_DIR = path.resolve(__dirname, "../data/fashion-mnist");
var EPOCHS = 80;
var BATCH = 64;
var LR = 0.001;
var CLASS_FILTER = [0, 1, 7]; // T-shirt, Trouser, Sneaker
var CLASS_MAP = {}; // original class → 0-indexed
CLASS_FILTER.forEach(function (c, i) { CLASS_MAP[c] = i; });
var NUM_CLASSES = CLASS_FILTER.length;

// Parse IDX format
function parseIdxImages(buf) {
  var count = buf.readUInt32BE(4);
  var rows = buf.readUInt32BE(8), cols = buf.readUInt32BE(12);
  var px = rows * cols;
  var images = [];
  for (var i = 0; i < count; i++) {
    var off = 16 + i * px;
    var row = new Array(px);
    for (var j = 0; j < px; j++) row[j] = buf[off + j] / 255.0;
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

console.log("Loading Fashion-MNIST...");
var trainImages = parseIdxImages(zlib.gunzipSync(fs.readFileSync(path.join(DATA_DIR, "train-images-idx3-ubyte.gz"))));
var trainLabels = parseIdxLabels(zlib.gunzipSync(fs.readFileSync(path.join(DATA_DIR, "train-labels-idx1-ubyte.gz"))));
var testImages = parseIdxImages(zlib.gunzipSync(fs.readFileSync(path.join(DATA_DIR, "t10k-images-idx3-ubyte.gz"))));
var testLabels = parseIdxLabels(zlib.gunzipSync(fs.readFileSync(path.join(DATA_DIR, "t10k-labels-idx1-ubyte.gz"))));

var xTrain = [], yTrain = [], labelsTrain = [];
var xVal = [], yVal = [], labelsVal = [];
for (var i = 0; i < trainImages.length; i++) {
  if (CLASS_MAP[trainLabels[i]] != null) {
    var cls = CLASS_MAP[trainLabels[i]];
    xTrain.push(trainImages[i]); yTrain.push(trainImages[i]);
    var oh = new Array(NUM_CLASSES).fill(0); oh[cls] = 1; labelsTrain.push(oh);
  }
}
for (var k = 0; k < testImages.length; k++) {
  if (CLASS_MAP[testLabels[k]] != null) {
    var cls2 = CLASS_MAP[testLabels[k]];
    xVal.push(testImages[k]); yVal.push(testImages[k]);
    var oh2 = new Array(NUM_CLASSES).fill(0); oh2[cls2] = 1; labelsVal.push(oh2);
  }
}
console.log("Data: " + xTrain.length + " train, " + xVal.length + " val (" + NUM_CLASSES + " classes)");

var modelConfigs = [
  { model: preset.models[0], varName: "COND_DDPM_PRETRAINED_BIN_B64", file: "cond_ddpm_pretrained.js" },
  { model: preset.models[1], varName: "COND_DENOISER_PRETRAINED_BIN_B64", file: "cond_denoiser_pretrained.js" },
];

function extractWeightsNamed(model) {
  var specs = [], buffers = [];
  model.weights.forEach(function (w) {
    specs.push({ name: w.name, shape: w.shape.slice(), dtype: "float32" });
    buffers.push(new Float32Array(w.read().dataSync()));
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

  var built = mb.buildModelFromGraph(tf, m.graph, {
    mode: "direct", featureSize: 784, allowedOutputKeys: [{ key: "pixel_values", headType: "reconstruction" }],
    defaultTarget: "pixel_values", numClasses: NUM_CLASSES,
  });
  console.log("  inputs:" + built.model.inputs.length + " params:" + built.model.countParams());

  var epochHistory = [];
  te.trainModel(tf, {
    model: built.model, headConfigs: built.headConfigs, inputNodes: built.inputNodes,
    phaseSwitchConfigs: [], shouldStop: function () { return false; },
    dataset: {
      xTrain: xTrain, yTrain: yTrain, xVal: xVal, yVal: yVal,
      labelsTrain: labelsTrain, labelsVal: labelsVal,
      targetMode: "pixel_values", paramNames: [], paramSize: 0, numClasses: NUM_CLASSES,
    },
    epochs: EPOCHS, batchSize: BATCH, learningRate: LR, optimizerType: "adam",
    lrSchedulerType: "plateau", lrPatience: 5, lrFactor: 0.5, minLr: 0.00001,
    earlyStoppingPatience: 0, restoreBestWeights: true,
    onEpochEnd: function (epoch, log) {
      epochHistory.push({ epoch: epoch + 1, loss: log.loss, val_loss: log.val_loss, current_lr: log.current_lr });
      if ((epoch + 1) % 5 === 0 || epoch === 0)
        console.log("  epoch " + (epoch + 1) + "/" + EPOCHS + " loss=" + (log.loss || 0).toFixed(6) + " val=" + (log.val_loss || 0).toFixed(6));
    },
  }).then(function (result) {
    console.log("  Done. bestEpoch=" + result.bestEpoch);
    var extracted = extractWeightsNamed(built.model);
    var meta = {
      name: m.name + " (pre-trained)", status: "done",
      config: { epochs: EPOCHS, batchSize: BATCH, learningRate: LR, optimizerType: "adam" },
      metrics: { bestEpoch: result.bestEpoch, bestValLoss: result.bestValLoss },
      backend: "cpu", epochs: epochHistory,
    };
    var packed = packBinary(meta, extracted.specs, extracted.buffers);
    var b64 = packed.toString("base64");
    fs.writeFileSync(path.join(DEMO_DIR, cfg.file),
      "// Pre-trained " + m.name + " weights\nwindow." + cfg.varName + " = \"" + b64 + "\";\n");
    console.log("  Saved: " + cfg.file + " (" + (packed.length / 1024).toFixed(0) + " KB)");
    built.model.dispose();
    nextModel();
  }).catch(function (e) {
    console.log("  ERROR: " + e.message);
    built.model.dispose();
    nextModel();
  });
}
nextModel();

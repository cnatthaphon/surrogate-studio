"use strict";
global.window = global;

var tf = require("@tensorflow/tfjs");
var gen = require("../src/generation_engine_core.js");
var te = require("../src/training_engine_core.js");

function makeTimeOnlyModel(order) {
  var xIn = tf.input({ shape: [4], name: "image_source_layer" });
  var classIn = tf.input({ shape: [3], name: "class_input" });
  var timeIn = tf.input({ shape: [2], name: "time_embed_layer" });

  var xZero = tf.layers.dense({ units: 4, useBias: false, kernelInitializer: "zeros", trainable: false }).apply(xIn);
  var cZero = tf.layers.dense({ units: 4, useBias: false, kernelInitializer: "zeros", trainable: false }).apply(classIn);
  var tProjLayer = tf.layers.dense({ units: 4, useBias: false, name: "time_projection" });
  var tProj = tProjLayer.apply(timeIn);
  var out = tf.layers.add().apply([xZero, cZero, tProj]);

  var inputs = order === "class-first" ? [xIn, classIn, timeIn] : [xIn, timeIn, classIn];
  var model = tf.model({ inputs: inputs, outputs: out });
  tProjLayer.setWeights([tf.tensor2d([[1, 0, 0, 0], [0, 1, 0, 0]], [2, 4])]);
  return model;
}

async function testConditionalInputOrderParity() {
  var cfg = {
    method: "ddpm",
    steps: 4,
    numSamples: 2,
    latentDim: 4,
    temperature: 1.0,
    seed: 42,
    classVector: [[1, 0, 0], [0, 1, 0]],
    ddpmPredMode: "x0",
  };
  var a = makeTimeOnlyModel("class-first");
  var b = makeTimeOnlyModel("time-first");
  var ra = await gen.generate(tf, Object.assign({ model: a }, cfg));
  var rb = await gen.generate(tf, Object.assign({ model: b }, cfg));
  var da = tf.tensor2d(ra.samples);
  var db = tf.tensor2d(rb.samples);
  var diff = da.sub(db).abs().max().arraySync();
  da.dispose();
  db.dispose();
  a.dispose();
  b.dispose();
  if (diff > 1e-6) throw new Error("conditional generation input order mismatch: max diff=" + diff);
}

async function testValidationUsesValidationClassLabels() {
  var xIn = tf.input({ shape: [2], name: "image_source_layer" });
  var classIn = tf.input({ shape: [3], name: "class_embed_layer" });
  var xZero = tf.layers.dense({ units: 3, useBias: false, kernelInitializer: "zeros", trainable: false }).apply(xIn);
  var classDense = tf.layers.dense({ units: 3, useBias: false, kernelInitializer: "identity" }).apply(classIn);
  var out = tf.layers.add().apply([xZero, classDense]);
  var model = tf.model({ inputs: [xIn, classIn], outputs: out });

  var dataset = {
    xTrain: [[0, 0], [0, 0]],
    yTrain: [[1, 0, 0], [0, 1, 0]],
    xVal: [[0, 0], [0, 0]],
    yVal: [[0, 0, 1], [0, 0, 1]],
    targetMode: "pixel_values",
    labelsTrain: [[1, 0, 0], [0, 1, 0]],
    labelsVal: [[0, 0, 1], [0, 0, 1]],
    paramNames: [],
    paramSize: 0,
    numClasses: 3,
  };

  var result = await te.trainModel(tf, {
    model: model,
    dataset: dataset,
    epochs: 1,
    batchSize: 2,
    learningRate: 0.001,
    optimizerType: "adam",
    inputNodes: [{ name: "image_source_layer" }, { name: "class_embed_layer" }],
    headConfigs: [{ id: "single", target: "pixel_values", loss: "mse", headType: "reconstruction" }],
    onEpochEnd: function () {},
  });

  model.dispose();
  if (!(result.bestValLoss < 1e-6)) {
    throw new Error("validation labels were not used for class conditioning: bestValLoss=" + result.bestValLoss);
  }
}

(async function main() {
  try {
    await testConditionalInputOrderParity();
    console.log("PASS conditional generation input order parity");
    await testValidationUsesValidationClassLabels();
    console.log("PASS validation uses validation class labels");
  } catch (err) {
    console.error("FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();

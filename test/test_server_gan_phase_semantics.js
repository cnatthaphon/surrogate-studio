/**
 * Server GAN phase semantics regression test.
 *
 * Verifies that the PyTorch training subprocess derives semantic phase names
 * from the schedule (`discriminator` / `generator`) instead of synthetic
 * `step1` / `step2`, so graph PhaseSwitch nodes follow the same meaning as the
 * client TF.js phased trainer.
 */

global.window = global;
var fs = require("fs");
var os = require("os");
var path = require("path");
var child = require("child_process");
var loader = require("../src/tfjs_node_loader.js");
var tf = loader.loadTfjs();
var MBC = require("../src/model_builder_core.js");

eval(fs.readFileSync("./demo/Fashion-MNIST-GAN/preset.js", "utf8"));

var PYTHON = process.env.SURROGATE_STUDIO_PYTHON || "/home/cue/venv/main/bin/python3";
var TRAIN_SCRIPT = path.resolve(__dirname, "../server/train_subprocess.py");

if (!fs.existsSync(PYTHON)) {
  console.log("SKIP test_server_gan_phase_semantics (python env missing: " + PYTHON + ")");
  process.exit(0);
}

var PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("  \u2713 " + msg); }
  else { FAIL++; console.log("  \u2717 FAIL: " + msg); }
}

function makeDataset(rows, cols) {
  return Array.from({ length: rows }, function (_, r) {
    return Array.from({ length: cols }, function (_, c) { return ((r + c) % 5) / 4; });
  });
}

function runServerCase(name, modelId, trainerId) {
  var modelRec = window.FASHION_MNIST_GAN_PRESET.models.find(function (m) { return m.id === modelId; });
  var trainerRec = window.FASHION_MNIST_GAN_PRESET.trainers.find(function (t) { return t.id === trainerId; });
  if (!modelRec || !trainerRec) throw new Error("Missing preset records for " + name);

  var built = MBC.buildModelFromGraph(tf, modelRec.graph, {
    mode: "direct",
    featureSize: 784,
    windowSize: 1,
    seqFeatureSize: 784,
    allowedOutputKeys: [{ key: "pixel_values", headType: "reconstruction" }],
    defaultTarget: "pixel_values",
    numClasses: 10,
  });

  var xTrain = makeDataset(16, 784);
  var cfg = {
    graph: modelRec.graph,
    dataset: {
      xTrain: xTrain,
      yTrain: xTrain,
      xVal: [],
      yVal: [],
      featureSize: 784,
      targetSize: 784,
      numClasses: 10,
      targetMode: "xv",
    },
    headConfigs: built.headConfigs,
    epochs: 1,
    batchSize: 8,
    learningRate: Number(trainerRec.config.learningRate || 0.0002),
    optimizerType: String(trainerRec.config.optimizerType || "adam"),
    optimizerBeta1: trainerRec.config.optimizerBeta1,
    optimizerBeta2: trainerRec.config.optimizerBeta2,
    optimizerMomentum: trainerRec.config.optimizerMomentum,
    optimizerRho: trainerRec.config.optimizerRho,
    optimizerEpsilon: trainerRec.config.optimizerEpsilon,
    lrSchedulerType: "none",
    earlyStoppingPatience: 0,
    weightSelection: "last",
    trainingSchedule: trainerRec.config.trainingSchedule,
    rotateSchedule: true,
  };

  var cfgPath = path.join(os.tmpdir(), "surrogate_server_phase_" + name + "_" + Date.now() + ".json");
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));

  var proc = child.spawnSync(PYTHON, [TRAIN_SCRIPT, cfgPath], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 200 * 1024 * 1024,
  });
  try { fs.unlinkSync(cfgPath); } catch (e) {}
  built.model.dispose();

  if (proc.status !== 0) {
    throw new Error(name + " server train failed: " + (proc.stderr || proc.stdout));
  }

  var lines = String(proc.stdout || "").trim().split("\n").filter(Boolean);
  var epochMsg = null;
  lines.forEach(function (line) {
    var msg = JSON.parse(line);
    if (msg.kind === "error") throw new Error(msg.message);
    if (msg.kind === "epoch" && !epochMsg) epochMsg = msg;
  });
  if (!epochMsg) throw new Error(name + " missing epoch log");

  var phaseLosses = epochMsg.phaseLosses || {};
  var keys = Object.keys(phaseLosses);
  assert(keys.indexOf("discriminator") >= 0, name + " emits discriminator phase loss");
  assert(keys.indexOf("generator") >= 0, name + " emits generator phase loss");
  assert(keys.indexOf("step1") < 0 && keys.indexOf("step2") < 0, name + " does not leak synthetic step labels");
}

console.log("=== 1. MLP-GAN Server Phases ===");
runServerCase("mlp_gan", "m-mlp-gan", "t-mlp-gan");

console.log("\n=== 2. DCGAN Server Phases ===");
runServerCase("dcgan", "m-dcgan", "t-dcgan");

console.log("\n=== RESULTS ===");
console.log("PASS: " + PASS + " / FAIL: " + FAIL);
if (FAIL > 0) process.exit(1);

"use strict";
// Codex round-6 P2: GRUResetAfterLayer must respect rnnCfg's
// kernelInitializer/recurrentInitializer/biasInitializer (previously
// hardcoded), and computeOutputShape with returnSequences=true must
// preserve the seq axis even when seq is null.
var path = require("path");
global.window = global;
global.OSCDatasetModules = { registerModule: function () {} };
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var sr = require(path.join(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var MBC = require(path.join(__dirname, "..", "src/model_builder_core.js"));

(async function () {
  await tf.setBackend("cpu"); await tf.ready();
  var ok = true;

  // ─── Test 1: zero/one initializers must propagate ───────────────
  var graph = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer",  data:{mode:"flat", featureSize:3}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"gru_layer",
           data:{units:4, returnseq:"false", dropout:0,
                 // _buildInitializer reads d[prefix+"Initializer"]; "default"
                 // returns null. Use explicit names so it constructs real
                 // tf.initializers.X instances and rnnCfg.kernelInitializer
                 // etc. become objects the layer must respect.
                 kernelInitializer:"zeros",
                 recurrentInitializer:"ones",
                 biasInitializer:"ones"},
           class:"gru_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:200, pos_y:0 },
    "3": { id:3, name:"output_layer", data:{target:"custom", targetType:"custom", loss:"none", units:4}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}}, outputs:{}, pos_x:400, pos_y:0 },
  } } } };
  var built = MBC.buildModelFromGraph(tf, graph, {
    mode: "direct", featureSize: 3, windowSize: 1, seqFeatureSize: 3,
    allowedOutputKeys: [], defaultTarget: "custom", numClasses: 0,
  });
  // Find the GRU layer's weights and inspect them.
  var ws = built.model.weights;
  var kernelW = null, recW = null, biasW = null;
  ws.forEach(function (w) {
    if (/kernel$/.test(w.name) && !/recurrent_kernel/.test(w.name) && !kernelW) kernelW = w;
    if (/recurrent_kernel$/.test(w.name) && !recW) recW = w;
    if (/\/bias$/.test(w.name) && w.shape.length === 2 && !biasW) biasW = w;
  });
  if (!kernelW || !recW || !biasW) {
    console.error("  FAIL: could not locate GRU weights");
    ws.forEach(function (w) { console.error("    " + w.name + " " + JSON.stringify(w.shape)); });
    ok = false;
  } else {
    var kArr = kernelW.read().arraySync();
    var rArr = recW.read().arraySync();
    var bArr = biasW.read().arraySync();
    var kSum = 0, rSum = 0, bSum = 0;
    kArr.forEach(function (row) { row.forEach(function (v) { kSum += Math.abs(v); }); });
    rArr.forEach(function (row) { row.forEach(function (v) { rSum += Math.abs(v); }); });
    bArr.forEach(function (row) { row.forEach(function (v) { bSum += Math.abs(v); }); });
    var kZero = kSum < 1e-6;
    var rOnes = Math.abs(rSum - rArr.length * rArr[0].length) < 1e-3;
    var bOnes = Math.abs(bSum - bArr.length * bArr[0].length) < 1e-3;
    console.log("  kernel sum=" + kSum.toFixed(4) + " (expect 0; zeros init)");
    console.log("  recurrent sum=" + rSum.toFixed(4) + " (expect " + (rArr.length * rArr[0].length) + "; ones init)");
    console.log("  bias sum=" + bSum.toFixed(4) + " (expect " + (bArr.length * bArr[0].length) + "; ones init)");
    if (!kZero) { console.error("  FAIL: kernelInitializer ignored"); ok = false; }
    if (!rOnes) { console.error("  FAIL: recurrentInitializer ignored"); ok = false; }
    if (!bOnes) { console.error("  FAIL: biasInitializer ignored"); ok = false; }
  }

  // ─── Test 2: returnSequences=true must preserve seq axis ─────────
  // Build a fresh layer instance and probe computeOutputShape with seq=null.
  var MBC2 = MBC; // reuse
  var graph2 = { drawflow: { Home: { data: {
    "1": { id:1, name:"input_layer",  data:{mode:"flat", featureSize:3}, class:"input_layer", html:"", typenode:false, inputs:{}, outputs:{output_1:{connections:[{node:"2",input:"input_1"}]}}, pos_x:0, pos_y:0 },
    "2": { id:2, name:"gru_layer",    data:{units:4, returnseq:"true", dropout:0}, class:"gru_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"1",output:"output_1"}]}}, outputs:{output_1:{connections:[{node:"3",input:"input_1"}]}}, pos_x:200, pos_y:0 },
    "3": { id:3, name:"output_layer", data:{target:"custom", targetType:"custom", loss:"none", units:4}, class:"output_layer", html:"", typenode:false, inputs:{input_1:{connections:[{node:"2",output:"output_1"}]}}, outputs:{}, pos_x:400, pos_y:0 },
  } } } };
  var built2 = MBC2.buildModelFromGraph(tf, graph2, {
    mode: "direct", featureSize: 3, windowSize: 1, seqFeatureSize: 3,
    allowedOutputKeys: [], defaultTarget: "custom", numClasses: 0,
  });
  // Find the GRU layer instance and call computeOutputShape with seq=null.
  var gruLayer = null;
  built2.model.layers.forEach(function (l) {
    if (l.constructor && l.constructor.name === "GRURALayer") gruLayer = l;
    // class registered under "GRUResetAfterLayer" string but constructor is GRURALayer
    if (l.getClassName && l.getClassName() === "GRUResetAfterLayer") gruLayer = l;
  });
  if (!gruLayer) {
    console.error("  FAIL: could not locate GRUResetAfterLayer instance");
    built2.model.layers.forEach(function (l) {
      console.error("    layer: " + l.name + " ctor=" + (l.constructor && l.constructor.name));
    });
    ok = false;
  } else {
    var shape = gruLayer.computeOutputShape([null, null, 3]);
    console.log("  computeOutputShape([null, null, 3]) returnSequences=true → " + JSON.stringify(shape));
    if (!Array.isArray(shape) || shape.length !== 3) {
      console.error("  FAIL: returnSequences=true with seq=null dropped time axis (expected 3D, got " + JSON.stringify(shape) + ")");
      ok = false;
    }
    if (shape[2] !== 4) {
      console.error("  FAIL: units mismatch (expected 4, got " + shape[2] + ")");
      ok = false;
    }
  }

  if (ok) {
    console.log("PASS: GRUResetAfterLayer respects initializers and preserves seq axis.");
    process.exit(0);
  } else {
    console.error("FAIL: at least one assertion failed.");
    process.exit(1);
  }
})().catch(function (e) { console.error(e); process.exit(1); });

"use strict";
// Regression test for the bbox-format mismatch reported in PR #86 review.
// Before fix: _giouLoss always interpreted [B,4] as (x,y,w,h). The UI
// gated GIoU on (headType=regression, featureSize=4), so the synthetic
// detection schema (which uses x0,y0,x1,y1 corners) was offered GIoU
// and silently optimized the wrong geometry.
//
// Reviewer reproduction: boxes [0.2,0.2,0.4,0.4] and [0.3,0.3,0.5,0.5]:
//   xyxy IoU = 0.01 / 0.07 ≈ 0.1429   GIoU loss ≈ 1.0794
//   xywh IoU = 0.09 / 0.32 ≈ 0.2813   GIoU loss ≈ 0.8299
//
// After fix: training_engine_core's _giouLoss + makeHeadLoss honor a
// bboxFormat parameter; head configs pull it from the schema via
// the builder; UI gates GIoU on bboxFormat being declared.

var path = require("path");
global.window = global;
global.OSCDatasetModules = { registerModule: function () {}, registerModules: function () {} };
var tf = require("@tensorflow/tfjs");
require("@tensorflow/tfjs-backend-cpu");
var sr = require(path.join(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.join(__dirname, "..", "src/schema_definitions_builtin.js"));
var TEC = require(path.join(__dirname, "..", "src/training_engine_core.js"));
var MGC = require(path.join(__dirname, "..", "src/model_graph_core.js"));

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

(async function () {
  await tf.setBackend("cpu"); await tf.ready();

  // ---- Case 1: makeHeadLoss respects bboxFormat ----
  var pred = tf.tensor2d([[0.2, 0.2, 0.4, 0.4]]);
  var truth = tf.tensor2d([[0.3, 0.3, 0.5, 0.5]]);

  var xywhHead = { loss: "giou", matchWeight: 1, headType: "regression", units: 4, bboxFormat: "xywh" };
  var xyxyHead = { loss: "giou", matchWeight: 1, headType: "regression", units: 4, bboxFormat: "xyxy" };

  var lossXywh = TEC.makeHeadLoss(tf, xywhHead, "mse")(truth, pred);
  var lossXyxy = TEC.makeHeadLoss(tf, xyxyHead, "mse")(truth, pred);
  var vXywh = (await lossXywh.data())[0];
  var vXyxy = (await lossXyxy.data())[0];
  lossXywh.dispose(); lossXyxy.dispose();

  ok(Math.abs(vXywh - 0.8299) < 1e-3,
    "xywh GIoU loss ≈ 0.8299 (got " + vXywh.toFixed(4) + ")");
  ok(Math.abs(vXyxy - 1.0794) < 1e-3,
    "xyxy GIoU loss ≈ 1.0794 (got " + vXyxy.toFixed(4) + ")");
  ok(Math.abs(vXywh - vXyxy) > 0.1, "xywh ≠ xyxy on the same numeric input (Δ=" + Math.abs(vXywh - vXyxy).toFixed(4) + ")");

  pred.dispose(); truth.dispose();

  // ---- Case 2: default (unspecified) bboxFormat falls back to xywh ----
  pred = tf.tensor2d([[0.2, 0.2, 0.4, 0.4]]);
  truth = tf.tensor2d([[0.3, 0.3, 0.5, 0.5]]);
  var defaultHead = { loss: "giou", matchWeight: 1, headType: "regression", units: 4 };
  var lossDefault = TEC.makeHeadLoss(tf, defaultHead, "mse")(truth, pred);
  var vDefault = (await lossDefault.data())[0];
  lossDefault.dispose();
  ok(Math.abs(vDefault - 0.8299) < 1e-3, "default bboxFormat behaves like xywh (got " + vDefault.toFixed(4) + ")");
  pred.dispose(); truth.dispose();

  // ---- Case 3: giou_mse hybrid honors bboxFormat too ----
  pred = tf.tensor2d([[0.2, 0.2, 0.4, 0.4]]);
  truth = tf.tensor2d([[0.3, 0.3, 0.5, 0.5]]);
  // hybrid: 0.5*MSE + 0.5*GIoU
  // MSE = ((0.1)^2 + (0.1)^2 + (0.1)^2 + (0.1)^2) / 4 = 0.01
  // xyxy GIoU = 1.0794
  // hybrid = 0.5*0.01 + 0.5*1.0794 = 0.5447
  var hybridHead = { loss: "giou_mse", matchWeight: 1, headType: "regression", units: 4, bboxFormat: "xyxy" };
  var lossHybrid = TEC.makeHeadLoss(tf, hybridHead, "mse")(truth, pred);
  var vHybrid = (await lossHybrid.data())[0];
  lossHybrid.dispose();
  ok(Math.abs(vHybrid - 0.5447) < 1e-3, "xyxy giou_mse hybrid ≈ 0.5447 (got " + vHybrid.toFixed(4) + ")");
  pred.dispose(); truth.dispose();

  // ---- Case 4: UI gating — schemas WITH bboxFormat show GIoU options ----
  function lossValues(spec) {
    if (!Array.isArray(spec)) return [];
    var f = spec.filter(function (x) { return x && x.key === "loss"; })[0];
    return f && f.options ? f.options.map(function (o) { return o.value; }) : [];
  }
  var rt = MGC.createRuntime({
    resolveSchemaId: function (sid) { return sid; },
    getCurrentSchemaId: function () { return "synthetic_detection"; },
    getOutputKeys: function (sid) { return sr.getOutputKeys(sid) || []; },
    normalizeOutputTargetsList: function (raw, current) {
      var v = String(raw || "").trim().toLowerCase();
      if (v) return [v];
      return current || [];
    },
  });
  var synthSpec = rt.getNodeConfigSpec({
    id: 1, name: "output_layer",
    data: { target: "bbox", targetType: "bbox", loss: "giou", headType: "regression" },
    inputs: {}, outputs: {},
  }, "synthetic_detection");
  var synthVals = lossValues(synthSpec);
  ok(synthVals.indexOf("giou") >= 0, "synthetic_detection bbox (xyxy): 'giou' option offered");
  ok(synthVals.indexOf("giou_mse") >= 0, "synthetic_detection bbox (xyxy): 'giou_mse' option offered");

  var sarSpec = rt.getNodeConfigSpec({
    id: 2, name: "output_layer",
    data: { target: "bbox", targetType: "bbox", loss: "giou", headType: "regression" },
    inputs: {}, outputs: {},
  }, "sar_ship_detection");
  var sarVals = lossValues(sarSpec);
  ok(sarVals.indexOf("giou") >= 0, "sar_ship_detection bbox (xywh): 'giou' option offered");

  // ---- Case 5: UI gating — bbox-shaped target WITHOUT bboxFormat hides GIoU ----
  var unannotatedRt = MGC.createRuntime({
    resolveSchemaId: function () { return "unannotated"; },
    getCurrentSchemaId: function () { return "unannotated"; },
    getOutputKeys: function () {
      // headType=regression, featureSize=4, but no bboxFormat — schema author
      // hasn't told us whether it's xywh or xyxy. GIoU must stay hidden.
      return [{ key: "box4", label: "Some 4-vec", headType: "regression", featureSize: 4 }];
    },
    normalizeOutputTargetsList: function (raw, current) {
      var v = String(raw || "").trim().toLowerCase();
      if (v) return [v];
      return current || [];
    },
  });
  var unSpec = unannotatedRt.getNodeConfigSpec({
    id: 3, name: "output_layer",
    data: { target: "box4", targetType: "box4", loss: "mse", headType: "regression" },
    inputs: {}, outputs: {},
  }, "unannotated");
  var unVals = lossValues(unSpec);
  ok(unVals.indexOf("giou") < 0, "schema without bboxFormat: 'giou' NOT offered");
  ok(unVals.indexOf("giou_mse") < 0, "schema without bboxFormat: 'giou_mse' NOT offered");

  // ---- Case 6: applyNodeConfigValue copies bboxFormat onto the node ----
  var bag = {
    "10": {
      id: 10, name: "output_layer",
      data: { target: "", targetType: "", loss: "mse", headType: "regression" },
      inputs: {}, outputs: {},
    },
  };
  var editor = {
    export: function () { return { drawflow: { Home: { data: bag } } }; },
    updateNodeDataFromId: function (id, d) { bag[String(id)].data = d; },
    addNodeInput: function () {}, removeNodeInput: function () {}, removeSingleConnection: function () {},
  };
  var realRt = MGC.createRuntime({
    resolveSchemaId: function () { return "synthetic_detection"; },
    getCurrentSchemaId: function () { return "synthetic_detection"; },
    getOutputKeys: function (sid) { return sr.getOutputKeys(sid) || []; },
    normalizeOutputTargetsList: function (raw, current) {
      var v = String(raw || "").trim().toLowerCase();
      if (v) return [v];
      return current || [];
    },
  });
  realRt.applyNodeConfigValue(editor, "10", "targetType", "bbox", "synthetic_detection");
  ok(bag["10"].data.bboxFormat === "xyxy",
    "synthetic_detection bbox target sets data.bboxFormat='xyxy' (got '" + bag["10"].data.bboxFormat + "')");

  realRt = MGC.createRuntime({
    resolveSchemaId: function () { return "sar_ship_detection"; },
    getCurrentSchemaId: function () { return "sar_ship_detection"; },
    getOutputKeys: function (sid) { return sr.getOutputKeys(sid) || []; },
    normalizeOutputTargetsList: function (raw, current) {
      var v = String(raw || "").trim().toLowerCase();
      if (v) return [v];
      return current || [];
    },
  });
  bag["10"].data = { target: "", targetType: "", loss: "mse", headType: "regression" };
  realRt.applyNodeConfigValue(editor, "10", "targetType", "bbox", "sar_ship_detection");
  ok(bag["10"].data.bboxFormat === "xywh",
    "sar_ship_detection bbox target sets data.bboxFormat='xywh' (got '" + bag["10"].data.bboxFormat + "')");

  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

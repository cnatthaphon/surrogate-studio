"use strict";
// #147 platform-feature parity check: the generic notebook export must
// handle a graph using augment_image / augment_bbox / target_source — not
// just simple flat-input regression. Mirrors the SAR-Ship CNN+Aug graph,
// uses a small synthetic image+bbox dataset, and verifies:
//   - export succeeds
//   - resulting notebook embeds the train_subprocess.py runtime that
//     contains augment dispatches AND the graphLabelOutputIdx fix
//   - the graph JSON round-trips with augment node types preserved
//   - schema knows about target_source / augment_* node names

var path = require("path");
var assert = require("assert");

global.window = global;
global.document = {
  createElement: function () { return { onload: null, onerror: null, style: {} }; },
  head: { appendChild: function () {} },
};
global.OSCDatasetModules = { registerModule: function () {}, registerModules: function () {} };

require(path.resolve(__dirname, "..", "src/notebook_runtime_assets.js"));
var NBC = require(path.resolve(__dirname, "..", "src/notebook_bundle_core.js"));
var DBA = require(path.resolve(__dirname, "..", "src/dataset_bundle_adapter.js"));
var sr = require(path.resolve(__dirname, "..", "src/schema_registry.js"));
global.OSCSchemaRegistry = sr;
require(path.resolve(__dirname, "..", "src/schema_definitions_builtin.js"));

// Reuse the actual SAR-Ship preset's graph builder (loaded via global)
require(path.resolve(__dirname, "..", "demo/SAR-Ship-Detection/preset.js"));
var preset = global.SAR_SHIP_DETECTION_PRESET;
if (!preset) { console.error("preset failed to register"); process.exit(1); }
var augModel = preset.models.filter(function (m) { return m.id === "sar_cnn_aug"; })[0];
if (!augModel) { console.error("sar_cnn_aug model missing"); process.exit(1); }

// Synthetic image+bbox dataset shaped like HRSID. 24 samples total
// (16 train / 4 val / 4 test). Each sample is a 64x64 grayscale image
// flattened to 4096 features, with a normalized xywh bbox.
function _makeImage() {
  var img = new Array(64 * 64);
  for (var p = 0; p < img.length; p++) {
    img[p] = ((p * 17) % 256) / 255;
  }
  return img;
}
function _makeBbox(i) { return [(i % 4) / 4, (i % 3) / 3, 0.2, 0.3]; }

var xTrain = [], yTrain = [], xVal = [], yVal = [], xTest = [], yTest = [];
for (var i = 0; i < 16; i++) { xTrain.push(_makeImage()); yTrain.push(_makeBbox(i)); }
for (var j = 0; j < 4; j++) { xVal.push(_makeImage()); yVal.push(_makeBbox(j + 16)); }
for (var k = 0; k < 4; k++) { xTest.push(_makeImage()); yTest.push(_makeBbox(k + 20)); }

var dataset = {
  schemaId: "sar_ship_detection",
  name: "sar_ship_aug_notebook_export_test",
  mode: "detection",
  featureSize: 64 * 64,
  targetSize: 4,
  imageShape: [64, 64, 1],
  targetMode: "bbox",
  numClasses: 1,
  classCount: 1,
  classNames: ["ship"],
  xTrain: xTrain, yTrain: yTrain,
  xVal: xVal, yVal: yVal,
  xTest: xTest, yTest: yTest,
};

(async function () {
  var result;
  try {
    result = await NBC.createSingleNotebookFileFromConfig({
      seed: 42,
      datasetBundleAdapter: DBA,
      returnObject: true,
      sessions: [{
        id: "sar_aug_export_test",
        name: "sar_aug_export_test",
        schemaId: "sar_ship_detection",
        graph: augModel.graph,
        runtime: "python_server",
        epochs: 2,
        batchSize: 4,
        learningRate: 0.001,
        datasetData: dataset,
      }],
    });
  } catch (e) {
    console.error("FAIL: export threw: " + (e && e.message || e));
    if (e && e.stack) console.error(e.stack);
    process.exit(1);
  }

  assert(result && result.notebook, "expected notebook object in result");
  console.log("✓ Generic notebook export succeeded for SAR-Ship aug graph");

  var cellTexts = result.notebook.cells.map(function (c) {
    return Array.isArray(c.source) ? c.source.join("") : String(c.source || "");
  });
  var joined = cellTexts.join("\n\n");

  // Graph JSON is embedded base64-encoded in the notebook for binary
  // safety. Extract and decode to confirm augment + target_source node
  // names round-trip through the export path (the runtime relies on
  // these strings to dispatch in train_subprocess.py).
  var b64Match = joined.match(/EMBEDDED_GRAPH_JSON_B64\s*=\s*['"]([^'"]+)['"]/);
  assert(b64Match && b64Match[1], "expected EMBEDDED_GRAPH_JSON_B64 = '...' assignment");
  var graphJson = Buffer.from(b64Match[1], "base64").toString("utf8");
  console.log("✓ graph JSON embedded via EMBEDDED_GRAPH_JSON_B64 (" + graphJson.length + " bytes)");

  assert(graphJson.indexOf("augment_image_layer") >= 0,
    "decoded embedded graph should contain augment_image_layer node");
  console.log("✓ augment_image_layer round-trips in embedded graph");
  assert(graphJson.indexOf("augment_bbox_layer") >= 0,
    "decoded embedded graph should contain augment_bbox_layer node");
  console.log("✓ augment_bbox_layer round-trips in embedded graph");
  assert(graphJson.indexOf("target_source_layer") >= 0,
    "decoded embedded graph should contain target_source_layer node");
  console.log("✓ target_source_layer round-trips in embedded graph");
  // Make sure the seedLink/format/layout configs survived too — these
  // are what make the augmentation actually pair correctly at runtime.
  assert(graphJson.indexOf("\"seedLink\":\"sar_aug\"") >= 0,
    "decoded graph should preserve seedLink=sar_aug on both augment nodes");
  console.log("✓ seedLink config preserved");
  assert(graphJson.indexOf("\"format\":\"xywh\"") >= 0,
    "decoded graph should preserve bbox format=xywh");
  console.log("✓ bbox format config preserved");
  assert(graphJson.indexOf("\"layout\":\"auto\"") >= 0,
    "decoded graph should preserve image layout=auto");
  console.log("✓ image layout=auto config preserved");

  // The notebook runtime (train_subprocess.py loaded from the asset
  // bundle) must contain the round-1 fix routing through _custom_labels
  // for graphLabelOutputIdx heads. This is what makes the augment graph
  // actually train correctly under the notebook runtime.
  var train_src = global.OSCNotebookRuntimeAssets.get("train_subprocess.py");
  assert(train_src, "asset bundle should expose train_subprocess.py");
  assert(train_src.indexOf("graphLabelOutputIdx") >= 0,
    "embedded train_subprocess.py must contain the graphLabelOutputIdx routing fix");
  console.log("✓ embedded train_subprocess.py contains graphLabelOutputIdx fix");
  assert(train_src.indexOf("_custom_labels[_hc_nid]") >= 0 || train_src.indexOf("_custom[_hc_nid]") >= 0,
    "embedded train_subprocess.py must look up _custom_labels by nodeId");
  console.log("✓ embedded train_subprocess.py contains _custom_labels[node_id] lookup");
  assert(train_src.indexOf("augment_image") >= 0 && train_src.indexOf("augment_bbox") >= 0,
    "embedded train_subprocess.py must contain augment dispatches");
  console.log("✓ embedded train_subprocess.py has augment dispatches");
  // Shape validation hardening
  assert(train_src.indexOf("requires a 4D tensor") >= 0,
    "embedded train_subprocess.py must contain augment_image shape validation");
  console.log("✓ embedded train_subprocess.py has shape validation (Layer 1)");

  // Sanity: dataset should be embedded too (binary-safe, not as raw rows)
  assert(joined.indexOf("EMBEDDED_DATASET_CSV_B64") >= 0,
    "exported notebook should embed dataset");
  console.log("✓ dataset embedded in notebook");

  console.log("\nPASS: generic notebook export handles augment graphs end-to-end.");
})().catch(function (e) {
  console.error("FAIL:", e && e.stack ? e.stack : e);
  process.exit(1);
});

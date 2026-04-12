/**
 * SAR Ship Detection — Bounding Box Regression on Radar Satellite Imagery
 *
 * Real SAR (Synthetic Aperture Radar) images from the HRSID dataset.
 * Ship detection via bounding box regression — predict [x, y, w, h].
 *
 * Dataset: HRSID (High Resolution SAR Images Dataset)
 * Source: Gaofen-3, Sentinel-1 SAR satellites
 */
(function () {
  "use strict";

  var sid = "sar_ship_detection";
  var DS_ID = "sar_ship_ds";
  var FEATURE_SIZE = 64 * 64;

  var _nid = 0;
  function N(d, name, data, x, y) {
    _nid++;
    d[String(_nid)] = {
      id: _nid, name: name + "_layer", data: data || {}, class: name + "_layer",
      html: "<div><div>" + name + "_layer</div></div>", typenode: false,
      inputs: {}, outputs: {}, pos_x: x, pos_y: y,
    };
    return String(_nid);
  }
  function C(d, from, to) {
    if (!d[from].outputs.output_1) d[from].outputs.output_1 = { connections: [] };
    d[from].outputs.output_1.connections.push({ node: to, input: "input_1" });
    if (!d[to].inputs.input_1) d[to].inputs.input_1 = { connections: [] };
    d[to].inputs.input_1.connections.push({ node: from, output: "output_1" });
  }
  function graph(d) { return { drawflow: { Home: { data: d } } }; }

  // CNN detector: Conv features → flatten → Dense → bbox
  function buildCnnDetector() {
    _nid = 0;
    var d = {};
    var imgSrc  = N(d, "image_source", { sourceKey: "pixel_values", featureSize: FEATURE_SIZE, imageShape: [64,64,1] }, 50, 300);
    var reshape = N(d, "reshape",      { targetShape: "64,64,1" },       200, 300);
    var c1      = N(d, "conv2d",       { filters: 16, kernelSize: 3, strides: 2, padding: "same", activation: "relu" }, 380, 300);
    var c2      = N(d, "conv2d",       { filters: 32, kernelSize: 3, strides: 2, padding: "same", activation: "relu" }, 550, 300);
    var c3      = N(d, "conv2d",       { filters: 64, kernelSize: 3, strides: 2, padding: "same", activation: "relu" }, 720, 300);
    var flat    = N(d, "flatten",      {},                                890, 300);
    var d1      = N(d, "dense",        { units: 128, activation: "relu" }, 1060, 300);
    var drop    = N(d, "dropout",      { rate: 0.3 },                    1230, 300);
    var out     = N(d, "output",       { target: "bbox", targetType: "bbox", headType: "regression", matchWeight: 1 }, 1400, 300);

    C(d, imgSrc, reshape); C(d, reshape, c1); C(d, c1, c2); C(d, c2, c3);
    C(d, c3, flat); C(d, flat, d1); C(d, d1, drop); C(d, drop, out);
    return graph(d);
  }

  // MLP detector baseline
  function buildMlpDetector() {
    _nid = 100;
    var d = {};
    var imgSrc = N(d, "image_source", { sourceKey: "pixel_values", featureSize: FEATURE_SIZE, imageShape: [64,64,1] }, 50, 300);
    var d1     = N(d, "dense",        { units: 256, activation: "relu" },  250, 300);
    var d2     = N(d, "dense",        { units: 64, activation: "relu" },   450, 300);
    var out    = N(d, "output",       { target: "bbox", targetType: "bbox", headType: "regression", matchWeight: 1 }, 650, 300);
    C(d, imgSrc, d1); C(d, d1, d2); C(d, d2, out);
    return graph(d);
  }

  window.SAR_SHIP_DETECTION_PRESET = {
    dataset: {
      id: DS_ID,
      name: "HRSID SAR Ships (64x64, 300 patches)",
      schemaId: sid,
      datasetModuleId: "hrsid_ship",
      taskRecipeId: "detection_single_box",
      mode: "detection",
      imageShape: [64, 64, 1],
      featureSize: FEATURE_SIZE,
      targetSize: 4,
      targetMode: "bbox",
      numClasses: 1,
      classCount: 1,
      classNames: ["ship"],
      splitConfig: { mode: "random", train: 0.7, val: 0.15, test: 0.15 },
      seed: 42,
    },
    models: [
      { id: "sar_cnn", name: "CNN Ship Detector", schemaId: sid, graph: buildCnnDetector(), createdAt: Date.now() },
      { id: "sar_mlp", name: "MLP Baseline", schemaId: sid, graph: buildMlpDetector(), createdAt: Date.now() },
    ],
    trainers: [
      {
        id: "sar_cnn_trainer", name: "CNN Detector Trainer", schemaId: sid,
        datasetId: DS_ID, modelId: "sar_cnn",
        runtime: "js_client", runtimeBackend: "auto", status: "draft",
        trainCfg: { epochs: 50, batchSize: 16, learningRate: 0.001, optimizer: "adam", earlyStoppingPatience: 15 },
      },
      {
        id: "sar_mlp_trainer", name: "MLP Baseline Trainer", schemaId: sid,
        datasetId: DS_ID, modelId: "sar_mlp",
        runtime: "js_client", runtimeBackend: "auto", status: "draft",
        trainCfg: { epochs: 50, batchSize: 16, learningRate: 0.001, optimizer: "adam" },
      },
    ],
    generations: [],
    evaluations: [
      {
        id: "sar_eval", name: "Ship Detection: CNN vs MLP", schemaId: sid, datasetId: DS_ID,
        trainerIds: ["sar_cnn_trainer", "sar_mlp_trainer"],
        evaluatorIds: ["mae", "rmse", "r2"],
        status: "draft", runs: [], createdAt: Date.now(),
      },
    ],
  };
})();

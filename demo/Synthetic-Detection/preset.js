(function () {
  "use strict";

  var sid = "synthetic_detection";
  var DS_ID = "synthetic_detection_ds";

  var _nid = 0;
  function N(d, name, data, x, y) {
    _nid += 1;
    d[String(_nid)] = {
      id: _nid,
      name: name + "_layer",
      data: data || {},
      class: name + "_layer",
      html: "<div><div>" + name + "_layer</div></div>",
      typenode: false,
      inputs: {},
      outputs: {},
      pos_x: x,
      pos_y: y,
    };
    return String(_nid);
  }
  function C(d, from, to, op, ip) {
    op = op || "output_1";
    ip = ip || "input_1";
    if (!d[from].outputs[op]) d[from].outputs[op] = { connections: [] };
    d[from].outputs[op].connections.push({ node: to, input: ip });
    if (!d[to].inputs[ip]) d[to].inputs[ip] = { connections: [] };
    d[to].inputs[ip].connections.push({ node: from, output: op });
  }
  function graph(d) {
    return { drawflow: { Home: { data: d } } };
  }

  function buildDetectionBaseline() {
    _nid = 0;
    var d = {};
    var img = N(d, "image_source", { sourceKey: "pixel_values", featureSize: 1024, imageShape: [32, 32, 1] }, 60, 240);
    var reshape = N(d, "reshape", { targetShape: "32,32,1" }, 230, 240);
    var conv1 = N(d, "conv2d", { filters: 16, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 420, 180);
    var pool1 = N(d, "maxpool2d", { poolSize: 2, strides: 2 }, 610, 180);
    var conv2 = N(d, "conv2d", { filters: 32, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 800, 180);
    var pool2 = N(d, "maxpool2d", { poolSize: 2, strides: 2 }, 990, 180);
    var flat = N(d, "flatten", {}, 1180, 240);
    var dense = N(d, "dense", { units: 96, activation: "relu" }, 1360, 240);
    var bboxDense = N(d, "dense", { units: 32, activation: "relu" }, 1540, 160);
    var bboxOut = N(d, "output", {
      target: "bbox",
      targetType: "bbox",
      headType: "regression",
      loss: "mse",
      units: 4,
      unitsHint: 4,
      matchWeight: 1
    }, 1720, 140);
    var clsDense = N(d, "dense", { units: 32, activation: "relu" }, 1540, 320);
    var clsOut = N(d, "output", {
      target: "label",
      targetType: "label",
      headType: "classification",
      loss: "cross_entropy",
      units: 3,
      unitsHint: 3,
      matchWeight: 0.4
    }, 1720, 320);

    C(d, img, reshape);
    C(d, reshape, conv1);
    C(d, conv1, pool1);
    C(d, pool1, conv2);
    C(d, conv2, pool2);
    C(d, pool2, flat);
    C(d, flat, dense);
    C(d, dense, bboxDense);
    C(d, bboxDense, bboxOut);
    C(d, dense, clsDense);
    C(d, clsDense, clsOut);
    return graph(d);
  }

  window.SYNTHETIC_DETECTION_PRESET = {
    dataset: {
      id: DS_ID,
      name: "Synthetic Detection Dataset",
      schemaId: sid,
      datasetModuleId: "synthetic_detection",
      status: "draft",
      config: {
        seed: 42,
        totalCount: 900,
        trainFrac: 0.70,
        valFrac: 0.15,
        testFrac: 0.15,
      }
    },
    models: [
      {
        id: "synthetic_detection_model",
        name: "Single-Box Detector",
        schemaId: sid,
        graph: buildDetectionBaseline(),
        createdAt: Date.now(),
      }
    ],
    trainers: [
      {
        id: "synthetic_detection_trainer",
        name: "Detection Trainer",
        schemaId: sid,
        datasetId: DS_ID,
        modelId: "synthetic_detection_model",
        runtime: "server_pytorch",
        runtimeBackend: "auto",
        status: "draft",
        trainCfg: {
          epochs: 18,
          batchSize: 64,
          learningRate: 0.001,
          optimizerType: "adam",
        }
      }
    ],
    evaluations: [
      {
        id: "synthetic_detection_eval",
        name: "BBox Quality",
        schemaId: sid,
        datasetId: DS_ID,
        trainerIds: ["synthetic_detection_trainer"],
        evaluatorIds: ["bbox_mae", "class_accuracy", "iou_mean"],
        status: "draft",
        runs: [],
        createdAt: Date.now(),
      }
    ]
  };
})();

/**
 * Cell Nuclei Segmentation — 2018 Data Science Bowl
 *
 * Real biomedical microscopy images with binary nucleus masks.
 * UNet-style encoder-decoder predicts per-pixel segmentation mask.
 *
 * This is the same class of task the original UNet paper targets:
 * binary segmentation of biomedical cell structures.
 *
 * Dataset: 300 samples from stage1_train, downsampled to 32x32 grayscale.
 * Source: 2018 Data Science Bowl (Kaggle)
 *
 * Reference: Ronneberger, Fischer, Brox — "U-Net: Convolutional Networks
 * for Biomedical Image Segmentation", MICCAI 2015. arXiv:1505.04597
 */
(function () {
  "use strict";

  var sid = "dsb2018_segmentation";
  var DS_ID = "dsb2018_ds";
  var IMAGE_SIZE = 1024;

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
  function NR(d, name, data, x, y) {
    _nid++;
    d[String(_nid)] = {
      id: _nid, name: name, data: data || {}, class: name,
      html: "<div><div>" + name + "</div></div>", typenode: false,
      inputs: {}, outputs: {}, pos_x: x, pos_y: y,
    };
    return String(_nid);
  }
  function C(d, from, to, op, ip) {
    op = op || "output_1"; ip = ip || "input_1";
    if (!d[from].outputs[op]) d[from].outputs[op] = { connections: [] };
    d[from].outputs[op].connections.push({ node: to, input: ip });
    if (!d[to].inputs[ip]) d[to].inputs[ip] = { connections: [] };
    d[to].inputs[ip].connections.push({ node: from, output: op });
  }
  function graph(d) { return { drawflow: { Home: { data: d } } }; }

  // UNet for nucleus segmentation — same architecture class as the original paper
  function buildNucleusUNet() {
    _nid = 0;
    var d = {};
    var imgSrc  = N(d, "image_source", { sourceKey: "pixel_values", featureSize: IMAGE_SIZE, imageShape: [32,32,1] }, 50, 300);
    var reshape = N(d, "reshape",      { targetShape: "32,32,1" },            200, 300);

    // Encoder block 1: Conv(16) → MaxPool
    var enc1    = N(d, "conv2d",       { filters: 16, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 380, 200);
    var pool1   = N(d, "maxpool2d",    { poolSize: 2, strides: 2 },           550, 200);
    // Encoder block 2: Conv(32) → MaxPool
    var enc2    = N(d, "conv2d",       { filters: 32, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 380, 400);
    var pool2   = N(d, "maxpool2d",    { poolSize: 2, strides: 2 },           550, 400);
    // Bottleneck: Conv(64)
    var bottle  = N(d, "conv2d",       { filters: 64, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 550, 600);

    // Decoder block 2: UpSample → Concat(skip2) → Conv(32)
    var up2     = N(d, "upsample2d",   { size: 2 },                           720, 600);
    var cat2    = NR(d, "concat_block", {},                                    720, 400);
    var dec2    = N(d, "conv2d",       { filters: 32, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 900, 400);
    // Decoder block 1: UpSample → Concat(skip1) → Conv(16)
    var up1     = N(d, "upsample2d",   { size: 2 },                           900, 200);
    var cat1    = NR(d, "concat_block", {},                                    900, 100);
    var dec1    = N(d, "conv2d",       { filters: 16, kernelSize: 3, strides: 1, padding: "same", activation: "relu" }, 1080, 100);

    // 1x1 conv → sigmoid → flat mask
    var conv1x1 = N(d, "conv2d",      { filters: 1, kernelSize: 1, strides: 1, padding: "same", activation: "sigmoid" }, 1080, 300);
    var flat    = N(d, "flatten",      {},                                     1250, 300);
    var out     = N(d, "output",       { target: "mask", targetType: "mask", loss: "bce", matchWeight: 1, headType: "segmentation" }, 1420, 300);

    C(d, imgSrc, reshape);
    C(d, reshape, enc1); C(d, enc1, pool1);
    C(d, pool1, enc2); C(d, enc2, pool2);
    C(d, pool2, bottle);
    C(d, bottle, up2);
    C(d, up2, cat2, "output_1", "input_1");
    C(d, enc2, cat2, "output_1", "input_2");
    C(d, cat2, dec2);
    C(d, dec2, up1);
    C(d, up1, cat1, "output_1", "input_1");
    C(d, enc1, cat1, "output_1", "input_2");
    C(d, cat1, dec1);
    C(d, dec1, conv1x1);
    C(d, conv1x1, flat);
    C(d, flat, out);

    return graph(d);
  }

  // MLP baseline — no spatial awareness
  function buildMlpSeg() {
    _nid = 100;
    var d = {};
    var imgSrc = N(d, "image_source", { sourceKey: "pixel_values", featureSize: IMAGE_SIZE, imageShape: [32,32,1] }, 50, 300);
    var d1     = N(d, "dense",        { units: 256, activation: "relu" },     250, 300);
    var d2     = N(d, "dense",        { units: IMAGE_SIZE, activation: "sigmoid" }, 450, 300);
    var out    = N(d, "output",       { target: "mask", targetType: "mask", loss: "bce", matchWeight: 1, headType: "segmentation" }, 650, 300);
    C(d, imgSrc, d1); C(d, d1, d2); C(d, d2, out);
    return graph(d);
  }

  window.CELL_NUCLEI_SEGMENTATION_PRESET = {
    dataset: {
      id: DS_ID,
      name: "DSB 2018 Cell Nuclei (32x32)",
      schemaId: sid,
      datasetModuleId: "dsb2018_segmentation",
      taskRecipeId: "segmentation_mask",
      mode: "segmentation",
      imageShape: [32, 32, 1],
      featureSize: IMAGE_SIZE,
      targetSize: IMAGE_SIZE,
      targetMode: "mask",
      numClasses: 2,
      classCount: 2,
      classNames: ["background", "nucleus"],
      splitConfig: { mode: "random", train: 0.7, val: 0.15, test: 0.15 },
      seed: 42,
    },
    models: [
      { id: "nuc_unet", name: "Nucleus UNet (skip connections)", schemaId: sid, graph: buildNucleusUNet(), createdAt: Date.now() },
      { id: "nuc_mlp", name: "MLP Baseline", schemaId: sid, graph: buildMlpSeg(), createdAt: Date.now() },
    ],
    trainers: [
      {
        id: "nuc_unet_trainer", name: "Nucleus UNet Trainer", schemaId: sid,
        datasetId: DS_ID, modelId: "nuc_unet",
        runtime: "js_client", runtimeBackend: "auto", status: "draft",
        trainCfg: { epochs: 50, batchSize: 16, learningRate: 0.001, optimizer: "adam", earlyStoppingPatience: 15 },
      },
      {
        id: "nuc_mlp_trainer", name: "MLP Baseline Trainer", schemaId: sid,
        datasetId: DS_ID, modelId: "nuc_mlp",
        runtime: "js_client", runtimeBackend: "auto", status: "draft",
        trainCfg: { epochs: 50, batchSize: 16, learningRate: 0.001, optimizer: "adam" },
      },
    ],
    generations: [],
    evaluations: [
      {
        id: "nuc_eval", name: "Nucleus Segmentation: UNet vs MLP", schemaId: sid, datasetId: DS_ID,
        trainerIds: ["nuc_unet_trainer", "nuc_mlp_trainer"],
        evaluatorIds: ["mask_iou", "dice", "pixel_accuracy"],
        status: "draft", runs: [], createdAt: Date.now(),
      },
    ],
  };
})();

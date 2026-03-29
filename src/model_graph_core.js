(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCModelGraphCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createRuntime(api) {
    if (!api || typeof api !== "object") {
      throw new Error("OSCModelGraphCore.createRuntime requires api.");
    }

    function addInputNode(editor, x, y) {
      var html =
        "<div><div style='font-weight:700'>Input</div><div style='display:grid;gap:4px'>" +
        "<select df-mode style='width:120px'><option value='auto'>auto</option><option value='flat'>flat</option><option value='sequence'>sequence</option></select>" +
        "<div style='font-size:11px'>auto: infer from layers</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>mode=auto</div></div></div>";
      return editor.addNode("input_layer", 1, 1, x, y, "input_layer", { mode: "auto" }, html);
    }

    function addDenseNode(editor, x, y, cfg) {
      var units = Math.max(1, Number((cfg && cfg.units) || 32));
      var activation = String((cfg && cfg.activation) || "relu");
      var html =
        "<div><div style='font-weight:700'>Dense</div><div style='display:grid;gap:4px'>" +
        "<input type='number' df-units value='" + units + "' min='1' style='width:80px'>" +
        "<select df-activation style='width:120px'>" +
        "<option value='relu'>relu</option><option value='tanh'>tanh</option><option value='sigmoid'>sigmoid</option><option value='linear'>linear</option>" +
        "</select><div class='node-summary' style='font-size:11px;color:#94a3b8;'>u=" + units + ", act=" + activation + "</div></div></div>";
      return editor.addNode("dense_layer", 1, 1, x, y, "dense_layer", { units: units, activation: activation }, html);
    }

    function addDropoutNode(editor, x, y, cfg) {
      var rate = api.clamp(Number((cfg && cfg.rate) || 0.1), 0, 0.9);
      var html =
        "<div><div style='font-weight:700'>Dropout</div>" +
        "<input type='number' step='0.05' min='0' max='0.9' df-rate value='" + rate.toFixed(2) + "' style='width:80px'>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>rate=" + rate.toFixed(2) + "</div></div>";
      return editor.addNode("dropout_layer", 1, 1, x, y, "dropout_layer", { rate: rate }, html);
    }

    function addBatchNormNode(editor, x, y, cfg) {
      var momentum = api.clamp(Number((cfg && cfg.momentum) || 0.99), 0.1, 0.999);
      var epsilon = Math.max(1e-6, Number((cfg && cfg.epsilon) || 1e-3));
      var html =
        "<div><div style='font-weight:700'>BatchNorm</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>m=" + momentum.toFixed(3) + ", ε=" + epsilon.toExponential(1) + "</div></div>";
      return editor.addNode("batchnorm_layer", 1, 1, x, y, "batchnorm_layer", { momentum: momentum, epsilon: epsilon }, html);
    }

    function addLayerNormNode(editor, x, y, cfg) {
      var epsilon = Math.max(1e-6, Number((cfg && cfg.epsilon) || 1e-3));
      var html =
        "<div><div style='font-weight:700'>LayerNorm</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>ε=" + epsilon.toExponential(1) + "</div></div>";
      return editor.addNode("layernorm_layer", 1, 1, x, y, "layernorm_layer", { epsilon: epsilon }, html);
    }

    function addLatentNode(editor, x, y, cfg) {
      var units = Math.max(2, Number((cfg && cfg.units) || 16));
      var group = String((cfg && cfg.group) || "z_shared");
      var matchWeight = Math.max(0, Number((cfg && cfg.matchWeight) || 1));
      var html =
        "<div><div style='font-weight:700'>Latent Z</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>u=" + units + ", g=" + group + ", w=" + matchWeight.toFixed(2) + "</div></div>";
      return editor.addNode("latent_layer", 1, 1, x, y, "latent_layer", { units: units, group: group, matchWeight: matchWeight }, html);
    }

    function addLatentMuNode(editor, x, y, cfg) {
      var units = Math.max(2, Number((cfg && cfg.units) || 16));
      var group = String((cfg && cfg.group) || "z_shared");
      var matchWeight = Math.max(0, Number((cfg && cfg.matchWeight) || 1));
      var html =
        "<div><div style='font-weight:700'>Latent μ</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>u=" + units + ", g=" + group + ", w=" + matchWeight.toFixed(2) + "</div></div>";
      return editor.addNode("latent_mu_layer", 1, 1, x, y, "latent_mu_layer", { units: units, group: group, matchWeight: matchWeight }, html);
    }

    function addLatentLogVarNode(editor, x, y, cfg) {
      var units = Math.max(2, Number((cfg && cfg.units) || 16));
      var group = String((cfg && cfg.group) || "z_shared");
      var matchWeight = Math.max(0, Number((cfg && cfg.matchWeight) || 1));
      var html =
        "<div><div style='font-weight:700'>Latent logσ²</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>u=" + units + ", g=" + group + ", w=" + matchWeight.toFixed(2) + "</div></div>";
      return editor.addNode("latent_logvar_layer", 1, 1, x, y, "latent_logvar_layer", { units: units, group: group, matchWeight: matchWeight }, html);
    }

    function addReparamNode(editor, x, y, cfg) {
      var group = String((cfg && cfg.group) || "z_shared");
      var beta = Math.max(0, Number((cfg && cfg.beta) || 1e-3));
      var matchWeight = Math.max(0, Number((cfg && cfg.matchWeight) || 1));
      var html =
        "<div><div style='font-weight:700'>Reparam z</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>g=" + group + ", β=" + beta.toExponential(1) + ", w=" + matchWeight.toFixed(2) + "</div></div>";
      return editor.addNode("reparam_layer", 2, 1, x, y, "reparam_layer", { group: group, beta: beta, matchWeight: matchWeight }, html);
    }

    function addOutputNode(editor, x, y, cfg) {
      var target = String((cfg && (cfg.target || cfg.targetType)) || "xv");
      var loss = String((cfg && cfg.loss) || "mse");
      var matchWeight = Math.max(0, Number((cfg && cfg.matchWeight) || 1));
      var phase = String((cfg && cfg.phase) || "").trim();
      var html =
        "<div><div style='font-weight:700'>Output</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>target=" + target + ", loss=" + loss + (phase ? ", phase=" + phase : "") + "</div></div>";
      // 2 inputs: input_1 = prediction data, input_2 = custom label (optional, from PhaseSwitch/Constant)
      return editor.addNode("output_layer", 2, 1, x, y, "output_layer", {
        target: target,
        targetType: target,
        loss: loss,
        matchWeight: matchWeight,
        phase: phase,
      }, html);
    }

    function addHistNode(editor, x, y, cfg) {
      var schemaId = api.resolveSchemaId((cfg && cfg.schemaId) || api.getCurrentSchemaId() || "oscillator");
      var featureKey = api.normalizeHistorySeriesKey((cfg && cfg.featureKey) || "x", schemaId);
      var html = "<div><div style='font-weight:700'>History</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>feature=" + api.historySeriesLabel(featureKey, schemaId) + "</div></div>";
      return editor.addNode("hist_block", 0, 1, x, y, "hist_block", { featureKey: featureKey }, html);
    }

    function addImageSourceNode(editor, x, y, cfg) {
      var schemaId = api.resolveSchemaId((cfg && cfg.schemaId) || api.getCurrentSchemaId() || "oscillator");
      var srcSpec = api.getImageSourceSpec((cfg && cfg.sourceKey) || "", schemaId);
      var featureSize = Math.max(1, Number((cfg && cfg.featureSize) || srcSpec.featureSize || 1));
      var html =
        "<div><div style='font-weight:700'>ImageSource</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>feature=" + srcSpec.label + ", shape=" + srcSpec.width + "x" + srcSpec.height + "x" + srcSpec.channels + ", n=" + String(Math.round(featureSize)) + "</div></div>";
      return editor.addNode("image_source_block", 0, 1, x, y, "image_source_block", {
        sourceKey: srcSpec.sourceKey,
        featureSize: Math.round(featureSize),
        imageShape: srcSpec.shape.slice(),
        imageHeight: srcSpec.height,
        imageWidth: srcSpec.width,
        imageChannels: srcSpec.channels,
      }, html);
    }

    function addWindowHistNode(editor, x, y, cfg) {
      var schemaId = api.resolveSchemaId((cfg && cfg.schemaId) || api.getCurrentSchemaId() || "oscillator");
      var featureKey = api.normalizeHistorySeriesKey((cfg && cfg.featureKey) || "x", schemaId);
      var windowSize = Math.max(5, Number((cfg && cfg.windowSize) || 20));
      var stride = Math.max(1, Number((cfg && cfg.stride) || 1));
      var lagMode = String((cfg && cfg.lagMode) || "contiguous");
      var lagCsv = String((cfg && cfg.lagCsv) || "1,2,3,4,5");
      var padMode = String((cfg && cfg.padMode) || "none");
      var html =
        "<div><div style='font-weight:700'>WindowHistory</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>feature=" + api.historySeriesLabel(featureKey, schemaId) + ", w=" + windowSize + ", s=" + stride + ", " + lagMode + ", " + padMode + "</div></div>";
      return editor.addNode("window_hist_block", 0, 1, x, y, "window_hist_block", { featureKey: featureKey, windowSize: windowSize, stride: stride, lagMode: lagMode, lagCsv: lagCsv, padMode: padMode }, html);
    }

    function addParamsNode(editor, x, y, cfg) {
      var pm = api.normalizeParamMask(cfg && cfg.paramMask ? cfg.paramMask : api.defaultParamMask());
      var html =
        "<div><div style='font-weight:700'>Features</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>m,c,k,e,x0,v0,gm,gk,gc,+ratios(opt)</div></div>";
      return editor.addNode("params_block", 0, 1, x, y, "params_block", { paramMask: pm }, html);
    }

    function addScenarioNode(editor, x, y, cfg) {
      var schemaId = api.resolveSchemaId((cfg && cfg.schemaId) || api.getCurrentSchemaId() || "oscillator");
      var oneHotKey = api.normalizeOneHotKey((cfg && cfg.oneHotKey) || "scenario", schemaId);
      var html = "<div><div style='font-weight:700'>OneHot</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>field=" + api.oneHotLabel(oneHotKey, schemaId) + "</div></div>";
      return editor.addNode("scenario_block", 0, 1, x, y, "scenario_block", { oneHotKey: oneHotKey }, html);
    }

    function addTimeSecNode(editor, x, y) {
      var html = "<div><div style='font-weight:700'>TimeSec</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>t (seconds)</div></div>";
      return editor.addNode("time_sec_block", 0, 1, x, y, "time_sec_block", {}, html);
    }

    function addTimeNormNode(editor, x, y) {
      var html = "<div><div style='font-weight:700'>TimeNorm</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>t/T</div></div>";
      return editor.addNode("time_norm_block", 0, 1, x, y, "time_norm_block", {}, html);
    }

    function addSinNormNode(editor, x, y) {
      var html = "<div><div style='font-weight:700'>SinNorm</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>sin(2π·t/T)</div></div>";
      return editor.addNode("sin_norm_block", 0, 1, x, y, "sin_norm_block", {}, html);
    }

    function addCosNormNode(editor, x, y) {
      var html = "<div><div style='font-weight:700'>CosNorm</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>cos(2π·t/T)</div></div>";
      return editor.addNode("cos_norm_block", 0, 1, x, y, "cos_norm_block", {}, html);
    }

    function addNoiseScheduleNode(editor, x, y) {
      var html = "<div><div style='font-weight:700'>NoiseSchedule</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>β(t), ᾱ(t), σ(t)</div></div>";
      return editor.addNode("noise_schedule_block", 0, 1, x, y, "noise_schedule_block", {}, html);
    }

    function addConv1dNode(editor, x, y, cfg) {
      var filters = Math.max(1, Number((cfg && cfg.filters) || 64));
      var kernelSize = Math.max(1, Number((cfg && cfg.kernelSize) || 3));
      var stride = Math.max(1, Number((cfg && cfg.stride) || 1));
      var activation = String((cfg && cfg.activation) || "relu");
      var html =
        "<div><div style='font-weight:700'>Conv1D</div><div style='display:grid;gap:4px'>" +
        "<input type='number' df-filters value='" + filters + "' min='1' style='width:80px'>" +
        "<input type='number' df-kernelSize value='" + kernelSize + "' min='1' style='width:80px'>" +
        "<input type='number' df-stride value='" + stride + "' min='1' style='width:80px'>" +
        "<select df-activation style='width:120px'><option value='relu'>relu</option><option value='tanh'>tanh</option><option value='sigmoid'>sigmoid</option><option value='linear'>linear</option></select>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>f=" + filters + ", k=" + kernelSize + ", s=" + stride + ", act=" + activation + "</div></div></div>";
      return editor.addNode("conv1d_layer", 1, 1, x, y, "conv1d_layer", { filters: filters, kernelSize: kernelSize, stride: stride, activation: activation }, html);
    }

    function addConcatNode(editor, x, y, cfg) {
      var numInputs = api.clamp(Math.round(Number((cfg && cfg.numInputs) || 5)), 1, 24);
      var html = "<div><div style='font-weight:700'>Concat</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>merge selected features</div></div>";
      return editor.addNode("concat_block", numInputs, 1, x, y, "concat_block", { numInputs: numInputs }, html);
    }

    function addRnnNode(editor, x, y, cfg) {
      var units = Math.max(1, Number((cfg && cfg.units) || 48));
      var dropout = api.clamp(Number((cfg && cfg.dropout) || 0.1), 0, 0.8);
      var returnseq = String((cfg && cfg.returnseq) || "auto");
      var html =
        "<div><div style='font-weight:700'>SimpleRNN</div><div style='display:grid;gap:4px'>" +
        "<input type='number' df-units value='" + units + "' min='1' style='width:80px'>" +
        "<input type='number' df-dropout value='" + dropout.toFixed(2) + "' min='0' max='0.8' step='0.05' style='width:80px'>" +
        "<select df-returnseq style='width:120px'><option value='auto'>returnSeq:auto</option><option value='false'>returnSeq:false</option><option value='true'>returnSeq:true</option></select>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>u=" + units + ", d=" + dropout.toFixed(2) + ", rs=" + returnseq + "</div>" +
        "</div></div>";
      return editor.addNode("rnn_layer", 1, 1, x, y, "rnn_layer", { units: units, dropout: dropout, returnseq: returnseq }, html);
    }

    function addGruNode(editor, x, y, cfg) {
      var units = Math.max(1, Number((cfg && cfg.units) || 64));
      var dropout = api.clamp(Number((cfg && cfg.dropout) || 0.1), 0, 0.8);
      var returnseq = String((cfg && cfg.returnseq) || "auto");
      var html =
        "<div><div style='font-weight:700'>GRU</div><div style='display:grid;gap:4px'>" +
        "<input type='number' df-units value='" + units + "' min='1' style='width:80px'>" +
        "<input type='number' df-dropout value='" + dropout.toFixed(2) + "' min='0' max='0.8' step='0.05' style='width:80px'>" +
        "<select df-returnseq style='width:120px'><option value='auto'>returnSeq:auto</option><option value='false'>returnSeq:false</option><option value='true'>returnSeq:true</option></select>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>u=" + units + ", d=" + dropout.toFixed(2) + ", rs=" + returnseq + "</div>" +
        "</div></div>";
      return editor.addNode("gru_layer", 1, 1, x, y, "gru_layer", { units: units, dropout: dropout, returnseq: returnseq }, html);
    }

    function addLstmNode(editor, x, y, cfg) {
      var units = Math.max(1, Number((cfg && cfg.units) || 64));
      var dropout = api.clamp(Number((cfg && cfg.dropout) || 0.1), 0, 0.8);
      var returnseq = String((cfg && cfg.returnseq) || "auto");
      var html =
        "<div><div style='font-weight:700'>LSTM</div><div style='display:grid;gap:4px'>" +
        "<input type='number' df-units value='" + units + "' min='1' style='width:80px'>" +
        "<input type='number' df-dropout value='" + dropout.toFixed(2) + "' min='0' max='0.8' step='0.05' style='width:80px'>" +
        "<select df-returnseq style='width:120px'><option value='auto'>returnSeq:auto</option><option value='false'>returnSeq:false</option><option value='true'>returnSeq:true</option></select>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>u=" + units + ", d=" + dropout.toFixed(2) + ", rs=" + returnseq + "</div>" +
        "</div></div>";
      return editor.addNode("lstm_layer", 1, 1, x, y, "lstm_layer", { units: units, dropout: dropout, returnseq: returnseq }, html);
    }

    // === New building blocks for GAN/Diffusion ===

    function addDetachNode(editor, x, y, cfg) {
      var activePhase = String((cfg && cfg.activePhase) || "");
      var html = "<div><div style='font-weight:700'>Detach</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>" +
        (activePhase ? "stop grad in phase=" + activePhase : "stop gradient (all phases)") + "</div></div>";
      return editor.addNode("detach_layer", 1, 1, x, y, "detach_layer", { activePhase: activePhase }, html);
    }

    function addSampleZNode(editor, x, y, cfg) {
      var dim = Math.max(1, Number((cfg && cfg.dim) || 128));
      var distribution = String((cfg && cfg.distribution) || "normal");
      var html =
        "<div><div style='font-weight:700'>SampleZ</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>z~" + distribution + "(" + dim + ")</div></div>";
      return editor.addNode("sample_z_layer", 0, 1, x, y, "sample_z_layer", { dim: dim, distribution: distribution }, html);
    }

    function addNoiseInjectionNode(editor, x, y, cfg) {
      var scale = Math.max(0, Number((cfg && cfg.scale) || 0.1));
      var schedule = String((cfg && cfg.schedule) || "constant");
      var html =
        "<div><div style='font-weight:700'>AddNoise</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>scale=" + scale + ", " + schedule + "</div></div>";
      return editor.addNode("noise_injection_layer", 1, 1, x, y, "noise_injection_layer", { scale: scale, schedule: schedule }, html);
    }

    function addTimeEmbedNode(editor, x, y, cfg) {
      var dim = Math.max(1, Number((cfg && cfg.dim) || 64));
      var html =
        "<div><div style='font-weight:700'>TimeEmbed</div>" +
        "<div class='node-summary' style='font-size:11px;color:#94a3b8;'>dim=" + dim + "</div></div>";
      return editor.addNode("time_embed_layer", 0, 1, x, y, "time_embed_layer", { dim: dim }, html);
    }

    // --- Embedding node ---
    function addEmbeddingNode(editor, x, y, cfg) {
      var inputDim = Math.max(1, Number((cfg && cfg.inputDim) || 10000));
      var outputDim = Math.max(1, Number((cfg && cfg.outputDim) || 256));
      var html =
        "<div><div style='font-weight:700'>Embedding</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>vocab=" + inputDim + ", dim=" + outputDim + "</div></div>";
      return editor.addNode("embedding_layer", 1, 1, x, y, "embedding_layer", { inputDim: inputDim, outputDim: outputDim }, html);
    }

    // --- GAN building blocks ---
    function addConstantNode(editor, x, y, cfg) {
      var value = Number((cfg && cfg.value) != null ? cfg.value : 1);
      var dim = Math.max(1, Number((cfg && cfg.dim) || 1));
      var html = "<div><div style='font-weight:700'>Constant</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>val=" + value + ", dim=" + dim + "</div></div>";
      return editor.addNode("constant_layer", 0, 1, x, y, "constant_layer", { value: value, dim: dim }, html);
    }
    function addConcatBatchNode(editor, x, y, cfg) {
      var html = "<div><div style='font-weight:700'>ConcatBatch</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>concat along batch axis</div></div>";
      return editor.addNode("concat_batch_layer", 2, 1, x, y, "concat_batch_layer", {}, html);
    }
    function addPhaseSwitchNode(editor, x, y, cfg) {
      var activePhase = String((cfg && cfg.activePhase) || "");
      var html = "<div><div style='font-weight:700'>PhaseSwitch</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>" +
        (activePhase ? "phase=" + activePhase + " \u2192 in1, else \u2192 in2" : "set activePhase") + "</div></div>";
      return editor.addNode("phase_switch_layer", 2, 1, x, y, "phase_switch_layer", { activePhase: activePhase }, html);
    }

    // --- Conv2D building blocks ---
    function addConv2dNode(editor, x, y, cfg) {
      var filters = Math.max(1, Number((cfg && cfg.filters) || 32));
      var kernelSize = Math.max(1, Number((cfg && cfg.kernelSize) || 3));
      var strides = Math.max(1, Number((cfg && cfg.strides) || 1));
      var padding = String((cfg && cfg.padding) || "same");
      var activation = String((cfg && cfg.activation) || "relu");
      var html =
        "<div><div style='font-weight:700'>Conv2D</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>f=" + filters + ", k=" + kernelSize + ", s=" + strides + ", " + padding + "</div></div>";
      return editor.addNode("conv2d_layer", 1, 1, x, y, "conv2d_layer", { filters: filters, kernelSize: kernelSize, strides: strides, padding: padding, activation: activation }, html);
    }
    function addMaxPool2dNode(editor, x, y, cfg) {
      var poolSize = Math.max(1, Number((cfg && cfg.poolSize) || 2));
      var strides = Math.max(1, Number((cfg && cfg.strides) || poolSize));
      var html =
        "<div><div style='font-weight:700'>MaxPool2D</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>pool=" + poolSize + ", s=" + strides + "</div></div>";
      return editor.addNode("maxpool2d_layer", 1, 1, x, y, "maxpool2d_layer", { poolSize: poolSize, strides: strides }, html);
    }
    function addFlattenNode(editor, x, y, cfg) {
      var html = "<div><div style='font-weight:700'>Flatten</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>ND → 1D</div></div>";
      return editor.addNode("flatten_layer", 1, 1, x, y, "flatten_layer", {}, html);
    }
    function addConv2dTransposeNode(editor, x, y, cfg) {
      var filters = Math.max(1, Number((cfg && cfg.filters) || 32));
      var kernelSize = Math.max(1, Number((cfg && cfg.kernelSize) || 3));
      var strides = Math.max(1, Number((cfg && cfg.strides) || 2));
      var padding = String((cfg && cfg.padding) || "same");
      var activation = String((cfg && cfg.activation) || "relu");
      var html =
        "<div><div style='font-weight:700'>ConvT2D</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>f=" + filters + ", k=" + kernelSize + ", s=" + strides + "</div></div>";
      return editor.addNode("conv2d_transpose_layer", 1, 1, x, y, "conv2d_transpose_layer", { filters: filters, kernelSize: kernelSize, strides: strides, padding: padding, activation: activation }, html);
    }
    function addUpSampling2dNode(editor, x, y, cfg) {
      var size = Math.max(1, Number((cfg && cfg.size) || 2));
      var html =
        "<div><div style='font-weight:700'>UpSample2D</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>size=" + size + "</div></div>";
      return editor.addNode("upsample2d_layer", 1, 1, x, y, "upsample2d_layer", { size: size }, html);
    }
    function addReshapeNode(editor, x, y, cfg) {
      var targetShape = String((cfg && cfg.targetShape) || "28,28,1");
      var html =
        "<div><div style='font-weight:700'>Reshape</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>[" + targetShape + "]</div></div>";
      return editor.addNode("reshape_layer", 1, 1, x, y, "reshape_layer", { targetShape: targetShape }, html);
    }
    function addGlobalAvgPool2dNode(editor, x, y, cfg) {
      var html = "<div><div style='font-weight:700'>GlobalAvgPool2D</div><div class='node-summary' style='font-size:11px;color:#94a3b8;'>spatial → 1</div></div>";
      return editor.addNode("global_avg_pool2d_layer", 1, 1, x, y, "global_avg_pool2d_layer", {}, html);
    }

    function getNodeFactories() {
      return {
        input: addInputNode,
        dense: addDenseNode,
        dropout: addDropoutNode,
        batchnorm: addBatchNormNode,
        layernorm: addLayerNormNode,
        latent: addLatentNode,
        latent_mu: addLatentMuNode,
        latent_logvar: addLatentLogVarNode,
        reparam: addReparamNode,
        output: addOutputNode,
        history: addHistNode,
        image_source: addImageSourceNode,
        window_hist: addWindowHistNode,
        window_hist_x: function (ed, xx, yy, cc) { return addWindowHistNode(ed, xx, yy, Object.assign({}, cc || {}, { featureKey: "x" })); },
        window_hist_v: function (ed, xx, yy, cc) { return addWindowHistNode(ed, xx, yy, Object.assign({}, cc || {}, { featureKey: "v" })); },
        params: addParamsNode,
        onehot: addScenarioNode,
        time_sec: addTimeSecNode,
        time_norm: addTimeNormNode,
        sin_norm: addSinNormNode,
        cos_norm: addCosNormNode,
        noise_schedule: addNoiseScheduleNode,
        conv1d: addConv1dNode,
        concat: addConcatNode,
        rnn: addRnnNode,
        gru: addGruNode,
        lstm: addLstmNode,
        detach: addDetachNode,
        sample_z: addSampleZNode,
        constant: addConstantNode,
        concat_batch: addConcatBatchNode,
        phase_switch: addPhaseSwitchNode,
        noise_injection: addNoiseInjectionNode,
        time_embed: addTimeEmbedNode,
        embedding: addEmbeddingNode,
        conv2d: addConv2dNode,
        maxpool2d: addMaxPool2dNode,
        flatten: addFlattenNode,
        conv2d_transpose: addConv2dTransposeNode,
        upsample2d: addUpSampling2dNode,
        reshape: addReshapeNode,
        global_avg_pool2d: addGlobalAvgPool2dNode,
      };
    }

    function createNodeByType(editor, type, x, y, cfg, schemaId) {
      var factories = getNodeFactories();
      var normalizedType = String(type || "").trim().toLowerCase();
      var factory = factories[normalizedType];
      if (typeof factory !== "function") {
        throw new Error("Unsupported preset node type '" + normalizedType + "'.");
      }
      return factory(editor, Number(x) || 0, Number(y) || 0, Object.assign({}, cfg || {}, { schemaId: schemaId }));
    }

    function addPresetSpecNode(editor, spec, schemaId) {
      var cfg = Object.assign({}, (spec && spec.config) || {}, { schemaId: schemaId });
      var type = String((spec && spec.type) || "").trim().toLowerCase();
      var x = Number(spec && spec.x) || 0;
      var y = Number(spec && spec.y) || 0;
      return createNodeByType(editor, type, x, y, cfg, schemaId);
    }

    function normalizePresetGraphNodes(nodes, edges) {
      var list = Array.isArray(nodes) ? nodes : [];
      var edgeList = Array.isArray(edges) ? edges : [];
      var requiredInputsByKey = {};
      edgeList.forEach(function (edgeSpec) {
        var key = String((edgeSpec && edgeSpec.to) || "").trim();
        var port = String((edgeSpec && edgeSpec.in) || "input_1");
        var m = port.match(/^input_(\d+)$/);
        if (!key || !m) return;
        var idx = Number(m[1] || 1);
        if (!Number.isFinite(idx) || idx < 1) return;
        requiredInputsByKey[key] = Math.max(Number(requiredInputsByKey[key] || 0), idx);
      });
      return list.map(function (nodeSpec) {
        var next = Object.assign({}, nodeSpec || {});
        next.config = Object.assign({}, (nodeSpec && nodeSpec.config) || {});
        var key = String((next && next.key) || "").trim();
        var type = String((next && next.type) || "").trim().toLowerCase();
        var requiredInputs = Number(requiredInputsByKey[key] || 0);
        if (requiredInputs > 0 && type === "concat") {
          next.config.numInputs = Math.max(requiredInputs, Number(next.config.numInputs || 0), 1);
        }
        return next;
      });
    }

    function renderPresetGraphSpec(editor, graphSpec, schemaId) {
      var spec = graphSpec && typeof graphSpec === "object" ? graphSpec : {};
      var rawNodes = Array.isArray(spec.nodes) ? spec.nodes : [];
      var edges = Array.isArray(spec.edges) ? spec.edges : [];
      var nodes = normalizePresetGraphNodes(rawNodes, edges);
      if (!nodes.length) throw new Error("Preset graph spec has no nodes.");
      api.clearEditor(editor);
      var nodeIds = {};
      nodes.forEach(function (nodeSpec) {
        var key = String((nodeSpec && nodeSpec.key) || "").trim();
        if (!key) throw new Error("Preset graph node missing key.");
        nodeIds[key] = addPresetSpecNode(editor, nodeSpec, schemaId);
      });
      edges.forEach(function (edgeSpec) {
        var fromId = nodeIds[String((edgeSpec && edgeSpec.from) || "").trim()];
        var toId = nodeIds[String((edgeSpec && edgeSpec.to) || "").trim()];
        if (!fromId || !toId) throw new Error("Preset graph edge references unknown node.");
        editor.addConnection(
          fromId,
          toId,
          String((edgeSpec && edgeSpec.out) || "output_1"),
          String((edgeSpec && edgeSpec.in) || "input_1")
        );
      });
    }

    function seedPreconfigGraph(editor, presetId, schemaId) {
      var sid = api.resolveSchemaId(schemaId || api.getCurrentSchemaId() || "oscillator");
      var pid = String(presetId || "").trim();
      var def = api.getSchemaPresetDefById(sid, pid);
      if (!def) {
        throw new Error("Preset '" + pid + "' is not registered for schema '" + sid + "'.");
      }
      var graphSpec = def && def.metadata && def.metadata.graphSpec;
      if (!graphSpec) {
        throw new Error("Preset '" + pid + "' is missing metadata.graphSpec.");
      }
      renderPresetGraphSpec(editor, graphSpec, sid);
    }

    function getNodeDisplayName(name) {
      var map = {
        input_layer: "Input",
        dense_layer: "Dense",
        latent_layer: "Latent Z",
        latent_mu_layer: "Latent \u03bc",
        latent_logvar_layer: "Latent log\u03c3\u00b2",
        reparam_layer: "Reparam z",
        dropout_layer: "Dropout",
        batchnorm_layer: "BatchNorm",
        layernorm_layer: "LayerNorm",
        output_layer: "Output",
        image_source_block: "ImageSource",
        sliding_window_block: "SlidingWindow",
        window_hist_block: "WindowHistory",
        window_hist_x_block: "WindowHistX",
        window_hist_v_block: "WindowHistV",
        hist_block: "History",
        hist_x_block: "History X",
        hist_v_block: "History V",
        x_block: "X",
        v_block: "V",
        params_block: "Features",
        time_block: "Time",
        time_sec_block: "TimeSec",
        time_norm_block: "TimeNorm",
        scenario_block: "OneHot",
        trig_block: "Sin/Cos",
        sin_norm_block: "SinNorm",
        cos_norm_block: "CosNorm",
        noise_schedule_block: "NoiseSchedule",
        concat_block: "Concat",
        conv1d_layer: "Conv1D",
        rnn_layer: "SimpleRNN",
        gru_layer: "GRU",
        lstm_layer: "LSTM"
      };
      return map[name] || String(name || "Node");
    }

    function getNodeSummary(node, nodeId, moduleData, schemaId) {
      if (!node) return "";
      var d = node.data || {};
      var sid = api.resolveSchemaId(schemaId || api.getCurrentSchemaId() || "oscillator");
      if (node.name === "input_layer") return "mode=" + String(d.mode || "auto");
      if (node.name === "dense_layer") return "u=" + Number(d.units || 32) + ", act=" + String(d.activation || "relu");
      if (node.name === "latent_layer") return "u=" + Number(d.units || 16) + ", g=" + String(d.group || "z_shared") + ", w=" + Number(d.matchWeight || 1).toFixed(2);
      if (node.name === "latent_mu_layer") return "u=" + Number(d.units || 16) + ", g=" + String(d.group || "z_shared");
      if (node.name === "latent_logvar_layer") return "u=" + Number(d.units || 16) + ", g=" + String(d.group || "z_shared");
      if (node.name === "reparam_layer") return "g=" + String(d.group || "z_shared") + ", \u03b2=" + Number(d.beta || 1e-3).toExponential(1);
      if (node.name === "dropout_layer") return "rate=" + Number(d.rate || 0.1).toFixed(2);
      if (node.name === "batchnorm_layer") return "m=" + Number(d.momentum || 0.99).toFixed(3) + ", \u03b5=" + Number(d.epsilon || 1e-3).toExponential(1);
      if (node.name === "layernorm_layer") return "\u03b5=" + Number(d.epsilon || 1e-3).toExponential(1);
      if (node.name === "rnn_layer" || node.name === "gru_layer" || node.name === "lstm_layer") {
        return "u=" + Number(d.units || 64) + ", d=" + Number(d.dropout || 0).toFixed(2) + ", rs=" + String(d.returnseq || "auto");
      }
      if (node.name === "image_source_block") {
        return "feature=" + String(d.sourceKey || "pixel_values") + ", shape=" + Number(d.imageWidth || 28) + "x" + Number(d.imageHeight || 28) + "x" + Number(d.imageChannels || 1);
      }
      if (node.name === "sliding_window_block" || node.name === "window_hist_block" || node.name === "window_hist_x_block" || node.name === "window_hist_v_block") {
        var prefix = node.name === "window_hist_x_block" ? "wx=" : (node.name === "window_hist_v_block" ? "wv=" : "w=");
        return prefix + Number(d.windowSize || 20) + ", s=" + Number(d.stride || 1) + ", " + String(d.lagMode || "contiguous") + ", " + String(d.padMode || "none");
      }
      if (node.name === "hist_block") return "feature=" + api.historySeriesLabel(d.featureKey || "x", sid);
      if (node.name === "hist_x_block" || node.name === "x_block") return "x(t-1)";
      if (node.name === "hist_v_block" || node.name === "v_block") return "v(t-1)";
      if (node.name === "params_block") {
        var pm = api.normalizeParamMask(d.paramMask);
        var names = [];
        if (pm.m) names.push("m");
        if (pm.c) names.push("c");
        if (pm.k) names.push("k");
        if (pm.e) names.push("e");
        if (pm.x0) names.push("x0");
        if (pm.v0) names.push("v0");
        if (pm.gm) names.push("gm");
        if (pm.gk) names.push("gk");
        if (pm.gc) names.push("gc");
        if (pm.rkm) names.push("k/m");
        if (pm.rcm) names.push("c/m");
        if (pm.rgl) names.push("g/L");
        return "n=" + String(api.countStaticParams(pm)) + " [" + names.join(",") + "]";
      }
      if (node.name === "time_block") return "t/T";
      if (node.name === "time_sec_block") return "t (sec)";
      if (node.name === "time_norm_block") return "t/T";
      if (node.name === "scenario_block") return "field=" + api.oneHotLabel(d.oneHotKey || "scenario", sid);
      if (node.name === "trig_block") return "sin/cos(2\u03c0\u00b7t/T)";
      if (node.name === "sin_norm_block") return "sin(2\u03c0\u00b7t/T)";
      if (node.name === "cos_norm_block") return "cos(2\u03c0\u00b7t/T)";
      if (node.name === "noise_schedule_block") return "\u03b2(t), \u03b1\u0304(t), \u03c3(t)";
      if (node.name === "conv1d_layer") {
        return "f=" + Number(d.filters || 64) + ", k=" + Number(d.kernelSize || 3) + ", s=" + Number(d.stride || 1) + ", act=" + String(d.activation || "relu");
      }
      if (node.name === "constant_layer") { return "const=" + Number(d.value != null ? d.value : 1) + ", dim=" + Number(d.dim || 1); }
      if (node.name === "concat_batch_layer") { return "concat batches (2 inputs)"; }
      if (node.name === "phase_switch_layer") { var swPh = String(d.activePhase || ""); return swPh ? "phase=" + swPh + " \u2192 in1, else \u2192 in2" : "set activePhase"; }
      if (node.name === "detach_layer") { var detPh = String(d.activePhase || ""); return detPh ? "stop grad in " + detPh : "stop gradient"; }
      if (node.name === "embedding_layer") {
        return "vocab=" + Number(d.inputDim || 10000) + ", dim=" + Number(d.outputDim || 256);
      }
      if (node.name === "conv2d_layer") {
        return "f=" + Number(d.filters || 32) + ", k=" + Number(d.kernelSize || 3) + ", s=" + Number(d.strides || 1) + ", " + String(d.padding || "same");
      }
      if (node.name === "conv2d_transpose_layer") {
        return "f=" + Number(d.filters || 32) + ", k=" + Number(d.kernelSize || 3) + ", s=" + Number(d.strides || 2) + " (deconv)";
      }
      if (node.name === "maxpool2d_layer") { return "pool=" + Number(d.poolSize || 2) + ", s=" + Number(d.strides || d.poolSize || 2); }
      if (node.name === "flatten_layer") { return "flatten ND\u21921D"; }
      if (node.name === "upsample2d_layer") { return "upsample \u00d7" + Number(d.size || 2); }
      if (node.name === "reshape_layer") { return "reshape [" + String(d.targetShape || "?") + "]"; }
      if (node.name === "global_avg_pool2d_layer") { return "global avg pool"; }
      if (node.name === "concat_block") {
        var nIn = Object.keys(node.inputs || {}).length || Math.max(1, Number(d.numInputs || 5));
        var featW = typeof api.estimateNodeFeatureWidth === "function"
          ? api.estimateNodeFeatureWidth(moduleData || {}, nodeId, {}, {})
          : 0;
        return "merge features, in=" + String(nIn) + ", feat\u2248" + String(Math.max(0, Number(featW || 0)));
      }
      if (node.name === "output_layer") {
        var rawLoss = String(d.loss || "mse");
        var loss = rawLoss === "use_global" ? "mse" : rawLoss;
        var target = String(d.targetType || d.target || "");
        var ht = String(d.headType || "");
        var phase = String(d.phase || "");
        var summary = "target=" + (target || "?") + ", loss=" + loss;
        if (ht) summary += " [" + ht + "]";
        if (phase) summary += " phase=" + phase;
        return summary;
      }
      return "";
    }

    function getNodeConfigSpec(node, schemaId) {
      if (!node) return [];
      var sid = api.resolveSchemaId(schemaId || api.getCurrentSchemaId() || "oscillator");
      var d = node.data || {};
      var spec = [];
      function addField(field) {
        spec.push(field);
      }
      function addMessage(text) {
        spec.push({ kind: "message", text: String(text || "") });
      }
      // weightTag: common field for all trainable layer nodes
      var _trainableNodes = { "dense_layer": 1, "conv1d_layer": 1, "conv2d_layer": 1, "conv2d_transpose_layer": 1, "lstm_layer": 1, "gru_layer": 1, "rnn_layer": 1, "embedding_layer": 1, "batchnorm_layer": 1 };
      if (_trainableNodes[node.name]) {
        // add weightTag at end (will appear after node-specific fields)
        // defer: push later via _addWeightTag flag
      }
      var _hasWeightTag = !!_trainableNodes[node.name];

      if (node.name === "output_layer") {
        var target = String(d.targetType || d.target || "");
        var rawLoss = String(d.loss || "mse");
        var loss = rawLoss === "use_global" ? "mse" : rawLoss;
        var headType = String(d.headType || "");
        // target options from schema only — no hardcoded options
        var outputKeys = (typeof api.getOutputKeys === "function") ? api.getOutputKeys(sid) : [];
        var targetOptions = [];
        outputKeys.forEach(function (k) {
          var v = k.key || k;
          var l = k.label || v;
          targetOptions.push({ value: v, label: l });
        });
        if (!targetOptions.length && target) targetOptions.push({ value: target, label: target });
        addField({
          kind: "select",
          key: "targetType",
          label: "Target",
          value: target,
          options: targetOptions
        });
        // headType is internal — used by engine, not shown to user
        addField({
          kind: "select",
          key: "loss",
          label: "Loss",
          value: loss,
          options: [
            { value: "mse", label: "MSE" },
            { value: "mae", label: "MAE" },
            { value: "huber", label: "Huber" },
            { value: "bce", label: "Binary Cross-Entropy" },
            { value: "categoricalCrossentropy", label: "Categorical Cross-Entropy" },
            { value: "sparseCategoricalCrossentropy", label: "Sparse Cat. CE" }
          ]
        });
        // informational hint based on headType (from schema, not target name)
        if (headType === "classification") {
          addMessage("Classification head. Use categoricalCrossentropy for one-hot, sparseCategoricalCrossentropy for integer labels.");
        } else if (headType === "reconstruction") {
          addMessage("Reconstruction head. Target = input features (y = x).");
        }
        addField({ kind: "number", key: "matchWeight", label: "Head weight", value: Math.max(0, Number(d.matchWeight || 1)).toFixed(2), min: 0, step: 0.1 });
        addField({ kind: "text", key: "phase", label: "Training phase (empty=default)", value: String(d.phase || ""), placeholder: "e.g. discriminator, generator" });
        return spec;
      }
      // --- Detach node ---
      if (node.name === "detach_layer") {
        addField({ kind: "text", key: "activePhase", label: "Active phase (stop gradient)", value: String(d.activePhase || ""), placeholder: "e.g. discriminator (empty=all)" });
        addMessage("Stops gradient in the specified phase. Empty = stop in all phases. In GAN: set to discriminator phase so G gradient flows during generator phase.");
        return spec;
      }
      // --- SampleZ node ---
      if (node.name === "sample_z_layer") {
        addField({ kind: "number", key: "dim", label: "Latent dim", value: Math.max(1, Number(d.dim || 128)), min: 1, step: 1 });
        addField({ kind: "select", key: "distribution", label: "Distribution", value: String(d.distribution || "normal"), options: [{ value: "normal", label: "Normal N(0,1)" }, { value: "uniform", label: "Uniform U(-1,1)" }] });
        return spec;
      }
      // --- NoiseInjection node ---
      if (node.name === "noise_injection_layer") {
        addField({ kind: "number", key: "scale", label: "Noise scale", value: Number(d.scale || 0.1), min: 0, step: 0.01 });
        addField({ kind: "select", key: "schedule", label: "Schedule", value: String(d.schedule || "constant"), options: [{ value: "constant", label: "Constant" }, { value: "linear", label: "Linear" }, { value: "cosine", label: "Cosine" }] });
        return spec;
      }
      // --- TimeEmbed node ---
      if (node.name === "time_embed_layer") {
        addField({ kind: "number", key: "dim", label: "Embed dim", value: Math.max(1, Number(d.dim || 64)), min: 1, step: 1 });
        return spec;
      }
      if (node.name === "image_source_block" || node.name === "image_source_layer") {
        // source key options from schema
        var imgSrcSpec = (typeof api.getImageSourceSpec === "function") ? api.getImageSourceSpec("", sid) : null;
        var featureNodesMeta = (typeof api.getFeatureNodesMeta === "function") ? api.getFeatureNodesMeta(sid) : {};
        var imgSources = featureNodesMeta.imageSource || [];
        if (imgSources.length > 0) {
          addField({
            kind: "select", key: "sourceKey", label: "Source",
            value: String(d.sourceKey || (imgSources[0] && imgSources[0].key) || ""),
            options: imgSources.map(function (s) { return { value: s.key, label: s.label || s.key }; }),
          });
        } else {
          addField({ kind: "text", key: "sourceKey", label: "Source key", value: String(d.sourceKey || "") });
        }
        addField({ kind: "number", key: "imageWidth", label: "Width", value: Math.max(1, Number(d.imageWidth || 28)), min: 1, step: 1 });
        addField({ kind: "number", key: "imageHeight", label: "Height", value: Math.max(1, Number(d.imageHeight || 28)), min: 1, step: 1 });
        addField({ kind: "number", key: "imageChannels", label: "Channels", value: Math.max(1, Number(d.imageChannels || 1)), min: 1, step: 1 });
        return spec;
      }
      if (node.name === "scenario_block") {
        addField({ kind: "text", key: "oneHotKey", label: "Field", value: String(d.oneHotKey || "scenario") });
        return spec;
      }
      if (node.name === "sliding_window_block" || node.name === "window_hist_block" || node.name === "window_hist_x_block" || node.name === "window_hist_v_block") {
        addField({ kind: "number", key: "windowSize", label: "Window size", value: Math.max(5, Number(d.windowSize || 20)), min: 5, step: 1 });
        addField({ kind: "number", key: "stride", label: "Stride", value: Math.max(1, Number(d.stride || 1)), min: 1, step: 1 });
        addField({
          kind: "select",
          key: "lagMode",
          label: "Lag mode",
          value: String(d.lagMode || "contiguous"),
          options: [
            { value: "contiguous", label: "contiguous" },
            { value: "exact", label: "exact" }
          ]
        });
        addField({ kind: "text", key: "lagCsv", label: "Lag csv", value: String(d.lagCsv || "1,2,3,4,5"), placeholder: "1,2,5" });
        addField({
          kind: "select",
          key: "padMode",
          label: "Pad mode",
          value: String(d.padMode || "none"),
          options: [
            { value: "none", label: "none (no pad)" },
            { value: "zero", label: "zero pad" },
            { value: "edge", label: "edge pad x(0),v(0)" }
          ]
        });
        return spec;
      }
      if (node.name === "params_block") {
        var pm = api.normalizeParamMask(d.paramMask);
        addMessage("Choose parameter features to include");
        addMessage("Shared schema: k_slg = k (spring), L (pendulum), g (bouncing). Use Scenario node for disambiguation.");
        addMessage("Optional derived ratios are configured here (not separate nodes): k/m, c/m, g/L.");
        addMessage("Meaning: m=mass, c=damping/drag, e=restitution, x0/v0=initial state, gm=ground model (0 rigid, 1 compliant), gk/gc=ground spring/damper.");
        addField({
          kind: "checkbox_grid",
          columns: 3,
          items: [
            { key: "pm_m", label: "m", checked: Boolean(pm.m) },
            { key: "pm_c", label: "c", checked: Boolean(pm.c) },
            { key: "pm_k", label: "k", checked: Boolean(pm.k) },
            { key: "pm_e", label: "e", checked: Boolean(pm.e) },
            { key: "pm_x0", label: "x0", checked: Boolean(pm.x0) },
            { key: "pm_v0", label: "v0", checked: Boolean(pm.v0) },
            { key: "pm_gm", label: "gm", checked: Boolean(pm.gm) },
            { key: "pm_gk", label: "gk", checked: Boolean(pm.gk) },
            { key: "pm_gc", label: "gc", checked: Boolean(pm.gc) },
            { key: "pm_rkm", label: "k/m", checked: Boolean(pm.rkm) },
            { key: "pm_rcm", label: "c/m", checked: Boolean(pm.rcm) },
            { key: "pm_rgl", label: "g/L", checked: Boolean(pm.rgl) }
          ]
        });
        return spec;
      }
      if (node.name === "input_layer") {
        addField({
          kind: "select",
          key: "mode",
          label: "Mode",
          value: String(d.mode || "auto"),
          options: [
            { value: "auto", label: "auto" },
            { value: "flat", label: "flat" },
            { value: "sequence", label: "sequence" }
          ]
        });
        return spec;
      }
      if (node.name === "latent_layer") {
        addField({ kind: "number", key: "units", label: "Units (z dim)", value: Math.max(2, Number(d.units || 16)), min: 2, step: 1 });
        addField({ kind: "text", key: "group", label: "Group", value: String(d.group || "z_shared") });
        addField({ kind: "number", key: "matchWeight", label: "Match weight", value: Math.max(0, Number(d.matchWeight || 1)).toFixed(2), min: 0, step: 0.1 });
        addMessage("Latent nodes with same group create auxiliary z-match loss (pairwise to first node in group).");
        return spec;
      }
      if (node.name === "latent_mu_layer" || node.name === "latent_logvar_layer") {
        addField({ kind: "number", key: "units", label: "Units (z dim)", value: Math.max(2, Number(d.units || 16)), min: 2, step: 1 });
        addField({ kind: "text", key: "group", label: "Group", value: String(d.group || "z_shared") });
        addMessage("Use Latent μ + Latent logσ² -> Reparam z for VAE.");
        return spec;
      }
      if (node.name === "reparam_layer") {
        addField({ kind: "text", key: "group", label: "Group", value: String(d.group || "z_shared") });
        addField({ kind: "number", key: "beta", label: "KL β", value: Math.max(0, Number(d.beta || 1e-3)).toFixed(4), min: 0, step: 0.0001 });
        addMessage("Inputs: #1=μ, #2=logσ². Adds auxiliary KL loss automatically.");
        return spec;
      }
      if (node.name === "dense_layer") {
        addField({ kind: "number", key: "units", label: "Units", value: Math.max(1, Number(d.units || 32)), min: 1, step: 1 });
        addField({
          kind: "select",
          key: "activation",
          label: "Activation",
          value: String(d.activation || "relu"),
          options: [
            { value: "relu", label: "relu" },
            { value: "tanh", label: "tanh" },
            { value: "sigmoid", label: "sigmoid" },
            { value: "linear", label: "linear" }
          ]
        });
        addField({ kind: "text", key: "weightTag", label: "Weight tag (for freeze)", value: String(d.weightTag || ""), placeholder: "e.g. generator, discriminator" });
        return spec;
      }
      if (node.name === "conv1d_layer") {
        addField({ kind: "number", key: "filters", label: "Filters", value: Math.max(1, Number(d.filters || 64)), min: 1, step: 1 });
        addField({ kind: "number", key: "kernelSize", label: "Kernel size", value: Math.max(1, Number(d.kernelSize || 3)), min: 1, step: 1 });
        addField({ kind: "number", key: "strideConv", label: "Stride", value: Math.max(1, Number(d.stride || 1)), min: 1, step: 1 });
        addField({
          kind: "select",
          key: "activation",
          label: "Activation",
          value: String(d.activation || "relu"),
          options: [
            { value: "relu", label: "relu" },
            { value: "tanh", label: "tanh" },
            { value: "sigmoid", label: "sigmoid" },
            { value: "linear", label: "linear" }
          ]
        });
        addMessage("Conv1D expects sequence input. For direct mode, keep graph flat.");
        return spec;
      }
      if (node.name === "constant_layer") {
        addField({ kind: "number", key: "value", label: "Value", value: Number(d.value != null ? d.value : 1), step: 0.1 });
        addField({ kind: "number", key: "dim", label: "Output dim", value: Math.max(1, Number(d.dim || 1)), min: 1, step: 1 });
        addMessage("Outputs a constant tensor. Use for GAN labels (1=real, 0=fake).");
        return spec;
      }
      if (node.name === "concat_batch_layer") {
        addMessage("Concatenates two inputs along the batch axis. Input 1 + Input 2 → doubled batch. Use to merge real and fake images for discriminator.");
        return spec;
      }
      if (node.name === "phase_switch_layer") {
        addField({ kind: "text", key: "activePhase", label: "Active phase (select input 1)", value: String(d.activePhase || ""), placeholder: "e.g. discriminator" });
        addMessage("When training phase matches → passes Input 1. Otherwise → passes Input 2. Use for GAN label switching.");
        return spec;
      }
      if (node.name === "embedding_layer") {
        addField({ kind: "number", key: "inputDim", label: "Vocab size", value: Math.max(1, Number(d.inputDim || 10000)), min: 1, step: 1 });
        addField({ kind: "number", key: "outputDim", label: "Embed dim", value: Math.max(1, Number(d.outputDim || 256)), min: 1, step: 1 });
        addMessage("Maps integer token IDs → dense vectors. Input must be integer sequences.");
        return spec;
      }
      // --- Conv2D family config specs ---
      if (node.name === "conv2d_layer" || node.name === "conv2d_transpose_layer") {
        var isTranspose = node.name === "conv2d_transpose_layer";
        addField({ kind: "number", key: "filters", label: "Filters", value: Math.max(1, Number(d.filters || 32)), min: 1, step: 1 });
        addField({ kind: "number", key: "kernelSize", label: "Kernel size", value: Math.max(1, Number(d.kernelSize || 3)), min: 1, step: 1 });
        addField({ kind: "number", key: "strides", label: "Strides", value: Math.max(1, Number(d.strides || (isTranspose ? 2 : 1))), min: 1, step: 1 });
        addField({ kind: "select", key: "padding", label: "Padding", value: String(d.padding || "same"), options: [{ value: "same", label: "same" }, { value: "valid", label: "valid" }] });
        addField({ kind: "select", key: "activation", label: "Activation", value: String(d.activation || "relu"), options: [{ value: "relu", label: "relu" }, { value: "tanh", label: "tanh" }, { value: "sigmoid", label: "sigmoid" }, { value: "linear", label: "linear" }] });
        addField({ kind: "text", key: "weightTag", label: "Weight tag (for freeze)", value: String(d.weightTag || ""), placeholder: "e.g. generator, discriminator" });
        if (isTranspose) addMessage("Upsampling convolution (decoder). Strides=2 doubles spatial dims.");
        return spec;
      }
      if (node.name === "maxpool2d_layer") {
        addField({ kind: "number", key: "poolSize", label: "Pool size", value: Math.max(1, Number(d.poolSize || 2)), min: 1, step: 1 });
        addField({ kind: "number", key: "strides", label: "Strides", value: Math.max(1, Number(d.strides || d.poolSize || 2)), min: 1, step: 1 });
        return spec;
      }
      if (node.name === "flatten_layer" || node.name === "global_avg_pool2d_layer") { return spec; }
      if (node.name === "upsample2d_layer") {
        addField({ kind: "number", key: "size", label: "Upsample factor", value: Math.max(1, Number(d.size || 2)), min: 1, step: 1 });
        return spec;
      }
      if (node.name === "reshape_layer") {
        addField({ kind: "text", key: "targetShape", label: "Target shape (H,W,C)", value: String(d.targetShape || "28,28,1"), placeholder: "28,28,1" });
        return spec;
      }
      if (node.name === "dropout_layer") {
        addField({ kind: "number", key: "rate", label: "Rate", value: api.clamp(Number(d.rate || 0.1), 0, 0.9).toFixed(2), min: 0, max: 0.9, step: 0.05 });
        return spec;
      }
      if (node.name === "batchnorm_layer") {
        addField({ kind: "number", key: "momentum", label: "Momentum", value: api.clamp(Number(d.momentum || 0.99), 0.1, 0.999).toFixed(3), min: 0.1, max: 0.999, step: 0.001 });
        addField({ kind: "number", key: "epsilon", label: "Epsilon", value: Math.max(1e-6, Number(d.epsilon || 1e-3)).toFixed(6), min: 0.000001, step: 0.000001 });
        addMessage("BatchNorm after Dense/Conv1D can improve training stability.");
        return spec;
      }
      if (node.name === "layernorm_layer") {
        addField({ kind: "number", key: "epsilon", label: "Epsilon", value: Math.max(1e-6, Number(d.epsilon || 1e-3)).toFixed(6), min: 0.000001, step: 0.000001 });
        addMessage("LayerNorm is sequence-safe and often robust for RNN/GRU/LSTM stacks.");
        return spec;
      }
      if (node.name === "rnn_layer" || node.name === "gru_layer" || node.name === "lstm_layer") {
        addField({ kind: "number", key: "units", label: "Units", value: Math.max(1, Number(d.units || 64)), min: 1, step: 1 });
        addField({ kind: "number", key: "dropout", label: "Dropout", value: api.clamp(Number(d.dropout || 0.1), 0, 0.8).toFixed(2), min: 0, max: 0.8, step: 0.05 });
        addField({
          kind: "select",
          key: "returnseq",
          label: "Return seq",
          value: String(d.returnseq || "auto"),
          options: [
            { value: "auto", label: "auto" },
            { value: "false", label: "false" },
            { value: "true", label: "true" }
          ]
        });
        return spec;
      }
      if (node.name === "concat_block") {
        var nIn = Object.keys(node.inputs || {}).length || Math.max(1, Number(d.numInputs || 5));
        addField({ kind: "number", key: "numInputs", label: "Input ports", value: Math.max(1, Number(nIn)), min: 1, max: 24, step: 1 });
        addMessage("Default is 5 for manual nodes. Presets may use larger values.");
        return spec;
      }
      return spec;
    }

    function applyNodeConfigValue(node, key, rawValue, schemaId) {
      if (!node) return { handled: false };
      var sid = api.resolveSchemaId(schemaId || api.getCurrentSchemaId() || "oscillator");
      var data = Object.assign({}, node.data || {});
      var k = String(key || "");
      if (k === "target" || k === "targetType") {
        var currentTarget = String(data.targetType || data.target || "");
        var targets = api.normalizeOutputTargetsList(rawValue, currentTarget ? [currentTarget] : [], sid);
        var target = String((targets && targets[0]) || currentTarget || "");
        data.target = target;
        data.targetType = target;
        // auto-set headType from schema metadata
        var _outKeys = (typeof api.getOutputKeys === "function") ? api.getOutputKeys(sid) : [];
        var _matched = _outKeys.filter(function (ok) { return (ok.key || ok) === target; });
        if (_matched.length && _matched[0].headType) {
          data.headType = _matched[0].headType;
        }
      } else if (k === "paramsSelect") {
        data.paramsSelect = String(rawValue || "")
          .replace(/[^a-zA-Z0-9_,]/g, "")
          .replace(/\s+/g, "")
          .replace(/,+/g, ",")
          .replace(/^,|,$/g, "");
      } else if (k === "loss") {
        var vLoss = String(rawValue || "mse");
        var validLosses = ["mse", "mae", "huber", "bce", "categoricalCrossentropy", "sparseCategoricalCrossentropy", "cross_entropy"];
        data.loss = validLosses.indexOf(vLoss) >= 0 ? vLoss : "mse";
      } else if (k === "phase") {
        data.phase = String(rawValue || "").trim();
      } else if (k === "activePhase") {
        data.activePhase = String(rawValue || "").trim();
      } else if (k === "weightTag") {
        data.weightTag = String(rawValue || "").trim();
      } else if (k === "matchWeight") {
        data.matchWeight = Math.max(0, Number(rawValue) || 1);
      } else if (k === "wx") {
        data.wx = Math.max(0, Number(rawValue) || 1);
      } else if (k === "wv") {
        data.wv = Math.max(0, Number(rawValue) || 1);
      } else if (k === "windowSize") {
        data.windowSize = Math.max(5, Number(rawValue) || 20);
      } else if (k === "stride") {
        data.stride = Math.max(1, Number(rawValue) || 1);
      } else if (k === "lagMode") {
        var vLag = String(rawValue || "contiguous");
        data.lagMode = vLag === "exact" ? "exact" : "contiguous";
      } else if (k === "lagCsv") {
        data.lagCsv = String(rawValue || "")
          .replace(/[^0-9,\s\-]/g, "")
          .replace(/\s+/g, "")
          .replace(/,+/g, ",")
          .replace(/^,|,$/g, "") || "1,2,3,4,5";
      } else if (k === "padMode") {
        var vPad = String(rawValue || "none");
        data.padMode = (vPad === "zero" || vPad === "edge") ? vPad : "none";
      } else if (k.indexOf("pm_") === 0) {
        var pm = api.normalizeParamMask(data.paramMask);
        var pKey = k.slice(3);
        if (Object.prototype.hasOwnProperty.call(pm, pKey)) pm[pKey] = Boolean(rawValue);
        data.paramMask = api.normalizeParamMask(pm);
      } else if (k === "mode") {
        var vMode = String(rawValue || "auto");
        data.mode = (vMode === "flat" || vMode === "sequence") ? vMode : "auto";
      } else if (k === "units") {
        if (node.name === "latent_layer" || node.name === "latent_mu_layer" || node.name === "latent_logvar_layer") {
          data.units = Math.max(2, Math.round(Number(rawValue) || 16));
        } else {
          data.units = Math.max(1, Math.round(Number(rawValue) || 32));
        }
      } else if (k === "group") {
        var g = String(rawValue || "z_shared").trim().replace(/\s+/g, "_");
        data.group = g || "z_shared";
      } else if (k === "matchWeight") {
        data.matchWeight = Math.max(0, Number(rawValue) || 1);
      } else if (k === "beta") {
        data.beta = Math.max(0, Number(rawValue) || 1e-3);
      } else if (k === "activation") {
        var act = String(rawValue || "relu");
        data.activation = ["relu", "tanh", "sigmoid", "linear"].indexOf(act) >= 0 ? act : "relu";
      } else if (k === "filters") {
        data.filters = Math.max(1, Math.round(Number(rawValue) || 64));
      } else if (k === "kernelSize") {
        data.kernelSize = Math.max(1, Math.round(Number(rawValue) || 3));
      } else if (k === "strideConv") {
        data.stride = Math.max(1, Math.round(Number(rawValue) || 1));
      } else if (k === "rate") {
        data.rate = api.clamp(Number(rawValue) || 0.1, 0, 0.9);
      } else if (k === "momentum") {
        data.momentum = api.clamp(Number(rawValue) || 0.99, 0.1, 0.999);
      } else if (k === "epsilon") {
        data.epsilon = Math.max(1e-6, Number(rawValue) || 1e-3);
      } else if (k === "dropout") {
        data.dropout = api.clamp(Number(rawValue) || 0.1, 0, 0.8);
      } else if (k === "returnseq") {
        var rs = String(rawValue || "auto");
        data.returnseq = (rs === "true" || rs === "false") ? rs : "auto";
      } else if (k === "sourceKey") {
        data.sourceKey = String(rawValue || "");
      } else if (k === "oneHotKey") {
        data.oneHotKey = api.normalizeOneHotKey(rawValue, sid);
      } else if (k === "imageWidth") {
        data.imageWidth = Math.max(1, Math.round(Number(rawValue) || 28));
      } else if (k === "imageHeight") {
        data.imageHeight = Math.max(1, Math.round(Number(rawValue) || 28));
      } else if (k === "imageChannels") {
        data.imageChannels = Math.max(1, Math.round(Number(rawValue) || 1));
        data.imageShape = [
          Math.max(1, Number(data.imageHeight || 28)),
          Math.max(1, Number(data.imageWidth || 28)),
          Math.max(1, Number(data.imageChannels || 1))
        ];
      } else if (k === "numInputs") {
        return {
          handled: true,
          operation: {
            type: "set_concat_inputs",
            value: rawValue
          }
        };
      } else {
        return { handled: false };
      }
      return { handled: true, data: data };
    }

    function getGraphModuleData(editor) {
      if (!editor || typeof editor.export !== "function") return {};
      var exported = editor.export();
      return (exported && exported.drawflow && exported.drawflow.Home && exported.drawflow.Home.data) || {};
    }

    function getNodeByName(moduleData, name) {
      if (!moduleData) return null;
      var ids = Object.keys(moduleData || {});
      for (var i = 0; i < ids.length; i += 1) {
        var node = moduleData[ids[i]];
        if (node && node.name === name) return node;
      }
      return null;
    }

    function getUpstreamFeatureNodeNames(editor) {
      var names = {};
      var data = getGraphModuleData(editor);
      var inputNode = getNodeByName(data, "input_layer");
      if (!inputNode) return names;
      var startIds = [];
      Object.keys(inputNode.inputs || {}).forEach(function (k) {
        var conns = (inputNode.inputs[k] && inputNode.inputs[k].connections) || [];
        conns.forEach(function (c) { startIds.push(String(c.node)); });
      });
      if (!startIds.length) return names;
      var seen = {};
      var walk = function (id) {
        if (seen[id]) return;
        seen[id] = true;
        var node = data[id];
        if (!node) return;
        names[node.name] = true;
        Object.keys(node.inputs || {}).forEach(function (k) {
          var conns = (node.inputs[k] && node.inputs[k].connections) || [];
          conns.forEach(function (c) { walk(String(c.node)); });
        });
      };
      startIds.forEach(walk);
      return names;
    }

    function getUpstreamFeatureNodes(editor) {
      var nodesByName = {};
      var data = getGraphModuleData(editor);
      var inputNode = getNodeByName(data, "input_layer");
      if (!inputNode) return nodesByName;
      var startIds = [];
      Object.keys(inputNode.inputs || {}).forEach(function (k) {
        var conns = (inputNode.inputs[k] && inputNode.inputs[k].connections) || [];
        conns.forEach(function (c) { startIds.push(String(c.node)); });
      });
      var seen = {};
      var walk = function (id) {
        if (seen[id]) return;
        seen[id] = true;
        var node = data[id];
        if (!node) return;
        if (!nodesByName[node.name]) nodesByName[node.name] = node;
        Object.keys(node.inputs || {}).forEach(function (k) {
          var conns = (node.inputs[k] && node.inputs[k].connections) || [];
          conns.forEach(function (c) { walk(String(c.node)); });
        });
      };
      startIds.forEach(walk);
      return nodesByName;
    }

    function inferGraphMode(editor, fallbackMode) {
      var names = getUpstreamFeatureNodeNames(editor);
      var hasHistory = Boolean(
        names.hist_block || names.hist_x_block || names.hist_v_block ||
        names.x_block || names.v_block ||
        names.window_hist_block || names.window_hist_x_block || names.window_hist_v_block ||
        names.sliding_window_block
      );
      return hasHistory ? "autoregressive" : String(fallbackMode || "direct");
    }

    function inferModelFamily(editor) {
      var data = getGraphModuleData(editor);
      var ids = Object.keys(data || {});
      var names = ids.map(function (id) { return String((data[id] && data[id].name) || ""); });
      var hasNoiseSchedule = names.indexOf("noise_schedule_block") >= 0;
      var hasReparam = names.indexOf("reparam_layer") >= 0;
      var hasLatent = names.indexOf("latent_layer") >= 0 || names.indexOf("latent_mu_layer") >= 0 || names.indexOf("latent_logvar_layer") >= 0;
      if (hasNoiseSchedule) return "diffusion";
      if (hasReparam || hasLatent) return "vae";
      return "supervised";
    }

    function inferWindow(editor, fallbackWindow) {
      var wFallback = Math.max(5, Number(fallbackWindow) || 20);
      var nodes = getUpstreamFeatureNodes(editor);
      var n = nodes.window_hist_block || nodes.window_hist_x_block || nodes.window_hist_v_block || nodes.sliding_window_block;
      if (n) return Math.max(5, Number((n.data && n.data.windowSize) || wFallback));
      if (nodes.hist_block || nodes.hist_x_block || nodes.hist_v_block || nodes.x_block || nodes.v_block) return 1;
      return wFallback;
    }

    function inferArHistoryConfig(editor, fallbackWindow) {
      var fallback = {
        windowSize: Math.max(5, Number(fallbackWindow) || 20),
        stride: 1,
        lagMode: "contiguous",
        lags: null,
        padMode: "none"
      };
      var nodes = getUpstreamFeatureNodes(editor);
      var n = nodes.window_hist_block || nodes.window_hist_x_block || nodes.window_hist_v_block || nodes.sliding_window_block;
      if (n) {
        var d = n.data || {};
        var windowSize = Math.max(5, Number(d.windowSize || fallback.windowSize));
        var stride = Math.max(1, Number(d.stride || 1));
        var lagMode = String(d.lagMode || "contiguous");
        var padMode = (String(d.padMode || "none") === "zero" || String(d.padMode || "none") === "edge")
          ? String(d.padMode || "none")
          : "none";
        if (lagMode !== "exact") {
          return { windowSize: windowSize, stride: stride, lagMode: "contiguous", lags: null, padMode: padMode };
        }
        var lags = String(d.lagCsv || "")
          .split(",")
          .map(function (s) { return Number(s.trim()); })
          .filter(function (v) { return Number.isFinite(v) && v >= 1; })
          .map(function (v) { return Math.floor(v); });
        var uniq = Array.from(new Set(lags)).sort(function (a, b) { return a - b; });
        if (!uniq.length) return { windowSize: windowSize, stride: stride, lagMode: "contiguous", lags: null, padMode: padMode };
        return { windowSize: uniq.length, stride: stride, lagMode: "exact", lags: uniq, padMode: padMode };
      }
      if (nodes.hist_block || nodes.hist_x_block || nodes.hist_v_block || nodes.x_block || nodes.v_block) {
        return { windowSize: 1, stride: 1, lagMode: "contiguous", lags: null, padMode: "none" };
      }
      return fallback;
    }

    function inferTargetMode(editor, fallbackTarget) {
      var fallback = String(fallbackTarget || "x");
      var data = getGraphModuleData(editor);
      var out = getNodeByName(data, "output_layer");
      if (!out || !out.data) return fallback;
      var target = String(out.data.targetType || out.data.target || fallback);
      return (target === "xv" || target === "v") ? target : "x";
    }

    function inferOutputHeads(editor, fallbackTarget, schemaId) {
      var fallback = String(fallbackTarget || "x");
      var sid = api.resolveSchemaId(schemaId || api.getCurrentSchemaId() || "oscillator");
      var data = getGraphModuleData(editor);
      var ids = Object.keys(data || {});
      var inputIds = ids.filter(function (id) { return data[id] && data[id].name === "input_layer"; });
      if (!inputIds.length) {
        return [{ id: "fallback", target: fallback, loss: "mse", wx: 1, wv: 1 }];
      }
      var reachable = {};
      var q = [String(inputIds[0])];
      reachable[String(inputIds[0])] = true;
      while (q.length) {
        var id = q.shift();
        var n = data[id];
        if (!n || !n.outputs) continue;
        Object.keys(n.outputs).forEach(function (ok) {
          var conns = (n.outputs[ok] && n.outputs[ok].connections) || [];
          conns.forEach(function (c) {
            var to = String(c.node);
            if (!reachable[to]) {
              reachable[to] = true;
              q.push(to);
            }
          });
        });
      }
      var nodes = Object.keys(data || {}).map(function (id2) { return { id: String(id2), node: data[id2] }; })
        .filter(function (x) { return reachable[x.id] && x.node && x.node.name === "output_layer"; })
        .sort(function (a, b) { return Number(a.id) - Number(b.id); });
      if (!nodes.length) {
        return [{ id: "fallback", target: fallback, loss: "mse", wx: 1, wv: 1 }];
      }
      return nodes.map(function (x) {
        var d = x.node.data || {};
        var rawTarget = String(d.targetType || d.target || fallback);
        var normalized = api.normalizeOutputTargetsList(rawTarget, [fallback], sid);
        var target = String((normalized && normalized[0]) || fallback);
        return {
          id: x.id,
          target: target,
          targetType: target,
          loss: String(d.loss || "mse"),
          wx: Math.max(0, Number(d.wx || 1)),
          wv: Math.max(0, Number(d.wv || 1)),
          paramsSelect: String(d.paramsSelect || "")
        };
      });
    }

    return {
      getUpstreamFeatureNodeNames: getUpstreamFeatureNodeNames,
      getUpstreamFeatureNodes: getUpstreamFeatureNodes,
      inferArHistoryConfig: inferArHistoryConfig,
      inferGraphMode: inferGraphMode,
      inferModelFamily: inferModelFamily,
      inferOutputHeads: inferOutputHeads,
      inferTargetMode: inferTargetMode,
      inferWindow: inferWindow,
      addInputNode: addInputNode,
      addDenseNode: addDenseNode,
      addDropoutNode: addDropoutNode,
      addBatchNormNode: addBatchNormNode,
      addLayerNormNode: addLayerNormNode,
      addLatentNode: addLatentNode,
      addLatentMuNode: addLatentMuNode,
      addLatentLogVarNode: addLatentLogVarNode,
      addReparamNode: addReparamNode,
      addOutputNode: addOutputNode,
      addHistNode: addHistNode,
      addImageSourceNode: addImageSourceNode,
      addWindowHistNode: addWindowHistNode,
      addParamsNode: addParamsNode,
      addScenarioNode: addScenarioNode,
      addTimeSecNode: addTimeSecNode,
      addTimeNormNode: addTimeNormNode,
      addSinNormNode: addSinNormNode,
      addCosNormNode: addCosNormNode,
      addNoiseScheduleNode: addNoiseScheduleNode,
      addConv1dNode: addConv1dNode,
      addConcatNode: addConcatNode,
      addRnnNode: addRnnNode,
      addGruNode: addGruNode,
      addLstmNode: addLstmNode,
      applyNodeConfigValue: applyNodeConfigValue,
      createNodeByType: createNodeByType,
      getNodeConfigSpec: getNodeConfigSpec,
      getNodeDisplayName: getNodeDisplayName,
      getNodeSummary: getNodeSummary,
      renderPresetGraphSpec: renderPresetGraphSpec,
      seedPreconfigGraph: seedPreconfigGraph,
    };
  }

  return {
    createRuntime: createRuntime,
  };
});

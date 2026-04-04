(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCCheckpointFormatCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA_VERSION = "osc-checkpoint-v1";
  var DEFAULT_TENSOR_LAYOUT = "osc-tensor-layout-v1";
  var DEFAULT_VALUE_ENCODING = "float32-le";

  function _cloneSpecs(specs) {
    return (Array.isArray(specs) ? specs : []).map(function (sp) {
      return {
        name: String((sp && sp.name) || ""),
        shape: Array.isArray(sp && sp.shape) ? sp.shape.map(Number) : [],
        dtype: String((sp && sp.dtype) || "float32"),
        offset: Number((sp && sp.offset) || 0),
      };
    });
  }

  function _inferTensorRole(name) {
    var raw = String(name || "").trim().toLowerCase();
    if (!raw) return "tensor";
    var tail = raw.split("/").pop();
    if (tail === "kernel" || tail === "recurrent_kernel") return tail;
    if (tail === "bias" || tail === "gamma" || tail === "beta") return tail;
    if (tail === "moving_mean" || tail === "running_mean") return "moving_mean";
    if (tail === "moving_variance" || tail === "running_var") return "moving_variance";
    if (tail.indexOf("kernel") >= 0) return "kernel";
    if (tail.indexOf("bias") >= 0) return "bias";
    return "tensor";
  }

  function extractWeightValues(source) {
    if (!source) return null;
    if (source.weightValues && Array.isArray(source.weightValues)) return new Float32Array(source.weightValues);
    if (source.weightData && source.weightData.byteLength != null) return new Float32Array(source.weightData);
    if (source.weightData && Array.isArray(source.weightData)) return new Float32Array(source.weightData);
    if (source.modelArtifacts) return extractWeightValues(source.modelArtifacts);
    if (source.checkpoint) return extractWeightValues(source.checkpoint);
    return null;
  }

  function extractWeightSpecs(source) {
    if (!source) return [];
    if (Array.isArray(source.weightSpecs)) return _cloneSpecs(source.weightSpecs);
    if (source.modelArtifacts) return extractWeightSpecs(source.modelArtifacts);
    if (source.checkpoint) return extractWeightSpecs(source.checkpoint);
    return [];
  }

  function describeArtifacts(source, opts) {
    var options = opts || {};
    var checkpoint = (source && source.checkpoint && typeof source.checkpoint === "object") ? source.checkpoint : source;
    var specs = extractWeightSpecs(source);
    var values = extractWeightValues(source);
    var tensorLayout = String(options.tensorLayout || (checkpoint && checkpoint.tensorLayout) || DEFAULT_TENSOR_LAYOUT);
    var producerRuntime = String(options.producerRuntime || (checkpoint && checkpoint.producerRuntime) || "");
    var valueEncoding = String(options.valueEncoding || (checkpoint && checkpoint.valueEncoding) || DEFAULT_VALUE_ENCODING);
    var schemaVersion = String(options.schemaVersion || (checkpoint && (checkpoint.schemaVersion || checkpoint.checkpointSchemaVersion)) || SCHEMA_VERSION);
    return {
      schemaVersion: schemaVersion,
      tensorLayout: tensorLayout,
      valueEncoding: valueEncoding,
      producerRuntime: producerRuntime,
      tensorCount: specs.length,
      totalValues: values ? values.length : 0,
      tensors: specs.map(function (sp) {
        return {
          name: String(sp.name || ""),
          shape: Array.isArray(sp.shape) ? sp.shape.slice() : [],
          dtype: String(sp.dtype || "float32"),
          offset: Number(sp.offset || 0),
          layout: tensorLayout,
          role: _inferTensorRole(sp.name),
        };
      }),
    };
  }

  function normalizeArtifacts(source, opts) {
    if (!source) return null;
    var specs = extractWeightSpecs(source);
    var values = extractWeightValues(source);
    var checkpoint = describeArtifacts(source, opts);
    var out = {
      weightSpecs: specs,
      checkpointSchemaVersion: checkpoint.schemaVersion,
      tensorLayout: checkpoint.tensorLayout,
      valueEncoding: checkpoint.valueEncoding,
      producerRuntime: checkpoint.producerRuntime,
      tensors: checkpoint.tensors,
      checkpoint: checkpoint,
    };
    if (values) out.weightValues = Array.from(values);
    if (source.weightData && source.weightData.byteLength != null) out.weightData = source.weightData;
    return out;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_TENSOR_LAYOUT: DEFAULT_TENSOR_LAYOUT,
    DEFAULT_VALUE_ENCODING: DEFAULT_VALUE_ENCODING,
    extractWeightValues: extractWeightValues,
    extractWeightSpecs: extractWeightSpecs,
    describeArtifacts: describeArtifacts,
    normalizeArtifacts: normalizeArtifacts,
  };
});

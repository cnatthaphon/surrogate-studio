(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCWeightConverter = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Weight Converter — converts weights between PyTorch and TF.js formats.
   *
   * Per-node-type mapping. No network-specific code.
   * All conversions are generalized based on node type.
   *
   * PyTorch → TF.js:
   *   Dense:     transpose kernel [out, in] → [in, out]
   *   LSTM:      swap gates [i,f,g,o] → [i,c,f,o], combine 2 biases → 1, transpose kernels
   *   GRU:       swap gates [r,z,n] → [z,r,n], combine 2 biases → 1, transpose kernels
   *   RNN:       combine 2 biases → 1, transpose kernels
   *   BatchNorm: move running_mean/var to end
   *   LayerNorm: same order
   *   Dropout:   no weights
   */

  // Swap gate blocks in a flat array: reorder chunks of size H
  function _swapGateBlocks(arr, H, fromOrder, toOrder) {
    var chunks = [];
    for (var i = 0; i < fromOrder.length; i++) {
      chunks.push(arr.slice(fromOrder[i] * H, (fromOrder[i] + 1) * H));
    }
    var result = new Float32Array(arr.length);
    for (var j = 0; j < toOrder.length; j++) {
      result.set(chunks[j], toOrder[j] * H);
    }
    // Actually we need to put chunks in toOrder positions
    var out = new Float32Array(arr.length);
    for (var k = 0; k < toOrder.length; k++) {
      var srcChunk = arr.slice(k * H, (k + 1) * H);
      out.set(srcChunk, toOrder[k] * H);
    }
    return out;
  }

  // Transpose 2D array stored as flat [rows * cols] → [cols * rows]
  function _transpose2D(flat, rows, cols) {
    var out = new Float32Array(rows * cols);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        out[c * rows + r] = flat[r * cols + c];
      }
    }
    return out;
  }

  // LSTM gate reorder: PyTorch [i,f,g,o] ↔ TF.js [i,c,f,o]
  // i=input, f=forget, g=cell_candidate(c), o=output
  function _lstmGatesPyToTf(flat4H, H) {
    // [i,f,g,o] → [i,g,f,o] (swap blocks 1 and 2)
    var out = new Float32Array(4 * H);
    out.set(flat4H.slice(0, H), 0);         // i → i
    out.set(flat4H.slice(2 * H, 3 * H), H); // g → c (position 1)
    out.set(flat4H.slice(H, 2 * H), 2 * H); // f → f (position 2)
    out.set(flat4H.slice(3 * H, 4 * H), 3 * H); // o → o
    return out;
  }

  function _lstmGatesTfToPy(flat4H, H) {
    // [i,c,f,o] → [i,f,c,o] (swap blocks 1 and 2)
    var out = new Float32Array(4 * H);
    out.set(flat4H.slice(0, H), 0);         // i → i
    out.set(flat4H.slice(2 * H, 3 * H), H); // f → f (position 1)
    out.set(flat4H.slice(H, 2 * H), 2 * H); // c → g (position 2)
    out.set(flat4H.slice(3 * H, 4 * H), 3 * H); // o → o
    return out;
  }

  // GRU gate reorder: PyTorch [r,z,n] ↔ TF.js [z,r,n]
  function _gruGatesPyToTf(flat3H, H) {
    var out = new Float32Array(3 * H);
    out.set(flat3H.slice(H, 2 * H), 0);     // z → position 0
    out.set(flat3H.slice(0, H), H);          // r → position 1
    out.set(flat3H.slice(2 * H, 3 * H), 2 * H); // n → position 2
    return out;
  }

  function _gruGatesTfToPy(flat3H, H) {
    var out = new Float32Array(3 * H);
    out.set(flat3H.slice(H, 2 * H), 0);     // r → position 0
    out.set(flat3H.slice(0, H), H);          // z → position 1
    out.set(flat3H.slice(2 * H, 3 * H), 2 * H); // n → position 2
    return out;
  }

  /**
   * Convert PyTorch weight specs to TF.js format.
   *
   * @param {Array} pySpecs - [{name, shape, ...}] from PyTorch state_dict
   * @param {Float32Array} pyValues - flat weight values
   * @returns {{ specs: Array, values: Float32Array }}
   */
  function pytorchToTfjs(pySpecs, pyValues) {
    var outSpecs = [];
    var outValues = [];
    var offset = 0;
    var i = 0;
    var deferredRunningStats = []; // BN running stats go at end

    while (i < pySpecs.length) {
      var spec = pySpecs[i];
      var name = spec.name || "";
      var shape = spec.shape || [];
      var size = shape.reduce(function (a, b) { return a * b; }, 1);
      var raw = pyValues.subarray ? pyValues.subarray(offset, offset + size) : new Float32Array(pyValues.slice(offset, offset + size));

      // Skip num_batches_tracked
      if (name.indexOf("num_batches_tracked") >= 0) {
        offset += size;
        i++;
        continue;
      }

      // BatchNorm running stats → defer to end
      if (name.indexOf("running_mean") >= 0 || name.indexOf("running_var") >= 0) {
        deferredRunningStats.push({ name: "tfjs_" + name, shape: shape.slice(), values: Array.from(raw) });
        offset += size;
        i++;
        continue;
      }

      // LSTM: 4 consecutive weights (weight_ih, weight_hh, bias_ih, bias_hh)
      if (name.indexOf("weight_ih_l0") >= 0 && i + 3 < pySpecs.length && pySpecs[i + 1].name.indexOf("weight_hh_l0") >= 0) {
        var wih = pyValues.subarray ? pyValues.subarray(offset, offset + size) : new Float32Array(pyValues.slice(offset, offset + size));
        offset += size;
        var s1 = pySpecs[i + 1]; var sz1 = s1.shape.reduce(function (a, b) { return a * b; }, 1);
        var whh = pyValues.subarray ? pyValues.subarray(offset, offset + sz1) : new Float32Array(pyValues.slice(offset, offset + sz1));
        offset += sz1;
        var s2 = pySpecs[i + 2]; var sz2 = s2.shape.reduce(function (a, b) { return a * b; }, 1);
        var bih = pyValues.subarray ? pyValues.subarray(offset, offset + sz2) : new Float32Array(pyValues.slice(offset, offset + sz2));
        offset += sz2;
        var s3 = pySpecs[i + 3]; var sz3 = s3.shape.reduce(function (a, b) { return a * b; }, 1);
        var bhh = pyValues.subarray ? pyValues.subarray(offset, offset + sz3) : new Float32Array(pyValues.slice(offset, offset + sz3));
        offset += sz3;

        var H = shape[0] / 4; // hidden size
        var inputSize = shape[1];
        var hiddenSize = pySpecs[i + 1].shape[1];
        var isLSTM = name.indexOf("lstm") >= 0 || (H === Math.floor(H) && shape[0] === 4 * H);
        var isGRU = name.indexOf("gru") >= 0 || shape[0] === 3 * Math.floor(shape[0] / 3);

        var gateSwap = isLSTM ? _lstmGatesPyToTf : (isGRU ? _gruGatesPyToTf : function (x) { return x; });
        var gateH = isLSTM ? H : (isGRU ? Math.floor(shape[0] / 3) : shape[0]);

        // kernel: swap gates, then transpose [4H, in] → [in, 4H]
        var swappedIh = gateSwap(new Float32Array(wih), gateH);
        var kernel = _transpose2D(swappedIh, shape[0], inputSize);
        outSpecs.push({ name: "tfjs_kernel", shape: [inputSize, shape[0]] });
        outValues = outValues.concat(Array.from(kernel));

        // recurrent: swap gates, then transpose
        var swappedHh = gateSwap(new Float32Array(whh), gateH);
        var recurrent = _transpose2D(swappedHh, pySpecs[i + 1].shape[0], hiddenSize);
        outSpecs.push({ name: "tfjs_recurrent_kernel", shape: [hiddenSize, pySpecs[i + 1].shape[0]] });
        outValues = outValues.concat(Array.from(recurrent));

        // bias: combine ih + hh, then swap gates
        var combinedBias = new Float32Array(sz2);
        for (var bi = 0; bi < sz2; bi++) combinedBias[bi] = bih[bi] + bhh[bi];
        var swappedBias = gateSwap(combinedBias, gateH);
        outSpecs.push({ name: "tfjs_bias", shape: [sz2] });
        outValues = outValues.concat(Array.from(swappedBias));

        i += 4;
        continue;
      }

      // Conv1D: [out, in, kernel] → [kernel, in, out]
      // Conv2D: [out, in, kH, kW] → [kH, kW, in, out]
      // Conv3D: [out, in, kD, kH, kW] → [kD, kH, kW, in, out]
      if (shape.length === 3 && name.indexOf("conv") >= 0) {
        // Conv1D: [O, I, K] → [K, I, O]
        var O = shape[0], I = shape[1], K = shape[2];
        var conv = new Float32Array(size);
        for (var o = 0; o < O; o++) for (var ii = 0; ii < I; ii++) for (var k = 0; k < K; k++) {
          conv[k * I * O + ii * O + o] = raw[o * I * K + ii * K + k];
        }
        outSpecs.push({ name: "tfjs_" + name, shape: [K, I, O] });
        outValues = outValues.concat(Array.from(conv));
        offset += size; i++; continue;
      }
      if (shape.length === 4 && name.indexOf("conv") >= 0) {
        // Conv2D: [O, I, H, W] → [H, W, I, O]
        var O2 = shape[0], I2 = shape[1], H2 = shape[2], W2 = shape[3];
        var conv2 = new Float32Array(size);
        for (var o2 = 0; o2 < O2; o2++) for (var i2 = 0; i2 < I2; i2++) for (var h2 = 0; h2 < H2; h2++) for (var w2 = 0; w2 < W2; w2++) {
          conv2[h2 * W2 * I2 * O2 + w2 * I2 * O2 + i2 * O2 + o2] = raw[o2 * I2 * H2 * W2 + i2 * H2 * W2 + h2 * W2 + w2];
        }
        outSpecs.push({ name: "tfjs_" + name, shape: [H2, W2, I2, O2] });
        outValues = outValues.concat(Array.from(conv2));
        offset += size; i++; continue;
      }
      if (shape.length === 5 && name.indexOf("conv") >= 0) {
        // Conv3D: [O, I, D, H, W] → [D, H, W, I, O]
        var O3 = shape[0], I3 = shape[1], D3 = shape[2], H3 = shape[3], W3 = shape[4];
        var conv3 = new Float32Array(size);
        for (var o3 = 0; o3 < O3; o3++) for (var i3 = 0; i3 < I3; i3++) for (var d3 = 0; d3 < D3; d3++) for (var h3 = 0; h3 < H3; h3++) for (var w3 = 0; w3 < W3; w3++) {
          conv3[d3*H3*W3*I3*O3 + h3*W3*I3*O3 + w3*I3*O3 + i3*O3 + o3] = raw[o3*I3*D3*H3*W3 + i3*D3*H3*W3 + d3*H3*W3 + h3*W3 + w3];
        }
        outSpecs.push({ name: "tfjs_" + name, shape: [D3, H3, W3, I3, O3] });
        outValues = outValues.concat(Array.from(conv3));
        offset += size; i++; continue;
      }

      // Dense/Linear: transpose 2D
      if (shape.length === 2) {
        var transposed = _transpose2D(new Float32Array(raw), shape[0], shape[1]);
        outSpecs.push({ name: "tfjs_" + name, shape: [shape[1], shape[0]] });
        outValues = outValues.concat(Array.from(transposed));
      } else {
        // 1D (bias, BN gamma/beta, LN gamma/beta)
        outSpecs.push({ name: "tfjs_" + name, shape: shape.slice() });
        outValues = outValues.concat(Array.from(raw));
      }

      offset += size;
      i++;
    }

    // Append deferred BN running stats at end (matching TF.js order)
    deferredRunningStats.forEach(function (stat) {
      outSpecs.push({ name: stat.name, shape: stat.shape });
      outValues = outValues.concat(stat.values);
    });

    return { specs: outSpecs, values: new Float32Array(outValues) };
  }

  /**
   * Detect if weight specs are from PyTorch (by naming convention).
   */
  function isPytorchWeights(specs) {
    if (!specs || !specs.length) return false;
    return specs.some(function (s) {
      var n = s.name || "";
      return n.match(/^\d+\./) || n.indexOf("weight_ih") >= 0 || n.indexOf("rnn_") >= 0 || n.indexOf("dense_") >= 0 && n.indexOf("Dense") < 0;
    });
  }

  return {
    pytorchToTfjs: pytorchToTfjs,
    isPytorchWeights: isPytorchWeights,
    _transpose2D: _transpose2D,
    _lstmGatesPyToTf: _lstmGatesPyToTf,
    _lstmGatesTfToPy: _lstmGatesTfToPy,
    _gruGatesPyToTf: _gruGatesPyToTf,
    _gruGatesTfToPy: _gruGatesTfToPy,
  };
});

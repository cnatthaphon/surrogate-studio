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
   *   LSTM:      combine 2 biases → 1, transpose kernels. Gate order
   *              [i,f,g,o] is the same as Keras/TF.js [i,f,c,o] — no
   *              reorder needed. (Verified: scripts/test_lstm_gate_parity.py)
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

  // PyTorch LSTM gate order [i, f, g, o] is identical to Keras/TF.js
  // [i, f, c, o] — Keras's "c" is the cell-candidate gate, the same gate
  // PyTorch calls "g". No reorder needed. These functions are kept as
  // identities for source-level documentation and so callers don't have
  // to special-case LSTM.
  //
  // History: earlier code applied [i,f,g,o] → [i,g,f,o] in both
  // directions, breaking LSTM inference end-to-end. Verified by
  // scripts/test_lstm_gate_parity.py — without the swap the PyTorch
  // and TF.js outputs match to ~1e-8.
  function _lstmGatesPyToTf(flat4H /*, H */) { return flat4H; }
  function _lstmGatesTfToPy(flat4H /*, H */) { return flat4H; }

  // GRU gate reorder: PyTorch [r,z,n] ↔ TF.js [z,r,n].
  //
  // Works for either:
  //   1D bias  [3*H]            (chunk = H)
  //   2D kernel [3*H, in_dim] flattened row-major (chunk = H*in_dim)
  // Chunk size is derived from total length so the same helper handles
  // both. The H parameter is kept for readable callers but ignored —
  // earlier code hardcoded chunk=H, silently truncating kernel data
  // to the first 3*H floats and producing garbage for any GRU kernel
  // wider than 1.
  function _gruGatesPyToTf(flat, _H) {
    var total = flat.length;
    var chunk = (total / 3) | 0;
    var out = new Float32Array(total);
    out.set(flat.slice(chunk, 2 * chunk), 0);          // z (pyChunk[1]) → position 0
    out.set(flat.slice(0, chunk), chunk);              // r (pyChunk[0]) → position 1
    out.set(flat.slice(2 * chunk, 3 * chunk), 2 * chunk); // n (pyChunk[2]) → position 2
    return out;
  }

  function _gruGatesTfToPy(flat, _H) {
    var total = flat.length;
    var chunk = (total / 3) | 0;
    var out = new Float32Array(total);
    out.set(flat.slice(chunk, 2 * chunk), 0);          // r (tfChunk[1]) → position 0
    out.set(flat.slice(0, chunk), chunk);              // z (tfChunk[0]) → position 1
    out.set(flat.slice(2 * chunk, 3 * chunk), 2 * chunk); // n (tfChunk[2]) → position 2
    return out;
  }

  function _stripSuffix(name) {
    return String(name || "").replace(/_\d+$/, "");
  }

  function _sameShape(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (Number(a[i]) !== Number(b[i])) return false;
    return true;
  }

  // Canonicalize a weight name to its browser-side equivalent. Returns a
  // single string for layers whose name maps unambiguously, or an Array of
  // candidates when the browser may use multiple naming conventions for the
  // same logical layer (notably output heads — see _aliasesFor below).
  // Callers should treat the result as "any of these matches".
  function canonicalizeWeightName(rawName) {
    var aliases = _aliasesFor(rawName);
    return aliases.length === 1 ? aliases[0] : aliases;
  }

  function _aliasesFor(rawName) {
    var name = _stripSuffix(rawName);
    if (!name) return [""];
    if (name.indexOf("tfjs_") === 0) name = name.slice(5);
    if (name.indexOf("/") >= 0) return [_stripSuffix(name)];

    // Server exports output-layer weights as `out_<id>.weight|bias`. The
    // browser-side model_builder gives the same logical layer either
    // `n<id>/kernel|bias` (when the output is a passthrough Dense built like
    // the encoder denses) OR `head_<id>/kernel|bias` (when the output is
    // built as a discriminator/classifier head). Without including BOTH
    // candidates, classifier-output weights fail the name match — load
    // falls through to positional, and on branched VAE+Classifier graphs
    // positional order doesn't line up with the browser's topological order
    // (classifier weights end up assigned to recon-path layers, classifier
    // output becomes constant, gradient through the latent is zero, and
    // classifier-guided generation can't steer at all).
    var m = name.match(/^out_(\d+)\.(weight|bias)$/);
    if (m) {
      var tail = m[2] === "weight" ? "kernel" : "bias";
      return ["head_" + m[1] + "/" + tail, "n" + m[1] + "/" + tail];
    }

    m = name.match(/^(dense|conv1d|conv2d|convt2d|embed)_(\d+)\.(weight|bias)$/);
    if (m) return ["n" + m[2] + "/" + (m[3] === "weight" ? "kernel" : "bias")];

    m = name.match(/^pe_proj_(\d+)\.(weight|bias)$/);
    if (m) return ["n" + m[1] + "_proj/" + (m[2] === "weight" ? "kernel" : "bias")];

    m = name.match(/^tb_(ln1|ln2)_(\d+)\.(weight|bias)$/);
    if (m) return ["n" + m[2] + "_" + m[1] + "/" + (m[3] === "weight" ? "gamma" : "beta")];

    m = name.match(/^tb_(q|k|v|attn_proj|ffn1|ffn2)_(\d+)\.(weight|bias)$/);
    if (m) return ["n" + m[2] + "_" + m[1] + "/" + (m[3] === "weight" ? "kernel" : "bias")];

    m = name.match(/^(bn|ln)_(\d+)\.(weight|bias|running_mean|running_var)$/);
    if (m) {
      var tailMap = {
        weight: "gamma",
        bias: "beta",
        running_mean: "moving_mean",
        running_var: "moving_variance",
      };
      return ["n" + m[2] + "/" + tailMap[m[3]]];
    }

    m = name.match(/^(rnn|gru|lstm)_(\d+)\.(kernel|recurrent_kernel|bias)$/);
    if (m) return ["n" + m[2] + "/" + m[3]];

    return [name];
  }

  function extractWeightValues(artifacts) {
    if (!artifacts) return null;
    if (artifacts.weightValues && Array.isArray(artifacts.weightValues)) return new Float32Array(artifacts.weightValues);
    if (artifacts.weightData && artifacts.weightData.byteLength) return new Float32Array(artifacts.weightData);
    return null;
  }

  function loadArtifactsIntoModel(tf, model, artifacts) {
    if (!tf || !model || !artifacts) return { loaded: false, reason: "missing_inputs" };
    var values = extractWeightValues(artifacts);
    if (!values) return { loaded: false, reason: "missing_weight_values" };
    var specs = Array.isArray(artifacts.weightSpecs) ? artifacts.weightSpecs.slice() : [];

    if (isPytorchWeights(specs)) {
      var converted = pytorchToTfjs(specs, values);
      specs = converted.specs || [];
      values = converted.values || values;
    }

    var modelWeights = model.weights || [];
    var current = model.getWeights();
    var matched = 0;
    var namedSpecs = 0;
    var offset = 0;
    var savedMap = {};
    var matchedSpecKeys = {};

    specs.forEach(function (sp, idx) {
      var shape = Array.isArray(sp.shape) ? sp.shape.slice() : [];
      var size = shape.reduce(function (a, b) { return a * b; }, 1);
      // canonicalizeWeightName returns either a string or an array of candidate
      // browser-side names. Register the spec under every alias so the lookup
      // below can match whichever convention the browser model used.
      var keys = _aliasesFor(sp.name || "").filter(Boolean);
      if (keys.length) {
        namedSpecs++;
        var entry = { offset: offset, size: size, shape: shape, rawName: sp.name || "", index: idx, primaryKey: keys[0] };
        keys.forEach(function (k) { if (k && !savedMap[k]) savedMap[k] = entry; });
      }
      offset += size;
    });

    if (namedSpecs > 0 && modelWeights.length) {
      for (var i = 0; i < modelWeights.length; i++) {
        var mw = modelWeights[i];
        var mwAliases = _aliasesFor(mw.name).filter(Boolean);
        var saved = null;
        var matchedKey = null;
        for (var ai = 0; ai < mwAliases.length; ai++) {
          if (savedMap[mwAliases[ai]]) {
            saved = savedMap[mwAliases[ai]];
            matchedKey = mwAliases[ai];
            break;
          }
        }
        if (!saved) continue;
        var expectedSize = mw.shape.reduce(function (a, b) { return a * b; }, 1);
        if (saved.size !== expectedSize) continue;
        if (saved.shape.length && !_sameShape(saved.shape, mw.shape)) continue;
        current[i] = tf.tensor(values.subarray(saved.offset, saved.offset + saved.size), mw.shape);
        matched++;
        // Track the spec's PRIMARY key (the spec was registered under all its
        // aliases, but for the "all named specs matched" check we want one
        // entry per unique spec, not per alias).
        matchedSpecKeys[saved.primaryKey || matchedKey] = true;
      }
      var matchedNamedSpecs = Object.keys(matchedSpecKeys).length;
      if (matchedNamedSpecs === namedSpecs && matched > 0) {
        model.setWeights(current);
        return {
          loaded: true,
          mode: "name",
          matched: matched,
          namedSpecs: namedSpecs,
          totalModelWeights: modelWeights.length,
        };
      }
    }

    // Fallback: positional slice copy for legacy artifacts without usable names.
    var mwVals = model.getWeights();
    var out = [];
    var off2 = 0;
    for (var wi = 0; wi < mwVals.length; wi++) {
      var sz = mwVals[wi].shape.reduce(function (a, b) { return a * b; }, 1);
      if (off2 + sz > values.length) break;
      out.push(tf.tensor(values.subarray(off2, off2 + sz), mwVals[wi].shape));
      off2 += sz;
    }
    if (out.length === mwVals.length) {
      model.setWeights(out);
      return {
        loaded: true,
        mode: "positional",
        matched: out.length,
        namedSpecs: namedSpecs,
        totalModelWeights: mwVals.length,
      };
    }
    return {
      loaded: false,
      reason: "weight_count_mismatch",
      matched: matched,
      namedSpecs: namedSpecs,
      totalModelWeights: modelWeights.length || mwVals.length || 0,
    };
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

        var inputSize = shape[1];
        var hiddenSize = pySpecs[i + 1].shape[1];
        // Derive gate count from the recurrent_kernel: PyTorch lays out
        // weight_hh_l0 as [gates*H, H], so shape[0] / hiddenSize is the
        // gate ratio (3 for GRU, 4 for LSTM, 1 for vanilla RNN). This is
        // the only reliable signal — name hints can be missing, and the
        // older shape[0]/4 vs shape[0]/3 divisibility heuristic
        // mis-classifies GRU as LSTM whenever H is divisible by 4 (e.g.
        // H=8 means shape[0]=24 satisfies both 4*6 and 3*8). When both
        // win the ternary picked LSTM and produced wrong-but-loadable
        // weights — caught by Codex with HIDDEN=8 reproduction.
        var gateRatio = hiddenSize > 0 ? Math.round(shape[0] / hiddenSize) : 0;
        var isLSTM = gateRatio === 4;
        var isGRU = gateRatio === 3;
        var H = hiddenSize;

        var gateSwap = isLSTM ? _lstmGatesPyToTf : (isGRU ? _gruGatesPyToTf : function (x) { return x; });
        var gateH = H;

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

        if (isGRU) {
          // GRU under GRUResetAfterLayer expects bias [2, 3*H]:
          //   row 0 = b_ih (gate-swapped), row 1 = b_hh (gate-swapped).
          // resetAfter=True keeps b_ih and b_hh asymmetric — combining
          // them would only match resetAfter=False semantics. The custom
          // browser layer slices both rows separately during forward.
          var swappedBih = gateSwap(new Float32Array(bih), gateH);
          var swappedBhh = gateSwap(new Float32Array(bhh), gateH);
          var bias2x = new Float32Array(2 * sz2);
          bias2x.set(swappedBih, 0);
          bias2x.set(swappedBhh, sz2);
          outSpecs.push({ name: "tfjs_bias", shape: [2, sz2] });
          outValues = outValues.concat(Array.from(bias2x));
        } else {
          // LSTM (and any other non-GRU recurrent): tf.layers.lstm
          // accepts a single combined bias [4*H], so fold ih + hh.
          var combinedBias = new Float32Array(sz2);
          for (var bi = 0; bi < sz2; bi++) combinedBias[bi] = bih[bi] + bhh[bi];
          var swappedBias = gateSwap(combinedBias, gateH);
          outSpecs.push({ name: "tfjs_bias", shape: [sz2] });
          outValues = outValues.concat(Array.from(swappedBias));
        }

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
      if (shape.length === 4 && (name.indexOf("conv") >= 0 || name.indexOf("pe_proj_") === 0)) {
        // Conv2D: [O, I, H, W] → [H, W, I, O]
        // (Same formula works for Conv2DTranspose by symmetry: PyTorch's
        // ConvTranspose2d weights are [I, O, H, W] and TF.js's
        // tf.conv2dTranspose kernel is [H, W, outDepth=O, inDepth=I] —
        // re-labeling shape[0]/shape[1] flips both source and destination,
        // so the same memory permutation applies. Verified against
        // tfjs-core's conv2dTranspose docs: filter layout
        // [filterH, filterW, outDepth, inDepth].)
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
      if (n.indexOf("tfjs_") === 0 || n.indexOf("/") >= 0) return false;
      return n.match(/^\d+\./) ||
        n.indexOf("weight_ih") >= 0 ||
        n.indexOf("weight_hh") >= 0 ||
        n.indexOf("rnn_") >= 0 ||
        n.indexOf("pe_proj_") === 0 ||
        n.indexOf("tb_") === 0;
    });
  }

  return {
    pytorchToTfjs: pytorchToTfjs,
    isPytorchWeights: isPytorchWeights,
    canonicalizeWeightName: canonicalizeWeightName,
    extractWeightValues: extractWeightValues,
    loadArtifactsIntoModel: loadArtifactsIntoModel,
    _transpose2D: _transpose2D,
    _lstmGatesPyToTf: _lstmGatesPyToTf,
    _lstmGatesTfToPy: _lstmGatesTfToPy,
    _gruGatesPyToTf: _gruGatesPyToTf,
    _gruGatesTfToPy: _gruGatesTfToPy,
  };
});

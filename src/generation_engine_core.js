(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCGenerationEngineCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Unified generation engine.
   *
   * All generative methods share one loop:
   *   z₀ = init(method)
   *   for step in 1..N: z_{t+1} = z_t - lr * ∇objective(z_t)
   *   output = decode(z_N)
   *
   * Methods:
   *   "random"    — sample z ~ N(0,1), decode once (0 optimization steps)
   *   "langevin"  — iterative: x_{t+1} = x_t + ε/2 * ∇log p(x_t) + √ε * noise
   *   "optimize"  — gradient descent on z to minimize objective (reconstruction, discriminator, etc.)
   *   "inverse"   — optimize input x to minimize ||model(x) - target||²
   *   "ddpm"      — iterative denoising from x_T ~ N(0,1) through T steps
   */

  // --- helpers ---
  function clampInt(v, lo, hi) { var n = Math.floor(Number(v)); return n < lo ? lo : n > hi ? hi : n; }

  /**
   * generate(tf, config) → Promise<{ samples, latents, lossHistory, method }>
   *
   * config:
   *   .method      — "random" | "langevin" | "optimize" | "inverse" | "ddpm"
   *   .model       — tf.LayersModel (full model or decoder)
   *   .latentDim   — integer, dimension of latent space
   *   .numSamples  — how many samples to generate (default 16)
   *   .steps       — optimization/sampling steps (default 0 for random, 100 for optimize)
   *   .lr          — learning rate (default 0.01)
   *   .temperature — sampling temperature / noise scale (default 1.0)
   *   .seed        — random seed (default 42)
   *   .objective   — function(tf, z, model) → scalar tensor (loss to minimize)
   *   .target      — target output for inverse mode (array or tensor)
   *   .scoreModel  — score network for Langevin (optional, uses .model if not provided)
   *   .noiseSchedule — array of noise levels for Langevin/DDPM (optional)
   *   .onStep      — callback(stepIdx, loss) for progress reporting
   *   .batchSize   — batch size for generation (default = numSamples)
   */
  function generate(tf, config) {
    var cfg = config || {};
    var method = String(cfg.method || "random").toLowerCase();
    var numSamples = clampInt(cfg.numSamples || 16, 1, 10000);
    var latentDim = clampInt(cfg.latentDim || 16, 1, 10000);
    var steps = cfg.steps != null ? clampInt(cfg.steps, 0, 100000) : (method === "random" ? 0 : 100);
    var lr = Number(cfg.lr || 0.01);
    var temperature = Number(cfg.temperature || 1.0);
    var onStep = typeof cfg.onStep === "function" ? cfg.onStep : null;

    if (method === "random") {
      return _generateRandom(tf, cfg, numSamples, latentDim, temperature);
    }
    if (method === "langevin") {
      return _generateLangevin(tf, cfg, numSamples, latentDim, steps, lr, temperature, onStep);
    }
    if (method === "optimize") {
      return _generateOptimize(tf, cfg, numSamples, latentDim, steps, lr, temperature, onStep);
    }
    if (method === "inverse") {
      return _generateInverse(tf, cfg, steps, lr, onStep);
    }
    if (method === "ddpm") {
      return _generateDDPM(tf, cfg, numSamples, latentDim, steps, onStep);
    }
    if (method === "reconstruct") {
      return _generateReconstruct(tf, cfg, numSamples);
    }
    if (method === "classifier_guided") {
      // use optimize method with classifier guidance objective
      if (!cfg.classifierModel) return Promise.reject(new Error("classifier_guided requires classifierModel"));
      var targetClass = cfg.targetClass || 0;
      var guidanceWeight = cfg.guidanceWeight || 1.0;
      cfg.objective = objectives.classifierGuidance(cfg.classifierModel, targetClass, guidanceWeight);
      cfg.method = "optimize";
      return _generateOptimize(tf, cfg, numSamples, latentDim, steps, lr, temperature, onStep);
    }

    return Promise.reject(new Error("Unknown generation method: " + method));
  }

  // === RANDOM: z ~ N(0,1) → decoder(z) ===
  function _generateRandom(tf, cfg, numSamples, latentDim, temperature) {
    return new Promise(function (resolve) {
      var model = cfg.model;
      if (!model) throw new Error("generation: model required");

      var z = tf.randomNormal([numSamples, latentDim], 0, temperature);
      var output = model.predict(z);
      var samples = (Array.isArray(output) ? output[0] : output).arraySync();
      var latents = z.arraySync();

      z.dispose();
      if (Array.isArray(output)) output.forEach(function (t) { t.dispose(); }); else output.dispose();

      resolve({
        method: "random",
        samples: samples,
        latents: latents,
        lossHistory: [],
        numSamples: numSamples,
        latentDim: latentDim,
      });
    });
  }

  // === LANGEVIN: x_{t+1} = x_t + ε/2 * score(x_t) + √ε * noise ===
  function _generateLangevin(tf, cfg, numSamples, dim, steps, lr, temperature, onStep) {
    return new Promise(function (resolve) {
      var scoreModel = cfg.scoreModel || cfg.model;
      if (!scoreModel) throw new Error("generation: model/scoreModel required for Langevin");

      var noiseSchedule = cfg.noiseSchedule || null;
      var epsilon = lr;
      var lossHistory = [];

      // init from noise
      var x = tf.variable(tf.randomNormal([numSamples, dim], 0, temperature));

      for (var step = 0; step < steps; step++) {
        var sigma = noiseSchedule ? noiseSchedule[Math.min(step, noiseSchedule.length - 1)] : 1.0;

        // compute score (gradient of log p(x))
        var gradFn = tf.grad(function (xIn) {
          var pred = scoreModel.predict(xIn);
          var score = Array.isArray(pred) ? pred[0] : pred;
          return score.mean(); // scalar score estimate
        });
        var grad = gradFn(x);

        // Langevin update: x += ε/2 * score + √ε * noise
        var noise = tf.randomNormal(x.shape, 0, Math.sqrt(epsilon) * sigma);
        var update = x.add(grad.mul(epsilon / 2)).add(noise);
        x.assign(update);

        var lossVal = grad.abs().mean().arraySync();
        lossHistory.push({ step: step, loss: lossVal });
        if (onStep) onStep(step, lossVal);

        grad.dispose();
        noise.dispose();
        update.dispose();
      }

      var samples = x.arraySync();
      var result = {
        method: "langevin",
        samples: samples,
        latents: samples, // in Langevin, samples ARE the latents (data space)
        lossHistory: lossHistory,
        numSamples: numSamples,
        latentDim: dim,
      };
      x.dispose();
      resolve(result);
    });
  }

  // === OPTIMIZE: z₀ ~ N(0,1), minimize objective(z) via gradient descent ===
  function _generateOptimize(tf, cfg, numSamples, latentDim, steps, lr, temperature, onStep) {
    return new Promise(function (resolve) {
      var model = cfg.model;
      var objective = cfg.objective;
      if (!model) throw new Error("generation: model required for optimize");
      if (!objective) throw new Error("generation: objective function required for optimize");

      var lossHistory = [];

      // init z from noise
      var z = tf.variable(tf.randomNormal([numSamples, latentDim], 0, temperature));
      var optimizer = tf.train.adam(lr);

      for (var step = 0; step < steps; step++) {
        var lossVal;
        optimizer.minimize(function () {
          var loss = objective(tf, z, model);
          lossVal = loss.arraySync();
          return loss;
        }, true, [z]);

        lossHistory.push({ step: step, loss: lossVal });
        if (onStep) onStep(step, lossVal);
      }

      // final decode
      var output = model.predict(z);
      var samples = (Array.isArray(output) ? output[0] : output).arraySync();
      var latents = z.arraySync();

      var result = {
        method: "optimize",
        samples: samples,
        latents: latents,
        lossHistory: lossHistory,
        numSamples: numSamples,
        latentDim: latentDim,
      };
      z.dispose();
      optimizer.dispose();
      if (Array.isArray(output)) output.forEach(function (t) { t.dispose(); }); else output.dispose();
      resolve(result);
    });
  }

  // === INVERSE: optimize input x to minimize ||model(x) - target||² ===
  function _generateInverse(tf, cfg, steps, lr, onStep) {
    return new Promise(function (resolve) {
      var model = cfg.model;
      var target = cfg.target;
      if (!model) throw new Error("generation: model required for inverse");
      if (!target) throw new Error("generation: target required for inverse");

      var targetTensor = target instanceof tf.Tensor ? target : tf.tensor(target);
      var inputShape = model.inputs[0].shape.slice(1); // remove batch dim
      var numSamples = targetTensor.shape[0] || 1;
      var lossHistory = [];

      // init x from small random
      var x = tf.variable(tf.randomNormal([numSamples].concat(inputShape), 0, 0.1));
      var optimizer = tf.train.adam(lr);

      for (var step = 0; step < steps; step++) {
        var lossVal;
        optimizer.minimize(function () {
          var pred = model.predict(x);
          var predOut = Array.isArray(pred) ? pred[0] : pred;
          var loss = predOut.sub(targetTensor).square().mean();
          lossVal = loss.arraySync();
          return loss;
        }, true, [x]);

        lossHistory.push({ step: step, loss: lossVal });
        if (onStep) onStep(step, lossVal);
      }

      var optimizedInput = x.arraySync();
      var finalOutput = model.predict(x);
      var samples = (Array.isArray(finalOutput) ? finalOutput[0] : finalOutput).arraySync();

      var result = {
        method: "inverse",
        samples: samples,
        latents: optimizedInput,
        lossHistory: lossHistory,
        numSamples: numSamples,
        latentDim: inputShape.reduce(function (a, b) { return a * b; }, 1),
        optimizedInput: optimizedInput,
      };
      x.dispose();
      optimizer.dispose();
      targetTensor.dispose();
      if (Array.isArray(finalOutput)) finalOutput.forEach(function (t) { t.dispose(); }); else finalOutput.dispose();
      resolve(result);
    });
  }

  // === DDPM: iterative denoising from x_T ~ N(0,1) ===
  function _generateDDPM(tf, cfg, numSamples, dim, steps, onStep) {
    return new Promise(function (resolve) {
      var model = cfg.model; // denoiser: takes [x_t, t_normalized] → predicted noise
      if (!model) throw new Error("generation: denoiser model required for DDPM");

      var T = steps;
      var lossHistory = [];

      // linear beta schedule
      var betaStart = cfg.betaStart || 0.0001;
      var betaEnd = cfg.betaEnd || 0.02;
      var betas = [];
      for (var i = 0; i < T; i++) betas.push(betaStart + (betaEnd - betaStart) * i / (T - 1));
      var alphas = betas.map(function (b) { return 1 - b; });
      var alphasCumprod = [];
      var cumProd = 1;
      for (var j = 0; j < T; j++) { cumProd *= alphas[j]; alphasCumprod.push(cumProd); }

      // start from pure noise
      var xT = tf.randomNormal([numSamples, dim]);
      var x = xT;

      // reverse diffusion
      for (var t = T - 1; t >= 0; t--) {
        var tNorm = tf.fill([numSamples, 1], t / T);
        var input = x.concat(tNorm, 1); // [x_t, t_normalized]
        var predictedNoise = model.predict(input);
        var eps = Array.isArray(predictedNoise) ? predictedNoise[0] : predictedNoise;

        var alpha = alphas[t];
        var alphaCum = alphasCumprod[t];
        var scale = 1 / Math.sqrt(alpha);
        var noiseCoeff = (1 - alpha) / Math.sqrt(1 - alphaCum);

        // x_{t-1} = 1/√α_t * (x_t - (1-α_t)/√(1-ᾱ_t) * ε_θ) + σ_t * z
        var xPrev = x.sub(eps.mul(noiseCoeff)).mul(scale);
        if (t > 0) {
          var sigma = Math.sqrt(betas[t]);
          var z = tf.randomNormal(x.shape, 0, sigma);
          var xWithNoise = xPrev.add(z);
          z.dispose();
          xPrev.dispose();
          xPrev = xWithNoise;
        }

        tNorm.dispose();
        input.dispose();
        if (Array.isArray(predictedNoise)) predictedNoise.forEach(function (pt) { pt.dispose(); }); else predictedNoise.dispose();
        if (x !== xT || t < T - 1) x.dispose();
        x = xPrev;

        if (onStep) onStep(T - 1 - t, 0);
        lossHistory.push({ step: T - 1 - t, loss: 0 });
      }

      var samples = x.arraySync();
      x.dispose();
      xT.dispose();

      resolve({
        method: "ddpm",
        samples: samples,
        latents: [],
        lossHistory: lossHistory,
        numSamples: numSamples,
        latentDim: dim,
      });
    });
  }

  // === RECONSTRUCT: pass real inputs through full model, compare input vs output ===
  function _generateReconstruct(tf, cfg, numSamples) {
    return new Promise(function (resolve) {
      var model = cfg.fullModel || cfg.model;
      if (!model) throw new Error("generation: model required for reconstruct");
      var originals = cfg.originals;
      if (!originals || !originals.length) throw new Error("generation: originals (real data) required for reconstruct");

      var n = Math.min(numSamples, originals.length);
      var inputArr = originals.slice(0, n);
      var inputTensor = tf.tensor2d(inputArr);
      var output = model.predict(inputTensor);
      var reconstructed = (Array.isArray(output) ? output[0] : output).arraySync();

      // per-sample MSE
      var metrics = [];
      for (var i = 0; i < n; i++) {
        var mse = 0;
        for (var j = 0; j < inputArr[i].length; j++) {
          var d = inputArr[i][j] - reconstructed[i][j];
          mse += d * d;
        }
        mse /= inputArr[i].length;
        metrics.push({ idx: i, mse: mse });
      }
      var avgMse = metrics.reduce(function (s, m) { return s + m.mse; }, 0) / n;

      inputTensor.dispose();
      if (Array.isArray(output)) output.forEach(function (t) { t.dispose(); }); else output.dispose();

      resolve({
        method: "reconstruct",
        samples: reconstructed,
        originals: inputArr,
        latents: [],
        lossHistory: [],
        numSamples: n,
        latentDim: inputArr[0].length,
        metrics: metrics,
        avgMse: avgMse,
      });
    });
  }

  // === Preset objective functions ===
  var objectives = {
    // reconstruction: ||decode(z) - target||²
    reconstruction: function (target) {
      var tArr = target;
      return function (tf, z, model) {
        var targetT = tf.tensor(tArr);
        var pred = model.predict(z);
        var out = Array.isArray(pred) ? pred[0] : pred;
        var loss = out.sub(targetT).square().mean();
        targetT.dispose();
        return loss;
      };
    },

    // discriminator: maximize D(decode(z)) → minimize -D(decode(z))
    discriminator: function (discriminatorModel) {
      return function (tf, z, decoderModel) {
        var generated = decoderModel.predict(z);
        var genOut = Array.isArray(generated) ? generated[0] : generated;
        var dScore = discriminatorModel.predict(genOut);
        var dOut = Array.isArray(dScore) ? dScore[0] : dScore;
        return dOut.mean().neg(); // minimize negative discriminator score
      };
    },

    // classifierGuidance: optimize z so decoded output is classified as targetClass
    // classifierModel: trained classifier that maps input → class probabilities
    // targetClass: integer class index to maximize
    // weight: how much to weight guidance vs reconstruction
    classifierGuidance: function (classifierModel, targetClass, weight) {
      var cls = targetClass || 0;
      var w = weight || 1.0;
      return function (tf, z, decoderModel) {
        var generated = decoderModel.predict(z);
        var genOut = Array.isArray(generated) ? generated[0] : generated;
        var classProbs = classifierModel.predict(genOut);
        var probs = Array.isArray(classProbs) ? classProbs[0] : classProbs;
        // maximize log P(targetClass) → minimize -log P(targetClass)
        var targetProb = probs.gather([cls], 1).mean();
        return targetProb.log().neg().mul(w);
      };
    },

    // classifierGuidedReconstruction: combine reconstruction + classifier guidance
    // reconstructs toward target while steering to target class
    classifierGuidedReconstruction: function (classifierModel, targetClass, target, guidanceWeight) {
      var cls = targetClass || 0;
      var gw = guidanceWeight || 0.5;
      var tArr = target;
      return function (tf, z, decoderModel) {
        var generated = decoderModel.predict(z);
        var genOut = Array.isArray(generated) ? generated[0] : generated;
        // reconstruction loss
        var reconLoss = tf.scalar(0);
        if (tArr) {
          var targetT = tf.tensor(tArr);
          reconLoss = genOut.sub(targetT).square().mean();
          targetT.dispose();
        }
        // classifier guidance loss
        var classProbs = classifierModel.predict(genOut);
        var probs = Array.isArray(classProbs) ? classProbs[0] : classProbs;
        var guidanceLoss = probs.gather([cls], 1).mean().log().neg();
        return reconLoss.add(guidanceLoss.mul(gw));
      };
    },

    // diversity: maximize pairwise distance between generated samples
    diversity: function () {
      return function (tf, z, model) {
        var pred = model.predict(z);
        var out = Array.isArray(pred) ? pred[0] : pred;
        // pairwise distance: mean ||xi - xj||²
        var expanded1 = out.expandDims(1); // [N,1,D]
        var expanded2 = out.expandDims(0); // [1,N,D]
        var dist = expanded1.sub(expanded2).square().sum(-1).mean();
        return dist.neg(); // minimize negative distance = maximize distance
      };
    },

    // combined: weighted sum of multiple objectives
    combined: function (objectiveList, weights) {
      return function (tf, z, model) {
        var totalLoss = tf.scalar(0);
        for (var i = 0; i < objectiveList.length; i++) {
          var w = weights && weights[i] != null ? weights[i] : 1.0;
          var loss = objectiveList[i](tf, z, model);
          totalLoss = totalLoss.add(loss.mul(w));
        }
        return totalLoss;
      };
    },
  };

  // === Detect generation capabilities from model family ===
  function detectCapabilities(modelFamily) {
    var family = String(modelFamily || "supervised").toLowerCase();
    var caps = {
      family: family,
      canReconstruct: family === "vae" || family === "supervised" || family === "diffusion",
      canRandomSample: family === "vae" || family === "gan",
      canClassifierGuide: family === "vae",
      canLangevin: family === "diffusion",
      canOptimize: family === "vae",
      canInverse: family === "supervised",
      canDDPM: family === "diffusion",
      defaultMethod: family === "vae" ? "reconstruct" : family === "diffusion" ? "langevin" : family === "gan" ? "random" : "reconstruct",
      availableMethods: [],
    };
    if (caps.canReconstruct) caps.availableMethods.push({ id: "reconstruct", label: "Reconstruct (input → model → output)" });
    if (caps.canRandomSample) caps.availableMethods.push({ id: "random", label: "Random Sampling (z ~ N(0,1))" });
    if (caps.canClassifierGuide) caps.availableMethods.push({ id: "classifier_guided", label: "Classifier-Guided Sampling" });
    if (caps.canOptimize) caps.availableMethods.push({ id: "optimize", label: "Latent Optimization" });
    if (caps.canLangevin) caps.availableMethods.push({ id: "langevin", label: "Langevin Dynamics" });
    if (caps.canDDPM) caps.availableMethods.push({ id: "ddpm", label: "DDPM Denoising" });
    if (caps.canInverse) caps.availableMethods.push({ id: "inverse", label: "Inverse / Transfer Learning" });
    return caps;
  }

  return {
    generate: generate,
    objectives: objectives,
    detectCapabilities: detectCapabilities,
  };
});

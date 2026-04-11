(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
    return;
  }
  var pack = factory(root);
  root.OSCDatasetModuleTextClassification = pack;
  if (root.OSCDatasetModules && typeof root.OSCDatasetModules.registerModules === "function") {
    root.OSCDatasetModules.registerModules(pack.modules || []);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  // Simple synthetic sentiment dataset
  // Vocabulary of ~200 words, sentences of 3-8 words, binary sentiment

  var POSITIVE_WORDS = [
    "good", "great", "excellent", "amazing", "wonderful", "fantastic", "love",
    "best", "happy", "beautiful", "perfect", "brilliant", "enjoy", "nice",
    "awesome", "outstanding", "superb", "impressive", "delightful", "pleasant",
    "remarkable", "splendid", "terrific", "magnificent", "fabulous", "marvelous",
    "charming", "elegant", "graceful", "stunning", "exciting", "inspiring",
  ];
  var NEGATIVE_WORDS = [
    "bad", "terrible", "awful", "horrible", "worst", "hate", "ugly",
    "boring", "dull", "poor", "weak", "disappointing", "annoying", "stupid",
    "disgusting", "pathetic", "useless", "miserable", "dreadful", "lousy",
    "mediocre", "bland", "tedious", "frustrating", "painful", "unpleasant",
    "clumsy", "sloppy", "dismal", "appalling", "atrocious", "abysmal",
  ];
  var NEUTRAL_WORDS = [
    "the", "a", "is", "was", "it", "this", "that", "very", "really", "quite",
    "movie", "film", "book", "story", "show", "food", "place", "thing", "work",
    "experience", "product", "service", "quality", "design", "performance",
    "i", "we", "they", "my", "our", "their", "have", "had", "been", "will",
    "would", "could", "should", "not", "no", "never", "always", "so", "too",
    "much", "many", "some", "all", "every", "each", "most", "just", "only",
  ];

  var ALL_WORDS = [].concat(["<pad>", "<unk>"], POSITIVE_WORDS, NEGATIVE_WORDS, NEUTRAL_WORDS);
  var VOCAB_SIZE = ALL_WORDS.length;
  var MAX_SEQ_LEN = 12;

  var word2idx = {};
  ALL_WORDS.forEach(function (w, i) { word2idx[w] = i; });

  function clampInt(v, lo, hi) {
    var n = Number(v);
    if (!Number.isFinite(n)) n = lo;
    return Math.max(lo, Math.min(hi, Math.floor(n)));
  }

  function createRng(seed) {
    var s = (Math.floor(Number(seed) || 42) >>> 0) || 42;
    return function () {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

  function generateSentence(rng, sentiment) {
    var len = 3 + Math.floor(rng() * 6); // 3-8 words
    var words = [];
    var sentimentWords = sentiment === 1 ? POSITIVE_WORDS : NEGATIVE_WORDS;
    // At least 1-3 sentiment words, rest neutral
    var nSentiment = 1 + Math.floor(rng() * 3);
    for (var i = 0; i < len; i++) {
      if (i < nSentiment || (rng() < 0.3 && nSentiment > 0)) {
        words.push(pick(sentimentWords, rng));
      } else {
        words.push(pick(NEUTRAL_WORDS, rng));
      }
    }
    // Shuffle
    for (var si = words.length - 1; si > 0; si--) {
      var sj = Math.floor(rng() * (si + 1));
      var tmp = words[si]; words[si] = words[sj]; words[sj] = tmp;
    }
    return words;
  }

  function tokenize(words) {
    var tokens = new Array(MAX_SEQ_LEN).fill(0); // pad with 0
    for (var i = 0; i < Math.min(words.length, MAX_SEQ_LEN); i++) {
      tokens[i] = word2idx[words[i]] || 1; // 1 = <unk>
    }
    return tokens;
  }

  function buildDataset(cfg) {
    var c = cfg || {};
    var seed = clampInt(c.seed, 0, 2147483647) || 42;
    var rng = createRng(seed);
    var totalCount = clampInt(c.totalCount || c.sourceTotalExamples || 1000, 50, 20000);
    var trainFrac = Number(c.trainFrac) || 0.7;
    var valFrac = Number(c.valFrac) || 0.15;
    var nTrain = Math.max(1, Math.round(totalCount * trainFrac));
    var nVal = Math.max(1, Math.round(totalCount * valFrac));
    var nTest = Math.max(1, totalCount - nTrain - nVal);

    var xTrain = [], yTrain = [];
    var xVal = [], yVal = [];
    var xTest = [], yTest = [];

    function genSplit(n, xArr, yArr) {
      for (var i = 0; i < n; i++) {
        var sentiment = rng() < 0.5 ? 1 : 0;
        var words = generateSentence(rng, sentiment);
        xArr.push(tokenize(words));
        yArr.push(sentiment);
      }
    }
    genSplit(nTrain, xTrain, yTrain);
    genSplit(nVal, xVal, yVal);
    genSplit(nTest, xTest, yTest);

    return {
      schemaId: "text_classification",
      datasetModuleId: "text_classification",
      taskRecipeId: "supervised_standard",
      mode: "classification",
      featureSize: MAX_SEQ_LEN,
      targetSize: 2,
      targetMode: "label",
      numClasses: 2,
      classCount: 2,
      classNames: ["negative", "positive"],
      vocabSize: VOCAB_SIZE,
      maxSeqLen: MAX_SEQ_LEN,
      vocabulary: ALL_WORDS,
      seed: seed,
      splitConfig: { mode: "random", train: trainFrac, val: valFrac, test: 1 - trainFrac - valFrac },
      trainCount: nTrain, valCount: nVal, testCount: nTest,
      xTrain: xTrain, yTrain: yTrain,
      xVal: xVal, yVal: yVal,
      xTest: xTest, yTest: yTest,
    };
  }

  function renderPlayground(mountEl, deps) {
    if (!mountEl) return;
    var el = deps && deps.el ? deps.el : function (tag, attrs, ch) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === "className") e.className = attrs[k];
        else if (k === "textContent") e.textContent = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
      if (ch) (Array.isArray(ch) ? ch : [ch]).forEach(function (c) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      });
      return e;
    };

    mountEl.innerHTML = "";
    mountEl.appendChild(el("div", { style: "font-size:14px;color:#67e8f9;font-weight:600;margin-bottom:8px;" },
      "Synthetic Sentiment Classification"));
    mountEl.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:12px;" },
      "Synthetic sentences labeled as positive/negative sentiment. Vocabulary: " + VOCAB_SIZE + " words, max length: " + MAX_SEQ_LEN + " tokens."));

    var rng = createRng(42);
    var grid = el("div", { style: "display:flex;flex-direction:column;gap:4px;max-width:600px;" });
    for (var i = 0; i < 12; i++) {
      var sentiment = rng() < 0.5 ? 1 : 0;
      var words = generateSentence(rng, sentiment);
      var label = sentiment === 1 ? "positive" : "negative";
      var color = sentiment === 1 ? "#4ade80" : "#f87171";
      var row = el("div", { style: "display:flex;gap:8px;align-items:center;font-size:12px;" });
      row.appendChild(el("span", { style: "color:" + color + ";font-weight:600;width:60px;" }, label));
      row.appendChild(el("span", { style: "color:#e2e8f0;" }, "\"" + words.join(" ") + "\""));
      grid.appendChild(row);
    }
    mountEl.appendChild(grid);

    mountEl.appendChild(el("div", { style: "font-size:11px;color:#64748b;margin-top:12px;" },
      "Tokens: " + MAX_SEQ_LEN + "-length integer sequences (word indices). Padded with 0."));
  }

  var modules = [{
    id: "text_classification",
    schemaId: "text_classification",
    label: "Synthetic Sentiment",
    build: buildDataset,
    playgroundApi: { renderPlayground: renderPlayground },
  }];

  return { modules: modules, buildDataset: buildDataset, vocabulary: ALL_WORDS, VOCAB_SIZE: VOCAB_SIZE, MAX_SEQ_LEN: MAX_SEQ_LEN };
});

"use strict";
// Wrapper: pre-load AIS inline data, then exec train_pretrained_server.js.
// The script's demo-local data loader only scans demo/TrAISformer/, but
// AIS data lives in data/ais-dma/ — outside that scope. Pre-loading it
// here sets global._AIS_INLINE_DATA which the ais_module checks before
// any fetch path.
//
// Also pre-sets NODE_OPTIONS so train_pretrained_server.js's auto-respawn
// (it bumps --max-old-space-size if not already set) is skipped — the
// respawn would fork a fresh process that loses our pre-loaded data.

if (!process.env.NODE_OPTIONS || !/--max-old-space-size/.test(process.env.NODE_OPTIONS)) {
  var spawn = require("child_process").spawnSync;
  if (!process.env.__OSC_TRAIS_RESPAWNED) {
    var existing = process.env.NODE_OPTIONS || "";
    var nodeOpts = (existing + " --max-old-space-size=8192").trim();
    var result = spawn(process.execPath, process.argv.slice(1), {
      stdio: "inherit",
      env: Object.assign({}, process.env, { NODE_OPTIONS: nodeOpts, __OSC_TRAIS_RESPAWNED: "1" }),
    });
    if (result.error) { console.error("respawn:", result.error.message); process.exit(1); }
    if (result.signal) { console.error("signal:", result.signal); process.exit(1); }
    process.exit(Number(result.status || 0));
  }
}

var fs = require("fs");
var path = require("path");
var vm = require("vm");

global.window = global;
// Faking document needs to cover the methods our dataset modules touch
// at require time. ais_module._resolveDataBase walks
// document.getElementsByTagName("script") to find a base path; without
// that method it throws and safeRequire silently drops the module,
// so getModuleForSchema("ais_trajectory") returns 0 matches.
global.document = {
  createElement: function () { return { onload: null, onerror: null, style: {} }; },
  getElementsByTagName: function () { return []; },
  head: { appendChild: function () {} },
};

var ROOT = path.resolve(__dirname, "..");
var inlinePath = path.join(ROOT, "data/ais-dma/ais_dma_full_inline.js");
console.log("Loading AIS inline data:", inlinePath);
var inlineSrc = fs.readFileSync(inlinePath, "utf8");
vm.runInThisContext(inlineSrc, { filename: "ais_dma_full_inline.js" });
console.log("  set:", !!global._AIS_INLINE_DATA,
  "trajectories train/val/test:",
  global._AIS_INLINE_DATA && global._AIS_INLINE_DATA.train ? global._AIS_INLINE_DATA.train.length : "?",
  global._AIS_INLINE_DATA && global._AIS_INLINE_DATA.val ? global._AIS_INLINE_DATA.val.length : "?",
  global._AIS_INLINE_DATA && global._AIS_INLINE_DATA.test ? global._AIS_INLINE_DATA.test.length : "?");

var modelIdx = process.argv[2];
// Both args must be absolute so the wrapper runs from anywhere — not just
// the repo root. train_pretrained_server.js resolves demoDir relative to
// CWD, so passing "demo/TrAISformer" from /tmp would print the usage line
// and exit. (Reviewer caught this on PR #90.)
process.argv = [
  process.argv[0],
  path.join(ROOT, "scripts/train_pretrained_server.js"),
  path.join(ROOT, "demo/TrAISformer"),
];
if (modelIdx !== undefined) process.argv.push(String(modelIdx));

// Skip train_pretrained_server.js's own respawn (we already bumped NODE_OPTIONS).
process.env.__OSC_RETRAIN_RESPAWNED = "1";
require(path.join(ROOT, "scripts/train_pretrained_server.js"));

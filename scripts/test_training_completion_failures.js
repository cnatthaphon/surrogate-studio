"use strict";
// Regression test for four silent-fallback bugs on the worker/server
// training-completion pathway. Same audit class as PRs #94-#98 — but
// these were on the PRODUCER side of the post-train save boundary, so
// PR #98's catch-side fixes couldn't see them.
//
// Bug G — src/training_worker.js (~line 734): worker weight
//   extraction failure was a kind:"log" warning + null artifacts.
//   Worker still posted kind:"complete" with result.modelArtifacts=null.
//
// Bug H — src/training_worker_bridge.js (~line 165): the bridge's
//   `done(msg.result || {})` accepted any complete message, including
//   ones with no result or no modelArtifacts.
//
// Bug I — src/tabs/trainer_tab.js (worker.then handler): tCard.status
//   was set to "done" unconditionally; the artifact assignment was
//   guarded by `if (result.modelArtifacts)`. A null result produced
//   "✓ Done (Worker)" + a "done" card with no artifacts.
//
// Bug J — src/server_runtime_adapter.js (~line 327): server complete
//   with hasArtifacts:false silently resolved as success. The Python
//   subprocess always emits modelArtifacts in complete payloads, so
//   hasArtifacts:false means contract violation, not a legitimate
//   state.

var path = require("path");
var fs = require("fs");

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

// ===========================================================
// Bug G — src/training_worker.js weight-extraction strict throw
// ===========================================================
var workerSrc = fs.readFileSync(
  path.join(__dirname, "..", "src/training_worker.js"), "utf8"
);

ok(!/} catch \(saveErr\) \{\s*\n\s*self\.postMessage\(\{ kind: "log", message: "Warning: weight extraction failed/.test(workerSrc),
  "worker NO LONGER posts kind:'log' on extraction failure (was the silent fake-success bug)");
ok(/throw new Error\("Weight extraction failed in worker:/.test(workerSrc),
  "worker throws on extraction failure so the outer try/catch posts kind:'error'");
ok(/refusing to report training complete/i.test(workerSrc),
  "worker throw message explains why we refuse to report complete with no artifacts");

// ===========================================================
// Bug H — src/training_worker_bridge.js bridge validation
// ===========================================================
var bridgeSrc = fs.readFileSync(
  path.join(__dirname, "..", "src/training_worker_bridge.js"), "utf8"
);

ok(!/done\(msg\.result \|\| \{\}\);/.test(bridgeSrc),
  "bridge NO LONGER does `done(msg.result || {})` (was the accept-anything bug)");
ok(/if \(!result \|\| !result\.modelArtifacts\)/.test(bridgeSrc),
  "bridge validates result.modelArtifacts presence before resolving");
ok(/Worker reported complete but no modelArtifacts/.test(bridgeSrc),
  "bridge fail message names the contract violation");

// --- Bug H behavioral: simulate the bridge handling kind:"complete"
// with various malformed result shapes; assert each one routes to
// fail() not done().
(function () {
  var failures = [];
  var successes = [];
  function fail(e) { failures.push(e); }
  function done(r) { successes.push(r); }
  // Inline the new logic from training_worker_bridge.js
  function handleComplete(msg) {
    var result = msg && msg.result;
    if (!result || !result.modelArtifacts) {
      fail(new Error("Worker reported complete but no modelArtifacts in result"));
      return;
    }
    done(result);
  }
  handleComplete({});                                              // no result
  handleComplete({ result: null });                                // null result
  handleComplete({ result: {} });                                  // empty result
  handleComplete({ result: { modelArtifacts: null } });           // null artifacts
  handleComplete({ result: { modelArtifacts: undefined } });      // undefined artifacts
  handleComplete({ result: { mae: 0.1 } });                       // metrics but no artifacts
  ok(failures.length === 6 && successes.length === 0,
    "Bug H behavioral: bridge rejects all 6 malformed complete shapes (got " + failures.length + " fails, " + successes.length + " successes)");
  ok(failures.every(function (e) { return /no modelArtifacts/.test(e.message); }),
    "Bug H behavioral: every rejection names 'no modelArtifacts'");
})();

// --- Bug H negative: a valid complete with modelArtifacts must
// still route to done() — guard against over-rotation.
(function () {
  var successes = [];
  function fail() {}
  function done(r) { successes.push(r); }
  function handleComplete(msg) {
    var result = msg && msg.result;
    if (!result || !result.modelArtifacts) {
      fail(new Error("..."));
      return;
    }
    done(result);
  }
  handleComplete({ result: { modelArtifacts: { weightSpecs: [{ name: "w" }] } } });
  ok(successes.length === 1, "Bug H negative: valid result still routes to done()");
})();

// ===========================================================
// Bug I — src/tabs/trainer_tab.js worker.then defense-in-depth
// ===========================================================
var trSrc = fs.readFileSync(
  path.join(__dirname, "..", "src/tabs/trainer_tab.js"), "utf8"
);

// Locate the worker.then handler so we don't false-match on other
// status assignments.
var workerThenStart = trSrc.indexOf("workerRun.then(function (result)");
ok(workerThenStart > 0, "located workerRun.then handler in trainer_tab.js");
var workerThenBlock = trSrc.slice(workerThenStart, workerThenStart + 3500);
ok(/if \(!result \|\| !result\.modelArtifacts\) \{[\s\S]{0,500}?tCard\.status = "error"/.test(workerThenBlock),
  "worker.then handler validates result.modelArtifacts BEFORE setting status='done'");
ok(/Worker training (completed but produced no weight artifacts|FAILED: no weight artifacts)/.test(workerThenBlock),
  "worker.then handler surfaces 'no weight artifacts' message on the silent-failure case");
ok(/trained model lost/i.test(workerThenBlock),
  "worker.then handler onStatus says 'trained model lost' for the consequence");

// ===========================================================
// Bug J — src/server_runtime_adapter.js hasArtifacts:false → reject
// ===========================================================
var saSrc = fs.readFileSync(
  path.join(__dirname, "..", "src/server_runtime_adapter.js"), "utf8"
);

ok(!/} else \{\s*\n\s*resolve\(_normalizeServerResult\(lightResult\)\);\s*\n\s*\}\s*\n\s*\} catch \(e\) \{\s*\n\s*reject\(new Error\("Failed to parse server result/.test(saSrc),
  "server adapter NO LONGER silently resolves on hasArtifacts:false");
ok(/Server reported complete but hasArtifacts=false/.test(saSrc),
  "server adapter rejects with a message naming the contract violation");
ok(/contract|trained model not retrievable/i.test(saSrc.slice(saSrc.indexOf("Server reported complete but hasArtifacts"), saSrc.indexOf("Server reported complete but hasArtifacts") + 400)),
  "rejection message references the contract / model loss");

// --- Bug J behavioral: simulate the complete-event handler with
// hasArtifacts:false; assert it rejects.
(function () {
  var resolves = [];
  var rejects = [];
  function resolve(v) { resolves.push(v); }
  function reject(e) { rejects.push(e); }
  // Inline the new logic from server_runtime_adapter.js
  function handleComplete(eventData) {
    var lightResult = JSON.parse(eventData);
    if (lightResult.hasArtifacts) {
      resolve({ fetched: true });
    } else {
      reject(new Error("Server reported complete but hasArtifacts=false — subprocess violated the complete-with-modelArtifacts contract, trained model not retrievable"));
    }
  }
  handleComplete(JSON.stringify({ hasArtifacts: false, mae: 0.05 }));
  ok(resolves.length === 0 && rejects.length === 1,
    "Bug J behavioral: hasArtifacts:false rejects (got " + rejects.length + " rejections)");
  ok(/hasArtifacts=false/.test(rejects[0].message),
    "Bug J behavioral: rejection names 'hasArtifacts=false'");
  // Negative: hasArtifacts:true still resolves.
  handleComplete(JSON.stringify({ hasArtifacts: true, mae: 0.05 }));
  ok(resolves.length === 1, "Bug J negative: hasArtifacts:true still resolves");
})();

console.log("\n  " + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);

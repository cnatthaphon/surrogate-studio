"use strict";
// Regression test for two dataset-side silent-fallback bugs in the
// same audit class as PRs #94-#101 — both let a dataset card reach a
// state-vs-reality mismatch where the UI hides a real build failure.
//
// Bug R — src/tabs/dataset_tab.js (~line 206): the `if (!ds.data)`
//   branch rendered "Configure and generate from right panel"
//   unconditionally. A dataset with status="ready" or status="error"
//   but missing ds.data fell through to this prompt and rendered as
//   if untouched — same UX-deception class as PR #101 Bug O
//   (imported trainer with status="done" but no artifacts).
//
// Bug T — src/pretrained_loader.js (~line 170): three silent-
//   fallback paths around mod.build(cfg):
//     1. sync throw → console.warn + return, dataset unchanged
//     2. async resolve(null) → silent return, dataset unchanged
//     3. async reject → console.warn catch, dataset unchanged
//   In all three cases, the user saw the card in its pre-build state
//   with no indication that the auto-build had failed.

var path = require("path");
var fs = require("fs");

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}

// ===========================================================
// Bug R — src/tabs/dataset_tab.js (state-vs-reality branch)
// ===========================================================
var dtSrc = fs.readFileSync(
  path.join(__dirname, "..", "src/tabs/dataset_tab.js"), "utf8"
);

// Locate the !ds.data branch.
var noDataStart = dtSrc.indexOf("if (!ds.data) {");
ok(noDataStart > 0, "located the `if (!ds.data)` branch in dataset_tab.js");
var noDataEnd = dtSrc.indexOf("return;\n      }", noDataStart);
ok(noDataEnd > 0, "located the end of the !ds.data branch");
var noDataBlock = dtSrc.slice(noDataStart, noDataEnd + 30);

ok(/ds\.status === "ready"/.test(noDataBlock),
  "Bug R: the no-data branch distinguishes status='ready' (corruption) from untouched");
ok(/ds\.status === "error"/.test(noDataBlock),
  "Bug R: the no-data branch also distinguishes status='error' (build failed)");
// Source uses escaped quotes `status=\"ready\"` for the JS literal,
// so the file content has a literal backslash before each quote.
ok(/Dataset claims status=\\"ready\\" but has no data/.test(noDataBlock),
  "Bug R: 'ready but no data' renders an explicit corruption message (not the generic configure prompt)");
ok(/Dataset build failed:/.test(noDataBlock),
  "Bug R: 'error' status surfaces the ds.error message");
ok(/Configure and generate from right panel/.test(noDataBlock),
  "Bug R negative: the legitimate untouched case still shows 'Configure and generate' (no false-positives)");

// ===========================================================
// Bug T — src/pretrained_loader.js (build-failure path)
// ===========================================================
var ploadSrc = fs.readFileSync(
  path.join(__dirname, "..", "src/pretrained_loader.js"), "utf8"
);

ok(/_markDatasetBuildFailure/.test(ploadSrc),
  "Bug T: helper _markDatasetBuildFailure exists to centralize the error-promotion");
ok(/status: "error"[\s\S]{0,200}?error: "Dataset build failed:/.test(ploadSrc),
  "Bug T: _markDatasetBuildFailure sets status='error' AND a descriptive ds.error");

// Source-level: the three pre-fix patterns should be gone.
ok(!/} catch \(e\) \{ console\.warn\("\[pretrained\] Dataset build failed:", ds\.id, e\.message\); return; \}/.test(ploadSrc),
  "Bug T: sync-throw catch NO LONGER just console.warn + return");
ok(!/if \(!result\) return;[\s\S]{0,200}?status: "ready"/.test(ploadSrc),
  "Bug T: async null-result NO LONGER silently returns before status assignment");
// Defensive: there shouldn't be a bare console.warn-only catch on the build promise.
var promiseCatchPattern = /\.catch\(function \(e\) \{\s*\n\s*console\.warn\("\[pretrained\] Dataset build failed:", ds\.id, e\.message\);\s*\n\s*\}\)/;
ok(!promiseCatchPattern.test(ploadSrc),
  "Bug T: async-reject catch NO LONGER just console.warn (now calls _markDatasetBuildFailure)");

// --- Behavioral: drive ensureDatasetsReady-style logic with three
// failure modes; assert each leaves the dataset at status="error"
// with a descriptive ds.error.

function makeMockStore() {
  var upserts = [];
  return {
    listDatasets: function () { return []; },
    upsertDataset: function (d) { upserts.push(d); },
    _upserts: upserts,
  };
}

// Inline a minimal version of the markDatasetBuildFailure + build
// flow so we can drive it without loading the whole module's
// requireRegistry chain.
function runWithBuilder(buildFn) {
  var ds = { id: "demo_ds", schemaId: "x", status: "new" };
  var store = makeMockStore();
  function _markDatasetBuildFailure(reason) {
    var failed = Object.assign({}, ds, {
      status: "error",
      error: "Dataset build failed: " + String(reason || "unknown"),
    });
    store.upsertDataset(failed);
  }
  var p;
  try {
    p = buildFn();
  } catch (e) {
    _markDatasetBuildFailure(e && e.message ? e.message : e);
    return Promise.resolve(store);
  }
  if (!p || typeof p.then !== "function") p = Promise.resolve(p);
  return p.then(function (result) {
    if (!result) {
      _markDatasetBuildFailure("module returned no result (null/undefined)");
      return store;
    }
    var updated = Object.assign({}, ds, { data: result, status: "ready", generatedAt: 1 });
    store.upsertDataset(updated);
    return store;
  }).catch(function (e) {
    _markDatasetBuildFailure(e && e.message ? e.message : e);
    return store;
  });
}

// Failure mode 1: sync throw.
runWithBuilder(function () { throw new Error("syntax error in dataset spec"); })
  .then(function (s) {
    ok(s._upserts.length === 1 && s._upserts[0].status === "error",
      "Bug T behavioral [sync throw]: dataset upserted with status='error' (was: silent return, status unchanged)");
    ok(/syntax error/.test(s._upserts[0].error || ""),
      "Bug T behavioral [sync throw]: ds.error names the underlying message");
  });

// Failure mode 2: async resolve(null).
runWithBuilder(function () { return Promise.resolve(null); })
  .then(function (s) {
    ok(s._upserts.length === 1 && s._upserts[0].status === "error",
      "Bug T behavioral [null result]: dataset upserted with status='error' (was: silent return)");
    ok(/module returned no result/i.test(s._upserts[0].error || ""),
      "Bug T behavioral [null result]: ds.error names 'module returned no result'");
  });

// Failure mode 3: async reject.
runWithBuilder(function () { return Promise.reject(new Error("HTTP 500 from source")); })
  .then(function (s) {
    ok(s._upserts.length === 1 && s._upserts[0].status === "error",
      "Bug T behavioral [async reject]: dataset upserted with status='error' (was: console.warn only)");
    ok(/HTTP 500/.test(s._upserts[0].error || ""),
      "Bug T behavioral [async reject]: ds.error names the underlying rejection reason");
  });

// Negative: successful build still sets status="ready".
runWithBuilder(function () { return Promise.resolve({ records: [{}], featureSize: 4 }); })
  .then(function (s) {
    ok(s._upserts.length === 1 && s._upserts[0].status === "ready",
      "Bug T behavioral negative: successful build still produces status='ready'");
    ok(s._upserts[0].data != null,
      "Bug T behavioral negative: successful build attaches data");
  })
  .then(function () {
    console.log("\n  " + passed + " passed, " + failed + " failed");
    if (failed) process.exit(1);
  });

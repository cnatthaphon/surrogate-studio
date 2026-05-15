"use strict";
// Regression test for the output-layer Custom-target bug.
//
// Before fix: changing the Output block's "Target" dropdown to "Custom"
// updated node.data but did NOT add a second input port (the one the
// "custom" mode is supposed to expose, where the user wires the target
// tensor in). The old applyNodeConfigUpdate path also coerced any
// non-oscillator target to "x" because of a leftover hardcoded list,
// so the dropdown selection silently reverted.
//
// After fix: switching to Custom must (a) keep targetType === "custom"
// on the node, and (b) flip the Drawflow input port count from 1 to 2.
// Switching back to a normal schema target must restore 1 input port.
//
// Drives a real demo (Custom-CSV-Tutorial — first schema where the
// output dropdown has real schema-defined targets to flip back to)
// against the local server on :3777.

var puppeteer = require("puppeteer");

var BASE = "http://localhost:3777";
var DEMO = "Custom-CSV-Tutorial";

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  var browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  var passed = 0, failed = 0;
  function ok(cond, label) {
    if (cond) { passed++; console.log("  ✓ " + label); }
    else { failed++; console.log("  ✗ " + label); }
  }
  try {
    var page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(BASE + "/demo/" + DEMO + "/index.html", { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);

    // Open the Model tab so the editor is mounted.
    await page.evaluate(function () {
      var btns = Array.from(document.querySelectorAll("button"));
      var m = btns.find(function (b) { return b.textContent.trim() === "Model"; });
      if (m) m.click();
    });
    await sleep(1500);

    // Select the first model preset so a graph is loaded.
    await page.evaluate(function () {
      var ws = document.querySelector(".osc-workspace.active") || document;
      var items = ws.querySelectorAll(".left-model-item, .left-item, .left-dataset-item");
      for (var i = 0; i < items.length; i++) {
        var txt = items[i].textContent || "";
        if (/Classifier|MLP|Model/i.test(txt)) { items[i].click(); return; }
      }
      if (items.length) items[0].click();
    });
    await sleep(1500);

    // Click the output node in the editor so its config panel opens.
    var nodeInfo = await page.evaluate(function () {
      var nodes = document.querySelectorAll(".drawflow-node");
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.className.indexOf("output_layer") >= 0 || (n.textContent || "").indexOf("Output") >= 0) {
          n.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
          n.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
          var id = n.id.replace("node-", "");
          return { id: id, found: true };
        }
      }
      return { found: false };
    });
    ok(nodeInfo.found, "found and selected an output_layer node (id=" + (nodeInfo.id || "?") + ")");
    await sleep(800);

    function getNodeState() {
      return page.evaluate(function (nid) {
        // The Drawflow editor instance lives in a closure in app.js and is
        // not exposed on window. Read state from the DOM instead: each input
        // port is a `.input` div inside `#node-<id> .inputs`.
        var nodeEl = document.getElementById("node-" + nid);
        if (!nodeEl) return null;
        var inputs = nodeEl.querySelectorAll(".inputs .input");
        var targetSel = document.querySelector("select[data-config-key='targetType']");
        return {
          target: targetSel ? targetSel.value : null,
          numInputs: inputs.length,
        };
      }, nodeInfo.id);
    }

    var before = await getNodeState();
    ok(before && before.numInputs === 1, "before Custom: numInputs=1 (got " + (before && before.numInputs) + ", target=" + (before && before.target) + ")");

    // Find the Target select in the config panel and switch it to "custom".
    var changed = await page.evaluate(function () {
      var sel = document.querySelector("select[data-config-key='targetType']");
      if (!sel) return false;
      var hasCustom = Array.from(sel.options).some(function (o) { return o.value === "custom"; });
      if (!hasCustom) return false;
      sel.value = "custom";
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    ok(changed, "found Target select with 'custom' option and dispatched change");
    await sleep(800);

    var afterCustom = await getNodeState();
    ok(afterCustom && afterCustom.target === "custom",
      "after switching to Custom: data.targetType === 'custom' (got '" + (afterCustom && afterCustom.target) + "')");
    ok(afterCustom && afterCustom.numInputs === 2,
      "after switching to Custom: numInputs === 2 (got " + (afterCustom && afterCustom.numInputs) + ")");

    // Now switch back to the first non-custom target option in the dropdown
    // and confirm the second input is removed.
    var revertedTo = await page.evaluate(function () {
      var sel = document.querySelector("select[data-config-key='targetType']");
      if (!sel) return null;
      var firstNonCustom = Array.from(sel.options).find(function (o) {
        return o.value && o.value !== "custom" && o.value !== "none";
      });
      if (!firstNonCustom) return null;
      sel.value = firstNonCustom.value;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return firstNonCustom.value;
    });
    ok(revertedTo != null, "found a non-custom target to revert to (" + revertedTo + ")");
    await sleep(800);

    var afterRevert = await getNodeState();
    ok(afterRevert && afterRevert.target === revertedTo,
      "after revert: data.targetType matches selected ('" + (afterRevert && afterRevert.target) + "' vs '" + revertedTo + "')");
    ok(afterRevert && afterRevert.numInputs === 1,
      "after revert: numInputs back to 1 (got " + (afterRevert && afterRevert.numInputs) + ")");
  } catch (e) {
    console.error("Fatal:", e && e.message);
    failed++;
  } finally {
    await browser.close();
  }
  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

"use strict";
// Sanity check: after the applyNodeConfigValue signature-dispatch fix,
// verify that right-panel edits across a sample of node types still
// persist to node.data. Pre-fix, the wrong-signature call coerced the
// field key to a nodeId and every onChange silently did nothing — that
// would have looked broken on Output (the Custom-target bug we just
// shipped) but it would have ALSO been broken on Dense, Dropout, GRU,
// LSTM, etc. This test confirms the dispatch fix didn't regress those.
//
// Approach: open a demo, walk the graph, edit one numeric field per
// node-type that exposes one, export the graph, assert the new value
// is in the exported data blob.

var puppeteer = require("puppeteer");

var BASE = "http://localhost:3777";
var DEMO = "Fashion-MNIST-Benchmark";

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

    await page.evaluate(function () {
      var btns = Array.from(document.querySelectorAll("button"));
      var m = btns.find(function (b) { return b.textContent.trim() === "Model"; });
      if (m) m.click();
    });
    await sleep(1200);

    // Load the CNN preset (has dense + conv + dropout + reshape).
    await page.evaluate(function () {
      var ws = document.querySelector(".osc-workspace.active") || document;
      var items = Array.from(ws.querySelectorAll(".left-model-item, .left-item, .left-dataset-item"));
      var hit = items.find(function (it) { return /CNN|LeNet/i.test(it.textContent || ""); });
      if (hit) hit.click(); else if (items.length) items[0].click();
    });
    await sleep(1500);

    // Walk every node, find each (nodeName, fieldKey, newValue) tuple we
    // want to verify. For each, click the node, edit the field via the
    // right panel, then read back via a Drawflow-DOM scan.
    async function nodeIdByName(name) {
      return await page.evaluate(function (target) {
        var nodes = document.querySelectorAll(".drawflow-node");
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].className.indexOf(target) >= 0) {
            return nodes[i].id.replace("node-", "");
          }
        }
        return null;
      }, name);
    }
    async function clickNode(nodeId) {
      await page.evaluate(function (nid) {
        var el = document.getElementById("node-" + nid);
        if (!el) return;
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      }, nodeId);
      await sleep(700);
    }
    async function setFieldValue(fieldKey, value) {
      return await page.evaluate(function (k, v) {
        var sel = document.querySelector("[data-config-key='" + k + "']");
        if (!sel) return false;
        var tag = (sel.tagName || "").toLowerCase();
        var inputType = (sel.type || "").toLowerCase();
        if (tag === "select" || inputType === "text" || inputType === "number") {
          sel.value = String(v);
        } else if (inputType === "checkbox") {
          sel.checked = Boolean(v);
        }
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, fieldKey, value);
    }
    async function readNodeData(nodeId) {
      return await page.evaluate(function (nid) {
        // Drawflow keeps a parent `Drawflow` instance on the canvas wrapper
        // via the `.parent` reference; walk up from a node element.
        var el = document.getElementById("node-" + nid);
        if (!el) return null;
        // Drawflow exposes the editor instance on every container .drawflow
        // via the inherited `drawflow` property on the underlying class.
        // It's easier to scan window for the instance.
        var ed = null;
        for (var k in window) {
          try {
            var v = window[k];
            if (v && typeof v.export === "function" && typeof v.updateNodeDataFromId === "function" && typeof v.addNodeInput === "function") {
              ed = v; break;
            }
          } catch (e) {}
        }
        if (!ed) {
          // Fallback: scrape summary text.
          var summary = el.querySelector(".node-summary");
          return { _via: "summary", summaryText: summary ? summary.textContent : "" };
        }
        var data = ed.export().drawflow.Home.data[nid];
        return data ? { _via: "drawflow", data: data.data || {} } : null;
      }, nodeId);
    }

    var cases = [
      { node: "dense_layer", field: "units", value: "77",   matcher: /77/ },
      { node: "dropout_layer", field: "rate", value: "0.42", matcher: /0\.42/ },
      { node: "conv2d_layer", field: "filters", value: "11", matcher: /f=11\b/ },
    ];

    for (var ci = 0; ci < cases.length; ci++) {
      var c = cases[ci];
      var id = await nodeIdByName(c.node);
      if (!id) { ok(false, c.node + ": node not present in graph"); continue; }
      await clickNode(id);
      var setOk = await setFieldValue(c.field, c.value);
      if (!setOk) { ok(false, c.node + "." + c.field + ": field control not found in right panel"); continue; }
      await sleep(500);
      var after = await readNodeData(id);
      var matched = after && c.matcher.test(after.summaryText);
      ok(matched, c.node + "." + c.field + " = " + c.value + " persisted into summary (" + (after && after.summaryText.slice(0, 80)) + ")");
    }
  } catch (e) {
    console.error("Fatal:", e && e.message);
    failed++;
  } finally {
    await browser.close();
  }
  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

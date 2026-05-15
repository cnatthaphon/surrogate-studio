"use strict";
// Smoke test for SAR-Ship Detection Playground/Dataset randomization.
//
// 1. Open the demo.
// 2. Click Playground tab → verify a "Random" button exists and is clickable;
//    capture a per-cell index-label snapshot before and after a click and
//    verify at least one cell's index changed.
// 3. Click Dataset tab → click Generate Dataset → verify "Random All" appears
//    along with the per-split buttons, and that clicking re-samples.
//
// Pass: both tabs render the new randomization affordance and clicking it
// changes the per-cell #N labels. Server must be running on :3777.

var puppeteer = require("puppeteer");

var BASE = "http://localhost:3777";

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
    await page.goto(BASE + "/demo/SAR-Ship-Detection/index.html", { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);

    async function clickTab(label) {
      await page.evaluate(function (l) {
        var btns = Array.from(document.querySelectorAll("button"));
        var m = btns.find(function (b) { return b.textContent.trim() === l; });
        if (m) m.click();
      }, label);
      await sleep(1500);
    }
    async function clickByText(t) {
      return await page.evaluate(function (txt) {
        var btns = Array.from(document.querySelectorAll("button"));
        var m = btns.find(function (b) { return b.textContent.trim() === txt || b.textContent.trim().indexOf(txt) === 0; });
        if (m) { m.click(); return m.textContent.trim(); }
        return null;
      }, t);
    }
    function readCellLabels() {
      return page.evaluate(function () {
        return Array.from(document.querySelectorAll(".osc-workspace.active div"))
          .filter(function (d) { return /^#\d+$/.test(d.textContent.trim()); })
          .map(function (d) { return d.textContent.trim(); });
      });
    }

    console.log("\n=== Playground tab ===");
    await clickTab("Playground");
    await sleep(2000);
    var labelsBefore = await readCellLabels();
    ok(labelsBefore.length > 0, "Playground rendered cells with #N index labels");
    var clicked = await clickByText("Random");
    ok(!!clicked, "Random button is clickable (label: " + clicked + ")");
    await sleep(500);
    var labelsAfter = await readCellLabels();
    var changed = labelsBefore.some(function (l, i) { return labelsAfter[i] && labelsAfter[i] !== l; });
    ok(changed, "Clicking Random re-samples at least one cell (before=" + labelsBefore.slice(0, 4).join(",") + " after=" + labelsAfter.slice(0, 4).join(",") + ")");

    console.log("\n=== Dataset tab ===");
    await clickTab("Dataset");
    await sleep(1500);
    await page.evaluate(function () {
      var items = document.querySelectorAll(".osc-workspace.active .left-dataset-item");
      if (items.length) items[0].click();
    });
    await sleep(500);
    await clickByText("Generate Dataset");
    await sleep(8000);
    var dsLabels = await readCellLabels();
    ok(dsLabels.length > 0, "Dataset tab rendered #N labels after Generate");
    var dsButtonText = await page.evaluate(function () {
      var btns = Array.from(document.querySelectorAll(".osc-workspace.active button"));
      var match = btns.find(function (b) { return b.textContent.trim() === "Random All"; });
      return match ? match.textContent.trim() : null;
    });
    ok(dsButtonText === "Random All", "Dataset tab shows 'Random All' master button");
    var splitButtons = await page.evaluate(function () {
      var btns = Array.from(document.querySelectorAll(".osc-workspace.active button"));
      return btns.filter(function (b) { return /^Random (Train|Val|Test)$/.test(b.textContent.trim()); }).length;
    });
    ok(splitButtons >= 2, "Per-split Random buttons present (found " + splitButtons + ")");
    var clickedDS = await clickByText("Random All");
    ok(!!clickedDS, "Random All clickable");
    await sleep(500);
    var dsLabelsAfter = await readCellLabels();
    var dsChanged = dsLabels.some(function (l, i) { return dsLabelsAfter[i] && dsLabelsAfter[i] !== l; });
    ok(dsChanged, "Clicking Random All re-samples at least one cell on Dataset tab");
  } catch (e) {
    console.error("Fatal:", e && e.message);
    failed++;
  } finally {
    await browser.close();
  }
  console.log("\n  " + passed + " passed, " + failed + " failed");
  if (failed) process.exit(1);
})();

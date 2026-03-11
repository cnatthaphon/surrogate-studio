"use strict";

const fs = require("fs");

function readNotebook(notebookPath) {
  return JSON.parse(fs.readFileSync(String(notebookPath), "utf8"));
}

function stringifyCellSource(cell) {
  if (!cell) return "";
  const src = cell.source;
  if (Array.isArray(src)) return src.join("");
  return String(src || "");
}

function firstOutputData(outputs) {
  const outList = Array.isArray(outputs) ? outputs : [];
  for (let i = 0; i < outList.length; i += 1) {
    const out = outList[i];
    if (out && out.data && typeof out.data === "object") return out.data;
  }
  return null;
}

function decodeMaybeArray(value) {
  if (Array.isArray(value)) return value.join("");
  return String(value == null ? "" : value);
}

function stripTags(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlTable(html) {
  const source = String(html || "");
  const headerMatch = source.match(/<thead[\s\S]*?<tr[\s\S]*?>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/i);
  const bodyMatch = source.match(/<tbody[\s\S]*?>([\s\S]*?)<\/tbody>/i);
  if (!headerMatch || !bodyMatch) return [];
  const headerCells = [];
  let hasIndexColumn = false;
  String(headerMatch[1]).replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, function (_m, cell) {
    const text = stripTags(cell);
    if (!text && !headerCells.length) {
      hasIndexColumn = true;
      return "";
    }
    if (text) headerCells.push(text);
    return "";
  });
  if (!headerCells.length) return [];
  const rows = [];
  String(bodyMatch[1]).replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, function (_m, rowHtml) {
    const values = [];
    String(rowHtml).replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, function (_m2, cell) {
      values.push(stripTags(cell));
      return "";
    });
    if (values.length) {
      if (hasIndexColumn && values.length === headerCells.length + 1) values.shift();
      const row = {};
      for (let i = 0; i < headerCells.length; i += 1) {
        row[headerCells[i]] = values[i] == null ? "" : values[i];
      }
      rows.push(row);
    }
    return "";
  });
  return rows;
}

function parseTableValue(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower === "nan") return NaN;
  if (lower === "none" || lower === "null") return null;
  const n = Number(text);
  if (Number.isFinite(n)) return n;
  return text;
}

function normalizeTableRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(function (row) {
    const out = {};
    Object.keys(row || {}).forEach(function (key) {
      out[String(key)] = parseTableValue(row[key]);
    });
    return out;
  });
}

function extractTableByCellSource(nb, sourceNeedle) {
  const cells = Array.isArray(nb && nb.cells) ? nb.cells : [];
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (cell.cell_type !== "code") continue;
    const src = stringifyCellSource(cell);
    if (src.indexOf(sourceNeedle) < 0) continue;
    const data = firstOutputData(cell.outputs);
    if (!data) return [];
    const html = decodeMaybeArray(data["text/html"]);
    if (html) {
      const parsed = parseHtmlTable(html);
      if (parsed.length) return normalizeTableRows(parsed);
    }
    const textPlain = decodeMaybeArray(data["text/plain"]);
    return textPlain ? [{ text: textPlain }] : [];
  }
  return [];
}

function extractNotebookReport(notebookPath) {
  const nb = readNotebook(notebookPath);
  const finalReport = extractTableByCellSource(nb, "REPORT_DF = pd.DataFrame(rows)");
  const trainSummary = extractTableByCellSource(nb, "TRAIN_SUMMARY_DF = pd.DataFrame(rows)");
  return {
    finalReport: finalReport,
    trainSummary: trainSummary,
  };
}

module.exports = {
  readNotebook,
  parseHtmlTable,
  extractNotebookReport,
};

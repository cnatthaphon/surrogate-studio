(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCNotebookRunnerUI = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /**
   * Notebook Runner UI — in-browser notebook execution via server kernel.
   *
   * Opens a fullscreen overlay with notebook cells.
   * Markdown cells rendered as HTML, code cells editable + runnable.
   * Outputs (text, images) displayed inline.
   *
   * Usage:
   *   OSCNotebookRunnerUI.open({
   *     notebook: { cells: [...] },  // ipynb-format notebook object
   *     serverUrl: "http://localhost:3777",
   *     el: function(tag, attrs, children) { ... },
   *   });
   */

  var _overlay = null;
  var _kernelId = null;
  var _serverUrl = "";

  function _el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "className") e.className = attrs[k];
      else if (k === "textContent") e.textContent = attrs[k];
      else if (k === "innerHTML") e.innerHTML = attrs[k];
      else if (k === "style") e.style.cssText = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    if (children != null) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (typeof c === "string") e.appendChild(document.createTextNode(c));
      else if (c && c.nodeType) e.appendChild(c);
    });
    return e;
  }

  function _postJSON(url, data) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(function (r) { return r.json(); });
  }

  function _escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function _renderMarkdown(src) {
    // Minimal markdown → HTML (headers, bold, code, links, lists)
    var html = _escapeHtml(src)
      .replace(/^### (.+)$/gm, "<h4 style='color:#67e8f9;margin:4px 0;'>$1</h4>")
      .replace(/^## (.+)$/gm, "<h3 style='color:#67e8f9;margin:6px 0;'>$1</h3>")
      .replace(/^# (.+)$/gm, "<h2 style='color:#67e8f9;margin:8px 0;'>$1</h2>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code style='background:#1e293b;padding:1px 4px;border-radius:3px;font-size:12px;'>$1</code>")
      .replace(/^\- (.+)$/gm, "<li style='margin:2px 0 2px 16px;'>$1</li>")
      .replace(/^\d+\. (.+)$/gm, "<li style='margin:2px 0 2px 16px;'>$1</li>")
      .replace(/\n/g, "<br>");
    return html;
  }

  function _startKernel(callback) {
    _postJSON(_serverUrl + "/api/notebook/start", {}).then(function (r) {
      _kernelId = r.kernelId;
      callback(null, r.kernelId);
    }).catch(function (e) { callback(e); });
  }

  function _executeCell(code, callback) {
    if (!_kernelId) { callback({ error: "No kernel" }); return; }
    _postJSON(_serverUrl + "/api/notebook/execute", {
      kernelId: _kernelId,
      code: code,
    }).then(function (r) { callback(r); }).catch(function (e) { callback({ error: e.message }); });
  }

  function _stopKernel() {
    if (!_kernelId) return;
    _postJSON(_serverUrl + "/api/notebook/stop", { kernelId: _kernelId }).catch(function () {});
    _kernelId = null;
  }

  function _renderCellOutput(container, result) {
    container.innerHTML = "";
    if (!result) return;

    if (result.error) {
      var errEl = _el("pre", { style: "color:#f43f5e;font-size:11px;white-space:pre-wrap;margin:4px 0;padding:8px;background:#1c1917;border-radius:4px;max-height:300px;overflow:auto;" },
        result.error);
      container.appendChild(errEl);
    }

    if (result.stdout) {
      var outEl = _el("pre", { style: "color:#e2e8f0;font-size:11px;white-space:pre-wrap;margin:4px 0;padding:8px;background:#0f172a;border-radius:4px;max-height:400px;overflow:auto;" },
        result.stdout);
      container.appendChild(outEl);
    }

    if (result.stderr) {
      var errEl2 = _el("pre", { style: "color:#fbbf24;font-size:10px;white-space:pre-wrap;margin:4px 0;padding:4px 8px;background:#1c1917;border-radius:4px;max-height:200px;overflow:auto;" },
        result.stderr);
      container.appendChild(errEl2);
    }

    if (result.images && result.images.length) {
      result.images.forEach(function (b64) {
        var img = _el("img", { src: "data:image/png;base64," + b64, style: "max-width:100%;border-radius:4px;margin:4px 0;" });
        container.appendChild(img);
      });
    }
  }

  function open(opts) {
    if (_overlay) close();

    var notebook = opts.notebook || { cells: [] };
    _serverUrl = (opts.serverUrl || "http://localhost:3777").replace(/\/$/, "");
    var cells = notebook.cells || [];

    // Create fullscreen overlay
    _overlay = _el("div", { style: "position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;background:#0b1220;overflow:hidden;display:flex;flex-direction:column;" });

    // Toolbar
    var toolbar = _el("div", { style: "display:flex;align-items:center;gap:8px;padding:8px 16px;background:#111827;border-bottom:1px solid #1e293b;flex-shrink:0;" });
    toolbar.appendChild(_el("span", { style: "font-size:14px;color:#67e8f9;font-weight:600;" }, "Notebook Runner"));

    var statusEl = _el("span", { style: "font-size:11px;color:#64748b;margin-left:8px;" }, "Starting kernel...");
    toolbar.appendChild(statusEl);

    var runAllBtn = _el("button", { style: "margin-left:auto;padding:4px 12px;background:#0ea5e9;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;" }, "Run All");
    toolbar.appendChild(runAllBtn);

    var closeBtn = _el("button", { style: "padding:4px 12px;background:#334155;color:#e2e8f0;border:none;border-radius:4px;cursor:pointer;font-size:12px;" }, "Close");
    toolbar.appendChild(closeBtn);
    closeBtn.addEventListener("click", function () { close(); });

    _overlay.appendChild(toolbar);

    // Cell container (scrollable)
    var cellContainer = _el("div", { style: "flex:1;overflow-y:auto;padding:16px;max-width:900px;margin:0 auto;width:100%;" });
    _overlay.appendChild(cellContainer);

    // Render cells
    var cellEls = [];
    cells.forEach(function (cell, idx) {
      var cellWrap = _el("div", { style: "margin-bottom:12px;border:1px solid #1e293b;border-radius:6px;overflow:hidden;" });

      var isCode = cell.cell_type === "code";
      var source = Array.isArray(cell.source) ? cell.source.join("") : (cell.source || "");

      // Cell header
      var header = _el("div", { style: "display:flex;align-items:center;gap:6px;padding:4px 8px;background:" + (isCode ? "#111827" : "#0f172a") + ";border-bottom:1px solid #1e293b;" });
      header.appendChild(_el("span", { style: "font-size:10px;color:" + (isCode ? "#67e8f9" : "#94a3b8") + ";font-weight:600;" },
        isCode ? "Code [" + idx + "]" : "Markdown"));

      if (isCode) {
        var runBtn = _el("button", { style: "margin-left:auto;padding:2px 8px;background:#1e293b;color:#67e8f9;border:1px solid #334155;border-radius:3px;cursor:pointer;font-size:10px;" }, "\u25B6 Run");
        header.appendChild(runBtn);
      }
      cellWrap.appendChild(header);

      // Cell body
      if (isCode) {
        var codeEl = _el("textarea", {
          style: "width:100%;min-height:80px;padding:8px;background:#0b1220;color:#e2e8f0;border:none;font-family:monospace;font-size:12px;resize:vertical;line-height:1.5;outline:none;",
        });
        codeEl.value = source;
        // Auto-resize
        codeEl.addEventListener("input", function () {
          codeEl.style.height = "auto";
          codeEl.style.height = Math.min(500, codeEl.scrollHeight) + "px";
        });
        cellWrap.appendChild(codeEl);
        setTimeout(function () { codeEl.style.height = Math.min(500, codeEl.scrollHeight) + "px"; }, 10);

        var outputEl = _el("div", { style: "padding:0 8px 8px;display:none;" });
        cellWrap.appendChild(outputEl);

        var cellData = { idx: idx, codeEl: codeEl, outputEl: outputEl, runBtn: runBtn, running: false };
        cellEls.push(cellData);

        runBtn.addEventListener("click", function () {
          _runCell(cellData, statusEl);
        });
      } else {
        var mdEl = _el("div", { style: "padding:8px 12px;color:#cbd5e1;font-size:12px;line-height:1.6;" });
        mdEl.innerHTML = _renderMarkdown(source);
        cellWrap.appendChild(mdEl);
        cellEls.push({ idx: idx, isMarkdown: true });
      }

      cellContainer.appendChild(cellWrap);
    });

    // Run All handler
    runAllBtn.addEventListener("click", function () {
      var codeCells = cellEls.filter(function (c) { return !c.isMarkdown; });
      var ci = 0;
      function runNext() {
        if (ci >= codeCells.length) {
          statusEl.textContent = "All cells executed.";
          return;
        }
        var cell = codeCells[ci++];
        statusEl.textContent = "Running cell " + ci + " of " + codeCells.length + "...";
        // Scroll cell into view
        cell.codeEl.parentElement.scrollIntoView({ behavior: "smooth", block: "center" });
        _runCell(cell, statusEl, function () {
          setTimeout(runNext, 100);
        });
      }
      runNext();
    });

    document.body.appendChild(_overlay);

    // Start kernel
    _startKernel(function (err, kid) {
      if (err) {
        statusEl.textContent = "Kernel failed: " + (err.message || err);
        statusEl.style.color = "#f43f5e";
      } else {
        statusEl.textContent = "Kernel ready (" + kid + ")";
        statusEl.style.color = "#4ade80";
      }
    });
  }

  function _runCell(cellData, statusEl, callback) {
    if (cellData.running) return;
    cellData.running = true;
    cellData.runBtn.textContent = "\u23f3 Running...";
    cellData.runBtn.disabled = true;
    cellData.outputEl.style.display = "block";
    cellData.outputEl.innerHTML = "<div style='color:#64748b;font-size:11px;'>Executing...</div>";

    var code = cellData.codeEl.value;
    _executeCell(code, function (result) {
      cellData.running = false;
      cellData.runBtn.textContent = "\u25B6 Run";
      cellData.runBtn.disabled = false;

      _renderCellOutput(cellData.outputEl, result);

      if (result && result.error) {
        cellData.codeEl.parentElement.style.borderColor = "#f43f5e";
      } else {
        cellData.codeEl.parentElement.style.borderColor = "#4ade80";
        setTimeout(function () { cellData.codeEl.parentElement.style.borderColor = "#1e293b"; }, 2000);
      }

      if (callback) callback();
    });
  }

  function close() {
    _stopKernel();
    if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
  }

  function isOpen() { return !!_overlay; }

  return { open: open, close: close, isOpen: isOpen };
});

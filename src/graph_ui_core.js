(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.OSCGraphUiCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createRuntime(api) {
    if (!api || typeof api !== "object") {
      throw new Error("OSCGraphUiCore.createRuntime requires api.");
    }

    function estimateNodeFeatureWidth(moduleData, nodeId, memo, stack) {
      var key = String(nodeId || "");
      if (!moduleData || !moduleData[key]) return 0;
      if (memo && Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
      if (stack && stack[key]) return 0;
      if (!memo) memo = {};
      if (!stack) stack = {};
      stack[key] = true;
      var node = moduleData[key];
      var d = node.data || {};
      var out = 0;
      if (node.name === "window_hist_block" || node.name === "window_hist_x_block" || node.name === "window_hist_v_block" || node.name === "sliding_window_block") {
        out = Math.max(1, Number(d.windowSize || 20));
      } else if (node.name === "hist_block" || node.name === "hist_x_block" || node.name === "x_block" || node.name === "hist_v_block" || node.name === "v_block") {
        out = 1;
      } else if (node.name === "params_block") {
        out = api.countStaticParams(api.normalizeParamMask(d.paramMask));
      } else if (node.name === "scenario_block") {
        out = 3;
      } else if (
        node.name === "time_block" ||
        node.name === "time_sec_block" ||
        node.name === "time_norm_block" ||
        node.name === "trig_block" ||
        node.name === "sin_norm_block" ||
        node.name === "cos_norm_block" ||
        node.name === "ratio_km_block" ||
        node.name === "ratio_cm_block" ||
        node.name === "ratio_gl_block"
      ) {
        out = 1;
      } else if (node.name === "concat_block") {
        var sum = 0;
        Object.keys(node.inputs || {}).forEach(function (ik) {
          var conns = (node.inputs[ik] && node.inputs[ik].connections) || [];
          conns.forEach(function (c) {
            sum += estimateNodeFeatureWidth(moduleData, String(c.node), memo, stack);
          });
        });
        out = sum;
      } else {
        Object.keys(node.inputs || {}).forEach(function (ik) {
          var conns = (node.inputs[ik] && node.inputs[ik].connections) || [];
          conns.forEach(function (c) {
            out = Math.max(out, estimateNodeFeatureWidth(moduleData, String(c.node), memo, stack));
          });
        });
      }
      memo[key] = out;
      delete stack[key];
      return out;
    }

    function refreshNodeSummaries(editor) {
      if (!editor || typeof editor.export !== "function") return;
      var documentRef = api.documentRef;
      if (!documentRef || typeof documentRef.querySelector !== "function") return;
      var moduleData = editor.export().drawflow.Home.data;
      Object.keys(moduleData).forEach(function (id) {
        var el = documentRef.querySelector("#node-" + id + " .node-summary");
        if (el) el.textContent = api.getNodeSummary(moduleData[id], id, moduleData);
      });
    }

    function autoArrangeGraph(editor) {
      if (!editor || typeof editor.export !== "function") return 0;
      var documentRef = api.documentRef;
      var data = editor.export().drawflow.Home.data || {};
      var ids = Object.keys(data);
      if (!ids.length) return 0;
      var featureSet = {
        image_source_block: true,
        sliding_window_block: true,
        window_hist_block: true,
        window_hist_x_block: true,
        window_hist_v_block: true,
        hist_block: true,
        hist_x_block: true,
        hist_v_block: true,
        x_block: true,
        v_block: true,
        params_block: true,
        time_block: true,
        time_sec_block: true,
        time_norm_block: true,
        scenario_block: true,
        trig_block: true,
        sin_norm_block: true,
        cos_norm_block: true,
        noise_schedule_block: true,
        ratio_km_block: true,
        ratio_cm_block: true,
        ratio_gl_block: true
      };
      var layerById = {};
      var edges = [];
      ids.forEach(function (id) {
        var n = data[id];
        if (!n) return;
        if (featureSet[n.name]) layerById[id] = 0;
        else if (n.name === "concat_block") layerById[id] = 1;
        else if (n.name === "input_layer") layerById[id] = 2;
        else if (n.name === "output_layer") layerById[id] = 4;
        else layerById[id] = 3;
        Object.keys(n.outputs || {}).forEach(function (k) {
          var conns = (n.outputs[k] && n.outputs[k].connections) || [];
          conns.forEach(function (c) {
            var to = String(c.node);
            if (data[to]) edges.push([String(id), to]);
          });
        });
      });
      for (var pass = 0; pass < ids.length + 2; pass += 1) {
        var changed = false;
        edges.forEach(function (e) {
          var cand = Number(layerById[e[0]] || 0) + 1;
          if (!Number.isFinite(layerById[e[1]]) || layerById[e[1]] < cand) {
            layerById[e[1]] = cand;
            changed = true;
          }
        });
        if (!changed) break;
      }
      var groups = {};
      ids.forEach(function (id) {
        var n = data[id];
        if (!n) return;
        var layer = Number(layerById[id]);
        if (!Number.isFinite(layer)) layer = 3;
        if (n.name === "output_layer" && layer < 4) layer = 4;
        if (layer > 10) layer = 10;
        if (!groups[layer]) groups[layer] = [];
        groups[layer].push(id);
      });
      var orderedLayers = Object.keys(groups).map(Number).sort(function (a, b) { return a - b; });
      var baseX = 60;
      var dx = 230;
      var startY = 40;
      var laneGap = 96;
      var moved = 0;
      var yById = {};
      var avg = function (arr) {
        if (!arr || !arr.length) return startY;
        var sum = 0;
        for (var i = 0; i < arr.length; i += 1) sum += Number(arr[i] || 0);
        return sum / arr.length;
      };
      orderedLayers.forEach(function (layer) {
        var arr = groups[layer].slice();
        var desiredY = {};
        arr.forEach(function (id, idx) {
          var inc = [];
          var node = data[id];
          Object.keys((node && node.inputs) || {}).forEach(function (ik) {
            var conns = (node.inputs[ik] && node.inputs[ik].connections) || [];
            conns.forEach(function (c) {
              var pid = String(c.node);
              if (Object.prototype.hasOwnProperty.call(yById, pid)) inc.push(yById[pid]);
            });
          });
          desiredY[id] = inc.length ? avg(inc) : (startY + idx * laneGap);
        });
        arr.sort(function (a, b) {
          var da = Number(desiredY[a] || 0);
          var db = Number(desiredY[b] || 0);
          if (da !== db) return da - db;
          return Number(a) - Number(b);
        });
        var cursor = startY;
        arr.forEach(function (id) {
          var x = baseX + layer * dx;
          var y = Math.max(Number(desiredY[id] || startY), cursor);
          cursor = y + laneGap;
          yById[id] = y;
          if (!data[id]) return;
          data[id].pos_x = x;
          data[id].pos_y = y;
          var el = documentRef && typeof documentRef.getElementById === "function" ? documentRef.getElementById("node-" + id) : null;
          if (el && el.style) {
            el.style.left = String(x) + "px";
            el.style.top = String(y) + "px";
          }
          if (typeof editor.updateConnectionNodes === "function") editor.updateConnectionNodes("node-" + id);
          moved += 1;
        });
      });
      return moved;
    }

    function fitGraphToViewport(editor, containerEl) {
      var documentRef = api.documentRef;
      if (!editor || typeof editor.export !== "function" || !containerEl) return false;
      var data = editor.export().drawflow.Home.data || {};
      var allIds = Object.keys(data);
      var ids = allIds.slice();
      var inputIds = allIds.filter(function (id) { return data[id] && data[id].name === "input_layer"; });
      if (inputIds.length) {
        var seen = {};
        var q = [String(inputIds[0])];
        seen[String(inputIds[0])] = true;
        while (q.length) {
          var id = q.shift();
          var n = data[id];
          if (!n || !n.outputs) continue;
          Object.keys(n.outputs).forEach(function (ok) {
            var conns = (n.outputs[ok] && n.outputs[ok].connections) || [];
            conns.forEach(function (c) {
              var to = String(c.node);
              if (!seen[to] && data[to]) {
                seen[to] = true;
                q.push(to);
              }
            });
          });
        }
        if (Object.keys(seen).length) ids = Object.keys(seen);
      }
      if (!ids.length) return false;
      var minX = Number.POSITIVE_INFINITY;
      var minY = Number.POSITIVE_INFINITY;
      var maxX = Number.NEGATIVE_INFINITY;
      var maxY = Number.NEGATIVE_INFINITY;
      var any = false;
      ids.forEach(function (id) {
        var n = data[id];
        if (!n) return;
        var el = documentRef && typeof documentRef.getElementById === "function" ? documentRef.getElementById("node-" + id) : null;
        var w = (el && el.offsetWidth) ? el.offsetWidth : 180;
        var h = (el && el.offsetHeight) ? el.offsetHeight : 90;
        var x = Number(n.pos_x || 0);
        var y = Number(n.pos_y || 0);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
        any = true;
      });
      if (!any) return false;
      var vw = Math.max(1, Number(containerEl.clientWidth || 0));
      var vh = Math.max(1, Number(containerEl.clientHeight || 0));
      if (vw < 80 || vh < 80) return false;
      var pad = 40;
      var bw = Math.max(1, maxX - minX);
      var bh = Math.max(1, maxY - minY);
      var sx = (vw - 2 * pad) / bw;
      var sy = (vh - 2 * pad) / bh;
      var scale = api.clamp(Math.min(sx, sy, 0.88), 0.18, 1);
      var graphCx = (minX + maxX) * 0.5;
      var graphCy = (minY + maxY) * 0.5;
      var tx = vw * 0.5 - graphCx * scale;
      var ty = vh * 0.5 - graphCy * scale;
      var p = editor.precanvas || (containerEl.querySelector ? containerEl.querySelector(".precanvas") : null);
      if (!p || !p.style) return false;
      p.style.transformOrigin = "0 0";
      var applyTransform = function (txv, tyv, zv) {
        p.style.transform = "translate(" + txv.toFixed(2) + "px, " + tyv.toFixed(2) + "px) scale(" + zv.toFixed(4) + ")";
        if (Object.prototype.hasOwnProperty.call(editor, "zoom")) editor.zoom = zv;
        if (Object.prototype.hasOwnProperty.call(editor, "canvas_x")) editor.canvas_x = txv;
        if (Object.prototype.hasOwnProperty.call(editor, "canvas_y")) editor.canvas_y = tyv;
      };
      applyTransform(tx, ty, scale);
      ids.forEach(function (id) {
        if (typeof editor.updateConnectionNodes === "function") editor.updateConnectionNodes("node-" + id);
      });
      return true;
    }

    function nudgeGraphToViewportCenter(editor, containerEl) {
      if (!editor || !containerEl) return false;
      var p = editor.precanvas || (containerEl.querySelector ? containerEl.querySelector(".precanvas") : null);
      if (!p || !p.style) return false;
      var crect = containerEl.getBoundingClientRect ? containerEl.getBoundingClientRect() : null;
      if (!crect || !Number.isFinite(crect.width) || !Number.isFinite(crect.height) || crect.width < 40 || crect.height < 40) return false;
      var nodeEls = Array.prototype.slice.call(containerEl.querySelectorAll ? containerEl.querySelectorAll(".drawflow-node") : []);
      if (!nodeEls.length) return false;
      var x0 = Number.POSITIVE_INFINITY;
      var y0 = Number.POSITIVE_INFINITY;
      var x1 = Number.NEGATIVE_INFINITY;
      var y1 = Number.NEGATIVE_INFINITY;
      var any = false;
      nodeEls.forEach(function (el) {
        if (!el || !el.getBoundingClientRect) return;
        var r = el.getBoundingClientRect();
        if (!r || !Number.isFinite(r.width) || !Number.isFinite(r.height) || r.width <= 0 || r.height <= 0) return;
        x0 = Math.min(x0, r.left);
        y0 = Math.min(y0, r.top);
        x1 = Math.max(x1, r.right);
        y1 = Math.max(y1, r.bottom);
        any = true;
      });
      if (!any) return false;
      var dx = crect.left + crect.width * 0.5 - (x0 + x1) * 0.5;
      var dy = crect.top + crect.height * 0.5 - (y0 + y1) * 0.5;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return true;
      var nx = Number(editor.canvas_x || 0) + dx;
      var ny = Number(editor.canvas_y || 0) + dy;
      var z = Number(editor.zoom || 1);
      p.style.transformOrigin = "0 0";
      p.style.transform = "translate(" + nx.toFixed(2) + "px, " + ny.toFixed(2) + "px) scale(" + z.toFixed(4) + ")";
      if (Object.prototype.hasOwnProperty.call(editor, "canvas_x")) editor.canvas_x = nx;
      if (Object.prototype.hasOwnProperty.call(editor, "canvas_y")) editor.canvas_y = ny;
      return true;
    }

    function scheduleFitGraphToViewport(editor, containerEl) {
      fitGraphToViewport(editor, containerEl);
      nudgeGraphToViewportCenter(editor, containerEl);
      if (typeof api.requestAnimationFrameRef === "function") {
        api.requestAnimationFrameRef(function () {
          fitGraphToViewport(editor, containerEl);
          nudgeGraphToViewportCenter(editor, containerEl);
        });
      }
      if (typeof api.setTimeoutRef === "function") {
        api.setTimeoutRef(function () { fitGraphToViewport(editor, containerEl); nudgeGraphToViewportCenter(editor, containerEl); }, 0);
        api.setTimeoutRef(function () { fitGraphToViewport(editor, containerEl); nudgeGraphToViewportCenter(editor, containerEl); }, 80);
        api.setTimeoutRef(function () { fitGraphToViewport(editor, containerEl); nudgeGraphToViewportCenter(editor, containerEl); }, 220);
        api.setTimeoutRef(function () { fitGraphToViewport(editor, containerEl); nudgeGraphToViewportCenter(editor, containerEl); }, 500);
        api.setTimeoutRef(function () { nudgeGraphToViewportCenter(editor, containerEl); }, 800);
      }
    }

    return {
      autoArrangeGraph: autoArrangeGraph,
      estimateNodeFeatureWidth: estimateNodeFeatureWidth,
      fitGraphToViewport: fitGraphToViewport,
      nudgeGraphToViewportCenter: nudgeGraphToViewportCenter,
      refreshNodeSummaries: refreshNodeSummaries,
      scheduleFitGraphToViewport: scheduleFitGraphToViewport
    };
  }

  return {
    createRuntime: createRuntime
  };
});

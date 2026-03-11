(() => {
  "use strict";

  function toStr(value, fallback) {
    const raw = String(value == null ? "" : value).trim();
    if (raw) return raw;
    return String(fallback == null ? "" : fallback).trim();
  }

  function toNum(value, fallback) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
    const fb = Number(fallback);
    return Number.isFinite(fb) ? fb : NaN;
  }

  function createEmptyHistory() {
    return { epoch: [], loss: [], val_loss: [], lr: [] };
  }

  function hasHistory(session) {
    const hist = session && session.history && typeof session.history === "object" ? session.history : {};
    return Array.isArray(hist.epoch) && hist.epoch.length > 0;
  }

  function normalizeStatus(session) {
    const s = session || {};
    const allowed = {
      draft: true,
      ready: true,
      running: true,
      paused: true,
      completed: true,
      failed: true,
    };
    const current = toStr(s.status, "").toLowerCase();
    if (allowed[current]) {
      s.status = current;
      return current;
    }
    if (!toStr(s.datasetId, "") || !toStr(s.modelId, "")) {
      s.status = "draft";
      return s.status;
    }
    const runtimeState = toStr(s.runtimeStatus && s.runtimeStatus.state, "").toLowerCase();
    if (runtimeState === "running") {
      s.status = "running";
      return s.status;
    }
    if (runtimeState === "paused") {
      s.status = "paused";
      return s.status;
    }
    if (hasHistory(s)) {
      s.status = "completed";
      return s.status;
    }
    if (s.lastResult && toStr(s.lastResult.note, "")) {
      s.status = "failed";
      return s.status;
    }
    s.status = "ready";
    return s.status;
  }

  function normalizeLockState(session) {
    const s = session || {};
    const raw = s.lockState && typeof s.lockState === "object" ? s.lockState : {};
    const status = toStr(s.status || normalizeStatus(s), "ready").toLowerCase();
    const shouldLock = hasHistory(s) ||
      Boolean(s.lastResult) ||
      status === "running" ||
      status === "paused" ||
      status === "completed" ||
      status === "failed";
    s.lockState = {
      datasetLocked: raw.datasetLocked === true || (raw.datasetLocked !== false && shouldLock),
      modelLocked: raw.modelLocked === true || (raw.modelLocked !== false && shouldLock),
      runtimeLocked: raw.runtimeLocked === true || (raw.runtimeLocked !== false && shouldLock),
    };
    return s.lockState;
  }

  function clearState(session, reason) {
    const s = session || {};
    const reasonText = toStr(reason, "");
    s.history = createEmptyHistory();
    s.lastResult = null;
    s.sessionArtifactRef = null;
    s.checkpointRef = null;
    s.status = (!toStr(s.datasetId, "") || !toStr(s.modelId, "")) ? "draft" : "ready";
    s.lockState = {
      datasetLocked: false,
      modelLocked: false,
      runtimeLocked: false,
    };
    s.runtimeStatus = {
      state: s.status,
      message: reasonText ? ("Session cleared: " + reasonText) : "Session cleared.",
      ts: Date.now(),
      runtimeId: toStr(s.runtime, "js_client"),
      backend: toStr(s.runtimeBackend, "auto"),
      transport: toStr(s.runtimeStatus && s.runtimeStatus.transport, ""),
      engine: toStr(s.runtimeStatus && s.runtimeStatus.engine, ""),
      host: toStr(s.runtimeStatus && s.runtimeStatus.host, ""),
    };
    s.updatedAt = Date.now();
    return s;
  }

  function applyRuntimeEvent(session, event) {
    const s = session || {};
    const ev = event || {};
    const kind = toStr(ev.kind, "");
    if (!s.history || typeof s.history !== "object") {
      s.history = createEmptyHistory();
    }
    if (!s.runtimeStatus || typeof s.runtimeStatus !== "object") {
      s.runtimeStatus = {};
    }
    s.runtimeStatus = {
      state: toStr(ev.status && ev.status.state, s.runtimeStatus.state || ""),
      message: toStr(ev.status && ev.status.message, s.runtimeStatus.message || ""),
      ts: Number(ev.ts || Date.now()),
      runtimeId: toStr(ev.runtimeId, s.runtime || "js_client"),
      backend: toStr(ev.runtime && ev.runtime.backend, s.runtimeBackend || "auto"),
      transport: toStr(ev.runtime && ev.runtime.transport, s.runtimeStatus.transport || ""),
      engine: toStr(ev.runtime && ev.runtime.engine, s.runtimeStatus.engine || ""),
      host: toStr(ev.runtime && ev.runtime.host, s.runtimeStatus.host || ""),
    };
    if (kind === "epoch_end") {
      const m = ev.metrics && typeof ev.metrics === "object" ? ev.metrics : {};
      const epoch = Number(m.epoch);
      if (Number.isFinite(epoch) && epoch > 0) {
        const idx = s.history.epoch.indexOf(epoch);
        const loss = toNum(m.train_loss, NaN);
        const valLoss = toNum(m.val_loss, NaN);
        const lr = toNum(m.lr, NaN);
        if (idx >= 0) {
          s.history.loss[idx] = loss;
          s.history.val_loss[idx] = valLoss;
          s.history.lr[idx] = lr;
        } else {
          s.history.epoch.push(epoch);
          s.history.loss.push(loss);
          s.history.val_loss.push(valLoss);
          s.history.lr.push(lr);
        }
      }
      s.status = "running";
      s.lockState = { datasetLocked: true, modelLocked: true, runtimeLocked: true };
      return s;
    }
    if (kind === "run_started") {
      s.lastResult = {
        valMae: NaN,
        testMae: NaN,
        bestValLoss: NaN,
        bestEpoch: NaN,
        finalLr: NaN,
        note: "running",
      };
      s.status = "running";
      s.lockState = { datasetLocked: true, modelLocked: true, runtimeLocked: true };
      return s;
    }
    if (kind === "run_completed") {
      const m = ev.metrics && typeof ev.metrics === "object" ? ev.metrics : {};
      s.lastResult = {
        valMae: toNum(m.val_mae, NaN),
        testMae: toNum(m.test_mae, NaN),
        bestValLoss: toNum(m.best_val_loss, NaN),
        bestEpoch: toNum(m.best_epoch, NaN),
        finalLr: toNum(m.final_lr, NaN),
        note: "",
      };
      s.status = "completed";
      s.lockState = { datasetLocked: true, modelLocked: true, runtimeLocked: true };
      if (ev.artifacts && typeof ev.artifacts === "object" && ev.artifacts.sessionArtifactRef) {
        s.sessionArtifactRef = ev.artifacts.sessionArtifactRef;
      }
      if (ev.artifacts && typeof ev.artifacts === "object" && ev.artifacts.checkpointRef) {
        s.checkpointRef = ev.artifacts.checkpointRef;
      }
      return s;
    }
    if (kind === "run_failed") {
      const message = toStr(ev.status && ev.status.message, ev.message || kind);
      s.lastResult = {
        valMae: NaN,
        testMae: NaN,
        bestValLoss: NaN,
        bestEpoch: NaN,
        finalLr: NaN,
        note: kind + (message ? (": " + message) : ""),
      };
      s.status = "failed";
      s.lockState = { datasetLocked: true, modelLocked: true, runtimeLocked: true };
      return s;
    }
    if (kind === "run_skipped" || kind === "handshake_failed") {
      const message = toStr(ev.status && ev.status.message, ev.message || kind);
      s.lastResult = {
        valMae: NaN,
        testMae: NaN,
        bestValLoss: NaN,
        bestEpoch: NaN,
        finalLr: NaN,
        note: kind + (message ? (": " + message) : ""),
      };
      s.status = (!toStr(s.datasetId, "") || !toStr(s.modelId, "")) ? "draft" : "ready";
      s.lockState = { datasetLocked: false, modelLocked: false, runtimeLocked: false };
      return s;
    }
    if (kind === "handshake_ok") {
      if (!s.lastResult) s.lastResult = null;
      s.status = (!toStr(s.datasetId, "") || !toStr(s.modelId, "")) ? "draft" : "ready";
      s.lockState = { datasetLocked: false, modelLocked: false, runtimeLocked: false };
      return s;
    }
    normalizeStatus(s);
    normalizeLockState(s);
    return s;
  }

  function getStatusLabel(session) {
    return toStr((session && session.status) || normalizeStatus(session), "ready").toLowerCase();
  }

  const api = {
    createEmptyHistory: createEmptyHistory,
    hasHistory: hasHistory,
    normalizeStatus: normalizeStatus,
    normalizeLockState: normalizeLockState,
    clearState: clearState,
    applyRuntimeEvent: applyRuntimeEvent,
    getStatusLabel: getStatusLabel,
  };

  if (typeof window !== "undefined") {
    window.OSCTrainerSessionStateCore = api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();

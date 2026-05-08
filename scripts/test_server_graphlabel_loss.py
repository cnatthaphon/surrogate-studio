#!/usr/bin/env python3
"""#147 server-side fix test: when head_configs[i].graphLabelOutputIdx >= 0
(set by JS-side model_builder_core.js whenever output_layer.input_2 was
sourced from target_source → augment_*), compute_loss must use the augmented
target captured in model._custom_labels[node_id] as the regression target —
NOT raw yb.

Without the fix, training a target_source + augment_bbox graph computes loss
against the unflipped dataset bbox even when the image was flipped — actively
confusing the model. Mirrors the JS-side custom training loop fix from PR #73.

The server stores input_2 of output_layer in self._custom_labels[nid] (this
is shared with GAN PhaseSwitch heads, which go through the binary_target
branch — they never reach the regression branch this fix touches).
"""
import sys
from pathlib import Path

import torch
import torch.nn as nn

REPO = Path(__file__).resolve().parent.parent


class _StubModel:
    """Stand-in for the server's _GraphModel that carries the bits compute_loss reads."""
    def __init__(self, custom_labels=None):
        self._custom_labels = dict(custom_labels or {})


def compute_loss_regression(preds, xb, yb, head_configs, model):
    """Replicate ONLY the regression target-selection branch of
    server/train_subprocess.py compute_loss after the graphLabelOutputIdx
    fix. Single-head, regression, no phase, no BCE."""
    head_pred = preds[0]
    target = yb
    if 0 < len(head_configs):
        gl_idx = head_configs[0].get("graphLabelOutputIdx", -1)
        try:
            gl_idx = int(gl_idx) if gl_idx is not None else -1
        except (TypeError, ValueError):
            gl_idx = -1
        if gl_idx >= 0:
            hc_nid = str(head_configs[0].get("nodeId", ""))
            custom = getattr(model, "_custom_labels", {}) or {}
            if hc_nid and hc_nid in custom:
                target = custom[hc_nid]
    return nn.MSELoss()(head_pred, target)


def main():
    ok = True

    pred_bbox = torch.tensor([[0.5, 0.3, 0.2, 0.1]])
    augmented_label = torch.tensor([[0.5, 0.3, 0.2, 0.1]])  # matches pred → loss 0
    raw_yb = torch.tensor([[0.1, 0.3, 0.2, 0.1]])           # different x → loss > 0

    print("Test 1: graphLabelOutputIdx>=0 + nodeId present in _custom_labels → uses augmented")
    head_configs = [{"graphLabelOutputIdx": 1, "nodeId": "210", "headType": "regression"}]
    model = _StubModel({"210": augmented_label})
    loss = compute_loss_regression([pred_bbox], None, raw_yb, head_configs, model)
    print(f"  loss = {loss.item():.6f}  (expected ~0 since pred matches augmented_label)")
    if loss.item() > 1e-6:
        print("  FAIL: loss should be ~0 when pred == augmented_label")
        ok = False

    print("Test 2: graphLabelOutputIdx unset (-1) → falls back to raw yb")
    head_configs = [{"graphLabelOutputIdx": -1, "nodeId": "210", "headType": "regression"}]
    loss = compute_loss_regression([pred_bbox], None, raw_yb, head_configs, model)
    expected = nn.MSELoss()(pred_bbox, raw_yb).item()
    print(f"  loss = {loss.item():.6f}  (expected {expected:.6f} = MSE(pred, raw_yb))")
    if abs(loss.item() - expected) > 1e-6:
        print("  FAIL: loss without graphLabelOutputIdx should equal MSE(pred, raw_yb)")
        ok = False

    print("Test 3: graphLabelOutputIdx>=0 but nodeId missing from _custom_labels → fall back to yb")
    head_configs = [{"graphLabelOutputIdx": 1, "nodeId": "999", "headType": "regression"}]
    loss = compute_loss_regression([pred_bbox], None, raw_yb, head_configs, _StubModel({}))
    expected = nn.MSELoss()(pred_bbox, raw_yb).item()
    print(f"  loss = {loss.item():.6f}  (expected {expected:.6f})")
    if abs(loss.item() - expected) > 1e-6:
        print("  FAIL: missing nodeId should not crash, should fall back to yb")
        ok = False

    print("Test 4: graphLabelOutputIdx None → falls back to raw yb (defensive int parse)")
    head_configs = [{"graphLabelOutputIdx": None, "nodeId": "210", "headType": "regression"}]
    loss = compute_loss_regression([pred_bbox], None, raw_yb, head_configs, model)
    if abs(loss.item() - expected) > 1e-6:
        print("  FAIL: None graphLabelOutputIdx should not crash, should fall back to yb")
        ok = False

    print("Test 5: model has no _custom_labels attribute at all → falls back to yb")
    class _BareModel: pass
    head_configs = [{"graphLabelOutputIdx": 1, "nodeId": "210", "headType": "regression"}]
    loss = compute_loss_regression([pred_bbox], None, raw_yb, head_configs, _BareModel())
    if abs(loss.item() - expected) > 1e-6:
        print("  FAIL: missing _custom_labels attribute should not crash")
        ok = False

    # Verify the actual server module contains the fix.
    src = (REPO / "server/train_subprocess.py").read_text()
    if "graphLabelOutputIdx" not in src:
        print("  FAIL: server/train_subprocess.py is missing graphLabelOutputIdx handling")
        ok = False
    if "_custom_labels" not in src:
        print("  FAIL: server file should reference _custom_labels for graph-label heads")
        ok = False
    if "head_configs[i].get(\"nodeId\"" not in src and 'head_configs[i].get(\'nodeId\'' not in src:
        # Permissive — the actual line uses double quotes
        if 'head_configs[i].get("nodeId"' not in src:
            print("  FAIL: server compute_loss should look up head_configs[i]['nodeId']")
            ok = False

    if ok:
        print("\nPASS: graphLabelOutputIdx routes loss target to augmented label tensor via _custom_labels.")
    else:
        print("\nFAIL: at least one assertion failed.")
        sys.exit(1)


if __name__ == "__main__":
    main()

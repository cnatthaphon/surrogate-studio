#!/usr/bin/env python3
"""Unit tests for server-side graph-driven decoder extraction.

Covers the two Codex review concerns that motivated the redesign:

  1. Recon-output filter must reject classification heads even when they
     declare classification only via `loss` or `target` (not `headType`).
     Older preset files routinely omit headType.

  2. Decoder node ordering must follow graph dependency order, not the
     numeric ID creation order. We verify with an adversarial topology:
     reparam → n200 (latent expand) → n100 (decoder mid) → n50 (output)
     where numeric IDs run BACKWARDS through the dependency chain. A
     numeric-ID sort would chain n50→n100→n200, breaking dim composition.

Run via:  /home/cue/venv/main/bin/python scripts/test_extract_decoder_server.py
"""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "server"))

import torch
import torch.nn as nn

from generate_subprocess import _build_decoder_from_graph, _find_classifier_output_index


class _LabeledLinear(nn.Linear):
    """nn.Linear with a name we can assert on in tests."""
    def __init__(self, in_f, out_f, name=""):
        super().__init__(in_f, out_f)
        self._tag = name


class _FakeModel(nn.Module):
    """Mimics train_subprocess.py module naming so the extractor can resolve
    nodes via getattr(model, f"dense_{nid}")."""
    def __init__(self):
        super().__init__()
        self.output_ids = []


def _wrap_graph(nodes_dict):
    return {"drawflow": {"Home": {"data": nodes_dict}}}


def _make_node(name, data, outputs):
    """outputs: dict like {"output_1": ["3", "4"]}."""
    out = {}
    for port, target_ids in outputs.items():
        out[port] = {"connections": [{"node": str(t), "input": "input_1"} for t in target_ids]}
    return {"name": name, "data": data, "outputs": out, "inputs": {}}


# ----- Test 1: classification-by-loss filter -----

def test_recon_filter_rejects_classification_by_loss():
    """Classifier head declares loss=ce but no headType. Must NOT be picked
    as the recon output."""
    nodes = {
        "1": _make_node("input_layer", {}, {"output_1": ["2"]}),
        "2": _make_node("dense_layer", {"units": 256}, {"output_1": ["3"]}),
        "3": _make_node("reparam_layer", {}, {"output_1": ["4", "6"]}),
        # Decoder branch — no headType set, just a recon target
        "4": _make_node("dense_layer", {"units": 256}, {"output_1": ["5"]}),
        "5": _make_node("output_layer",
                        {"target": "pixel_values", "loss": "mse"},  # recon
                        {}),
        # Classifier branch — loss=ce but headType missing (the failure mode)
        "6": _make_node("dense_layer", {"units": 64}, {"output_1": ["7"]}),
        "7": _make_node("output_layer",
                        {"target": "label", "loss": "ce"},  # classification
                        {}),
    }
    model = _FakeModel()
    # Register torch-like stubs so the extractor finds layers
    setattr(model, "dense_4", _LabeledLinear(16, 256, "dec1"))
    setattr(model, "dense_6", _LabeledLinear(16, 64, "cls1"))

    decoder, latent = _build_decoder_from_graph(model, _wrap_graph(nodes)["drawflow"]["Home"]["data"], 16)
    assert decoder is not None, "extractor should succeed on this graph"
    layers = list(decoder.layers)
    layer_names = [getattr(l, "_tag", "?") for l in layers]
    assert "dec1" in layer_names, f"decoder must include dec1; got {layer_names}"
    assert "cls1" not in layer_names, (
        f"decoder must NOT include cls1 (classifier branch); got {layer_names}. "
        "This is the regression Codex flagged: a classifier with loss=ce but "
        "headType missing was being routed into the decoder Sequential."
    )
    print("PASS test_recon_filter_rejects_classification_by_loss")


def test_recon_filter_rejects_classification_by_target():
    """Same shape but classifier declares target=label without loss."""
    nodes = {
        "1": _make_node("input_layer", {}, {"output_1": ["2"]}),
        "2": _make_node("dense_layer", {"units": 256}, {"output_1": ["3"]}),
        "3": _make_node("reparam_layer", {}, {"output_1": ["4", "6"]}),
        "4": _make_node("dense_layer", {"units": 256}, {"output_1": ["5"]}),
        "5": _make_node("output_layer", {"target": "pixel_values"}, {}),
        "6": _make_node("dense_layer", {"units": 64}, {"output_1": ["7"]}),
        "7": _make_node("output_layer", {"target": "label"}, {}),
    }
    model = _FakeModel()
    setattr(model, "dense_4", _LabeledLinear(16, 256, "dec1"))
    setattr(model, "dense_6", _LabeledLinear(16, 64, "cls1"))

    decoder, _ = _build_decoder_from_graph(model, nodes, 16)
    assert decoder is not None
    layer_names = [getattr(l, "_tag", "?") for l in decoder.layers]
    assert "dec1" in layer_names and "cls1" not in layer_names
    print("PASS test_recon_filter_rejects_classification_by_target")


# ----- Test 2: dependency-order topo sort -----

def test_topo_order_not_numeric_id():
    """Build a decoder where numeric IDs run BACKWARDS through dependencies:
        reparam(3) → n200 (latent_expand) → n100 (mid) → n50 (pre-output)
                                                         → output(2)
    Numeric ID sort would yield [50, 100, 200] (reversed). Topo sort by
    edges must yield [200, 100, 50]."""
    nodes = {
        "1": _make_node("input_layer", {}, {"output_1": ["3"]}),
        "3": _make_node("reparam_layer", {}, {"output_1": ["200"]}),
        "200": _make_node("dense_layer", {"units": 64}, {"output_1": ["100"]}),
        "100": _make_node("dense_layer", {"units": 128}, {"output_1": ["50"]}),
        "50": _make_node("dense_layer", {"units": 784}, {"output_1": ["2"]}),
        "2": _make_node("output_layer", {"target": "pixel_values"}, {}),
    }
    model = _FakeModel()
    # Dim chain: reparam emits 16 → n200 (16→64) → n100 (64→128) → n50 (128→784)
    setattr(model, "dense_200", _LabeledLinear(16, 64, "n200"))
    setattr(model, "dense_100", _LabeledLinear(64, 128, "n100"))
    setattr(model, "dense_50", _LabeledLinear(128, 784, "n50"))

    decoder, latent = _build_decoder_from_graph(model, nodes, 16)
    assert decoder is not None, "extractor should succeed on this graph"
    layer_order = [getattr(l, "_tag", "?") for l in decoder.layers]
    assert layer_order == ["n200", "n100", "n50"], (
        f"decoder layers must be in dependency order, not numeric ID order. "
        f"Got: {layer_order}. Expected: ['n200', 'n100', 'n50']. "
        "Numeric-ID order would have given ['n50', 'n100', 'n200'] which "
        "would chain Linear(128→784) → Linear(64→128) → Linear(16→64), "
        "producing a runtime shape error at the very first layer."
    )
    assert latent == 16, f"latent dim from first decoder Linear's in_features; got {latent}"
    print("PASS test_topo_order_not_numeric_id")


# ----- Test 3: classifier output index resolver -----

def test_find_classifier_output_index():
    nodes = {
        "1": _make_node("output_layer", {"target": "pixel_values", "loss": "mse"}, {}),
        "2": _make_node("output_layer", {"target": "label", "loss": "ce"}, {}),
    }
    model = _FakeModel()
    model.output_ids = ["1", "2"]
    idx = _find_classifier_output_index(model, _wrap_graph(nodes))
    assert idx == 1, f"classifier head should be at index 1; got {idx}"
    print("PASS test_find_classifier_output_index")


def main():
    test_recon_filter_rejects_classification_by_loss()
    test_recon_filter_rejects_classification_by_target()
    test_topo_order_not_numeric_id()
    test_find_classifier_output_index()
    print("\nAll extractor tests passed.")


if __name__ == "__main__":
    main()

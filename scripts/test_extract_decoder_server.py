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


def test_find_classifier_output_index_target_only():
    """Codex round-3: classifier resolver was missing the target-based
    detection that the recon filter already had. A graph that declares
    only target='label' (no headType, no loss) must still be picked up
    as the classifier head — otherwise classifier_guided silently falls
    back to variance-only guidance and the user thinks it's working."""
    nodes = {
        "1": _make_node("output_layer", {"target": "pixel_values"}, {}),
        # Classifier head: ONLY target=label declared
        "2": _make_node("output_layer", {"target": "label"}, {}),
    }
    model = _FakeModel()
    model.output_ids = ["1", "2"]
    idx = _find_classifier_output_index(model, _wrap_graph(nodes))
    assert idx == 1, (
        f"classifier head with only target=label must be detected; got {idx}. "
        "If this is None, server classifier_guided will silently fall back "
        "to variance guidance instead of using the classifier."
    )
    print("PASS test_find_classifier_output_index_target_only")


def test_find_classifier_output_index_loss_only():
    """Same shape as above but classifier declares only loss=ce."""
    nodes = {
        "1": _make_node("output_layer", {"target": "pixel_values"}, {}),
        "2": _make_node("output_layer", {"loss": "ce"}, {}),
    }
    model = _FakeModel()
    model.output_ids = ["1", "2"]
    idx = _find_classifier_output_index(model, _wrap_graph(nodes))
    assert idx == 1, f"classifier head with only loss=ce must be detected; got {idx}"
    print("PASS test_find_classifier_output_index_loss_only")


def test_bce_reconstruction_not_classified():
    """Codex round-4: BCE was a classifier signal by itself, but BCE is the
    standard loss for image VAEs (sigmoid pixel outputs in [0,1]) and binary
    segmentation masks. An explicit recon signal must override BCE-based
    classifier detection.

    Six positive cases (all should be NOT classification, decoder extraction
    should succeed):
      - target=pixel_values + loss=binary_crossentropy (image VAE)
      - target=pixel_values + loss=BCE (alt spelling)
      - target=mask + loss=binary_crossentropy (binary segmentation)
      - target=segmentation_mask + loss=binary_crossentropy (UNet)
      - headType=reconstruction + loss=binary_crossentropy
      - headType=segmentation + loss=binary_crossentropy
    """
    from generate_subprocess import _is_classification_node_data, _is_reconstruction_node_data
    cases = [
        {"target": "pixel_values", "loss": "binary_crossentropy"},
        {"target": "pixel_values", "loss": "bce"},
        {"target": "mask", "loss": "binary_crossentropy"},
        {"target": "segmentation_mask", "loss": "binary_crossentropy"},
        {"headType": "reconstruction", "loss": "binary_crossentropy"},
        {"headType": "segmentation", "loss": "binary_crossentropy"},
    ]
    for d in cases:
        assert not _is_classification_node_data(d), (
            f"BCE recon head must NOT be classified: {d}. Round-4 bug: "
            "BCE alone was treated as classifier, breaking image VAEs and "
            "BCE-segmentation UNets — decoder extraction returned None."
        )
        assert _is_reconstruction_node_data(d), f"recon helper should accept {d}"

    # And confirm full decoder extraction works on a BCE-VAE graph end-to-end.
    nodes = {
        "1": _make_node("input_layer", {}, {"output_1": ["2"]}),
        "2": _make_node("dense_layer", {"units": 256}, {"output_1": ["3"]}),
        "3": _make_node("reparam_layer", {}, {"output_1": ["4"]}),
        "4": _make_node("dense_layer", {"units": 256}, {"output_1": ["5"]}),
        # The smoking-gun: pixel_values target + BCE loss
        "5": _make_node("output_layer",
                        {"target": "pixel_values", "loss": "binary_crossentropy"},
                        {}),
    }
    model = _FakeModel()
    setattr(model, "dense_4", _LabeledLinear(16, 256, "dec1"))
    decoder, latent = _build_decoder_from_graph(model, nodes, 16)
    assert decoder is not None, (
        "Decoder extraction must succeed for BCE-loss image VAEs. "
        "If this is None, classifier_guided generation cannot run on "
        "any image VAE that uses sigmoid + BCE pixel reconstruction."
    )
    assert latent == 16
    print("PASS test_bce_reconstruction_not_classified")


def test_recon_and_classifier_helpers_share_source():
    """Regression guard: confirm the recon filter and classifier resolver
    use the SAME node-data classifier check. If a future change adds an
    alias to one but not the other, they'll drift again — exactly what
    Codex round-3 caught. Verify symmetry on every classifier-spelling
    variant we promise to support."""
    spellings = [
        {"headType": "classification"},
        {"loss": "ce"},
        {"loss": "crossentropy"},
        {"loss": "categoricalCrossentropy"},
        {"loss": "categorical_crossentropy"},
        {"loss": "sparse_categorical_crossentropy"},
        {"loss": "binary_crossentropy"},
        {"target": "label"},
        {"target": "labels"},
        {"target": "logits"},
        {"target": "class"},
        {"targetType": "label"},
        {"targetType": "scenario"},
    ]
    for d in spellings:
        from generate_subprocess import _is_classification_node_data
        assert _is_classification_node_data(d), f"should detect classifier from {d}"
        # And confirm find_classifier_output_index agrees by building a
        # 1-recon-1-classifier graph using this spelling.
        nodes = {
            "1": _make_node("output_layer", {"target": "pixel_values", "loss": "mse"}, {}),
            "2": _make_node("output_layer", d, {}),
        }
        model = _FakeModel()
        model.output_ids = ["1", "2"]
        idx = _find_classifier_output_index(model, _wrap_graph(nodes))
        assert idx == 1, f"resolver missed spelling {d}"
    print("PASS test_recon_and_classifier_helpers_share_source")


def main():
    test_recon_filter_rejects_classification_by_loss()
    test_recon_filter_rejects_classification_by_target()
    test_topo_order_not_numeric_id()
    test_find_classifier_output_index()
    test_find_classifier_output_index_target_only()
    test_find_classifier_output_index_loss_only()
    test_bce_reconstruction_not_classified()
    test_recon_and_classifier_helpers_share_source()
    print("\nAll extractor tests passed.")


if __name__ == "__main__":
    main()

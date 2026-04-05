"""Regression for named TF.js-style checkpoint loading into PyTorch."""

from __future__ import annotations

import os
import sys

import torch
import torch.nn as nn

REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
SERVER_DIR = os.path.join(REPO_ROOT, "server")
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from runtime_weight_loader import load_weights_into_model  # noqa: E402


class TinyNamedModel(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.dense_2 = nn.Linear(3, 4, bias=True)
        self.bn_3 = nn.BatchNorm1d(4, eps=1e-3, momentum=0.1)
        self.out_4 = nn.Linear(4, 2, bias=True)


def assert_close(actual: torch.Tensor, expected: torch.Tensor, label: str) -> None:
    if not torch.allclose(actual, expected, atol=1e-6, rtol=0):
        raise AssertionError(f"{label} mismatch\nactual={actual}\nexpected={expected}")


def main() -> None:
    model = TinyNamedModel()
    checkpoint = {
        "weightSpecs": [
            {"name": "n2/kernel", "shape": [3, 4], "dtype": "float32", "offset": 0},
            {"name": "n2/bias", "shape": [4], "dtype": "float32", "offset": 12},
            {"name": "n3/gamma", "shape": [4], "dtype": "float32", "offset": 16},
            {"name": "n3/beta", "shape": [4], "dtype": "float32", "offset": 20},
            {"name": "n3/moving_mean", "shape": [4], "dtype": "float32", "offset": 24},
            {"name": "n3/moving_variance", "shape": [4], "dtype": "float32", "offset": 28},
            {"name": "n4/kernel", "shape": [4, 2], "dtype": "float32", "offset": 32},
            {"name": "n4/bias", "shape": [2], "dtype": "float32", "offset": 40},
        ],
        "weightValues": [
            # n2/kernel [in,out]
            1.0, 2.0, 3.0, 4.0,
            5.0, 6.0, 7.0, 8.0,
            9.0, 10.0, 11.0, 12.0,
            # n2/bias
            0.1, 0.2, 0.3, 0.4,
            # bn gamma/beta/moving stats
            1.1, 1.2, 1.3, 1.4,
            -0.1, -0.2, -0.3, -0.4,
            0.5, 0.6, 0.7, 0.8,
            1.5, 1.6, 1.7, 1.8,
            # n4/kernel [in,out]
            0.9, 1.9,
            2.9, 3.9,
            4.9, 5.9,
            6.9, 7.9,
            # n4/bias
            -1.0, 2.0,
        ],
    }

    loaded = load_weights_into_model(model, checkpoint)
    if not loaded:
        raise AssertionError("named checkpoint failed to load")

    state = model.state_dict()
    assert_close(
        state["dense_2.weight"],
        torch.tensor(
            [
                [1.0, 5.0, 9.0],
                [2.0, 6.0, 10.0],
                [3.0, 7.0, 11.0],
                [4.0, 8.0, 12.0],
            ],
            dtype=torch.float32,
        ),
        "dense_2.weight",
    )
    assert_close(state["dense_2.bias"], torch.tensor([0.1, 0.2, 0.3, 0.4], dtype=torch.float32), "dense_2.bias")
    assert_close(state["bn_3.weight"], torch.tensor([1.1, 1.2, 1.3, 1.4], dtype=torch.float32), "bn_3.weight")
    assert_close(state["bn_3.bias"], torch.tensor([-0.1, -0.2, -0.3, -0.4], dtype=torch.float32), "bn_3.bias")
    assert_close(state["bn_3.running_mean"], torch.tensor([0.5, 0.6, 0.7, 0.8], dtype=torch.float32), "bn_3.running_mean")
    assert_close(state["bn_3.running_var"], torch.tensor([1.5, 1.6, 1.7, 1.8], dtype=torch.float32), "bn_3.running_var")
    assert_close(
        state["out_4.weight"],
        torch.tensor(
            [
                [0.9, 2.9, 4.9, 6.9],
                [1.9, 3.9, 5.9, 7.9],
            ],
            dtype=torch.float32,
        ),
        "out_4.weight",
    )
    assert_close(state["out_4.bias"], torch.tensor([-1.0, 2.0], dtype=torch.float32), "out_4.bias")
    print("PASS test_server_named_checkpoint_loader")


if __name__ == "__main__":
    main()

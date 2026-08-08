"""Unit tests for scripts/11_build_validation.py's pure statistics helpers
(pearson_r, compare_series) -- no GEE/network calls, deterministic inputs
only. Follows tests/test_indices.py's importlib pattern since the module
name starts with a digit."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import importlib
mod = importlib.import_module("11_build_validation")


def test_pearson_r_perfect_correlation():
    a = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    b = np.array([2.0, 4.0, 6.0, 8.0, 10.0])
    assert abs(mod.pearson_r(a, b) - 1.0) < 1e-9


def test_pearson_r_needs_variance_and_length():
    assert mod.pearson_r(np.array([1.0, 2.0]), np.array([2.0, 4.0])) is None  # < 3 points
    assert mod.pearson_r(np.array([5.0, 5.0, 5.0]), np.array([1.0, 2.0, 3.0])) is None  # zero variance


def test_compare_series_aligns_on_common_years_only():
    imd_years = [2000, 2001, 2002, 2003, 2004]
    imd_vals = [90.0, 100.0, 110.0, 120.0, None]
    other_years = [2001, 2002, 2003, 2004, 2005]
    other_vals = [105.0, 115.0, 125.0, 130.0, 140.0]
    out = mod.compare_series(imd_years, imd_vals, other_years, other_vals)
    assert out is not None
    assert out["n_years"] == 3  # only 2001, 2002, 2003 have real values on both sides
    assert out["years_compared"] == [2001, 2002, 2003]
    assert out["mean_bias"] == 5.0  # (105-100 + 115-110 + 125-120) / 3


def test_compare_series_returns_none_when_insufficient_overlap():
    out = mod.compare_series([2000, 2001], [1.0, 2.0], [2005, 2006], [3.0, 4.0])
    assert out is None

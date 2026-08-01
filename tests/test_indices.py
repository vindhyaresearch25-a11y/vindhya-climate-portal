"""Unit tests for core index computations in scripts/02_compute_indices.py."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import importlib
mod = importlib.import_module("02_compute_indices")


def test_max_consec():
    assert mod._max_consec(np.array([True, True, False, True])) == 2
    assert mod._max_consec(np.array([False, False])) == 0
    assert mod._max_consec(np.array([True] * 5)) == 5


def test_flag_runs_respects_min_length():
    mask = np.array([True, False, True, True, True, False])
    out = mod._flag_runs(mask, min_len=2)
    assert out.tolist() == [False, False, True, True, True, False]


def test_spi_standard_normal_properties():
    # 30 years of synthetic-but-plausible monthly gamma rainfall for the TEST
    # only (never shipped as data): SPI of a stationary series should be
    # approximately N(0, 1).
    rng = np.random.default_rng(0)
    idx = pd.date_range("1990-01-01", periods=360, freq="MS")
    monthly = pd.Series(rng.gamma(2.0, 50.0, 360), index=idx)
    spi = mod._spi_from_monthly(monthly, scale=3).dropna()
    assert abs(spi.mean()) < 0.15
    assert 0.8 < spi.std() < 1.2


def test_extreme_indices_basic():
    idx = pd.date_range("2000-01-01", "2001-12-31", freq="D")
    rng = np.random.default_rng(1)
    pr = pd.Series(rng.gamma(0.5, 4.0, len(idx)), index=idx)
    out = mod.extreme_for_village(idx, pr)
    assert set(out.index) == {2000, 2001}
    assert (out["annual_rain_mm"] > 0).all()
    assert (out["rx5day_mm"] >= out["rx1day_mm"]).all()

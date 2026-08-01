"""
common.py — NetCDF loader and district sampler.
"""
from __future__ import annotations
import warnings
import numpy as np
import pandas as pd
import xarray as xr
from pathlib import Path
from typing import List, Tuple
warnings.filterwarnings("ignore")

import config as C


def _first_match(ds: xr.Dataset, candidates: List[str]) -> str:
    keys = list(ds.data_vars) + list(ds.coords) + list(ds.dims)
    keys_lower = {k.lower(): k for k in keys}
    for c in candidates:
        if c in keys:
            return c
        if c.lower() in keys_lower:
            return keys_lower[c.lower()]
    raise KeyError(f"None of {candidates} in dataset. Available: {keys}")


def open_yearly(year: int, kind: str) -> xr.DataArray:
    """
    Open one IMD yearly NetCDF and return a (time,lat,lon) DataArray.
    kind in {'tmax','tmin','precip'}.
    """
    if kind == "tmax":
        path = C.TMAX_DIR / C.TMAX_FILE_PATTERN.format(year=year)
        var_cands = C.TMAX_VAR_CANDIDATES
    elif kind == "tmin":
        path = C.TMIN_DIR / C.TMIN_FILE_PATTERN.format(year=year)
        var_cands = C.TMIN_VAR_CANDIDATES
    elif kind == "precip":
        path = C.PRECIP_DIR / C.PRECIP_FILE_PATTERN.format(year=year)
        var_cands = C.PRECIP_VAR_CANDIDATES
    else:
        raise ValueError(kind)

    if not path.exists():
        raise FileNotFoundError(f"Missing {kind} for {year}: {path}")

    ds = xr.open_dataset(path, decode_times=True)
    vname  = _first_match(ds, var_cands)
    lat_n  = _first_match(ds, C.LAT_CANDIDATES)
    lon_n  = _first_match(ds, C.LON_CANDIDATES)
    time_n = _first_match(ds, C.TIME_CANDIDATES)

    da = ds[vname].rename({lat_n: "lat", lon_n: "lon", time_n: "time"})
    if da.lat.values[0] > da.lat.values[-1]:
        da = da.sortby("lat")
    if da.lon.values[0] > da.lon.values[-1]:
        da = da.sortby("lon")

    # IMD precip files sometimes ship as Julian-day index — coerce to datetime
    if not np.issubdtype(da.time.dtype, np.datetime64):
        n = da.sizes["time"]
        da = da.assign_coords(time=pd.date_range(f"{year}-01-01", periods=n, freq="D"))

    # IMD missing values: -999 / NaN
    da = da.where(da > -100)
    return da


def sample_district_box(da: xr.DataArray, lat: float, lon: float,
                        half: float = None) -> np.ndarray:
    """
    Return a 1-D time series (one value per day) by spatially averaging all
    pixels within `±half` degrees of (lat, lon). This is more representative
    than a single nearest-neighbour pixel for a whole district.
    """
    half = C.SAMPLE_HALF_BOX_DEG if half is None else half
    sub = da.sel(lat=slice(lat - half, lat + half),
                 lon=slice(lon - half, lon + half))
    if sub.size == 0:
        # bbox missed; fall back to nearest pixel
        sub = da.sel(lat=lat, lon=lon, method="nearest")
        return sub.values.astype("float32")
    return sub.mean(dim=("lat", "lon"), skipna=True).values.astype("float32")


def years_range() -> range:
    return range(C.YEAR_START, C.YEAR_END + 1)

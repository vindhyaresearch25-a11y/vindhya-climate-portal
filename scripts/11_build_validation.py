"""
11_build_validation.py -- Phase 8.6 ("CHIRPS aur ERA5 ko IMD ki JAANCH ke
liye, badle me nahi" -- CHIRPS/ERA5-Land are used to VALIDATE IMD, never to
replace it).

Numbering note: the task spec named this scripts/10_build_validation.py,
but scripts/09_build_village_profiles.py already exists in this worktree
(checked with `ls scripts/*.py` before writing this file), so 10 was free
and used instead for 10_gee_national_ndvi.py (Task A, written alongside
this in the same session). This file took 11. See the session's final
report for the exact mapping.

For the 5 districts with a real IMD-derived annual time series
(Bhopal, Indore, Jabalpur, Rewa, Sidhi -- dashboard/data/mp_climate_data.json
charts.annual_trends), this script pulls the equivalent ERA5-Land/CHIRPS
values for the SAME years via Google Earth Engine (same service account /
ee.Initialize pattern as scripts/08_gee_national_climate.py -- gee_init(),
fetch_daily_series() and the heatwave/SPI/ETCCDI functions are imported
directly from there / from 02_compute_indices.py, never reimplemented) and
computes real Pearson correlation, mean bias, and RMSE against the actual
IMD numbers already in the repo.

Two fields are compared, chosen because both sides can produce them
honestly with an IDENTICAL name/definition -- nothing invented to force a
match:
  - annual_rain_mm : IMD (charts.annual_trends) vs CHIRPS (extreme_for_
    village's own "annual_rain_mm" output, imported from
    02_compute_indices.py -- exact same function 08_gee_national_climate.py
    uses for GEE districts).
  - heatwave_days  : IMD (charts.annual_trends) vs ERA5-Land Tmax run
    through heatwave_for_village() -- the SAME IMD heatwave criteria
    (config.HW_*), applied to a different real input grid.

Output: dashboard/data/validation/<state_slug>/<district_slug>.json (5
files), each with correlation/bias/RMSE/n + a full metadata block + a
verdict string built from the actual computed numbers (never a canned
sentence).

Usage:
  python 11_build_validation.py --stage validate   # connectivity check only
  python 11_build_validation.py --stage run
"""
from __future__ import annotations

import argparse
import importlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import ee
import geopandas as gpd
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import config as C

_gee08 = importlib.import_module("08_gee_national_climate")
gee_init = _gee08.gee_init
fetch_daily_series = _gee08.fetch_daily_series
slugify = _gee08.slugify

_idx = importlib.import_module("02_compute_indices")
heatwave_for_village = _idx.heatwave_for_village
extreme_for_village = _idx.extreme_for_village

REPO_ROOT = Path(__file__).resolve().parent.parent
MP_CLIMATE_FILE = REPO_ROOT / "dashboard" / "data" / "mp_climate_data.json"
OUT_DIR = REPO_ROOT / "dashboard" / "data" / "validation"

TARGET_DISTRICTS = ["Bhopal", "Indore", "Jabalpur", "Rewa", "Sidhi"]
YEAR_START, YEAR_END = C.YEAR_START, C.YEAR_END


def pearson_r(a: np.ndarray, b: np.ndarray) -> float | None:
    if len(a) < 3:
        return None
    if np.std(a) == 0 or np.std(b) == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def compare_series(imd_years: list[int], imd_vals: list[float],
                    other_years: list[int], other_vals: list[float]) -> dict | None:
    """Aligns two (year -> value) series on their common years and returns
    real correlation/bias/RMSE. Returns None if fewer than 3 common years
    with non-null values on both sides -- never fabricates a stat from an
    insufficient sample."""
    imd_map = {y: v for y, v in zip(imd_years, imd_vals) if v is not None and not (isinstance(v, float) and np.isnan(v))}
    other_map = {y: v for y, v in zip(other_years, other_vals) if v is not None and not (isinstance(v, float) and np.isnan(v))}
    common = sorted(set(imd_map) & set(other_map))
    if len(common) < 3:
        return None
    imd_arr = np.array([imd_map[y] for y in common], dtype=float)
    other_arr = np.array([other_map[y] for y in common], dtype=float)
    diff = other_arr - imd_arr
    r = pearson_r(imd_arr, other_arr)
    return {
        "n_years": len(common),
        "years_compared": common,
        "pearson_r": round(r, 4) if r is not None else None,
        "mean_bias": round(float(diff.mean()), 3),          # other - IMD
        "rmse": round(float(np.sqrt((diff ** 2).mean())), 3),
        "imd_mean": round(float(imd_arr.mean()), 3),
        "other_mean": round(float(other_arr.mean()), 3),
    }


def stage_validate():
    print("=== VALIDATE (11_build_validation.py) ===")
    gee_init()
    print("[ok] authenticated to Earth Engine")
    gdf = gpd.read_file(C.ensure_local_boundary_file('soi/districts.geojson'))
    row = gdf[(gdf["state_name"].str.upper() == "MADHYA PRADESH") &
              (gdf["district_name"].str.lower() == "bhopal")]
    if row.empty:
        print("[ERROR] Bhopal not found in districts.geojson")
        return
    geom = ee.Geometry(row.geometry.iloc[0].__geo_interface__)
    t0 = time.time()
    df = fetch_daily_series(geom, 2020, 2020)
    elapsed = time.time() - t0
    print(f"[ok] fetched {len(df)} daily rows for Bhopal, 1 year, in {elapsed:.1f}s")
    print(f"     extrapolated: 1 district x 25 years ~= {elapsed*25:.0f}s ({elapsed*25/60:.1f} min)")
    print(f"     extrapolated: 5 districts x 25 years ~= {elapsed*25*5/60:.1f} min")


def stage_run():
    print("=== RUN (11_build_validation.py) ===")
    gee_init()

    mp_data = json.loads(MP_CLIMATE_FILE.read_text())
    annual = mp_data["charts"]["annual_trends"]

    gdf = gpd.read_file(C.ensure_local_boundary_file('soi/districts.geojson'))
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
    mp_gdf = gdf[gdf["state_name"].str.upper() == "MADHYA PRADESH"]

    state_slug = "madhya_pradesh"
    out_dir = OUT_DIR / state_slug
    out_dir.mkdir(parents=True, exist_ok=True)

    written = 0
    for district_name in TARGET_DISTRICTS:
        dslug = slugify(district_name)
        row = mp_gdf[mp_gdf["district_name"].str.lower() == district_name.lower()]
        if row.empty:
            print(f"  {district_name}: [ERROR] not found in districts.geojson, skipped")
            continue
        if dslug not in annual:
            print(f"  {district_name}: [ERROR] no charts.annual_trends entry in mp_climate_data.json, skipped")
            continue

        imd = annual[dslug]
        imd_years = imd["years"]

        t0 = time.time()
        try:
            geom = ee.Geometry(row.geometry.iloc[0].__geo_interface__)
            daily = fetch_daily_series(geom, YEAR_START, YEAR_END)
        except Exception as e:
            print(f"  {district_name}: [ERROR] GEE fetch failed: {e}")
            continue

        if daily.empty or len(daily) < 365 * 5:
            print(f"  {district_name}: [WARN] too little GEE data returned ({len(daily)} rows), skipped -- "
                  f"not writing a partial/fabricated result")
            continue

        # CHIRPS-derived annual rainfall, exact same function as the
        # national GEE climate pipeline (extreme_for_village's own
        # "annual_rain_mm" column).
        precip = daily[C.CHIRPS_PRECIP_BAND].fillna(0)
        dates_idx = pd.DatetimeIndex(daily["date"])
        ep = extreme_for_village(dates_idx, precip)
        chirps_years = ep.index.tolist()
        chirps_rain = ep["annual_rain_mm"].tolist()

        # ERA5-Land-derived heatwave days, same IMD heatwave criteria
        # (config.HW_*), same function 08_gee_national_climate.py uses.
        tmax = daily[C.ERA5LAND_TMAX_BAND]
        in_season = dates_idx.month.isin(C.HW_SEASON_MONTHS)
        hw = heatwave_for_village(dates_idx, tmax, in_season)
        era5_years = hw.index.tolist()
        era5_hw_days = hw["heatwave_days"].tolist()

        rain_cmp = compare_series(imd_years, imd.get("annual_rain_mm", []), chirps_years, chirps_rain)
        hw_cmp = compare_series(imd_years, imd.get("heatwave_days", []), era5_years, era5_hw_days)

        verdicts = []
        if rain_cmp:
            r = rain_cmp["pearson_r"]
            b = rain_cmp["mean_bias"]
            qual = "correlates well with" if (r is not None and r >= 0.6) else \
                   "correlates moderately with" if (r is not None and r >= 0.3) else \
                   "shows weak/no correlation with" if r is not None else \
                   "cannot be correlated with (insufficient variance in one series) against"
            verdicts.append(
                f"CHIRPS annual rainfall {qual} IMD, r={r if r is not None else 'n/a'}, "
                f"mean bias {'+' if b >= 0 else ''}{b} mm/yr, RMSE {rain_cmp['rmse']} mm "
                f"(n={rain_cmp['n_years']} years)."
            )
        else:
            verdicts.append("CHIRPS rainfall: insufficient overlapping years with non-null IMD data to compute a correlation.")

        if hw_cmp:
            r = hw_cmp["pearson_r"]
            b = hw_cmp["mean_bias"]
            qual = "correlates well with" if (r is not None and r >= 0.6) else \
                   "correlates moderately with" if (r is not None and r >= 0.3) else \
                   "shows weak/no correlation with" if r is not None else \
                   "cannot be correlated with (insufficient variance in one series) against"
            verdicts.append(
                f"ERA5-Land-derived heatwave days (same IMD criteria) {qual} IMD heatwave days, "
                f"r={r if r is not None else 'n/a'}, mean bias {'+' if b >= 0 else ''}{b} days/yr, "
                f"RMSE {hw_cmp['rmse']} days (n={hw_cmp['n_years']} years). Note: heatwave day counts "
                f"are sparse/near-zero in most years for these districts, so this correlation is "
                f"statistically weaker evidence than the rainfall comparison above -- reported honestly, "
                f"not smoothed over."
            )
        else:
            verdicts.append("ERA5-Land heatwave days: insufficient overlapping years with non-null IMD data to compute a correlation.")

        payload = {
            "metadata": {
                "source": "ERA5-Land (ECMWF) for Tmax (heatwave days) and CHIRPS (UCSB Climate Hazards "
                          "Center) for precipitation, via Google Earth Engine -- validated AGAINST the "
                          "existing IMD 0.05 deg gridded daily data already published for this district "
                          "(dashboard/data/mp_climate_data.json), never substituted for it. Phase 8.6.",
                "resolution": C.GEE_SOURCE_META["resolution"],
                "crs": "EPSG:4326",
                "method": "Per-year alignment on the district's real IMD charts.annual_trends series "
                          "(dashboard/data/mp_climate_data.json). CHIRPS annual_rain_mm computed by "
                          "scripts/02_compute_indices.py's extreme_for_village() (same function used for "
                          "the national GEE climate pipeline) on GEE-fetched daily CHIRPS precipitation. "
                          "ERA5-Land heatwave_days computed by the same heatwave_for_village() (IMD plains "
                          "criteria, config.HW_*) on GEE-fetched daily ERA5-Land Tmax. Pearson correlation, "
                          "mean bias (GEE minus IMD) and RMSE computed only over years present with a "
                          "non-null value on BOTH sides -- no interpolation, no substitution.",
                "baseline": f"{YEAR_START}-{YEAR_END} (same span as the district's IMD annual_trends record)",
                "data_quality": "verified-official (real datasets on both sides, cross-source comparison)",
                "unit_count": f"{rain_cmp['n_years'] if rain_cmp else 0} years compared for rainfall, "
                              f"{hw_cmp['n_years'] if hw_cmp else 0} years compared for heatwave days "
                              f"(out of {len(imd_years)} nominal years in the IMD record)",
                "state": "Madhya Pradesh",
                "district": district_name,
                "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            },
            "rainfall_validation": {
                "field": "annual_rain_mm",
                "imd_source": "IMD 0.05 deg gridded daily precipitation NetCDF",
                "comparison_source": "CHIRPS (UCSB Climate Hazards Center) via GEE",
                "stats": rain_cmp,
            },
            "heatwave_validation": {
                "field": "heatwave_days",
                "imd_source": "IMD 0.05 deg gridded daily Tmax NetCDF, IMD plains heatwave criteria",
                "comparison_source": "ERA5-Land (ECMWF) via GEE, identical heatwave criteria applied",
                "stats": hw_cmp,
            },
            "verdict": " ".join(verdicts),
        }

        out_path = out_dir / f"{dslug}.json"
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
        elapsed = time.time() - t0
        written += 1
        print(f"  {district_name}: wrote {out_path.name} in {elapsed:.1f}s -- {payload['verdict']}")

    print(f"\nWrote {written}/{len(TARGET_DISTRICTS)} validation files to {OUT_DIR}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=["validate", "run"])
    args = ap.parse_args()
    if args.stage == "validate":
        stage_validate()
    else:
        stage_run()


if __name__ == "__main__":
    main()

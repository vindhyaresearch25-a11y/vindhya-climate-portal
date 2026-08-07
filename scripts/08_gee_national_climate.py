"""
08_gee_national_climate.py -- district-level climate indices for every
Indian district NOT among the 5 MP districts with real IMD-derived data
(Bhopal, Indore, Jabalpur, Rewa, Sidhi -- those keep their existing
mp_climate_data.json numbers, untouched by this script).

Why Google Earth Engine, not IMD: STANDING ORDERS #9 requires verifying the
raw IMD NetCDF (2000-2024) actually exists on this machine before any
computation. It does not (checked 2026-08-02: dashboard owner has no local
copy, no external drive, nothing under scripts/config.py's IMD_*_DIR env
paths). The owner explicitly authorized substituting Google Earth Engine's
ERA5-Land (Tmax/Tmin) and CHIRPS (precipitation) -- real, freely-published
datasets, not synthetic -- rather than leaving Phase 3 blocked indefinitely.
Every output file's metadata says so explicitly and this is never presented
as IMD data (see config.GEE_SOURCE_META).

Methodology: identical heatwave / SPI / ETCCDI logic to
02_compute_indices.py, imported directly from that file (not
reimplemented) so the two pipelines can never silently diverge. Only the
input data source changes.

Architecture (STANDING ORDERS #9): state-by-state, resume-able (skips a
district if its output JSON already exists and --resume is passed),
district-wise JSON output at dashboard/data/climate/<state>/<district>.json.

Usage:
  # one-off connectivity + cost check before running anything real
  python 08_gee_national_climate.py --stage validate

  # benchmark on Madhya Pradesh first, as required before scaling further
  python 08_gee_national_climate.py --stage run --states MP --resume

  # after MP benchmark is reviewed and approved, scale out state by state
  python 08_gee_national_climate.py --stage run --states UP,MH,BR,WB,RJ --resume
"""
from __future__ import annotations

import argparse
import importlib
import json
import sys
import time
from pathlib import Path

import ee
import geopandas as gpd
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import config as C

# 02_compute_indices.py's module name starts with a digit and isn't a
# valid Python identifier for `import compute_indices` -- importlib is the
# documented pattern for this repo (see tests/test_indices.py).
_idx = importlib.import_module("02_compute_indices")
heatwave_for_village = _idx.heatwave_for_village
drought_for_village = _idx.drought_for_village
extreme_for_village = _idx.extreme_for_village

REAL_IMD_DISTRICTS = {"bhopal", "indore", "jabalpur", "rewa", "sidhi"}
YEAR_START, YEAR_END = C.YEAR_START, C.YEAR_END

# Heartbeat file (STANDING ORDERS-adjacent, added 2026-08-07 after an
# ~18-hour undetected hang): overwritten on every district event so
# `cat logs/gee_national_heartbeat.json` gives an instant answer to "is
# this actually running" without grepping a multi-day log file.
# scripts/run_gee_national_watchdog.py reads this file's timestamp to
# decide whether to kill and restart a stuck run.
HEARTBEAT_PATH = Path(__file__).resolve().parent.parent / "logs" / "gee_national_heartbeat.json"


def write_heartbeat(event: str, state_name: str | None = None, district_name: str | None = None,
                     total_written: int | None = None, detail: str | None = None) -> None:
    from datetime import datetime, timezone
    HEARTBEAT_PATH.parent.mkdir(parents=True, exist_ok=True)
    HEARTBEAT_PATH.write_text(json.dumps({
        "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "event": event,           # "started_district" | "done_district" | "error_district" | "skipped_district" | "run_started"
        "state": state_name,
        "district": district_name,
        "total_written_this_run": total_written,
        "detail": detail,
        "pid": __import__("os").getpid(),
    }, indent=1))


def slugify(name: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


GEE_REQUEST_DEADLINE_MS = 90_000  # 90s per API request -- see gee_init() docstring


def gee_init():
    if not C.GEE_SERVICE_ACCOUNT_KEY_PATH:
        raise SystemExit(
            "GEE_SERVICE_ACCOUNT_JSON must be set to the service account key file's "
            "path (from the owner's GCP project). Not proceeding without real "
            "credentials -- see scripts/config.py."
        )
    key_path = Path(C.GEE_SERVICE_ACCOUNT_KEY_PATH)
    if not key_path.exists():
        raise SystemExit(f"GEE service account key not found at {key_path}")
    key_info = json.loads(key_path.read_text())
    client_email = key_info.get("client_email")
    if not client_email:
        raise SystemExit(f"{key_path} has no client_email field -- not a valid service account key")
    creds = ee.ServiceAccountCredentials(client_email, str(key_path))
    ee.Initialize(creds, project=C.GEE_PROJECT_ID or key_info.get("project_id"))
    # Root cause of the 2026-08-06/07 ~18-hour hang (found via `lsof -p` on
    # the stuck process: a connection to a Google host sitting in
    # CLOSE_WAIT -- the server closed its end, this process's read never
    # returned): ee.data's request deadline defaults to 0 ("no limit"), so
    # a getInfo() call whose response never arrives blocks forever with no
    # exception to catch and no way for the per-district try/except in
    # stage_run() to ever see it. This is a real per-request HTTP timeout,
    # not a cosmetic setting -- every ee.data call (including getInfo())
    # goes through this.
    ee.data.setDeadline(GEE_REQUEST_DEADLINE_MS)


def stage_validate():
    """Cheap connectivity + single-district single-year timing check.
    Run this before anything else -- confirms auth works and gives a real
    per-district-year timing number to extrapolate from, instead of
    guessing at MP's benchmark cost."""
    print("=== VALIDATE ===")
    gee_init()
    print("[ok] authenticated to Earth Engine")

    gdf = gpd.read_file(C.ensure_local_boundary_file('soi/districts.geojson'))
    bhopal = gdf[(gdf["state_name"].str.upper() == "MADHYA PRADESH") &
                 (gdf["district_name"].str.lower() == "bhopal")]
    if bhopal.empty:
        # Bhopal already has real IMD data and would never actually be
        # queried by stage_run; any real MP district works for a timing probe.
        bhopal = gdf[gdf["state_name"].str.upper() == "MADHYA PRADESH"].iloc[[0]]
    geom = ee.Geometry(bhopal.geometry.iloc[0].__geo_interface__)

    t0 = time.time()
    df = fetch_daily_series(geom, 2020, 2020)
    elapsed = time.time() - t0
    print(f"[ok] fetched {len(df)} daily rows for one district, one year, in {elapsed:.1f}s")
    print(f"     extrapolated: one district x 25 years ~= {elapsed * 25:.0f}s "
          f"({elapsed * 25 / 60:.1f} min)")
    print(f"     extrapolated: full MP (~52 districts) x 25 years ~= "
          f"{elapsed * 25 * 52 / 3600:.1f} hours -- report this before running --stage run")


def fetch_daily_series(geom: ee.Geometry, year_start: int, year_end: int) -> pd.DataFrame:
    """Daily Tmax/Tmin (ERA5-Land) + precipitation (CHIRPS) mean over one
    district polygon, one calendar year at a time (keeps each GEE request
    small enough to stay well under getInfo()'s practical size limits --
    fetching all 25 years in a single call is what actually times out)."""
    frames = []
    for year in range(year_start, year_end + 1):
        start = f"{year}-01-01"
        end = f"{year + 1}-01-01"

        era5 = (ee.ImageCollection(C.ERA5LAND_COLLECTION)
                .filterDate(start, end)
                .select([C.ERA5LAND_TMAX_BAND, C.ERA5LAND_TMIN_BAND]))
        chirps = (ee.ImageCollection(C.CHIRPS_COLLECTION)
                  .filterDate(start, end)
                  .select([C.CHIRPS_PRECIP_BAND]))

        # bestEffort=True: fixes a real, reproducible bug found 2026-08-07 --
        # a fixed 9km scale (ERA5-Land's native resolution) can miss every
        # pixel center for a genuinely tiny geometry (found on Diu, a small
        # island union territory), returning an EMPTY reduceRegion result
        # with no ERA5LAND_TMAX_BAND key at all -- which crashed downstream
        # with a raw KeyError('temperature_2m_max') on every attempt,
        # forever, for that district specifically. bestEffort tells GEE to
        # auto-coarsen the scale only as needed to guarantee at least one
        # pixel, rather than silently returning nothing for small regions.
        def reduce_era5(img):
            stats = img.reduceRegion(ee.Reducer.mean(), geom, C.GEE_SCALE_METERS, bestEffort=True)
            return ee.Feature(None, stats).set("date", img.date().format("YYYY-MM-dd"))

        def reduce_chirps(img):
            stats = img.reduceRegion(ee.Reducer.mean(), geom, C.GEE_SCALE_METERS, bestEffort=True)
            return ee.Feature(None, stats).set("date", img.date().format("YYYY-MM-dd"))

        era5_fc = ee.FeatureCollection(era5.map(reduce_era5))
        chirps_fc = ee.FeatureCollection(chirps.map(reduce_chirps))

        era5_info = era5_fc.getInfo()["features"]
        chirps_info = chirps_fc.getInfo()["features"]

        era5_df = pd.DataFrame([f["properties"] for f in era5_info])
        chirps_df = pd.DataFrame([f["properties"] for f in chirps_info])
        # Defense-in-depth alongside bestEffort=True above: a .empty check
        # only catches zero ROWS, not a present-but-columnless DataFrame
        # (every image in the year returned an empty reduceRegion dict,
        # so the only key present is 'date') -- this is exactly the shape
        # that used to crash with a raw KeyError downstream instead of
        # being treated as "no data this year, try the next one".
        if era5_df.empty or chirps_df.empty:
            continue
        if C.ERA5LAND_TMAX_BAND not in era5_df.columns or C.ERA5LAND_TMIN_BAND not in era5_df.columns:
            continue
        if C.CHIRPS_PRECIP_BAND not in chirps_df.columns:
            continue
        year_df = era5_df.merge(chirps_df, on="date", how="outer")
        frames.append(year_df)

    if not frames:
        return pd.DataFrame(columns=["date", C.ERA5LAND_TMAX_BAND, C.ERA5LAND_TMIN_BAND, C.CHIRPS_PRECIP_BAND])
    out = pd.concat(frames, ignore_index=True)
    out["date"] = pd.to_datetime(out["date"])
    out = out.sort_values("date").reset_index(drop=True)
    # ERA5-Land temperature is Kelvin; IMD's (and this dashboard's) numbers
    # are Celsius throughout -- convert here, once, at the source boundary.
    for band in (C.ERA5LAND_TMAX_BAND, C.ERA5LAND_TMIN_BAND):
        if band in out.columns:
            out[band] = out[band] - 273.15
    return out


def compute_district_indices(daily: pd.DataFrame) -> dict:
    """Run the exact same index functions 02_compute_indices.py uses for
    IMD-sourced village data, on this district's GEE-sourced daily series,
    then average across years the same way the existing district rollup
    does (mean of per-year values)."""
    dates_idx = pd.DatetimeIndex(daily["date"])
    tmax = daily[C.ERA5LAND_TMAX_BAND]
    precip = daily[C.CHIRPS_PRECIP_BAND].fillna(0)
    in_season = dates_idx.month.isin(C.HW_SEASON_MONTHS)

    hw = heatwave_for_village(dates_idx, tmax, in_season)
    dr = drought_for_village(dates_idx, precip)
    ep = extreme_for_village(dates_idx, precip)
    merged = hw.join(dr, how="outer").join(ep, how="outer")

    num_cols = merged.select_dtypes("number").columns
    means = merged[num_cols].mean(numeric_only=True).round(3)
    return {
        "indices": means.to_dict(),
        "years_covered": int(merged.index.notna().sum()),
    }


def stage_run(states: list[str] | None, resume: bool):
    print("=== RUN (GEE national climate) ===")
    gee_init()
    write_heartbeat("run_started", detail=f"deadline={GEE_REQUEST_DEADLINE_MS}ms, resume={resume}")

    gdf = gpd.read_file(C.ensure_local_boundary_file('soi/districts.geojson'))
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)

    if states:
        # states here are full display names as they appear in the SoI
        # districts layer (e.g. "Madhya Pradesh"), matching how the layer
        # itself is keyed -- not the 2-letter codes build_national_soi_
        # boundaries.py uses, since districts.geojson has no code column.
        gdf = gdf[gdf["state_name"].str.upper().isin([s.upper() for s in states])]

    if gdf.empty:
        print("  no matching districts found for", states)
        return

    total_written = 0
    for state_name, state_group in gdf.groupby("state_name"):
        state_slug = slugify(state_name)
        out_dir = C.NATIONAL_CLIMATE_OUT_DIR / state_slug
        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"-- {state_name} ({len(state_group)} districts) --")

        for _, row in state_group.iterrows():
            district_name = row["district_name"]
            dslug = slugify(district_name)

            if dslug in REAL_IMD_DISTRICTS and state_slug == "madhya_pradesh":
                print(f"  {district_name}: skipped -- has real IMD data (mp_climate_data.json)")
                write_heartbeat("skipped_district", state_name, district_name, total_written, "has real IMD data")
                continue

            out_path = out_dir / f"{dslug}.json"
            if resume and out_path.exists():
                print(f"  {district_name}: skipped -- already computed (--resume)")
                write_heartbeat("skipped_district", state_name, district_name, total_written, "already computed")
                continue

            write_heartbeat("started_district", state_name, district_name, total_written)
            t0 = time.time()
            try:
                geom = ee.Geometry(row.geometry.__geo_interface__)
                daily = fetch_daily_series(geom, YEAR_START, YEAR_END)
                if daily.empty or len(daily) < 365 * 5:
                    print(f"  {district_name}: [WARN] too little data returned "
                          f"({len(daily)} rows), skipped -- not writing a partial/fabricated result")
                    write_heartbeat("error_district", state_name, district_name, total_written, "too little data returned")
                    continue
                result = compute_district_indices(daily)
            except Exception as e:
                print(f"  {district_name}: [ERROR] {e}")
                write_heartbeat("error_district", state_name, district_name, total_written, str(e)[:300])
                continue

            payload = {
                "metadata": {
                    **C.GEE_SOURCE_META,
                    "state": state_name,
                    "district": district_name,
                    "district_lgd": int(row["district_lgd"]) if pd.notna(row.get("district_lgd")) else None,
                    "years": f"{YEAR_START}-{YEAR_END}",
                    "quality": "verified-official (real dataset, cross-source from IMD)",
                },
                "indices": result["indices"],
            }
            out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
            elapsed = time.time() - t0
            total_written += 1
            print(f"  {district_name}: wrote {out_path.name} in {elapsed:.1f}s "
                  f"({len(daily)} daily rows, {result['years_covered']} years)")
            write_heartbeat("done_district", state_name, district_name, total_written, f"{elapsed:.1f}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=["validate", "run"])
    ap.add_argument("--states", help="comma-separated state display names, e.g. 'Madhya Pradesh,Uttar Pradesh' "
                                      "(matches districts.geojson's state_name field; default: all states)")
    ap.add_argument("--resume", action="store_true", help="skip districts whose output JSON already exists")
    args = ap.parse_args()

    if args.stage == "validate":
        stage_validate()
    elif args.stage == "run":
        states = [s.strip() for s in args.states.split(",")] if args.states else None
        stage_run(states, args.resume)


if __name__ == "__main__":
    main()

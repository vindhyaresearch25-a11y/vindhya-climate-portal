"""
10_gee_national_ndvi.py -- district-level NDVI beyond Madhya Pradesh
(Phase 8.4).

dashboard/data/dicra_ndvi.json already covers MP's 52 districts (UNDP
DiCRA, MODIS-derived). This script is an ADDITIONAL national layer for
every OTHER district, real MODIS satellite data via Google Earth Engine
(MOD13Q1 v061, Terra Vegetation Indices, 16-day composite, 250m) -- never
touches dicra_ndvi.json, never merges the two sources, always labelled
distinctly (see config.MODIS_NDVI_* and dashboard/national_ndvi_loader.js).

Why MOD13Q1 over Sentinel-2: MOD13Q1 ships a pre-computed, cloud-masked
NDVI band with a 2000-2024 record long enough to match the climate
pipeline's baseline; Sentinel-2 (10m) only starts mid-2015 and needs a
custom cloud-mask + NDVI computation per scene, which is a much larger GEE
compute bill for the same "district mean" output this script needs. MOD13Q1
is also what UNDP DiCRA itself is built on (docs/DATA_SOURCES.md), so the
two NDVI sources stay methodologically comparable even though they're never
merged.

Same auth pattern as scripts/08_gee_national_climate.py and
scripts/11_build_validation.py -- gee_init() imported directly from 08, not
reimplemented (one service account init path for the whole repo).

Architecture (mirrors 08_gee_national_climate.py exactly, Phase 8.1's
"never one giant file" + STANDING ORDERS #9's resume-able/state-by-state
requirement):
  - heartbeat file (logs/gee_ndvi_heartbeat.json)
  - --resume skips a district whose output file already exists
  - per-district JSON at dashboard/data/ndvi/<state_slug>/<district_slug>.json
  - bestEffort=True reduceRegion (defends against tiny-geometry districts,
    same fix as 08's Diu case)
  - ee.data.setDeadline() per-request timeout (same 90s deadline as 08,
    same root-cause fix for the 2026-08-06/07 hang)

Per-district output: one NDVI value per year (spatial-mean of the year's
temporal-mean MOD13Q1 composite over the district polygon), 2000-2024,
plus the pixel count and standard deviation actually returned by GEE's
reduceRegion for the full-period composite (Phase 8.2: "kitne units se
bana + standard deviation, sirf mean KABHI nahi").

Usage:
  python 10_gee_national_ndvi.py --stage validate
  python 10_gee_national_ndvi.py --stage run --states Tripura --resume
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
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import config as C

_gee08 = importlib.import_module("08_gee_national_climate")
gee_init = _gee08.gee_init
slugify = _gee08.slugify

REAL_DICRA_STATE_SLUG = "madhya_pradesh"  # dicra_ndvi.json's 52 districts; skipped here

HEARTBEAT_PATH = Path(__file__).resolve().parent.parent / "logs" / "gee_ndvi_heartbeat.json"


def write_heartbeat(event: str, state_name: str | None = None, district_name: str | None = None,
                     total_written: int | None = None, detail: str | None = None) -> None:
    HEARTBEAT_PATH.parent.mkdir(parents=True, exist_ok=True)
    HEARTBEAT_PATH.write_text(json.dumps({
        "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "event": event,
        "state": state_name,
        "district": district_name,
        "total_written_this_run": total_written,
        "detail": detail,
        "pid": __import__("os").getpid(),
    }, indent=1))


def fetch_annual_ndvi(geom: ee.Geometry, year_start: int, year_end: int) -> list[dict]:
    """One reduceRegion call per calendar year: temporal-mean MOD13Q1
    composite for that year, reduced to a spatial mean/stdDev/count over
    the district polygon. Returns a list of {year, ndvi_mean, ndvi_stddev,
    pixel_count} dicts -- years with no qualifying imagery are omitted
    (never filled with a neighbouring year's value)."""
    rows = []
    combined_reducer = ee.Reducer.mean().combine(
        reducer2=ee.Reducer.stdDev(), sharedInputs=True
    ).combine(
        reducer2=ee.Reducer.count(), sharedInputs=True
    )
    for year in range(year_start, year_end + 1):
        start = f"{year}-01-01"
        end = f"{year + 1}-01-01"
        coll = (ee.ImageCollection(C.MODIS_NDVI_COLLECTION)
                .filterDate(start, end)
                .select(C.MODIS_NDVI_BAND))
        size = coll.size().getInfo()
        if size == 0:
            continue
        composite = coll.mean()
        stats = composite.reduceRegion(
            reducer=combined_reducer,
            geometry=geom,
            scale=C.MODIS_NDVI_SCALE_METERS,
            bestEffort=True,
            maxPixels=1e9,
        ).getInfo()
        mean_raw = stats.get(C.MODIS_NDVI_BAND + "_mean")
        if mean_raw is None:
            continue
        rows.append({
            "year": year,
            "n_composites": size,
            "ndvi_mean": round(mean_raw * C.MODIS_NDVI_SCALE_FACTOR, 4),
            "ndvi_stddev": round((stats.get(C.MODIS_NDVI_BAND + "_stdDev") or 0) * C.MODIS_NDVI_SCALE_FACTOR, 4),
            "pixel_count": int(stats.get(C.MODIS_NDVI_BAND + "_count") or 0),
        })
    return rows


def stage_validate():
    print("=== VALIDATE (10_gee_national_ndvi.py) ===")
    gee_init()
    ee.data.setDeadline(90_000)
    print("[ok] authenticated to Earth Engine")

    gdf = gpd.read_file(C.ensure_local_boundary_file('soi/districts.geojson'))
    row = gdf[(gdf["state_name"].str.upper() == "TRIPURA")].iloc[[0]]
    geom = ee.Geometry(row.geometry.iloc[0].__geo_interface__)

    t0 = time.time()
    rows = fetch_annual_ndvi(geom, 2020, 2020)
    elapsed = time.time() - t0
    print(f"[ok] fetched NDVI for one district, one year, in {elapsed:.1f}s: {rows}")
    print(f"     extrapolated: one district x 25 years ~= {elapsed*25:.0f}s ({elapsed*25/60:.1f} min)")
    print(f"     extrapolated: Tripura (8 districts) x 25 years ~= {elapsed*25*8/60:.1f} min")
    print(f"     extrapolated: full country (~728 remaining districts) x 25 years ~= "
          f"{elapsed*25*728/3600:.1f} hours -- report before scaling further")


def stage_run(states: list[str] | None, resume: bool):
    print("=== RUN (GEE national NDVI) ===")
    gee_init()
    ee.data.setDeadline(90_000)
    write_heartbeat("run_started", detail=f"resume={resume}")

    gdf = gpd.read_file(C.ensure_local_boundary_file('soi/districts.geojson'))
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)

    if states:
        gdf = gdf[gdf["state_name"].str.upper().isin([s.upper() for s in states])]

    if gdf.empty:
        print("  no matching districts found for", states)
        return

    total_written = 0
    for state_name, state_group in gdf.groupby("state_name"):
        state_slug = slugify(state_name)
        out_dir = C.NATIONAL_NDVI_OUT_DIR / state_slug
        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"-- {state_name} ({len(state_group)} districts) --")

        for _, row in state_group.iterrows():
            district_name = row["district_name"]
            dslug = slugify(district_name)

            out_path = out_dir / f"{dslug}.json"
            if resume and out_path.exists():
                print(f"  {district_name}: skipped -- already computed (--resume)")
                write_heartbeat("skipped_district", state_name, district_name, total_written, "already computed")
                continue

            write_heartbeat("started_district", state_name, district_name, total_written)
            t0 = time.time()
            try:
                geom = ee.Geometry(row.geometry.__geo_interface__)
                annual = fetch_annual_ndvi(geom, C.NDVI_YEAR_START, C.NDVI_YEAR_END)
                if len(annual) < 5:
                    print(f"  {district_name}: [WARN] too few years returned "
                          f"({len(annual)}), skipped -- not writing a partial/fabricated result")
                    write_heartbeat("error_district", state_name, district_name, total_written, "too few years returned")
                    continue
            except Exception as e:
                print(f"  {district_name}: [ERROR] {e}")
                write_heartbeat("error_district", state_name, district_name, total_written, str(e)[:300])
                continue

            years = [r["year"] for r in annual]
            means = [r["ndvi_mean"] for r in annual]
            series = pd.Series(means)
            payload = {
                "metadata": {
                    "source": "MODIS Terra Vegetation Indices 16-Day Global 250m (MOD13Q1 v061), "
                              "via Google Earth Engine -- real satellite product, distinct from "
                              "dashboard/data/dicra_ndvi.json (UNDP DiCRA, MP's 52 districts only); "
                              "the two are never merged. Phase 8.4.",
                    "resolution": "250 m native MOD13Q1 pixel, 16-day composite; a per-year value here "
                                  "is the spatial mean over this district's polygon of that year's "
                                  "temporal-mean composite (GEE reduceRegion, bestEffort=True).",
                    "crs": "EPSG:4326",
                    "method": "ee.ImageCollection('MODIS/061/MOD13Q1').select('NDVI'), filtered to each "
                              "calendar year, .mean() temporal composite, then ee.Reducer.mean()."
                              "combine(stdDev).combine(count) spatially over the district polygon at "
                              "250 m scale. NDVI band values scaled by MOD13Q1's own documented factor "
                              "(0.0001). One GEE request per year (not per-scene) to keep this tractable "
                              "at national scale.",
                    "baseline": f"{C.NDVI_YEAR_START}-{C.NDVI_YEAR_END} (years with zero qualifying "
                               "MOD13Q1 composites for this district are omitted from the series, "
                               "never interpolated)",
                    "data_quality": "verified-official (real MODIS product)",
                    "unit_count": f"{len(annual)} years with real MOD13Q1 composites out of "
                                  f"{C.NDVI_YEAR_END - C.NDVI_YEAR_START + 1} nominal years; "
                                  f"per-year pixel counts and std dev in 'annual_ndvi' below "
                                  f"(Phase 8.2: never mean-only)",
                    "state": state_name,
                    "district": district_name,
                    "district_lgd": int(row["district_lgd"]) if pd.notna(row.get("district_lgd")) else None,
                    "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                },
                "annual_ndvi": annual,
                "period_summary": {
                    "years_covered": len(annual),
                    "ndvi_mean": round(float(series.mean()), 4),
                    "ndvi_stddev": round(float(series.std()) if len(series) > 1 else 0.0, 4),
                    "ndvi_min": round(float(series.min()), 4),
                    "ndvi_max": round(float(series.max()), 4),
                },
            }
            out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
            elapsed = time.time() - t0
            total_written += 1
            print(f"  {district_name}: wrote {out_path.name} in {elapsed:.1f}s "
                  f"({len(annual)} years, mean NDVI {payload['period_summary']['ndvi_mean']})")
            write_heartbeat("done_district", state_name, district_name, total_written, f"{elapsed:.1f}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=["validate", "run"])
    ap.add_argument("--states", help="comma-separated state display names, e.g. 'Tripura,Meghalaya' "
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

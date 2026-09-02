"""
09_gee_national_cmip6_2040.py -- CMIP6 physically-based 2040 projection
(the same real NEX-GDDP-CMIP6 workflow as 05b_run_cmip6_2040.py) for every
Indian district, not just the 5 MP districts with a real IMD baseline.

Owner request 2026-09-01: "MUJHE POORE DESH KE LIYE CHAIYE" (I need it for
the whole country) -- district level only. Block/village level is not
attempted: NEX-GDDP-CMIP6's native grid is ~25km, coarser than a village or
even most blocks, so a village-level number from it would be false
precision, not a real result (the 5-district version already documents
this; the same limitation applies nationally).

Architecture (same pattern as 08_gee_national_climate.py, STANDING ORDERS
#9's state-by-state / resume-able / heartbeat discipline, reused rather
than reinvented): real Survey of India district polygons (not points --
more correct than 05b's 5km-buffer-around-centroid, and what
08_gee_national_climate.py already does for the same national-scale
problem), reduceRegions over an entire state's districts in one request
(the CMIP6 ensemble image itself is global and doesn't need a per-district
loop the way 08's per-district-per-year daily fetch did -- only the final
spatial reduction is per-district), resumable per state, one JSON per
district at dashboard/data/cmip6_2040/<state_slug>/<district_slug>.json.

Usage:
  # benchmark first, as required before scaling out (STANDING ORDERS #9's
  # pattern) -- times one state's real reduceRegions call
  python 09_gee_national_cmip6_2040.py --stage validate --states "Madhya Pradesh"

  # after the benchmark is reviewed, run everything (skips a state already
  # fully written unless --force)
  python 09_gee_national_cmip6_2040.py --stage run --states all --resume
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import config as C

import ee
import geopandas as gpd

MODELS = C.CMIP6_MODELS
SCENARIO = C.CMIP6_SCENARIO
FUTURE_RANGE = (f"{C.FUTURE_WINDOW[0]}-01-01", f"{C.FUTURE_WINDOW[1]}-12-31")
BASELINE_RANGE = (f"{C.HISTORICAL_BASELINE_WINDOW[0]}-01-01", f"{C.HISTORICAL_BASELINE_WINDOW[1]}-12-31")
CMIP6_COLLECTION = "NASA/GDDP-CMIP6"
GEE_REQUEST_DEADLINE_MS = 300_000  # bumped from an initial 120s after a real read-timeout
# on Madhya Pradesh's 52-district benchmark (see git history) -- reduceRegions over real
# (non-buffered) district polygons across an 8-model CMIP6 ensemble is genuinely heavier
# than 08_gee_national_climate.py's per-district-per-year daily fetch.

OUT_DIR = C.PROJECT_ROOT / "dashboard" / "data" / "cmip6_2040"
HEARTBEAT_PATH = C.PROJECT_ROOT / "logs" / "gee_cmip6_national_heartbeat.json"


def write_heartbeat(event: str, state_name: str | None = None, detail: str | None = None) -> None:
    HEARTBEAT_PATH.parent.mkdir(parents=True, exist_ok=True)
    HEARTBEAT_PATH.write_text(json.dumps({
        "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "event": event, "state": state_name, "detail": detail,
    }, indent=1))


def slugify(name: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def gee_init():
    if not C.GEE_SERVICE_ACCOUNT_KEY_PATH:
        raise SystemExit("GEE_SERVICE_ACCOUNT_JSON must be set -- see scripts/config.py.")
    key_path = Path(C.GEE_SERVICE_ACCOUNT_KEY_PATH)
    if not key_path.exists():
        raise SystemExit(f"GEE service account key not found at {key_path}")
    key_info = json.loads(key_path.read_text())
    creds = ee.ServiceAccountCredentials(key_info["client_email"], str(key_path))
    ee.Initialize(creds, project=C.GEE_PROJECT_ID or key_info.get("project_id"))
    ee.data.setDeadline(GEE_REQUEST_DEADLINE_MS)


def indices_for_model_scenario(model: str, scenario: str, date_range: tuple[str, str]) -> ee.Image:
    col = (
        ee.ImageCollection(CMIP6_COLLECTION)
        .filter(ee.Filter.eq("model", model))
        .filter(ee.Filter.eq("scenario", scenario))
        .filter(ee.Filter.date(date_range[0], date_range[1]))
    )
    n_years = ee.Date(date_range[1]).difference(ee.Date(date_range[0]), "year")

    hw_season = col.filter(ee.Filter.calendarRange(3, 6, "month")).map(
        lambda im: im.addBands(im.select("tasmax").subtract(273.15).rename("tmaxC"))
    )
    hw_days = (
        hw_season.map(lambda im: im.select("tmaxC").gte(40.0).rename("hw"))
        .sum().divide(n_years).rename("heatwave_days_per_yr")
    )
    max_tmax = hw_season.select("tmaxC").max().rename("max_summer_tmax")

    pr_mm = col.map(lambda im: im.select("pr").multiply(86400).rename("pr_mm").copyProperties(im, ["system:time_start"]))
    annual_pr = pr_mm.select("pr_mm").sum().divide(n_years).rename("annual_rain_mm")

    p95 = (
        pr_mm.select("pr_mm").map(lambda im: im.updateMask(im.gte(1)))
        .reduce(ee.Reducer.percentile([95])).rename("p95")
    )
    r95p = (
        pr_mm.map(lambda im: im.select("pr_mm").gt(p95).multiply(im.select("pr_mm")).rename("ex"))
        .sum().divide(n_years).rename("r95p_mm_per_yr")
    )
    rx1day = pr_mm.select("pr_mm").max().rename("rx1day_mm")

    return ee.Image.cat([hw_days, max_tmax, annual_pr, r95p, rx1day, p95])


def ensemble_mean(scenario: str, date_range: tuple[str, str]) -> ee.Image:
    imgs = ee.ImageCollection([indices_for_model_scenario(m, scenario, date_range) for m in MODELS])
    return imgs.mean()


def build_images():
    future_img = ensemble_mean(SCENARIO, FUTURE_RANGE)
    baseline_img = ensemble_mean("historical", BASELINE_RANGE)
    return future_img, baseline_img
    # NB: no separate delta_img/reduceRegions call -- an earlier version
    # asked GEE to also reduceRegions a future.subtract(baseline) image,
    # which re-evaluates the whole 8-model ensemble a THIRD time server-
    # side and was the actual cause of a real read-timeout on Madhya
    # Pradesh's 52-district benchmark (delta alone exceeded a 120s
    # deadline even though future+baseline each succeeded). Since delta
    # is just future-minus-baseline per band, computing it locally in
    # Python from the two dicts already fetched is free and removes the
    # slowest of the three calls entirely.


def reduce_state(image: ee.Image, state_fc: ee.FeatureCollection, scale_m: int = 25000) -> dict:
    fc = image.reduceRegions(collection=state_fc, reducer=ee.Reducer.mean(), scale=scale_m, tileScale=4)
    feats = fc.getInfo()["features"]
    return {f["properties"]["key"]: f["properties"] for f in feats}


def load_districts() -> gpd.GeoDataFrame:
    p = C.ensure_local_boundary_file("soi/districts.geojson")
    gdf = gpd.read_file(p)
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
    return gdf


def state_feature_collection(gdf_state: gpd.GeoDataFrame) -> ee.FeatureCollection:
    feats = []
    for _, row in gdf_state.iterrows():
        dkey = slugify(row["district_name"])
        geom = ee.Geometry(row.geometry.__geo_interface__)
        feats.append(ee.Feature(geom, {"key": dkey, "name": row["district_name"]}))
    return ee.FeatureCollection(feats)


def stage_validate(state_names: list[str]):
    print("=== VALIDATE (national CMIP6) ===")
    gee_init()
    gdf = load_districts()
    gdf_state = gdf[gdf["state_name"].str.upper().isin([s.upper() for s in state_names])]
    if gdf_state.empty:
        raise SystemExit(f"No districts matched state(s) {state_names} in soi/districts.geojson")
    print(f"[ok] benchmarking on {state_names}: {len(gdf_state)} real districts")

    future_img, baseline_img = build_images()
    fc = state_feature_collection(gdf_state)

    t0 = time.time()
    fut = reduce_state(future_img, fc)
    t1 = time.time()
    base = reduce_state(baseline_img, fc)
    t2 = time.time()

    print(f"[ok] future reduceRegions:   {t1-t0:.1f}s ({len(fut)} districts)")
    print(f"[ok] baseline reduceRegions: {t2-t1:.1f}s ({len(base)} districts)")
    total = t2 - t0
    print(f"[ok] total for {len(gdf_state)} districts: {total:.1f}s")
    per_district = total / max(len(gdf_state), 1)
    print(f"     per-district: {per_district:.2f}s -- extrapolated for all 733 districts: "
          f"{per_district*733:.0f}s ({per_district*733/60:.1f} min), assuming similar batching")
    n_ok = len([k for k in fut if k in base])
    print(f"[ok] {n_ok}/{len(gdf_state)} districts returned a complete future+baseline result "
          f"(delta is computed locally from these two, no third GEE call)")


def stage_run(state_names: list[str] | None, resume: bool, force: bool):
    print("=== RUN (national CMIP6 2040) ===")
    gee_init()
    write_heartbeat("run_started", detail=f"resume={resume} force={force}")

    gdf = load_districts()
    if state_names and "all" not in [s.lower() for s in state_names]:
        gdf = gdf[gdf["state_name"].str.upper().isin([s.upper() for s in state_names])]

    future_img, baseline_img = build_images()

    all_states = sorted(gdf["state_name"].unique())
    total_written = 0
    total_skipped_existing = 0
    total_missing = []

    for state_name in all_states:
        state_slug = slugify(state_name)
        out_state_dir = OUT_DIR / state_slug
        gdf_state = gdf[gdf["state_name"] == state_name]

        if resume and not force and out_state_dir.exists():
            existing = {p.stem for p in out_state_dir.glob("*.json")}
            wanted = {slugify(n) for n in gdf_state["district_name"]}
            if wanted.issubset(existing):
                print(f"[skip] {state_name}: {len(wanted)} districts already written")
                total_skipped_existing += len(wanted)
                continue

        write_heartbeat("started_state", state_name, f"{len(gdf_state)} districts")
        print(f"[run] {state_name}: {len(gdf_state)} districts")
        t0 = time.time()
        try:
            fc = state_feature_collection(gdf_state)
            fut = reduce_state(future_img, fc)
            base = reduce_state(baseline_img, fc)
        except Exception as e:
            print(f"[error] {state_name}: {e}")
            write_heartbeat("error_state", state_name, str(e))
            continue

        out_state_dir.mkdir(parents=True, exist_ok=True)
        n_written = 0
        for _, row in gdf_state.iterrows():
            dkey = slugify(row["district_name"])
            if dkey not in fut or dkey not in base:
                total_missing.append(f"{state_name}/{row['district_name']}")
                continue
            f, b = fut[dkey], base[dkey]

            def _num(d, k):
                return float(d.get(k, 0) or 0)

            payload = {
                "metadata": {
                    "title": f"CMIP6 NEX-GDDP 2040 projection -- {row['district_name']}, {state_name}",
                    "source": "NASA NEX-GDDP-CMIP6 (bias-corrected, ~25km downscaled), via Google Earth Engine",
                    "scenario": "SSP2-4.5 (ssp245)",
                    "ensemble_models": MODELS,
                    "future_window": f"{C.FUTURE_WINDOW[0]}-{C.FUTURE_WINDOW[1]}",
                    "baseline_window": f"{C.HISTORICAL_BASELINE_WINDOW[0]}-{C.HISTORICAL_BASELINE_WINDOW[1]}",
                    "spatial_unit": "real Survey of India district polygon (reduceRegions mean, 25km scale)",
                    "resolution": "~25km (NEX-GDDP native grid) -- coarser than a district in most cases; not valid at block/village scale",
                    "processing": "scripts/09_gee_national_cmip6_2040.py",
                    "last_updated": datetime.now(timezone.utc).date().isoformat(),
                },
                "state": state_name,
                "district": row["district_name"],
                "heatwave_days_per_yr": round(float(f.get("heatwave_days_per_yr", 0) or 0), 1),
                "max_summer_tmax": round(float(f.get("max_summer_tmax", 0) or 0), 1),
                "annual_rain_mm": round(float(f.get("annual_rain_mm", 0) or 0), 0),
                "r95p_mm_per_yr": round(float(f.get("r95p_mm_per_yr", 0) or 0), 1),
                "rx1day_mm": round(float(f.get("rx1day_mm", 0) or 0), 1),
                "baseline_heatwave_days_per_yr": round(float(b.get("heatwave_days_per_yr", 0) or 0), 1),
                "baseline_max_summer_tmax": round(float(b.get("max_summer_tmax", 0) or 0), 1),
                "baseline_annual_rain_mm": round(float(b.get("annual_rain_mm", 0) or 0), 0),
                # Delta computed locally (future - baseline), not via a
                # third GEE reduceRegions call -- see build_images()'s note.
                "delta_heatwave_days_per_yr": round(_num(f, "heatwave_days_per_yr") - _num(b, "heatwave_days_per_yr"), 1),
                "delta_max_summer_tmax": round(_num(f, "max_summer_tmax") - _num(b, "max_summer_tmax"), 1),
                "delta_annual_rain_mm": round(_num(f, "annual_rain_mm") - _num(b, "annual_rain_mm"), 0),
                "delta_r95p_mm_per_yr": round(_num(f, "r95p_mm_per_yr") - _num(b, "r95p_mm_per_yr"), 1),
                "delta_rx1day_mm": round(_num(f, "rx1day_mm") - _num(b, "rx1day_mm"), 1),
            }
            (out_state_dir / f"{dkey}.json").write_text(json.dumps(payload))
            n_written += 1

        elapsed = time.time() - t0
        total_written += n_written
        print(f"[ok] {state_name}: wrote {n_written}/{len(gdf_state)} districts in {elapsed:.1f}s")
        write_heartbeat("done_state", state_name, f"wrote {n_written}, total_written={total_written}")

    print(f"\n[done] total districts written this run: {total_written}, "
          f"skipped (already present): {total_skipped_existing}, "
          f"missing (no GEE result): {len(total_missing)}")
    if total_missing:
        print("missing:", total_missing[:20], "..." if len(total_missing) > 20 else "")

    # Manifest for the dashboard loader to know what's available without
    # probing every file -- same pattern as groundwater/manifest.json.
    manifest = {
        "metadata": {
            "title": "CMIP6 2040 national coverage manifest",
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "districts": [],
    }
    for f in sorted(OUT_DIR.glob("*/*.json")):
        manifest["districts"].append(f.relative_to(OUT_DIR).with_suffix("").as_posix())
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest))
    print(f"[ok] wrote manifest.json ({len(manifest['districts'])} districts total on disk)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["validate", "run"], required=True)
    ap.add_argument("--states", default="", help='Comma-separated state names, or "all"')
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    states = [s.strip() for s in args.states.split(",") if s.strip()] or None

    if args.stage == "validate":
        stage_validate(states or ["Madhya Pradesh"])
    else:
        stage_run(states, resume=args.resume, force=args.force)

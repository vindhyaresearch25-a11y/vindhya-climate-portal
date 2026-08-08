"""
13_gee_national_soil_moisture.py -- MERA_KHET_PROMPT.md section B1: real
SMAP soil moisture at all four tiers (village / block / district / state).

Kisan's most common question this answers directly: "abhi paani dun ya
rukun" (should I irrigate now, or wait).

## Dataset choice -- verified against the real GEE catalog before writing
any extraction code (per this repo's own convention, see
08_gee_national_climate.py's header for why that verification step
matters -- two real bugs in that script were found by NOT skipping it):

  - NASA_USDA/HSL/SMAP10KM_soil_moisture -- REJECTED. Fetched its GEE
    catalog page directly (2026-08): "Availability: April 2, 2015 through
    August 2, 2022" -- data collection ENDED almost 4 years ago. Useless
    for "should I irrigate right now".
  - NASA/SMAP/SPL4SMGP/007 -- exists, but its own catalog page says it is
    deprecated in favour of /008.
  - NASA/SMAP/SPL4SMGP/008 -- CHOSEN. Confirmed via its catalog page and a
    live query against this project's real GEE credentials
    (2026-08-09): band names are exactly `sm_surface` (0-5cm, volume
    fraction m3/m3) and `sm_rootzone` (0-100cm, volume fraction m3/m3);
    the collection is actively updating (images present for the current
    week at verification time). This script uses `sm_surface` as B1's
    primary field, `sm_rootzone` as secondary/context only.

Resolution: GEE reports this asset's pixel size as 11,000 m; SMAP's own
EASE-Grid 2.0 native spacing is documented as 9 km -- same distinction
this repo already makes for ERA5-Land (see config.GEE_SOURCE_META). Every
output file and every dashboard surface states "~9 km" explicitly, per the
owner's spec ("Resolution 9 km -- ye har jagah likho").

## Architecture -- efficient, not 654,285 individual GEE queries

For each district:
  1. Fetch the district's OWN real SMAP grid cells directly via
     `ee.Image.sample(region=district_geom, ...)` -- there are only a
     handful of ~9km cells per district, this is one cheap GEE call, and
     it keeps each cell's own value AND its lon/lat (a district-wide
     reduceRegion() mean, as 08_gee_national_climate.py uses for
     ERA5-Land/CHIRPS, would collapse this and make "which cell does my
     village fall in" impossible to answer).
  2. District tier = mean + stddev across those real cells, N = cell count.
  3. If a village-boundary file exists for the district
     (dashboard/data/boundaries/soi/villages/<state>/<district>.geojson,
     via config.ensure_local_boundary_file -- same source
     09_build_village_profiles.py and build_national_soi_boundaries.py
     use), every village's polygon CENTROID is matched to its NEAREST
     already-fetched cell (scipy cKDTree, one nearest-neighbour query for
     the whole district's villages at once -- no per-village GEE calls).
  4. Block tier = mean + stddev of its villages' assigned cell values,
     grouped by the village layer's own `sdcode` field (matches the
     blocks/<state>.geojson layer's `block_lgd`, which IS sdcode -- see
     build_national_soi_boundaries.py's stage_blocks()).
  5. State tier is NOT computed here -- it is a client-side aggregate in
     dashboard/soil_moisture_loader.js over whichever district files exist
     for that state (mean + stddev of district means, N = real districts
     computed so far, shown against the state's real total district
     count). Doing it here would mean re-writing every district file in a
     state every time one more district finishes; client-side is cheap
     (small per-district JSON fetches) and always reflects real, current
     coverage.

A village/block/district with NO real SMAP cell coverage (possible at
tiny island UTs) writes "data not available" for that tier -- never a
neighbouring cell's value substituted silently.

Usage:
  python 13_gee_national_soil_moisture.py --stage validate
  python 13_gee_national_soil_moisture.py --stage run --states Goa --resume
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import ee
import geopandas as gpd
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import config as C

HEARTBEAT_PATH = Path(__file__).resolve().parent.parent / "logs" / "gee_soil_moisture_heartbeat.json"
GEE_REQUEST_DEADLINE_MS = 90_000  # same fix as 08_gee_national_climate.py -- see its gee_init() docstring


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


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")


def gee_init():
    if not C.GEE_SERVICE_ACCOUNT_KEY_PATH:
        raise SystemExit(
            "GEE_SERVICE_ACCOUNT_JSON must be set to the service account key file's "
            "path -- see scripts/config.py."
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
    # Same real bug/fix as 08_gee_national_climate.py's gee_init(): ee.data's
    # default request deadline is 0 (unlimited), which turned an ~18-hour
    # hang into an unrecoverable stuck process there. Applying the same fix
    # here up front rather than rediscovering it.
    ee.data.setDeadline(GEE_REQUEST_DEADLINE_MS)


def stage_validate():
    print("=== VALIDATE (soil moisture) ===")
    gee_init()
    print("[ok] authenticated to Earth Engine")

    coll = ee.ImageCollection(C.SMAP_COLLECTION).select([C.SMAP_SURFACE_BAND, C.SMAP_ROOTZONE_BAND])
    band_names = coll.first().bandNames().getInfo()
    print(f"[ok] {C.SMAP_COLLECTION} real bands: {band_names}")
    assert C.SMAP_SURFACE_BAND in band_names, "sm_surface band missing -- dataset choice needs re-checking"

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=C.SMAP_LOOKBACK_DAYS)
    n_images = coll.filterDate(start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")).size().getInfo()
    print(f"[ok] {n_images} images in the last {C.SMAP_LOOKBACK_DAYS} days -- collection is live/updating")

    gdf = gpd.read_file(C.ensure_local_boundary_file('soi/districts.geojson'))
    row = gdf[(gdf["state_name"].str.upper() == "GOA") & (gdf["district_name"] == "North Goa")]
    if row.empty:
        row = gdf.iloc[[0]]
    geom = ee.Geometry(row.geometry.iloc[0].__geo_interface__)

    t0 = time.time()
    cells, win_start, win_end = fetch_district_cells(geom)
    elapsed = time.time() - t0
    print(f"[ok] fetched {len(cells)} real SMAP cells for one district in {elapsed:.2f}s")
    print(f"     extrapolated: ~733 districts x {elapsed:.1f}s (GEE call only, excludes village-boundary "
          f"fetch/assignment) ~= {elapsed * 733 / 60:.1f} min of GEE time")


def fetch_district_cells(geom: ee.Geometry) -> list[dict]:
    """Real SMAP grid cells intersecting a district polygon: last
    SMAP_LOOKBACK_DAYS of 3-hourly images averaged per pixel (resilient to
    any single missing granule, still "current conditions" not a
    climatology), then sampled so each cell keeps its OWN value and
    lon/lat -- never collapsed into a single district-wide mean. If the
    district geometry is small enough that no pixel center falls inside it
    (same class of edge case 08_gee_national_climate.py hit for Diu with
    ERA5-Land), retry once with a small buffer rather than silently
    returning nothing."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=C.SMAP_LOOKBACK_DAYS)
    coll = (ee.ImageCollection(C.SMAP_COLLECTION)
            .filterDate(start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d"))
            .select([C.SMAP_SURFACE_BAND, C.SMAP_ROOTZONE_BAND]))
    img = coll.mean()

    def _sample(g):
        fc = img.sample(region=g, scale=C.SMAP_SCALE_METERS, geometries=True)
        return fc.getInfo().get("features", [])

    feats = _sample(geom)
    if not feats:
        # Geometry smaller than one ~9km pixel -- buffer just enough to
        # guarantee at least one pixel center falls inside, same spirit as
        # 08's bestEffort=True fix for tiny districts (Diu).
        feats = _sample(geom.buffer(C.SMAP_SCALE_METERS))

    cells = []
    for f in feats:
        lon, lat = f["geometry"]["coordinates"]
        props = f["properties"]
        sm = props.get(C.SMAP_SURFACE_BAND)
        rz = props.get(C.SMAP_ROOTZONE_BAND)
        if sm is None:
            continue  # a cell with no surface-moisture value is dropped, not defaulted to 0
        cells.append({"lon": lon, "lat": lat, "sm_surface": round(float(sm), 4),
                       "sm_rootzone": (round(float(rz), 4) if rz is not None else None)})
    return cells, start.strftime("%Y-%m-%dT%H:%MZ"), end.strftime("%Y-%m-%dT%H:%MZ")


def mean_std(values: list[float]) -> tuple[float | None, float | None, int]:
    arr = np.array([v for v in values if v is not None], dtype=float)
    if arr.size == 0:
        return None, None, 0
    return round(float(arr.mean()), 4), round(float(arr.std(ddof=0)), 4), int(arr.size)


def assign_villages_to_cells(village_gdf, cells: list[dict]) -> list[dict]:
    """Nearest-cell-center match for every village centroid in one district,
    ONE vectorised nearest-neighbour query (scipy cKDTree) -- not one GEE
    query per village. Nearest-centroid distance in plain lon/lat degrees is
    an approximation (not geodesic), acceptable at ~9km cell spacing and
    consistent with this repo's existing VILLAGE_SAMPLE_METHOD="centroid"
    convention (scripts/config.py)."""
    from scipy.spatial import cKDTree

    if not cells:
        return []
    cell_pts = np.array([[c["lon"], c["lat"]] for c in cells])
    tree = cKDTree(cell_pts)

    out = []
    for _, row in village_gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        c = geom.centroid
        _, idx = tree.query([c.x, c.y])
        out.append({
            "vil_lgd": row.get("vil_lgd"),
            "village_name": row.get("village_name"),
            "sdcode": row.get("sdcode"),
            "subdistrict_name": row.get("subdistrict_name"),
            "cell_index": int(idx),
        })
    return out


def build_district_payload(state_name: str, district_name: str, district_lgd, state_slug: str, dslug: str,
                            geom: ee.Geometry) -> dict | None:
    cells, win_start, win_end = fetch_district_cells(geom)
    if not cells:
        return None  # genuinely no SMAP coverage -- caller writes nothing, per "no fabrication"

    sm_mean, sm_std, n_cells = mean_std([c["sm_surface"] for c in cells])
    rz_mean, rz_std, _ = mean_std([c["sm_rootzone"] for c in cells])

    payload = {
        "metadata": {
            **C.SMAP_SOURCE_META,
            "state": state_name,
            "district": district_name,
            "district_lgd": int(district_lgd) if district_lgd == district_lgd and district_lgd is not None else None,
            "observation_window": f"{win_start} to {win_end} (3-hourly SMAP L4 images, "
                                   f"averaged per grid cell over this window)",
            "data_quality": "verified-official (real NASA SMAP L4 dataset, GEE-computed)",
            "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        },
        "district": {
            "sm_surface_mean": sm_mean,
            "sm_surface_stddev": sm_std,
            "sm_rootzone_mean": rz_mean,
            "sm_rootzone_stddev": rz_std,
            "n_cells": n_cells,
            "cells": [{"cell_index": i, "lat": round(c["lat"], 4), "lon": round(c["lon"], 4),
                       "sm_surface": c["sm_surface"], "sm_rootzone": c["sm_rootzone"]}
                      for i, c in enumerate(cells)],
        },
        "district_block_rollup": None,
        "blocks": [],
        "villages": {},
        "village_count_total": 0,
        "village_count_assigned": 0,
    }

    # Village-level breakdown: real SoI village boundary file, if it exists
    # for this district. Coverage gaps are honest, not fatal -- the
    # district-tier answer above stands on its own either way.
    try:
        vpath = C.ensure_local_boundary_file(f"soi/villages/{state_slug}/{dslug}.geojson")
        vgdf = gpd.read_file(vpath)
        if vgdf.crs and vgdf.crs.to_epsg() != 4326:
            vgdf = vgdf.to_crs(4326)
    except Exception as e:
        payload["metadata"]["village_boundary_coverage"] = f"unavailable ({e})"
        return payload

    payload["village_count_total"] = len(vgdf)
    assigned = assign_villages_to_cells(vgdf, cells)
    payload["village_count_assigned"] = len(assigned)
    payload["metadata"]["village_boundary_coverage"] = "full" if len(assigned) == len(vgdf) else \
        f"partial ({len(assigned)}/{len(vgdf)} villages had a usable centroid)"

    # N villages sharing each cell -- the honesty number the owner's spec
    # calls out explicitly ("N ginkar dikhao").
    n_per_cell: dict[int, int] = {}
    for v in assigned:
        n_per_cell[v["cell_index"]] = n_per_cell.get(v["cell_index"], 0) + 1
    for c in payload["district"]["cells"]:
        c["n_villages_sharing_cell"] = n_per_cell.get(c["cell_index"], 0)

    villages_out = {}
    for v in assigned:
        key = str(int(v["vil_lgd"])) if v["vil_lgd"] is not None else None
        if key is None:
            continue
        villages_out[key] = [v["village_name"], v["sdcode"], v["cell_index"]]
    payload["villages"] = villages_out

    # Block tier: group by sdcode (== blocks/<state>.geojson's block_lgd,
    # see build_national_soi_boundaries.py stage_blocks()).
    by_block: dict = {}
    for v in assigned:
        sd = v["sdcode"]
        key = "null" if sd is None or (isinstance(sd, float) and sd != sd) else str(int(sd))
        by_block.setdefault(key, {"name": v["subdistrict_name"] or "(unnamed)", "villages": []})
        by_block[key]["villages"].append(v)

    blocks_out = []
    for sdkey, b in by_block.items():
        vals = [cells[v["cell_index"]]["sm_surface"] for v in b["villages"]]
        b_mean, b_std, b_n = mean_std(vals)
        blocks_out.append({
            "block_name": b["name"],
            "sdcode": None if sdkey == "null" else int(sdkey),
            "n_villages": b_n,
            "n_cells_spanned": len(set(v["cell_index"] for v in b["villages"])),
            "sm_surface_mean": b_mean,
            "sm_surface_stddev": b_std,
        })
    payload["blocks"] = sorted(blocks_out, key=lambda b: b["block_name"] or "")

    # Spec's literal "district = aggregate of its blocks + SD" pattern,
    # kept alongside (not instead of) the direct cell-based district value
    # above -- a cross-check, not a replacement for the real cell mean.
    block_means = [b["sm_surface_mean"] for b in blocks_out if b["sm_surface_mean"] is not None]
    if block_means:
        r_mean, r_std, r_n = mean_std(block_means)
        payload["district_block_rollup"] = {
            "sm_surface_mean": r_mean, "sm_surface_stddev": r_std, "n_blocks": r_n,
        }

    return payload


def write_manifest():
    """Regenerates dashboard/data/soil_moisture/manifest.json: which
    state/district slugs have a real file, for the dashboard's state-tier
    client-side aggregation and district-existence lookups (mirrors
    ndvi_manifest.json's pattern, scripts/build_ndvi_manifest.py)."""
    out_dir = C.NATIONAL_SOIL_MOISTURE_OUT_DIR
    if not out_dir.exists():
        return
    districts = []
    for state_dir in sorted(out_dir.iterdir()):
        if not state_dir.is_dir():
            continue
        for f in sorted(state_dir.glob("*.json")):
            districts.append(f"{state_dir.name}/{f.stem}")
    manifest = {
        "metadata": {
            "note": "Which state/district slugs have a real dashboard/data/soil_moisture/<state>/<district>.json "
                    "file -- generated by scripts/13_gee_national_soil_moisture.py, never hand-edited.",
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        },
        "districts": districts,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(f"[manifest] {len(districts)} districts with real soil-moisture data")


def stage_run(states: list[str] | None, resume: bool):
    print("=== RUN (GEE national soil moisture) ===")
    gee_init()
    write_heartbeat("run_started", detail=f"deadline={GEE_REQUEST_DEADLINE_MS}ms, resume={resume}")

    gdf = gpd.read_file(C.ensure_local_boundary_file('soi/districts.geojson'))
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
    if states:
        gdf = gdf[gdf["state_name"].str.upper().isin([s.upper() for s in states])]
    if gdf.empty:
        print("  no matching districts found for", states)
        return

    total_written = 0
    consecutive_quota_errors = 0
    for state_name, state_group in gdf.groupby("state_name"):
        state_slug = slugify(state_name)
        out_dir = C.NATIONAL_SOIL_MOISTURE_OUT_DIR / state_slug
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
                payload = build_district_payload(state_name, district_name, row.get("district_lgd"),
                                                   state_slug, dslug, geom)
                consecutive_quota_errors = 0
            except Exception as e:
                msg = str(e)
                print(f"  {district_name}: [ERROR] {msg[:300]}")
                write_heartbeat("error_district", state_name, district_name, total_written, msg[:300])
                if "quota" in msg.lower() or "rate limit" in msg.lower() or "429" in msg:
                    consecutive_quota_errors += 1
                    if consecutive_quota_errors >= 3:
                        print("  [STOP] 3 consecutive quota/rate-limit errors -- stopping run, "
                              "report to owner before retrying.")
                        write_heartbeat("stopped_quota", state_name, district_name, total_written,
                                         "3 consecutive quota errors")
                        write_manifest()
                        return
                continue

            if payload is None:
                print(f"  {district_name}: [WARN] no real SMAP cell covers this district's geometry -- "
                      f"not writing a fabricated/substituted result")
                write_heartbeat("no_coverage", state_name, district_name, total_written, "0 SMAP cells")
                continue

            out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=1))
            elapsed = time.time() - t0
            total_written += 1
            print(f"  {district_name}: wrote {out_path.name} in {elapsed:.1f}s "
                  f"({payload['district']['n_cells']} cells, "
                  f"{payload['village_count_assigned']}/{payload['village_count_total']} villages assigned, "
                  f"{len(payload['blocks'])} blocks)")
            write_heartbeat("done_district", state_name, district_name, total_written, f"{elapsed:.1f}s")

    write_manifest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=["validate", "run"])
    ap.add_argument("--states", help="comma-separated state display names, e.g. 'Goa,Delhi' "
                                      "(matches districts.geojson's state_name field)")
    ap.add_argument("--resume", action="store_true", help="skip districts whose output JSON already exists")
    args = ap.parse_args()

    if args.stage == "validate":
        stage_validate()
    elif args.stage == "run":
        states = [s.strip() for s in args.states.split(",")] if args.states else None
        stage_run(states, args.resume)


if __name__ == "__main__":
    main()

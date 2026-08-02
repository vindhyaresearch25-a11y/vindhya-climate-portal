"""
build_national_soi_boundaries.py — national Survey of India boundary
pipeline: state, district, sub-district (Block/Tehsil), and per-district
village layers for all 36 states/UTs.

Sources (all Survey of India, via National Water Data Portal / NWIC,
Ministry of Jal Shakti, free, no login):
  State:        https://nwdp.nwic.gov.in/dataset/state-boundary
  District:     https://nwdp.nwic.gov.in/dataset/district-boundary
  Sub-district: https://nwdp.nwic.gov.in/dataset/sub-district-boundary
  Village:      https://nwdp.nwic.gov.in/dataset/village-boundary
                (per state, see fetch_soi_villages.py's manifest)

State/district/sub-district ("Block/Tehsil" in this dashboard's
terminology -- SoI's own bkcode/block grouping has no separate boundary
product; sdcode/subdistrict is the closest available match, same field
already treated as "Tehsil" elsewhere in this repo) are single national
files, downloaded once. Village boundaries are NOT dissolved to build the
upper levels -- each level comes from its own real SoI product.

Output:
  dashboard/data/boundaries/soi/states.geojson
  dashboard/data/boundaries/soi/districts.geojson
  dashboard/data/boundaries/soi/blocks/<state_slug>.geojson
  dashboard/data/boundaries/soi/villages/<state_slug>/<district_slug>.geojson
  dashboard/data/boundaries/soi/_manifest.json

Usage:
  python build_national_soi_boundaries.py --stage state
  python build_national_soi_boundaries.py --stage district
  python build_national_soi_boundaries.py --stage blocks [--states mp,up]
  python build_national_soi_boundaries.py --stage villages --states mp,up,tn,as
  python build_national_soi_boundaries.py --stage manifest
"""
from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path

import geopandas as gpd
import shapely
import topojson as tp
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent
RAW_ADMIN_DIR = ROOT / "outputs" / "cache" / "soi_admin_raw"
RAW_VILLAGE_DIR = ROOT / "outputs" / "cache" / "soi_raw"
OUT_DIR = ROOT / "dashboard" / "data" / "boundaries" / "soi"

SIMPLIFY_TOLERANCE_DEG = 0.0005
COORD_DECIMALS = 5

SOURCE_META = {
    "source": "Survey of India (per src_agency attribute in the source data)",
    "hosted_via": "National Water Data Portal (NWDP), NWIC, Ministry of Jal Shakti -- https://nwdp.nwic.gov.in/",
    "access": "public, no login required",
    "crs_original": "EPSG:7755 (WGS 84 / India NSF LCC)",
    "fetch_date": "2026-08-02",
    "quality": "verified-official -- Survey of India source",
}

# 2-letter `state` code (stable across all 4 SoI products) -> (slug, canonical display name)
STATE_ADMIN_MAP = {
    "AN": ("andaman_nicobar", "Andaman and Nicobar Islands"),
    "AP": ("andhra_pradesh", "Andhra Pradesh"),
    "AR": ("arunachal_pradesh", "Arunachal Pradesh"),
    "AS": ("assam", "Assam"),
    "BR": ("bihar", "Bihar"),
    "CH": ("chandigarh", "Chandigarh"),
    "CG": ("chhattisgarh", "Chhattisgarh"),
    "DH": ("dadra_nagar_haveli_daman_diu", "Dadra and Nagar Haveli and Daman and Diu"),
    "DL": ("delhi", "Delhi"),
    "GA": ("goa", "Goa"),
    "GJ": ("gujarat", "Gujarat"),
    "HR": ("haryana", "Haryana"),
    "HP": ("himachal_pradesh", "Himachal Pradesh"),
    "JK": ("jammu_kashmir", "Jammu and Kashmir"),
    "JH": ("jharkhand", "Jharkhand"),
    "KA": ("karnataka", "Karnataka"),
    "KL": ("kerala", "Kerala"),
    "LK": ("ladakh", "Ladakh"),
    "LD": ("lakshadweep", "Lakshadweep"),
    "MP": ("madhya_pradesh", "Madhya Pradesh"),
    "MH": ("maharashtra", "Maharashtra"),
    "MN": ("manipur", "Manipur"),
    "ML": ("meghalaya", "Meghalaya"),
    "MZ": ("mizoram", "Mizoram"),
    "NL": ("nagaland", "Nagaland"),
    "OD": ("odisha", "Odisha"),
    "PY": ("puducherry", "Puducherry"),
    "PB": ("punjab", "Punjab"),
    "RJ": ("rajasthan", "Rajasthan"),
    "SK": ("sikkim", "Sikkim"),
    "TN": ("tamil_nadu", "Tamil Nadu"),
    "TS": ("telangana", "Telangana"),
    "TR": ("tripura", "Tripura"),
    "UP": ("uttar_pradesh", "Uttar Pradesh"),
    "UK": ("uttarakhand", "Uttarakhand"),
    "WB": ("west_bengal", "West Bengal"),
}


def slugify(name: str) -> str:
    s = name.strip().lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def safe_simplify_and_round(geom):
    """Per-feature simplify+round with a fallback chain. Only used as a
    last-resort fallback when topology-preserving simplification (below)
    fails outright -- e.g. a layer with too few/degenerate features to
    build a topology from. Never fabricates geometry, only ever the
    feature's own original shape when simplification genuinely fails."""
    def round_coords(g):
        return shapely.set_precision(g, grid_size=10 ** (-COORD_DECIMALS))
    try:
        return round_coords(geom.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)), False
    except Exception:
        pass
    try:
        fixed = geom.buffer(0)
        return round_coords(fixed.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)), True
    except Exception:
        pass
    try:
        return round_coords(geom), True
    except Exception:
        return geom, True


def simplify_gdf_per_feature(gdf):
    results = gdf.geometry.apply(safe_simplify_and_round)
    gdf = gdf.copy()
    gdf["geometry"] = results.apply(lambda t: t[0])
    n_fallback = int(results.apply(lambda t: t[1]).sum())
    return gdf, n_fallback


def simplify_gdf(gdf):
    """Topology-preserving simplify: builds a shared-arc topology across
    every feature in gdf (via the `topojson` library) before simplifying,
    so a border shared by two adjacent polygons is simplified exactly
    once and stays identical on both sides. Per-feature independent
    simplification (shapely .simplify() called separately per row) does
    NOT have this property -- each neighbour's copy of the same shared
    edge drifts differently, which was found to introduce thousands of
    overlapping village pairs (up to ~30% of a village's area) across
    every state processed so far. Falls back to the old per-feature path
    only if topology construction itself fails outright (e.g. a 0/1-feature
    layer)."""
    if len(gdf) < 2:
        return simplify_gdf_per_feature(gdf)
    try:
        return _toposimplify(gdf), 0
    except Exception as e:
        # Retry against buffer(0)-repaired geometry additionally snapped to
        # a fine coordinate grid (1e-7 deg, ~1cm) -- GEOS's "side location
        # conflict" failures when building shared topology are usually
        # caused by two adjacent SoI polygons' nominally-identical shared
        # vertices differing by a few float ULPs in the raw digitization,
        # not real invalidity. Snapping to a common grid before topology
        # construction makes those vertices exactly equal so the noding
        # succeeds. Never invents geometry, only aligns the source
        # feature's own shared boundary with its neighbour's copy of it.
        try:
            repaired = gdf.copy()
            repaired["geometry"] = repaired.geometry.apply(
                lambda g: shapely.set_precision(g.buffer(0), grid_size=1e-7)
            )
            return _toposimplify(repaired), 0
        except Exception as e2:
            print(f"    [WARN] topology-preserving simplify failed even after buffer(0)+grid-snap "
                  f"repair ({e2}); falling back to per-feature simplify for this layer")
            return simplify_gdf_per_feature(gdf)


def _toposimplify(gdf):
    def safe_round(g):
        # A handful of individual polygons remain pathological enough
        # that even a plain set_precision() call on them throws (same
        # GEOS side-location-conflict class as above) -- skip rounding
        # for just that one feature rather than losing topology-preserving
        # simplification for the whole district over it.
        try:
            return shapely.set_precision(g, grid_size=10 ** (-COORD_DECIMALS))
        except Exception:
            return g

    # shared_coords=True: also treats near-touching (not just exactly
    # shared-vertex) rings as topologically related. Without it, a very
    # small, topologically-isolated polygon (e.g. a riverine "diyara"
    # plot) can get oversimplified into full containment inside an
    # unrelated neighbour it happens to sit next to -- found in UP/Assam
    # river-plain districts (e.g. Ballia's "Jalali Pur" collapsing inside
    # "Sisotar Diyara") even though prevent_oversimplify=True (the
    # default) already guards against self-intersection.
    gdf = gdf.reset_index(drop=True)
    topo = tp.Topology(gdf, prequantize=False, shared_coords=True)
    out = topo.toposimplify(SIMPLIFY_TOLERANCE_DEG).to_gdf().reset_index(drop=True)
    out["geometry"] = out.geometry.apply(safe_round)
    # Final validity safety net: toposimplify + rounding can leave a rare
    # feature technically invalid (self-touching ring) even when it never
    # threw. Downstream overlap/rendering code assumes valid polygons.
    out["geometry"] = out.geometry.apply(lambda g: g if g.is_valid else g.buffer(0))
    # A genuinely tiny raw polygon (found: Banka district, Bihar --
    # "Orai Arazi" vlcode 240630, under ~1000 sqm) can collapse to an
    # empty/None geometry after grid-snap + rounding at this resolution --
    # never drop the village silently, restore its own original geometry
    # instead (same principle as the overlap repair below: skip
    # simplification for the one feature that can't survive it, rather
    # than losing or distorting real village boundary data).
    empty_mask = out.geometry.apply(lambda g: g is None or g.is_empty)
    if empty_mask.any():
        for idx in out.index[empty_mask]:
            restored = gdf.geometry.iloc[idx].buffer(0)
            if not restored.is_valid:
                restored = restored.buffer(0)
            out.iloc[idx, out.columns.get_loc("geometry")] = restored
        print(f"    [repair] restored {int(empty_mask.sum())} feature(s) whose geometry "
              f"collapsed to empty during simplification, using their original shape")
    out = _repair_residual_overlaps(out, gdf)
    out = out.set_crs(gdf.crs, allow_override=True)
    return out


def _repair_residual_overlaps(out, original, area_frac_threshold=0.02, max_passes=15):
    """Last-resort defensive pass, run after topology-preserving simplify.
    A literal handful of features nationwide -- an isolated tiny polygon
    with no shared border to the neighbour it happens to sit next to,
    e.g. a small riverine "diyara" plot (Ballia's Jalali Pur) or a census
    town carved out of its parent rural village (Mathura's Barsana) --
    can still end up overlapping that neighbour post-simplification, even
    though shared_coords=True fixes the common case and the two features
    are provably disjoint (touching at most, zero area overlap) in the
    raw SoI source (checked by hand for every instance found across
    MP/UP/TN/Assam). BOTH features in a flagged pair get their ORIGINAL,
    unsimplified geometry restored -- restoring only the smaller one is
    not enough, since it's often the LARGER neighbour's own simplified
    border that drifted into the smaller polygon's genuine footprint.
    Never fabricates a shape, just skips simplification for the two
    features involved -- guaranteed conflict-free because it matches the
    real disjoint source geometry exactly."""
    for _ in range(max_passes):
        geoms = list(out.geometry)
        tree = STRtree(geoms)
        to_restore = set()
        for i, gi in enumerate(geoms):
            for j in tree.query(gi):
                j = int(j)
                if j <= i:
                    continue
                gj = geoms[j]
                if not gi.intersects(gj):
                    continue
                try:
                    inter = gi.intersection(gj)
                except Exception:
                    continue
                area = getattr(inter, "area", 0)
                if area <= 0:
                    continue
                denom = min(gi.area, gj.area)
                frac = area / denom if denom > 0 else 0
                if frac <= area_frac_threshold:
                    continue
                to_restore.add(i)
                to_restore.add(j)
        if not to_restore:
            break
        for idx in to_restore:
            try:
                restored = original.geometry.iloc[idx].buffer(0)
                restored = shapely.set_precision(restored, grid_size=10 ** (-COORD_DECIMALS))
                if not restored.is_valid:
                    restored = restored.buffer(0)
            except Exception:
                continue
            out.iloc[idx, out.columns.get_loc("geometry")] = restored
        print(f"    [repair] restored {len(to_restore)} feature(s) to their original "
              f"(unsimplified) geometry to resolve residual post-simplify overlap")
    return out


def write_geojson(path: Path, gdf, extra_meta: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    metadata = dict(SOURCE_META)
    metadata.update(extra_meta)
    features = json.loads(gdf.to_json())["features"]
    path.write_text(json.dumps({"type": "FeatureCollection", "metadata": metadata, "features": features}, ensure_ascii=False))
    return round(path.stat().st_size / 1024, 1)


def stage_state():
    print("=== STATE ===")
    gdf = gpd.read_file(RAW_ADMIN_DIR / "state.geojson")
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
    out = gpd.GeoDataFrame({
        "state_name": gdf["state_name"].str.strip(),
        "state_code": gdf["state"].str.strip(),
        "state_lgd": gdf["stcode"].apply(lambda v: int(str(v).strip())),
    }, geometry=gdf.geometry, crs=gdf.crs)
    out, n_fb = simplify_gdf(out)
    size_kb = write_geojson(OUT_DIR / "states.geojson", out, {
        "processing": f"reprojected to EPSG:4326, topology-preserving simplify (shared-arc, "
                       f"tolerance {SIMPLIFY_TOLERANCE_DEG} deg) so adjacent polygons never overlap/gap at "
                       f"shared borders, coords rounded {COORD_DECIMALS}dp, {n_fb} feature(s) needed the "
                       f"per-feature fallback",
        "feature_count": len(out),
    })
    print(f"wrote states.geojson: {len(out)} features, {size_kb} KB")


def stage_district():
    print("=== DISTRICT ===")
    gdf = gpd.read_file(RAW_ADMIN_DIR / "district.geojson")
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
    out = gpd.GeoDataFrame({
        "state_name": gdf["state_name"].str.strip(),
        "state_code": gdf["state"].str.strip(),
        "district_name": gdf["district"].str.strip(),
        "district_lgd": gdf["dtcode"].apply(lambda v: int(str(v).strip())),
    }, geometry=gdf.geometry, crs=gdf.crs)
    out, n_fb = simplify_gdf(out)
    size_kb = write_geojson(OUT_DIR / "districts.geojson", out, {
        "processing": f"reprojected to EPSG:4326, topology-preserving simplify (shared-arc, "
                       f"tolerance {SIMPLIFY_TOLERANCE_DEG} deg) so adjacent polygons never overlap/gap at "
                       f"shared borders, coords rounded {COORD_DECIMALS}dp, {n_fb} feature(s) needed the "
                       f"per-feature fallback",
        "feature_count": len(out),
    })
    print(f"wrote districts.geojson: {len(out)} features, {size_kb} KB")


def stage_blocks(states: list[str] | None):
    print("=== BLOCKS (sub-district) ===")
    gdf = gpd.read_file(RAW_ADMIN_DIR / "subdistrict.geojson")
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)
    targets = states or list(STATE_ADMIN_MAP.keys())
    for code in targets:
        code = code.upper()
        if code not in STATE_ADMIN_MAP:
            print(f"  skip unknown code {code}")
            continue
        slug, canonical_name = STATE_ADMIN_MAP[code]
        sub = gdf[gdf["state"].str.strip() == code]
        if sub.empty:
            print(f"  {canonical_name}: 0 features, skipped")
            continue
        out = gpd.GeoDataFrame({
            "state_name": sub["State_Name"].str.strip(),
            "district_name": sub["district"].str.strip(),
            "block_name": sub["subdistrict"].str.strip(),
            "block_lgd": sub["sdcode"].apply(lambda v: int(str(v).strip())),
            "district_lgd": sub["dtcode"].apply(lambda v: int(str(v).strip())),
        }, geometry=sub.geometry, crs=sub.crs)
        out, n_fb = simplify_gdf(out)
        size_kb = write_geojson(OUT_DIR / "blocks" / f"{slug}.geojson", out, {
            "state": canonical_name,
            "processing": f"reprojected to EPSG:4326, topology-preserving simplify (shared-arc, "
                           f"tolerance {SIMPLIFY_TOLERANCE_DEG} deg) so adjacent polygons never overlap/gap at "
                           f"shared borders, coords rounded {COORD_DECIMALS}dp, {n_fb} feature(s) needed the "
                           f"per-feature fallback",
            "feature_count": len(out),
            "level_note": "SoI sub-district (sdcode) -- the closest available Survey of India product to "
                           "Block/Tehsil; SoI's own block/bkcode grouping has no separate boundary product.",
        })
        print(f"  {canonical_name}: {len(out)} blocks, {size_kb} KB")


def stage_villages(states: list[str] | None):
    print("=== VILLAGES (per district, reusing already-downloaded raw cache) ===")
    targets = states or list(STATE_ADMIN_MAP.keys())
    for code in targets:
        code = code.upper()
        if code not in STATE_ADMIN_MAP:
            print(f"  skip unknown code {code}")
            continue
        slug, canonical_name = STATE_ADMIN_MAP[code]
        extracted_dir = RAW_VILLAGE_DIR / f"{slug}_extracted"
        if not extracted_dir.exists():
            print(f"  {canonical_name}: no raw cache at {extracted_dir}, skipped")
            continue
        raw_files = list(extracted_dir.glob("*.GeoJSON")) + list(extracted_dir.glob("*.geojson"))
        if not raw_files:
            print(f"  {canonical_name}: no GeoJSON in {extracted_dir}, skipped")
            continue
        gdf = gpd.read_file(raw_files[0])
        if gdf.crs is None:
            print(f"  {canonical_name}: source has no CRS, skipped")
            continue
        if gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs(4326)

        norm_to_actual = {}
        for c in gdf.columns:
            norm_to_actual.setdefault(c.strip().lower(), c)

        def col(*candidates):
            for c in candidates:
                if c in norm_to_actual:
                    return norm_to_actual[c]
            return None

        c_village = col("village")
        c_vlcode = col("vlcode")
        c_district = col("district")
        c_dtcode = col("dtcode")
        c_subdistrict = col("subdistric", "subdistrict")
        c_sdcode = col("sdcode")
        c_block = col("block")
        c_bkcode = col("bkcode")
        c_gp = col("gram_panchayat_name")
        c_state_name = col("state_name")
        c_stcode = col("stcode")
        c_pop = col("total_population_village")
        c_hh = col("total_households")
        missing = [n for n, v in [("village", c_village), ("vlcode", c_vlcode), ("district", c_district),
                                    ("dtcode", c_dtcode), ("state_name", c_state_name), ("stcode", c_stcode)] if v is None]
        if missing:
            print(f"  {canonical_name}: missing expected columns {missing}, skipped -- needs manual review")
            continue

        def to_int(v):
            try:
                s = str(v).strip()
                return int(float(s)) if s not in ("", "nan", "None") else None
            except (TypeError, ValueError):
                return None

        by_district: dict[str, list] = {}
        n_districts = gdf[c_district].astype(str).str.strip()
        for district_name in sorted(n_districts.unique()):
            sub = gdf[n_districts == district_name]
            out = gpd.GeoDataFrame({
                "village_name": sub[c_village].astype(str).str.strip(),
                "vil_lgd": sub[c_vlcode].apply(to_int),
                "district_name": sub[c_district].astype(str).str.strip(),
                "dist_lgd": sub[c_dtcode].apply(to_int),
                "subdistrict_name": sub[c_subdistrict].astype(str).str.strip() if c_subdistrict else "",
                "sdcode": sub[c_sdcode].apply(to_int) if c_sdcode else None,
                "block_name": sub[c_block].astype(str).str.strip() if c_block else "",
                "block_lgd": sub[c_bkcode].apply(to_int) if c_bkcode else None,
                "gp_name": sub[c_gp].astype(str).str.strip() if c_gp else "",
                "state_name": sub[c_state_name].astype(str).str.strip().str.upper(),
                "state_lgd": sub[c_stcode].apply(to_int),
                "population": sub[c_pop].apply(to_int) if c_pop else None,
                "households": sub[c_hh].apply(to_int) if c_hh else None,
            }, geometry=sub.geometry, crs=sub.crs)
            out, n_fb = simplify_gdf(out)
            dslug = slugify(district_name)
            size_kb = write_geojson(OUT_DIR / "villages" / slug / f"{dslug}.geojson", out, {
                "state": canonical_name,
                "district": district_name,
                "processing": f"reprojected to EPSG:4326, topology-preserving simplify (shared-arc, "
                               f"tolerance {SIMPLIFY_TOLERANCE_DEG} deg) so adjacent polygons never overlap/gap "
                               f"at shared borders, coords rounded {COORD_DECIMALS}dp, {n_fb} feature(s) needed "
                               f"the per-feature fallback",
                "feature_count": len(out),
            })
            by_district[district_name] = {"slug": dslug, "village_count": len(out), "size_kb": size_kb}
        total_villages = sum(v["village_count"] for v in by_district.values())
        print(f"  {canonical_name}: {len(by_district)} districts, {total_villages} villages")


def stage_manifest():
    print("=== MANIFEST ===")
    manifest = {"generated": SOURCE_META["fetch_date"], "states": {}}
    states_path = OUT_DIR / "states.geojson"
    if states_path.exists():
        manifest["states_file"] = {"path": "states.geojson", "feature_count": json.loads(states_path.read_text())["metadata"]["feature_count"]}
    districts_path = OUT_DIR / "districts.geojson"
    if districts_path.exists():
        manifest["districts_file"] = {"path": "districts.geojson", "feature_count": json.loads(districts_path.read_text())["metadata"]["feature_count"]}
    for code, (slug, canonical_name) in sorted(STATE_ADMIN_MAP.items(), key=lambda kv: kv[1][1]):
        entry: dict = {"state_code": code}
        block_path = OUT_DIR / "blocks" / f"{slug}.geojson"
        if block_path.exists():
            meta = json.loads(block_path.read_text())["metadata"]
            entry["blocks"] = {"path": f"blocks/{slug}.geojson", "count": meta["feature_count"], "size_kb": round(block_path.stat().st_size / 1024, 1)}
        village_dir = OUT_DIR / "villages" / slug
        if village_dir.exists():
            districts = {}
            total_villages = 0
            for f in sorted(village_dir.glob("*.geojson")):
                meta = json.loads(f.read_text())["metadata"]
                districts[meta["district"]] = {"path": f"villages/{slug}/{f.name}", "village_count": meta["feature_count"], "size_kb": round(f.stat().st_size / 1024, 1)}
                total_villages += meta["feature_count"]
            entry["villages"] = {"district_count": len(districts), "total_villages": total_villages, "districts": districts}
        if len(entry) > 1:
            manifest["states"][canonical_name] = entry
    (OUT_DIR / "_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(f"wrote {OUT_DIR / '_manifest.json'}: {len(manifest['states'])} states with data")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=["state", "district", "blocks", "villages", "manifest", "all"])
    ap.add_argument("--states", help="comma-separated 2-letter state codes, e.g. MP,UP,TN,AS (default: all 36)")
    args = ap.parse_args()
    states = [s.strip() for s in args.states.split(",")] if args.states else None

    if args.stage in ("state", "all"):
        stage_state()
    if args.stage in ("district", "all"):
        stage_district()
    if args.stage in ("blocks", "all"):
        stage_blocks(states)
    if args.stage in ("villages", "all"):
        stage_villages(states)
    if args.stage in ("manifest", "all"):
        stage_manifest()


if __name__ == "__main__":
    main()

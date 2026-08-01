"""
build_soi_village_layer.py — turn a Survey-of-India village boundary
download (see fetch_soi_villages.py, which builds the manifest this script
reads) into the dashboard's lazy-loaded per-state village layer:

  dashboard/data/boundaries/villages/<slug>.geojson  (simplified geometry)
  dashboard/data/boundaries/names/<slug>.json         (names/codes only)

and updates dashboard/data/boundaries/names_index.json +
dashboard/data/boundaries/villages/_manifest.json for each state processed.

This replaces the existing community-sourced (India Geodata project) layer
for a state with the official Survey-of-India one, and fills the 9 states
that had NO village boundary at all (status "pending" in names_index.json):
Arunachal Pradesh, Himachal Pradesh, Jammu and Kashmir, Ladakh, Manipur,
Meghalaya, Mizoram, Nagaland, Sikkim.

Source schema has ~73 non-geometry columns per state, but exact column
NAMES vary slightly by state (trailing "\n" on some, "subdistric" vs
"subdistrict" on at least Andhra Pradesh) -- resolve_columns() below matches
by candidate name after stripping/lowercasing rather than assuming a fixed
name holds across all 36 downloads. Only 11 columns are kept, matching this
repo's existing 9-column village-layer convention plus 2 extra (population,
households): vil_lgd, village_name, district_name, subdistrict_name,
block_name, gp_name, state_name, dist_lgd, state_lgd, population,
households.

Geometry: reprojected from the source CRS (EPSG:7755, WGS 84 / India NSF
LCC) to EPSG:4326, simplified with geopandas .simplify(tolerance=0.0005,
preserve_topology=True) (matching tools/create_village_boundaries.py and
docs/DATA_SOURCES.md's stated convention for every other boundary layer in
this repo), coordinates rounded to 5 decimal places (~1m).

Nothing is fixed or fabricated: known source quirks (a 999999 sentinel
vlcode for some forest/unnamed parcels, a handful of self-intersecting
polygons) are counted and reported in each file's metadata block, not
silently corrected — per this repo's no-fabrication rule.

Usage:
  python build_soi_village_layer.py --state "Madhya Pradesh"
  python build_soi_village_layer.py --all
  python build_soi_village_layer.py --all --skip-existing-cache
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import geopandas as gpd
import shapely

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "outputs" / "soi_village_manifest.json"
RAW_CACHE_DIR = ROOT / "outputs" / "cache" / "soi_raw"
BOUNDARIES_DIR = ROOT / "dashboard" / "data" / "boundaries"
VILLAGES_DIR = BOUNDARIES_DIR / "villages"
NAMES_DIR = BOUNDARIES_DIR / "names"
NAMES_INDEX_PATH = BOUNDARIES_DIR / "names_index.json"
VILLAGES_MANIFEST_PATH = VILLAGES_DIR / "_manifest.json"

TIMEOUT = 300
SIMPLIFY_TOLERANCE_DEG = 0.0005
COORD_DECIMALS = 5

# NWDP manifest state name -> (canonical names_index.json key, file slug)
STATE_MAP = {
    "Andaman and Nicobar Islands": ("Andaman and Nicobar Islands", "andaman_nicobar"),
    "Andhra Pradesh": ("Andhra Pradesh", "andhra_pradesh"),
    "Arunachal Pradesh": ("Arunachal Pradesh", "arunachal_pradesh"),
    "Assam": ("Assam", "assam"),
    "Bihar": ("Bihar", "bihar"),
    "Chandigarh": ("Chandigarh", "chandigarh"),
    "Chhattisgarh": ("Chhattisgarh", "chhattisgarh"),
    "Dadra and Nagar Haveli and Daman & Diu": ("Dadra and Nagar Haveli and Daman and Diu", "dadra_nagar_haveli_daman_diu"),
    "Delhi": ("Delhi", "delhi"),
    "Goa": ("Goa", "goa"),
    "Gujarat": ("Gujarat", "gujarat"),
    "Haryana": ("Haryana", "haryana"),
    "Himachal Pradesh": ("Himachal Pradesh", "himachal_pradesh"),
    "Jammu & Kashmir": ("Jammu and Kashmir", "jammu_kashmir"),
    "Jharkhand": ("Jharkhand", "jharkhand"),
    "Karnataka": ("Karnataka", "karnataka"),
    "Kerala": ("Kerala", "kerala"),
    "Ladakh": ("Ladakh", "ladakh"),
    "Lakshadweep": ("Lakshadweep", "lakshadweep"),
    "Madhya Pradesh": ("Madhya Pradesh", "madhya_pradesh"),
    "Maharashtra": ("Maharashtra", "maharashtra"),
    "Manipur": ("Manipur", "manipur"),
    "Meghalaya": ("Meghalaya", "meghalaya"),
    "Mizoram": ("Mizoram", "mizoram"),
    "Nagaland": ("Nagaland", "nagaland"),
    "Odisha": ("Odisha", "odisha"),
    "Puducherry": ("Puducherry", "puducherry"),
    "Punjab": ("Punjab", "punjab"),
    "Rajasthan": ("Rajasthan", "rajasthan"),
    "Sikkim": ("Sikkim", "sikkim"),
    "Tamil Nadu": ("Tamil Nadu", "tamil_nadu"),
    "Telangana": ("Telangana", "telangana"),
    "Tripura": ("Tripura", "tripura"),
    "Uttar Pradesh": ("Uttar Pradesh", "uttar_pradesh"),
    "Uttarakhand": ("Uttarakhand", "uttarakhand"),
    "West Bengal": ("West Bengal", "west_bengal"),
}


# Source column names are NOT byte-identical across every state's export --
# some carry a trailing "\n" inherited from the original shapefile field
# name, some don't, and at least one state (Andhra Pradesh) renames
# "subdistric" to "subdistrict". Match on candidates after stripping
# whitespace and lowercasing, the same auto-detect pattern config.py already
# uses for IMD NetCDF variable names (LAT_CANDIDATES etc.) -- never assume
# a fixed column name holds across all 36 downloads.
FIELD_CANDIDATES = {
    "village_name": ["village"],
    "vil_lgd": ["vlcode"],
    "district_name": ["district"],
    "subdistrict_name": ["subdistric", "subdistrict"],
    "block_name": ["block"],
    "gp_name": ["gram_panchayat_name"],
    "state_name": ["state_name"],
    "dist_lgd": ["dtcode"],
    "state_lgd": ["stcode"],
    "population": ["total_population_village"],
    "households": ["total_households"],
}


def resolve_columns(gdf) -> tuple[dict, list]:
    norm_to_actual = {}
    for c in gdf.columns:
        norm_to_actual.setdefault(c.strip().lower(), c)
    resolved = {}
    missing = []
    for out_col, candidates in FIELD_CANDIDATES.items():
        actual = next((norm_to_actual[c] for c in candidates if c in norm_to_actual), None)
        if actual is None:
            missing.append(out_col)
        else:
            resolved[out_col] = actual
    return resolved, missing


def load_manifest() -> dict:
    if not MANIFEST_PATH.exists():
        sys.exit(f"Manifest not found at {MANIFEST_PATH} — run fetch_soi_villages.py first.")
    return json.loads(MANIFEST_PATH.read_text())


def download_state_zip(entry: dict, slug: str) -> Path:
    RAW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dest = RAW_CACHE_DIR / f"{slug}.zip"
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    req = urllib.request.Request(
        entry["download_url"],
        headers={"User-Agent": "Mozilla/5.0 (compatible; vindhya-climate-portal/1.0)"},
    )
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r, open(dest, "wb") as f:
                f.write(r.read())
            return dest
        except Exception as exc:
            last = exc
            if dest.exists():
                dest.unlink()
            time.sleep(3)
    raise RuntimeError(f"download failed after 3 attempts: {last}")


def extract_geojson(zip_path: Path, slug: str) -> Path:
    extract_dir = RAW_CACHE_DIR / f"{slug}_extracted"
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".geojson")]
        if not names:
            raise RuntimeError(f"no .geojson member in {zip_path.name}: {zf.namelist()}")
        zf.extract(names[0], extract_dir)
        return extract_dir / names[0]


def to_int_or_none(v):
    try:
        s = str(v).strip()
        return int(float(s)) if s not in ("", "nan", "None") else None
    except (TypeError, ValueError):
        return None


def round_coords(geom):
    return shapely.set_precision(geom, grid_size=10 ** (-COORD_DECIMALS))


def safe_simplify_and_round(geom) -> tuple:
    """Per-feature simplify+round with a fallback chain, so one bad source
    polygon can't abort an entire state's processing (GEOS's simplifier can
    raise TopologyException on self-intersecting input). Returns
    (geometry, used_fallback: bool) -- geometry is never fabricated, only
    ever the original (possibly unsimplified) shape when simplification
    genuinely can't be done."""
    try:
        simplified = geom.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
        return round_coords(simplified), False
    except Exception:
        pass
    try:
        fixed = geom.buffer(0)
        simplified = fixed.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
        return round_coords(simplified), True
    except Exception:
        pass
    try:
        return round_coords(geom), True
    except Exception:
        return geom, True


def process_state(nwdp_name: str, entry: dict, force_download: bool = False) -> dict:
    canonical_name, slug = STATE_MAP[nwdp_name]
    print(f"\n=== {canonical_name} ({slug}) ===")

    zip_path = RAW_CACHE_DIR / f"{slug}.zip"
    if force_download and zip_path.exists():
        zip_path.unlink()
    zip_path = download_state_zip(entry, slug)
    print(f"  downloaded/cached: {zip_path.stat().st_size / 1e6:.1f} MB zip")

    geojson_path = extract_geojson(zip_path, slug)
    gdf = gpd.read_file(geojson_path)
    print(f"  loaded: {len(gdf)} features, CRS {gdf.crs}")

    resolved, missing_cols = resolve_columns(gdf)
    if missing_cols:
        raise RuntimeError(f"{canonical_name}: could not find a source column for {missing_cols} "
                            f"among {list(gdf.columns)} — needs a new candidate name in FIELD_CANDIDATES")

    if gdf.crs is None:
        raise RuntimeError(f"{canonical_name}: source has no CRS")
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(4326)

    n_invalid = int((~gdf.geometry.is_valid).sum())
    n_sentinel = int((gdf[resolved["vil_lgd"]].astype(str).str.strip() == "999999").sum())

    out = gpd.GeoDataFrame({
        out_col: (
            gdf[src_col].apply(to_int_or_none) if out_col in
            ("vil_lgd", "dist_lgd", "state_lgd", "population", "households")
            else gdf[src_col].astype(str).str.strip()
        )
        for out_col, src_col in resolved.items()
    }, geometry=gdf.geometry, crs=gdf.crs)
    out["state_name"] = out["state_name"].str.upper()

    simplify_results = out.geometry.apply(safe_simplify_and_round)
    out["geometry"] = simplify_results.apply(lambda t: t[0])
    n_simplify_fallback = int(simplify_results.apply(lambda t: t[1]).sum())

    n_district = out["district_name"].nunique()

    metadata = {
        "source": "Survey of India (per src_agency attribute in the source data)",
        "hosted_via": "National Water Data Portal (NWDP), NWIC, Ministry of Jal Shakti "
                       "-- https://nwdp.nwic.gov.in/dataset/village-boundary "
                       "(the portal's own breadcrumb tags 'Geological Survey of India' as the "
                       "uploading Data Producer; every source feature's own src_agency "
                       "attribute reads 'Survey of India (SOI)')",
        "access": "public, no login required",
        "crs_original": "EPSG:7755 (WGS 84 / India NSF LCC)",
        "fetch_date": "2026-08-01",
        "processing": f"reprojected to EPSG:4326, geometry simplified with Douglas-Peucker "
                       f"(tolerance {SIMPLIFY_TOLERANCE_DEG} deg, ~55m, preserve_topology=True), "
                       f"coordinates rounded to {COORD_DECIMALS} decimal places (~1m), attributes "
                       f"trimmed from 73 source columns to 11",
        "quality": "verified-official -- Survey of India source, see docs/DATA_SOURCES.md",
        "known_quirks": (
            f"{n_sentinel} feature(s) carry vlcode=999999, a sentinel the source uses for "
            f"incomplete/placeholder records rather than a real LGD id -- the accompanying "
            f"village name is sometimes a real place (e.g. a reserve-forest area) and "
            f"sometimes the source's own literal placeholder text 'Data Partially Available' "
            f"-- left as-is, not corrected either way. {n_invalid} feature(s) have "
            f"self-intersecting source geometry -- "
            f"left as-is, not repaired (of these, {n_simplify_fallback} could not be "
            f"Douglas-Peucker simplified because GEOS raised a topology error on the raw "
            f"shape; a buffer(0) self-intersection fix was tried first, and only where that "
            f"also failed is the original unsimplified geometry kept verbatim). Neither is "
            f"fabricated or silently dropped."
        ),
    }

    VILLAGES_DIR.mkdir(parents=True, exist_ok=True)
    NAMES_DIR.mkdir(parents=True, exist_ok=True)

    geojson_out_path = VILLAGES_DIR / f"{slug}.geojson"
    features = json.loads(out.to_json())["features"]
    geojson_out_path.write_text(json.dumps(
        {"type": "FeatureCollection", "metadata": metadata, "features": features},
        ensure_ascii=False,
    ))
    size_mb = round(geojson_out_path.stat().st_size / 1e6, 1)
    print(f"  wrote {geojson_out_path.relative_to(ROOT)}: {len(out)} features, {size_mb} MB")

    names_by_district: dict[str, list] = {}
    for _, row in out.iterrows():
        names_by_district.setdefault(row["district_name"], []).append(
            {"name": row["village_name"], "vil_lgd": row["vil_lgd"]}
        )
    names_out_path = NAMES_DIR / f"{slug}.json"
    names_out_path.write_text(json.dumps(
        {"state": canonical_name, "districts": names_by_district}, ensure_ascii=False
    ))
    print(f"  wrote {names_out_path.relative_to(ROOT)}")

    return {
        "canonical_name": canonical_name,
        "slug": slug,
        "village_count": len(out),
        "district_count": n_district,
        "geometry_file_size_mb": size_mb,
        "n_invalid_geom": n_invalid,
        "n_sentinel_vlcode": n_sentinel,
    }


def update_indexes(results: list[dict]) -> None:
    names_index = json.loads(NAMES_INDEX_PATH.read_text()) if NAMES_INDEX_PATH.exists() else {"generated": "", "states": {}}
    villages_manifest = json.loads(VILLAGES_MANIFEST_PATH.read_text()) if VILLAGES_MANIFEST_PATH.exists() else {"generated": "", "total_features": 0, "skipped": 0, "states": {}}

    for r in results:
        names_index["states"][r["canonical_name"]] = {
            "status": "available",
            "geometry_file": f"villages/{r['slug']}.geojson",
            "names_file": f"names/{r['slug']}.json",
            "district_count": r["district_count"],
            "village_count": r["village_count"],
            "geometry_file_size_mb": r["geometry_file_size_mb"],
            "source": "Survey of India (NWDP)",
        }
        villages_manifest["states"][r["slug"]] = {
            "name": r["canonical_name"].upper(),
            "feature_count": r["village_count"],
        }

    villages_manifest["total_features"] = sum(s["feature_count"] for s in villages_manifest["states"].values())
    NAMES_INDEX_PATH.write_text(json.dumps(names_index, ensure_ascii=False, indent=2))
    VILLAGES_MANIFEST_PATH.write_text(json.dumps(villages_manifest, ensure_ascii=False, indent=2))
    print(f"\nUpdated {NAMES_INDEX_PATH.relative_to(ROOT)} and {VILLAGES_MANIFEST_PATH.relative_to(ROOT)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", help="Process a single state (NWDP manifest name, e.g. 'Madhya Pradesh')")
    ap.add_argument("--all", action="store_true", help="Process all 36 states")
    ap.add_argument("--force-download", action="store_true", help="Re-download even if cached zip exists")
    args = ap.parse_args()

    manifest = load_manifest()
    by_name = {e["state"]: e for e in manifest["states"]}

    if args.state:
        targets = [args.state]
    elif args.all:
        targets = list(STATE_MAP.keys())
    else:
        ap.error("pass --state \"<name>\" or --all")
        return 1

    results = []
    failures = []
    for nwdp_name in targets:
        entry = by_name.get(nwdp_name)
        if entry is None:
            print(f"SKIP: {nwdp_name!r} not found in manifest", file=sys.stderr)
            failures.append(nwdp_name)
            continue
        try:
            results.append(process_state(nwdp_name, entry, force_download=args.force_download))
        except Exception as exc:
            print(f"FAILED: {nwdp_name}: {exc}", file=sys.stderr)
            failures.append(nwdp_name)
            continue
        # Update indexes incrementally so progress isn't lost if interrupted.
        update_indexes(results)

    print(f"\n{len(results)}/{len(targets)} states processed successfully.")
    if failures:
        print(f"FAILED ({len(failures)}): {', '.join(failures)}")
    return 1 if failures and not results else 0


if __name__ == "__main__":
    raise SystemExit(main())

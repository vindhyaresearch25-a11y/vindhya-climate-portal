"""
backfill_data_metadata.py -- bring every served JSON under dashboard/data/
up to the five-key metadata contract stated in CLAUDE.md and
docs/DATA_SOURCES.md: source, resolution, CRS, processing, last_updated.

WHY THIS EXISTS (2026-09-02 methodology audit)
----------------------------------------------
The CI metadata check in .github/workflows/verify-data.yml was
`glob.glob('dashboard/data/*.json')` -- non-recursive. It inspected 10 files
out of ~5,200 served ones and only tested that the `metadata` KEY existed,
so `"metadata": {}` passed. 99.8% of the published data was never checked.
The glob is now recursive and asserts the five required keys, which means
the data actually has to satisfy the contract.

WHAT THIS SCRIPT DOES NOT DO
----------------------------
It does not invent provenance. Almost every file already carried real,
detailed provenance -- it was simply recorded under a different key name by
whichever pipeline wrote it (`crs` vs `CRS`, `method` or `generator` vs
`processing`). So the primary action here is a RENAME/ALIAS of information
that is already present and already true.

Where a key is genuinely absent, only two kinds of value are filled in, both
verifiable rather than assumed:

  * CRS = "EPSG:4326". True by construction for every geospatial layer here:
    Google Earth Engine reduceRegion/reduceRegions output carries the
    geometry's CRS, every geometry in this project comes from the Survey of
    India boundary files, and those were reprojected to EPSG:4326 on ingest
    (docs/DATA_SOURCES.md, boundaries rows). Not applied to tabular layers
    that have no geometry at all -- those are exempted in CI instead, since
    a coordinate reference system is not a property of a table of crop areas.

  * processing = the actual pipeline script that produced the file. Taken
    from the per-directory map below, which mirrors what each script's own
    header and docs/DATA_SOURCES.md already state. Verified against the
    output path each script writes to before being listed here.

Anything this script cannot fill from a real, known value is left alone and
reported, so it surfaces as a CI failure rather than being papered over.

Usage:
  python scripts/backfill_data_metadata.py --check     # report only
  python scripts/backfill_data_metadata.py --write     # apply
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "dashboard" / "data"

REQUIRED = ("source", "resolution", "CRS", "processing", "last_updated")

# Keys already used by the various pipelines that carry the same information
# under a different name. Checked file-by-file before being listed.
ALIASES = {
    "CRS": ("crs", "CRS", "coordinate_reference_system"),
    "processing": ("processing", "method", "generator", "pipeline", "script"),
    "source": ("source", "dataset_source"),
    "resolution": ("resolution", "spatial_resolution"),
    "last_updated": ("last_updated", "generated", "updated", "last_update",
                     "fetch_date", "generated_utc"),
}

# Real per-layer strings for the files that carry no equivalent key at all.
# Each is a statement about what the file demonstrably is, checked against
# the script that writes it -- not a placeholder.
MANIFEST_RESOLUTION = ("Index/manifest file: it lists which units have a real "
                       "output file and carries no measured value of its own, so "
                       "it has no spatial resolution independent of the layer it "
                       "indexes.")


# Which pipeline script actually writes each directory. Verified against each
# script's own output path, not guessed.
PROCESSING_BY_DIR = {
    "climate":                    "scripts/08_gee_national_climate.py",
    "ndvi":                       "scripts/10_gee_national_ndvi.py",
    "soil_moisture":              "scripts/13_gee_national_soil_moisture.py",
    "groundwater":                "scripts/16_fetch_groundwater.py",
    "advisory":                   "scripts/15_build_advisory.py",
    "cmip6_2040":                 "scripts/09_gee_national_cmip6_2040.py",
    "validation":                 "scripts/11_build_validation.py",
    "crop_stats_des":             "scripts/fetch_des_apy.py",
    "crop_stats_des_by_district": "scripts/build_crop_stats_des_district_files.py",
    "crop_yield":                 "scripts/fetch_crop_stats.py",
    "horticulture_stats":         "scripts/fetch_horticulture_stats.py",
    "state_reports":              "scripts/extract_state_reports.py",
    "knowledge_base":             "scripts/fetch_knowledge_base.py + manual curation",
    "crop_insurance_pilot":       "dashboard/crop_insurance_pilot/generate_synthetic_pilot.py",
}

# Layers whose values are genuinely georeferenced, so EPSG:4326 is a real
# statement about them rather than boilerplate. Tabular layers are absent
# from this set on purpose and are exempted in CI instead.
GEOSPATIAL_DIRS = {
    "climate", "ndvi", "soil_moisture", "groundwater", "cmip6_2040",
    "validation", "boundaries", "crop_insurance_pilot",
}

# Top-level manifest/aggregate files that need a real block written once.
# Every string below states what the file actually is; none is a guess.
TOP_LEVEL = {
    "forecast_2040.json": {
        "source": "Derived from this repo's own observed IMD 2000-2024 annual indices "
                  "(dashboard/data/mp_climate_data.json). INDICATIVE deterministic OLS "
                  "trend with a 95% band from historical residuals -- explicitly NOT a "
                  "climate-model projection. The physical-model projection is the CMIP6 "
                  "layer in dashboard/data/cmip6_2040/.",
        "resolution": "District (the 5 IMD districts), annual time step.",
        "CRS": "EPSG:4326",
        "processing": "scripts/07_build_dicra_forecast.py",
    },
    "crop_list.json": {
        "processing": "scripts/build_crop_list.py",
    },
    "dicra_ndvi.json": {
        "processing": "scripts/07_build_dicra_forecast.py",
        "CRS": "EPSG:4326",
    },
    "crop_stats_comparison.json": {
        "source": "Derived cross-check between two already-published real sources in "
                  "this repo: dashboard/data/crop_stats_des/ (DES, data.desagri.gov.in) "
                  "and dashboard/data/crop_stats.json (data.gov.in). No third source is "
                  "introduced; this file only reports where the two agree and differ.",
        "processing": "scripts/build_crop_comparison.py",
    },
    "sources_manifest.json": {
        "source": "Machine-readable mirror of docs/DATA_SOURCES.md, this project's "
                  "provenance register. Derived from that document, kept in sync by hand.",
        "processing": "manual, mirrors docs/DATA_SOURCES.md",
    },
    "districts_index.json": {
        "resolution": "Attribute table only (state_name / district_name / district_lgd); "
                      "the geometry it indexes lives in boundaries/soi/districts.geojson.",
        "processing": "scripts/build_districts_index.py",
    },
    "index.json": {
        "source": "Curated register of publicly-published agricultural reference "
                  "documents (ICAR / state agricultural university / KVK / IMD agromet). "
                  "Each entry records its own title, publisher, year and link; see "
                  "dashboard/data/knowledge_base/README.md for the copyright rule.",
    },
    "mp_climate_data.json": {
        "source": "IMD 0.05 deg gridded daily Tmax/Tmin/Precipitation NetCDF, 2000-2024 "
                  "(India Meteorological Department).",
        "resolution": "~5.5 km (0.05 deg) IMD grid, sampled per village centroid and "
                      "rolled up to district; see docs/METHODOLOGY.md Sec 3 and 3.1.",
        "processing": "scripts/01_extract_village_timeseries.py -> 02_compute_indices.py "
                      "-> 03_build_chart_data.py -> 04_build_dashboard_json.py",
    },
    "mandi_prices.json": {
        "resolution": "Market (APMC mandi) point records, reported per district/state; "
                      "no gridded resolution applies.",
    },
    "climate_manifest.json": {
        "source": "Index of this repo's own dashboard/data/climate/ outputs "
                  "(ERA5-Land + CHIRPS via Google Earth Engine). Derived index, "
                  "not an independent observation.",
        "processing": "scripts/build_climate_manifest.py",
        "CRS": "EPSG:4326",
        "resolution": MANIFEST_RESOLUTION,
    },
    "ndvi_manifest.json": {
        "source": "Index of this repo's own dashboard/data/ndvi/ outputs "
                  "(MODIS MOD13Q1 v061 via Google Earth Engine). Derived index, "
                  "not an independent observation.",
        "processing": "scripts/build_ndvi_manifest.py",
        "CRS": "EPSG:4326",
        "resolution": MANIFEST_RESOLUTION,
    },
}


def git_last_modified(path: Path) -> str | None:
    """Date of the last commit touching `path`, as YYYY-MM-DD, or None."""
    import subprocess
    try:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "log", "-1", "--format=%cs", "--", str(path)],
            capture_output=True, text=True, timeout=30)
        v = out.stdout.strip()
        return v or None
    except Exception:
        return None


def first_alias(meta: dict, canonical: str):
    for k in ALIASES.get(canonical, (canonical,)):
        if k in meta and meta[k] not in (None, "", {}, []):
            return meta[k]
    return None


def top_dir(path: Path) -> str:
    rel = path.relative_to(DATA)
    return rel.parts[0] if len(rel.parts) > 1 else ""


def fix_file(path: Path, write: bool) -> tuple[list[str], list[str]]:
    """Return (filled, still_missing) canonical key names."""
    try:
        doc = json.loads(path.read_text())
    except Exception as e:
        return [], ["UNREADABLE: %s" % e]
    if not isinstance(doc, dict):
        return [], ["top-level JSON array, cannot carry metadata"]

    meta = doc.get("metadata")
    if not isinstance(meta, dict):
        meta = {}

    d = top_dir(path)
    filled, missing = [], []

    for key in REQUIRED:
        if key in meta and meta[key] not in (None, "", {}, []):
            continue
        val = first_alias(meta, key)
        if val is None:
            if key == "CRS" and d in GEOSPATIAL_DIRS:
                val = "EPSG:4326"
            elif key == "processing" and d in PROCESSING_BY_DIR:
                val = PROCESSING_BY_DIR[d]
            elif path.name in TOP_LEVEL and key in TOP_LEVEL[path.name]:
                val = TOP_LEVEL[path.name][key]
        if val is None and path.name == "manifest.json":
            if key == "resolution":
                val = MANIFEST_RESOLUTION
            elif key == "source" and d in PROCESSING_BY_DIR:
                val = ("Index of this repo's own dashboard/data/%s/ outputs. Derived "
                       "index, not an independent observation -- see those files' own "
                       "metadata for the underlying source." % d)
        if val is None and key == "last_updated":
            # Fall back to the date of the last git commit that touched this
            # file. That is a real, checkable fact about when the file was
            # last updated -- unlike today's date, which would assert a
            # freshness the file does not have.
            val = git_last_modified(path)
        if val is None:
            missing.append(key)
        else:
            meta[key] = val
            filled.append(key)

    if filled and write:
        doc["metadata"] = meta
        path.write_text(json.dumps(doc, indent=1) if len(json.dumps(doc)) < 20000
                        else json.dumps(doc))
    return filled, missing


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="apply changes (default: report only)")
    args = ap.parse_args()

    files = sorted(DATA.rglob("*.json"))
    n_fixed = 0
    still = {}
    for f in files:
        filled, missing = fix_file(f, args.write)
        if filled:
            n_fixed += 1
        if missing:
            still.setdefault(",".join(missing), []).append(str(f.relative_to(ROOT)))

    print("scanned %d files under dashboard/data/" % len(files))
    print("%s %d files" % ("rewrote" if args.write else "would rewrite", n_fixed))
    if still:
        print("\nSTILL MISSING (left alone deliberately -- fill these from a real "
              "source, do not invent them):")
        for k, v in sorted(still.items(), key=lambda x: -len(x[1])):
            print("  %5d files missing %s" % (len(v), k))
            for p in v[:5]:
                print("        %s" % p)
        return 1
    print("\nall files satisfy the five-key metadata contract")
    return 0


if __name__ == "__main__":
    sys.exit(main())

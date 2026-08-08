"""
build_ndvi_manifest.py -- counts real NDVI district files and writes
dashboard/data/ndvi_manifest.json, mirroring scripts/build_climate_manifest.py
for the new dashboard/data/ndvi/<state_slug>/<district_slug>.json layer
written by scripts/10_gee_national_ndvi.py (Phase 8.4).

Two genuinely different real NDVI sources, counted separately, never merged:
  - UNDP DiCRA (MODIS-derived district zonal stats), MP's 52 districts,
    dashboard/data/dicra_ndvi.json.
  - MODIS MOD13Q1 v061 via Google Earth Engine, every other district
    scripts/10_gee_national_ndvi.py has computed so far,
    dashboard/data/ndvi/<state_slug>/<district_slug>.json.

Re-run this after every batch of new GEE NDVI output and commit the
refreshed manifest -- GitHub Pages cannot list a directory client-side, so
this file is the only way the browser learns the count
(dashboard/national_ndvi_loader.js reads it the same way
national_climate_loader.js reads climate_manifest.json).

Usage:
  python scripts/build_ndvi_manifest.py
"""
import json
import os
from datetime import datetime, timezone, timedelta

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NDVI_DIR = os.path.join(REPO_ROOT, "dashboard", "data", "ndvi")
DICRA_NDVI_FILE = os.path.join(REPO_ROOT, "dashboard", "data", "dicra_ndvi.json")
OUT_FILE = os.path.join(REPO_ROOT, "dashboard", "data", "ndvi_manifest.json")
IST = timezone(timedelta(hours=5, minutes=30))


def count_dicra_districts():
    if not os.path.exists(DICRA_NDVI_FILE):
        return []
    with open(DICRA_NDVI_FILE) as f:
        d = json.load(f)
    return sorted(d.get("districts", {}).keys())


def count_gee_ndvi_districts():
    out = []
    if not os.path.isdir(NDVI_DIR):
        return out
    for state_slug in sorted(os.listdir(NDVI_DIR)):
        state_dir = os.path.join(NDVI_DIR, state_slug)
        if not os.path.isdir(state_dir):
            continue
        for fname in sorted(os.listdir(state_dir)):
            if fname.endswith(".json"):
                out.append(state_slug + "/" + fname[:-5])
    return out


def main():
    dicra = count_dicra_districts()
    gee = count_gee_ndvi_districts()
    total_districts = 733

    manifest = {
        "metadata": {
            "note": "Machine-readable count of districts with real NDVI. Read by "
                    "dashboard/national_ndvi_loader.js -- the numerator grows as "
                    "scripts/10_gee_national_ndvi.py writes more files; never hardcode "
                    "this number in dashboard code.",
            "generated": datetime.now(IST).strftime("%Y-%m-%d %H:%M IST"),
        },
        "dicra": {
            "source": "UNDP DiCRA district NDVI zonal statistics (MODIS-derived)",
            "district_count": len(dicra),
            "districts": dicra,
        },
        "gee_modis": {
            "source": "MODIS MOD13Q1 v061 (Terra Vegetation Indices, 16-day, 250m), via Google Earth Engine",
            "years": "2000-2024",
            "district_count": len(gee),
            "districts": gee,
        },
        "totals": {
            "districts_with_ndvi": len(dicra) + len(gee),
            "districts_nationwide": total_districts,
        },
    }

    with open(OUT_FILE, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"DiCRA districts: {len(dicra)}")
    print(f"GEE (MOD13Q1) districts: {len(gee)}")
    print(f"Total: {len(dicra) + len(gee)} of {total_districts}")
    print(f"Wrote {OUT_FILE}")


if __name__ == "__main__":
    main()

"""
Counts real climate-index district files and writes
dashboard/data/climate_manifest.json -- the landing page's "OBSERVED CLIMATE"
stat reads this file's counts rather than a typed-in number, per the
2026-08-03 owner instruction that the "N of 733" figure must grow on its own
as scripts/08_gee_national_climate.py adds more district files, never be
hardcoded in dashboard JS/HTML.

Two genuinely different real sources are counted separately and never
merged into one undifferentiated "climate data" number:
  - IMD 0.05 deg gridded NetCDF (2000-2024), the 5 original MP districts,
    from dashboard/data/mp_climate_data.json.
  - ERA5-Land + CHIRPS via Google Earth Engine (2000-2024), districts
    written incrementally by scripts/08_gee_national_climate.py into
    dashboard/data/climate/<state_slug>/<district_slug>.json.

Re-run this after every batch of new GEE output (or on a schedule) and
commit the refreshed manifest -- GitHub Pages cannot list a directory
client-side, so this file is the only way the browser learns the count.
"""
import json
import os
from datetime import datetime, timezone, timedelta

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIMATE_DIR = os.path.join(REPO_ROOT, "dashboard", "data", "climate")
MP_CLIMATE_FILE = os.path.join(REPO_ROOT, "dashboard", "data", "mp_climate_data.json")
OUT_FILE = os.path.join(REPO_ROOT, "dashboard", "data", "climate_manifest.json")
IST = timezone(timedelta(hours=5, minutes=30))


def count_imd_districts():
    if not os.path.exists(MP_CLIMATE_FILE):
        return []
    with open(MP_CLIMATE_FILE) as f:
        d = json.load(f)
    return sorted(d.get("districts", {}).keys())


def count_gee_districts():
    out = []
    if not os.path.isdir(CLIMATE_DIR):
        return out
    for state_slug in sorted(os.listdir(CLIMATE_DIR)):
        state_dir = os.path.join(CLIMATE_DIR, state_slug)
        if not os.path.isdir(state_dir):
            continue
        for fname in sorted(os.listdir(state_dir)):
            if fname.endswith(".json"):
                out.append(state_slug + "/" + fname[:-5])
    return out


def main():
    imd = count_imd_districts()
    gee = count_gee_districts()
    total_districts = 733  # from data/boundaries/soi/_manifest.json districts_file.feature_count

    manifest = {
        "metadata": {
            "note": "Machine-readable count of districts with real computed climate indices. "
                    "Read by the landing page's OBSERVED CLIMATE stat -- the numerator grows as "
                    "scripts/08_gee_national_climate.py writes more files; never hardcode this "
                    "number in dashboard code.",
            "generated": datetime.now(IST).strftime("%Y-%m-%d %H:%M IST"),
        },
        "imd": {
            "source": "IMD 0.05 deg gridded daily Tmax/Tmin/Precipitation NetCDF",
            "years": "2000-2024",
            "district_count": len(imd),
            "districts": imd,
        },
        "gee_era5_chirps": {
            "source": "ERA5-Land (ECMWF) + CHIRPS (UCSB), via Google Earth Engine",
            "years": "2000-2024",
            "district_count": len(gee),
            "districts": gee,
        },
        "totals": {
            "districts_with_climate_data": len(imd) + len(gee),
            "districts_nationwide": total_districts,
        },
    }

    with open(OUT_FILE, "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"IMD districts: {len(imd)}")
    print(f"GEE (ERA5-Land+CHIRPS) districts: {len(gee)}")
    print(f"Total: {len(imd) + len(gee)} of {total_districts}")
    print(f"Wrote {OUT_FILE}")


if __name__ == "__main__":
    main()

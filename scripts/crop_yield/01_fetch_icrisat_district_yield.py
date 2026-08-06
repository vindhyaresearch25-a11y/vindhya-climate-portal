"""
01_fetch_icrisat_district_yield.py — the one real, runnable slice of the
crop-yield pipeline (docs/CROP_YIELD_METHODOLOGY.md §5).

Downloads the ICRISAT District-Level Data panel ("Heterogeneous Climate
Effect on Crop Yield and Associated Risks to Water Security in India",
Mohapatra/ICRISAT, Mendeley Data DOI 10.17632/ywp3y5j9vv.1, CC BY 4.0):
560 districts, 20 states, 1990-2015, real per-crop area/production/yield
for rice, pearl millet, chickpea, groundnut and sugarcane, plus real
agro-climatic covariates (temperature, precipitation, evapotranspiration,
windspeed, fertiliser use, irrigated area, agricultural labour).

Why this dataset, now: it is public, free, requires no application or
credential (unlike CCE/Digital Crop Survey/UPAg -- see METHODOLOGY §4), and
its own public API returns a SHA-256 for the file, which this script
verifies before parsing anything -- integrity checked, not assumed.

This is coarser than parcel-level ground truth. It is used here exactly as
METHODOLOGY §4 describes: a district-level regression target and a coarse
sanity bound for future parcel-level classification, explicitly labelled
as such in the output's own metadata -- never presented as parcel-measured
yield.

Requires: pandas, xlrd (the source file is legacy .xls, not .xlsx --
openpyxl alone cannot read it). Both listed in requirements.txt.

Usage:
    python scripts/crop_yield/01_fetch_icrisat_district_yield.py
"""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# Order matters: scripts/ (for national_districts) must be importable, but
# scripts/crop_yield/config.py must win over scripts/config.py -- both are
# named "config", so crop_yield's own directory has to be checked first.
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))
import config as cy_config  # noqa: E402
from national_districts import slugify  # noqa: E402

RAW_CACHE = cy_config.CROP_YIELD_DATA_DIR / "_icrisat_raw.xls"


def _get(url: str):
    # Mendeley's API 403s the default urllib user-agent (bot-blocking, not
    # an auth requirement -- curl with no special headers works fine).
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; VINDHYA-crop-yield-pipeline/1.0)",
        "Accept": "application/json",
    })
    return urllib.request.urlopen(req, timeout=30)


def fetch_file_metadata() -> dict:
    with _get(cy_config.ICRISAT_FILES_API) as r:
        files = json.load(r)
    if not files:
        raise SystemExit("ICRISAT Mendeley API returned no files -- dataset "
                          "may have moved; check the DOI page by hand before "
                          "hardcoding a new URL.")
    return files[0]  # single-file dataset as of this writing


def download_and_verify(meta: dict) -> Path:
    url = meta["content_details"]["download_url"]
    expected_sha256 = meta["content_details"]["sha256_hash"]
    print(f"Downloading {meta['filename']} ({meta['size']:,} bytes)...")
    with _get(url) as r, open(RAW_CACHE, "wb") as f:
        f.write(r.read())
    actual = hashlib.sha256(RAW_CACHE.read_bytes()).hexdigest()
    if actual != expected_sha256:
        RAW_CACHE.unlink(missing_ok=True)
        raise SystemExit(
            f"SHA-256 mismatch on download -- refusing to parse a file that "
            f"doesn't match Mendeley's own checksum (expected {expected_sha256}, "
            f"got {actual}). Re-run; if this repeats, the upstream file changed."
        )
    print(f"SHA-256 verified: {actual}")
    return RAW_CACHE


def parse(raw_path: Path) -> list[dict]:
    import pandas as pd  # deferred import: only needed by this script

    df = pd.read_excel(raw_path, sheet_name="Sheet1")
    rows = []
    for _, r in df.iterrows():
        state = str(r["State Name"]).strip()
        district = str(r["Dist Name"]).strip()
        if not state or not district or state == "nan" or district == "nan":
            continue

        crops = {}
        for crop in cy_config.ICRISAT_CROPS:
            area = r.get(f"{crop} AREA (1000 ha)")
            prod = r.get(f"{crop} PRODUCTION (1000 tons)")
            yld = r.get(f"{crop} YIELD (Kg per ha)")
            if pd.notna(yld):
                crops[crop.title().replace(" ", "_").lower()] = {
                    "area_1000ha": None if pd.isna(area) else float(area),
                    "production_1000t": None if pd.isna(prod) else float(prod),
                    "yield_kg_per_ha": float(yld),
                }

        climate = {}
        for season in cy_config.ICRISAT_SEASONS:
            season_key = season.split()[0].lower()  # winter/summer/rainy/autumn
            season_vals = {}
            for src_suffix, out_key in cy_config.ICRISAT_CLIMATE_VARS:
                col = f"{season} {src_suffix}"
                v = r.get(col)
                if pd.notna(v):
                    season_vals[out_key] = float(v)
            if season_vals:
                climate[season_key] = season_vals

        rows.append({
            "state": state,
            "state_slug": slugify(state),
            "district": district,
            "district_slug": slugify(district),
            "year": int(r["Year"]),
            "gross_cropped_area_1000ha": (
                None if pd.isna(r.get("GROSS CROPPED AREA (1000 ha)"))
                else float(r["GROSS CROPPED AREA (1000 ha)"])
            ),
            "gross_irrigated_area_1000ha": (
                None if pd.isna(r.get("GROSS IRRIGATED AREA (1000 ha)"))
                else float(r["GROSS IRRIGATED AREA (1000 ha)"])
            ),
            "total_fertiliser_consumption_tons": (
                None if pd.isna(r.get("TOTAL FERTILISER CONSUMPTION (tons)"))
                else float(r["TOTAL FERTILISER CONSUMPTION (tons)"])
            ),
            "agricultural_labour_population_1000": (
                None if pd.isna(r.get("TOTAL AGRICULTURAL LABOUR POPULATION (1000 Number)"))
                else float(r["TOTAL AGRICULTURAL LABOUR POPULATION (1000 Number)"])
            ),
            "crops": crops,
            "climate_seasonal": climate,
        })
    return rows


def main() -> int:
    meta = fetch_file_metadata()
    raw_path = download_and_verify(meta)
    rows = parse(raw_path)

    states = sorted({r["state"] for r in rows})
    years = sorted({r["year"] for r in rows})
    district_count = len({(r["state_slug"], r["district_slug"]) for r in rows})
    by_state_district = {}
    for r in rows:
        by_state_district.setdefault(r["state_slug"], {}).setdefault(
            r["district_slug"], []
        ).append(r)

    out = {
        "metadata": {
            "source": "ICRISAT District-Level Data: Heterogeneous Climate Effect "
                       "on Crop Yield and Associated Risks to Water Security in India",
            "source_url": "https://data.mendeley.com/datasets/ywp3y5j9vv/1",
            "doi": cy_config.ICRISAT_DATASET_DOI,
            "publisher": "Mendeley Data (Mohapatra, S. / ICRISAT)",
            "license": "CC BY 4.0",
            "sha256_verified": True,
            "quality": "verified-official -- real published panel dataset, "
                       "district-level (not parcel-level). Used per "
                       "docs/CROP_YIELD_METHODOLOGY.md §4 as a district-level "
                       "regression target and sanity bound, NOT as parcel-level "
                       "crop-type ground truth -- that remains blocked, see "
                       "METHODOLOGY.md §7.",
            "trimmed_columns_note": "Source has 107 columns per row (48 raw "
                       "monthly climate columns among them); this file keeps "
                       "crop area/production/yield, irrigated/cropped area, "
                       "fertiliser, labour, and 4 SEASONAL climate aggregates "
                       "(not the 48 monthly raw values) to keep file size "
                       "reasonable. Re-run against _icrisat_raw.xls (kept "
                       "alongside this file) if the monthly columns are needed.",
            "coverage": f"{len(states)} states, {district_count} districts, "
                        f"years {years[0]}-{years[-1]}",
            "crops_covered": cy_config.ICRISAT_CROPS,
            "row_count": len(rows),
            "fetch_date": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "states": states,
        "by_state_district": by_state_district,
    }

    cy_config.ICRISAT_OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"\nWrote {cy_config.ICRISAT_OUT.relative_to(cy_config.ROOT)}: "
          f"{len(rows)} district-year rows, {len(states)} states, "
          f"{years[0]}-{years[-1]}")
    print(f"Raw source cached at {RAW_CACHE.relative_to(cy_config.ROOT)} "
          f"(sha256-verified, kept for re-parsing without re-downloading).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

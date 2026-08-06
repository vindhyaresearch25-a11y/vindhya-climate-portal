"""
config.py — crop classification & yield estimation pipeline.

Same pattern as scripts/config.py (the climate pipeline's config), kept
deliberately separate rather than merged into it: this pipeline has its own
credential surface (a GEE service account distinct from the earthengine-api
user auth some contributors may already have set up for the climate
pipeline's 05_gee_cmip6_2040.js export step) and its own output tree.

See docs/CROP_YIELD_METHODOLOGY.md for what each stage below is for and
which ones are currently blocked (§7 of that document) versus real and
runnable today.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DASHBOARD_DATA_DIR = ROOT / "dashboard" / "data"
CROP_YIELD_DATA_DIR = DASHBOARD_DATA_DIR / "crop_yield"
CROP_YIELD_DATA_DIR.mkdir(parents=True, exist_ok=True)

# ---------- GEE credentials (blocked -- not set on this machine as of
# 2026-08-06, see docs/CROP_YIELD_METHODOLOGY.md §7). Every script that
# needs GEE must check this and exit with a clear message, never silently
# proceed with no auth or fall back to fabricated output. ----------
GEE_SERVICE_ACCOUNT_JSON = os.environ.get("GEE_SERVICE_ACCOUNT_JSON")  # path to key file
GEE_PROJECT_ID = os.environ.get("GEE_PROJECT_ID")


def require_gee():
    """Call at the top of any script that needs Earth Engine. Fails loudly
    and immediately with exactly what's missing, rather than letting an
    ee.Initialize() call fail deep inside a script with a less legible
    stack trace, or -- the failure mode this project explicitly forbids --
    silently falling through to made-up output."""
    missing = [name for name, val in (
        ("GEE_SERVICE_ACCOUNT_JSON", GEE_SERVICE_ACCOUNT_JSON),
        ("GEE_PROJECT_ID", GEE_PROJECT_ID),
    ) if not val]
    if missing:
        raise SystemExit(
            "GEE is not configured on this machine (missing: "
            + ", ".join(missing) + "). See docs/CROP_YIELD_METHODOLOGY.md "
            "§7 -- this blocks Sentinel-1/2, Landsat, MODIS extras, SMAP, "
            "DEM and SoilGrids ingestion. Set the env var(s) and re-run; "
            "this script will not proceed with no credential and will "
            "never substitute fabricated imagery."
        )


# ---------- Ground truth (district-level proxy; real parcel-level CCE/
# Digital Crop Survey/UPAg data is not held by this project -- see
# docs/CROP_YIELD_METHODOLOGY.md §4) ----------
ICRISAT_DATASET_DOI = "10.17632/ywp3y5j9vv.1"
ICRISAT_FILES_API = "https://data.mendeley.com/api/datasets/ywp3y5j9vv/files"
ICRISAT_OUT = CROP_YIELD_DATA_DIR / "icrisat_district_panel.json"

# Columns kept from the source's 107 -- crop area/production/yield for the
# 5 crops the dataset covers, cropped/irrigated area, fertiliser and
# agricultural-labour covariates, and SEASONAL (not the raw 48 monthly)
# climate aggregates, to keep the shipped file a reasonable size while
# still carrying real covariates a later model could use. This is a
# documented trim, not a silent drop -- see the script's own docstring and
# the output file's own metadata.trimmed_columns_note.
ICRISAT_CROPS = ["RICE", "PEARL MILLET", "CHICKPEA", "GROUNDNUT", "SUGARCANE"]
ICRISAT_SEASONS = ["Winter JAN-FEB", "Summer MAR-MAY", "Rainy JUN-SEP", "Autumn OCT-DEC"]
ICRISAT_CLIMATE_VARS = [
    ("MAXIMUM TEMPERATURE (Centigrate)", "tmax_c"),
    ("MINIMUM TEMPERATURE (Centigrate)", "tmin_c"),
    ("PERCIPITATION (Millimeters)", "precip_mm"),
    ("ACTUAL EVAPOTRANSPIRATION (Millimeters)", "aet_mm"),
    ("WINDSPEED (Meter per second)", "windspeed_mps"),
]

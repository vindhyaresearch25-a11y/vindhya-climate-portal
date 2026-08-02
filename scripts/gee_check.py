"""
gee_check.py — verify Google Earth Engine access before any real work.

Run this once after setting up the service account. It fails loudly and
tells you exactly which step is incomplete, rather than producing an empty
result that looks like data.

Setup expected:
    export GEE_SERVICE_ACCOUNT_JSON=~/.gee/service-account.json
    export GEE_PROJECT_ID=your-cloud-project-id
    pip install earthengine-api

Usage:
    python scripts/gee_check.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# A small, cheap query over Bhopal: does Sentinel-2 actually return imagery?
TEST_POINT = (77.413, 23.260)      # lon, lat — Bhopal
TEST_START = "2025-01-01"
TEST_END = "2025-03-31"


def fail(msg: str, fix: str) -> None:
    print(f"\nFAILED: {msg}\n\nHow to fix:\n{fix}\n", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    try:
        import ee
    except ImportError:
        fail("earthengine-api is not installed.",
             "    pip install earthengine-api --break-system-packages")

    key_path = os.environ.get("GEE_SERVICE_ACCOUNT_JSON", "").strip()
    project = os.environ.get("GEE_PROJECT_ID", "").strip()

    if not key_path:
        fail("GEE_SERVICE_ACCOUNT_JSON is not set.",
             "    echo 'export GEE_SERVICE_ACCOUNT_JSON=~/.gee/service-account.json' >> ~/.zprofile\n"
             "    source ~/.zprofile")
    if not project:
        fail("GEE_PROJECT_ID is not set.",
             "    echo 'export GEE_PROJECT_ID=your-project-id' >> ~/.zprofile\n"
             "    source ~/.zprofile")

    key = Path(os.path.expanduser(key_path))
    if not key.exists():
        fail(f"Key file not found: {key}",
             "    Download the JSON key from\n"
             "    https://console.cloud.google.com/iam-admin/serviceaccounts\n"
             "    then: mv ~/Downloads/<file>.json ~/.gee/service-account.json")

    try:
        info = json.loads(key.read_text())
        sa_email = info["client_email"]
    except Exception as exc:
        fail(f"Key file is not a valid service-account JSON: {exc}",
             "    Re-download it: Service account -> Keys -> Add key -> JSON")

    print(f"Service account : {sa_email}")
    print(f"Cloud project   : {project}")
    print(f"Key file        : {key}\n")

    try:
        creds = ee.ServiceAccountCredentials(sa_email, str(key))
        ee.Initialize(creds, project=project)
    except Exception as exc:
        fail(f"Earth Engine refused the credentials.\n  {exc}",
             "  Most likely one of these three steps is incomplete:\n"
             "   1. The Cloud project is not registered for Earth Engine:\n"
             "      https://code.earthengine.google.com/register\n"
             "   2. The Earth Engine API is not enabled on the project:\n"
             "      https://console.cloud.google.com/apis/library/earthengine.googleapis.com\n"
             f"   3. The SERVICE ACCOUNT ITSELF is not registered. Register\n"
             f"      {sa_email}\n"
             "      at https://code.earthengine.google.com/register — this is\n"
             "      the step most people miss, and it produces a 403.")

    print("Authentication OK.\n")

    # Real query, not a stub: does Sentinel-2 return scenes over Bhopal?
    try:
        pt = ee.Geometry.Point(list(TEST_POINT))
        col = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
               .filterBounds(pt)
               .filterDate(TEST_START, TEST_END))
        n = col.size().getInfo()
        print(f"Sentinel-2 scenes over Bhopal, {TEST_START} to {TEST_END}: {n}")
        if n == 0:
            print("  Zero scenes. Authentication works but the query returned "
                  "nothing — widen the date range before concluding anything.")
        else:
            first = col.first()
            date = ee.Date(first.get("system:time_start")).format(
                "YYYY-MM-dd").getInfo()
            cloud = first.get("CLOUDY_PIXEL_PERCENTAGE").getInfo()
            print(f"  First scene: {date}, cloud cover {cloud:.1f}%")
    except Exception as exc:
        fail(f"Authenticated, but the data query failed.\n  {exc}",
             "  The credentials work. Check that the service account has the\n"
             "  'Earth Engine Resource Writer' role on the project.")

    print("\nEarth Engine is ready. You can now run GEE scripts from here.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

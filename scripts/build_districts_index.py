"""
build_districts_index.py -- regenerate dashboard/data/boundaries/soi/
districts_index.json from the real districts.geojson (now Hugging
Face-hosted, see dashboard/data/boundaries/README.md).

Why this file exists: 2026-08-06's HF migration deleted the ~20MB
districts.geojson from the working tree (kept in HF + git history only,
see docs/DATA_SOURCES.md). national_districts.py -- the shared district
list used by fetch_crop_stats.py, fetch_mandi_prices.py, and anything
else that iterates India's 733 districts by name -- used to read that
file directly and broke as a result. districts_index.json is the fix: a
~70KB properties-only extract (state_name/district_name/district_lgd, no
geometry) that's small enough to check into git directly rather than
re-fetching ~20MB over the network on every script run.

Run this whenever the upstream districts.geojson changes (state/district
boundary corrections, new districts).

Usage:
  python scripts/build_districts_index.py
"""
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))

OUT = ROOT / "dashboard" / "data" / "boundaries" / "soi" / "districts_index.json"
DATA_CONFIG = ROOT / "dashboard" / "config" / "data_config.json"


def source_url() -> str:
    base = json.loads(DATA_CONFIG.read_text())["DATA_BASE_URL"]
    return base.rstrip("/") + "/boundaries/soi/districts.geojson"


def main() -> int:
    url = source_url()
    print(f"Fetching {url} ...")
    req = urllib.request.Request(url, headers={"User-Agent": "vindhya-climate-portal/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        geo = json.loads(r.read())

    districts = []
    for feat in geo["features"]:
        p = feat["properties"]
        districts.append({
            "state_name": p["state_name"].strip(),
            "district_name": p["district_name"].strip(),
            "district_lgd": p.get("district_lgd"),
        })

    idx = {
        "metadata": {
            "source": "Survey of India via NWDP (dashboard/data/boundaries/soi/"
                      "districts.geojson, HF-hosted -- see boundaries/README.md)",
            "description": "Properties-only index (state_name/district_name/"
                           "district_lgd, no geometry) for Python scripts that "
                           "iterate districts by name without needing the full "
                           "boundary geometry file or a network fetch. "
                           "Regenerate via this script whenever districts.geojson "
                           "changes upstream.",
            "count": len(districts),
            "last_updated": date.today().isoformat(),
        },
        "districts": districts,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(idx, ensure_ascii=False, indent=1))
    print(f"Wrote {OUT} ({len(districts)} districts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

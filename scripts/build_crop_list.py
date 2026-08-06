"""
build_crop_list.py -- the exact crop list farmers pick from in the ground-
truth upload form (dashboard/kisan_upload.html), derived from
crop_stats.json's own real crop labels rather than a separately typed-in
dropdown list that could drift from what the rest of the portal calls
each crop.

Usage:
  python scripts/build_crop_list.py
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "dashboard" / "data" / "crop_stats.json"
OUT = ROOT / "dashboard" / "data" / "crop_list.json"


def main() -> int:
    d = json.loads(SRC.read_text())
    crops = set()
    for dist in d.get("districts", {}).values():
        for r in dist.get("records", []):
            if r.get("crop"):
                crops.add(r["crop"])

    out = {
        "metadata": {
            "source": "Derived from dashboard/data/crop_stats.json's own crop labels "
                      "(data.gov.in district-wise crop statistics) -- not a separately "
                      "typed-in list, so it can't drift from what the rest of the portal "
                      "calls each crop.",
            "count": len(crops),
            "last_updated": "2026-08-07",
        },
        "crops": sorted(crops),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"Wrote {OUT} ({len(crops)} crops)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
build_crop_stats_des_district_files.py -- reshapes the 23 national-per-
year DES files (dashboard/data/crop_stats_des/<year>.json, 86MB total)
into per-district files (dashboard/data/crop_stats_des_by_district/
<state_slug>/<district_slug>.json), matching this repo's established
file-architecture convention (see data/climate/<state>/<district>.json)
so the dashboard can lazy-load one district's full 23-year time series
instead of fetching a whole year's national file to read one district's
rows -- STANDING ORDERS #8.1 ("ek badi file KABHI nahi").

District identity: DES's own per-state serial-numbered labels ("17.
Madhya Pradesh", "1. Agar malwa") are stripped and slugified the same way
national_districts.py does, so lookups from the dashboard's existing
district dropdown (which already uses this slug convention for climate/
mandi data) work without a separate mapping table. Districts whose slug
doesn't match any of the 733 in districts_index.json are still written
(under their own DES-derived slug) rather than dropped -- CHARAN 7 found
real cases (renamed/newer districts) that shouldn't silently disappear;
docs/DISTRICT_NAME_MAP.md is the reconciliation record for those.

Usage:
  python scripts/build_crop_stats_des_district_files.py
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "dashboard" / "data" / "crop_stats_des"
OUT_DIR = ROOT / "dashboard" / "data" / "crop_stats_des_by_district"


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def strip_serial(s: str) -> str:
    return re.sub(r"^\d+\.\s*", "", s).strip()


def main() -> int:
    # {(state_slug, district_slug): {"state": .., "district": .., "records": [...]}}
    by_district: dict[tuple[str, str], dict] = {}

    year_files = sorted(SRC_DIR.glob("*.json"))
    if not year_files:
        print("No dashboard/data/crop_stats_des/*.json found -- run fetch_des_apy.py first.")
        return 1

    total_records = 0
    for f in year_files:
        d = json.loads(f.read_text())
        for r in d["records"]:
            state = strip_serial(r["state"])
            district = strip_serial(r["district"])
            key = (slugify(state), slugify(district))
            entry = by_district.setdefault(key, {"state": state, "district": district, "records": []})
            entry["records"].append({
                "year": r["year"], "crop": r["crop"], "season": r["season"],
                "area_ha": r["area_ha"], "production": r["production"],
                "yield_per_ha": r["yield_per_ha"], "unit": r["unit"],
            })
            total_records += 1

    written = 0
    for (state_slug, district_slug), entry in by_district.items():
        out_path = OUT_DIR / state_slug / f"{district_slug}.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        records = entry["records"]
        years = sorted({r["year"] for r in records})
        out = {
            "metadata": {
                "title": f"DES district-wise crop APY -- {entry['district']}, {entry['state']}",
                "source": "Directorate of Economics and Statistics (DES), Dept. of Agriculture and "
                          "Farmers Welfare, data.desagri.gov.in",
                "state": entry["state"], "district": entry["district"],
                "year_range": [years[0], years[-1]] if years else None,
                "count": len(records),
                "unit": "area in hectares, production in tonnes (bales for cotton/jute -- see each "
                        "record's own 'unit' field)",
                "last_updated": "2026-08-07",
            },
            "records": records,
        }
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1))
        written += 1

    print(f"Read {total_records} records from {len(year_files)} year files.")
    print(f"Wrote {written} per-district files under {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

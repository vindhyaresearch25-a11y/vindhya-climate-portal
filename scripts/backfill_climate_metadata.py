"""
backfill_climate_metadata.py -- adds method/baseline/data_quality/
unit_count/resolution/last_updated to every existing
dashboard/data/climate/<state>/<district>.json file, matching the fields
scripts/config.py's GEE_SOURCE_META + 08_gee_national_climate.py's
per-file payload now write for every NEW file (owner-flagged gap,
2026-08-07: "method aur data_quality KHALI hain").

Honesty note on unit_count for BACKFILLED files specifically: the exact
per-file daily-row count (len(daily) at the time it was originally
computed) was never persisted for files written before this fix, and
this script does not re-fetch from GEE to recover it (that would cost
real GEE quota for a metadata-only change). Backfilled files get an
approximate unit_count derived from the file's own "years" field
(nominal calendar span, ~365 days/year) with a label that says exactly
that -- "nominal, not the exact recorded count" -- rather than
presenting a guessed number as if it were the real observed count. Any
file written by 08_gee_national_climate.py from now on gets the real
count directly.

Safe to run while 08_gee_national_climate.py --resume is still running:
this script only ever touches files that already exist on disk at the
moment it lists them; the live fetch only ever writes to district files
that don't exist yet (--resume skips existing ones), so there's no
file either process would touch at the same time.

Usage:
  python scripts/backfill_climate_metadata.py
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLIMATE_DIR = ROOT / "dashboard" / "data" / "climate"

METHOD_TEXT = (
    "Heatwave: IMD plains criteria (Tmax departure from normal >=4.5C mild / "
    ">=6.5C severe, March-June season, scripts/config.py HW_DEPARTURE_MILD/"
    "SEVERE). SPI: McKee et al. 1993, 3/6/12-month timescales with the "
    "zero-inflated gamma correction for zero-rainfall periods, moderate-drought "
    "threshold SPI<=-1.0. ETCCDI: standard extreme-precipitation indices "
    "(R95p/R99p/Rx1day/Rx5day/CDD/CWD) at 95th/99th percentile thresholds. "
    "Identical formulas to scripts/02_compute_indices.py (imported directly "
    "by 08_gee_national_climate.py, never reimplemented) -- only the input "
    "grid (ERA5-Land/CHIRPS here, IMD 0.05 deg for the 5 original MP "
    "districts) differs. See docs/METHODOLOGY.md for the exact formulas."
)
BASELINE_TEXT = (
    "2000-2014 (ETCCDI percentile base period and historical baseline "
    "window, scripts/config.py EXT_PRECIP_BASE_PERIOD / HISTORICAL_BASELINE_WINDOW)"
)
RESOLUTION_TEXT = (
    "ERA5-Land ~9 km (0.1 deg) native grid, CHIRPS ~5.5 km (0.05 deg) -- "
    "both far coarser than a village (~2 sq km): a district's indices "
    "here are ONE value per pixel-day within the district polygon "
    "(GEE reduceRegion mean), not a village-resolved product. See "
    "docs/METHODOLOGY.md Sec 3.1 (modifiable areal unit problem)."
)
DATA_QUALITY_TEXT = "verified-official (real dataset, cross-source from IMD)"


def main() -> int:
    files = sorted(CLIMATE_DIR.glob("*/*.json"))
    if not files:
        print("No climate files found under", CLIMATE_DIR)
        return 1

    updated = 0
    already_ok = 0
    today = date.today().isoformat()
    for f in files:
        d = json.loads(f.read_text())
        meta = d.get("metadata")
        if not meta:
            continue
        changed = False
        if not meta.get("method"):
            meta["method"] = METHOD_TEXT
            changed = True
        if not meta.get("baseline"):
            meta["baseline"] = BASELINE_TEXT
            changed = True
        if not meta.get("data_quality"):
            meta["data_quality"] = meta.get("quality") or DATA_QUALITY_TEXT
            changed = True
        if not meta.get("resolution"):
            meta["resolution"] = RESOLUTION_TEXT
            changed = True
        if not meta.get("unit_count"):
            years_str = meta.get("years", "")
            n_years = None
            if "-" in years_str:
                try:
                    y0, y1 = years_str.split("-")
                    n_years = int(y1) - int(y0) + 1
                except ValueError:
                    n_years = None
            if n_years:
                meta["unit_count"] = (
                    f"~{n_years * 365} daily pixel-day observations (nominal, "
                    f"{n_years} years x 365 days -- the exact recorded count "
                    f"from when this file was first computed was not persisted "
                    f"before this backfill; files written from 2026-08-07 onward "
                    f"carry the real observed count instead of this nominal one)"
                )
            else:
                meta["unit_count"] = (
                    "not recoverable without re-fetching from GEE -- "
                    "the 'years' field itself is missing/malformed in this file"
                )
            changed = True
        if not meta.get("last_updated"):
            meta["last_updated"] = today
            changed = True

        if changed:
            f.write_text(json.dumps(d, ensure_ascii=False, indent=2))
            updated += 1
        else:
            already_ok += 1

    print(f"Checked {len(files)} climate files: {updated} updated, {already_ok} already complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

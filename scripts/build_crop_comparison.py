"""
build_crop_comparison.py -- CROP_DATA_PROMPT.md CHARAN 5: cross-check DES
(this repo's designated MUKHYA/primary crop source) against every other
crop-statistics source this repo has actually fetched. Never merges
figures -- for each (district, crop, season, year) all sources' numbers
are shown side by side plus the raw difference, so a reader sees the real
disagreement rather than a smoothed-over average.

Sources compared (only ones actually fetched so far -- UPAg and state
annual reports are not yet pulled, see docs/CROP_DATA_COVERAGE.md and
docs/STATE_REPORTS.md; this script does not wait for them):
  - DES (data.desagri.gov.in), dashboard/data/crop_stats_des/*.json --
    the designated primary source.
  - Legacy data.gov.in resource, dashboard/data/crop_stats.json -- 5 MP
    districts, 1997-2013 only, kept as-is (never overwritten by this
    script).

District/crop names are matched using docs/DISTRICT_NAME_MAP.md's
confirmed renames where applicable; the legacy source only covers 5
Madhya Pradesh districts so the practical overlap is small, but this is
exactly the comparison CHARAN 5 asks for -- real, not skipped because the
overlap happens to be small.

Usage:
  python scripts/build_crop_comparison.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DES_DIR = ROOT / "dashboard" / "data" / "crop_stats_des"
LEGACY_PATH = ROOT / "dashboard" / "data" / "crop_stats.json"
OUT_PATH = ROOT / "dashboard" / "data" / "crop_stats_comparison.json"

# The legacy file's 5 district slugs are all in Madhya Pradesh and use
# plain lowercase names with no per-state DES-style "N. " prefix.
LEGACY_DISTRICT_TO_DES = {
    "bhopal": "Bhopal", "indore": "Indore", "jabalpur": "Jabalpur",
    "rewa": "Rewa", "sidhi": "Sidhi",
}


def norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


LEGACY_MAX_YEAR = 2013  # the legacy source's own range is 1997-2013 -- DES
# years after this can never have a legacy counterpart, so excluding them
# keeps this file focused on the actual overlap CHARAN 5 asks about
# instead of duplicating DES's full MP coverage (measured: cut the file
# from 31,403 rows / 9.9MB to the real overlap below).


def load_des() -> dict:
    """{(district_norm, crop, season, year): {"area_ha":..,"production":..}}"""
    out = {}
    for f in sorted(DES_DIR.glob("*.json")):
        d = json.loads(f.read_text())
        for r in d["records"]:
            district = re.sub(r"^\d+\.\s*", "", r["district"]).strip()
            state = re.sub(r"^\d+\.\s*", "", r["state"]).strip()
            if state != "Madhya Pradesh":
                continue  # only the legacy source's 5 MP districts overlap
            year_str = r["year"]  # "2000 - 2001"
            year = int(year_str.split(" - ")[0])
            if year > LEGACY_MAX_YEAR:
                continue
            key = (norm(district), r["crop"], r["season"], year)
            out[key] = {"area_ha": r["area_ha"], "production": r["production"]}
    return out


def load_legacy() -> dict:
    d = json.loads(LEGACY_PATH.read_text())
    out = {}
    for slug, dist in d["districts"].items():
        des_name = LEGACY_DISTRICT_TO_DES.get(slug)
        if not des_name:
            continue
        for r in dist.get("records", []):
            key = (norm(des_name), r["crop"], r["season"], r["year"])
            out[key] = {"area_ha": r["area_ha"], "production": r["production_tonnes"]}
    return out


def pct_diff(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or a == 0:
        return None
    return round((b - a) / a * 100, 1)


def main() -> int:
    des = load_des()
    legacy = load_legacy()
    all_keys = set(des) | set(legacy)

    rows = []
    for key in sorted(all_keys):
        district_norm, crop, season, year = key
        des_rec = des.get(key)
        legacy_rec = legacy.get(key)
        if des_rec is None and legacy_rec is None:
            continue
        rows.append({
            "district": next((v for v in LEGACY_DISTRICT_TO_DES.values() if norm(v) == district_norm), district_norm),
            "crop": crop, "season": season, "year": year,
            "des": des_rec or {"area_ha": None, "production": None},
            "legacy_data_gov_in": legacy_rec or {"area_ha": None, "production": None},
            "area_diff_pct_des_vs_legacy": pct_diff(
                legacy_rec["area_ha"] if legacy_rec else None,
                des_rec["area_ha"] if des_rec else None,
            ) if des_rec and legacy_rec else None,
            "both_sources_present": bool(des_rec and legacy_rec),
        })

    both = [r for r in rows if r["both_sources_present"]]
    diffs = [abs(r["area_diff_pct_des_vs_legacy"]) for r in both if r["area_diff_pct_des_vs_legacy"] is not None]

    out = {
        "metadata": {
            "title": "Cross-source crop statistics comparison -- DES vs legacy data.gov.in",
            "description": "CROP_DATA_PROMPT.md CHARAN 5. DES (data.desagri.gov.in) is this "
                           "portal's designated primary (MUKHYA) crop-statistics source; the "
                           "legacy data.gov.in pull (5 Madhya Pradesh districts, 1997-2013) is "
                           "shown as a cross-check, never averaged or merged into DES's numbers. "
                           "UPAg and state-department annual reports are not yet fetched (see "
                           "docs/CROP_DATA_COVERAGE.md, docs/STATE_REPORTS.md) so are not part "
                           "of this comparison yet.",
                "sources": {
                "des": "Directorate of Economics and Statistics, data.desagri.gov.in",
                "legacy_data_gov_in": "data.gov.in, Ministry of Agriculture and Farmers Welfare, "
                                      "resource 35be999b-0208-4354-b557-f6ca9a5355de",
            },
            "overlap_scope": "5 Madhya Pradesh districts (the legacy source's only coverage), "
                             "years 2000-2013 (legacy source's own range, intersected with DES's "
                             "2000-01 to 2022-23)",
            "row_count": len(rows),
            "rows_with_both_sources": len(both),
            "area_pct_diff_summary": {
                "n": len(diffs),
                "mean_abs_pct_diff": round(sum(diffs) / len(diffs), 1) if diffs else None,
                "max_abs_pct_diff": round(max(diffs), 1) if diffs else None,
            },
            "last_updated": "2026-08-07",
        },
        "rows": rows,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"Wrote {OUT_PATH}: {len(rows)} rows, {len(both)} with both sources present")
    if diffs:
        print(f"Area %% diff (DES vs legacy) where both exist: mean abs {out['metadata']['area_pct_diff_summary']['mean_abs_pct_diff']}%%, "
              f"max abs {out['metadata']['area_pct_diff_summary']['max_abs_pct_diff']}%%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

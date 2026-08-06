"""
fetch_des_apy.py -- national, year-by-year Area/Production/Yield pull from
the Directorate of Economics & Statistics (data.desagri.gov.in), the
primary source CROP_DATA_PROMPT.md designates for crop statistics.

This calls the exact endpoint the site's own "View Report" button calls
(POST /report/crop/horizontal_crop_vertical_year) -- reverse-engineered
by intercepting window.fetch/XMLHttpRequest in a real browser session
while using the form normally (CHARAN 1's own instruction: "portal khud
kis API se data laata hai, wahi seedha istemal ho sakta hai"), not by
probing undocumented endpoints. It parses the same HTML table a human
would see after clicking the button
(scripts/des_apy_table_extractor.js is the browser-side twin of the
table-parsing logic below, kept for manual/console use).

Politeness (STANDING NIYAM "server par bojh mat daalo"):
  - One request per year (not per district/crop -- the site handles an
    All States/All Districts/All Crops query for a single year fine,
    verified interactively first).
  - SLEEP_SECONDS pause between requests.
  - A real browser User-Agent and Referer, exactly what a normal visitor's
    browser sends -- no header spoofing beyond that.
  - Retries with backoff, never hammering on failure.

Usage:
  python scripts/fetch_des_apy.py --start-year 2000 --end-year 2000   # one year, for testing
  python scripts/fetch_des_apy.py --start-year 2000 --end-year 2022   # full national sweep
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "dashboard" / "data" / "crop_stats_des"

BASE = "https://data.desagri.gov.in"
FORM_URL = f"{BASE}/website/crops-apy-report-web"
SUBMIT_URL = f"{BASE}/report/crop/horizontal_crop_vertical_year"

# The 5 real seasons DES reports (excludes "Whole Year", a separate season
# category for continuously-grown crops like sugarcane -- fetched too, see
# SEASON_CODES below; single-letter codes match the site's own <option value>).
SEASON_CODES = {"Rabi": "R", "Kharif": "K", "Autumn": "A", "Winter": "W", "Summer": "S", "Whole Year": "Y"}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer": FORM_URL,
    "X-Requested-With": "XMLHttpRequest",
}
SLEEP_SECONDS = 3.0
TIMEOUT = 90
RETRIES = 3


def get_token(session: requests.Session) -> str:
    r = session.get(FORM_URL, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    inp = soup.find("input", {"name": "_token"})
    if not inp or not inp.get("value"):
        raise RuntimeError("Could not find _token on the form page -- site markup may have changed.")
    return inp["value"]


def fetch_year(session: requests.Session, token: str, year: int) -> str:
    """One POST for one calendar year (e.g. 2000 -> DES's '2000 - 2001'),
    all states, all districts, all crops, all 6 season categories."""
    data = [
        ("reportformat", "horizontal_crop_vertical_year"),
        ("fltrstates[]", ""),
        ("fltrdistricts[]", "all"),
        ("fltrcrops[]", ""),
    ]
    for code in SEASON_CODES.values():
        data.append(("fltrseason[]", code))
    data += [
        ("fltrstartyear", str(year)),
        ("fltrendyear", str(year)),
        ("fltrrptformat", "exl"),  # confirmed value from the real captured request;
                                    # both "exl" and Screen View render the same HTML
                                    # table server-side, only the on-screen CSS differs
        ("_token", token),
    ]
    last_exc = None
    for attempt in range(RETRIES):
        try:
            r = session.post(SUBMIT_URL, data=data, headers=HEADERS, timeout=TIMEOUT)
            r.raise_for_status()
            return r.text
        except Exception as exc:
            last_exc = exc
            if attempt < RETRIES - 1:
                time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"year {year}: {last_exc}")


def parse_table(html: str, year_label: str) -> list[dict]:
    """Same colspan/rowspan logic as scripts/des_apy_table_extractor.js
    (the browser-side twin) -- row 0 (crop) includes the State/District/
    Year rowSpan=3 header cells as real <td>s, rows 1 (season) and 2
    (metric) don't repeat them."""
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if table is None:
        return []
    trs = table.find_all("tr")
    if len(trs) < 4:
        return []

    def expand_row(tr):
        out = []
        for td in tr.find_all(["td", "th"]):
            text = td.get_text(strip=True)
            span = int(td.get("colspan", 1))
            out.extend([text] * span)
        return out

    crop_row = expand_row(trs[0])[3:]
    season_row = expand_row(trs[1])
    metric_row = expand_row(trs[2])
    n_cols = len(metric_row)

    records = []
    current_state = None
    for tr in trs[3:]:
        expanded = []
        for td in tr.find_all(["td", "th"]):
            text = td.get_text(strip=True)
            span = int(td.get("colspan", 1))
            expanded.extend([text] * span)
        if len(expanded) == 3 + n_cols:
            current_state, district_col, year_col, data_start = expanded[0], expanded[1], expanded[2], 3
        elif len(expanded) == 2 + n_cols:
            district_col, year_col, data_start = expanded[0], expanded[1], 2
        else:
            continue  # malformed row -- skip rather than misalign silently
        for c in range(0, n_cols, 3):
            area, prod, yld = expanded[data_start + c: data_start + c + 3]
            if area or prod or yld:
                records.append({
                    "state": current_state, "district": district_col, "year": year_col,
                    "crop": crop_row[c] if c < len(crop_row) else None,
                    "season": season_row[c] if c < len(season_row) else None,
                    "area_raw": area or None, "production_raw": prod or None, "yield_raw": yld or None,
                    "unit": metric_row[c] if c < len(metric_row) else None,
                })
    return records


def clean_number(raw: str | None) -> float | None:
    if not raw:
        return None
    try:
        return float(raw.replace(",", ""))
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-year", type=int, required=True, help="e.g. 2000 for '2000 - 2001'")
    ap.add_argument("--end-year", type=int, required=True, help="e.g. 2022 for '2022 - 2023'")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    total_records = 0
    for year in range(args.start_year, args.end_year + 1):
        token = get_token(session)  # fresh token each year -- cheap, avoids stale-token 419s
        print(f"[{year}] fetching...", file=sys.stderr)
        try:
            html = fetch_year(session, token, year)
        except Exception as exc:
            print(f"[{year}] FAILED: {exc}", file=sys.stderr)
            time.sleep(SLEEP_SECONDS)
            continue

        records = parse_table(html, f"{year} - {year + 1}")
        for rec in records:
            rec["area_ha"] = clean_number(rec.pop("area_raw"))
            rec["production"] = clean_number(rec.pop("production_raw"))
            rec["yield_per_ha"] = clean_number(rec.pop("yield_raw"))

        out = {
            "metadata": {
                "title": f"DES district-wise crop Area/Production/Yield, {year}-{(year + 1) % 100:02d}",
                "source": "Directorate of Economics and Statistics (DES), Department of Agriculture "
                          "and Farmers Welfare, data.desagri.gov.in",
                "source_url": FORM_URL,
                "endpoint": SUBMIT_URL,
                "spatial_unit": "district",
                "unit": "area in hectares, production in tonnes (bales for cotton/jute -- see each "
                        "record's 'unit' field), yield as reported by DES (not re-derived here)",
                "seasons_included": list(SEASON_CODES.keys()),
                "estimate_type": "as published by DES; not distinguished by this fetch as final/advance "
                                 "-- DES's own report does not label individual years either way on this "
                                 "endpoint",
                "fetch_date": now,
                "count": len(records),
            },
            "records": records,
        }
        out_path = OUT_DIR / f"{year}-{(year + 1) % 100:02d}.json"
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1))
        total_records += len(records)
        print(f"[{year}] {len(records)} records -> {out_path.name}", file=sys.stderr)
        time.sleep(SLEEP_SECONDS)

    print(f"\nDone. {total_records} total records across "
          f"{args.end_year - args.start_year + 1} year(s).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

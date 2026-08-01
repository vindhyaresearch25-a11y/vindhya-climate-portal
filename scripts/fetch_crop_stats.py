"""
fetch_crop_stats.py — district-wise, season-wise crop area/production for
the portal's 5 districts.

Source: "District-wise, season-wise crop production statistics from 1997"
on data.gov.in (Ministry of Agriculture and Farmers Welfare). Resource
35be999b-0208-4354-b557-f6ca9a5355de.

Runs on GitHub Actions, never in the browser -- same reasoning as
fetch_mandi_prices.py: the API key stays a repository secret, and GitHub
Pages serves static files only.

This dataset's own `updated_date` is 2021-07-13 (confirmed by querying the
resource's own metadata). It was NOT refreshed after that, so its Crop_Year
coverage stops years before the current date -- unlike mandi prices, this
is not a daily-refreshing source. The output's metadata block states this
explicitly. Nothing is generated: a district/season/crop combination with
no record is simply absent, never filled in or carried forward.

Yield (production / area) is a derived value computed here, not published
directly by the source -- flagged as derived in the metadata and skipped
(null) wherever area is zero or missing, rather than divided by zero or
approximated.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dashboard" / "data" / "crop_stats.json"

RESOURCE = "35be999b-0208-4354-b557-f6ca9a5355de"
BASE = f"https://api.data.gov.in/resource/{RESOURCE}"

# Same public sample key documented by data.gov.in itself; see
# fetch_mandi_prices.py for the same note. Register a private key for
# reliable runs and store it as the DATA_GOV_API_KEY repository secret.
SAMPLE_KEY = "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"

STATE = "Madhya Pradesh"
# This resource's district names are upper-case, unlike the mandi resource.
DISTRICTS = {
    "bhopal": "BHOPAL",
    "indore": "INDORE",
    "jabalpur": "JABALPUR",
    "rewa": "REWA",
    "sidhi": "SIDHI",
}

TIMEOUT = 60
RETRIES = 3
# Verified directly against this resource: the shared public sample key
# silently caps every response at 10 records and echoes back
# "limit": "10" regardless of the requested limit (e.g. requesting 50
# still returns exactly 10). A registered key may allow a larger page --
# check before raising this. Getting this wrong makes pagination stop
# after the first page, silently truncating every district to 10 rows.
PAGE_LIMIT = 10
IST = timezone(timedelta(hours=5, minutes=30))


def api_key() -> tuple[str, bool]:
    k = os.environ.get("DATA_GOV_API_KEY", "").strip()
    if k:
        return k, False
    print("WARNING: DATA_GOV_API_KEY not set; using the public sample key. "
          "It is rate-limited and shared. Register at https://data.gov.in.",
          file=sys.stderr)
    return SAMPLE_KEY, True


def fetch_all(key: str, district: str) -> list[dict]:
    """Page through every record for one district. The resource has no
    documented hard cap on offset, so this stops when a page returns fewer
    rows than PAGE_LIMIT or an empty list."""
    records: list[dict] = []
    offset = 0
    while True:
        params = {
            "api-key": key,
            "format": "json",
            "limit": str(PAGE_LIMIT),
            "offset": str(offset),
            "filters[state_name]": STATE,
            "filters[district_name]": district,
        }
        url = BASE + "?" + urllib.parse.urlencode(params)
        last = None
        payload = None
        for attempt in range(RETRIES):
            try:
                req = urllib.request.Request(
                    url, headers={"User-Agent": "vindhya-climate-portal/1.0"})
                with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                    payload = json.loads(r.read())
                if payload.get("status") != "ok":
                    raise RuntimeError(f"API status {payload.get('status')}")
                break
            except Exception as exc:
                last = exc
                payload = None
                if attempt < RETRIES - 1:
                    time.sleep(3)
        if payload is None:
            raise RuntimeError(f"{district} offset={offset}: {last}")

        page = payload.get("records", [])
        records.extend(page)
        if len(page) < PAGE_LIMIT:
            break
        offset += PAGE_LIMIT
        if offset > 50000:  # safety cap -- one district should never need this many rows
            print(f"[{district}] WARNING: stopped paging at offset {offset} (safety cap)", file=sys.stderr)
            break
        time.sleep(0.3)  # pace requests against the shared rate-limited sample key
    return records


def clean(rec: dict) -> dict | None:
    """Keep only rows with a usable area/production pair. Never substitute
    a missing value; yield is left null (not 0, not interpolated) when area
    is zero, missing, or non-numeric."""
    try:
        year = int(rec["crop_year"])
        area = float(rec["area_"])
        production = float(rec["production_"])
    except (KeyError, TypeError, ValueError):
        return None
    if area < 0 or production < 0:
        return None
    season = (rec.get("season") or "").strip()
    crop = (rec.get("crop") or "").strip()
    if not season or not crop:
        return None
    yield_val = round(production / area, 3) if area > 0 else None
    return {
        "year": year,
        "season": season,
        "crop": crop,
        "area_ha": area,
        "production_tonnes": production,
        "yield_tonnes_per_ha": yield_val,
    }


def main() -> int:
    key, is_sample = api_key()
    now = datetime.now(IST)
    out = {
        "metadata": {
            "title": "District-wise, season-wise crop area, production and derived yield",
            "source": "data.gov.in, Ministry of Agriculture and Farmers Welfare "
                      "(\"District-wise, season-wise crop production statistics from 1997\")",
            "resource_id": RESOURCE,
            "source_url": "https://www.data.gov.in/resource/district-wise-season-wise-crop-production-statistics-1997",
            "unit": "area in hectares, production in tonnes, yield in tonnes/hectare (derived)",
            "spatial_unit": "district",
            "crs": "not applicable (tabular)",
            "processing": "filtered to Madhya Pradesh and the five covered districts; "
                          "yield is computed here as production/area and is null (not "
                          "estimated) wherever area is zero or missing; rows with a "
                          "missing/negative area or production, or no season/crop label, "
                          "are dropped",
            "data_quality": "verified",
            "key_used": "public sample key (rate limited)" if is_sample
                        else "registered data.gov.in key",
            # This dataset's own updated_date (checked against the resource
            # metadata endpoint) is 2021-07-13. It has not been refreshed
            # upstream since, so recent crop years are not present here --
            # unlike mandi prices, this is not a daily-moving source.
            "upstream_last_updated": "2021-07-13",
            "coverage_note": "The source was last updated 2021-07-13 and has not been "
                             "refreshed since; for these 5 districts its year coverage "
                             "runs from 1997 to 2013, not the current year. Do not "
                             "present this as current-season data.",
            "fetch_date": now.isoformat(timespec="seconds"),
        },
        "districts": {},
    }

    failures = 0
    for slug, name in DISTRICTS.items():
        try:
            raw = fetch_all(key, name)
        except Exception as exc:
            print(f"[{slug}] FETCH FAILED: {exc}", file=sys.stderr)
            out["districts"][slug] = {
                "name": name.title(), "records": [], "count": 0,
                "note": f"Upstream fetch failed: {exc}",
            }
            failures += 1
            continue

        rows = [c for c in (clean(r) for r in raw) if c]
        rows.sort(key=lambda r: (r["year"], r["season"], r["crop"]))
        years = sorted({r["year"] for r in rows})
        out["districts"][slug] = {
            "name": name.title(),
            "records": rows,
            "count": len(rows),
            "dropped": len(raw) - len(rows),
            "year_range": [years[0], years[-1]] if years else None,
            "note": None if rows else
                    "No crop statistics returned for this district from the source.",
        }
        print(f"[{slug}] {len(rows)} rows kept, {len(raw) - len(rows)} dropped, "
              f"years: {years[0] if years else '--'}-{years[-1] if years else '--'}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    total = sum(d["count"] for d in out["districts"].values())
    print(f"\nWrote {OUT.name}: {total} rows across {len(DISTRICTS)} districts, "
          f"{failures} fetch failures")
    return 1 if failures == len(DISTRICTS) else 0


if __name__ == "__main__":
    raise SystemExit(main())

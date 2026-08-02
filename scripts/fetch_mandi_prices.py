"""
fetch_mandi_prices.py — daily mandi prices, nationally (all 36 states/UTs,
733 districts — see national_districts.py, built from the real Survey of
India district layer, not a separately typed-in list).

Source: AGMARKNET, published as "Current Daily Price of Various Commodities
from Various Markets (Mandi)" on data.gov.in (Ministry of Agriculture and
Farmers Welfare). Resource 9ef84268-d588-465a-a308-a864a43d0070.

Runs on GitHub Actions, never in the browser. Two reasons:
  1. the API key stays a repository secret instead of being shipped to every
     visitor in JavaScript;
  2. GitHub Pages serves static files only, so a committed JSON is the one
     delivery mechanism that works without a backend.

Nothing is generated. A district with no arrivals today is written with an
empty record list and an explicit note, not with carried-forward prices. A
district whose AGMARKNET spelling doesn't match the Survey of India name
used to query it (a real, expected mismatch for some districts) surfaces as
an honest per-district fetch failure in its own "note" field, never a
silently dropped or guessed result.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from national_districts import load_district_slugs

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dashboard" / "data" / "mandi_prices.json"

RESOURCE = "9ef84268-d588-465a-a308-a864a43d0070"
BASE = f"https://api.data.gov.in/resource/{RESOURCE}"

# data.gov.in publishes this sample key in its own API documentation. It is
# heavily rate-limited and shared by every anonymous caller. Register at
# https://data.gov.in for a private key and store it as the DATA_GOV_API_KEY
# repository secret.
SAMPLE_KEY = "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"

# {slug: (state_name, district_name)} for all 733 districts.
DISTRICT_SLUGS = load_district_slugs()

TIMEOUT = 45
RETRIES = 3
REQUEST_PACING_SEC = 0.25  # be a polite national-scale caller, not just a 5-district one
IST = timezone(timedelta(hours=5, minutes=30))


def api_key() -> tuple[str, bool]:
    k = os.environ.get("DATA_GOV_API_KEY", "").strip()
    if k:
        return k, False
    print("WARNING: DATA_GOV_API_KEY not set; using the public sample key. "
          "It is rate-limited and shared. Register at https://data.gov.in.",
          file=sys.stderr)
    return SAMPLE_KEY, True


def fetch(key: str, state: str, district: str) -> list[dict]:
    params = {
        "api-key": key,
        "format": "json",
        "limit": "200",
        "filters[state.keyword]": state,
        "filters[district]": district,
    }
    url = BASE + "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "vindhya-climate-portal/1.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                payload = json.loads(r.read())
            if payload.get("status") != "ok":
                raise RuntimeError(f"API status {payload.get('status')}")
            return payload.get("records", [])
        except Exception as exc:
            last = exc
            if attempt < RETRIES - 1:
                time.sleep(3)
    raise RuntimeError(f"{district}: {last}")


def clean(rec: dict) -> dict | None:
    """Keep only rows with a usable price. Never substitute a missing value."""
    try:
        mn = float(rec["min_price"])
        mx = float(rec["max_price"])
        md = float(rec["modal_price"])
    except (KeyError, TypeError, ValueError):
        return None
    # Mandi prices are Rs/quintal. Anything outside this band is an upstream
    # data error, not a real price; drop it rather than display it.
    if not all(1 <= v <= 200000 for v in (mn, mx, md)):
        return None
    if mn > mx:
        return None
    return {
        "market": rec.get("market", "").strip(),
        "commodity": rec.get("commodity", "").strip(),
        "variety": rec.get("variety", "").strip(),
        "grade": rec.get("grade", "").strip(),
        "arrival_date": rec.get("arrival_date", ""),
        "min_price": mn,
        "max_price": mx,
        "modal_price": md,
    }


def main() -> int:
    key, is_sample = api_key()
    now = datetime.now(IST)
    out = {
        "metadata": {
            "title": "Daily mandi prices",
            "source": "AGMARKNET via data.gov.in, Ministry of Agriculture and "
                      "Farmers Welfare",
            "resource_id": RESOURCE,
            "source_url": "https://agmarknet.gov.in/",
            "unit": "INR per quintal",
            "spatial_unit": "APMC market, aggregated to district",
            "crs": "not applicable (tabular)",
            "processing": "national -- all 36 states/UTs, 733 districts from the "
                          "Survey of India district layer (national_districts.py); "
                          "rows without a usable min/max/modal price, or with min "
                          "greater than max, are dropped; no value is interpolated "
                          "or carried forward; a district whose AGMARKNET name "
                          "doesn't match its Survey of India name is a real, "
                          "expected fetch failure, recorded per-district, not "
                          "silently skipped",
            "data_quality": "verified",
            "key_used": "public sample key (rate limited)" if is_sample
                        else "registered data.gov.in key",
            "last_updated": now.isoformat(timespec="seconds"),
        },
        "districts": {},
    }

    failures = 0
    for i, (slug, (state, name)) in enumerate(sorted(DISTRICT_SLUGS.items())):
        try:
            raw = fetch(key, state, name)
        except Exception as exc:
            print(f"[{slug}] FETCH FAILED: {exc}", file=sys.stderr)
            out["districts"][slug] = {
                "name": name, "state": state, "records": [], "count": 0,
                "note": f"Upstream fetch failed: {exc}",
            }
            failures += 1
            time.sleep(REQUEST_PACING_SEC)
            continue

        rows = [c for c in (clean(r) for r in raw) if c]
        rows.sort(key=lambda r: (r["commodity"], r["market"]))
        dates = sorted({r["arrival_date"] for r in rows if r["arrival_date"]})
        out["districts"][slug] = {
            "name": name,
            "state": state,
            "records": rows,
            "count": len(rows),
            "dropped": len(raw) - len(rows),
            "arrival_dates": dates,
            "note": None if rows else
                    "No arrivals reported for this district in the current "
                    "AGMARKNET release. This is normal on holidays and "
                    "off-season days, or the district name not matching "
                    "AGMARKNET's spelling; no price is carried forward.",
        }
        if (i + 1) % 50 == 0:
            print(f"  ... {i + 1}/{len(DISTRICT_SLUGS)} districts done")
        time.sleep(REQUEST_PACING_SEC)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    total = sum(d["count"] for d in out["districts"].values())
    print(f"\nWrote {OUT.name}: {total} price rows across "
          f"{len(DISTRICT_SLUGS)} districts, {failures} fetch failures")
    # A quiet market day (or a district AGMARKNET has no data for at all)
    # is not a build failure. Only a total outage is.
    return 1 if failures == len(DISTRICT_SLUGS) else 0


if __name__ == "__main__":
    raise SystemExit(main())

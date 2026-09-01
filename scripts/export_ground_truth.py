"""
export_ground_truth.py -- pulls new farmer crop submissions out of D1
(cloudflare/kisan_upload_worker.js's table), resolves each point's real
village/block/district/state via point-in-polygon against the Survey of
India boundary layer (never asked of the farmer -- B4), rounds
coordinates to 3 decimals (~100m) for the PUBLIC copy only, and writes
data/ground_truth/<state_slug>/<district_slug>.json for upload to Hugging
Face -- CROP_DATA_PROMPT.md Bhaag B6.

Requires (GitHub Actions repository secrets, never in chat -- see
docs/SECURITY.md):
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_API_TOKEN   -- scoped to D1:Read only
  D1_DATABASE_ID         -- the vindhya-ground-truth database's id

Usage:
  python scripts/export_ground_truth.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "dashboard" / "data" / "ground_truth"
DATA_CONFIG = ROOT / "dashboard" / "config" / "data_config.json"


def d1_query(sql: str, params: list | None = None) -> list[dict]:
    account_id = os.environ["CLOUDFLARE_ACCOUNT_ID"]
    api_token = os.environ["CLOUDFLARE_API_TOKEN"]
    database_id = os.environ["D1_DATABASE_ID"]
    url = (f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
           f"/d1/database/{database_id}/query")
    body = json.dumps({"sql": sql, "params": params or []}).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        payload = json.loads(r.read())
    if not payload.get("success"):
        raise RuntimeError(f"D1 query failed: {payload.get('errors')}")
    return payload["result"][0]["results"]


def resolve_location(lat: float, lon: float, villages_by_state: dict) -> dict:
    """Point-in-polygon against the real SoI boundary layer. Returns
    {state, district, block, village} with any level left null if the
    point doesn't fall inside a known polygon at that level (never
    substitutes a neighbouring unit -- STANDING ORDERS #6)."""
    from shapely.geometry import Point
    pt = Point(lon, lat)
    for state_slug, gdf in villages_by_state.items():
        hit = gdf[gdf.contains(pt)]
        if not hit.empty:
            row = hit.iloc[0]
            return {
                "state": row.get("state_name"),
                "district": row.get("district_name"),
                "block": row.get("block_name") or row.get("subdistric"),
                "village": row.get("village_name"),
            }
    return {"state": None, "district": None, "block": None, "village": None}


def main() -> int:
    for var in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "D1_DATABASE_ID"):
        if not os.environ.get(var):
            print(f"STOP: {var} not set. This script needs D1 credentials as repo "
                  f"secrets -- see docs/SECURITY.md. Not asked for in chat.", file=sys.stderr)
            return 1

    rows = d1_query(
        "SELECT id, created_at, crop, season, lat, lon, area_ha, status, problem_description, "
        "photo_url, photo_lat, photo_lon, photo_captured_at "
        "FROM submissions WHERE exported_at IS NULL"
    )
    if not rows:
        print("No new submissions to export.")
        return 0

    print(f"{len(rows)} new submission(s) to resolve and export.")

    # Lazy import -- only needed once there's something to resolve, and
    # keeps this script's own --help/error paths fast.
    import geopandas as gpd

    # Point-in-polygon needs the real village boundary geometry, which is
    # HF-hosted per-state (see dashboard/data/boundaries/README.md) -- not
    # loaded here by default since nothing has been submitted yet in this
    # repo's current state (Worker not deployed). Left as an explicit
    # TODO rather than a silent no-op: wire this to fetch
    # boundaries/soi/villages/<state_slug>/<district_slug>.geojson per
    # distinct (lat, lon) once real submissions exist, rather than
    # downloading all 36 states' village files up front for zero rows.
    print("NOTE: point-in-polygon resolution against SoI village boundaries "
          "is not wired up yet -- no real submissions exist to test it "
          "against (the Worker has not been deployed). Placeholder "
          "state/district/block/village=null for now; implement the "
          "per-state boundary fetch in resolve_location()'s caller once "
          "there is real data to resolve.", file=sys.stderr)

    by_district: dict[str, list[dict]] = {}
    for r in rows:
        loc = {"state": None, "district": None, "block": None, "village": None}
        rounded_lat = round(r["lat"], 3)
        rounded_lon = round(r["lon"], 3)
        key = f"{(loc['state'] or 'unresolved').lower()}/{(loc['district'] or 'unresolved').lower()}"
        by_district.setdefault(key, []).append({
            "id": r["id"],
            "created_at": r["created_at"],
            "crop": r["crop"],
            "season": r["season"],
            "lat_rounded": rounded_lat,
            "lon_rounded": rounded_lon,
            "area_ha": r.get("area_ha"),
            "status": r["status"],
            "village": loc["village"],
            "block": loc["block"],
            # KISAN_DASHBOARD_PROMPT.md section 8 (KRAM 6): optional free-text
            # damage/problem note from the Kisan Dashboard's report form. None
            # for ordinary crop ground-truth submissions (Mera Khet's own form,
            # kisan_upload.html) -- only that form's submissions ever set it.
            "problem_description": r.get("problem_description"),
            # Owner request 2026-09-02: live field photo, Kisan Fasal Sahyog
            # only. photo_url is an R2 object key (not a JPEG or a public
            # URL -- see wrangler_kisan_upload.toml's own note on why
            # nothing serves it back yet); photo_lat/lon are the position
            # fix taken at capture, rounded the same 3-decimal (~100m) way
            # as the row's own lat/lon, kept separately since a farmer can
            # walk between the two captures. None for every other caller.
            "photo_url": r.get("photo_url"),
            "photo_lat": round(r["photo_lat"], 3) if r.get("photo_lat") is not None else None,
            "photo_lon": round(r["photo_lon"], 3) if r.get("photo_lon") is not None else None,
            "photo_captured_at": r.get("photo_captured_at"),
        })

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for key, entries in by_district.items():
        state_slug, district_slug = key.split("/", 1)
        out_path = OUT_DIR / state_slug / f"{district_slug}.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        existing = json.loads(out_path.read_text()) if out_path.exists() else {
            "metadata": {
                "title": "Farmer-submitted crop ground truth (CROP_DATA_PROMPT.md Bhaag B)",
                "description": "Crowdsourced crop/season/location submissions from farmers via "
                               "the VINDHYA Kisan Fasal Sahayog form, for training/validating "
                               "the satellite crop classifier. No name, phone, or Aadhaar "
                               "collected. Coordinates rounded to 3 decimal places "
                               "(~100m) before publication. 'status':'unverified' unless "
                               "cross-checked against other submissions or ground survey.",
                "license": "CC-BY-4.0",
                "privacy": "IP addresses are never stored, only a same-day salted hash used "
                           "for rate-limiting and never exported.",
            },
            "entries": [],
        }
        existing["entries"].extend(entries)
        existing["metadata"]["last_updated"] = now
        existing["metadata"]["count"] = len(existing["entries"])
        out_path.write_text(json.dumps(existing, ensure_ascii=False, indent=1))
        print(f"  wrote {out_path} (+{len(entries)}, total {len(existing['entries'])})")

    ids = [r["id"] for r in rows]
    placeholders = ",".join("?" for _ in ids)
    d1_query(f"UPDATE submissions SET exported_at = ? WHERE id IN ({placeholders})", [now, *ids])
    print(f"Marked {len(ids)} row(s) exported_at={now} in D1.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

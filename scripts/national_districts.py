"""
national_districts.py -- the one real, shared (state, district) list for
every script that needs to iterate India's districts (mandi prices, crop
stats, and anything added later). Built from the Survey of India district
layer this repo already ships (dashboard/data/boundaries/soi/districts.geojson,
733 districts, produced by build_national_soi_boundaries.py) rather than a
separately typed-in list, so it can never drift from the boundary the rest
of the dashboard uses.

Does not use geopandas -- these are plain-Python data-fetch scripts run on
GitHub Actions' minimal image, and the geometry itself isn't needed here,
only state_name/district_name, which a plain json.load gets just as well.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DISTRICTS_GEOJSON = ROOT / "dashboard" / "data" / "boundaries" / "soi" / "districts.geojson"


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")


def load_state_districts() -> dict[str, list[str]]:
    """{state_name: [district_name, ...]} in the exact spelling/casing the
    Survey of India source uses -- the same strings an external API query
    (AGMARKNET, crop-stats) is filtered on, so a mismatch surfaces as an
    honest per-district fetch failure rather than being silently papered
    over by a second, differently-spelled list."""
    data = json.loads(DISTRICTS_GEOJSON.read_text())
    out: dict[str, list[str]] = {}
    for feat in data["features"]:
        props = feat["properties"]
        state = props["state_name"].strip()
        district = props["district_name"].strip()
        out.setdefault(state, [])
        if district not in out[state]:
            out[state].append(district)
    for state in out:
        out[state].sort()
    return out


def load_district_slugs() -> dict[str, tuple[str, str]]:
    """{slug: (state_name, district_name)} flattened across all states --
    slug collisions (two states sharing a district name, e.g. Aurangabad in
    both Bihar and Maharashtra) are disambiguated with a state-slug suffix."""
    by_state = load_state_districts()
    seen_slugs: dict[str, int] = {}
    out: dict[str, tuple[str, str]] = {}
    for state, districts in sorted(by_state.items()):
        for district in districts:
            base = slugify(district)
            seen_slugs[base] = seen_slugs.get(base, 0) + 1
            slug = base if seen_slugs[base] == 1 else f"{base}_{slugify(state)}"
            out[slug] = (state, district)
    return out


if __name__ == "__main__":
    by_state = load_state_districts()
    total = sum(len(v) for v in by_state.values())
    print(f"{len(by_state)} states, {total} districts")
    for state, districts in sorted(by_state.items()):
        print(f"  {state}: {len(districts)}")

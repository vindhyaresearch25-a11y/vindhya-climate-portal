"""
09_build_village_profiles.py -- national village profile data layer
(STANDING ORDERS #6: "Boundary and SoI village profile (72 columns:
population, households, net area sown, irrigation, water sources, nearest
town) show for the WHOLE country").

The raw Survey of India village-boundary source (already downloaded for
all 36 states/UTs by fetch_soi_villages.py, cached under
outputs/cache/soi_raw/) carries 74 columns per village, not just the
~13 used for the boundary layer (build_national_soi_boundaries.py):
population/household counts, drinking-water source status (tapwater,
covered/uncovered well, handpump, tubewell, spring, river/canal,
tank/pond/lake), drainage, land-use breakdown (forest, barren, pastures,
fallow, net area sown), irrigation source area (canals, wells, tanks,
waterfall), and nearest town + distance. This script extracts that
profile data -- separately from geometry, per STANDING ORDERS #6 ("data
and boundary are separate") -- into its own per-district JSON layer the
dashboard fetches on demand alongside the boundary.

Never fabricates a field: a column that's blank in the source is omitted
from that village's profile entirely, not defaulted to 0 or "unknown".

Output: dashboard/data/village_profiles/<state_slug>/<district_slug>.json

Usage:
  python 09_build_village_profiles.py --states MP,UP,TN,AS
  python 09_build_village_profiles.py            # all 36 states
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import geopandas as gpd

sys.path.insert(0, str(Path(__file__).parent))
from build_national_soi_boundaries import STATE_ADMIN_MAP, slugify  # reuse the one canonical state map

ROOT = Path(__file__).resolve().parent.parent
RAW_VILLAGE_DIR = ROOT / "outputs" / "cache" / "soi_raw"
OUT_DIR = ROOT / "dashboard" / "data" / "village_profiles"

SOURCE_META = {
    "source": "Survey of India village-boundary product (attribute table), via National "
              "Water Data Portal (NWDP), NWIC, Ministry of Jal Shakti",
    "access": "public, no login required",
    "fetch_date": "2026-08-02",
    "quality": "verified-official -- Survey of India source",
    "note": "Fields absent from the source for a given village are omitted from its "
            "profile, never defaulted or estimated.",
}

# raw column (normalized: stripped + lowercased) -> compact output key.
# Only real Survey of India attribute columns; GIS-internal bookkeeping
# columns (id, objectid, objectid_1, shape_leng/length/area, uqcode,
# ds_name) are intentionally excluded -- they aren't village profile data.
FIELD_MAP = {
    "total_households": "households",
    "total_population_village": "population",
    "avg_household": "avg_household_size",
    "total_geographical_area": "geographical_area_ha",
    "total_male_population_village": "population_male",
    "total_female_population_village": "population_female",
    "tapwater_treated_status": "water_tapwater_treated",
    "tapwater_untreated_status": "water_tapwater_untreated",
    "covered_well_status": "water_covered_well",
    "covered_well_function_year": "water_covered_well_year_round",
    "covered_well_functioning_summer": "water_covered_well_summer",
    "uncovered_well_status": "water_uncovered_well",
    "uncovered_well_function_year": "water_uncovered_well_year_round",
    "uncovered_well_function_summer": "water_uncovered_well_summer",
    "handpump_status": "water_handpump",
    "hand_pump_function_year": "water_handpump_year_round",
    "hand_pump_function_summer": "water_handpump_summer",
    "tubewell_borehole_status": "water_tubewell_borehole",
    "tube_wells_borehole_function_year": "water_tubewell_year_round",
    "tube_wells_borehole_function_summer": "water_tubewell_summer",
    "spring_status": "water_spring",
    "spring_functioning_all_round_year": "water_spring_year_round",
    "spring_functioning_summer_month": "water_spring_summer",
    "river_canal_status": "water_river_canal",
    "tank_pond_lake_status": "water_tank_pond_lake",
    "others_status": "water_other_source",
    "closed_drainage_status": "drainage_closed",
    "open_drainage_status": "drainage_open",
    "village_pin_code_status": "has_pin_code",
    "forest_area": "land_forest_ha",
    "area_under_non_agricultural_use": "land_non_agricultural_ha",
    "barren_uncultivable_land": "land_barren_uncultivable_ha",
    "permanent_pastures_grazing": "land_pastures_ha",
    "land_under_miscellaneous": "land_miscellaneous_ha",
    "culturable_waste_land": "land_culturable_waste_ha",
    "fallows_land_other_than_current": "land_fallow_other_ha",
    "current_fallows_area": "land_fallow_current_ha",
    "net_area_sown": "land_net_area_sown_ha",
    "total_unirrigated_land": "land_unirrigated_ha",
    "area_irrigated_by_source": "irrigated_area_total_ha",
    "canals_area": "irrigated_canals_ha",
    "wells_tube_wells_area": "irrigated_wells_tubewells_ha",
    "tanks_lakes_area": "irrigated_tanks_lakes_ha",
    "waterfall_area": "irrigated_waterfall_ha",
    "other_source_specify_area": "irrigated_other_ha",
    "nearest_town_name": "nearest_town",
    "nearest_town_distance_from_village": "nearest_town_distance_km",
}

# Source encodes these as free text ("Available" / "Not Available" / a
# few other spellings seen across states) -- compacted to 1/0 rather than
# repeating that string 654,285 times; still three-valued (1 / 0 / absent
# for "not stated"), never collapsing "not available" and "no data" into
# the same thing.
STATUS_FIELDS = {v for v in FIELD_MAP.values()
                  if v.startswith(("water_", "drainage_", "has_"))}
TEXT_FIELDS = {"village_name", "nearest_town"}
NUMERIC_FIELDS = {v for v in FIELD_MAP.values() if v not in STATUS_FIELDS and v not in TEXT_FIELDS}

# Output rows are positional arrays, not objects -- eliminates repeating
# ~45 JSON key names per village (the actual driver of file size at
# national scale: 654,285 villages x ~45 keys). FIELD_ORDER is written
# once into each file's metadata so the mapping stays self-describing.
FIELD_ORDER = ["village_name"] + [FIELD_MAP[k] for k in FIELD_MAP]


def clean_value(raw_key: str, val):
    if val is None:
        return None
    s = str(val).strip()
    if s == "" or s.lower() in ("nan", "none", "na", "n/a"):
        return None
    out_key = FIELD_MAP[raw_key]
    if out_key in NUMERIC_FIELDS:
        try:
            f = float(s)
            return int(f) if f.is_integer() else round(f, 2)
        except ValueError:
            return None
    if out_key in STATUS_FIELDS:
        low = s.lower()
        if low.startswith(("not available", "no", "nil", "absent")):
            return 0
        if low.startswith(("available", "yes", "present")):
            return 1
        return None  # an unrecognized value is left unstated, not guessed
    return s


def build_state(code: str, states: dict):
    slug, canonical_name = states[code]
    extracted_dir = RAW_VILLAGE_DIR / f"{slug}_extracted"
    if not extracted_dir.exists():
        print(f"  {canonical_name}: no raw cache at {extracted_dir}, skipped")
        return
    raw_files = list(extracted_dir.glob("*.GeoJSON")) + list(extracted_dir.glob("*.geojson"))
    if not raw_files:
        print(f"  {canonical_name}: no GeoJSON found, skipped")
        return

    gdf = gpd.read_file(raw_files[0])
    norm_to_actual = {}
    for c in gdf.columns:
        norm_to_actual.setdefault(c.strip().lower(), c)

    def col(name):
        return norm_to_actual.get(name)

    c_village = col("village")
    c_vlcode = col("vlcode")
    c_district = col("district")
    if not (c_village and c_vlcode and c_district):
        print(f"  {canonical_name}: missing village/vlcode/district column, skipped")
        return

    present_raw_cols = [k for k in FIELD_MAP if col(k)]
    missing_raw_cols = [k for k in FIELD_MAP if not col(k)]
    if missing_raw_cols:
        print(f"  {canonical_name}: {len(missing_raw_cols)}/{len(FIELD_MAP)} profile "
              f"columns not present in source, skipped for this state: {missing_raw_cols[:5]}...")

    n_districts = gdf[c_district].astype(str).str.strip()
    out_dir = OUT_DIR / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    total_villages = 0

    # position of each output field within a village's row array
    field_pos = {name: i for i, name in enumerate(FIELD_ORDER)}

    for district_name in sorted(n_districts.unique()):
        sub = gdf[n_districts == district_name]
        profiles = {}
        for _, row in sub.iterrows():
            vlcode_raw = row[c_vlcode]
            try:
                vlcode = str(int(float(str(vlcode_raw).strip())))
            except (TypeError, ValueError):
                continue
            arr = [None] * len(FIELD_ORDER)
            arr[field_pos["village_name"]] = str(row[c_village]).strip()
            for raw_key in present_raw_cols:
                actual_col = col(raw_key)
                v = clean_value(raw_key, row[actual_col])
                if v is not None:
                    arr[field_pos[FIELD_MAP[raw_key]]] = v
            while arr and arr[-1] is None:  # trailing nulls cost bytes for nothing
                arr.pop()
            profiles[vlcode] = arr

        dslug = slugify(district_name)
        payload = {
            "metadata": {
                **SOURCE_META,
                "field_order": FIELD_ORDER,
                "state": canonical_name,
                "district": district_name,
                "village_count": len(profiles),
            },
            "villages": profiles,
        }
        out_path = out_dir / f"{dslug}.json"
        out_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        total_villages += len(profiles)

    size_mb = sum(f.stat().st_size for f in out_dir.glob("*.json")) / 1024 / 1024
    print(f"  {canonical_name}: {len(n_districts.unique())} districts, {total_villages} village profiles, {size_mb:.1f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", help="comma-separated 2-letter state codes (default: all 36)")
    args = ap.parse_args()
    targets = [s.strip().upper() for s in args.states.split(",")] if args.states else list(STATE_ADMIN_MAP.keys())

    print(f"=== VILLAGE PROFILES ({len(targets)} states) ===")
    for code in targets:
        if code not in STATE_ADMIN_MAP:
            print(f"  skip unknown code {code}")
            continue
        build_state(code, STATE_ADMIN_MAP)


if __name__ == "__main__":
    main()

"""
district_name_map.py -- the confirmed 1:1 district rename pairs from
docs/DISTRICT_NAME_MAP.md (CROP_DATA_PROMPT.md CHARAN 7), as a Python
dict, for any script that needs to translate DES's (sometimes historical)
district name to the current Survey of India name the dashboard's
dropdowns actually use.

Keep this in sync with docs/DISTRICT_NAME_MAP.md's "Confirmed 1:1
renames" table by hand -- it is the source of truth; this module is a
derived, machine-usable copy of only the entries in that table (not the
"needs further verification" categories, which stay unresolved on
purpose rather than guessed at).
"""
from __future__ import annotations

# {old_name_lower: current_soi_name} -- lookup is case-insensitive since
# DES and SoI don't always agree on capitalization either.
_RENAMES = {
    "hoshangabad": "Narmadapuram",
    "khandwa": "East Nimar",
    "ahmednagar": "Ahilyanagar",
    "aurangabad": "Chhatrapati Sambhajinagar",  # Maharashtra's Aurangabad; the
                                                  # Bihar district of the same
                                                  # name is untouched by this
                                                  # global rename -- see caveat below
    "osmanabad": "Dharashiv",
    "allahabad": "Prayagraj",
    "faizabad": "Ayodhya",
    "sant ravidas nagar": "Bhadohi",
    "tuticorin": "Thoothukudi",
    "thenkasi": "Tenkasi",
    "gurgaon": "Gurugram",
    "mewat": "Nuh",
    "arvalli": "Aravalli",
    "firozepur": "Ferozepur",
    "muktsar": "Sri Muktsar Sahib",
    "nawanshahr": "Shahid Bhagat Singh Nagar",
    "geyzing": "Gyalshing",
    "bagalkot": "Bagalkote",
    "bellary": "Ballari",
    "belgaum": "Belagavi",
    "bangalore rural": "Bengaluru Rural",
    "chamarajanagar": "Chamarajanagara",
    "chikballapur": "Chikkaballapura",
    "chikmagalur": "Chikkamagaluru",
    "dakshin kannad": "Dakshina Kannada",
    "gulbarga": "Kalaburagi",
    "mysore": "Mysuru",
    "shimoga": "Shivamogga",
    "tumkur": "Tumakuru",
    "uttar kannad": "Uttara Kannada",
    "bijapur": "Vijayapura",
}

# CAVEAT: "aurangabad" also names a real district in Bihar, unrelated to
# Maharashtra's Aurangabad->Chhatrapati Sambhajinagar rename -- applying
# this map by (name) alone without checking state would wrongly rename
# Bihar's Aurangabad too. Every caller in this repo currently applies the
# map per-(state, district) pair, not by district name alone; do the same
# in any new caller.
STATES_WHERE_AURANGABAD_RENAME_APPLIES = {"maharashtra"}


def apply_rename(state_name: str, district_name: str) -> str:
    """Returns district_name unchanged unless it's a confirmed DES-old-name
    with a current SoI equivalent for this state; never guesses."""
    key = district_name.strip().lower()
    if key == "aurangabad" and state_name.strip().lower() not in STATES_WHERE_AURANGABAD_RENAME_APPLIES:
        return district_name
    return _RENAMES.get(key, district_name)

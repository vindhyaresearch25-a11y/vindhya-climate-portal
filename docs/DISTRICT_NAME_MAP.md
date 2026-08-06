# District name reconciliation — DES crop data vs Survey of India boundaries

CROP_DATA_PROMPT.md CHARAN 7. Cross-referenced every state's district list
from `dashboard/data/crop_stats_des/*.json` (DES, 2000-01 to 2022-23,
2026-08-07) against `dashboard/data/boundaries/soi/districts_index.json`
(Survey of India via NWDP, the boundary layer this portal renders). 63
DES-side and 75 SoI-side district labels didn't match by normalized name.
Categorized below — **confirmed 1:1 renames vs categories needing further
verification are kept explicitly separate; nothing here is guessed and
presented as fact.**

## Confirmed 1:1 renames (high confidence, well-documented official renames)

Same district, same boundary, official name changed at a known date. Safe
to join DES data to the SoI boundary using these pairs.

| SoI (current) name | DES (historical) name | State | Notes |
|---|---|---|---|
| Narmadapuram | Hoshangabad | Madhya Pradesh | Renamed 2021 |
| East Nimar | Khandwa | Madhya Pradesh | Khandwa town is the HQ of East Nimar district -- same unit, dual naming |
| Ahilyanagar | Ahmednagar | Maharashtra | Renamed 2023 |
| Chhatrapati Sambhajinagar | Aurangabad | Maharashtra | Renamed 2023 |
| Dharashiv | Osmanabad | Maharashtra | Renamed 2023 |
| Prayagraj | Allahabad | Uttar Pradesh | Renamed 2018 |
| Ayodhya | Faizabad | Uttar Pradesh | Renamed 2018 |
| Bhadohi | Sant Ravidas Nagar | Uttar Pradesh | Renamed 2011 |
| Thoothukudi | Tuticorin | Tamil Nadu | Renamed 2020 (English spelling of Tamil name) |
| Tenkasi | Thenkasi | Tamil Nadu | Spelling variant, same district (created 2019 from Tirunelveli) |
| Gurugram | Gurgaon | Haryana | Renamed 2016 |
| Nuh | Mewat | Haryana | Renamed 2016 |
| Aravalli | Arvalli | Gujarat | Spelling variant |
| Ferozepur | Firozepur | Punjab | Spelling variant |
| Sri Muktsar Sahib | Muktsar | Punjab | Renamed 2016 |
| Shahid Bhagat Singh Nagar | Nawanshahr | Punjab | Renamed 2008 |
| Gyalshing | Geyzing | Sikkim | Renamed 2018 |
| Bagalkote | Bagalkot | Karnataka | Spelling variant |
| Ballari | Bellary | Karnataka | Renamed 2014 (official Kannada spelling) |
| Belagavi | Belgaum | Karnataka | Renamed 2014 |
| Bengaluru Rural | Bangalore rural | Karnataka | Renamed 2014 |
| Chamarajanagara | Chamarajanagar | Karnataka | Spelling variant |
| Chikkaballapura | Chikballapur | Karnataka | Spelling variant |
| Chikkamagaluru | Chikmagalur | Karnataka | Renamed 2014 |
| Dakshina Kannada | Dakshin kannad | Karnataka | Spelling variant |
| Kalaburagi | Gulbarga | Karnataka | Renamed 2014 |
| Mysuru | Mysore | Karnataka | Renamed 2014 |
| Shivamogga | Shimoga | Karnataka | Renamed 2014 |
| Tumakuru | Tumkur | Karnataka | Renamed 2014 |
| Uttara Kannada | Uttar kannad | Karnataka | Spelling variant |
| Vijayapura | Bijapur | Karnataka | Renamed 2014 |

## State-name-level renames (affects the whole state's join, see script)

| SoI label | DES label | Note |
|---|---|---|
| Andaman & Nicobar Island | Andaman and Nicobar Islands | punctuation/pluralization only |
| Arunanchal Pradesh | Arunachal Pradesh | **SoI's own spelling is the non-standard one** ("Arunanchal" is a common misspelling of "Arunachal") -- flagging so this doesn't get silently "fixed" backwards |
| Jammu & Kashmir | Jammu and Kashmir | punctuation only |
| Dadra & Nagar Havelli and Daman & Diu / Dadra and Nagar Haveli / Daman and Diu | The Dadra & Nagar Haveli and Daman and Diu | The two UTs merged Jan 2020 -- DES correctly reports them as 2 separate UTs for years before 2020 and 1 merged UT after. **Do not collapse pre-2020 DES rows into the merged UT** -- that would misattribute Daman and Diu's numbers to a unit that didn't exist yet. |

## Needs further verification (NOT guessed here -- category-level only)

These look like genuine **old district(s) → multiple new districts**
splits (CHARAN 7: "Purana zila tootkar do bana ho to ye LIKHO, aankda
baant mat do" -- write this down, don't divide the data), not simple
renames. Confirming the exact old→new mapping for each requires per-state
gazette notifications this pass didn't check -- listed here as a known
gap rather than guessed:

- **Andhra Pradesh** (2022 reorganization, 13→26 districts): DES's older
  years use pre-2022 names (e.g. "Y.S.R."); SoI has the current 26,
  including new ones like Alluri Sitharama Raju, Anakapalli, Annamayya,
  Bapatla, Eluru, Kakinada, Konaseema, Nandyal, NTR, Palnadu,
  Parvathipuram Manyam, Sri Sathya Sai, Tirupati.
- **Telangana** (2016 reorganization, 10→33 districts): DES-side names
  (Bhadradri, Jayashankar, Jogulamba, Komaram Bheem Asifabad, Mahbubnagar,
  Medchal, Narayanapet, Rajanna, Rangareddi, Warangal Urban, Yadadri) vs
  SoI's fuller current names suggest a mix of spelling variants and
  genuine pre/post-2016 district splits -- not disentangled here.
- **Chhattisgarh** (2022, 5 new districts): Khairagarh-Chhuikhadan-Gandai,
  Manendragarh-Chirmiri-Bharatpur, Mohla-Manpur-Ambagarh Chowki, Sakti,
  Sarangarh-Bilaigarh -- present in DES-side labels but not matched to
  the SoI snapshot; likely just not yet in this repo's SoI boundary
  snapshot rather than a DES gap.
- **Manipur** (7 SoI districts not in DES: Jiribam, Kakching, Kamjong,
  Kangpokpi, Noney, Pherzawl, Tengnoupal), **Mizoram** (3 DES districts
  not in SoI: Hnahthial, Khawzawl, Saitual), **Nagaland** (5 DES
  districts not in SoI: Chumoukedima, Noklak, Nuiland, Shamator,
  Tseminyu) -- all three states created new districts across
  2015-2022; which source's snapshot is more current wasn't checked.
- **Sikkim**: SoI has "Pakyong" and "Soreng" as DES-side-only entries
  alongside Geyzing/Gyalshing -- Pakyong and Soreng are newer districts
  (2021-22, split from East/West Sikkim); not reconciled to a precise
  parent-district mapping here.

## Structural differences (not a naming problem)

- **Delhi**: SoI has 11 named sub-districts (Central, East, New Delhi,
  North, North East, North West, Shahdara, South, South East, South
  West, West). DES reports Delhi as a single `Delhi_Total` row -- it does
  not publish district-level crop APY for Delhi. Any join must treat
  Delhi as state-level-only data, not distributed across the 11
  sub-districts.
- **Kolkata** (West Bengal) and **Mumbai** (Maharashtra) appear in SoI's
  boundary layer but have no matching DES crop-statistics rows in any of
  the 23 years. Both are the primary metro districts of their states,
  consistent with DES simply not reporting agricultural statistics for a
  district with negligible cultivated area -- not investigated further,
  but plausible rather than an extraction bug (0 negative/garbage values
  found anywhere else in the DES pull).

## Method

```
python3 -c "
import json, re, glob
# des_districts: {state: {district}} from dashboard/data/crop_stats_des/*.json,
# normalized state/district names with the leading 'N. ' DES index stripped.
# soi_by_state: {state: {district}} from
# dashboard/data/boundaries/soi/districts_index.json.
# norm() strips everything but lowercase letters before comparing.
"
```
Full script used for this pass is not checked in (one-off analysis, run
interactively) -- rerun by loading both sources the same way
`scripts/fetch_des_apy.py` and `scripts/build_districts_index.py` already
do and diffing normalized district-name sets per state.

## Not done this pass

Building `scripts/build_districts_index.py`-style automated crosswalk
application (i.e. actually rewriting DES records to use SoI's current
district names before any dashboard join) -- this document is the
research/reconciliation record CHARAN 7 asked for; wiring it into a join
script is separate follow-up work.

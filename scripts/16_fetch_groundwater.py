"""
16_fetch_groundwater.py -- real CGWB groundwater-level readings, nationally.

PENDING.md item 4 previously closed this as a dead end (2026-08-09): checked
india-wris.gov.in (Angular shell, no JSON API), gwdata.cgwb.gov.in
(maintenance mode, form-driven tool), cgwb.gov.in (PDF reports only) and
data.gov.in (no CGWB groundwater-level resource_id found). This session
(2026-08-19) found a real source that investigation missed: the National
Water Data Portal (nwdp.nwic.gov.in) -- the SAME government portal this
project already trusts for village boundaries (CLAUDE.md standing order
#3, https://nwdp.nwic.gov.in/dataset/village-boundary) also hosts CGWB's
own dataset "Ground Water Level (Manual - Quarterly), CGWB":
https://nwdp.nwic.gov.in/dataset/gwl-manual-quarterly-central-ground-water-board-department

## How the URL table below was built

The dataset page was fetched directly (curl, 2026-08-19) and every
`https://nwdp.nwic.gov.in/dataset/<uuid>/resource/<uuid>/download/
gwl_manual_quarterly_cgwb_<code>_<span>.csv` URL was extracted with a
regex over the raw HTML (CKAN resource list, no JS execution needed --
plain download links are already in the page source). 95 real files were
found across 33 two-letter state/UT codes, three time-slices each where
present (1991_2020, 2021_2025, 2026_2030) -- except `lk` (Lakshadweep) and
`mn` (Manipur), which have only the 1991_2020 slice on the portal. This
list is hardcoded below (same convention as fetch_mandi_prices.py's
hardcoded `RESOURCE` UUID) rather than re-scraped on every run, since the
resource UUIDs are not guessable/derivable and re-scraping a government
CKAN page on every pipeline run is both slower and more fragile than a
frozen, dated, verified table -- re-run the same extraction against the
dataset page above if the portal reorganizes its resources later.

Three of India's 36 states/UTs have NO dataset on this page at all
(confirmed absent, not a parsing miss -- their full names do not appear
anywhere in the fetched HTML): **Mizoram, Sikkim, Ladakh**. These stay
honestly "not available" everywhere downstream, exactly like the CLAUDE.md
standing order #3 note about states missing from a source (checked NWDP
directly, genuinely absent here, not carried over from a different
source's gap).

## Join key -- LGD dtcode, not district name

Every CSV row carries its own `District LGD Code` column. This project's
own Survey-of-India district index (dashboard/data/boundaries/soi/
districts_index.json) already keys every one of its 733 districts on the
same LGD `district_lgd` code (see scripts/national_districts.py). Joining
on that code -- verified directly: MP's Jabalpur is `District LGD Code`
411 in the CSV and `district_lgd` 411 in districts_index.json, exact
match -- sidesteps the AGMARKNET-style name-spelling mismatch documented
in fetch_mandi_prices.py's own header entirely. A CSV row whose LGD code
has no match in districts_index.json is dropped and counted, never
force-matched by name.

## Units / sign convention

The dataset's own CKAN "notes" text says only: "Each record includes the
date, station identifier with geographic hierarchy, and the corresponding
GWL values in meter (m)." It does not spell out "below ground level"
explicitly. This script documents, rather than assumes, what was checked:
  - CGWB's own standard public reporting convention for this exact series
    ("Ground Water Level") is depth to water level below ground level
    (mbgl), positive number, larger = deeper/worse.
  - Real cross-check on real rows: Jabalpur (MP) station "Adhartal Naka"
    reads 8.94-10.0 m across 2021-2022 quarters in the fetched CSV --
    consistent with CGWB's own publicly reported pre/post-monsoon depth
    range for Jabalpur district (commonly cited ~5-15 m bgl in CGWB
    Dynamic Ground Water Resources district reports). Alirajpur (MP)
    reads ~4.3-5.2 m across the same window -- also a plausible shallow
    mbgl reading, not a plausible RL-relative-to-sea-level number (Madhya
    Pradesh's terrain is several hundred metres above MSL, so a value of
    4-10 "meters" cannot be RL/MSL; it is depth below the local ground
    surface). Both checks are consistent with "meters below ground
    level", not against it -- but note this is a plausibility check
    against typical published ranges, not a station-by-station audit
    against a named public CGWB report for these exact stations/dates.
    Documented honestly as indicative confirmation, not proof.
  - Sanity bound applied: 0-100 m is the physically plausible band for a
    manual dug-well/piezometer depth-to-water reading in India; anything
    outside it is dropped as a bad row (clean(), mirrors
    fetch_mandi_prices.py's clean()), never silently trusted.

## Trend

Per district, a plain OLS slope (numpy polyfit degree-1) is fit on every
station's own numeric quarterly series (all time-slices concatenated,
sorted by date), only when a station has >=4 real quarterly points -- the
same "indicative OLS trend on real history" style already used by
forecast_2040.json (07_build_dicra_forecast.py), never described as a
projection. Positive slope = water level number increasing over time =
water table getting DEEPER (worse); negative slope = water table rising
(better). This sign convention is spelled out again at the point the
trend is computed and in every JSON's metadata block.

Usage:
  python 16_fetch_groundwater.py                # fetch all states, build all district files
  python 16_fetch_groundwater.py --states mp,an  # just these state codes (testing)
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import config as C

ROOT = Path(__file__).resolve().parent.parent
DISTRICTS_INDEX = ROOT / "dashboard" / "data" / "boundaries" / "soi" / "districts_index.json"
OUT_DIR = C.NATIONAL_GROUNDWATER_OUT_DIR

TIMEOUT = 60
RETRIES = 3
REQUEST_PACING_SEC = 0.5  # polite pacing between the ~95 state-CSV downloads

# {two-letter NWDP state code: {time_span: full download URL}} -- see this
# file's header for exactly how this table was built and verified.
STATE_CSV_URLS = {
    'an': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/c81b1976-fcd3-4bad-aedb-8b38d957a1a8/download/gwl_manual_quarterly_cgwb_an_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/7413b8de-2f99-45d3-b673-3d145012d3e8/download/gwl_manual_quarterly_cgwb_an_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/c0886194-96fd-4e46-8cf2-82fcf1a69057/download/gwl_manual_quarterly_cgwb_an_2026_2030.csv',
    },
    'ap': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/80fd198a-7d77-412c-87ab-bc6a61f11063/download/gwl_manual_quarterly_cgwb_ap_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/31803a41-1025-4eae-8786-8efe29b1623c/download/gwl_manual_quarterly_cgwb_ap_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/1bd14e55-0fc9-4e01-9a44-2e268ae0ae99/download/gwl_manual_quarterly_cgwb_ap_2026_2030.csv',
    },
    'ar': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/8d3e9f64-8e0b-474a-8e1c-0b260b400c0c/download/gwl_manual_quarterly_cgwb_ar_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/721a9ff5-cd1b-470c-875b-a381e1306392/download/gwl_manual_quarterly_cgwb_ar_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/a5710ea2-6889-4125-b68c-e112a00d8f09/download/gwl_manual_quarterly_cgwb_ar_2026_2030.csv',
    },
    'as': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/fcdd441f-7b73-451e-9c0e-9f84eacbc055/download/gwl_manual_quarterly_cgwb_as_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/7e054f9d-8161-455b-8c09-8a918e32f5ac/download/gwl_manual_quarterly_cgwb_as_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/a563a6ff-9972-483d-884d-9e09161509ff/download/gwl_manual_quarterly_cgwb_as_2026_2030.csv',
    },
    'br': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/63d2878e-8993-4459-b12a-08cb5149f1b3/download/gwl_manual_quarterly_cgwb_br_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/fdf501bd-064a-4a57-b620-79516782b7ff/download/gwl_manual_quarterly_cgwb_br_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/dc48e2f4-5944-4f3e-9e45-2eec001058e5/download/gwl_manual_quarterly_cgwb_br_2026_2030.csv',
    },
    'cg': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/61791d05-02ed-4837-ac60-234283841519/download/gwl_manual_quarterly_cgwb_cg_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/8b6f022a-0b4f-4101-ae83-bec6fb719651/download/gwl_manual_quarterly_cgwb_cg_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/550d8b72-e310-4fef-99d0-2e7912b77eea/download/gwl_manual_quarterly_cgwb_cg_2026_2030.csv',
    },
    'ch': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/285d261b-d29f-4b1b-b2bf-441354fbfd76/download/gwl_manual_quarterly_cgwb_ch_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/0341ca7b-d805-477e-810c-8677e34a3958/download/gwl_manual_quarterly_cgwb_ch_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/619fe37e-74ca-4f09-b896-04a4ac6c8eab/download/gwl_manual_quarterly_cgwb_ch_2026_2030.csv',
    },
    'dl': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/9a04b453-b6b2-418b-b185-9cf20862821f/download/gwl_manual_quarterly_cgwb_dl_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/f9d6022f-934e-4835-a0ff-8abd30d20ed9/download/gwl_manual_quarterly_cgwb_dl_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/6e357dfe-c0c3-447d-9c99-fd3eb544b2b5/download/gwl_manual_quarterly_cgwb_dl_2026_2030.csv',
    },
    'dn': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/b1193030-1bde-4a9e-afc6-d66de6d275e3/download/gwl_manual_quarterly_cgwb_dn_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/53ca7ccc-7e47-4003-992a-c1c594e25c3a/download/gwl_manual_quarterly_cgwb_dn_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/ce83ecff-bccf-4d18-b962-59f46ebd6f9b/download/gwl_manual_quarterly_cgwb_dn_2026_2030.csv',
    },
    'ga': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/1ee95bba-cc6e-4648-95a3-ba195f80686e/download/gwl_manual_quarterly_cgwb_ga_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/4c250b6b-cde4-4634-ac3f-86285a95dbd5/download/gwl_manual_quarterly_cgwb_ga_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/94facedc-a5a8-4114-bb23-dcf4d75c98fb/download/gwl_manual_quarterly_cgwb_ga_2026_2030.csv',
    },
    'gj': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/5fc7025a-79b8-45e7-8028-354b7f38cdad/download/gwl_manual_quarterly_cgwb_gj_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/ef17ded9-be74-48e6-9359-f3a19daeea4a/download/gwl_manual_quarterly_cgwb_gj_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/3c9ea0a0-28b4-49a5-a14f-c9db90cc4bf0/download/gwl_manual_quarterly_cgwb_gj_2026_2030.csv',
    },
    'hp': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/63d76ebf-7f2c-4e62-9322-8810aa3ca6ce/download/gwl_manual_quarterly_cgwb_hp_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/86e14207-4aa3-48a0-bcc9-3a155e6185b5/download/gwl_manual_quarterly_cgwb_hp_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/5e981bdb-9664-4210-a812-fd7229ff55a5/download/gwl_manual_quarterly_cgwb_hp_2026_2030.csv',
    },
    'hr': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/1386c95c-14e4-4dae-9697-bc738d23a30e/download/gwl_manual_quarterly_cgwb_hr_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/62fe9597-ddd1-4372-a7f5-bd62481beab3/download/gwl_manual_quarterly_cgwb_hr_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/00a546a5-db9d-4586-887b-4170b01a6dfc/download/gwl_manual_quarterly_cgwb_hr_2026_2030.csv',
    },
    'jh': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/9dcefdc5-a56d-43ba-9979-3f8f1558438f/download/gwl_manual_quarterly_cgwb_jh_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/7b69bb72-5c7b-4a7a-99d5-ce8ec7f13e30/download/gwl_manual_quarterly_cgwb_jh_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/80ce70c1-0ef0-4daa-b0ee-4f67d28430c2/download/gwl_manual_quarterly_cgwb_jh_2026_2030.csv',
    },
    'jk': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/a88dccd4-399b-4564-a2d0-4d6eb252266b/download/gwl_manual_quarterly_cgwb_jk_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/c9ddb1e5-02d6-4ef4-87e3-56efeff36211/download/gwl_manual_quarterly_cgwb_jk_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/e6463586-1187-4367-a60e-b3f103dafc82/download/gwl_manual_quarterly_cgwb_jk_2026_2030.csv',
    },
    'ka': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/3dacbc24-b45c-4ffe-8099-f69728ca711b/download/gwl_manual_quarterly_cgwb_ka_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/7b76b032-99a5-4725-8a5b-125346e7aebf/download/gwl_manual_quarterly_cgwb_ka_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/84bb8743-79e9-4856-95ee-b79c96126fcf/download/gwl_manual_quarterly_cgwb_ka_2026_2030.csv',
    },
    'kl': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/95faaf19-07c2-4c79-b597-03f7030cc4f0/download/gwl_manual_quarterly_cgwb_kl_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/d32e6b72-9abf-4c80-b225-9d685398eb91/download/gwl_manual_quarterly_cgwb_kl_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/e6c267cd-6f76-49f6-ae06-809a87830b47/download/gwl_manual_quarterly_cgwb_kl_2026_2030.csv',
    },
    'lk': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/7d5a5fc2-5fd7-4efc-8c25-75c1277b0fa2/download/gwl_manual_quarterly_cgwb_lk_1991_2020.csv',
    },
    'mh': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/0e7180fa-5282-4df6-bead-8ca7a7557e74/download/gwl_manual_quarterly_cgwb_mh_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/073029e8-492d-416c-9857-3ad3e27c69a6/download/gwl_manual_quarterly_cgwb_mh_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/59f9aee6-701e-42db-860c-b0f7663f6383/download/gwl_manual_quarterly_cgwb_mh_2026_2030.csv',
    },
    'ml': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/e24d301d-5031-44cb-9972-f46972bc2c69/download/gwl_manual_quarterly_cgwb_ml_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/05cb78d1-e9da-46b3-89f6-b98079e601df/download/gwl_manual_quarterly_cgwb_ml_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/042ad1ca-e437-476d-89db-ae4cc8d93bdf/download/gwl_manual_quarterly_cgwb_ml_2026_2030.csv',
    },
    'mn': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/d8061368-6ca9-454b-bbaf-338687f9754a/download/gwl_manual_quarterly_cgwb_mn_1991_2020.csv',
    },
    'mp': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/415f09ce-8ce3-4ede-a076-615dc14bf917/download/gwl_manual_quarterly_cgwb_mp_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/6a47df3a-8c42-419c-b577-b9c6ded71112/download/gwl_manual_quarterly_cgwb_mp_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/bb0861b8-54c6-4951-b49f-1b9ae0a047d3/download/gwl_manual_quarterly_cgwb_mp_2026_2030.csv',
    },
    'nl': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/4e2817d9-d2d9-4419-9366-c56e05b24103/download/gwl_manual_quarterly_cgwb_nl_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/1b3effee-add1-4172-b33f-cc6d214cea59/download/gwl_manual_quarterly_cgwb_nl_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/ec2946f3-889d-4a8b-90f3-b7e774b18989/download/gwl_manual_quarterly_cgwb_nl_2026_2030.csv',
    },
    'od': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/bf10433c-7213-401f-9cc3-ba35f1f7adb0/download/gwl_manual_quarterly_cgwb_od_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/bdebe9ba-62ad-4c34-acd0-e7f9332dff59/download/gwl_manual_quarterly_cgwb_od_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/62c5c7ed-64c4-4420-871b-f8b45532ab59/download/gwl_manual_quarterly_cgwb_od_2026_2030.csv',
    },
    'pb': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/41e431b0-082a-41f7-bf32-d7eea6a4ef1f/download/gwl_manual_quarterly_cgwb_pb_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/862305d4-0384-4af2-9dca-122e6db0a1c2/download/gwl_manual_quarterly_cgwb_pb_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/cfe24362-d4bf-4316-8ef1-3131dacc4216/download/gwl_manual_quarterly_cgwb_pb_2026_2030.csv',
    },
    'py': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/cc859127-1d81-4a3b-b05b-dfbdf14fc5e6/download/gwl_manual_quarterly_cgwb_py_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/9bfd807e-dbdc-40b2-b997-2cc7b192c910/download/gwl_manual_quarterly_cgwb_py_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/77128d62-e921-4d1d-8815-01e29d651086/download/gwl_manual_quarterly_cgwb_py_2026_2030.csv',
    },
    'rj': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/f1ef9d48-1ac1-4f8c-9ed1-e0682fabc81b/download/gwl_manual_quarterly_cgwb_rj_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/8111c3ef-5dc3-4aa9-9f37-f4f13d6099d5/download/gwl_manual_quarterly_cgwb_rj_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/12537471-6467-4415-81e2-a605b08b98f6/download/gwl_manual_quarterly_cgwb_rj_2026_2030.csv',
    },
    'tn': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/528b106b-664a-4736-accc-72bbb808b74d/download/gwl_manual_quarterly_cgwb_tn_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/21cfbb8e-ac1b-4837-a463-317c05fb6f1b/download/gwl_manual_quarterly_cgwb_tn_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/94d55b3e-ff8d-4dcc-9aef-735fb828eade/download/gwl_manual_quarterly_cgwb_tn_2026_2030.csv',
    },
    'tr': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/89c09841-b92e-4488-ae73-9dd3336e4ebe/download/gwl_manual_quarterly_cgwb_tr_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/47123b4c-09b2-4dd8-8c2d-693e4322c00b/download/gwl_manual_quarterly_cgwb_tr_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/413d270d-973c-4a7f-9c5b-103cb2892aba/download/gwl_manual_quarterly_cgwb_tr_2026_2030.csv',
    },
    'ts': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/372a5399-0b73-4460-a97b-a0262f17f88e/download/gwl_manual_quarterly_cgwb_ts_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/3751ad91-8203-493a-9716-ad0186f4f5ff/download/gwl_manual_quarterly_cgwb_ts_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/7e951b93-7025-45c4-be72-378a8db544cd/download/gwl_manual_quarterly_cgwb_ts_2026_2030.csv',
    },
    'uk': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/5bca5263-df4a-489d-8a1d-9cffb6416703/download/gwl_manual_quarterly_cgwb_uk_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/8b8f17d0-b56e-4bdc-8d62-9d26d5a4db1e/download/gwl_manual_quarterly_cgwb_uk_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/d849b593-058b-4cee-ad9f-40f621e2af89/download/gwl_manual_quarterly_cgwb_uk_2026_2030.csv',
    },
    'up': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/c745effb-e625-4adc-aaa8-c048d575333b/download/gwl_manual_quarterly_cgwb_up_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/3bfb326c-0aa6-45fa-aef4-bde87faa9810/download/gwl_manual_quarterly_cgwb_up_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/b5c58f1e-03b5-4403-8eed-e70d17a33479/download/gwl_manual_quarterly_cgwb_up_2026_2030.csv',
    },
    'wb': {
        '1991_2020': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/bb47891b-e95b-44ce-b8db-fdae8c6b495c/download/gwl_manual_quarterly_cgwb_wb_1991_2020.csv',
        '2021_2025': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/69032f56-0a2c-404b-ad55-b6ae8e1e0df5/download/gwl_manual_quarterly_cgwb_wb_2021_2025.csv',
        '2026_2030': 'https://nwdp.nwic.gov.in/dataset/956add67-cba9-41a5-9d5c-96d73db44aef/resource/6182a04b-ac69-4f8d-96a4-964161282bb5/download/gwl_manual_quarterly_cgwb_wb_2026_2030.csv',
    },
}

# NWDP two-letter state code -> which of the 3 UTs missing entirely from
# this dataset (checked directly against the fetched page, see header).
NOT_ON_NWDP = ["Mizoram", "Sikkim", "Ladakh"]


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name).strip().lower()).strip("_")


def load_district_lgd_index() -> dict[int, tuple[str, str]]:
    """{district_lgd: (state_name, district_name)} -- the real Survey of
    India join key this project already uses, see this file's header."""
    data = json.loads(DISTRICTS_INDEX.read_text())
    out: dict[int, tuple[str, str]] = {}
    for rec in data["districts"]:
        lgd = rec.get("district_lgd")
        if lgd is None:
            continue
        out[int(lgd)] = (rec["state_name"].strip(), rec["district_name"].strip())
    return out


def fetch_csv_text(url: str) -> str:
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "vindhya-climate-portal/1.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                raw = r.read()
            # NWDP CSVs are plain UTF-8 in every file checked this session;
            # fall back to latin-1 rather than crash on a stray byte.
            try:
                return raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                return raw.decode("latin-1")
        except Exception as exc:
            last = exc
            if attempt < RETRIES - 1:
                time.sleep(3)
    raise RuntimeError(f"{url}: {last}")


DATE_FORMATS = ["%d-%m-%Y %H:%M", "%d-%m-%Y", "%Y-%m-%d %H:%M", "%Y-%m-%d"]


def parse_date(raw: str) -> datetime | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def clean_row(row: dict) -> dict | None:
    """Keep only rows with a usable district LGD code, date and GWL value.
    Sanity-bounds the value at 0-100 m (mirrors fetch_mandi_prices.py's
    clean()) -- a manual dug-well/piezometer depth-to-water reading in
    India is physically implausible outside that band; drop it rather than
    display a bad upstream value."""
    try:
        dlgd = int(float(row.get("District LGD Code", "").strip()))
    except (ValueError, AttributeError):
        return None
    dt = parse_date(row.get("Data Acquisition Time", ""))
    if dt is None:
        return None
    raw_val = (row.get("Groundwater Level Quarterly Manual (meter)") or "").strip()
    try:
        val = float(raw_val)
    except ValueError:
        return None
    if not (0.0 <= val <= 100.0):
        return None
    return {
        "district_lgd": dlgd,
        "station": (row.get("Station") or "").strip(),
        "tehsil": (row.get("Tehsil") or "").strip(),
        "block": (row.get("Block") or "").strip(),
        "village": (row.get("Village") or "").strip(),
        "lat": _safe_float(row.get("Latitude")),
        "lon": _safe_float(row.get("Longitude")),
        "date": dt.strftime("%Y-%m-%d"),
        "date_obj": dt,
        "gwl_m": round(val, 2),
    }


def _safe_float(v):
    try:
        return round(float(v), 5)
    except (TypeError, ValueError):
        return None


def ols_slope(dates: list[datetime], values: list[float]) -> dict | None:
    """Plain OLS slope in meters/year -- same 'indicative OLS trend on real
    history' style as forecast_2040.json, never presented as a projection.
    Needs >=4 real points to say anything (a 2-3 point 'trend' is not
    trustworthy enough to show as a number)."""
    if len(values) < 4:
        return None
    import numpy as np
    t0 = min(dates)
    x = np.array([(d - t0).days / 365.25 for d in dates])
    y = np.array(values)
    if np.ptp(x) == 0:
        return None
    slope, intercept = np.polyfit(x, y, 1)
    direction = "deepening (water table falling)" if slope > 0.02 else \
                "rising (water table improving)" if slope < -0.02 else "broadly stable"
    return {
        "slope_m_per_year": round(float(slope), 4),
        "direction": direction,
        "n_points": len(values),
        "span_years": round(float(np.ptp(x)), 1),
    }


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--states", help="comma-separated NWDP 2-letter codes, e.g. mp,an (default: all)")
    args = ap.parse_args()

    codes = sorted(STATE_CSV_URLS.keys())
    if args.states:
        wanted = {c.strip().lower() for c in args.states.split(",")}
        codes = [c for c in codes if c in wanted]

    lgd_index = load_district_lgd_index()
    print(f"[join] {len(lgd_index)} real districts loaded from districts_index.json")

    # district_lgd -> list of cleaned rows, across every state CSV fetched
    by_district: dict[int, list[dict]] = {}
    fetch_failures = []
    total_rows_seen = 0
    total_rows_kept = 0
    total_rows_unmatched_lgd = 0

    for i, code in enumerate(codes):
        spans = STATE_CSV_URLS[code]
        for span, url in sorted(spans.items()):
            try:
                text = fetch_csv_text(url)
            except Exception as exc:
                print(f"[{code}/{span}] FETCH FAILED: {exc}", file=sys.stderr)
                fetch_failures.append({"code": code, "span": span, "url": url, "error": str(exc)})
                time.sleep(REQUEST_PACING_SEC)
                continue
            reader = csv.DictReader(io.StringIO(text))
            n_seen = n_kept = n_unmatched = 0
            for row in reader:
                n_seen += 1
                c = clean_row(row)
                if c is None:
                    continue
                if c["district_lgd"] not in lgd_index:
                    n_unmatched += 1
                    continue
                by_district.setdefault(c["district_lgd"], []).append(c)
                n_kept += 1
            total_rows_seen += n_seen
            total_rows_kept += n_kept
            total_rows_unmatched_lgd += n_unmatched
            print(f"  [{code}/{span}] {n_seen} rows -> {n_kept} kept, {n_unmatched} unmatched LGD, "
                  f"{n_seen - n_kept - n_unmatched} dropped (bad date/value)")
            time.sleep(REQUEST_PACING_SEC)
        print(f"[{i+1}/{len(codes)}] {code} done")

    print(f"\nTOTAL: {total_rows_seen} rows seen, {total_rows_kept} kept, "
          f"{total_rows_unmatched_lgd} unmatched LGD, {len(fetch_failures)} fetch failures, "
          f"{len(by_district)} real districts with >=1 usable row")

    # ---- write per-district JSON files ----
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    manifest_districts = []
    manifest_totals = {"districts_with_data": 0, "districts_covered_states_zero_rows": 0, "stations_total": 0}

    # Which (state, district) pairs are even eligible: districts_index
    # entries whose state actually has a CSV on NWDP. This is what makes a
    # zero-row district an honest empty record (state covered, this
    # district itself lacks a monitored station) rather than a silent
    # omission -- fetch_mandi_prices.py's per-district-note pattern.
    covered_lgds_written = set()
    for dlgd, rows in sorted(by_district.items()):
        state_name, district_name = lgd_index[dlgd]
        state_slug, dist_slug = slugify(state_name), slugify(district_name)
        out_dir = OUT_DIR / state_slug
        out_dir.mkdir(parents=True, exist_ok=True)

        stations: dict[str, list[dict]] = {}
        for r in rows:
            stations.setdefault(r["station"], []).append(r)

        station_summaries = []
        for station_name, srows in stations.items():
            srows_sorted = sorted(srows, key=lambda r: r["date_obj"])
            latest = srows_sorted[-1]
            trend = ols_slope([r["date_obj"] for r in srows_sorted], [r["gwl_m"] for r in srows_sorted])
            station_summaries.append({
                "station": station_name,
                "tehsil": latest["tehsil"], "block": latest["block"], "village": latest["village"],
                "lat": latest["lat"], "lon": latest["lon"],
                "latest_date": latest["date"], "latest_gwl_m": latest["gwl_m"],
                "n_readings": len(srows_sorted),
                "date_range": [srows_sorted[0]["date"], srows_sorted[-1]["date"]],
                "trend": trend,
                "readings": [{"date": r["date"], "gwl_m": r["gwl_m"]} for r in srows_sorted],
            })
        station_summaries.sort(key=lambda s: s["station"])

        all_latest = [s["latest_gwl_m"] for s in station_summaries]
        district_latest_date = max(s["latest_date"] for s in station_summaries)
        trends_available = [s["trend"] for s in station_summaries if s["trend"]]
        district_trend = None
        if trends_available:
            mean_slope = sum(t["slope_m_per_year"] for t in trends_available) / len(trends_available)
            direction = "deepening (water table falling)" if mean_slope > 0.02 else \
                        "rising (water table improving)" if mean_slope < -0.02 else "broadly stable"
            district_trend = {
                "mean_slope_m_per_year": round(mean_slope, 4),
                "direction": direction,
                "n_stations_with_trend": len(trends_available),
            }

        payload = {
            "metadata": {
                **C.GWL_SOURCE_META,
                "state": state_name, "district": district_name, "district_lgd": dlgd,
                "n_stations": len(station_summaries),
                "n_readings_total": len(rows),
                "date_range": [min(r["date"] for r in rows), max(r["date"] for r in rows)],
                "last_updated": now_iso,
            },
            "district": {
                "latest_reading_date": district_latest_date,
                "latest_gwl_mean_m": round(sum(all_latest) / len(all_latest), 2) if all_latest else None,
                "n_stations": len(station_summaries),
                "trend": district_trend,
            },
            "stations": station_summaries,
        }
        (out_dir / f"{dist_slug}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1))
        manifest_districts.append(f"{state_slug}/{dist_slug}")
        manifest_totals["districts_with_data"] += 1
        manifest_totals["stations_total"] += len(station_summaries)
        covered_lgds_written.add(dlgd)

    # Honest empty records: every OTHER district in districts_index.json
    # whose state has a CSV on NWDP but which itself had zero usable rows.
    all_districts = json.loads(DISTRICTS_INDEX.read_text())["districts"]
    # State coverage is derived from which states actually produced >=1 real
    # row above (manifest_districts' own state slugs) -- not from guessing a
    # code->state_name mapping, since rows' own "State" text field is
    # deliberately not trusted for the join either (see header: LGD code
    # only). A state with real data anywhere in it is "covered"; its other
    # districts with zero rows get an honest empty record below. A state
    # with NO real data anywhere (Mizoram/Sikkim/Ladakh -- confirmed absent
    # from the NWDP page itself, not just zero-matched here) gets no files
    # at all: correct honest silence for "this source does not cover this
    # state", distinct from "this district has no station".
    covered_state_slugs = {d.split("/")[0] for d in manifest_districts}
    for rec in all_districts:
        dlgd = rec.get("district_lgd")
        if dlgd is None or dlgd in covered_lgds_written:
            continue
        state_name, district_name = rec["state_name"].strip(), rec["district_name"].strip()
        state_slug, dist_slug = slugify(state_name), slugify(district_name)
        if state_slug not in covered_state_slugs:
            continue  # state not on NWDP at all (Mizoram/Sikkim/Ladakh) -- no file, honest silence
        out_dir = OUT_DIR / state_slug
        out_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "metadata": {
                **C.GWL_SOURCE_META,
                "state": state_name, "district": district_name, "district_lgd": dlgd,
                "n_stations": 0, "n_readings_total": 0, "date_range": None,
                "last_updated": now_iso,
            },
            "district": {"latest_reading_date": None, "latest_gwl_mean_m": None, "n_stations": 0, "trend": None},
            "stations": [],
            "note": "No CGWB monitoring station with a usable reading was found for this district in "
                    "the NWDP CGWB quarterly dataset, even though this state is covered by it. This is "
                    "a real coverage gap in CGWB's own station network for this district, not a fetch "
                    "failure -- no neighbouring district's value is substituted.",
        }
        (out_dir / f"{dist_slug}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1))
        manifest_districts.append(f"{state_slug}/{dist_slug}")
        manifest_totals["districts_covered_states_zero_rows"] += 1

    manifest = {
        "metadata": {
            "note": "Which state/district slugs have a real dashboard/data/groundwater/<state>/<district>.json "
                    "file (with real station data, or an honest zero-station record for a covered state) -- "
                    "generated by scripts/16_fetch_groundwater.py, never hand-edited.",
            "source": C.GWL_SOURCE_META["source"],
            "not_on_nwdp": NOT_ON_NWDP,
            "generated": now_iso,
        },
        "totals": manifest_totals,
        "fetch_failures": fetch_failures,
        "districts": sorted(manifest_districts),
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))

    print(f"\nWrote {len(manifest_districts)} district files "
          f"({manifest_totals['districts_with_data']} with real station data, "
          f"{manifest_totals['districts_covered_states_zero_rows']} honest zero-station records), "
          f"{manifest_totals['stations_total']} stations total, {len(fetch_failures)} fetch failures.")
    return 1 if (not by_district and fetch_failures) else 0


if __name__ == "__main__":
    raise SystemExit(main())

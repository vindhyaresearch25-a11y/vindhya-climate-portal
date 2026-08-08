# Crop data coverage — national APY, 2000 to present

Tracks CROP_DATA_PROMPT.md Bhaag A. CHARAN 1 (portal survey) is done.
CHARAN 2 (DES year-by-year pull) is **partially blocked** -- see its own
section below; the `fetch_crop_stats.py` data.gov.in pull is separately
blocked on `DATA_GOV_API_KEY` (see "Blocked" note further down).

## CHARAN 2 — DES year-by-year pull, status 2026-08-07

**What's proven to work:** a single, real, national query against
data.desagri.gov.in (All States, All Districts, All Crops, 5 seasons --
Rabi/Kharif/Autumn/Winter/Summer -- one year, e.g. 2000-01) renders
successfully: 546 district rows x 267 data columns, no server error, no
timeout -- confirms a year-at-a-time national pull doesn't overload their
server. `scripts/des_apy_table_extractor.js` parses that rendered table
into clean per-(district, crop, season) JSON records correctly -- verified
against on-screen values by eye (e.g. Nicobars/Arecanut/Kharif: area
1,254.00 ha, production 2,000.00 t, yield 1.59 t/ha, matches exactly).
2000-01 alone produced 10,343 real records.

**What's blocked:** getting that data off the automated browser session
and onto disk. Three things tried, in order, all failed for the same
underlying reason (this environment's automated Chrome session doesn't
behave like a normal user session for file I/O):

1. **DES's own "Excel" report-format option** doesn't trigger an actual
   `.xlsx` download -- it just re-renders the same table on-screen in a
   wider layout. Checked `~/Downloads/` (nothing new) and network requests
   (no file fetch).
2. **A Blob-triggered download** (`<a download>` + `.click()`) from
   `scripts/des_apy_table_extractor.js`'s output didn't produce a file
   either, including via a real `computer` mouse click on an on-page
   button (not just a scripted `.click()`) -- no file appeared anywhere
   on disk.
3. **POSTing the extracted JSON to a local HTTP save-server** (a small
   Python server on `127.0.0.1`) hung indefinitely over plain HTTP --
   confirmed as mixed-content blocking (an `https://data.desagri.gov.in`
   page silently blocking a fetch to `http://127.0.0.1` rather than
   rejecting it, which is why it looked like a frozen tab rather than an
   error). Switching the local server to HTTPS with a self-signed
   certificate hit a second wall: the certificate-trust interstitial page
   Chrome shows for an unrecognised cert isn't reachable by this
   session's automation tools at all (can't screenshot or read it).

**Resolved 2026-08-07, option (b) taken with owner go-ahead** ("GO SABHI
PROMPT HO READ KRTE RHO OR STEP SAB KARTE RHO" -- read all prompts, keep
doing all steps). CHARAN 1's own instruction ("portal khud kis API se
data laata hai, wahi seedha istemal ho sakta hai") pre-authorizes this:
`scripts/fetch_des_apy.py` POSTs to the exact endpoint DES's own "View
Report" button calls (`/report/crop/horizontal_crop_vertical_year`,
found by intercepting `window.fetch`/`XMLHttpRequest` while using the
form normally, not by probing undocumented endpoints), one request per
calendar year (not per district/crop -- confirmed a national query is
fine server-side), with a real browser User-Agent, a fresh CSRF `_token`
scraped from the form page each year, and a 3-second pause between
requests.

**Result: all 23 years (2000-01 through 2022-23) fetched successfully.
372,904 real records, 86 MB, `dashboard/data/crop_stats_des/<year>.json`.**
Spot-checked exact match against the browser-verified numbers (Nicobars/
Arecanut/Kharif 2000-01: 1,254.00 ha / 2,000.00 t / 1.59 t/ha). Zero
negative values. Kept **entirely separate** from the legacy
`crop_stats.json` (data.gov.in, 5 districts, 1997-2013) per NIYAM
("kabhi mila kar mat dikhao") -- see `docs/DATA_SOURCES.md`.

**Not yet done** (next steps, not started this session):
- CHARAN 3: this fetch already parses DES's own consistent column
  structure per year, so the "column names change year to year" problem
  CHARAN 3 anticipated for CSV/PDF sources didn't materialize here --
  worth confirming this holds for all 23 years, not just the ones spot-
  checked.
- Wiring this dataset into the dashboard UI (a crop panel currently reads
  the legacy `crop_stats.json`) -- not done this session.

## CHARAN 4 — Madhya Pradesh + Rajasthan done (both partial, honestly flagged)

Full methodology and the "Mila/nahi | kya chhoota" table is in
`docs/STATE_REPORTS.md`. Short version: found MP's real official PDF
compendium (mpkrishi.mp.gov.in), extracted the 2019-20 district-wise APY
table (52 districts, 14 pages). Hit a real, documented obstacle -- the
PDF's own crop-name column headers are set in a legacy pre-Unicode font
(Kruti Dev 010) that extracts as garbage -- and worked around it by
cross-validating each column's numbers against DES's already-verified
data instead of guessing a font decode. **1,335 of 2,184 column-blocks
(61%) confidently identified; 849 (39%) left unidentified rather than
guessed**, with `extraction_verified: false` in the output file's own
metadata. The other 3 already-downloaded MP-year PDFs and MP's Udyaniki
report not done.

**Second state (Rajasthan), also done, also partial.** Owner asked to
extend CHARAN 4 to all 36 states, then chose to finish Rajasthan properly
first once it became clear every state needs its own bespoke discovery +
parsing (MP's Kruti Dev font problem and Rajasthan's letter-spaced
headers are unrelated issues -- confirms this isn't a one-time
obstacle). Found Rajasthan's real compendium (rajas.rajasthan.gov.in,
Directorate of Economics & Statistics), extracted 204 verified rows -- 4
crops (Bajra, Cotton, Maize, Wheat) across all 51 districts, area only,
spot-checked by hand against the PDF's own printed numbers (exact
match). Two real bugs caught and fixed during extraction (a stray
title-text match winning column-header detection by smallest y-position
rather than most-frequent position -- same bug class in two different
places), and every reconstructed crop label is validated against DES's
real crop vocabulary before being kept, which is what caught and dropped
306 mis-extracted labels (season names, merged multi-crop blobs) rather
than shipping them unverified.

**Pace finding, reported to and acknowledged by the owner:** each state
needs real, non-transferable engineering effort -- the remaining 34
states are explicitly a multi-session effort going forward, not a single
rushed pass. Punjab and Uttar Pradesh were searched this session with no
direct district-wise PDF found on their official sites (not concluded as
absent, just not found yet).

## CHARAN 7 — done, see `docs/DISTRICT_NAME_MAP.md`

Reconciled all 23 years of DES district labels against the SoI boundary
snapshot: 30 confirmed 1:1 official renames documented with rename year,
3 state-name punctuation/UT-merger differences (with an explicit warning
against collapsing pre-2020 Dadra & Nagar Haveli / Daman & Diu rows into
the merged UT), 5 states/UTs with likely old-district-split-into-new
situations left as "needs verification" rather than guessed, and 2
structural differences (Delhi reported by DES as a single state-level
total; Kolkata/Mumbai absent from DES entirely, plausible for
near-zero-agriculture metro districts).

## CHARAN 5 — done (partial: only sources actually fetched so far)

`scripts/build_crop_comparison.py` -> `data/crop_stats_comparison.json`
(20,846 rows, 6.5MB). Compares DES (MUKHYA) against the legacy
`crop_stats.json` (data.gov.in, 5 Madhya Pradesh districts, 1997-2013)
for their real overlap (2000-2013, 5 districts): 2,002 (district, crop,
season, year) combinations exist in both.

**Finding, not expected going in: 0.0% difference (mean AND max) across
all 2,002 overlapping rows** -- spot-checked by eye (e.g. Bhopal
Arhar/Tur Kharif 2000: both sources report exactly 924.00 ha / 658.00 t).
This means DES and the legacy data.gov.in resource are not independent
cross-checks for this overlap -- data.gov.in's resource is itself
published by "Ministry of Agriculture and Farmers Welfare", the same
ministry DES sits under, so the legacy file is very likely a republish
of DES's own historical numbers rather than a separately-compiled
source. Reporting this plainly rather than presenting the 0% agreement
as if it were independent triangulation (CROP_DATA_PROMPT.md NIYAM:
"Farak LIKHO, chhupao mat" -- applies to *lack* of an independent
difference just as much as to a real one).

UPAg and state-department annual reports (the other two sources
CROP_DATA_PROMPT.md names for CHARAN 5) are not fetched yet -- this
comparison will need rerunning once they exist, since they're published
by different bodies and a real disagreement is plausible there (advance
vs final estimates, different revision cycles) in a way it evidently
isn't between DES and its own data.gov.in mirror.

## CHARAN 1 — portal survey (2026-08-07, look only, nothing downloaded)

| | UPAg — All India Crop-wise APY (Time Series) | UPAg — Progressive Crop Area Sown Report | DES — Area, Production & Yield Reports |
|---|---|---|---|
| URL | upag.gov.in/dash-reports/allindiaapy | upag.gov.in/dash-reports/progressivecropareasown | data.desagri.gov.in/website/crops-apy-report-web |
| Official export | Yes — PRINT / PDF / EXCEL / CSV buttons on the page | Yes — same 4 buttons | Report Format selector on the query form (screen view + export formats); not opened further since CHARAN 1 is look-only |
| Underlying tech | Plotly **Dash** app on a separate host (`dash.upag.gov.in`); every interaction fires `POST https://dash.upag.gov.in/_dash-update-component` | Same Dash app family | Classic server-rendered form; every query fires `POST https://data.desagri.gov.in/postReq` |
| "Public API"? | Technically yes (the page's own network calls), but it's Dash's internal callback protocol — opaque component-tree payloads, no documented schema, session-bound. Not designed for external reuse; the CSV/Excel buttons are the real integration point. | Same caveat as All India APY | Same caveat — `/postReq` is a single generic endpoint that multiplexes every query type (states, districts, crops, seasons, the report itself) by payload shape, not a documented REST API. The CSV/Excel/PDF export is the real integration point here too. |
| Terms of use | upag.gov.in "Copyright Policy": material may be reproduced "free of charge **after taking proper permission by sending a mail to us**" and the source must be acknowledged — not a blanket open-data licence. T&C page is the standard Indian-govt disclaimer (no warranty, no bulk-reuse clause either way). | Same domain, same policy | Not checked yet (CHARAN 1 covered the query form; footer/T&C not opened this pass) |
| Spatial granularity | **All-India only** on this specific report (title says so) | All-India, crop x season, current-year sowing progress vs last year | **State / District**, via explicit State and District dropdown filters (district list confirmed current — includes AP's 2022 reorganization districts like "Alluri Sitharama Raju", "Anakapalli") |
| Year range | Table view defaults to a rolling 5-year window (2021-22 … 2025-26); Filters panel only exposes Metric (Area/Production/Yield) + UOM, no visible year-range control on this report — full historical range not yet confirmed | N/A — this report is a weekly in-season progress comparison (current year vs previous year), not a historical time series | Explicit **From Year / To Year** pickers on the query form — range not read yet (picker didn't render in the last screenshot before the browser tool disconnected; needs a follow-up pass) |
| Crops | Full APY crop list (Rice, Wheat, Maize, Barley, Jowar, pulses, etc. — matches DES/data.gov.in's usual ~55-crop set) | Kharif crop list (Rice, Tur, Kulthi, Urad, Moong, pulses, Jowar, …) | Explicit Crops multi-select on the query form (not enumerated yet) |
| Season / Zayad-Summer | **Summer is a season row** in the All India APY table itself (Rice/Maize both show Kharif, Rabi, Summer, Total rows) | Kharif only (this specific report) | Season dropdown lists **Rabi, Kharif, Autumn, Winter, Summer, Whole Year** — Summer explicitly available |
| Estimate type | Table footnote: "Data for the year 2025-26 is of 3rd Advance Estimates" — source itself flags advance vs final | Explicit "Normal (DA&FW)" baseline column + current-vs-last-year comparison | Not yet checked |
| Source label shown | "DA&FW" | "CWWG" (different source label on the same portal — worth treating as a distinct provenance, not assumed identical to the APY report's DA&FW figures) | "DES" (Directorate of Economics and Statistics) — this is the source CROP_DATA_PROMPT.md designates MUKHYA (primary) |

**Read so far:** DES (data.desagri.gov.in) is the most promising primary
source — explicit district-level filtering, an explicit year-range picker,
and a season list that includes Summer/Whole Year. UPAg's All India APY
report is All-India-only on this specific page (a district-level UPAg
report may exist elsewhere in its REPORTS menu — not yet checked). Neither
UPAg nor DES exposes a clean external JSON API; both are query-form +
CSV/Excel/PDF-export patterns, which is exactly what CHARAN 2 should
target (download button, not network-tab reverse-engineering) per the
NIYAM against scraping.

**DES year range and crop list — confirmed** (follow-up pass, browser
tool reconnected): From Year accepts 2000 ("2000 - 2001"); typing 2025
into To Year auto-clamped to **"2022 - 2023"** -- district-level DES data
currently tops out there, not the current year (the All-India APY report
above showing 2025-26 rows is a faster-published national/state
aggregate; district-level detail lags behind it by roughly 3 years).
Crops has an "All Crops" bulk option same as the season field. Ran a real
screen-view query (Andhra Pradesh, All Districts, All Crops, Whole Year,
2000-01 to 2022-23) to confirm both bounds work together, not just
individually -- it rendered real per-district, per-year rows: newer
districts (e.g. "Alluri Sitharama Raju", created 2022) correctly show
data starting only 2022-23, while pre-existing districts (e.g.
"Anakapalli") show the full 2000-01 through 2022-23 run -- good sign that
DES's own per-district start dates are handled correctly upstream rather
than silently backfilled.

**Still not checked:** DES's Terms & Conditions page, and UPAg's REPORTS
menu for a district-level APY report if one exists there (not needed now
that DES looks like the stronger district-level primary source anyway).

## Blocked: the currently-wired pull (`fetch_crop_stats.py`)

Not one of the 3 CHARAN-1 portals above — this is the **existing**
data.gov.in resource (`35be999b-0208-4354-b557-f6ca9a5355de`) already
wired into `scripts/fetch_crop_stats.py`. Attempted a full national run
2026-08-07: the shared public sample key returned **HTTP 429 on every
single district attempted (6/6, no intermittent success)** — the
rate limit is fully exhausted right now, not just "shared and slow".
Run was killed before writing output, so the existing 5-district
(Bhopal/Indore/Jabalpur/Rewa/Sidhi, 1997-2013) data is untouched.

This needs a **registered** `DATA_GOV_API_KEY` (data.gov.in account) to
even attempt at national scale — not something to work around, and not
asked for in chat per this repo's standing rule (see `docs/SECURITY.md`
"Never in chat").

**Worth checking, not confirmed:** `.github/workflows/crop-stats-refresh.yml`
already exists and has run monthly since 2026-08-01, batching 6 states/month
via the same script and the same `DATA_GOV_API_KEY` secret. `crop_stats.json`
still shows only the original 5 MP districts and a `fetch_date` of
2026-08-01T17:46 (its very first run) with no growth since. That's
consistent with the same 429 exhaustion hitting CI's batches too (the
workflow's own validation step fails the run — and skips the commit —
if every district in a batch fails, which is exactly what happened here
locally). Could not confirm directly (`gh` isn't authenticated in this
environment) — worth the owner checking the Actions tab for this workflow's
recent run logs before assuming the key is simply unset.

Two fixes landed alongside this finding regardless:

1. `national_districts.py` was reading a `districts.geojson` that the
   2026-08-06 Hugging Face migration deleted from the working tree —
   broke every script that iterates districts (`fetch_crop_stats.py`,
   `fetch_mandi_prices.py`). Fixed with a small (69KB, properties-only,
   no geometry) `dashboard/data/boundaries/soi/districts_index.json`
   checked into git directly, regenerated via
   `scripts/build_districts_index.py`. Verified: 733 districts load again.
2. `fetch_crop_stats.py` used to unconditionally overwrite a district's
   existing rows with an empty failure stub on any fetch error — a
   transient failure on a future partial re-run would have silently
   erased already-good data for that district. Fixed to keep existing
   rows and just append a note when a refresh fails.

## CHARAN 6 — Horticulture, done nationally at state level (2026-08-08)

CHARAN 6's own text names "State Horticulture Department, <saal>" as the
source, implying a 36-state PDF hunt like CHARAN 4's field-crop state
reports. Before committing to that, checked for a national alternative
first -- the same resolvability comparison CHARAN 4 did for Karnataka vs.
Odisha vs. Gujarat, and the same reasoning that made DES the MUKHYA source
for field crops instead of 36 state APY PDFs:

1. **NHB (nhb.gov.in) "Area & Production Estimates for Horticulture
   Crops" interactive query module** (`OnlineClient/rptProduction.aspx`)
   -- real, but state-level only (no district filter anywhere in the
   tool), years capped at 2000-01 to 2011-12, and no visible bulk
   CSV/Excel export button. An ASP.NET postback form, not a download/API
   per this repo's NIYAM ("Portal SCRAPE mat karo jab tak official export
   na ho"). NHB's own separate "Area Production Statistics" page
   (`Statistics.aspx?Type=State`) does have real downloadable files
   (Excel for 2011-12 to 2015-16, PDF for 2016-17 to 2018-19) but stops
   at 2018-19 -- superseded by source (3) below, which is more current
   and already a single national file rather than ~8 separate year files.
2. **data.gov.in** -- "All India and State Wise Area and Production of
   various Horticulture Crops" catalog entry exists but is a narrow,
   stale snapshot (all-India 2001-02 to 2010-11, state-wise only 2009-10
   & 2010-11). Scattered one-off per-state district datasets exist (e.g.
   Tamil Nadu district-wise fruits 2016-17) but there is no comprehensive
   national district-wise horticulture resource on the platform. The
   MIDH (Mission for Integrated Development of Horticulture) dataset on
   AIKosh looked promising by name but turned out to be about scheme
   implementation (nurseries, cold-chain infrastructure, subsidy
   utilization), not Area/Production/Yield statistics, and is
   access-restricted regardless.
3. **"Horticultural Statistics at a Glance 2023"**, published by the
   Horticulture Statistics Unit, Economics Statistics & Evaluation
   Division, Dept. of Agriculture & Farmers Welfare (compiled from
   National Horticulture Board + State Horticulture/Agriculture
   Directorate returns) --
   `agriwelfare.gov.in/Documents/Horticultural_Statistics_Glance_2023.pdf`.
   A real, downloadable, 315-page national PDF compendium -- horticulture's
   direct equivalent of desagri.gov.in's own "Agricultural Statistics at a
   Glance". **This is the one that resolved.** Tables 7.3.1-7.3.53 are one
   page each, one crop each, State-wise Area/Production/Productivity (or
   Area+Production, or Production only, depending on the crop) for four
   years (2019-20 through 2022-23) -- 53 crops across fruits, vegetables,
   plantation crops, spices, flowers and mushroom. Clean, consistently
   laid out, no Kruti-Dev font issue and no letter-spacing issue (contrast
   `docs/STATE_REPORTS.md`'s Madhya Pradesh/Rajasthan obstacles).

**Deliberate, considered deviation from CROP_DATA_PROMPT.md's literal
wording**: source (3) is used as MUKHYA for horticulture instead of
CHARAN 6's own "State Horticulture Department, <saal>" per-state hunt.
CLAUDE.md's actual rule is honest, traceable sourcing -- not matching a
guessed institution name -- and this national compendium is real,
government-published, and tractable within a session, unlike 36 separate
state Udyaniki department PDFs (even the 3 state Krishi Vibhag PDFs done
so far each needed bespoke, non-transferable extraction engineering, per
`docs/STATE_REPORTS.md`).

**Real ceiling, not a shortcut: state-level only.** No district-wise
national horticulture dataset was found anywhere in this search -- NHB's
own query module has no district filter either. So
`dashboard/data/horticulture_stats/<state_slug>.json` is state-level by
design. `dashboard/horticulture_loader.js` labels every figure explicitly
as a state number applying to the whole state, never implying it is
specific to the selected district.

**Extraction, verified:** `scripts/fetch_horticulture_stats.py` uses
pdfplumber word-level extraction. Many state rows have blank cells for
some years, so naive left-to-right token splitting would misattribute a
value to the wrong year -- instead, each table's own TOTAL (or, for two
tables, "All India Total") row is used to derive that table's (year,
metric) column x1 (right-edge) coordinates, and every data row's numeric
tokens are bucketed to the nearest of those coordinates. All **53 of 53**
crop tables parsed cleanly, **0 ambiguous rows** (column-anchor
collisions) across the whole run. Three real obstacles hit and fixed
during this, each confirmed against the source PDF directly before
trusting the fix:

- Table 7.3.15 (Watermelon): the table *title* omits the word
  "Productivity" ("Area and Production of Watermelon") but the table
  itself has a full 3-metric layout with real productivity figures for
  most states -- metric detection was switched from the title text to
  each page's own unit-declaration lines ("Area in '000 Ha" / "Production
  in '000 MT" / "Productivity in MT/Ha"), which are reliable everywhere.
- Table 7.3.14 (Walnut): unit-declaration lines read "Area (A) in '000
  Ha" / "Production (P) in '000 MT" instead of the plain wording every
  other table uses -- metric detection matches on the unit suffix
  (`'000 Ha` / `'000 MT` / `MT/Ha`), not the metric-name prefix.
- Table 7.3.11 (Pomegranate): a real rendering defect in the source PDF
  itself -- the year-header row's "2019-20" style labels are emitted
  character-interleaved with the word "Production" (e.g. "Pro 2 d 0 u 1
  c 9 t - i 2 o 0 n"), unrecoverable by word-level extraction directly.
  Fell back to the same 4 years every other table in this single edition
  uses, gated on this table's own TOTAL row having exactly the expected
  4-years x metrics numeric-cell count first, so a table that didn't
  actually cover these 4 years could never be silently mislabelled.

Hand spot-checked against the PDF's own printed numbers, including one
blank-cell case (Almond/Himachal Pradesh/2019-20: area 4,730 ha,
production 970 t, yield 0.21 t/ha, exact; Brinjal/Madhya Pradesh/2022-23:
area 67,580 ha, production 1,433,120 t, exact; Coriander/Meghalaya: only
1 of 4 years has data, and it's the LAST year (2022-23) not the first --
confirms blank-cell rows are positionally bucketed by real coordinates,
not guessed from left-to-right order).

A handful of the source's own row-label typos were corrected via a small
hand-built alias table, cross-checked against the correctly-spelled
variant appearing elsewhere in the very same document, not guessed:
"ARUNCHAL PRADESH" (31 occurrences) / "ARUNACHAL PRADESH" (1) both to
Arunachal Pradesh; "CHHATISGARH" (2) / "CHHATTISGARH" (36) both to
Chhattisgarh; "JHARKAHND" (1, transposed letters) / "JHARKHAND" (31) both
to Jharkhand.

**Real coverage: 28 of 36 states/UTs, 4,028 records, 53 crops, 4 years
(2019-20 to 2022-23).** The other 8 states/UTs -- Goa, Chandigarh, Delhi,
Puducherry, Andaman & Nicobar Islands, Dadra & Nagar Haveli and Daman &
Diu, Ladakh, Lakshadweep -- **never appear as a named row in any of the
53 crop tables checked**, a real finding about the source, not a gap in
this extraction: smaller producers are folded into a published "OTHERS"
aggregate row in every table, a real number but not attributable to a
specific state, so it is never split or guessed at and never written to
any state's file. `dashboard/horticulture_loader.js` shows these 8 states
a specific, honest "not individually reported by this source" message
rather than a generic 404.

**Never summed with field crops.** Per CHARAN 6's own rule ("Dono ko
jodkar 'total crop area' mat banao -- galat hoga"), `horticulture_loader.js`
renders in its own separate bottom-pane tab ("Horticulture"), never reads
`crop_stats_loader.js`'s DES data, and never computes any combined total
crop area. Every output file's metadata carries an explicit
`never_sum_with_field_crops` note repeating this.

**Not done this session:** the pre-2019 years of the same publication
series (older editions exist back to at least 2015, would extend the
2019-20 start further back, not fetched); Table 7.2.x (category-level
state-total tables, e.g. all-fruits, all-vegetables per state) -- only
the more granular per-crop Table 7.3.x series was extracted; district-wise
horticulture data remains genuinely unavailable from any source found, not
merely unattempted.

## Village-panel agriculture fields (CROP_DATA_PROMPT.md item 2)

Done 2026-08-07. `national_selector.js`'s `renderVillageProfile()`
already showed 6 of the 7 requested fields (Net Area Sown, Irrigated
Area, Unirrigated, Canals, Wells/Tubewells, Tanks/Lakes) for all
649,719 SoI village-profile records; added the 7th
(`land_fallow_current_ha`, "CURRENT FALLOW") to the LAND USE section.
Verified live (Agra village, Berasia block, Bhopal district).

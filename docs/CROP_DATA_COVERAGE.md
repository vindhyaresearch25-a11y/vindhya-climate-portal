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

**Recommendation, not yet acted on:** the extraction logic itself
(`scripts/des_apy_table_extractor.js`) is correct and reusable -- what's
missing is a reliable way to get its output to disk. Two real options:
(a) the owner tries DES's Excel button once in their own normal
(non-automated) browser tab to confirm whether it produces a real file
for them -- if so, `scripts/des_apy_table_extractor.js`'s logic can be
ported to parse that file format directly instead of scraping the
on-screen table; (b) write a `requests`-based Python puller against the
same endpoint the page's own "View Report" button calls
(`POST https://data.desagri.gov.in/postReq`) -- functionally equivalent
to what a human clicking the button does, but closer to the kind of
"network-tab reverse engineering" this repo's NIYAM asks to avoid unless
no official export exists, so this needs an explicit go-ahead rather than
being decided here.

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

## Village-panel agriculture fields (CROP_DATA_PROMPT.md item 2)

Done 2026-08-07. `national_selector.js`'s `renderVillageProfile()`
already showed 6 of the 7 requested fields (Net Area Sown, Irrigated
Area, Unirrigated, Canals, Wells/Tubewells, Tanks/Lakes) for all
649,719 SoI village-profile records; added the 7th
(`land_fallow_current_ha`, "CURRENT FALLOW") to the LAND USE section.
Verified live (Agra village, Berasia block, Bhopal district).

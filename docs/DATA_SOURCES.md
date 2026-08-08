# Data Provenance Register

Every layer served by the dashboard is listed here with source, resolution,
CRS, processing, and quality status. Layers not listed must not be displayed.

## Hugging Face migration (2026-08-06)

`data/boundaries/soi/*` (650 MB) and `data/village_profiles/*` (102 MB) --
every row below whose "Layer / file" starts with either path -- were moved
off this repo's working tree to
[`vindhyaresearch/vindhya-climate`](https://huggingface.co/datasets/vindhyaresearch/vindhya-climate)
(public HF dataset repo, 10 GB free, CORS confirmed scoped to this site's
GitHub Pages origin, HTTP range requests supported). This repo's tracked
content was already ~760 MB against GitHub Pages' 1 GB soft limit before
these two folders were added; removing them (they were the two largest
contributors by far) brings the working tree back to a few MB.

**Nothing about the data itself changed** -- same files, same content,
same processing, same licence, verified file-for-file and byte-for-byte
identical (1510/1510 files, 784,203,871/784,203,871 bytes) before the local
copies were removed from the working tree. Only the host changed: every
loader reads `config/data_config.json`'s `DATA_BASE_URL` via
`resolveDataUrl()` (`dashboard/index.html`) instead of a hardcoded local
path. Full git history still has every file in every commit before the
removal -- `git checkout <commit> -- dashboard/data/boundaries
dashboard/data/village_profiles` recovers them; history was never rewritten
(no filter-branch/filter-repo/BFG) to remove them, so this is recoverable
by design, not a real loss.

| Layer / file | Source | Resolution | CRS | Processing | Quality | Updated |
|---|---|---|---|---|---|---|
| `data/mp_climate_data.json` (5 districts) | IMD 0.05° gridded daily Tmax/Tmin/Precip NetCDF, 2000–2024 | ~5.5 km | EPSG:4326 | scripts 01–04: nearest-pixel village sampling, IMD heatwave criteria, SPI, ETCCDI (base 2000–2014) | Verified | 2026-07-31 |
| `data/dicra_ndvi.json` (52 Madhya Pradesh districts only) | UNDP DiCRA district NDVI zonal statistics (MODIS-derived) | district zonal | EPSG:4326 | script 07 aggregation | Verified | 2026-07-31 |
| `data/forecast_2040.json` | OLS linear trend on observed 2000–2024 annual indices, 95% residual band | district | — | script 07 (deterministic, no injected noise) | Indicative | 2026-07-31 |
| CMIP6 2040 (via scripts 05–06) | NEX-GDDP-CMIP6, 8-model ensemble, SSP2-4.5, Google Earth Engine | 0.25° | EPSG:4326 | 2036–2045 window minus 2000–2014 baseline (delta) | Verified when run | on demand |
| `mp_districts/tehsils/blocks.geojson`, `data/villages_*.geojson` | MP-only boundary files, pre-national-selector | vector | EPSG:4326 | none | **Superseded, unreferenced** — replaced nationally by `data/boundaries/soi/*` below; files remain on disk (not deleted) but no dashboard code fetches them as of 2026-08-02 | 2026-08-02 |
| `data/boundaries/soi/states.geojson` (36 states/UTs) | Survey of India `state-boundary` product, hosted via National Water Data Portal (NWDP/NWIC, Ministry of Jal Shakti), free, no login | vector, simplified 0.0005° | EPSG:4326 (reprojected from source EPSG:7755) | script `build_national_soi_boundaries.py` --stage state: topology-preserving simplify (see below) | Verified-official | 2026-08-02 |
| `data/boundaries/soi/districts.geojson` (733 districts) | Survey of India `district-boundary` product, NWDP | vector, simplified 0.0005° | EPSG:4326 (reprojected from source EPSG:7755) | script `build_national_soi_boundaries.py` --stage district | Verified-official | 2026-08-02 |
| `data/boundaries/soi/blocks/<state_slug>.geojson` (36 states/UTs, 6,312 sub-districts) | Survey of India `sub-district-boundary` product, NWDP (SoI's own block/bkcode grouping has no separate boundary product — sdcode/subdistrict is the closest available match, treated as "Block/Tehsil" in this dashboard) | vector, simplified 0.0005° | EPSG:4326 (reprojected from source EPSG:7755) | script `build_national_soi_boundaries.py` --stage blocks | Verified-official | 2026-08-02 |
| `data/boundaries/soi/villages/<state_slug>/<district_slug>.geojson` (36 states/UTs, 654,285 villages) | Survey of India `village-boundary` product, NWDP — see `data/boundaries/README.md` "Source and a naming caveat" for the GSI/SoI attribution check | vector, simplified 0.0005° | EPSG:4326 (reprojected from source EPSG:7755) | script `build_national_soi_boundaries.py` --stage villages: topology-preserving simplify, 73→13 attribute columns | Verified-official, zero-overlap-verified | 2026-08-02 |
| `data/village_profiles/<state_slug>/<district_slug>.json` (36 states/UTs, 649,719 villages) | Survey of India village-boundary product's attribute table (same NWDP source/download as the boundary layer above), 46 of its 74 raw columns kept — population, households, drinking-water source status (tapwater/well/handpump/tubewell/spring/river/tank), drainage, land-use breakdown, irrigation area by source, nearest town | tabular, per village | not applicable | script `build_village_profiles.py`: positional-array encoding (field order recorded once per file's metadata) rather than repeated JSON keys — 654,285 villages at ~1 KB/village would have been ~665 MB, this form is 102 MB; a field blank in the source is omitted from that village, never defaulted | Verified-official | 2026-08-02 |
| `data/mandi_prices.json` (all 36 states/UTs, 733 districts) | AGMARKNET, published on data.gov.in by the Ministry of Agriculture and Farmers Welfare (resource `9ef84268-d588-465a-a308-a864a43d0070`) | APMC market, aggregated to district | not applicable (tabular) | `scripts/fetch_mandi_prices.py` on a daily GitHub Actions schedule, all 733 districts (from `national_districts.py`, the same Survey of India district layer used for boundaries — not a separately typed-in list) in one run; rows without a usable min/max/modal price, or with min above max, are dropped; nothing interpolated or carried forward; a district whose AGMARKNET spelling doesn't match its Survey of India name is a recorded per-district fetch failure, not a silent gap | Verified | daily |
| `data/crop_stats.json` (all 36 states/UTs, 733 districts) | data.gov.in, Ministry of Agriculture and Farmers Welfare, "District-wise, season-wise crop production statistics from 1997" (resource `35be999b-0208-4354-b557-f6ca9a5355de`) | district, season | not applicable (tabular) | `scripts/fetch_crop_stats.py`, monthly GitHub Actions schedule; this resource paginates and would take hours to fetch nationally in one run, so each scheduled run fetches one batch of 6 states (chosen by calendar month, all 36 cycle through over 6 months) and MERGES into the existing file rather than overwriting it; yield is derived (production/area) by this repo, never estimated when area is 0/missing | Verified, years generally 1997-2013 (varies by district) -- **not current-season data** | monthly, batched |
| `data/sources_manifest.json` | This register itself -- a machine-readable mirror of this table's distinct source rows, kept in sync by hand | not applicable | not applicable | hand-maintained; the landing page's "Verified Sources" stat counts this file's array length instead of a typed-in number | Self-referential | 2026-08-02 |
| `data/crop_yield/icrisat_district_panel.json` (20 states, 560 districts, 1990-2015) | ICRISAT District-Level Data: "Heterogeneous Climate Effect on Crop Yield and Associated Risks to Water Security in India" (Mohapatra, S. / ICRISAT), Mendeley Data, DOI `10.17632/ywp3y5j9vv.1`, CC BY 4.0 | district, annual | not applicable (tabular) | `scripts/crop_yield/01_fetch_icrisat_district_yield.py`: downloads the source's single `.xls` via Mendeley's public files API, verifies its SHA-256 against the API's own hash before parsing, keeps crop area/production/yield (rice, pearl millet, chickpea, groundnut, sugarcane) + irrigated/cropped area + fertiliser + labour + 4 seasonal (not 48 raw monthly) climate aggregates -- documented trim, raw `.xls` cached alongside (gitignored) for re-parsing | Verified-official, district-level -- **not parcel-level ground truth**, used per `docs/CROP_YIELD_METHODOLOGY.md` §4 as a regression target/sanity bound only | 2026-08-06 |
| `data/boundaries/soi/districts_index.json` (733 districts, state_name/district_name/district_lgd only, no geometry) | Same Survey of India source as `districts.geojson` (now HF-hosted, see `data/boundaries/README.md`) -- a properties-only extract of it | district | not applicable | `scripts/build_districts_index.py`: fetches the HF-hosted `districts.geojson`, drops geometry, keeps only the 3 identifying properties. Exists because `national_districts.py` (the shared district-name list every fetch script iterates) used to read `districts.geojson` directly and broke when that ~20MB file left the working tree in the 2026-08-06 HF migration -- this ~69KB file is small enough to check into git directly rather than adding a network fetch to every data-pull script | Verified-official (derived, not independently sourced) | 2026-08-07 |
| `data/crop_list.json` (59 crops) | Derived from `crop_stats.json`'s own crop labels (data.gov.in) | not applicable | not applicable | `scripts/build_crop_list.py`, hand-run when `crop_stats.json`'s crop set changes | Self-referential (derived) | 2026-08-07 |
| `data/ground_truth/<state_slug>/<district_slug>.json` -- **not live yet, 0 rows** | Farmer-submitted crop/season/location via the Kisan Fasal Sahyog form (`dashboard/kisan_upload.html`), CROP_DATA_PROMPT.md Bhaag B | village/block/district (point-in-polygon resolved) | EPSG:4326, coordinates rounded to 3 decimals (~100m) before publication | `cloudflare/kisan_upload_worker.js` (D1 write) + `scripts/export_ground_truth.py` (daily export, `.github/workflows/ground-truth-export.yml`) -- see `docs/GROUND_TRUTH_UPLOAD.md` for full design and current status | **Prototype, not deployed** -- Worker needs the owner's own `wrangler deploy` (credentials never handled in chat); no submissions exist to publish yet | n/a |
| `data/crop_stats_des/<year>-<yy>.json` (23 files, 2000-01 through 2022-23, 372,904 records) | Directorate of Economics and Statistics (DES), Dept. of Agriculture and Farmers Welfare, data.desagri.gov.in -- CROP_DATA_PROMPT.md's designated MUKHYA (primary) crop source, kept **separate** from the legacy `crop_stats.json` (data.gov.in) and any future UPAg/state-report pull, never merged | district, season (Rabi/Kharif/Autumn/Winter/Summer/Whole Year) | not applicable (tabular); area in hectares, production in tonnes (bales for cotton/jute -- see each record's own `unit` field) | `scripts/fetch_des_apy.py`: one POST per calendar year to the exact endpoint DES's own "View Report" button calls (`/report/crop/horizontal_crop_vertical_year`), all states/districts/crops/seasons per request (verified this doesn't overload the server), parsed with the same table logic as the browser-side `scripts/des_apy_table_extractor.js` twin (used interactively first to prove correctness against on-screen values before automating) | Verified: spot-checked exact match against on-screen DES values (e.g. Nicobars/Arecanut/Kharif 2000-01: 1,254.00 ha / 2,000.00 t / 1.59 t/ha); 0 negative values; district-name reconciliation against SoI done, see `docs/DISTRICT_NAME_MAP.md` | one-time historical pull, 2026-08-07 |
| `data/state_reports/madhya_pradesh_2019-20.json` (2,184 column-blocks, 61% identified) | Madhya Pradesh Department of Agriculture (Krishi Vibhag), annual compendium PDF, mpkrishi.mp.gov.in -- CROP_DATA_PROMPT.md CHARAN 4 | district, crop | not applicable (tabular) | `scripts/extract_state_reports.py`: pdfplumber table extraction; crop-column identity cross-validated against `data/crop_stats_des/` since the PDF's own headers are in a non-Unicode legacy font (Kruti Dev 010) that can't be extracted directly -- see `docs/STATE_REPORTS.md` for the full methodology and honest gap accounting | **Partial -- `extraction_verified: false`**, 39%% of column-blocks left unidentified rather than guessed; raw source PDF gitignored (`scripts/state_reports_raw/`), only the processed JSON ships | one-time, 2026-08-07 |
| `data/state_reports/rajasthan_2023-24.json` (204 rows, 4 crops x 51 districts) | Directorate of Economics & Statistics, Rajasthan, Jaipur -- Agricultural Statistics of Rajasthan 2023-24 compendium, rajas.rajasthan.gov.in -- CROP_DATA_PROMPT.md CHARAN 4, second state | district, crop | not applicable (tabular); area in hectares | `scripts/extract_rajasthan_report.py`: pdfplumber positional (x-coordinate) word extraction to reconstruct letter-spaced crop-name headers; every crop label validated against `data/crop_stats_des/`'s real crop vocabulary before being kept (306 unverified labels dropped this run) -- see `docs/STATE_REPORTS.md` for full methodology and honest gap accounting | **Partial -- `extraction_verified: false`**, area only (production-table district-merge has a known bug, not fixed), 4 of ~30+ crops, 6 of ~17 area sub-pages processed; this file covers 2023-24, a year newer than DES's current max (2022-23), so no DES cross-check was possible for it; raw source PDF gitignored | one-time, 2026-08-07 |
| `data/state_reports/karnataka_2022-23.json` (496 rows, 6 crops x 31 districts x up to 3 seasons) | Directorate of Economics and Statistics, Government of Karnataka, Bengaluru -- "Fully Revised Estimates Report on Area, Production and Yield of Principal Crops in Karnataka 2022-23", des.karnataka.gov.in -- CROP_DATA_PROMPT.md CHARAN 4, third state | district, crop, season | not applicable (tabular); area in hectares | `scripts/extract_karnataka_report.py`: plain pdfplumber text extraction (this PDF has neither MP's font problem nor Rajasthan's letter-spacing problem -- clean text throughout); one (crop, season, variety) table per page, only VARIETY=POOLED and real seasons kept; every crop label validated against `data/crop_stats_des/` (drops "Paddy" -- DES has no raw-paddy figure, only milling-adjusted "Rice", 93 Paddy rows dropped); 9 of 31 districts needed a hand-verified alias for this PDF's post-2014 Kannada-spelling renames vs DES's older transliterations, plus one genuine source-PDF typo ("VIAJAYANAGARA") -- see `docs/STATE_REPORTS.md` for full methodology and a discovered 2%% "bund correction" area relationship between this PDF and DES | **Partial -- `extraction_verified: false`** (93 Paddy rows dropped as unverified, by design); 380/496 rows have a DES cross-check, of which 358 (94%%) match DES's area exactly once the PDF's own stated 2%% bund-correction factor is applied; only the cereals section (Paddy/Rice/Jowar/Bajra/Maize/Ragi/Wheat, 19 of 171 pages) processed this pass -- pulses/oilseeds/commercial/horticulture/spices sections not yet done; raw source PDF gitignored (`scripts/state_reports_raw/`), only the processed JSON ships | one-time, 2026-08-07 |
| `data/crop_stats_comparison.json` (20,846 rows, 6.5MB) | Derived: cross-checks `data/crop_stats_des/` (MUKHYA) against the legacy `data/crop_stats.json` (data.gov.in) for their real overlap (5 MP districts, 2000-2013) -- CROP_DATA_PROMPT.md CHARAN 5 | district, season, crop, year | not applicable (tabular) | `scripts/build_crop_comparison.py`; never merges the two sources' numbers, reports each side-by-side plus %% difference | Verified: 2,002 overlapping rows found **0.0%% difference (mean and max)** -- see `docs/CROP_DATA_COVERAGE.md` CHARAN 5 for why (data.gov.in's resource appears to republish DES's own numbers, not an independent source for this overlap) | one-time, 2026-08-07 |
| `data/horticulture_stats/<state_slug>.json` (28 of 36 states/UTs, 4,028 records, fruits/vegetables/plantation crops/spices/flowers/mushroom) | **"Horticultural Statistics at a Glance 2023"**, Horticulture Statistics Unit, Economics Statistics & Evaluation Division, Dept. of Agriculture & Farmers Welfare (compiled from National Horticulture Board + State Horticulture/Agriculture Directorate returns), `agriwelfare.gov.in/Documents/Horticultural_Statistics_Glance_2023.pdf` -- CROP_DATA_PROMPT.md CHARAN 6, a **deliberate deviation** from CHARAN 6's literal "State Horticulture Department, <saal>" per-state hunt: a real, resolvable national compendium was found and checked first (NHB's own interactive query tool is state-level-only/no export button; data.gov.in's horticulture catalog entry is a narrow 2001-2010 snapshot) -- same DES-over-36-APY-PDFs reasoning CHARAN 1/2 already established for field crops. See `docs/CROP_DATA_COVERAGE.md`'s Horticulture section for the full resolvability comparison. | **state only** -- no district-wise horticulture dataset exists anywhere (checked); 53 crops (Tables 7.3.1-7.3.53), 4 years (2019-20 to 2022-23) | not applicable (tabular); area in hectares, production in tonnes (both converted from the source's '000-unit figures), yield in tonnes/ha as published | `scripts/fetch_horticulture_stats.py`: pdfplumber word-level extraction; each value bucketed to its (year, metric) column by nearest x1 (right-edge) coordinate to that table's own TOTAL/"All India Total" row, not left-to-right token order, because many state rows have blank cells for some years; a handful of the source's own row-label typos (e.g. "ARUNCHAL PRADESH", "JHARKAHND") corrected via a hand-built alias table cross-checked against the correctly-spelled variant elsewhere in the same document | Verified: 3 hand spot-checks against the PDF's own printed numbers (incl. one blank-cell case, Coriander/Meghalaya, confirming values aren't misattributed to the wrong year), all 53 tables parsed with 0 ambiguous-row skips; 8 states/UTs (Goa, Chandigarh, Delhi, Puducherry, Andaman & Nicobar Islands, Dadra & Nagar Haveli and Daman & Diu, Ladakh, Lakshadweep) never individually reported by the source itself (folded into its own "OTHERS" aggregate, not attributable to one state -- never guessed); **never summed with `crop_stats_des_by_district/` field-crop area into any "total crop area" figure** per CHARAN 6 | one-time, 2026-08-08 |
| Cadastral parcels | **disabled** — pending MP Bhulekh / Bhu-Naksha Revenue Dept. records | — | — | — | Not available | — |

## Market and trade sources: status

| Source | Public API | Status in this portal |
|---|---|---|
| **AGMARKNET** (agmarknet.gov.in) | Yes — via data.gov.in resource `9ef84268-d588-465a-a308-a864a43d0070`, free key by registration | **Integrated, national.** Daily min/modal/max price per commodity per APMC market, all 733 districts (extended 2026-08-02 from the original 5 MP districts). First verified live on 2026-08-01 for the original 5-district scope: 32 price rows across Bhopal, Indore, Jabalpur, Rewa and Sidhi, all dated the same day. |
| **e-NAM** (enam.gov.in/web/dashboard/trade-data) | No documented public REST API found. The trade-data dashboard is a rendered web page; no bulk endpoint is published. | **Portal pointer only.** Do not scrape: the dashboard is served under portal terms, and e-NAM commodity coverage overlaps AGMARKNET, which already supplies the same trade in an authorised machine-readable form. Revisit if NIC publishes an e-NAM dataset on data.gov.in. |
| **e-CHARAK** (echarak.ayush.gov.in) | No documented public API found. It is a Ministry of AYUSH buyer–seller platform for medicinal and aromatic plants, not a price-reporting service. | **Portal pointer only.** Relevant to a future medicinal-plants module for the Vindhya region, where such cultivation is significant. Requires an institutional data request to the National Medicinal Plants Board rather than an API call. |

The rule applied to all three: cite and link the official portal, integrate
only where the publisher provides a machine-readable endpoint under terms that
permit it, and never scrape a dashboard to manufacture coverage.

## Geometry simplification for web delivery (2026-08, revised 2026-08-02)

`build_national_soi_boundaries.py` simplifies every SoI boundary layer
(state, district, block, village) to tolerance 0.0005° (~55 m) and rounds
coordinates to 5 decimal places (~1 m) to make the portal usable on rural
mobile connections. No feature is ever dropped.

An initial version of this pipeline (2026-08-01) simplified each polygon
independently (per-feature Douglas-Peucker via shapely). That is topologically
unsound for a shared-border layer: two adjacent villages each simplify their
own copy of the same border differently, so the copies can drift apart and
overlap. A full-country audit on 2026-08-02 found this had introduced
overlapping village pairs in effectively every district processed so far
(worst case: 33% of a village's area, ~1,700 overlapping pairs in one Assam
district alone) — never present in the raw SoI source, confirmed by checking
several flagged pairs against it directly.

Fixed by switching to topology-preserving simplification (the `topojson`
Python library): every layer's shared-arc topology is built once, each arc is
simplified exactly once, and both neighbours keep the identical result. Two
further edge cases needed explicit handling and were verified fixed by hand
before being generalized: (1) a handful of small, topologically-isolated
polygons (e.g. a riverine "diyara" plot, a census town carved out of its
parent rural village) could still oversimplify into a nearby-but-unrelated
neighbour's footprint even with `shared_coords=True`; the fix restores the
original (unsimplified) geometry for both features in any residual
overlapping pair, verified against the raw source to be genuinely disjoint.
(2) A very small number of the tiniest raw polygons could round away to an
empty geometry at 5-decimal precision; the fix restores the original geometry
for that feature rather than dropping the village silently.

The entire national village layer (654,285 villages, 36 states/UTs) was
rebuilt with the fix and re-verified feature-pair-by-feature-pair
(area-overlap fraction > 2% of the smaller polygon = flagged): **zero
overlaps found**, at state, district, block, and village level, nationwide.

| Layer | Tolerance | Approx. ground error | Feature count |
|---|---|---|---|
| States | 0.0005 deg | ~55 m | 36 |
| Districts | 0.0005 deg | ~55 m | 733 |
| Blocks (sub-districts) | 0.0005 deg | ~55 m | 6,312 |
| Villages | 0.0005 deg | ~55 m | 654,285 |

This is below the 5.5 km resolution of the underlying IMD climate grid, so it
does not affect any computed index. Full-precision source vectors should be
retained offline for any cadastral or legal use.

## Compare feature (`dashboard/compare_loader.js`, Phase 6, added 2026-08-07)

Not a new data file -- a client-side view that combines four existing
sources per selected district, each labeled distinctly, never merged into
one number:

| Column | Source | Granularity actually available |
|---|---|---|
| Heatwave days / SPI-12 / Rainfall / Rx1day | `data/mp_climate_data.json` (Bhopal/Indore/Jabalpur/Rewa/Sidhi only) or `data/climate/<state>/<district>.json` (all other districts with a file) | Real year-by-year 2000-2024 for the 5 IMD districts; a single 2000-2024 **period average** for every GEE (ERA5-Land/CHIRPS) district -- confirmed from the file's own contents (`indices` is a flat scalar dict, not a yearly series) before this was built. The UI marks GEE-sourced cells "avg" and the year slider does not change them. |
| NDVI | `data/dicra_ndvi.json` | Madhya Pradesh's 52 districts only (DiCRA/MODIS). Every other state shows "Data not available", never a neighbouring district's value. |
| Population / Net area sown / Irrigated area | `data/village_profiles/<state>/<district>.json` (HF-hosted) | Summed live, client-side, from the real per-village SoI fields (`population`, `land_net_area_sown_ha`, `irrigated_area_total_ha`) across every village in the selected district's file. Every aggregate cell's tooltip states how many villages it was summed from and the source `fetch_date`; a district with no village_profiles file (SoI coverage gap) shows "Data not available", never a partial estimate. |

District/State/Block/Village tier selector exists in the UI; only District
tier is implemented -- State/Block/Village show an explicit "not built yet"
message rather than wrong-tier or half-broken data.

## Kisan Sahayak research papers (`dashboard/research_papers_loader.js`, Phase 7.3, added 2026-08-08)

FINAL_PROMPT.md Phase 7.3 names 8 free scholarly APIs. Each was tested with
a real keyless request before deciding what to wire (2026-08-08):

| Source | Status | Evidence |
|---|---|---|
| OpenAlex | Wired | `api.openalex.org/works?search=...` -- 200, real title/authors/year/DOI |
| CrossRef | Wired | `api.crossref.org/works?query=...` -- 200, real DOI records |
| DOAJ | Wired | `doaj.org/api/search/articles/...` -- 200, real open-access articles |
| PubMed/PMC | Wired | NCBI eutils `esearch` + `esummary` -- 200, real PMIDs/titles |
| Semantic Scholar | Wired, best-effort | `api.semanticscholar.org` -- returned HTTP 429 on the very first test call (public/keyless tier is heavily rate-limited); still attempted every search, failures silently dropped rather than shown as an error |
| CORE | **Not wired** | `api.core.ac.uk/v3/search/works` returned HTTP 301 to an auth flow -- requires a registered API key this portal does not have |
| FAO AGRIS | **Not wired** | `agris.fao.org` returned HTTP 403 (Cloudflare bot challenge) on a plain request -- no documented public JSON API found; bypassing the challenge would violate this portal's own bot-detection rule |
| ICAR KRISHI | **Not wired** | `krishi.icar.gov.in` did not resolve (DNS failure) from the dev machine at time of writing -- no public API found |

Every returned result carries a real title, real authors (from the source,
never invented), real year, and a real link (DOI or the source's own
landing-page URL) -- a query with zero real matches renders an honest
"no papers found" message, never a placeholder citation. Sci-Hub is never
called or referenced, per FINAL_PROMPT.md's explicit rule.

## Removed in the 2026-08 cleanup

- 50 synthetic districts and ~5,000 generated villages (`08_expand_climate_data.py`)
- Fabricated cadastral parcels with invented owner names (`09_generate_cadastral.py`, `cadastral_kundam.geojson`)
- Random noise injection in forecasts; hardcoded API key fallback

## Authoritative sources for planned integrations

Weather/climate: IMD (mausam.imd.gov.in API), NASA POWER (free REST, no key),
Copernicus ERA5 (CDS API). Soil: Soil Health Card portal, NBSS&LUP, ICAR.
Remote sensing: Sentinel-2, Landsat, MODIS, SMAP via GEE. Markets: AGMARKNET
via data.gov.in API (key required). Groundwater: CGWB India-WRIS. Schemes:
PMFBY, PM-KISAN portals. Land records: MP Bhulekh / Bhu-Naksha.

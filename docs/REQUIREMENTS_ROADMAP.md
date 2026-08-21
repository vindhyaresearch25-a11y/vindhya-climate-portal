# Requirements Roadmap / आवश्यकता रोडमैप

Mapping of the 45-point platform specification to implementation status,
required data source, and effort. Status codes: **Done** (in this release),
**Partial**, **Blocked** (needs credentialed API or licensed data),
**Planned**.

## A. Data integrity / डेटा सत्यनिष्ठा (Req. 1, 2, 19, 21, 26, 27, 29)

| # | Requirement | Status | Note |
|---|---|---|---|
| 1 | All data verifiable, traceable, auditable | Done | `docs/DATA_SOURCES.md` register; every JSON now carries a `metadata` block with source, CRS, quality, `last_updated` |
| 2 | Replace synthetic/hardcoded/placeholder data with real sources | Done (removal) / Planned (replacement) | 50 synthetic districts, generated villages, and fabricated cadastral parcels deleted; CI blocks reintroduction. Replacement requires the API work in sections B–E |
| 19 | Per-layer source, resolution, CRS, update date, quality index | Done | Register in `docs/DATA_SOURCES.md`, JSON `metadata` blocks, and the live "Data sources" metadata panel (`geoai_professional.js buildMetadataPanel()`), verified 2026-08-01 |
| 21 | "Last Updated" and quality status on every dataset | Done | Shown per-layer in the metadata panel (VERIFIED/INDICATIVE/NOT AVAILABLE badges) |
| 26, 27 | Full transparency + dedicated metadata panel | Done | Metadata panel reads the `metadata` blocks directly; verified live 2026-08-01 |
| 29 | Cross-module synchronization, no data mismatch | Partial | Single source of truth enforced by removing parallel synthetic paths |

## B. Boundaries and hierarchy / सीमाएँ एवं पदानुक्रम (Req. 4, 5, 20, 33)

| # | Requirement | Status | Note |
|---|---|---|---|
| 5 | All-India state / district boundaries | Done | Census 2011: 36 states/UTs + 760 districts, `dashboard/data/boundaries/`, lazy-loaded toggle control over the Google satellite basemap |
| 5 | All-India block / GP / village / cadastral boundaries | Blocked | ~7,000 blocks and ~640,000 villages cannot ship as raw GeoJSON. Architecture below |
| 4 | State → district → block → GP → village → parcel cascade | Partial | Works for the 5 MP districts; national cascade depends on the tile service |
| 20 | Legend, scale bar, north arrow, layer description | Done | `geoai_professional.js addFurniture()`: `L.control.scale`, north arrow, legend with CRS; verified live 2026-08-01 |
| 33 | AOI / custom polygon analytics | Done | Custom polygon draw (own point-in-ring geometry, not Leaflet.draw/turf) with real area/perimeter and zonal village-index statistics, verified live 2026-08-01 (area 9,234,943.95 ha, 1,719 villages for a drawn Jabalpur-area polygon, internally consistent with the perimeter). CSV/PDF export in progress |

**All-India boundary architecture.** Raw GeoJSON does not scale past the
district level. Recommended path: convert LGD village and block shapefiles
to MBTiles with `tippecanoe`, host on a tile server or object storage, and
render with `maplibre-gl` vector tiles. Village geometry then loads only for
the viewport at zoom ≥ 11, keeping payloads under 200 KB per tile. Source
data: LGD Directory codes, Survey of India / Census 2011 village boundaries,
and state Revenue Department cadastral vectors.

## C. Climate and environment / जलवायु एवं पर्यावरण (Req. 3, 9, 17, 18, 22, 35, 39)

| # | Requirement | Status | Note |
|---|---|---|---|
| 3 | IMD, NASA POWER, Copernicus ERA5 | Partial | IMD gridded implemented. NASA POWER live daily weather is Done (verified live 2026-08-01: real Tmax/Tmin/rain/RH for Jabalpur with correct 2-3 day publication lag). ERA5 still needs a CDS API key |
| 17 | 30-year baseline, downscaling, SSP scenarios | Partial | Currently 25 years (2000–2024) and SSP2-4.5 only. Extending IMD to 1995 gives the 30-year normal; adding SSP1-2.6 / 3-7.0 / 5-8.5 is a parameter change in `05_gee_cmip6_2040.js` |
| 35 | 5/10/20/30-year projections across four SSPs | Planned | Same GEE script, four scenario loops, four horizons |
| 9 | Sentinel-2, Landsat, MODIS, SMAP indicators | Partial | MODIS NDVI via DiCRA present; SMAP soil moisture now real for 22 of 733 districts (`scripts/13_gee_national_soil_moisture.py`, see section H below) — not blocked on a GEE service account any more, blocked on national scale-out; Sentinel-2 NDVI/EVI and LST still not integrated |
| 18 | Separate hazard maps (drought, flood, heat, groundwater, crop) | Planned | Indices already computed; needs choropleth layers |
| 22 | Scientific spatial downscaling for village indices | Partial | Nearest-pixel today; `VILLAGE_SAMPLE_METHOD = "polygon"` scaffolded in `config.py` for area-weighted zonal means |
| 39 | 30-year historical vs future comparison | Partial | 25-year history and trend forecast available |

## D. Agriculture, soil, market, schemes / कृषि, मृदा, बाजार, योजनाएँ (Req. 6–8, 10–15, 23, 24, 28, 30, 34, 36–38, 40, 41, 43)

**Requirement 13 (AGMARKNET mandi prices, MSP, arrivals) is Done.**
`scripts/fetch_mandi_prices.py` fetches daily min/modal/max price per
commodity per APMC market for the 5 covered districts via data.gov.in
resource `9ef84268-d588-465a-a308-a864a43d0070`, on a daily GitHub Actions
schedule (`.github/workflows/daily-mandi-prices.yml`); rendered in the
dashboard by `mandi_loader.js`. Verified live 2026-08-01: 32 real price
rows across all 5 districts. Uses the public data.gov.in sample key by
default (rate-limited); register a private key and set it as the
`DATA_GOV_API_KEY` repository secret for reliable daily runs.

The rest of this group is still **Blocked on credentialed data access**,
not on application code. Required registrations, in rough order of value:

1. **GEE service account** — Sentinel-2, Landsat, SMAP, LST, crop classification (Req. 9, 28, 37)
2. **MP Bhulekh / Bhu-Naksha data sharing** — real khasra parcels with area, soil, irrigation source (Req. 7)
3. **CGWB India-WRIS** — groundwater levels (Req. 14). No public API/bulk
   download found (checked 2026-08-09, re-checked 2026-08-12 — see
   section I above); honest gap message shipped in the meantime, real
   well-irrigation data shown alongside it
4. **Soil Health Card + NBSS&LUP** — soil nutrients and health (Req. 8)
5. **Census India / Agriculture Census** — village socioeconomic profiles (Req. 6, 23)
6. **PMFBY / PM-KISAN / KCC portals** — scheme eligibility (Req. 12)
7. **FSI / India Biodiversity Portal / ISRO** — forest and biodiversity (Req. 24)
9. **PMKSY and state irrigation databases** (Req. 15)

**2026-08-06 addendum — crop classification & yield estimation.** Full
methodology in `docs/CROP_YIELD_METHODOLOGY.md`, written against the
owner's 22-section platform spec that day. Same blocker as item 1 above
(no GEE service account) plus no parcel-level crop-type ground truth (CCE/
Digital Crop Survey/UPAg — none held). One real, runnable slice shipped
regardless: `scripts/crop_yield/01_fetch_icrisat_district_yield.py` pulls
the real, public ICRISAT district-level yield+climate panel (20 states,
560 districts, 1990-2015, CC BY 4.0) into `data/crop_yield/`, used as a
district-level regression target and sanity bound — not a substitute for
real parcel-level ground truth, see METHODOLOGY.md §4 for the literature-
grounded fallback (transfer learning / domain adaptation) while that
remains blocked.

Requirement 7 specifically asks for parcels drawn on real field bunds
(मेड़). That is achievable two ways: official Bhu-Naksha cadastral vectors
(preferred, legally authoritative), or field-boundary delineation from
Sentinel-2 / Cartosat imagery using edge detection or a segmentation model.
The second is a research output and must be labeled "derived, not a legal
land record."

## E. AI/ML transparency / एआई पारदर्शिता (Req. 16, 42, 44, 45)

| # | Requirement | Status | Note |
|---|---|---|---|
| 16 | Training/test data, Accuracy, RMSE, MAE, R², ROC-AUC, explainability | Planned | No trained model exists yet. The current "AI forecast" is OLS trend extrapolation and is now labeled as such, with a 95% residual band instead of injected noise |
| 42 | Confidence score, feature importance, SHAP/LIME | Planned | Applies once yield and suitability models are trained |
| 44 | Automatic PDF/Word scientific report generator | Planned | Straightforward once indicators are stable |
| 45 | Real-time GeoAI decision support system | Planned | Depends on sections C and D |

## F. Interface / इंटरफ़ेस (Req. 25, 31, 32)

| # | Requirement | Status | Note |
|---|---|---|---|
| 25 | Full Hindi and English operation | Partial | Toggle exists; coverage should be audited string by string |
| 31, 32 | Real-time DSS aligned with NABARD/ICAR/NITI standards | Planned | Institutional review after sections C–E |

## G. Removed panels — MERA_KHET_PROMPT.md Bhaag B (2026-08-09)

Eight sidebar panels were "khali" (empty placeholders, honest "Not
available" states from the 2026-08-01 audit) and made the whole portal
read as unfinished next to the real work (6.5 lakh villages, 400+
districts of real climate data). The owner's instruction: "Khali panel se
na hona behtar hai" (no panel is better than an empty one). Three were
removed outright, permanently:

| Panel | Removed | Why | Do not re-add unless |
|---|---|---|---|
| Satellite Viewer | 2026-08-09 | Pure duplication of the existing 5-basemap switcher (Satellite/Street/Terrain/Light/Dark, top-right map control) — same capability already live, a second entry point for it added nothing | a genuinely different satellite-layer capability (e.g. real Sentinel-2 band composites) is built, in which case it belongs under NDVI Analytics, not a revived standalone panel |
| Panchayat Dashboard | 2026-08-09 | No real panchayat-level vulnerability data source exists or was found; the pre-audit version had shown named Gram Panchayats with invented scores | real panchayat boundaries + a real computed index exist (see `docs/NATIONAL_SCALE_RESEARCH.md`) |
| Biodiversity Risk | 2026-08-09 | No credible biodiversity data source integrated or found; the only real figure in it (NDVI) already lives in the NDVI Analytics panel, so this panel was 100% "Not available" placeholders | a real biodiversity/forest data source (see Forest Monitor's Hansen/GFC plan below) is integrated |

Two panels stay in the sidebar, explicitly labeled "coming soon" rather
than removed (MERA_KHET_PROMPT.md's "BAAD ME" list — not farm-decision
priorities right now, but have a real, findable, free path forward):

- **Forest Monitor** — Hansen Global Forest Change is free via Google
  Earth Engine; not prioritized yet because it isn't farming-decision
  relevant. Nav item now carries a "SOON" badge.
- **PMFBY Insurance** — claim status needs a farmer login (out of scope
  for a public portal); district-level premium/claim statistics may be
  public on pmfby.gov.in — worth a real resolvability check before
  building, not yet done.

Removed from: sidebar nav items, the bottom-panel tab strip, the three
`btm-pane` blocks, `setNav()`'s routing branches, and
`mp_climate_loader.js`'s `renderEcologyPanel()` (dead code once
`pane-ecology` no longer exists). The Forest panel's own text, which
cross-referenced "the Biodiversity Risk panel," was updated rather than
left pointing at a panel that no longer exists.

## H. Soil Moisture built (MERA_KHET_PROMPT.md B1, 2026-08-09)

The sidebar's "Soil Moisture" nav item (previously "Not available — Source:
SMAP not yet integrated" everywhere) now shows real NASA SMAP L4 data
(`NASA/SMAP/SPL4SMGP/008`, ~9 km) at all four tiers (village/block/
district/state), with the real N (villages sharing a cell, cells per
district, districts computed per state) and standard deviation shown on
every aggregate, per this repo's honesty convention. Built:
`scripts/13_gee_national_soil_moisture.py` (pipeline),
`dashboard/soil_moisture_loader.js` (dashboard pane + main metric card),
`docs/DATA_SOURCES.md` (provenance row), `docs/METHODOLOGY.md` §7
(limitations #6). Benchmarked on Goa, then extended to Delhi, Chandigarh,
Puducherry and Sikkim — 22 of 733 districts as of 2026-08-09, a deliberate
partial-coverage stop per the "naapo" instruction, not a rushed national
pass. Remaining: scale to more states (state-by-state, `--resume`,
`logs/gee_soil_moisture_heartbeat.json` tracks progress the same way
`08_gee_national_climate.py`'s does).

## I. Groundwater built (MERA_KHET_PROMPT.md B2, 2026-08-09; re-checked 2026-08-12)

The "Groundwater & Irrigation" card in the Agriculture panel (nav item
"Groundwater & Irrigation" → Agriculture tab) shows two things, kept
honestly separate rather than combined into one score:

1. **Real well/tubewell-irrigated area** (`agri-gw-wells`) — summed live
   from `data/village_profiles/<state>/<district>.json`'s
   `irrigated_wells_tubewells_ha` field (Survey of India), with the real
   village count it was built from shown alongside it.
2. **Groundwater level trend** (`agri-gw-level`) — checked first, per the
   prompt's rule, whether India-WRIS or CGWB expose a public API/bulk
   download. Neither does: `indiawris.gov.in` is a form-driven Angular
   portal with no documented JSON API; CGWB's real-time water-level portal
   (`gwdata.cgwb.gov.in`) publishes no bulk machine-readable download and
   was in "Maintenance Mode" when re-checked 2026-08-12; `cgwb.gov.in`
   itself only links PDF reports (e.g. `GWRA_2025.pdf`, the Dynamic Ground
   Water Resources district assessment), not structured data. The card
   honestly reads "No public API. Source: CGWB India-WRIS. Institutional
   data request required." instead of being scraped (`gwdata.cgwb.gov.in`
   was never scraped, in or out of maintenance) or estimated. `data.gov.in`
   was also checked (same channel AGMARKNET mandi prices uses,
   `scripts/fetch_mandi_prices.py`) — its catalog/search endpoints
   return HTTP 403 to a direct, non-browser request and no CGWB
   groundwater-level `resource_id` was found; this is documented as a real
   gap, not chased further given the effort cap, and remains a candidate
   follow-up if a specific resource ID surfaces later.

Built/changed: `dashboard/index.html` (panel markup),
`dashboard/mp_climate_loader.js` (`renderWellIrrigation()` +
`renderAgriculturePanel()`), `docs/DATA_SOURCES.md` (provenance section).
Verified locally: Bhopal shows 56,429 ha across 522/522 villages, correct
honest CGWB message, no console errors.

### RESOLVED 2026-08-19 — real CGWB groundwater-level data found and shipped

The "no public API" conclusion above was correct for every source it
checked, but missed one: **National Water Data Portal**
(`nwdp.nwic.gov.in`) — the same government portal already trusted for
village boundaries — publishes CGWB's own "Ground Water Level (Manual -
Quarterly), CGWB" dataset as 95 plain CSV files, no login, no API key.
Full account of how it was found, the LGD-code join method, the
unit/sign-convention check, and the license finding: `docs/DATA_SOURCES.md`
§"Groundwater / well-irrigation", "RESOLVED 2026-08-19" subsection.

Built: `scripts/16_fetch_groundwater.py` (fetch + clean + LGD-join +
per-station OLS trend + district JSON + manifest),
`dashboard/groundwater_loader.js` (own bottom-panel tab; district/state
tiers; also overwrites `#m-gw`/`#bar-gw` on the Climate Metrics side panel
and `#agri-gw-level` in the Agriculture pane with real values once
covered), `scripts/config.py` (`GWL_SOURCE_META`,
`NATIONAL_GROUNDWATER_OUT_DIR`), sidebar "Groundwater & Irrigation" nav
item now routes to the new tab (`index.html` `setNav()`, `section ===
'ground'`) instead of only the Agriculture pane.

First full national fetch results (read `dashboard/data/groundwater/
manifest.json` for the live, regenerated numbers — summarized here from
that same run, not retyped by hand): 1,393,429 real CSV rows kept across
all 33 covered states/UTs, 0 fetch failures. **626 of 733 districts got
real CGWB station data** (36,360 stations total), **94 more districts in
those same covered states got an honest zero-station record** (state has
the dataset, this specific district has no monitored station — a real
CGWB network gap, not a fetch failure), and **Mizoram, Sikkim and Ladakh
have no dataset on NWDP at all** (confirmed absent from the fetched page
itself) and stay honestly "not available", same as before. Well/tubewell
irrigated area (item 1 above) is untouched and stays real; the two are
still never combined into one score.

## Recommended sequence

1. ~~NASA POWER integration~~ — Done, verified live 2026-08-01
2. Extend IMD record to 1995 for a 30-year normal; run four SSP scenarios in GEE
3. ~~AGMARKNET~~ — Done, verified live 2026-08-01. CGWB still open (highest remaining farmer-facing value per unit effort)
4. Vector tile service for all-India block and village boundaries
5. Bhu-Naksha cadastral agreement, then parcel-level advisory
6. Train and validate yield and crop-suitability models with full metrics

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
| 9 | Sentinel-2, Landsat, MODIS, SMAP indicators | Partial | MODIS NDVI via DiCRA present; Sentinel-2 NDVI/EVI, LST, and SMAP soil moisture require a GEE service account |
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
3. **CGWB India-WRIS** — groundwater levels (Req. 14)
4. **Soil Health Card + NBSS&LUP** — soil nutrients and health (Req. 8)
5. **Census India / Agriculture Census** — village socioeconomic profiles (Req. 6, 23)
6. **PMFBY / PM-KISAN / KCC portals** — scheme eligibility (Req. 12)
7. **FSI / India Biodiversity Portal / ISRO** — forest and biodiversity (Req. 24)
9. **PMKSY and state irrigation databases** (Req. 15)

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

## Recommended sequence

1. ~~NASA POWER integration~~ — Done, verified live 2026-08-01
2. Extend IMD record to 1995 for a 30-year normal; run four SSP scenarios in GEE
3. ~~AGMARKNET~~ — Done, verified live 2026-08-01. CGWB still open (highest remaining farmer-facing value per unit effort)
4. Vector tile service for all-India block and village boundaries
5. Bhu-Naksha cadastral agreement, then parcel-level advisory
6. Train and validate yield and crop-suitability models with full metrics

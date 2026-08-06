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

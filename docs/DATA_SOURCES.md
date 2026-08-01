# Data Provenance Register

Every layer served by the dashboard is listed here with source, resolution,
CRS, processing, and quality status. Layers not listed must not be displayed.

| Layer / file | Source | Resolution | CRS | Processing | Quality | Updated |
|---|---|---|---|---|---|---|
| `data/mp_climate_data.json` (5 districts) | IMD 0.05° gridded daily Tmax/Tmin/Precip NetCDF, 2000–2024 | ~5.5 km | EPSG:4326 | scripts 01–04: nearest-pixel village sampling, IMD heatwave criteria, SPI, ETCCDI (base 2000–2014) | Verified | 2026-07-31 |
| `data/dicra_ndvi.json` | UNDP DiCRA district NDVI zonal statistics (MODIS-derived) | district zonal | EPSG:4326 | script 07 aggregation | Verified | 2026-07-31 |
| `data/forecast_2040.json` | OLS linear trend on observed 2000–2024 annual indices, 95% residual band | district | — | script 07 (deterministic, no injected noise) | Indicative | 2026-07-31 |
| CMIP6 2040 (via scripts 05–06) | NEX-GDDP-CMIP6, 8-model ensemble, SSP2-4.5, Google Earth Engine | 0.25° | EPSG:4326 | 2036–2045 window minus 2000–2014 baseline (delta) | Verified when run | on demand |
| `mp_districts/tehsils/blocks.geojson` | MP administrative boundaries | vector | EPSG:4326 | none | Verified | as shipped |
| `data/villages_*.geojson` (5 districts) | MP village boundary shapefile (LGD-coded) | vector | EPSG:4326 | reprojected, deduplicated on Vill_LGD | Verified | as shipped |
| `data/boundaries/india_states.geojson` | Census of India 2011 (36 states/UTs, dissolved from districts) | vector, simplified 0.01° | EPSG:4326 | dissolve + Douglas-Peucker | Verified | 2026-08-01 |
| `data/boundaries/india_districts.geojson` | Census of India 2011 (760 districts) | vector, simplified 0.005° | EPSG:4326 | simplification only | Verified | 2026-08-01 |
| `data/boundaries/villages/<state>.geojson` (36 states/UTs, 654,285 villages) | Survey of India, hosted via National Water Data Portal (NWIC, Ministry of Jal Shakti) — see `data/boundaries/README.md` "Source and a naming caveat" for the GSI/SoI attribution check | vector, simplified 0.0005° | EPSG:4326 (reprojected from source EPSG:7755) | scripts `fetch_soi_villages.py` + `build_soi_village_layer.py`: Douglas-Peucker simplification, 73→11 attribute columns, per-feature simplify fallback for invalid source geometry | Verified-official | 2026-08-01 |
| `data/boundaries/subdistricts.geojson`, `blocks.geojson` | India Geodata project (LGD-sourced, community-maintained) | vector, simplified 0.001° | EPSG:4326 | Douglas-Peucker | Community-sourced, not government-published | 2026-08-01 |
| `data/mandi_prices.json` | AGMARKNET, published on data.gov.in by the Ministry of Agriculture and Farmers Welfare (resource `9ef84268-d588-465a-a308-a864a43d0070`) | APMC market, aggregated to district | not applicable (tabular) | `scripts/fetch_mandi_prices.py` on a daily GitHub Actions schedule; rows without a usable min/max/modal price, or with min above max, are dropped; nothing interpolated or carried forward | Verified | daily |
| `data/crop_stats.json` | data.gov.in, Ministry of Agriculture and Farmers Welfare, "District-wise, season-wise crop production statistics from 1997" (resource `35be999b-0208-4354-b557-f6ca9a5355de`) | district, season | not applicable (tabular) | `scripts/fetch_crop_stats.py`, monthly GitHub Actions schedule (source is static, last updated by its publisher 2021-07-13); yield is derived (production/area) by this repo, never estimated when area is 0/missing | Verified, years 1997-2013 only -- **not current-season data** | monthly check |
| Cadastral parcels | **disabled** — pending MP Bhulekh / Bhu-Naksha Revenue Dept. records | — | — | — | Not available | — |

## Market and trade sources: status

| Source | Public API | Status in this portal |
|---|---|---|
| **AGMARKNET** (agmarknet.gov.in) | Yes — via data.gov.in resource `9ef84268-d588-465a-a308-a864a43d0070`, free key by registration | **Integrated.** Daily min/modal/max price per commodity per APMC market for the five covered districts. Verified live on 2026-08-01: 32 price rows across Bhopal, Indore, Jabalpur, Rewa and Sidhi, all dated the same day. |
| **e-NAM** (enam.gov.in/web/dashboard/trade-data) | No documented public REST API found. The trade-data dashboard is a rendered web page; no bulk endpoint is published. | **Portal pointer only.** Do not scrape: the dashboard is served under portal terms, and e-NAM commodity coverage overlaps AGMARKNET, which already supplies the same trade in an authorised machine-readable form. Revisit if NIC publishes an e-NAM dataset on data.gov.in. |
| **e-CHARAK** (echarak.ayush.gov.in) | No documented public API found. It is a Ministry of AYUSH buyer–seller platform for medicinal and aromatic plants, not a price-reporting service. | **Portal pointer only.** Relevant to a future medicinal-plants module for the Vindhya region, where such cultivation is significant. Requires an institutional data request to the National Medicinal Plants Board rather than an API call. |

The rule applied to all three: cite and link the official portal, integrate
only where the publisher provides a machine-readable endpoint under terms that
permit it, and never scrape a dashboard to manufacture coverage.

## Geometry simplification for web delivery (2026-08)

Boundary vectors were simplified with the Douglas-Peucker algorithm
(topology preserving) and coordinates rounded to 5 decimal places (~1 m) to
make the portal usable on rural mobile connections.

| Layer | Tolerance | Approx. ground error | Features before / after |
|---|---|---|---|
| MP districts, tehsils, blocks | 0.001 deg | ~110 m | 5/5, 42/42, 42/42 |
| Village polygons (5 districts) | 0.0005 deg | ~55 m | 5,625 / 5,625 |
| India states, districts | precision only | ~1 m | 36/36, 760/760 |

No feature was dropped. The simplification affects boundary line detail only
and is below the 5.5 km resolution of the underlying IMD climate grid, so it
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

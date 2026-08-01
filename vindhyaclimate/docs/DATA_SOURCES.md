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
| Cadastral parcels | **disabled** — pending MP Bhulekh / Bhu-Naksha Revenue Dept. records | — | — | — | Not available | — |

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

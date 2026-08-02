# Methodology — MP Climate Intelligence System

## 1. Study area and scope

Madhya Pradesh, India. Five focus districts that span the state's climatic and agro-ecological diversity:

| District  | Centroid (lat, lon)   | Climate setting                       |
|-----------|-----------------------|---------------------------------------|
| Bhopal    | 23.260°N, 77.413°E    | Malwa plateau, central MP             |
| Indore    | 22.720°N, 75.858°E    | Western Malwa, semi-arid edge         |
| Jabalpur  | 23.181°N, 79.986°E    | Narmada basin, central                |
| Rewa      | 24.531°N, 81.297°E    | Vindhya/Baghelkhand, northeastern     |
| Sidhi     | 24.418°N, 81.881°E    | Sidhi-Singrauli belt, eastern MP      |

Historical analysis window: 2000–2024 (25 years). Future projection: 10-year window 2036–2045 centred on 2040.

## 2. Data sources

### 2.1 Historical observations — IMD 0.05° gridded NetCDF

- **Daily Tmax, Tmin (°C)** — IMD INDmet product, 0.05° × 0.05° (~5.5 km × 5.5 km)
- **Daily Rainfall (mm)** — same grid
- Yearly files, 2000–2024 inclusive
- Variables auto-detected from common name aliases (tmax/TMAX/temperature, etc.)
- Missing values (-999) masked out before any computation

### 2.2 Future projections — CMIP6 via Google Earth Engine

- Dataset: `NASA/GDDP-CMIP6` (NEX-GDDP-CMIP6: bias-corrected statistically downscaled daily data, 0.25° ≈ 25 km)
- Models (8): ACCESS-CM2, CMCC-ESM2, EC-Earth3, GFDL-ESM4, INM-CM5-0, MPI-ESM1-2-HR, MRI-ESM2-0, NorESM2-MM
- Scenario: SSP2-4.5 (middle-of-the-road emissions)
- Future window: 2036–2045 (centred on 2040)
- Baseline within same dataset: 2000–2014 (historical experiment)
- Reported value = ensemble mean; **headline metric is the delta** (future − baseline) since absolute model output carries residual bias

### 2.3 Vegetation — MODIS via GEE

- `MODIS/061/MOD13Q1` NDVI, 250 m, 16-day composite, 2018–2024 mean
- Scaled by 0.0001 to dimensionless NDVI

## 3. Sampling strategy

For each district, the daily IMD raster is spatially averaged over a **±0.1° bounding box** around the centroid. That covers approximately a 5×5 pixel block (≈ 11 km × 11 km). This avoids the noise of single-pixel sampling while keeping the value representative of the district's geographic core.

## 4. Index definitions

### 4.1 Heatwave (IMD plains definition)

A day at station/grid is a heatwave day when **either**:

1. Tmax ≥ 40°C **and** Tmax − climatological_normal ≥ 4.5°C, **or**
2. Tmax ≥ 45°C (absolute threshold)

Severe heatwave: departure ≥ 6.5°C **or** Tmax ≥ 47°C.

A heatwave **event** requires ≥ 2 consecutive days meeting the criteria. Restricted to March–June (Indian heatwave season). The climatological normal is the smoothed (15-day rolling) mean of Tmax for each day-of-year across 2000–2024.

Reported per year per district:
- `heatwave_days` — total heatwave days during runs ≥ 2 consecutive
- `severe_heatwave_days`
- `max_summer_tmax`, `mean_summer_tmax`

#### Heatwave severity badge (dashboard)

The dashboard's "Heatwave Severity" metric card classifies a district's
multi-year mean `heatwave_days`/`severe_heatwave_days` (not absolute Tmax
alone -- a hot day that doesn't meet the IMD heatwave-event criteria above
must not read as severe):

| Condition | Badge |
|---|---|
| `severe_heatwave_days_mean` ≥ 2 | EXTREME |
| `heatwave_days_mean` ≥ 8 (and not EXTREME) | HIGH |
| `heatwave_days_mean` ≥ 2 (and not HIGH/EXTREME) | MODERATE |
| otherwise | LOW |

`max_summer_tmax` is shown alongside the badge as context, not as the
classification input. See `docs/AUDIT_2026-08-01.md` P3.

### 4.2 Drought — Standardized Precipitation Index (McKee et al., 1993)

Monthly precipitation totals are fitted to a gamma distribution per calendar month using `scipy.stats.gamma.fit(positive_values, floc=0)`. Zero-precipitation months are handled with the mixed-distribution correction:

$$ H(x) = q + (1-q) \cdot G(x) $$

where q = fraction of zero months and G is the gamma CDF for positive values. SPI is then computed as the inverse standard normal CDF of H(x).

SPI is computed at three time scales: **3, 6, 12 months**.

Drought thresholds:
- SPI ≤ -1.0 → moderate drought (used for `drought_months/year`)
- SPI ≤ -1.5 → severe drought (`severe_drought_months/year`)

`drought_probability_pct` = % of months in the full record with SPI-3 ≤ -1.0.

### 4.3 Extreme Precipitation (ETCCDI indices)

Reference: Karl et al. (1999), Zhang et al. (2011). Computed per year:

| Index   | Definition                                                            |
|---------|-----------------------------------------------------------------------|
| R95p    | Annual sum of rainfall on days exceeding the 95th percentile of wet-day rainfall in the reference period |
| R99p    | Same but 99th percentile                                              |
| Rx1day  | Maximum daily precipitation in the year                               |
| Rx5day  | Maximum 5-day cumulative precipitation                                |
| CDD     | Maximum consecutive dry-day spell (rainfall < 1 mm)                   |
| CWD     | Maximum consecutive wet-day spell (rainfall ≥ 1 mm)                   |
| ETD     | Count of days exceeding 95th percentile                               |

Wet-day threshold: 1 mm. Percentile thresholds are computed from the full 2000–2024 wet-day series, then applied per year.

## 5. Future projection methodology

For each model in the ensemble:
- Filter the NEX-GDDP-CMIP6 collection by `(model, scenario, date_range)`
- Convert `tasmax` from Kelvin to °C, `pr` from kg/m²/s to mm/day
- Compute the same family of indices (heatwave days, max Tmax, R95p, Rx1day, annual rainfall)
- Average across all 8 models → ensemble mean

For each district we compute three numbers per index:
1. `future` — ensemble mean over 2036–2045
2. `baseline` — ensemble mean over 2000–2014 (historical experiment)
3. `delta = future − baseline`

The **delta is the meaningful number** for impact assessment because most CMIP6 model systematic bias survives downscaling and is largely subtracted out when you compare future to historical from the same model.

## 6. Risk classification (composite)

Each district's overall risk band (`low / moderate / high / extreme`) is a simple ordinal sum:

| Component                            | Threshold | Score |
|--------------------------------------|-----------|-------|
| `drought_probability_pct`            | ≥ 60      | +2    |
| `drought_probability_pct`            | ≥ 40      | +1    |
| `heatwave_days_mean`                 | ≥ 12      | +2    |
| `heatwave_days_mean`                 | ≥ 6       | +1    |
| `severe_drought_months_mean`         | ≥ 2       | +1    |

Total ≥ 4 → extreme, ≥ 3 → high, ≥ 1 → moderate, else low.

This is intentionally simple and replaceable. A production system would calibrate weights against historical impact data (crop loss, mortality, declared drought years).

## 7. Limitations

1. **Spatial granularity.** The IMD 0.05° grid is ≈ 5.5 km; most villages in MP are smaller than one pixel. "Village-level" outputs in this dashboard are technically pixel-level outputs labelled at the nearest village/district. This should be stated explicitly in any operational deployment.
2. **Record length.** 25 years is shorter than the WMO climate normal (30 years). The gamma fits behind SPI are noisier at the tails, and percentile thresholds for extreme precipitation have wider uncertainty bands than they would with 30+ years.
3. **Single CMIP6 scenario.** Only SSP2-4.5 is used. Operational climate-services should report at minimum SSP1-2.6, SSP2-4.5, and SSP5-8.5 with uncertainty.
4. **Ensemble size.** 8 models is the minimum defensible ensemble. CMIP6 has 40+; production work would use the full ensemble with weighting.
5. **No bias correction beyond what NEX-GDDP applies.** Quantile mapping on top would improve realism. Reporting delta-from-baseline mostly avoids this concern.
6. **No downscaling to village resolution.** The IMD grid is already as fine as we get from a public observation product. Stochastic downscaling would only smooth and add fake precision.
7. **Heatwave climatology is fitted on the same period as the analysis.** This is unavoidable with 25 years of data but means "departure from normal" is a within-sample statistic.
8. **NDVI coverage is Madhya Pradesh only.** `dashboard/data/dicra_ndvi.json` covers all 52 MP districts but none of the other 35 states/UTs -- the UNDP DiCRA platform this repo's NDVI pipeline (script 07) reads from is a manual per-district download, not an API, so it was never extended nationally. This dashboard does not display a substitute NDVI value for any district outside MP; the vegetation-stress panel says "Not available" there instead. Google Earth Engine (already integrated for Phase 3 climate indices, see #9 below) hosts MODIS NDVI (MOD13Q1) directly and is the planned route to close this gap, not a second DiCRA-style manual pipeline.
9. **National climate indices (beyond the 5 original IMD districts) use ERA5-Land + CHIRPS via Google Earth Engine, not IMD.** IMD's own 0.05° gridded product is not published on Earth Engine and no raw IMD NetCDF file is available on the machine this pipeline runs on (checked directly against `scripts/config.py`'s `IMD_TMAX_DIR`/`IMD_TMIN_DIR`/`IMD_PRECIP_DIR` before writing `scripts/08_gee_national_climate.py`). ERA5-Land (~9 km) and CHIRPS (~5.5 km) are coarser than IMD's ~5.5 km grid for temperature specifically, and are a genuinely different product, not a substitute manufactured to fill the gap -- the exact same heatwave/SPI/ETCCDI functions from `02_compute_indices.py` are applied unchanged, only the input series differs. Every such district's output JSON states this in its own metadata block; Bhopal, Indore, Jabalpur, Rewa and Sidhi are untouched and remain IMD-derived.

## 8. References

- McKee, T.B., Doesken, N.J., Kleist, J. (1993). The relationship of drought frequency and duration to time scales. AMS 8th Conf. on Applied Climatology.
- Karl, T.R., Nicholls, N., Ghazi, A. (1999). CLIVAR/GCOS/WMO workshop on indices and indicators. Climatic Change 42:3-7.
- Zhang, X. et al. (2011). Indices for monitoring changes in extremes based on daily temperature and precipitation data. WIREs Climate Change 2:851-870.
- IMD (2020). Forecasting of Heat Wave & Cold Wave Conditions. India Meteorological Department.
- Thrasher, B. et al. (2022). NASA Global Daily Downscaled Projections, CMIP6. Scientific Data 9:262.


---

## Revision note — 2026-08 accuracy audit

The following corrections were applied. Earlier outputs predating this note
should not be cited.

1. **Synthetic records removed.** 50 districts and their villages were
   previously generated by scaling and jittering the five real districts, and
   cadastral parcels with fabricated owner names were generated
   procedurally. All were served to users indistinguishably from observed
   data. They have been deleted. The dashboard now covers only the five
   districts with IMD-derived values. A CI check blocks reintroduction of
   random generation in pipeline scripts.

2. **ETCCDI base period fixed.** R95p and R99p percentile thresholds were
   computed over the entire 2000-2024 record, meaning each year was scored
   against a distribution that included itself. Thresholds are now derived
   from a fixed 2000-2014 base period, per ETCCDI convention.

3. **SPI sample requirement raised.** The gamma fit previously accepted 10
   samples per calendar month. It now requires 15. The WMO recommendation is
   30 years; with a 25-year record the fit remains less stable than standard
   and SPI-12 values in particular should be read as indicative.

4. **Forecast noise removed.** The 2025-2040 trend projection injected
   pseudo-random noise with an expanding cone, and district headline numbers
   applied arbitrary multipliers (1.15x drought probability, +1.8 degrees C,
   1.8x heatwave days). The projection is now a deterministic OLS trend with
   a 95% band derived from historical residuals, and headline numbers carry
   the observed baseline forward. Scenario deltas must come from the CMIP6
   Earth Engine workflow, not from multipliers.

5. **Reproducibility.** Absolute Windows paths were replaced with
   environment variables; requirements.txt now lists the full dependency set
   rather than Streamlit alone; the hardcoded API key fallback was removed.

### Standing limitations

Village indices are nearest-pixel samples of a 5.5 km grid, not polygon
zonal means, so villages sharing a pixel receive identical values. The
record is 25 years against a 30-year WMO normal. A single scenario
(SSP2-4.5) is implemented. These are documented rather than concealed, and
`config.VILLAGE_SAMPLE_METHOD` is scaffolded for the polygon upgrade.

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

### 3.1 Spatial resolution and the modifiable areal unit problem

This section exists because the honest answer to "what is a village's climate
value" is not "the village's own measurement" -- no product publishes one --
and that needs to be stated precisely, not glossed over.

**The resolution gap is real and structural, not a shortcoming of this
pipeline specifically.** ERA5-Land is ~9-11 km, CHIRPS is ~5.5 km, IMD's own
gridded product is ~5.5 km (0.05°). A typical Indian village is on the order
of ~2 km². By basic 2D sampling theory a grid cell resolves phenomena at
roughly 2x its nominal spacing in each dimension, i.e. a "10 km" product
genuinely resolves ~20 km x 20 km (400 km²) features, not 10 km ones. India's
own national dynamical-downscaling effort settled on 10 km specifically
because that is the achievable scale given the country's district sizes and
available computing -- not because finer wasn't wanted (Barik et al., 2024,
*Geoscience Data Journal*, doi:10.1002/gdj3.266). **No publicly available
gridded climate product -- global or Indian -- has genuine village-level
(sub-km) resolution.** This is the field's real ceiling, not this pipeline's.

**What this pipeline actually does, and does not do:** every village-level
value in this dashboard is **the value of the grid cell whose footprint
contains that village's centroid** (or, for a village whose polygon spans
multiple cells, the area-weighted mean across the cells it overlaps -- see
the per-file `pixel_count`/`villages_sharing_pixel` metadata once populated,
tracked in `scripts/08_gee_national_climate.py` and the village-level
follow-on). **This is not sub-kilometre downscaling, and is never presented
as one.** Because one grid cell is roughly 25-120x a single village's area,
dozens of neighbouring villages routinely share the identical pixel value --
that is expected, not a bug, and is exactly why every aggregate in this
pipeline reports how many real units (villages, pixels) it was built from
alongside the mean, never the mean alone (see `docs/DATA_SOURCES.md` and
FINAL_PROMPT.md Phase 8.2).

**This is a named, general problem, not something specific to climate
rasters:** fitting areal/grid data onto a different set of administrative or
enumeration units is the **Modifiable Areal Unit Problem (MAUP)** --
statistics computed this way are sensitive to the arbitrary choice of unit
boundaries, and a reviewer will use exactly this term. Citing it by name here
is so a future contributor recognises the pattern immediately rather than
rediscovering it.

**The bias is not uniform, so a single accuracy number is misleading.**
Validation of CHIRPS against IMD gauges over South Peninsular India,
2001-2020, found r = 0.888, RMSE = 180 mm overall (ScienceDirect,
doi in record S2950-1172-2600021X) -- but with a clear **positive bias on
the windward slopes of the Western Ghats** and **near-zero bias in the
interior semi-arid tracts**. Reporting one national correlation number
without this spatial structure would overstate confidence in the
orographically-exposed districts specifically. ERA5-Land needs bias
correction in India too -- Himalayan-basin studies report RMSE reductions of
up to ~86% after a regression/GAM correction against station data. Neither
correction is applied in this pipeline yet (§7 item 5); §8.6 (validation
files, `data/validation/<state>/<district>.json`) is where CHIRPS/ERA5 get
checked against IMD per district rather than assumed accurate everywhere.

## 4. Index definitions

### 4.1 Heatwave (IMD plains definition)

A day at station/grid is a heatwave day when **either**:

1. Tmax ≥ 40°C **and** Tmax − climatological_normal ≥ 4.5°C, **or**
2. Tmax ≥ 45°C (absolute threshold)

Severe heatwave: Tmax ≥ 40°C **and** departure ≥ 6.5°C, **or** Tmax ≥ 47°C.
(The Tmax ≥ 40°C precondition on the departure branch is the IMD rule and is what `scripts/02_compute_indices.py`'s `heatwave_for_village()` actually applies — this line previously omitted it, which read as a looser criterion than the code has ever used. Corrected 2026-09-02.)

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

For a month whose total is exactly zero, H(x) is not single-valued (the whole probability mass q sits at that one point), so the code assigns it **q/2** — the midpoint of the zero atom, the standard convention. H(x) is then clipped to [1e-6, 1−1e-6] before the normal inverse so an all-zero or all-wet month cannot produce ±∞. Both details are in `_spi_from_monthly()`; documented here 2026-09-02 so the published SPI is reproducible from this file alone.

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

Wet-day threshold: 1 mm. Percentile thresholds are computed from the wet-day series of the **fixed 2000–2014 base period** and then applied to every year, per ETCCDI convention — so a year is never scored against a distribution that includes itself. (`EXT_PRECIP_BASE_PERIOD` in `scripts/config.py`; `extreme_for_village()` falls back to the full record only if the base period somehow holds fewer than 5 years of days.) **This line previously said the thresholds came from the full 2000–2024 record**, which contradicted both the code and revision note 2 below; it was stale text left behind by that very fix. Corrected 2026-09-02.

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

**Max-type indices are the mean of the per-year maxima, not the maximum over
the window** (`_mean_annual_max()` in both CMIP6 scripts). This matters
because the two windows are different lengths: 10 years for the future,
15 for the baseline. A plain window maximum grows with window length — a
15-year baseline simply has more chances to contain an extreme than a
10-year future window — so `future.max() − baseline.max()` carried a
systematic negative bias that was an artefact of the window lengths rather
than a climate signal. It was found live on 2026-09-02: Bhopal's published
`delta_rx1day_mm` was **−189.9 mm against a future Rx1day of 152.6 mm**,
implying a 15-year baseline maximum of 342.5 mm and reading on screen as a
large projected *drop* in extreme rainfall. Averaging the per-year maxima is
window-length invariant and is the ETCCDI Rx1day/TXx definition §4.3 already
specifies. Affects `max_summer_tmax` and `rx1day_mm` only; hot-day counts,
annual rainfall and R95p were already per-year rates and were never affected.

### 5.1 "Hot days" in the CMIP6 layer are NOT IMD heatwave days

The CMIP6 scripts compute a **plain count of March–June days with Tmax ≥
40 °C**, divided by the number of years. That is a *hot-day count*. It is
**not** the IMD heatwave-event index of §4.1, which additionally requires a
≥ 4.5 °C departure from the day-of-year normal **and** a run of ≥ 2
consecutive qualifying days.

The two are an order of magnitude apart for the same place — Bhopal's
observed IMD heatwave days average **0.4 per year**, while its CMIP6
hot-day count is **≈ 38 per year in the baseline window**. Until 2026-09-02
both were rendered on adjacent panels under the identical label "HEATWAVE
DAYS/YR", which invited the reader to infer a ~100× increase that does not
exist and was never claimed by either number. The output field is now called
`hot_days_tmax_ge40_per_yr` and the dashboard card reads "HOT DAYS/YR (TMAX
≥ 40 °C)" with the distinction stated in the panel footer.

The full IMD definition is not reproduced in the CMIP6 layer because the
consecutive-run and day-of-year-departure logic is a poor fit for Earth
Engine's server-side image algebra, and because **the delta is the reported
quantity anyway**: future minus baseline under one consistent definition is
meaningful regardless of which threshold defines "hot", whereas the absolute
count is not comparable to the observed IMD series and should not be read
against it.

### 5.2 Two CMIP6 pipelines, and which one is authoritative

Two scripts produce CMIP6 2040 output. They run the **identical** 8-model
NEX-GDDP-CMIP6 ensemble, the same SSP2-4.5 scenario, the same 2036–2045 vs
2000–2014 windows and the same index definitions. The only difference is the
spatial unit they reduce over:

| | `scripts/05b_run_cmip6_2040.py` | `scripts/09_gee_national_cmip6_2040.py` |
|---|---|---|
| Coverage | the 5 original IMD districts | all 733 districts |
| Spatial unit | 5 km buffer around one centroid **point** | the district's real Survey of India **polygon** |
| Output | `mp_climate_data.json` → `future_2040` | `data/cmip6_2040/<state>/<district>.json` |
| Written | 2026-09-01 (this project's first real CMIP6 result) | 2026-09-01 |

Compared directly for the same 5 districts on 2026-09-02 they agree closely
— hot days within 0.5–3.6 d/yr, peak Tmax within 0.3 °C, annual rain within
6 %, R95p within 8 %; Rx1day differs most (up to ~25 %), which is expected of
a single-maximum statistic sampled over two different footprints. So neither
was wrong, and this is a refinement rather than a contradiction.

**The polygon version (09) is authoritative for all 733 districts,
including the original 5.** It measures the district rather than a disc near
its middle, and it is the same spatial unit every other district-level layer
in this portal already uses, so one method now covers the whole country. As
of 2026-09-02 `dashboard/national_cmip6_loader.js` renders every district
including those 5 (its previous skip-the-5 branch is gone), and
`mp_climate_loader.js`'s `renderFuturePanel()` no longer draws a competing
version of the same panel.

`future_2040` is deliberately **retained** in `mp_climate_data.json`, flagged
`superseded_by`, rather than deleted: it is a real computed result and
deleting real results is not how provenance works here. It is no longer
rendered anywhere.

The **delta is the meaningful number** for impact assessment because most CMIP6 model systematic bias survives downscaling and is largely subtracted out when you compare future to historical from the same model.

**Run status (2026-09-01):** this workflow has now actually been executed for
all 5 districts, via `scripts/05b_run_cmip6_2040.py` -- a Python port of
`scripts/05_gee_cmip6_2040.js` that calls the Earth Engine Python API directly
(same computation, same 8-model ensemble, same windows) instead of pasting the
script into the GEE Code Editor and exporting to Drive by hand; the result set
is small enough (5 districts) for a single synchronous `getInfo()` call. Real
results are in `dashboard/data/mp_climate_data.json` under each district's
`future_2040` key (see the `metadata.cmip6_projection` block in that same
file for source/scenario/ensemble/window) and render in the "2040 PROJECTION
METHOD" panel and the district detail view wherever `mp_climate_loader.js`
reads `future_2040`. This is a live physical-model scenario, separate from
and in addition to the deterministic OLS trend in `forecast_2040.json`
(still labelled INDICATIVE, and still the only projection shown for districts
outside these original 5).

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

This is intentionally simple and replaceable. A production system would
calibrate weights against historical impact data (crop loss, mortality,
declared drought years).

**It is a labelled ordinal band, not a calibrated risk model, and must never
be presented as one.** The thresholds above are an editorial choice; no
weight in the table was fitted to any observed outcome, and the resulting
`low/moderate/high/extreme` label carries no probability, no return period
and no confidence interval. Verified 2026-09-02 that `classify_risk()` in
`scripts/04_build_dashboard_json.py` is the **only** implementation of this
table anywhere in the repo — it is not replicated client-side in
`national_selector.js`, `geoai_professional.js` or any loader, so the code
and this table cannot drift apart.

Also corrected 2026-09-02: `dashboard/index.html`'s `MP_DISTRICTS` table used
to carry hardcoded `risk:"moderate"`/`"extreme"` literals (plus `drought`,
`heat` and `ndvi` literals) as pre-fetch defaults. None matched what this
scoring actually produces — the real computed band is `low` for all five
districts, against literals claiming `moderate` and `extreme` — so any failed
or slow fetch of `mp_climate_data.json` displayed an invented risk band that
was indistinguishable from a computed one. The literals are gone; the fields
are now absent until the real file populates them, and every consumer already
guards on `!= null`.

## 7. Limitations

1. **Spatial granularity (MAUP).** The IMD 0.05° grid is ≈ 5.5 km; most villages in MP are smaller than one pixel. "Village-level" outputs in this dashboard are technically pixel-level outputs labelled at the nearest village/district. See §3.1 for the full treatment (why no product resolves true village scale, the modifiable areal unit problem by name, and the non-uniform CHIRPS/ERA5 bias found in the literature) -- stated explicitly here and in every affected output file's metadata, not just this one line.
2. **Record length.** 25 years is shorter than the WMO climate normal (30 years). The gamma fits behind SPI are noisier at the tails, and percentile thresholds for extreme precipitation have wider uncertainty bands than they would with 30+ years.
3. **Single CMIP6 scenario.** Only SSP2-4.5 is used. Operational climate-services should report at minimum SSP1-2.6, SSP2-4.5, and SSP5-8.5 with uncertainty.
4. **Ensemble size.** 8 models is the minimum defensible ensemble. CMIP6 has 40+; production work would use the full ensemble with weighting.
5. **No bias correction beyond what NEX-GDDP applies.** Quantile mapping on top would improve realism. Reporting delta-from-baseline mostly avoids this concern.
6. **No downscaling to village resolution.** The IMD grid is already as fine as we get from a public observation product. Stochastic downscaling would only smooth and add fake precision.
7. **Heatwave climatology is fitted on the same period as the analysis.** This is unavoidable with 25 years of data but means "departure from normal" is a within-sample statistic.
8. **NDVI coverage is Madhya Pradesh only, plus a small MODIS/GEE start elsewhere.** `dashboard/data/dicra_ndvi.json` covers all 52 MP districts (UNDP DiCRA, manual per-district download, not an API). Since 2026-08-08, `scripts/10_gee_national_ndvi.py` (MODIS MOD13Q1 v061 via Google Earth Engine, real per-year district-mean NDVI) has begun closing the rest of the country, benchmarked and run for one state (see `NIGHT_LOG.md` for the exact district count/timing) -- still a small fraction of the ~680 remaining non-MP districts. Every district still lacking a file (either source) shows "Not available", never a substitute value. The two NDVI sources are served from separate files/loaders (`dicra_ndvi.json`+`dicra_ndvi_loader.js` vs `dashboard/data/ndvi/`+`national_ndvi_loader.js`) and are never merged into one number.
9. **National climate indices (beyond the 5 original IMD districts) use ERA5-Land + CHIRPS via Google Earth Engine, not IMD.** IMD's own 0.05° gridded product is not published on Earth Engine and no raw IMD NetCDF file is available on the machine this pipeline runs on (checked directly against `scripts/config.py`'s `IMD_TMAX_DIR`/`IMD_TMIN_DIR`/`IMD_PRECIP_DIR` before writing `scripts/08_gee_national_climate.py`). ERA5-Land (~9 km) and CHIRPS (~5.5 km) are coarser than IMD's ~5.5 km grid for temperature specifically, and are a genuinely different product, not a substitute manufactured to fill the gap -- the exact same heatwave/SPI/ETCCDI functions from `02_compute_indices.py` are applied unchanged, only the input series differs. Every such district's output JSON states this in its own metadata block; Bhopal, Indore, Jabalpur, Rewa and Sidhi are untouched and remain IMD-derived.
10. **ERA5-Land/CHIRPS are validated against IMD for the 5 original districts, not assumed accurate.** `scripts/11_build_validation.py` (Phase 8.6) pulls the same ERA5-Land/CHIRPS series used for the national climate layer above, for Bhopal/Indore/Jabalpur/Rewa/Sidhi specifically, and computes real Pearson correlation, mean bias, and RMSE against those districts' actual IMD `annual_trends` numbers (`dashboard/data/validation/madhya_pradesh/*.json`). This checks the national layer's plausibility on the one set of districts where a ground-truth IMD series exists; it is not a claim that the same skill holds everywhere ERA5-Land/CHIRPS are used nationally -- that would need IMD data for those districts too, which is exactly what's unavailable (see #9).
11. **CMIP6 "hot days" and observed IMD "heatwave days" are different
    indices and are not comparable.** See §5.1. The CMIP6 layer counts
    March–June days with Tmax ≥ 40 °C; the observed layer applies the full
    IMD heatwave-event definition (departure ≥ 4.5 °C plus a ≥ 2-day run).
    Only the CMIP6 *delta* (future − baseline, one consistent definition on
    both sides) is meaningful; its absolute value must not be read against
    the observed series.

12. **CMIP6 max-type indices were window-length biased before 2026-09-02.**
    See §5. `max_summer_tmax` and `rx1day_mm` were the single maximum over
    each window, and the two windows are unequal (10 future vs 15 baseline
    years), so their published deltas were biased low. The scripts now
    average the per-year maxima. Any district file that does **not** carry a
    `metadata.max_index_definition` block predates this fix and still holds
    the old values; `national_cmip6_loader.js` detects exactly that and
    prints a visible provisional-delta warning on those two cards rather
    than showing a number it knows to be biased.

13. **The CMIP6 spatial unit changed for 5 districts on 2026-09-02.** See
    §5.2. Bhopal, Indore, Jabalpur, Rewa and Sidhi were previously served
    from a 5 km-buffer-around-centroid computation and are now served from
    their real Survey of India district polygon, like every other district.
    Numbers shift slightly (hot days within 3.6 d/yr, peak Tmax within
    0.3 °C); anything citing those five districts' 2040 projection from
    before that date should be re-checked against the polygon values.

14. **Kisan Sahayak citation policy: citations are generated from retrieved documents only, never by the model.** See the dedicated sub-section below -- this is a considered, code-enforced design decision, not a gap to be "fixed" by asking the model to cite more carefully.

### 7.1 Kisan Sahayak citation policy (added 2026-08-08; item 14 above)

Live testing of `cloudflare/kisan_sahayak_worker.js` (the chat Worker) found the
model inventing plausible-sounding citations -- a fabricated manual title
("मौसम विज्ञान मैनुअल, आईएमडी, 2019") that does not exist -- **despite explicit,
repeated prompt instructions not to.** This confirmed the owner's assessment:
prompt-only instructions ("don't invent a citation") are not reliable enough
on their own for a farmer-facing feature, because a language model sometimes
follows a negative instruction and sometimes doesn't, and a fabricated
citation is worse than a fabricated number -- it manufactures false
credibility that a farmer has no way to check.

The fix is enforced in **code**, not prompt wording, in three independent
layers (all in `cloudflare/kisan_sahayak_worker.js`):

1. **The model is told to never write a citation at all.** `buildSystemPrompt()`
   explicitly forbids writing the words "Source"/"स्रोत", any
   organisation-name-plus-year parenthetical, `et al.`, or an `[M#]`/`[P#]`
   tag -- this reduces how often the model tries, but is not relied upon to
   fully work.
2. **`stripFakeCitations()`** regex-removes any citation-shaped text from the
   model's raw streamed output before it ever reaches the client -- whether
   or not layer 1 worked. Applied to safely-buffered chunks (on newline
   boundaries, never mid-token) so a pattern can never be split across a
   flush in a way that lets half of it through unfiltered.
3. **`buildCitationFooter()`** appends exactly one real citation block after
   the model's answer, generated entirely from what was **actually
   retrieved** by the deterministic data prefetch (climate/weather/mandi/
   crop/village) and the `search_manuals`/`search_papers` tools -- never
   from anything the model wrote. It further checks whether the answer text
   shows real evidence a given source's specific number was actually used
   (`answerMentionsNumber`/`answerMentionsAny`) before citing it, so a
   source that was fetched but irrelevant to the question isn't listed. If
   nothing real was retrieved, the footer says so honestly: "यह सामान्य कृषि
   जानकारी है, किसी दस्तावेज़ से उद्धृत नहीं" / "This is general agricultural
   knowledge, not quoted from any specific document" -- an honest label is
   better than false authority.

Once `search_manuals` (Cloudflare Vectorize, see `docs/KISAN_SAHAYAK_RAG.md`)
is populated and deployed, real manual/paper citations will appear
automatically through layer 3, because they come from an actually-retrieved
document, not from the model claiming one exists. **Do not revert this to a
prompt-only approach** -- verified live 2026-08-08 that prompt instructions
alone let a real fabricated citation through; the code-enforced version was
tested clean across 4 real questions (rainfall, pest, soil testing, a
government scheme) with zero fabricated sources.

## 8. References

- McKee, T.B., Doesken, N.J., Kleist, J. (1993). The relationship of drought frequency and duration to time scales. AMS 8th Conf. on Applied Climatology.
- Karl, T.R., Nicholls, N., Ghazi, A. (1999). CLIVAR/GCOS/WMO workshop on indices and indicators. Climatic Change 42:3-7.
- Zhang, X. et al. (2011). Indices for monitoring changes in extremes based on daily temperature and precipitation data. WIREs Climate Change 2:851-870.
- IMD (2020). Forecasting of Heat Wave & Cold Wave Conditions. India Meteorological Department.
- Barik, A. et al. (2024). A high-resolution dynamically downscaled climate
  dataset for India. *Geoscience Data Journal*. doi:10.1002/gdj3.266 --
  basis for §3.1's "10 km is the achievable scale, not a choice" claim and
  the sampling-theory argument (a 10 km product resolves ~20 km features).
- CHIRPS vs IMD validation, South Peninsular India 2001-2020 (r=0.888,
  RMSE=180mm, non-uniform bias -- positive on Western Ghats windward
  slopes, near-zero in interior semi-arid tracts). ScienceDirect, record
  S2950-1172-2600021X.
- ERA5-Land bias correction, Himalayan basin studies (RMSE reduction up to
  ~86% after regression/GAM correction against station data) -- cited in
  §3.1 as the reason ERA5-Land is not used uncorrected in any downstream
  claim of absolute accuracy, only as an internally-consistent time series.
- Thrasher, B. et al. (2022). NASA Global Daily Downscaled Projections, CMIP6. Scientific Data 9:262.

## 9. Advisory layer (derived, rule-based) — added 2026-08-12

PENDING.md item 13. `scripts/15_build_advisory.py` combines this portal's
own already-published, already-verified pipeline outputs (Sections 2-5
above, plus soil moisture — MERA_KHET_PROMPT.md B1) into four
plain-language flags per district: `heatwave_risk`, `drought_risk`,
`vegetation_stress`, `irrigation_need`. Output:
`dashboard/data/advisory/<state_slug>/<district_slug>.json`, rendered by
`dashboard/advisory_loader.js`.

**This layer is explicitly NOT a machine-learning model, and reports no
confidence/probability score of its own.** Every flag is a fixed,
code-defined threshold applied to one or more numbers this repo already
computed and published elsewhere — the exact source file and field name(s)
are recorded in each flag's own `basis` object, and the exact numeric
threshold crossed is stated in its `note` string, so every flag is
auditable back to a real stored value, never a re-estimate. A district with
no real climate file has no advisory file at all (climate is the mandatory
minimum input); a district with climate but no NDVI/soil-moisture file
simply omits that one flag rather than guessing — partial coverage is
explicit per field, never per district.

### 9.1 heatwave_risk

Reuses, verbatim, the same LOW/MODERATE/HIGH/EXTREME bands already shown on
the district climate panel (`national_climate_loader.js`'s
`applyGeeMetrics()`), applied to `heatwave_days`/`severe_heatwave_days`
from `dashboard/data/climate/<state>/<district>.json` (726 districts,
ERA5-Land/CHIRPS via GEE) or `dashboard/data/mp_climate_data.json`
(`heatwave_days_mean`/`severe_heatwave_days_mean`, the 5 real IMD
districts):

| Condition | Level |
|---|---|
| `severe_heatwave_days >= 2` | EXTREME |
| `heatwave_days >= 8` | HIGH |
| `heatwave_days >= 2` | MODERATE |
| else | LOW |

### 9.2 drought_risk

A standalone drought-only categorisation using `drought_probability_pct`
(pipeline output) and the **real, existing** SPI thresholds already defined
in `scripts/config.py` (`DROUGHT_SPI_THRESHOLD=-1.0`,
`SEVERE_DROUGHT_SPI=-1.5`) — reused, not redefined. Deliberately distinct
from Section 6's composite district risk score above, which combines heat
+ drought into one number and is not meant as a standalone drought scale:

| Condition | Level |
|---|---|
| `drought_probability_pct >= 40` OR `spi_12 <= -1.5` | HIGH |
| `drought_probability_pct >= 20` OR `spi_12 <= -1.0` | MODERATE |
| else | LOW |

### 9.3 vegetation_stress (only when an NDVI file exists)

Only computed where a real NDVI file exists for the district —
`dashboard/data/dicra_ndvi.json` (UNDP DiCRA, MP's districts) or
`dashboard/data/ndvi/<state>/<district>.json` (MODIS/GEE, from the ongoing
`scripts/10_gee_national_ndvi.py` background run — coverage grows on the
next run of `15_build_advisory.py`, never waited on). The district's
**own** real per-year mean NDVI is grouped by calendar year; the latest
year is compared against the mean/stddev of that same district's own
*prior* years (a real relative comparison, never an absolute "good/bad"
judgement invented from nothing):

```
z = (latest_year_mean - mean(prior_years)) / stddev(prior_years)
z <= -1.0   -> HIGH   (below normal)
z <= -0.5   -> MODERATE
else        -> LOW
```

If `stddev(prior_years) == 0` (fewer than 2 usable prior years to get a
real spread), falls back to a percent-departure metric (`<=-10% -> HIGH`,
`<=-5% -> MODERATE`) instead of a division by zero. Requires at least 1
prior year to exist at all; a district with only 1 year of NDVI ever gets
no `vegetation_stress` flag (no baseline to compare against).

**Partial-year guard.** A "latest year" whose real composite count is
below 60% of the district's own typical composite count (e.g. a
mid-calendar-year DiCRA read that only has Jan–Apr composites so far, vs.
~23/yr typical) is a partial year, not a full year — comparing it against
a historical *full-year* mean systematically biases the result toward
looking artificially low, because full-year means include the lush monsoon
months a partial dry-season year hasn't reached yet. Rather than silently
comparing anyway (which would have been a genuine "invented risk number"
bug of exactly the kind Section 7 above warns about) or dropping the flag
(a farmer still wants a current read), the flag is computed **and**
labelled `"partial_year": true` in `basis`, with an explicit caution
sentence prepended to `note`, and severity is capped at MODERATE — a
seasonal artifact can never present as a false HIGH.

### 9.4 irrigation_need (only when a soil-moisture file exists)

Only computed where `dashboard/data/soil_moisture/<state>/<district>.json`
exists (733/733 districts as of 2026-08-12). Reuses, verbatim, the exact
fixed reference band already live in `dashboard/soil_moisture_loader.js`'s
`irrigationHint()` — not a new threshold invented for this layer:

| Condition (`district.sm_surface_mean`) | Level |
|---|---|
| `< 0.15` | HIGH (irrigate soon) |
| `< 0.30` | MODERATE |
| else | LOW |

The SMAP pipeline stores a current ~5-day observation window only, no
per-district historical time series — so "relative to recent values" here
means the same generic reference band the Soil Moisture tab already shows
(explicitly labelled a fixed threshold, not a trend), not a fabricated
history that doesn't exist in the underlying data.

### Tier scope

**District tier only**, in this pass, and documented as such rather than
rushed to a shaky 4-tier version. Village/block aggregation is a
**documented next step, not yet built**: the climate and NDVI pipelines
this layer reads have no sub-district output at all to aggregate (unlike
soil moisture, which has a real village→block→district breakdown from
SMAP-cell-nearest-village matching). Building a consistent sub-district
advisory would mean either (a) waiting for a genuinely sub-district climate
product, or (b) explicitly documenting that a village/block "advisory"
would just be its parent district's value relabelled, which is not a real
finer-grained result and should not be presented as one. The state tier
(`dashboard/advisory_loader.js`, computed client-side, never precomputed)
is a real per-flag-level **count** across the state's computed districts —
deliberately NOT the mean+stddev convention used for continuous soil
moisture/climate numbers elsewhere (FINAL_PROMPT.md Phase 8.2), because a
categorical LOW/MODERATE/HIGH/EXTREME flag has no meaningful mean; a full
count distribution is its honest equivalent.

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

6. **Soil moisture (MERA_KHET_PROMPT.md B1, `scripts/13_gee_national_soil_moisture.py`)
   is coarser than the climate layer above, deliberately shown that way.**
   SMAP L4's real native grid is ~9 km (vs. the climate layer's 5.5-9 km) --
   one grid cell routinely covers dozens of villages (observed range in the
   22 districts computed so far: 1 to 24+ villages per cell). Every tier
   states this explicitly and the village tier always shows the real count
   of villages sharing its cell, never a village-specific number. Nearest-
   cell assignment for villages uses plain lon/lat distance (not geodesic),
   an approximation acceptable at this grid spacing and consistent with the
   existing `VILLAGE_SAMPLE_METHOD="centroid"` convention above. State tier
   is a mean of whichever district means are computed so far, not a
   national SMAP query -- coverage is intentionally partial (22 of 733
   districts as of 2026-08-09, see `docs/DATA_SOURCES.md`) and always shown
   against the real total, per MERA_KHET_PROMPT.md's "naapo" (measure
   first) instruction rather than rushed to national scale in one pass. The
   in-dashboard irrigation hint ("dry / moderate / adequate") is a fixed,
   code-defined volumetric-moisture reference band, not a per-place model
   output -- explicitly labelled as varying by soil texture, not a
   substitute for field-specific agronomic advice.

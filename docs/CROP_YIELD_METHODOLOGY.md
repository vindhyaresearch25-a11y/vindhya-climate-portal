# Crop Classification & Yield Estimation — Methodology

## Status: framework design, not yet operational

This document is the methodology for the parcel-to-national crop mapping and
yield estimation extension to VINDHYA (owner spec, 2026-08-06 — see the
22-section platform requirement pasted into the working session that day).
It is written the way `docs/METHODOLOGY.md` and `docs/REQUIREMENTS_ROADMAP.md`
are written: every design choice below is grounded in a real, cited,
peer-reviewed or officially-published source (§8), not invented. It follows
the same rule as the rest of this repo — **no synthetic data, ever** — which
means this document is honest about what is a literature-grounded *design*
today versus what is *running* today. Nothing here should be read as "this
platform already estimates yield." It does not yet. §7 states precisely
what is blocked and on what.

This is not a duplicate of `docs/REQUIREMENTS_ROADMAP.md` §D (item 1, "GEE
service account... crop classification") — that entry is a one-line roadmap
status. This document is the methodology that entry now points to.

## 1. Why this design, not a different one

Three literature findings drove every architectural choice in §2–§6:

1. **SAR+optical fusion beats either sensor alone in smallholder systems.**
   A 2026 systematic study of crop-type classification across smallholder
   farms in Central and South Asia found Sentinel-1 (SAR) is particularly
   effective for structurally distinct crops (e.g. cotton), Sentinel-2
   (optical) substantially improves classification of spectrally similar
   crop classes, and combining both consistently outperforms either alone —
   with monthly temporal aggregation adding another 1–3 percentage points
   and feature selection a further 2–5 points (Nasrallah et al., 2026,
   *Remote Sensing Applications: Society and Environment*). An earlier
   eastern-India study using Sentinel-1 + Sentinel-2 + PlanetScope reached
   85% accuracy classifying maize, mustard, tobacco and wheat with an SVM
   (Jin et al., 2021, *Remote Sensing* 13(10):1870). This is why §3 fuses
   SAR and optical rather than picking one.

2. **Parcel size and feature selection materially change accuracy, and this
   is measurable, not assumed.** Comparative work on SAR-optical fusion
   found accuracy is sensitive to parcel size and which spectral/temporal
   features are kept (Blickensdörfer et al., 2022, in review at *Remote
   Sensing of Environment*) — meaning the same model can perform
   differently on VINDHYA's own smallholder MP parcels than on the paper's
   study area, and that has to be measured against local ground truth (§4),
   not assumed to transfer.

3. **Ground truth scarcity is the field's normal starting condition, not a
   VINDHYA-specific gap, and transfer/domain-adaptation is the literature's
   answer, not an improvisation.** Multiple independent lines of work
   address exactly this: interseasonal transfer learning on Sentinel-1 time
   series (Wang et al., 2024, *Int. J. Applied Earth Observation and
   Geoinformation*); unsupervised domain adaptation via adversarial
   self-training, "STDAN" (Wang et al., 2022, *Remote Sensing* 14(18):4639);
   self-supervised pretraining on unlabeled satellite image time series
   before fine-tuning on the few local labels available (see review in
   Xu et al., 2025, arXiv:2507.12590, "Best Practices for Large-Scale,
   Pixel-Wise Crop Mapping and Transfer Learning Workflows"). This is the
   literature basis for the fallback hierarchy in §4.2 — it is not a
   workaround invented because VINDHYA lacks CCE access, it is the
   field-standard response to exactly that situation.

## 2. Data sources — what's real and already in this repo vs. what's blocked

| Layer | Status here | Real source |
|---|---|---|
| Village/block/district boundaries | **Already real, already in repo** | Survey of India via NWDP, `dashboard/data/boundaries/soi/` — 654,285 villages, 36/36 states (see `dashboard/data/boundaries/README.md`) |
| Cadastral (khasra) parcels | **Blocked** — no source connected | Needs MP Bhulekh/Bhu-Naksha data-sharing agreement (already flagged blocked in `docs/REQUIREMENTS_ROADMAP.md` §D item 2) |
| Sentinel-1/2, Landsat, MODIS, SMAP, DEM, SoilGrids | **Blocked** — no GEE service account configured on this machine | Google Earth Engine (`GEE_SERVICE_ACCOUNT_JSON` env var, not yet set — see `scripts/config.py` pattern used by every other GEE script in this repo) |
| CHIRPS, ERA5-Land | **Blocked**, same reason | Via GEE, same credential |
| NASA POWER daily weather | **Already real, already in repo** | `geoai_professional.js loadNasaPower()` — live daily Tmax/Tmin/rain/RH, no key required |
| District-level crop area/production (season-wise) | **Already real, already in repo** | `scripts/fetch_crop_stats.py` — data.gov.in resource `35be999b-…`, Ministry of Agriculture, all 733 districts, see its own docstring for the 2021-07-13 freshness caveat |
| Farm/parcel-level crop-type ground truth | **Blocked** — none held | See §4 for what's realistically obtainable and what fallback the literature recommends meanwhile |
| District-level yield + climate panel (usable *now* as a coarse ground-truth proxy) | **Real, public, not yet fetched into this repo** | ICRISAT District Level Database, Mendeley Data (Nedumaran et al.) — decades of district-level yield across major Indian crops, freely downloadable, no application/credential needed |

## 3. Pipeline design (parcel → national), literature-grounded

Mirrors the owner spec's 22 sections; each stage names the paper/standard
behind the choice, and its current status.

1. **Boundary ingestion + repair** (spec §1) — reuse the SoI boundary
   pipeline already in this repo (`scripts/build_soi_village_layer.py`,
   `scripts/fetch_soi_villages.py`) rather than building a second one.
   Geometry repair (invalid rings, multipart, CRS mismatch) via
   `shapely.validation.make_valid` / GDAL `ogr2ogr -makevalid`, the
   standard tools for this, not a bespoke repair routine.
2. **GEE connection** (spec §2) — `ee.Initialize()` via a service-account
   JSON, the standard non-interactive GEE Python authentication path for
   scheduled/headless jobs (Earth Engine's own documented pattern, not a
   workaround). **Blocked**: no service account configured yet (§2 table).
3. **Cropland masking** (spec §4) — ESA WorldCover / Dynamic World class
   filtering (cropland classes only), the same dual-product approach the
   spec itself names in §3; cross-checked against the already-real MP
   agricultural-area figures in `crop_stats.json` as a sanity bound, not
   accepted blindly.
4. **Crop classification** (spec §5) — Sentinel-1 (VV/VH/coherence) +
   Sentinel-2 (10 optical bands/indices) fused monthly composite, fed to a
   Random Forest first (interpretable, small-sample-tolerant, the
   literature's typical baseline — Jin et al. 2021 above), with CNN/LSTM/
   Transformer sequence models as a second phase once there is enough
   local ground truth to justify their extra data appetite (per Xu et al.
   2025's "best practices" review, which explicitly warns against jumping
   to deep sequence models before a classical baseline is beaten).
5. **Season/phenology detection** (spec §6) — NDVI/EVI time-series
   change-point detection (Savitzky-Golay-smoothed curve, greenup/
   senescence dates), the standard remote-sensing phenology method also
   used for the MODIS-based approach in `07_build_dicra_forecast.py`'s
   NDVI series — same technique, applied per-parcel instead of per-district.
6. **Feature engineering** (spec §7) — indices and covariates as named in
   the spec (NDVI/EVI/GCVI/GNDVI/NDRE/SAVI/MSAVI/NDWI/NDMI/LSWI/LAI/FPAR/
   LST/GDD/SAR VV-VH-texture/DEM derivatives/soil moisture) — all
   standard, published index formulas (cited in agronomy remote-sensing
   literature broadly, not re-derived here).
7. **Ground truth** (spec §8) — see §4 below, the section this document
   spends the most space on because it is the actual blocker.
8. **Gap-filling** (spec §9) — cloud/shadow masking (Sentinel-2 `SCL`
   band or `s2cloudless`, the standard GEE-available cloud probability
   product) + Savitzky-Golay/Whittaker smoothing, both established
   time-series reconstruction methods, not novel here.
9. **Zonal statistics** (spec §10) — area-weighted zonal stats per parcel,
   the same "polygon" sample method already scaffolded but unused in
   `scripts/config.py` (`VILLAGE_SAMPLE_METHOD`) for the climate pipeline —
   reused, not reinvented.
10. **Model comparison + MLOps** (spec §11) — RF/XGBoost/LightGBM/CatBoost
    baseline sweep with 5-fold spatial cross-validation (spatial, not
    random, CV — random CV inflates accuracy on spatially autocorrelated
    crop data, a well-documented pitfall) before any deep model is tried.
    MLflow for run tracking once real training runs exist — premature to
    stand up before there is real data to log.
11. **Yield estimation + scaling** (spec §12) — district-level ICRISAT/
    crop-stats panel as the *initial* regression target (real numbers,
    available now) scaled down to parcel level via the classified-area
    fraction, explicitly labeled "district-calibrated, not parcel-measured"
    until real parcel-level CCE yield records are obtained — the honest
    equivalent of how `fetch_crop_stats.py` already labels its derived
    yield field.
12. **Explainability** (spec §13) — SHAP (Lundberg & Lee, 2017,
    *NeurIPS*), the standard, citable choice; permutation importance as a
    model-agnostic cross-check.

## 4. Ground truth — the actual blocker, and the literature-grounded fallback

**What is not available:** Crop Cutting Experiment (CCE) microdata, Digital
Crop Survey records, or any farmer-survey/geo-tagged-photo dataset. None of
these are held by this project, and none can be fabricated (see repo rule
"No synthetic data, ever," `CLAUDE.md`).

**What is real, public, and obtainable without a data-sharing agreement:**

- **ICRISAT District Level Database** (Nedumaran et al., Mendeley Data,
  DOI-registered) — decades of district-level yield, area and production
  for major Indian crops, plus climate covariates, freely downloadable, no
  application required. Coarser than parcel-level, but real and usable
  today as (a) a sanity check on any parcel-level classification's
  aggregate area, and (b) a district-level regression target for §3 step
  11, honestly labeled as district-calibrated.
- **UP Agriculture (UPAg) platform** — a state government platform
  publishing certified farm-level crop labels for Uttar Pradesh, used as
  ground truth in a 2025 farm-level in-season crop-identification study
  (arXiv:2507.02972). Real and government-certified, but its formal
  access/licensing terms need checking before use — flagged here, not
  assumed.
- **ICRISAT × Mahalanobis National Crop Forecasting Centre pilot** (2019–
  2020) — a joint ICRISAT/Ministry of Agriculture CCE-satellite validation
  pilot covering groundnut, chickpea, rice and maize across 5 districts in
  Andhra Pradesh, Telangana and Odisha. Confirms CCE-satellite cross-
  validation is an active, government-partnered line of work in India —
  a possible future data-sharing contact, not a dataset held today.

**Fallback strategy while parcel-level ground truth remains blocked** (this
is spec §8's own instruction, and it matches current published practice,
not an invented workaround):

1. Pretrain on a public benchmark crop-type dataset from a climatically
   comparable region (e.g. the Central/South Asia smallholder study's
   released features, §1 finding 1) via transfer learning.
2. Self-supervised pretraining on VINDHYA's own unlabeled Sentinel-1/2
   time series for the target districts (once GEE access exists), then
   fine-tune on whatever small amount of real local labels can be
   obtained.
3. Validate classified cropland *area* (not crop-type accuracy) against
   the real, already-available `crop_stats.json` district totals as a
   coarse sanity bound — real numbers, not a substitute for true
   validation.
4. Report a confidence/uncertainty map (spec §13) alongside every
   classified parcel so a district officer can see where the model is
   extrapolating beyond its training support (the "Area of Applicability"
   concept from finding 1, §1) — never present an unvalidated classification
   as equivalent to a validated one.

## 5. What "small real slice first" means here

Per the 2026-08-06 scoping conversation (owner instruction: real slice
before full scaffold), the first implementable, honest slice is:

1. This methodology document (done — you are reading it).
2. `scripts/crop_yield/` package skeleton: `config.py` (GEE + data-path env
   vars, following the exact pattern of `scripts/config.py`), and one
   real, runnable script — `01_fetch_icrisat_district_yield.py` — that
   pulls the real, public ICRISAT district-level dataset (§4) into
   `dashboard/data/crop_yield/` with a proper `metadata` block, the same
   convention every other dataset in this repo follows.
3. Everything past that (GEE cropland masking, classification, MLOps,
   Airflow, Docker) is designed above but **not implemented**, because it
   is genuinely blocked on the service account and parcel ground truth in
   §2/§4's tables — implementing it now would mean either fabricating
   inputs (forbidden) or shipping code that silently no-ops, which is the
   exact "toota hua mat dikhao" (don't show something broken) failure mode
   `FINAL_PROMPT.md` Phase F5 already warns against for other sidebar
   items.

## 6. Infrastructure (designed now, deferred until there's real load to run)

Docker/Airflow/MLflow/PostGIS/BigQuery (spec §14–16) are standard,
appropriate choices for this workload *once it exists* — Airflow for the
~5-day Sentinel revisit cadence, PostGIS/GeoParquet for parcel-level
storage GEE itself shouldn't hold (spec §15's own reasoning), Docker for
reproducible environments. Standing them up before any real pipeline runs
would mean maintaining infrastructure with nothing real flowing through it
— deferred to whichever comes first: GEE credentials or CCE/UPAg data
access.

## 7. Current blockers, explicit

| Blocker | Needed from | Unblocks |
|---|---|---|
| GEE service account (`GEE_SERVICE_ACCOUNT_JSON`) | Owner | Sentinel-1/2, Landsat, MODIS extras, SMAP, DEM, SoilGrids, CHIRPS, ERA5-Land — i.e. all of §3 steps 2–9 |
| MP Bhulekh/Bhu-Naksha data-sharing agreement | Owner / state Revenue Dept. | Real parcel (khasra) boundaries — already blocked identically in `docs/REQUIREMENTS_ROADMAP.md` §D item 2 |
| CCE / Digital Crop Survey / UPAg formal access | Owner / govt. data-sharing | True parcel-level crop-type and yield ground truth, replacing the district-level ICRISAT proxy in §4 |

## 8. References

- Nasrallah et al. (2026). Crop type classification in smallholder
  agriculture of Central and South Asia using Sentinel-1/2 data fusion.
  *Remote Sensing Applications: Society and Environment*.
  https://www.sciencedirect.com/science/article/pii/S2352938526001400
- Jin, Z. et al. (2021). Using Sentinel-1, Sentinel-2, and Planet Imagery
  to Map Crop Type of Smallholder Farms. *Remote Sensing* 13(10):1870.
  https://doi.org/10.3390/rs13101870
- Crop Type Classification Using Fusion of Sentinel-1 and Sentinel-2 Data:
  Assessing the Impact of Feature Selection, Optical Data Availability,
  and Parcel Sizes on the Accuracies.
  https://www.researchgate.net/publication/343905381
- Frontiers in Plant Science (2026). A review of remote sensing-based crop
  yield estimation: machine learning techniques and environmental,
  algorithmic, and hardware limitations.
  https://www.frontiersin.org/journals/plant-science/articles/10.3389/fpls.2026.1742689/full
- District-Level Groundnut Yield Prediction in Gujarat State Using Machine
  Learning and Remote Sensing Data. *Journal of the Indian Society of
  Remote Sensing* (Springer). https://link.springer.com/article/10.1007/s12524-025-02410-w
- Advancing food security: Rice yield estimation framework using
  time-series satellite data & machine learning. PMC.
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11637374/
- Nedumaran, S. et al. ICRISAT District Level Database. Mendeley Data.
  https://data.mendeley.com/datasets/ywp3y5j9vv/1
- ICRISAT × Mahalanobis National Crop Forecasting Centre CCE-satellite
  pilot (2019–2020), groundnut/chickpea/rice/maize, AP/Telangana/Odisha.
  https://www.global-agriculture.com/ag-tech-research-news/icrisat-uses-satellite-data-to-assess-crop-cutting-experiments-for-crop-yield-estimations/
- Farm-Level, In-Season Crop Identification for India (UPAg ground truth).
  arXiv:2507.02972. https://arxiv.org/pdf/2507.02972
- Wang, Y. et al. (2024). Interseasonal transfer learning for crop mapping
  using Sentinel-1 data. *International Journal of Applied Earth
  Observation and Geoinformation*.
  https://www.sciencedirect.com/science/article/pii/S1569843224000724
- Wang et al. (2022). Unsupervised Domain Adaptation with Adversarial
  Self-Training for Crop Classification Using Remote Sensing Images
  (STDAN). *Remote Sensing* 14(18):4639.
  https://www.mdpi.com/2072-4292/14/18/4639
- Xu et al. (2025). Best Practices for Large-Scale, Pixel-Wise Crop
  Mapping and Transfer Learning Workflows. arXiv:2507.12590.
  https://arxiv.org/html/2507.12590v1
- Lundberg, S. & Lee, S. (2017). A Unified Approach to Interpreting Model
  Predictions (SHAP). *NeurIPS*.

## Revision note — 2026-08-06

Created in response to a 22-section platform specification for autonomous
parcel-to-national crop mapping and yield estimation, pasted into the
working session that day. Scoped down to a literature-grounded design plus
one real, runnable first slice per explicit owner instruction ("chhota,
real slice pehle") after confirming neither a GEE service account nor any
parcel-level ground truth dataset is available to this project yet (§7).

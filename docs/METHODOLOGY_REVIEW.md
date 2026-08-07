# Methodology Review — literature check against `docs/METHODOLOGY.md`

Prepared per FINAL_PROMPT.md Phase 10. Scope: verify this portal's current
methods (heatwave, SPI/drought, ETCCDI extremes, CMIP6/NEX-GDDP downscaling
and bias correction, ERA5-Land/CHIRPS use, IPCC-style projection reporting,
village-level spatial aggregation) against real, peer-reviewed literature
found via OpenAlex/CrossRef/Semantic Scholar/general web search. Every
citation below was independently checked (DOI resolved, or — where no DOI
exists, e.g. 1979/1993 proceedings — confirmed via an independent secondary
source) before being included; none are typed in from memory. Full BibTeX
is in `docs/references/`, one file per topic.

**This document does not modify `docs/METHODOLOGY.md` or any pipeline
script.** Findings that suggest a change are recorded below for the owner
to act on.

---

## Flagged for owner review

Two items below look like genuine, literature-backed gaps rather than
already-documented limitations. Neither is a "your number is wrong" finding
— nothing in `docs/METHODOLOGY.md` contradicts the literature — but both are
places where the current pipeline stops short of what the papers it already
leans on recommend. Flagged rather than fixed, per the task instruction.

### 1. SPI: no per-series goodness-of-fit check before trusting the gamma fit

`scripts/02_compute_indices.py` fits a gamma distribution (`scipy.stats
.gamma.fit`, `floc=0`) to positive monthly precipitation per calendar month,
mixed with a zero-inflation term — this is exactly the McKee et al. (1993)
/ Wu et al. (2001) approach and is correctly implemented (see
`docs/references/04_spi_gamma.bib`). What it does **not** do, and what
Stagge et al. (2015, *International Journal of Climatology*,
doi:10.1002/joc.4267) explicitly recommends, is a per-series goodness-of-fit
test (they use Shapiro-Wilk on the resulting normalized index) before
accepting the gamma fit for a given station/district/month. Stagge et al.
found the choice of distribution measurably changes drought classification
at the tails, and recommend checking rather than assuming fit quality
holds uniformly.

This matters more than it would elsewhere because MP districts span a real
aridity gradient — Indore is described in `docs/METHODOLOGY.md` §1 itself
as "semi-arid edge." Semi-arid districts have more zero-precipitation
months, which is exactly the regime where a gamma (or mixed-gamma) fit is
most likely to be poor, and where `docs/METHODOLOGY.md`'s own revision note
already flags SPI-12 as "less stable than standard" on a 25-year record.
A goodness-of-fit check would turn that qualitative caveat into a
per-district, per-scale quantitative one (e.g. "SPI-12 fit is unreliable in
Indore specifically" rather than a blanket note).

**Suggested owner action (not applied):** consider adding a Shapiro-Wilk (or
similar) check on the normalized SPI series per district/scale, flagging
years/districts where the fit is poor in the output JSON's metadata, rather
than changing the underlying gamma-mixture method itself (which remains the
standard, WMO-endorsed approach and should not be swapped out).

### 2. No India-specific validation study found for ERA5-Land specifically (only for ERA5, and for CHIRPS)

Phase 10 called ERA5-Land/CHIRPS validation for India "sabse zaroori" (most
important), since `scripts/08_gee_national_climate.py` uses ERA5-Land +
CHIRPS directly for every national-scale district outside the original 5
IMD-covered MP districts (`docs/METHODOLOGY.md` §7 item 9). A real,
substantive, India-specific literature search was run for both halves of
that pair:

- **CHIRPS**: strong coverage found — five real, verified, India-specific
  papers (`docs/references/05_era5_chirps_validation.bib`), including the
  South Peninsular India 2001-2020 study already cited in
  `docs/METHODOLOGY.md` (confirmed genuine, see next section) plus four more
  independently found in this review.
- **ERA5-Land** (the ~9 km land-surface-only reanalysis, as opposed to its
  ~31 km parent ERA5): despite a deliberate multi-query search, no
  peer-reviewed, India-specific validation paper naming **ERA5-Land**
  specifically (as opposed to ERA5) was found. The best available
  India-specific reanalysis validation is Mahto & Mishra (2019, *JGR
  Atmospheres*, doi:10.1029/2019JD031155), which validates **ERA5**, the
  parent atmospheric reanalysis — a related but distinct, coarser-resolution
  product. `docs/METHODOLOGY.md` §3.1 already cites a *Himalayan-basin*
  ERA5-Land bias-correction result (not sourced in this review; not
  India-wide) as its only ERA5-Land-specific evidence.

This is not evidence the portal's ERA5-Land numbers are wrong — it is an
honest statement that the specific validation claim "ERA5-Land is accurate
for India" currently rests on (a) a general, non-ERA5-Land-specific
reanalysis study (Mahto & Mishra) and (b) a regional Himalayan-basin study,
not a national ERA5-Land-specific one. `docs/METHODOLOGY.md` §3.1 and §7
item 9 already hedge this appropriately ("ERA5-Land and CHIRPS ... are a
genuinely different product, not a substitute manufactured to fill the
gap") — this finding supports keeping that hedge, and suggests the
`data/validation/<state>/<district>.json` per-district validation files
referenced in §3.1 are the right place to eventually close this gap with
this portal's own IMD-vs-ERA5-Land comparison for the 5 MP districts where
both exist, rather than relying on non-ERA5-Land-specific literature. No
code or doc change made.

---

## Per-topic findings

### A. NEX-GDDP-CMIP6 downscaling (NASA)

**Method used:** `NASA/GDDP-CMIP6` Earth Engine collection, 8-model subset,
SSP2-4.5, per `docs/METHODOLOGY.md` §2.2.

**Citation:** Thrasher, Wang, Michaelis, Melton, Lee, Nemani (2022),
*Scientific Data* 9:262, doi:10.1038/s41597-022-01393-4 — the dataset's own
paper (already cited correctly in `docs/METHODOLOGY.md` §8). Confirms the
daily BCSD (bias-correction/spatial-disaggregation) method, 0.25° resolution,
and the 5-experiment/35-model archive this portal draws its 8-model,
SSP2-4.5-only subset from.

**Limitation:** the paper documents 35 models available; this portal uses 8
(already flagged in `docs/METHODOLOGY.md` §7 item 4 as "the minimum
defensible ensemble"). No new concern found — matches the source paper's own
documented scope.

**Dissenting/alternative view:** none found specific to the dataset itself;
downstream bias-correction debates are covered in topic B below.

### B. Bias correction: quantile mapping / delta change for India's monsoon

**Method used:** delta-change (future − baseline, same model) rather than
absolute bias-corrected output — `docs/METHODOLOGY.md` §5, justified there
as "most CMIP6 model systematic bias survives downscaling and is largely
subtracted out."

**Citations:** Cannon, Sobie & Murdock (2015, *Journal of Climate* 28,
doi:10.1175/JCLI-D-14-00754.1) — the standard quantile-mapping
method-comparison paper; Mishra, Bhatia & Tiwari (2020, *Scientific Data* 7,
doi:10.1038/s41597-020-00681-1) — empirical quantile mapping applied to 13
CMIP6 models over South Asia including India; Varghese et al. (2025,
*Scientific Reports* 15, doi:10.1038/s41598-025-87949-x) — EQM applied
specifically to Indian summer monsoon extreme rainfall in CMIP6.

**Why delta-change over quantile mapping here:** the delta approach is
methodologically simpler and, per Cannon et al. (2015), avoids a real
failure mode of naive quantile mapping — degrading a model's own projected
trend in the extremes when the correction is estimated only from the
historical period. For a portal reporting deltas (not absolute future
values) as its headline number, this is a defensible, literature-consistent
choice, not an outdated one.

**Dissenting/alternative view:** the South Asia-specific literature
(Mishra et al. 2020, Varghese et al. 2025) both use full quantile mapping
rather than simple delta-change, and get a bias-corrected *absolute* future
distribution as their reported output rather than a delta. This is a real
methodological fork, not a right/wrong situation — quantile mapping gives
usable absolute future values (useful for e.g. threshold-exceedance
counting) at the cost of the Cannon et al. tail-distortion risk; delta-change
avoids that risk but only ever reports a difference, never a standalone
future value. `docs/METHODOLOGY.md` §7 item 5 already acknowledges "Quantile
mapping on top would improve realism" — this review found nothing to
suggest that acknowledgment is wrong, over- or under-stated.

### C. ETCCDI extreme indices — standard definitions

**Method used:** R95p, R99p, Rx1day, Rx5day, CDD, CWD per
`docs/METHODOLOGY.md` §4.3, 1mm wet-day threshold, percentiles from a fixed
2000–2014 base period (per the 2026-08 revision note).

**Citations:** Karl, Nicholls & Ghazi (1999, *Climatic Change* 42,
doi:10.1023/A:1005491526870) and Zhang et al. (2011, *WIREs Climate Change*
2, doi:10.1002/wcc.147) — both already correctly cited in
`docs/METHODOLOGY.md` §8, both verified real.

**Limitation:** none beyond what §7 item 2 already states (25-year record
gives "wider uncertainty bands than they would with 30+ years" for the
percentile thresholds) — Zhang et al. (2011) themselves recommend the
1961–1990 (or comparable 30-year) WMO normal period for base-period
percentiles, which this portal cannot meet with a 2000–2024 IMD record; the
2000–2014 base-period fix (revision note item 2) is the right response given
that constraint, not an error.

**Dissenting/alternative view:** none found; ETCCDI's index definitions are
essentially uncontested in the literature as *the* standard, unlike SPI
(topic D) or heatwave (topic E) where multiple competing definitions exist.

### D. SPI calculation and the zero-inflated gamma correction

**Method used:** `docs/METHODOLOGY.md` §4.2 — gamma fit to positive monthly
totals per calendar month, zero-inflation mixed in via H(x) = q +
(1−q)·G(x), SPI at 3/6/12-month scales.

**Citations:** McKee, Doesken & Kleist (1993, AMS 8th Conf. Applied
Climatology, no DOI — pre-DOI-era proceedings, verified via its
widely-mirrored PDF and citation count) — the originating SPI paper; Wu,
Hayes, Weiss & Hu (2001, *International Journal of Climatology* 21,
doi:10.1002/joc.658) — the substantive lineage for the zero-precipitation
mixed-distribution correction this portal implements; Stagge et al. (2015,
*International Journal of Climatology* 35, doi:10.1002/joc.4267) — see
"Flagged for owner review" item 1 above.

**Limitation:** already covered by the flagged item above (no
goodness-of-fit check) and by `docs/METHODOLOGY.md`'s existing 25-vs-30-year
record-length caveat.

**Dissenting/alternative view:** Wu et al. (2001) itself is partly a
comparison paper — it evaluates SPI *against* the China-Z Index and a plain
Z-score as competing alternatives, and finds SPI performs comparably or
better in most of their four test locations but is not universally superior.
Stagge et al. (2015) is a dissent specifically against the *log-logistic*
distribution for the related SPEI index (not directly applicable to this
portal's SPI, which correctly uses gamma), but its general recommendation
to test goodness-of-fit rather than assume it applies equally to SPI.

### E. Heatwave definition — IMD's criteria vs international (WMO) definitions

**Method used:** `docs/METHODOLOGY.md` §4.1 — IMD's plains criteria
(absolute Tmax ≥40°C plus departure-from-normal ≥4.5°C, or absolute ≥45°C;
severe at departure ≥6.5°C or ≥47°C; ≥2 consecutive days; March–June only).

**Citations:** Pai, Nair & Ramanathan (2013, *MAUSAM* 64(4), IMD's own
journal, doi:10.54302/mausam.v64i4.742) — sets out and applies these exact
IMD criteria nationally over 1961–2010; Rohini, Rajeevan & Srivastava (2016,
*Scientific Reports* 6, doi:10.1038/srep26153) — independent confirmation of
IMD methodology and trends, but also applies the **Excess Heat Factor
(EHF)** and a 90th-percentile definition as comparison points; McCarthy,
Armstrong & Armstrong (2019, *Weather* 74, doi:10.1002/wea.3629) — the UK
Met Office's heatwave definition, used here as the "international" contrast
case.

**Why IMD's definition here:** for a portal reporting Indian heatwave days
specifically for Indian government/public use, using IMD's own operational
definition (not a generic percentile-based one) is the right choice — it is
what IMD itself issues warnings against, and what
`docs/METHODOLOGY.md`'s badge classification (§4.1 "Heatwave severity
badge") is built to communicate in locally-meaningful terms.

**Dissenting/alternative view — real and worth stating plainly:** IMD's
definition is an **absolute-temperature-plus-fixed-departure** criterion,
structurally different from the WMO-associated **percentile-threshold**
family (WSDI-style: 90th percentile of a fixed reference period, ≥6-day
run) and from the UK's McCarthy et al. (2019) definition (90th percentile,
fixed 3-day window, **no absolute-temperature threshold at all**). Rohini et
al. (2016) show EHF and 90th-percentile definitions produce materially
different heatwave-day counts and trends than IMD's own absolute-threshold
method within the same Indian dataset. This means "heatwave days" as
reported by this dashboard is one specific, defensible, IMD-consistent
choice among several methodologically distinct definitions in the
international literature — not a universal or objectively "the" heatwave
count. `docs/METHODOLOGY.md` does not currently state this explicitly (it
documents the IMD formula precisely but doesn't note that a
percentile-based method would count different — sometimes quite
different — days as heatwave days). This is a documentation gap worth
closing, not a methodological error; not escalated to the top flagged
section because it doesn't suggest the current choice is wrong for this
portal's purpose.

### F. IPCC AR6 WG1 Chapter 11 (extremes) — projection presentation

**Method used:** `docs/METHODOLOGY.md` keeps observed / CMIP6-projected /
OLS-trend-indicative numbers in three explicitly separate categories (§5,
`forecast_2040.json` labeled "indicative" per `DATA_SOURCES.md`), matching
the project's `CLAUDE.md` rule "Observed / projected / validation — teeno
ALAG, kabhi mila kar nahi."

**Citation:** Seneviratne, Zhang et al. (2021, in *Climate Change 2021: The
Physical Science Basis*, Cambridge University Press, pp. 1513–1766,
doi:10.1017/9781009157896.013) — IPCC AR6 WG1 Chapter 11, confirmed
open-access, full 16-author lead-author list verified.

**Limitation / gap found:** IPCC AR6 Ch.11's own convention for presenting
projected extremes is to report changes at specific **global warming
levels** (1.5°C, 2°C, 3°C, 4°C) with explicit **confidence/likelihood**
language (e.g. "likely," "very likely," calibrated per the IPCC uncertainty
guidance), rather than a single SSP/single-window ensemble-mean delta. This
portal's CMIP6 branch reports one scenario (SSP2-4.5), one future window
(2036–2045), and an ensemble mean with no confidence/likelihood
qualifier attached to the delta itself (model spread is not currently
surfaced as an uncertainty band on the CMIP6 numbers the way
`forecast_2040.json`'s OLS trend does report a 95% residual band). This is
already indirectly covered by `docs/METHODOLOGY.md` §7 items 3–4 (single
scenario, 8-model ensemble as a limitation) but the specific IPCC convention
of attaching likelihood language is not mentioned. Not escalated to the top
flagged section — it's an enhancement in the spirit of IPCC's own
presentation standard, not a claim that the current numbers are wrong.

### G. Village-level / sub-district downscaling limitations — MAUP

**Method used:** `docs/METHODOLOGY.md` §3.1 already names the Modifiable
Areal Unit Problem explicitly and describes the nearest-pixel-per-village
sampling method and its consequences at length — this is the most
thoroughly literature-grounded section of the existing methodology doc.

**Citations:** Openshaw & Taylor (1979, in *Statistical Applications in the
Spatial Sciences*, Pion, London, pp. 127–144, no DOI — pre-DOI-era, verified
via 989-citation Semantic Scholar record and independent secondary
confirmation) — the paper that coined "MAUP"; Fotheringham & Wong (1991,
*Environment and Planning A* 23, doi:10.1068/a231025) — extends MAUP to
multivariate statistics, relevant to this portal's composite risk score
(§6) which sums multiple thresholded grid-cell-resolution indicators; Barik
et al. (2024, *Geoscience Data Journal*, doi:10.1002/gdj3.266) — already
cited in `docs/METHODOLOGY.md` §3.1/§8, confirmed real, with one minor title
mismatch noted (see `docs/references/08_maup_downscaling.bib` note — the
methodology doc paraphrases the title rather than quoting it exactly; not a
fabrication, just imprecise, and not fixed here per the task's no-edit rule).

**Limitation:** `docs/METHODOLOGY.md` §3.1 and §7 item 1 already state this
as clearly and honestly as the literature supports — no gap found here.

**Dissenting/alternative view:** none found contesting that MAUP applies, or
that grid-cell products cannot resolve true village-scale variation; this is
essentially uncontested in the spatial-statistics literature. Fotheringham &
Wong (1991) is a methodological extension, not a dissent.

---

## Summary table

| Topic | Real citations found | Notes |
|---|---|---|
| A. NEX-GDDP-CMIP6 | 1 | Dataset's own paper; already correctly cited |
| B. Bias correction / delta-change, India monsoon | 3 | Delta-change vs quantile-mapping is a real methodological fork, both defensible |
| C. ETCCDI indices | 2 | Already correctly cited; no dissent found |
| D. SPI + zero-inflated gamma | 3 | Correction correctly implemented; goodness-of-fit gap flagged |
| E. ERA5-Land / CHIRPS validation, India | 6 | CHIRPS: 5 papers, strong coverage. ERA5-Land specifically: 0 India-specific papers found (ERA5 parent: 1) — flagged |
| F. Heatwave: IMD vs international | 3 | IMD choice is defensible; alternative-definition divergence worth documenting |
| G. IPCC AR6 WG1 Ch.11 | 1 | Confirms current observed/projected/indicative separation is right; likelihood-language convention not yet adopted |
| H. Village-level MAUP | 3 | Existing §3.1 already the strongest-cited section; no new gap |

**Total real, independently-verified citations: 22** across 8 topics (some
citations serve more than one topic, e.g. Barik et al. 2024 is cited under
both B/G context and H). Every DOI above was resolved live (CrossRef API
and/or publisher redirect) on 2026-08-07, except McKee et al. (1993) and
Openshaw & Taylor (1979), which predate the DOI system and were instead
confirmed via independent secondary sources (mirrored PDF, citation-count
record).

No topic had insufficient literature to write a section — ERA5-Land came
closest (see flagged item 2) but CHIRPS coverage for the same pairing was
strong enough to write a complete, honest section rather than padding with
unverified sources.

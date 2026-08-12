"""
15_build_advisory.py -- PENDING.md item 13 ("ADVISORY PARAT"): a derived,
rule-based advisory layer combining this portal's own already-published,
real pipeline outputs (climate indices, NDVI, soil moisture) into
plain-language flags per district.

**This is explicitly NOT a machine-learning model and NOT a confidence
score.** Every flag is a fixed, code-defined threshold rule applied to a
number this repo already computed and published elsewhere (never a new
measurement, never an estimate). See docs/METHODOLOGY.md Sec 9 for the
exact threshold table -- this script and that doc must stay in sync, this
script is the reference implementation.

Four flags, computed independently per district (each present only when
its own real underlying data exists for that district -- partial coverage
is explicit per-field, never all-or-nothing per-district):

  heatwave_risk     -- from heatwave_days / severe_heatwave_days
                        (dashboard/data/climate/<state>/<district>.json for
                        726 districts, or dashboard/data/mp_climate_data.json
                        for the 5 real IMD districts). Same LOW/MODERATE/
                        HIGH/EXTREME bands already shown on the district
                        climate panel (national_climate_loader.js
                        applyGeeMetrics()) -- reused verbatim, not a new
                        scale.
  drought_risk      -- from drought_probability_pct and spi_12, using
                        scripts/config.py's own real SPI thresholds
                        (DROUGHT_SPI_THRESHOLD=-1.0, SEVERE_DROUGHT_SPI=-1.5)
                        plus a probability band documented in
                        docs/METHODOLOGY.md Sec 9.
  vegetation_stress -- ONLY when an NDVI file exists (dicra_ndvi.json for
                        MP's 52 districts, or dashboard/data/ndvi/<state>/
                        <district>.json elsewhere, from the ongoing
                        scripts/10_gee_national_ndvi.py background run --
                        NOT waited on, coverage grows on its own on the
                        next run of this script). Latest calendar year's
                        real mean NDVI compared to the district's OWN
                        historical (prior-years) mean/stddev -- a real
                        z-score relative comparison, never an absolute
                        "good/bad" judgement.
  irrigation_need   -- ONLY when a soil-moisture file exists
                        (dashboard/data/soil_moisture/<state>/<district>.json,
                        733/733 districts as of 2026-08). Reuses the EXACT
                        same fixed reference band already live in
                        dashboard/soil_moisture_loader.js's irrigationHint()
                        (sm_surface_mean < 0.15 / < 0.30 / else) -- not a
                        new threshold invented for this layer. The soil
                        moisture pipeline stores a current ~5-day SMAP
                        window only, no per-district time series, so
                        "relative to recent values" here means the same
                        generic band the Soil Moisture tab already shows,
                        not a fabricated trend.

Output: dashboard/data/advisory/<state_slug>/<district_slug.json>, only
written when the climate input exists (the mandatory minimum). Full
metadata block matching dashboard/data/climate/<state>/<district>.json's
convention. Also writes dashboard/data/advisory/manifest.json (counts per
flag type, mirroring scripts/build_climate_manifest.py /
build_ndvi_manifest.py -- GitHub Pages can't list a directory client-side).

District-tier only in this pass. Block/village/state aggregation is a
documented next step, not attempted here -- see docs/METHODOLOGY.md Sec 9's
"Tier scope" note for why (this derived layer has no per-village/per-block
input of its own to aggregate; it would need to inherit the soil-moisture
pipeline's real village/block breakdown and the climate pipeline has none
at all below district level, so a shortcut client-side mean-of-means like
soil_moisture_loader.js's state tier is the natural next step, deliberately
not rushed here).

Usage:
  python scripts/15_build_advisory.py
"""
from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from national_districts import load_state_districts, slugify  # noqa: E402
import config  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASH_DATA = os.path.join(REPO_ROOT, "dashboard", "data")

CLIMATE_DIR = os.path.join(DASH_DATA, "climate")
MP_CLIMATE_FILE = os.path.join(DASH_DATA, "mp_climate_data.json")
NDVI_DIR = os.path.join(DASH_DATA, "ndvi")
DICRA_NDVI_FILE = os.path.join(DASH_DATA, "dicra_ndvi.json")
SOIL_DIR = os.path.join(DASH_DATA, "soil_moisture")
DISTRICTS_INDEX_FILE = os.path.join(DASH_DATA, "boundaries", "soi", "districts_index.json")
OUT_DIR = os.path.join(DASH_DATA, "advisory")
MANIFEST_FILE = os.path.join(OUT_DIR, "manifest.json")

IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(IST).strftime("%Y-%m-%d")

MP_REAL_DISTRICTS = {"bhopal", "indore", "jabalpur", "rewa", "sidhi"}

# Drought probability bands -- this layer's own simple categorisation
# (docs/METHODOLOGY.md Sec 9); distinct from docs/METHODOLOGY.md Sec 6's
# combined heat+drought district risk score, which is not a standalone
# drought scale. The SPI thresholds ARE the real, existing pipeline
# constants (scripts/config.py), reused verbatim, never redefined here.
DROUGHT_PROB_HIGH = 40.0
DROUGHT_PROB_MODERATE = 20.0

# Same categorical bands already live in dashboard/national_climate_loader.js
# applyGeeMetrics() -- reused verbatim, not redefined.
HEATWAVE_SEVERE_EXTREME = 2.0
HEATWAVE_DAYS_HIGH = 8.0
HEATWAVE_DAYS_MODERATE = 2.0

# Same fixed reference band already live in
# dashboard/soil_moisture_loader.js's irrigationHint() -- reused verbatim.
SM_DRY = 0.15
SM_MODERATE = 0.30

# NDVI anomaly z-score bands -- standard climatology-anomaly convention
# (|z|<0.5 near normal, 0.5<=|z|<1.0 mild departure, |z|>=1.0 significant
# departure), applied to a real per-year mean vs the district's own
# prior-years mean/stddev. See docs/METHODOLOGY.md Sec 9.
NDVI_Z_HIGH = 1.0
NDVI_Z_MODERATE = 0.5


def load_json(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_districts_lgd_map():
    idx = load_json(DISTRICTS_INDEX_FILE)
    out = {}
    if idx and isinstance(idx.get("districts"), list):
        for rec in idx["districts"]:
            out[(rec["state_name"].strip(), rec["district_name"].strip())] = rec.get("district_lgd")
    return out


# ---------------------------------------------------------------------
# Climate input (heatwave_risk + drought_risk)
# ---------------------------------------------------------------------
def get_climate_indices(state, state_slug, district, district_slug, mp_climate_cache):
    """Returns (indices_dict_normalised, source_label, source_file) or
    (None, None, None) if no real climate file exists for this district.
    Field names are normalised to the GEE convention (heatwave_days,
    severe_heatwave_days, drought_probability_pct, spi_12,
    severe_drought_months) -- the 'raw_field' recorded per flag below
    always names the ACTUAL source key used, so the normalisation is
    auditable, not a silent rename."""
    if state_slug == "madhya_pradesh" and district_slug in MP_REAL_DISTRICTS:
        if mp_climate_cache["data"] is None:
            mp_climate_cache["data"] = load_json(MP_CLIMATE_FILE)
        mp = mp_climate_cache["data"]
        if not mp:
            return None, None, None
        drec = (mp.get("districts") or {}).get(district_slug)
        if not drec or "indices" not in drec:
            return None, None, None
        idx = drec["indices"]
        norm = {
            "heatwave_days": idx.get("heatwave_days_mean"),
            "severe_heatwave_days": idx.get("severe_heatwave_days_mean"),
            "drought_probability_pct": idx.get("drought_probability_pct"),
            "spi_12": idx.get("spi12_year_end_mean"),
            "severe_drought_months": idx.get("severe_drought_months_mean"),
            "_raw_fields": {
                "heatwave_days": "indices.heatwave_days_mean",
                "severe_heatwave_days": "indices.severe_heatwave_days_mean",
                "drought_probability_pct": "indices.drought_probability_pct",
                "spi_12": "indices.spi12_year_end_mean",
                "severe_drought_months": "indices.severe_drought_months_mean",
            },
        }
        return norm, "IMD 0.05deg gridded daily Tmax/Tmin/Precipitation NetCDF, 2000-2024", "dashboard/data/mp_climate_data.json"

    path = os.path.join(CLIMATE_DIR, state_slug, district_slug + ".json")
    file = load_json(path)
    if not file or "indices" not in file:
        return None, None, None
    idx = file["indices"]
    norm = {
        "heatwave_days": idx.get("heatwave_days"),
        "severe_heatwave_days": idx.get("severe_heatwave_days"),
        "drought_probability_pct": idx.get("drought_probability_pct"),
        "spi_12": idx.get("spi_12"),
        "severe_drought_months": idx.get("severe_drought_months"),
        "_raw_fields": {
            "heatwave_days": "indices.heatwave_days",
            "severe_heatwave_days": "indices.severe_heatwave_days",
            "drought_probability_pct": "indices.drought_probability_pct",
            "spi_12": "indices.spi_12",
            "severe_drought_months": "indices.severe_drought_months",
        },
    }
    rel = "dashboard/data/climate/%s/%s.json" % (state_slug, district_slug)
    return norm, "ERA5-Land (ECMWF) + CHIRPS (UCSB), via Google Earth Engine, 2000-2024", rel


def heatwave_flag(idx, source_label, source_file):
    hw = idx.get("heatwave_days")
    if hw is None:
        return None
    severe = idx.get("severe_heatwave_days")
    if severe is not None and severe >= HEATWAVE_SEVERE_EXTREME:
        level = "EXTREME"
    elif hw >= HEATWAVE_DAYS_HIGH:
        level = "HIGH"
    elif hw >= HEATWAVE_DAYS_MODERATE:
        level = "MODERATE"
    else:
        level = "LOW"
    note = (
        "%.2f heatwave days/yr and %s severe heatwave days/yr (2000-2024 mean, %s). "
        "Threshold: severe_heatwave_days>=%.0f -> EXTREME, heatwave_days>=%.0f -> HIGH, "
        ">=%.0f -> MODERATE, else LOW (same bands as the district climate panel)."
        % (hw, ("%.2f" % severe) if severe is not None else "n/a", source_label,
           HEATWAVE_SEVERE_EXTREME, HEATWAVE_DAYS_HIGH, HEATWAVE_DAYS_MODERATE)
    )
    return {
        "level": level,
        "basis": {
            "heatwave_days": hw,
            "severe_heatwave_days": severe,
            "source_file": source_file,
            "source_fields": {
                "heatwave_days": idx["_raw_fields"]["heatwave_days"],
                "severe_heatwave_days": idx["_raw_fields"]["severe_heatwave_days"],
            },
        },
        "note": note,
    }


def drought_flag(idx, source_label, source_file):
    prob = idx.get("drought_probability_pct")
    spi12 = idx.get("spi_12")
    if prob is None and spi12 is None:
        return None
    level = "LOW"
    reasons = []
    if prob is not None:
        if prob >= DROUGHT_PROB_HIGH:
            level = "HIGH"
            reasons.append("drought_probability_pct %.1f%% >= %.0f%%" % (prob, DROUGHT_PROB_HIGH))
        elif prob >= DROUGHT_PROB_MODERATE:
            level = "MODERATE" if level == "LOW" else level
            reasons.append("drought_probability_pct %.1f%% >= %.0f%%" % (prob, DROUGHT_PROB_MODERATE))
    if spi12 is not None:
        if spi12 <= config.SEVERE_DROUGHT_SPI:
            level = "HIGH"
            reasons.append("spi_12 %.2f <= %.1f (config.SEVERE_DROUGHT_SPI)" % (spi12, config.SEVERE_DROUGHT_SPI))
        elif spi12 <= config.DROUGHT_SPI_THRESHOLD and level == "LOW":
            level = "MODERATE"
            reasons.append("spi_12 %.2f <= %.1f (config.DROUGHT_SPI_THRESHOLD)" % (spi12, config.DROUGHT_SPI_THRESHOLD))
    note = (
        "drought_probability_pct=%s, spi_12=%s (2000-2024, %s). %s"
        % (("%.1f%%" % prob) if prob is not None else "n/a",
           ("%.2f" % spi12) if spi12 is not None else "n/a",
           source_label,
           ("Triggered by: " + "; ".join(reasons) + ".") if reasons else "Below both threshold bands -> LOW.")
    )
    return {
        "level": level,
        "basis": {
            "drought_probability_pct": prob,
            "spi_12": spi12,
            "severe_drought_months": idx.get("severe_drought_months"),
            "source_file": source_file,
            "source_fields": {
                "drought_probability_pct": idx["_raw_fields"]["drought_probability_pct"],
                "spi_12": idx["_raw_fields"]["spi_12"],
                "severe_drought_months": idx["_raw_fields"]["severe_drought_months"],
            },
        },
        "note": note,
    }


# ---------------------------------------------------------------------
# NDVI input (vegetation_stress) -- optional
# ---------------------------------------------------------------------
def get_ndvi_years(state_slug, district_slug, dicra_districts, dicra_cache):
    """Returns (list of (year, mean) real per-year means sorted ascending,
    source_label, source_file) or (None, None, None)."""
    if district_slug in dicra_districts:
        if dicra_cache["data"] is None:
            dicra_cache["data"] = load_json(DICRA_NDVI_FILE)
        d = dicra_cache["data"]
        rec = (d.get("districts") or {}).get(district_slug) if d else None
        if not rec or not rec.get("dates") or not rec.get("ndvi_mean"):
            return None, None, None
        by_year = {}
        counts = {}
        for date_str, val in zip(rec["dates"], rec["ndvi_mean"]):
            if val is None:
                continue
            yr = int(date_str[:4])
            by_year.setdefault(yr, 0.0)
            counts.setdefault(yr, 0)
            by_year[yr] += val
            counts[yr] += 1
        years = sorted(by_year.keys())
        series = [(yr, by_year[yr] / counts[yr], counts[yr]) for yr in years]
        return series, "UNDP DiCRA district NDVI zonal statistics (MODIS-derived)", "dashboard/data/dicra_ndvi.json"

    path = os.path.join(NDVI_DIR, state_slug, district_slug + ".json")
    file = load_json(path)
    if not file or not file.get("annual_ndvi"):
        return None, None, None
    series = [(e["year"], e["ndvi_mean"], e.get("n_composites")) for e in file["annual_ndvi"] if e.get("ndvi_mean") is not None]
    series.sort(key=lambda t: t[0])
    rel = "dashboard/data/ndvi/%s/%s.json" % (state_slug, district_slug)
    return series, "MODIS Terra Vegetation Indices 16-Day Global 250m (MOD13Q1 v061), via Google Earth Engine", rel


def _median(vals):
    vals = sorted(vals)
    n = len(vals)
    if n == 0:
        return None
    mid = n // 2
    return vals[mid] if n % 2 == 1 else (vals[mid - 1] + vals[mid]) / 2.0


# A latest year whose real composite count is well below the district's own
# typical composite count is a PARTIAL year (e.g. a DiCRA "2026" entry with
# only Jan-Apr composites vs 23/yr typical, because it's mid-year when this
# script runs). Comparing a partial dry-season slice against a historical
# FULL-YEAR mean (which includes lush monsoon months) is a like-with-unlike
# comparison that systematically biases the result toward looking
# artificially LOW -- exactly the kind of misleading precision
# docs/METHODOLOGY.md's "no fabrication" rule warns against. Rather than
# silently comparing anyway, or dropping the flag entirely (a farmer still
# wants a current read), this is computed AND explicitly labelled partial,
# with severity capped at MODERATE so a seasonal artifact can never present
# as a false HIGH.
PARTIAL_YEAR_FRACTION = 0.6


def vegetation_flag(series, source_label, source_file):
    if not series or len(series) < 2:
        return None  # need at least 1 prior year to form a baseline
    latest_year, latest_val, latest_n = series[-1]
    baseline = series[:-1]
    baseline_vals = [v for (_, v, _) in baseline]
    baseline_ns = [n for (_, _, n) in baseline if n is not None]
    n_baseline = len(baseline_vals)
    mean_b = sum(baseline_vals) / n_baseline
    if n_baseline >= 2:
        var_b = sum((v - mean_b) ** 2 for v in baseline_vals) / n_baseline
        sd_b = math.sqrt(var_b)
    else:
        sd_b = 0.0

    typical_n = _median(baseline_ns)
    partial_year = bool(
        typical_n and latest_n is not None and latest_n < PARTIAL_YEAR_FRACTION * typical_n
    )
    caution = (
        ("CAUTION -- PARTIAL YEAR: %s has only %s of a typical ~%.0f composites so far "
         "(real MODIS 16-day composites actually available, not a full year yet). Comparing a "
         "partial dry-season slice to a full-year historical mean is not like-for-like and biases "
         "toward looking artificially low, so severity is capped at MODERATE regardless of the "
         "computed metric below. " % (latest_year, latest_n, typical_n))
        if partial_year else ""
    )

    if sd_b > 0:
        z = (latest_val - mean_b) / sd_b
        metric_label = "z-score"
        metric_val = round(z, 2)
        if z <= -NDVI_Z_HIGH:
            level = "HIGH"
        elif z <= -NDVI_Z_MODERATE:
            level = "MODERATE"
        else:
            level = "LOW"
        note = (
            "%s%s mean NDVI %.4f vs district's own %d-year prior mean %.4f (SD %.4f) -> z=%.2f. "
            "Threshold: z<=-%.1f -> HIGH (below normal), z<=-%.1f -> MODERATE, else LOW. Source: %s (%s)."
            % (caution, latest_year, latest_val, n_baseline, mean_b, sd_b, z, NDVI_Z_HIGH, NDVI_Z_MODERATE, source_label, source_file)
        )
    else:
        pct = ((latest_val - mean_b) / mean_b * 100.0) if mean_b else 0.0
        metric_label = "pct_departure"
        metric_val = round(pct, 1)
        if pct <= -10:
            level = "HIGH"
        elif pct <= -5:
            level = "MODERATE"
        else:
            level = "LOW"
        note = (
            "%s%s mean NDVI %.4f vs district's own %d-year prior mean %.4f (SD=0, using %% departure) -> %.1f%%. "
            "Threshold: <=-10%% -> HIGH, <=-5%% -> MODERATE, else LOW. Source: %s (%s)."
            % (caution, latest_year, latest_val, n_baseline, mean_b, pct, source_label, source_file)
        )

    if partial_year and level == "HIGH":
        level = "MODERATE"

    return {
        "level": level,
        "basis": {
            "latest_year": latest_year,
            "latest_year_ndvi_mean": round(latest_val, 4),
            "latest_year_n_composites": latest_n,
            "typical_n_composites": typical_n,
            "partial_year": partial_year,
            "historical_years_used": n_baseline,
            "historical_mean": round(mean_b, 4),
            "historical_stddev": round(sd_b, 4),
            "metric": metric_label,
            "metric_value": metric_val,
            "source_file": source_file,
        },
        "note": note,
    }


# ---------------------------------------------------------------------
# Soil moisture input (irrigation_need) -- optional
# ---------------------------------------------------------------------
def get_soil_moisture(state_slug, district_slug):
    path = os.path.join(SOIL_DIR, state_slug, district_slug + ".json")
    file = load_json(path)
    if not file or "district" not in file:
        return None, None
    rel = "dashboard/data/soil_moisture/%s/%s.json" % (state_slug, district_slug)
    return file, rel


def irrigation_flag(sm_file, source_file):
    d = sm_file.get("district") or {}
    sm_surface = d.get("sm_surface_mean")
    if sm_surface is None:
        return None
    sm_rootzone = d.get("sm_rootzone_mean")
    n_cells = d.get("n_cells")
    window = (sm_file.get("metadata") or {}).get("observation_window")

    if sm_surface < SM_DRY:
        level = "HIGH"
    elif sm_surface < SM_MODERATE:
        level = "MODERATE"
    else:
        level = "LOW"
    note = (
        "sm_surface_mean=%.3f m3/m3 (0-5cm), sm_rootzone_mean=%s m3/m3 (0-100cm), N=%s SMAP cells, "
        "window %s. Threshold (same as the Soil Moisture tab): <%.2f -> HIGH (irrigate soon), "
        "<%.2f -> MODERATE, else LOW. No per-district soil-moisture time series is stored yet "
        "(SMAP pipeline keeps a current ~5-day window only), so this is the fixed reference band, "
        "not a trend."
        % (sm_surface, ("%.3f" % sm_rootzone) if sm_rootzone is not None else "n/a",
           n_cells if n_cells is not None else "n/a", window or "n/a", SM_DRY, SM_MODERATE)
    )
    return {
        "level": level,
        "basis": {
            "sm_surface_mean": sm_surface,
            "sm_rootzone_mean": sm_rootzone,
            "n_cells": n_cells,
            "observation_window": window,
            "source_file": source_file,
            "source_fields": {
                "sm_surface_mean": "district.sm_surface_mean",
                "sm_rootzone_mean": "district.sm_rootzone_mean",
            },
        },
        "note": note,
    }


# ---------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------
def main():
    by_state = load_state_districts()
    lgd_map = load_districts_lgd_map()
    dicra = load_json(DICRA_NDVI_FILE)
    dicra_districts = set((dicra or {}).get("districts", {}).keys())
    mp_climate_cache = {"data": None}
    dicra_cache = {"data": dicra}

    n_total = 0
    n_climate = 0
    n_heat = 0
    n_drought = 0
    n_veg = 0
    n_irrigation = 0
    written = []

    for state in sorted(by_state.keys()):
        state_slug = slugify(state)
        for district in by_state[state]:
            n_total += 1
            district_slug = slugify(district)

            idx, climate_label, climate_file = get_climate_indices(
                state, state_slug, district, district_slug, mp_climate_cache
            )
            if idx is None:
                continue  # climate is the mandatory minimum -- no file written at all

            flags = {}
            hw = heatwave_flag(idx, climate_label, climate_file)
            if hw:
                flags["heatwave_risk"] = hw
                n_heat += 1
            dr = drought_flag(idx, climate_label, climate_file)
            if dr:
                flags["drought_risk"] = dr
                n_drought += 1

            ndvi_series, ndvi_label, ndvi_file = get_ndvi_years(state_slug, district_slug, dicra_districts, dicra_cache)
            if ndvi_series:
                veg = vegetation_flag(ndvi_series, ndvi_label, ndvi_file)
                if veg:
                    flags["vegetation_stress"] = veg
                    n_veg += 1

            sm_file, sm_source = get_soil_moisture(state_slug, district_slug)
            if sm_file:
                irr = irrigation_flag(sm_file, sm_source)
                if irr:
                    flags["irrigation_need"] = irr
                    n_irrigation += 1

            if not flags:
                continue  # climate indices existed but produced no flags at all (shouldn't happen, defensive)

            out = {
                "metadata": {
                    "source": "Derived, rule-based layer computed entirely from this portal's own already-published "
                               "pipeline outputs -- climate indices (%s), NDVI (UNDP DiCRA or MODIS/GEE, where "
                               "available), soil moisture (NASA SMAP L4/GEE, where available). NOT a machine-learning "
                               "model, NOT a probability/confidence score -- every flag is a fixed, code-defined "
                               "threshold rule. See docs/METHODOLOGY.md Sec 9 for the exact rules; "
                               "scripts/15_build_advisory.py is the reference implementation." % climate_label,
                    "method": "Rule-based thresholds on real stored values; see each flag's own 'basis'/'note' for "
                               "the exact source field(s) and threshold used.",
                    "state": state,
                    "district": district,
                    "district_lgd": lgd_map.get((state, district)),
                    "data_quality": "derived (rule-based, not independently measured) -- see 'source' for the real "
                                    "underlying pipeline output each flag traces to",
                    "flags_present": sorted(flags.keys()),
                    "last_updated": TODAY,
                },
                "flags": flags,
            }
            out_dir = os.path.join(OUT_DIR, state_slug)
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(out_dir, district_slug + ".json")
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(out, f, indent=2, ensure_ascii=False)
            written.append(state_slug + "/" + district_slug)
            n_climate += 1

    manifest = {
        "metadata": {
            "note": "Machine-readable index of districts with a real advisory file, and per-flag-type coverage "
                    "counts. Read by dashboard/advisory_loader.js -- never hardcode these counts in dashboard code. "
                    "Generated by scripts/15_build_advisory.py.",
            "generated": TODAY,
            "tier_scope": "District tier only. Block/village/state aggregation is a documented next step, not yet "
                          "built -- see docs/METHODOLOGY.md Sec 9's 'Tier scope' note.",
        },
        "totals": {
            "districts_nationwide": n_total,
            "districts_with_advisory": n_climate,
            "heatwave_risk": n_heat,
            "drought_risk": n_drought,
            "vegetation_stress": n_veg,
            "irrigation_need": n_irrigation,
        },
        "districts": sorted(written),
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(MANIFEST_FILE, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print("Districts nationwide: %d" % n_total)
    print("Advisory files written (have climate): %d" % n_climate)
    print("  heatwave_risk:      %d" % n_heat)
    print("  drought_risk:       %d" % n_drought)
    print("  vegetation_stress:  %d" % n_veg)
    print("  irrigation_need:    %d" % n_irrigation)
    print("Wrote %s" % MANIFEST_FILE)


if __name__ == "__main__":
    main()

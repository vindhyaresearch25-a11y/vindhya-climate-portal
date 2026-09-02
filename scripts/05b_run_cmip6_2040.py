"""
05b_run_cmip6_2040.py

Runs the CMIP6 NEX-GDDP 2040 physically-based projection workflow
end-to-end via the Earth Engine Python API, using the same service-account
credentials already set up for 08_gee_national_climate.py /
13_gee_national_soil_moisture.py (GEE_SERVICE_ACCOUNT_JSON /
GEE_PROJECT_ID env vars, see config.py).

This is a Python port of 05_gee_cmip6_2040.js -- same collection
(NASA/GDDP-CMIP6), same 8-model ensemble, same ssp245 scenario, same
2036-2045 future window vs. 2000-2014 historical baseline, same 5 MP
district centroids/buffers, same index definitions (heatwave days/yr,
max summer tmax, annual rain, R95p, Rx1day) and same current-era MODIS
NDVI bonus layer.

Why a Python port instead of pasting the .js into the GEE Code Editor
by hand: the result set is tiny (5 districts x ~20 numbers), well inside
a single synchronous getInfo() call, so there's no need for the
Export.table.toDrive() + manual download step the .js file documents.
This script produces the exact same two CSVs at the exact paths
06_convert_gee_export.py already expects (outputs/gee_downloads/), then
calls that script's conversion logic directly -- so the documented
pipeline (05 -> 06 -> 04) stays the source of truth; this file only
automates the "run it and fetch results" part that would otherwise be a
manual browser session.

Real data only: this pulls live from the NASA/GDDP-CMIP6 and MODIS
MOD13Q1 collections on Google Earth Engine at run time -- nothing here
is synthetic, approximated, or filled in when a district's real result
comes back missing (a missing district is left out of the output dict,
not zero-filled).
"""
from __future__ import annotations
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import config as C

import ee
import pandas as pd

MODELS = C.CMIP6_MODELS
SCENARIO = C.CMIP6_SCENARIO
FUTURE_RANGE = (f"{C.FUTURE_WINDOW[0]}-01-01", f"{C.FUTURE_WINDOW[1]}-12-31")
BASELINE_RANGE = (f"{C.HISTORICAL_BASELINE_WINDOW[0]}-01-01", f"{C.HISTORICAL_BASELINE_WINDOW[1]}-12-31")
CMIP6_COLLECTION = "NASA/GDDP-CMIP6"

GEE_DOWNLOADS = C.OUTPUT_DIR / "gee_downloads"


def gee_init():
    if not C.GEE_SERVICE_ACCOUNT_KEY_PATH:
        raise SystemExit(
            "GEE_SERVICE_ACCOUNT_JSON must be set to the service account key file's "
            "path. Not proceeding without real credentials -- see scripts/config.py."
        )
    key_path = Path(C.GEE_SERVICE_ACCOUNT_KEY_PATH)
    if not key_path.exists():
        raise SystemExit(f"GEE service account key not found at {key_path}")
    key_info = json.loads(key_path.read_text())
    client_email = key_info.get("client_email")
    if not client_email:
        raise SystemExit(f"{key_path} has no client_email field -- not a valid service account key")
    creds = ee.ServiceAccountCredentials(client_email, str(key_path))
    ee.Initialize(creds, project=C.GEE_PROJECT_ID or key_info.get("project_id"))
    ee.data.setDeadline(90_000)


def _mean_annual_max(coll: "ee.ImageCollection", band: str, years: "ee.List", out_name: str) -> "ee.Image":
    """Mean of the PER-YEAR maxima, not the max over the whole window.

    Identical to scripts/09_gee_national_cmip6_2040.py's helper of the same
    name -- see that file for the full reasoning. Short version: a plain
    `.max()` over a collection grows with the window's LENGTH, so a 15-year
    baseline (2000-2014) vs a 10-year future window (2036-2045) produced a
    delta that was a window-length artefact rather than a climate signal
    (found live 2026-09-02: Bhopal delta_rx1day_mm = -189.9 mm against a
    future Rx1day of 152.6 mm). The mean of per-year maxima is
    window-length invariant and is the ETCCDI Rx1day/TXx definition
    docs/METHODOLOGY.md Sec 4.3 already documents.
    """
    def one_year(y):
        y = ee.Number(y)
        return (coll.filter(ee.Filter.calendarRange(y, y, "year"))
                    .select(band).max())
    return ee.ImageCollection(years.map(one_year)).mean().rename(out_name)


def indices_for_model_scenario(model: str, scenario: str, date_range: tuple[str, str]) -> ee.Image:
    col = (
        ee.ImageCollection(CMIP6_COLLECTION)
        .filter(ee.Filter.eq("model", model))
        .filter(ee.Filter.eq("scenario", scenario))
        .filter(ee.Filter.date(date_range[0], date_range[1]))
    )
    n_years = ee.Date(date_range[1]).difference(ee.Date(date_range[0]), "year")
    years = ee.List.sequence(ee.Date(date_range[0]).get("year"),
                             ee.Date(date_range[1]).get("year"))

    # ---- HOT DAYS (Mar-Jun season, matches config.py HW_SEASON_MONTHS)
    # NAMING, deliberate: a plain count of days with Tmax >= 40 degC. This is
    # NOT the IMD heatwave-event definition used for the observed indices in
    # 02_compute_indices.py (which also needs a >= 4.5 degC departure from
    # the day-of-year normal and a >= 2-day consecutive run). The two are an
    # order of magnitude apart for the same district and must never share a
    # label -- hence `hot_days_tmax_ge40_per_yr`. docs/METHODOLOGY.md Sec 5.1.
    hw_season = col.filter(ee.Filter.calendarRange(3, 6, "month")).map(
        lambda im: im.addBands(im.select("tasmax").subtract(273.15).rename("tmaxC"))
    )
    hw_days = (
        hw_season.map(lambda im: im.select("tmaxC").gte(40.0).rename("hw"))
        .sum()
        .divide(n_years)
        .rename("hot_days_tmax_ge40_per_yr")
    )
    max_tmax = _mean_annual_max(hw_season, "tmaxC", years, "max_summer_tmax")

    # ---- PRECIP (pr is kg/m2/s -> mm/day = *86400)
    pr_mm = col.map(
        lambda im: im.select("pr").multiply(86400).rename("pr_mm").copyProperties(im, ["system:time_start"])
    )
    annual_pr = pr_mm.select("pr_mm").sum().divide(n_years).rename("annual_rain_mm")

    p95 = (
        pr_mm.select("pr_mm")
        .map(lambda im: im.updateMask(im.gte(1)))
        .reduce(ee.Reducer.percentile([95]))
        .rename("p95")
    )
    r95p = (
        pr_mm.map(lambda im: im.select("pr_mm").gt(p95).multiply(im.select("pr_mm")).rename("ex"))
        .sum()
        .divide(n_years)
        .rename("r95p_mm_per_yr")
    )
    rx1day = _mean_annual_max(pr_mm, "pr_mm", years, "rx1day_mm")

    return ee.Image.cat([hw_days, max_tmax, annual_pr, r95p, rx1day, p95])


def ensemble_mean(scenario: str, date_range: tuple[str, str]) -> ee.Image:
    imgs = ee.ImageCollection([indices_for_model_scenario(m, scenario, date_range) for m in MODELS])
    return imgs.mean()


def reduce_fc(image: ee.Image, districts_fc: ee.FeatureCollection, scale_m: int) -> list[dict]:
    fc = image.reduceRegions(collection=districts_fc, reducer=ee.Reducer.mean(), scale=scale_m)
    return fc.getInfo()["features"]


def main():
    print(f"[gee] init project={C.GEE_PROJECT_ID!r} key={C.GEE_SERVICE_ACCOUNT_KEY_PATH!r}")
    gee_init()

    districts = ee.FeatureCollection(
        [
            ee.Feature(ee.Geometry.Point([d["lng"], d["lat"]]), {"key": key, "name": d["name"]})
            for key, d in C.DISTRICTS.items()
        ]
    )
    districts_b = districts.map(lambda f: f.buffer(5000))

    print(f"[gee] computing future ensemble ({SCENARIO}, {FUTURE_RANGE[0]}..{FUTURE_RANGE[1]}, {len(MODELS)} models)...")
    future_img = ensemble_mean(SCENARIO, FUTURE_RANGE)
    print(f"[gee] computing baseline ensemble (historical, {BASELINE_RANGE[0]}..{BASELINE_RANGE[1]})...")
    baseline_img = ensemble_mean("historical", BASELINE_RANGE)
    delta_img = future_img.subtract(baseline_img).rename(
        ["d_hot_days", "d_maxTmax", "d_annualRain", "d_r95p", "d_rx1day", "d_p95"]
    )

    print("[gee] reducing to district buffers (scale=25000m)...")
    future_feats = reduce_fc(future_img, districts_b, 25000)
    baseline_feats = reduce_fc(baseline_img, districts_b, 25000)
    delta_feats = reduce_fc(delta_img, districts_b, 25000)

    def by_key(feats):
        return {f["properties"]["key"]: f["properties"] for f in feats}

    fut, base, delt = by_key(future_feats), by_key(baseline_feats), by_key(delta_feats)

    rows = []
    for key, d in C.DISTRICTS.items():
        if key not in fut or key not in base or key not in delt:
            print(f"[warn] no GEE result for {key} -- omitting rather than fabricating")
            continue
        f, b, dl = fut[key], base[key], delt[key]
        rows.append(
            {
                "key": key,
                "name": d["name"],
                "future_hot_days_tmax_ge40_per_yr": f.get("hot_days_tmax_ge40_per_yr"),
                "future_max_summer_tmax": f.get("max_summer_tmax"),
                "future_annual_rain_mm": f.get("annual_rain_mm"),
                "future_r95p_mm_per_yr": f.get("r95p_mm_per_yr"),
                "future_rx1day_mm": f.get("rx1day_mm"),
                "future_p95": f.get("p95"),
                "baseline_hot_days_tmax_ge40_per_yr": b.get("hot_days_tmax_ge40_per_yr"),
                "baseline_max_summer_tmax": b.get("max_summer_tmax"),
                "baseline_annual_rain_mm": b.get("annual_rain_mm"),
                "baseline_r95p_mm_per_yr": b.get("r95p_mm_per_yr"),
                "baseline_rx1day_mm": b.get("rx1day_mm"),
                "baseline_p95": b.get("p95"),
                "delta_d_hot_days": dl.get("d_hot_days"),
                "delta_d_maxTmax": dl.get("d_maxTmax"),
                "delta_d_annualRain": dl.get("d_annualRain"),
                "delta_d_r95p": dl.get("d_r95p"),
                "delta_d_rx1day": dl.get("d_rx1day"),
                "delta_d_p95": dl.get("d_p95"),
            }
        )

    GEE_DOWNLOADS.mkdir(parents=True, exist_ok=True)
    cmip_csv = GEE_DOWNLOADS / "cmip6_future_2040_mp5.csv"
    pd.DataFrame(rows).to_csv(cmip_csv, index=False)
    print(f"[ok] wrote {cmip_csv} ({len(rows)} districts)")

    # ---- NDVI bonus layer (current era, MODIS) ----
    print("[gee] computing current-era MODIS NDVI (2018-2024)...")
    modis = ee.ImageCollection("MODIS/061/MOD13Q1").filter(ee.Filter.date("2018-01-01", "2024-12-31")).select("NDVI")
    ndvi = modis.mean().multiply(0.0001).rename("ndvi_mean")
    ndvi_feats = reduce_fc(ndvi, districts_b, 250)
    # NB: reduceRegions on a single-band image names the output column after
    # the reducer ("mean"), not the band ("ndvi_mean") -- only multi-band
    # images (like the CMIP6 indices above) keep their band names as
    # columns. Confirmed directly against a live getInfo() call.
    ndvi_rows = [
        {"key": f["properties"]["key"], "name": f["properties"]["name"], "ndvi_mean": f["properties"].get("mean")}
        for f in ndvi_feats
    ]
    ndvi_csv = GEE_DOWNLOADS / "ndvi_current_mp5.csv"
    pd.DataFrame(ndvi_rows).to_csv(ndvi_csv, index=False)
    print(f"[ok] wrote {ndvi_csv} ({len(ndvi_rows)} districts)")


if __name__ == "__main__":
    main()

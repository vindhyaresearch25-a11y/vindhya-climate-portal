"""
03_build_chart_data.py  (VILLAGE-LEVEL → DISTRICT CHARTS)

Per-district climatology + rankings for the bottom-panel charts.
Aggregation: district-level monthly time series = mean of all village daily
series for that district, resampled monthly.

Output: outputs/chart_data.json
"""
from __future__ import annotations
import sys, json
from pathlib import Path
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import config as C

WY = ["Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May"]
WY_MONTHS = [6,7,8,9,10,11,12,1,2,3,4,5]
CAL = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]


def main():
    meta = pd.read_parquet(C.CACHE_DIR / "villages_meta.parquet")
    tmax = pd.read_parquet(C.CACHE_DIR / "tmax_village_daily.parquet")
    tmin = pd.read_parquet(C.CACHE_DIR / "tmin_village_daily.parquet")
    pr   = pd.read_parquet(C.CACHE_DIR / "precip_village_daily.parquet")
    for d in (tmax, tmin, pr):
        d["date"] = pd.to_datetime(d["date"])
        d.set_index("date", inplace=True)

    # Map village columns to district key
    dist_lc = meta.assign(key=meta["district"].str.lower())[["village_id","key"]]
    col_to_dist = {f"vil_{r.village_id}": r.key for r in dist_lc.itertuples()}

    chart = {"rainfall_monthly_mm": {}, "temperature_monthly_C": {}}

    districts = sorted(meta["district"].str.lower().unique())
    for dkey in districts:
        cols = [c for c in tmax.columns if col_to_dist.get(c) == dkey]
        if not cols: continue

        # district daily mean
        tx_d = tmax[cols].mean(axis=1)
        tn_d = tmin[cols].mean(axis=1) if all(c in tmin.columns for c in cols) else tmin[
                       [c for c in cols if c in tmin.columns]].mean(axis=1)
        pr_d = pr[cols].mean(axis=1) if all(c in pr.columns for c in cols) else pr[
                       [c for c in cols if c in pr.columns]].mean(axis=1)

        # monthly climatology (calendar months 1..12)
        tx_mclim = tx_d.groupby(tx_d.index.month).mean()
        tn_mclim = tn_d.groupby(tn_d.index.month).mean()
        # rainfall: monthly totals per year, then mean of years
        pr_year_month = pr_d.resample("MS").sum(min_count=10)
        pr_mclim = pr_year_month.groupby(pr_year_month.index.month).mean()

        # Rainfall in Jun..May order
        rain_actual = [round(float(pr_mclim.get(m, np.nan)), 1) for m in WY_MONTHS]
        sm = pd.Series(rain_actual).rolling(3, center=True, min_periods=1).mean().round(1).tolist()
        chart["rainfall_monthly_mm"][dkey] = {"labels": WY, "actual": rain_actual, "normal": sm}

        chart["temperature_monthly_C"][dkey] = {
            "labels": CAL,
            "tmax": [round(float(tx_mclim.get(m, np.nan)), 1) for m in range(1, 13)],
            "tmin": [round(float(tn_mclim.get(m, np.nan)), 1) for m in range(1, 13)],
        }

    # Rankings — from village summary, aggregated by district
    summary = pd.read_parquet(C.OUTPUT_DIR / "village_indices_summary.parquet")
    by_dist = summary.groupby("district").agg(
        drought_probability_pct=("drought_probability_pct", "mean"),
        heatwave_days=("heatwave_days", "mean"),
        r95p_mm=("r95p_mm", "mean"),
    ).round(2).reset_index()
    by_dist["district_name"] = by_dist["district"].str.title()

    def rank(col):
        d = by_dist[["district_name", col]].sort_values(col, ascending=False).head(10)
        return d.rename(columns={col: col}).to_dict(orient="records")

    chart["rankings"] = {
        "drought":        rank("drought_probability_pct"),
        "heatwave":       rank("heatwave_days"),
        "extreme_precip": rank("r95p_mm"),
    }

    # Annual trends per district (mean of villages, per year)
    per_year = pd.read_parquet(C.OUTPUT_DIR / "village_indices_per_year.parquet")
    trends = {}
    for dkey in districts:
        sub = per_year[per_year["district"].str.lower() == dkey]
        if sub.empty: continue
        agg = sub.groupby("year").agg(
            heatwave_days=("heatwave_days","mean"),
            extreme_days=("extreme_days","mean"),
            rx1day_mm=("rx1day_mm","mean"),
            annual_rain_mm=("annual_rain_mm","mean"),
            spi_12=("spi_12","mean"),
        ).round(2).reset_index()
        trends[dkey] = {
            "years":          agg["year"].astype(int).tolist(),
            "heatwave_days":  agg["heatwave_days"].fillna(0).round(0).astype(int).tolist(),
            "extreme_days":   agg["extreme_days"].fillna(0).round(0).astype(int).tolist(),
            "rx1day_mm":      agg["rx1day_mm"].tolist(),
            "annual_rain_mm": agg["annual_rain_mm"].tolist(),
            "spi_12":         agg["spi_12"].tolist(),
        }
    chart["annual_trends"] = trends

    out = C.OUTPUT_DIR / "chart_data.json"
    out.write_text(json.dumps(chart, indent=2))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()

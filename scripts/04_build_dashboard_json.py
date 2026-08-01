"""
04_build_dashboard_json.py  (VILLAGE-LEVEL)

Output: dashboard/data/mp_climate_data.json

Structure:
{
  "metadata": {...},
  "districts": {
    "bhopal": { ..., "blocks": {tehsil: [village names]},
                "indices": <district-level means>, "annual": {...},
                "villages": { <village_id>: {name, lat, lon, tehsil, indices} } },
    ...
  },
  "charts": {...}
}
"""
from __future__ import annotations
import sys, json
from pathlib import Path
from datetime import datetime
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import config as C


def classify_risk(drought_pct, heat_days, severe_drought_months):
    score = 0
    if drought_pct >= 60: score += 2
    elif drought_pct >= 40: score += 1
    if heat_days >= 12: score += 2
    elif heat_days >= 6: score += 1
    if severe_drought_months >= 2: score += 1
    if score >= 4: return "extreme"
    if score >= 3: return "high"
    if score >= 1: return "moderate"
    return "low"


def main():
    meta = pd.read_parquet(C.CACHE_DIR / "villages_meta.parquet")
    summary = pd.read_parquet(C.OUTPUT_DIR / "village_indices_summary.parquet")
    per_year = pd.read_parquet(C.OUTPUT_DIR / "village_indices_per_year.parquet")
    charts = json.loads((C.OUTPUT_DIR / "chart_data.json").read_text())

    future_path = C.OUTPUT_DIR / "cmip6_future_2040.json"
    future = {}
    if future_path.exists():
        future = json.loads(future_path.read_text())
        print(f"[ok] loaded {future_path}")

    # Districts in lowercase keys matching the dashboard's MP_DISTRICTS
    dist_keys = sorted(meta["district"].str.lower().unique())
    districts_out = {}

    for dkey in dist_keys:
        dist_villages = meta[meta["district"].str.lower() == dkey].copy()
        dist_summary = summary[summary["district"].str.lower() == dkey]
        if dist_summary.empty:
            continue

        # district means = mean of village indices
        mean_idx = dist_summary.select_dtypes("number").mean(numeric_only=True).round(2).to_dict()

        drought_pct = float(mean_idx.get("drought_probability_pct", 0) or 0)
        heat_days   = float(mean_idx.get("heatwave_days", 0) or 0)
        sev_dr      = float(mean_idx.get("severe_drought_months", 0) or 0)
        peak_tmax   = float(mean_idx.get("max_summer_tmax", 0) or 0)

        # blocks = tehsil -> [village names]
        blocks = {}
        for tehsil, sub in dist_villages.groupby("sub_dist"):
            blocks[tehsil] = sub["village_name"].tolist()

        # Annual time series at district level (mean across villages)
        sub_py = per_year[per_year["district"].str.lower() == dkey]
        agg_year = sub_py.groupby("year").agg(
            heatwave_days=("heatwave_days","mean"),
            extreme_days=("extreme_days","mean"),
            rx1day_mm=("rx1day_mm","mean"),
            annual_rain_mm=("annual_rain_mm","mean"),
            spi_12=("spi_12","mean"),
        ).round(2).reset_index()

        # Per-village data — keep compact (just key indices)
        vil_block = {}
        for _, row in dist_summary.iterrows():
            vil_block[str(row["village_id"])] = {
                "name":   row.get("village_name"),
                "tehsil": row.get("sub_dist"),
                "lat":    round(float(row.get("lat_x", row.get("lat_y", np.nan))), 4),
                "lon":    round(float(row.get("lon_x", row.get("lon_y", np.nan))), 4),
                "indices": {
                    "heatwave_days":         round(float(row.get("heatwave_days", 0) or 0), 1),
                    "severe_heatwave_days":  round(float(row.get("severe_heatwave_days", 0) or 0), 1),
                    "max_summer_tmax":       round(float(row.get("max_summer_tmax", 0) or 0), 1),
                    "drought_probability_pct": round(float(row.get("drought_probability_pct", 0) or 0), 1),
                    "drought_months":        round(float(row.get("drought_months", 0) or 0), 1),
                    "annual_rain_mm":        round(float(row.get("annual_rain_mm", 0) or 0), 0),
                    "r95p_mm":               round(float(row.get("r95p_mm", 0) or 0), 1),
                    "rx1day_mm":             round(float(row.get("rx1day_mm", 0) or 0), 1),
                    "rx5day_mm":             round(float(row.get("rx5day_mm", 0) or 0), 1),
                    "cdd":                   round(float(row.get("cdd", 0) or 0), 1),
                    "spi_12":                round(float(row.get("spi_12", 0) or 0), 2),
                },
            }

        # district centroid: mean of village centroids
        dist_lat = float(dist_villages["lat"].mean())
        dist_lon = float(dist_villages["lon"].mean())

        d_out = {
            "name": dkey.title(),
            "lat": round(dist_lat, 4),
            "lng": round(dist_lon, 4),
            "risk": classify_risk(drought_pct, heat_days, sev_dr),
            "drought": int(round(drought_pct)),
            "heat":    round(peak_tmax, 1),
            "ndvi":    None,
            "blocks":  blocks,
            "indices": {
                "village_count":               int(len(dist_villages)),
                "heatwave_days_mean":          round(heat_days, 1),
                "severe_heatwave_days_mean":   round(float(mean_idx.get("severe_heatwave_days", 0) or 0), 1),
                "mean_summer_tmax":            round(float(mean_idx.get("mean_summer_tmax", 0) or 0), 1),
                "max_summer_tmax":             round(peak_tmax, 1),
                "spi12_year_end_mean":         round(float(mean_idx.get("spi_12", 0) or 0), 2),
                "drought_months_per_year_mean":round(float(mean_idx.get("drought_months", 0) or 0), 1),
                "severe_drought_months_mean":  round(sev_dr, 1),
                "drought_probability_pct":     round(drought_pct, 1),
                "r95p_mm_mean":                round(float(mean_idx.get("r95p_mm", 0) or 0), 1),
                "rx1day_mm_mean":              round(float(mean_idx.get("rx1day_mm", 0) or 0), 1),
                "rx5day_mm_mean":              round(float(mean_idx.get("rx5day_mm", 0) or 0), 1),
                "cdd_mean":                    round(float(mean_idx.get("cdd", 0) or 0), 1),
                "annual_rain_mm_mean":         round(float(mean_idx.get("annual_rain_mm", 0) or 0), 0),
                "p95_threshold_mm":            round(float(mean_idx.get("p95_threshold_mm", 0) or 0), 1),
                "p99_threshold_mm":            round(float(mean_idx.get("p99_threshold_mm", 0) or 0), 1),
            },
            "annual": {
                "years":          agg_year["year"].astype(int).tolist(),
                "heatwave_days":  agg_year["heatwave_days"].fillna(0).round(0).astype(int).tolist(),
                "extreme_days":   agg_year["extreme_days"].fillna(0).round(0).astype(int).tolist(),
                "rx1day_mm":      agg_year["rx1day_mm"].tolist(),
                "annual_rain_mm": agg_year["annual_rain_mm"].tolist(),
                "spi_12":         agg_year["spi_12"].tolist(),
            },
            "villages": vil_block,
        }
        if dkey in future:
            d_out["future_2040"] = future[dkey]
        districts_out[dkey] = d_out

    payload = {
        "metadata": {
            "generated_at":         datetime.utcnow().isoformat() + "Z",
            "source":               "IMD 0.05° gridded NetCDF — village-level extraction",
            "historical_period":    [C.YEAR_START, C.YEAR_END],
            "future_window":        list(C.FUTURE_WINDOW),
            "future_scenario":      C.CMIP6_SCENARIO,
            "districts_in_scope":   list(districts_out.keys()),
            "village_count_total":  int(sum(len(d.get("villages",{})) for d in districts_out.values())),
            "sampling_note":        "Nearest IMD pixel to each village centroid; IMD pixel ~5.5 km",
            "heatwave_definition":  "IMD plains: Tmax ≥ 40°C with departure ≥ 4.5°C, or Tmax ≥ 45°C, ≥ 2 consec days",
            "drought_definition":   "SPI ≤ -1.0 (McKee 1993)",
            "extreme_precip_definition": "ETCCDI R95p / R99p / Rx1day / Rx5day",
        },
        "districts": districts_out,
        "charts":    charts,
    }

    out = C.DASHBOARD_DATA_DIR / "mp_climate_data.json"
    out.write_text(json.dumps(payload))   # not indented; file is large
    print(f"wrote {out}  ({out.stat().st_size/1e6:.1f} MB)")
    for k, d in districts_out.items():
        print(f"  {k:10s}: {len(d.get('villages',{})):>5,} villages   risk={d['risk']}")


if __name__ == "__main__":
    main()

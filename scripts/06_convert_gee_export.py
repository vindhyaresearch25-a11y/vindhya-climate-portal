"""
06_convert_gee_export.py

Once the GEE tasks finish, two CSVs land in your Drive folder GEE_MP_Climate:
  - cmip6_future_2040_mp5.csv
  - ndvi_current_mp5.csv

Download both into outputs/gee_downloads/. This script reads them and
produces outputs/cmip6_future_2040.json (consumed by 04_build_dashboard_json.py)
and updates dashboard/data/mp_climate_data.json to fill in NDVI.

Usage:  python 06_convert_gee_export.py
"""
from __future__ import annotations
import sys, json
from pathlib import Path
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import config as C


GEE_DOWNLOADS = C.OUTPUT_DIR / "gee_downloads"


def main():
    cmip_file = GEE_DOWNLOADS / "cmip6_future_2040_mp5.csv"
    ndvi_file = GEE_DOWNLOADS / "ndvi_current_mp5.csv"

    if not GEE_DOWNLOADS.exists():
        GEE_DOWNLOADS.mkdir(parents=True, exist_ok=True)
        print(f"[hint] put your GEE downloads here: {GEE_DOWNLOADS}")
        return

    if not cmip_file.exists():
        print(f"[warn] {cmip_file} not found — skipping CMIP6 conversion")
    else:
        df = pd.read_csv(cmip_file)
        # Expected columns: key, name, future_heatwave_days_per_yr, future_max_summer_tmax,
        # future_annual_rain_mm, future_r95p_mm_per_yr, future_rx1day_mm, future_p95,
        # baseline_*, delta_*
        future = {}
        for _, row in df.iterrows():
            k = row["key"]
            future[k] = {
                "scenario": C.CMIP6_SCENARIO,
                "window":   list(C.FUTURE_WINDOW),
                "ensemble_models": C.CMIP6_MODELS,
                "heatwave_days_per_yr":     round(float(row.get("future_heatwave_days_per_yr", 0)), 1),
                "max_summer_tmax":          round(float(row.get("future_max_summer_tmax", 0)), 1),
                "annual_rain_mm":           round(float(row.get("future_annual_rain_mm", 0)), 0),
                "r95p_mm_per_yr":           round(float(row.get("future_r95p_mm_per_yr", 0)), 1),
                "rx1day_mm":                round(float(row.get("future_rx1day_mm", 0)), 1),
                "baseline_heatwave_days_per_yr": round(float(row.get("baseline_heatwave_days_per_yr", 0)), 1),
                "baseline_max_summer_tmax":      round(float(row.get("baseline_max_summer_tmax", 0)), 1),
                "baseline_annual_rain_mm":       round(float(row.get("baseline_annual_rain_mm", 0)), 0),
                "delta_heatwave_days_per_yr":    round(float(row.get("delta_d_heatwave", 0)), 1),
                "delta_max_summer_tmax":         round(float(row.get("delta_d_maxTmax", 0)), 1),
                "delta_annual_rain_mm":          round(float(row.get("delta_d_annualRain", 0)), 0),
                "delta_r95p_mm_per_yr":          round(float(row.get("delta_d_r95p", 0)), 1),
                "delta_rx1day_mm":               round(float(row.get("delta_d_rx1day", 0)), 1),
            }
        out = C.OUTPUT_DIR / "cmip6_future_2040.json"
        out.write_text(json.dumps(future, indent=2))
        print(f"wrote {out}")

    # NDVI: patch into the existing dashboard JSON
    dashboard_json = C.DASHBOARD_DATA_DIR / "mp_climate_data.json"
    if ndvi_file.exists() and dashboard_json.exists():
        ndvi = pd.read_csv(ndvi_file)
        payload = json.loads(dashboard_json.read_text())
        for _, row in ndvi.iterrows():
            k = row["key"]
            if k in payload["districts"]:
                payload["districts"][k]["ndvi"] = round(float(row.get("ndvi_mean", 0)), 2)
        dashboard_json.write_text(json.dumps(payload, indent=2))
        print(f"updated NDVI in {dashboard_json}")


if __name__ == "__main__":
    main()

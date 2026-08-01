"""
02_compute_indices.py  (VILLAGE-LEVEL)

Computes per-village per-year climate indices from village daily parquet files.

Indices per (village, year):
  HEATWAVE   : heatwave_days, severe_heatwave_days, max_summer_tmax, mean_summer_tmax
  DROUGHT    : spi_3, spi_6, spi_12 (year-end), drought_months, severe_drought_months
  EXT PRECIP : r95p_mm, r99p_mm, rx1day_mm, rx5day_mm, cdd, cwd, extreme_days,
               annual_rain_mm
  drought_probability_pct (computed across full record per village)

Writes:
  outputs/village_indices_per_year.parquet   one row per (village_id, year)
  outputs/village_indices_summary.parquet    one row per village (means)
  outputs/district_indices_summary.csv       one row per district (means of village means)

The per-year file gets ~5000 villages * 25 years = 125k rows. Fine.
"""
from __future__ import annotations
import sys
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).parent))
import config as C


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------
def _max_consec(mask: np.ndarray) -> int:
    best = cur = 0
    for x in mask:
        cur = cur + 1 if x else 0
        if cur > best: best = cur
    return int(best)


def _flag_runs(mask: np.ndarray, min_len: int) -> np.ndarray:
    """True for days inside a consecutive True-run of length >= min_len."""
    out = np.zeros(len(mask), dtype=bool)
    i, n = 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            if j - i >= min_len:
                out[i:j] = True
            i = j
        else:
            i += 1
    return out


def _spi_from_monthly(monthly: pd.Series, scale: int) -> pd.Series:
    rolled = monthly.rolling(scale).sum()
    out = pd.Series(np.nan, index=rolled.index)
    for m in range(1, 13):
        vals = rolled[rolled.index.month == m].dropna()
        # Gamma fit needs a reasonable sample; WMO recommends >= 30 years.
        # With the 25-year IMD record we accept >= 15 but flag the limitation
        # in docs/METHODOLOGY.md.
        if len(vals) < 15:
            continue
        positive = vals[vals > 0]
        zero_frac = 1.0 - len(positive) / len(vals)
        if len(positive) < 4:
            continue
        try:
            a, loc, b = stats.gamma.fit(positive, floc=0)
        except Exception:
            continue
        cdf = np.where(vals > 0,
                       zero_frac + (1 - zero_frac) * stats.gamma.cdf(vals, a, loc=loc, scale=b),
                       zero_frac / 2.0)
        cdf = np.clip(cdf, 1e-6, 1 - 1e-6)
        out.loc[vals.index] = stats.norm.ppf(cdf)
    return out


# ----------------------------------------------------------------------
# per-village computations (vectorized where possible)
# ----------------------------------------------------------------------
def heatwave_for_village(dates_idx, tmax_series, in_season):
    """Vectorized for one village column."""
    doy = dates_idx.dayofyear.values
    # daily climatology
    df_tmp = pd.DataFrame({"doy": doy, "t": tmax_series.values})
    daily_norm = df_tmp.groupby("doy")["t"].mean()
    # 15-day rolling smooth, wrap-pad
    pad = pd.concat([daily_norm, daily_norm, daily_norm])
    smoothed = pad.rolling(window=15, center=True, min_periods=1).mean()
    daily_norm = smoothed.iloc[len(daily_norm):2 * len(daily_norm)]
    daily_norm.index = range(1, len(daily_norm) + 1)

    norms = pd.Series(doy, index=dates_idx).map(daily_norm).values
    departure = tmax_series.values - norms

    mild = ((tmax_series.values >= C.HW_TMAX_ABS_THRESHOLD) &
            (departure >= C.HW_DEPARTURE_MILD)) | (tmax_series.values >= C.HW_TMAX_SEVERE)
    mild = mild & in_season

    severe = ((tmax_series.values >= C.HW_TMAX_ABS_THRESHOLD) &
              (departure >= C.HW_DEPARTURE_SEVERE)) | (tmax_series.values >= 47.0)
    severe = severe & in_season

    hw_days = _flag_runs(mild, C.HW_MIN_CONSEC_DAYS)
    shw_days = _flag_runs(severe, C.HW_MIN_CONSEC_DAYS)

    out = pd.DataFrame({
        "date": dates_idx,
        "hw":   hw_days,
        "shw":  shw_days,
        "tmax": tmax_series.values,
        "in_season": in_season,
    })
    out["year"] = out["date"].dt.year
    agg = out.groupby("year").agg(
        heatwave_days=("hw", "sum"),
        severe_heatwave_days=("shw", "sum"),
    )
    seas = out[out["in_season"]]
    agg["max_summer_tmax"] = seas.groupby("year")["tmax"].max()
    agg["mean_summer_tmax"] = seas.groupby("year")["tmax"].mean()
    return agg


def drought_for_village(dates_idx, pr_series):
    s = pd.Series(pr_series.values, index=dates_idx)
    monthly = s.resample("MS").sum(min_count=10)
    spi3  = _spi_from_monthly(monthly, 3)
    spi6  = _spi_from_monthly(monthly, 6)
    spi12 = _spi_from_monthly(monthly, 12)
    df = pd.DataFrame({"spi3": spi3, "spi6": spi6, "spi12": spi12})
    df["year"] = df.index.year
    agg = df.groupby("year").agg(
        spi_3=("spi3", "last"),
        spi_6=("spi6", "last"),
        spi_12=("spi12", "last"),
        drought_months=("spi3", lambda v: int((v <= C.DROUGHT_SPI_THRESHOLD).sum())),
        severe_drought_months=("spi3", lambda v: int((v <= C.SEVERE_DROUGHT_SPI).sum())),
    )
    total = df["spi3"].notna().sum()
    in_dr = (df["spi3"] <= C.DROUGHT_SPI_THRESHOLD).sum()
    agg["drought_probability_pct"] = round(100 * in_dr / total, 1) if total else np.nan
    return agg


def extreme_for_village(dates_idx, pr_series):
    df = pd.DataFrame({"date": dates_idx, "pr": pr_series.values})
    df["year"] = df["date"].dt.year
    # ETCCDI convention: percentile thresholds computed over a FIXED base
    # period so that exceedances in later years are measured against a stable
    # reference, not against a record that includes those same years.
    base_lo, base_hi = C.EXT_PRECIP_BASE_PERIOD
    base = df[(df["year"] >= base_lo) & (df["year"] <= base_hi)]
    if len(base) < 365 * 5:            # base period too short; fall back
        base = df
    wet = base[base["pr"] >= C.WET_DAY_THRESHOLD_MM]["pr"]
    p95 = wet.quantile(0.95) if len(wet) else np.nan
    p99 = wet.quantile(0.99) if len(wet) else np.nan

    rows = []
    for yr, sub in df.groupby("year"):
        v = sub["pr"].fillna(0).to_numpy()
        rx1 = float(np.nanmax(v)) if len(v) else np.nan
        rx5 = float(pd.Series(v).rolling(5).sum().max()) if len(v) >= 5 else rx1
        r95p = float(v[v > p95].sum()) if np.isfinite(p95) else np.nan
        r99p = float(v[v > p99].sum()) if np.isfinite(p99) else np.nan
        cdd = _max_consec(v < 1.0)
        cwd = _max_consec(v >= 1.0)
        edays = int((v > p95).sum()) if np.isfinite(p95) else 0
        rows.append({
            "year": yr, "r95p_mm": r95p, "r99p_mm": r99p,
            "rx1day_mm": rx1, "rx5day_mm": rx5,
            "cdd": cdd, "cwd": cwd, "extreme_days": edays,
            "annual_rain_mm": float(v.sum()),
            "p95_threshold_mm": p95, "p99_threshold_mm": p99,
        })
    return pd.DataFrame(rows).set_index("year")


# ----------------------------------------------------------------------
# main
# ----------------------------------------------------------------------
def main():
    meta = pd.read_parquet(C.CACHE_DIR / "villages_meta.parquet")
    tmax = pd.read_parquet(C.CACHE_DIR / "tmax_village_daily.parquet")
    pr   = pd.read_parquet(C.CACHE_DIR / "precip_village_daily.parquet")

    tmax["date"] = pd.to_datetime(tmax["date"])
    pr["date"]   = pd.to_datetime(pr["date"])
    tmax = tmax.set_index("date").sort_index()
    pr   = pr.set_index("date").sort_index()

    villages = meta["village_id"].tolist()
    col_map = {f"vil_{v}": v for v in villages}
    in_season_tmax = tmax.index.month.isin(C.HW_SEASON_MONTHS)

    out_per_year = []

    for vid in tqdm(villages, desc="villages"):
        col = f"vil_{vid}"
        if col not in tmax.columns or col not in pr.columns:
            continue
        try:
            hw = heatwave_for_village(tmax.index, tmax[col], in_season_tmax)
            dr = drought_for_village(pr.index, pr[col])
            ep = extreme_for_village(pr.index, pr[col])
        except Exception as e:
            print(f"  [warn] {vid} failed: {e}")
            continue
        merged = hw.join(dr, how="outer").join(ep, how="outer")
        merged["village_id"] = vid
        merged = merged.reset_index().rename(columns={"index": "year"})
        out_per_year.append(merged)

    per_year = pd.concat(out_per_year, ignore_index=True)
    per_year = per_year.merge(meta, on="village_id", how="left")
    per_year.to_parquet(C.OUTPUT_DIR / "village_indices_per_year.parquet",
                        index=False, compression="zstd")
    print(f"[ok] wrote village_indices_per_year.parquet ({len(per_year):,} rows)")

    # Per-village summary (mean across years)
    num_cols = per_year.select_dtypes("number").columns.drop("year")
    summary = (per_year.groupby(["village_id"])[num_cols].mean(numeric_only=True)
                       .round(3).reset_index())
    summary = summary.merge(meta, on="village_id", how="left")
    summary.to_parquet(C.OUTPUT_DIR / "village_indices_summary.parquet",
                       index=False, compression="zstd")
    print(f"[ok] wrote village_indices_summary.parquet ({len(summary):,} villages)")

    # District-level rollup (mean of village means)
    dist = (summary.groupby("district")[num_cols].mean(numeric_only=True)
                   .round(3).reset_index())
    dist.to_csv(C.OUTPUT_DIR / "district_indices_summary.csv", index=False)
    print(f"[ok] wrote district_indices_summary.csv")
    print(dist.to_string(index=False))


if __name__ == "__main__":
    main()

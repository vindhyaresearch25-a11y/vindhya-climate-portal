"""
01_extract_village_timeseries.py  (VILLAGE-LEVEL)

For each village in the 5 target MP districts (BHOPAL, INDORE, JABALPUR,
REWA, SIDHI), sample daily IMD tmax/tmin/precip from yearly NetCDFs
(2000-2024) at the village centroid (nearest pixel).

Writes per-variable parquet files (parquet, not CSV, because we have
thousands of village columns and CSV is too slow):

  cache/villages_meta.parquet           village_id, name, district, sub_dist, lon, lat
  cache/tmax_village_daily.parquet      date, vil_<id1>, vil_<id2>, ...
  cache/tmin_village_daily.parquet
  cache/precip_village_daily.parquet
"""
from __future__ import annotations
import sys, time
from pathlib import Path
import numpy as np
import pandas as pd
import geopandas as gpd
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).parent))
import config as C
from common import open_yearly, years_range

# Districts of interest -- as they appear in the shapefile's 'District' column
TARGET_DISTRICTS_SHP = ["BHOPAL", "INDORE", "JABALPUR", "REWA", "SIDHI"]


def load_target_villages():
    print(f"[shapefile] reading {C.MP_SHAPEFILE}")
    gdf = gpd.read_file(C.MP_SHAPEFILE)
    print(f"  total features: {len(gdf):,}")

    # Filter to our 5 districts
    gdf["District"] = gdf["District"].astype(str).str.upper().str.strip()
    gdf = gdf[gdf["District"].isin(TARGET_DISTRICTS_SHP)].copy()
    print(f"  villages in target districts: {len(gdf):,}")
    by_dist = gdf.groupby("District").size().to_dict()
    for d, n in by_dist.items():
        print(f"    {d}: {n:,}")

    # Reproject to WGS84 (IMD data is in lon/lat)
    print("  reprojecting to EPSG:4326 ...")
    gdf_wgs = gdf.to_crs(epsg=4326)
    # Compute centroid in the projected CRS (more accurate) then bring to WGS84
    cent_proj = gdf.geometry.centroid
    cent = gpd.GeoSeries(cent_proj, crs=gdf.crs).to_crs(epsg=4326)
    gdf_wgs["lon"] = cent.x.values
    gdf_wgs["lat"] = cent.y.values

    # Normalize columns + assign stable IDs
    gdf_wgs["village_id"] = gdf_wgs["Vill_LGD"].astype(str)
    gdf_wgs["village_name"] = gdf_wgs["Villl_name"].astype(str).str.strip()
    gdf_wgs["sub_dist"] = gdf_wgs["Sub_dist"].astype(str).str.strip()
    gdf_wgs["district"] = gdf_wgs["District"].astype(str).str.strip()

    # Deduplicate on village_id (some shapefiles repeat)
    gdf_wgs = gdf_wgs.drop_duplicates(subset=["village_id"]).reset_index(drop=True)
    print(f"  unique villages after dedup: {len(gdf_wgs):,}")
    return gdf_wgs


def sample_at_points_nearest(da, lons, lats):
    """Vectorized nearest-pixel sampling. Returns shape (T, N)."""
    pts = pd.DataFrame({"lon": lons, "lat": lats})
    import xarray as xr
    pt_ds = xr.Dataset({
        "lon": ("pt", pts["lon"].values),
        "lat": ("pt", pts["lat"].values),
    })
    sampled = da.sel(lon=pt_ds.lon, lat=pt_ds.lat, method="nearest")
    return sampled.values.astype("float32")


def extract_kind(kind, villages):
    lons = villages["lon"].to_numpy()
    lats = villages["lat"].to_numpy()
    cols = ["vil_" + v for v in villages["village_id"].tolist()]
    # Bounding box around all target villages to crop NetCDF before sampling
    minx, maxx = float(lons.min() - 0.2), float(lons.max() + 0.2)
    miny, maxy = float(lats.min() - 0.2), float(lats.max() + 0.2)

    frames = []
    for year in tqdm(list(years_range()), desc=f"  {kind}"):
        try:
            da = open_yearly(year, kind)
        except FileNotFoundError as e:
            print(f"    SKIP {year}: {e}")
            continue
        da = da.sel(lat=slice(miny, maxy), lon=slice(minx, maxx))
        arr = sample_at_points_nearest(da, lons, lats)  # (T, N)
        dates = pd.to_datetime(da.time.values)
        df = pd.DataFrame(arr, index=dates, columns=cols)
        df.index.name = "date"
        frames.append(df)
        da.close()

    if not frames:
        raise SystemExit(f"no NetCDF files found for {kind}")
    return pd.concat(frames).sort_index()


def main():
    t0 = time.time()
    villages = load_target_villages()
    meta = villages[["village_id", "village_name", "district",
                     "sub_dist", "lon", "lat"]].copy()
    meta.to_parquet(C.CACHE_DIR / "villages_meta.parquet", index=False)
    print(f"[ok] wrote villages_meta.parquet ({len(meta):,} villages)")

    for kind in ["tmax", "tmin", "precip"]:
        print(f"\n[{kind}] sampling at village centroids ...")
        df = extract_kind(kind, villages)
        out = C.CACHE_DIR / f"{kind}_village_daily.parquet"
        df.reset_index().to_parquet(out, index=False, compression="zstd")
        print(f"  wrote {out}  ({len(df):,} days x {df.shape[1]:,} villages,"
              f" {out.stat().st_size/1e6:.1f} MB)")

    print(f"\nDONE in {(time.time()-t0)/60:.1f} min")


if __name__ == "__main__":
    main()

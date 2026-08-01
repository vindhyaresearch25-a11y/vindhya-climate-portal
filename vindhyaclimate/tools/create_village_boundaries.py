"""
Creates simplified village boundary GeoJSON for the 5 MP districts.
Each district gets its own file for on-demand loading.
"""
import geopandas as gpd
from pathlib import Path
import json

SHP = r"D:\10023\MADHYA_PRADESH.shp"
OUT = Path(r"D:\VINDHYA\vindhya_dashboard\dashboard\data")

TARGET = ["BHOPAL", "INDORE", "JABALPUR", "REWA", "SIDHI"]

print("Reading shapefile...")
gdf = gpd.read_file(SHP)
gdf = gdf.to_crs(epsg=4326)
gdf["District"] = gdf["District"].astype(str).str.upper().str.strip()
gdf = gdf[gdf["District"].isin(TARGET)].copy()
print(f"Total villages: {len(gdf)}")

# Simplify geometry (tolerance ~100m) to reduce file size
print("Simplifying geometry...")
gdf["geometry"] = gdf.geometry.simplify(tolerance=0.001, preserve_topology=True)

# Keep essential columns
gdf = gdf[["Vill_LGD", "Villl_name", "Sub_dist", "District", "geometry"]]

for dist in TARGET:
    sub = gdf[gdf["District"] == dist].copy()
    fname = f"villages_{dist.lower()}.geojson"
    sub.to_file(OUT / fname, driver="GeoJSON")
    size = (OUT / fname).stat().st_size / 1024
    print(f"  {dist.lower()}: {len(sub)} villages, {size:.0f} KB")

print("\nDone! Village boundary files created.")

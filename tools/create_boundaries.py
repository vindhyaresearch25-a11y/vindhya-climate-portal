"""
Creates mp_districts.geojson and mp_tehsils.geojson from the MP shapefile
for the 5 target districts (BHOPAL, INDORE, JABALPUR, REWA, SIDHI).
"""
import geopandas as gpd
from pathlib import Path

SHP = r"D:\10023\MADHYA_PRADESH.shp"
OUT = Path(r"D:\VINDHYA\vindhya_dashboard\dashboard")

TARGET = ["BHOPAL", "INDORE", "JABALPUR", "REWA", "SIDHI"]

print("Reading shapefile...")
gdf = gpd.read_file(SHP)
print(f"Total features: {len(gdf)}")
print(f"Original CRS: {gdf.crs}")

# Convert to WGS84 (lon/lat) for Leaflet
gdf = gdf.to_crs(epsg=4326)

# Filter target districts
gdf["District"] = gdf["District"].astype(str).str.upper().str.strip()
gdf = gdf[gdf["District"].isin(TARGET)].copy()
print(f"Villages in 5 districts: {len(gdf)}")

# --- District boundaries ---
print("\nCreating district boundaries...")
districts = gdf.dissolve(by="District", aggfunc="first").reset_index()
# Keep only useful columns
keep = [c for c in ["District", "Dist_LGD", "STATE_UT", "STATE_LGD"] if c in districts.columns]
districts = districts[keep + ["geometry"]]
districts.to_file(OUT / "mp_districts.geojson", driver="GeoJSON")
print(f"  Wrote {len(districts)} districts to mp_districts.geojson")

# --- Tehsil boundaries ---
print("\nCreating tehsil boundaries...")
# Ensure WGS84
gdf = gdf.to_crs(epsg=4326)
gdf["Sub_dist"] = gdf["Sub_dist"].astype(str).str.strip()
tehsils = gdf.dissolve(by=["District", "Sub_dist"], aggfunc="first").reset_index()
keep_t = [c for c in ["District", "Sub_dist", "Subdis_LGD"] if c in tehsils.columns]
tehsils = tehsils[keep_t + ["geometry"]]
tehsils.to_file(OUT / "mp_tehsils.geojson", driver="GeoJSON")
print(f"  Wrote {len(tehsils)} tehsils to mp_tehsils.geojson")

# --- Block boundaries (same as tehsil or Subdis_Typ) ---
print("\nCreating block boundaries...")
if "Subdis_Typ" in gdf.columns:
    blocks = gdf.dissolve(by=["District", "Sub_dist", "Subdis_Typ"], aggfunc="first").reset_index()
    keep_b = [c for c in ["District", "Sub_dist", "Subdis_Typ"] if c in blocks.columns]
    blocks = blocks[keep_b + ["geometry"]]
    blocks.to_file(OUT / "mp_blocks.geojson", driver="GeoJSON")
    print(f"  Wrote {len(blocks)} blocks to mp_blocks.geojson")
else:
    # Same as tehsil
    tehsils.to_file(OUT / "mp_blocks.geojson", driver="GeoJSON")
    print(f"  (Subdis_Typ not found, copied tehsil as blocks)")

print("\nDone! Re-enable boundary control in index.html and refresh.")

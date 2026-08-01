import geopandas as gpd
gdf = gpd.read_file(r"D:\10023\MADHYA_PRADESH.shp")
gdf = gdf.to_crs(epsg=4326)
gdf["District"] = gdf["District"].astype(str).str.upper().str.strip()
gdf = gdf[gdf["District"].isin(["BHOPAL","INDORE","JABALPUR","REWA","SIDHI"])]
print(f"Total villages: {len(gdf)}")
# Check bounds
print(f"Bounds: {[round(b,4) for b in gdf.total_bounds]}")
# Write a subset to estimate size
small = gdf.head(10)
small.to_file(r"D:\VINDHYA\vindhya_dashboard\dashboard\test_village.geojson", driver="GeoJSON")
size_10 = __import__("os").path.getsize(r"D:\VINDHYA\vindhya_dashboard\dashboard\test_village.geojson")
print(f"10 villages: {size_10/1024:.1f} KB")
print(f"Estimated {len(gdf)} villages: {size_10 * len(gdf) / 10 / 1024 / 1024:.1f} MB")

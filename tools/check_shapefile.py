import geopandas as gpd
gdf = gpd.read_file(r"D:\10023\MADHYA_PRADESH.shp")
gdf["District"] = gdf["District"].astype(str).str.upper().str.strip()
gdf = gdf[gdf["District"].isin(["BHOPAL","INDORE","JABALPUR","REWA","SIDHI"])]
print("Shapefile columns:", list(gdf.columns))
print()
print("Sample from shapefile:")
print(gdf[["Villl_name","Sub_dist","District"]].head(3))
print()
cent = gdf.geometry.centroid
cent_wgs = cent.to_crs(epsg=4326)
print("Sample lat/lon from shapefile:")
for i in range(3):
    print(f'  {gdf.iloc[i]["Villl_name"]}: lat={cent_wgs.y.iloc[i]:.4f}, lon={cent_wgs.x.iloc[i]:.4f}')

import geopandas as gpd, json
from pathlib import Path

SHP = r"D:\10023\MADHYA_PRADESH.shp"
OUT = Path(r"D:\VINDHYA\mp_climate_dashboard\outputs\shapefile_info.txt")
OUT.parent.mkdir(parents=True, exist_ok=True)

g = gpd.read_file(SHP)
lines = []
lines.append(f"FEATURES: {len(g)}")
lines.append(f"CRS: {g.crs}")
lines.append(f"COLUMNS: {list(g.columns)}")
lines.append(f"GEOMETRY_TYPES: {g.geom_type.value_counts().to_dict()}")
lines.append(f"BOUNDS: {g.total_bounds.tolist()}")
lines.append("")
lines.append("FIRST 20 ROWS (attributes only, no geometry):")
attrs = g.drop(columns="geometry")
lines.append(attrs.head(20).to_string())
lines.append("")
# Unique counts per column to find district/village columns
lines.append("UNIQUE VALUE COUNTS per column:")
for c in attrs.columns:
    try:
        u = attrs[c].nunique(dropna=True)
        sample = attrs[c].dropna().unique()[:5].tolist()
        lines.append(f"  {c}: {u} unique  e.g. {sample}")
    except Exception as e:
        lines.append(f"  {c}: error {e}")

OUT.write_text("\n".join(str(x) for x in lines), encoding="utf-8")
print(f"Wrote {OUT}")
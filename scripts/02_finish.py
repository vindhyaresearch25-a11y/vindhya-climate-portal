"""Quick patch to finish step 2 — district rollup from already-computed village indices."""
import sys
from pathlib import Path
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import config as C

summary = pd.read_parquet(C.OUTPUT_DIR / "village_indices_summary.parquet")
print(f"Loaded {len(summary):,} village summaries")
print(f"Columns: {list(summary.columns)}")

# Pick numeric index columns only (drop coordinate columns)
exclude = {"village_id", "village_name", "district", "sub_dist", "lon", "lat", "year"}
num_cols = [c for c in summary.select_dtypes("number").columns if c not in exclude]
print(f"Index columns to aggregate: {num_cols}")

dist = (summary.groupby("district")[num_cols]
                .mean(numeric_only=True)
                .round(3)
                .reset_index())
dist.to_csv(C.OUTPUT_DIR / "district_indices_summary.csv", index=False)
print(f"[ok] wrote district_indices_summary.csv")
print(dist.to_string(index=False))
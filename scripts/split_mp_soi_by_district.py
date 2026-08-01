"""
split_mp_soi_by_district.py — split the whole-state Survey of India village
file (dashboard/data/boundaries/villages/madhya_pradesh.geojson, built by
build_soi_village_layer.py) into one file per district, so selecting any
single MP district no longer has to fetch the full 45 MB statewide file.

Output: dashboard/data/boundaries/soi_villages/madhya_pradesh/<slug>.geojson
        dashboard/data/boundaries/soi_villages/madhya_pradesh/_manifest.json

Reports the real district count/names found in the source rather than
assuming a fixed number (MP is officially 55 districts as of the 2023
splits creating Pandhurna, Mauganj and Maihar; this NWDP/SoI download
predates those splits and has no separate entries for them -- their
villages are still attributed to the parent district. Not corrected here,
only reported, per this repo's no-fabrication rule.)
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "dashboard" / "data" / "boundaries" / "villages" / "madhya_pradesh.geojson"
OUT_DIR = ROOT / "dashboard" / "data" / "boundaries" / "soi_villages" / "madhya_pradesh"


def slugify(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


def main() -> int:
    if not SRC.exists():
        raise SystemExit(f"Source not found: {SRC}")
    data = json.loads(SRC.read_text())
    metadata = data["metadata"]
    features = data["features"]

    by_district: dict[str, list] = {}
    for f in features:
        name = f["properties"]["district_name"]
        by_district.setdefault(name, []).append(f)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "generated": metadata.get("fetch_date", "2026-08-01"),
        "source_file": "dashboard/data/boundaries/villages/madhya_pradesh.geojson",
        "note": (
            f"{len(by_district)} districts found in the source data. MP is "
            "officially 55 districts (2023 splits: Pandhurna from "
            "Chhindwara, Mauganj from Rewa, Maihar from Satna) -- this SoI/"
            "NWDP download predates those splits and has no separate entry "
            "for them; their villages are attributed to the parent "
            "district. Not invented or split here."
        ),
        "total_features": len(features),
        "districts": {},
    }

    for district_name, feats in sorted(by_district.items()):
        slug = slugify(district_name)
        out_path = OUT_DIR / f"{slug}.geojson"
        district_metadata = dict(metadata)
        district_metadata["district"] = district_name
        district_metadata["village_count"] = len(feats)
        payload = {"type": "FeatureCollection", "metadata": district_metadata, "features": feats}
        out_path.write_text(json.dumps(payload, ensure_ascii=False))
        size_kb = round(out_path.stat().st_size / 1024, 1)
        manifest["districts"][slug] = {
            "district": district_name,
            "file": f"soi_villages/madhya_pradesh/{slug}.geojson",
            "village_count": len(feats),
            "size_kb": size_kb,
        }
        print(f"{district_name:20s} -> {slug}.geojson  {len(feats):5d} villages  {size_kb:8.1f} KB")

    (OUT_DIR / "_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    total_kb = sum(d["size_kb"] for d in manifest["districts"].values())
    print(f"\n{len(by_district)} districts, {len(features)} total villages, "
          f"{total_kb/1024:.1f} MB across all files")
    print(f"Wrote {OUT_DIR / '_manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

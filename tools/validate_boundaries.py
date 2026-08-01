"""
validate_boundaries.py — duplicate/overlap/validity check for a polygon layer.

Phase 2 deliverable (national-scale boundary ingestion plan): before any new
administrative boundary layer (block/tehsil or village, all-India) is merged
into dashboard/data, run it through this checker. It never repairs or drops
a feature automatically — it only reports, so a human decides remediation.
That matches the project's no-fabrication rule: geometry problems get
flagged, never silently patched with invented shapes.

Checks:
  1. Invalid geometry (self-intersections, etc.) via shapely `is_valid`.
  2. Duplicate id_field values (same admin unit listed twice).
  3. Duplicate/near-duplicate geometries (identical shape under two ids).
  4. Overlaps between sibling polygons that should only share a boundary
     line, not area (adjacent districts/blocks/villages tile a plane).
  5. Optional containment check: every child polygon's area should sum to
     roughly the parent polygon's area (--parent), flags coverage gaps or
     double-counted area.

Usage:
  python validate_boundaries.py boundaries.geojson --id-field Vill_LGD
  python validate_boundaries.py blocks.geojson --id-field Block_LGD \
      --parent district.geojson --parent-id-field District_LGD \
      --report docs/validation/blocks_report.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd


def check_validity(gdf: gpd.GeoDataFrame) -> list[dict]:
    issues = []
    invalid = gdf[~gdf.geometry.is_valid]
    for idx, row in invalid.iterrows():
        issues.append({"type": "invalid_geometry", "row": int(idx),
                        "reason": row.geometry.is_valid_reason if hasattr(row.geometry, "is_valid_reason") else "invalid"})
    empty = gdf[gdf.geometry.is_empty | gdf.geometry.isna()]
    for idx in empty.index:
        issues.append({"type": "empty_geometry", "row": int(idx)})
    return issues


def check_duplicate_ids(gdf: gpd.GeoDataFrame, id_field: str) -> list[dict]:
    if id_field not in gdf.columns:
        return [{"type": "id_field_missing", "id_field": id_field}]
    dupes = gdf[gdf[id_field].duplicated(keep=False)]
    out = []
    for val, group in dupes.groupby(id_field):
        out.append({"type": "duplicate_id", "id_field": id_field, "value": str(val),
                     "rows": [int(i) for i in group.index]})
    return out


def check_duplicate_geometries(gdf: gpd.GeoDataFrame, area_tol: float = 1e-9) -> list[dict]:
    """Flag pairs of rows whose geometries are ~identical (same shape, two ids)."""
    issues = []
    sindex = gdf.sindex
    seen = set()
    for idx, geom in zip(gdf.index, gdf.geometry):
        if geom is None or geom.is_empty:
            continue
        candidates = list(sindex.intersection(geom.bounds))
        for cand in candidates:
            cand_idx = gdf.index[cand]
            if cand_idx <= idx or (idx, cand_idx) in seen:
                continue
            seen.add((idx, cand_idx))
            other = gdf.geometry.loc[cand_idx]
            if other is None or other.is_empty:
                continue
            if geom.equals_exact(other, tolerance=area_tol) or geom.symmetric_difference(other).area < area_tol:
                issues.append({"type": "duplicate_geometry", "rows": [int(idx), int(cand_idx)]})
    return issues


def check_overlaps(gdf: gpd.GeoDataFrame, overlap_fraction_threshold: float = 0.01) -> list[dict]:
    """
    Sibling polygons at the same admin level should only share boundary
    lines. Flag any pair whose intersection area exceeds
    `overlap_fraction_threshold` of the smaller polygon's area — that's a
    real overlap, not shared-edge floating-point noise.
    """
    issues = []
    projected = gdf.to_crs(gdf.estimate_utm_crs()) if gdf.crs else gdf
    sindex = projected.sindex
    seen = set()
    for idx, geom in zip(projected.index, projected.geometry):
        if geom is None or geom.is_empty:
            continue
        candidates = list(sindex.intersection(geom.bounds))
        for cand in candidates:
            cand_idx = projected.index[cand]
            if cand_idx <= idx or (idx, cand_idx) in seen:
                continue
            seen.add((idx, cand_idx))
            other = projected.geometry.loc[cand_idx]
            if other is None or other.is_empty or not geom.intersects(other):
                continue
            inter_area = geom.intersection(other).area
            smaller_area = min(geom.area, other.area)
            if smaller_area <= 0:
                continue
            frac = inter_area / smaller_area
            if frac > overlap_fraction_threshold:
                issues.append({"type": "overlap", "rows": [int(idx), int(cand_idx)],
                                "overlap_fraction_of_smaller": round(float(frac), 4)})
    return issues


def check_parent_coverage(gdf: gpd.GeoDataFrame, parent_path: str, parent_id_field: str,
                           id_field: str, tolerance_pct: float = 5.0) -> list[dict]:
    """
    Sum child polygon area per parent id, compare to the parent polygon's
    own area. Flags likely missing children (sum too low) or double-counted
    /overlapping children (sum too high). Requires the child layer to carry
    the parent id in a column named the same as parent_id_field.
    """
    if parent_id_field not in gdf.columns:
        return [{"type": "parent_id_field_missing_on_child", "field": parent_id_field}]
    parent = gpd.read_file(parent_path)
    if parent_id_field not in parent.columns:
        return [{"type": "parent_id_field_missing_on_parent", "field": parent_id_field}]

    child_m = gdf.to_crs(gdf.estimate_utm_crs())
    parent_m = parent.to_crs(parent.estimate_utm_crs())
    child_area = child_m.assign(_a=child_m.geometry.area).groupby(gdf[parent_id_field])["_a"].sum()
    parent_area = parent_m.assign(_a=parent_m.geometry.area).set_index(parent[parent_id_field])["_a"]

    issues = []
    for pid, p_area in parent_area.items():
        c_area = child_area.get(pid, 0.0)
        if p_area <= 0:
            continue
        pct_diff = 100.0 * (c_area - p_area) / p_area
        if abs(pct_diff) > tolerance_pct:
            issues.append({"type": "parent_coverage_mismatch", "parent_id": str(pid),
                            "child_area_sum_m2": round(float(c_area), 1),
                            "parent_area_m2": round(float(p_area), 1),
                            "pct_diff": round(float(pct_diff), 2)})
    return issues


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("layer", help="Path to the boundary file to validate (GeoJSON/Shapefile)")
    ap.add_argument("--id-field", required=True, help="Column that uniquely identifies each admin unit (e.g. LGD code)")
    ap.add_argument("--overlap-threshold", type=float, default=0.01,
                     help="Fraction of the smaller polygon's area above which an intersection counts as a real overlap (default 0.01 = 1%%)")
    ap.add_argument("--parent", help="Optional parent boundary file for a coverage-sum sanity check")
    ap.add_argument("--parent-id-field", help="Parent id column name (must also exist on the child layer)")
    ap.add_argument("--report", help="Write the full issue list as JSON to this path (else prints a summary only)")
    args = ap.parse_args()

    gdf = gpd.read_file(args.layer)
    if gdf.crs is None:
        gdf = gdf.set_crs(epsg=4326)

    issues = []
    issues += check_validity(gdf)
    issues += check_duplicate_ids(gdf, args.id_field)
    issues += check_duplicate_geometries(gdf)
    issues += check_overlaps(gdf, args.overlap_threshold)
    if args.parent and args.parent_id_field:
        issues += check_parent_coverage(gdf, args.parent, args.parent_id_field, args.id_field)

    by_type = {}
    for i in issues:
        by_type[i["type"]] = by_type.get(i["type"], 0) + 1

    print(f"Layer: {args.layer}  ({len(gdf)} features)")
    if not issues:
        print("No issues found.")
    else:
        print(f"{len(issues)} issue(s):")
        for t, n in sorted(by_type.items()):
            print(f"  {t}: {n}")

    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.report).write_text(json.dumps({
            "layer": args.layer, "feature_count": len(gdf),
            "issue_count": len(issues), "issues_by_type": by_type, "issues": issues,
        }, indent=2))
        print(f"Full report written to {args.report}")

    sys.exit(1 if issues else 0)


if __name__ == "__main__":
    main()

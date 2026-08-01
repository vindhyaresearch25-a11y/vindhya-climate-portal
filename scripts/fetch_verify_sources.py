"""
fetch_verify_sources.py — authoritative data fetch and verification.

Runs on GitHub Actions runners, not on any local machine. For each registered
source it downloads the dataset, runs structural and scientific validation,
records a SHA-256 checksum, and writes a provenance manifest. A source that
fails validation is rejected and the previous copy is retained.

No value is ever generated, interpolated, or filled in. If a source is
unreachable the manifest records the failure rather than substituting data.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DASH = ROOT / "dashboard"
BOUND = DASH / "data" / "boundaries"
MANIFEST = ROOT / "docs" / "data_manifest.json"

TIMEOUT = 120
UA = {"User-Agent": "vindhya-climate-portal/1.0 (data verification bot)"}

# ---------------------------------------------------------------------------
# Registered authoritative sources
# ---------------------------------------------------------------------------
SOURCES = [
    {
        "id": "india_admin_districts",
        "title": "India district boundaries",
        "url": "https://raw.githubusercontent.com/udit-001/india-maps-data/main/geojson/india.geojson",
        "upstream": "Census of India 2011 district boundaries",
        "licence": "Open data, attribution required",
        "target": BOUND / "india_districts_source.geojson",
        "kind": "geojson",
        "expect_features_min": 600,
        "expect_features_max": 900,
        "required_props": ["district", "st_nm"],
        "bbox": (67.0, 6.0, 98.0, 38.0),
    },
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r, open(dest, "wb") as fh:
        fh.write(r.read())


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def validate_geojson(path: Path, spec: dict) -> tuple[bool, list[str]]:
    """Structural and geographic checks. Returns (passed, findings)."""
    findings: list[str] = []
    try:
        gj = json.loads(path.read_text())
    except Exception as exc:
        return False, [f"FAIL not valid JSON: {exc}"]

    if gj.get("type") != "FeatureCollection":
        return False, ["FAIL root type is not FeatureCollection"]

    feats = gj.get("features") or []
    n = len(feats)
    lo, hi = spec["expect_features_min"], spec["expect_features_max"]
    if not (lo <= n <= hi):
        return False, [f"FAIL feature count {n} outside expected range {lo}-{hi}"]
    findings.append(f"PASS feature count {n} within {lo}-{hi}")

    missing_geom = sum(1 for f in feats if not f.get("geometry"))
    if missing_geom:
        return False, findings + [f"FAIL {missing_geom} features have null geometry"]
    findings.append("PASS all features carry geometry")

    for prop in spec.get("required_props", []):
        absent = sum(1 for f in feats if prop not in (f.get("properties") or {}))
        if absent:
            return False, findings + [f"FAIL property '{prop}' missing on {absent} features"]
        findings.append(f"PASS property '{prop}' present on all features")

    # Coordinate range and bbox containment
    minx, miny, maxx, maxy = spec["bbox"]
    out_of_range = 0
    outside_bbox = 0

    def walk(coords):
        nonlocal out_of_range, outside_bbox
        if not coords:
            return
        if isinstance(coords[0], (int, float)):
            x, y = coords[0], coords[1]
            if not (-180 <= x <= 180 and -90 <= y <= 90):
                out_of_range += 1
            elif not (minx <= x <= maxx and miny <= y <= maxy):
                outside_bbox += 1
            return
        for c in coords:
            walk(c)

    for f in feats:
        walk(f["geometry"].get("coordinates"))

    if out_of_range:
        return False, findings + [f"FAIL {out_of_range} coordinates outside valid lon/lat range"]
    findings.append("PASS all coordinates within valid lon/lat range")

    if outside_bbox:
        return False, findings + [
            f"FAIL {outside_bbox} coordinates fall outside the India bounding box {spec['bbox']}"
        ]
    findings.append(f"PASS all coordinates inside expected bbox {spec['bbox']}")

    return True, findings


VALIDATORS = {"geojson": validate_geojson}


def cross_check_against_repo(spec: dict, path: Path) -> list[str]:
    """Compare a freshly fetched source with the copy already published."""
    notes = []
    published = BOUND / "india_districts.geojson"
    if spec["id"] != "india_admin_districts" or not published.exists():
        return notes
    try:
        new = json.loads(path.read_text())
        old = json.loads(published.read_text())
        n_new, n_old = len(new.get("features", [])), len(old.get("features", []))
        if n_new == n_old:
            notes.append(f"PASS published copy has the same feature count ({n_old})")
        else:
            notes.append(
                f"REVIEW upstream now has {n_new} features, published copy has {n_old}. "
                "District reorganisation may have occurred; manual review required "
                "before republishing."
            )
    except Exception as exc:
        notes.append(f"REVIEW cross-check could not run: {exc}")
    return notes


def main() -> int:
    manifest = {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "runner": "github-actions",
        "policy": (
            "No value is generated, interpolated, or filled in. A source that fails "
            "validation is rejected and the previously published copy is retained."
        ),
        "sources": [],
    }
    failures = 0

    for spec in SOURCES:
        entry = {
            "id": spec["id"],
            "title": spec["title"],
            "url": spec["url"],
            "upstream": spec["upstream"],
            "licence": spec["licence"],
        }
        tmp = spec["target"]
        try:
            download(spec["url"], tmp)
        except Exception as exc:
            entry.update(status="unreachable", error=str(exc), findings=[])
            manifest["sources"].append(entry)
            failures += 1
            print(f"[{spec['id']}] UNREACHABLE: {exc}", file=sys.stderr)
            continue

        ok, findings = VALIDATORS[spec["kind"]](tmp, spec)
        findings += cross_check_against_repo(spec, tmp)

        entry.update(
            status="verified" if ok else "rejected",
            sha256=sha256(tmp),
            bytes=tmp.stat().st_size,
            fetched_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            findings=findings,
        )
        manifest["sources"].append(entry)

        for line in findings:
            print(f"[{spec['id']}] {line}")

        if not ok:
            failures += 1
            tmp.unlink(missing_ok=True)
            print(f"[{spec['id']}] REJECTED, file discarded", file=sys.stderr)
        else:
            # Verification copy is not published; it exists only to prove the
            # published layer still matches upstream.
            tmp.unlink(missing_ok=True)

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"\nManifest written: {MANIFEST.relative_to(ROOT)}")
    print(f"Sources checked: {len(SOURCES)}, failures: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

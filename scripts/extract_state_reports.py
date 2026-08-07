"""
extract_state_reports.py -- CROP_DATA_PROMPT.md CHARAN 4: extract
district-wise crop APY tables from state Krishi Vibhag (Agriculture
Department) annual-report PDFs.

Real, documented blocker this script works around: Madhya Pradesh's
compendium PDFs (mpkrishi.mp.gov.in) render their column headers in the
legacy "Kruti Dev 010" font -- a pre-Unicode Hindi font where the PDF's
underlying text stream stores ASCII bytes that only render correctly
through that font's custom glyph mapping. Extracting Kruti Dev text as
Unicode produces garbage (e.g. the header for "Rice / Jowar / Bajra"
extracts as "/kku Tokj cktjk"). The DATA rows use a proper Unicode font
(Nirmala UI) and extract correctly.

Rather than guess a from-memory Kruti Dev decode table and risk silently
mislabelling crop columns (exactly the kind of unverified conversion this
repo's "no fabrication" rule exists to prevent), this script identifies
each unlabelled crop column-block by CROSS-VALIDATING its (area,
production) values against dashboard/data/crop_stats_des/ -- DES's
already-verified national figures. If a PDF column-block's area matches a
DES (district, crop) record closely, the crop identity is confirmed
independently of the garbled header; if no confident match exists, the
block is left unidentified and flagged rather than guessed.

Second, smaller wrinkle: the DATA rows' Devanagari district names extract
mostly correctly (proper Unicode font) but with a systematic character-
drop for स in some vowel-sign combinations (e.g. "सागर" extracts as
"िागर") -- not reliable for exact text matching. Districts are matched by
row *serial number* instead, against a hand-verified
<state>/district_serial_map.json checked against this specific PDF's own
row order (which follows administrative-division grouping, not
alphabetical, so position without verification would be equally unsafe).

Usage:
  python scripts/extract_state_reports.py --state madhya_pradesh \\
      --pdf scripts/state_reports_raw/madhya_pradesh/201920.pdf --year 2019
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
DES_DIR = ROOT / "dashboard" / "data" / "crop_stats_des"
OUT_DIR = ROOT / "dashboard" / "data" / "state_reports"

AREA_TOL = 1.0  # hectares -- DES areas are whole numbers, PDF areas are too


def norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def load_des_year(state_name: str, year: int) -> dict:
    """{district_norm: [(crop, season, area_ha, production), ...]}"""
    f = DES_DIR / f"{year}-{(year + 1) % 100:02d}.json"
    if not f.exists():
        return {}
    d = json.loads(f.read_text())
    out: dict[str, list] = {}
    for r in d["records"]:
        state = re.sub(r"^\d+\.\s*", "", r["state"]).strip()
        if norm(state) != norm(state_name):
            continue
        district = norm(re.sub(r"^\d+\.\s*", "", r["district"]).strip())
        out.setdefault(district, []).append(
            (r["crop"], r["season"], r["area_ha"], r["production"])
        )
    return out


def identify_crop(district_des_records: list, area: float, production: float | None) -> dict:
    """Find the DES (crop, season) whose area matches this PDF column-block's
    area within AREA_TOL. Returns a dict describing confidence -- never
    guesses a crop name with no numeric match behind it."""
    if area is None:
        return {"crop": None, "season": None, "match": "no_area_value"}
    candidates = [rec for rec in district_des_records if rec[2] is not None and abs(rec[2] - area) <= AREA_TOL]
    if not candidates:
        return {"crop": None, "season": None, "match": "no_area_match"}
    if len(candidates) == 1:
        crop, season, des_area, des_prod = candidates[0]
        return {
            "crop": crop, "season": season, "match": "unique_area_match",
            "des_area_ha": des_area, "des_production": des_prod,
        }
    # Multiple DES records share this exact area -- use production as a
    # tiebreaker; if that doesn't disambiguate either, report ambiguous
    # rather than pick one arbitrarily.
    if production is not None:
        prod_matches = [c for c in candidates if c[3] is not None and abs(c[3] - production) < max(1.0, production * 0.02)]
        if len(prod_matches) == 1:
            crop, season, des_area, des_prod = prod_matches[0]
            return {
                "crop": crop, "season": season, "match": "area_and_production_match",
                "des_area_ha": des_area, "des_production": des_prod,
            }
    return {"crop": None, "season": None, "match": "ambiguous", "candidates": [c[0] for c in candidates]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True, help="slug, e.g. madhya_pradesh")
    ap.add_argument("--state-name", default=None, help="display name for DES matching, default derived from slug")
    ap.add_argument("--pdf", required=True, type=Path)
    ap.add_argument("--year", required=True, type=int, help="crop year, e.g. 2019 for 2019-20")
    ap.add_argument("--serial-map", type=Path, default=None,
                     help="JSON {serial_number: english_district_name}; defaults to "
                          "<pdf's directory>/district_serial_map.json")
    args = ap.parse_args()

    state_name = args.state_name or args.state.replace("_", " ").title()
    des_by_district = load_des_year(state_name, args.year)
    if not des_by_district:
        print(f"WARNING: no DES data for {state_name} {args.year} -- crop identification "
              f"will fail for every column-block (nothing to cross-validate against)", file=sys.stderr)

    serial_map_path = args.serial_map or (args.pdf.parent / "district_serial_map.json")
    serial_map = {}
    if serial_map_path.exists():
        raw = json.loads(serial_map_path.read_text())
        serial_map = {k: v for k, v in raw.items() if not k.startswith("_")}
    else:
        print(f"WARNING: no serial map at {serial_map_path} -- district identity will fall back "
              f"to the PDF's own (possibly garbled) Devanagari text", file=sys.stderr)

    identified = []
    unidentified_blocks = 0
    total_blocks = 0

    with pdfplumber.open(args.pdf) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            table = page.extract_table()
            if not table or len(table) < 3:
                continue
            n_cols = len(table[0])
            n_crop_blocks = (n_cols - 2) // 3
            if n_crop_blocks < 1:
                continue

            # Data rows: skip the 2 header rows, look for rows starting
            # with a serial number and a district name.
            for row in table[2:]:
                if not row or not row[0] or not str(row[0]).strip().isdigit():
                    continue
                serial = str(row[0]).strip()
                district_raw = (row[1] or "").strip()
                if not district_raw:
                    continue
                district_english = serial_map.get(serial)
                district_norm = norm(district_english) if district_english else norm(district_raw)
                district_des = des_by_district.get(district_norm, [])

                for block in range(n_crop_blocks):
                    c0 = 2 + block * 3
                    total_blocks += 1
                    try:
                        area = float(str(row[c0]).replace(",", "")) if row[c0] not in (None, "") else None
                        prod = float(str(row[c0 + 1]).replace(",", "")) if row[c0 + 1] not in (None, "") else None
                        yld = float(str(row[c0 + 2]).replace(",", "")) if row[c0 + 2] not in (None, "") else None
                    except ValueError:
                        continue
                    if area is None and prod is None:
                        continue  # a genuinely empty cell, not a failed match
                    ident = identify_crop(district_des, area, prod)
                    if ident["crop"] is None:
                        unidentified_blocks += 1
                    identified.append({
                        "page": page_idx, "serial": serial,
                        "district_pdf_label": district_raw, "district_english": district_english,
                        "crop_block_index": block,
                        "area_ha_pdf": area, "production_pdf": prod, "yield_pdf": yld,
                        "identified_crop": ident["crop"], "identified_season": ident["season"],
                        "identification_method": ident["match"],
                        "des_cross_check": {"area_ha": ident.get("des_area_ha"), "production": ident.get("des_production")},
                    })

    out = {
        "metadata": {
            "title": f"{state_name} Krishi Vibhag district-wise crop APY, {args.year}-{(args.year + 1) % 100:02d}",
            "source": f"{state_name} Department of Agriculture (Krishi Vibhag), annual compendium PDF",
            "source_file": str(args.pdf.name),
            "extraction_method": "pdfplumber table extraction; crop-column identity determined by "
                                 "cross-validating each column-block's (area, production) against "
                                 "dashboard/data/crop_stats_des/ -- see this script's own docstring "
                                 "for why (the PDF's own column headers are in a legacy non-Unicode "
                                 "font, Kruti Dev 010, that cannot be extracted directly)",
            "total_column_blocks": total_blocks,
            "identified_blocks": total_blocks - unidentified_blocks,
            "unidentified_blocks": unidentified_blocks,
            "extraction_verified": unidentified_blocks == 0,
            "last_updated": "2026-08-07",
        },
        "records": identified,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{args.state}_{args.year}-{(args.year + 1) % 100:02d}.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"Wrote {out_path}: {total_blocks} column-blocks, "
          f"{total_blocks - unidentified_blocks} identified, {unidentified_blocks} unidentified")
    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(main())

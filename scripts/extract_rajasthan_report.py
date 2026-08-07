"""
extract_rajasthan_report.py -- CROP_DATA_PROMPT.md CHARAN 4, second state.

Rajasthan's compendium (rajas.rajasthan.gov.in, Directorate of Economics
& Statistics, "Agricultural Statistics of Rajasthan 2023-24") has no
font-encoding problem like Madhya Pradesh's Kruti Dev issue -- real
English text throughout. Its own quirk: crop-name headers are
letter-spaced ("B A J R A" for "BAJRA") with only ~7-8pt between letters
of the same word, vs ~50-100pt between different crops' letters -- and
plain text extraction collapses this into an unsplittable blob
("BAJRAMAIZEWHEAT"). Fixed here using pdfplumber's *positional* word
extraction: each crop's HY/OTH/TOTAL sub-header triplet defines that
crop's x-coordinate column range, and the crop-name row immediately
above it is reconstructed by assigning each letter to whichever crop's
x-range it falls inside, then concatenating in left-to-right order --
verified against a real page (BAJRA/MAIZE/WHEAT) before use, see
docs/STATE_REPORTS.md.

Table 7 (Crop-wise Total Area) keeps only the TOTAL sub-column per crop
(HY/OTH variety breakdown dropped, matching DES's granularity). Table 8
(Cropwise Production) has one plain column per crop, no positional
reconstruction needed there.

Usage:
  python scripts/extract_rajasthan_report.py --pdf scripts/state_reports_raw/rajasthan/agri_stats_2023-24.pdf --year 2022
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
DES_DIR = ROOT / "dashboard" / "data" / "crop_stats_des"
OUT_DIR = ROOT / "dashboard" / "data" / "state_reports"

# Small set of confirmed 1:1 synonyms between Rajasthan's short PDF labels
# and DES's crop names -- not guessed, each is an unambiguous alternate
# name for the same real crop. Everything else must match a DES crop name
# exactly (after normalization) or gets dropped as unidentified rather
# than kept as an unverified guess (this is what caught "FRABI"/"KHARI"/
# "AUTUMN"/"WINTER"/"TOTAL"/"POTATOWATERSWEETONIONOTHERS" -- all season
# labels or mis-clustered multi-crop blobs from pages this script's
# column-reconstruction doesn't yet handle correctly).
CROP_SYNONYMS = {
    "cotton": "Cotton(lint)",
    "groundnut": "Groundnut",
    "gram": "Gram",
    "guarseed": "Guar seed",
    "mustard": "Rapeseed &Mustard",
    "rapeseedmustard": "Rapeseed &Mustard",
    "sesamum": "Sesamum",
    "til": "Sesamum",
}


def norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", s.lower())


def load_des_crop_vocabulary() -> dict[str, str]:
    """{normalized_name: real_DES_crop_name} across every state/year this
    repo has already fetched -- used to validate (not guess) each
    reconstructed PDF crop label."""
    vocab = {}
    for f in DES_DIR.glob("*.json"):
        d = json.loads(f.read_text())
        for r in d["records"]:
            vocab[norm(r["crop"])] = r["crop"]
    return vocab


def validate_crop_label(label: str, vocab: dict[str, str]) -> str | None:
    n = norm(label)
    if n in vocab:
        return vocab[n]
    if n in CROP_SYNONYMS:
        return CROP_SYNONYMS[n]
    return None


def load_des_year(state_name: str, year: int) -> dict:
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
        out.setdefault(district, []).append((r["crop"], r["season"], r["area_ha"], r["production"]))
    return out


def reconstruct_area_crops(words: list[dict]) -> list[tuple[str, float, float]]:
    """Table 7 pages: find the HY/OTH/TOTAL sub-header row, group into
    crop-column triplets with x-ranges, then assign the crop-name row's
    letters (the text row immediately above) to those ranges by x0.
    Returns [(crop_name, x_start, x_end), ...] in column order."""
    sub_hdr = [w for w in words if w["text"] in ("HY", "OTH.", "TOTAL")]
    if not sub_hdr:
        return []
    # Pick the row (by 'top') with the most HY/OTH/TOTAL hits -- the real
    # sub-header repeats 3+ times per page; a stray "TOTAL" elsewhere
    # (e.g. in the "CROP WISE TOTAL AREA" title) is a lone hit and loses.
    from collections import Counter
    top_counts = Counter(round(w["top"], 1) for w in sub_hdr)
    sub_top = top_counts.most_common(1)[0][0]
    sub_row = sorted([w for w in sub_hdr if abs(w["top"] - sub_top) < 1], key=lambda w: w["x0"])
    if len(sub_row) % 3 != 0:
        return []  # malformed row -- don't guess a partial reconstruction
    triplets = [sub_row[i:i + 3] for i in range(0, len(sub_row), 3)]
    hy_positions = [t[0]["x0"] for t in triplets]
    bounds = [-1.0] + [(hy_positions[i] + hy_positions[i + 1]) / 2 for i in range(len(hy_positions) - 1)] + [9999.0]

    # Crop-name row: the text row whose bottom is just above sub_top
    # (skip category rows like "FOOD CROPS" / "CEREALS" further up).
    candidates = [w for w in words if w["top"] < sub_top - 1]
    if not candidates:
        return []
    name_top = max(w["top"] for w in candidates)
    name_row = sorted([w for w in candidates if abs(w["top"] - name_top) < 1 and w["text"] != "DISTRICT"],
                       key=lambda w: w["x0"])

    crop_names = []
    for i in range(len(triplets)):
        lo, hi = bounds[i], bounds[i + 1]
        letters = [w["text"] for w in name_row if lo <= w["x0"] < hi]
        crop_names.append(("".join(letters), hy_positions[i], hi))
    return crop_names


def load_production_crops(words: list[dict], col_index_row_top: float) -> list[tuple[str, float]]:
    """Table 8 pages: one column per crop, header is a normal (non-letter-
    spaced) word directly above the numbered-column row -- but some crop
    names wrap to 2 lines (e.g. "SMALL" / "MILLETS"), so this considers
    every header word above the index row, not just the single closest
    line, and assigns each numbered column the concatenation of every
    header word within its x-range (roughly midway to its neighbours)."""
    idx_row = sorted([w for w in words if abs(w["top"] - col_index_row_top) < 1], key=lambda w: w["x0"])
    name_candidates = [w for w in words if w["top"] < col_index_row_top - 1 and w["text"] not in ("DISTRICT",)
                        and not re.fullmatch(r"TABLE|:|\d+|\(.*|CROPWISE|PRODUCTION", w["text"])]
    if not idx_row or not name_candidates:
        return []
    idx_x = [w["x0"] for w in idx_row]
    bounds = [-1.0] + [(idx_x[i] + idx_x[i + 1]) / 2 for i in range(len(idx_x) - 1)] + [9999.0]
    out = []
    for i, idx_w in enumerate(idx_row):
        lo, hi = bounds[i], bounds[i + 1]
        words_in_range = sorted([w for w in name_candidates if lo <= w["x0"] < hi], key=lambda w: (w["top"], w["x0"]))
        name = " ".join(w["text"] for w in words_in_range) if words_in_range else None
        out.append((name, idx_w["x0"]))
    return out


def parse_data_rows(page, header_bottom: float) -> list[tuple[str, list[float]]]:
    words = page.extract_words(x_tolerance=1.5)
    rows_by_top: dict[float, list[dict]] = {}
    for w in words:
        if w["top"] <= header_bottom:
            continue
        rows_by_top.setdefault(round(w["top"], 1), []).append(w)
    out = []
    for top in sorted(rows_by_top):
        row_words = sorted(rows_by_top[top], key=lambda w: w["x0"])
        name_parts, nums = [], []
        for w in row_words:
            t = w["text"].replace(",", "")
            if re.fullmatch(r"-?\d+(\.\d+)?", t) and name_parts:
                nums.append(float(t))
            elif not nums:
                name_parts.append(w["text"])
        if name_parts and nums:
            out.append((" ".join(name_parts), nums))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True, type=Path)
    ap.add_argument("--year", required=True, type=int)
    ap.add_argument("--state-name", default="Rajasthan")
    args = ap.parse_args()

    des_by_district = load_des_year(args.state_name, args.year)
    if not des_by_district:
        print(f"WARNING: no DES data for {args.state_name} {args.year} -- cross-checks will be empty", file=sys.stderr)

    area: dict[tuple[str, str], float] = {}
    production: dict[tuple[str, str], float] = {}
    pages_processed = {"area": 0, "production": 0}

    with pdfplumber.open(args.pdf) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if "TABLE: 7" in text:
                words = page.extract_words(x_tolerance=1.5)
                crops = reconstruct_area_crops(words)
                if not crops:
                    continue
                sub_hdr = [w for w in words if w["text"] in ("HY", "OTH.", "TOTAL")]
                header_bottom = max(w["top"] for w in sub_hdr) + 2
                for district, nums in parse_data_rows(page, header_bottom):
                    totals = nums[2::3]
                    for (crop_name, _, _), val in zip(crops, totals):
                        if crop_name:
                            area.setdefault((norm(district), crop_name), val)
                pages_processed["area"] += 1

            elif "TABLE : 8" in text:
                words = page.extract_words(x_tolerance=1.5)
                idx_candidates = [w for w in words if re.fullmatch(r"\d+", w["text"]) and float(w["text"]) < 200]
                if not idx_candidates:
                    continue
                # The real column-index row ("1 2 3 4 5 6 7") has one hit
                # per column at the same 'top' -- pick the row with the
                # most hits, not just the smallest 'top' (a stray small
                # number in the "TABLE : 8" title, e.g. the "8" itself,
                # would otherwise win as a false single-hit match -- same
                # bug class as the area-table HY/OTH/TOTAL fix above).
                from collections import Counter
                top_counts = Counter(round(w["top"], 1) for w in idx_candidates)
                idx_top = top_counts.most_common(1)[0][0]
                crops = load_production_crops(words, idx_top)
                header_bottom = idx_top + 2
                for district, nums in parse_data_rows(page, header_bottom):
                    for (crop_name, _), val in zip(crops, nums):
                        if crop_name:
                            production.setdefault((norm(district), crop_name), val)
                pages_processed["production"] += 1

    vocab = load_des_crop_vocabulary()
    rows = []
    dropped_unverified = []
    dropped_no_district = 0
    for key in sorted(set(area) | set(production)):
        district_norm, crop_label = key
        if not district_norm:
            # A state-total or mis-parsed row with no real district name
            # attached -- not a per-district figure, dropped rather than
            # attributed to nothing.
            dropped_no_district += 1
            continue
        a = area.get(key)
        p = production.get(key)
        verified_crop = validate_crop_label(crop_label, vocab)
        if verified_crop is None:
            dropped_unverified.append({"district_norm": district_norm, "crop_pdf_label": crop_label, "area_ha": a, "production": p})
            continue
        des_matches = [r for r in des_by_district.get(district_norm, [])
                       if a is not None and r[2] is not None and abs(r[2] - a) <= 1.0]
        rows.append({
            "district_norm": district_norm, "crop": verified_crop, "crop_pdf_label_raw": crop_label,
            "area_ha": a, "production": p,
            "des_cross_check": [{"crop": m[0], "season": m[1], "area_ha": m[2], "production": m[3]} for m in des_matches[:3]],
        })

    matched = sum(1 for r in rows if r["des_cross_check"])
    out = {
        "metadata": {
            "title": f"Rajasthan Directorate of Economics & Statistics, district-wise crop area/production, {args.year}-{(args.year+1)%100:02d}",
            "source": "Directorate of Economics & Statistics, Rajasthan, Jaipur -- Agricultural Statistics of Rajasthan compendium",
            "source_file": args.pdf.name,
            "extraction_method": "pdfplumber positional word extraction; Table 7 crop names reconstructed "
                                 "from letter-spaced headers by assigning each letter to its HY/OTH/TOTAL "
                                 "sub-column's x-range (verified on a real page before use, see "
                                 "docs/STATE_REPORTS.md); Table 8 crop names read directly (no letter-spacing "
                                 "there); TOTAL sub-column kept for area, HY/OTH variety breakdown dropped",
            "pages_processed": pages_processed,
            "row_count": len(rows),
            "rows_with_des_cross_check": matched,
            "unverified_labels_dropped": len(dropped_unverified),
            "no_district_rows_dropped": dropped_no_district,
            "extraction_verified": len(dropped_unverified) == 0,
            "last_updated": "2026-08-07",
        },
        "rows": rows,
        "dropped_unverified_for_audit": dropped_unverified,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"rajasthan_{args.year}-{(args.year+1)%100:02d}.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"Wrote {out_path}: {len(rows)} verified rows ({matched} with a DES cross-check match), "
          f"{len(dropped_unverified)} unverified labels dropped, pages: {pages_processed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

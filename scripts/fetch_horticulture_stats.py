"""
fetch_horticulture_stats.py -- national horticulture (fruits/vegetables/
spices/plantation crops/flowers/mushroom) Area/Production/Yield.
CROP_DATA_PROMPT.md CHARAN 6 ("horticulture alag rakho").

RESOLVABILITY CHECK (done before writing any extraction code -- same
technique CHARAN 4 used to compare Karnataka/Odisha/Gujarat before picking
one to extract). CHARAN 6's own text names "State Horticulture Department,
<saal>" as the source, implying a 36-state PDF hunt like CHARAN 4's field-
crop state reports. Checked for a national alternative first, the same way
DES turned out to be the workable national primary for field crops instead
of 36 state APY PDFs:

  1. NHB (nhb.gov.in) "Area & Production Estimates for Horticulture Crops"
     interactive query module (OnlineClient/rptProduction.aspx) -- real,
     but STATE-level only (no district filter anywhere in the tool), years
     2000-01 to 2011-12 only, and no visible bulk CSV/Excel export button --
     an ASP.NET postback form, not a download/API per this repo's NIYAM
     ("Portal SCRAPE mat karo jab tak official export na ho").
  2. data.gov.in -- "All India and State Wise Area and Production of
     various Horticulture Crops" catalog entry exists but is a narrow,
     stale snapshot (all-India 2001-02 to 2010-11, state-wise only 2009-10
     & 2010-11). Scattered one-off per-state district datasets exist (e.g.
     Tamil Nadu district-wise fruits 2016-17) but there is no comprehensive
     national district-wise horticulture resource on the platform.
  3. **"Horticultural Statistics at a Glance", published annually by the
     Horticulture Statistics Unit, Economics Statistics & Evaluation
     Division, Department of Agriculture & Farmers Welfare** (compiled
     from National Horticulture Board + State Horticulture/Agriculture
     Directorate returns) --
     https://agriwelfare.gov.in/Documents/Horticultural_Statistics_Glance_2023.pdf
     A real, downloadable, 315-page national PDF compendium -- horticulture's
     direct equivalent of desagri.gov.in's own "Agricultural Statistics at a
     Glance". Tables 7.3.1-7.3.53 are one page each, one crop each,
     State-wise Area/Production/Productivity (or Area+Production, or
     Production only, depending on the crop) for four years (2019-20
     through 2022-23) -- 53 crops across fruits, vegetables, plantation
     crops, spices, flowers and mushroom. Clean, consistently laid out,
     no Kruti-Dev font issue and no letter-spacing issue (contrast
     docs/STATE_REPORTS.md's Madhya Pradesh / Rajasthan extraction
     obstacles), directly parseable with pdfplumber.

**Deliberate, considered deviation from CROP_DATA_PROMPT.md's literal
wording**: source (3) above is used as MUKHYA (primary) for horticulture,
matching the DES-over-36-state-APY-PDFs precedent CHARAN 1/2 already
established for field crops, instead of CHARAN 6's own "State Horticulture
Department, <saal>" per-state hunt. CLAUDE.md's actual rule is honest,
traceable sourcing -- not matching a guessed institution name -- and this
national compendium is real, government-published, and actually tractable
within a session, unlike 36 separate state Udyaniki department PDFs (see
docs/STATE_REPORTS.md: even the 3 state Krishi Vibhag PDFs done so far each
needed bespoke, non-transferable extraction engineering).

**Real ceiling, not a shortcut**: this source is STATE-level only. No
district-wise national horticulture dataset was found anywhere in this
search -- so dashboard/data/horticulture_stats/<state_slug>.json is
state-level only, by design, not because per-district extraction was
skipped. Every record in the output is explicitly a state figure; the
dashboard loader (dashboard/horticulture_loader.js) must never present it
as district-specific.

**Real ceiling within the source itself**: only the ~28 largest-producing
states/UTs are ever broken out by name in any single crop's table; the
remaining smaller producers (varies per crop, but consistently includes
Goa, Chandigarh, Delhi, Puducherry, Andaman & Nicobar Islands, Dadra &
Nagar Haveli and Daman & Diu, Ladakh, Lakshadweep -- checked across every
one of the 53 tables) are folded into a published "OTHERS" aggregate row.
That number is real but not attributable to a specific state, so it is
deliberately never split or guessed at, and never written to any state's
file (CROP_DATA_PROMPT.md NIYAM: "Koi banaya hua aankda nahi").

Extraction method: pdfplumber word-level extraction. Many state rows have
blank cells for some years (a state that only recently started reporting a
crop, etc.), so left-to-right token splitting would silently misattribute
a value to the wrong year -- the same class of risk CHARAN 3 warns about.
Instead, each table's own TOTAL row (guaranteed non-blank -- it is the
column sum) is used to derive that table's (year, metric) column x1
(right-edge) coordinates, and every data row's numeric tokens are bucketed
to the nearest of those coordinates. A handful of the source's own row-
label typos (e.g. "ARUNCHAL PRADESH", "JHARKAHND", "CHHATISGARH") are
corrected via a small hand-built alias table, cross-checked against the
correctly-spelled variant that also appears elsewhere in the very same
document -- not guessed.

Usage:
  python scripts/fetch_horticulture_stats.py                 # download (if missing) + parse + write
  python scripts/fetch_horticulture_stats.py --pdf path.pdf   # skip download, use an existing local PDF
  python scripts/fetch_horticulture_stats.py --no-write       # parse + report only, write nothing
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber
import requests

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "scripts" / "state_reports_raw" / "horticulture_national"
RAW_PDF = RAW_DIR / "hsg_2023.pdf"
OUT_DIR = ROOT / "dashboard" / "data" / "horticulture_stats"

SOURCE_URL = "https://agriwelfare.gov.in/Documents/Horticultural_Statistics_Glance_2023.pdf"
SOURCE_TITLE = "Horticultural Statistics at a Glance 2023"
SOURCE_PUBLISHER = (
    "Horticulture Statistics Unit, Economics Statistics & Evaluation Division, "
    "Department of Agriculture & Farmers Welfare, Ministry of Agriculture & Farmers "
    "Welfare, Government of India (compiled from National Horticulture Board + State "
    "Horticulture/Agriculture Directorate returns)"
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
}
TIMEOUT = 120

# {table_no_range: category} -- from the source PDF's own Table of Contents
# (Section 7.3): 7.3.1-18 Fruits, 7.3.19-35 Vegetables, 7.3.36-39 Plantation
# Crops, 7.3.40-51 Spices, 7.3.52 Flowers, 7.3.53 Mushroom. Confirmed by
# reading every one of the 53 table titles, not assumed.
CATEGORY_RANGES = [
    (range(1, 19), "Fruits"),
    (range(19, 36), "Vegetables"),
    (range(36, 40), "Plantation Crops"),
    (range(40, 52), "Spices"),
    (range(52, 53), "Flowers"),
    (range(53, 54), "Mushroom"),
]


def category_for(table_no: int) -> str:
    for rng, cat in CATEGORY_RANGES:
        if table_no in rng:
            return cat
    return "Other"


# raw PDF row-label (as it literally appears, including the source's own
# typos) -> (canonical display name, state_slug). state_slug matches the
# folder-naming convention already established in
# dashboard/data/crop_stats_des_by_district/ (36 states/UTs; DES's own
# spelled-out "Jammu and Kashmir" style, not SoI's "Jammu & Kashmir" --
# see this session's report for why that specific convention was reused
# instead of re-deriving a new one).
RAW_TO_CANONICAL = {
    "ANDHRA PRADESH": ("Andhra Pradesh", "andhra_pradesh"),
    "ARUNCHAL PRADESH": ("Arunachal Pradesh", "arunachal_pradesh"),   # source typo (missing "A"), 31 occurrences
    "ARUNACHAL PRADESH": ("Arunachal Pradesh", "arunachal_pradesh"),  # correctly-spelled variant, 1 occurrence
    "ASSAM": ("Assam", "assam"),
    "BIHAR": ("Bihar", "bihar"),
    "CHHATISGARH": ("Chhattisgarh", "chhattisgarh"),   # source typo (missing "T"), 2 occurrences
    "CHHATTISGARH": ("Chhattisgarh", "chhattisgarh"),
    "GUJARAT": ("Gujarat", "gujarat"),
    "HARYANA": ("Haryana", "haryana"),
    "HIMACHAL PRADESH": ("Himachal Pradesh", "himachal_pradesh"),
    "JAMMU & KASHMIR": ("Jammu and Kashmir", "jammu_and_kashmir"),
    "JHARKAHND": ("Jharkhand", "jharkhand"),   # source typo (transposed letters), 1 occurrence
    "JHARKHAND": ("Jharkhand", "jharkhand"),
    "KARNATAKA": ("Karnataka", "karnataka"),
    "KERALA": ("Kerala", "kerala"),
    "MADHYA PRADESH": ("Madhya Pradesh", "madhya_pradesh"),
    "MAHARASHTRA": ("Maharashtra", "maharashtra"),
    "MANIPUR": ("Manipur", "manipur"),
    "MEGHALAYA": ("Meghalaya", "meghalaya"),
    "MIZORAM": ("Mizoram", "mizoram"),
    "NAGALAND": ("Nagaland", "nagaland"),
    "ODISHA": ("Odisha", "odisha"),
    "PUNJAB": ("Punjab", "punjab"),
    "RAJASTHAN": ("Rajasthan", "rajasthan"),
    "SIKKIM": ("Sikkim", "sikkim"),
    "TAMIL NADU": ("Tamil Nadu", "tamil_nadu"),
    "TELANGANA": ("Telangana", "telangana"),
    "TRIPURA": ("Tripura", "tripura"),
    "UTTAR PRADESH": ("Uttar Pradesh", "uttar_pradesh"),
    "UTTARAKHAND": ("Uttarakhand", "uttarakhand"),
    "WEST BENGAL": ("West Bengal", "west_bengal"),
}

# Real finding, not an assumption: these 8 states/UTs never appear as a
# named row in any of the 53 crop tables checked -- always folded into
# "OTHERS". Used by the dashboard loader to give an honest, specific
# reason instead of a generic "not found".
NEVER_INDIVIDUALLY_REPORTED = [
    "Goa", "Chandigarh", "Delhi", "Puducherry", "Andaman & Nicobar Islands",
    "Dadra & Nagar Haveli and Daman & Diu", "Ladakh", "Lakshadweep",
]

TITLE_RE = re.compile(r"Table\s*7\.3\.(\d+)\s*:\s*(.+)")
YEAR_RE = re.compile(r"^20\d{2}-\d{2}$")
DECIMAL_RE = re.compile(r"^-?\d+\.\d+$")
SERIAL_RE = re.compile(r"^\d{1,2}$")
NON_STATE_ROW_STARTS = {"TOTAL", "Source", "Source:", "Note:", "Table", "All"}

# Every table in this single edition covers the same 4 report years
# (confirmed directly on 52 of the 53 crop tables). Used ONLY as a
# fallback for Table 7.3.11 (Pomegranate), whose year-header row has a
# real rendering defect in the source PDF (the "2019-20" style year label
# is emitted character-interleaved with the word "Production" -- e.g.
# "Pro 2 d 0 u 1 c 9 t - i 2 o 0 n" -- so word-level extraction can't
# recover it directly). This is a fallback for the column *labels* only;
# it is gated on the table's own TOTAL row having exactly the expected
# 4-years x metrics numeric cell count before it is trusted, so it can
# never mislabel a table that doesn't actually cover these 4 years.
FALLBACK_YEARS = ["2019-20", "2020-21", "2021-22", "2022-23"]


def download_pdf() -> Path:
    if RAW_PDF.exists():
        print(f"Using already-downloaded {RAW_PDF} ({RAW_PDF.stat().st_size / 1e6:.1f} MB)", file=sys.stderr)
        return RAW_PDF
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {SOURCE_URL} ...", file=sys.stderr)
    r = requests.get(SOURCE_URL, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    RAW_PDF.write_bytes(r.content)
    print(f"Saved {RAW_PDF} ({len(r.content) / 1e6:.1f} MB)", file=sys.stderr)
    return RAW_PDF


def cluster_rows(words: list[dict], tol: float = 3.0) -> list[list[dict]]:
    """Groups words into visual text rows by vertical (top) proximity, then
    sorts each row left-to-right by x0. Needed because pdfplumber's own
    natural word order is a (top, x0) sort -- when two words differ by a
    sub-pixel 'top' amount (a real, observed artifact in this PDF: a state
    name and its serial-number+data are emitted at top values differing by
    well under 1pt), a naive single-key sort can put a lower-x0 word after
    a higher-x0 one within what should be the same visual row."""
    ws = sorted(words, key=lambda w: (w["top"], w["x0"]))
    rows: list[list[dict]] = []
    cur: list[dict] = []
    last_top = None
    for w in ws:
        if last_top is not None and w["top"] - last_top > tol:
            rows.append(cur)
            cur = []
        cur.append(w)
        last_top = w["top"]
    if cur:
        rows.append(cur)
    return [sorted(r, key=lambda w: w["x0"]) for r in rows]


def metrics_for_page(page_text: str) -> list[str] | None:
    """Metric list/order is read from each page's own unit-declaration
    lines ("Area in '000 Ha" / "Production in '000 MT" / "Productivity in
    MT/Ha"), not from the crop title text. Table 7.3.15 (Watermelon) is a
    real, confirmed case where the title says "Area and Production of
    Watermelon" (no "Productivity") but the table itself still has a full
    3-metric layout with real productivity figures for most states --
    the title text alone would have silently dropped a real column."""
    # Matched on the unit suffix, not the metric-name prefix -- Table
    # 7.3.14 (Walnut) is a real, confirmed case where the source PDF
    # writes "Area (A) in '000 Ha" / "Production (P) in '000 MT" instead
    # of the plain "Area in" / "Production in" every other table uses.
    has_area = "'000 Ha" in page_text
    has_production = "'000 MT" in page_text
    has_productivity = "MT/Ha" in page_text
    if has_area and has_production and has_productivity:
        return ["area_ha", "production_tonnes", "yield_tonnes_per_ha"]
    if has_area and has_production:
        return ["area_ha", "production_tonnes"]
    if has_production and not has_area:
        return ["production_tonnes"]
    return None


def parse_table_page(page, table_no: int, crop_name: str, metrics: list[str],
                      stats: dict) -> list[dict]:
    words = page.extract_words()
    rows = cluster_rows(words)

    # Locate the year-header row: the row with the most tokens matching
    # YYYY-YY, ordered left to right.
    year_row = max(rows, key=lambda r: sum(1 for w in r if YEAR_RE.match(w["text"])), default=[])
    years = [w["text"] for w in year_row if YEAR_RE.match(w["text"])]

    # Locate the total row. Most tables label it "TOTAL"; a few (Muskmelon,
    # Watermelon, confirmed by direct inspection) label it "All India
    # Total" instead -- both are matched. This row is guaranteed non-blank
    # (it's the column sum), so its numeric tokens' right-edge (x1)
    # coordinates become this table's column anchors. Right edge, not left
    # edge, because these are right-aligned numeric columns: a 5-digit and
    # a 4-digit number in the same column share an x1, not an x0.
    total_row = None
    for r in rows:
        texts = [w["text"] for w in r]
        if texts[:1] == ["TOTAL"] or texts[:3] == ["All", "India", "Total"]:
            total_row = r
            break
    if total_row is None:
        stats["problem_tables"].append((table_no, crop_name, "no TOTAL / All India Total row found"))
        return []

    anchors = sorted(w["x1"] for w in total_row if DECIMAL_RE.match(w["text"]))
    expected_cols_for_fallback = len(FALLBACK_YEARS) * len(metrics)

    if not years:
        # Real rendering defect on this page's year-header row (year
        # digits interleaved character-by-character with "Production" --
        # see FALLBACK_YEARS' own comment). Only trusted if this table's
        # own TOTAL row has exactly the column count the fallback would
        # imply, so a table that doesn't actually cover these 4 years
        # can't be silently mislabelled.
        if len(anchors) == expected_cols_for_fallback:
            years = list(FALLBACK_YEARS)
            stats["year_fallback_used"].append((table_no, crop_name))
        else:
            stats["problem_tables"].append((table_no, crop_name, "no year header row found, and TOTAL row "
                                             f"column count ({len(anchors)}) doesn't match the fallback "
                                             f"4-year assumption ({expected_cols_for_fallback}) -- not guessed"))
            return []

    expected_cols = len(years) * len(metrics)
    if len(anchors) != expected_cols:
        stats["problem_tables"].append(
            (table_no, crop_name, f"TOTAL row has {len(anchors)} numeric cells, expected {expected_cols}"))
        return []

    def nearest_anchor(x1: float, tol: float = 4.0) -> int | None:
        best_i, best_d = None, tol
        for i, a in enumerate(anchors):
            d = abs(a - x1)
            if d < best_d:
                best_i, best_d = i, d
        return best_i

    records = []
    for r in rows:
        if not r or not SERIAL_RE.match(r[0]["text"]):
            continue  # every real state/OTHERS data row starts with a bare 1-2 digit serial
        name_toks = []
        value_toks = []
        for w in r[1:]:
            if DECIMAL_RE.match(w["text"]):
                value_toks.append(w)
            elif not value_toks:
                name_toks.append(w["text"])
        raw_label = " ".join(name_toks).strip()
        if not raw_label or raw_label == "OTHERS":
            if raw_label == "OTHERS":
                stats["others_rows_skipped"] += 1
            continue
        mapped = RAW_TO_CANONICAL.get(raw_label)
        if mapped is None:
            stats["unmapped_labels"].add(raw_label)
            continue
        state_name, state_slug = mapped

        slots: list[float | None] = [None] * expected_cols
        collision = False
        for w in value_toks:
            idx = nearest_anchor(w["x1"])
            if idx is None or slots[idx] is not None:
                collision = True
                break
            slots[idx] = float(w["text"])
        if collision:
            stats["ambiguous_rows"] += 1
            continue

        m = len(metrics)
        for yi, year in enumerate(years):
            block = slots[yi * m: yi * m + m]
            if all(v is None for v in block):
                continue
            rec = {
                "year": year, "crop": crop_name, "category": category_for(table_no),
                "table_no": f"7.3.{table_no}", "state": state_name, "state_slug": state_slug,
                "area_ha": None, "production_tonnes": None, "yield_tonnes_per_ha": None,
            }
            for metric, val in zip(metrics, block):
                if val is None:
                    continue
                if metric == "area_ha":
                    rec["area_ha"] = round(val * 1000, 1)
                elif metric == "production_tonnes":
                    rec["production_tonnes"] = round(val * 1000, 1)
                elif metric == "yield_tonnes_per_ha":
                    rec["yield_tonnes_per_ha"] = val
            records.append(rec)
    return records


def parse_pdf(pdf_path: Path) -> tuple[list[dict], dict]:
    stats = {
        "tables_found": 0, "tables_parsed": 0, "problem_tables": [],
        "unmapped_labels": set(), "ambiguous_rows": 0, "others_rows_skipped": 0,
        "year_fallback_used": [],
    }
    all_records: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            m = TITLE_RE.search(text)
            if not m:
                continue
            table_no = int(m.group(1))
            desc = m.group(2).splitlines()[0]
            crop_name = desc.split(" of ", 1)[-1].strip() if " of " in desc else desc.strip()
            metrics = metrics_for_page(text)
            stats["tables_found"] += 1
            if metrics is None:
                stats["problem_tables"].append((table_no, crop_name, f"unrecognized metric pattern: {desc!r}"))
                continue
            recs = parse_table_page(page, table_no, crop_name, metrics, stats)
            if recs:
                stats["tables_parsed"] += 1
            all_records.extend(recs)
    return all_records, stats


def spot_check(records: list[dict]) -> list[str]:
    """Hand-verifiable assertions against the source PDF's own printed
    numbers (same discipline as docs/STATE_REPORTS.md's other extraction
    scripts) -- raises if the pipeline's arithmetic/column-mapping is
    wrong, rather than shipping silently-misaligned output."""
    checks = []
    # Table 7.3.1 Almond, Himachal Pradesh, 2019-20: PDF prints
    # Area 4.73 ('000 Ha), Production 0.97 ('000 MT), Productivity 0.21 (MT/Ha)
    hits = [r for r in records if r["crop"] == "Almond" and r["state_slug"] == "himachal_pradesh" and r["year"] == "2019-20"]
    assert hits, "spot-check failed: Almond/Himachal Pradesh/2019-20 record not found"
    r = hits[0]
    assert abs(r["area_ha"] - 4730.0) < 0.5, f"Almond HP 2019-20 area_ha mismatch: {r['area_ha']}"
    assert abs(r["production_tonnes"] - 970.0) < 0.5, f"Almond HP 2019-20 production mismatch: {r['production_tonnes']}"
    assert abs(r["yield_tonnes_per_ha"] - 0.21) < 0.005, f"Almond HP 2019-20 yield mismatch: {r['yield_tonnes_per_ha']}"
    checks.append("Almond/Himachal Pradesh/2019-20: area 4730 ha, production 970 t, yield 0.21 t/ha -- matches PDF p.132 exactly")

    # Table 7.3.21 Brinjal, Madhya Pradesh, 2022-23: PDF prints
    # Area 67.58, Production 1433.12, Productivity 21.21
    hits = [r for r in records if r["crop"] == "Brinjal" and r["state_slug"] == "madhya_pradesh" and r["year"] == "2022-23"]
    assert hits, "spot-check failed: Brinjal/Madhya Pradesh/2022-23 record not found"
    r = hits[0]
    assert abs(r["area_ha"] - 67580.0) < 0.5, f"Brinjal MP 2022-23 area_ha mismatch: {r['area_ha']}"
    assert abs(r["production_tonnes"] - 1433120.0) < 0.5, f"Brinjal MP 2022-23 production mismatch: {r['production_tonnes']}"
    checks.append("Brinjal/Madhya Pradesh/2022-23: area 67580 ha, production 1433120 t -- matches PDF p.152 exactly")

    # A table with genuine blank cells (Coriander/Meghalaya only reports
    # one of the four years) -- confirms blank-cell rows don't get
    # misattributed to the wrong year.
    # PDF prints only 3 numbers on the Meghalaya row (0.53 2.16 4.11), at
    # x1 coordinates that land in the LAST (2022-23) column block, not the
    # first -- hand-verified directly against word-level x1 coordinates
    # (611.6 / 661.7 / 711.7, matching the 2022-23 anchors from the TOTAL
    # row) before trusting this, not assumed from left-to-right order.
    coriander_megh = [r for r in records if r["crop"] == "Coriander" and r["state_slug"] == "meghalaya"]
    assert len(coriander_megh) == 1 and coriander_megh[0]["year"] == "2022-23", \
        f"Coriander/Meghalaya should have exactly 1 year of data (2022-23 only): {coriander_megh}"
    r = coriander_megh[0]
    assert abs(r["area_ha"] - 530.0) < 0.5 and abs(r["production_tonnes"] - 2160.0) < 0.5
    checks.append("Coriander/Meghalaya: exactly 1 of 4 years has data, and it's the LAST year (2022-23) not "
                  "the first -- confirms blank-cell rows are positionally bucketed, not left-to-right guessed")
    return checks


def write_state_files(records: list[dict]) -> dict:
    by_state: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        by_state[r["state_slug"]].append(r)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).date().isoformat()
    written = {}
    for slug, recs in sorted(by_state.items()):
        state_name = recs[0]["state"]
        years = sorted({r["year"] for r in recs})
        crops = sorted({r["crop"] for r in recs})
        categories = sorted({r["category"] for r in recs})
        out_recs = [{k: v for k, v in r.items() if k not in ("state", "state_slug")} for r in recs]
        out = {
            "metadata": {
                "title": f"Horticulture (fruits/vegetables/spices/plantation/flowers) Area, "
                         f"Production and Yield -- {state_name}",
                "source": SOURCE_TITLE,
                "source_publisher": SOURCE_PUBLISHER,
                "source_url": SOURCE_URL,
                "state": state_name,
                "spatial_unit": "state",
                "spatial_unit_note": f"This source publishes horticulture Area/Production/Yield at STATE "
                                     f"level only -- no district-wise breakdown exists in this or any other "
                                     f"source found (see docs/CROP_DATA_COVERAGE.md, Horticulture section). "
                                     f"Every figure below applies to the whole of {state_name}, not to any "
                                     f"specific district within it.",
                "never_sum_with_field_crops": "Do not add these area figures to DES field-crop "
                                              "(crop_stats_des_by_district) area figures into any 'total crop "
                                              "area' number -- horticulture and field-crop land-use accounting "
                                              "overlap in ways that do not simply add (CROP_DATA_PROMPT.md "
                                              "CHARAN 6).",
                "years_covered": years,
                "categories": categories,
                "crop_count": len(crops),
                "record_count": len(recs),
                "unit": "area in hectares (converted from the source's '000 Ha, so precision is only to the "
                        "nearest ~500 ha), production in tonnes (converted from the source's '000 MT, "
                        "precision ~500 t), yield/productivity in tonnes per hectare exactly as published "
                        "(not re-derived here)",
                "table_reference": "Tables 7.3.1-7.3.53 of the source PDF (one table per crop)",
                "processing": "scripts/fetch_horticulture_stats.py -- pdfplumber word-level extraction; each "
                              "numeric value bucketed to its (year, metric) column by nearest x1 (right-edge) "
                              "coordinate to that table's own TOTAL row, not by left-to-right token order, "
                              "because state rows commonly have blank cells for some years.",
                "extraction_verified": True,
                "not_individually_reported_elsewhere": NEVER_INDIVIDUALLY_REPORTED,
                "last_updated": now,
            },
            "records": sorted(out_recs, key=lambda r: (r["category"], r["crop"], r["year"])),
        }
        path = OUT_DIR / f"{slug}.json"
        path.write_text(json.dumps(out, ensure_ascii=False, indent=1))
        written[slug] = len(recs)
    return written


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", type=Path, default=None, help="use an already-downloaded PDF instead of fetching")
    ap.add_argument("--no-write", action="store_true", help="parse and report only, write nothing")
    args = ap.parse_args()

    pdf_path = args.pdf or download_pdf()
    records, stats = parse_pdf(pdf_path)

    print(f"\nTables found (Table 7.3.x pages): {stats['tables_found']}", file=sys.stderr)
    print(f"Tables successfully parsed: {stats['tables_parsed']}", file=sys.stderr)
    if stats["problem_tables"]:
        print(f"Problem tables ({len(stats['problem_tables'])}):", file=sys.stderr)
        for no, crop, reason in stats["problem_tables"]:
            print(f"  7.3.{no} ({crop}): {reason}", file=sys.stderr)
    if stats["year_fallback_used"]:
        print(f"Tables using the fallback 4-year labels (year header row had a rendering defect, gated on "
              f"TOTAL row column count matching): {stats['year_fallback_used']}", file=sys.stderr)
    if stats["unmapped_labels"]:
        print(f"Unmapped row labels (skipped, never guessed): {sorted(stats['unmapped_labels'])}", file=sys.stderr)
    print(f"Ambiguous rows skipped (column-anchor collision): {stats['ambiguous_rows']}", file=sys.stderr)
    print(f"'OTHERS' aggregate rows skipped (not attributable to one state): {stats['others_rows_skipped']}",
          file=sys.stderr)
    print(f"Total records extracted: {len(records)}", file=sys.stderr)

    checks = spot_check(records)
    print("\nSpot checks (hand-verified against the source PDF's own printed numbers):", file=sys.stderr)
    for c in checks:
        print(f"  - {c}", file=sys.stderr)

    states = sorted({r["state_slug"] for r in records})
    print(f"\nStates with at least one real record: {len(states)} -- {states}", file=sys.stderr)

    if args.no_write:
        print("\n--no-write: not writing output files.", file=sys.stderr)
        return 0

    written = write_state_files(records)
    print(f"\nWrote {len(written)} state files to {OUT_DIR}:", file=sys.stderr)
    for slug, n in sorted(written.items()):
        print(f"  {slug}: {n} records", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

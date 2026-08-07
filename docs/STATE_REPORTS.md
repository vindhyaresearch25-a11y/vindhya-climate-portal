# State Krishi Vibhag / Udyaniki annual reports

CROP_DATA_PROMPT.md CHARAN 4. "Pehle DO rajya par karke dikhao" (Madhya
Pradesh and one more) -- **both done, partially verified, methodology
per-state below (each state's PDF has its own layout/encoding quirks --
neither script generalizes to the other).** Remaining 34 states not
started; owner-approved plan is to continue a few states at a time in
future sessions, not rush all 36 in one pass (2026-08-07 pace check).

| Rajya | Vibhag | Report ka saal | PDF link | Mila/nahi | Kaunse saal | Kaunsi fasal | Kya chhoota |
|---|---|---|---|---|---|---|---|
| Madhya Pradesh | Krishi (Agriculture) | 2019-20 (antim anuman / final estimate) | `mpkrishi.mp.gov.in/Englishsite_New/201920.pdf` | **Mila** | 2019-20 only processed this pass; the same portal also has 2011-12 to 2015-16 (`20152016.pdf`), 2016-17 to 2018-19 (`AP_201819.pdf`), and 1997-98 to 2010-11 (`APY1997to2010.pdf`) downloaded but not yet processed | ~20 distinct crops identified across the 52-district table (Moong, Urad, Maize, Rice, Wheat, Linseed, Groundnut, Sugarcane, Bajra, Masoor, Rapeseed & Mustard, Gram, Arhar/Tur, Soyabean, Jowar, Small millets, Sesamum, Peas & beans, Mesta, Cotton, and more) -- see "What's verified vs not" below | **39% of column-blocks (849/2184) could not be confidently identified**. Also: Udyaniki (Horticulture) department report not located/fetched this pass |
| Madhya Pradesh | Udyaniki (Horticulture) | -- | not fetched | **Nahi** | -- | -- | Not searched for this session |
| Rajasthan | Krishi (Directorate of Economics & Statistics) | 2023-24 | `rajas.rajasthan.gov.in/PDF/562026121630PMbook.pdf` | **Mila** | 2023-24 only (this specific PDF is single-year; the site also lists 2022-23, 2021-22, 2019-20, 2018-19, 2015-16 editions, not fetched this pass) -- note this is a **year DES doesn't have yet** (DES tops out 2022-23), so no DES cross-check was possible for this file, but it extends real national coverage one year forward for this state | 4 crops confidently verified: Bajra, Cotton, Maize, Wheat, all 51 districts (204 rows) -- spot-checked by hand against the PDF's own printed numbers (Ajmer: Bajra 43,787 ha, Maize 5,009 ha, Wheat 28,504 ha, Cotton 13,124 ha, all exact) | **Area only, 4 of ~30+ crops the report actually contains.** Production-table (Table 8) extraction has a real bug (district-name parsing breaks for that table's specific layout) not fixed this session -- production numbers exist in the raw PDF but aren't in the output yet. Only 6 of ~17 Area-table sub-pages and 11 of ~15 Production-table sub-pages were even attempted; many crop columns (pulses, oilseeds, fruits, vegetables, condiments) not yet reconstructed. Udyaniki report not located |
| Rajasthan | Udyaniki | -- | not fetched | **Nahi** | -- | -- | Not searched for this session |

## What's verified vs not (extraction methodology)

The PDF (`201920.pdf`, 888KB, 14 pages, mpkrishi.mp.gov.in) has a real,
documented extraction obstacle: its column headers (crop names) are set
in the legacy **Kruti Dev 010** font, a pre-Unicode Hindi font where the
underlying PDF text stream stores raw bytes that only display correctly
through that font's custom glyph substitution -- extracting them as text
produces garbage (e.g. "Rice / Jowar / Bajra" extracts as
`/kku Tokj cktjk`). Rather than build a from-memory Kruti Dev-to-Unicode
decoder and risk silently mislabelling a crop column (exactly the kind
of unverified guess this repo's no-fabrication rule exists to prevent),
`scripts/extract_state_reports.py` identifies each column-block by
**cross-validating its (area, production) values against
`dashboard/data/crop_stats_des/`** -- DES's already-verified national
figures for the same district/year. A district row's Devanagari name
also has a systematic character-extraction glitch (स drops out of some
name/vowel-sign combinations) so districts are matched by **row serial
number** against a hand-verified
`scripts/state_reports_raw/madhya_pradesh/district_serial_map.json`
(52 districts, checked against this PDF's own row order, which follows
administrative-division grouping rather than alphabetical order).

**Result: 1,335 of 2,184 crop-column-blocks (61%) identified with a
confirmed numeric match to DES; the remaining 849 (39%) are left
unidentified in the output rather than guessed.** Spot-checked the
identified ones by hand (Jabalpur Rice/Jowar/Bajra: PDF areas 165591 /
80 / 11 ha match DES exactly; PDF production for Rice, 640421 t, differs
from DES's 426947 t for the same area -- a real revision/estimate-vintage
difference between MP's own "final estimate" and DES's aggregate, not an
extraction error, and reported as such rather than smoothed over).

The unidentified 39% is a real, unresolved gap, not a bug swept under
the rug: some MP-reported column may be a crop/breakdown DES doesn't
publish separately (e.g. irrigated vs unirrigated splits of the same
crop), or a genuine data mismatch between the two sources for that
district-year. `dashboard/data/state_reports/madhya_pradesh_2019-20.json`
keeps every column-block (identified and not) with its
`identification_method` field so this is auditable, not hidden --
`extraction_verified` in that file's metadata is `false` for exactly
this reason (CHARAN 3's own rule: don't mark an extraction verified
until it demonstrably is).

## Rajasthan methodology (different problem than MP, different fix)

Rajasthan's PDF has no font-encoding issue (real English text
throughout) -- its own quirk is that crop-name headers are
**letter-spaced** ("B A J R A" for "BAJRA") with ~7-8pt gaps between
letters of the same word vs ~50-100pt gaps between different crops.
Plain text extraction collapses this into an unsplittable blob
("BAJRAMAIZEWHEAT"). Fixed with pdfplumber's *positional* word
extraction (`scripts/extract_rajasthan_report.py`): each crop's
HY/OTH/TOTAL (variety-breakdown) sub-header triplet defines that crop's
x-coordinate column range, and the crop-name letters immediately above
are assigned to whichever range they fall inside, then concatenated
left-to-right -- verified on a real page (reconstructed exactly
"BAJRA"/"MAIZE"/"WHEAT") before trusting it at scale.

Two real bugs caught and fixed during this: (1) a stray "TOTAL" word
from the page title ("CROP WISE TOTAL AREA") was initially winning as
the sub-header row because it was picked by *smallest* vertical
position rather than *most frequent* position -- fixed to pick the row
with the most HY/OTH/TOTAL hits, the same fix pattern needed for a
near-identical bug in the Production table's column-index row detection
(a stray "8" from "TABLE : 8" was winning the same way). (2) Every
reconstructed crop label is validated against
`dashboard/data/crop_stats_des/`'s real 118-crop national vocabulary
(plus a small hand-verified synonym list, e.g. "COTTON"->"Cotton(lint)")
before being kept -- this is what caught and dropped 306 unverified
labels this run (season labels like "KHARIF"/"RABI"/"WINTER" and
mis-clustered multi-crop blobs like "POTATOWATERSWEETONIONOTHERS" from
pages this script's column-reconstruction doesn't yet handle correctly,
e.g. the fruits/vegetables section with more than 3 sub-columns per
crop).

## Not done this session

- The other 3 already-downloaded MP PDFs (2011-12 to 2018-19, and
  1997-98 to 2010-11) -- not processed, same methodology should apply
  since the compendium page listed them as the same report family.
- MP's and Rajasthan's Udyaniki (Horticulture) department annual
  reports -- not located.
- Rajasthan's Production table (Table 8) district-name parsing bug --
  production values are being extracted correctly page-by-page but
  aren't being attached to the right district row; not fixed this
  session.
- Rajasthan's remaining ~26 crop columns (pulses, oilseeds beyond what's
  covered, fruits, vegetables, condiments & spices, fodder crops) --
  only 6 of ~17 Area sub-pages were processed.
- Resolving MP's 849 unidentified column-blocks -- would need either a
  verified Kruti Dev decode (a real, solvable problem, just not
  attempted here given the numeric cross-validation approach already
  works for the majority) or manual inspection against MP's published
  compendium index/cover pages.
- 34 more states, plus Udyaniki departments for all -- CHARAN 4's
  original plan is to continue a handful at a time, not all at once;
  Punjab and Uttar Pradesh were searched but no direct district-wise PDF
  was found on their official department sites this pass (may need
  deeper searching, or may simply not be published in this form).

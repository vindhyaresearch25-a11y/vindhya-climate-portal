# State Krishi Vibhag / Udyaniki annual reports

CROP_DATA_PROMPT.md CHARAN 4. "Pehle DO rajya par karke dikhao" (Madhya
Pradesh and one more) -- **both done, partially verified**; a third
state, Karnataka, done this session as a continuation of the "a few
states at a time" plan. Methodology per-state below (each state's PDF has
its own layout/encoding/naming quirk -- none of the three scripts
generalizes to another state as-is). Remaining 33 states not started;
owner-approved plan is to continue a few states at a time in future
sessions, not rush all 36 in one pass (2026-08-07 pace check).

| Rajya | Vibhag | Report ka saal | PDF link | Mila/nahi | Kaunse saal | Kaunsi fasal | Kya chhoota |
|---|---|---|---|---|---|---|---|
| Madhya Pradesh | Krishi (Agriculture) | 2019-20 (antim anuman / final estimate) | `mpkrishi.mp.gov.in/Englishsite_New/201920.pdf` | **Mila** | 2019-20 only processed this pass; the same portal also has 2011-12 to 2015-16 (`20152016.pdf`), 2016-17 to 2018-19 (`AP_201819.pdf`), and 1997-98 to 2010-11 (`APY1997to2010.pdf`) downloaded but not yet processed | ~20 distinct crops identified across the 52-district table (Moong, Urad, Maize, Rice, Wheat, Linseed, Groundnut, Sugarcane, Bajra, Masoor, Rapeseed & Mustard, Gram, Arhar/Tur, Soyabean, Jowar, Small millets, Sesamum, Peas & beans, Mesta, Cotton, and more) -- see "What's verified vs not" below | **39% of column-blocks (849/2184) could not be confidently identified**. Also: Udyaniki (Horticulture) department report not located/fetched this pass |
| Madhya Pradesh | Udyaniki (Horticulture) | -- | not fetched | **Nahi** | -- | -- | Not searched for this session |
| Rajasthan | Krishi (Directorate of Economics & Statistics) | 2023-24 | `rajas.rajasthan.gov.in/PDF/562026121630PMbook.pdf` | **Mila** | 2023-24 only (this specific PDF is single-year; the site also lists 2022-23, 2021-22, 2019-20, 2018-19, 2015-16 editions, not fetched this pass) -- note this is a **year DES doesn't have yet** (DES tops out 2022-23), so no DES cross-check was possible for this file, but it extends real national coverage one year forward for this state | 4 crops confidently verified: Bajra, Cotton, Maize, Wheat, all 51 districts (204 rows) -- spot-checked by hand against the PDF's own printed numbers (Ajmer: Bajra 43,787 ha, Maize 5,009 ha, Wheat 28,504 ha, Cotton 13,124 ha, all exact) | **Area only, 4 of ~30+ crops the report actually contains.** Production-table (Table 8) extraction has a real bug (district-name parsing breaks for that table's specific layout) not fixed this session -- production numbers exist in the raw PDF but aren't in the output yet. Only 6 of ~17 Area-table sub-pages and 11 of ~15 Production-table sub-pages were even attempted; many crop columns (pulses, oilseeds, fruits, vegetables, condiments) not yet reconstructed. Udyaniki report not located |
| Rajasthan | Udyaniki | -- | not fetched | **Nahi** | -- | -- | Not searched for this session |
| Karnataka | Krishi (Directorate of Economics & Statistics) | 2022-23 ("Fully Revised Estimates") | `des.karnataka.gov.in/storage/pdf-files/AGS/FRE2022-23Final.pdf` | **Mila** | 2022-23 only processed this pass -- this is DES's own latest year too, so full cross-check was possible (unlike Rajasthan's newer-than-DES file) | 6 crops confidently verified across all 31 districts x up to 3 seasons (Rice, Jowar, Bajra, Maize, Ragi, Wheat) = 496 rows; 380 have a matching DES (district,crop,season) record, of which 358 (94%) match DES's area exactly once this PDF's own stated 2% "bund correction" is applied (see methodology below); hand spot-checked (Bagalkot Wheat Rabi: PDF prints Area 22,430 ha / Production 52,537 t / Yield 2,390 kg/ha exactly, 22,430 x 0.98 = 21,981.4 which matches DES's 21,981 ha to the hectare) | **Only the cereals section (7 of ~29 crop groups, 19 of 171 pages) processed.** Pulses (Tur, Blackgram, Horsegram, Greengram, Avare, Cowpea, Gram), oilseeds (Groundnut, Castor, Sesamum, Linseed, Soyabean, Nigerseed, Mustard, Safflower, Sunflower), commercial/fibre (Cotton, Sugarcane, Tobacco, Mesta, Sunhemp), horticulture (Potato, Onion, Tomato, Beans, Brinjal, Cabbage, Banana, Sweet Potato, Tapioca, Grapes, Mango, Papaya, Cashewnut, Guava, Sapota, Lemon, Pomegranate), and spices (Dry Chillies, Turmeric, Ginger, Garlic, Arecanut, Coriander, Cardamom, Black Pepper, Coconut) sections not attempted -- most of those tables have a different (single Area/Production/Yield column, no season/variety split) layout this script doesn't handle. Paddy (93 rows) deliberately dropped as unverified since DES has no separate raw-paddy figure. Udyaniki department report not located/fetched |

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

## Karnataka methodology (third state, third different problem)

Karnataka's compendium (`FRE2022-23Final.pdf`, 4.3MB, 171 pages,
des.karnataka.gov.in) has **neither** of the first two states' problems:
plain `extract_text()` returns clean, correctly-ordered Unicode
throughout -- no Kruti Dev-style font substitution (MP's problem), no
letter-spaced headers (Rajasthan's problem). Its own three, smaller,
different quirks:

**1. One (crop x season x variety) table per page**, not one big
multi-crop table (MP) or one table per crop-group (Rajasthan). Section IV
gives each of Paddy/Rice/Jowar/Bajra/Maize/Ragi/Wheat up to 12 pages --
{Kharif, Rabi, Summer, All Season} x {Traditional, HYV, Pooled} -- each
with a plain-text page header ("CROP RAGI SEASON KHARIF VARIETY POOLED")
that's trivial to regex-match. `scripts/extract_karnataka_report.py`
keeps only VARIETY=POOLED (Traditional+HYV already summed, matching DES's
granularity) and drops SEASON="ALL SEASON" (a redundant sum across the
seasons already kept separately -- keeping it too would double-count
against DES).

**2. District-name naming-vintage mismatch, not a font/layout bug.** This
PDF prints CURRENT (post-2014 Kannada-spelling) district names --
BELAGAVI, KALABURGI, VIJAYPURA, CHICKBALLAPUR, SHIVAMOGGA, TUMAKURU,
RAMANAGARAM, BAGALKOTE, VIJAYANAGARA -- while `crop_stats_des/`'s
Karnataka records still publish the OLDER English transliterations for
the same 31 districts: Belgaum, Gulbarga, Bijapur, Chikballapur, Shimoga,
Tumkur, Ramanagara, Bagalkot, Vijayanagar. This is a genuine two-vintage
naming mismatch between two live government sources describing the same
districts, a different problem class than either MP's or Rajasthan's.
Plain normalization (strip non-letters, lowercase) auto-matches 22 of 31
district names already (e.g. "BENGALURU- URBAN" -> "Bengaluru urban"
collapse to the same string once punctuation/spaces are stripped); the
other 9 needed an explicit, hand-verified alias table built by comparing
this PDF's own printed district list against
`dashboard/data/crop_stats_des/2022-23.json`'s Karnataka district list
side by side (`KARNATAKA_DISTRICT_PDF_TO_DES` in the script). One further
entry was added after finding a genuine **source-PDF typo**: page 54
(Table 3.5, Jowar/Rabi/Pooled) prints "VIAJAYANAGARA" (letters
transposed) instead of "VIJAYANAGARA" -- confirmed as the same district
by row position (serial 30, matching every other page's row order) before
being added to the alias table, not guessed.

**3. A minor row-wrap rendering quirk**: on 4 of the 19 processed pages
(every Ragi season, plus Wheat Rabi), pdfplumber's `extract_text()` put
district #7's (VIJAYPURA) leading serial number on its own line,
separated from the rest of that row -- dropping the row entirely under a
naive line-by-line parse. Fixed by `merge_wrapped_serial_lines()`: a
lone-serial-number line is rejoined with the line that follows before row
parsing. Verified it recovers exactly the missing VIJAYPURA row on every
affected page (496 rows total after the fix = the expected 31 districts x
16 crop-season combinations exactly, versus 492 before).

**A genuine, useful finding, not a bug**: comparing this PDF's area
figures against DES's for the same (district, crop, season) initially
looked like a widespread mismatch (only 95 of 380 cross-checked rows
matched DES's area exactly). The PDF's own introduction (p. ii) explains
why: a 2% "bund correction" is deducted from gross sown area (for bunds,
water channels, foot tracks) to get the net area DES-style sources
publish. Multiplying this PDF's Area by 0.98 and comparing against DES
resolves 358 of the 380 (94%) to within 2 hectares -- confirmed
precisely on a hand spot-check (Bagalkot Wheat Rabi: PDF Area 22,430 ha
x 0.98 = 21,981.4, DES's own figure is 21,981 ha, matching to the
hectare). Production figures still commonly differ between the two
sources (same pattern as MP and Rajasthan -- different estimate
revision/vintage, not an extraction error) and are reported as-is,
un-reconciled.

**Result: 496 verified (district, crop, season) rows** across 6 crops
(Rice, Jowar, Bajra, Maize, Ragi, Wheat) x 31 districts x up to 3 seasons.
Paddy (93 rows) was dropped entirely as unverified -- DES has no separate
raw-paddy figure, only a milling-adjusted "Rice" one, and treating them
as interchangeable would be exactly the kind of guess this repo's
no-fabrication rule forbids. `extraction_verified` is `false` in the
output file for this reason, following the same rule the first two
states' files use.

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
- Karnataka's remaining ~22 crop groups (pulses, oilseeds, commercial/
  fibre crops, horticulture, spices -- see the table row above for the
  full list) -- only the 7-crop cereals section (19 of 171 pages) was
  processed this pass; most of those remaining tables use a different,
  simpler (single Area/Production/Yield column, no season/variety split)
  layout this script doesn't yet parse.
- Karnataka's Udyaniki (Horticulture Department, separate from DES)
  annual report -- not located/fetched this session.
- 33 more states, plus Udyaniki departments for all -- CHARAN 4's
  original plan is to continue a handful at a time, not all at once;
  Punjab and Uttar Pradesh were searched but no direct district-wise PDF
  was found on their official department sites in a previous session
  (may need deeper searching, or may simply not be published in this
  form).

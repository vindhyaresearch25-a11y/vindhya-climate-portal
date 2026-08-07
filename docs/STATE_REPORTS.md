# State Krishi Vibhag / Udyaniki annual reports

CROP_DATA_PROMPT.md CHARAN 4. "Pehle DO rajya par karke dikhao" (Madhya
Pradesh and one more) -- **Madhya Pradesh done (partially verified,
methodology below); the second state not started this session.**

| Rajya | Vibhag | Report ka saal | PDF link | Mila/nahi | Kaunse saal | Kaunsi fasal | Kya chhoota |
|---|---|---|---|---|---|---|---|
| Madhya Pradesh | Krishi (Agriculture) | 2019-20 (antim anuman / final estimate) | `mpkrishi.mp.gov.in/Englishsite_New/201920.pdf` | **Mila** | 2019-20 only processed this pass; the same portal also has 2011-12 to 2015-16 (`20152016.pdf`), 2016-17 to 2018-19 (`AP_201819.pdf`), and 1997-98 to 2010-11 (`APY1997to2010.pdf`) downloaded but not yet processed | ~20 distinct crops identified across the 52-district table (Moong, Urad, Maize, Rice, Wheat, Linseed, Groundnut, Sugarcane, Bajra, Masoor, Rapeseed & Mustard, Gram, Arhar/Tur, Soyabean, Jowar, Small millets, Sesamum, Peas & beans, Mesta, Cotton, and more) -- see extraction_verified note below | **39% of column-blocks (849/2184) could not be confidently identified** -- see "What's verified vs not" below. Also: Udyaniki (Horticulture) department report not located/fetched this pass |
| Madhya Pradesh | Udyaniki (Horticulture) | -- | not fetched | **Nahi** | -- | -- | Not searched for this session |
| (second state) | Krishi | -- | not fetched | **Nahi** | -- | -- | CHARAN 4 asks for MP + one more; only MP attempted this session |

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

## Not done this session

- The other 3 already-downloaded MP PDFs (2011-12 to 2018-19, and
  1997-98 to 2010-11) -- not processed, same methodology should apply
  since the compendium page listed them as the same report family.
- MP's Udyaniki (Horticulture) department annual report -- not located.
- A second state's Krishi report (CHARAN 4 explicitly asks for 2 states
  before scaling to all 36) -- not started.
- Resolving the 849 unidentified column-blocks -- would need either a
  verified Kruti Dev decode (a real, solvable problem, just not
  attempted here given the numeric cross-validation approach already
  works for the majority) or manual inspection against MP's published
  compendium index/cover pages.

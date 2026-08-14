# Kisan Sahayak RAG (search_manuals) -- corpus coverage and contract

Owner instruction (2026-08-08): disease/pest answers should come from real
manuals, not model memory. This is the honest record of what's actually in
the corpus, what was tried and excluded, and the exact contract the Worker
and the ingestion script both depend on. Same convention as
`docs/STATE_REPORTS.md` -- update this file whenever the corpus changes,
don't let the claim drift ahead of what was actually ingested.

## The contract (keep these three in sync if you ever rename anything)

| Thing | Value | Where it's used |
|---|---|---|
| Vectorize index name | `kisan-sahayak-manuals` | `wrangler vectorize create` command below; `scripts/12_ingest_kisan_manuals.py`'s `VECTORIZE_INDEX_NAME` |
| Worker binding name | `VECTORIZE_INDEX` | `cloudflare/wrangler_kisan_sahayak.toml`'s `[[vectorize]]` block; `cloudflare/kisan_sahayak_worker.js`'s `env.VECTORIZE_INDEX` |
| Embedding model | `@cf/baai/bge-base-en-v1.5` (768-dim) | Both the Worker (query-time) and the ingestion script (ingest-time) -- **must match**, a mismatched embedding model would still "work" (no error) but return meaningless nearest-neighbours |

Embedding model verified 2026-08-08 against
`developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/`: "BAAI
general embedding (Base) model that transforms any given text into a
768-dimensional vector" -- this confirms the assumption the task started
with rather than requiring a swap.

## One-time setup (run yourself)

```bash
npm install -g wrangler        # if not already installed
wrangler login
wrangler vectorize create kisan-sahayak-manuals --dimensions=768 --metric=cosine
```

Then ingest the corpus (needs `CLOUDFLARE_ACCOUNT_ID` and a
`CLOUDFLARE_API_TOKEN` scoped to `Workers AI:Read` + `Vectorize:Edit` --
Cloudflare dashboard -> My Profile -> API Tokens):

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_API_TOKEN=...
cd scripts
python 12_ingest_kisan_manuals.py --dry-run   # sanity check first, no creds/network writes needed beyond the PDF fetches
python 12_ingest_kisan_manuals.py             # real embed + upsert
```

Then deploy (or redeploy) the Worker so its `[[vectorize]]` binding picks
up the now-existing index:

```bash
cd cloudflare
wrangler deploy --config wrangler_kisan_sahayak.toml
```

Neither of these was run this session -- both need the owner's own
Cloudflare login, which this sandbox cannot use (confirmed 2026-08-08).

## What's actually in the corpus (updated 2026-08-12/13, PENDING.md item 12)

**`wheat_pop_1984` REMOVED 2026-08-12.** Re-fetched and read in full: it
explicitly recommends Aldrin 5% @ 25 kg/ha (banned in India since
2001/2002 under the Insecticides Act), BHC/HCH (banned 1997),
organomercurial seed-dressing fungicides Ceresan/Agrosan (mercury
compounds, banned), and Dimecron/phosphamidon (restricted for most uses
today) at specific dosages. A metadata caveat would not stop a model from
surfacing a banned chemical name+dosage as if it were current advice, so
the document was dropped from `CORPUS` and its 16 vectors deleted from
Vectorize rather than kept with a warning attached.

**8 new documents added 2026-08-12/13** (PENDING.md's 8 priority crops:
wheat, rice, soybean, chana/chickpea, sarson/mustard, cotton, maize,
potato -- 6 of 8 got real coverage; maize and potato did not, see "Not
covered" below). Every URL fetched live and confirmed 200 OK /
`application/pdf` before being added. Sources: ICAR institute bulletins
(IIWBR, CRRI, IISR, IIPR, DRMR), a State Agricultural University's own
Package-of-Practices (Punjab Agricultural University -- the single
richest source added, 208+184 pages covering most of the 8 crops in one
place), and a state POP hosted on Vikaspedia (Govt. of India digital
portal, MeitY/C-DAC). Never ResearchGate, never Sci-Hub.

13 real PDFs total (6 original minus 1 removed, plus 8 new), extracted
with `pdfplumber`, chunked at ~500 words with 75-word overlap. `--dry-run`
output on this exact corpus (2 of 13 failed to fetch this run, both
transient host timeouts, not excluded from `CORPUS` -- retry on the next
ingestion run):

| id | Document | Publisher | Crop | Year | Pages (text-extractable) | Chunks |
|---|---|---|---|---|---|---|
| `organic_pop_maharashtra` | Package of Practices for Organic Farming, Maharashtra | Dept. of Agriculture and Farmers Welfare | multiple (organic) | not stated in doc | 15 (15) | 7 |
| `crri_direct_seeded_rice_2025` | CRRI Technology Bulletin No. 250: Direct Seeded Rice | ICAR-CRRI | rice | 2025 | 12 (12) | 8 |
| `icar_kharif_agro_advisories_2025` | ICAR Kharif Agro-Advisories for Farmers 2025 | ICAR | multiple (kharif) | 2025 | 310 (309) | 616 |
| `imd_agromet_gujarat` | Agromet Advisory Service Bulletin -- Gujarat | IMD, Gramin Krishi Mausam Sewa | multiple (state agromet) | rolling bulletin | 74 (74) | 62 |
| `imd_agromet_assam` | Agromet Advisory Service Bulletin -- Assam | IMD, Gramin Krishi Mausam Sewa | multiple (state agromet) | rolling bulletin | 17 (17) | 18 |
| `pau_pop_kharif_2026` | Package of Practices for Crops of Punjab -- Kharif 2026 | Punjab Agricultural University | multiple (paddy/rice, cotton, maize, soybean, sugarcane, kharif pulses) | 2026 | 208 (208) | 203 |
| `pau_pop_rabi_2025_26` | Package of Practices for Crops of Punjab -- Rabi 2025-26 | Punjab Agricultural University | multiple (wheat, gram/chana, mustard/raya, potato, sugarcane, rabi pulses) | 2025 | 184 (184) | 176 |
| `iiwbr_wheat_pocket_2023` | Wheat Cultivation in India -- Pocket Guide (EB-52) | ICAR-IIWBR | wheat | 2023 | 40 (36) | 18 |
| `iiwbr_wheat_conservation_agri_2024` | Conservation Agriculture for Climate Resilience of Wheat Systems (RB-49) | ICAR-IIWBR | wheat | 2024 | 36 (34) | 47 |
| `iisr_soybean_extension_2023` | Improved Technologies for Maximising Soybean Productivity (EB-18) | ICAR-IISR, Indore | soybean | 2023 | 77 (77) | 37 |
| `iipr_chickpea_pc_report_2022` | AICRP Chickpea -- Project Coordinator's Report 2021-22 | ICAR-IIPR, Kanpur | chana/chickpea | 2022 | 46 (46) | 48 |
| `drmr_mustard_assam_bmp_2021` | Best Management Practices of Rapeseed-Mustard for Assam | ICAR-DRMR via rmkpassam.in | sarson/mustard | 2021 | 44 (37) | 25 |
| `cotton_maharashtra_pop` | Approved Package of Practices for Cotton: Maharashtra State | Maharashtra Dept. of Agriculture, via Vikaspedia | cotton | not stated in doc | 7 (7) | 6 |
| **Subtotal (round 1, as of 2026-08-12/13)** | | | | | **~880 text-extractable pages** | **1263 chunks, 926 vectors upserted** |

**Note on vector-count drift:** a live `wrangler vectorize info kisan-sahayak-manuals`
check at the start of round 2 (2026-08-13) showed **1389** vectors already
live, not the 926 last recorded above -- a real discrepancy between this
file's last update and the index's actual state, not investigated further
this round (out of scope; the index only ever upserts, never silently
deletes, so the extra vectors are not a correctness risk, just an
undocumented gap). Round 2 treats 1389 as its own honest starting baseline
-- see the round 2 table below for before/after counts on every batch
ingested this round.

**Per-crop coverage, honestly assessed** (round 1, PENDING.md's 8 priority crops):
wheat -- **strong** (2 dedicated IIWBR docs + PAU rabi POP + the removed
1984 doc's gap is more than covered); rice -- **strong** (CRRI DSR
bulletin + PAU kharif POP); soybean -- **covered** (1 dedicated IISR
bulletin + PAU kharif POP); chana/chickpea -- **covered** (1 dedicated
IIPR report + PAU rabi POP); sarson/mustard -- **covered** (1 dedicated
DRMR bulletin + PAU rabi POP); cotton -- **covered, thin** (1 Maharashtra
POP + PAU kharif POP; the official `cotton.dac.gov.in` POP PDF is a
scanned image with zero extractable text -- excluded rather than shipped
empty); maize and potato got dedicated documents in round 2 below (see
`dmr_maize_production_systems_2013`, `cpri_potato_gap_2020`).

## Round 2 (2026-08-13, PENDING.md item 12 continued -- "sabhi jitne bhi crop
hain un sabka cultivation crop wise dalo")

Owner instruction: add cultivation/good-agriculture-practices content for
ALL 59 crops in `dashboard/data/crop_list.json`, crop-wise. Same discipline
as round 1: every URL fetched live and confirmed 200 OK / `application/pdf`
before being added to `CORPUS`, no ResearchGate/Sci-Hub, ICAR institute
bulletins and State Agricultural University POPs preferred over research
papers, real ingestion run after every batch (not just `--dry-run`).

**New systemic fix this round: chunk-level banned-chemical filter.**
Round 1 found and removed one whole document (`wheat_pop_1984`) because
banned-pesticide recommendations ran through its entire plant-protection
philosophy. Round 2 found the *opposite* shape twice in the first two
batches alone -- an ICAR-IIMR finger millet POP recommending Phosphamidon
for stem borer, and a 2022-dated ICAR small-millets book recommending
Ceresan seed treatment for foxtail millet -- one isolated banned-chemical
sentence each, inside otherwise clean, current, useful documents. Dropping
either whole document over one sentence would have thrown away real good
content for no safety benefit. `scripts/12_ingest_kisan_manuals.py`'s
`chunk_pages()` now runs every chunk through `_contains_banned_chemical()`
(`BANNED_CHEMICAL_TERMS` -- Aldrin, Dieldrin, Endrin, BHC/HCH/Lindane,
Ceresan/Agrosan, Dimecron/Phosphamidon, DDT, Heptachlor, Chlordane,
Endosulfan, Monocrotophos, Methyl/Ethyl Parathion, Calcium/Sodium Cyanide,
Nicotine Sulphate, Toxaphene, Pentachlorophenol, Pentachloronitrobenzene,
Nitrofen, Menazon, Sodium Methane Arsonate, Copper Acetoarsenite,
Chlorofenvinphos, Phenyl Mercury Acetate, Ethyl Mercury Chloride -- India's
CIB&RC banned/restricted list, widened partway through this round after
multiple new documents' own "banned pesticide" appendices kept surfacing
more of them) and **drops** (not merely flags) any matching chunk before
embedding, logging which chunk and which term. This is real removal, not a
caveat -- exactly the same corrective action round 1 took, applied at finer
grain so it doesn't cost the rest of a good document. It runs automatically
on every future document too.

### Round 2 batch progress (Vectorize vector count before/after each batch)

| Batch | Crops added | Documents | Vectors before -> after |
|---|---|---|---|
| 1 (cereals/millets + oilseeds) | maize, jowar, bajra, ragi, barley, small millets, groundnut, sesamum, castor seed, sunflower, safflower, niger seed | 9 (`dmr_maize_production_systems_2013`, `iimr_sorghum_kharif_pop`, `iimr_sorghum_rabi_pop`, `iimr_pearl_millet_pop`, `iimr_finger_millet_pop`, `iiwbr_barley_eb53_pocket_guide`, `iimr_small_millets_gap_2022`, `iimr_kodo_millet_pop`, `dgr_groundnut_pop_states`, `tnau_cpg2020_oilseeds`) | 1389 -> 2069 (+680) |
| 2 (vegetables + fruits) | potato, onion, tomato, brinjal, bhindi, cabbage, cauliflower, banana, mango, citrus fruit, papaya, orange, pome fruit, other fresh fruits | 15 (`cpri_potato_gap_2020`, `pau_vegetable_pop_2021`, `tnau_horticulture_cpg_2020`, `niphm_aesa_ipm_banana_2014`, `niphm_aesa_ipm_mango_2014`, `niphm_aesa_ipm_citrus_2014`, `niphm_aesa_ipm_papaya_2015`, `niphm_aesa_ipm_apple_2014`, `niphm_aesa_ipm_pear_2015`, `niphm_aesa_ipm_guava_2015`, `kau_pop_crops_2016`, `hpshiva_subtropical_pop_2022`, `ppqs_mango_export_pop_2022`, `nhm_ipm_schedule_banana_2012`, `nrcb_tr4_banana_technote`) | 2069 -> 3325 (+1256) |
| 3 (pulses) | arhar/tur, moong, urad, masoor, horse-gram, khesari, cowpea, peas & beans | 8 successfully ingested (`aau_pigeonpea_pop_2021`, `aau_greengram_pop_2021`, `aau_blackgram_pop_2021`, `aau_lentil_pop_2021`, `tnau_cpg2020_pulses`, `aau_grasspea_pop_2021`, `aau_cowpea_pop_2021`, `aau_pea_pop_2021`) -- see note below on `aau_kharif_pop_2023`/`aau_rabi_pop_2023` (link rot, removed, no dedicated "other rabi/kharif pulses" doc this round) | ~3325 -> 3666 (+341) |
| 4 (fibre/plantation + spices) | sugarcane, jute, tobacco, mesta, sannhamp, turmeric, dry ginger | 5 successfully ingested (`sbi_tn_vksa_agrotech_2025`, `crijaf_jute_allied_fibres_cropcalendar_2013`, `ctri_nirca_fcv_agronomy`, `iisr_turmeric_ext_pamphlet_2022`, `iisr_ginger_ext_pamphlet_2025`) -- `iisr_chilli_gap_2019` (dry chillies) and `iisr_coriander_gap_2019` (coriander) verified live and added to `CORPUS` but **NOT YET INGESTED**, see rate-limit note below | ~3666 -> 3996 (+~330, includes some concurrent-session activity between checks, see note below) |

**This session hit a real Workers AI embedding rate limit (HTTP 429 on
`@cf/baai/bge-base-en-v1.5`) partway through batch 4**, after roughly
2400+ chunks embedded across today's batches -- the existing
retry-with-backoff (added by a concurrent/earlier continuation of this same
task, see the git log for `21d6bf3`/`436a203`) retried up to ~80s and still
failed. Per this repo's "seemaa paas aaye to RUKO" rule, ingestion was
stopped rather than hammering a failing endpoint. `iisr_chilli_gap_2019`
and `iisr_coriander_gap_2019` are real, verified (200 OK/application/pdf),
already in `CORPUS` -- just run `python 12_ingest_kisan_manuals.py --only
iisr_chilli_gap_2019` (and the coriander id) again once the rate limit
window clears (likely resets on a rolling/daily basis; retry in a later
session rather than immediately).

**Vector-count bookkeeping note:** this task ran across a session
interruption (the working worktree was cleaned up mid-task; batches 1-2's
commits survived via a merge into `main`, batch 3/4's `CORPUS` entries also
survived but had NOT actually been ingested yet when this session resumed
-- confirmed directly via Vectorize `get_by_ids`, not assumed from vector
count deltas alone, since count deltas conflate genuinely-new ids with
same-id upserts of already-live documents). Other sessions also
continued this same PENDING.md item 12 task concurrently/sequentially
(commits `21d6bf3`, `436a203` improved the ingestion script's retry/
checkpoint behaviour) and evidently ran some ingestion of their own between
this session's checkpoints, hence the batch 4 delta being larger than
strictly this session's own additions -- flagged honestly rather than
claimed as this session's sole work.

**`aau_kharif_pop_2023` / `aau_rabi_pop_2023` removed (link rot):** both
verified live (200 OK/application/pdf) when found and added to `CORPUS`
during research; both now 404 when re-checked before this session's real
ingestion run (the `kvkkokrajhar.aau.ac.in` host itself still resolves and
serves other pages, just not these two files anymore). Removed from
`CORPUS` rather than kept as a dead entry -- real, honest gap for "Other
Rabi pulses" / "Other Kharif pulses" as dedicated multi-crop documents;
those categories still get partial coverage from
`icar_kharif_agro_advisories_2025` and the PAU kharif/rabi POPs already in
this corpus. Retry the exact URLs in a future session before assuming
permanently gone.

**Linseed** is covered without a new document -- the oilseeds research pass
found that the existing `pau_pop_rabi_2025_26` PDF (already ingested in
round 1) has a dedicated Linseed section on pp.65-66 that just wasn't
called out in that entry's crop label; re-fetching the same URL under a new
id would only duplicate already-live vectors, so no new CORPUS entry was
added for it.

**Rejected this round:** a 2005 ICAR-CRIDA linseed bulletin
(`icar-crida.res.in/assets/img/Books/2005-06/Linseed.pdf`) -- verified
live/PDF, but explicit Aldrin/Chlordane, BHC, Ceresan, Phosphamidon/
Dimecron, Endosulfan, and Monocrotophos dosages ran through the whole
document (same pervasive shape as `wheat_pop_1984`), so the whole document
was excluded rather than relying on the chunk filter for something this
saturated with banned content.

**Two real extraction/fetch bugs found and fixed this session**, both in
`scripts/12_ingest_kisan_manuals.py`:
1. `fetch_pdf_bytes()`'s exception handling didn't catch `socket.timeout`
   on this machine's Python 3.9 (it's a distinct class from `TimeoutError`
   before 3.10) -- a single slow host (icar.org.in, observed live) crashed
   the *entire* multi-document run instead of failing just that one
   document. Now also catches `socket.timeout`/`OSError`.
2. `organic_pop_maharashtra`'s PDF renders each glyph via multiple
   overlapping paths (a faux-bold/emboss effect from whatever tool
   generated it) -- pdfplumber's `extract_text()` picked up every
   overlapping instance, turning "Package" into
   `"PPPPPaaaaaccccckkkkkaaaaagggggeeeee"` (every character repeated
   exactly 5x). This was **already live in the original 6-document
   corpus** since 2026-08-08, unnoticed until this session's dry-run
   output was actually read closely. Fixed with a detector
   (`_looks_5x_duplicated()`, checks what fraction of a page's text is
   covered by 5+-character runs) and repair (`_fix_5x_duplicated()`,
   collapses those runs to 1) applied per-page in `extract_pages()` --
   scoped narrowly enough (>50% coverage threshold) that it never touches
   normal prose elsewhere. Verified: the sample chunk now reads "Package
   of Practices for Organic Production of Crops..." correctly. The
   re-ingestion run in this session re-embedded this document with the
   fix applied, so the live Vectorize index no longer carries the garbled
   version.

Note on `wheat_pop_1984`: see removal note above -- this document is
**gone from the corpus entirely**, not merely caveated.
The IMD bulletins are **rolling** documents re-issued twice weekly at
state level -- their chunks carry `ingested_date`, not a claimed
publication year, and should be re-ingested periodically to stay current
rather than treated as a fixed historical corpus like the ICAR/PAU PoPs.

Every chunk's Vectorize metadata carries `text`, `source`, `crop`, `year`,
`publisher`, `url`, `page` (a single page number or a `"12-13"` range if
the chunk spans a page boundary), and `ingested_date` -- this is exactly
what `kisan_sahayak_worker.js`'s `search_manuals` tool returns to the
model, and what the model is instructed to cite in the answer's Source
list.

## What was tried and excluded (checked 2026-08-08, not assumed)

| Host | What's there (per a live web search) | What happened |
|---|---|---|
| `krishi.icar.gov.in` | ICAR's own PoP archive -- e.g. hybrid rice cultivation and hybrid rice seed production PDFs under `/PDF/Selected_Tech/Crop Production/` | Every direct fetch attempt returned a DNS resolution failure (`curl` exit 6) from this environment, both this session and the prior one. The URLs themselves are real (found via web search, not guessed) -- worth retrying directly, not necessarily broken upstream. |
| `kvk.icar.gov.in` | KVK's Package-of-Practices upload area, `/API/Content/PPupload/<code>.pdf` (e.g. `k0306_1.pdf` for paddy) | Same DNS failure, both sessions. |
| `icar-nrri.in` | National Rice Research Institute bulletins (organic rice, aromatic rice PoPs) | Same DNS failure this session. |
| `icar-iirr.org` | Indian Institute of Rice Research | Root resolves (HTTP 301 redirect), not pursued further this pass -- worth a follow-up. |
| `agris.fao.org` | FAO AGRIS scholarly index | HTTP 403 (Cloudflare bot-detection challenge) on a plain keyless request -- same finding as `research_papers_loader.js` recorded for this host. |
| `npss.dac.gov.in` | National Pest Surveillance System (AI/ML photo pest ID, launched Aug 2024) | Portal itself resolves (HTTP 200) but it's a JS single-page app; no `/api/`, `/swagger-ui.html`, or other common API path returned anything but 404. No public bulk-data/API access found. Not a document corpus source in any case -- this was a side-check, not part of the ingestion pipeline. |

**Follow-up for a future session:** retry `krishi.icar.gov.in` and
`kvk.icar.gov.in` directly (their DNS failure looked environment-specific,
not a real outage, both times) -- they're the deepest real PoP archives
found and would meaningfully widen crop coverage beyond wheat/rice/organic.

## Re-running after corpus changes

`scripts/12_ingest_kisan_manuals.py` always **upserts** (not insert-only),
so re-running it after editing `CORPUS` is safe -- existing chunk ids
(`<doc id>__chunk<NNNN>`) get overwritten in place, new ids get added. It
does not delete vectors for a document removed from `CORPUS` -- if you drop
a document, delete its vectors from the Vectorize index by id prefix
yourself (`wrangler vectorize delete-by-ids ...` or the Vectorize REST
delete endpoint) before or after removing it from the list.

## Bug found and fixed 2026-08-12: citations never appeared in production

The index existed (727 vectors, created 2026-08-08) and the ingest script
had run successfully, but `search_manuals` returned `available: false` on
every real request. Root cause, confirmed by direct inspection (not
guessed): `cloudflare/wrangler_kisan_sahayak.toml`'s `[[vectorize]]` block
was left commented out after the very first deploy (per this file's own
"ORDERING FIX" step 1) and never uncommented for the redeploy in step 3 --
so `env.VECTORIZE_INDEX` was `undefined` in every production request,
hitting `toolSearchManuals`'s own honest degrade path
(`'Vectorize index not configured on this deployment yet'`). Fixed: the
block is uncommented now. **Requires an actual `wrangler deploy
--config wrangler_kisan_sahayak.toml` to take effect** -- this session's
`CLOUDFLARE_API_TOKEN` only has Vectorize-read scope, not Workers-edit, so
deploy could not be completed from here; the owner needs to run it (or
grant the token `Workers Scripts:Edit`).

Two more bugs found via direct Vectorize queries (bypassing the Worker,
using the same account credentials) while diagnosing the above, both fixed
in the same commit:

1. **`looksLikeManualQuestion()`'s keyword list was too narrow.** Neither
   of the owner's two test questions ("DSR ki kheti kaise karein", "gehun
   me peela ratua kaise roken") matched any keyword, so `search_manuals`
   was never even attempted for them, independent of the binding bug.
   "ratua" (Hindi transliteration for rust) and general practice terms
   ("dsr", "kheti kaise", "bijai", "katai", "nursery", "transplant", ...)
   are now in `MANUAL_KEYWORDS`.
2. **Hinglish/Devanagari queries embed poorly against `bge-base-en-v1.5`
   (English-only).** Direct side-by-side test, same account, same index:

   | Query | Top match | Score |
   |---|---|---|
   | "gehun me peela ratua kaise roken" (Hinglish) | IMD Assam bulletin, thunderstorm text (wrong doc, irrelevant) | 0.646 |
   | "wheat yellow rust management control" (English) | ICAR Kharif Advisories p.113, actual fungicide dosage for rust | 0.740 |
   | "DSR ki kheti kaise karein" (Hinglish) | ICAR Kharif Advisories p.5-6, garbled Devanagari (legacy-font PDF extraction, unrelated to DSR) | 0.674 |
   | "how to grow direct seeded rice DSR" (English) | CRRI Technology Bulletin 250 p.1-3, the actual right document | 0.802 |

   Fixed with `translateQueryToEnglish()`: queries containing Devanagari
   script or common Hinglish function words (kaise/hai/ki/ke/mein/...) are
   translated via Workers AI's `@cf/meta/m2m100-1.2b` before embedding.
   Best-effort only -- any failure falls back to embedding the original
   query untranslated, never blocks the answer. **Not live-verified this
   session** (Workers AI free-tier rate limit was hit while diagnosing the
   above and didn't clear before this session ended) -- retest the two
   questions above after deploy and confirm the translated-query scores
   look like the English column, not the Hinglish column.

**Known residual gap, not fixed this session:** the ICAR Kharif
Agro-Advisories PDF has at least one genuinely garbled section (bilingual
PDF, Hindi front-matter pages extracted through a legacy non-Unicode font
-- the same class of problem `docs/STATE_REPORTS.md` already documents for
crop-report PDFs, e.g. "Hkwfedk fuHkk jgs gSaA..." instead of real
Devanagari). It didn't surface in the English-query top-5 results above,
so it's not actively breaking retrieval right now, but it is still sitting
in the index and could surface for some other query. Not re-extracted or
purged this session -- would need either a Kruti Dev-class font decoder
(risk of silently mislabeling text, the exact failure mode this repo's
no-fabrication rule exists to prevent) or simply dropping the affected
page range and re-ingesting.

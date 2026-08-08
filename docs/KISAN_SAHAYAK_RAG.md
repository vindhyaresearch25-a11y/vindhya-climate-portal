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

## What's actually in the corpus (verified 2026-08-08, dry-run output)

Six real PDFs, every one confirmed with a live HTTP fetch this session
(200 OK, `application/pdf`), extracted with `pdfplumber`, chunked at ~500
words with 75-word overlap. `--dry-run` output on this exact corpus:

| id | Document | Publisher | Crop | Year | Pages (text-extractable) | Chunks |
|---|---|---|---|---|---|---|
| `wheat_pop_1984` | Package of Practices for Increasing Wheat Production | ICAR-IIWBR | wheat | 1984 | 31 (31) | 16 |
| `organic_pop_maharashtra` | Package of Practices for Organic Farming, Maharashtra | Dept. of Agriculture and Farmers Welfare | multiple (organic) | not stated in doc | 15 (15) | 7 |
| `crri_direct_seeded_rice_2025` | CRRI Technology Bulletin No. 250: Direct Seeded Rice | ICAR-CRRI | rice | 2025 | 12 (12) | 8 |
| `icar_kharif_agro_advisories_2025` | ICAR Kharif Agro-Advisories for Farmers 2025 | ICAR | multiple (kharif) | 2025 | 310 (309) | 616 |
| `imd_agromet_gujarat` | Agromet Advisory Service Bulletin -- Gujarat | IMD, Gramin Krishi Mausam Sewa | multiple (state agromet) | rolling bulletin, no fixed year | 74 (74) | 62 |
| `imd_agromet_assam` | Agromet Advisory Service Bulletin -- Assam | IMD, Gramin Krishi Mausam Sewa | multiple (state agromet) | rolling bulletin, no fixed year | 17 (17) | 18 |
| **Total** | | | | | **459 pages, 458 with extractable text** | **727 chunks** |

Note on `wheat_pop_1984`: it's a scanned 1984 document; pdfplumber's text
layer for it is real but visibly OCR-garbled in places (e.g. "PACI(AGE OF
PRACTIGES" for "PACKAGE OF PRACTICES") -- this is the document's own
extracted text, not a bug in the chunker, and is kept as-is rather than
"corrected" (correcting it would mean guessing what the original said).
The IMD bulletins are **rolling** documents re-issued twice weekly at
state level -- their chunks carry `ingested_date`, not a claimed
publication year, and should be re-ingested periodically to stay current
rather than treated as a fixed historical corpus like the ICAR PoPs.

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
